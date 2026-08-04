import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  PRICE_CONFIG,
  defaultImageModelId,
  defaultVideoModelId,
  generationModels,
} from '@klyvo/shared';
import { ZodError } from 'zod';
import { config } from './config.js';
import { AppError } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { accountRoutes } from './routes/account.js';
import { uploadRoutes } from './routes/uploads.js';
import { generationRoutes } from './routes/generations.js';
import { videoRoutes } from './routes/videos.js';
import { purchaseRoutes } from './routes/purchases.js';
import { mediaRoutes } from './routes/media.js';

/**
 * Разбор ошибки валидации.
 *
 * Схема запроса живёт в общем пакете, и у него своя копия zod — `instanceof`
 * на такой ошибке не срабатывает, хотя ошибка ровно та же. Из-за этого любая
 * непройденная проверка возвращалась как 500 вместо понятного 400 с полем,
 * в котором проблема. Поэтому ошибку опознаём и по имени тоже.
 */
function zodIssues(error: unknown): unknown[] | null {
  if (error instanceof ZodError) return error.issues;
  if (error && typeof error === 'object' && (error as { name?: unknown }).name === 'ZodError') {
    const issues: unknown = (error as { issues?: unknown }).issues;
    if (Array.isArray(issues)) return issues as unknown[];
  }
  return null;
}

export async function buildApp() {
  const app = Fastify({
    logger: config.NODE_ENV !== 'test',
    bodyLimit: config.MAX_UPLOAD_MB * 1024 * 1024,
  });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(rateLimit, {
    max: config.NODE_ENV === 'test' ? 10000 : 180,
    timeWindow: '1 minute',
  });
  await app.register(jwt, { secret: config.JWT_SECRET });
  await app.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 5 },
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Klyvo API',
        description: 'API for Klyvo AI video generation',
        version: '0.1.0',
      },
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  // Настоящие генерации идут через fal.ai; без ключа сервер работает на заглушках.
  const live = config.PROVIDER_MODE === 'fal' && Boolean(config.FAL_KEY);

  app.get('/health', async () => ({
    status: 'ok',
    providerMode: config.PROVIDER_MODE,
    generationProvider: live ? 'fal.ai' : 'mock',
    storageMode: config.STORAGE_MODE,
    timestamp: new Date().toISOString(),
  }));
  app.get('/config', async () => ({
    pricing: PRICE_CONFIG,
    limits: { maxPromptLength: 2000, maxUploadMb: config.MAX_UPLOAD_MB },
    features: {
      videoToVideo: false,
      imageGeneration: true,
      mockPayments: config.PAYMENT_MODE === 'mock',
      generationProvider: live ? 'fal.ai' : 'mock',
    },
  }));

  /**
   * Список моделей генерации: что умеет каждая, что подключено прямо сейчас и что
   * выбрано по умолчанию. Приложение строит по нему и выпадающий список, и набор
   * доступных настроек — вместе с моделью меняются форматы, качества и длительности.
   */
  app.get('/models', async () => ({
    defaultModelId: defaultVideoModelId,
    defaultImageModelId,
    providerMode: config.PROVIDER_MODE,
    models: generationModels.map((model) => ({
      ...model,
      modes: Object.keys(model.endpoints),
      available: true,
      // В mock-режиме модель не настоящая — приложение честно это показывает.
      connected: live,
      translation: Boolean(config.DEEPSEEK_API_KEY),
    })),
  }));

  /**
   * Обработчики ошибок ставятся до маршрутов: fastify копирует их в контекст
   * плагина в момент регистрации, и обработчик, назначенный после `register`,
   * до этих маршрутов уже не доходит. Из-за этого ошибки валидации и «запись не
   * найдена» возвращались как 500 вместо 400 и 404.
   */
  app.setNotFoundHandler((request, reply) => {
    void reply
      .code(404)
      .send({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId: request.id } });
  });
  app.setErrorHandler((error, request, reply) => {
    const issues = zodIssues(error);
    if (issues) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: issues,
          requestId: request.id,
        },
      });
    }
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: request.id,
        },
      });
    }
    // Отсутствующая запись — это 404, а не «на сервере всё сломалось».
    if (typeof error === 'object' && error && (error as { code?: string }).code === 'P2025') {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Resource was not found', requestId: request.id },
      });
    }
    request.log.error({ err: error }, 'Unhandled request error');
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId: request.id },
    });
  });
  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(uploadRoutes);
  await app.register(mediaRoutes);
  await app.register(generationRoutes);
  await app.register(videoRoutes);
  await app.register(purchaseRoutes);

  return app;
}
