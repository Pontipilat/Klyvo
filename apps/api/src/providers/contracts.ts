import type { GenerationInput, GenerationKind, Language } from '@klyvo/shared';
import type { Readable } from 'node:stream';

export interface MediaGenerationResult {
  taskId: string;
}

export interface CompletedMedia {
  /** VIDEO — ролик, IMAGE — картинка. Для картинки `videoUrl` ведёт на сам файл. */
  mediaType: GenerationKind;
  videoUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  fileSize: number;
}

export interface MediaGenerationInput extends GenerationInput {
  firstFrameUrl?: string;
  lastFrameUrl?: string;
}

export interface MediaGenerationProvider {
  readonly name: string;
  create(input: MediaGenerationInput): Promise<MediaGenerationResult>;
  /** `null` — задача ещё выполняется. */
  result(taskId: string): Promise<CompletedMedia | null>;
  cancel(taskId: string): Promise<void>;
}

export interface PromptEnhancementProvider {
  enhance(prompt: string, mode: string, language: Language): Promise<string>;
}

export interface StoredObject {
  key: string;
  size: number;
}

export interface ObjectRange {
  start: number;
  end: number;
}

export interface StorageProvider {
  put(input: Readable, fileName: string, mimeType: string): Promise<StoredObject>;
  /**
   * Отдаёт поток. С `range` читается только запрошенный кусок — благодаря этому
   * медиамаршрут не держит целый 35-мегабайтный ролик в памяти на каждый запрос.
   */
  open(key: string, range?: ObjectRange): Promise<Readable>;
  /** Размер объекта без его чтения — нужен для Content-Length и Content-Range. */
  size(key: string): Promise<number>;
  remove(key: string): Promise<void>;
  url?(key: string, expiresInSeconds?: number): Promise<string>;
  /** Записать уже готовый буфер (используется для кэша уменьшённых превью). */
  putBuffer?(key: string, data: Buffer, mimeType: string): Promise<StoredObject>;
  exists?(key: string): Promise<boolean>;
  /** Путь на диске, если хранилище локальное: позволяет обрабатывать файл без чтения в память. */
  localPath?(key: string): string;
  /**
   * Постоянная публичная ссылка на объект, если хранилище отдаёт файлы напрямую.
   * Когда она есть, приложение скачивает медиа мимо API — сервер не тратит
   * ни трафик, ни процессор на перекачку байтов.
   */
  publicUrl?(key: string): string | null;
}

export interface Product {
  id: string;
  name: string;
  credits: number;
  priceAmount: number;
  currency: string;
  featured?: boolean;
}

export interface PaymentProvider {
  products(): Promise<Product[]>;
  verify(productId: string, purchaseToken: string): Promise<{ valid: boolean; product: Product }>;
}

export interface ModerationProvider {
  moderate(prompt: string): Promise<{ allowed: boolean; reason?: string }>;
  report(videoId: string, reason: string): Promise<'RECEIVED'>;
}
