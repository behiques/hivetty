// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { groupOfId, KEY_PATHS, readKeys, writeKeys } from '../../../../electron/main/sync/allow-lists';

/**
 * What settings sync may read from and write to config.json (HIVE-284). These lists are the only thing
 * between a token or a project path and the cloud, so each never-synced name is asserted by name.
 */

const doc = () => ({
  version: 2,
  claudeCommand: 'claude',
  shell: '/bin/zsh',
  env: { TOKEN: 'secret' },
  projects: [{ path: '/Users/ada/code/app' }],
  server: { relay: { enabled: true } },
  remote: { mode: 'local' },
  receiver: { host: 'x' },
  account: { cloudUrl: 'https://x' },
  slack: { channel: 'c' },
  agentsDefaultCli: 'codex',
  sessionsDefaultCli: 'claude-code',
  notifications: { 'pr.merged': 'banner' },
  jira: {
    site: 'acme.atlassian.net',
    email: 'ada@acme.dev',
    jql: 'assignee = currentUser()',
    workflow: { kind: 'skill', skill: 'work-on' },
  },
  clis: {
    codex: {
      command: 'codex',
      sessions: true,
      sessionModel: 'gpt-5',
      sessionEffort: 'high',
      installSkills: true,
      skipPermissions: true,
      agents: { enabled: true, model: 'gpt-5', effort: 'low', sandbox: 'workspace-write' },
    },
    copilot: { command: 'copilot', agents: { deny: ['shell'] } },
    'claude-code': { sessionModel: 'opus', skipPermissions: true },
  },
});

describe('the allow-lists', () => {
  it('reads exactly the listed keys, each under its group', () => {
    expect(readKeys(doc())).toEqual({
      'harnesses:k:claudeCommand': 'claude',
      'harnesses:k:clis.codex.command': 'codex',
      'harnesses:k:clis.copilot.command': 'copilot',
      'harnesses:k:clis.codex.sessions': true,
      'harnesses:k:clis.codex.sessionModel': 'gpt-5',
      'harnesses:k:clis.codex.sessionEffort': 'high',
      'harnesses:k:clis.codex.agents.enabled': true,
      'harnesses:k:clis.codex.agents.model': 'gpt-5',
      'harnesses:k:clis.codex.agents.effort': 'low',
      'harnesses:k:clis.codex.agents.sandbox': 'workspace-write',
      'harnesses:k:clis.copilot.agents.deny': ['shell'],
      'harnesses:k:clis.claude-code.sessionModel': 'opus',
      'harnesses:k:agentsDefaultCli': 'codex',
      'harnesses:k:sessionsDefaultCli': 'claude-code',
      'automation:k:jira.workflow': { kind: 'skill', skill: 'work-on' },
      'workspace:k:notifications': { 'pr.merged': 'banner' },
      'workspace:k:jira.jql': 'assignee = currentUser()',
    });
  });

  it.each([
    'clis.codex.installSkills',
    'clis.codex.skipPermissions',
    'clis.claude-code.skipPermissions',
    'clis.copilot.skipPermissions',
    'clis.claude-code.command',
    'projects',
    'env',
    'shell',
    'server',
    'remote',
    'receiver',
    'account',
    'slack',
    'jira.site',
    'jira.email',
    'version',
  ])('never lists %s', (path) => {
    expect(Object.values(KEY_PATHS).flat()).not.toContain(path);
    expect(Object.keys(readKeys(doc())).some((id) => id.endsWith(`:k:${path}`))).toBe(false);
  });

  it('never lists a path with a prototype segment', () => {
    for (const path of Object.values(KEY_PATHS).flat()) {
      expect(path.split('.').some((part) => ['__proto__', 'constructor', 'prototype'].includes(part))).toBe(false);
    }
  });

  it('writes only listed paths and leaves every other key as the receiving Mac has it', () => {
    const next = writeKeys(
      doc(),
      {
        'harnesses:k:clis.codex.sessionModel': 'o4',
        'harnesses:k:clis.codex.installSkills': false,
        'harnesses:k:clis.codex.skipPermissions': false,
        'harnesses:k:projects': [],
        'workspace:k:env': {},
        'workspace:k:appearance.theme': 'dark',
        'automation:k:__proto__.polluted': true,
      },
      ['workspace:k:jira.jql', 'harnesses:k:shell'],
    );
    expect(next).toEqual({
      ...doc(),
      jira: { site: 'acme.atlassian.net', email: 'ada@acme.dev', workflow: { kind: 'skill', skill: 'work-on' } },
      clis: { ...doc().clis, codex: { ...doc().clis.codex, sessionModel: 'o4' } },
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('does not change the draft it was given', () => {
    const draft = doc();
    writeKeys(draft, { 'harnesses:k:clis.codex.sessionModel': 'o4' }, ['workspace:k:jira.jql']);
    expect(draft).toEqual(doc());
  });

  it('creates missing parents on set and prunes empty ones on remove', () => {
    expect(writeKeys({}, { 'harnesses:k:clis.codex.agents.model': 'gpt-5' }, [])).toEqual({
      clis: { codex: { agents: { model: 'gpt-5' } } },
    });
    expect(writeKeys({ clis: { codex: { agents: { model: 'gpt-5' } } } }, {}, ['harnesses:k:clis.codex.agents.model'])).toEqual(
      {},
    );
  });

  it('replaces a parent that is not an object when setting under it', () => {
    expect(writeKeys({ clis: 'nope' }, { 'harnesses:k:clis.codex.command': 'codex' }, [])).toEqual({
      clis: { codex: { command: 'codex' } },
    });
  });

  it('leaves the document alone when removing a key that is not there', () => {
    const draft = { clis: { codex: { command: 'codex' } }, jira: 'flat' };
    expect(writeKeys(draft, {}, ['harnesses:k:clis.copilot.command', 'workspace:k:jira.jql'])).toBe(draft);
  });

  it('names the group of an id', () => {
    expect(groupOfId('automation:f:skills/review/SKILL.md')).toBe('automation');
    expect(groupOfId('workspace:k:appearance.theme')).toBe('workspace');
    expect(() => groupOfId('nope:k:x')).toThrow();
    expect(() => groupOfId('no-colon')).toThrow();
  });
});
