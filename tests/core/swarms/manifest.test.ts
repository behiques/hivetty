// @vitest-environment node
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SwarmProblem } from '@shared/swarm-contract';

import { readBundle } from '../../../core/skills/bundle';
import { readSwarm } from '../../../core/swarms/manifest';

/*
  The real `readBundle`, wrapped so one test can see which folders were walked:
  a linked entry dropped after the walk and one never walked look the same in
  `contents`. `restoreMocks` reverts it to the real call before every test.
*/
vi.mock('../../../core/skills/bundle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/skills/bundle')>();
  return { ...actual, readBundle: vi.fn(actual.readBundle) };
});

const MANIFEST = {
  name: 'standard',
  title: 'Standard',
  description: 'Ticket to merge: plan, build, review, ship.',
  publisher: 'HiveTTY',
  version: '1.0.0',
  tags: ['workflow', 'review'],
};

const SKILL = '---\nname: tdd\ndescription: Test first.\n---\nbody\n';

const agentSource = (name: string, skills = '[tdd]'): string => `---
name: ${name}
description: Helps out.
icon: Ghost
skills: ${skills}
tools: [Read, Bash]
---
Wait to be asked.
`;

let tmp: string;
let dir: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hive-swarm-'));
  dir = join(tmp, 'swarm');
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** Write a valid swarm at `at`: the spec's swarm.json, skill `tdd`, agent `helper`. */
async function swarm(
  at: string,
  options: { manifest?: unknown; agents?: boolean; skills?: boolean } = {},
): Promise<void> {
  await mkdir(at, { recursive: true });
  if (options.manifest !== null) {
    await writeFile(join(at, 'swarm.json'), JSON.stringify(options.manifest ?? MANIFEST), 'utf8');
  }
  if (options.skills !== false) {
    await mkdir(join(at, 'skills', 'tdd'), { recursive: true });
    await writeFile(join(at, 'skills', 'tdd', 'SKILL.md'), SKILL, 'utf8');
  }
  if (options.agents !== false) {
    await mkdir(join(at, 'agents', 'helper'), { recursive: true });
    await writeFile(join(at, 'agents', 'helper', 'AGENT.md'), agentSource('helper'), 'utf8');
  }
}

const fields = (problems: SwarmProblem[]): string[] => problems.map((problem) => problem.field);

describe('readSwarm', () => {
  it('reads a valid swarm with no problems', async () => {
    await swarm(dir);

    const read = await readSwarm(dir);

    expect(read.problems).toEqual([]);
    expect(read.manifest).toEqual(MANIFEST);
    expect(read.contents).toEqual({
      agents: [{ name: 'helper', description: 'Helps out.', tools: ['Read', 'Bash'] }],
      skills: [{ name: 'tdd', description: 'Test first.' }],
    });
  });

  it('reports a missing swarm.json on the whole swarm', async () => {
    await swarm(dir, { manifest: null });

    const read = await readSwarm(dir);

    expect(read.manifest).toBeNull();
    expect(fields(read.problems)).toEqual(['']);
    expect(read.problems[0]?.reason).toContain('No swarm.json');
  });

  it('reports a swarm.json that is not JSON', async () => {
    await swarm(dir);
    await writeFile(join(dir, 'swarm.json'), '{', 'utf8');

    const read = await readSwarm(dir);

    expect(read.manifest).toBeNull();
    expect(fields(read.problems)).toEqual(['']);
    expect(read.problems[0]?.reason).toContain('not valid JSON');
  });

  it('never follows a swarm.json that is a symlink', async () => {
    await swarm(dir, { manifest: null });
    const elsewhere = join(tmp, 'elsewhere.json');
    await writeFile(elsewhere, JSON.stringify(MANIFEST), 'utf8');
    await symlink(elsewhere, join(dir, 'swarm.json'));

    const read = await readSwarm(dir);

    expect(read.manifest).toBeNull();
    expect(fields(read.problems)).toEqual(['']);
    expect(read.problems[0]?.reason).toContain('symlink');
  });

  it('reports a bad manifest field by name', async () => {
    await swarm(dir, { manifest: { ...MANIFEST, version: '1.0' } });

    const read = await readSwarm(dir);

    expect(read.manifest).toBeNull();
    expect(fields(read.problems)).toEqual(['version']);
  });

  it('reports an agent folder with no AGENT.md and leaves it out', async () => {
    await swarm(dir);
    await rm(join(dir, 'agents', 'helper', 'AGENT.md'));

    const read = await readSwarm(dir);

    expect(fields(read.problems)).toEqual(['agents/helper']);
    expect(read.contents.agents).toEqual([]);
  });

  it('never follows an AGENT.md that is a symlink', async () => {
    await swarm(dir);
    const elsewhere = join(tmp, 'AGENT.md');
    await writeFile(elsewhere, agentSource('helper'), 'utf8');
    await rm(join(dir, 'agents', 'helper', 'AGENT.md'));
    await symlink(elsewhere, join(dir, 'agents', 'helper', 'AGENT.md'));

    const read = await readSwarm(dir);

    expect(fields(read.problems)).toEqual(['agents/helper']);
    expect(read.contents.agents).toEqual([]);
  });

  it('never follows an agent folder that is a symlink', async () => {
    await swarm(dir);
    const outside = join(tmp, 'outside-agent', 'linked');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'AGENT.md'), agentSource('linked'), 'utf8');
    await symlink(outside, join(dir, 'agents', 'linked'));

    const read = await readSwarm(dir);

    expect(fields(read.problems)).toEqual(['agents/linked']);
    expect(read.contents.agents.map((agent) => agent.name)).toEqual(['helper']);
  });

  it('never follows a skill folder that is a symlink, and reports it once', async () => {
    await swarm(dir);
    const outside = join(tmp, 'outside-skill', 'linked');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'SKILL.md'), '---\nname: linked\ndescription: Elsewhere.\n---\n', 'utf8');
    await symlink(outside, join(dir, 'skills', 'linked'));

    const read = await readSwarm(dir);

    expect(fields(read.problems)).toEqual(['skills/linked']);
    expect(read.contents.skills.map((skill) => skill.name)).toEqual(['tdd']);
    expect(vi.mocked(readBundle).mock.calls.map(([walked]) => walked)).toEqual([join(dir, 'skills', 'tdd')]);
  });

  it('reports a linked skill entry once even when its target is invalid', async () => {
    await swarm(dir);
    const outside = join(tmp, 'outside-skill', 'linked');
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(dir, 'skills', 'linked'));

    const read = await readSwarm(dir);

    expect(fields(read.problems)).toEqual(['skills/linked']);
  });

  it('never reads a SKILL.md that is a symlink', async () => {
    await swarm(dir);
    const elsewhere = join(tmp, 'SKILL.md');
    await writeFile(elsewhere, '---\nname: secret-text\n---\n', 'utf8');
    await rm(join(dir, 'skills', 'tdd', 'SKILL.md'));
    await symlink(elsewhere, join(dir, 'skills', 'tdd', 'SKILL.md'));

    const read = await readSwarm(dir);

    // Its agent names the refused skill, which leaves the swarm empty.
    expect(fields(read.problems)).toEqual(['skills/tdd', 'agents/helper', '']);
    expect(read.problems[0]?.reason).toContain('symlink');
    expect(JSON.stringify(read.problems)).not.toContain('secret-text');
    expect(read.contents.skills).toEqual([]);
  });

  it('never follows a skills folder that is a symlink', async () => {
    await swarm(dir, { skills: false });
    const outside = join(tmp, 'outside-skills');
    await mkdir(join(outside, 'tdd'), { recursive: true });
    await writeFile(join(outside, 'tdd', 'SKILL.md'), SKILL, 'utf8');
    await symlink(outside, join(dir, 'skills'));

    const read = await readSwarm(dir);

    expect(fields(read.problems)).toContain('skills');
    expect(read.contents.skills).toEqual([]);
  });

  it('refuses a skill that holds a symlink', async () => {
    await swarm(dir);
    await writeFile(join(tmp, 'notes.md'), 'notes\n', 'utf8');
    await symlink(join(tmp, 'notes.md'), join(dir, 'skills', 'tdd', 'notes.md'));

    const read = await readSwarm(dir);

    expect(fields(read.problems)).toContain('skills/tdd');
    expect(read.contents.skills).toEqual([]);
  });

  it('refuses a skill folder past the file cap', async () => {
    await swarm(dir);
    await Promise.all(
      Array.from({ length: 201 }, (_, index) =>
        writeFile(join(dir, 'skills', 'tdd', `f${String(index)}.md`), 'x', 'utf8'),
      ),
    );

    const read = await readSwarm(dir);

    expect(fields(read.problems)).toContain('skills/tdd');
    expect(read.contents.skills).toEqual([]);
  });

  it('refuses a skill folder with no SKILL.md', async () => {
    await swarm(dir, { agents: false });
    await rm(join(dir, 'skills', 'tdd', 'SKILL.md'));
    await mkdir(join(dir, 'skills', 'other'), { recursive: true });
    await writeFile(join(dir, 'skills', 'other', 'SKILL.md'), '---\nname: other\ndescription: Other.\n---\n', 'utf8');

    const read = await readSwarm(dir);

    expect(fields(read.problems)).toEqual(['skills/tdd']);
    expect(read.contents.skills.map((skill) => skill.name)).toEqual(['other']);
  });

  it('refuses a reserved agent name', async () => {
    await swarm(dir);
    await mkdir(join(dir, 'agents', 'overmind'), { recursive: true });
    await writeFile(join(dir, 'agents', 'overmind', 'AGENT.md'), agentSource('overmind'), 'utf8');

    const read = await readSwarm(dir);

    expect(fields(read.problems)).toEqual(['agents/overmind']);
    expect(read.contents.agents.map((agent) => agent.name)).toEqual(['helper']);
  });

  it('refuses an agent that names a skill outside its swarm', async () => {
    await swarm(dir);
    await writeFile(join(dir, 'agents', 'helper', 'AGENT.md'), agentSource('helper', '[nope]'), 'utf8');

    const read = await readSwarm(dir);

    expect(fields(read.problems)).toEqual(['agents/helper']);
    expect(read.problems[0]?.reason.startsWith('skills:')).toBe(true);
    expect(read.contents.agents).toEqual([]);
  });

  it('ignores a loose file under agents/', async () => {
    await swarm(dir);
    await writeFile(join(dir, 'agents', 'README.md'), '# agents\n', 'utf8');

    expect((await readSwarm(dir)).problems).toEqual([]);
  });

  it('reports a swarm with no agents and no skills', async () => {
    await swarm(dir, { agents: false, skills: false });

    const read = await readSwarm(dir);

    expect(read.manifest).toEqual(MANIFEST);
    expect(fields(read.problems)).toEqual(['']);
  });

  it('reports a directory that does not exist without throwing', async () => {
    const read = await readSwarm(join(tmp, 'nowhere'));

    expect(read.manifest).toBeNull();
    expect(fields(read.problems)).toEqual(['', '']);
    expect(read.contents).toEqual({ agents: [], skills: [] });
  });

  describe('minApp', () => {
    beforeEach(async () => {
      await swarm(dir, { manifest: { ...MANIFEST, minApp: '1.1.0' } });
    });

    it('reports an app older than minApp, keeping the manifest', async () => {
      const read = await readSwarm(dir, { appVersion: '1.0.0-rc.12' });

      expect(read.manifest).not.toBeNull();
      expect(read.problems).toHaveLength(1);
      expect(read.problems[0]).toMatchObject({ field: 'minApp', code: 'needs-newer-app' });
      expect(read.problems[0]?.reason).toContain('1.1.0');
      expect(read.problems[0]?.reason).toContain('1.0.0-rc.12');
    });

    it('accepts a release candidate of minApp', async () => {
      expect((await readSwarm(dir, { appVersion: '1.1.0-rc.1' })).problems).toEqual([]);
    });

    it('skips the rule with no appVersion', async () => {
      expect((await readSwarm(dir)).problems).toEqual([]);
    });
  });

  it('reads the Standard swarm from resources/ with no problems', async () => {
    const root = resolve(import.meta.dirname, '../../..');
    await mkdir(dir, { recursive: true });
    await cp(join(root, 'resources', 'agents'), join(dir, 'agents'), { recursive: true });
    await cp(join(root, 'resources', 'skills'), join(dir, 'skills'), { recursive: true });
    await writeFile(join(dir, 'swarm.json'), JSON.stringify(MANIFEST), 'utf8');

    const read = await readSwarm(dir);

    expect(read.problems).toEqual([]);
    expect(read.contents.agents.map((agent) => agent.name)).toEqual(['acr', 'builder', 'fixer', 'shipper']);
    expect(read.contents.skills).toHaveLength(14);
    for (const skill of read.contents.skills) expect(skill.description).not.toBe('');
    expect(read.contents.agents.find((agent) => agent.name === 'builder')?.tools).toContain(
      'mcp__hive__jira_transition',
    );
  });
});
