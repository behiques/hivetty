import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  onLicenceChanged,
  planLine,
  readLicence,
  readPaused,
  refreshLicence,
  startTrial,
  trialDaysLeft,
  watchPurchase,
} from '@/lib/licence';

const bridge = (licence: Record<string, unknown>): void => {
  (window as { hive?: unknown }).hive = { licence };
};

afterEach(() => {
  delete (window as { hive?: unknown }).hive;
  vi.restoreAllMocks();
});

describe('src/lib/licence', () => {
  it('answers null and no-ops with no bridge (the browser target)', async () => {
    await expect(readLicence()).resolves.toBeNull();
    await expect(refreshLicence()).resolves.toBeNull();
    await expect(watchPurchase(true)).resolves.toBeUndefined();
    expect(onLicenceChanged(vi.fn())).toEqual(expect.any(Function));
  });

  it('passes main answers through', async () => {
    const dispose = vi.fn();
    const licence = {
      state: vi.fn().mockResolvedValue({ kind: 'unlicensed' }),
      refresh: vi.fn().mockResolvedValue({ kind: 'lapsed', reason: 'no_plan' }),
      watchPurchase: vi.fn().mockResolvedValue(undefined),
      onChanged: vi.fn().mockReturnValue(dispose),
    };
    bridge(licence);
    await expect(readLicence()).resolves.toEqual({ kind: 'unlicensed' });
    await expect(refreshLicence()).resolves.toEqual({ kind: 'lapsed', reason: 'no_plan' });
    await watchPurchase(true);
    expect(licence.watchPurchase).toHaveBeenCalledWith(true);
    const callback = vi.fn();
    expect(onLicenceChanged(callback)).toBe(dispose);
    expect(licence.onChanged).toHaveBeenCalledWith(callback);
  });

  it('answers null rather than throwing when main refuses', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    bridge({
      state: vi.fn().mockRejectedValue(new Error('x')),
      refresh: vi.fn().mockRejectedValue(new Error('x')),
      watchPurchase: vi.fn().mockRejectedValue(new Error('x')),
    });
    await expect(readLicence()).resolves.toBeNull();
    await expect(refreshLicence()).resolves.toBeNull();
    await expect(watchPurchase(false)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(3);
  });
});

describe('trialDaysLeft (HIVE-268)', () => {
  const DAY = 86_400_000;
  const NOW = 1_800_000_000_000;
  const trial = (trialEnds?: number) => ({
    kind: 'licensed' as const,
    org: 'org_1',
    plan: 'team',
    features: [],
    limits: {},
    exp: 0,
    iat: NOW / 1000,
    ...(trialEnds === undefined ? {} : { trialEnds }),
  });

  it('rounds part of a day up, and floors at zero', () => {
    expect(trialDaysLeft(trial((NOW + 8.2 * DAY) / 1000), NOW)).toBe(9);
    expect(trialDaysLeft(trial((NOW - DAY) / 1000), NOW)).toBe(0);
  });

  it('counts in grace too', () => {
    expect(trialDaysLeft({ ...trial((NOW + DAY) / 1000), kind: 'grace' }, NOW)).toBe(1);
  });

  it('is null without a trial, or without a licence', () => {
    expect(trialDaysLeft(trial(), NOW)).toBeNull();
    expect(trialDaysLeft({ kind: 'unlicensed' }, NOW)).toBeNull();
    expect(trialDaysLeft({ kind: 'lapsed', reason: 'trial_ended' }, NOW)).toBeNull();
    expect(trialDaysLeft(null, NOW)).toBeNull();
  });
});

describe('startTrial (HIVE-265)', () => {
  it('answers null with no bridge', async () => {
    await expect(startTrial()).resolves.toBeNull();
  });

  it('passes the answer through', async () => {
    bridge({ startTrial: vi.fn().mockResolvedValue({ error: 'trial_used' }) });
    await expect(startTrial()).resolves.toEqual({ error: 'trial_used' });
  });

  it('answers null and logs when main refuses', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    bridge({ startTrial: vi.fn().mockRejectedValue(new Error('x')) });
    await expect(startTrial()).resolves.toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe('readPaused (HIVE-265)', () => {
  it('answers null with no bridge', async () => {
    await expect(readPaused()).resolves.toBeNull();
  });

  it('passes the answer through', async () => {
    bridge({ paused: vi.fn().mockResolvedValue({ sessions: ['s'], agents: ['a'] }) });
    await expect(readPaused()).resolves.toEqual({ sessions: ['s'], agents: ['a'] });
  });

  it('answers null and logs when main refuses', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    bridge({ paused: vi.fn().mockRejectedValue(new Error('x')) });
    await expect(readPaused()).resolves.toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe('planLine', () => {
  const NOW = Date.UTC(2026, 10, 7);
  const live = { kind: 'licensed' as const, org: 'org_1', plan: 'team', features: [], limits: {}, exp: NOW / 1000 + 86_400 * 30, iat: NOW / 1000 };
  it('a trial reads "<Plan> trial · N days left", singular at one', () => {
    expect(planLine({ ...live, trialEnds: NOW / 1000 + 2.5 * 86_400 }, NOW)).toBe('Team trial · 3 days left');
    expect(planLine({ ...live, trialEnds: NOW / 1000 + 0.5 * 86_400 }, NOW)).toBe('Team trial · 1 day left');
  });
  it('a paid plan reads its display name; an unknown key reads as itself', () => {
    expect(planLine(live, NOW)).toBe('Team');
    expect(planLine({ ...live, plan: 'gold' }, NOW)).toBe('gold');
  });
  it('no live licence has no line', () => {
    expect(planLine(null, NOW)).toBeNull();
    expect(planLine({ kind: 'lapsed', reason: 'trial_ended' }, NOW)).toBeNull();
  });
});
