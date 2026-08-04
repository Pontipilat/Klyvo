import { memo, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEventListener } from 'expo';
import { LinearGradient } from 'expo-linear-gradient';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Heart, TriangleAlert } from 'lucide-react-native';
import { colors, fonts, radii, spacing } from '../../theme';

/** Держим плитки в приятных пропорциях, даже если модель вернула экстремальный кадр. */
function safeAspect(width?: number, height?: number, fallback = 0.72) {
  if (!width || !height) return fallback;
  const ratio = width / height;
  if (!Number.isFinite(ratio) || ratio <= 0) return fallback;
  return Math.min(2.4, Math.max(0.5, ratio));
}

/**
 * Размер плитки по заявленному формату генерации.
 * Провайдер не всегда возвращает реальные width/height, и тогда в базу попадает
 * запасной 1280×720 — из-за этого вертикальные ролики показывались горизонтальными.
 * Формат, выбранный при создании, известен точно, поэтому он в приоритете.
 */
export function sizeFromAspectRatio(
  label: string | undefined,
  fallbackWidth?: number,
  fallbackHeight?: number,
): { width: number; height: number } {
  const match = label && /^(\d+):(\d+)$/u.exec(label);
  if (match) {
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width > 0 && height > 0) return { width, height };
  }
  return { width: fallbackWidth || 1280, height: fallbackHeight || 720 };
}

/**
 * Плеер на экране видео. Пропорции берутся из самого ролика,
 * поэтому горизонтальные видео больше не показываются в вертикальной рамке.
 */
export function KlyvoVideoPlayer({
  uri,
  width,
  height,
  autoplay = false,
}: {
  uri: string;
  width?: number;
  height?: number;
  autoplay?: boolean;
}) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    if (autoplay) instance.play();
  });
  return (
    <View style={[styles.playerWrap, { aspectRatio: safeAspect(width, height, 9 / 16) }]}>
      <VideoView
        player={player}
        nativeControls
        allowsFullscreen
        contentFit="contain"
        surfaceType="textureView"
        style={styles.player}
      />
    </View>
  );
}

/**
 * Видео внутри плитки ленты. Компонент монтируется только когда плитка
 * реально видна на экране — так проигрывается именно то, что попало в кадр,
 * а плеера для невидимых роликов не существует и они не жрут батарею.
 */
function TileVideo({
  uri,
  muted,
  onError,
}: {
  uri: string;
  muted: boolean;
  onError: () => void;
}) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.muted = true;
    /**
     * По умолчанию Android буферизует 20 секунд вперёд — для ролика на 18 МБ это
     * означает скачать почти весь файл до первого кадра. В ленте нам нужен быстрый
     * старт, а не запас, поэтому буфер маленький.
     */
    instance.bufferOptions = {
      preferredForwardBufferDuration: 3,
      minBufferForPlayback: 0.5,
      maxBufferBytes: 4 * 1024 * 1024,
      prioritizeTimeOverSizeThreshold: true,
      waitsToMinimizeStalling: false,
    };
    instance.play();
  });
  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);
  // Ссылки провайдера живут ограниченное время. Если источник умер, показываем это явно,
  // вместо чёрного прямоугольника без объяснений.
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'error') onError();
  });
  // Повторный play на случай, если плеер создался раньше, чем источник успел открыться.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        player.play();
      } catch {
        // Плеер мог быть освобождён вместе с плиткой — это нормально.
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [player]);
  return (
    <VideoView
      player={player}
      nativeControls={false}
      contentFit="cover"
      pointerEvents="none"
      // На Android surfaceView в скролле со скруглениями часто рисует чёрный прямоугольник.
      surfaceType="textureView"
      style={StyleSheet.absoluteFill}
    />
  );
}

export interface FeedTileData {
  id: string;
  videoUrl: string;
  thumbnailUrl: string;
  width?: number;
  height?: number;
  authorName?: string;
  likesCount: number;
  liked: boolean;
  mine?: boolean;
  durationLabel?: string;
}

interface FeedTileProps {
  item: FeedTileData;
  active: boolean;
  muted?: boolean;
  yoursLabel: string;
  likeLabel: string;
  unavailableLabel: string;
  onPress: (id: string) => void;
  onLike: (id: string) => void;
  onLongPress?: (id: string) => void;
}

function FeedTile({
  item,
  active,
  muted = true,
  yoursLabel,
  likeLabel,
  unavailableLabel,
  onPress,
  onLike,
  onLongPress,
}: FeedTileProps) {
  const [failed, setFailed] = useState(false);
  return (
    <Pressable
      onPress={() => onPress(item.id)}
      onLongPress={onLongPress ? () => onLongPress(item.id) : undefined}
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
    >
      <Image
        source={{ uri: item.thumbnailUrl }}
        resizeMode="cover"
        style={StyleSheet.absoluteFill}
      />
      {/* У картинки видеофайла нет — в плитке остаётся только сама картинка. */}
      {active && !failed && item.videoUrl ? (
        <TileVideo uri={item.videoUrl} muted={muted} onError={() => setFailed(true)} />
      ) : null}
      {/*
        Затемнения на всю плитку больше нет: оно приглушало картинку и делало ленту
        грязнее. Осталась короткая подложка только под самой кнопкой лайка.
      */}
      {failed ? (
        <View style={styles.tileFailed} pointerEvents="none">
          <TriangleAlert color={colors.warning} size={18} />
          <Text style={styles.tileFailedText}>{unavailableLabel}</Text>
        </View>
      ) : null}
      {item.mine ? (
        <View style={styles.mineBadge} pointerEvents="none">
          <Text style={styles.mineText}>{yoursLabel}</Text>
        </View>
      ) : null}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.5)']}
        style={styles.tileScrim}
        pointerEvents="none"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={likeLabel}
        hitSlop={10}
        onPress={() => onLike(item.id)}
        style={styles.tileLike}
      >
        <Heart
          size={14}
          color={item.liked ? colors.error : colors.text}
          fill={item.liked ? colors.error : 'transparent'}
        />
        <Text style={styles.tileLikeText}>{item.likesCount}</Text>
      </Pressable>
    </Pressable>
  );
}

/**
 * Плитка перерисовывается только когда меняется что-то видимое.
 * Без этого каждый кадр прокрутки пересобирал все плитки окна вместе с плеерами.
 */
export const KlyvoFeedTile = memo(FeedTile, (prev, next) => {
  const a = prev.item;
  const b = next.item;
  return (
    prev.active === next.active &&
    prev.muted === next.muted &&
    a.id === b.id &&
    a.videoUrl === b.videoUrl &&
    a.thumbnailUrl === b.thumbnailUrl &&
    a.liked === b.liked &&
    a.likesCount === b.likesCount &&
    a.authorName === b.authorName &&
    a.mine === b.mine &&
    prev.onPress === next.onPress &&
    prev.onLike === next.onLike &&
    prev.onLongPress === next.onLongPress
  );
});

export function KlyvoVideoCard({
  thumbnailUrl,
  title,
  meta,
  aspect = 'landscape',
  onPress,
}: {
  thumbnailUrl: string;
  title: string;
  meta?: string;
  aspect?: 'landscape' | 'portrait' | 'square';
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles[`card_${aspect}`], pressed && styles.tilePressed]}
    >
      <Image source={{ uri: thumbnailUrl }} resizeMode="cover" style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.14)', 'rgba(0,0,0,0.92)']}
        locations={[0.25, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.copy}>
        <Text numberOfLines={2} style={styles.title}>
          {title}
        </Text>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 14,
    flex: 1,
    overflow: 'hidden',
    width: '100%',
  },
  tilePressed: { opacity: 0.85 },
  // Короткая подложка снизу, чтобы счётчик лайков читался на светлом кадре.
  tileScrim: { bottom: 0, height: 56, left: 0, position: 'absolute', right: 0 },
  tileFailed: {
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    left: 0,
    paddingHorizontal: spacing.sm,
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
  },
  tileFailedText: {
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 11,
    textAlign: 'center',
  },
  mineBadge: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
  },
  mineText: { color: colors.text, fontFamily: fonts.bold, fontSize: 10 },
  tileLike: {
    alignItems: 'center',
    bottom: spacing.sm,
    flexDirection: 'row',
    gap: 4,
    minHeight: 26,
    paddingHorizontal: spacing.sm,
    position: 'absolute',
    right: 4,
  },
  tileLikeText: { color: colors.text, fontFamily: fonts.bold, fontSize: 11 },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  card_landscape: { aspectRatio: 1.46, width: 250 },
  card_portrait: { aspectRatio: 0.72, width: 180 },
  card_square: { aspectRatio: 1, width: '100%' },
  copy: { gap: 5, padding: spacing.md },
  title: { color: colors.text, fontFamily: fonts.bold, fontSize: 14, lineHeight: 19 },
  meta: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 12 },
  playerWrap: {
    backgroundColor: '#000',
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
  },
  player: { height: '100%', width: '100%' },
});
