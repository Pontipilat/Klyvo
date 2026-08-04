import { resolve } from 'node:path';
import { config } from '../config.js';
import {
  LocalStorageProvider,
  MockModerationProvider,
  MockPaymentProvider,
  MockPromptEnhancementProvider,
  MockVideoGenerationProvider,
} from './mock.js';
import { DeepSeekProvider, S3StorageProvider, SeedanceProvider } from './production.js';
import type {
  PromptEnhancementProvider,
  StorageProvider,
  VideoGenerationProvider,
} from './contracts.js';

export const videoGenerationProvider: VideoGenerationProvider =
  config.PROVIDER_MODE === 'seedance' ? new SeedanceProvider() : new MockVideoGenerationProvider();
export const promptEnhancementProvider: PromptEnhancementProvider =
  config.PROVIDER_MODE === 'seedance'
    ? new DeepSeekProvider()
    : new MockPromptEnhancementProvider();
export const storageProvider: StorageProvider =
  config.STORAGE_MODE === 's3'
    ? new S3StorageProvider()
    : new LocalStorageProvider(resolve(process.cwd(), 'uploads'));
export const paymentProvider = new MockPaymentProvider();
export const moderationProvider = new MockModerationProvider();
