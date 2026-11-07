import { describe, expect, it } from 'vitest';

import { FEATURE_PLANS, PLAN_NAMES, PLAN_ORDER, TRIAL_PLAN } from '../../../electron/shared/feature-plans';

/** The facts of HIVE-272 as built (HIVE-268's 5 Nov UPDATED SPECS). A diff here means plans:sync pulled a change. */
describe('feature-plans (generated from @hivetty/plans)', () => {
  it('orders the plans cheapest first, with their names', () => {
    expect(PLAN_ORDER).toEqual(['solo', 'team', 'enterprise']);
    expect(PLAN_NAMES).toEqual({ solo: 'Solo', team: 'Team', enterprise: 'Enterprise' });
  });

  it('names the cheapest plan for each feature', () => {
    expect(FEATURE_PLANS).toEqual({
      'cli.codex': 'solo',
      relay: 'solo',
      'runners.byo': 'solo',
      sync: 'solo',
      'cli.copilot': 'team',
      'team.ledger': 'team',
    });
  });

  it('runs the trial on Team', () => {
    expect(TRIAL_PLAN).toBe('team');
  });
});
