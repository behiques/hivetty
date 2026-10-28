import { describe, expect, it } from 'vitest';

import {
  COPILOT_SESSION_EVENTS,
  copilotPluginFiles,
  launchCopilotSession,
} from '../../../../../electron/main/harness/copilot/launch';
import { hookCommand } from '../../../../../electron/main/harness/hook-commands';

const UUID = '11111111-2222-4333-8444-555555555551';
const BASE = { command: 'copilot', sessionUuid: UUID, stateDir: '/Users/x/.hivetty/cli/copilot session' };
const HIVE = { command: '/app/electron', args: ['/app/mcp-host.js'], env: { ELECTRON_RUN_AS_NODE: '1' } };

describe('launchCopilotSession', () => {
  it('unsets the token keys, pins the id, loads the plugin and exits with the shell', () => {
    expect(launchCopilotSession(BASE).command).toBe(
      'unset COPILOT_GITHUB_TOKEN GH_TOKEN GITHUB_TOKEN; copilot --session-id 11111111-2222-4333-8444-555555555551' +
        " --plugin-dir '/Users/x/.hivetty/cli/copilot session/plugin' && exit",
    );
  });

  it('passes the picked model and effort from the closed vocabulary', () => {
    expect(launchCopilotSession({ ...BASE, model: 'auto', effort: 'high' }).command).toContain(
      '--model auto --reasoning-effort high',
    );
    expect(() => launchCopilotSession({ ...BASE, model: 'gpt; rm -rf ~' })).toThrow(/refusing model/);
    expect(() => launchCopilotSession({ ...BASE, effort: 'turbo' })).toThrow(/refusing effort/);
  });

  it('leaves the effort off a model with no effort scale: kimi-k3 refuses it (FINDINGS P8)', () => {
    const { command } = launchCopilotSession({ ...BASE, model: 'kimi-k3', effort: 'medium' });
    expect(command).toContain('--model kimi-k3');
    expect(command).not.toContain('--reasoning-effort');
  });

  it('adds the hive server by ${VAR} reference, shell-quoted', () => {
    const { command } = launchCopilotSession({ ...BASE, hiveServer: HIVE });
    expect(command).toContain(`--additional-mcp-config '{"mcpServers":{"hive":`);
    expect(command).toContain('"HIVE_SESSION_ID":"${HIVE_SESSION_ID}"');
    expect(command).not.toMatch(/HIVE_RUN/);
  });

  it('runs a task with -i on a fresh start only, newlines folded and quoted', () => {
    expect(launchCopilotSession({ ...BASE, task: "fix it's\nbug" }).command).toContain(
      `-i 'fix it'\\''s bug' && exit`,
    );
    expect(launchCopilotSession({ ...BASE, task: 'again', resume: true }).command).not.toContain(' -i ');
    expect(launchCopilotSession({ ...BASE, task: '  \n ' }).command).not.toContain(' -i ');
  });

  it('resumes with the same --session-id: one flag starts and resumes (HIVE-343)', () => {
    expect(launchCopilotSession({ ...BASE, resume: true }).command).toContain(`--session-id ${UUID}`);
  });

  it('never passes a flag that widens trust or approval', () => {
    const { command } = launchCopilotSession({ ...BASE, hiveServer: HIVE, task: 't', model: 'auto', effort: 'low' });
    for (const flag of ['--allow-all', '--yolo', '--trust-folder', '--no-auto-update', '--allow-tool']) {
      expect(command).not.toContain(flag);
    }
  });

  it('refuses without a pinned uuid or a state dir', () => {
    expect(() => launchCopilotSession({ command: 'copilot', stateDir: '/s' })).toThrow(/uuid/);
    expect(() => launchCopilotSession({ command: 'copilot', sessionUuid: 'nope', stateDir: '/s' })).toThrow(/uuid/);
    expect(() => launchCopilotSession({ command: 'copilot', sessionUuid: UUID })).toThrow(/state directory/);
  });

  it('strips the parent session and the token keys from the pty', () => {
    expect(launchCopilotSession(BASE).stripEnv).toEqual([
      'COPILOT_AGENT_SESSION_ID',
      'COPILOT_CLI',
      'COPILOT_CLI_BINARY_VERSION',
      'COPILOT_CLI_RESOLVED_DIST_DIR',
      'COPILOT_PROJECT_DIR',
      'COPILOT_CUSTOM_INSTRUCTIONS_DIRS',
      'COPILOT_GITHUB_TOKEN',
      'GH_TOKEN',
      'GITHUB_TOKEN',
    ]);
  });

  it('returns the plugin files for the core to write', () => {
    expect(launchCopilotSession(BASE).files).toEqual(copilotPluginFiles(`${BASE.stateDir}/plugin`));
  });
});

describe('copilotPluginFiles', () => {
  it('is a manifest and one wrapped hook per session event', () => {
    const [manifest, hooks] = copilotPluginFiles('/p');
    expect(manifest.path).toBe('/p/plugin.json');
    expect(JSON.parse(manifest.text)).toMatchObject({ name: 'hivetty' });
    expect(hooks.path).toBe('/p/hooks/hooks.json');
    const parsed = JSON.parse(hooks.text) as { version: number; hooks: Record<string, Array<{ bash: string }>> };
    expect(parsed.version).toBe(1);
    expect(Object.keys(parsed.hooks)).toEqual([...COPILOT_SESSION_EVENTS]);
    expect(COPILOT_SESSION_EVENTS).toContain('notification');
    for (const event of COPILOT_SESSION_EVENTS) {
      expect(parsed.hooks[event]).toEqual([
        { type: 'command', bash: hookCommand({ harness: 'copilot', wrap: event }), timeoutSec: 10 },
      ]);
    }
  });
});
