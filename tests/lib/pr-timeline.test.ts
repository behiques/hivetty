import { describe, expect, it } from 'vitest';

import { fraction, MIN, ticks } from '@lib/pr-timeline';

const T0 = new Date(2026, 9, 3, 11, 0).getTime();

describe('fraction', () => {
  it('places a time on the axis, clamped', () => {
    expect(fraction(T0 + 95 * MIN, T0, T0 + 190 * MIN)).toBe(0.5);
    expect(fraction(T0 - MIN, T0, T0 + 10 * MIN)).toBe(0);
    expect(fraction(T0 + 20 * MIN, T0, T0 + 10 * MIN)).toBe(1);
    expect(fraction(T0, T0, T0)).toBe(0);
  });
});

describe('ticks', () => {
  it('a 10-minute PR ticks every few minutes, HH:MM, never touching', () => {
    const out = ticks(T0, T0 + 10 * MIN, 900);
    expect(out[0]).toMatchObject({ at: T0, f: 0, label: '11:00' });
    expect(out.map((t) => t.label)).toEqual(['11:00', '11:05', '11:10']);
  });
  it('the design PR (3h10m at ~900px) ticks every 30 minutes', () => {
    expect(ticks(T0, T0 + 190 * MIN, 900).map((t) => t.label)).toEqual(['11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00']);
  });
  it('a 3-day PR widens the step and names the day', () => {
    const out = ticks(T0, T0 + 3 * 24 * 60 * MIN, 900);
    const gaps = out.slice(1).map((t, i) => (t.f - out[i]!.f) * 900);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(56);
    expect(out[0]?.label).toBe('Sat 11:00');
  });
});
