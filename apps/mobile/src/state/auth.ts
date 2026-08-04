import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { AuthTokens, Language } from '@klyvo/shared';
import { apiRequest, setApiRefreshHandler, setApiTokens } from '../api/client';
import { resetQueryCache } from '../api/queryClient';
import { useI18nStore } from '../i18n';
import { useCreateStore } from './create';

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  language: Language;
  isGuest?: boolean;
}
interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

interface AuthState {
  hydrated: boolean;
  onboardingComplete: boolean;
  user: User | null;
  tokens: AuthTokens | null;
  initialize: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  refresh: () => Promise<boolean>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const TOKEN_KEY = 'klyvo.tokens';
const ONBOARDING_KEY = 'klyvo.onboarding';

/**
 * Любая смена пользователя обязана стирать кэш запросов и черновик создания.
 * Без этого после входа под другим аккаунтом библиотека и экран видео
 * какое-то время показывали чужие ролики («ваше видео готово», хотя оно не ваше).
 */
function clearSessionState() {
  resetQueryCache();
  useCreateStore.getState().reset();
}

async function persistSession(response: AuthResponse) {
  setApiTokens(response.tokens);
  await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(response.tokens));
}

export const useAuthStore = create<AuthState>((set, get) => ({
  hydrated: false,
  onboardingComplete: false,
  user: null,
  tokens: null,
  initialize: async () => {
    let onboardingComplete = false;
    try {
      await useI18nStore.getState().hydrate();
      const [storedTokens, onboarding] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(ONBOARDING_KEY),
      ]);
      onboardingComplete = onboarding === 'true';
      const parsed = storedTokens ? (JSON.parse(storedTokens) as AuthTokens) : null;
      setApiTokens(parsed);
      setApiRefreshHandler(get().refresh);
      if (parsed) {
        const { user } = await apiRequest<{ user: User }>('/me');
        set({ user, tokens: parsed, onboardingComplete, hydrated: true });
        return;
      }
    } catch {
      setApiTokens(null);
      await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
    }
    set({ user: null, tokens: null, onboardingComplete, hydrated: true });
  },
  completeOnboarding: async () => {
    await SecureStore.setItemAsync(ONBOARDING_KEY, 'true');
    set({ onboardingComplete: true });
  },
  login: async (email, password) => {
    const response = await apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      skipAuth: true,
      skipRefresh: true,
    });
    clearSessionState();
    await persistSession(response);
    set({ user: response.user, tokens: response.tokens });
  },
  register: async (displayName, email, password) => {
    const language = useI18nStore.getState().language;
    const response = await apiRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ displayName, email, password, language }),
      skipAuth: true,
      skipRefresh: true,
    });
    clearSessionState();
    await persistSession(response);
    set({ user: response.user, tokens: response.tokens });
  },
  refresh: async () => {
    const refreshToken = get().tokens?.refreshToken;
    if (!refreshToken) return false;
    try {
      const response = await apiRequest<{ tokens: AuthTokens }>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
        skipAuth: true,
        skipRefresh: true,
      });
      setApiTokens(response.tokens);
      await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(response.tokens));
      set({ tokens: response.tokens });
      return true;
    } catch {
      return false;
    }
  },
  logout: async () => {
    const refreshToken = get().tokens?.refreshToken;
    if (refreshToken) {
      await apiRequest('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
        skipRefresh: true,
      }).catch(() => undefined);
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setApiTokens(null);
    clearSessionState();
    set({ user: null, tokens: null });
  },
  deleteAccount: async () => {
    await apiRequest('/me', { method: 'DELETE' });
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setApiTokens(null);
    clearSessionState();
    set({ user: null, tokens: null });
  },
}));
