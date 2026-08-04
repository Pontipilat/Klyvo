import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { Columns2, List, Search } from 'lucide-react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { GenerationDto } from '@klyvo/shared';
import { apiRequest } from '../../src/api/client';
import {
  KlyvoChip,
  KlyvoEmptyState,
  KlyvoIconButton,
  KlyvoSkeleton,
  ScreenHeader,
} from '../../src/components/ui';
import { useTranslation, type Translate } from '../../src/i18n';
import { colors, fonts, radii, spacing } from '../../src/theme';

interface GenerationPage {
  items: GenerationDto[];
  nextCursor?: string;
}

export default function LibraryScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'ALL' | 'READY' | 'ACTIVE' | 'PUBLISHED' | 'ERROR'>('ALL');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const query = useInfiniteQuery({
    queryKey: ['generations'],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      apiRequest<GenerationPage>(`/generations?limit=24${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.nextCursor,
    // Опрашиваем только пока что-то реально создаётся.
    refetchInterval: (current) =>
      current.state.data?.pages.some((page) =>
        page.items.some(({ status }) => status === 'QUEUED' || status === 'PROCESSING'),
      )
        ? 4000
        : false,
  });

  const all = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data?.pages],
  );
  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((item) => {
      const haystack = `${item.originalPrompt} ${item.enhancedPrompt ?? ''}`.toLowerCase();
      const matchesSearch = !needle || haystack.includes(needle);
      const matchesFilter =
        filter === 'ALL' ||
        (filter === 'READY' && item.status === 'COMPLETED') ||
        (filter === 'ACTIVE' && (item.status === 'QUEUED' || item.status === 'PROCESSING')) ||
        (filter === 'PUBLISHED' && item.video?.visibility === 'PUBLIC') ||
        (filter === 'ERROR' && (item.status === 'FAILED' || item.status === 'CANCELED'));
      return matchesSearch && matchesFilter;
    });
  }, [all, filter, search]);

  const filters = [
    { value: 'ALL', label: t('filterAll') },
    { value: 'ACTIVE', label: t('filterActive') },
    { value: 'READY', label: t('filterReady') },
    { value: 'PUBLISHED', label: t('filterPublished') },
    { value: 'ERROR', label: t('filterError') },
  ] as const;

  const filtered = Boolean(search.trim()) || filter !== 'ALL';

  /**
   * Спиннер обновления привязан к собственному состоянию, а не к isRefetching.
   * Пока идёт генерация, список опрашивается в фоне каждые 4 секунды, и react-query
   * держит isRefetching включённым — из-за этого «потяните, чтобы обновить» крутилось бесконечно.
   */
  const onRefresh = () => {
    setRefreshing(true);
    void query.refetch().finally(() => setRefreshing(false));
  };

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={styles.header}>
        <ScreenHeader
          title={t('libraryTitle')}
          subtitle={t('librarySubtitle')}
          action={
            <KlyvoIconButton
              icon={layout === 'grid' ? List : Columns2}
              label={layout === 'grid' ? t('viewList') : t('viewGrid')}
              onPress={() => setLayout(layout === 'grid' ? 'list' : 'grid')}
            />
          }
        />
        <View style={styles.search}>
          <Search color={colors.textMuted} size={18} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t('searchPlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
          />
        </View>
        <View style={styles.filterRow}>
          {filters.map((item) => (
            <KlyvoChip
              key={item.value}
              label={item.label}
              selected={item.value === filter}
              onPress={() => setFilter(item.value)}
            />
          ))}
        </View>
      </View>

      {query.isLoading ? (
        <View style={styles.loading}>
          <KlyvoSkeleton height={240} />
          <KlyvoSkeleton height={240} />
        </View>
      ) : items.length === 0 ? (
        <KlyvoEmptyState
          title={filtered ? t('libraryNothingFound') : t('libraryEmptyTitle')}
          body={filtered ? t('libraryNothingFoundBody') : t('libraryEmptyBody')}
          actionLabel={filtered ? undefined : t('create')}
          onAction={filtered ? undefined : () => router.push('/(tabs)/create')}
        />
      ) : (
        <FlashList
          key={layout}
          data={items}
          numColumns={layout === 'grid' ? 2 : 1}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          refreshControl={
            <RefreshControl refreshing={refreshing} tintColor={colors.text} onRefresh={onRefresh} />
          }
          renderItem={({ item }) => (
            <GenerationCard
              item={item}
              layout={layout}
              t={t}
              onPress={() =>
                item.video
                  ? router.push({ pathname: '/video/[id]', params: { id: item.video.id } })
                  : router.push({ pathname: '/generation/[id]', params: { id: item.id } })
              }
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function GenerationCard({
  item,
  layout,
  t,
  onPress,
}: {
  item: GenerationDto;
  layout: 'grid' | 'list';
  t: Translate;
  onPress: () => void;
}) {
  const isActive = item.status === 'QUEUED' || item.status === 'PROCESSING';
  const isFailed = item.status === 'FAILED' || item.status === 'CANCELED';
  const statusLabel =
    item.status === 'COMPLETED'
      ? t('statusReady')
      : item.status === 'FAILED'
        ? t('statusFailed')
        : item.status === 'CANCELED'
          ? t('statusCanceled')
          : item.status === 'QUEUED'
            ? t('statusQueued')
            : t('statusProcessing');
  const duration = item.timingMode === 'FRAMES' && item.frames ? item.frames / 24 : item.duration;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.itemWrap,
        layout === 'list' && styles.itemWrapList,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.poster, layout === 'list' && styles.posterList]}>
        {item.video?.thumbnailUrl ? (
          <Image
            source={{ uri: item.video.thumbnailUrl }}
            resizeMode="cover"
            style={StyleSheet.absoluteFill}
          />
        ) : isActive ? (
          <CreatingPoster />
        ) : (
          <View style={styles.failedPoster}>
            <Text style={styles.failedMark}>!</Text>
          </View>
        )}
        <View style={[styles.status, isFailed && styles.statusError]}>
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
        {item.video?.visibility === 'PUBLIC' ? (
          <View style={styles.publishedBadge}>
            <Text style={styles.publishedText}>{t('publishedBadge')}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.itemCopy}>
        {isActive ? <Text style={styles.creatingText}>{t('creatingCaption')}</Text> : null}
        <Text numberOfLines={layout === 'grid' ? 2 : 3} style={styles.itemTitle}>
          {item.originalPrompt}
        </Text>
        {isFailed ? (
          <Text numberOfLines={2} style={styles.errorText}>
            {item.status === 'CANCELED' ? t('canceled') : t('errProvider')}
          </Text>
        ) : null}
        <Text style={styles.itemMeta}>
          {duration.toFixed(duration % 1 ? 2 : 0)} {t('seconds')} · {item.resolution}
          {item.batchSize > 1
            ? ` · ${t('variant')} ${item.batchIndex}/${item.batchSize}`
            : ''}
        </Text>
      </View>
    </Pressable>
  );
}

function CreatingPoster() {
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 1800, easing: Easing.linear }),
      -1,
      false,
    );
  }, [rotation]);
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  return (
    <View style={styles.processingPoster}>
      <Animated.View style={[styles.processingRing, ringStyle]} />
      <Text style={styles.processingMark}>K</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  header: { gap: spacing.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  search: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  searchInput: { color: colors.text, flex: 1, fontFamily: fonts.medium, fontSize: 15, height: 46 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  loading: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg },
  listContent: { paddingBottom: 120, paddingHorizontal: spacing.md, paddingTop: spacing.lg },
  itemWrap: { flex: 1, gap: spacing.sm, margin: spacing.xs, marginBottom: spacing.lg, minWidth: 0 },
  itemWrapList: { flexDirection: 'row', gap: spacing.md },
  pressed: { opacity: 0.78 },
  poster: {
    aspectRatio: 0.78,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  posterList: { aspectRatio: 0.86, height: 134 },
  processingPoster: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  processingRing: {
    borderColor: colors.borderStrong,
    borderLeftColor: colors.text,
    borderRadius: 42,
    borderTopColor: colors.text,
    borderWidth: 2,
    height: 84,
    position: 'absolute',
    width: 84,
  },
  processingMark: { color: colors.text, fontFamily: fonts.extraBold, fontSize: 30 },
  failedPoster: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  failedMark: { color: colors.error, fontFamily: fonts.extraBold, fontSize: 46 },
  status: {
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    left: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    position: 'absolute',
    top: spacing.sm,
  },
  statusError: { backgroundColor: 'rgba(127,29,29,0.9)' },
  statusText: { color: colors.text, fontFamily: fonts.bold, fontSize: 11 },
  publishedBadge: {
    backgroundColor: colors.text,
    borderRadius: radii.pill,
    bottom: spacing.sm,
    left: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    position: 'absolute',
  },
  publishedText: { color: colors.background, fontFamily: fonts.bold, fontSize: 10 },
  itemCopy: { flex: 1, gap: 4, paddingHorizontal: 2 },
  creatingText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 12 },
  itemTitle: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  errorText: { color: colors.error, fontFamily: fonts.medium, fontSize: 12, lineHeight: 17 },
  itemMeta: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 12 },
});
