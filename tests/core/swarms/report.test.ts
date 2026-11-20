// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { InstalledSwarm, SwarmEntry, SwarmFailureCode } from '@shared/swarm-contract';

import type { AuthedFetch } from '../../../core/swarms/registry';
import { reportFor, reportInstall } from '../../../core/swarms/report';

const AGENT = { name: 'reviewer', description: 'Reviews.', tools: ['Read'] };
const SKILL = { name: 'rules', description: 'The rules.' };

const entryFor = (overrides: Partial<SwarmEntry> = {}): SwarmEntry => ({
  id: 'a1',
  slug: 'standard',
  kind: 'native',
  title: 'Standard',
  description: 'From the row',
  publisher: 'HiveTTY',
  tags: [],
  version: '1.4.0',
  updatedAt: '2026-11-19T00:00:00Z',
  installs: 0,
  agents: [],
  skills: [],
  repoUrl: 'https://github.com/o/r',
  folder: 'standard',
  commit: 'a'.repeat(40),
  access: 'token',
  policy: 'latest',
  pinnedVersion: null,
  org: null,
  ...overrides,
});

const installedFor = (overrides: Partial<InstalledSwarm> = {}): InstalledSwarm => ({
  swarmId: 'a1',
  slug: 'standard',
  kind: 'native',
  org: null,
  repoUrl: 'https://github.com/o/r',
  folder: 'standard',
  version: '1.4.0',
  commit: 'a'.repeat(40),
  installedAt: '2026-11-19T12:00:00.000Z',
  autoUpdate: true,
  lastError: null,
  title: 'Standard',
  description: 'Ticket to merge.',
  contents: { agents: [AGENT], skills: [SKILL] },
  disabled: { agents: [], skills: [] },
  ...overrides,
});

const org = { id: 'o1', name: 'Acme' };

describe('reportFor', () => {
  it('reports an installed native swarm with its version and no contents', () => {
    const report = reportFor(entryFor(), { ok: true, installed: installedFor() });
    expect(report).toEqual({ state: 'installed', version: '1.4.0' });
    expect(report).not.toHaveProperty('contents');
  });

  it('carries the installed contents for an organization swarm', () => {
    const entry = entryFor({ kind: 'organization', org });
    const installed = installedFor({ kind: 'organization', org, title: 'Acme Review', description: 'Acme rules' });

    expect(reportFor(entry, { ok: true, installed })).toEqual({
      state: 'installed',
      version: '1.4.0',
      contents: { title: 'Acme Review', description: 'Acme rules', agents: [AGENT], skills: [SKILL] },
    });
  });

  it('takes the row’s description when the installed entry has none', () => {
    const entry = entryFor({ kind: 'organization', org, description: 'From the row' });
    const installed = installedFor({ kind: 'organization', org, description: '' });

    const report = reportFor(entry, { ok: true, installed });
    expect(report?.state === 'installed' && report.contents?.description).toBe('From the row');
  });

  it('takes the row’s description for an entry written before descriptions were kept', () => {
    const entry = entryFor({ kind: 'organization', org, description: 'From the row' });
    const { description: _dropped, ...older } = installedFor({ kind: 'organization', org });

    const report = reportFor(entry, { ok: true, installed: older as InstalledSwarm });
    expect(report?.state === 'installed' && report.contents?.description).toBe('From the row');
  });

  it('reports no_access with no version', () => {
    expect(reportFor(entryFor(), { ok: false, failure: { code: 'no_access', message: 'no' } })).toEqual({
      state: 'no_access',
    });
  });

  it.each<SwarmFailureCode>(['offline', 'failed', 'invalid', 'collision'])('reports nothing for a %s failure', (code) => {
    expect(reportFor(entryFor(), { ok: false, failure: { code, message: 'no' } })).toBeNull();
  });
});

describe('reportInstall', () => {
  it('posts the report to the swarm’s installs route, the id encoded', async () => {
    const fetchSpy = vi.fn<AuthedFetch>().mockResolvedValue(new Response(null, { status: 204 }));

    await reportInstall(fetchSpy, 'a b', { state: 'removed', version: '1.0.0' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/api/swarms/a%20b/installs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"state":"removed","version":"1.0.0"}',
    });
  });

  it('does nothing without a session', async () => {
    await expect(reportInstall(null, 'a1', { state: 'no_access' })).resolves.toBeUndefined();
  });

  it('never rejects when the fetch rejects', async () => {
    const fetchSpy = vi.fn<AuthedFetch>().mockRejectedValue(new Error('offline'));
    await expect(reportInstall(fetchSpy, 'a1', { state: 'no_access' })).resolves.toBeUndefined();
  });

  it.each([404, 400, 429, 204])('resolves undefined on a %i', async (status) => {
    const fetchSpy = vi.fn<AuthedFetch>().mockResolvedValue(new Response(null, { status }));
    await expect(reportInstall(fetchSpy, 'a1', { state: 'installed', version: '1.0.0' })).resolves.toBeUndefined();
  });
});
