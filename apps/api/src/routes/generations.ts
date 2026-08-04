import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { generationInputSchema } from '@klyvo/shared';
import { authenticate } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { withMediaUrls } from '../lib/media.js';
import {
  cancelGeneration,
  createGenerations,
  syncGeneration,
  toGenerationInput,
} from '../services/generations.js';

export const generationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/generations', { preHandler: authenticate }, async (request, reply) => {
    const input = generationInputSchema.parse(request.body);
    const generations = await createGenerations(request.user.sub, input);
    return reply.code(202).send({
      generations,
      generation: generations[0],
      batchId: generations[0]?.batchId,
    });
  });

  fastify.get('/generations', { preHandler: authenticate }, async (request) => {
    const query = z
      .object({
        status: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(request.query);
    const found = await prisma.generation.findMany({
      where: { userId: request.user.sub, ...(query.status ? { status: query.status } : {}) },
      // publication нужен, чтобы автор видел лайки и просмотры своих опубликованных роликов.
      include: { video: { include: { publication: true } } },
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const nextCursor = found.length > query.limit ? found[query.limit]?.id : undefined;
    const items = await Promise.all(
      found.slice(0, query.limit).map(async (item) => {
        // Сбой на одной генерации не должен прятать от пользователя всю библиотеку.
        if (['QUEUED', 'PROCESSING'].includes(item.status)) {
          await syncGeneration(item.id).catch((error: unknown) => {
            request.log.error({ err: error, generationId: item.id }, 'Не удалось обновить генерацию');
          });
        }
        const current = await prisma.generation.findUnique({
          where: { id: item.id },
          include: { video: { include: { publication: true } } },
        });
        if (!current?.video) return current;
        return { ...current, video: withMediaUrls(request, current.video) };
      }),
    );
    return { items, nextCursor };
  });

  fastify.get('/generations/:id', { preHandler: authenticate }, async (request) => {
    const { id } = request.params as { id: string };
    const owned = await prisma.generation.findFirst({ where: { id, userId: request.user.sub } });
    if (!owned) throw new AppError(404, 'GENERATION_NOT_FOUND', 'Generation was not found');
    await syncGeneration(id);
    const generation = await prisma.generation.findUnique({
      where: { id },
      // publication нужен, чтобы автор видел лайки и просмотры своих опубликованных роликов.
      include: { video: { include: { publication: true } } },
    });
    return {
      generation:
        generation?.video
          ? { ...generation, video: withMediaUrls(request, generation.video) }
          : generation,
    };
  });

  fastify.post('/generations/:id/cancel', { preHandler: authenticate }, async (request) => {
    const { id } = request.params as { id: string };
    return { generation: await cancelGeneration(id, request.user.sub) };
  });

  fastify.post('/generations/:id/retry', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const source = await prisma.generation.findFirst({ where: { id, userId: request.user.sub } });
    if (!source) throw new AppError(404, 'GENERATION_NOT_FOUND', 'Generation was not found');
    const generations = await createGenerations(request.user.sub, toGenerationInput(source));
    return reply.code(202).send({ generation: generations[0], generations });
  });
};
