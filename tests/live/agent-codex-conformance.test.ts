// @vitest-environment node
import { spawn as spawnProcess, spawnSync, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { agentPromptFile, agentStateFile, agentsRoot, laneWorkdir } from '../../electron/main/agents/paths';
import { createPermissions, type Permissions } from '../../electron/main/agents/permissions';
import { createAgentRegistry, type AgentRegistry } from '../../electron/main/agents/registry';
import type { HarnessGate } from '../../electron/main/agents/resolve-harness';
import { createRunTracker, type ChildLike, type RunTracker } from '../../electron/main/agents/runs';
import { createScheduler, type Scheduler } from '../../electron/main/agents/scheduler';
import { createAgentState, type AgentState } from '../../electron/main/agents/state';
import { createWakeCommand } from '../../electron/main/agents/wake-command';
import { headlessAdapter } from '../../electron/main/harness/registry';
import { createReceiver, type Receiver } from '../../electron/main/hooks/receiver';
import { writeAgentSettings } from '../../electron/main/harness/claude-code/settings';
import { mcpConfig } from '../../electron/main/harness/claude-code/mcp-config';
import { createLedger, type Ledger } from '../../electron/main/ledger';
import { agentMcpConfigFile } from '../../electron/main/mcp';
import { hiveServerSpec } from '../../electron/main/mcp/config';
import type { AgentRunState, RunLine } from '../../electron/shared/agent-contract';
import { CONFIG_PATH_ENV } from '../../electron/shared/config-contract';
import {
  HOOK_ENV_RECEIVER_URL,
  HOOK_ENV_SESSION,
  HOOK_ENV_TOKEN,
  type HookAgentEvent,
} from '../../electron/shared/hook-contract';
import { LEDGER_DIR, OVERMIND } from '../../electron/shared/ledger-contract';

/**
 * What only a real `codex` can prove about a Codex wake (HIVE-342).
 *
 * The unit suites hold the argv, the reader and the fence against recorded fixtures. This holds
 * them against the binary: that the thread `codex exec --json` names is the one the next wake
 * resumes, that its `Stop` hook reaches the receiver under the agent's name, that its usage lands
 * on the receipt, and that the `PreToolUse` fence asks about a shell call, a patch and an MCP call
 * and lets each through once an `allow-once` answers it.
 *
 * Composed the way `ipc/index.ts` composes it (see `agent-conformance.test.ts`, which this
 * follows), with one difference: the gate's default CLI is `codex` and every probe names
 * `harness: [codex]`.
 *
 * Opt-in: `pnpm desktop:build && pnpm test:agent:codex`. It needs `codex` on PATH, signed in, at
 * the version the fixtures were recorded against; a different version fails rather than proving
 * something nobody recorded.
 */

const LIVE = process.env['HIVE_LIVE_AGENT_CODEX_PROOF'] === '1';
const PINNED = '0.164';
const TEARDOWN_WAIT_MS = 10_000;
const TURN_MS = 240_000;

const CX = 'probe-codex';
const SHELL = 'probe-codex-shell';
const PATCH = 'probe-codex-patch';
const MCP = 'probe-codex-mcp';
const AGENTS = [CX, SHELL, PATCH, MCP];

const CX_MD = `---
name: ${CX}
description: Proves a Codex wake, its resume and its receipt.
icon: Ghost
harness: [codex]
wake:
  on: [ledger]
tools: [Bash]
limits:
  turns: 10
  parallel: 2
  rotate_after: 50
---
This is a conformance probe. Do not read files or explore. Do exactly what your wake prompt
asks, in as few steps as you can, then end your turn.
`;

const fenceMd = (name: string, call: string) => `---
name: ${name}
description: Proves the Codex fence asks about one call, and lets it through once answered.
icon: Ghost
harness: [codex]
wake:
  on: [ledger]
tools: []
limits:
  turns: 8
---
This is a conformance probe. After your ledger inbox, make exactly this one call and nothing else:

${call}

If it is denied, end your turn at once: you will be woken when it is answered. When you are woken
again, make the same call again, exactly as written, then end your turn. Never use any other tool.
`;

describe.skipIf(!LIVE)('real headless wakes, against a real codex', () => {
  let dir: string | undefined;
  let previousConfigPath: string | undefined;
  let skipReason: string | undefined;
  let shellMarker: string;
  let patchMarker: string;

  let receiver: Receiver | null = null;
  let ledger: Ledger;
  let agentState: AgentState;
  let runs: RunTracker;
  let scheduler: Scheduler | null = null;
  let agentRegistry: AgentRegistry;
  let permissions: Permissions;

  const spawns: { name: string; args: string[] }[] = [];
  const agentEvents: HookAgentEvent[] = [];
  const turnEnds: { name: string; uuid?: string }[] = [];
  const lines: RunLine[] = [];
  const jiraComments: unknown[] = [];
  const settlers = new Map<string, () => void>();
  /** Swapped by case 7; every other case runs with Codex entitled. */
  let entitled: HarnessGate['entitled'] = () => null;

  beforeAll(async () => {
    const version = spawnSync('codex', ['--version'], { encoding: 'utf8' });
    if (version.status !== 0) {
      skipReason = 'codex is not on PATH';
      return;
    }
    if (spawnSync('codex', ['login', 'status'], { encoding: 'utf8' }).status !== 0) {
      skipReason = 'codex is not signed in (codex login, or --device-auth on a headless runner)';
      return;
    }
    const found = /(\d+\.\d+)\.\d+/.exec(version.stdout)?.[0] ?? version.stdout.trim();
    if (!found.startsWith(`${PINNED}.`)) {
      throw new Error(
        `test:agent:codex was proven against codex ${PINNED}.x; found ${found}. Re-record tests/fixtures/codex and re-prove before changing the pin.`,
      );
    }

    const host = join(process.cwd(), 'out', 'main', 'mcp-host.js');
    if (!existsSync(host)) {
      throw new Error(`${host} is missing. Run \`pnpm desktop:build\` before \`pnpm test:agent:codex\`.`);
    }

    dir = await mkdtemp(join(tmpdir(), 'hive-live-codex-'));
    const userDataPath = join(dir, 'userData');
    previousConfigPath = process.env[CONFIG_PATH_ENV];
    process.env[CONFIG_PATH_ENV] = join(dir, '.hive', 'config.json');
    shellMarker = join(dir, 'made-by-shell');
    patchMarker = join(dir, 'made-by-patch.txt');

    for (const [name, body] of [
      [CX, CX_MD],
      [SHELL, fenceMd(SHELL, `The shell command: touch ${shellMarker}`)],
      [
        PATCH,
        fenceMd(PATCH, `apply_patch adding the file ${patchMarker} containing the one line: made`),
      ],
      [MCP, fenceMd(MCP, 'The hive MCP tool jira_comment, with key "HIVE-1" and body "probe".')],
    ] as const) {
      await mkdir(join(agentsRoot(), name), { recursive: true });
      await writeFile(join(agentsRoot(), name, 'AGENT.md'), body, 'utf8');
    }

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
      onAgentEvent: (event) => {
        agentEvents.push(event);
        if (event.signal.kind === 'turn-end') {
          turnEnds.push({ name: event.entityId, ...(event.sessionUuid === undefined ? {} : { uuid: event.sessionUuid }) });
          runs.noteTurnEnded(event.entityId, event.sessionUuid, event.backgroundWork);
        }
      },
      onEvent: () => {},
      onLedgerRead: (_caller, query) => ledger.read(query),
      onLedgerPost: (caller, request) => ledger.append({ ...request, from: caller }),
      onAgentsList: async () => ({ agents: [] }),
      // The MCP case's effect: the one call it is fenced on, reaching the tool once answered.
      onJira: {
        get: () => Promise.reject(new Error('not exercised')),
        transition: () => Promise.reject(new Error('not exercised')),
        comment: (request) => {
          jiraComments.push(request);
          return Promise.resolve({ ok: true, value: { id: '1', author: 'probe', created: 'now', body: [] } });
        },
        users: () => Promise.reject(new Error('not exercised')),
      },
      // As `hooks/index.ts` wires it.
      fenceTranslate: headlessAdapter('codex').headless.fence.translate,
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
      defaultCli: () => 'codex',
      defaults: (id) => (id === 'codex' ? { effort: 'low' } : {}),
    };

    const buildWakeCommand = createWakeCommand({
      agentsRoot,
      workdir: laneWorkdir,
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
      env: () => process.env,
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
      parallelFor: (name) => (name === CX ? 2 : 1),
      // As `ipc/index.ts` wires it: `/fence` reads a Codex run's grants from here, never its env.
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
      onRunClosed: (name) => scheduler?.onRunClosed(name),
      now: () => Date.now(),
      newRunId: () => randomUUID(),
    });

    scheduler = createScheduler({
      run: (name, trigger, extra, options) => runs.run(name, trigger, extra, options),
      state: agentState,
      isAgent: (id) => AGENTS.includes(id),
      parallelFor: (name) => (name === CX ? 2 : 1),
      wakesOnLedger: (id) => AGENTS.includes(id),
      laneOf: () => undefined,
      laneLive: (name, lane) =>
        runs.liveRuns(name).some((run) => run.kind === 'standing' && (run.lane ?? 'standing') === lane),
      removeLaneDir: () => undefined,
      schedules: () => new Map(),
      pushStatus: () => {},
      ledger: { read: () => ledger.read({}), append: (request) => ledger.append(request) },
      now: () => Date.now(),
      setIntervalFn: (() => 0) as unknown as typeof setInterval,
      clearIntervalFn: (() => undefined) as unknown as typeof clearInterval,
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

  const settled = (name: string): Promise<void> =>
    new Promise((resolve) => {
      settlers.set(name, resolve);
    });

  const wake = (name: string, extra?: string): Promise<void> =>
    new Promise((resolve, reject) => {
      settlers.set(name, resolve);
      const started = runs.run(name, 'manual', extra);
      if (!started.started) reject(new Error(`the wake was refused (${started.refused}): ${started.reason ?? ''}`));
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

  const permissionAsks = (name: string) =>
    ledger
      .read({})
      .openAsks.filter((ask) => ask.from === name && ask.meta?.['kind'] === 'permission');

  it('the first wake mints a thread', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    await wake(CX, 'Reply with one short sentence saying hello, then end your turn.');

    const state = await persisted(CX);
    const marker = spawns.find((spawn) => spawn.name === CX)?.args;
    const thread = turnEnds.find((end) => end.name === CX)?.uuid;

    expect(thread).toBeTypeOf('string');
    expect(state.sessionUuid).toBe(thread);
    // The argv's id is the stop marker, never the conversation.
    expect(marker?.join(' ')).not.toContain(` resume `);
    expect(marker).not.toContain(state.sessionUuid);
    expect(state.runs.at(-1)?.harness).toBe('codex');
  }, TURN_MS);

  it('Stop arms the watchdog and the run closes done', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    const state = await persisted(CX);

    expect(turnEnds.some((end) => end.name === CX && end.uuid === state.sessionUuid)).toBe(true);
    expect(agentEvents.every((event) => AGENTS.includes(event.entityId))).toBe(true);
    expect(state.runs.at(-1)?.outcome).toBe('done');
  });

  it('a second wake resumes and remembers', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    const word = `probe${randomUUID().slice(0, 6)}`;
    await wake(CX, `Remember this exact word for later: ${word}. Reply only with "noted", then end your turn.`);
    const thread = (await persisted(CX)).sessionUuid as string;
    const before = lines.length;

    await wake(CX, 'What was the exact word you were asked to remember? Reply with only that word.');

    const args = spawns.filter((spawn) => spawn.name === CX).at(-1)?.args ?? [];
    expect(args.slice(0, 3)).toEqual(['exec', 'resume', thread]);
    expect(JSON.stringify(lines.slice(before))).toContain(word);
    expect((await persisted(CX)).sessionUuid).toBe(thread);
  }, 2 * TURN_MS);

  it('a task run starts a fresh thread', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    const standing = (await persisted(CX)).sessionUuid;
    const before = (await persisted(CX)).runs.length;

    expect(runs.run(CX, 'manual', 'Reply with "ok" and end your turn.', { job: true })).toMatchObject({
      started: true,
      kind: 'task',
    });
    await until(() => agentState.read(CX).runs.length > before, TURN_MS);

    const state = await persisted(CX);
    const task = state.runs.at(-1);
    expect(task?.kind).toBe('task');
    expect(task?.sessionUuid).toBeTypeOf('string');
    expect(task?.sessionUuid).not.toBe(standing);
    expect(state.sessionUuid).toBe(standing);
  }, TURN_MS);

  it('the receipt carries usage and no costUsd', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    const last = (await persisted(CX)).runs.at(-1);

    expect(last?.usage?.inputTokens).toBeGreaterThan(0);
    expect(last?.costUsd).toBeUndefined();
  });

  it('a Starter lease resolves Codex, a Community lease refuses', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    // Resolved: every wake above ran on codex with `entitled` answering null.
    expect((await persisted(CX)).runs.every((run) => run.harness === 'codex')).toBe(true);

    entitled = (id) => (id === 'codex' ? 'not in your plan (Starter or higher)' : null);
    const before = spawns.length;
    try {
      const refused = runs.run(CX, 'manual');
      expect(refused).toMatchObject({ started: false });
      expect(JSON.stringify(refused)).toContain(
        `No CLI can run ${CX}: codex is not in your plan (Starter or higher).`,
      );
      expect(spawns).toHaveLength(before);
    } finally {
      entitled = () => null;
    }
  });

  /**
   * Case 4: the fence. Each call kind is denied with one permission ask and no effect, then an
   * `allow-once` answer wakes the agent with that one-shot grant and the call runs.
   */
  const fenceCase = async (name: string, tool: string, effect: () => boolean) => {
    await wake(name);

    const asks = permissionAsks(name);
    expect(asks, JSON.stringify(ledger.read({ from: name }).entries.map((entry) => entry.body))).toHaveLength(1);
    expect(asks[0]?.meta?.['tool']).toBe(tool);
    expect(effect()).toBe(false);
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

  it('the fence asks about each file a patch writes, and allow-once lets it run', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    await fenceCase(PATCH, 'Write', () => existsSync(patchMarker));
  }, 2 * TURN_MS);

  it('the fence asks about an MCP call, and allow-once lets it run', async (ctx) => {
    if (skipReason !== undefined) ctx.skip(skipReason);
    await fenceCase(MCP, 'mcp__hive__jira_comment', () => jiraComments.length > 0);
  }, 2 * TURN_MS);
});
