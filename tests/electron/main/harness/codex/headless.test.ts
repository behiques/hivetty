import { describe, expect, it } from 'vitest';

import {
  CODEX_AUTH_ENV_KEYS,
  CODEX_SESSION_ENV_KEYS,
  codexFence,
  launchCodexHeadless,
  toml,
} from '../../../../../electron/main/harness/codex/headless';
import type { HeadlessSpec } from '../../../../../electron/main/harness/port';

const spec = (over: Partial<HeadlessSpec> = {}): HeadlessSpec => ({
  conversation: { start: 'new-uuid' },
  name: 'watcher',
  limits: { turns: 40 },
  files: {
    settings: '/u/hive/s.json',
    pluginDir: '/u/hive/plugin',
    mcpConfig: '/u/hive/m.json',
    systemPrompt: '/u/hive/p.md',
  },
  grants: ['mcp__hive__ledger_*'],
  prompt: 'You were woken.',
  subscriptionAuth: true,
  instructions: 'You are "watcher".\nBe \\brief\\.',
  hiveServer: {
    command: '/Applications/HiveTTY.app/Contents/MacOS/HiveTTY',
    args: ['/u/hive/mcp-host.js'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  },
  ...over,
});

describe('launchCodexHeadless', () => {
  it('spells a first wake', () => {
    expect(
      launchCodexHeadless(spec({ model: 'gpt-6-luna', effort: 'high', sandbox: 'workspace-write' }))
        .args,
    ).toMatchSnapshot();
  });

  it('spells a resume, without the instructions it keeps', () => {
    const plan = launchCodexHeadless(spec({ conversation: { resume: 'thread-1' } }));

    expect(plan.args.slice(0, 3)).toEqual(['exec', 'resume', 'thread-1']);
    expect(plan.args.join(' ')).not.toContain('developer_instructions');
    expect(plan.args).toMatchSnapshot();
  });

  it('spells the read-only sandbox on both shapes', () => {
    expect(launchCodexHeadless(spec({ sandbox: 'read-only' })).args).toContain(
      'sandbox_mode="read-only"',
    );
    expect(
      launchCodexHeadless(spec({ sandbox: 'read-only', conversation: { resume: 't' } })).args,
    ).toContain('sandbox_mode="read-only"');
  });

  it('omits -m and the effort when the card chose none, and defaults the sandbox', () => {
    const args = launchCodexHeadless(spec()).args;

    expect(args).not.toContain('-m');
    expect(args.join(' ')).not.toContain('model_reasoning_effort');
    expect(args).toContain('sandbox_mode="workspace-write"');
  });

  it('always skips the git check, ignores user config and bypasses hook trust', () => {
    expect(launchCodexHeadless(spec()).args).toEqual(
      expect.arrayContaining([
        '--json',
        '--skip-git-repo-check',
        '--ignore-user-config',
        '--dangerously-bypass-hook-trust',
      ]),
    );
  });

  it('quotes text as TOML that parses back to itself', () => {
    for (const text of ['plain', 'a "quote"', 'back\\slash', 'line\nbreak', 'tab\tand é']) {
      expect(JSON.parse(toml(text))).toBe(text); // a TOML basic string is a JSON string
    }
  });

  it('escapes what JSON leaves raw but TOML forbids, and replaces what TOML cannot hold', () => {
    // DEL is a control character TOML requires escaped; a lone surrogate is no scalar value.
    expect(toml('a\u007fb')).toBe('"a\\u007fb"');
    expect(toml('x\ud800y')).toBe('"x\ufffdy"');
    expect(toml('\udc00')).toBe('"\ufffd"');
    expect(toml('😀')).toBe('"😀"');
  });

  it('never puts a token on the argv: the identity is forwarded by name', () => {
    const args = launchCodexHeadless(spec()).args;
    const value = (key: string) => args.find((arg) => arg.startsWith(`${key}=`));

    expect(value('mcp_servers.hive.env_vars')).toBe(
      'mcp_servers.hive.env_vars=["HIVE_RECEIVER_URL","HIVE_SESSION_ID","HIVE_HOOK_TOKEN","HIVE_RUN_ID","HIVE_RUN_TOKEN","HIVE_GRANTS"]',
    );
    expect(value('hooks.Stop')).toContain('x-hive-session: $HIVE_SESSION_ID');
    expect(value('hooks.Stop')).toContain('x-hive-token: $HIVE_HOOK_TOKEN');
    expect(args.join(' ')).not.toContain('HIVE_HOOK_TOKEN=');
  });

  it('stops on the wake id, which a first wake does not otherwise name', () => {
    const plan = launchCodexHeadless(spec({ conversation: { start: 'uuid-1' } }));

    expect(plan.stopPattern).toBe('uuid-1');
    expect(plan.args).toContain('mcp_servers.hive_wake.command="uuid-1"');
    expect(plan.namesConversation).toBe(false);
    expect(launchCodexHeadless(spec({ conversation: { resume: 't' } })).namesConversation).toBe(
      true,
    );
  });

  it('strips the parent session always, and the API keys under subscription auth', () => {
    expect(launchCodexHeadless(spec({ subscriptionAuth: false })).stripEnv).toEqual(
      CODEX_SESSION_ENV_KEYS,
    );
    expect(launchCodexHeadless(spec({ subscriptionAuth: true })).stripEnv).toEqual([
      ...CODEX_SESSION_ENV_KEYS,
      ...CODEX_AUTH_ENV_KEYS,
    ]);
    expect(CODEX_SESSION_ENV_KEYS).not.toContain('CODEX_HOME');
    expect(CODEX_SESSION_ENV_KEYS).not.toContain('CODEX_API_KEY');
  });

  it('refuses an http hive server: containers are not supported yet', () => {
    expect(() =>
      launchCodexHeadless(
        spec({ hiveServer: { type: 'http', url: 'http://h/mcp', headers: {} } }),
      ),
    ).toThrow(/container/);
  });
});

describe('codexFence', () => {
  it('refuses every rule set until the PreToolUse fence lands', () => {
    expect(codexFence.express([])).toEqual({ ok: false, unexpressible: ['*'] });
    expect(codexFence.express(['Read'])).toEqual({ ok: false, unexpressible: ['*'] });
  });
});
