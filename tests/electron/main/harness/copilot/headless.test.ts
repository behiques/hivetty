import { describe, expect, it } from 'vitest';

import {
  COPILOT_AUTH_ENV_KEYS,
  COPILOT_ROUTING_ENV_KEYS,
  COPILOT_SESSION_ENV_KEYS,
  copilotSettings,
  launchCopilotHeadless,
} from '../../../../../electron/main/harness/copilot/headless';
import type { HeadlessSpec } from '../../../../../electron/main/harness/port';

const spec = (over: Partial<HeadlessSpec> = {}): HeadlessSpec => ({
  conversation: { start: '11111111-2222-4333-8444-555555555551' },
  name: 'watcher',
  limits: { turns: 40 },
  files: {
    settings: '/u/s.json',
    pluginDir: '/u/plugin',
    mcpConfig: '/u/m.json',
    systemPrompt: '/u/p.md',
  },
  grants: ['mcp__hive__ledger_*'],
  prompt: 'You were woken.',
  subscriptionAuth: true,
  instructions: 'You are "watcher".',
  hiveServer: { command: '/Apps/HiveTTY', args: ['/u/mcp-host.js'], env: { ELECTRON_RUN_AS_NODE: '1' } },
  stateDir: '/h/cli/copilot',
  workdir: '/h/work/watcher',
  ...over,
});
const U = '11111111-2222-4333-8444-555555555551';

describe('launchCopilotHeadless', () => {
  it('spells a first wake', () => {
    expect(
      launchCopilotHeadless(spec({ model: 'claude-sonnet-5.5', effort: 'high', deny: ['shell(rm:*)'] }))
        .args,
    ).toMatchSnapshot();
  });

  // `--session-id` resumes a session that exists and starts one that does not (probed at 1.0.104),
  // so a first wake that died before Copilot made its session can still be resumed.
  it('pins the id with --session-id on a start and on a resume', () => {
    expect(launchCopilotHeadless(spec()).args).toEqual(expect.arrayContaining(['--session-id', U]));

    const resumed = launchCopilotHeadless(spec({ conversation: { resume: U } })).args;

    expect(resumed).toEqual(expect.arrayContaining(['--session-id', U]));
    expect(resumed.some((arg) => arg.startsWith('--resume'))).toBe(false);
  });

  it('always runs non-interactive, silent, with no ask_user and no built-in MCP', () => {
    expect(launchCopilotHeadless(spec()).args).toEqual(
      expect.arrayContaining(['-p', 'You were woken.', '-s', '--no-ask-user', '--disable-builtin-mcps']),
    );
  });

  it('grants the three kinds the hook decides on, never everything', () => {
    const args = launchCopilotHeadless(spec()).args;

    expect(args).toEqual(
      expect.arrayContaining(['--allow-tool', 'shell', '--allow-tool', 'write', '--allow-tool', 'hive']),
    );
    for (const flag of [
      '--allow-all',
      '--allow-all-tools',
      '--yolo',
      '--allow-all-paths',
      '--allow-all-urls',
      '--no-auto-update',
    ]) {
      expect(args).not.toContain(flag);
    }
  });

  it('puts the deny patterns last among the permission flags', () => {
    const args = launchCopilotHeadless(spec({ deny: ['shell(rm:*)', 'write(.env)'] })).args;
    const lastAllow = args.lastIndexOf('--allow-tool');

    expect(args.indexOf('--deny-tool')).toBeGreaterThan(lastAllow);
    expect(args.filter((_, i) => args[i - 1] === '--deny-tool')).toEqual(['shell(rm:*)', 'write(.env)']);
  });

  it('passes the hive server by env reference, so no secret is on the argv', () => {
    const args = launchCopilotHeadless(spec()).args;
    const config = JSON.parse(args[args.indexOf('--additional-mcp-config') + 1]!);

    expect(config.mcpServers.hive).toMatchObject({
      type: 'local',
      command: '/Apps/HiveTTY',
      args: ['/u/mcp-host.js'],
      tools: ['*'],
    });
    expect(config.mcpServers.hive.env['HIVE_HOOK_TOKEN']).toBe('${HIVE_HOOK_TOKEN}');
    expect(config.mcpServers.hive.env['ELECTRON_RUN_AS_NODE']).toBe('1');
    expect(args.join(' ')).not.toMatch(/gho_|github_pat_/);
  });

  it('replaces a value the server spec carries with its reference', () => {
    const args = launchCopilotHeadless(
      spec({ hiveServer: { command: '/Apps/HiveTTY', args: [], env: { HIVE_HOOK_TOKEN: 's3cret' } } }),
    ).args;

    expect(args.join(' ')).not.toContain('s3cret');
  });

  it('writes usage under the home, keyed by the conversation', () => {
    const plan = launchCopilotHeadless(spec());

    expect(plan.usageFile).toBe(`/h/cli/copilot/usage/${U}.json`);
    expect(plan.args).toEqual(expect.arrayContaining(['--usage-output-file', plan.usageFile]));
  });

  it('writes the hooks into the home and the instructions into the workdir', () => {
    expect(launchCopilotHeadless(spec()).files).toEqual([
      { path: '/h/cli/copilot/settings.json', text: copilotSettings() },
      { path: '/h/work/watcher/AGENTS.md', text: 'You are "watcher".' },
    ]);
  });

  it('the hooks: agentStop to /hook in an envelope, preToolUse to /fence failing closed', () => {
    const settings = JSON.parse(copilotSettings());

    expect(Object.keys(settings.hooks).sort()).toEqual(['agentStop', 'preToolUse']);
    expect(settings.hooks.agentStop[0].bash).toContain('"event":"agentStop"');
    expect(settings.hooks.agentStop[0].bash).toContain('x-hive-harness: copilot');
    expect(settings.hooks.preToolUse[0].bash).toContain('/fence');
    expect(settings.hooks.preToolUse[0].bash).toContain('"permissionDecision":"deny"');
    expect(settings.hooks.preToolUse[0].timeoutSec).toBe(35);
    expect(settings.banner).toBe('never');
  });

  it('moves the home, strips the parent session and every other token', () => {
    const plan = launchCopilotHeadless(spec());

    expect(plan.addEnv).toEqual({ COPILOT_HOME: '/h/cli/copilot' });
    expect(plan.stripEnv).toEqual([
      ...COPILOT_SESSION_ENV_KEYS,
      ...COPILOT_AUTH_ENV_KEYS,
      ...COPILOT_ROUTING_ENV_KEYS,
    ]);
    expect(COPILOT_AUTH_ENV_KEYS).toEqual(['GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_ALLOW_ALL']);
    expect(COPILOT_SESSION_ENV_KEYS).toEqual([
      'COPILOT_AGENT_SESSION_ID',
      'COPILOT_CLI',
      'COPILOT_CLI_BINARY_VERSION',
      'COPILOT_CLI_RESOLVED_DIST_DIR',
      'COPILOT_PROJECT_DIR',
      'COPILOT_CUSTOM_INSTRUCTIONS_DIRS',
    ]);
    expect(plan.args).toEqual(expect.arrayContaining(['--secret-env-vars', 'COPILOT_GITHUB_TOKEN']));
  });

  it('strips every key that changes who pays, which model answers or what is approved', () => {
    const plan = launchCopilotHeadless(spec());

    expect(plan.stripPrefixes).toEqual(['COPILOT_PROVIDER_']);
    expect(COPILOT_ROUTING_ENV_KEYS).toEqual([
      'COPILOT_OFFLINE',
      'COPILOT_MODEL',
      'COPILOT_AUTO_TIER',
      'COPILOT_ASSISTED_APPROVAL',
      'GH_ENTERPRISE_TOKEN',
      'GITHUB_ENTERPRISE_TOKEN',
    ]);
    expect(plan.stripEnv).toEqual(expect.arrayContaining([...COPILOT_ROUTING_ENV_KEYS]));
    // An Enterprise user's stored token authenticates against these hosts.
    expect(plan.stripEnv).not.toContain('GH_HOST');
    expect(plan.stripEnv).not.toContain('COPILOT_GH_HOST');
  });

  it('names its conversation and stops on it', () => {
    const plan = launchCopilotHeadless(spec());

    expect(plan.namesConversation).toBe(true);
    expect(plan.stopPattern).toBe(U);
  });

  it('refuses an http hive server: no containers', () => {
    expect(() =>
      launchCopilotHeadless(spec({ hiveServer: { type: 'http', url: 'http://h/mcp', headers: {} } })),
    ).toThrow(/container/);
  });
});
