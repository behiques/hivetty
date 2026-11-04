import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { shellQuote } from '../../../../../electron/main/container/shell-quote';
import {
  COPILOT_SESSION_EVENTS,
  copilotPluginFiles,
  launchCopilotSession,
} from '../../../../../electron/main/harness/copilot/launch';
import { goalVerifierCommand, hookCommand } from '../../../../../electron/main/harness/hook-commands';

const UUID = '11111111-2222-4333-8444-555555555551';
const BASE = { command: 'copilot', sessionUuid: UUID, stateDir: '/Users/x/.hivetty/cli/copilot session' };
const HIVE = { command: '/app/electron', args: ['/app/mcp-host.js'], env: { ELECTRON_RUN_AS_NODE: '1' } };

describe('launchCopilotSession', () => {
  it('unsets the token keys, pins the id, loads the plugin and exits with the shell', () => {
    expect(launchCopilotSession(BASE).command).toBe(
      'unset COPILOT_GITHUB_TOKEN GH_TOKEN GITHUB_TOKEN COPILOT_ALLOW_ALL COPILOT_ASSISTED_APPROVAL; copilot --session-id 11111111-2222-4333-8444-555555555551' +
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

  it('pre-approves session_done alone, so finishing never prompts (HIVE-368)', () => {
    const { command } = launchCopilotSession({ ...BASE, hiveServer: HIVE });
    expect(command).toContain(`--allow-tool 'hive(session_done)'`);
  });

  it('approves nothing without a hive server', () => {
    expect(launchCopilotSession(BASE).command).not.toContain('--allow-tool');
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
    for (const flag of ['--allow-all', '--yolo', '--trust-folder', '--no-auto-update']) {
      expect(command).not.toContain(flag);
    }
    // HIVE-368: one exception, by name, and only that one: `done`'s `session_done` never prompts.
    expect(command.match(/--allow-tool \S+/g)).toEqual([`--allow-tool 'hive(session_done)'`]);
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
      'COPILOT_ALLOW_ALL',
      'COPILOT_ASSISTED_APPROVAL',
    ]);
  });

  it('never lets the user env auto-approve: no permissionRequest would fire, so no card (HIVE-363)', () => {
    const { command, stripEnv } = launchCopilotSession(BASE);
    for (const key of ['COPILOT_ALLOW_ALL', 'COPILOT_ASSISTED_APPROVAL']) {
      expect(stripEnv).toContain(key);
      expect(command.split('; ')[0]!.split(' ')).toContain(key);
    }
  });

  it('returns the plugin files for the core to write', () => {
    expect(launchCopilotSession(BASE).files).toEqual(copilotPluginFiles(`${BASE.stateDir}/plugin`));
  });

  const SKILLS = '/Users/x/Library/Application Support/HiveTTY/hive/plugins/copilot';

  it("adds HiveTTY's skills as a second --plugin-dir after the hooks plugin, quoted (HIVE-362)", () => {
    const { command } = launchCopilotSession({ ...BASE, pluginDir: SKILLS, hiveServer: HIVE });
    const hooks = command.indexOf(`--plugin-dir '/Users/x/.hivetty/cli/copilot session/plugin'`);
    const skills = command.indexOf(`--plugin-dir '${SKILLS}'`);
    const mcp = command.indexOf('--additional-mcp-config');
    const allow = command.indexOf(`--allow-tool 'hive(session_done)'`);
    expect(hooks).toBeGreaterThan(0);
    expect(skills).toBeGreaterThan(hooks);
    expect(mcp).toBeGreaterThan(skills);
    expect(allow).toBeGreaterThan(mcp);
  });

  it('points the instructions dir at the same folder, after any value the user set (HIVE-362)', () => {
    const { command } = launchCopilotSession({ ...BASE, pluginDir: SKILLS });
    expect(command).toContain(
      `; COPILOT_CUSTOM_INSTRUCTIONS_DIRS="\${COPILOT_CUSTOM_INSTRUCTIONS_DIRS:+$COPILOT_CUSTOM_INSTRUCTIONS_DIRS,}"'${SKILLS}' copilot --session-id`,
    );
  });

  it('writes the verifier into the plugin a session launches with (HIVE-370)', () => {
    expect(launchCopilotSession({ ...BASE, pluginDir: SKILLS }).files).toEqual(
      copilotPluginFiles(`${BASE.stateDir}/plugin`, SKILLS),
    );
  });

  it('adds neither without a rendered folder', () => {
    const { command } = launchCopilotSession(BASE);
    expect(command.match(/--plugin-dir/g)).toHaveLength(1);
    expect(command).not.toContain('COPILOT_CUSTOM_INSTRUCTIONS_DIRS');
  });
});

describe('copilotPluginFiles', () => {
  it('is a manifest and one wrapped hook per session event without a rendered skills folder', () => {
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

  it("adds goal-on's verifier to agentStop, after the status hook, when the skills are rendered (HIVE-370)", () => {
    const hooks = JSON.parse(copilotPluginFiles('/p', '/skills')[1]!.text) as {
      hooks: Record<string, Array<{ bash: string; timeoutSec: number }>>;
    };
    expect(hooks.hooks['agentStop']).toEqual([
      { type: 'command', bash: hookCommand({ harness: 'copilot', wrap: 'agentStop' }), timeoutSec: 10 },
      { type: 'command', bash: goalVerifierCommand('/skills', 'copilot'), timeoutSec: 30 },
    ]);
    for (const event of COPILOT_SESSION_EVENTS.filter((e) => e !== 'agentStop')) expect(hooks.hooks[event]).toHaveLength(1);
  });
});

describe('the OTel export (HIVE-335)', () => {
  const base = { command: 'copilot', sessionUuid: '11111111-2222-4333-8444-555555555555', stateDir: '/state' };
  it('exports the file path, after the unset, only when the user has no OTel of their own', () => {
    const { command } = launchCopilotSession({ ...base, exportPath: '/state/otel/sess-07.jsonl' });
    expect(command).toContain(
      `; [ -n "\${OTEL_EXPORTER_OTLP_ENDPOINT}\${COPILOT_OTEL_FILE_EXPORTER_PATH}\${COPILOT_OTEL_EXPORTER_TYPE}\${COPILOT_OTEL_ENABLED}" ] || export COPILOT_OTEL_FILE_EXPORTER_PATH='/state/otel/sess-07.jsonl'; `,
    );
    expect(command.indexOf('export COPILOT_OTEL')).toBeGreaterThan(command.indexOf('unset '));
    expect(command.indexOf('export COPILOT_OTEL')).toBeLessThan(command.indexOf(' copilot '));
  });
  it('quotes a path with a quote in it', () => {
    const { command } = launchCopilotSession({ ...base, exportPath: "/it's/otel/s.jsonl" });
    expect(command).toContain(`export COPILOT_OTEL_FILE_EXPORTER_PATH=${shellQuote("/it's/otel/s.jsonl")};`);
  });
  it('adds nothing without an export path', () => {
    expect(launchCopilotSession(base).command).not.toContain('OTEL');
  });
  it('really decides in a shell: the user’s endpoint wins, else ours is exported', () => {
    const { command } = launchCopilotSession({ ...base, exportPath: '/state/otel/s.jsonl' });
    const guard = /\[ -n .*?; /.exec(command)?.[0] ?? '';
    expect(guard).not.toBe('');
    const run = (env: Record<string, string>) =>
      spawnSync('sh', ['-c', `${guard} printf %s "$COPILOT_OTEL_FILE_EXPORTER_PATH"`], {
        env: { PATH: process.env['PATH'] ?? '', ...env },
        encoding: 'utf8',
      }).stdout;
    expect(run({})).toBe('/state/otel/s.jsonl');
    expect(run({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://c:4318' })).toBe('');
    expect(run({ COPILOT_OTEL_FILE_EXPORTER_PATH: '/mine.jsonl' })).toBe('/mine.jsonl');
    expect(run({ COPILOT_OTEL_EXPORTER_TYPE: 'otlp-http' })).toBe('');
    expect(run({ COPILOT_OTEL_ENABLED: 'true' })).toBe('');
  });
});
