import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { languages, promptEnhancementSchema } from '@klyvo/shared';
import { authenticate } from '../lib/auth.js';
import { previewKey } from '../lib/images.js';
import { isGuestEmail } from './auth.js';
import { detectLanguage } from '../lib/language.js';
import { prisma } from '../lib/prisma.js';
import { promptEnhancementProvider, storageProvider } from '../providers/index.js';

const mePatchSchema = z.object({
  displayName: z.string().trim().min(2).max(60).optional(),
  avatarUrl: z.url().nullable().optional(),
  language: z.enum(languages).optional(),
});

export const accountRoutes: FastifyPluginAsync = async (fastify) => {
  const userSelect = {
    id: true,
    email: true,
    displayName: true,
    avatarUrl: true,
    language: true,
    createdAt: true,
  } as const;

  fastify.get('/me', { preHandler: authenticate }, async (request) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.user.sub },
      select: userSelect,
    });
    // Признак гостя нужен и после перезапуска приложения, иначе профиль показывает служебный email.
    return { user: { ...user, isGuest: isGuestEmail(user.email) } };
  });

  fastify.patch('/me', { preHandler: authenticate }, async (request) => {
    const input = mePatchSchema.parse(request.body);
    const user = await prisma.user.update({
      where: { id: request.user.sub },
      data: input,
      select: userSelect,
    });
    return { user: { ...user, isGuest: isGuestEmail(user.email) } };
  });

  /**
   * Полное удаление аккаунта — требование App Store и Google Play.
   * Все связанные записи удаляются каскадом, файлы в хранилище чистятся отдельно.
   */
  fastify.delete('/me', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub;
    const [assets, videos] = await Promise.all([
      prisma.generationAsset.findMany({ where: { userId }, select: { storageKey: true } }),
      prisma.video.findMany({
        where: { userId },
        select: {
          videoStorageKey: true,
          thumbnailStorageKey: true,
          previewStorageKey: true,
          thumbnailPreviewStorageKey: true,
        },
      }),
    ]);
    await prisma.user.delete({ where: { id: userId } });
    const keys = [
      ...assets.map(({ storageKey }) => storageKey),
      ...videos.flatMap((video) => [
        video.videoStorageKey,
        video.thumbnailStorageKey,
        video.previewStorageKey,
        video.thumbnailPreviewStorageKey,
        // Уменьшенное превью могло быть создано на лету по предсказуемому имени.
        video.thumbnailStorageKey ? previewKey(video.thumbnailStorageKey) : null,
      ]),
    ].filter((key): key is string => Boolean(key));
    await Promise.all(
      keys.map((key) => storageProvider.remove(key).catch(() => undefined)),
    );
    return reply.code(204).send();
  });

  fastify.get('/wallet', { preHandler: authenticate }, async (request) => {
    const wallet = await prisma.creditWallet.findUniqueOrThrow({
      where: { userId: request.user.sub },
    });
    return {
      balance: wallet.balance,
      reservedBalance: wallet.reservedBalance,
      availableBalance: wallet.balance - wallet.reservedBalance,
    };
  });

  fastify.get('/wallet/transactions', { preHandler: authenticate }, async (request) => {
    const query = z
      .object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(request.query);
    const items = await prisma.creditTransaction.findMany({
      where: { userId: request.user.sub },
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const nextCursor = items.length > query.limit ? items[query.limit]?.id : undefined;
    return { items: items.slice(0, query.limit), nextCursor };
  });

  fastify.post('/prompts/enhance', { preHandler: authenticate }, async (request) => {
    const input = promptEnhancementSchema.parse(request.body);
    const language = detectLanguage(input.prompt);
    const enhancedPrompt = await promptEnhancementProvider.enhance(
      input.prompt,
      input.mode,
      language,
    );
    return { originalPrompt: input.prompt, enhancedPrompt, detectedLanguage: language };
  });
};
