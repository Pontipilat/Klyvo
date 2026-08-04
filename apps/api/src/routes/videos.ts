import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { visibilityValues } from '@klyvo/shared';
import { authenticate } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { withMediaUrls } from '../lib/media.js';
import { moderationProvider } from '../providers/index.js';
import { requestFeedPreview } from '../services/generations.js';

const publishSchema = z.object({
  visibility: z.enum(visibilityValues).default('PUBLIC'),
  showAuthor: z.boolean().default(true),
  showPrompt: z.boolean().default(false),
  allowRemix: z.boolean().default(true),
  allowDownload: z.boolean().default(false),
  allowTemplate: z.boolean().default(false),
});

export const videoRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/videos', { preHandler: authenticate }, async (request) => {
    const query = z
      .object({
        published: z.enum(['true', 'false']).optional(),
        search: z.string().trim().max(100).optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(request.query);
    const items = await prisma.video.findMany({
      where: {
        userId: request.user.sub,
        deletedAt: null,
        ...(query.published === 'true' ? { publication: { isNot: null } } : {}),
        ...(query.search ? { generation: { originalPrompt: { contains: query.search } } } : {}),
      },
      include: { generation: true, publication: true },
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const nextCursor = items.length > query.limit ? items[query.limit]?.id : undefined;
    return {
      items: items.slice(0, query.limit).map((video) => withMediaUrls(request, video)),
      nextCursor,
    };
  });

  fastify.get('/videos/:id', { preHandler: authenticate }, async (request) => {
    const { id } = request.params as { id: string };
    const video = await prisma.video.findFirst({
      where: {
        id,
        deletedAt: null,
        OR: [
          { userId: request.user.sub },
          { visibility: 'PUBLIC', publication: { moderationStatus: 'APPROVED' } },
          { visibility: 'UNLISTED', publication: { moderationStatus: 'APPROVED' } },
        ],
      },
      include: {
        generation: true,
        publication: true,
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });
    if (!video) throw new AppError(404, 'VIDEO_NOT_FOUND', 'Video was not found');
    // Клиенту нужно знать, свой это ролик или чужой: у чужого нет удаления,
    // публикации и повторной генерации, а заголовок должен быть другим.
    return {
      video: {
        ...withMediaUrls(request, video),
        mine: video.userId === request.user.sub,
        liked: Boolean(
          await prisma.videoLike.findUnique({
            where: { videoId_userId: { videoId: id, userId: request.user.sub } },
          }),
        ),
      },
    };
  });

  fastify.delete('/videos/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await prisma.video.updateMany({
      where: { id, userId: request.user.sub, deletedAt: null },
      data: { deletedAt: new Date(), visibility: 'PRIVATE' },
    });
    if (!result.count) throw new AppError(404, 'VIDEO_NOT_FOUND', 'Video was not found');
    await prisma.videoPublication.deleteMany({ where: { videoId: id, userId: request.user.sub } });
    return reply.code(204).send();
  });

  fastify.post('/videos/:id/publish', { preHandler: authenticate }, async (request) => {
    const { id } = request.params as { id: string };
    const input = publishSchema.parse(request.body);
    const video = await prisma.video.findFirst({
      where: { id, userId: request.user.sub, deletedAt: null },
    });
    if (!video) throw new AppError(404, 'VIDEO_NOT_FOUND', 'Video was not found');
    const { visibility, ...publicationSettings } = input;
    const publication = await prisma.$transaction(async (tx) => {
      await tx.video.update({ where: { id }, data: { visibility } });
      return tx.videoPublication.upsert({
        where: { videoId: id },
        create: {
          videoId: id,
          userId: request.user.sub,
          ...publicationSettings,
          moderationStatus: 'APPROVED',
        },
        update: { ...publicationSettings, moderationStatus: 'APPROVED', publishedAt: new Date() },
      });
    });
    // Готовим облегчённую копию сразу, а не ждём следующего прохода воркера —
    // иначе первые секунды лента отдавала бы тяжёлый оригинал.
    if (visibility === 'PUBLIC') {
      requestFeedPreview(id, {
        warn: (message) => request.log.warn(message),
        info: (payload, message) => request.log.info(payload, message),
      });
    }
    return { publication };
  });

  fastify.post('/videos/:id/unpublish', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const video = await prisma.video.findFirst({ where: { id, userId: request.user.sub } });
    if (!video) throw new AppError(404, 'VIDEO_NOT_FOUND', 'Video was not found');
    await prisma.$transaction([
      prisma.video.update({ where: { id }, data: { visibility: 'PRIVATE' } }),
      prisma.videoPublication.deleteMany({ where: { videoId: id } }),
    ]);
    return reply.code(204).send();
  });

  fastify.get('/feed', { preHandler: authenticate }, async (request) => {
    const query = z
      .object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(20).default(8),
      })
      .parse(request.query);
    const items = await prisma.videoPublication.findMany({
      where: {
        moderationStatus: 'APPROVED',
        video: {
          visibility: 'PUBLIC',
          deletedAt: null,
          // В ленту попадают только ролики, файл которых лежит у нас. Ссылки провайдера
          // живут ограниченное время, и без своей копии видео однажды перестаёт открываться.
          videoStorageKey: { not: null },
        },
      },
      include: {
        video: { include: { generation: true } },
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
      orderBy: { publishedAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const likes = await prisma.videoLike.findMany({
      where: { userId: request.user.sub, videoId: { in: items.map(({ videoId }) => videoId) } },
      select: { videoId: true },
    });
    const liked = new Set(likes.map(({ videoId }) => videoId));
    const nextCursor = items.length > query.limit ? items[query.limit]?.id : undefined;
    return {
      items: items
        .slice(0, query.limit)
        .map((item) => ({
          ...item,
          // В ленту уходит облегчённая копия, полное качество — на экране просмотра.
          video: withMediaUrls(request, item.video, 'feed'),
          liked: liked.has(item.videoId),
          mine: item.userId === request.user.sub,
        })),
      nextCursor,
    };
  });

  fastify.post('/feed/:videoId/view', { preHandler: authenticate }, async (request, reply) => {
    const { videoId } = request.params as { videoId: string };
    // Автор не накручивает просмотры собственного ролика.
    await prisma.videoPublication.updateMany({
      where: { videoId, NOT: { userId: request.user.sub } },
      data: { viewsCount: { increment: 1 } },
    });
    return reply.code(204).send();
  });

  fastify.post('/feed/:videoId/like', { preHandler: authenticate }, async (request) => {
    const { videoId } = request.params as { videoId: string };
    const publication = await prisma.videoPublication.findUnique({ where: { videoId } });
    if (!publication) throw new AppError(404, 'VIDEO_NOT_FOUND', 'Published video was not found');
    const existing = await prisma.videoLike.findUnique({
      where: { videoId_userId: { videoId, userId: request.user.sub } },
    });
    if (!existing) {
      const [, updated] = await prisma.$transaction([
        prisma.videoLike.create({ data: { videoId, userId: request.user.sub } }),
        prisma.videoPublication.update({
          where: { videoId },
          data: { likesCount: { increment: 1 } },
        }),
      ]);
      return { liked: true, likesCount: updated.likesCount };
    }
    return { liked: true, likesCount: publication.likesCount };
  });

  fastify.delete('/feed/:videoId/like', { preHandler: authenticate }, async (request) => {
    const { videoId } = request.params as { videoId: string };
    const removed = await prisma.videoLike.deleteMany({
      where: { videoId, userId: request.user.sub },
    });
    if (!removed.count) {
      const current = await prisma.videoPublication.findUnique({ where: { videoId } });
      return { liked: false, likesCount: current?.likesCount ?? 0 };
    }
    const updated = await prisma.videoPublication.update({
      where: { videoId },
      data: { likesCount: { decrement: 1 } },
    });
    return { liked: false, likesCount: Math.max(0, updated.likesCount) };
  });

  fastify.post('/feed/:videoId/report', { preHandler: authenticate }, async (request, reply) => {
    const { videoId } = request.params as { videoId: string };
    const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(request.body);
    const publication = await prisma.videoPublication.findUnique({ where: { videoId } });
    if (!publication) throw new AppError(404, 'VIDEO_NOT_FOUND', 'Published video was not found');
    await moderationProvider.report(videoId, reason);
    const report = await prisma.report.upsert({
      where: { videoId_userId: { videoId, userId: request.user.sub } },
      create: { videoId, userId: request.user.sub, reason },
      update: { reason, status: 'RECEIVED' },
    });
    return reply.code(201).send({ report });
  });
};
