import { describe, expect, it } from 'vitest';
import { calculateGenerationCost } from '../src/index.js';

describe('calculateGenerationCost', () => {
  it('prices a silent five-second 720p text generation', () => {
    expect(
      calculateGenerationCost({
        mode: 'TEXT_TO_VIDEO',
        timingMode: 'DURATION',
        duration: 5,
        resolution: '720p',
        generateAudio: false,
        buildQuantity: 1,
      }),
    ).toBe(8);
  });

  it('multiplies the price by build quantity', () => {
    expect(
      calculateGenerationCost({
        mode: 'IMAGE_TO_VIDEO',
        timingMode: 'DURATION',
        duration: 10,
        resolution: '1080p',
        generateAudio: true,
        buildQuantity: 2,
      }),
    ).toBe(146);
  });
});
