import { useEffect, useState } from 'react';
import { Image, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Copy,
  Cpu,
  Download,
  EyeOff,
  Heart,
  RotateCcw,
  Send,
  Share2,
  Trash2,
} from 'lucide-react-native';
import {
  findGenerationModel,
  type GenerationInput,
  type GenerationKind,
  type PublicationSettingsDto,
} from '@klyvo/shared';
import { apiRequest } from '../../src/api/client';
import {
  KlyvoBottomSheet,
  KlyvoButton,
  KlyvoCard,
  KlyvoChip,
  KlyvoConfirm,
  KlyvoErrorState,
  KlyvoIconButton,
  KlyvoImageViewer,
  KlyvoScreen,
  KlyvoSkeleton,
  KlyvoToggle,
  KlyvoVideoPlayer,
  sizeFromAspectRatio,
  useToast,
} from '../../src/components/ui';
import { useTranslation } from '../../src/i18n';
import { useCreateStore } from '../../src/state/create';
import { colors, fonts, radii, spacing } from '../../src/theme';

interface VideoDetail {
  id: string;
  mediaType?: GenerationKind;
  videoUrl: string;
  thumbnailUrl: string;
  duration: number;
  width: number;
  height: number;
  visibility: string;
  mine: boolean;
  liked: boolean;
  user?: { id: string; displayName: string } | null;
  generation: {
    modelId?: string | null;
    id: string;
    mode: GenerationInput['mode'];
    originalPrompt: string;
    enhancedPrompt?: string | null;
    aspectRatio: GenerationInput['aspectRatio'];
    duration: GenerationInput['duration'];
    timingMode: GenerationInput['timingMode'];
    frames?: number | null;
    resolution: GenerationInput['resolution'];
    generateAudio: boolean;
    style: GenerationInput['style'];
    cameraMotion: GenerationInput['cameraMotion'];
    creditCost: number;
    firstFrameAssetId?: string | null;
  };
  publication?: (PublicationSettingsDto & { likesCount: number; viewsCount: number }) | null;
}

const defaultSettings: PublicationSettingsDto = {
  showAuthor: true,
  showPrompt: false,
  allowRemix: true,
  allowDownload: false,
  allowTemplate: false,
};

export default function VideoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t, tError } = useTranslation();
  const toast = useToast();
  const create = useCreateStore();
  const [publishOpen, setPublishOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [settings, setSettings] = useState<PublicationSettingsDto>(defaultSettings);

  const query = useQuery({
    queryKey: ['video', id],
    queryFn: () => apiRequest<{ video: VideoDetail }>(`/videos/${id}`),
  });
  const video = query.data?.video;
  const isPublished = Boolean(video?.publication) && video?.visibility === 'PUBLIC';

  // Переключатели в шторке показывают текущие настройки публикации, а не значения по умолчанию.
  useEffect(() => {
    if (video?.publication) setSettings(video.publication);
  }, [video?.publication]);

  const invalidateLists = () => {
    void queryClient.invalidateQueries({ queryKey: ['generations'] });
    void queryClient.invalidateQueries({ queryKey: ['feed'] });
  };

  const remove = useMutation({
    mutationFn: () => apiRequest(`/videos/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateLists();
      toast.show(t('deleted'));
      router.replace('/(tabs)/library');
    },
    onError: (error) => toast.show(tError(error), 'error'),
  });

  const publish = useMutation({
    mutationFn: () =>
      apiRequest(`/videos/${id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ visibility: 'PUBLIC', ...settings }),
      }),
    onSuccess: () => {
      setPublishOpen(false);
      toast.show(t('publishedToast'));
      void query.refetch();
      invalidateLists();
    },
    onError: (error) => toast.show(tError(error), 'error'),
  });

  const unpublish = useMutation({
    mutationFn: () => apiRequest(`/videos/${id}/unpublish`, { method: 'POST' }),
    onSuccess: () => {
      setPublishOpen(false);
      toast.show(t('unpublishedToast'));
      void query.refetch();
      invalidateLists();
    },
    onError: (error) => toast.show(tError(error), 'error'),
  });

  /** Лайк чужого ролика прямо с экрана просмотра. */
  const like = useMutation({
    mutationFn: () =>
      apiRequest(`/feed/${id}/like`, { method: video?.liked ? 'DELETE' : 'POST' }),
    onSuccess: () => {
      void query.refetch();
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
    onError: (error) => toast.show(tError(error), 'error'),
  });

  const retry = useMutation({
    mutationFn: () =>
      apiRequest<{ generation: { id: string } }>(
        `/generations/${video?.generation.id}/retry`,
        { method: 'POST' },
      ),
    onSuccess: ({ generation }) => {
      setRegenerateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      router.replace({ pathname: '/generation/[id]', params: { id: generation.id } });
    },
    onError: (error) => toast.show(tError(error), 'error'),
  });

  if (query.isError)
    return (
      <KlyvoScreen>
        <KlyvoErrorState
          title={t('offlineTitle')}
          body={t('offlineBody')}
          actionLabel={t('tryAgain')}
          onAction={() => void query.refetch()}
        />
      </KlyvoScreen>
    );
  if (!video)
    return (
      <KlyvoScreen>
        <KlyvoSkeleton height={340} />
        <KlyvoSkeleton height={110} />
      </KlyvoScreen>
    );

  const download = async () => {
    setDownloading(true);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) throw new Error(t('galleryPermission'));
      const directory = FileSystem.cacheDirectory;
      if (!directory) throw new Error(t('genericError'));
      // Расширение должно соответствовать содержимому: картинку с именем .mp4 галерея не примет.
      const extension = video.mediaType === 'IMAGE' ? 'jpg' : 'mp4';
      const downloaded = await FileSystem.downloadAsync(
        video.videoUrl,
        `${directory}klyvo-${video.id}.${extension}`,
      );
      await MediaLibrary.saveToLibraryAsync(downloaded.uri);
      toast.show(t('savedToGallery'));
    } catch (error) {
      toast.show(error instanceof Error ? error.message : t('genericError'), 'error');
    } finally {
      setDownloading(false);
    }
  };

  const shareVideo = async () => {
    try {
      await Share.share({ message: video.videoUrl, url: video.videoUrl });
    } catch {
      toast.show(t('genericError'), 'error');
    }
  };

  const createSimilar = () => {
    const generation = video.generation;
    create.set('mode', generation.mode);
    create.set('prompt', generation.originalPrompt);
    create.set('enhancedPrompt', generation.enhancedPrompt ?? undefined);
    create.set('aspectRatio', generation.aspectRatio);
    create.set('timingMode', generation.timingMode);
    create.set('duration', generation.duration);
    if (generation.frames) create.set('frames', generation.frames);
    create.set('resolution', generation.resolution);
    create.set('generateAudio', generation.generateAudio);
    create.set('buildQuantity', 1);
    create.set('style', generation.style);
    create.set('cameraMotion', generation.cameraMotion);
    // Кадры не переносятся — предупреждаем, вместо того чтобы оставить кнопку серой.
    create.set('firstFrame', undefined);
    create.set('lastFrame', undefined);
    if (generation.mode === 'IMAGE_TO_VIDEO') toast.show(t('similarNeedsFrame'));
    router.push('/(tabs)/create');
  };

  const isImage = video.mediaType === 'IMAGE';
  const mediaRatio = sizeFromAspectRatio(
    video.generation.aspectRatio,
    video.width,
    video.height,
  );
  const durationLabel = isImage
    ? t('imageResult')
    : `${video.duration.toFixed(video.duration % 1 ? 1 : 0)} ${t('seconds')}`;
  const modelLabel = findGenerationModel(video.generation.modelId)?.label ?? t('model');

  return (
    <KlyvoScreen>
      <View style={styles.top}>
        <KlyvoIconButton icon={ChevronLeft} label={t('back')} onPress={() => router.back()} />
        {video.mine ? (
          <View style={[styles.badge, isPublished && styles.badgePublished]}>
            <Text style={[styles.badgeText, isPublished && styles.badgeTextPublished]}>
              {isPublished ? t('publishedBadge') : t('privateBadge')}
            </Text>
          </View>
        ) : (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{t('viewerTitle')}</Text>
          </View>
        )}
        {video.mine ? (
          <KlyvoIconButton icon={Trash2} label={t('delete')} onPress={() => setDeleteOpen(true)} />
        ) : (
          <View style={styles.topSpacer} />
        )}
      </View>

      {/* Чужое видео не может быть «вашим» — заголовок зависит от владельца. */}
      <Text style={styles.title}>
        {video.mine
          ? t('readyTitle')
          : (video.publication?.showAuthor && video.user?.displayName) || t('anonymousAuthor')}
      </Text>

      {/* Формат генерации надёжнее размеров из ответа провайдера — см. sizeFromAspectRatio. */}
      {isImage ? (
        <Pressable onPress={() => setViewerOpen(true)}>
          <Image
            source={{ uri: video.videoUrl }}
            resizeMode="contain"
            style={[styles.image, { aspectRatio: mediaRatio.width / mediaRatio.height }]}
          />
        </Pressable>
      ) : (
        <KlyvoVideoPlayer
          uri={video.videoUrl}
          autoplay
          {...sizeFromAspectRatio(video.generation.aspectRatio, video.width, video.height)}
        />
      )}

      {video.mine ? (
        <View style={styles.primaryActions}>
          <KlyvoButton
            label={downloading ? t('saving') : t('saveToGallery')}
            icon={Download}
            variant="secondary"
            loading={downloading}
            onPress={() => void download()}
          />
          <KlyvoButton
            label={t('share')}
            icon={Share2}
            variant="secondary"
            onPress={() => void shareVideo()}
          />
          <KlyvoButton
            label={isPublished ? t('unpublish') : t('publish')}
            icon={isPublished ? EyeOff : Send}
            onPress={() => setPublishOpen(true)}
          />
        </View>
      ) : (
        <View style={styles.primaryActions}>
          <KlyvoButton
            label={`${video.publication?.likesCount ?? 0}`}
            icon={Heart}
            variant={video.liked ? 'primary' : 'secondary'}
            onPress={() => like.mutate()}
          />
          {video.publication?.allowDownload ? (
            <KlyvoButton
              label={downloading ? t('saving') : t('saveToGallery')}
              icon={Download}
              variant="secondary"
              loading={downloading}
              onPress={() => void download()}
            />
          ) : null}
          <KlyvoButton
            label={t('share')}
            icon={Share2}
            variant="secondary"
            onPress={() => void shareVideo()}
          />
        </View>
      )}

      <KlyvoCard style={styles.promptCard}>
        {video.mine || video.publication?.showPrompt ? (
          <Text numberOfLines={detailsOpen ? undefined : 3} style={styles.prompt}>
            {video.generation.originalPrompt}
          </Text>
        ) : null}
        <View style={styles.chips}>
          {/* Видно, какой моделью сделан ролик. */}
          <KlyvoChip label={modelLabel} icon={Cpu} />
          <KlyvoChip label={video.generation.aspectRatio} />
          <KlyvoChip label={durationLabel} />
          <KlyvoChip label={video.generation.resolution} />
          <KlyvoChip label={video.generation.generateAudio ? t('withSound') : t('withoutSound')} />
        </View>
        {video.mine && isPublished ? (
          <View style={styles.stats}>
            <Text style={styles.statsText}>
              {video.publication?.likesCount ?? 0} {t('likes')}
            </Text>
            <Text style={styles.statsText}>
              {video.publication?.viewsCount ?? 0} {t('views')}
            </Text>
          </View>
        ) : null}
        {video.mine ? (
          <>
            {detailsOpen && video.generation.enhancedPrompt ? (
              <View style={styles.enhancedBlock}>
                <Text style={styles.enhancedLabel}>{t('generatedWith')}: {modelLabel}</Text>
                <Text style={styles.enhanced}>{video.generation.enhancedPrompt}</Text>
              </View>
            ) : null}
            <Pressable onPress={() => setDetailsOpen(!detailsOpen)} style={styles.detailsButton}>
              <Text style={styles.detailsText}>{t('promptAndSettings')}</Text>
              {detailsOpen ? (
                <ChevronUp color={colors.textMuted} size={16} />
              ) : (
                <ChevronDown color={colors.textMuted} size={16} />
              )}
            </Pressable>
          </>
        ) : null}
      </KlyvoCard>

      {video.mine || video.publication?.allowRemix ? (
        <View style={styles.secondaryActions}>
          <KlyvoButton
            fullWidth
            label={t('createSimilar')}
            icon={Copy}
            variant="secondary"
            onPress={createSimilar}
          />
          {video.mine ? (
            <KlyvoButton
              fullWidth
              label={`${t('regenerate')} · ${video.generation.creditCost} ${t('creditsShort')}`}
              icon={RotateCcw}
              variant="ghost"
              onPress={() => setRegenerateOpen(true)}
            />
          ) : null}
        </View>
      ) : null}

      <KlyvoBottomSheet
        visible={publishOpen}
        title={t('publishTitle')}
        onClose={() => setPublishOpen(false)}
      >
        <Text style={styles.sheetBody}>{t('publishBody')}</Text>
        <View>
          <KlyvoToggle
            label={t('showAuthor')}
            value={settings.showAuthor}
            onChange={(showAuthor) => setSettings({ ...settings, showAuthor })}
          />
          <KlyvoToggle
            label={t('showPrompt')}
            value={settings.showPrompt}
            onChange={(showPrompt) => setSettings({ ...settings, showPrompt })}
          />
          <KlyvoToggle
            label={t('allowRemix')}
            value={settings.allowRemix}
            onChange={(allowRemix) => setSettings({ ...settings, allowRemix })}
          />
          <KlyvoToggle
            label={t('allowDownload')}
            value={settings.allowDownload}
            onChange={(allowDownload) => setSettings({ ...settings, allowDownload })}
          />
          <KlyvoToggle
            label={t('allowTemplate')}
            value={settings.allowTemplate}
            onChange={(allowTemplate) => setSettings({ ...settings, allowTemplate })}
          />
        </View>
        <View style={styles.sheetActions}>
          <KlyvoButton
            fullWidth
            label={isPublished ? t('savePublishSettings') : t('publish')}
            icon={Send}
            loading={publish.isPending}
            onPress={() => publish.mutate()}
          />
          {isPublished ? (
            <KlyvoButton
              fullWidth
              label={t('unpublish')}
              icon={EyeOff}
              variant="danger"
              loading={unpublish.isPending}
              onPress={() => unpublish.mutate()}
            />
          ) : null}
        </View>
      </KlyvoBottomSheet>

      <KlyvoConfirm
        visible={deleteOpen}
        destructive
        icon={Trash2}
        title={t('deleteVideoTitle')}
        body={t('deleteVideoBody')}
        confirmLabel={t('deleteForever')}
        cancelLabel={t('cancel')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setDeleteOpen(false)}
      />

      <KlyvoConfirm
        visible={regenerateOpen}
        icon={RotateCcw}
        title={t('regenerateTitle')}
        body={`${t('regenerateBody')} ${video.generation.creditCost} ${t('creditsShort')}`}
        confirmLabel={t('regenerate')}
        cancelLabel={t('cancel')}
        loading={retry.isPending}
        onConfirm={() => retry.mutate()}
        onClose={() => setRegenerateOpen(false)}
      />

      <KlyvoImageViewer
        uri={video.videoUrl}
        visible={isImage && viewerOpen}
        closeLabel={t('close')}
        hintLabel={t('zoomHint')}
        onClose={() => setViewerOpen(false)}
      />
    </KlyvoScreen>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    width: '100%',
  },
  top: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  badge: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  badgePublished: { backgroundColor: colors.text, borderColor: colors.text },
  badgeText: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 11 },
  badgeTextPublished: { color: colors.background },
  title: { color: colors.text, fontFamily: fonts.bold, fontSize: 26, letterSpacing: -0.8 },
  primaryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  promptCard: { gap: spacing.md },
  topSpacer: { width: 42 },
  prompt: { color: colors.text, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  enhancedBlock: { gap: 4 },
  enhancedLabel: { color: colors.textMuted, fontFamily: fonts.semibold, fontSize: 12 },
  enhanced: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  stats: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    paddingTop: spacing.md,
  },
  statsText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  detailsButton: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  detailsText: { color: colors.textMuted, fontFamily: fonts.semibold, fontSize: 13 },
  secondaryActions: { gap: spacing.sm },
  sheetBody: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  sheetActions: { gap: spacing.sm },
});
