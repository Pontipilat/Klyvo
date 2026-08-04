import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { prisma } from './prisma.js';
import { AppError } from './errors.js';

const ACCESS_TTL = '15m';
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;

export function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export async function issueTokens(fastify: FastifyInstance, user: { id: string; email: string }) {
  const accessToken = fastify.jwt.sign(
    { sub: user.id, email: user.email, kind: 'access' },
    { expiresIn: ACCESS_TTL },
  );
  const refreshToken = fastify.jwt.sign(
    { sub: user.id, email: user.email, kind: 'refresh', nonce: randomUUID() },
    { key: config.JWT_REFRESH_SECRET, expiresIn: REFRESH_TTL_SECONDS },
  );
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    },
  });
  return { accessToken, refreshToken };
}

export async function authenticate(request: FastifyRequest) {
  try {
    await request.jwtVerify();
    if (request.user.kind !== 'access') throw new Error('Wrong token type');
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required');
  }
}
