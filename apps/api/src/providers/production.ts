import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Language } from '@klyvo/shared';
import { config } from '../config.js';
import type {
  ObjectRange,
  PaymentProvider,
  Product,
  PromptEnhancementProvider,
  StorageProvider,
} from './contracts.js';

export class ProviderRequestError extends Error {
  constructor(
    readonly provider: string,
    readonly statusCode: number,
    message: string,
    readonly terminal = false,
  ) {
    super(message);
    this.name = 'ProviderRequestError';
  }
}

function required(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} is required for the selected provider mode`);
  return value;
}

function providerMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;
  const value = payload as Record<string, unknown>;
  const error = value.error;
  if (typeof error === 'object' && error) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string') return message.slice(0, 500);
  }
  for (const key of ['message', 'failure_reason', 'fail_reason']) {
    if (typeof value[key] === 'string') return String(value[key]).slice(0, 500);
  }
  return fallback;
}

async function jsonRequest<T>(
  provider: string,
  url: string,
  apiKey: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text.slice(0, 500) };
    }
  }
  if (!response.ok) {
    throw new ProviderRequestError(
      provider,
      response.status,
      providerMessage(payload, `${provider} returned HTTP ${response.status}`),
      response.status >= 400 && response.status < 500 && response.status !== 429,
    );
  }
  return payload as T;
}

interface DeepSeekResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export class DeepSeekProvider implements PromptEnhancementProvider {
  private readonly apiKey = required(config.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY');
  private readonly baseUrl = config.DEEPSEEK_BASE_URL.replace(/\/$/u, '');

  async enhance(prompt: string, mode: string, language: Language) {
    /**
     * TRANSLATE — дословный перевод: модель генерации понимает английский лучше,
     * но пользователь не должен получить чужую фантазию вместо своей сцены.
     * Ничего не добавляем, ничего не убираем, порядок и детали сохраняем.
     */
    const isTranslation = mode === 'TRANSLATE';
    const system = isTranslation
      ? 'You are a literal translator. Translate the user text into English exactly as written: keep every subject, action, object, number, colour and detail, add nothing, remove nothing, do not embellish and do not turn it into a stylised prompt. If the text is already English, return it unchanged. Reply with the translation only — no quotes, no markdown, no commentary.'
      : 'You write production-ready prompts for an AI video generator. Return only one English prompt as plain text, without headings, quotes, markdown, or commentary.';
    const instructions: Record<string, string> = {
      TRANSLATE: 'Translate literally into English.',
      ENHANCE: 'Improve clarity, visual specificity, motion, lighting, and shot composition.',
      CINEMATIC: 'Turn it into a concise cinematic shot description with coherent natural motion.',
      PRESERVE: 'Improve wording while preserving every fact, subject, action, and constraint.',
    };
    const response = await jsonRequest<DeepSeekResponse>(
      'DeepSeek',
      `${this.baseUrl}/chat/completions`,
      this.apiKey,
      {
        method: 'POST',
        body: JSON.stringify({
          model: config.DEEPSEEK_MODEL,
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: `${instructions[mode] ?? instructions.ENHANCE} Source language: ${language}. Text: ${prompt}`,
            },
          ],
          // Перевод должен быть предсказуемым, а не творческим.
          temperature: isTranslation ? 0 : 0.35,
          max_tokens: 700,
          stream: false,
        }),
      },
    );
    const enhanced = response.choices?.[0]?.message?.content?.trim();
    if (!enhanced) throw new ProviderRequestError('DeepSeek', 502, 'DeepSeek returned no prompt');
    return enhanced.slice(0, 3000);
  }
}

export class S3StorageProvider implements StorageProvider {
  private readonly bucket = required(config.R2_BUCKET, 'R2_BUCKET');
  private readonly client = new S3Client({
    region: 'auto',
    endpoint: required(config.R2_ENDPOINT, 'R2_ENDPOINT'),
    credentials: {
      accessKeyId: required(config.R2_ACCESS_KEY_ID, 'R2_ACCESS_KEY_ID'),
      secretAccessKey: required(config.R2_SECRET_ACCESS_KEY, 'R2_SECRET_ACCESS_KEY'),
    },
  });

  async put(input: Readable, fileName: string, mimeType: string) {
    const extension = extname(basename(fileName)).slice(0, 12).toLowerCase();
    const now = new Date();
    const key = `uploads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}${extension}`;
    let size = 0;
    input.on('data', (chunk: Buffer | string) => {
      size += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    });
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: input, ContentType: mimeType }),
    );
    return { key, size };
  }

  async putBuffer(key: string, data: Buffer, mimeType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: mimeType }),
    );
    return { key, size: data.length };
  }

  /** Range пробрасывается в S3, поэтому по сети едет только запрошенный кусок. */
  async open(key: string, range?: ObjectRange) {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }),
    );
    if (!response.Body) throw new Error('R2 returned an empty object body');
    return response.Body as unknown as Readable;
  }

  async size(key: string) {
    const response = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return response.ContentLength ?? 0;
  }

  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /**
   * Прямая ссылка на объект в R2. Есть только когда настроен публичный домен бакета —
   * тогда телефон качает медиа прямо из хранилища, минуя сервер приложения.
   */
  publicUrl(key: string) {
    if (!config.R2_PUBLIC_BASE_URL) return null;
    return `${config.R2_PUBLIC_BASE_URL.replace(/\/$/u, '')}/${key
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
  }

  async url(key: string, expiresInSeconds = 3600) {
    const direct = this.publicUrl(key);
    if (direct) return direct;
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: Math.min(expiresInSeconds, 604_800),
    });
  }
}

function notConfigured(name: string): never {
  throw new Error(`${name} is disabled. Configure its server-side credentials before enabling it.`);
}

abstract class StorePaymentProvider implements PaymentProvider {
  async products(): Promise<Product[]> {
    return notConfigured(this.constructor.name);
  }
  async verify(): Promise<never> {
    return notConfigured(this.constructor.name);
  }
}

export class GooglePlayBillingProvider extends StorePaymentProvider {}
export class AppleStoreKitProvider extends StorePaymentProvider {}
