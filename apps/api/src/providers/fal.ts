import {
  findGenerationModel,
  type AspectRatio,
  type GenerationMode,
  type Resolution,
} from '@klyvo/shared';
import { config } from '../config.js';
import type {
  CompletedMedia,
  MediaGenerationInput,
  MediaGenerationProvider,
} from './contracts.js';
import { ProviderRequestError } from './production.js';

/**
 * Генерация через fal.ai.
 *
 * У fal все модели работают по одной очереди: запрос кладётся в очередь и сразу
 * возвращает адрес, по которому потом забирается результат. Этот адрес мы и храним
 * в `providerTaskId` — по нему можно и опросить статус, и отменить задачу, и забрать
 * готовый файл, не собирая URL заново и не завися от формата идентификаторов fal.
 */

interface FalQueueTicket {
  request_id?: string;
  response_url?: string;
  status_url?: string;
  cancel_url?: string;
  status?: string;
}

interface FalStatus {
  status?: string;
  queue_position?: number;
  error?: unknown;
  detail?: unknown;
}

interface FalFile {
  url?: string;
  content_type?: string;
  file_size?: number;
  width?: number;
  height?: number;
}

interface FalResult {
  video?: FalFile;
  images?: FalFile[];
  image?: FalFile;
  seed?: number;
}

function falMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;
  const value = payload as Record<string, unknown>;
  // У fal ошибка приходит в `detail`: строкой или списком проблем валидации.
  const detail = value.detail;
  if (typeof detail === 'string') return detail.slice(0, 500);
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) =>
        item && typeof item === 'object' ? (item as { msg?: unknown }).msg : undefined,
      )
      .filter((item): item is string => typeof item === 'string');
    if (messages.length) return messages.join('; ').slice(0, 500);
  }
  for (const key of ['message', 'error']) {
    const nested = value[key];
    if (typeof nested === 'string') return nested.slice(0, 500);
    if (nested && typeof nested === 'object') {
      const message = (nested as Record<string, unknown>).message;
      if (typeof message === 'string') return message.slice(0, 500);
    }
  }
  return fallback;
}

/** Формат кадра приложения → значение, которое понимает fal. */
function falAspectRatio(value: AspectRatio) {
  return value === 'SMART' ? 'auto' : value;
}

/** «Разрешение» у GPT Image 2 — это уровень качества. */
const IMAGE_QUALITY: Record<Resolution, string> = {
  '480p': 'low',
  '720p': 'medium',
  '1080p': 'high',
  '4k': 'high',
};

const IMAGE_SIZE: Record<AspectRatio, string> = {
  SMART: 'auto',
  '21:9': 'landscape_16_9',
  '16:9': 'landscape_16_9',
  '4:3': 'landscape_4_3',
  '1:1': 'square_hd',
  '3:4': 'portrait_4_3',
  '9:16': 'portrait_16_9',
};

/** У Seedream «качество» — это размер холста, а автоформат называется иначе, чем у OpenAI. */
const SEEDREAM_AUTO_SIZE: Partial<Record<Resolution, string>> = {
  '720p': 'auto_1K',
  '1080p': 'auto_2K',
  '4k': 'auto_4K',
};

/**
 * Промпт для модели: перевод (если он есть) плюс стиль и движение камеры.
 * Отдельных полей под них у fal нет — они уходят частью текста, и только тем
 * моделям, для которых имеют смысл.
 */
function promptFor(input: MediaGenerationInput) {
  const details = [input.enhancedPrompt || input.prompt];
  const model = findGenerationModel(input.modelId);
  if (input.style !== 'NONE' && model?.supportsStyle) {
    details.push(`Visual style: ${input.style.toLowerCase()}.`);
  }
  if (input.cameraMotion !== 'AUTO' && model?.supportsCameraMotion) {
    details.push(`Camera movement: ${input.cameraMotion.toLowerCase().replaceAll('_', ' ')}.`);
  }
  return details.join(' ');
}

/**
 * Kling v3 и Kling o3 принимают исходный кадр под разными именами: `start_image_url`
 * у v3 и `image_url` у o3. Ошибиться здесь легко, а поймать трудно — запрос уйдёт
 * и вернётся ошибкой валидации уже от fal.
 */
function klingFrameField(modelId: string) {
  return modelId.startsWith('kling-o3-') ? 'image_url' : 'start_image_url';
}

function klingPayload(input: MediaGenerationInput, prompt: string) {
  const base: Record<string, unknown> = {
    prompt,
    duration: String(input.duration),
    generate_audio: input.generateAudio,
  };
  if (input.mode === 'REFERENCE_TO_VIDEO') {
    /**
     * Референсы адресуются в промпте как @Image1, @Image2 — без этой подсказки
     * модель не понимает, к чему они относятся, и просто их игнорирует.
     */
    const references = input.referenceUrls ?? [];
    base.image_urls = references;
    base.aspect_ratio = input.aspectRatio === 'SMART' ? '16:9' : input.aspectRatio;
    base.prompt = `${prompt} Use ${references
      .map((_, index) => `@Image${index + 1}`)
      .join(', ')} as visual references.`;
    return base;
  }
  if (input.mode === 'IMAGE_TO_VIDEO') {
    base[klingFrameField(input.modelId)] = input.firstFrameUrl;
    if (input.lastFrameUrl) base.end_image_url = input.lastFrameUrl;
    // Формат кадра у image-to-video берётся из самого изображения.
    return base;
  }
  base.aspect_ratio = input.aspectRatio === 'SMART' ? '16:9' : input.aspectRatio;
  return base;
}

function seedreamPayload(input: MediaGenerationInput, prompt: string) {
  const base: Record<string, unknown> = {
    prompt,
    image_size:
      input.aspectRatio === 'SMART'
        ? (SEEDREAM_AUTO_SIZE[input.resolution] ?? 'auto_2K')
        : IMAGE_SIZE[input.aspectRatio],
    num_images: 1,
    output_format: 'jpeg',
  };
  if (input.mode === 'IMAGE_TO_IMAGE') base.image_urls = [input.firstFrameUrl];
  return base;
}

function seedancePayload(input: MediaGenerationInput, prompt: string) {
  const base: Record<string, unknown> = {
    prompt,
    duration: String(input.duration),
    resolution: input.resolution,
    aspect_ratio: falAspectRatio(input.aspectRatio),
    generate_audio: input.generateAudio,
  };
  if (input.mode === 'IMAGE_TO_VIDEO') {
    base.image_url = input.firstFrameUrl;
    if (input.lastFrameUrl) base.end_image_url = input.lastFrameUrl;
  }
  return base;
}

function imagePayload(input: MediaGenerationInput, prompt: string) {
  const base: Record<string, unknown> = {
    prompt,
    image_size: IMAGE_SIZE[input.aspectRatio],
    quality: IMAGE_QUALITY[input.resolution],
    num_images: 1,
    // Всегда JPEG: так медиамаршрут отдаёт один и тот же тип и для видео-превью,
    // и для самой картинки, а телефон не получает неожиданный формат.
    output_format: 'jpeg',
  };
  if (input.mode === 'IMAGE_TO_IMAGE') {
    base.image_urls = [input.firstFrameUrl];
  }
  return base;
}

function payloadFor(input: MediaGenerationInput) {
  const prompt = promptFor(input);
  if (input.modelId.startsWith('kling-')) return klingPayload(input, prompt);
  if (input.modelId.startsWith('seedance-')) return seedancePayload(input, prompt);
  if (input.modelId.startsWith('seedream-')) return seedreamPayload(input, prompt);
  return imagePayload(input, prompt);
}

export class FalProvider implements MediaGenerationProvider {
  readonly name = 'fal';
  private readonly apiKey: string;
  private readonly queueUrl = config.FAL_QUEUE_URL.replace(/\/$/u, '');

  constructor() {
    if (!config.FAL_KEY) throw new Error('FAL_KEY is required when PROVIDER_MODE=fal');
    this.apiKey = config.FAL_KEY;
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Key ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    let payload: unknown = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { detail: text.slice(0, 500) };
      }
    }
    if (!response.ok) {
      throw new ProviderRequestError(
        'fal.ai',
        response.status,
        falMessage(payload, `fal.ai returned HTTP ${response.status}`),
        // 4xx (кроме «слишком часто») повторять бессмысленно — запрос не пройдёт и со второго раза.
        response.status >= 400 && response.status < 500 && response.status !== 429,
      );
    }
    return payload as T;
  }

  private endpointFor(modelId: string, mode: GenerationMode) {
    const model = findGenerationModel(modelId);
    const endpoint = model?.endpoints[mode];
    if (!endpoint) {
      throw new ProviderRequestError(
        'fal.ai',
        400,
        `Model ${modelId} cannot run ${mode}`,
        true,
      );
    }
    return endpoint;
  }

  async create(input: MediaGenerationInput) {
    const endpoint = this.endpointFor(input.modelId, input.mode);
    const ticket = await this.request<FalQueueTicket>(`${this.queueUrl}/${endpoint}`, {
      method: 'POST',
      body: JSON.stringify(payloadFor(input)),
    });
    /**
     * `response_url` fal возвращает сам, и он уже содержит и приложение, и идентификатор
     * запроса. Собирать его вручную не нужно: у моделей с вложенными путями
     * (например `kling-video/v3/pro/text-to-video`) правило склейки неочевидно.
     */
    const taskId = ticket.response_url ?? this.fallbackTaskUrl(endpoint, ticket.request_id);
    if (!taskId) throw new ProviderRequestError('fal.ai', 502, 'fal.ai returned no request id');
    return { taskId };
  }

  private fallbackTaskUrl(endpoint: string, requestId?: string) {
    if (!requestId) return null;
    return `${this.queueUrl}/${endpoint}/requests/${requestId}`;
  }

  async result(taskId: string): Promise<CompletedMedia | null> {
    const status = await this.request<FalStatus>(`${taskId}/status`);
    const state = status.status?.toUpperCase();
    if (state === 'IN_QUEUE' || state === 'IN_PROGRESS') return null;
    if (state && state !== 'COMPLETED' && state !== 'OK') {
      throw new ProviderRequestError('fal.ai', 502, falMessage(status, `Task ${state}`), true);
    }
    const payload = await this.request<FalResult>(taskId);
    return toCompletedMedia(payload);
  }

  async cancel(taskId: string) {
    const response = await fetch(`${taskId}/cancel`, {
      method: 'PUT',
      headers: { Authorization: `Key ${this.apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    // 400 — задача уже выполняется и отменить её нельзя, 404 — её уже нет.
    if (!response.ok && ![400, 404, 409].includes(response.status)) {
      const payload: unknown = await response.json().catch((): unknown => ({}));
      throw new ProviderRequestError(
        'fal.ai',
        response.status,
        falMessage(payload, `Unable to cancel task (${response.status})`),
      );
    }
  }
}

/**
 * Ответ fal → результат генерации.
 *
 * Кадра-обложки fal не отдаёт ни для Kling, ни для Seedance, поэтому для видео
 * `thumbnailUrl` остаётся пустым: обложку сервер вырежет из готового ролика сам.
 * Для картинки обложка — она же.
 */
export function toCompletedMedia(payload: FalResult): CompletedMedia {
  const image = payload.images?.[0] ?? payload.image;
  if (image?.url) {
    return {
      mediaType: 'IMAGE',
      videoUrl: image.url,
      thumbnailUrl: image.url,
      width: image.width ?? 0,
      height: image.height ?? 0,
      fileSize: image.file_size ?? 0,
    };
  }
  const video = payload.video;
  if (!video?.url) {
    throw new ProviderRequestError('fal.ai', 502, 'Completed task returned no media URL', true);
  }
  return {
    mediaType: 'VIDEO',
    videoUrl: video.url,
    thumbnailUrl: '',
    width: video.width ?? 0,
    height: video.height ?? 0,
    fileSize: video.file_size ?? 0,
  };
}
