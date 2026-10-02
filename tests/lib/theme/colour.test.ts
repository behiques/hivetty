import { describe, expect, it } from 'vitest';

import { clearColour, mixColour, parseColour } from '@lib/theme/colour';

describe('parseColour', () => {
  it.each([
    ['#fff', [255, 255, 255, 1]],
    ['#10152a', [16, 21, 42, 1]],
    ['#10152a80', [16, 21, 42, 128 / 255]],
    ['rgb(16, 21, 42)', [16, 21, 42, 1]],
    ['rgb(16, 21, 42, 0.5)', [16, 21, 42, 0.5]],
    ['rgb(16 21 42 / 50%)', [16, 21, 42, 0.5]],
    ['rgb(100% 0% 0%)', [255, 0, 0, 1]],
    ['oklch(1 0 0)', [255, 255, 255, 1]],
    ['oklch(0 0 0)', [0, 0, 0, 1]],
    ['oklch(62.796% 0.25768 29.2339)', [255, 0, 0, 1]],
  ] as const)('reads %s', (input, want) => {
    const got = parseColour(input);
    expect(got).not.toBeNull();
    got!.forEach((channel, i) => expect(channel).toBeCloseTo(want[i]!, 0));
  });

  it('answers null for anything validate.ts would refuse', () => {
    expect(parseColour('hsl(0 0% 0%)')).toBeNull();
    expect(parseColour('rgb(1 2)')).toBeNull();
    expect(parseColour('red')).toBeNull();
  });
});

describe('mixColour', () => {
  it('blends in sRGB and emits modern rgb()', () => {
    expect(mixColour('#10152a', '#8fa7f2', 0.4)).toBe('rgb(67 79 122)');
    expect(mixColour('#10152a', '#b9a7f0', 0.18)).toBe('rgb(46 47 78)');
  });

  it('mixes across formats', () => {
    expect(mixColour('oklch(0 0 0)', 'rgb(255 255 255)', 0.5)).toBe('rgb(128 128 128)');
  });

  it('hands back the base unchanged when either side is unreadable', () => {
    expect(mixColour('nonsense', '#fff', 0.5)).toBe('nonsense');
    expect(mixColour('#000000', 'nonsense', 0.5)).toBe('#000000');
  });
});

describe('clearColour', () => {
  it('keeps the channels and drops the alpha to zero', () => {
    expect(clearColour('#5b3d8f')).toBe('rgb(91 61 143 / 0)');
  });
});
