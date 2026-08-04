import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, LibraryBig, RotateCcw, Sparkles, X } from 'lucide-react-native';
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
  KlyvoButton,
  KlyvoCard,
  KlyvoChip,
  KlyvoCreditBadge,
  KlyvoErrorState,
  KlyvoIconButton,
  KlyvoScreen,
  useToast,
} from '../../src/components/ui';
import { useTranslation } from '../../src/i18n';
import { colors, fonts, radii, spacing } from '../../src/theme';

const LONG_RUN_SECONDS = 240;

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** Честная «бегущая» полоса: реальный процент нам неизвестен, поэтому мы его и не выдумываем. */
function IndeterminateBar({ done }: { done: boolean }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const shift = useSharedValue(0);
  useEffect(() => {
    if (done || !trackWidth) return;
    shift.value = 0;
    shift.value = withRepeat(
      withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) }),
      -1,
      false,
    );
  }, [done, shift, trackWidth]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: -trackWidth * 0.45 + shift.value * trackWidth * 1.45 }],
  }));
  return (
    <View
      style={styles.progressTrack}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
    >
      {done ? (
        <View style={styles.progressDone} />
      ) : trackWidth ? (
        <Animated.View style={[styles.progressPulse, { width: trackWidth * 0.45 }, style]} />
      ) : null}
    </View>
  );
}

export default function GenerationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t, tError } = useTranslation();
  const toast = useToast();
  const [now, setNow] = useState(() => Date.now());

  const query = useQuery({
    queryKey: ['generation', id],
    queryFn: () => apiRequest<{ generation: GenerationDto }>(`/generations/${id}`),
    refetchInterval: (current) => {
      const status = current.state.data?.generation.status;
      return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELED' ? false : 2000;
    },
  });
  const generation = query.data?.generation;
  const status = generation?.status ?? 'QUEUED';
  const active = status === 'QUEUED' || status === 'PROCESSING';

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  const retry = useMutation({
    mutationFn: () =>
      apiRequest<{ generation: GenerationDto }>(`/generations/${id}/retry`, { method: 'POST' }),
    onSuccess: ({ generation: next }) => {
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      router.replace({ pathname: '/generation/[id]', params: { id: next.id } });
    },
    onError: (error) => toast.show(tError(error), 'error'),
  });
  const cancel = useMutation({
    mutationFn: () => apiRequest(`/generations/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      void query.refetch();
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError: (error) => toast.show(tError(error), 'error'),
  });

  useEffect(() => {
    if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELED') {
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      void queryClient.invalidateQueries({ queryKey: ['generations'] });
    }
  }, [status, queryClient]);

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

  const statusText =
    status === 'QUEUED'
      ? t('queued')
      : status === 'PROCESSING'
        ? t('processing')
        : status === 'COMPLETED'
          ? t('completed')
          : status === 'FAILED'
            ? t('failed')
            : t('canceled');

  const elapsedSeconds = generation
    ? Math.max(0, Math.floor((now - new Date(generation.createdAt).getTime()) / 1000))
    : 0;
  const steps: Array<{ label: string; done: boolean }> = [
    { label: t('stage1'), done: true },
    { label: t('stage2'), done: status === 'PROCESSING' || status === 'COMPLETED' },
    { label: t('stage3'), done: status === 'COMPLETED' },
  ];

  return (
    <KlyvoScreen contentStyle={styles.screen}>
      <View style={styles.top}>
        <KlyvoIconButton icon={ChevronLeft} label={t('back')} onPress={() => router.back()} />
        <KlyvoButton
          label={t('minimize')}
          icon={LibraryBig}
          variant="ghost"
          size="sm"
          onPress={() => router.replace('/(tabs)/library')}
        />
      </View>

      <View style={styles.titleWrap}>
        <Text style={styles.eyebrow}>{t('generationEyebrow')}</Text>
        <Text style={styles.title}>
          {status === 'COMPLETED' ? t('completed') : t('generationTitle')}
        </Text>
      </View>

      <KlyvoCard accent style={styles.preview}>
        <View style={styles.processMark}>
          <Sparkles color={colors.text} size={28} strokeWidth={1.5} />
        </View>
        {active ? (
          <>
            <Text style={styles.elapsed}>{formatElapsed(elapsedSeconds)}</Text>
            <Text style={styles.hint}>
              {elapsedSeconds > LONG_RUN_SECONDS ? t('takingLonger') : t('typicalTime')}
            </Text>
          </>
        ) : null}
        <View style={styles.statusPill}>
          <View style={[styles.statusDot, status === 'FAILED' && styles.statusDotError]} />
          <Text style={styles.statusText}>{statusText}</Text>
        </View>
      </KlyvoCard>

      <IndeterminateBar done={!active} />

      {active ? <Text style={styles.reassure}>{t('keepWorking')}</Text> : null}

      <KlyvoCard style={styles.steps}>
        {steps.map((step) => (
          <View key={step.label} style={styles.step}>
            <View style={[styles.stepIcon, step.done && styles.stepIconDone]}>
              {step.done ? (
                <Check color={colors.background} size={14} />
              ) : (
                <View style={styles.stepDot} />
              )}
            </View>
            <Text style={[styles.stepLabel, step.done && styles.stepLabelDone]}>{step.label}</Text>
          </View>
        ))}
      </KlyvoCard>

      {generation ? (
        <KlyvoCard style={styles.details}>
          <Text numberOfLines={4} style={styles.prompt}>
            {generation.originalPrompt}
          </Text>
          <View style={styles.chips}>
            <KlyvoChip label={generation.aspectRatio} />
            <KlyvoChip
              label={
                generation.timingMode === 'FRAMES' && generation.frames
                  ? `${generation.frames} ${t('lengthFrames').toLowerCase()}`
                  : `${generation.duration} ${t('seconds')}`
              }
            />
            <KlyvoChip label={generation.resolution} />
          </View>
          <View style={styles.reserved}>
            <Text style={styles.reservedLabel}>{t('reserved')}</Text>
            <KlyvoCreditBadge amount={generation.creditCost} label={t('creditsShort')} />
          </View>
        </KlyvoCard>
      ) : null}

      {status === 'COMPLETED' && generation?.video ? (
        <KlyvoButton
          fullWidth
          size="lg"
          label={t('viewResult')}
          icon={Check}
          onPress={() =>
            router.replace({ pathname: '/video/[id]', params: { id: generation.video?.id ?? '' } })
          }
        />
      ) : null}

      {status === 'FAILED' || status === 'CANCELED' ? (
        <View style={styles.failure}>
          {generation?.errorMessage ? (
            <>
              <Text style={styles.failureText}>{tError({ code: generation.errorCode })}</Text>
              {/*
                Ответ провайдера показывается как есть: без него причина отказа
                видна только в логах сервера, а пользователь может лишь гадать,
                что именно не понравилось модели.
              */}
              <Text style={styles.failureDetail} selectable>
                {generation.errorMessage}
              </Text>
            </>
          ) : null}
          <KlyvoButton
            fullWidth
            label={`${t('retry')}${generation ? ` · ${generation.creditCost} ${t('creditsShort')}` : ''}`}
            icon={RotateCcw}
            loading={retry.isPending}
            onPress={() => retry.mutate()}
          />
        </View>
      ) : null}

      {active ? (
        <KlyvoButton
          label={t('cancelGeneration')}
          icon={X}
          variant="ghost"
          loading={cancel.isPending}
          onPress={() => cancel.mutate()}
        />
      ) : null}
    </KlyvoScreen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingBottom: spacing.xxl },
  top: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  titleWrap: { gap: spacing.sm },
  eyebrow: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 13 },
  title: { color: colors.text, fontFamily: fonts.bold, fontSize: 28, letterSpacing: -0.8 },
  preview: {
    alignItems: 'center',
    gap: spacing.md,
    justifyContent: 'center',
    minHeight: 240,
    overflow: 'hidden',
  },
  processMark: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  elapsed: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 34,
    letterSpacing: -1.2,
  },
  hint: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 13, textAlign: 'center' },
  statusPill: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  statusDot: { backgroundColor: colors.text, borderRadius: 4, height: 7, width: 7 },
  statusDotError: { backgroundColor: colors.error },
  statusText: { color: colors.text, fontFamily: fonts.bold, fontSize: 12 },
  progressTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 3,
    height: 5,
    overflow: 'hidden',
  },
  progressPulse: { backgroundColor: colors.text, height: '100%' },
  progressDone: { backgroundColor: colors.text, height: '100%', width: '100%' },
  reassure: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 13, textAlign: 'center' },
  steps: { gap: 0 },
  step: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: 50 },
  stepIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.pill,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  stepIconDone: { backgroundColor: colors.text },
  stepDot: { backgroundColor: colors.borderStrong, borderRadius: 4, height: 8, width: 8 },
  stepLabel: { color: colors.textMuted, fontFamily: fonts.semibold, fontSize: 14 },
  stepLabelDone: { color: colors.text },
  details: { gap: spacing.md },
  prompt: { color: colors.text, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  reserved: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  reservedLabel: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 12 },
  failure: { gap: spacing.md },
  failureText: { color: colors.error, fontFamily: fonts.medium, fontSize: 13, textAlign: 'center' },
  failureDetail: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
});
