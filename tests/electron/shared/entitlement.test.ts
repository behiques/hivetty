import { describe, expect, it } from 'vitest';

import { entitlementOf, UPGRADE_PATH } from '../../../electron/shared/entitlement';
import type { LicenceState } from '../../../electron/shared/licence-contract';

const terms = (plan: string, features: string[], extra: { trialEnds?: number } = {}) => ({
  plan,
  features,
  limits: { devices: 3 },
  exp: 2_000_000_000,
  ...extra,
});
const licensed = (plan: string, features: string[], extra = {}): LicenceState => ({
  kind: 'licensed',
  ...terms(plan, features, extra),
});

describe('entitlementOf', () => {
  it('allows a feature the lease lists, licensed or in grace', () => {
    expect(entitlementOf(licensed('solo', ['cli.codex']), 'cli.codex')).toEqual({ allowed: true });
    expect(entitlementOf({ kind: 'grace', ...terms('solo', ['cli.codex']) }, 'cli.codex')).toEqual({ allowed: true });
  });

  it('names the cheapest plan for a feature the lease lacks', () => {
    expect(entitlementOf(licensed('solo', ['cli.codex']), 'cli.copilot')).toEqual({
      allowed: false,
      reason: 'Copilot is in Team and above',
      plan: 'Team',
    });
    expect(entitlementOf(licensed('solo', []), 'cli.codex')).toEqual({
      allowed: false,
      reason: 'Codex is in Solo and above',
      plan: 'Solo',
    });
  });

  it('a feature only Enterprise has says so, and the trial says it is not in the trial', () => {
    const table = { 'audit.log': 'enterprise' } as const;
    expect(entitlementOf(licensed('team', []), 'audit.log', table)).toEqual({
      allowed: false,
      reason: 'audit.log is in Enterprise',
      plan: 'Enterprise',
    });
    expect(entitlementOf(licensed('team', [], { trialEnds: 1 }), 'audit.log', table)).toEqual({
      allowed: false,
      reason: 'Not in the trial: Enterprise only',
      plan: 'Enterprise',
    });
  });

  it('a feature no plan has is simply not in the plan', () => {
    expect(entitlementOf(licensed('team', []), 'nope')).toEqual({
      allowed: false,
      reason: "nope isn't in your plan",
      plan: null,
    });
  });

  it('fails closed with no licence, unlicensed or lapsed, and keeps the plan chip', () => {
    expect(entitlementOf(null, 'cli.codex')).toEqual({ allowed: false, reason: 'Sign in to use Codex', plan: 'Solo' });
    expect(entitlementOf({ kind: 'unlicensed' }, 'cli.codex')).toEqual({
      allowed: false,
      reason: 'Sign in to use Codex',
      plan: 'Solo',
    });
    expect(entitlementOf({ kind: 'lapsed', reason: 'offline' }, 'cli.copilot')).toEqual({
      allowed: false,
      reason: 'Your licence has lapsed',
      plan: 'Team',
    });
  });

  it('upgrades through the account plan page', () => {
    expect(UPGRADE_PATH).toBe('/account/plan');
  });
});
