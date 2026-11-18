// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  collectFiles,
  collectKeys,
  decodeBundle,
  encodeBundle,
  hashOf,
  safeRel,
} from '../../../../electron/main/sync/bundle';
import type { View } from '../../../../electron/main/sync/merge';

/**
 * This Mac's view for settings sync and the bundle it travels in (HIVE-284). The shipped-file rule, the link
 * and dotfile rules, and a bundle that names a path outside skills/ and agents/ are the cases that guard the
 * person's hive folder.
 */

let dir: string;
let manifest: string;

const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');
const write = (rel: string, text: string): void => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const writeManifest = (content: unknown): void => writeFileSync(manifest, JSON.stringify(content));
const gzipJson = async (value: unknown): Promise<Buffer> => gzipSync(Buffer.from(JSON.stringify(value)));
const bundleWithFile = (rel: string, text = 'x') => ({
  v: 1,
  groups: {
    automation: { keys: {}, files: { [rel]: { sha256: sha256(text), mtime: 1, b64: Buffer.from(text).toString('base64') } } },
  },
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sync-bundle-'));
  manifest = join(dir, '.seed.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('collectFiles', () => {
  it('lists skills and agents with their bytes, hash and mtime', async () => {
    write('skills/mine/SKILL.md', 'mine');
    write('agents/scout/AGENT.md', 'scout');
    utimesSync(join(dir, 'skills/mine/SKILL.md'), 1_700_000_000, 1_700_000_000);
    const view = await collectFiles(dir, manifest);
    expect(view).toEqual({
      'automation:f:agents/scout/AGENT.md': {
        hash: sha256('scout'),
        at: expect.any(Number) as number,
        data: Buffer.from('scout').toString('base64'),
      },
      'automation:f:skills/mine/SKILL.md': {
        hash: sha256('mine'),
        at: 1_700_000_000_000,
        data: Buffer.from('mine').toString('base64'),
      },
    });
  });

  it('leaves out a file that is still what the seed wrote, and includes it once edited', async () => {
    write('skills/work-on/SKILL.md', 'shipped');
    write('skills/mine/SKILL.md', 'mine');
    writeManifest({ files: { 'skills/work-on/SKILL.md': sha256('shipped') }, parts: {} });
    expect(Object.keys(await collectFiles(dir, manifest))).toEqual(['automation:f:skills/mine/SKILL.md']);
    write('skills/work-on/SKILL.md', 'edited');
    expect(Object.keys(await collectFiles(dir, manifest)).sort()).toEqual([
      'automation:f:skills/mine/SKILL.md',
      'automation:f:skills/work-on/SKILL.md',
    ]);
  });

  it('never follows a link and never reads a dotfile', async () => {
    write('skills/a/SKILL.md', 'a');
    write('skills/a/.DS_Store', 'x');
    write('skills/.hidden/SKILL.md', 'x');
    write('outside/b/SKILL.md', 'b');
    symlinkSync('/etc/hosts', join(dir, 'skills/a/hosts'));
    symlinkSync(join(dir, 'outside/b'), join(dir, 'skills/b'));
    symlinkSync('/etc', join(dir, 'agents'));
    expect(Object.keys(await collectFiles(dir, manifest))).toEqual(['automation:f:skills/a/SKILL.md']);
  });

  it('never reads anything outside skills and agents', async () => {
    write('config.json', '{}');
    write('ledger/agents.json', '{}');
    write('work/x', 'x');
    write('cli/hive', 'x');
    write('sync-conflicts/2026/skills/a/SKILL.md', 'x');
    expect(await collectFiles(dir, manifest)).toEqual({});
  });
});

describe('collectKeys', () => {
  it('keeps a key’s time while its value is unchanged and restamps it when it changes', () => {
    const first = collectKeys({ claudeCommand: 'claude' }, null, {}, 100);
    expect(first.view['harnesses:k:claudeCommand']).toEqual({ hash: hashOf('claude'), at: 100, data: 'claude' });
    expect(collectKeys({ claudeCommand: 'claude' }, null, first.seen, 200).view['harnesses:k:claudeCommand']?.at).toBe(100);
    expect(collectKeys({ claudeCommand: 'claude2' }, null, first.seen, 200).view['harnesses:k:claudeCommand']?.at).toBe(200);
    expect(collectKeys({ claudeCommand: 'claude2' }, null, first.seen, 200).seen).toEqual({
      'harnesses:k:claudeCommand': { hash: hashOf('claude2'), at: 200 },
    });
    expect(collectKeys({}, null, first.seen, 200).seen).toEqual({});
  });

  it('adds the listed appearance fields under the workspace group, and none without a report', () => {
    expect(Object.keys(collectKeys({}, null, {}, 1).view)).toEqual([]);
    const { view } = collectKeys({}, { density: 'compact', theme: undefined }, {}, 1);
    expect(view).toEqual({ 'workspace:k:appearance.density': { hash: hashOf('compact'), at: 1, data: 'compact' } });
  });

  it('never collects a key that is not listed', () => {
    const { view } = collectKeys({ projects: [{ path: '/x' }], env: { A: 'b' }, clis: { codex: { skipPermissions: true } } }, null, {}, 1);
    expect(view).toEqual({});
  });
});

describe('hashOf', () => {
  it('hashes a value the same whatever the key order', () => {
    expect(hashOf({ a: 1, b: { c: 2, d: 3 } })).toBe(hashOf({ b: { d: 3, c: 2 }, a: 1 }));
    expect(hashOf([1, 2])).not.toBe(hashOf([2, 1]));
  });
});

describe('safeRel', () => {
  it.each([
    ['skills/a/SKILL.md', true],
    ['agents/a/AGENT.md', true],
    ['skills', false],
    ['../config.json', false],
    ['skills/../../x', false],
    ['skills/./x', false],
    ['ledger/agents.json', false],
    ['skills//x', false],
    ['skills\\x', false],
    ['/etc/passwd', false],
    ['skills/.git/config', false],
  ])('%s → %s', (rel, ok) => {
    expect(safeRel(rel)).toBe(ok);
  });
});

describe('the bundle', () => {
  const view: View = {
    'harnesses:k:clis.codex.sessionModel': { hash: hashOf('gpt-5'), at: 10, data: 'gpt-5' },
    'automation:k:jira.workflow': { hash: hashOf({ kind: 'skill', skill: 'work-on' }), at: 11, data: { kind: 'skill', skill: 'work-on' } },
    'workspace:k:notifications': { hash: hashOf({ 'pr.merged': 'banner' }), at: 12, data: { 'pr.merged': 'banner' } },
    'workspace:k:appearance.density': { hash: hashOf('compact'), at: 13, data: 'compact' },
    'automation:f:skills/a/SKILL.md': { hash: sha256('a'), at: 14, data: Buffer.from('a').toString('base64') },
    'automation:f:agents/b/AGENT.md': { hash: sha256('b'), at: 15, data: Buffer.from('b').toString('base64') },
  };

  it('round-trips a view', async () => {
    expect(await decodeBundle(await encodeBundle(view))).toEqual(view);
  });

  it('encodes the spec’s shape, gzipped', async () => {
    const json: unknown = JSON.parse(gunzipSync(await encodeBundle(view)).toString('utf8'));
    expect(json).toEqual({
      v: 1,
      groups: {
        harnesses: { keys: { 'clis.codex.sessionModel': { value: 'gpt-5', at: 10 } }, files: {} },
        automation: {
          keys: { 'jira.workflow': { value: { kind: 'skill', skill: 'work-on' }, at: 11 } },
          files: {
            'skills/a/SKILL.md': { sha256: sha256('a'), mtime: 14, b64: Buffer.from('a').toString('base64') },
            'agents/b/AGENT.md': { sha256: sha256('b'), mtime: 15, b64: Buffer.from('b').toString('base64') },
          },
        },
        workspace: {
          keys: {
            notifications: { value: { 'pr.merged': 'banner' }, at: 12 },
            'appearance.density': { value: 'compact', at: 13 },
          },
          files: {},
        },
      },
    });
  });

  it('decodes an empty bundle and one with a group left out', async () => {
    expect(await decodeBundle(await encodeBundle({}))).toEqual({});
    expect(await decodeBundle(await gzipJson({ v: 1, groups: { harnesses: { keys: { claudeCommand: { value: 'c', at: 1 } } } } }))).toEqual({
      'harnesses:k:claudeCommand': { hash: hashOf('c'), at: 1, data: 'c' },
    });
  });

  it('refuses a bundle whose file would land outside skills and agents', async () => {
    for (const rel of ['../config.json', 'skills/../../x', 'ledger/agents.json', 'skills//x', 'skills\\x', '/etc/passwd', 'skills/.hidden/x']) {
      expect(await decodeBundle(await gzipJson(bundleWithFile(rel)))).toBeNull();
    }
  });

  it('refuses a bundle whose sha256 does not match its bytes', async () => {
    const bundle = bundleWithFile('skills/a/SKILL.md', 'a');
    bundle.groups.automation.files['skills/a/SKILL.md'].sha256 = sha256('b');
    expect(await decodeBundle(await gzipJson(bundle))).toBeNull();
  });

  it.each([
    ['not gzip', Buffer.from('plain')],
    ['not JSON', gzipSync(Buffer.from('{'))],
    ['another version', gzipSync(Buffer.from(JSON.stringify({ v: 2, groups: {} })))],
    ['no groups', gzipSync(Buffer.from(JSON.stringify({ v: 1 })))],
    ['an unknown group', gzipSync(Buffer.from(JSON.stringify({ v: 1, groups: { projects: { keys: {} } } })))],
    ['a key without a time', gzipSync(Buffer.from(JSON.stringify({ v: 1, groups: { harnesses: { keys: { a: { value: 1 } } } } })))],
    ['a key without a value', gzipSync(Buffer.from(JSON.stringify({ v: 1, groups: { harnesses: { keys: { a: { at: 1 } } } } })))],
    ['a file without bytes', gzipSync(Buffer.from(JSON.stringify({ v: 1, groups: { automation: { files: { 'skills/a/x': { sha256: 'h', mtime: 1 } } } } })))],
    ['keys that are not an object', gzipSync(Buffer.from(JSON.stringify({ v: 1, groups: { harnesses: { keys: [] } } })))],
  ])('decodes %s as null', async (_, bytes) => {
    expect(await decodeBundle(bytes)).toBeNull();
  });
});
