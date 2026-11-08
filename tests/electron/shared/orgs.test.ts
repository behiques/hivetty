import { describe, expect, it } from 'vitest';

import { canManage, isTeam, orgBadge } from '../../../electron/shared/orgs';

describe('isTeam (HIVE-291 D2)', () => {
  it.each([
    [{ personal: false, plan: null }, true],
    [{ personal: false, plan: 'solo' }, true],
    [{ personal: true, plan: 'team' }, true],
    [{ personal: true, plan: 'enterprise' }, true],
    [{ personal: true, plan: 'solo' }, false],
    [{ personal: true, plan: null }, false],
  ])('%o is a team: %s', (org, team) => {
    expect(isTeam(org)).toBe(team);
  });
});

describe('orgBadge (HIVE-291)', () => {
  it.each([
    ['Acme Corp', 'AC'],
    ['acme  corp inc', 'AC'],
    ['Personal', 'PE'],
    ['  x ', 'X'],
    ['', ''],
  ])('%j → %j', (name, badge) => {
    expect(orgBadge(name)).toBe(badge);
  });
});

describe('canManage (HIVE-291 D1)', () => {
  it.each([
    ['Owner', true],
    ['Admin', true],
    ['Billing', true],
    ['Member', false],
    ['owner', false],
  ])('%s manages: %s', (role, can) => {
    expect(canManage(role)).toBe(can);
  });
});
