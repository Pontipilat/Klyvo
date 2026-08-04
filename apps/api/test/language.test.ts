import { describe, expect, it } from 'vitest';
import { detectLanguage } from '../src/lib/language.js';

describe('detectLanguage', () => {
  it('detects Russian Cyrillic text', () => {
    expect(detectLanguage('Белый самолёт летит над столом')).toBe('ru');
  });

  it('prioritizes Kazakh-specific Cyrillic characters', () => {
    expect(detectLanguage('Ақ қағаз ұшағы үстелдің үстімен ұшады')).toBe('kk');
  });

  it('falls back to English', () => {
    expect(detectLanguage('A paper plane flies above the table')).toBe('en');
  });
});
