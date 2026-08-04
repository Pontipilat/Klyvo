import type { ApiErrorPayload, AuthTokens } from '@klyvo/shared';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const metroHost = Constants.expoConfig?.hostUri?.split(':')[0];

/**
 * Адрес API.
 *
 * Заданный явно `EXPO_PUBLIC_API_URL` важнее всего остального: иначе приложение,
 * запущенное через Expo Go, всегда стучалось бы на компьютер с Metro и не могло
 * подключиться к серверу на хостинге. Если переменной нет, адрес определяется сам —
 * по хосту Metro в разработке и по адресу эмулятора Android как последний вариант.
 */
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
const detectedApiUrl = metroHost ? `http://${metroHost}:4000` : 'http://10.0.2.2:4000';

export const API_URL = (configuredApiUrl || detectedApiUrl).replace(/\/$/u, '');

const DEVICE_KEY = 'klyvo.deviceId';
let cachedDeviceId: string | null = null;

/**
 * Стабильный идентификатор устройства для гостевого входа.
 * Раньше все гости логинились в один общий демо-аккаунт и видели чужую библиотеку.
 */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  const stored = await SecureStore.getItemAsync(DEVICE_KEY);
  if (stored) {
    cachedDeviceId = stored;
    return stored;
  }
  const generated = `dev_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2)}`;
  await SecureStore.setItemAsync(DEVICE_KEY, generated);
  cachedDeviceId = generated;
  return generated;
}

let tokens: AuthTokens | null = null;
let refreshHandler: (() => Promise<boolean>) | null = null;

export function setApiTokens(next: AuthTokens | null) {
  tokens = next;
}
export function setApiRefreshHandler(handler: () => Promise<boolean>) {
  refreshHandler = handler;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
  skipRefresh?: boolean;
  /** Загрузка файлов и генерация занимают больше 12 секунд — таймаут настраивается. */
  timeoutMs?: number;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { skipAuth, skipRefresh, timeoutMs, ...init } = options;
  const headers = new Headers(init.headers);
  /**
   * Заголовок ставится только когда тело действительно есть.
   * С `Content-Type: application/json` и пустым телом Fastify отвечает 400
   * (FST_ERR_CTP_EMPTY_JSON_BODY) — из-за этого молча не работали лайк, просмотр,
   * отмена и повтор генерации, снятие с публикации и восстановление покупок.
   */
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (!skipAuth && tokens?.accessToken)
    headers.set('Authorization', `Bearer ${tokens.accessToken}`);
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 15_000);
  const abort = () => controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers, signal: controller.signal });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'The API server is unavailable', 0);
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abort);
  }
  if (response.status === 401 && !skipRefresh && refreshHandler && (await refreshHandler())) {
    return apiRequest<T>(path, { ...options, skipRefresh: true });
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
    throw new ApiError(
      payload?.error.code ?? 'REQUEST_FAILED',
      payload?.error.message ?? 'Request failed',
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
