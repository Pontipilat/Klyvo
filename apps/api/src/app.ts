import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { PRICE_CONFIG, defaultVideoModelId, videoModels } from '@klyvo/shared';
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

  app.get('/health', async () => ({
    status: 'ok',
    providerMode: config.PROVIDER_MODE,
    videoModel: config.PROVIDER_MODE === 'seedance' ? config.SEEDANCE_MODEL : 'mock',
    storageMode: config.STORAGE_MODE,
    timestamp: new Date().toISOString(),
  }));
  app.get('/config', async () => ({
    pricing: PRICE_CONFIG,
    limits: { maxPromptLength: 2000, maxUploadMb: config.MAX_UPLOAD_MB },
    features: {
      videoToVideo: false,
      mockPayments: config.PAYMENT_MODE === 'mock',
      videoModel: config.PROVIDER_MODE === 'seedance' ? config.SEEDANCE_MODEL : 'mock',
    },
  }));

  /**
   * Список моделей генерации: что доступно, что подключено прямо сейчас и какая
   * выбрана по умолчанию. Приложение показывает это в выпадающем списке.
   */
  app.get('/models', async () => {
    const live = config.PROVIDER_MODE === 'seedance' && Boolean(config.SEEDANCE_API_KEY);
    return {
      defaultModelId: defaultVideoModelId,
      providerMode: config.PROVIDER_MODE,
      models: videoModels.map((model) => ({
        ...model,
        available: true,
        // В mock-режиме модель не настоящая — приложение честно это показывает.
        connected: live,
        providerModel:
          model.id === 'seedance-1-0-pro' ? config.SEEDANCE_FRAMES_MODEL : config.SEEDANCE_MODEL,
        translation: Boolean(config.DEEPSEEK_API_KEY),
      })),
    };
  });

  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(uploadRoutes);
  await app.register(mediaRoutes);
  await app.register(generationRoutes);
  await app.register(videoRoutes);
  await app.register(purchaseRoutes);

  app.setNotFoundHandler((request, reply) => {
    void reply
      .code(404)
      .send({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId: request.id } });
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.issues,
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
  return app;
}
