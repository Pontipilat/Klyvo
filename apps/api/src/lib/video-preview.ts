import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Лёгкая копия ролика для ленты.
 *
 * Оригиналы приходят в 1080p и весят до 33 МБ за десять секунд. В плитке шириной
 * ~180 точек столько не нужно, а по Wi-Fi несколько таких роликов одновременно
 * просто не проигрываются. Копия — 480p по короткой стороне, без звука,
 * с moov-атомом в начале файла, чтобы воспроизведение начиналось сразу.
 *
 * `ffmpeg-static` подключается динамически: если бинарника нет, лента продолжает
 * работать на оригиналах, просто медленнее.
 */
let ffmpegPath: string | null | undefined;
let warned = false;

async function resolveFfmpeg(log?: { warn: (message: string) => void }) {
  if (ffmpegPath !== undefined) return ffmpegPath;
  try {
    const module = await import('ffmpeg-static');
    ffmpegPath = module.default ?? null;
  } catch {
    ffmpegPath = null;
  }
  if (!ffmpegPath && !warned) {
    warned = true;
    log?.warn(
      'ffmpeg-static недоступен: лента будет отдавать оригиналы видео. Установите его командой "pnpm add ffmpeg-static --filter @klyvo/api".',
    );
  }
  return ffmpegPath;
}

export interface PreviewResult {
  data: Buffer;
  originalSize: number;
  durationMs: number;
}

export interface PreviewSource {
  /** Готовый путь к файлу — используется локальным хранилищем, экономит память и лишнюю запись. */
  path?: string;
  /** Содержимое, если файл лежит в объектном хранилище и пути на диске нет. */
  data?: Buffer;
  size: number;
}

export async function createVideoPreview(
  source: PreviewSource,
  options: { threads?: number; shortSide?: number; crf?: number } = {},
  log?: { warn: (message: string) => void },
): Promise<PreviewResult | null> {
  const binary = await resolveFfmpeg(log);
  if (!binary) return null;
  if (!source.path && !source.data) return null;
  const started = Date.now();
  const directory = await mkdtemp(join(tmpdir(), 'klyvo-preview-'));
  const output = join(directory, 'output.mp4');
  let input = source.path;
  try {
    if (!input) {
      input = join(directory, 'input.mp4');
      await writeFile(input, source.data as Buffer);
    }
    await run(
      binary,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        // Ограничиваем число потоков, чтобы перекодирование не забирало весь процессор
        // и не замедляло обычные запросы к API.
        '-threads',
        String(Math.max(1, options.threads ?? 1)),
        '-i',
        input,
        /**
         * Короткая сторона 720: плитка шириной ~180 точек на экране с тройной
         * плотностью требует около 540 пикселей, 480p туда уже не хватало.
         * Чётные размеры обязательны для H.264.
         */
        '-vf',
        `scale='if(gt(iw,ih),-2,${options.shortSide ?? 720})':'if(gt(iw,ih),${options.shortSide ?? 720},-2)'`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        // crf 23 против прежних 30: на реальном ролике 0.82 МБ вместо 0.10 МБ,
        // и это по-прежнему в двадцать раз легче оригинала.
        '-crf',
        String(options.crf ?? 23),
        // main вместо baseline: заметно лучше сжимает при том же качестве.
        '-profile:v',
        'main',
        '-level',
        '4.0',
        '-pix_fmt',
        'yuv420p',
        // Звук в ленте всё равно выключен по умолчанию — не тащим его по сети.
        '-an',
        // moov в начало: плеер начинает играть, не скачав файл целиком.
        '-movflags',
        '+faststart',
        output,
      ],
      { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const data = await readFile(output);
    if (!data.length) return null;
    return { data, originalSize: source.size, durationMs: Date.now() - started };
  } catch {
    return null;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Кадр-обложка из готового ролика.
 *
 * fal.ai отдаёт только видеофайл, отдельной обложки у Kling и Seedance нет.
 * Раньше её присылал провайдер, поэтому обложку мы вырезаем сами: берём кадр
 * на первой секунде (в самом начале ролика часто затемнение) и кладём рядом.
 * Если ffmpeg недоступен, возвращается `null` — генерация из-за этого не падает.
 */
export async function extractPosterFrame(
  source: PreviewSource,
  log?: { warn: (message: string) => void },
): Promise<Buffer | null> {
  const binary = await resolveFfmpeg(log);
  if (!binary) return null;
  if (!source.path && !source.data) return null;
  const directory = await mkdtemp(join(tmpdir(), 'klyvo-poster-'));
  const output = join(directory, 'poster.jpg');
  let input = source.path;
  try {
    if (!input) {
      input = join(directory, 'input.mp4');
      await writeFile(input, source.data as Buffer);
    }
    await run(
      binary,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        // Перемотка до -i: ffmpeg не декодирует всё, что было до нужной секунды.
        '-ss',
        '1',
        '-i',
        input,
        '-frames:v',
        '1',
        '-q:v',
        '3',
        output,
      ],
      { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const data = await readFile(output);
    return data.length ? data : null;
  } catch {
    return null;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function feedPreviewKey(key: string) {
  const dot = key.lastIndexOf('.');
  return dot > 0 ? `${key.slice(0, dot)}_feed.mp4` : `${key}_feed.mp4`;
}
