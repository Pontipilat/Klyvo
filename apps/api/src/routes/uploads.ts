import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { storageProvider } from '../providers/index.js';

const acceptedMime = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
]);

export const uploadRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/uploads', { preHandler: authenticate }, async (request, reply) => {
    const upload = await request.file();
    if (!upload) throw new AppError(400, 'FILE_REQUIRED', 'Choose an image or video');
    if (!acceptedMime.has(upload.mimetype))
      throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Unsupported file type');
    const stored = await storageProvider.put(upload.file, upload.filename, upload.mimetype);
    if (upload.file.truncated) {
      await storageProvider.remove(stored.key);
      throw new AppError(413, 'FILE_TOO_LARGE', 'The uploaded file is too large');
    }
    const asset = await prisma.generationAsset.create({
      data: {
        userId: request.user.sub,
        type: upload.mimetype.startsWith('image/') ? 'IMAGE' : 'VIDEO',
        storageKey: stored.key,
        mimeType: upload.mimetype,
        fileName: upload.filename.slice(0, 200),
        fileSize: stored.size,
      },
    });
    return reply.code(201).send({ asset: { ...asset, url: `/uploads/${asset.id}` } });
  });

  fastify.get('/uploads/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const asset = await prisma.generationAsset.findFirst({
      where: { id, userId: request.user.sub },
    });
    if (!asset) throw new AppError(404, 'ASSET_NOT_FOUND', 'File was not found');
    reply.type(asset.mimeType);
    reply.header('Content-Disposition', `inline; filename="${asset.fileName.replaceAll('"', '')}"`);
    return reply.send(await storageProvider.open(asset.storageKey));
  });
};
