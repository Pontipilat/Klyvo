/**
 * Уменьшение превью для ленты.
 *
 * Провайдер отдаёт последний кадр в полном разрешении — в среднем 1.7 МБ на ролик.
 * Плитка ленты шириной ~180 точек столько не использует, а страница из 12 карточек
 * заставляла телефон тянуть больше двадцати мегабайт ради картинок.
 *
 * `sharp` подключается динамически: если пакет не установлен, отдаём оригинал и
 * пишем предупреждение один раз. Так отсутствие нативной зависимости не ломает API.
 */
type SharpModule = {
  default: (input: Buffer) => {
    rotate: () => {
      resize: (options: {
        width: number;
        height: number;
        fit: 'inside';
        withoutEnlargement: boolean;
      }) => {
        jpeg: (options: { quality: number; mozjpeg: boolean }) => { toBuffer: () => Promise<Buffer> };
      };
    };
  };
};

let sharpModule: SharpModule['default'] | null | undefined;
let warned = false;

async function loadSharp() {
  if (sharpModule !== undefined) return sharpModule;
  try {
    const imported = (await import('sharp')) as unknown as SharpModule;
    sharpModule = imported.default;
  } catch {
    sharpModule = null;
  }
  return sharpModule;
}

export interface PreviewOptions {
  maxSize?: number;
  quality?: number;
}

/**
 * Возвращает уменьшённый JPEG или `null`, если уменьшить нечем.
 * Пропорции сохраняются, картинка не увеличивается.
 */
export async function createPreview(
  source: Buffer,
  { maxSize = 640, quality = 72 }: PreviewOptions = {},
  log?: { warn: (message: string) => void },
): Promise<Buffer | null> {
  const sharp = await loadSharp();
  if (!sharp) {
    if (!warned) {
      warned = true;
      log?.warn(
        'sharp не установлен: превью отдаются в полном размере. Установите его командой "pnpm add sharp -w --filter @klyvo/api", чтобы лента грузилась быстрее.',
      );
    }
    return null;
  }
  try {
    return await sharp(source)
      .rotate()
      .resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  } catch {
    return null;
  }
}

export function previewKey(key: string) {
  const dot = key.lastIndexOf('.');
  return dot > 0 ? `${key.slice(0, dot)}_preview.jpg` : `${key}_preview.jpg`;
}
