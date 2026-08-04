import { resolve } from 'node:path';
import { config } from '../config.js';
import { FalProvider } from './fal.js';
import {
  LocalStorageProvider,
  MockMediaGenerationProvider,
  MockModerationProvider,
  MockPaymentProvider,
  MockPromptEnhancementProvider,
} from './mock.js';
import { DeepSeekProvider, S3StorageProvider } from './production.js';
import type {
  MediaGenerationProvider,
  PromptEnhancementProvider,
  StorageProvider,
} from './contracts.js';

/** Настоящие генерации включены только когда выбран режим fal и задан ключ. */
export const liveProviders = config.PROVIDER_MODE === 'fal';

export const mediaGenerationProvider: MediaGenerationProvider = liveProviders
  ? new FalProvider()
  : new MockMediaGenerationProvider();
export const promptEnhancementProvider: PromptEnhancementProvider =
  liveProviders && config.DEEPSEEK_API_KEY
    ? new DeepSeekProvider()
    : new MockPromptEnhancementProvider();
export const storageProvider: StorageProvider =
  config.STORAGE_MODE === 's3'
    ? new S3StorageProvider()
    : new LocalStorageProvider(resolve(process.cwd(), 'uploads'));
export const paymentProvider = new MockPaymentProvider();
export const moderationProvider = new MockModerationProvider();
