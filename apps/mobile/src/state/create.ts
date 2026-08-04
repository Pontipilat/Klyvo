import { create } from 'zustand';
import { defaultVideoModelId } from '@klyvo/shared';
import type {
  AspectRatio,
  CameraMotion,
  GenerationMode,
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
  markSubmitted: (generationIds: string[]) => void;
  clearSubmitted: () => void;
  reset: () => void;
}

const initial = {
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
