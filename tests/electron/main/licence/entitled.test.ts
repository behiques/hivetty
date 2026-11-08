// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LicenceState } from '../../../../electron/shared/licence-contract';

const state = vi.hoisted(() => ({ current: { kind: 'unlicensed' } as LicenceState }));
vi.mock('../../../../electron/main/licence/index', () => ({ licence: () => state.current }));

const { cliEntitled, entitled } = await import('../../../../electron/main/licence/entitled');

const lease = (plan: string, features: string[]): LicenceState => ({
  kind: 'licensed',
  org: 'org_1',
  plan,
  features,
  limits: {},
  exp: 2_000_000_000,
  iat: 1_800_000_000,
});
const SOLO = ['cli.codex', 'relay', 'runners.byo', 'sync'];
const TEAM = [...SOLO, 'cli.copilot', 'team.ledger'];

describe('entitled', () => {
  beforeEach(() => {
    state.current = { kind: 'unlicensed' };
  });

  it('is null for cli.codex on Solo, Team and Enterprise leases', () => {
    for (const [plan, features] of [
      ['solo', SOLO],
      ['team', TEAM],
      ['enterprise', TEAM],
    ] as const) {
      state.current = lease(plan, [...features]);
      expect(entitled('cli.codex')).toBeNull();
    }
  });

  it('answers the reason on a lease without the feature', () => {
    state.current = lease('solo', SOLO);
    expect(entitled('cli.copilot')).toBe('Copilot is in Team and above');
  });

  it('fails closed when unlicensed', () => {
    expect(entitled('cli.codex')).toBe('Sign in to use Codex');
  });
});

describe('cliEntitled (HIVE-332)', () => {
  beforeEach(() => {
    state.current = { kind: 'unlicensed' };
  });

  it('is null for Claude even unlicensed, and names the plan for a CLI the lease lacks', () => {
    expect(cliEntitled('claude-code')).toBeNull();
    state.current = lease('solo', SOLO);
    expect(cliEntitled('codex')).toBeNull();
    expect(cliEntitled('copilot')).toBe('Copilot is in Team and above');
    state.current = lease('team', TEAM);
    expect(cliEntitled('copilot')).toBeNull();
  });

  it('refuses Codex unlicensed and lapsed', () => {
    expect(cliEntitled('codex')).toBe('Sign in to use Codex');
    state.current = { kind: 'lapsed', reason: 'offline' } as LicenceState;
    expect(cliEntitled('codex')).toBe('Your licence has lapsed');
  });
});
