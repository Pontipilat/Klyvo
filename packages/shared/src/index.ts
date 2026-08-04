import { z } from 'zod';

export const generationModes = ['TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO'] as const;
export const generationStatuses = [
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELED',
] as const;
export const aspectRatios = ['SMART', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export const resolutions = ['480p', '720p', '1080p'] as const;
export const timingModes = ['DURATION', 'FRAMES'] as const;
export const styles = [
  'CINEMATIC',
  'REALISTIC',
  'ADVERTISING',
  'ANIME',
  'FANTASY',
  'MINIMAL',
  'NONE',
] as const;
export const cameraMotions = [
  'AUTO',
  'ZOOM_IN',
  'ZOOM_OUT',
  'PAN',
  'FOLLOW',
  'STATIC',
  'DRONE',
] as const;
export const languages = ['ru', 'kk', 'en'] as const;
export const visibilityValues = ['PRIVATE', 'UNLISTED', 'PUBLIC'] as const;

export type GenerationMode = (typeof generationModes)[number];
export type GenerationStatus = (typeof generationStatuses)[number];
export type AspectRatio = (typeof aspectRatios)[number];
export type Resolution = (typeof resolutions)[number];
export type TimingMode = (typeof timingModes)[number];
export type VisualStyle = (typeof styles)[number];
export type CameraMotion = (typeof cameraMotions)[number];
export type Language = (typeof languages)[number];

/**
 * Реестр моделей генерации. Идентификатор стабилен и хранится в базе,
 * конкретное имя модели у провайдера задаётся на сервере через переменные окружения.
 */
export interface VideoModelInfo {
  id: string;
  label: string;
  provider: string;
  description: string;
  supportsAudio: boolean;
  supportsFrames: boolean;
  maxDuration: number;
}

export const videoModels = [
  {
    id: 'seedance-1-5-pro',
    label: 'Seedance 1.5 Pro',
    provider: 'BytePlus ModelArk',
    description: 'Основная модель: длительность в секундах и генерация со звуком.',
    supportsAudio: true,
    supportsFrames: false,
    maxDuration: 12,
  },
  {
    id: 'seedance-1-0-pro',
    label: 'Seedance 1.0 Pro',
    provider: 'BytePlus ModelArk',
    description: 'Точное число кадров с шагом 4. Звук этой моделью не создаётся.',
    supportsAudio: false,
    supportsFrames: true,
    maxDuration: 12,
  },
] as const satisfies readonly VideoModelInfo[];

export type VideoModelId = (typeof videoModels)[number]['id'];
export const videoModelIds = videoModels.map(({ id }) => id) as [VideoModelId, ...VideoModelId[]];
export const defaultVideoModelId: VideoModelId = 'seedance-1-5-pro';

export function findVideoModel(id: string | null | undefined): VideoModelInfo | undefined {
  return videoModels.find((model) => model.id === id);
}

/** Модель, которой можно выполнить запрос с такими параметрами. */
export function modelForTiming(timingMode: TimingMode): VideoModelId {
  return timingMode === 'FRAMES' ? 'seedance-1-0-pro' : defaultVideoModelId;
}

export const generationInputSchema = z
  .object({
    mode: z.enum(generationModes),
    modelId: z.enum(videoModelIds).default(defaultVideoModelId),
    prompt: z.string().trim().min(3).max(2000),
    enhancedPrompt: z.string().trim().max(3000).optional(),
    firstFrameAssetId: z.string().min(1).optional(),
    lastFrameAssetId: z.string().min(1).optional(),
    aspectRatio: z.enum(aspectRatios),
    timingMode: z.enum(timingModes).default('DURATION'),
    duration: z.coerce.number().int().min(4).max(12).default(5),
    frames: z.coerce.number().int().min(29).max(289).optional(),
    resolution: z.enum(resolutions),
    buildQuantity: z.coerce.number().int().min(1).max(8).default(1),
    generateAudio: z.boolean().default(true),
    style: z.enum(styles),
    cameraMotion: z.enum(cameraMotions),
    forceFailure: z.boolean().optional().default(false),
  })
  .superRefine((value, context) => {
    if (value.mode === 'IMAGE_TO_VIDEO' && !value.firstFrameAssetId) {
      context.addIssue({
        code: 'custom',
        path: ['firstFrameAssetId'],
        message: 'First frame is required for image-to-video',
      });
    }
    if (value.lastFrameAssetId && !value.firstFrameAssetId) {
      context.addIssue({
        code: 'custom',
        path: ['lastFrameAssetId'],
        message: 'A last frame can only be used together with a first frame',
      });
    }
    if (value.timingMode === 'FRAMES') {
      if (value.frames === undefined || (value.frames - 25) % 4 !== 0) {
        context.addIssue({
          code: 'custom',
          path: ['frames'],
          message: 'Frames must be between 29 and 289 and follow 25 + 4n',
        });
      }
    }
    // Возможности проверяем по выбранной модели, а не по режиму длины.
    const model = findVideoModel(value.modelId);
    if (!model) return;
    if (value.timingMode === 'FRAMES' && !model.supportsFrames) {
      context.addIssue({
        code: 'custom',
        path: ['modelId'],
        message: `${model.label} does not support an exact frame count`,
      });
    }
    if (value.generateAudio && !model.supportsAudio) {
      context.addIssue({
        code: 'custom',
        path: ['generateAudio'],
        message: `${model.label} does not generate audio`,
      });
    }
  });

export type GenerationInput = z.infer<typeof generationInputSchema>;

export const promptEnhancementSchema = z.object({
  prompt: z.string().trim().min(3).max(2000),
  mode: z.enum(['TRANSLATE', 'ENHANCE', 'CINEMATIC', 'PRESERVE']),
});

export const registerSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(2).max(60),
  language: z.enum(languages).default('ru'),
});

export const loginSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
});


export const PRICE_CONFIG = {
  version: 2,
  basePerSecond: 1.6,
  resolutionMultiplier: { '480p': 0.75, '720p': 1, '1080p': 2.2 },
  audioMultiplier: 2,
  modeSurcharge: { TEXT_TO_VIDEO: 0, IMAGE_TO_VIDEO: 2 },
} as const;

export function generationDurationSeconds(
  input: Pick<GenerationInput, 'timingMode' | 'duration' | 'frames'>,
): number {
  return input.timingMode === 'FRAMES' && input.frames ? input.frames / 24 : input.duration;
}

export function calculateSingleGenerationCost(
  input: Pick<
    GenerationInput,
    'timingMode' | 'duration' | 'frames' | 'resolution' | 'mode' | 'generateAudio'
  >,
): number {
  const seconds = generationDurationSeconds(input);
  const resolutionCost =
    seconds * PRICE_CONFIG.basePerSecond * PRICE_CONFIG.resolutionMultiplier[input.resolution];
  const audioCost = input.generateAudio ? resolutionCost * PRICE_CONFIG.audioMultiplier : resolutionCost;
  return Math.max(1, Math.ceil(audioCost + PRICE_CONFIG.modeSurcharge[input.mode]));
}

export function calculateGenerationCost(
  input: Pick<
    GenerationInput,
    | 'timingMode'
    | 'duration'
    | 'frames'
    | 'resolution'
    | 'mode'
    | 'generateAudio'
    | 'buildQuantity'
  >,
): number {
  return calculateSingleGenerationCost(input) * input.buildQuantity;
}

export interface CostBreakdown {
  seconds: number;
  /** Стоимость одного ролика без звука и без надбавки за режим. */
  baseCost: number;
  /** Сколько кредитов добавляет включённый звук. */
  audioCost: number;
  /** Сколько кредитов добавляет генерация из кадров. */
  modeCost: number;
  perVideo: number;
  quantity: number;
  total: number;
  resolutionMultiplier: number;
}

/** Разбивка цены, которую можно показать пользователю до нажатия Generate. */
export function describeGenerationCost(
  input: Pick<
    GenerationInput,
    | 'timingMode'
    | 'duration'
    | 'frames'
    | 'resolution'
    | 'mode'
    | 'generateAudio'
    | 'buildQuantity'
  >,
): CostBreakdown {
  const seconds = generationDurationSeconds(input);
  const resolutionMultiplier = PRICE_CONFIG.resolutionMultiplier[input.resolution];
  const baseCost = seconds * PRICE_CONFIG.basePerSecond * resolutionMultiplier;
  const audioCost = input.generateAudio ? baseCost * (PRICE_CONFIG.audioMultiplier - 1) : 0;
  const modeCost = PRICE_CONFIG.modeSurcharge[input.mode];
  const perVideo = calculateSingleGenerationCost(input);
  return {
    seconds,
    baseCost: Math.round(baseCost),
    audioCost: Math.round(audioCost),
    modeCost,
    perVideo,
    quantity: input.buildQuantity,
    total: perVideo * input.buildQuantity,
    resolutionMultiplier,
  };
}

export interface ApiErrorPayload {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface WalletDto {
  balance: number;
  reservedBalance: number;
  availableBalance: number;
}

export type Visibility = (typeof visibilityValues)[number];

export interface VideoDto {
  id: string;
  generationId: string;
  videoUrl: string;
  thumbnailUrl: string;
  duration: number;
  width: number;
  height: number;
  visibility: Visibility;
  createdAt: string;
  publication?: PublicationSettingsDto | null;
}

export interface PublicationSettingsDto {
  showAuthor: boolean;
  showPrompt: boolean;
  allowRemix: boolean;
  allowDownload: boolean;
  allowTemplate: boolean;
}

export interface FeedItemDto extends PublicationSettingsDto {
  id: string;
  videoId: string;
  likesCount: number;
  viewsCount: number;
  liked: boolean;
  publishedAt: string;
  user: { id: string; displayName: string; avatarUrl?: string | null };
  video: {
    id: string;
    videoUrl: string;
    thumbnailUrl: string;
    duration: number;
    width: number;
    height: number;
    generation: {
      originalPrompt: string;
      style: VisualStyle;
      aspectRatio: AspectRatio;
      modelId?: string | null;
    };
  };
}

export interface GenerationDto {
  id: string;
  batchId: string;
  batchIndex: number;
  batchSize: number;
  mode: GenerationMode;
  modelId?: string | null;
  model?: string | null;
  status: GenerationStatus;
  originalPrompt: string;
  enhancedPrompt?: string | null;
  detectedLanguage: Language;
  aspectRatio: AspectRatio;
  timingMode: TimingMode;
  duration: number;
  frames?: number | null;
  resolution: Resolution;
  generateAudio: boolean;
  style: VisualStyle;
  cameraMotion: CameraMotion;
  creditCost: number;
  reservedCredits: number;
  createdAt: string;
  completedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  video?: VideoDto | null;
}

export const DEMO_ACCOUNT = {
  email: 'demo@klyvo.local',
  password: 'Demo123!',
} as const;
