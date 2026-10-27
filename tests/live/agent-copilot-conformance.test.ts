// @vitest-environment node
import { spawn as spawnProcess, spawnSync, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';

import { createCliGate } from '../../electron/main/agents/cli-gate';
import {
  agentPromptFile,
  agentStateFile,
  agentsRoot,
  agentWorkdir,
  cliHome,
  laneWorkdir,
} from '../../electron/main/agents/paths';
import { createPermissions, type Permissions } from '../../electron/main/agents/permissions';
import { createAgentRegistry, type AgentRegistry } from '../../electron/main/agents/registry';
import type { HarnessGate } from '../../electron/main/agents/resolve-harness';
import { createRunTracker, type ChildLike, type RunTracker } from '../../electron/main/agents/runs';
import { createScheduler, type Scheduler } from '../../electron/main/agents/scheduler';
import { createAgentState, type AgentState } from '../../electron/main/agents/state';
import { createWakeCommand } from '../../electron/main/agents/wake-command';
import { createHarnessRegistry, headlessAdapter } from '../../electron/main/harness/registry';
import { getConfig, setCliAgents } from '../../electron/main/config';
import { createReceiver, type Receiver } from '../../electron/main/hooks/receiver';
import { writeAgentSettings } from '../../electron/main/harness/claude-code/settings';
import { mcpConfig } from '../../electron/main/harness/claude-code/mcp-config';
import { createLedger, type Ledger } from '../../electron/main/ledger';
import { agentMcpConfigFile } from '../../electron/main/mcp';
import { hiveServerSpec } from '../../electron/main/mcp/config';
import type { AgentRunState, RunLine, WakeSpec } from '../../electron/shared/agent-contract';
import { CONFIG_PATH_ENV } from '../../electron/shared/config-contract';
import { isHarnessId } from '../../electron/shared/harness-contract';
import {
  HOOK_ENV_RECEIVER_URL,
  HOOK_ENV_SESSION,
  HOOK_ENV_TOKEN,
  type HookAgentEvent,
} from '../../electron/shared/hook-contract';
import { LEDGER_DIR, OVERMIND } from '../../electron/shared/ledger-contract';

/**
 * What only a real `copilot` can prove about a Copilot wake (HIVE-343).
 *
 * The unit suites hold the argv, the reader, the hooks and the fence against recorded fixtures.
 * This holds them against the binary: that the id the argv pins after `--session-id` is the one the
 * next wake resumes, that `AGENTS.md` is read, that `agentStop` reaches the receiver under the
 * agent's name, that the usage file lands on the receipt and is gone after, that a lease without
 * Copilot refuses it, and that nothing is written under the user's own `~/.copilot`.
 *
 * Composed the way `ipc/index.ts` composes it (see `agent-codex-conformance.test.ts`, which this
 * follows): the gate's default CLI is `copilot`, every probe names `harness: [copilot]` and no
 * `model:`, and the token is the stored one, never the shell's `GH_TOKEN`.
 *
 * Opt-in: `pnpm desktop:build && COPILOT_GITHUB_TOKEN=… pnpm test:agent:copilot`. It needs
 * `copilot` on PATH at the version the fixtures were recorded against; a different version fails
 * rather than proving something nobody recorded.
 */

const LIVE = process.env['HIVE_LIVE_AGENT_COPILOT_PROOF'] === '1';
const PINNED = /^GitHub Copilot CLI 1\.0\.104\b/;
const TEARDOWN_WAIT_MS = 10_000;
const TURN_MS = 240_000;

const CP = 'probe-copilot';
const SHELL = 'probe-copilot-shell';
const CREATE = 'probe-copilot-create';
const MCP = 'probe-copilot-mcp';
const DENY = 'probe-copilot-deny';
const UNTRUSTED = 'probe-copilot-untrusted';
const SUB = 'probe-copilot-subagent';
const INTERVAL = 'probe-copilot-interval';
const AGENTS = [CP, SHELL, CREATE, MCP, DENY, UNTRUSTED, SUB, INTERVAL];

const probeMd = (name: string, on = '[ledger]') => `---
name: ${name}
description: Proves a Copilot wake, its resume and its receipt.
icon: Ghost
harness: [copilot]
wake:
  on: ${on}
tools: [Bash(awk *)]
limits:
  turns: 10
  parallel: 2
  rotate_after: 50
---
Your name is ${name}.

This is a conformance probe. Do not read files, run any command your wake prompt does not name, or
explore. Do exactly what your wake prompt asks, in as few steps as you can, then end your turn.
`;
const CP_MD = probeMd(CP);

const fenceMd = (name: string, call: string, tools = '[]') => `---
name: ${name}
description: Proves the Copilot fence asks about one call, and lets it through once answered.
icon: Ghost
harness: [copilot]
wake:
  on: [ledger]
tools: ${tools}
limits:
  turns: 8
---
This is a conformance probe. After your ledger inbox, make exactly this one call and nothing else:

${call}

If it is denied, end your turn at once: you will be woken when it is answered. When you are woken
again, make the same call again, exactly as written, even if it failed before, then end your turn.
Never use any other tool, and never try another way to get the same effect.
`;

/** Each entry's name and mtime, or null when the directory does not exist. */
const snapshot = (path: string): Record<string, number> | null =>
  existsSync(path)
    ? Object.fromEntries(readdirSync(path).map((name) => [name, statSync(join(path, name)).mtimeMs]))
    : null;

describe.skipIf(!LIVE)('real headless wakes, against a real copilot', () => {
  let dir: string | undefined;
  let previousConfigPath: string | undefined;
  let skipReason: string | undefined;
  /** The user's real `~/.copilot`, before anything spawned. */
  const userCopilot = join(homedir(), '.copilot');
  let before: Record<string, number> | null = null;

  let receiver: Receiver | null = null;
  let ledger: Ledger;
  let agentState: AgentState;
  let runs: RunTracker;
  let scheduler: Scheduler | null = null;
  let agentRegistry: AgentRegistry;
  let permissions: Permissions;
  let buildWakeCommand: ReturnType<typeof createWakeCommand>;
  let shellMarker: string;
  let createMarker: string;
  let denyMarker: string;
  /** Outside every workdir, so nothing the agent does there can create them (HIVE-357). */
  let hookMarker: string;
  let mcpMarker: string;
  let subMarker: string;

  const spawns: { name: string; args: string[] }[] = [];
  const agentEvents: HookAgentEvent[] = [];
  /** Every Copilot hook body the fence read, so a case can say whose call it was (HIVE-357). */
  const fenceBodies: Record<string, unknown>[] = [];
  const lines: RunLine[] = [];
  const jiraComments: unknown[] = [];
  const settlers = new Map<string, () => void>();
  /** What `schedules` answers, filled by the interval case alone (HIVE-357). */
  const schedules = new Map<string, { wake: WakeSpec; dailyUsd?: number }>();
  /** The scheduler's tick, captured off its injected interval. */
  let fireTick: (() => void) | undefined;
  const onRunClosed = vi.fn((name: string) => scheduler?.onRunClosed(name));
  /** Swapped by case 7; every other case runs with Copilot entitled. */
  let entitled: HarnessGate['entitled'] = () => null;

  beforeAll(async () => {
    // Before anything spawns: the real user directory this suite proves untouched.
    before = snapshot(userCopilot);

    dir = await mkdtemp(join(tmpdir(), 'hive-live-copilot-'));
    // Even `--version` gets a scratch home: no copilot this suite starts ever sees `~/.copilot`.
    const version = spawnSync('copilot', ['--version'], {
      encoding: 'utf8',
      env: { ...process.env, COPILOT_HOME: join(dir, 'version-home') },
    });
    if (version.error !== undefined || version.status !== 0) {
      skipReason = 'copilot is not on PATH';
      return;
    }
    const token = process.env['COPILOT_GITHUB_TOKEN'];
    if (token === undefined || token === '') {
      skipReason = 'COPILOT_GITHUB_TOKEN is unset (a fine-grained PAT with Copilot Requests, or a gho_ token)';
      return;
    }
    const found = version.stdout.trim();
    if (!PINNED.test(found)) {
      throw new Error(
        `test:agent:copilot was proven against copilot 1.0.104; found ${found}. Re-record tests/fixtures/copilot and re-prove before changing the pin.`,
      );
    }

    const host = join(process.cwd(), 'out', 'main', 'mcp-host.js');
    if (!existsSync(host)) {
      throw new Error(`${host} is missing. Run \`pnpm desktop:build\` before \`pnpm test:agent:copilot\`.`);
    }

    const userDataPath = join(dir, 'userData');
    previousConfigPath = process.env[CONFIG_PATH_ENV];
    process.env[CONFIG_PATH_ENV] = join(dir, '.hive', 'config.json');
    // Boot, as the app does: the first load writes the config file Settings later edits.
    getConfig();

    // Each inside its own agent's workdir, where Copilot writes without a path prompt of its own.
    shellMarker = join(agentWorkdir(SHELL), 'made-by-shell');
    createMarker = join(agentWorkdir(CREATE), 'made-by-create.txt');
    denyMarker = join(agentWorkdir(DENY), 'made-by-denied-shell');
    subMarker = join(agentWorkdir(SUB), 'made-by-subagent');
    for (const [name, body] of [
      [CP, CP_MD],
      [SHELL, fenceMd(SHELL, `The shell command: touch ${shellMarker}`)],
      [CREATE, fenceMd(CREATE, `Create the file ${createMarker} with your create tool, containing the one line: made`)],
      [MCP, fenceMd(MCP, 'The hive MCP tool jira_comment, with key "HIVE-1" and body "probe".')],
      // Granted, so only Copilot's own `--deny-tool` can stop it.
      [DENY, fenceMd(DENY, `The shell command: touch ${denyMarker}`, '[Bash(touch *)]')],
      [UNTRUSTED, probeMd(UNTRUSTED)],
      // Nothing but the captured tick wakes it.
      [INTERVAL, probeMd(INTERVAL, '[]')],
      [
        SUB,
        fenceMd(
          SUB,
          `The task tool, starting one subagent whose only job is the shell command: touch ${subMarker}. Do not run the command yourself.`,
          // Granted, so the fence's ask is the subagent's shell call, not the `task` call that starts it.
          '[Task]',
        ),
      ],
    ] as const) {
      await mkdir(join(agentsRoot(), name), { recursive: true });
      await writeFile(join(agentsRoot(), name, 'AGENT.md'), body, 'utf8');
    }

    // A workdir's own hooks and MCP servers, which Copilot loads only in a trusted folder (HIVE-357).
    const untrusted = agentWorkdir(UNTRUSTED);
    hookMarker = join(dir, 'untrusted-hook-ran');
    mcpMarker = join(dir, 'untrusted-mcp-ran');
    await mkdir(join(untrusted, '.github', 'hooks'), { recursive: true });
    await writeFile(
      join(untrusted, '.github', 'hooks', 'probe.json'),
      JSON.stringify({
        version: 1,
        hooks: { sessionStart: [{ type: 'command', bash: `touch ${hookMarker}`, timeoutSec: 10 }] },
      }),
      'utf8',
    );
    await writeFile(
      join(untrusted, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          planted: { type: 'local', command: 'sh', args: ['-c', `touch ${mcpMarker}; sleep 5`], tools: ['*'] },
        },
      }),
      'utf8',
    );

    ledger = createLedger({
      dir: join(dirname(process.env[CONFIG_PATH_ENV]), LEDGER_DIR),
      knowsParty: (party) => AGENTS.includes(party) || party === OVERMIND,
    });
    agentRegistry = createAgentRegistry({ root: agentsRoot(), skillNames: async () => ({ all: [], hive: [] }) });
    permissions = createPermissions({
      entries: () => ledger.read({}).entries,
      append: (request) => {
        ledger.append(request);
      },
      read: (name) => agentRegistry.read(name),
      write: (name, source) => agentRegistry.write(name, source),
    });

    receiver = createReceiver({
      knowsSession: () => false,
      knowsAgent: (id) => AGENTS.includes(id),
      // As `sessions/index.ts` wires it: an agent hook's `x-hive-harness` picks the reader.
      harnesses: createHarnessRegistry({ sessionHarness: () => undefined }),
      onAgentEvent: (event) => {
        agentEvents.push(event);
        if (event.signal.kind === 'turn-end') {
          runs.noteTurnEnded(event.entityId, event.sessionUuid, event.backgroundWork);
        }
      },
      onEvent: () => {},
      onLedgerRead: (_caller, query) => ledger.read(query),
      onLedgerPost: (caller, request) => ledger.append({ ...request, from: caller }),
      onAgentsList: async () => ({ agents: [] }),
      onJira: {
        get: () => Promise.reject(new Error('not exercised')),
        transition: () => Promise.reject(new Error('not exercised')),
        // The MCP fence case's effect: the one call it is fenced on, reaching the tool once answered.
        comment: (request) => {
          jiraComments.push(request);
          return Promise.resolve({ ok: true, value: { id: '1', author: 'probe', created: 'now', body: [] } });
        },
        users: () => Promise.reject(new Error('not exercised')),
      },
      // As `hooks/index.ts` wires it: a hook names its CLI by the `x-hive-harness` header.
      fenceFor: (harness) => {
        const fence =
          harness === undefined
            ? headlessAdapter('codex').headless.fence
            : isHarnessId(harness)
              ? headlessAdapter(harness).headless.fence
              : null;
        if (fence === null || fence.read === undefined) return fence;
        const read = fence.read.bind(fence);
        return {
          ...fence,
          read: (body) => {
            fenceBodies.push(body);
            return read(body);
          },
        };
      },
      onPlan: () => {},
      onTicketIntent: () => undefined,
      onPromptName: () => {},
      onCleared: () => undefined,
      onMetrics: () => undefined,
      onDone: () => undefined,
      onReady: () => undefined,
    });
    const url = await receiver.start();
    expect(url).not.toBeNull();

    const settingsPath = await writeAgentSettings(userDataPath, url ?? '');
    const mcpConfigPath = join(userDataPath, 'hive', 'hive.mcp.json');
    await mkdir(dirname(mcpConfigPath), { recursive: true });
    await writeFile(mcpConfigPath, mcpConfig({ execPath: process.execPath, scriptPath: host }), 'utf8');

    agentState = createAgentState({ path: agentStateFile() });
    const newUuid = (): string => randomUUID();
    const gate: HarnessGate = {
      entitled: (id) => entitled(id),
      enabled: () => true,
      defaultCli: () => 'copilot',
      // Settings › CLIs, read per call as `ipc/index.ts` reads it: the deny case writes it.
      defaults: (id) => createCliGate(getConfig).defaults(id),
    };

    /*
      The child's env carries no shell token: `GH_TOKEN` and `GITHUB_TOKEN` are gone, and so is the
      shell's `COPILOT_GITHUB_TOKEN`, so the only token a run can pay with is the stored one, which
      `cliToken` hands the wake as a secret.
    */
    const childEnv = (): NodeJS.ProcessEnv => {
      const env = { ...process.env };
      delete env['GH_TOKEN'];
      delete env['GITHUB_TOKEN'];
      delete env['COPILOT_GITHUB_TOKEN'];
      return env;
    };

    buildWakeCommand = createWakeCommand({
      agentsRoot,
      workdir: laneWorkdir,
      // Under the temp home, through `configPath()`.
      cliHome,
      cliToken: (id) => (id === 'copilot' ? (process.env['COPILOT_GITHUB_TOKEN'] ?? null) : null),
      promptFile: (name) => agentPromptFile(userDataPath, name),
      pluginDir: () => join(userDataPath, 'plugin'),
      agentSettingsPath: () => settingsPath,
      mcpConfig: () => mcpConfigPath,
      hiveServer: () => hiveServerSpec({ execPath: process.execPath, scriptPath: host }),
      agentMcpFile: (name) => agentMcpConfigFile(userDataPath, name),
      hookEnv: (name) => ({
        [HOOK_ENV_SESSION]: name,
        [HOOK_ENV_TOKEN]: receiver?.tokenFor(name) ?? '',
        [HOOK_ENV_RECEIVER_URL]: receiver?.origin ?? '',
      }),
      claudeCommand: () => 'claude',
      userDataPath: () => userDataPath,
      hostAlias: () => 'host.docker.internal',
      agentContainerSettingsPath: () => null,
      subscriptionAuth: () => false,
      state: agentState,
      env: childEnv,
      newUuid,
      pendingGrants: (name, lane) => permissions.grantsFor(name, lane),
      gate,
    });

    runs = createRunTracker({
      spawn: (file, args, options) => {
        spawns.push({ name: String((options as SpawnOptions).env?.[HOOK_ENV_SESSION]), args: [...args] });
        return spawnProcess(file, [...args], options as SpawnOptions) as unknown as ChildLike;
      },
      command: (name, trigger, extra, options) => buildWakeCommand(name, trigger, extra, options),
      parallelFor: () => 2,
      // As `ipc/index.ts` wires it: `/fence` reads a run's grants from here, never its env.
      grants: {
        set: (run, owner, grants) => receiver?.grants.set(run, owner, grants),
        delete: (run) => receiver?.grants.delete(run),
      },
      runToken: (run) => receiver?.runToken(run) ?? null,
      limitsFor: () => ({}),
      state: agentState,
      appendLedger: (entry) => {
        expect(ledger.append(entry).ok).toBe(true);
      },
      openAsksFor: (name, run) =>
        ledger.read({ from: name }).openAsks.some((ask) => ask.from === name && ask.meta?.['run'] === run),
      hasOpenAsk: (name) => ledger.read({}).openAsks.some((ask) => ask.from === name),
      handoffFor: (name, run) =>
        ledger.read({ from: name }).entries.findLast((entry) => entry.kind === 'handoff' && entry.meta?.['run'] === run)?.body,
      newUuid,
      pushStatus: (name) => {
        if (agentState.read(name).status === 'working') return;
        const settle = settlers.get(name);
        settlers.delete(name);
        settle?.();
      },
      pushLines: (_name, pushed) => lines.push(...pushed),
      onRunClosed,
      now: () => Date.now(),
      newRunId: () => randomUUID(),
    });

    scheduler = createScheduler({
      run: (name, trigger, extra, options) => runs.run(name, trigger, extra, options),
      state: agentState,
      isAgent: (id) => AGENTS.includes(id),
      parallelFor: () => 2,
      // The interval probe's `wake.on` is empty: only its schedule wakes it (HIVE-357).
      wakesOnLedger: (id) => AGENTS.includes(id) && id !== INTERVAL,
      laneOf: () => undefined,
      laneLive: (name, lane) =>
        runs.liveRuns(name).some((run) => run.kind === 'standing' && (run.lane ?? 'standing') === lane),
      removeLaneDir: () => undefined,
      schedules: () => schedules,
      pushStatus: () => {},
      ledger: { read: () => ledger.read({}), append: (request) => ledger.append(request) },
      now: () => Date.now(),
      // Captured rather than armed, as `agent-conformance.test.ts` does: a case fires the tick itself.
      setIntervalFn: ((handler: () => void) => {
        fireTick = handler;
        return 0 as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      clearIntervalFn: (() => {
        fireTick = undefined;
      }) as unknown as typeof clearInterval,
    });
    scheduler.start();

    // `ipc/index.ts`'s order: a permission answer's grant lands before the wake it causes.
    ledger.onChange((entry) => {
      const schedule = () => scheduler?.onEntry(entry);
      if (entry.kind === 'answer' && permissions.isPermissionAnswer(entry)) {
        permissions.onAnswer(entry).catch(() => undefined).finally(schedule);
      } else {
        schedule();
      }
    });
  }, 180_000);

  afterAll(async () => {
    runs?.killAll('suite ended');
    const deadline = Date.now() + TEARDOWN_WAIT_MS;
    while ((runs?.live().length ?? 0) > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    agentState?.dispose();
    await receiver?.stop();
    agentRegistry?.close();
    if (previousConfigPath === undefined) delete process.env[CONFIG_PATH_ENV];
    else process.env[CONFIG_PATH_ENV] = previousConfigPath;
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }, TEARDOWN_WAIT_MS + 30_000);

  /** A standing wake, as the scheduler starts one; resolves with its run id once the run has closed. */
  const wake = (name: string, extra?: string): Promise<string> =>
    new Promise((resolve, reject) => {
      let run = '';
      settlers.set(name, () => resolve(run));
      const started = runs.run(name, 'manual', extra);
      if (started?.started === true) run = started.run;
      else reject(new Error(`the wake was refused: ${JSON.stringify(started)}`));
    });

  const persisted = async (name: string): Promise<AgentRunState> => {
    agentState.flush();
    const parsed = JSON.parse(await readFile(agentStateFile(), 'utf8')) as Record<string, AgentRunState>;
    const state = parsed[name];
    if (state === undefined) throw new Error(`${name} is not in agents.json`);
    return state;
  };

  const until = async (predicate: () => boolean, ms: number): Promise<void> => {
    const deadline = Date.now() + ms;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${predicate.toString()}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };

  const settled = (name: string): Promise<void> =>
    new Promise((resolve) => {
      settlers.set(name, resolve);
    });

  const permissionAsks = (name: string) =>
    ledger.read({}).openAsks.filter((ask) => ask.from === name && ask.meta?.['kind'] === 'permission');

  const endedTurn = (name: string): boolean =>
    agentEvents.some((event) => event.entityId === name && event.signal.kind === 'turn-end');

  /**
   * The calls a session made, from Copilot's own `events.jsonl`: the run log carries only the
   * model's words. Each is a `tool.execution_complete` (`success`, `result.content`, `error`), its
   * call named by the `tool.execution_start` with the same id. At 1.0.104 a `--deny-tool` refusal
   * is one with `success: false` and `error.code: 'denied'`.
   */
  const sessionCalls = async (uuid: string) => {
    const file = join(cliHome('copilot'), 'session-state', uuid, 'events.jsonl');
    const events = (await readFile(file, 'utf8'))
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> });
    const started = new Map(
      events
        .filter((event) => event.type === 'tool.execution_start')
        .map((event) => [event.data['toolCallId'], event.data] as const),
    );
    return events
      .filter((event) => event.type === 'tool.execution_complete')
      .map((event) => {
        const start = started.get(event.data['toolCallId']);
        const args = (start?.['arguments'] ?? {}) as Record<string, unknown>;
        const result = event.data['result'] as { content?: unknown } | undefined;
        return {
          tool: start?.['toolName'],
          command: args['command'],
          success: event.data['success'],
          error: event.data['error'],
          content: result?.content,
        };
      });
  };

  const refusedCalls = async (uuid: string) =>
    (await sessionCalls(uuid))
      .filter((call) => call.success === false)
      .map(({ tool, command, error }) => ({ tool, command, error }));

  const runLog = (run: string): string => JSON.stringify(lines.filter((line) => line.run === run));

  const lastArgs = (name: string): string[] => spawns.filter((spawn) => spawn.name === name).at(-1)?.args ?? [];

  let noteTurnEnded: MockInstance<RunTracker['noteTurnEnded']>;

  it('the first wake runs under the pinned id', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    noteTurnEnded = vi.spyOn(runs, 'noteTurnEnded');

    // `--secret-env-vars` keeps the token out of the agent's own shell. The plan's
    // `env | grep -c` is a pipe, which no `Bash(...)` rule ever matches, so this counts it pipe-free.
    const run = await wake(
      CP,
      'State your name exactly as your instructions give it, in one short sentence. Then run exactly ' +
        `this shell command, once: awk 'BEGIN { print ("COPILOT_GITHUB_TOKEN" in ENVIRON) }' ` +
        'and reply with one more line, TOKEN-COUNT: followed by the number it printed. Then end your turn.',
    );

    const state = await persisted(CP);
    const args = lastArgs(CP);
    const pinned = args[args.indexOf('--session-id') + 1];

    expect(args).toContain('--session-id');
    expect(pinned).toBeTypeOf('string');
    expect(state.sessionUuid).toBe(pinned);
    expect(state.runs.at(-1)?.harness).toBe('copilot');
    // The prompt never names the agent: only `AGENTS.md` does.
    expect(args[args.indexOf('-p') + 1]).not.toContain(CP);
    expect(runLog(run)).toContain(CP);
    // The awk call really ran and printed 0: at 1.0.104 a shell result's `content` is its stdout,
    // then a `<shellId: … exit code …>` line. The model's own TOKEN-COUNT line is the second check.
    const awk = (await sessionCalls(pinned as string)).filter(
      (call) =>
        call.tool === 'bash' &&
        typeof call.command === 'string' &&
        call.command.includes('awk') &&
        call.command.includes('ENVIRON'),
    );
    expect(awk, JSON.stringify(awk)).toHaveLength(1);
    expect(awk[0]?.success).toBe(true);
    expect(String(awk[0]?.content).split('\n')[0]?.trim()).toBe('0');
    expect(runLog(run)).toMatch(/TOKEN-COUNT: 0\b/);
  }, TURN_MS);

  it('agentStop arms the watchdog and the run closes done', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    const state = await persisted(CP);

    const call = noteTurnEnded.mock.calls.findIndex(([name, uuid]) => name === CP && uuid === state.sessionUuid);
    expect(call).toBeGreaterThanOrEqual(0);
    const closed = onRunClosed.mock.calls.findIndex(([name]) => name === CP);
    expect(closed).toBeGreaterThanOrEqual(0);
    expect(noteTurnEnded.mock.invocationCallOrder[call]).toBeLessThan(
      onRunClosed.mock.invocationCallOrder[closed] ?? 0,
    );
    expect(agentEvents.every((event) => AGENTS.includes(event.entityId))).toBe(true);
    // A run that asked instead names what it asked about.
    const asks = ledger.read({}).openAsks.map((ask) => ask.meta?.['tool']);
    expect(state.runs.at(-1)?.outcome, `open asks: ${JSON.stringify(asks)}`).toBe('done');
  });

  it('resume remembers', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    const word = `probe${randomUUID().slice(0, 6)}`;
    await wake(
      CP,
      `Remember this exact word for later: ${word}. Report it with ledger_done, with the word as the body, then end your turn.`,
    );
    const uuid = (await persisted(CP)).sessionUuid as string;

    const run = await wake(
      CP,
      'What was the exact word you were asked to remember? Reply with only that word, then end your turn.',
    );

    // One flag starts and resumes (HIVE-343 Task 21): `--resume=` is gone.
    expect(lastArgs(CP)).toEqual(expect.arrayContaining(['--session-id', uuid]));
    expect(lastArgs(CP).some((arg) => arg.startsWith('--resume'))).toBe(false);
    expect(runLog(run)).toContain(word);
    expect((await persisted(CP)).sessionUuid).toBe(uuid);
  }, 2 * TURN_MS);

  it('wakes on its own schedule twice, resuming the same session', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    schedules.set(INTERVAL, { wake: { everyMs: 60_000, check: 'always', on: [] } });
    // Due now: a first tick only seeds `nextRunAt` for an agent never scheduled.
    agentState.patch(INTERVAL, { nextRunAt: Date.now() - 1 });

    const first = settled(INTERVAL);
    fireTick?.();
    await first;

    const after = await persisted(INTERVAL);
    expect(after.runs).toHaveLength(1);
    expect(after.runs[0]?.trigger).toBe('interval');
    expect(after.runs[0]?.harness).toBe('copilot');
    expect(after.runs[0]?.outcome).not.toBe('failed');
    const uuid = after.sessionUuid ?? '';
    expect(uuid).not.toBe('');
    expect(after.runsSinceRotate).toBe(1);

    agentState.patch(INTERVAL, { nextRunAt: Date.now() - 1 });
    const second = settled(INTERVAL);
    fireTick?.();
    await second;

    const twice = await persisted(INTERVAL);
    expect(twice.runs).toHaveLength(2);
    expect(twice.runs[1]?.outcome).not.toBe('failed');
    expect(lastArgs(INTERVAL)).toEqual(expect.arrayContaining(['--session-id', uuid]));
    expect(twice.sessionUuid).toBe(uuid);
    // Both counted: each run's usage file named a request (HIVE-357).
    expect(twice.runsSinceRotate).toBe(2);
    schedules.delete(INTERVAL);
  }, 2 * TURN_MS);

  /**
   * Case 4: the fence. Each call kind is denied with one permission ask and no effect, then an
   * `allow-once` answer wakes the agent with that one-shot grant and the call runs.
   */
  const fenceCase = async (name: string, tool: string, effect: () => boolean) => {
    await wake(name);

    const asks = permissionAsks(name);
    expect(asks, JSON.stringify(ledger.read({ from: name }).entries.map((entry) => entry.body))).toHaveLength(1);
    expect(asks[0]?.kind).toBe('ask');
    expect(asks[0]?.meta?.['tool']).toBe(tool);
    expect(effect()).toBe(false);
    expect(endedTurn(name)).toBe(true);
    expect((await persisted(name)).runs.at(-1)?.outcome).toBe('asking');

    const second = settled(name);
    expect(ledger.answer({ thread: asks[0]?.id ?? '', body: 'allow-once' }, OVERMIND).ok).toBe(true);
    await second;

    expect(effect()).toBe(true);
    expect(permissionAsks(name)).toEqual([]);
  };

  it('the fence asks about a shell call, and allow-once lets it run', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    await fenceCase(SHELL, 'Bash', () => existsSync(shellMarker));
  }, 2 * TURN_MS);

  it('the fence asks about a file create, and allow-once lets it run', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    await fenceCase(CREATE, 'Write', () => existsSync(createMarker));
  }, 2 * TURN_MS);

  it('the fence asks about an MCP call, and allow-once lets it run', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    await fenceCase(MCP, 'mcp__hive__jira_comment', () => jiraComments.length > 0);
  }, 2 * TURN_MS);

  it('the fence asks about a subagent’s shell call, and allow-once lets it run', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    await fenceCase(SUB, 'Bash', () => existsSync(subMarker));

    /*
      The shell call the fence asked about was a subagent's: Copilot names its parent on the body. A
      `task` body can name the marker too (its prompt), and a model may nest one, so look for the bash.
    */
    const sub = fenceBodies.find(
      (body) =>
        body['toolName'] === 'bash' &&
        typeof body['parentAgentId'] === 'string' &&
        JSON.stringify(body['toolArgs'] ?? {}).includes(subMarker),
    );
    expect(
      sub,
      JSON.stringify(fenceBodies.map((body) => [body['toolName'], typeof body['parentAgentId']])),
    ).toBeDefined();
  }, 2 * TURN_MS);

  it('a --deny-tool pattern from Settings blocks even a granted call', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    // Copilot's own `--deny-tool` grammar, written the way Settings writes it.
    expect(setCliAgents({ cli: 'copilot', deny: ['shell(touch:*)'] }).clis.copilot.agents.deny).toEqual([
      'shell(touch:*)',
    ]);
    try {
      await wake(DENY);

      // The model really made the call, and Copilot refused it by the pattern.
      const uuid = (await persisted(DENY)).sessionUuid ?? '';
      expect(await refusedCalls(uuid)).toContainEqual({
        tool: 'bash',
        command: `touch ${denyMarker}`,
        error: { code: 'denied', message: 'Permission to run this tool was denied due to the following rules: `shell(touch:*)`' },
      });
      expect(endedTurn(DENY)).toBe(true);

      const args = lastArgs(DENY);
      expect(args[args.indexOf('--deny-tool') + 1]).toBe('shell(touch:*)');
      expect(existsSync(denyMarker)).toBe(false);
      // Copilot refused it before the hook: the fence never saw the call, so nothing asked.
      expect(permissionAsks(DENY)).toEqual([]);
      expect(runs.liveRuns(DENY)).toEqual([]);
    } finally {
      setCliAgents({ cli: 'copilot', deny: null });
    }

    // The positive control: the same grant, with the pattern cleared, does create the file.
    await wake(DENY, 'The deny pattern is gone now: make the call again, exactly as written.');
    expect(lastArgs(DENY)).not.toContain('--deny-tool');
    expect(existsSync(denyMarker)).toBe(true);
    expect(permissionAsks(DENY)).toEqual([]);
  }, 2 * TURN_MS);

  it('a task run starts a fresh session', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    const standing = (await persisted(CP)).sessionUuid;
    const count = (await persisted(CP)).runs.length;

    expect(runs.run(CP, 'manual', 'Reply with "ok" and end your turn.', { job: true })).toMatchObject({
      started: true,
      kind: 'task',
    });
    await until(() => agentState.read(CP).runs.length > count, TURN_MS);

    const state = await persisted(CP);
    const task = state.runs.at(-1);
    expect(task?.kind).toBe('task');
    expect(task?.sessionUuid).toBeTypeOf('string');
    expect(task?.sessionUuid).not.toBe(standing);
    expect(state.sessionUuid).toBe(standing);
  }, TURN_MS);

  it('the receipt carries usage from the output file', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    const last = (await persisted(CP)).runs.at(-1);

    expect(last?.usage?.outputTokens).toBeGreaterThan(0);
    expect(last?.costUsd).toBeUndefined();
    expect(existsSync(join(cliHome('copilot'), 'usage', `${last?.sessionUuid ?? ''}.json`))).toBe(false);
  });

  it('a Starter lease refuses Copilot with the reason, a Team lease resolves it', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    // Resolved: every wake above ran on copilot with `entitled` answering null.
    expect((await persisted(CP)).runs.every((run) => run.harness === 'copilot')).toBe(true);

    entitled = (id) => (id === 'copilot' ? 'not in your plan (Team or higher)' : null);
    const count = spawns.length;
    try {
      expect(buildWakeCommand(CP, 'manual')).toEqual({
        problem: `No CLI can run ${CP}: copilot is not in your plan (Team or higher).`,
      });
      expect(runs.run(CP, 'manual')).toMatchObject({ started: false, refused: 'invalid' });
      expect(spawns).toHaveLength(count);
    } finally {
      entitled = () => null;
    }
    expect(buildWakeCommand(CP, 'manual')).not.toHaveProperty('problem');
  });

  it('an untrusted workdir loads neither its hooks nor its MCP servers', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    await wake(UNTRUSTED, 'Reply with "ok" and end your turn.');

    expect((await persisted(UNTRUSTED)).runs.at(-1)?.outcome).toBe('done');
    expect(existsSync(hookMarker)).toBe(false);
    expect(existsSync(mcpMarker)).toBe(false);

    // The positive control: the same directory trusted for one prompt does load both.
    const control = spawnSync(
      'copilot',
      ['-p', 'Reply with "ok".', '-s', '--no-ask-user', '--disable-builtin-mcps', '--trust-folder'],
      {
        cwd: agentWorkdir(UNTRUSTED),
        encoding: 'utf8',
        timeout: TURN_MS,
        env: {
          ...process.env,
          COPILOT_HOME: join(dir as string, 'control-home'),
          GH_TOKEN: undefined,
          GITHUB_TOKEN: undefined,
        },
      },
    );
    expect(control.status, control.stderr).toBe(0);
    expect(existsSync(hookMarker) || existsSync(mcpMarker)).toBe(true);
  }, 2 * TURN_MS);

  it('nothing is written under ~/.copilot', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    await until(() => runs.live().length === 0, TURN_MS);

    expect(snapshot(userCopilot)).toEqual(before);
    // The positive control: Copilot really ran, somewhere else.
    expect(existsSync(join(cliHome('copilot'), 'settings.json'))).toBe(true);
    expect(statSync(join(cliHome('copilot'), 'session-state')).isDirectory()).toBe(true);
  }, TURN_MS);
});
