// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { InstalledSwarm } from '@shared/swarm-contract';

import { baseOf } from '../../../core/seed/merge';
import { ADOPTED_SWARM_ID, STANDARD, adoptBuiltIns } from '../../../core/swarms/adopt';

/**
 * Adoption (HIVE-447): the built-ins a home holds become the installed Standard swarm, offline, once. Every case
 * runs against a real temp `~/.hivetty`; there is no network, Git or registry to fake.
 */

let root: string;
let hiveDir: string;

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const hive = (rel: string): string => join(hiveDir, rel);
const write = (rel: string, text: string): void => {
  mkdirSync(dirname(hive(rel)), { recursive: true });
  writeFileSync(hive(rel), text, 'utf8');
};
const readHive = (rel: string): string => readFileSync(hive(rel), 'utf8');
const readJson = <T>(rel: string): T => JSON.parse(readHive(rel)) as T;

const NOW = new Date('2026-11-19T12:00:00Z');
const adopt = (): Promise<void> =>
  adoptBuiltIns({ hiveDir, shippedManifest: hive('.seed.json'), now: () => NOW });

const skillText = (name: string, body = 'Body.'): string => `---\nname: ${name}\ndescription: Does ${name}.\n---\n${body}\n`;
const agentText = (name: string): string =>
  `---\nname: ${name}\ndescription: Helps with ${name}.\nicon: Ghost\nskills: []\ntools: [Read, Bash]\n---\nWait to be asked.\n`;

const FILES: Record<string, string> = {
  'agents/builder/AGENT.md': agentText('builder'),
  'agents/shipper/AGENT.md': agentText('shipper'),
  'skills/tdd/SKILL.md': skillText('tdd'),
  'skills/verify/SKILL.md': skillText('verify'),
};

const seededManifest = (): { files: Record<string, string>; parts: Record<string, unknown> } => ({
  files: Object.fromEntries(Object.entries(FILES).map(([rel, text]) => [rel, sha(text)])),
  parts: Object.fromEntries(Object.entries(FILES).map(([rel, text]) => [rel, baseOf(text)])),
});

/** A home the boot seed filled: two agents and two skills on disk, `.seed.json` naming every file. */
function seededHome(): void {
  for (const [rel, text] of Object.entries(FILES)) write(rel, text);
  write('.seed.json', JSON.stringify(seededManifest()));
}

const installedJson = (): InstalledSwarm[] =>
  existsSync(hive('swarms/installed.json')) ? readJson<InstalledSwarm[]>('swarms/installed.json') : [];
const EMPTY = { files: {}, parts: {} };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hive-swarm-adopt-'));
  hiveDir = join(root, 'hive');
  mkdirSync(hiveDir);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('adoptBuiltIns', () => {
  it('holds a seeded home’s built-ins as the installed Standard at version bundled, and leaves the marker', async () => {
    seededHome();
    const before = readJson<object>('.seed.json');

    await adopt();

    expect(installedJson()).toEqual([
      {
        swarmId: ADOPTED_SWARM_ID,
        slug: 'standard',
        kind: 'native',
        org: null,
        title: 'Standard',
        description: STANDARD.description,
        repoUrl: STANDARD.repoUrl,
        folder: STANDARD.folder,
        commit: STANDARD.commit,
        version: 'bundled',
        installedAt: NOW.toISOString(),
        autoUpdate: true,
        lastError: null,
        contents: {
          agents: [
            { name: 'builder', description: 'Helps with builder.', tools: ['Read', 'Bash'] },
            { name: 'shipper', description: 'Helps with shipper.', tools: ['Read', 'Bash'] },
          ],
          skills: [
            { name: 'tdd', description: 'Does tdd.' },
            { name: 'verify', description: 'Does verify.' },
          ],
        },
      },
    ]);
    expect(ADOPTED_SWARM_ID).toBe('bundled-standard');
    expect(readJson('swarms/bundled-standard/seed.json')).toEqual(before);
    expect(readJson('.seed.json')).toEqual(EMPTY);
    expect(existsSync(hive('swarms/adopted'))).toBe(true);
  });

  it('keeps an edited file’s bytes and moves its seeded hash as it was', async () => {
    seededHome();
    write('skills/tdd/SKILL.md', skillText('tdd', 'Mine.'));

    await adopt();

    expect(readHive('skills/tdd/SKILL.md')).toBe(skillText('tdd', 'Mine.'));
    const own = readJson<{ files: Record<string, string> }>('swarms/bundled-standard/seed.json');
    expect(own.files['skills/tdd/SKILL.md']).toBe(sha(skillText('tdd')));
  });

  it('changes nothing on a second run', async () => {
    seededHome();
    await adopt();
    const snapshot = ['swarms/installed.json', 'swarms/bundled-standard/seed.json', '.seed.json'].map(readHive);

    await adoptBuiltIns({ hiveDir, shippedManifest: hive('.seed.json'), now: () => new Date('2027-01-01T00:00:00Z') });

    expect(['swarms/installed.json', 'swarms/bundled-standard/seed.json', '.seed.json'].map(readHive)).toEqual(snapshot);
    expect(installedJson()[0]?.installedAt).toBe(NOW.toISOString());
  });

  it('writes only the marker for a home with no seed manifest', async () => {
    await adopt();

    expect(existsSync(hive('swarms/installed.json'))).toBe(false);
    expect(existsSync(hive('.seed.json'))).toBe(false);
    expect(existsSync(hive('swarms/adopted'))).toBe(true);
  });

  it('writes no entry when every built-in was deleted, empties .seed.json, and leaves the marker', async () => {
    write('.seed.json', JSON.stringify(seededManifest()));

    await adopt();

    expect(existsSync(hive('swarms/installed.json'))).toBe(false);
    expect(readJson('.seed.json')).toEqual(EMPTY);
    expect(existsSync(hive('swarms/adopted'))).toBe(true);
  });

  it('moves the leftover entries into a Standard already installed under its registry id, writing no second entry', async () => {
    seededHome();
    const realId = 'cmwn22bge000001jtss3qlz4i';
    const held = {
      swarmId: realId,
      slug: 'standard',
      kind: 'native',
      org: null,
      repoUrl: STANDARD.repoUrl,
      folder: 'standard',
      version: '1.0.0',
      commit: 'c'.repeat(40),
      installedAt: '2026-11-01T00:00:00Z',
      autoUpdate: true,
      lastError: null,
      title: 'Standard',
      description: '',
      contents: { agents: [], skills: [] },
    };
    write('swarms/installed.json', JSON.stringify([held]));
    write(`swarms/${realId}/seed.json`, JSON.stringify({ files: { 'skills/other/SKILL.md': 'x' }, parts: {} }));

    await adopt();

    expect(installedJson()).toEqual([held]);
    const own = readJson<{ files: Record<string, string> }>(`swarms/${realId}/seed.json`);
    expect(Object.keys(own.files).sort()).toEqual([...Object.keys(FILES), 'skills/other/SKILL.md'].sort());
    expect(readJson('.seed.json')).toEqual(EMPTY);
    expect(existsSync(hive('swarms/bundled-standard'))).toBe(false);
    expect(existsSync(hive('swarms/adopted'))).toBe(true);
  });

  it('finishes a run that died after writing the entry, without a second entry', async () => {
    seededHome();
    await adopt();
    const entry = installedJson();
    // Back to the moment after the entry landed: `.seed.json` still full, no swarm manifest, no marker.
    write('.seed.json', JSON.stringify(seededManifest()));
    rmSync(hive('swarms/bundled-standard'), { recursive: true });
    rmSync(hive('swarms/adopted'));

    await adopt();

    expect(installedJson()).toEqual(entry);
    expect(readJson('swarms/bundled-standard/seed.json')).toEqual(seededManifest());
    expect(readJson('.seed.json')).toEqual(EMPTY);
    expect(existsSync(hive('swarms/adopted'))).toBe(true);
  });

  it('finishes a run that died mid-takeover, leaving each entry once', async () => {
    seededHome();
    await adopt();
    // Back to the moment after the swarm's manifest landed and before `.seed.json` was emptied.
    write('.seed.json', JSON.stringify(seededManifest()));
    rmSync(hive('swarms/adopted'));

    await adopt();

    expect(readJson('swarms/bundled-standard/seed.json')).toEqual(seededManifest());
    expect(readJson('.seed.json')).toEqual(EMPTY);
    expect(installedJson()).toHaveLength(1);
  });

  it('rejects on an installed.json that is not JSON, writing neither the marker nor a manifest', async () => {
    seededHome();
    write('swarms/installed.json', 'not json');

    await expect(adopt()).rejects.toThrow();

    expect(readHive('swarms/installed.json')).toBe('not json');
    expect(existsSync(hive('swarms/adopted'))).toBe(false);
    expect(existsSync(hive('swarms/bundled-standard'))).toBe(false);
    expect(readJson('.seed.json')).toEqual(seededManifest());
  });

  it('names a file the swarm reader cannot read, with an empty description', async () => {
    seededHome();
    write('agents/builder/AGENT.md', 'no frontmatter at all\n');

    await adopt();

    const agents = installedJson()[0]?.contents.agents;
    expect(agents).toEqual([
      { name: 'builder', description: '', tools: [] },
      { name: 'shipper', description: 'Helps with shipper.', tools: ['Read', 'Bash'] },
    ]);
  });
});
