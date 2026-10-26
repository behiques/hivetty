// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  reloadConfig,
  setAgentsDefaultCli,
  setCliAgents,
} from '../../../../electron/main/config';
import { parseConfig } from '../../../../electron/main/config/parse';
import { CONFIG_PATH_ENV, emptySnapshot } from '../../../../electron/shared/config-contract';

const doc = (extra: object) => JSON.stringify({ version: 2, projects: [], ...extra });

describe('the clis block (HIVE-341)', () => {
  it('reads every field', () => {
    const parsed = parseConfig(
      doc({ clis: { 'claude-code': { agents: { enabled: false, model: 'haiku', effort: 'max' } } } }),
      'config',
    );

    expect(parsed.clis).toEqual({
      'claude-code': { agents: { enabled: false, model: 'haiku', effort: 'max' } },
    });
    expect(parsed.errors).toEqual([]);
  });

  it('is absent when the file names none', () => {
    expect(parseConfig(doc({}), 'config').clis).toBeUndefined();
  });

  it('ignores an unknown CLI id and says so', () => {
    const parsed = parseConfig(doc({ clis: { copilot: { agents: { enabled: true } } } }), 'config');

    expect(parsed.clis).toEqual({});
    expect(parsed.errors).toContain('config.clis: unknown key "copilot" — ignored');
  });

  it("checks codex's fields against codex's vocabulary (HIVE-342)", () => {
    const parsed = parseConfig(
      doc({ clis: { codex: { agents: { model: 'gpt-6-luna', effort: 'xhigh' } } } }),
      'config',
    );
    const claudeWords = parseConfig(doc({ clis: { codex: { agents: { model: 'opus' } } } }), 'config');

    expect(parsed.clis).toEqual({ codex: { agents: { model: 'gpt-6-luna', effort: 'xhigh' } } });
    expect(claudeWords.errors).toEqual([
      'config.clis.codex.agents.model: expected one of gpt-6-luna, gpt-5.6-terra, gpt-5.6-luna — ignored',
    ]);
  });

  it('reads a sandbox on codex only, and never danger-full-access (HIVE-342)', () => {
    const readOnly = parseConfig(doc({ clis: { codex: { agents: { sandbox: 'read-only' } } } }), 'config');
    const danger = parseConfig(
      doc({ clis: { codex: { agents: { sandbox: 'danger-full-access' } } } }),
      'config',
    );
    const claude = parseConfig(
      doc({ clis: { 'claude-code': { agents: { sandbox: 'read-only' } } } }),
      'config',
    );

    expect(readOnly.clis).toEqual({ codex: { agents: { sandbox: 'read-only' } } });
    expect(readOnly.errors).toEqual([]);
    expect(danger.clis).toEqual({ codex: { agents: {} } });
    expect(danger.errors).toEqual([
      'config.clis.codex.agents.sandbox: expected one of read-only, workspace-write — ignored',
    ]);
    expect(claude.clis).toEqual({ 'claude-code': { agents: {} } });
    expect(claude.errors).toEqual([
      'config.clis.claude-code.agents.sandbox: only codex takes a sandbox — ignored',
    ]);
  });

  it('costs a bad field, never its siblings', () => {
    const parsed = parseConfig(
      doc({ clis: { 'claude-code': { agents: { enabled: 'yes', model: 'gpt-5', effort: 'high' } } } }),
      'config',
    );

    expect(parsed.clis).toEqual({ 'claude-code': { agents: { effort: 'high' } } });
    expect(parsed.errors).toEqual([
      'config.clis.claude-code.agents.enabled: expected a boolean — ignored',
      'config.clis.claude-code.agents.model: expected one of haiku, sonnet, opus, fable — ignored',
    ]);
  });

  it('reports an unknown key inside a CLI and inside agents', () => {
    const parsed = parseConfig(
      doc({ clis: { 'claude-code': { sandbox: 'read-only', agents: { deny: [] } } } }),
      'config',
    );

    expect(parsed.errors).toEqual([
      'config.clis.claude-code: unknown key "sandbox" — ignored',
      'config.clis.claude-code.agents: unknown key "deny" — ignored',
    ]);
  });

  it('costs the block, and nothing else, when it is not an object', () => {
    const parsed = parseConfig(doc({ clis: [], shell: '/bin/zsh' }), 'config');

    expect(parsed.clis).toBeUndefined();
    expect(parsed.shell).toBe('/bin/zsh');
    expect(parsed.errors).toEqual(['config.clis: expected an object — ignored']);
  });

  it('reads agentsDefaultCli, and ignores a CLI this build cannot run', () => {
    expect(parseConfig(doc({ agentsDefaultCli: 'claude-code' }), 'config').agentsDefaultCli).toBe(
      'claude-code',
    );

    expect(parseConfig(doc({ agentsDefaultCli: 'codex' }), 'config').agentsDefaultCli).toBe('codex');

    const bad = parseConfig(doc({ agentsDefaultCli: 'copilot' }), 'config');

    expect(bad.agentsDefaultCli).toBeUndefined();
    expect(bad.errors).toEqual([
      'config.agentsDefaultCli: expected one of claude-code, codex — ignored',
    ]);
  });
});

describe('the snapshot (HIVE-341)', () => {
  let dir: string;
  let saved: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-clis-'));
    saved = process.env[CONFIG_PATH_ENV];
    process.env[CONFIG_PATH_ENV] = join(dir, 'config.json');
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[CONFIG_PATH_ENV];
    else process.env[CONFIG_PATH_ENV] = saved;
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves a file with no block to every CLI enabled', () => {
    writeFileSync(process.env[CONFIG_PATH_ENV]!, doc({}));

    const snapshot = reloadConfig();

    expect(snapshot.clis).toEqual({
      'claude-code': { agents: { enabled: true } },
      codex: { agents: { enabled: true } },
    });
    expect(snapshot.agentsDefaultCli).toBeUndefined();
  });

  it('carries what the file named', () => {
    writeFileSync(
      process.env[CONFIG_PATH_ENV]!,
      doc({ agentsDefaultCli: 'claude-code', clis: { 'claude-code': { agents: { model: 'opus' } } } }),
    );

    const snapshot = reloadConfig();

    expect(snapshot.clis['claude-code'].agents).toEqual({ enabled: true, model: 'opus' });
    expect(snapshot.agentsDefaultCli).toBe('claude-code');
  });

  it('writes a field, keeps its siblings, and null clears one', () => {
    writeFileSync(
      process.env[CONFIG_PATH_ENV]!,
      doc({ clis: { 'claude-code': { agents: { model: 'opus', effort: 'high' } } } }),
    );
    reloadConfig();

    let snapshot = setCliAgents({ cli: 'claude-code', enabled: false, model: null });

    expect(snapshot.clis['claude-code'].agents).toEqual({ enabled: false, effort: 'high' });
    expect(JSON.parse(readFileSync(process.env[CONFIG_PATH_ENV]!, 'utf8')).clis).toEqual({
      'claude-code': { agents: { enabled: false, effort: 'high' } },
    });

    snapshot = setCliAgents({ cli: 'claude-code', model: 'haiku' });
    expect(snapshot.clis['claude-code'].agents.model).toBe('haiku');
  });

  it('writes the default CLI for agents, and null deletes the key (HIVE-342)', () => {
    writeFileSync(process.env[CONFIG_PATH_ENV]!, doc({ shell: '/bin/zsh' }));
    reloadConfig();

    let snapshot = setAgentsDefaultCli({ cli: 'codex' });

    expect(snapshot.agentsDefaultCli).toBe('codex');
    expect(JSON.parse(readFileSync(process.env[CONFIG_PATH_ENV]!, 'utf8'))).toMatchObject({
      agentsDefaultCli: 'codex',
      shell: '/bin/zsh',
    });

    snapshot = setAgentsDefaultCli({ cli: null });
    expect(snapshot.agentsDefaultCli).toBeUndefined();
    expect(JSON.parse(readFileSync(process.env[CONFIG_PATH_ENV]!, 'utf8'))).not.toHaveProperty(
      'agentsDefaultCli',
    );
  });

  it("writes codex's sandbox, and null deletes it (HIVE-342)", () => {
    writeFileSync(process.env[CONFIG_PATH_ENV]!, doc({}));
    reloadConfig();

    let snapshot = setCliAgents({ cli: 'codex', sandbox: 'read-only' });

    expect(snapshot.clis.codex.agents).toEqual({ enabled: true, sandbox: 'read-only' });
    expect(JSON.parse(readFileSync(process.env[CONFIG_PATH_ENV]!, 'utf8')).clis).toEqual({
      codex: { agents: { sandbox: 'read-only' } },
    });

    snapshot = setCliAgents({ cli: 'codex', sandbox: null });
    expect(snapshot.clis.codex.agents).toEqual({ enabled: true });
  });

  it('replaces a block that is not an object rather than merging into it', () => {
    writeFileSync(process.env[CONFIG_PATH_ENV]!, doc({ clis: 'nope' }));
    reloadConfig();

    expect(setCliAgents({ cli: 'claude-code', enabled: false }).clis['claude-code'].agents.enabled).toBe(
      false,
    );
  });

  it('an empty snapshot has every CLI enabled', () => {
    expect(emptySnapshot('/tmp/config.json').clis).toEqual({
      'claude-code': { agents: { enabled: true } },
      codex: { agents: { enabled: true } },
    });
  });
});
