import { describe, expect, it } from 'vitest';

import { bannerFor } from '@features/account/lib/banner';

const DAY = 86_400;
const NOW = Date.UTC(2026, 10, 7) / 1000;
const live = (over = {}) => ({
  kind: 'licensed' as const,
  plan: 'team',
  features: [],
  limits: {},
  exp: NOW + 30 * DAY,
  iat: NOW,
  ...over,
});

describe('bannerFor (HIVE-265)', () => {
  it('no trial, or more than 3 days left: none', () => {
    expect(bannerFor(live(), NOW * 1000, null)).toBeNull();
    expect(bannerFor(live({ trialEnds: NOW + 3.5 * DAY }), NOW * 1000, null)).toBeNull();
  });
  it('3 days or fewer: threshold 3; 1 or fewer: threshold 1', () => {
    expect(bannerFor(live({ trialEnds: NOW + 3 * DAY }), NOW * 1000, null)).toEqual({
      kind: 'trial',
      threshold: 3,
      days: 3,
    });
    expect(bannerFor(live({ trialEnds: NOW + 2 * DAY }), NOW * 1000, null)).toEqual({
      kind: 'trial',
      threshold: 3,
      days: 2,
    });
    expect(bannerFor(live({ trialEnds: NOW + 0.5 * DAY }), NOW * 1000, null)).toEqual({
      kind: 'trial',
      threshold: 1,
      days: 1,
    });
  });
  it('a dismissal at 3 hides it until 1; a dismissal at 1 hides it for good', () => {
    expect(bannerFor(live({ trialEnds: NOW + 2 * DAY }), NOW * 1000, 3)).toBeNull();
    expect(bannerFor(live({ trialEnds: NOW + 0.5 * DAY }), NOW * 1000, 3)).toEqual({
      kind: 'trial',
      threshold: 1,
      days: 1,
    });
    expect(bannerFor(live({ trialEnds: NOW + 0.5 * DAY }), NOW * 1000, 1)).toBeNull();
  });
  it('offline: grace within 3 days of exp, N from iat and M from exp', () => {
    const grace = { ...live({ exp: NOW + 2.5 * DAY, iat: NOW - 27 * DAY }), kind: 'grace' as const };
    expect(bannerFor(grace, NOW * 1000, null)).toEqual({ kind: 'offline', days: 27, left: 3 });
  });
  it('offline wins over the trial, and a dismissal does not hide it', () => {
    const grace = {
      ...live({ exp: NOW + 2 * DAY, iat: NOW - 28 * DAY, trialEnds: NOW + DAY }),
      kind: 'grace' as const,
    };
    expect(bannerFor(grace, NOW * 1000, 1)).toMatchObject({ kind: 'offline' });
  });
  it('grace with more than 3 days left: no offline banner', () => {
    expect(bannerFor({ ...live(), kind: 'grace' }, NOW * 1000, null)).toBeNull();
  });
  it('lapsed or loading: none', () => {
    expect(bannerFor(null, NOW * 1000, null)).toBeNull();
    expect(bannerFor({ kind: 'lapsed', reason: 'offline' }, NOW * 1000, null)).toBeNull();
  });
});
