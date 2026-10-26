// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../../../electron/main/config/parse';

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
    const parsed = parseConfig(doc({ clis: { codex: { agents: { enabled: true } } } }), 'config');

    expect(parsed.clis).toEqual({});
    expect(parsed.errors).toContain('config.clis: unknown key "codex" — ignored');
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

    const bad = parseConfig(doc({ agentsDefaultCli: 'codex' }), 'config');

    expect(bad.agentsDefaultCli).toBeUndefined();
    expect(bad.errors).toEqual(['config.agentsDefaultCli: expected one of claude-code — ignored']);
  });
});
