import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

let app: FastifyInstance;

async function register(email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'Secure123!', displayName: 'Test Creator', language: 'en' },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { user: { id: string }; tokens: { accessToken: string } };
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

beforeEach(async () => {
  await prisma.report.deleteMany();
  await prisma.videoLike.deleteMany();
  await prisma.videoPublication.deleteMany();
  await prisma.video.deleteMany();
  await prisma.creditTransaction.deleteMany();
  await prisma.generationAsset.deleteMany();
  await prisma.generation.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.creditWallet.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Klyvo API', () => {
  it('registers a user with starter credits', async () => {
    const result = await register('new@klyvo.test');
    const wallet = await app.inject({
      method: 'GET',
      url: '/wallet',
      headers: { authorization: `Bearer ${result.tokens.accessToken}` },
    });
    expect(wallet.statusCode).toBe(200);
    expect(wallet.json()).toMatchObject({ balance: 100, availableBalance: 100 });
  });

  it('runs the core prompt → generation → video → publish flow', async () => {
    const { tokens } = await register('flow@klyvo.test');
    const headers = { authorization: `Bearer ${tokens.accessToken}` };
    const enhanced = await app.inject({
      method: 'POST',
      url: '/prompts/enhance',
      headers,
      payload: { prompt: 'Туманный лес на рассвете', mode: 'CINEMATIC' },
    });
    expect(enhanced.statusCode).toBe(200);
    const enhancedPrompt = (enhanced.json() as { enhancedPrompt: string }).enhancedPrompt;

    const created = await app.inject({
      method: 'POST',
      url: '/generations',
      headers,
      payload: {
        mode: 'TEXT_TO_VIDEO',
        prompt: 'Туманный лес на рассвете',
        enhancedPrompt,
        aspectRatio: '16:9',
        timingMode: 'DURATION',
        duration: 5,
        resolution: '720p',
        buildQuantity: 1,
        generateAudio: false,
        style: 'CINEMATIC',
        cameraMotion: 'PAN',
      },
    });
    expect(created.statusCode).toBe(202);
    const generationId = (created.json() as { generation: { id: string } }).generation.id;
    const completed = await app.inject({
      method: 'GET',
      url: `/generations/${generationId}`,
      headers,
    });
    expect(completed.statusCode).toBe(200);
    const videoId = (completed.json() as { generation: { status: string; video: { id: string } } })
      .generation.video.id;
    expect((completed.json() as { generation: { status: string } }).generation.status).toBe(
      'COMPLETED',
    );

    const published = await app.inject({
      method: 'POST',
      url: `/videos/${videoId}/publish`,
      headers,
      payload: {
        visibility: 'PUBLIC',
        showAuthor: true,
        showPrompt: true,
        allowRemix: true,
        allowDownload: false,
      },
    });
    expect(published.statusCode).toBe(200);
    const feed = await app.inject({ method: 'GET', url: '/feed', headers });
    expect((feed.json() as { items: unknown[] }).items).toHaveLength(1);
  });

  it('does not expose another user private video', async () => {
    const owner = await register('owner@klyvo.test');
    const stranger = await register('stranger@klyvo.test');
    const generation = await prisma.generation.create({
      data: {
        batchId: 'private-batch',
        userId: owner.user.id,
        mode: 'TEXT_TO_VIDEO',
        status: 'COMPLETED',
        originalPrompt: 'Private',
        detectedLanguage: 'en',
        aspectRatio: '16:9',
        duration: 5,
        resolution: '720p',
        generateAudio: false,
        style: 'NONE',
        cameraMotion: 'STATIC',
        creditCost: 8,
        reservedCredits: 0,
        provider: 'mock',
        model: 'mock',
      },
    });
    const video = await prisma.video.create({
      data: {
        generationId: generation.id,
        userId: owner.user.id,
        videoUrl: 'private.mp4',
        thumbnailUrl: 'private.jpg',
        duration: 5,
        width: 1280,
        height: 720,
        fileSize: 100,
        visibility: 'PRIVATE',
      },
    });
    const response = await app.inject({
      method: 'GET',
      url: `/videos/${video.id}`,
      headers: { authorization: `Bearer ${stranger.tokens.accessToken}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it('gives every guest device its own isolated account', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/auth/guest',
      payload: { deviceId: 'device-alpha-0001', language: 'ru' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/auth/guest',
      payload: { deviceId: 'device-beta-0002', language: 'ru' },
    });
    const sameDeviceAgain = await app.inject({
      method: 'POST',
      url: '/auth/guest',
      payload: { deviceId: 'device-alpha-0001', language: 'ru' },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(sameDeviceAgain.statusCode).toBe(200);

    const firstUser = (first.json() as { user: { id: string; isGuest: boolean } }).user;
    const secondUser = (second.json() as { user: { id: string } }).user;
    const repeatUser = (sameDeviceAgain.json() as { user: { id: string } }).user;
    expect(firstUser.isGuest).toBe(true);
    expect(firstUser.id).not.toBe(secondUser.id);
    expect(repeatUser.id).toBe(firstUser.id);
  });

  it('never returns generations that belong to another account', async () => {
    const owner = await register('a@klyvo.test');
    const other = await register('b@klyvo.test');
    await prisma.generation.create({
      data: {
        batchId: 'owner-batch',
        userId: owner.user.id,
        mode: 'TEXT_TO_VIDEO',
        status: 'COMPLETED',
        originalPrompt: 'Owner only',
        detectedLanguage: 'en',
        aspectRatio: '16:9',
        duration: 5,
        resolution: '720p',
        generateAudio: false,
        style: 'NONE',
        cameraMotion: 'STATIC',
        creditCost: 8,
        reservedCredits: 0,
        provider: 'mock',
        model: 'mock',
      },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/generations',
      headers: { authorization: `Bearer ${other.tokens.accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { items: unknown[] }).items).toHaveLength(0);
  });

  it('deletes the account with everything attached to it', async () => {
    const { user, tokens } = await register('bye@klyvo.test');
    const headers = { authorization: `Bearer ${tokens.accessToken}` };
    const response = await app.inject({ method: 'DELETE', url: '/me', headers });
    expect(response.statusCode).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.creditWallet.findUnique({ where: { userId: user.id } })).toBeNull();
    const afterDelete = await app.inject({ method: 'GET', url: '/wallet', headers });
    expect(afterDelete.statusCode).toBe(404);
  });

  it('removes a published video from the feed on unpublish', async () => {
    const { user, tokens } = await register('unpub@klyvo.test');
    const headers = { authorization: `Bearer ${tokens.accessToken}` };
    const generation = await prisma.generation.create({
      data: {
        batchId: 'unpub-batch',
        userId: user.id,
        mode: 'TEXT_TO_VIDEO',
        status: 'COMPLETED',
        originalPrompt: 'Published clip',
        detectedLanguage: 'en',
        aspectRatio: '16:9',
        duration: 5,
        resolution: '720p',
        generateAudio: false,
        style: 'NONE',
        cameraMotion: 'STATIC',
        creditCost: 8,
        reservedCredits: 0,
        provider: 'mock',
        model: 'mock',
      },
    });
    const video = await prisma.video.create({
      data: {
        generationId: generation.id,
        userId: user.id,
        videoUrl: 'clip.mp4',
        thumbnailUrl: 'clip.jpg',
        duration: 5,
        width: 1280,
        height: 720,
        fileSize: 100,
        visibility: 'PRIVATE',
      },
    });
    await app.inject({
      method: 'POST',
      url: `/videos/${video.id}/publish`,
      headers,
      payload: { visibility: 'PUBLIC' },
    });
    const published = await app.inject({ method: 'GET', url: '/feed', headers });
    expect((published.json() as { items: unknown[] }).items).toHaveLength(1);

    const removed = await app.inject({
      method: 'POST',
      url: `/videos/${video.id}/unpublish`,
      headers,
    });
    expect(removed.statusCode).toBe(204);
    const afterUnpublish = await app.inject({ method: 'GET', url: '/feed', headers });
    expect((afterUnpublish.json() as { items: unknown[] }).items).toHaveLength(0);
  });

  it('does not credit the same purchase token twice', async () => {
    const { tokens } = await register('buyer@klyvo.test');
    const headers = { authorization: `Bearer ${tokens.accessToken}` };
    const payload = {
      productId: 'klyvo_starter_50',
      purchaseToken: 'mock_repeat_token',
      platform: 'MOCK',
    };
    const first = await app.inject({ method: 'POST', url: '/purchases/mock', headers, payload });
    const second = await app.inject({ method: 'POST', url: '/purchases/mock', headers, payload });
    expect(first.statusCode).toBe(201);
    expect((second.json() as { alreadyProcessed: boolean }).alreadyProcessed).toBe(true);
    const wallet = await app.inject({ method: 'GET', url: '/wallet', headers });
    expect((wallet.json() as { balance: number }).balance).toBe(150);
  });
});
