import { z } from 'zod';

export const generationModes = [
  'TEXT_TO_VIDEO',
  'IMAGE_TO_VIDEO',
  /** Ролик по нескольким картинкам-референсам: на них модель ориентируется по стилю и героям. */
  'REFERENCE_TO_VIDEO',
  'TEXT_TO_IMAGE',
  'IMAGE_TO_IMAGE',
] as const;
export const generationStatuses = [
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELED',
] as const;
/** Что именно создаёт модель: ролик или картинку. */
export const generationKinds = ['VIDEO', 'IMAGE'] as const;
export const aspectRatios = ['SMART', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export const resolutions = ['480p', '720p', '1080p', '4k'] as const;
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
export type GenerationKind = (typeof generationKinds)[number];
export type AspectRatio = (typeof aspectRatios)[number];
export type Resolution = (typeof resolutions)[number];
export type TimingMode = (typeof timingModes)[number];
export type VisualStyle = (typeof styles)[number];
export type CameraMotion = (typeof cameraMotions)[number];
export type Language = (typeof languages)[number];

/**
 * Реестр моделей генерации.
 *
 * Идентификатор стабилен и хранится в базе, а `endpoints` — это адреса моделей
 * у fal.ai: именно туда сервер отправляет запрос. Здесь же перечислены реальные
 * возможности каждой модели, поэтому приложение показывает только те настройки,
 * которые модель действительно принимает, и невалидный запрос не уходит на сервер.
 */
export interface GenerationModelInfo {
  id: string;
  kind: GenerationKind;
  label: string;
  provider: string;
  description: string;
  /** Адрес модели у fal.ai для каждого поддерживаемого режима. */
  endpoints: Partial<Record<GenerationMode, string>>;
  supportsAudio: boolean;
  supportsFrames: boolean;
  /** Модель умеет доводить ролик до заданного последнего кадра. */
  supportsLastFrame: boolean;
  /** Стиль имеет смысл: он уходит припиской к промпту. */
  supportsStyle: boolean;
  /** Движение камеры имеет смысл — у картинок его нет. */
  supportsCameraMotion: boolean;
  /** Сколько картинок-референсов принимает режим REFERENCE_TO_VIDEO. 0 — режима нет. */
  maxReferenceImages: number;
  aspectRatios: readonly AspectRatio[];
  resolutions: readonly Resolution[];
  durations: readonly number[];
  /** Надбавка к базовой цене за секунду именно этой модели. */
  priceMultiplier: number;
}

const KLING_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;
const KLING_DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
const SEEDANCE_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
const IMAGE_ASPECT_RATIOS = ['SMART', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;

/** Общая часть описания для трёх уровней качества Kling — они отличаются только им. */
function klingTier(
  family: 'v3' | 'o3',
  tier: 'standard' | 'pro' | '4k',
  resolution: Resolution,
  label: string,
  description: string,
  priceMultiplier: number,
) {
  const base = `fal-ai/kling-video/${family}/${tier}`;
  return {
    id: `kling-${family === 'v3' ? '3' : 'o3'}-${tier}`,
    kind: 'VIDEO',
    label,
    provider: 'fal.ai · Kuaishou',
    description,
    endpoints: {
      TEXT_TO_VIDEO: `${base}/text-to-video`,
      IMAGE_TO_VIDEO: `${base}/image-to-video`,
      // Режим по референсам есть у всех трёх уровней o3; у v3 его нет вовсе.
      ...(family === 'o3' ? { REFERENCE_TO_VIDEO: `${base}/reference-to-video` } : {}),
    },
    supportsAudio: true,
    supportsFrames: false,
    supportsLastFrame: true,
    supportsStyle: true,
    supportsCameraMotion: true,
    maxReferenceImages: family === 'o3' ? 4 : 0,
    aspectRatios: KLING_ASPECT_RATIOS,
    resolutions: [resolution],
    durations: KLING_DURATIONS,
    priceMultiplier,
  } as const satisfies GenerationModelInfo;
}

export const generationModels = [
  klingTier('v3', 'standard', '720p', 'Kling 3 Standard', 'Быстрый режим Kling 3: 720p, звук, до 15 секунд.', 1.2),
  klingTier('v3', 'pro', '1080p', 'Kling 3 Pro', 'Кинематографичный Kling 3: 1080p, звук, плавное движение.', 1.2),
  klingTier('v3', '4k', '4k', 'Kling 3 4K', 'Максимум Kling 3: настоящие 4K без апскейла.', 1.2),
  klingTier('o3', 'standard', '720p', 'Kling O3 Standard', 'Новое поколение Kling: 720p, референсы, до 15 секунд.', 1.3),
  klingTier('o3', 'pro', '1080p', 'Kling O3 Pro', 'Новое поколение Kling: 1080p, референсы, точная сцена.', 1.3),
  klingTier('o3', '4k', '4k', 'Kling O3 4K', 'Новое поколение Kling в 4K, тоже с референсами.', 1.3),
  {
    id: 'seedance-2-0',
    kind: 'VIDEO',
    label: 'Seedance 2.0',
    provider: 'fal.ai · ByteDance',
    description: 'Все форматы кадра, разрешение до 4K и звук.',
    endpoints: {
      TEXT_TO_VIDEO: 'bytedance/seedance-2.0/text-to-video',
      IMAGE_TO_VIDEO: 'bytedance/seedance-2.0/image-to-video',
    },
    supportsAudio: true,
    supportsFrames: false,
    supportsLastFrame: true,
    supportsStyle: true,
    supportsCameraMotion: true,
    maxReferenceImages: 0,
    aspectRatios: aspectRatios,
    resolutions: resolutions,
    durations: SEEDANCE_DURATIONS,
    priceMultiplier: 1,
  },
  {
    id: 'seedance-2-0-fast',
    kind: 'VIDEO',
    label: 'Seedance 2.0 Fast',
    provider: 'fal.ai · ByteDance',
    description: 'Тот же Seedance 2.0, но быстрее и заметно дешевле. До 720p.',
    endpoints: {
      TEXT_TO_VIDEO: 'bytedance/seedance-2.0/fast/text-to-video',
      IMAGE_TO_VIDEO: 'bytedance/seedance-2.0/fast/image-to-video',
    },
    supportsAudio: true,
    supportsFrames: false,
    supportsLastFrame: true,
    supportsStyle: true,
    supportsCameraMotion: true,
    maxReferenceImages: 0,
    aspectRatios: aspectRatios,
    resolutions: ['480p', '720p'],
    durations: SEEDANCE_DURATIONS,
    priceMultiplier: 0.6,
  },
  {
    id: 'gpt-image-2',
    kind: 'IMAGE',
    label: 'GPT Image 2',
    provider: 'fal.ai · OpenAI',
    description: 'Картинки по описанию и правка загруженного изображения.',
    endpoints: {
      TEXT_TO_IMAGE: 'openai/gpt-image-2',
      IMAGE_TO_IMAGE: 'openai/gpt-image-2/edit',
    },
    supportsAudio: false,
    supportsFrames: false,
    supportsLastFrame: false,
    supportsStyle: true,
    supportsCameraMotion: false,
    maxReferenceImages: 0,
    aspectRatios: IMAGE_ASPECT_RATIOS,
    // Разрешение здесь — это уровень качества у GPT Image 2: low / medium / high.
    resolutions: ['480p', '720p', '1080p'],
    durations: [],
    priceMultiplier: 1,
  },
  {
    id: 'seedream-5-pro',
    kind: 'IMAGE',
    label: 'Seedream 5.0 Pro',
    provider: 'fal.ai · ByteDance',
    description: 'Сильная работа с текстом на картинке. Умеет править загруженную.',
    endpoints: {
      TEXT_TO_IMAGE: 'bytedance/seedream/v5/pro/text-to-image',
      IMAGE_TO_IMAGE: 'bytedance/seedream/v5/pro/edit',
    },
    supportsAudio: false,
    supportsFrames: false,
    supportsLastFrame: false,
    supportsStyle: true,
    supportsCameraMotion: false,
    maxReferenceImages: 0,
    aspectRatios: IMAGE_ASPECT_RATIOS,
    // У Seedream качество — это размер: 2K или 4K.
    resolutions: ['1080p', '4k'],
    durations: [],
    priceMultiplier: 1.1,
  },
  {
    id: 'seedream-5-lite',
    kind: 'IMAGE',
    label: 'Seedream 5.0 Lite',
    provider: 'fal.ai · ByteDance',
    description: 'Быстрый и дешёвый Seedream 5.0. Умеет править загруженную.',
    endpoints: {
      TEXT_TO_IMAGE: 'fal-ai/bytedance/seedream/v5/lite/text-to-image',
      IMAGE_TO_IMAGE: 'fal-ai/bytedance/seedream/v5/lite/edit',
    },
    supportsAudio: false,
    supportsFrames: false,
    supportsLastFrame: false,
    supportsStyle: true,
    supportsCameraMotion: false,
    maxReferenceImages: 0,
    aspectRatios: IMAGE_ASPECT_RATIOS,
    resolutions: ['720p', '1080p', '4k'],
    durations: [],
    priceMultiplier: 0.6,
  },
] as const satisfies readonly GenerationModelInfo[];

export type GenerationModelId = (typeof generationModels)[number]['id'];
export const generationModelIds = generationModels.map(({ id }) => id) as [
  GenerationModelId,
  ...GenerationModelId[],
];
export const defaultVideoModelId: GenerationModelId = 'seedance-2-0';
export const defaultImageModelId: GenerationModelId = 'gpt-image-2';

export function findGenerationModel(id: string | null | undefined): GenerationModelInfo | undefined {
  return generationModels.find((model) => model.id === id);
}

/** Ролик или картинка — определяется выбранной моделью, а не режимом. */
export function kindForMode(mode: GenerationMode): GenerationKind {
  return mode === 'TEXT_TO_IMAGE' || mode === 'IMAGE_TO_IMAGE' ? 'IMAGE' : 'VIDEO';
}

/** Модели, которыми можно выполнить этот вид генерации. */
export function modelsForKind(kind: GenerationKind): readonly GenerationModelInfo[] {
  return generationModels.filter((model) => model.kind === kind);
}

export function modeIsImageInput(mode: GenerationMode): boolean {
  return mode === 'IMAGE_TO_VIDEO' || mode === 'IMAGE_TO_IMAGE';
}

/** Режим работает по набору картинок-референсов, а не по одному кадру. */
export function modeUsesReferences(mode: GenerationMode): boolean {
  return mode === 'REFERENCE_TO_VIDEO';
}

/** Модель по умолчанию для режима — используется, когда клиент её не прислал. */
export function defaultModelForMode(mode: GenerationMode): GenerationModelId {
  return kindForMode(mode) === 'IMAGE' ? defaultImageModelId : defaultVideoModelId;
}

export const generationInputSchema = z
  .object({
    mode: z.enum(generationModes),
    modelId: z.enum(generationModelIds).default(defaultVideoModelId),
    prompt: z.string().trim().min(3).max(2000),
    enhancedPrompt: z.string().trim().max(3000).optional(),
    firstFrameAssetId: z.string().min(1).optional(),
    lastFrameAssetId: z.string().min(1).optional(),
    /** Картинки-референсы: на них модель ориентируется, кадром они не становятся. */
    referenceAssetIds: z.array(z.string().min(1)).max(4).optional(),
    aspectRatio: z.enum(aspectRatios),
    timingMode: z.enum(timingModes).default('DURATION'),
    duration: z.coerce.number().int().min(3).max(15).default(5),
    frames: z.coerce.number().int().min(29).max(289).optional(),
    resolution: z.enum(resolutions),
    buildQuantity: z.coerce.number().int().min(1).max(8).default(1),
    generateAudio: z.boolean().default(true),
    style: z.enum(styles),
    cameraMotion: z.enum(cameraMotions),
    forceFailure: z.boolean().optional().default(false),
  })
  .superRefine((value, context) => {
    if (modeUsesReferences(value.mode) && !value.referenceAssetIds?.length) {
      context.addIssue({
        code: 'custom',
        path: ['referenceAssetIds'],
        message: 'At least one reference image is required for this mode',
      });
    }
    if (modeIsImageInput(value.mode) && !value.firstFrameAssetId) {
      context.addIssue({
        code: 'custom',
        path: ['firstFrameAssetId'],
        message: 'A source image is required for this mode',
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
    const model = findGenerationModel(value.modelId);
    if (!model) return;
    if (!model.endpoints[value.mode]) {
      context.addIssue({
        code: 'custom',
        path: ['mode'],
        message: `${model.label} does not support this mode`,
      });
    }
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
    if (!model.aspectRatios.includes(value.aspectRatio)) {
      context.addIssue({
        code: 'custom',
        path: ['aspectRatio'],
        message: `${model.label} does not support ${value.aspectRatio}`,
      });
    }
    if (!model.resolutions.includes(value.resolution)) {
      context.addIssue({
        code: 'custom',
        path: ['resolution'],
        message: `${model.label} does not support ${value.resolution}`,
      });
    }
    if (
      model.kind === 'VIDEO' &&
      value.timingMode === 'DURATION' &&
      !model.durations.includes(value.duration)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['duration'],
        message: `${model.label} does not support ${value.duration}s`,
      });
    }
    if (value.referenceAssetIds?.length && value.referenceAssetIds.length > model.maxReferenceImages) {
      context.addIssue({
        code: 'custom',
        path: ['referenceAssetIds'],
        message: `${model.label} accepts at most ${model.maxReferenceImages} reference images`,
      });
    }
    if (model.kind === 'IMAGE' && value.lastFrameAssetId) {
      context.addIssue({
        code: 'custom',
        path: ['lastFrameAssetId'],
        message: `${model.label} does not use a last frame`,
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
  version: 3,
  basePerSecond: 1.6,
  resolutionMultiplier: { '480p': 0.75, '720p': 1, '1080p': 2.2, '4k': 4 },
  audioMultiplier: 2,
  modeSurcharge: {
    TEXT_TO_VIDEO: 0,
    IMAGE_TO_VIDEO: 2,
    REFERENCE_TO_VIDEO: 3,
    TEXT_TO_IMAGE: 0,
    IMAGE_TO_IMAGE: 1,
  },
  /** У картинки нет секунд, поэтому её база — цена за один кадр. */
  imageBase: 4,
} as const;

/**
 * Параметры, от которых зависит цена. `modelId` необязателен: без него цена
 * считается по базовой ставке, и старые записи в базе остаются считаемыми.
 */
export type GenerationCostInput = Pick<
  GenerationInput,
  'timingMode' | 'duration' | 'frames' | 'resolution' | 'mode' | 'generateAudio'
> & { modelId?: string | null };

export type GenerationBatchCostInput = GenerationCostInput & Pick<GenerationInput, 'buildQuantity'>;

export function generationDurationSeconds(
  input: Pick<GenerationInput, 'timingMode' | 'duration' | 'frames'>,
): number {
  return input.timingMode === 'FRAMES' && input.frames ? input.frames / 24 : input.duration;
}

function priceMultiplierFor(modelId: string | null | undefined): number {
  return findGenerationModel(modelId)?.priceMultiplier ?? 1;
}

export function calculateSingleGenerationCost(input: GenerationCostInput): number {
  const multiplier =
    PRICE_CONFIG.resolutionMultiplier[input.resolution] * priceMultiplierFor(input.modelId);
  if (kindForMode(input.mode) === 'IMAGE') {
    return Math.max(
      1,
      Math.ceil(PRICE_CONFIG.imageBase * multiplier + PRICE_CONFIG.modeSurcharge[input.mode]),
    );
  }
  const seconds = generationDurationSeconds(input);
  const resolutionCost = seconds * PRICE_CONFIG.basePerSecond * multiplier;
  const audioCost = input.generateAudio ? resolutionCost * PRICE_CONFIG.audioMultiplier : resolutionCost;
  return Math.max(1, Math.ceil(audioCost + PRICE_CONFIG.modeSurcharge[input.mode]));
}

export function calculateGenerationCost(input: GenerationBatchCostInput): number {
  return calculateSingleGenerationCost(input) * input.buildQuantity;
}

export interface CostBreakdown {
  kind: GenerationKind;
  seconds: number;
  /** Стоимость одного результата без звука и без надбавки за режим. */
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
export function describeGenerationCost(input: GenerationBatchCostInput): CostBreakdown {
  const kind = kindForMode(input.mode);
  const seconds = kind === 'IMAGE' ? 0 : generationDurationSeconds(input);
  const resolutionMultiplier =
    PRICE_CONFIG.resolutionMultiplier[input.resolution] * priceMultiplierFor(input.modelId);
  const baseCost =
    kind === 'IMAGE'
      ? PRICE_CONFIG.imageBase * resolutionMultiplier
      : seconds * PRICE_CONFIG.basePerSecond * resolutionMultiplier;
  const audioCost =
    kind === 'VIDEO' && input.generateAudio ? baseCost * (PRICE_CONFIG.audioMultiplier - 1) : 0;
  const modeCost = PRICE_CONFIG.modeSurcharge[input.mode];
  const perVideo = calculateSingleGenerationCost(input);
  return {
    kind,
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
  /** VIDEO — ролик, IMAGE — картинка. У картинки `videoUrl` ведёт на сам файл. */
  mediaType: GenerationKind;
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
    mediaType: GenerationKind;
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
