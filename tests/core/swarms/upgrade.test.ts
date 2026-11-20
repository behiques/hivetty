// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InstalledSwarm } from '@shared/swarm-contract';

/**
 * HIVE-448: what boot does to a home once the app ships no agents and no skills. Three homes, each booted through
 * the one function boot calls (`adopt`), with the real seed and swarm modules: only where `~/.hivetty` is moves.
 */
const config = vi.hoisted(() => ({ path: '/h/config.json' }));
vi.mock('../../../core/config/paths', () => ({ configPath: () => config.path }));
vi.unmock('../../../core/swarms'); // tests/setup.ts stubs boot's adoption for every other spec

const { adopt, resetSwarms } = await import('../../../core/swarms');

let home: string;
const at = (rel: string): string => join(home, rel);
const write = (rel: string, text: string): void => {
  mkdirSync(dirname(at(rel)), { recursive: true });
  writeFileSync(at(rel), text);
};
const read = (rel: string): string => readFileSync(at(rel), 'utf8');
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const entries = (rel: string): string[] => (existsSync(at(rel)) ? readdirSync(at(rel)) : []);
const installed = (): InstalledSwarm[] =>
  existsSync(at('swarms/installed.json')) ? (JSON.parse(read('swarms/installed.json')) as InstalledSwarm[]) : [];

const AGENT = '---\nname: builder\ndescription: Builds.\nicon: Ghost\nskills: []\ntools: [Read]\n---\nBuild.\n';
const SKILL = '---\nname: tdd\ndescription: Test first.\n---\nRed, green.\n';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'hive-upgrade-'));
  config.path = at('config.json');
});

afterEach(() => {
  resetSwarms();
  rmSync(home, { recursive: true, force: true });
});

describe('boot after HIVE-448', () => {
  it('a fresh home ends boot with no agents, no skills and nothing installed', async () => {
    await expect(adopt()).resolves.toBeUndefined();

    expect(entries('agents')).toEqual([]);
    expect(entries('skills')).toEqual([]);
    expect(installed()).toEqual([]);
    expect(existsSync(at('.seed.json'))).toBe(false);
  });

  it('an adopted home keeps its installed entry and its edited bytes', async () => {
    const edited = `${AGENT}Mine.\n`;
    const entry = {
      swarmId: 'bundled-dev-squad',
      slug: 'dev-squad',
      kind: 'native',
      org: null,
      title: 'Dev Squad',
      description: 'Ticket to merge: plan, build, review, ship.',
      repoUrl: 'https://github.com/behiques/hivetty-swarms.git',
      folder: 'dev-squad',
      commit: 'e'.repeat(40),
      version: 'bundled',
      installedAt: '2026-11-19T00:00:00.000Z',
      autoUpdate: true,
      lastError: null,
      contents: { agents: [{ name: 'builder', description: 'Builds.', tools: ['Read'] }], skills: [] },
    };
    write('swarms/adopted', '');
    write('swarms/installed.json', JSON.stringify([entry]));
    write('swarms/bundled-dev-squad/seed.json', JSON.stringify({ files: { 'agents/builder/AGENT.md': sha(AGENT) }, parts: {} }));
    write('agents/builder/AGENT.md', edited);
    const before = read('swarms/installed.json');

    await adopt();

    expect(read('swarms/installed.json')).toBe(before);
    expect(read('agents/builder/AGENT.md')).toBe(edited);
    expect(entries('skills')).toEqual([]);
  });

  it('a home never adopted becomes Dev Squad, with both files’ bytes unchanged', async () => {
    const edited = `${SKILL}Mine.\n`;
    write('agents/builder/AGENT.md', AGENT);
    write('skills/tdd/SKILL.md', edited);
    write(
      '.seed.json',
      JSON.stringify({ files: { 'agents/builder/AGENT.md': sha(AGENT), 'skills/tdd/SKILL.md': sha(SKILL) }, parts: {} }),
    );

    await adopt();

    expect(installed().map((held) => [held.swarmId, held.slug, held.version])).toEqual([
      ['bundled-dev-squad', 'dev-squad', 'bundled'],
    ]);
    expect(existsSync(at('swarms/adopted'))).toBe(true);
    expect(read('agents/builder/AGENT.md')).toBe(AGENT);
    expect(read('skills/tdd/SKILL.md')).toBe(edited);
  });

  it('never rejects, and leaves no marker, when adoption fails; the next launch tries again', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    write('agents/builder/AGENT.md', AGENT);
    write('.seed.json', JSON.stringify({ files: { 'agents/builder/AGENT.md': sha(AGENT) }, parts: {} }));
    write('swarms/installed.json', 'not json');

    await expect(adopt()).resolves.toBeUndefined();

    expect(existsSync(at('swarms/adopted'))).toBe(false);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('could not be adopted as the Dev Squad swarm'));
    info.mockRestore();
  });
});
