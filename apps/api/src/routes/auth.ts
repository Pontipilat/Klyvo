import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { loginSchema, registerSchema } from '@klyvo/shared';
import { config } from '../config.js';
import { hashToken, issueTokens } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

const refreshSchema = z.object({ refreshToken: z.string().min(20) });

/**
 * Гостевой вход убран: в приложение попадают только зарегистрированные пользователи.
 * Функция оставлена, чтобы ранее созданные гостевые аккаунты корректно опознавались.
 */
const GUEST_DOMAIN = 'guest.klyvo.local';

export function isGuestEmail(email: string) {
  return email.endsWith(`@${GUEST_DOMAIN}`);
}

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/auth/register', async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const exists = await prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        displayName: input.displayName,
        language: input.language,
        wallet: { create: { balance: 100 } },
        creditTransactions: {
          create: {
            type: 'BONUS',
            amount: 100,
            balanceBefore: 0,
            balanceAfter: 100,
            description: 'Welcome credits',
          },
        },
      },
      include: { wallet: true },
    });
    const tokens = await issueTokens(fastify, user);
    return reply.code(201).send({ user: sanitizeUser(user), tokens });
  });

  fastify.post('/auth/login', async (request) => {
    const input = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: { wallet: true },
    });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
    }
    const tokens = await issueTokens(fastify, user);
    return { user: sanitizeUser(user), tokens };
  });

  fastify.post('/auth/refresh', async (request) => {
    const { refreshToken } = refreshSchema.parse(request.body);
    let payload: { sub: string; email: string; kind: string };
    try {
      payload = fastify.jwt.verify(refreshToken, { key: config.JWT_REFRESH_SECRET });
    } catch {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
    }
    if (payload.kind !== 'refresh')
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid token type');
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is no longer active');
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return { tokens: await issueTokens(fastify, user) };
  });

  fastify.post('/auth/logout', async (request, reply) => {
    const { refreshToken } = refreshSchema.parse(request.body);
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return reply.code(204).send();
  });

  fastify.post('/auth/forgot-password', async (request) => {
    const { email } = z.object({ email: z.email() }).parse(request.body);
    fastify.log.info({ email }, 'Mock password recovery requested');
    return { accepted: true };
  });
};

function sanitizeUser(user: {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  language: string;
  createdAt: Date;
  wallet?: { balance: number; reservedBalance: number } | null;
}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    language: user.language,
    createdAt: user.createdAt,
    isGuest: isGuestEmail(user.email),
    wallet: user.wallet,
  };
}
