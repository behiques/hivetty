// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { LicenceState } from '../../shared/licence-contract';
import { EDITION_EXIT, EDITION_FEATURE, EDITION_REFUSAL, gateEdition } from '../../server/edition';

const terms = (features: string[]) => ({
  org: 'org_1',
  plan: 'team',
  features,
  limits: {},
  exp: 2_000_000_000,
  iat: 1_800_000_000,
});
const licensed = (features: string[]): LicenceState => ({ kind: 'licensed', ...terms(features) });
const lapsed: LicenceState = { kind: 'lapsed', reason: 'signed_out' };

function harness(initial: LicenceState, onDisk: string[] | null = null) {
  let listener: ((state: LicenceState) => void) | null = null;
  const unsubscribe = vi.fn();
  const deps = {
    read: vi.fn(() => initial),
    leaseFeatures: vi.fn(() => onDisk),
    subscribe: vi.fn((next: (state: LicenceState) => void) => {
      listener = next;
      return unsubscribe;
    }),
    start: vi.fn(),
    refuse: vi.fn(),
  };
  const off = gateEdition(deps);
  const emit = (state: LicenceState): void => listener?.(state);
  return { deps, off, emit, unsubscribe, setDisk: (next: string[] | null) => deps.leaseFeatures.mockReturnValue(next) };
}

describe('the edition gate (HIVE-422)', () => {
  it('names the feature, the refusal and the exit code', () => {
    expect(EDITION_FEATURE).toBe('runners.byo');
    expect(EDITION_REFUSAL).toBe("This edition isn't part of your plan");
    expect(EDITION_EXIT).toBe(3);
  });

  it('waits while unlicensed, then starts once a licence with the feature arrives', () => {
    const { deps, emit } = harness({ kind: 'unlicensed' });
    expect(deps.start).not.toHaveBeenCalled();
    expect(deps.refuse).not.toHaveBeenCalled();
    emit(licensed(['runners.byo']));
    expect(deps.start).toHaveBeenCalledTimes(1);
  });

  it('starts once for a licence with runners.byo, and not again for the same state', () => {
    const { deps, emit } = harness(licensed(['runners.byo']));
    expect(deps.start).toHaveBeenCalledTimes(1);
    emit(licensed(['runners.byo']));
    expect(deps.start).toHaveBeenCalledTimes(1);
    expect(deps.refuse).not.toHaveBeenCalled();
  });

  it('refuses a licence without the feature', () => {
    const { deps } = harness(licensed(['relay']));
    expect(deps.refuse).toHaveBeenCalledTimes(1);
    expect(deps.start).not.toHaveBeenCalled();
  });

  it('refuses a grace state without the feature, and starts one with it', () => {
    const refused = harness({ kind: 'grace', ...terms(['relay']) });
    expect(refused.deps.refuse).toHaveBeenCalledTimes(1);
    const served = harness({ kind: 'grace', ...terms(['runners.byo']) });
    expect(served.deps.start).toHaveBeenCalledTimes(1);
  });

  it('lapsed at boot: starts when the lease on disk carries the feature', () => {
    const { deps } = harness(lapsed, ['runners.byo']);
    expect(deps.start).toHaveBeenCalledTimes(1);
    expect(deps.refuse).not.toHaveBeenCalled();
  });

  it('lapsed at boot: refuses when the lease on disk lacks the feature', () => {
    const { deps } = harness(lapsed, ['relay']);
    expect(deps.refuse).toHaveBeenCalledTimes(1);
    expect(deps.start).not.toHaveBeenCalled();
  });

  it('lapsed at boot: refuses when no lease can be read', () => {
    const { deps } = harness(lapsed, null);
    expect(deps.refuse).toHaveBeenCalledTimes(1);
    expect(deps.start).not.toHaveBeenCalled();
  });

  it('keeps serving through a lapse once started', () => {
    const { deps, emit, setDisk } = harness(licensed(['runners.byo']));
    setDisk(null);
    emit(lapsed);
    expect(deps.start).toHaveBeenCalledTimes(1);
    expect(deps.refuse).not.toHaveBeenCalled();
  });

  it('refuses when the plan changes under a running server', () => {
    const { deps, emit } = harness(licensed(['runners.byo']));
    emit(licensed(['relay']));
    expect(deps.refuse).toHaveBeenCalledTimes(1);
  });

  it('returns the unsubscribe subscribe gave it', () => {
    const { off, unsubscribe } = harness({ kind: 'unlicensed' });
    expect(off).toBe(unsubscribe);
  });
});
