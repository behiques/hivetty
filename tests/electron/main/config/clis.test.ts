// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  reloadConfig,
  setAgentsDefaultCli,
  setCli,
  setCliAgents,
  setCliSessions,
} from '../../../../electron/main/config';
import { parseConfig } from '../../../../electron/main/config/parse';
import { resolveClis } from '../../../../electron/shared/cli-contract';
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
    const parsed = parseConfig(doc({ clis: { gemini: { agents: { enabled: true } } } }), 'config');

    expect(parsed.clis).toEqual({});
    expect(parsed.errors).toContain('config.clis: unknown key "gemini" — ignored');
  });

  it("checks codex's fields against codex's vocabulary (HIVE-342)", () => {
    const parsed = parseConfig(
      doc({ clis: { codex: { agents: { model: 'gpt-6-luna', effort: 'xhigh' } } } }),
      'config',
    );
    const claudeWords = parseConfig(doc({ clis: { codex: { agents: { model: 'gpt 6; rm' } } } }), 'config');

    expect(parsed.clis).toEqual({ codex: { agents: { model: 'gpt-6-luna', effort: 'xhigh' } } });
    expect(claudeWords.errors).toEqual([
      'config.clis.codex.agents.model: expected a codex model id — ignored',
    ]);
    const live = parseConfig(doc({ clis: { codex: { agents: { model: 'gpt-7-nova', effort: 'ultra' } } } }), 'config');
    expect(live.clis).toEqual({ codex: { agents: { model: 'gpt-7-nova', effort: 'ultra' } } });
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

  it('reads deny patterns on copilot only, keeping the good ones (HIVE-343)', () => {
    const good = parseConfig(
      doc({ clis: { copilot: { agents: { deny: ['shell(rm:*)', 'write(.env)'] } } } }),
      'config',
    );
    const mixed = parseConfig(
      doc({ clis: { copilot: { agents: { deny: ['shell(rm:*)', 'not a pattern'] } } } }),
      'config',
    );
    const codex = parseConfig(doc({ clis: { codex: { agents: { deny: ['shell(rm)'] } } } }), 'config');
    const notList = parseConfig(doc({ clis: { copilot: { agents: { deny: 'shell(rm)' } } } }), 'config');

    expect(good.clis).toEqual({ copilot: { agents: { deny: ['shell(rm:*)', 'write(.env)'] } } });
    expect(good.errors).toEqual([]);
    expect(mixed.clis).toEqual({ copilot: { agents: { deny: ['shell(rm:*)'] } } });
    expect(mixed.errors).toEqual([
      'config.clis.copilot.agents.deny[1]: expected kind(argument), like shell(git push) — ignored',
    ]);
    expect(codex.clis).toEqual({ codex: { agents: {} } });
    expect(codex.errors).toEqual([
      'config.clis.codex.agents.deny: only copilot takes deny patterns — ignored',
    ]);
    expect(notList.clis).toEqual({ copilot: { agents: {} } });
    expect(notList.errors).toEqual([
      'config.clis.copilot.agents.deny: expected a list of patterns — ignored',
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
      doc({ clis: { 'claude-code': { sandbox: 'read-only', agents: { allow: [] } } } }),
      'config',
    );

    expect(parsed.errors).toEqual([
      'config.clis.claude-code: unknown key "sandbox" — ignored',
      'config.clis.claude-code.agents: unknown key "allow" — ignored',
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

    expect(parseConfig(doc({ agentsDefaultCli: 'copilot' }), 'config').agentsDefaultCli).toBe(
      'copilot',
    );

    const bad = parseConfig(doc({ agentsDefaultCli: 'gemini' }), 'config');

    expect(bad.agentsDefaultCli).toBeUndefined();
    expect(bad.errors).toEqual([
      'config.agentsDefaultCli: expected one of claude-code, codex, copilot — ignored',
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
      'claude-code': { agents: { enabled: true }, sessions: true },
      codex: { agents: { enabled: true }, sessions: true },
      copilot: { agents: { enabled: true }, sessions: true },
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

  it("writes copilot's deny patterns, and null deletes them (HIVE-343)", () => {
    writeFileSync(process.env[CONFIG_PATH_ENV]!, doc({}));
    reloadConfig();

    let snapshot = setCliAgents({ cli: 'copilot', deny: ['shell(rm:*)'] });

    expect(snapshot.clis.copilot.agents).toEqual({ enabled: true, deny: ['shell(rm:*)'] });
    expect(JSON.parse(readFileSync(process.env[CONFIG_PATH_ENV]!, 'utf8')).clis).toEqual({
      copilot: { agents: { deny: ['shell(rm:*)'] } },
    });

    snapshot = setCliAgents({ cli: 'copilot', deny: null });
    expect(snapshot.clis.copilot.agents).toEqual({ enabled: true });
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
      'claude-code': { agents: { enabled: true }, sessions: true },
      codex: { agents: { enabled: true }, sessions: true },
      copilot: { agents: { enabled: true }, sessions: true },
    });
  });

  it('writes sessions and the default, keeping agents and unknown keys (HIVE-375)', () => {
    writeFileSync(
      process.env[CONFIG_PATH_ENV]!,
      JSON.stringify({ version: 2, projects: [], future: 1, clis: { codex: { agents: { model: 'gpt-6-luna' } } } }),
    );
    reloadConfig();

    let snapshot = setCliSessions({ sessions: { codex: false }, defaultCli: 'copilot' });
    expect(snapshot.clis.codex.sessions).toBe(false);
    expect(snapshot.sessionsDefaultCli).toBe('copilot');
    expect(JSON.parse(readFileSync(process.env[CONFIG_PATH_ENV]!, 'utf8'))).toMatchObject({
      future: 1,
      sessionsDefaultCli: 'copilot',
      clis: { codex: { sessions: false, agents: { model: 'gpt-6-luna' } } },
    });

    snapshot = setCliSessions({ sessions: { codex: true } });
    expect(snapshot.sessionsDefaultCli).toBe('copilot');
    snapshot = setCliSessions({ sessions: { codex: true }, defaultCli: null });
    const file = JSON.parse(readFileSync(process.env[CONFIG_PATH_ENV]!, 'utf8'));
    expect(file.clis.codex).toEqual({ agents: { model: 'gpt-6-luna' } });
    expect(file).not.toHaveProperty('sessionsDefaultCli');
    expect(snapshot.clis.codex.sessions).toBe(true);
  });

  it('refuses to turn the last CLI off, and writes nothing (HIVE-375)', () => {
    writeFileSync(process.env[CONFIG_PATH_ENV]!, doc({ clis: { codex: { sessions: false } } }));
    reloadConfig();
    const before = readFileSync(process.env[CONFIG_PATH_ENV]!, 'utf8');

    const snapshot = setCliSessions({ sessions: { 'claude-code': false, copilot: false } });
    expect(snapshot.errors).toEqual([expect.stringContaining('At least one CLI must stay on for sessions.')]);
    expect(snapshot.clis['claude-code'].sessions).toBe(true);
    expect(readFileSync(process.env[CONFIG_PATH_ENV]!, 'utf8')).toBe(before);
  });

  it('carries sessionsDefaultCli and each CLI’s sessions into the snapshot (HIVE-375)', () => {
    writeFileSync(
      process.env[CONFIG_PATH_ENV]!,
      doc({ sessionsDefaultCli: 'copilot', clis: { codex: { sessions: false } } }),
    );
    const snapshot = reloadConfig();
    expect(snapshot.sessionsDefaultCli).toBe('copilot');
    expect(snapshot.clis.codex.sessions).toBe(false);
    expect(snapshot.clis['claude-code'].sessions).toBe(true);
  });

  it('setCli writes command and session defaults, keeping agents, sessions and unknown keys (HIVE-376)', () => {
    writeFileSync(
      process.env[CONFIG_PATH_ENV]!,
      JSON.stringify({
        version: 2,
        projects: [],
        clis: { codex: { sessions: false, agents: { model: 'gpt-6-luna' }, future: 1 } },
      }),
    );
    reloadConfig();
    let snapshot = setCli({
      cli: 'codex',
      command: '/opt/bin/codex',
      sessionModel: 'gpt-6-terra',
      sessionEffort: 'high',
    });
    expect(snapshot.clis.codex).toMatchObject({
      command: '/opt/bin/codex',
      sessionModel: 'gpt-6-terra',
      sessionEffort: 'high',
      sessions: false,
    });
    expect(JSON.parse(readFileSync(process.env[CONFIG_PATH_ENV]!, 'utf8')).clis.codex).toEqual({
      sessions: false,
      agents: { model: 'gpt-6-luna' },
      future: 1,
      command: '/opt/bin/codex',
      sessionModel: 'gpt-6-terra',
      sessionEffort: 'high',
    });
    snapshot = setCli({ cli: 'codex', command: null, sessionEffort: null });
    expect(JSON.parse(readFileSync(process.env[CONFIG_PATH_ENV]!, 'utf8')).clis.codex).toEqual({
      sessions: false,
      agents: { model: 'gpt-6-luna' },
      future: 1,
      sessionModel: 'gpt-6-terra',
    });
    expect(snapshot.clis.codex.command).toBeUndefined();
  });
});

describe('sessions (HIVE-375)', () => {
  it('reads clis.<id>.sessions beside agents, and sessionsDefaultCli', () => {
    const parsed = parseConfig(
      doc({ clis: { codex: { sessions: false, agents: { enabled: false } } }, sessionsDefaultCli: 'codex' }),
      'config',
    );
    expect(parsed.clis).toEqual({ codex: { sessions: false, agents: { enabled: false } } });
    expect(parsed.sessionsDefaultCli).toBe('codex');
    expect(parsed.errors).toEqual([]);
  });

  it('ignores a non-boolean sessions and an unknown default, and says so', () => {
    const parsed = parseConfig(doc({ clis: { codex: { sessions: 'no' } }, sessionsDefaultCli: 'gemini' }), 'config');
    expect(parsed.clis).toEqual({ codex: {} });
    expect(parsed.sessionsDefaultCli).toBeUndefined();
    expect(parsed.errors).toEqual([
      'config.clis.codex.sessions: expected a boolean — ignored',
      'config.sessionsDefaultCli: expected one of claude-code, codex, copilot — ignored',
    ]);
  });
});

describe('command and session defaults (HIVE-376)', () => {
  it('reads command, sessionModel and sessionEffort', () => {
    const parsed = parseConfig(
      doc({
        clis: {
          codex: { command: '/opt/codex/bin/codex', sessionModel: 'gpt-6-luna', sessionEffort: 'high' },
        },
      }),
      'config',
    );
    expect(parsed.clis).toEqual({
      codex: { command: '/opt/codex/bin/codex', sessionModel: 'gpt-6-luna', sessionEffort: 'high' },
    });
    expect(parsed.errors).toEqual([]);
  });

  it('refuses a command on claude-code, an empty command, and words outside the vocabulary', () => {
    const parsed = parseConfig(
      doc({
        clis: {
          'claude-code': { command: 'claude', sessionModel: 'gpt-6', sessionEffort: 'ultra' },
          copilot: { command: '   ' },
        },
      }),
      'config',
    );
    expect(parsed.clis).toEqual({ 'claude-code': {}, copilot: {} });
    expect(parsed.errors).toEqual([
      'config.clis.claude-code.command: claude-code runs claudeCommand — ignored',
      expect.stringMatching(/^config\.clis\.claude-code\.sessionModel: expected one of /),
      expect.stringMatching(/^config\.clis\.claude-code\.sessionEffort: expected one of /),
      'config.clis.copilot.command: expected a non-empty string — ignored',
    ]);
  });

  it('resolves them through to the snapshot', () => {
    expect(resolveClis({ copilot: { command: 'gh-copilot', sessionModel: 'auto' } }).copilot).toEqual({
      agents: { enabled: true },
      sessions: true,
      command: 'gh-copilot',
      sessionModel: 'auto',
    });
  });
});

describe('clis.codex.installSkills (HIVE-372)', () => {
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

  it('reads clis.codex.installSkills and ignores it on another CLI', () => {
    writeFileSync(
      process.env[CONFIG_PATH_ENV]!,
      doc({ clis: { codex: { installSkills: true }, copilot: { installSkills: true } } }),
    );
    const snapshot = reloadConfig();
    expect(snapshot.clis.codex.installSkills).toBe(true);
    expect(snapshot.clis.copilot.installSkills).toBeUndefined();
    expect(snapshot.errors.some((error) => error.includes('copilot.installSkills'))).toBe(true);
  });

  it('refuses a non-boolean', () => {
    writeFileSync(process.env[CONFIG_PATH_ENV]!, doc({ clis: { codex: { installSkills: 'yes' } } }));
    const snapshot = reloadConfig();
    expect(snapshot.clis.codex.installSkills).toBeUndefined();
    expect(snapshot.errors.some((error) => error.includes('codex.installSkills: expected a boolean'))).toBe(true);
  });

  it('setCli writes installSkills true and deletes it on false', () => {
    writeFileSync(process.env[CONFIG_PATH_ENV]!, doc({ clis: { codex: { command: '/opt/codex' } } }));
    reloadConfig();
    expect(setCli({ cli: 'codex', installSkills: true }).clis.codex).toMatchObject({
      installSkills: true,
      command: '/opt/codex',
    });
    expect(JSON.parse(readFileSync(process.env[CONFIG_PATH_ENV]!, 'utf8')).clis.codex.installSkills).toBe(true);
    setCli({ cli: 'codex', installSkills: false });
    expect(JSON.parse(readFileSync(process.env[CONFIG_PATH_ENV]!, 'utf8')).clis.codex).toEqual({ command: '/opt/codex' });
  });
});
