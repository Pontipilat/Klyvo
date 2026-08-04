import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  calculateSingleGenerationCost,
  defaultModelForMode,
  findGenerationModel,
  type GenerationInput,
  type GenerationMode,
} from '@klyvo/shared';
import type { Generation } from '@prisma/client';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { detectLanguage } from '../lib/language.js';
import { prisma } from '../lib/prisma.js';
import { createPreview, previewKey } from '../lib/images.js';
import { createVideoPreview, extractPosterFrame, feedPreviewKey } from '../lib/video-preview.js';
import {
  liveProviders,
  mediaGenerationProvider,
  moderationProvider,
  promptEnhancementProvider,
  storageProvider,
} from '../providers/index.js';
import type { CompletedMedia, MediaGenerationInput } from '../providers/contracts.js';
import { ProviderRequestError } from '../providers/production.js';

const terminalStatuses = new Set(['COMPLETED', 'FAILED', 'CANCELED']);
const dispatching = new Map<string, Promise<void>>();

async function streamToBuffer(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function assetInputUrl(assetId: string | null, userId: string) {
  if (!assetId) return undefined;
  const asset = await prisma.generationAsset.findFirst({ where: { id: assetId, userId } });
  if (!asset) throw new AppError(404, 'ASSET_NOT_FOUND', 'Reference image was not found');
  if (asset.type !== 'IMAGE') {
    throw new AppError(415, 'IMAGE_REQUIRED', 'First and last frames must be images');
  }
  if (storageProvider.url) return storageProvider.url(asset.storageKey, 3600);
  const buffer = await streamToBuffer(await storageProvider.open(asset.storageKey));
  return `data:${asset.mimeType};base64,${buffer.toString('base64')}`;
}

function scheduleGeneration(id: string) {
  setImmediate(() => {
    void dispatchGeneration(id);
  });
}

/** Реестровый идентификатор модели → адрес модели у fal.ai для этого режима. */
function providerModelName(modelId: string, mode: GenerationMode) {
  return findGenerationModel(modelId)?.endpoints[mode] ?? modelId;
}

/**
 * Промпт уходит в модель на английском — так она работает заметно лучше.
 * Перевод делается на сервере, автоматически и незаметно для пользователя:
 * в библиотеке и ленте по-прежнему показывается исходный текст.
 * Если перевести не удалось, запрос уходит как есть — генерацию это не ломает.
 */
async function englishPromptFor(generation: Generation): Promise<string | undefined> {
  if (generation.enhancedPrompt) return generation.enhancedPrompt;
  if (generation.detectedLanguage === 'en') return undefined;
  try {
    const translated = await promptEnhancementProvider.enhance(
      generation.originalPrompt,
      'TRANSLATE',
      generation.detectedLanguage as 'ru' | 'kk' | 'en',
    );
    const trimmed = translated.trim();
    if (!trimmed || trimmed === generation.originalPrompt) return undefined;
    await prisma.generation.update({
      where: { id: generation.id },
      data: { enhancedPrompt: trimmed },
    });
    return trimmed;
  } catch {
    return undefined;
  }
}

export async function createGenerations(userId: string, input: GenerationInput) {
  const moderation = await moderationProvider.moderate(input.prompt);
  if (!moderation.allowed) {
    throw new AppError(422, 'PROMPT_REJECTED', moderation.reason ?? 'Prompt rejected');
  }

  const assetIds = [input.firstFrameAssetId, input.lastFrameAssetId].filter(
    (value): value is string => Boolean(value),
  );
  if (assetIds.length) {
    const assets = await prisma.generationAsset.findMany({
      where: { id: { in: assetIds }, userId, type: 'IMAGE' },
      select: { id: true },
    });
    if (new Set(assets.map(({ id }) => id)).size !== new Set(assetIds).size) {
      throw new AppError(404, 'ASSET_NOT_FOUND', 'One of the selected frames was not found');
    }
  }

  const singleCost = calculateSingleGenerationCost(input);
  const totalCost = singleCost * input.buildQuantity;
  const batchId = randomUUID();
  const model = providerModelName(input.modelId, input.mode);
  const generations = await prisma.$transaction(async (tx) => {
    const wallet = await tx.creditWallet.findUnique({ where: { userId } });
    if (!wallet || wallet.balance - wallet.reservedBalance < totalCost) {
      throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Not enough credits');
    }

    const created: Generation[] = [];
    for (let index = 1; index <= input.buildQuantity; index += 1) {
      const generation = await tx.generation.create({
        data: {
          batchId,
          batchIndex: index,
          batchSize: input.buildQuantity,
          userId,
          mode: input.mode,
          status: 'QUEUED',
          originalPrompt: input.prompt,
          enhancedPrompt: input.enhancedPrompt,
          detectedLanguage: detectLanguage(input.prompt),
          aspectRatio: input.aspectRatio,
          timingMode: input.timingMode,
          duration: input.duration,
          frames: input.timingMode === 'FRAMES' ? input.frames : null,
          resolution: input.resolution,
          generateAudio: input.generateAudio,
          firstFrameAssetId: input.firstFrameAssetId,
          lastFrameAssetId: input.lastFrameAssetId,
          style: input.style,
          cameraMotion: input.cameraMotion,
          creditCost: singleCost,
          reservedCredits: singleCost,
          provider: mediaGenerationProvider.name,
          modelId: input.modelId,
          model,
          forceFailure: input.forceFailure,
        },
      });
      await tx.creditTransaction.create({
        data: {
          userId,
          type: 'RESERVE',
          amount: -singleCost,
          balanceBefore: wallet.balance,
          balanceAfter: wallet.balance,
          generationId: generation.id,
          description: 'Credits reserved for video generation',
        },
      });
      created.push(generation);
    }
    await tx.creditWallet.update({
      where: { userId },
      data: { reservedBalance: { increment: totalCost } },
    });
    return created;
  });

  for (const generation of generations) scheduleGeneration(generation.id);
  return generations;
}

async function dispatchGeneration(id: string) {
  const active = dispatching.get(id);
  if (active) return active;
  const task = (async () => {
    try {
      const generation = await prisma.generation.findUnique({ where: { id } });
      if (!generation || terminalStatuses.has(generation.status) || generation.providerTaskId) return;
      const enhancedPrompt = await englishPromptFor(generation);
      const providerInput: MediaGenerationInput = {
        ...toGenerationInput(generation),
        enhancedPrompt,
        firstFrameUrl: await assetInputUrl(generation.firstFrameAssetId, generation.userId),
        lastFrameUrl: await assetInputUrl(generation.lastFrameAssetId, generation.userId),
      };
      const providerTask = await mediaGenerationProvider.create(providerInput);
      await prisma.generation.update({
        where: { id },
        data: {
          providerTaskId: providerTask.taskId,
          status: 'PROCESSING',
          startedAt: generation.startedAt ?? new Date(),
        },
      });
    } catch (error) {
      await failGeneration(id, 'PROVIDER_CREATE_FAILED', providerErrorMessage(error));
    }
  })();
  dispatching.set(id, task);
  try {
    await task;
  } finally {
    dispatching.delete(id);
  }
}

async function storeRemote(url: string, fileName: string, fallbackMime: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) {
    throw new Error(`Unable to persist generated media (${response.status})`);
  }
  const mimeType = response.headers.get('content-type')?.split(';')[0] || fallbackMime;
  return storageProvider.put(
    Readable.fromWeb(response.body as never),
    fileName,
    mimeType,
  );
}

/**
 * Складывает готовый файл к себе в хранилище.
 *
 * Ссылки fal.ai живут ограниченное время, поэтому и ролик, и картинка сразу
 * копируются в наше хранилище — иначе однажды библиотека перестала бы открываться.
 *
 * Обложки fal не отдаёт: для ролика её вырезаем из первого кадра, для картинки
 * обложка — сам файл, второй копии не нужно.
 */
async function persistCompletedMedia(id: string, result: CompletedMedia) {
  if (result.mediaType === 'IMAGE') {
    const image = await storeRemote(result.videoUrl, `${id}.jpg`, 'image/jpeg');
    return { video: image, thumbnail: image };
  }
  const video = await storeRemote(result.videoUrl, `${id}.mp4`, 'video/mp4');
  if (result.thumbnailUrl) {
    return { video, thumbnail: await storeRemote(result.thumbnailUrl, `${id}.jpg`, 'image/jpeg') };
  }
  const poster = await posterFor(video.key, video.size);
  // Без ffmpeg обложки не будет — ролик всё равно сохранён, плитка покажет первый кадр плеера.
  return { video, thumbnail: poster ?? video };
}

async function posterFor(key: string, size: number) {
  const putBuffer = storageProvider.putBuffer?.bind(storageProvider);
  if (!putBuffer) return null;
  const localPath = storageProvider.localPath?.(key);
  const source = localPath
    ? { path: localPath, size }
    : { data: await streamToBuffer(await storageProvider.open(key)), size };
  const frame = await extractPosterFrame(source);
  if (!frame) return null;
  return putBuffer(previewKey(key), frame, 'image/jpeg');
}

const SHORT_SIDE: Record<string, number> = {
  '480p': 480,
  '720p': 720,
  '1080p': 1080,
  '4k': 2160,
};

/**
 * Провайдер не всегда возвращает размеры кадра, а от них зависит, как ролик ляжет
 * в плитку ленты: без них вертикальное видео показывалось горизонтальным.
 * Настоящие размеры, если они пришли, всегда важнее расчётных. Если их нет, но
 * формат кадра был задан явно, размеры считаются из него — он точно известен.
 */
function resolveDimensions(
  aspectRatio: string,
  resolution: string,
  provided: { width: number; height: number },
) {
  if (provided.width > 0 && provided.height > 0) return provided;
  const match = /^(\d+):(\d+)$/u.exec(aspectRatio);
  const shortSide = SHORT_SIDE[resolution] ?? 720;
  if (!match) return { width: Math.round((shortSide * 16) / 9), height: shortSide };
  const ratioWidth = Number(match[1]);
  const ratioHeight = Number(match[2]);
  if (!ratioWidth || !ratioHeight) return { width: shortSide, height: shortSide };
  const isPortrait = ratioHeight > ratioWidth;
  const width = isPortrait ? shortSide : Math.round((shortSide * ratioWidth) / ratioHeight);
  const height = isPortrait ? Math.round((shortSide * ratioHeight) / ratioWidth) : shortSide;
  return { width, height };
}

async function completeGeneration(id: string, result: CompletedMedia) {
  const generation = await prisma.generation.findUnique({ where: { id } });
  if (!generation || terminalStatuses.has(generation.status)) return generation;
  const stored = liveProviders ? await persistCompletedMedia(id, result) : null;

  return prisma.$transaction(async (tx) => {
    const current = await tx.generation.findUnique({ where: { id } });
    if (!current || terminalStatuses.has(current.status)) return current;
    const wallet = await tx.creditWallet.findUniqueOrThrow({ where: { userId: current.userId } });
    await tx.creditWallet.update({
      where: { userId: current.userId },
      data: {
        balance: { decrement: current.creditCost },
        reservedBalance: { decrement: current.reservedCredits },
      },
    });
    await tx.creditTransaction.create({
      data: {
        userId: current.userId,
        type: 'CHARGE',
        amount: -current.creditCost,
        balanceBefore: wallet.balance,
        balanceAfter: wallet.balance - current.creditCost,
        generationId: current.id,
        description: 'Video generation completed',
      },
    });
    await tx.video.create({
      data: {
        generationId: current.id,
        userId: current.userId,
        mediaType: result.mediaType,
        videoUrl: result.videoUrl,
        // Обложки у ролика может не быть — тогда ссылкой служит сам файл.
        thumbnailUrl: result.thumbnailUrl || result.videoUrl,
        videoStorageKey: stored?.video.key,
        thumbnailStorageKey: stored?.thumbnail.key,
        // У картинки длительности нет, и выдумывать её нельзя: на ней держится цена и подписи.
        duration:
          result.mediaType === 'IMAGE'
            ? 0
            : current.timingMode === 'FRAMES' && current.frames
              ? current.frames / 24
              : current.duration,
        ...resolveDimensions(current.aspectRatio, current.resolution, {
          width: result.width,
          height: result.height,
        }),
        fileSize: stored?.video.size || result.fileSize,
      },
    });
    return tx.generation.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date(), reservedCredits: 0 },
      include: { video: true },
    });
  });
}

export async function failGeneration(
  id: string,
  code = 'MOCK_PROVIDER_ERROR',
  message = 'The video provider could not generate this video',
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.generation.findUnique({ where: { id } });
    if (!current || terminalStatuses.has(current.status)) return current;
    const wallet = await tx.creditWallet.findUniqueOrThrow({ where: { userId: current.userId } });
    await tx.creditWallet.update({
      where: { userId: current.userId },
      data: { reservedBalance: { decrement: current.reservedCredits } },
    });
    await tx.creditTransaction.create({
      data: {
        userId: current.userId,
        type: 'REFUND',
        amount: current.reservedCredits,
        balanceBefore: wallet.balance,
        balanceAfter: wallet.balance,
        generationId: current.id,
        description: 'Reservation released after generation failure',
      },
    });
    return tx.generation.update({
      where: { id },
      data: {
        status: 'FAILED',
        errorCode: code,
        errorMessage: message,
        completedAt: new Date(),
        reservedCredits: 0,
      },
      include: { video: true },
    });
  });
}

export async function cancelGeneration(id: string, userId: string) {
  const generation = await prisma.generation.findFirst({ where: { id, userId } });
  if (!generation) throw new AppError(404, 'GENERATION_NOT_FOUND', 'Generation was not found');
  if (terminalStatuses.has(generation.status)) return generation;
  if (generation.providerTaskId) await mediaGenerationProvider.cancel(generation.providerTaskId);
  const result = await failGeneration(id, 'CANCELED_BY_USER');
  if (!result) return result;
  return prisma.generation.update({
    where: { id },
    data: { status: 'CANCELED', errorCode: null, errorMessage: null },
    include: { video: true },
  });
}

export async function syncGeneration(id: string, depth = 0): Promise<
  Awaited<ReturnType<typeof prisma.generation.findUnique>>
> {
  const generation = await prisma.generation.findUnique({
    where: { id },
    include: { video: true },
  });
  if (!generation || terminalStatuses.has(generation.status)) return generation;

  if (Date.now() - generation.createdAt.getTime() > config.GENERATION_TIMEOUT_MINUTES * 60_000) {
    return failGeneration(
      id,
      'GENERATION_TIMEOUT',
      'The video provider did not finish this generation in time',
    );
  }

  if (!generation.providerTaskId) {
    if (depth > 1) return generation;
    await dispatchGeneration(id);
    return syncGeneration(id, depth + 1);
  }

  if (liveProviders) {
    try {
      const result = await mediaGenerationProvider.result(generation.providerTaskId);
      return result ? completeGeneration(id, result) : generation;
    } catch (error) {
      if (error instanceof ProviderRequestError && error.terminal) {
        return failGeneration(id, 'PROVIDER_TASK_FAILED', providerErrorMessage(error));
      }
      return generation;
    }
  }

  const elapsed = Date.now() - generation.createdAt.getTime();
  const total = config.MOCK_GENERATION_SECONDS * 1000;
  if (elapsed >= total) {
    if (generation.forceFailure) return failGeneration(id);
    const result = await mediaGenerationProvider.result(generation.providerTaskId);
    return result ? completeGeneration(id, result) : generation;
  }
  return generation;
}

/**
 * Готовит облегчённые копии для ленты.
 *
 * Копия делается только для **опубликованных** роликов: приватное видео в ленту
 * никогда не попадёт, и перекодировать его — впустую жечь процессор.
 * За один проход обрабатывается один ролик, ffmpeg ограничен по числу потоков.
 */
const buildingPreview = new Set<string>();

/**
 * Запускает подготовку облегчённых файлов для конкретного ролика, не дожидаясь
 * очередного прохода воркера. Вызывается сразу при публикации: иначе первые
 * секунды после публикации лента отдавала бы тяжёлый оригинал.
 */
export function requestFeedPreview(
  videoId: string,
  log?: { warn: (message: string) => void; info: (payload: unknown, message: string) => void },
) {
  if (!config.FEED_PREVIEW_ENABLED || buildingPreview.has(videoId)) return;
  buildingPreview.add(videoId);
  setImmediate(() => {
    void buildMissingFeedPreviews(log, videoId).finally(() => buildingPreview.delete(videoId));
  });
}

export async function buildMissingFeedPreviews(
  log: { warn: (message: string) => void; info: (payload: unknown, message: string) => void } = {
    warn: () => {},
    info: () => {},
  },
  videoId?: string,
) {
  // bind обязателен: у S3-хранилища метод использует this.client.
  const putBuffer = storageProvider.putBuffer?.bind(storageProvider);
  if (!config.FEED_PREVIEW_ENABLED || !putBuffer) return null;
  // Берём ролик, которому не хватает хотя бы одного из двух облегчённых файлов.
  const video = await prisma.video.findFirst({
    where: {
      ...(videoId ? { id: videoId } : {}),
      deletedAt: null,
      videoStorageKey: { not: null },
      visibility: 'PUBLIC',
      publication: { isNot: null },
      OR: [{ previewStorageKey: null }, { thumbnailPreviewStorageKey: null }],
    },
    // Свежеопубликованные важнее: их прямо сейчас смотрят в ленте.
    orderBy: { publication: { publishedAt: 'desc' } },
  });
  if (!video?.videoStorageKey) return null;
  const data: { previewStorageKey?: string; thumbnailPreviewStorageKey?: string } = {};

  if (!video.previewStorageKey && video.mediaType !== 'IMAGE') {
    const key = video.videoStorageKey;
    const size = await storageProvider.size(key).catch(() => 0);
    if (size) {
      const localPath = storageProvider.localPath?.(key);
      const source = localPath
        ? { path: localPath, size }
        : { data: await streamToBuffer(await storageProvider.open(key)), size };
      const preview = await createVideoPreview(
        source,
        { threads: config.FEED_PREVIEW_THREADS },
        log,
      );
      if (preview) {
        const name = feedPreviewKey(key);
        await putBuffer(name, preview.data, 'video/mp4');
        data.previewStorageKey = name;
        log.info(
          {
            videoId: video.id,
            fromMb: +(preview.originalSize / 1048576).toFixed(1),
            toMb: +(preview.data.length / 1048576).toFixed(1),
            seconds: +(preview.durationMs / 1000).toFixed(1),
          },
          'Готова облегчённая копия видео для ленты',
        );
      }
    }
  }

  /**
   * Уменьшенное превью тоже готовится заранее, а не по запросу: только так его
   * можно отдать прямой ссылкой из хранилища, не поднимая сервер на каждую плитку.
   */
  if (!video.thumbnailPreviewStorageKey && video.thumbnailStorageKey) {
    const smallKey = previewKey(video.thumbnailStorageKey);
    if (await storageProvider.exists?.(smallKey)) {
      data.thumbnailPreviewStorageKey = smallKey;
    } else {
      const original = await streamToBuffer(
        await storageProvider.open(video.thumbnailStorageKey),
      ).catch(() => null);
      const small = original ? await createPreview(original, undefined, log) : null;
      if (small) {
        await putBuffer(smallKey, small, 'image/jpeg');
        data.thumbnailPreviewStorageKey = smallKey;
        log.info(
          {
            videoId: video.id,
            fromKb: Math.round((original?.length ?? 0) / 1024),
            toKb: Math.round(small.length / 1024),
          },
          'Готово уменьшенное превью для ленты',
        );
      }
    }
  }

  /**
   * У картинки облегчённой видеокопии нет и быть не может. Поле всё равно нужно
   * заполнить: пока оно пустое, воркер выбирает эту же запись на каждом проходе
   * и крутится по кругу. В ленту вместо копии уходит уменьшённый файл.
   */
  if (video.mediaType === 'IMAGE' && !video.previewStorageKey) {
    data.previewStorageKey =
      data.thumbnailPreviewStorageKey ?? video.thumbnailPreviewStorageKey ?? video.videoStorageKey;
  }

  if (!Object.keys(data).length) return null;
  await prisma.video.update({ where: { id: video.id }, data });
  return video.id;
}

/**
 * Догоняет все незавершённые генерации всех пользователей.
 * Благодаря этому видео дорабатывается до конца, даже если приложение закрыто,
 * а зависшие задачи не держат кредиты в резерве вечно.
 */
export async function syncPendingGenerations(batchSize = 40) {
  const pending = await prisma.generation.findMany({
    where: { status: { in: ['QUEUED', 'PROCESSING'] } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });
  let synced = 0;
  for (const item of pending) {
    try {
      await syncGeneration(item.id);
      synced += 1;
    } catch {
      // Отдельная неудачная задача не должна останавливать весь проход.
    }
  }
  return { pending: pending.length, synced };
}

let workerTimer: ReturnType<typeof setInterval> | null = null;

export function startGenerationWorker(
  log: {
    error: (payload: unknown, message: string) => void;
    warn?: (message: string) => void;
    info?: (payload: unknown, message: string) => void;
  } = { error: () => {} },
) {
  if (workerTimer) return () => stopGenerationWorker();
  /**
   * Методы логгера оборачиваем, а не передаём напрямую: у pino они опираются на this,
   * и оторванная ссылка падает с `this[writeSym] is not a function`. Раньше из-за этого
   * перекодирование завершалось ошибкой уже после работы ffmpeg, но до записи в базу,
   * и один и тот же ролик пересчитывался по кругу.
   */
  const previewLog = {
    warn: (message: string) => {
      try {
        log.warn?.(message);
      } catch {
        // Логирование не должно ломать обработку.
      }
    },
    info: (payload: unknown, message: string) => {
      try {
        log.info?.(payload, message);
      } catch {
        // Логирование не должно ломать обработку.
      }
    },
  };
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void syncPendingGenerations()
      // Свободные проходы используем на облегчённые копии для ленты.
      .then(() => buildMissingFeedPreviews(previewLog))
      .catch((error: unknown) => log.error({ err: error }, 'Generation worker tick failed'))
      .finally(() => {
        running = false;
      });
  };
  workerTimer = setInterval(tick, config.GENERATION_POLL_SECONDS * 1000);
  workerTimer.unref?.();
  tick();
  return () => stopGenerationWorker();
}

export function stopGenerationWorker() {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
}

function providerErrorMessage(error: unknown) {
  if (error instanceof ProviderRequestError) return error.message;
  if (error instanceof Error && error.message) return error.message.slice(0, 500);
  return 'The video provider is temporarily unavailable';
}

export function toGenerationInput(source: Generation): GenerationInput {
  return {
    mode: source.mode as GenerationInput['mode'],
    modelId:
      (source.modelId as GenerationInput['modelId']) ??
      defaultModelForMode(source.mode as GenerationMode),
    prompt: source.originalPrompt,
    enhancedPrompt: source.enhancedPrompt ?? undefined,
    firstFrameAssetId: source.firstFrameAssetId ?? undefined,
    lastFrameAssetId: source.lastFrameAssetId ?? undefined,
    aspectRatio: source.aspectRatio as GenerationInput['aspectRatio'],
    timingMode: source.timingMode as GenerationInput['timingMode'],
    duration: source.duration,
    frames: source.frames ?? undefined,
    resolution: source.resolution as GenerationInput['resolution'],
    buildQuantity: 1,
    generateAudio: source.generateAudio,
    style: source.style as GenerationInput['style'],
    cameraMotion: source.cameraMotion as GenerationInput['cameraMotion'],
    forceFailure: source.forceFailure,
  };
}
