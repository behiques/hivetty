// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { LicenceState } from '../../../../electron/shared/licence-contract';
import { startWhenLicensed } from '../../../../electron/main/licence/serve-gate';

const TERMS = { org: 'org_1', plan: 'team', features: [], limits: {}, exp: 2e9, iat: 1.9e9 };

function source(initial: LicenceState) {
  let listener: ((s: LicenceState) => void) | null = null;
  const unsubscribe = vi.fn(() => {
    listener = null;
  });
  return {
    read: () => initial,
    subscribe: vi.fn((l: (s: LicenceState) => void) => {
      listener = l;
      return unsubscribe;
    }),
    push: (s: LicenceState) => listener?.(s),
    unsubscribe,
  };
}

describe('startWhenLicensed (HIVE-265)', () => {
  it.each<LicenceState>([
    { kind: 'licensed', ...TERMS },
    { kind: 'grace', ...TERMS },
    { kind: 'lapsed', reason: 'trial_ended' },
  ])('starts at once when %o', (state) => {
    const start = vi.fn();
    const s = source(state);
    startWhenLicensed(start, s.read, s.subscribe);
    expect(start).toHaveBeenCalledOnce();
    expect(s.subscribe).not.toHaveBeenCalled();
  });

  it('unlicensed: waits, starts on the first change out of it, once, and stops listening', () => {
    const start = vi.fn();
    const s = source({ kind: 'unlicensed' });
    startWhenLicensed(start, s.read, s.subscribe);
    expect(start).not.toHaveBeenCalled();
    s.push({ kind: 'unlicensed' });
    expect(start).not.toHaveBeenCalled();
    s.push({ kind: 'licensed', ...TERMS });
    expect(start).toHaveBeenCalledOnce();
    expect(s.unsubscribe).toHaveBeenCalledOnce();
    s.push({ kind: 'lapsed', reason: 'offline' });
    expect(start).toHaveBeenCalledOnce();
  });
});
