import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().default('file:./dev.db'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  JWT_SECRET: z.string().min(16).default('local-klyvo-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().min(16).default('local-klyvo-refresh-secret-change-me'),
  /** `fal` — настоящие генерации через fal.ai, `mock` — заглушки для разработки. */
  PROVIDER_MODE: z.enum(['mock', 'fal']).default('mock'),
  STORAGE_MODE: z.enum(['local', 's3']).default('local'),
  /**
   * Куда локальное хранилище кладёт файлы. Относительный путь считается от рабочего
   * каталога API. На хостинге сюда указывают примонтированный диск — иначе загруженные
   * и сгенерированные файлы исчезают вместе с контейнером при каждом деплое.
   */
  UPLOADS_DIR: z.string().min(1).default('uploads'),
  PAYMENT_MODE: z.enum(['mock', 'store']).default('mock'),
  MOCK_GENERATION_SECONDS: z.coerce.number().min(0).max(120).default(10),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(250).default(50),
  /** Как часто сервер сам проверяет незавершённые генерации, не дожидаясь запроса из приложения. */
  GENERATION_POLL_SECONDS: z.coerce.number().min(1).max(120).default(5),
  /** Через сколько минут зависшая генерация помечается ошибкой, а кредиты возвращаются. */
  GENERATION_TIMEOUT_MINUTES: z.coerce.number().min(1).max(240).default(20),
  /** Готовить облегчённые копии для ленты. Выключите, если процессор сервера дороже трафика. */
  FEED_PREVIEW_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value !== 'false'),
  /** Сколько потоков отдавать ffmpeg. Один поток не мешает API отвечать. */
  FEED_PREVIEW_THREADS: z.coerce.number().int().min(1).max(16).default(1),
  /** Ключ fal.ai (Dashboard → Keys). Формат `key_id:key_secret`. */
  FAL_KEY: z.string().min(1).optional(),
  FAL_QUEUE_URL: z.url().default('https://queue.fal.run'),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  DEEPSEEK_BASE_URL: z.url().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.string().min(1).default('deepseek-v4-flash'),
  R2_ENDPOINT: z.url().optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
  R2_PUBLIC_BASE_URL: z.url().optional(),
});

export const config = envSchema.parse(process.env);
