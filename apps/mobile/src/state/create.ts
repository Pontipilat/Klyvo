import { create } from 'zustand';
import { defaultVideoModelId, generationModels, modeIsImageInput } from '@klyvo/shared';
import type {
  AspectRatio,
  CameraMotion,
  GenerationKind,
  GenerationMode,
  GenerationModelInfo,
  Resolution,
  TimingMode,
  VisualStyle,
} from '@klyvo/shared';

export interface ReferenceAsset {
  id: string;
  uri: string;
  mimeType: string;
}

interface CreateState {
  /**
   * Ролики или картинки. Хранится отдельно от модели, потому что от этого выбора
   * зависит не только экран создания, но и лента: смешивать в ней видео и картинки
   * незачем, а список моделей к моменту открытия ленты может быть ещё не загружен.
   */
  kind: GenerationKind;
  mode: GenerationMode;
  modelId: string;
  prompt: string;
  enhancedPrompt?: string;
  firstFrame?: ReferenceAsset;
  lastFrame?: ReferenceAsset;
  aspectRatio: AspectRatio;
  timingMode: TimingMode;
  duration: number;
  frames: number;
  resolution: Resolution;
  buildQuantity: number;
  generateAudio: boolean;
  style: VisualStyle;
  cameraMotion: CameraMotion;
  lastSubmittedPrompt?: string;
  lastSubmittedAt?: number;
  lastBatchIds: string[];
  set: <K extends keyof Omit<CreateState, 'set' | 'reset' | 'markSubmitted' | 'clearSubmitted'>>(
    key: K,
    value: CreateState[K],
  ) => void;
  /** Выбрать модель и подтянуть под её возможности всё остальное. */
  applyModel: (model: GenerationModelInfo) => void;
  /** Переключиться между роликами и картинками. */
  setKind: (kind: GenerationKind) => void;
  markSubmitted: (generationIds: string[]) => void;
  clearSubmitted: () => void;
  reset: () => void;
}

/**
 * Режим под модель. Загруженный кадр — осознанный выбор пользователя,
 * поэтому при смене модели он сохраняется, если модель его принимает.
 */
function modeForModel(model: GenerationModelInfo, wantsSourceImage: boolean): GenerationMode {
  const modes = Object.keys(model.endpoints) as GenerationMode[];
  const withImage = modes.find((mode) => modeIsImageInput(mode));
  const withoutImage = modes.find((mode) => !modeIsImageInput(mode));
  if (wantsSourceImage && withImage) return withImage;
  return withoutImage ?? withImage ?? 'TEXT_TO_VIDEO';
}

/** Ближайшее допустимое значение из тех, что принимает модель. */
function nearest(values: readonly number[], value: number) {
  if (values.includes(value)) return value;
  return values.reduce(
    (best, item) => (Math.abs(item - value) < Math.abs(best - value) ? item : best),
    values[0] ?? value,
  );
}

/**
 * Приводит параметры к возможностям модели.
 *
 * Модели различаются сильно: у Kling 3 три формата кадра и одно качество, у
 * GPT Image 2 нет ни длительности, ни звука. Несовместимые значения не должны
 * оставаться выбранными — иначе запрос уйдёт на сервер и вернётся ошибкой.
 */
function stateForModel(state: CreateState, model: GenerationModelInfo): Partial<CreateState> {
  return {
    modelId: model.id,
    kind: model.kind,
    mode: modeForModel(model, Boolean(state.firstFrame)),
    generateAudio: model.supportsAudio ? state.generateAudio : false,
    timingMode: model.supportsFrames ? state.timingMode : 'DURATION',
    lastFrame: model.supportsLastFrame ? state.lastFrame : undefined,
    aspectRatio: model.aspectRatios.includes(state.aspectRatio)
      ? state.aspectRatio
      : (model.aspectRatios[0] ?? state.aspectRatio),
    resolution: model.resolutions.includes(state.resolution)
      ? state.resolution
      : (model.resolutions[0] ?? state.resolution),
    duration: model.durations.length ? nearest(model.durations, state.duration) : state.duration,
  };
}

const initial = {
  kind: 'VIDEO' as const,
  mode: 'TEXT_TO_VIDEO' as const,
  modelId: defaultVideoModelId as string,
  prompt: '',
  enhancedPrompt: undefined,
  firstFrame: undefined,
  lastFrame: undefined,
  aspectRatio: '9:16' as const,
  timingMode: 'DURATION' as const,
  duration: 5,
  frames: 121,
  resolution: '720p' as const,
  buildQuantity: 1,
  generateAudio: true,
  style: 'CINEMATIC' as const,
  cameraMotion: 'AUTO' as const,
  lastSubmittedPrompt: undefined,
  lastSubmittedAt: undefined,
  lastBatchIds: [] as string[],
};

export const useCreateStore = create<CreateState>((set) => ({
  ...initial,
  set: (key, value) => set({ [key]: value }),
  applyModel: (model) => set((state) => stateForModel(state, model)),
  setKind: (kind) =>
    set((state) => {
      if (state.kind === kind) return state;
      const model = generationModels.find((item) => item.kind === kind);
      return model ? stateForModel(state, model) : state;
    }),
  markSubmitted: (generationIds) =>
    set((state) => ({
      lastSubmittedPrompt: state.prompt,
      lastSubmittedAt: Date.now(),
      lastBatchIds: generationIds,
    })),
  clearSubmitted: () =>
    set({ lastSubmittedPrompt: undefined, lastSubmittedAt: undefined, lastBatchIds: [] }),
  reset: () => set(initial),
}));
