import { describe, expect, it } from 'vitest';

import { shellQuote } from '../../../../../electron/main/container/shell-quote';
import { CODEX_AUTH_ENV_KEYS, CODEX_SESSION_ENV_KEYS } from '../../../../../electron/main/harness/codex/headless';
import { launchCodexSession } from '../../../../../electron/main/harness/codex/launch';
import { hookEntry, toml, tomlList } from '../../../../../electron/main/harness/codex/toml';
import { hookCommand } from '../../../../../electron/main/harness/hook-commands';
import type { LaunchSpec } from '../../../../../electron/main/harness/port';
import type { StdioServerSpec } from '../../../../../electron/main/mcp/agent-config';

const HIVE: StdioServerSpec = { command: '/app/electron', args: ['/app/mcp-host.js'], env: { ELECTRON_RUN_AS_NODE: '1' } };

const line = (spec: Partial<LaunchSpec> = {}) => launchCodexSession({ command: 'codex', ...spec }).command;

describe('codex session command (HIVE-279)', () => {
  it('starts codex in a login shell that exits with it', () => {
    expect(line()).toMatch(/^codex .* && exit$/);
  });

  it('keeps the user’s config: no --ignore-user-config, ever (D2)', () => {
    expect(line({ hiveServer: HIVE })).not.toContain('--ignore-user-config');
  });

  it('passes the picked model and effort', () => {
    expect(line({ model: 'gpt-5.6-terra', effort: 'xhigh' })).toContain(
      `-m gpt-5.6-terra -c ${shellQuote('model_reasoning_effort="xhigh"')}`,
    );
  });

  it('refuses a model or effort outside Codex’s vocabulary rather than quote it', () => {
    expect(() => line({ model: 'opus' })).toThrow(/codex: refusing model/);
    expect(() => line({ effort: 'none; rm -rf ~' })).toThrow(/codex: refusing effort/);
  });

  it('reports every session event to the receiver, the plan tool by matcher', () => {
    const l = line();
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop']) {
      expect(l).toContain(shellQuote(hookEntry(event, hookCommand())));
    }
    expect(l).toContain(shellQuote(hookEntry('PostToolUse', hookCommand(), 'update_plan')));
  });

  it('turns the plan tool on, which the TUI leaves off (FINDINGS P4)', () => {
    expect(line()).toContain(shellQuote('tools.update_plan.enabled=true'));
  });

  it('turns paste-burst off so a typed Enter submits', () => {
    expect(line()).toContain(shellQuote('tui.disable_paste_burst=true'));
  });

  it('serves the hive MCP server with its identity forwarded by name, no token on the argv', () => {
    const l = line({ hiveServer: HIVE });
    expect(l).toContain(shellQuote(`mcp_servers.hive.command=${toml('/app/electron')}`));
    expect(l).toContain(shellQuote(`mcp_servers.hive.args=${tomlList(['/app/mcp-host.js'])}`));
    expect(l).toContain(shellQuote('mcp_servers.hive.env={"ELECTRON_RUN_AS_NODE"="1"}'));
    expect(l).toContain(
      shellQuote(`mcp_servers.hive.env_vars=${tomlList(['HIVE_RECEIVER_URL', 'HIVE_SESSION_ID', 'HIVE_HOOK_TOKEN'])}`),
    );
    expect(l).not.toMatch(/HIVE_HOOK_TOKEN=/);
  });

  it('omits the hive server when main has none to offer', () => {
    expect(line()).not.toContain('mcp_servers.hive');
  });

  it('bypasses hook trust only when asked', () => {
    expect(line({ bypassHookTrust: true })).toContain('--dangerously-bypass-hook-trust');
    expect(line({ bypassHookTrust: false })).not.toContain('--dangerously-bypass-hook-trust');
    expect(line()).not.toContain('--dangerously-bypass-hook-trust');
  });

  it('resumes by the recorded id, and starts fresh without one', () => {
    const id = '0199a2b3-4c5d-7e6f-8a9b-0c1d2e3f4a5b';
    expect(line({ sessionUuid: id, resume: true })).toMatch(new RegExp(`^codex resume ${id} `));
    // A fresh start names no id: codex picks it and the first hook reports it.
    expect(line({ sessionUuid: id })).not.toContain(id);
  });

  it('keeps every flag on a resume, after the id (`codex resume --help` at 0.164)', () => {
    const id = '0199a2b3-4c5d-7e6f-8a9b-0c1d2e3f4a5b';
    expect(line({ sessionUuid: id, resume: true, model: 'gpt-6-luna', bypassHookTrust: true })).toMatch(
      new RegExp(`^codex resume ${id} -m gpt-6-luna .*hooks\\.Stop.* --dangerously-bypass-hook-trust && exit$`),
    );
  });

  it('starts fresh rather than type an id that is not a uuid', () => {
    expect(line({ sessionUuid: 'x; rm -rf ~', resume: true })).not.toContain('rm -rf');
  });

  it('puts the task last, quoted, behind --', () => {
    expect(line({ task: 'fix it\nnow' })).toMatch(/ -- 'fix it now' && exit$/);
  });

  it('does not repeat the task on a resume', () => {
    expect(line({ task: 'x', sessionUuid: '0199a2b3-4c5d-7e6f-8a9b-0c1d2e3f4a5b', resume: true })).not.toContain(
      " -- 'x'",
    );
  });

  it('strips a parent codex’s session env, and API keys under subscription auth', () => {
    expect(launchCodexSession({ command: 'codex' }).stripEnv).toEqual([...CODEX_SESSION_ENV_KEYS]);
    expect(launchCodexSession({ command: 'codex', subscriptionAuth: true }).stripEnv).toEqual([
      ...CODEX_SESSION_ENV_KEYS,
      ...CODEX_AUTH_ENV_KEYS,
    ]);
  });

  it('splits text and Enter the way Claude’s sessions do (HIVE-63)', () => {
    expect(launchCodexSession({ command: 'codex' }).submitDelayMs).toBe(300);
  });
});
