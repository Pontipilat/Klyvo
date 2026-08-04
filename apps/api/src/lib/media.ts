import type { FastifyRequest } from 'fastify';
import { storageProvider } from '../providers/index.js';

interface StoredVideo {
  id: string;
  videoUrl: string;
  thumbnailUrl: string;
  videoStorageKey?: string | null;
  thumbnailStorageKey?: string | null;
  previewStorageKey?: string | null;
  thumbnailPreviewStorageKey?: string | null;
}

function requestBaseUrl(request: FastifyRequest) {
  const forwarded = request.headers['x-forwarded-proto'];
  const protocol = typeof forwarded === 'string' ? forwarded.split(',')[0] : request.protocol;
  return `${protocol}://${request.headers.host}`;
}

/**
 * Собирает ссылку на медиа.
 *
 * Если хранилище умеет отдавать файлы напрямую (R2 с публичным доменом), ссылка
 * ведёт прямо в хранилище: сервер приложения не участвует в передаче байтов и не
 * тратит ни трафик, ни процессор. Это важно для хостинга с оплатой по ресурсам.
 *
 * Иначе (локальное хранилище в разработке) отдаём через собственный маршрут.
 */
function mediaUrl(
  request: FastifyRequest,
  video: StoredVideo,
  key: string | null | undefined,
  kind: 'video' | 'preview' | 'thumbnail',
  fallback: string,
) {
  if (!key) return fallback;
  const direct = storageProvider.publicUrl?.(key);
  if (direct) return direct;
  return `${requestBaseUrl(request)}/media/videos/${encodeURIComponent(video.id)}/${kind}`;
}

/**
 * @param variant `feed` отдаёт облегчённую копию (480p без звука) и уменьшенное превью,
 * если они уже готовы. Полное качество остаётся на экране просмотра.
 */
export function withMediaUrls<T extends StoredVideo>(
  request: FastifyRequest,
  video: T,
  variant: 'full' | 'feed' = 'full',
): T {
  const useVideoPreview = variant === 'feed' && Boolean(video.previewStorageKey);
  const videoKey = useVideoPreview ? video.previewStorageKey : video.videoStorageKey;
  const thumbnailKey =
    variant === 'feed' && video.thumbnailPreviewStorageKey
      ? video.thumbnailPreviewStorageKey
      : video.thumbnailStorageKey;
  return {
    ...video,
    videoUrl: mediaUrl(
      request,
      video,
      videoKey,
      useVideoPreview ? 'preview' : 'video',
      video.videoUrl,
    ),
    thumbnailUrl: mediaUrl(request, video, thumbnailKey, 'thumbnail', video.thumbnailUrl),
  };
}
