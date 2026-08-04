import { useCallback, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowUp,
  Clapperboard,
  Image as ImageIcon,
  ImagePlus,
  Menu,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react-native';
import {
  describeGenerationCost,
  modeIsImageInput,
  type FeedItemDto,
  type WalletDto,
} from '@klyvo/shared';
import { apiRequest } from '../../src/api/client';
import {
  KlyvoBottomSheet,
  KlyvoButton,
  KlyvoChip,
  KlyvoCreditBadge,
  KlyvoDrawer,
  KlyvoEmptyState,
  KlyvoErrorState,
  KlyvoFeedTile,
  KlyvoIconButton,
  KlyvoMasonry,
  KlyvoSkeleton,
  sizeFromAspectRatio,
  useToast,
} from '../../src/components/ui';
import { useTranslation } from '../../src/i18n';
import { useCreateStore } from '../../src/state/create';
import { colors, fonts, radii, spacing } from '../../src/theme';

type FeedSection = 'video' | 'image';
type FeedItem = FeedItemDto & { mine?: boolean };
interface FeedPage {
  items: FeedItem[];
  nextCursor?: string;
}

/** Каждая плитка ленты знает свои пропорции — они нужны кладке для расчёта высоты. */
interface FeedTileItem {
  id: string;
  width: number;
  height: number;
  thumbnailUrl: string;
  videoUrl: string;
  source: FeedItem;
}

const MAX_FRAME_BYTES = 50 * 1024 * 1024;

export default function FeedScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { t, tError } = useTranslation();
  const toast = useToast();
  const createStore = useCreateStore();
  const [muted, setMuted] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /**
   * Вкладка остаётся смонтированной при переходе на другую, и плееры замирали
   * на паузе, не возобновляясь при возврате. Теперь при уходе с ленты они
   * снимаются целиком, а при возврате создаются заново и сразу играют.
   */
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const [reportTarget, setReportTarget] = useState<FeedItem>();
  const [composeText, setComposeText] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const countedViews = useRef(new Set<string>()).current;

  const wallet = useQuery({
    queryKey: ['wallet'],
    queryFn: () => apiRequest<WalletDto>('/wallet'),
  });

  /**
   * Лента показывает то же, что выбрано на экране создания: ролики или картинки.
   * Вид входит в ключ запроса, иначе при переключении отдавался бы старый кэш.
   */
  const kind = createStore.kind;
  const section: FeedSection = kind === 'IMAGE' ? 'image' : 'video';
  const feedKey = ['feed', kind] as const;

  const feed = useInfiniteQuery({
    queryKey: feedKey,
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      apiRequest<FeedPage>(
        `/feed?limit=12&kind=${kind}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });

  const tiles = useMemo<FeedTileItem[]>(
    () =>
      (feed.data?.pages.flatMap((page) => page.items) ?? []).map((item) => ({
        id: item.id,
        ...sizeFromAspectRatio(
          item.video.generation.aspectRatio,
          item.video.width,
          item.video.height,
        ),
        thumbnailUrl: item.video.thumbnailUrl,
        // Кладка использует это, чтобы заранее прогреть начало ролика.
        // У картинки проигрывать нечего — плитка остаётся статичной.
        videoUrl: item.video.mediaType === 'IMAGE' ? '' : item.video.videoUrl,
        source: item,
      })),
    [feed.data?.pages],
  );

  /** Лайк отрисовывается сразу, не дожидаясь ответа сервера и перезагрузки всей ленты. */
  const like = useMutation({
    mutationFn: ({ videoId, liked }: { videoId: string; liked: boolean }) =>
      apiRequest<{ liked: boolean; likesCount: number }>(`/feed/${videoId}/like`, {
        method: liked ? 'DELETE' : 'POST',
      }),
    onMutate: async ({ videoId, liked }) => {
      await queryClient.cancelQueries({ queryKey: feedKey });
      const previous = queryClient.getQueryData(feedKey);
      queryClient.setQueryData<{ pages: FeedPage[]; pageParams: unknown[] }>(feedKey, (current) =>
        current
          ? {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                items: page.items.map((item) =>
                  item.videoId === videoId
                    ? {
                        ...item,
                        liked: !liked,
                        likesCount: Math.max(0, item.likesCount + (liked ? -1 : 1)),
                      }
                    : item,
                ),
              })),
            }
          : current,
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(feedKey, context.previous);
      toast.show(tError(error), 'error');
    },
  });

  const report = useMutation({
    mutationFn: ({ videoId, reason }: { videoId: string; reason: string }) =>
      apiRequest(`/feed/${videoId}/report`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      setReportTarget(undefined);
      toast.show(t('reportSent'));
    },
    onError: (error) => toast.show(tError(error), 'error'),
  });

  const cost = describeGenerationCost({
    mode: createStore.mode,
    timingMode: createStore.timingMode,
    duration: createStore.duration,
    frames: createStore.frames,
    resolution: createStore.resolution,
    buildQuantity: createStore.buildQuantity,
    generateAudio: createStore.generateAudio,
  });
  const available = wallet.data?.availableBalance ?? 0;

  const generate = useMutation({
    mutationFn: () =>
      apiRequest<{ generations: Array<{ id: string }> }>('/generations', {
        method: 'POST',
        body: JSON.stringify({
          mode: createStore.mode,
          modelId: createStore.modelId,
          prompt: composeText.trim(),
          firstFrameAssetId: createStore.firstFrame?.id,
          aspectRatio: createStore.aspectRatio,
          timingMode: createStore.timingMode,
          duration: createStore.duration,
          frames: createStore.timingMode === 'FRAMES' ? createStore.frames : undefined,
          resolution: createStore.resolution,
          buildQuantity: createStore.buildQuantity,
          generateAudio: createStore.generateAudio,
          style: createStore.style,
          cameraMotion: createStore.cameraMotion,
        }),
      }),
    onSuccess: ({ generations }) => {
      setQuickOpen(false);
      setComposeText('');
      createStore.set('firstFrame', undefined);
      createStore.set('mode', 'TEXT_TO_VIDEO');
      void queryClient.invalidateQueries({ queryKey: ['generations'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      const first = generations[0];
      if (first) router.push({ pathname: '/generation/[id]', params: { id: first.id } });
    },
    onError: (error) => toast.show(tError(error), 'error'),
  });

  /** Просмотр засчитывается один раз за сеанс, а не на каждой прокрутке. */
  const countViews = useCallback(
    (ids: string[]) => {
      for (const id of ids) {
        const videoId = tiles.find((tile) => tile.id === id)?.source.videoId;
        if (!videoId || countedViews.has(videoId)) continue;
        countedViews.add(videoId);
        void apiRequest(`/feed/${videoId}/view`, { method: 'POST' }).catch(() => undefined);
      }
    },
    [countedViews, tiles],
  );

  /**
   * Кадр прикрепляется прямо из ленты: файл сразу уходит на сервер и кладётся
   * в черновик создания, поэтому он виден и здесь, и на экране «Создать».
   */
  const attachFrame = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.92,
      allowsEditing: false,
    });
    const selected = result.assets?.[0];
    if (result.canceled || !selected) return;
    if (selected.fileSize && selected.fileSize > MAX_FRAME_BYTES) {
      toast.show(t('frameTooLarge'), 'error');
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', {
        uri: selected.uri,
        name: selected.fileName ?? 'first-frame.jpg',
        type: selected.mimeType ?? 'image/jpeg',
      } as unknown as Blob);
      const response = await apiRequest<{ asset: { id: string; mimeType: string } }>('/uploads', {
        method: 'POST',
        body,
        timeoutMs: 60_000,
      });
      createStore.set('firstFrame', {
        id: response.asset.id,
        uri: selected.uri,
        mimeType: response.asset.mimeType,
      });
      createStore.set('mode', 'IMAGE_TO_VIDEO');
    } catch (error) {
      toast.show(tError(error), 'error');
    } finally {
      setUploading(false);
    }
  };

  /**
   * Колбэки стабильны между рендерами — иначе React.memo на плитке не сработает
   * и весь список пересобирался бы на каждый кадр прокрутки.
   */
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;
  const findItem = useCallback((id: string) => tilesRef.current.find((tile) => tile.id === id)?.source, []);

  const openVideo = useCallback(
    (id: string) => {
      const item = findItem(id);
      if (item) router.push({ pathname: '/video/[id]', params: { id: item.video.id } });
    },
    [findItem, router],
  );
  const toggleLike = useCallback(
    (id: string) => {
      const item = findItem(id);
      if (item) like.mutate({ videoId: item.videoId, liked: item.liked });
    },
    [findItem, like],
  );
  const openReport = useCallback(
    (id: string) => {
      const item = findItem(id);
      if (item) setReportTarget(item);
    },
    [findItem],
  );

  const openCreateScreen = useCallback(() => {
    if (composeText.trim()) createStore.set('prompt', composeText.trim());
    router.push('/(tabs)/create');
  }, [composeText, createStore, router]);

  const headerHeight = insets.top + 52;
  const promptReady = composeText.trim().length >= 3;
  const frameReady = !modeIsImageInput(createStore.mode) || Boolean(createStore.firstFrame);
  const enoughCredits = available >= cost.total;

  const body = () => {
    if (feed.isError) {
      return (
        <View style={[styles.center, { paddingTop: headerHeight }]}>
          <KlyvoErrorState
            title={t('offlineTitle')}
            body={t('offlineBody')}
            actionLabel={t('tryAgain')}
            onAction={() => void feed.refetch()}
          />
        </View>
      );
    }
    if (feed.isLoading) {
      return (
        <View style={[styles.skeletons, { paddingTop: headerHeight + spacing.sm }]}>
          <View style={styles.skeletonColumn}>
            <KlyvoSkeleton height={220} radius={14} />
            <KlyvoSkeleton height={160} radius={14} />
          </View>
          <View style={styles.skeletonColumn}>
            <KlyvoSkeleton height={150} radius={14} />
            <KlyvoSkeleton height={230} radius={14} />
          </View>
        </View>
      );
    }
    if (!tiles.length) {
      return (
        <View style={[styles.center, { paddingTop: headerHeight }]}>
          <KlyvoEmptyState
            title={t('feedEmptyTitle')}
            body={t('feedEmptyBody')}
            actionLabel={t('create')}
            onAction={() => router.push('/(tabs)/create')}
          />
        </View>
      );
    }
    return (
      <KlyvoMasonry
        data={tiles}
        paddingTop={headerHeight + spacing.sm}
        paddingBottom={insets.bottom + 150}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void feed.refetch().finally(() => setRefreshing(false));
        }}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        onActiveChange={countViews}
        renderItem={(tile, active) => {
          const item = tile.source;
          return (
            // focused: при уходе на другую вкладку плееры снимаются, при возврате
            // создаются заново и сразу играют — иначе видео оставались на паузе.
            <KlyvoFeedTile
              item={{
                id: item.id,
                videoUrl: item.video.mediaType === 'IMAGE' ? '' : item.video.videoUrl,
                thumbnailUrl: item.video.thumbnailUrl,
                width: tile.width,
                height: tile.height,
                authorName: item.showAuthor ? item.user.displayName : t('anonymousAuthor'),
                likesCount: item.likesCount,
                liked: item.liked,
                mine: item.mine,
              }}
              active={active && focused}
              muted={muted}
              yoursLabel={t('yours')}
              likeLabel={t('likeAction')}
              unavailableLabel={t('videoUnavailable')}
              onPress={openVideo}
              onLike={toggleLike}
              onLongPress={openReport}
            />
          );
        }}
      />
    );
  };

  return (
    <View style={styles.screen}>
      {body()}

      {/* Шапка прозрачная: контент виден под ней, читаемость держат сами кнопки. */}
      <View style={[styles.header, { paddingTop: insets.top }]} pointerEvents="box-none">
        <View style={styles.headerRow}>
          <KlyvoIconButton
            icon={Menu}
            label={t('menu')}
            size={38}
            onPress={() => setMenuOpen(true)}
          />
          <View style={styles.headerActions}>
            <KlyvoIconButton
              icon={muted ? VolumeX : Volume2}
              label={muted ? t('soundOn') : t('soundOff')}
              size={38}
              onPress={() => setMuted(!muted)}
            />
            <Pressable onPress={() => router.push('/shop')}>
              <KlyvoCreditBadge amount={available} />
            </Pressable>
          </View>
        </View>
      </View>

      <KlyvoDrawer
        visible={menuOpen}
        title="Klyvo"
        activeKey={section}
        onClose={() => setMenuOpen(false)}
        onSelect={(key: string) => {
          // Раздел меню и есть выбор вида: он же применяется на экране создания.
          createStore.setKind(key === 'image' ? 'IMAGE' : 'VIDEO');
          setMenuOpen(false);
        }}
        items={[
          {
            key: 'video',
            label: t('sectionVideo'),
            description: t('sectionVideoHint'),
            icon: Clapperboard,
          },
          {
            key: 'image',
            label: t('sectionImage'),
            description: t('sectionImageHint'),
            icon: ImageIcon,
            badge: t('comingSoon'),
          },
        ]}
      />

      <BlurView intensity={48} tint="dark" style={[styles.compose, { bottom: insets.bottom + 12 }]}>
        {/* Левый круг — прикрепить кадр из галереи, а не переход в профиль. */}
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('firstFrame')}
            disabled={uploading}
            onPress={() => void attachFrame()}
            style={styles.composeAvatar}
          >
            {createStore.firstFrame ? (
              <Image
                source={{ uri: createStore.firstFrame.uri }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
              />
            ) : (
              <ImagePlus color={uploading ? colors.borderStrong : colors.textMuted} size={19} />
            )}
          </Pressable>
          {createStore.firstFrame ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('removeFrame')}
              hitSlop={10}
              onPress={() => {
                createStore.set('firstFrame', undefined);
                createStore.set('mode', 'TEXT_TO_VIDEO');
              }}
              style={styles.removeFrame}
            >
              <X color={colors.background} size={11} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('create')}
          onPress={openCreateScreen}
          style={styles.composePlus}
        >
          <Plus color={colors.background} size={20} />
        </Pressable>
        <TextInput
          value={composeText}
          onChangeText={setComposeText}
          onSubmitEditing={() => promptReady && setQuickOpen(true)}
          returnKeyType="go"
          placeholder={t('composePlaceholder')}
          placeholderTextColor={colors.textMuted}
          style={styles.composeInput}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={promptReady ? t('generate') : t('advancedShow')}
          onPress={() => (promptReady ? setQuickOpen(true) : openCreateScreen())}
          style={[styles.composeSettings, promptReady && styles.composeSend]}
        >
          {promptReady ? (
            <ArrowUp color={colors.background} size={18} />
          ) : (
            <SlidersHorizontal color={colors.text} size={18} />
          )}
        </Pressable>
      </BlurView>

      {/* Быстрый запуск из ленты: цена и параметры видны до списания. */}
      <KlyvoBottomSheet
        visible={quickOpen}
        title={t('createTitle')}
        onClose={() => setQuickOpen(false)}
      >
        <View style={styles.quickRow}>
          {createStore.firstFrame ? (
            <Image source={{ uri: createStore.firstFrame.uri }} style={styles.quickFrame} />
          ) : null}
          <Text style={styles.quickPrompt}>{composeText.trim()}</Text>
        </View>
        <View style={styles.quickChips}>
          <KlyvoChip label={createStore.aspectRatio} />
          <KlyvoChip label={`${createStore.duration} ${t('seconds')}`} />
          <KlyvoChip label={createStore.resolution} />
          <KlyvoChip label={createStore.generateAudio ? t('withSound') : t('withoutSound')} />
        </View>
        <View style={styles.quickCost}>
          <Text style={styles.quickCostLabel}>{t('cost')}</Text>
          <Text style={styles.quickCostValue}>
            {cost.total} {t('creditsShort')}
          </Text>
        </View>
        {!enoughCredits ? <Text style={styles.warning}>{t('needCredits')}</Text> : null}
        {!frameReady ? <Text style={styles.warning}>{t('needFirstFrame')}</Text> : null}
        <View style={styles.quickActions}>
          <KlyvoButton
            fullWidth
            size="lg"
            icon={Sparkles}
            label={generate.isPending ? t('generating') : t('generate')}
            loading={generate.isPending}
            disabled={!enoughCredits || !frameReady}
            onPress={() => generate.mutate()}
          />
          <KlyvoButton
            fullWidth
            variant="secondary"
            icon={SlidersHorizontal}
            label={t('advancedShow')}
            onPress={() => {
              setQuickOpen(false);
              openCreateScreen();
            }}
          />
        </View>
      </KlyvoBottomSheet>

      <KlyvoBottomSheet
        visible={Boolean(reportTarget)}
        title={t('reportTitle')}
        onClose={() => setReportTarget(undefined)}
      >
        <Text style={styles.sheetBody}>{t('reportBody')}</Text>
        <View style={styles.reasons}>
          {[
            t('reportSexual'),
            t('reportViolence'),
            t('reportCopyright'),
            t('reportSpam'),
            t('reportOther'),
          ].map((label) => (
            <KlyvoChip
              key={label}
              label={label}
              disabled={report.isPending}
              onPress={() => {
                if (!reportTarget) return;
                report.mutate({ videoId: reportTarget.videoId, reason: label });
              }}
            />
          ))}
        </View>
        <KlyvoButton
          fullWidth
          variant="ghost"
          label={t('cancel')}
          onPress={() => setReportTarget(undefined)}
        />
      </KlyvoBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  center: { flex: 1, justifyContent: 'center' },
  skeletons: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.md },
  skeletonColumn: { flex: 1, gap: spacing.md },
  // Прозрачная шапка: контент проходит под ней, читаемость держат сами кнопки.
  header: { left: 0, position: 'absolute', right: 0, top: 0 },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 52,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  headerActions: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  compose: {
    alignItems: 'center',
    backgroundColor: 'rgba(15,15,17,0.86)',
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    left: spacing.md,
    overflow: 'hidden',
    padding: 6,
    position: 'absolute',
    right: spacing.md,
  },
  composeAvatar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 40,
  },
  removeFrame: {
    alignItems: 'center',
    backgroundColor: colors.text,
    borderColor: colors.background,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    height: 18,
    justifyContent: 'center',
    position: 'absolute',
    right: -3,
    top: -3,
    width: 18,
  },
  composePlus: {
    alignItems: 'center',
    backgroundColor: colors.text,
    borderRadius: radii.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  composeInput: { color: colors.text, flex: 1, fontFamily: fonts.medium, fontSize: 14, height: 40 },
  composeSettings: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  composeSend: { backgroundColor: colors.text },
  quickRow: { flexDirection: 'row', gap: spacing.md },
  quickFrame: { borderRadius: radii.md, height: 64, width: 64 },
  quickPrompt: { color: colors.text, flex: 1, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  quickChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  quickCost: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  quickCostLabel: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 13 },
  quickCostValue: { color: colors.text, fontFamily: fonts.bold, fontSize: 20 },
  warning: { color: colors.warning, fontFamily: fonts.semibold, fontSize: 13 },
  quickActions: { gap: spacing.sm },
  sheetBody: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
