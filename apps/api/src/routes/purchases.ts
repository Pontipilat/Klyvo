import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { paymentProvider } from '../providers/index.js';

const purchaseSchema = z.object({
  productId: z.string().min(1),
  purchaseToken: z.string().min(8).optional(),
  platform: z.enum(['MOCK', 'ANDROID', 'IOS']).default('MOCK'),
  outcome: z.enum(['SUCCESS', 'CANCEL', 'ERROR']).default('SUCCESS'),
});

async function processPurchase(userId: string, input: z.infer<typeof purchaseSchema>) {
  if (input.outcome === 'CANCEL') return { status: 'CANCELED' as const };
  if (input.outcome === 'ERROR') throw new AppError(402, 'PAYMENT_FAILED', 'Mock payment failed');
  const token = input.purchaseToken ?? `mock_${randomUUID()}`;
  const existing = await prisma.purchase.findUnique({ where: { purchaseToken: token } });
  if (existing) {
    if (existing.userId !== userId)
      throw new AppError(409, 'PURCHASE_ALREADY_USED', 'Purchase token was already used');
    return { status: 'COMPLETED' as const, purchase: existing, alreadyProcessed: true };
  }
  const verification = await paymentProvider.verify(input.productId, token);
  if (!verification.valid)
    throw new AppError(402, 'PAYMENT_NOT_VERIFIED', 'Purchase could not be verified');
  const result = await prisma.$transaction(async (tx) => {
    const wallet = await tx.creditWallet.findUniqueOrThrow({ where: { userId } });
    const purchase = await tx.purchase.create({
      data: {
        userId,
        platform: input.platform,
        productId: verification.product.id,
        purchaseToken: token,
        status: 'VERIFIED',
        credits: verification.product.credits,
        priceAmount: verification.product.priceAmount,
        currency: verification.product.currency,
        verifiedAt: new Date(),
      },
    });
    await tx.creditWallet.update({
      where: { userId },
      data: { balance: { increment: purchase.credits } },
    });
    await tx.creditTransaction.create({
      data: {
        userId,
        type: 'PURCHASE',
        amount: purchase.credits,
        balanceBefore: wallet.balance,
        balanceAfter: wallet.balance + purchase.credits,
        purchaseId: purchase.id,
        description: `${verification.product.name} credit pack`,
      },
    });
    return purchase;
  });
  return { status: 'COMPLETED' as const, purchase: result, alreadyProcessed: false };
}

export const purchaseRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/products', async () => ({ products: await paymentProvider.products() }));

  fastify.post('/purchases/mock', { preHandler: authenticate }, async (request, reply) => {
    const result = await processPurchase(request.user.sub, purchaseSchema.parse(request.body));
    return reply.code(result.status === 'CANCELED' ? 200 : 201).send(result);
  });

  fastify.post('/purchases/verify', { preHandler: authenticate }, async (request, reply) => {
    const result = await processPurchase(request.user.sub, purchaseSchema.parse(request.body));
    return reply.code(201).send(result);
  });

  fastify.post('/purchases/restore', { preHandler: authenticate }, async (request) => {
    const purchases = await prisma.purchase.findMany({
      where: { userId: request.user.sub, status: 'VERIFIED' },
      orderBy: { createdAt: 'desc' },
    });
    return { restored: purchases.length, purchases };
  });
};
