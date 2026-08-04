import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Coins,
  Cpu,
  Info,
  ImagePlus,
  Languages,
  Minus,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react-native';
import {
  describeGenerationCost,
  modeIsImageInput,
  type GenerationKind,
  type GenerationMode,
  type GenerationModelInfo,
  type Resolution,
  type TimingMode,
  type WalletDto,
} from '@klyvo/shared';

interface ModelInfo extends GenerationModelInfo {
  connected: boolean;
  available: boolean;
  modes: GenerationMode[];
}
interface ModelsResponse {
  defaultModelId: string;
  models: ModelInfo[];
}

import { apiRequest } from '../../src/api/client';
import {
  KlyvoBottomSheet,
  KlyvoButton,
  KlyvoCard,
  KlyvoChip,
  KlyvoCreditBadge,
  KlyvoIconButton,
  KlyvoSegmentedControl,
  KlyvoTextArea,
  ScreenHeader,
  useToast,
} from '../../src/components/ui';
import { useTranslation, type Translate } from '../../src/i18n';
import { useCreateStore, type ReferenceAsset } from '../../src/state/create';
import { colors, fonts, radii, spacing } from '../../src/theme';

const MAX_FRAME_BYTES = 50 * 1024 * 1024;

/**
 * Режим под выбранную модель. Загруженный кадр — это осознанный выбор
 * пользователя, поэтому при смене модели он сохраняется, если модель его умеет.
 */
function modeForModel(model: ModelInfo, wantsSourceImage: boolean): GenerationMode {
  const modes = model.modes;
  const withImage = modes.find((mode) => modeIsImageInput(mode));
  const withoutImage = modes.find((mode) => !modeIsImageInput(mode));
  if (wantsSourceImage && withImage) return withImage;
  // Модель без единого режима в реестр не попадает, но тип этого не знает.
  return withoutImage ?? withImage ?? modes[0] ?? 'TEXT_TO_VIDEO';
}

/** Ближайшее допустимое значение из тех, что принимает модель. */
function nearest(values: readonly number[], value: number) {
  if (values.includes(value)) return value;
  return values.reduce(
    (best, item) => (Math.abs(item - value) < Math.abs(best - value) ? item : best),
    values[0] ?? value,
  );
}

function OptionGroup<T extends string | number>({
  title,
  hint,
  value,
  options,
  onChange,
}: {
  title: string;
  hint?: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.optionGroup}>
      <View style={styles.optionHeading}>
        <Text style={styles.label}>{title}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <View style={styles.wrap}>
        {options.map((option) => (
          <KlyvoChip
            key={option.value}
            label={option.label}
            selected={option.value === value}
            disabled={option.disabled}
            onPress={() => onChange(option.value)}
          />
        ))}
      </View>
    </View>
  );
}

function FramePicker({
  title,
  optional,
  asset,
  disabled,
  t,
  onPick,
  onRemove,
}: {
  title: string;
  optional?: boolean;
  asset?: ReferenceAsset;
  disabled?: boolean;
  t: Translate;
  onPick: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.frameColumn}>
      <View style={styles.frameLabelRow}>
        <Text style={styles.label}>{title}</Text>
        {optional ? <Text style={styles.hint}>{t('optional')}</Text> : null}
      </View>
      {asset ? (
        <View style={styles.framePreview}>
          <Image source={{ uri: asset.uri }} style={StyleSheet.absoluteFill} />
          <KlyvoIconButton
            icon={Trash2}
            label={t('removeFrame')}
            size={36}
            onPress={onRemove}
            style={styles.removeFrame}
          />
        </View>
      ) : (
        <Pressable
          disabled={disabled}
          onPress={onPick}
          style={({ pressed }) => [
            styles.frameUpload,
            disabled && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <ImagePlus color={colors.textMuted} size={22} />
          <Text style={styles.frameUploadText}>{t('upload')}</Text>
          <Text style={styles.hint}>{t('uploadFormats')}</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function CreateScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t, tError } = useTranslation();
  const state = useCreateStore();
  const [costOpen, setCostOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const wallet = useQuery({
    queryKey: ['wallet'],
    queryFn: () => apiRequest<WalletDto>('/wallet'),
  });
  const cost = describeGenerationCost({
    mode: state.mode,
    modelId: state.modelId,
    timingMode: state.timingMode,
    duration: state.duration,
    frames: state.frames,
    resolution: state.resolution,
    buildQuantity: state.buildQuantity,
    generateAudio: state.generateAudio,
  });
  const available = wallet.data?.availableBalance ?? 0;
  const detectedLanguage = useMemo(
    () => (/[әіңғүұқөһ]/iu.test(state.prompt) ? 'KK' : /[а-яё]/iu.test(state.prompt) ? 'RU' : 'EN'),
    [state.prompt],
  );

  /**
   * Список моделей и признак «подключена сейчас» приходят с сервера,
   * чтобы пользователь видел, чем именно он генерирует.
   */
  const models = useQuery({
    queryKey: ['models'],
    queryFn: () => apiRequest<ModelsResponse>('/models'),
  });
  const activeModel =
    models.data?.models.find((model) => model.id === state.modelId) ?? models.data?.models[0];
  // Картинка — это другой набор настроек: длительности, звука и камеры у неё нет.
  const isImage = activeModel?.kind === 'IMAGE';
  const kind: GenerationKind = isImage ? 'IMAGE' : 'VIDEO';
  /**
   * Выбор «видео или картинка» стоит выше выбора модели: модели для роликов и
   * для картинок не взаимозаменяемы, и показывать их одним списком — значит
   * предлагать заведомо неподходящий вариант.
   */
  const modelsForKind = (models.data?.models ?? []).filter((model) => model.kind === kind);
  const aspectOptions = activeModel?.aspectRatios ?? ['9:16'];
  const resolutionOptions = activeModel?.resolutions ?? ['720p'];
  const durationOptions = activeModel?.durations ?? [5];
  const framesSupported = (models.data?.models ?? []).some((model) => model.supportsFrames);
  /** Качество у картинки — это уровень детализации у модели, а не разрешение видео. */
  const imageQualityLabels: Record<string, string> = {
    '480p': t('imageQualityLow'),
    '720p': t('imageQualityMedium'),
    '1080p': t('imageQualityHigh'),
  };

  const generate = useMutation({
    mutationFn: () =>
      apiRequest<{ generations: Array<{ id: string }> }>('/generations', {
        method: 'POST',
        body: JSON.stringify({
          mode: state.mode,
          modelId: state.modelId,
          prompt: state.prompt,
          firstFrameAssetId: state.firstFrame?.id,
          lastFrameAssetId: state.lastFrame?.id,
          aspectRatio: state.aspectRatio,
          timingMode: state.timingMode,
          duration: state.duration,
          frames: state.timingMode === 'FRAMES' ? state.frames : undefined,
          resolution: state.resolution,
          buildQuantity: state.buildQuantity,
          generateAudio: state.generateAudio,
          style: state.style,
          cameraMotion: state.cameraMotion,
        }),
      }),
    onSuccess: ({ generations }) => {
      state.markSubmitted(generations.map(({ id }) => id));
      void queryClient.invalidateQueries({ queryKey: ['generations'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      toast.show(generations.length > 1 ? t('sentMany') : t('sentOne'));
      const first = generations[0];
      if (generations.length === 1 && first) {
        router.push({ pathname: '/generation/[id]', params: { id: first.id } });
      } else {
        router.push('/(tabs)/library');
      }
    },
    onError: (error) => toast.show(tError(error), 'error'),
  });

  const pickFrame = async (target: 'firstFrame' | 'lastFrame') => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.92,
      allowsEditing: false,
    });
    const selected = result.assets?.[0];
    if (result.canceled || !selected) return;
    // Проверяем размер до отправки, чтобы не ждать ответа сервера ради ошибки.
    if (selected.fileSize && selected.fileSize > MAX_FRAME_BYTES) {
      toast.show(t('frameTooLarge'), 'error');
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', {
        uri: selected.uri,
        name: selected.fileName ?? `${target}.jpg`,
        type: selected.mimeType ?? 'image/jpeg',
      } as unknown as Blob);
      const response = await apiRequest<{ asset: { id: string; mimeType: string } }>('/uploads', {
        method: 'POST',
        body,
        timeoutMs: 60_000,
      });
      state.set(target, {
        id: response.asset.id,
        uri: selected.uri,
        mimeType: response.asset.mimeType,
      });
      if (activeModel) state.set('mode', modeForModel(activeModel, true));
    } catch (error) {
      toast.show(tError(error), 'error');
    } finally {
      setUploading(false);
    }
  };

  /**
   * Смена модели подстраивает параметры под её возможности.
   *
   * Модели различаются сильнее, чем раньше: у Kling 3 всего три формата кадра и
   * фиксированное качество, у GPT Image 2 нет ни длительности, ни звука. Поэтому
   * несовместимые значения не «остаются висеть», а сразу заменяются ближайшими
   * допустимыми — иначе запрос ушёл бы на сервер и вернулся ошибкой валидации.
   */
  const selectModel = (model: ModelInfo) => {
    state.set('modelId', model.id);
    state.set('mode', modeForModel(model, Boolean(state.firstFrame)));
    if (!model.supportsAudio) state.set('generateAudio', false);
    if (!model.supportsFrames && state.timingMode === 'FRAMES') state.set('timingMode', 'DURATION');
    if (!model.supportsLastFrame) state.set('lastFrame', undefined);
    const aspectRatio = model.aspectRatios[0];
    if (aspectRatio && !model.aspectRatios.includes(state.aspectRatio)) {
      state.set('aspectRatio', aspectRatio);
    }
    const resolution = model.resolutions[0];
    if (resolution && !model.resolutions.includes(state.resolution)) {
      state.set('resolution', resolution);
    }
    if (model.durations.length) state.set('duration', nearest(model.durations, state.duration));
    setModelOpen(false);
  };

  /** Переключение между роликами и картинками — это смена модели на подходящую. */
  const selectKind = (next: GenerationKind) => {
    if (next === kind) return;
    const target = (models.data?.models ?? []).find((model) => model.kind === next);
    if (target) selectModel(target);
  };

  const setTimingMode = (mode: TimingMode) => {
    state.set('timingMode', mode);
    // Точные кадры умеет только модель с их поддержкой — переключаемся на неё автоматически.
    if (mode === 'FRAMES') {
      state.set('generateAudio', false);
      const framesModel = models.data?.models.find((model) => model.supportsFrames);
      if (framesModel) state.set('modelId', framesModel.id);
    }
  };
  const setFrames = (frames: number, notify = false) => {
    const clamped = Math.max(29, Math.min(289, frames));
    const snapped = 25 + Math.round((clamped - 25) / 4) * 4;
    if (notify && snapped !== frames) toast.show(t('framesRounded'));
    state.set('frames', snapped);
  };

  const promptReady = state.prompt.trim().length >= 3;
  const frameReady = !modeIsImageInput(state.mode) || Boolean(state.firstFrame);
  const enoughCredits = available >= cost.total;
  const canGenerate = promptReady && frameReady && enoughCredits;
  // Кнопка больше не «просто серая»: всегда видно, чего именно не хватает.
  const blockingReason = !promptReady
    ? t('needPrompt')
    : !frameReady
      ? t('needFirstFrame')
      : !enoughCredits
        ? t('needCredits')
        : undefined;

  const styleOptions = [
    ['CINEMATIC', t('styleCinematic')],
    ['REALISTIC', t('styleRealistic')],
    ['ADVERTISING', t('styleAdvertising')],
    ['ANIME', t('styleAnime')],
    ['FANTASY', t('styleFantasy')],
    ['MINIMAL', t('styleMinimal')],
    ['NONE', t('styleNone')],
  ] as const;
  const cameraOptions = [
    ['AUTO', t('cameraAuto')],
    ['ZOOM_IN', t('cameraZoomIn')],
    ['ZOOM_OUT', t('cameraZoomOut')],
    ['PAN', t('cameraPan')],
    ['FOLLOW', t('cameraFollow')],
    ['STATIC', t('cameraStatic')],
    ['DRONE', t('cameraDrone')],
  ] as const;

  return (
    <View style={styles.screen}>
      <SafeAreaView edges={['top']} style={styles.flex}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <ScreenHeader
            eyebrow={activeModel ? `${activeModel.label} · ${activeModel.provider}` : undefined}
            title={t('createTitle')}
            action={<KlyvoCreditBadge amount={available} />}
          />

          <KlyvoSegmentedControl
            value={kind}
            options={[
              { value: 'VIDEO' as const, label: t('kindVideoTab') },
              { value: 'IMAGE' as const, label: t('kindImageTab') },
            ]}
            onChange={selectKind}
          />

          {/* Пользователь всегда видит, какой моделью генерирует, и может её сменить. */}
          <Pressable
            onPress={() => setModelOpen(true)}
            style={({ pressed }) => [styles.modelRow, pressed && styles.pressed]}
          >
            <View style={styles.modelIcon}>
              <Cpu color={colors.textMuted} size={19} />
            </View>
            <View style={styles.modelCopy}>
              <Text style={styles.hint}>{t('model')}</Text>
              <Text style={styles.modelName}>{activeModel?.label ?? '—'}</Text>
              <Text style={styles.hint}>
                {activeModel
                  ? activeModel.connected
                    ? t('modelConnected')
                    : t('modelMock')
                  : ''}
              </Text>
            </View>
            <ChevronDown color={colors.textMuted} size={18} />
          </Pressable>

          {state.lastSubmittedPrompt ? (
            <KlyvoCard style={styles.submittedCard}>
              <View style={styles.submittedCopy}>
                <Text style={styles.submittedTitle}>{t('submittedTitle')}</Text>
                <Text numberOfLines={2} style={styles.submittedText}>
                  {state.lastSubmittedPrompt}
                </Text>
              </View>
              <KlyvoIconButton
                icon={X}
                label={t('submittedDismiss')}
                size={32}
                onPress={state.clearSubmitted}
              />
            </KlyvoCard>
          ) : null}

          <KlyvoSegmentedControl
            value={state.mode}
            options={
              isImage
                ? [
                    { value: 'TEXT_TO_IMAGE' as const, label: t('modeText') },
                    { value: 'IMAGE_TO_IMAGE' as const, label: t('modeImage') },
                  ]
                : [
                    { value: 'TEXT_TO_VIDEO' as const, label: t('modeText') },
                    { value: 'IMAGE_TO_VIDEO' as const, label: t('modeImage') },
                  ]
            }
            onChange={(mode) => state.set('mode', mode)}
          />

          <KlyvoCard style={styles.promptCard} accent>
            <View style={styles.rowBetween}>
              <Text style={styles.label}>{t('describeScene')}</Text>
              <Text style={styles.hint}>{state.prompt.length} / 2000</Text>
            </View>
            <KlyvoTextArea
              value={state.prompt}
              maxLength={2000}
              placeholder={t('promptPlaceholder')}
              onChangeText={(value) => {
                state.set('prompt', value);
                state.set('enhancedPrompt', undefined);
              }}
            />
            {/* Перевод делается автоматически на сервере — кнопки для этого больше нет. */}
            <View style={styles.promptActions}>
              <Languages color={colors.textMuted} size={15} />
              <Text style={styles.translateNote}>
                {t('promptLanguage')}: {detectedLanguage} · {t('autoTranslateNote')}
              </Text>
            </View>
          </KlyvoCard>

          {modeIsImageInput(state.mode) ? (
            <View style={styles.framesRow}>
              <FramePicker
                title={isImage ? t('sourceImage') : t('firstFrame')}
                asset={state.firstFrame}
                disabled={uploading}
                t={t}
                onPick={() => void pickFrame('firstFrame')}
                onRemove={() => {
                  state.set('firstFrame', undefined);
                  state.set('lastFrame', undefined);
                }}
              />
              {activeModel?.supportsLastFrame ? (
                <FramePicker
                  title={t('lastFrame')}
                  optional
                  disabled={!state.firstFrame || uploading}
                  asset={state.lastFrame}
                  t={t}
                  onPick={() => void pickFrame('lastFrame')}
                  onRemove={() => state.set('lastFrame', undefined)}
                />
              ) : null}
            </View>
          ) : null}

          <OptionGroup
            title={t('format')}
            value={state.aspectRatio}
            options={aspectOptions.map((value) => ({
              value,
              label: value === 'SMART' ? 'Smart' : value,
            }))}
            onChange={(value) => state.set('aspectRatio', value)}
          />

          {!isImage && state.timingMode === 'DURATION' ? (
            <OptionGroup
              title={t('duration')}
              hint={t('lengthSecondsHint')}
              value={state.duration}
              options={durationOptions.map((value) => ({
                value,
                label: `${value} ${t('seconds')}`,
              }))}
              onChange={(value) => state.set('duration', value)}
            />
          ) : null}

          <OptionGroup
            title={t('quality')}
            value={state.resolution}
            options={resolutionOptions.map((value: Resolution) => ({
              value,
              label: isImage ? (imageQualityLabels[value] ?? value) : value,
            }))}
            onChange={(value) => state.set('resolution', value)}
          />

          {!isImage && activeModel?.supportsAudio !== false ? (
            <OptionGroup
              title={t('sound')}
              hint={
                state.timingMode === 'FRAMES' ? t('soundUnavailable') : `×2 ${t('cost').toLowerCase()}`
              }
              value={state.generateAudio ? 'OPEN' : 'CLOSE'}
              options={[
                {
                  value: 'OPEN',
                  label: t('soundOn'),
                  disabled: state.timingMode === 'FRAMES',
                },
                { value: 'CLOSE', label: t('soundOff') },
              ]}
              onChange={(value) => state.set('generateAudio', value === 'OPEN')}
            />
          ) : null}

          <Pressable
            onPress={() => setAdvancedOpen(!advancedOpen)}
            style={({ pressed }) => [styles.advancedToggle, pressed && styles.pressed]}
          >
            <Text style={styles.advancedText}>
              {advancedOpen ? t('advancedHide') : t('advancedShow')}
            </Text>
            {advancedOpen ? (
              <ChevronUp color={colors.textMuted} size={18} />
            ) : (
              <ChevronDown color={colors.textMuted} size={18} />
            )}
          </Pressable>

          {advancedOpen ? (
            <>
              {/* Точное число кадров сейчас не умеет ни одна подключённая модель. */}
              {framesSupported && !isImage ? (
                <OptionGroup
                  title={t('lengthControl')}
                  hint={
                    state.timingMode === 'FRAMES' ? t('lengthFramesHint') : t('lengthSecondsHint')
                  }
                  value={state.timingMode}
                  options={[
                    { value: 'DURATION', label: t('lengthSeconds') },
                    { value: 'FRAMES', label: t('lengthFrames') },
                  ]}
                  onChange={setTimingMode}
                />
              ) : null}

              {state.timingMode === 'FRAMES' ? (
                <KlyvoCard style={styles.framesControl}>
                  <View style={styles.framesTop}>
                    <View style={styles.flexShrink}>
                      <Text style={styles.label}>{t('framesTitle')}</Text>
                      <Text style={styles.hint}>
                        {t('framesHint')} · ≈ {(state.frames / 24).toFixed(2)} {t('seconds')}
                      </Text>
                    </View>
                    <View style={styles.stepper}>
                      <KlyvoIconButton
                        icon={Minus}
                        label={t('minusFourFrames')}
                        disabled={state.frames <= 29}
                        onPress={() => setFrames(state.frames - 4)}
                      />
                      <TextInput
                        keyboardType="number-pad"
                        defaultValue={String(state.frames)}
                        key={state.frames}
                        onEndEditing={(event) => {
                          const parsed = Number(event.nativeEvent.text);
                          if (Number.isFinite(parsed) && parsed > 0) setFrames(parsed, true);
                        }}
                        style={styles.framesInput}
                      />
                      <KlyvoIconButton
                        icon={Plus}
                        label={t('plusFourFrames')}
                        disabled={state.frames >= 289}
                        onPress={() => setFrames(state.frames + 4)}
                      />
                    </View>
                  </View>
                  <View style={styles.wrap}>
                    {[29, 73, 121, 169, 217, 241, 289].map((value) => (
                      <KlyvoChip
                        key={value}
                        label={String(value)}
                        selected={state.frames === value}
                        onPress={() => setFrames(value)}
                      />
                    ))}
                  </View>
                  <Text style={styles.modelNote}>{t('framesNote')}</Text>
                </KlyvoCard>
              ) : null}

              <OptionGroup
                title={t('quantity')}
                hint={t('quantityHint')}
                value={state.buildQuantity}
                options={[1, 2, 3, 4, 5, 6, 7, 8].map((value) => ({ value, label: String(value) }))}
                onChange={(value) => state.set('buildQuantity', value)}
              />

              <OptionGroup
                title={t('style')}
                value={state.style}
                options={styleOptions.map(([value, label]) => ({ value, label }))}
                onChange={(value) => state.set('style', value)}
              />

              {!isImage ? (
                <OptionGroup
                  title={t('camera')}
                  value={state.cameraMotion}
                  options={cameraOptions.map(([value, label]) => ({ value, label }))}
                  onChange={(value) => state.set('cameraMotion', value)}
                />
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      {/* Панель всегда на экране — до неё больше не нужно листать всю простыню настроек. */}
      <View style={styles.dock}>
        {blockingReason ? <Text style={styles.blocking}>{blockingReason}</Text> : null}
        <View style={styles.dockRow}>
          <Pressable onPress={() => setCostOpen(true)} style={styles.dockCost}>
            <View style={styles.costRow}>
              <Text style={styles.cost}>{cost.total}</Text>
              <Text style={styles.hint}>{t('creditsShort')}</Text>
              <Info color={colors.textMuted} size={14} />
            </View>
            <Text style={styles.hint}>
              {cost.quantity > 1
                ? `${cost.quantity} × ${cost.perVideo} ${t('creditsShort')}`
                : isImage
                  ? `${t('imageResult')} · ${imageQualityLabels[state.resolution] ?? state.resolution}`
                  : `${cost.seconds.toFixed(cost.seconds % 1 ? 1 : 0)} ${t('seconds')} · ${state.resolution}`}
            </Text>
          </Pressable>
          {enoughCredits ? (
            <KlyvoButton
              label={generate.isPending ? t('generating') : t('generate')}
              icon={Sparkles}
              size="lg"
              loading={generate.isPending}
              disabled={!canGenerate}
              onPress={() => generate.mutate()}
            />
          ) : (
            <KlyvoButton
              label={t('topUp')}
              icon={Coins}
              size="lg"
              onPress={() => router.push('/shop')}
            />
          )}
        </View>
      </View>

      <KlyvoBottomSheet visible={costOpen} title={t('cost')} onClose={() => setCostOpen(false)}>
        <View style={styles.breakdown}>
          <CostRow
            label={
              isImage
                ? `${t('costBase')} · ${imageQualityLabels[state.resolution] ?? state.resolution}`
                : `${t('costBase')} · ${cost.seconds.toFixed(cost.seconds % 1 ? 2 : 0)} ${t('seconds')} · ${state.resolution}`
            }
            value={`${cost.baseCost}`}
          />
          {cost.audioCost ? (
            <CostRow label={t('costAudio')} value={`+${cost.audioCost}`} />
          ) : null}
          {cost.modeCost ? <CostRow label={t('costFrames')} value={`+${cost.modeCost}`} /> : null}
          <CostRow label={t('costPerVideo')} value={`${cost.perVideo}`} />
          {cost.quantity > 1 ? (
            <CostRow label={t('costQuantity')} value={`× ${cost.quantity}`} />
          ) : null}
          <CostRow label={t('costTotal')} value={`${cost.total} ${t('creditsShort')}`} strong />
        </View>
        <KlyvoButton fullWidth label={t('close')} variant="secondary" onPress={() => setCostOpen(false)} />
      </KlyvoBottomSheet>

      <KlyvoBottomSheet
        visible={modelOpen}
        title={t('modelPickerTitle')}
        onClose={() => setModelOpen(false)}
      >
        <View style={styles.modelList}>
          {modelsForKind.map((model) => {
            const selected = model.id === state.modelId;
            return (
              <Pressable
                key={model.id}
                onPress={() => selectModel(model)}
                style={({ pressed }) => [
                  styles.modelOption,
                  selected && styles.modelOptionActive,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.modelOptionTop}>
                  <Text style={styles.modelName}>{model.label}</Text>
                  {selected ? <Check color={colors.text} size={17} /> : null}
                </View>
                <Text style={styles.hint}>{model.description}</Text>
                <View style={styles.wrap}>
                  <KlyvoChip label={model.connected ? t('modelConnected') : t('modelMock')} />
                  {model.kind === 'VIDEO' ? (
                    <KlyvoChip label={model.resolutions.join(' · ')} />
                  ) : null}
                  {!model.supportsAudio && model.kind === 'VIDEO' ? (
                    <KlyvoChip label={t('modelAudioNo')} />
                  ) : null}
                  {model.supportsFrames ? <KlyvoChip label={t('modelFramesYes')} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>{t('autoTranslateNote')}</Text>
      </KlyvoBottomSheet>
    </View>
  );
}

function CostRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={[styles.costLine, strong && styles.costLineStrong]}>
      <Text style={[styles.costLabel, strong && styles.costLabelStrong]}>{label}</Text>
      <Text style={[styles.costValue, strong && styles.costLabelStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  content: {
    gap: spacing.xl,
    paddingBottom: 150,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  optionGroup: { gap: spacing.md },
  optionHeading: { alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  label: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  hint: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rowBetween: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  promptCard: { gap: spacing.md },
  promptActions: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  translateNote: {
    color: colors.textMuted,
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 17,
  },
  modelRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 68,
    paddingHorizontal: spacing.md,
  },
  modelIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.md,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  modelCopy: { flex: 1, gap: 2 },
  modelName: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  modelList: { gap: spacing.sm },
  modelOption: {
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  modelOptionActive: { borderColor: colors.text },
  modelOptionTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  enhanced: {
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  enhancedCopy: { flex: 1, gap: 6 },
  enhancedLabel: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  enhancedText: { color: colors.text, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  submittedCard: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  submittedCopy: { flex: 1, gap: 3 },
  submittedTitle: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14 },
  submittedText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  framesRow: { flexDirection: 'row', gap: spacing.md },
  frameColumn: { flex: 1, gap: spacing.sm },
  frameLabelRow: { alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  framePreview: {
    aspectRatio: 0.84,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  removeFrame: { position: 'absolute', right: spacing.sm, top: spacing.sm },
  frameUpload: {
    alignItems: 'center',
    aspectRatio: 0.84,
    borderColor: colors.borderStrong,
    borderRadius: radii.lg,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 6,
    justifyContent: 'center',
  },
  frameUploadText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 13 },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.75 },
  framesControl: { gap: spacing.lg },
  framesTop: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' },
  stepper: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  framesInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 16,
    height: 42,
    textAlign: 'center',
    width: 64,
  },
  modelNote: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  advancedToggle: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  advancedText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14 },
  dock: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    bottom: 0,
    gap: spacing.sm,
    left: 0,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    position: 'absolute',
    right: 0,
  },
  dockRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.lg, justifyContent: 'space-between' },
  dockCost: { flex: 1, gap: 2 },
  costRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  cost: { color: colors.text, fontFamily: fonts.bold, fontSize: 26, letterSpacing: -0.8 },
  blocking: { color: colors.warning, fontFamily: fonts.semibold, fontSize: 12 },
  breakdown: { gap: 0 },
  costLine: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    minHeight: 44,
  },
  costLineStrong: { borderBottomWidth: 0 },
  costLabel: { color: colors.textMuted, flex: 1, fontFamily: fonts.medium, fontSize: 13 },
  costValue: { color: colors.text, fontFamily: fonts.semibold, fontSize: 13 },
  costLabelStrong: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  sheetActions: { gap: spacing.sm },
});
