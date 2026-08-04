import type { Language } from '@klyvo/shared';

export function detectLanguage(value: string): Language {
  if (/[ӘәҒғҚқҢңӨөҰұҮүҺһІі]/u.test(value)) return 'kk';
  if (/[А-Яа-яЁё]/u.test(value)) return 'ru';
  return 'en';
}
