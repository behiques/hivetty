// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyMerge, conflictsSummary, CONFLICTS_DIR, type ApplyDeps } from '../../../../electron/main/sync/apply';
import type { Item, MergeResult } from '../../../../electron/main/sync/merge';

/**
 * Writing a settings sync merge to this Mac (HIVE-284). It overwrites and deletes the person's files, so the
 * containment (only skills/ and agents/, never through a link), the order (the losing copy before the winner)
 * and the shipped-file reset are each a case.
 */

let dir: string;
let manifest: string;

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const file = (text: string, at = 1): Item => ({ hash: sha256(text), at, data: Buffer.from(text).toString('base64') });
const key = (value: unknown, at = 1): Item => ({ hash: JSON.stringify(value), at, data: value });
const write = (rel: string, text: string): void => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const read = (rel: string): string => readFileSync(join(dir, rel), 'utf8');
const result = (partial: Partial<MergeResult>): MergeResult => ({
  merged: {},
  set: {},
  remove: [],
  conflicts: {},
  push: false,
  ...partial,
});

function makeDeps(overrides: Partial<ApplyDeps> = {}): ApplyDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    hiveDir: dir,
    manifestFile: manifest,
    writeConfig: vi.fn(() => true),
    resetShipped: vi.fn((kind: string, name: string) => {
      calls.push(`reset:${kind}/${name}`);
      return Promise.resolve();
    }),
    sendAppearance: vi.fn(),
    afterSkills: vi.fn(),
    afterAgents: vi.fn(),
    now: () => Date.parse('2026-11-17T10:20:30.456Z'),
    ...overrides,
  };
}

const STAMP = '2026-11-17T10-20-30.456Z';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sync-apply-'));
  manifest = join(dir, '.seed.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('applyMerge: files', () => {
  it('writes a set file with its bytes, parents created, no temp file left', async () => {
    const deps = makeDeps();
    await applyMerge(deps, result({ set: { 'automation:f:skills/new/deep/SKILL.md': file('hello') } }), {});
    expect(read('skills/new/deep/SKILL.md')).toBe('hello');
    expect(readdirSync(join(dir, 'skills/new/deep'))).toEqual(['SKILL.md']);
    expect(deps.afterSkills).toHaveBeenCalledTimes(1);
    expect(deps.afterAgents).not.toHaveBeenCalled();
  });

  it('writes nothing outside skills and agents, nor through a link, and does not throw', async () => {
    write('outside/x', 'outside');
    mkdirSync(join(dir, 'skills'));
    symlinkSync(join(dir, 'outside'), join(dir, 'skills/linked'));
    const deps = makeDeps();
    await applyMerge(
      deps,
      result({
        set: {
          'automation:f:../config.json': file('pwned'),
          'automation:f:ledger/x': file('pwned'),
          'automation:f:skills/linked/x': file('pwned'),
          'automation:f:skills/../config.json': file('pwned'),
        },
      }),
      {},
    );
    expect(existsSync(join(dir, 'config.json'))).toBe(false);
    expect(existsSync(join(dir, 'ledger'))).toBe(false);
    expect(read('outside/x')).toBe('outside');
    expect(deps.afterSkills).not.toHaveBeenCalled();
  });

  it('writes nothing when skills itself is a link', async () => {
    write('outside/keep', 'keep');
    symlinkSync(join(dir, 'outside'), join(dir, 'skills'));
    await applyMerge(makeDeps(), result({ set: { 'automation:f:skills/x/SKILL.md': file('pwned') } }), {});
    expect(readdirSync(join(dir, 'outside'))).toEqual(['keep']);
  });

  it('resets a shipped folder once instead of deleting, then writes the merge’s files for it', async () => {
    write('skills/work-on/SKILL.md', 'edited');
    write('skills/work-on/notes.md', 'edited too');
    writeFileSync(
      manifest,
      JSON.stringify({ files: { 'skills/work-on/SKILL.md': sha256('shipped'), 'skills/work-on/notes.md': sha256('n') }, parts: {} }),
    );
    const deps = makeDeps({
      resetShipped: vi.fn((kind: string, name: string) => {
        deps.calls.push(`reset:${kind}/${name}`);
        write('skills/work-on/SKILL.md', 'shipped');
        return Promise.resolve();
      }),
    });
    await applyMerge(
      deps,
      result({
        remove: ['automation:f:skills/work-on/SKILL.md', 'automation:f:skills/work-on/notes.md'],
        set: { 'automation:f:skills/work-on/extra.md': file('extra') },
      }),
      {},
    );
    expect(deps.resetShipped).toHaveBeenCalledTimes(1);
    expect(deps.resetShipped).toHaveBeenCalledWith('skills', 'work-on');
    expect(read('skills/work-on/SKILL.md')).toBe('shipped');
    expect(read('skills/work-on/extra.md')).toBe('extra');
    expect(deps.afterSkills).toHaveBeenCalledTimes(1);
  });

  it('still deletes an unlisted file in a folder that was reset', async () => {
    writeFileSync(manifest, JSON.stringify({ files: { 'skills/work-on/SKILL.md': sha256('shipped') }, parts: {} }));
    write('skills/work-on/SKILL.md', 'edited');
    write('skills/work-on/mine.md', 'mine');
    await applyMerge(
      makeDeps(),
      result({ remove: ['automation:f:skills/work-on/SKILL.md', 'automation:f:skills/work-on/mine.md'] }),
      {},
    );
    expect(existsSync(join(dir, 'skills/work-on/mine.md'))).toBe(false);
  });

  it('puts back an edited sibling the reset overwrote, as merged', async () => {
    writeFileSync(
      manifest,
      JSON.stringify({ files: { 'skills/work-on/SKILL.md': sha256('shipped'), 'skills/work-on/refs/x.md': sha256('x') }, parts: {} }),
    );
    write('skills/work-on/SKILL.md', 'edited');
    write('skills/work-on/refs/x.md', 'my edit');
    const deps = makeDeps({
      resetShipped: vi.fn(() => {
        write('skills/work-on/SKILL.md', 'shipped');
        write('skills/work-on/refs/x.md', 'x');
        return Promise.resolve();
      }),
    });
    await applyMerge(
      deps,
      result({
        merged: { 'automation:f:skills/work-on/refs/x.md': file('my edit') },
        remove: ['automation:f:skills/work-on/SKILL.md'],
      }),
      {},
    );
    expect(read('skills/work-on/SKILL.md')).toBe('shipped');
    expect(read('skills/work-on/refs/x.md')).toBe('my edit');
  });

  it('writes a set file for a reset folder after the reset', async () => {
    writeFileSync(manifest, JSON.stringify({ files: { 'skills/work-on/SKILL.md': sha256('shipped') }, parts: {} }));
    write('skills/work-on/SKILL.md', 'edited');
    const order: string[] = [];
    const deps = makeDeps({
      resetShipped: vi.fn(() => {
        order.push(existsSync(join(dir, 'skills/work-on/extra.md')) ? 'reset-after-write' : 'reset-first');
        return Promise.resolve();
      }),
    });
    await applyMerge(
      deps,
      result({
        remove: ['automation:f:skills/work-on/SKILL.md'],
        set: { 'automation:f:skills/work-on/extra.md': file('extra') },
      }),
      {},
    );
    expect(order).toEqual(['reset-first']);
  });

  it('deletes an unlisted file and its empty folder, and keeps skills/', async () => {
    write('skills/mine/SKILL.md', 'mine');
    const deps = makeDeps();
    await applyMerge(deps, result({ remove: ['automation:f:skills/mine/SKILL.md'] }), {});
    expect(existsSync(join(dir, 'skills/mine'))).toBe(false);
    expect(existsSync(join(dir, 'skills'))).toBe(true);
    expect(deps.resetShipped).not.toHaveBeenCalled();
    expect(deps.afterSkills).toHaveBeenCalledTimes(1);
  });

  it('keeps a folder that still holds other files', async () => {
    write('agents/scout/AGENT.md', 'a');
    write('agents/scout/notes.md', 'n');
    const deps = makeDeps();
    await applyMerge(deps, result({ remove: ['automation:f:agents/scout/notes.md'] }), {});
    expect(readdirSync(join(dir, 'agents/scout'))).toEqual(['AGENT.md']);
    expect(deps.afterAgents).toHaveBeenCalledTimes(1);
  });

  it('falls back to delete when this build does not ship the folder', async () => {
    write('skills/old/SKILL.md', 'old');
    writeFileSync(manifest, JSON.stringify({ files: { 'skills/old/SKILL.md': sha256('old-shipped') }, parts: {} }));
    const deps = makeDeps({ resetShipped: vi.fn(() => Promise.reject(new Error('not shipped'))) });
    await applyMerge(deps, result({ remove: ['automation:f:skills/old/SKILL.md'] }), {});
    expect(existsSync(join(dir, 'skills/old'))).toBe(false);
  });

  it('removes nothing outside skills and agents', async () => {
    write('config.json', '{}');
    await applyMerge(makeDeps(), result({ remove: ['automation:f:../config.json', 'automation:f:config.json'] }), {});
    expect(read('config.json')).toBe('{}');
  });
});

describe('applyMerge: conflicts', () => {
  it('copies the losing file and the losing keys into one stamped folder', async () => {
    write('skills/review/SKILL.md', 'mine');
    const deps = makeDeps();
    const { kept } = await applyMerge(
      deps,
      result({
        set: { 'automation:f:skills/review/SKILL.md': file('theirs') },
        conflicts: {
          'automation:f:skills/review/SKILL.md': file('mine'),
          'harnesses:k:clis.codex.sessionModel': key('o4'),
          'workspace:k:appearance.density': key('compact'),
        },
      }),
      {},
    );
    expect(readFileSync(join(dir, CONFLICTS_DIR, STAMP, 'skills/review/SKILL.md'), 'utf8')).toBe('mine');
    expect(JSON.parse(readFileSync(join(dir, CONFLICTS_DIR, STAMP, 'settings.json'), 'utf8'))).toEqual({
      'clis.codex.sessionModel': 'o4',
      'appearance.density': 'compact',
    });
    expect(read('skills/review/SKILL.md')).toBe('theirs');
    expect(kept).toEqual({
      'automation:f:skills/review/SKILL.md': sha256('mine'),
      'harnesses:k:clis.codex.sessionModel': JSON.stringify('o4'),
      'workspace:k:appearance.density': JSON.stringify('compact'),
    });
  });

  it('has the copy on disk before the winner is written', async () => {
    write('skills/review/SKILL.md', 'mine');
    mkdirSync(join(dir, 'skills/review/SKILL.md.blocker'));
    const deps = makeDeps();
    // The winner's path is a folder, so writing it throws after the conflict copy.
    await expect(
      applyMerge(
        deps,
        result({
          set: { 'automation:f:skills/review/SKILL.md.blocker': file('theirs') },
          conflicts: { 'automation:f:skills/review/SKILL.md.blocker': file('mine') },
        }),
        {},
      ),
    ).rejects.toThrow();
    expect(readFileSync(join(dir, CONFLICTS_DIR, STAMP, 'skills/review/SKILL.md.blocker'), 'utf8')).toBe('mine');
  });

  it('does not copy a loser it already kept', async () => {
    const deps = makeDeps();
    const loser = file('mine');
    const { kept } = await applyMerge(
      deps,
      result({ conflicts: { 'automation:f:skills/review/SKILL.md': loser } }),
      { 'automation:f:skills/review/SKILL.md': loser.hash },
    );
    expect(existsSync(join(dir, CONFLICTS_DIR))).toBe(false);
    expect(kept).toEqual({ 'automation:f:skills/review/SKILL.md': loser.hash });
  });

  it('throws when the copy cannot be written, before anything is overwritten', async () => {
    write('skills/review/SKILL.md', 'mine');
    writeFileSync(join(dir, CONFLICTS_DIR), 'a file where the folder goes');
    await expect(
      applyMerge(
        makeDeps(),
        result({
          set: { 'automation:f:skills/review/SKILL.md': file('theirs') },
          conflicts: { 'automation:f:skills/review/SKILL.md': file('mine') },
        }),
        {},
      ),
    ).rejects.toThrow();
    expect(read('skills/review/SKILL.md')).toBe('mine');
  });

  it('refuses to keep copies through a linked conflicts folder', async () => {
    mkdirSync(join(dir, 'elsewhere'));
    symlinkSync(join(dir, 'elsewhere'), join(dir, CONFLICTS_DIR));
    write('skills/review/SKILL.md', 'mine');
    await expect(
      applyMerge(
        makeDeps(),
        result({
          set: { 'automation:f:skills/review/SKILL.md': file('theirs') },
          conflicts: { 'automation:f:skills/review/SKILL.md': file('mine') },
        }),
        {},
      ),
    ).rejects.toThrow();
    expect(readdirSync(join(dir, 'elsewhere'))).toEqual([]);
    expect(read('skills/review/SKILL.md')).toBe('mine');
  });

  it('never keeps a losing file under a path outside the conflicts folder', async () => {
    await applyMerge(makeDeps(), result({ conflicts: { 'automation:f:../../escape': file('x') } }), {});
    expect(existsSync(join(dirname(dir), 'escape'))).toBe(false);
  });
});

describe('applyMerge: keys and appearance', () => {
  it('sends one mutation that changes only listed paths', async () => {
    const deps = makeDeps();
    const { configOk } = await applyMerge(
      deps,
      result({
        set: {
          'harnesses:k:clis.codex.sessionModel': key('o4'),
          'harnesses:k:projects': key([]),
        },
        remove: ['workspace:k:jira.jql'],
      }),
      {},
    );
    expect(configOk).toBe(true);
    expect(deps.writeConfig).toHaveBeenCalledTimes(1);
    const mutate = vi.mocked(deps.writeConfig).mock.calls[0]?.[0];
    expect(mutate?.({ projects: [{ path: '/x' }], jira: { jql: 'q', site: 's' } })).toEqual({
      projects: [{ path: '/x' }],
      jira: { site: 's' },
      clis: { codex: { sessionModel: 'o4' } },
    });
  });

  it('answers configOk false when the write is refused', async () => {
    const deps = makeDeps({ writeConfig: vi.fn(() => false) });
    expect((await applyMerge(deps, result({ set: { 'harnesses:k:claudeCommand': key('c') } }), {})).configOk).toBe(false);
  });

  it('does not write the config when no key changes', async () => {
    const deps = makeDeps();
    expect((await applyMerge(deps, result({ set: { 'automation:f:skills/a/SKILL.md': file('a') } }), {})).configOk).toBe(true);
    expect(deps.writeConfig).not.toHaveBeenCalled();
  });

  it('sends appearance to the windows and never to the config', async () => {
    const deps = makeDeps();
    await applyMerge(
      deps,
      result({
        set: { 'workspace:k:appearance.density': key('compact'), 'workspace:k:appearance.listPanelWidth': key(999) },
        remove: ['workspace:k:appearance.theme'],
      }),
      {},
    );
    expect(deps.writeConfig).not.toHaveBeenCalled();
    expect(deps.sendAppearance).toHaveBeenCalledTimes(1);
    expect(deps.sendAppearance).toHaveBeenCalledWith({ density: 'compact', theme: undefined });
  });
});

describe('conflictsSummary', () => {
  it('answers nothing kept when there is no folder', async () => {
    expect(await conflictsSummary(dir)).toEqual({ count: 0, latest: null });
  });

  it('counts files and keys across folders and names the newest', async () => {
    write(`${CONFLICTS_DIR}/2026-11-16T09-00-00.000Z/skills/a/SKILL.md`, 'a');
    write(`${CONFLICTS_DIR}/2026-11-16T09-00-00.000Z/settings.json`, JSON.stringify({ claudeCommand: 'c', 'jira.jql': 'q' }));
    write(`${CONFLICTS_DIR}/2026-11-17T10-20-30.456Z/skills/review/SKILL.md`, 'r');
    write(`${CONFLICTS_DIR}/2026-11-17T10-20-30.456Z/.DS_Store`, 'x');
    write(`${CONFLICTS_DIR}/.DS_Store`, 'x');
    expect(await conflictsSummary(dir)).toEqual({
      count: 4,
      latest: { path: 'skills/review/SKILL.md', at: Date.parse('2026-11-17T10:20:30.456Z') },
    });
  });

  it('names a key when the newest folder holds only settings', async () => {
    write(`${CONFLICTS_DIR}/2026-11-17T10-20-30.456Z/settings.json`, JSON.stringify({ claudeCommand: 'c' }));
    write(`${CONFLICTS_DIR}/not-a-stamp/x`, 'x');
    expect(await conflictsSummary(dir)).toEqual({
      count: 2,
      latest: { path: 'claudeCommand', at: Date.parse('2026-11-17T10:20:30.456Z') },
    });
  });
});
