import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { claudeDir } from '../../../../core/harness/claude-code/claude-dir';
import { createClaudeRecord } from '../../../../core/harness/claude-code/record';
import { claudeProjectDir, createTitleOriginReader } from '../../../../core/harness/claude-code/title-origin';

describe("Claude's folder (HIVE-422)", () => {
  const CWD = '/repo/app';
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hive-claude-dir-'));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  const write = (claude: string, uuid: string, lines: string[]) => {
    const dir = join(claude, 'projects', claudeProjectDir(CWD));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${uuid}.jsonl`), lines.join('\n'));
    return join(dir, `${uuid}.jsonl`);
  };

  it('is CLAUDE_CONFIG_DIR when set, else ~/.claude', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/people/ana/claude');
    expect(claudeDir()).toBe('/people/ana/claude');
    vi.stubEnv('CLAUDE_CONFIG_DIR', undefined);
    vi.stubEnv('HOME', '/people/bo');
    expect(claudeDir()).toBe('/people/bo/.claude');
  });

  it('is <home>/.claude for an explicit home, whatever CLAUDE_CONFIG_DIR says', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/people/ana/claude');
    expect(claudeDir('/h')).toBe('/h/.claude');
  });

  it('the record and the title reader read transcripts from CLAUDE_CONFIG_DIR', () => {
    const claude = join(root, 'ana-claude');
    vi.stubEnv('CLAUDE_CONFIG_DIR', claude);
    const path = write(claude, 'u1', [JSON.stringify({ type: 'custom-title', customTitle: 'HIVE-9' })]);
    expect(createClaudeRecord().transcriptPath(CWD, 'u1')).toBe(path);
    expect(createTitleOriginReader().classify(CWD, 'u1', 'HIVE-9')).toBe('rename');
  });

  it('without it, both read from ~/.claude/projects', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', undefined);
    vi.stubEnv('HOME', root);
    const path = write(join(root, '.claude'), 'u2', [JSON.stringify({ type: 'custom-title', customTitle: 'HIVE-8' })]);
    expect(createClaudeRecord().transcriptPath(CWD, 'u2')).toBe(path);
    expect(createTitleOriginReader().classify(CWD, 'u2', 'HIVE-8')).toBe('rename');
  });
});
