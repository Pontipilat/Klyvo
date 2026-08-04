import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Language } from '@klyvo/shared';
import type {
  ModerationProvider,
  ObjectRange,
  PaymentProvider,
  Product,
  PromptEnhancementProvider,
  StorageProvider,
  VideoGenerationInput,
  VideoGenerationProvider,
} from './contracts.js';

const videos = [
  {
    videoUrl:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1485846234645-a62644f84728?w=1200&auto=format&fit=crop',
    width: 1280,
    height: 720,
    fileSize: 2498120,
  },
  {
    videoUrl:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1533929736458-ca588d08c8be?w=1200&auto=format&fit=crop',
    width: 1280,
    height: 720,
    fileSize: 3218142,
  },
  {
    videoUrl:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1200&auto=format&fit=crop',
    width: 1280,
    height: 720,
    fileSize: 3812142,
  },
] as const;

export class MockVideoGenerationProvider implements VideoGenerationProvider {
  readonly name = 'mock';
  async create(_input: VideoGenerationInput) {
    return { taskId: `mock_${randomUUID()}` };
  }
  async result(seed: string) {
    const index = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0) % videos.length;
    return videos[index] ?? videos[0];
  }
  async cancel(_taskId: string) {}
}

export class MockPromptEnhancementProvider implements PromptEnhancementProvider {
  async enhance(prompt: string, mode: string, language: Language) {
    await new Promise((resolve) => setTimeout(resolve, process.env.NODE_ENV === 'test' ? 0 : 650));
    // Без ключа DeepSeek переводить нечем: возвращаем текст как есть,
    // чтобы приложение не выдавало выдуманную заглушку за перевод.
    if (mode === 'TRANSLATE') return prompt;
    const intent =
      mode === 'PRESERVE' ? 'Preserve every key detail.' : 'Create a polished cinematic sequence.';
    return `${intent} ${prompt} Shot on a cinema camera, intentional composition, natural motion, volumetric light, rich detail, coherent subjects, professional color grade. Source language: ${language}.`;
  }
}

export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly directory: string) {}
  private path(key: string) {
    return join(this.directory, basename(key));
  }
  localPath(key: string) {
    return this.path(key);
  }
  async put(input: NodeJS.ReadableStream, fileName: string, _mimeType: string) {
    await mkdir(this.directory, { recursive: true });
    const safeExtension = extname(basename(fileName)).slice(0, 10).toLowerCase();
    const key = `${randomUUID()}${safeExtension}`;
    let size = 0;
    input.on('data', (chunk: Buffer) => (size += chunk.length));
    await pipeline(input, createWriteStream(this.path(key)));
    return { key, size };
  }
  async putBuffer(key: string, data: Buffer) {
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.path(key), data);
    return { key, size: data.length };
  }
  /** Чтение куска файла вместо загрузки целиком — основа быстрой перемотки и старта. */
  async open(key: string, range?: ObjectRange) {
    return createReadStream(this.path(key), range ? { start: range.start, end: range.end } : {});
  }
  async size(key: string) {
    const info = await stat(this.path(key));
    return info.size;
  }
  async exists(key: string) {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
}

const products: Product[] = [
  { id: 'klyvo_starter_50', name: 'Starter', credits: 50, priceAmount: 199, currency: 'USD' },
  {
    id: 'klyvo_creator_150',
    name: 'Creator',
    credits: 150,
    priceAmount: 499,
    currency: 'USD',
    featured: true,
  },
  { id: 'klyvo_studio_350', name: 'Studio', credits: 350, priceAmount: 999, currency: 'USD' },
  { id: 'klyvo_pro_800', name: 'Pro', credits: 800, priceAmount: 1999, currency: 'USD' },
];

export class MockPaymentProvider implements PaymentProvider {
  async products() {
    return products;
  }
  async verify(productId: string, purchaseToken: string) {
    const product = products.find(({ id }) => id === productId);
    if (!product) throw new Error('PRODUCT_NOT_FOUND');
    return { valid: !purchaseToken.startsWith('fail_'), product };
  }
}

export class MockModerationProvider implements ModerationProvider {
  async moderate(prompt: string) {
    const blocked = /(?:sexual minors|terrorist propaganda)/iu.test(prompt);
    return { allowed: !blocked, reason: blocked ? 'Content policy violation' : undefined };
  }
  async report(_videoId: string, _reason: string) {
    return 'RECEIVED' as const;
  }
}
