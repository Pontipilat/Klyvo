import { QueryClient } from '@tanstack/react-query';

/**
 * Единственный клиент кэша на всё приложение.
 * Вынесен из _layout, чтобы хранилище авторизации могло полностью очищать его
 * при входе и выходе — иначе после смены аккаунта в библиотеке и на экране видео
 * продолжали показываться данные предыдущего пользователя.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 20_000, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

/** Полный сброс кэша при смене пользователя. */
export function resetQueryCache() {
  void queryClient.cancelQueries();
  queryClient.removeQueries();
  queryClient.clear();
}
