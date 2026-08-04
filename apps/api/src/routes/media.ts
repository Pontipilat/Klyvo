import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';
import { createPreview, previewKey } from '../lib/images.js';
import { prisma } from '../lib/prisma.js';
import { storageProvider } from '../providers/index.js';

async function readBuffer(key: string) {
  const chunks: Buffer[] = [];
  for await (const chunk of await storageProvider.open(key)) {
    const value: unknown = chunk;
    if (Buffer.isBuffer(value)) chunks.push(Buffer.from(value));
    else if (typeof value === 'string' || value instanceof Uint8Array) {
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks);
}

/**
 * Готовит уменьшённое превью и кладёт его рядом с оригиналом.
 * Первый запрос платит за конвертацию, все последующие получают готовый файл.
 */
async function resolveThumbnailKey(key: string, log: FastifyRequest['log']) {
  if (!storageProvider.putBuffer || !storageProvider.exists) return key;
  const smallKey = previewKey(key);
  if (await storageProvider.exists(smallKey)) return smallKey;
  const original = await readBuffer(key);
  const preview = await createPreview(original, undefined, log);
  if (!preview) return key;
  await storageProvider.putBuffer(smallKey, preview, 'image/jpeg');
  log.info(
    { from: original.length, to: preview.length },
    'Превью уменьшено и закэшировано',
  );
  return smallKey;
}

function parseRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header);
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  // Суффиксная форма "bytes=-500" означает последние 500 байт.
  const start = rawStart ? Number(rawStart) : Math.max(0, size - Number(rawEnd));
  const end = rawStart ? (rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}

export const mediaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/media/videos/:id/:kind', async (request, reply) => {
    const { id, kind } = request.params as { id: string; kind: 'video' | 'thumbnail' | 'preview' };
    if (kind !== 'video' && kind !== 'thumbnail' && kind !== 'preview') {
      throw new AppError(404, 'MEDIA_NOT_FOUND', 'Media was not found');
    }
    const video = await prisma.video.findFirst({ where: { id, deletedAt: null } });
    if (!video) throw new AppError(404, 'MEDIA_NOT_FOUND', 'Media was not found');
    // Если облегчённая копия ещё не готова, отдаём оригинал — лента не ломается.
    const storedKey =
      kind === 'thumbnail'
        ? (video.thumbnailPreviewStorageKey ?? video.thumbnailStorageKey)
        : kind === 'preview'
          ? (video.previewStorageKey ?? video.videoStorageKey)
          : video.videoStorageKey;
    const fallback = kind === 'thumbnail' ? video.thumbnailUrl : video.videoUrl;
    if (!storedKey) return reply.redirect(fallback);

    const key = kind === 'thumbnail' ? await resolveThumbnailKey(storedKey, request.log) : storedKey;
    const size = await storageProvider.size(key);
    // Картинки сохраняются в JPEG, поэтому по всем трём адресам у них один тип.
    const mimeType =
      kind === 'thumbnail' || video.mediaType === 'IMAGE' ? 'image/jpeg' : 'video/mp4';

    reply
      .type(mimeType)
      .header('Accept-Ranges', 'bytes')
      // Содержимое по этому адресу никогда не меняется, поэтому телефон может
      // держать его в кэше и не скачивать превью заново при каждом открытии ленты.
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('ETag', `"${key}-${size}"`);

    if (request.headers['if-none-match'] === `"${key}-${size}"`) {
      return reply.code(304).send();
    }

    const rangeHeader = request.headers.range;
    if (rangeHeader) {
      const range = parseRange(rangeHeader, size);
      if (!range) {
        return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      }
      // Читаем с диска только запрошенный отрезок, а не весь файл.
      const stream = await storageProvider.open(key, range);
      return reply
        .code(206)
        .header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
        .header('Content-Length', range.end - range.start + 1)
        .send(stream);
    }

    reply.header('Content-Length', size);
    return sendStream(reply, key);
  });
};

async function sendStream(reply: FastifyReply, key: string) {
  return reply.send(await storageProvider.open(key));
}
