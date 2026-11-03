// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { archiveStaleBriefs, goalsDir } from '../../../../electron/main/sessions/goal-briefs';

const brief = (header: string) => `---\nstatus: ACTIVE\n${header}---\n\n## Outcome\n- [ ] open\n`;
const NOW = new Date('2026-11-03T18:00:00.000Z');

describe('archiveStaleBriefs', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'goals-'));
  });

  const archived = (): string[] =>
    existsSync(join(dir, 'archive')) ? readdirSync(join(dir, 'archive')).sort() : [];

  it('moves an unbound brief named for the id out of the verifier’s way', () => {
    writeFileSync(join(dir, 'sess-07.md'), brief('session: sess-07\n'));
    writeFileSync(join(dir, 'session_sess-07.md'), brief(''));

    archiveStaleBriefs('sess-07', dir, NOW);

    expect(readdirSync(dir).filter((n) => n.endsWith('.md'))).toEqual([]);
    expect(archived()).toEqual([
      'sess-07.2026-11-03T18-00-00-000Z.md',
      'session_sess-07.2026-11-03T18-00-00-000Z.md',
    ]);
    expect(readFileSync(join(dir, 'archive', archived()[0]!), 'utf8')).toBe(brief('session: sess-07\n'));
  });

  it('finds a renamed brief by its header, as the verifier does', () => {
    writeFileSync(join(dir, 'my-goal.md'), brief('session: "sess-07"\n'));
    writeFileSync(join(dir, 'other.md'), brief('session: sess-070\n'));

    archiveStaleBriefs('sess-07', dir, NOW);

    expect(archived()).toEqual(['my-goal.2026-11-03T18-00-00-000Z.md']);
    expect(existsSync(join(dir, 'other.md'))).toBe(true);
  });

  it('treats a comment-only cli_session as unbound, the template’s own line', () => {
    writeFileSync(join(dir, 'sess-07.md'), brief('cli_session:   # written by the verifier, never by you\n'));
    archiveStaleBriefs('sess-07', dir, NOW);
    expect(archived()).toHaveLength(1);
  });

  it('leaves a bound brief alone: the verifier already ignores it, and it may be another app’s live goal', () => {
    writeFileSync(join(dir, 'sess-07.md'), brief('cli_session: 0f0e-uuid\n'));
    archiveStaleBriefs('sess-07', dir, NOW);
    expect(existsSync(join(dir, 'sess-07.md'))).toBe(true);
    expect(archived()).toEqual([]);
  });

  it('is a no-op without a goals folder, and refuses an id that could leave it', () => {
    expect(() => archiveStaleBriefs('sess-07', join(dir, 'missing'), NOW)).not.toThrow();
    mkdirSync(join(dir, 'x'));
    writeFileSync(join(dir, 'x.md'), brief(''));
    archiveStaleBriefs('../x', dir, NOW);
    archiveStaleBriefs('', dir, NOW);
    expect(existsSync(join(dir, 'x.md'))).toBe(true);
  });

  it('never throws on an unreadable neighbour', () => {
    mkdirSync(join(dir, 'dir.md')); // a directory with a brief's name
    writeFileSync(join(dir, 'sess-07.md'), brief(''));
    expect(() => archiveStaleBriefs('sess-07', dir, NOW)).not.toThrow();
    expect(archived()).toHaveLength(1);
  });
});

describe('goalsDir', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is the verifier’s folder: HIVE_GOALS_DIR, else ~/.hivetty/goals', () => {
    vi.stubEnv('HIVE_GOALS_DIR', '/tmp/g');
    expect(goalsDir()).toBe('/tmp/g');
    vi.stubEnv('HIVE_GOALS_DIR', '');
    expect(goalsDir()).toMatch(/\/\.hivetty\/goals$/);
  });
});
