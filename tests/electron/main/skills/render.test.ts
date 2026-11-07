// @vitest-environment node
import { readFileSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderSkills } from '../../../../electron/main/skills/render';
import { readUserSkills } from '../../../../electron/main/skills/read';
import { renderSkillText } from '../../../../electron/shared/skill-render';

/**
 * Pass-through spies on `copyFile` and `writeFile`, in the shape
 * `hooks/index.test.ts` already uses for `writeFile`: everything forwards to
 * the real implementation, so every other test in this file that copies or
 * writes a file keeps working unchanged. Only the two tests below that ask
 * "did the skip actually skip?" read call counts, filtered to the one
 * destination path they care about — every other test in this file also
 * calls `writeFile` (the manifest, `/done`, every skill's `SKILL.md`), so an
 * unfiltered total would not isolate the one write under test.
 */
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    copyFile: vi.fn(actual.copyFile),
    writeFile: vi.fn(actual.writeFile),
  };
});

const copyFileSpy = vi.mocked((await import('node:fs/promises')).copyFile);
const writeFileSpy = vi.mocked((await import('node:fs/promises')).writeFile);

let pluginRoot: string;
let source: string;

beforeEach(async () => {
  pluginRoot = join(await mkdtemp(join(tmpdir(), 'hive-plugin-')), 'plugin');
  source = await mkdtemp(join(tmpdir(), 'hive-skills-'));
});

/**
 * Write a minimal valid skill folder under `source`, so the fixtures below
 * come from `readUserSkills` reading real files — not a hand-built
 * `SkillsRead` whose `manifest` and `dir` were never exercised.
 */
async function writeSkill(name: string, body?: string): Promise<void> {
  await mkdir(join(source, name), { recursive: true });
  await writeFile(
    join(source, name, 'SKILL.md'),
    body ?? `---\nname: ${name}\ndescription: d\n---\nBody.\n`,
    'utf8',
  );
}

const skillsIn = (root: string): Promise<string[]> =>
  readdir(join(root, 'skills')).then((names) => names.sort());

describe('renderSkills', () => {
  it('writes the folder it renders into as {{plugin_root}} for Codex and Copilot, and the env var for Claude', async () => {
    await writeSkill('rooted', '---\nname: rooted\ndescription: d\n---\nRun {{plugin_root}}/x.mjs\n');
    const read = await readUserSkills(source);
    for (const [cli, expected] of [
      ['codex', `Run ${pluginRoot}/x.mjs`],
      ['copilot', `Run ${pluginRoot}/x.mjs`],
      ['claude-code', 'Run $CLAUDE_PLUGIN_ROOT/x.mjs'],
    ] as const) {
      await renderSkills(pluginRoot, cli, read, { version: '1.0.0', doneUrl: null });
      expect(await readFile(join(pluginRoot, 'skills', 'rooted', 'SKILL.md'), 'utf8')).toContain(expected);
    }
  });

  it('writes a manifest Claude Code can load', async () => {
    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '9.9.9', doneUrl: null });

    const manifest: unknown = JSON.parse(
      await readFile(
        join(pluginRoot, '.claude-plugin', 'plugin.json'),
        'utf8',
      ),
    );

    expect(manifest).toMatchObject({
      name: 'hive',
      version: '9.9.9',
      skills: ['./skills/'],
    });
  });

  it('always writes the app-owned /done skill', async () => {
    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    const body = await readFile(
      join(pluginRoot, 'skills', 'done', 'SKILL.md'),
      'utf8',
    );

    expect(body).toMatch(/^---\n/);
    expect(body).toMatch(/name: done/);
  });

  it('copies each user skill verbatim', async () => {
    await writeSkill('standup');

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    const body = await readFile(
      join(pluginRoot, 'skills', 'standup', 'SKILL.md'),
      'utf8',
    );

    expect(body).toBe('---\nname: standup\ndescription: d\n---\nBody.\n');
  });

  it('removes a skill the user deleted, so the command goes away', async () => {
    await writeSkill('standup');
    await writeSkill('triage');
    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    await rm(join(source, 'standup'), { recursive: true, force: true });
    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    expect(await skillsIn(pluginRoot)).toEqual(['done', 'triage']);
  });

  it('removes junk that is not a skill at all', async () => {
    await mkdir(join(pluginRoot, 'skills', 'stray'), { recursive: true });
    await writeFile(
      join(pluginRoot, 'skills', 'stray', 'note.txt'),
      'x',
      'utf8',
    );

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    expect(await skillsIn(pluginRoot)).toEqual(['done']);
  });

  it('rewrites /done every time, so tampering cannot persist', async () => {
    // The app owns this file. A copy edited in userData surviving a launch
    // would make the built-in mean something different per machine.
    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });
    await writeFile(
      join(pluginRoot, 'skills', 'done', 'SKILL.md'),
      'tampered',
      'utf8',
    );

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    const body = await readFile(
      join(pluginRoot, 'skills', 'done', 'SKILL.md'),
      'utf8',
    );
    expect(body).not.toBe('tampered');
  });

  it('never writes an invalid skill', async () => {
    // A folder with no SKILL.md is invalid — readUserSkills rejects it and
    // reports it through `invalid`, not `skills`.
    await mkdir(join(source, 'bad'), { recursive: true });

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    expect(await skillsIn(pluginRoot)).toEqual(['done']);
  });

  it('is idempotent, because it runs before every spawn', async () => {
    await writeSkill('standup');

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });
    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    expect(await skillsIn(pluginRoot)).toEqual(['done', 'standup']);
  });

  it('copies every admitted entry into the plugin directory', async () => {
    await mkdir(join(source, 'graphify', 'scripts'), { recursive: true });
    await writeFile(
      join(source, 'graphify', 'SKILL.md'),
      '---\nname: graphify\n---\nrun scripts/build.py\n',
      'utf8',
    );
    await writeFile(
      join(source, 'graphify', 'scripts', 'build.py'),
      'print(1)\n',
      'utf8',
    );

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    const copied = join(
      pluginRoot,
      'skills',
      'graphify',
      'scripts',
      'build.py',
    );
    expect(await readFile(copied, 'utf8')).toBe('print(1)\n');
  });

  it('preserves the executable bit so a script stays runnable', async () => {
    await mkdir(join(source, 'graphify', 'scripts'), { recursive: true });
    await writeFile(
      join(source, 'graphify', 'SKILL.md'),
      '---\nname: graphify\n---\n',
      'utf8',
    );
    await writeFile(
      join(source, 'graphify', 'scripts', 'run.sh'),
      '#!/bin/sh\n',
      'utf8',
    );
    await chmod(join(source, 'graphify', 'scripts', 'run.sh'), 0o755);

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    const mode = (
      await stat(join(pluginRoot, 'skills', 'graphify', 'scripts', 'run.sh'))
    ).mode;
    expect(mode & 0o100).not.toBe(0);
  });

  it('propagates a mode change with bytes and mtime unchanged', async () => {
    await mkdir(join(source, 'graphify', 'scripts'), { recursive: true });
    await writeFile(
      join(source, 'graphify', 'SKILL.md'),
      '---\nname: graphify\n---\n',
      'utf8',
    );
    await writeFile(
      join(source, 'graphify', 'scripts', 'run.sh'),
      '#!/bin/sh\n',
      'utf8',
    );

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });
    const copied = join(pluginRoot, 'skills', 'graphify', 'scripts', 'run.sh');
    expect((await stat(copied)).mode & 0o100).toBe(0);

    /*
      `chmod` on its own changes neither a file's bytes nor its mtime — only
      its ctime, which nothing here compares. A size/mtime-only comparison
      would read this file as unchanged and never re-copy it, which is
      exactly how a mode change stopped propagating once the mtime skip was
      fixed on its own.
    */
    await chmod(join(source, 'graphify', 'scripts', 'run.sh'), 0o755);
    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    expect((await stat(copied)).mode & 0o100).not.toBe(0);
  });

  it('does not copy an excluded entry', async () => {
    await mkdir(join(source, 'graphify', 'node_modules'), {
      recursive: true,
    });
    await writeFile(
      join(source, 'graphify', 'SKILL.md'),
      '---\nname: graphify\n---\n',
      'utf8',
    );
    await writeFile(
      join(source, 'graphify', 'node_modules', 'x.js'),
      'x',
      'utf8',
    );

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    await expect(
      stat(join(pluginRoot, 'skills', 'graphify', 'node_modules')),
    ).rejects.toThrow();
  });

  it('skips the actual copy on a second run of an unchanged file', async () => {
    await mkdir(join(source, 'graphify', 'scripts'), { recursive: true });
    await writeFile(
      join(source, 'graphify', 'SKILL.md'),
      '---\nname: graphify\n---\n',
      'utf8',
    );
    await writeFile(
      join(source, 'graphify', 'scripts', 'build.py'),
      'print(1)\n',
      'utf8',
    );

    // A direct count of the underlying syscall, rather than an inference
    // from a side effect: proves `copyIfChanged`'s skip branch itself runs,
    // not just that its outcome happens to look the same either way. Cleared
    // first: earlier tests in this file also call `copyFile`.
    copyFileSpy.mockClear();

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });
    expect(copyFileSpy).toHaveBeenCalledTimes(1);

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });
    expect(copyFileSpy).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: a second run leaves the file untouched', async () => {
    await mkdir(join(source, 'graphify', 'scripts'), { recursive: true });
    await writeFile(
      join(source, 'graphify', 'SKILL.md'),
      '---\nname: graphify\n---\n',
      'utf8',
    );
    await writeFile(
      join(source, 'graphify', 'scripts', 'build.py'),
      'print(1)\n',
      'utf8',
    );

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });
    const copied = join(
      pluginRoot,
      'skills',
      'graphify',
      'scripts',
      'build.py',
    );
    const stamp = await stat(copied);

    /*
      A discriminator a plain mtime comparison across two runs cannot be:
      corrupt the destination's *bytes* while leaving its size, mtime and
      mode exactly as a correct copy would leave them. `copyIfChanged`
      compares only those three, never a hash, so a genuine skip leaves the
      corruption in place — only an (incorrect) unconditional recopy would
      overwrite it back to the source's real content. Comparing mtime alone
      cannot tell the two apart, because `utimes` at the end of every copy
      restores the same mtime whether or not a copy actually happened.
    */
    const corrupted = 'X'.repeat((await readFile(copied, 'utf8')).length);
    await writeFile(copied, corrupted, 'utf8');
    await utimes(copied, stamp.atime, stamp.mtime);

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    expect(await readFile(copied, 'utf8')).toBe(corrupted);
  });

  it('recopies once the source file actually changes', async () => {
    await mkdir(join(source, 'graphify', 'scripts'), { recursive: true });
    await writeFile(
      join(source, 'graphify', 'SKILL.md'),
      '---\nname: graphify\n---\n',
      'utf8',
    );
    await writeFile(
      join(source, 'graphify', 'scripts', 'build.py'),
      'print(1)\n',
      'utf8',
    );

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    // Pairs with the previous test: proves the skip is real rather than a
    // mirror that never copies at all, by showing a genuine source edit
    // does reach the destination.
    await writeFile(
      join(source, 'graphify', 'scripts', 'build.py'),
      'print(2)\n',
      'utf8',
    );
    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    const copied = join(
      pluginRoot,
      'skills',
      'graphify',
      'scripts',
      'build.py',
    );
    expect(await readFile(copied, 'utf8')).toBe('print(2)\n');
  });

  it('prunes a file no longer in the source, inside a subfolder', async () => {
    await mkdir(join(source, 'graphify', 'scripts'), { recursive: true });
    await writeFile(
      join(source, 'graphify', 'SKILL.md'),
      '---\nname: graphify\n---\n',
      'utf8',
    );
    await writeFile(
      join(source, 'graphify', 'scripts', 'old.py'),
      'x',
      'utf8',
    );
    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    await rm(join(source, 'graphify', 'scripts', 'old.py'));
    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    await expect(
      stat(join(pluginRoot, 'skills', 'graphify', 'scripts', 'old.py')),
    ).rejects.toThrow();
  });

  it('writes SKILL.md even when the bundle walk never lists it', async () => {
    await mkdir(join(source, 'graphify', 'assets'), { recursive: true });
    await writeFile(
      join(source, 'graphify', 'SKILL.md'),
      '---\nname: graphify\n---\nBody.\n',
      'utf8',
    );
    /*
      'assets' sorts before 'SKILL.md', and `readBundle` walks in that order
      and stops hard at MAX_BUNDLE_FILES (200). Enough files in here
      exhausts the cap while the walk is still inside 'assets', so the
      manifest it returns never lists 'SKILL.md' at all — the exact
      scenario the docblock's "SKILL.md itself" paragraph describes.
    */
    for (let i = 0; i < 205; i += 1) {
      const name = `f${String(i).padStart(3, '0')}.txt`;
      await writeFile(join(source, 'graphify', 'assets', name), 'x', 'utf8');
    }

    const read = await readUserSkills(source);
    expect(
      read.skills[0]?.manifest.entries.some(
        (entry) => entry.path === 'SKILL.md',
      ),
    ).toBe(false);

    await renderSkills(pluginRoot, 'claude-code', read, { version: '1.0.0', doneUrl: null });

    const body = await readFile(
      join(pluginRoot, 'skills', 'graphify', 'SKILL.md'),
      'utf8',
    );
    expect(body).toBe('---\nname: graphify\n---\nBody.\n');
  });

  it('replaces a stale directory with a same-named file', async () => {
    await mkdir(join(source, 'graphify', 'notes'), { recursive: true });
    await writeFile(
      join(source, 'graphify', 'SKILL.md'),
      '---\nname: graphify\n---\n',
      'utf8',
    );
    await writeFile(join(source, 'graphify', 'notes', 'a.txt'), 'a', 'utf8');
    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });
    const flipped = join(pluginRoot, 'skills', 'graphify', 'notes');
    expect((await stat(flipped)).isDirectory()).toBe(true);

    await rm(join(source, 'graphify', 'notes'), {
      recursive: true,
      force: true,
    });
    await writeFile(
      join(source, 'graphify', 'notes'),
      'now a file\n',
      'utf8',
    );

    // Must not throw `EISDIR` and must not leave every later regeneration
    // throwing the same way.
    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    expect((await stat(flipped)).isFile()).toBe(true);
    expect(await readFile(flipped, 'utf8')).toBe('now a file\n');
  });

  it('replaces a stale file with a same-named directory', async () => {
    await mkdir(join(source, 'graphify'), { recursive: true });
    await writeFile(
      join(source, 'graphify', 'SKILL.md'),
      '---\nname: graphify\n---\n',
      'utf8',
    );
    await writeFile(join(source, 'graphify', 'notes'), 'a file\n', 'utf8');
    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });
    const flipped = join(pluginRoot, 'skills', 'graphify', 'notes');
    expect((await stat(flipped)).isFile()).toBe(true);

    await rm(join(source, 'graphify', 'notes'));
    await mkdir(join(source, 'graphify', 'notes'), { recursive: true });
    await writeFile(join(source, 'graphify', 'notes', 'a.txt'), 'a', 'utf8');

    // Must not throw `EEXIST` and must not leave every later regeneration
    // throwing the same way.
    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    expect((await stat(flipped)).isDirectory()).toBe(true);
    expect(await readFile(join(flipped, 'a.txt'), 'utf8')).toBe('a');
  });

  it('never lets a destination symlink escape the plugin root', async () => {
    await mkdir(join(source, 'graphify', 'assets'), { recursive: true });
    await writeFile(
      join(source, 'graphify', 'SKILL.md'),
      '---\nname: graphify\n---\n',
      'utf8',
    );
    await writeFile(join(source, 'graphify', 'assets', 'a.txt'), 'a', 'utf8');

    // A directory outside pluginRoot that a stale symlink could resolve
    // through, if `mkdir({ recursive: true })` or `copyFile` ever followed
    // it.
    const outside = await mkdtemp(join(tmpdir(), 'hive-outside-'));
    await mkdir(join(pluginRoot, 'skills', 'graphify'), { recursive: true });
    await symlink(outside, join(pluginRoot, 'skills', 'graphify', 'assets'));

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    const dest = join(pluginRoot, 'skills', 'graphify', 'assets');
    expect((await lstat(dest)).isSymbolicLink()).toBe(false);
    expect((await stat(dest)).isDirectory()).toBe(true);
    expect(await readFile(join(dest, 'a.txt'), 'utf8')).toBe('a');
    // Nothing was ever written through the old symlink target.
    expect(await readdir(outside)).toEqual([]);
  });

  it('does not rewrite an unchanged SKILL.md on a second run', async () => {
    await writeSkill('standup');
    const target = join(pluginRoot, 'skills', 'standup', 'SKILL.md');
    const callsToTarget = (): number =>
      writeFileSpy.mock.calls.filter((call) => call[0] === target).length;

    // Cleared first: earlier tests in this file also call `writeFile` (the
    // manifest, `/done`, other skills' `SKILL.md`), and this run's own
    // manifest and `/done` writes are not what this test is about.
    writeFileSpy.mockClear();

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });
    expect(callsToTarget()).toBe(1);

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });
    expect(callsToTarget()).toBe(1);
  });

  it('never lets a symlinked skill root escape the plugin root', async () => {
    await writeSkill('standup');

    // A directory outside pluginRoot that a stale symlink could resolve
    // through, if the recursive `mkdir` for the skill root ever followed it.
    const outside = await mkdtemp(join(tmpdir(), 'hive-outside-'));
    await mkdir(join(pluginRoot, 'skills'), { recursive: true });
    await symlink(outside, join(pluginRoot, 'skills', 'standup'));

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    const dest = join(pluginRoot, 'skills', 'standup');
    expect((await lstat(dest)).isSymbolicLink()).toBe(false);
    expect(await readFile(join(dest, 'SKILL.md'), 'utf8')).toBe(
      '---\nname: standup\ndescription: d\n---\nBody.\n',
    );
    // Nothing was ever written through the old symlink target.
    expect(await readdir(outside)).toEqual([]);
  });

  it("never lets a symlinked extra's folder escape the plugin root (HIVE-369)", async () => {
    // `/done` is an extra under `skills/done/`; a stale symlink there must not
    // carry its write outside pluginRoot.
    const outside = await mkdtemp(join(tmpdir(), 'hive-outside-'));
    await mkdir(join(pluginRoot, 'skills'), { recursive: true });
    await symlink(outside, join(pluginRoot, 'skills', 'done'));

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    expect((await lstat(join(pluginRoot, 'skills', 'done'))).isSymbolicLink()).toBe(false);
    expect(await readdir(outside)).toEqual([]);
  });

  it("repairs a file where an extra's folder belongs (HIVE-369)", async () => {
    await mkdir(join(pluginRoot, 'skills'), { recursive: true });
    await writeFile(join(pluginRoot, 'skills', 'done'), 'stale', 'utf8');

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    expect((await lstat(join(pluginRoot, 'skills', 'done'))).isDirectory()).toBe(true);
  });

  it('never lets a symlinked SKILL.md escape the plugin root', async () => {
    await writeSkill('standup');

    // A file outside pluginRoot that a stale symlink could resolve through,
    // if the body write ever followed it.
    const outside = await mkdtemp(join(tmpdir(), 'hive-outside-'));
    const outsideFile = join(outside, 'escaped.md');
    await writeFile(outsideFile, 'stale', 'utf8');
    await mkdir(join(pluginRoot, 'skills', 'standup'), { recursive: true });
    await symlink(
      outsideFile,
      join(pluginRoot, 'skills', 'standup', 'SKILL.md'),
    );

    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    const target = join(pluginRoot, 'skills', 'standup', 'SKILL.md');
    expect((await lstat(target)).isSymbolicLink()).toBe(false);
    expect(await readFile(target, 'utf8')).toBe(
      '---\nname: standup\ndescription: d\n---\nBody.\n',
    );
    // Nothing was ever written through the old symlink target.
    expect(await readFile(outsideFile, 'utf8')).toBe('stale');
  });

  it('replaces a stale directory occupying the SKILL.md path', async () => {
    await writeSkill('standup');

    await mkdir(join(pluginRoot, 'skills', 'standup', 'SKILL.md'), {
      recursive: true,
    });
    await writeFile(
      join(pluginRoot, 'skills', 'standup', 'SKILL.md', 'stray.txt'),
      'x',
      'utf8',
    );

    // Must not throw `EISDIR` and must not leave every later regeneration
    // throwing the same way.
    await renderSkills(pluginRoot, 'claude-code', await readUserSkills(source), { version: '1.0.0', doneUrl: null });

    const target = join(pluginRoot, 'skills', 'standup', 'SKILL.md');
    expect((await stat(target)).isFile()).toBe(true);
    expect(await readFile(target, 'utf8')).toBe(
      '---\nname: standup\ndescription: d\n---\nBody.\n',
    );
  });

  /**
   * One unreadable file must cost that file, not the plugin (HIVE-148 review).
   *
   * `read.ts` and `bundle.ts` already hold this rule for the walk that
   * produces a manifest; this is the copy loop that mirrors it, and it did
   * not hold the rule until this story's review found it. Reproduced the way
   * the finding names as most likely — a file gone between the walk and the
   * copy, since `~/.hivetty/skills` is hand-editable by design — rather than a
   * permission bit, which a test running as root would not reproduce at all.
   *
   * Before the fix this `renderSkills` call rejected outright: `stat` on
   * the vanished source threw inside `copyIfChanged`, uncaught, straight out
   * of the function. `regenerate`'s own `catch` (`electron/main/skills/index.ts`)
   * is what turns that into `written = false` and drops `--plugin-dir` from
   * every spawn — including `/done`'s — which is why the assertion below also
   * checks that `/done` still landed, not only that this one skill survived.
   */
  it('mirrors every other file when one goes missing between the walk and the copy', async () => {
    await mkdir(join(source, 'graphify'), { recursive: true });
    await writeFile(
      join(source, 'graphify', 'SKILL.md'),
      '---\nname: graphify\ndescription: d\n---\nBody.\n',
      'utf8',
    );
    await writeFile(join(source, 'graphify', 'ok.txt'), 'fine', 'utf8');
    await writeFile(join(source, 'graphify', 'gone.txt'), 'will vanish', 'utf8');

    const read = await readUserSkills(source);
    await rm(join(source, 'graphify', 'gone.txt'));

    await expect(
      renderSkills(pluginRoot, 'claude-code', read, { version: '1.0.0', doneUrl: null }),
    ).resolves.toBeUndefined();

    expect(
      await readFile(join(pluginRoot, 'skills', 'graphify', 'SKILL.md'), 'utf8'),
    ).toContain('name: graphify');
    expect(
      await readFile(join(pluginRoot, 'skills', 'graphify', 'ok.txt'), 'utf8'),
    ).toBe('fine');
    await expect(
      stat(join(pluginRoot, 'skills', 'graphify', 'gone.txt')),
    ).rejects.toThrow();
    // The rest of the plugin, `/done` included, is unaffected.
    await expect(
      stat(join(pluginRoot, 'skills', 'done', 'SKILL.md')),
    ).resolves.toBeDefined();
  });
});

describe('per CLI (HIVE-369)', () => {
  const body = (name: string, extra = ''): string =>
    `---\nname: ${name}\ndescription: d\n${extra}---\nCall {{tool:ledger_ask}}, then {{skill:plan}}.\n`;

  it('fills each CLI its own names', async () => {
    await writeSkill('flow', body('flow'));
    const read = await readUserSkills(source);
    const out = await mkdtemp(join(tmpdir(), 'hive-cli-'));
    for (const cli of ['claude-code', 'codex', 'copilot'] as const) {
      await renderSkills(join(out, cli), cli, read, { version: '1', doneUrl: null });
    }
    const text = (cli: string) => readFile(join(out, cli, 'skills', 'flow', 'SKILL.md'), 'utf8');
    expect(await text('claude-code')).toContain('Call mcp__hive__ledger_ask, then hive:plan.');
    expect(await text('codex')).toContain('Call mcp__hive__ledger_ask, then $hive-plan.');
    expect(await text('copilot')).toContain('Call hive-ledger_ask, then /hive:hive-plan.');
  });

  it('gives every CLI every skill and its done (HIVE-368), and lists each in the Codex catalog', async () => {
    await writeSkill('flow', body('flow'));
    await writeSkill('review', body('review'));
    const read = await readUserSkills(source);
    for (const cli of ['claude-code', 'codex', 'copilot'] as const) {
      await renderSkills(join(pluginRoot, cli), cli, read, { version: '1', doneUrl: null });
    }
    expect((await readdir(join(pluginRoot, 'codex', 'skills'))).sort()).toEqual(['done', 'flow', 'review']);
    expect((await readdir(join(pluginRoot, 'copilot', 'skills'))).sort()).toEqual(['done', 'flow', 'review']);
    expect(await readFile(join(pluginRoot, 'codex', 'catalog.md'), 'utf8')).toContain('- hive-review: d (file: ');
    expect(await readFile(join(pluginRoot, 'codex', 'catalog.md'), 'utf8')).toContain('- hive-done: Finish this session');
  });

  it("drops goal-on's hooks: for Codex and keeps them for Claude Code", async () => {
    const goal = '---\nname: goal\ndescription: d\nhooks:\n  Stop:\n    - type: command\n---\nbody\n';
    await writeSkill('goal', goal);
    const read = await readUserSkills(source);
    await renderSkills(join(pluginRoot, 'claude-code'), 'claude-code', read, { version: '1', doneUrl: null });
    await renderSkills(join(pluginRoot, 'codex'), 'codex', read, { version: '1', doneUrl: null });
    expect(await readFile(join(pluginRoot, 'claude-code', 'skills', 'goal', 'SKILL.md'), 'utf8')).toBe(goal);
    expect(await readFile(join(pluginRoot, 'codex', 'skills', 'goal', 'SKILL.md'), 'utf8')).toBe(
      '---\nname: hive-goal\ndescription: d\n---\nbody\n',
    );
  });

  it('tells every CLI how the brief is named and which verifiers run (HIVE-370)', () => {
    const source = readFileSync(join(process.cwd(), 'resources/skills/goal-on/SKILL.md'), 'utf8');
    for (const cli of ['claude-code', 'codex', 'copilot'] as const) {
      const text = renderSkillText(source, cli, '/root');
      expect(text).toContain('`~/.hivetty/goals/<$HIVE_SESSION_ID>.md`');
      expect(text).toContain('on Codex and Copilot only the command verifier runs');
    }
  });

  it('copies a skill with no placeholder as written, but for its hive- name (HIVE-382)', async () => {
    const literal = '---\nname: mine\ndescription: d\n---\nUse mcp__hive__ledger_ask.\n';
    await writeSkill('mine', literal);
    await renderSkills(pluginRoot, 'copilot', await readUserSkills(source), { version: '1', doneUrl: null });
    expect(await readFile(join(pluginRoot, 'skills', 'mine', 'SKILL.md'), 'utf8')).toBe(
      literal.replace('name: mine', 'name: hive-mine'),
    );
  });

  it('renders a bundle markdown file and copies the rest', async () => {
    await writeSkill('flow', body('flow'));
    await mkdir(join(source, 'flow', 'prompts'), { recursive: true });
    await writeFile(join(source, 'flow', 'prompts', 'p.md'), 'ask {{tool:pr}}', 'utf8');
    await writeFile(join(source, 'flow', 'prompts', 'p.txt'), 'ask {{tool:pr}}', 'utf8');
    await renderSkills(pluginRoot, 'copilot', await readUserSkills(source), { version: '1', doneUrl: null });
    expect(await readFile(join(pluginRoot, 'skills', 'flow', 'prompts', 'p.md'), 'utf8')).toBe('ask hive-pr');
    expect(await readFile(join(pluginRoot, 'skills', 'flow', 'prompts', 'p.txt'), 'utf8')).toBe('ask {{tool:pr}}');
  });

  it('rewrites an unchanged extra never, and a tampered one every run', async () => {
    const manifestPath = join(pluginRoot, '.claude-plugin', 'plugin.json');
    const writes = (): number => writeFileSpy.mock.calls.filter(([path]) => path === manifestPath).length;
    await renderSkills(pluginRoot, 'copilot', await readUserSkills(source), { version: '1', doneUrl: null });
    writeFileSpy.mockClear();
    await renderSkills(pluginRoot, 'copilot', await readUserSkills(source), { version: '1', doneUrl: null });
    expect(writes()).toBe(0);
    await writeFile(manifestPath, 'tampered', 'utf8');
    writeFileSpy.mockClear();
    await renderSkills(pluginRoot, 'copilot', await readUserSkills(source), { version: '1', doneUrl: null });
    expect(writes()).toBe(1);
    expect(await readFile(manifestPath, 'utf8')).toContain('"name": "hive"');
  });

  it('is idempotent for every CLI', async () => {
    await writeSkill('flow', body('flow'));
    const read = await readUserSkills(source);
    for (const cli of ['claude-code', 'codex', 'copilot'] as const) {
      const root = join(pluginRoot, cli);
      await renderSkills(root, cli, read, { version: '1', doneUrl: null });
      const first = await readdir(root, { recursive: true });
      await renderSkills(root, cli, read, { version: '1', doneUrl: null });
      expect(await readdir(root, { recursive: true })).toEqual(first);
    }
  });
});

describe('renderSkills transform (HIVE-372)', () => {
  it('applies transform to every SKILL.md, done included, and to nothing else', async () => {
    await writeSkill('tdd', '---\nname: tdd\ndescription: t\n---\nbody\n');
    await mkdir(join(source, 'tdd', 'refs'), { recursive: true });
    await writeFile(join(source, 'tdd', 'refs', 'more.md'), 'more\n');
    await renderSkills(pluginRoot, 'codex', await readUserSkills(source), {
      version: '1.0.0',
      doneUrl: null,
      transform: (text) => `MARK\n${text}`,
    });
    expect(readFileSync(join(pluginRoot, 'skills', 'tdd', 'SKILL.md'), 'utf8').startsWith('MARK\n')).toBe(true);
    expect(readFileSync(join(pluginRoot, 'skills', 'done', 'SKILL.md'), 'utf8').startsWith('MARK\n')).toBe(true);
    expect(readFileSync(join(pluginRoot, 'skills', 'tdd', 'refs', 'more.md'), 'utf8')).toBe('more\n');
    expect(readFileSync(join(pluginRoot, 'catalog.md'), 'utf8').startsWith('MARK')).toBe(false);
  });
});
