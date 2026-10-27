// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CLI_TOKEN_ENV,
  createWakeCommand,
  type WakeCommandDeps,
  type WakeFs,
} from '../../../../electron/main/agents/wake-command';
import type { AgentState } from '../../../../electron/main/agents/state';
import { claudeCodeAdapter } from '../../../../electron/main/harness/claude-code';
import { codexAdapter } from '../../../../electron/main/harness/codex';
import { copilotAdapter } from '../../../../electron/main/harness/copilot';
import { COPILOT_TOKEN_ENV, copilotSettings } from '../../../../electron/main/harness/copilot/headless';
import type { HarnessAdapter, HeadlessSpec } from '../../../../electron/main/harness/port';
import type { McpServerSpec } from '../../../../electron/main/mcp/agent-config';
import { STANDING_LANE, type AgentRunState } from '../../../../electron/shared/agent-contract';
import type { HarnessId } from '../../../../electron/shared/harness-contract';
import { HOOK_ENV_GRANTS } from '../../../../electron/shared/hook-contract';

/**
 * The seam between a *name* and an argv (HIVE-115, task 9).
 *
 * `waker.test.ts` already pins the flags; what belongs here is everything that
 * happens on the way to calling it — which definition is read, whether the
 * binary resolved, what is written to disk before the spawn, and the rotation
 * rule that decides whether the run resumes a conversation or starts one.
 *
 * The filesystem is injected, so these assertions are about *what* was written
 * where, with no temp directory to clean up.
 */

const AGENT_MD = `---
name: slack-watcher
description: Watches the channel.
icon: ChatCircleDots
model: sonnet
tools: [Read, Bash]
limits:
  turns: 12
  rotate_after: 5
---
Read the channel and report.
`;

let files: Record<string, string>;
let written: Record<string, string>;
let made: string[];
let stored: Record<string, AgentRunState>;

const fs: WakeFs = {
  read: (path) => {
    const found = files[path];

    if (found === undefined) throw new Error(`ENOENT: ${path}`);

    return found;
  },
  write: (path, text) => {
    written[path] = text;
  },
  mkdir: (path) => {
    made.push(path);
  },
};

const EMPTY: AgentRunState = { status: 'sleeping', runsSinceRotate: 0, runs: [] };

const state = (): AgentState => ({
  all: () => ({ ...stored }),
  read: (name) => stored[name] ?? EMPTY,
  patch: (name, change) => {
    const next = { ...(stored[name] ?? EMPTY), ...change };

    stored[name] = next;

    return next;
  },
  recordRun: vi.fn(),
  clearSlackNeedsAuth: vi.fn(() => []),
  lane: (name, key) => {
    const agent = stored[name] ?? EMPTY;
    if (key !== STANDING_LANE) return agent.lanes?.[key] ?? { runsSinceRotate: 0 };
    const { status: _s, runs: _r, today: _t, skipsSinceRun: _k, forceRotate: _f, lanes: _l, ...lane } = agent;
    return lane;
  },
  patchLane: (name, key, change) => {
    const agent = stored[name] ?? EMPTY;
    if (key === STANDING_LANE) {
      stored[name] = { ...agent, ...change };
      return { ...change, runsSinceRotate: stored[name].runsSinceRotate };
    }
    const next = { ...(agent.lanes?.[key] ?? { runsSinceRotate: 0 }), ...change };
    stored[name] = { ...agent, lanes: { ...agent.lanes, [key]: next } };
    return next;
  },
  forgetLane: vi.fn(),
  forget: (name) => {
    delete stored[name];
  },
  carry: (from, to) => {
    const entry = stored[from];

    if (entry === undefined) return;

    stored[to] = entry;
    delete stored[from];
  },
  flush: vi.fn(),
  dispose: vi.fn(),
});

const build = (over: Partial<WakeCommandDeps> = {}) =>
  createWakeCommand({
    agentsRoot: () => '/home/u/.hive/agents',
    cliHome: (id) => `/home/u/.hive/cli/${id}`,
    workdir: (name, lane) =>
      lane === 'standing' ? `/home/u/.hive/work/${name}` : `/home/u/.hive/work/${name}/lanes/${lane}`,
    promptFile: (name) => `/data/hive/agents/${name}.system.md`,
    pluginDir: () => '/data/hive/plugin',
    agentSettingsPath: () => '/data/hive/claude-agent.settings.json',
    mcpConfig: () => '/data/hive/hive.mcp.json',
    // Handed to every wake's adapter (HIVE-342). `AGENT_MD` has no `mcp:` field,
    // so no per-agent file is written from it.
    hiveServer: () => ({
      command: '/App',
      args: ['/host.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    }),
    agentMcpFile: (name) => `/data/hive/agents/${name}.mcp.json`,
    hookEnv: (name) => ({ HIVE_SESSION_ID: name, HIVE_HOOK_TOKEN: 'tok' }),
    claudeCommand: () => '/usr/local/bin/claude',
    cliToken: () => null,
    subscriptionAuth: () => true,
    state: state(),
    env: () => ({ PATH: '/usr/local/bin', HOME: '/home/u' }),
    newUuid: () => 'minted-uuid',
    pendingGrants: () => [],
    fs,
    isExecutable: (path) => path === '/usr/local/bin/claude',
    // HIVE-137. Unused by a host agent, which every fixture above is.
    userDataPath: () => '/data',
    hostAlias: () => 'host.docker.internal',
    agentContainerSettingsPath: () => null,
    ...over,
  });

/** The hash a fresh session of the definition on disk would record. */
const promptHashNow = (): string => {
  const saved = stored;
  stored = {};
  const built = build()('slack-watcher', 'manual');
  stored = saved;
  if ('problem' in built || built.promptHash === undefined) throw new Error('expected a hash');
  return built.promptHash;
};

beforeEach(() => {
  files = { '/home/u/.hive/agents/slack-watcher/AGENT.md': AGENT_MD };
  written = {};
  made = [];
  stored = {};
});

describe('createWakeCommand', () => {
  it('builds the argv from the definition on disk', () => {
    const built = build()('slack-watcher', 'manual');

    expect('problem' in built).toBe(false);

    if ('problem' in built) return;

    expect(built.file).toBe('/usr/local/bin/claude');
    expect(built.args).toContain('--session-id');
    expect(built.args).toContain('minted-uuid');
    expect(built.args.join(' ')).toContain('--model sonnet');
    expect(built.args.join(' ')).toContain('--max-turns 12');
    expect(built.cwd).toBe('/home/u/.hive/work/slack-watcher');
  });

  it('writes the preamble and the body into the generated system prompt', () => {
    build()('slack-watcher', 'manual');

    const prompt = written['/data/hive/agents/slack-watcher.system.md'];

    expect(prompt).toContain('You are a background agent in HiveTTY.');
    expect(prompt).toContain('Read the channel and report.');
  });

  it('creates the working directory and the prompt directory before spawning', () => {
    build()('slack-watcher', 'manual');

    expect(made).toEqual(['/home/u/.hive/work/slack-watcher', '/data/hive/agents']);
  });

  it('carries the trigger into the wake prompt', () => {
    const built = build()('slack-watcher', 'ledger', 'a12 was answered');

    if ('problem' in built) throw new Error('expected a command');

    expect(built.args[built.args.length - 1]).toContain(
      'You woke because: ledger — a12 was answered',
    );
  });

  it('resumes the stored conversation and reports the uuid it invoked', () => {
    stored['slack-watcher'] = {
      status: 'sleeping',
      runsSinceRotate: 2,
      runs: [],
      sessionUuid: 'earlier-uuid',
      promptHash: promptHashNow(),
    };

    const built = build()('slack-watcher', 'manual');

    if ('problem' in built) throw new Error('expected a command');

    expect(built.args.join(' ')).toContain('--resume earlier-uuid');
    expect(built.args).not.toContain('--session-id');
    expect(built.sessionUuid).toBe('earlier-uuid');
    // Two under `rotate_after: 5`, so this is an ordinary wake, not a goodbye.
    expect(built.lastTurn).toBe(false);
  });

  it('refuses an agent that is not on disk', () => {
    expect(build()('ghost', 'manual')).toEqual({
      problem: 'There is no agent called ghost.',
    });
  });

  it('refuses a definition that cannot be parsed, naming the field', () => {
    files['/home/u/.hive/agents/slack-watcher/AGENT.md'] =
      '---\nname: slack-watcher\nicon: Robot\n---\nbody\n';

    const built = build()('slack-watcher', 'manual');

    expect(built).toEqual({ problem: 'description: Required.' });
  });

  /**
   * The wake-time parse deliberately does *not* re-check skills against the
   * machine. A renamed folder or an unscanned `~/.claude` would otherwise
   * refuse to wake the agent at all, where the honest consequence of a missing
   * skill is an agent that runs without it.
   */
  it('wakes an agent naming a skill this machine has never heard of', () => {
    files['/home/u/.hive/agents/slack-watcher/AGENT.md'] = AGENT_MD.replace(
      'tools: [Read, Bash]',
      'tools: [Read]\nskills: [some-plugin:vanished]',
    );

    expect('problem' in build()('slack-watcher', 'manual')).toBe(false);
  });

  it('refuses when the agent settings file has not been written', () => {
    const built = build({ agentSettingsPath: () => null })(
      'slack-watcher',
      'manual',
    );

    expect(built).toMatchObject({
      problem: expect.stringContaining('agent settings file'),
    });
  });

  it('starts an agent with the agent settings file, not the session one', () => {
    const built = build({
      agentSettingsPath: () => '/data/hive/claude-agent.settings.json',
    })('slack-watcher', 'manual');

    if ('problem' in built) throw new Error('expected a command');

    expect(built.args[built.args.indexOf('--settings') + 1]).toBe(
      '/data/hive/claude-agent.settings.json',
    );
  });

  it("carries this wake's one-shot grants into the command", () => {
    // `WebFetch`, not `Bash` — the fixture's own `tools: [Read, Bash]`
    // (`AGENT_MD` above) already grants `Bash`, so asserting that would pass
    // even with `grants: deps.pendingGrants(name)` deleted from the
    // `wakeCommand` call. A tool the definition does not list is the only
    // choice that actually discriminates the wiring this test exists to
    // prove.
    const built = build({ pendingGrants: () => ['WebFetch'] })(
      'slack-watcher',
      'manual',
    );

    if ('problem' in built) throw new Error('expected a command');

    expect(JSON.parse(built.env['HIVE_GRANTS']!)).toContain('WebFetch');
  });

  it('refuses when the MCP config has not been written', () => {
    const built = build({ mcpConfig: () => null })('slack-watcher', 'manual');

    expect(built).toMatchObject({
      problem: expect.stringContaining('ledger tools'),
    });
  });

  it('passes the resolver failure through unchanged', () => {
    const built = build({ claudeCommand: () => 'claude --tel' })(
      'slack-watcher',
      'manual',
    );

    expect(built).toMatchObject({
      problem: expect.stringContaining('carries arguments'),
    });
  });

  it('reports a disk it cannot write to rather than spawning anyway', () => {
    const built = build({
      fs: {
        ...fs,
        write: () => {
          throw new Error('EROFS: read-only file system');
        },
      },
    })('slack-watcher', 'manual');

    expect(built).toEqual({
      problem: 'Could not prepare the run: EROFS: read-only file system',
    });
  });

  /**
   * A wake that could not be prepared has changed nothing.
   *
   * The ordering this pins predates HIVE-122 — recording a rotation before the
   * `mkdir`/`write` meant a transient fs error threw away the session uuid
   * *and* returned no command: no run, and the conversation gone anyway. The
   * crossing wake no longer writes anything at all, so the invariant is now
   * that a failed prepare leaves the counter and the uuid exactly as it found
   * them, whichever side of the threshold they are on.
   */
  it('leaves the counter and the uuid untouched when preparing the run fails', () => {
    stored['slack-watcher'] = {
      status: 'sleeping',
      runsSinceRotate: 5,
      runs: [],
      sessionUuid: 'stale-uuid',
    };

    const built = build({
      fs: {
        ...fs,
        write: () => {
          throw new Error('ENOSPC: no space left on device');
        },
      },
    })('slack-watcher', 'manual');

    expect('problem' in built).toBe(true);
    expect(stored['slack-watcher']?.sessionUuid).toBe('stale-uuid');
    expect(stored['slack-watcher']?.runsSinceRotate).toBe(5);
  });

  it('strips the API-key variables when the user is on a subscription', () => {
    const built = build({
      env: () => ({
        PATH: '/usr/local/bin',
        ANTHROPIC_API_KEY: 'sk-should-not-travel',
      }),
    })('slack-watcher', 'manual');

    if ('problem' in built) throw new Error('expected a command');

    expect(built.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(built.env['HIVE_SESSION_ID']).toBe('slack-watcher');
    expect(built.env['HIVE_AGENT']).toBe('1');
  });
});

/**
 * Rotation as a handover rather than an amnesia (HIVE-122).
 *
 * The wake that crosses `rotate_after` used to clear the uuid and start fresh
 * on the spot. It now spends that wake asking the agent for a handoff, still
 * resumed on the old conversation — and writes nothing, because whether the
 * rotation happens is the *close's* call. `pendingSession` is the other half:
 * a rotation already decided, waiting for a wake to start it.
 *
 * `AGENT_MD` above declares `rotate_after: 5`.
 */
describe('the handoff wake', () => {
  /** The disk this wake cannot write its system prompt to. */
  const failWrites = (): WakeFs => ({
    ...fs,
    write: () => {
      throw new Error('ENOSPC: no space left on device');
    },
  });

  it('resumes the old session and asks for a handoff when the counter is up', () => {
    stored['slack-watcher'] = {
      status: 'sleeping',
      runsSinceRotate: 50,
      runs: [],
      sessionUuid: '9f3c1e2a',
    };

    const result = build()('slack-watcher', 'schedule');

    expect('problem' in result).toBe(false);

    if ('problem' in result) return;

    expect(result.lastTurn).toBe(true);
    expect(result.args).toContain('--resume');
    expect(result.args).toContain('9f3c1e2a');
    expect(result.args).not.toContain('--session-id');
    expect(result.sessionUuid).toBe('9f3c1e2a');
    expect(result.args.at(-1)).toContain('This is your last turn on this session.');
  });

  it('leaves the counter and the uuid alone — the close decides', () => {
    stored['slack-watcher'] = {
      status: 'sleeping',
      runsSinceRotate: 50,
      runs: [],
      sessionUuid: '9f3c1e2a',
    };

    build()('slack-watcher', 'schedule');

    expect(stored['slack-watcher']?.runsSinceRotate).toBe(50);
    expect(stored['slack-watcher']?.sessionUuid).toBe('9f3c1e2a');
  });

  it('starts the pending session and carries its handoff', () => {
    stored['slack-watcher'] = {
      status: 'sleeping',
      runsSinceRotate: 0,
      runs: [],
      sessionUuid: '9f3c1e2a',
      pendingSession: { uuid: 'b2e1-new', handoff: 'I watch #ops.' },
    };

    const result = build()('slack-watcher', 'schedule');

    if ('problem' in result) throw new Error(result.problem);

    expect(result.lastTurn).toBe(false);
    expect(result.args).toContain('--session-id');
    expect(result.args).toContain('b2e1-new');
    expect(result.args).not.toContain('--resume');
    expect(result.sessionUuid).toBe('b2e1-new');
    expect(result.args.at(-1)).toContain('I watch #ops.');
    // Consumed, so the wake after this one resumes normally.
    expect(stored['slack-watcher']?.pendingSession).toBeUndefined();
  });

  it('honours a forced rotation, and clears the flag', () => {
    stored['slack-watcher'] = {
      status: 'sleeping',
      runsSinceRotate: 0,
      runs: [],
      sessionUuid: '9f3c1e2a',
      forceRotate: true,
    };

    const result = build()('slack-watcher', 'manual');

    if ('problem' in result) throw new Error(result.problem);

    expect(result.lastTurn).toBe(true);
    expect(stored['slack-watcher']?.forceRotate).toBeUndefined();
  });

  /*
    A forced rotation on an agent that has never run degrades to an ordinary
    first wake (HIVE-122).

    Only a run sets `sessionUuid`, so the counter path can never reach this —
    but the console's `rotate` verb can, on an agent installed five minutes ago.
    Without the `sessionUuid` term the wake would be a *last turn* on a brand
    new `--session-id` session: an agent asked to summarise a conversation that
    has not happened yet, and a handoff that could only be fiction.
  */
  it('degrades a forced rotation on a never-run agent to a first wake', () => {
    stored['slack-watcher'] = {
      status: 'sleeping',
      runsSinceRotate: 0,
      runs: [],
      forceRotate: true,
    };

    const result = build()('slack-watcher', 'manual');

    if ('problem' in result) throw new Error(result.problem);

    expect(result.lastTurn).toBe(false);
    expect(result.args).toContain('--session-id');
    expect(result.args).not.toContain('--resume');
    // Consumed all the same: the fresh session the user asked for is the one
    // this wake starts, so leaving the flag armed would rotate again next time.
    expect(stored['slack-watcher']?.forceRotate).toBeUndefined();
  });

  it('keeps the pending session when preparing the run fails', () => {
    stored['slack-watcher'] = {
      status: 'sleeping',
      runsSinceRotate: 0,
      runs: [],
      pendingSession: { uuid: 'b2e1-new', handoff: 'I watch #ops.' },
    };

    const built = build({ fs: failWrites() })('slack-watcher', 'schedule');

    expect('problem' in built).toBe(true);
    // Nothing consumed: a full disk must not destroy the handoff.
    expect(stored['slack-watcher']?.pendingSession).toEqual({
      uuid: 'b2e1-new',
      handoff: 'I watch #ops.',
    });
  });

  it('never both asks for a handoff and starts a fresh session', () => {
    stored['slack-watcher'] = {
      status: 'sleeping',
      runsSinceRotate: 50,
      runs: [],
      pendingSession: { uuid: 'b2e1-new', handoff: 'I watch #ops.' },
    };

    const result = build()('slack-watcher', 'schedule');

    if ('problem' in result) throw new Error(result.problem);

    expect(result.lastTurn).toBe(false);
    expect(result.args).toContain('--session-id');
  });
});

/**
 * A task run: a fresh session for one job, never the standing conversation
 * (HIVE-128).
 */
describe('a task run (HIVE-128)', () => {
  beforeEach(() => {
    stored['slack-watcher'] = {
      status: 'sleeping',
      runsSinceRotate: 9,
      runs: [],
      sessionUuid: 'old-uuid',
      pendingSession: { uuid: 'rotation-uuid', handoff: 'what I know' },
      forceRotate: true,
    };
  });

  it('starts a fresh session and never resumes the standing one', () => {
    const built = build()('slack-watcher', 'manual', 'review PR 166', { kind: 'task' });

    expect('problem' in built).toBe(false);
    if ('problem' in built) return;

    expect(built.kind).toBe('task');
    expect(built.args).toContain('--session-id');
    expect(built.args[built.args.indexOf('--session-id') + 1]).toBe('minted-uuid');
    expect(built.args).not.toContain('--resume');
    expect(built.sessionUuid).toBe('minted-uuid');
  });

  it('leaves the pending rotation and the force flag for the standing run', () => {
    build()('slack-watcher', 'manual', 'review PR 166', { kind: 'task' });

    expect(stored['slack-watcher']?.pendingSession).toEqual({
      uuid: 'rotation-uuid',
      handoff: 'what I know',
    });
    expect(stored['slack-watcher']?.forceRotate).toBe(true);
  });

  it('is never a last turn, however many runs the counter shows', () => {
    const built = build()('slack-watcher', 'manual', 'review PR 166', { kind: 'task' });

    if ('problem' in built) throw new Error(built.problem);

    expect(built.lastTurn).toBe(false);
    expect(built.args[built.args.length - 1]).not.toContain('last turn');
  });

  it('reports standing for a wake that names no kind', () => {
    const built = build()('slack-watcher', 'manual');

    if ('problem' in built) throw new Error(built.problem);

    expect(built.kind).toBe('standing');
  });
});

/**
 * A per-agent `--mcp-config`, for a definition that names an integration
 * (HIVE-123, task 2).
 *
 * A self-contained fixture set rather than a reuse of `build()` above: that
 * one's `AGENT_MD` has no `mcp:` field on purpose, so it cannot exercise this
 * branch without being rewritten out from under the rotation tests it exists
 * for.
 */
describe('a per-agent mcp config', () => {
  const HIVE: McpServerSpec = {
    command: '/App',
    args: ['/host.js'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };

  /**
   * An AGENT.md body, customisable by the one field each test varies.
   *
   * `name:` is a placeholder rather than a fixed value: `deps()`'s `read`
   * fills it in with whatever folder was actually asked for, so this same
   * source works whichever agent name a test wakes.
   */
  function agentSource(over: { mcp?: string; tools?: string } = {}): string {
    const tools = over.tools ?? '[Read, Bash]';
    const mcpLine = over.mcp === undefined ? '' : `mcp: ${over.mcp}\n`;

    return `---
name: {{name}}
description: Watches the channel.
icon: ChatCircleDots
model: sonnet
tools: ${tools}
${mcpLine}limits:
  turns: 12
  rotate_after: 5
---
Read the channel and report.
`;
  }

  /** A `WakeFs.read` that serves `source` for whichever folder was asked for. */
  function readerFor(source: string): WakeFs['read'] {
    return (path) => {
      const match = /\/agents\/([^/]+)\/AGENT\.md$/.exec(path);

      if (match === null) throw new Error(`ENOENT: ${path}`);

      return source.replace('{{name}}', match[1]!);
    };
  }

  /** `WakeCommandDeps`, fixed across these tests apart from what each varies. */
  function deps(
    over: {
      source?: string;
      fs?: Partial<WakeFs>;
      hiveServer?: () => McpServerSpec | null;
    } = {},
  ): WakeCommandDeps {
    const source = over.source ?? agentSource();
    const localState: Record<string, AgentRunState> = {};

    return {
      agentsRoot: () => '/home/u/.hive/agents',
      cliHome: (id) => `/home/u/.hive/cli/${id}`,
      workdir: (name) => `/home/u/.hive/work/${name}`,
      promptFile: (name) => `/userData/hive/agents/${name}.system.md`,
      pluginDir: () => '/userData/hive/plugin',
      agentSettingsPath: () => '/userData/hive/claude-agent.settings.json',
      mcpConfig: () => '/userData/hive/hive.mcp.json',
      hiveServer: over.hiveServer ?? (() => HIVE),
      agentMcpFile: (name) => `/userData/hive/agents/${name}.mcp.json`,
      hookEnv: (name) => ({ HIVE_SESSION_ID: name, HIVE_HOOK_TOKEN: 'tok' }),
      claudeCommand: () => '/usr/local/bin/claude',
      cliToken: () => null,
      subscriptionAuth: () => true,
      // HIVE-137. Host agents only in this describe.
      userDataPath: () => '/userData',
      hostAlias: () => 'host.docker.internal',
      agentContainerSettingsPath: () => null,
      state: {
        all: () => ({ ...localState }),
        read: (name) => localState[name] ?? EMPTY,
        patch: (name, change) => {
          const next = { ...(localState[name] ?? EMPTY), ...change };

          localState[name] = next;

          return next;
        },
        recordRun: vi.fn(),
        clearSlackNeedsAuth: vi.fn(() => []),
        lane: vi.fn(() => ({ runsSinceRotate: 0 })),
        patchLane: vi.fn(() => ({ runsSinceRotate: 0 })),
        forgetLane: vi.fn(),
        forget: (name) => {
          delete localState[name];
        },
        carry: (from, to) => {
          const entry = localState[from];

          if (entry === undefined) return;

          localState[to] = entry;
          delete localState[from];
        },
        flush: vi.fn(),
        dispose: vi.fn(),
      },
      env: () => ({ PATH: '/usr/local/bin', HOME: '/home/u' }),
      newUuid: () => 'minted-uuid',
      pendingGrants: () => [],
      isExecutable: (path) => path === '/usr/local/bin/claude',
      fs: {
        read: readerFor(source),
        write: () => {},
        mkdir: () => {},
        ...over.fs,
      },
    };
  }

  it('points --mcp-config at a per-agent file when the definition names an integration', () => {
    const written = new Map<string, string>();
    const build = createWakeCommand(
      deps({
        source: agentSource({ mcp: '[slack]', tools: '[Read, mcp__slack__*]' }),
        fs: {
          write: (path, body) => {
            written.set(path, body);
          },
        },
      }),
    );

    const command = build('slack-watcher', 'interval');

    if ('problem' in command) throw new Error(command.problem);

    const flag = command.args[command.args.indexOf('--mcp-config') + 1];

    expect(flag).toBe('/userData/hive/agents/slack-watcher.mcp.json');
    expect(JSON.parse(written.get(flag ?? '') ?? '{}').mcpServers).toHaveProperty(
      'slack',
    );
  });

  it('keeps the shared file for an agent with an empty mcp:', () => {
    const written = new Map<string, string>();
    const build = createWakeCommand(
      deps({
        source: agentSource({ tools: '[Read]' }),
        fs: {
          write: (path, body) => {
            written.set(path, body);
          },
        },
      }),
    );

    const command = build('drone', 'interval');

    if ('problem' in command) throw new Error(command.problem);

    expect(command.args[command.args.indexOf('--mcp-config') + 1]).toBe(
      '/userData/hive/hive.mcp.json',
    );
    expect([...written.keys()]).not.toContain('/userData/hive/agents/drone.mcp.json');
  });

  it('refuses the wake when the hive descriptor is unavailable', () => {
    const build = createWakeCommand(
      deps({ source: agentSource({ mcp: '[slack]' }), hiveServer: () => null }),
    );

    expect(build('slack-watcher', 'interval')).toEqual({
      problem:
        'The ledger tools are not configured yet, and an agent reads its ' +
        'inbox before anything else. Try again in a moment.',
    });
  });
});

describe('a containerised agent (HIVE-137)', () => {
  const CONTAINER_MD = AGENT_MD.replace(
    'limits:',
    'container:\n  runtime: docker\n  name: devbox\n  workspace: /work\n  hive_dir: /hive\nlimits:',
  );
  const containerDeps = (): Partial<WakeCommandDeps> => ({
    userDataPath: () => '/data',
    hostAlias: () => 'host.docker.internal',
    agentContainerSettingsPath: () => '/data/hive/container/claude-agent.settings.json',
  });

  beforeEach(() => {
    files['/home/u/.hive/agents/slack-watcher/AGENT.md'] = CONTAINER_MD;
  });

  it('uses the container agent settings file and the shared container MCP file, mapped inside', () => {
    const built = build(containerDeps())('slack-watcher', 'manual');

    if ('problem' in built) throw new Error(built.problem);

    const joined = built.args.join(' ');
    expect(joined).toContain('--settings /hive/container/claude-agent.settings.json');
    expect(joined).toContain('--mcp-config /hive/container/hive.mcp.json');
    expect(built.container?.name).toBe('devbox');
    expect(built.env['HIVE_RECEIVER_URL']).toBeUndefined();
  });

  it('does not need a claude on the host: the binary is inside', () => {
    const built = build({ ...containerDeps(), claudeCommand: () => 'claude --tel' })(
      'slack-watcher',
      'manual',
    );

    expect('problem' in built).toBe(false);
  });

  it('refuses when the container settings file is not ready', () => {
    const built = build({ ...containerDeps(), agentContainerSettingsPath: () => null })(
      'slack-watcher',
      'manual',
    );

    expect('problem' in built && built.problem).toMatch(/container/i);
  });

  it('refuses an unmappable path as a problem, not a throw', () => {
    const built = build({
      ...containerDeps(),
      agentContainerSettingsPath: () => '/elsewhere/claude-agent.settings.json',
    })('slack-watcher', 'manual');

    expect('problem' in built && built.problem).toContain('/elsewhere/claude-agent.settings.json');
  });

  it('refuses rewrite, which this story does not support for an agent', () => {
    files['/home/u/.hive/agents/slack-watcher/AGENT.md'] = CONTAINER_MD.replace(
      '  hive_dir: /hive',
      '  hive_dir: /hive\n  freshness: rewrite',
    );

    const built = build(containerDeps())('slack-watcher', 'manual');

    expect('problem' in built && built.problem).toContain('exec-env');
  });

  it('refuses an integration, which runs on this machine and cannot be reached inside', () => {
    files['/home/u/.hive/agents/slack-watcher/AGENT.md'] = CONTAINER_MD.replace(
      'tools: [Read, Bash]',
      'tools: [Read, Bash]\nmcp: [slack]',
    );

    const built = build(containerDeps())('slack-watcher', 'manual');

    expect('problem' in built && built.problem).toContain('slack');
    expect(written['/data/hive/agents/slack-watcher.mcp.json']).toBeUndefined();
  });
});

describe('lanes (HIVE-185)', () => {
  it('resumes the lane\'s own recorded session, never the standing one', () => {
    stored['slack-watcher'] = {
      status: 'sleeping', runsSinceRotate: 3, runs: [], sessionUuid: 'standing-uuid',
      lanes: { 'thread:A': { sessionUuid: 'lane-a-uuid', runsSinceRotate: 1 } },
    };

    const built = build()('slack-watcher', 'ledger', undefined, { lane: 'thread:A' });

    if ('problem' in built) throw new Error(built.problem);
    expect(built.args).toContain('--resume');
    expect(built.args).toContain('lane-a-uuid');
    expect(built.args).not.toContain('standing-uuid');
    expect(built.sessionUuid).toBe('lane-a-uuid');
  });

  it('mints a fresh --session-id for a lane that has none', () => {
    stored['slack-watcher'] = { status: 'sleeping', runsSinceRotate: 3, runs: [], sessionUuid: 'standing-uuid' };

    const built = build()('slack-watcher', 'ledger', undefined, { lane: 'thread:B' });

    if ('problem' in built) throw new Error(built.problem);
    expect(built.args).toContain('--session-id');
    expect(built.args).toContain('minted-uuid');
    expect(built.args).not.toContain('standing-uuid');
  });

  it('asks a lane for its handoff on its own count, and consumes only its own pending rotation', () => {
    stored['slack-watcher'] = {
      status: 'sleeping', runsSinceRotate: 0, runs: [], sessionUuid: 'standing-uuid',
      pendingSession: { uuid: 'standing-next', handoff: 'standing notes' },
      lanes: { 'repo:a/x': { sessionUuid: 'lane-uuid', runsSinceRotate: 999 } },
    };

    const built = build()('slack-watcher', 'ledger', undefined, { lane: 'repo:a/x' });

    if ('problem' in built) throw new Error(built.problem);
    expect(built.lastTurn).toBe(true);
    expect(built.args).toContain('lane-uuid');
    // The standing lane's parked rotation is untouched by another lane's wake.
    expect(stored['slack-watcher'].pendingSession).toEqual({ uuid: 'standing-next', handoff: 'standing notes' });
  });

  it('starts a lane\'s own parked rotation with its handoff', () => {
    stored['slack-watcher'] = {
      status: 'sleeping', runsSinceRotate: 0, runs: [],
      lanes: { 'repo:a/x': { sessionUuid: 'old', runsSinceRotate: 0, pendingSession: { uuid: 'lane-next', handoff: 'lane notes' } } },
    };

    const built = build()('slack-watcher', 'ledger', undefined, { lane: 'repo:a/x' });

    if ('problem' in built) throw new Error(built.problem);
    expect(built.args).toContain('lane-next');
    expect(built.sessionUuid).toBe('lane-next');
    expect(stored['slack-watcher'].lanes?.['repo:a/x']?.pendingSession).toBeUndefined();
  });

  it('never reads forceRotate from another lane — it is the standing lane\'s', () => {
    stored['slack-watcher'] = {
      status: 'sleeping', runsSinceRotate: 0, runs: [], sessionUuid: 's', forceRotate: true,
      lanes: { 'thread:A': { sessionUuid: 'a', runsSinceRotate: 0, promptHash: promptHashNow() } },
    };

    const built = build()('slack-watcher', 'ledger', undefined, { lane: 'thread:A' });

    if ('problem' in built) throw new Error(built.problem);
    expect(built.lastTurn).toBe(false);
    expect(stored['slack-watcher'].forceRotate).toBe(true);
  });
});

describe('a lane\'s working directory (HIVE-188)', () => {
  it('creates and runs a lane in its own directory, and a standing wake in the agent\'s own', () => {
    const lane = build()('slack-watcher', 'ledger', undefined, { lane: 'thread:A' });

    if ('problem' in lane) throw new Error(lane.problem);
    expect(lane.cwd).toBe('/home/u/.hive/work/slack-watcher/lanes/thread:A');
    expect(made).toContain('/home/u/.hive/work/slack-watcher/lanes/thread:A');

    const standing = build()('slack-watcher', 'ledger');

    if ('problem' in standing) throw new Error(standing.problem);
    expect(standing.cwd).toBe('/home/u/.hive/work/slack-watcher');
  });

  it('runs a task run in the agent\'s own directory, whatever lane it names', () => {
    const task = build()('slack-watcher', 'manual', 'review', { kind: 'task', lane: 'thread:A' });

    if ('problem' in task) throw new Error(task.problem);
    expect(task.cwd).toBe('/home/u/.hive/work/slack-watcher');
  });
});

describe('the lane in the wake prompt (HIVE-188)', () => {
  it('tells a lane run which lane it is', () => {
    files['/home/u/.hive/agents/slack-watcher/AGENT.md'] = AGENT_MD.replace('model: sonnet\n', 'model: sonnet\nlane: thread\n');

    const built = build()('slack-watcher', 'ledger', 'ask A from overmind', { lane: 'thread:A' });

    if ('problem' in built) throw new Error(built.problem);
    expect(built.args.at(-1)).toContain("You are slack-watcher's lane for ask A.");
  });

  it('tells the standing lane of a laning agent how to hand work over', () => {
    files['/home/u/.hive/agents/slack-watcher/AGENT.md'] = AGENT_MD.replace('model: sonnet\n', 'model: sonnet\nlane: thread\n');

    const built = build()('slack-watcher', 'ledger');

    if ('problem' in built) throw new Error(built.problem);
    expect(built.args.at(-1)).toContain('slack-watcher lanes by thread.');
  });
});

describe('grants per lane (HIVE-187)', () => {
  it('asks for the grants of the wake\'s own lane, and a task run for the standing lane\'s', () => {
    const pendingGrants = vi.fn((_name: string, _lane: string): string[] => []);

    build({ pendingGrants })('slack-watcher', 'ledger', undefined, { lane: 'thread:A' });
    build({ pendingGrants })('slack-watcher', 'manual', 'review', { kind: 'task', lane: 'thread:A' });
    build({ pendingGrants })('slack-watcher', 'ledger');

    expect(pendingGrants.mock.calls).toEqual([
      ['slack-watcher', 'thread:A'],
      ['slack-watcher', 'standing'],
      ['slack-watcher', 'standing'],
    ]);
  });
});

/**
 * A resumed session keeps the system prompt it started with: `claude --resume`
 * ignores a changed `--append-system-prompt-file`. So an edited definition, or
 * an app update to the preamble, reaches a running conversation only through a
 * rotation, and a changed prompt forces one.
 */
describe('a changed system prompt', () => {
  const fresh = () => {
    const built = build()('slack-watcher', 'manual');

    if ('problem' in built) throw new Error(built.problem);

    return built;
  };

  it('reports the hash of the prompt a new session starts with', () => {
    const built = fresh();

    expect(built.promptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports no hash for a resumed wake, whose session keeps its own prompt', () => {
    stored['slack-watcher'] = { ...EMPTY, sessionUuid: 'earlier', promptHash: promptHashNow() };

    const built = fresh();

    expect(built.args).toContain('--resume');
    expect(built.promptHash).toBeUndefined();
  });

  it('resumes without a handoff while the prompt is unchanged', () => {
    stored['slack-watcher'] = { ...EMPTY, sessionUuid: 'earlier', promptHash: promptHashNow() };

    expect(fresh().lastTurn).toBe(false);
  });

  it('asks for a handoff on the wake after the definition changes', () => {
    stored['slack-watcher'] = { ...EMPTY, sessionUuid: 'earlier', promptHash: promptHashNow() };
    files['/home/u/.hive/agents/slack-watcher/AGENT.md'] = AGENT_MD.replace(
      'Read the channel and report.',
      'Read the channel and never relay.',
    );

    const built = fresh();

    expect(built.lastTurn).toBe(true);
    expect(built.args).toContain('earlier');
  });

  it('asks for a handoff when the session predates prompt hashes', () => {
    stored['slack-watcher'] = { ...EMPTY, sessionUuid: 'earlier' };

    expect(fresh().lastTurn).toBe(true);
  });

  it('asks a lane for a handoff on its own stale prompt', () => {
    stored['slack-watcher'] = {
      ...EMPTY,
      sessionUuid: 'standing',
      promptHash: promptHashNow(),
      lanes: { 'thread:A': { sessionUuid: 'lane', runsSinceRotate: 0, promptHash: 'other' } },
    };

    const lane = build()('slack-watcher', 'ledger', undefined, { lane: 'thread:A' });
    const standing = fresh();

    if ('problem' in lane) throw new Error(lane.problem);
    expect(lane.lastTurn).toBe(true);
    expect(standing.lastTurn).toBe(false);
  });
});

describe('the CLI a wake runs on (HIVE-340)', () => {
  const codex: HarnessId = 'codex';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs on claude-code and says so, with no gate and no harness:', () => {
    const built = build()('slack-watcher', 'manual');

    if ('problem' in built) throw new Error(built.problem);

    expect(built.harness).toBe('claude-code');
  });

  it('asks the fence about exactly what HIVE_GRANTS carries', () => {
    const express = vi.spyOn(claudeCodeAdapter.headless.fence, 'express');
    const built = build({ pendingGrants: () => ['literal:Bash:git push'] })('slack-watcher', 'manual');

    if ('problem' in built) throw new Error(built.problem);

    expect(express).toHaveBeenCalledWith(JSON.parse(built.env[HOOK_ENV_GRANTS]!));
  });

  it('refuses a run no CLI can fence, naming tools and never their arguments', () => {
    vi.spyOn(claudeCodeAdapter.headless.fence, 'express').mockReturnValue({
      ok: false,
      unexpressible: ['Bash(cat /Users/u/secret)'],
    });

    expect(build()('slack-watcher', 'manual')).toEqual({
      problem: 'No CLI can run slack-watcher: claude-code cannot enforce Bash.',
    });
  });

  it('resolves again on the next wake after a lapse', () => {
    let allowed = true;
    const wake = build({
      gate: {
        entitled: () => (allowed ? null : 'not in your plan (Starter or higher)'),
        enabled: () => true,
        defaultCli: () => undefined,
        defaults: () => ({}),
      },
    });

    expect(wake('slack-watcher', 'manual')).not.toHaveProperty('problem');
    allowed = false;
    expect(wake('slack-watcher', 'manual')).toEqual({
      problem: 'No CLI can run slack-watcher: claude-code is not in your plan (Starter or higher).',
    });
  });

  it("passes the card's model to a definition that names none, and AGENT.md's wins (HIVE-341)", () => {
    const wake = build({
      gate: {
        entitled: () => null,
        enabled: () => true,
        defaultCli: () => undefined,
        defaults: () => ({ model: 'haiku' }),
      },
    });

    const named = wake('slack-watcher', 'manual');
    if ('problem' in named) throw new Error(named.problem);
    expect(named.args[named.args.indexOf('--model') + 1]).toBe('sonnet');

    files['/home/u/.hive/agents/slack-watcher/AGENT.md'] = AGENT_MD.replace('model: sonnet\n', '');
    const unnamed = wake('slack-watcher', 'manual');
    if ('problem' in unnamed) throw new Error(unnamed.problem);
    expect(unnamed.args[unnamed.args.indexOf('--model') + 1]).toBe('haiku');
  });

  it('resumes a lane whose conversation is on the same CLI', () => {
    stored['slack-watcher'] = {
      status: 'sleeping', runsSinceRotate: 1, runs: [],
      sessionUuid: 'earlier-uuid', harness: 'claude-code', promptHash: promptHashNow(),
    };
    const built = build()('slack-watcher', 'manual');

    if ('problem' in built) throw new Error(built.problem);

    expect(built.args.join(' ')).toContain('--resume earlier-uuid');
  });

  it("starts fresh, without a handoff turn, when the lane's conversation is another CLI's", () => {
    stored['slack-watcher'] = {
      status: 'sleeping', runsSinceRotate: 9, runs: [],
      sessionUuid: 'codex-thread', harness: codex, promptHash: 'stale', forceRotate: true,
    };
    const built = build()('slack-watcher', 'manual');

    if ('problem' in built) throw new Error(built.problem);

    expect(built.args.join(' ')).not.toContain('--resume');
    expect(built.args.join(' ')).toContain('--session-id minted-uuid');
    expect(built.sessionUuid).toBe('minted-uuid');
    expect(built.lastTurn).toBe(false);
    expect(built.promptHash).toBeDefined();
    expect(built.harness).toBe('claude-code');
    expect(built.args.join('\n')).toContain(
      'This is a fresh conversation on claude-code: your last one ran on codex, which is not available for this wake.',
    );
    expect(stored['slack-watcher']?.forceRotate).toBeUndefined();
  });

  it('zeroes the rotation counters when the CLI changed, so the fresh conversation is not asked to hand off', () => {
    stored['slack-watcher'] = {
      status: 'sleeping', runsSinceRotate: 9, rotateFailures: 2, runs: [],
      sessionUuid: 'codex-thread', harness: codex, promptHash: promptHashNow(),
    };
    const built = build()('slack-watcher', 'manual');

    if ('problem' in built) throw new Error(built.problem);

    expect(stored['slack-watcher']?.runsSinceRotate).toBe(0);
    expect(stored['slack-watcher']?.rotateFailures).toBe(0);

    const next = build()('slack-watcher', 'manual');

    if ('problem' in next) throw new Error(next.problem);

    expect(next.lastTurn).toBe(false);
  });

  it('keeps the old conversation\'s counters when a switched wake is refused', () => {
    files['/home/u/.hive/agents/slack-watcher/AGENT.md'] = AGENT_MD.replace(
      'limits:',
      'container:\n  runtime: docker\n  name: devbox\n  workspace: /work\n  hive_dir: /hive\nlimits:',
    );
    stored['slack-watcher'] = {
      status: 'sleeping', runsSinceRotate: 9, rotateFailures: 2, runs: [],
      sessionUuid: 'codex-thread', harness: codex, promptHash: 'stale',
    };
    const built = build({
      userDataPath: () => '/data',
      hostAlias: () => 'host.docker.internal',
      agentContainerSettingsPath: () => '/elsewhere/claude-agent.settings.json',
    })('slack-watcher', 'manual');

    expect('problem' in built && built.problem).toContain('/elsewhere/claude-agent.settings.json');
    expect(stored['slack-watcher']?.runsSinceRotate).toBe(9);
    expect(stored['slack-watcher']?.rotateFailures).toBe(2);
  });

  it('leaves the rotation counters alone when the CLI did not change', () => {
    stored['slack-watcher'] = {
      status: 'sleeping', runsSinceRotate: 3, rotateFailures: 1, runs: [],
      sessionUuid: 'earlier-uuid', harness: 'claude-code', promptHash: promptHashNow(),
    };
    build()('slack-watcher', 'manual');

    expect(stored['slack-watcher']?.runsSinceRotate).toBe(3);
    expect(stored['slack-watcher']?.rotateFailures).toBe(1);
  });

  it('does not count a lane with no recorded harness as switched', () => {
    stored['slack-watcher'] = {
      status: 'sleeping', runsSinceRotate: 3, rotateFailures: 1, runs: [],
      sessionUuid: 'old-uuid', promptHash: promptHashNow(),
    };
    const built = build()('slack-watcher', 'manual');

    if ('problem' in built) throw new Error(built.problem);

    expect(built.args.join(' ')).toContain('--resume old-uuid');
    expect(stored['slack-watcher']?.runsSinceRotate).toBe(3);
  });

  it('still starts a parked rotation with its handoff, on the new CLI', () => {
    stored['slack-watcher'] = {
      status: 'sleeping', runsSinceRotate: 0, runs: [],
      sessionUuid: 'codex-thread', harness: codex,
      pendingSession: { uuid: 'parked-uuid', handoff: 'Pick up the PR review.' },
    };
    const built = build()('slack-watcher', 'manual');

    if ('problem' in built) throw new Error(built.problem);

    expect(built.sessionUuid).toBe('parked-uuid');
    expect(built.args.join('\n')).toContain('Pick up the PR review.');
    expect(built.args.join('\n')).not.toContain('This is a fresh conversation');
  });
});

describe('what a CLI without a settings file is handed (HIVE-342)', () => {
  const recording = () => {
    const seen: HeadlessSpec[] = [];
    const adapter: HarnessAdapter = {
      ...claudeCodeAdapter,
      headless: {
        ...claudeCodeAdapter.headless,
        launch: (spec) => {
          seen.push(spec);
          return claudeCodeAdapter.headless.launch(spec);
        },
      },
    };
    return { seen, adapter };
  };

  it('hands the adapter the system prompt text and the hive server', () => {
    const { seen, adapter } = recording();
    const built = build({ adapter: () => adapter })('slack-watcher', 'manual');

    if ('problem' in built) throw new Error(built.problem);

    expect(seen[0]?.instructions).toBe(written['/data/hive/agents/slack-watcher.system.md']);
    expect(seen[0]?.instructions).toContain('Read the channel and report.');
    expect(seen[0]?.hiveServer).toEqual({
      command: '/App',
      args: ['/host.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });

  it('refuses the wake when the hive descriptor is unavailable, with no mcp: at all', () => {
    expect(build({ hiveServer: () => null })('slack-watcher', 'manual')).toEqual({
      problem:
        'The ledger tools are not configured yet, and an agent reads its ' +
        'inbox before anything else. Try again in a moment.',
    });
  });
});

describe('the binary per CLI, and no codex in a container (HIVE-342)', () => {
  const CODEX_MD = AGENT_MD.replace('limits:', 'harness: [codex]\nlimits:');
  // PR1's codex fence refuses everything; these tests stand in PR2's, which passes.
  const fenced: HarnessAdapter = {
    ...codexAdapter,
    headless: { ...codexAdapter.headless, fence: { express: () => ({ ok: true }) } },
  };
  const adapter = (id: HarnessId) => (id === 'codex' ? fenced : claudeCodeAdapter);

  it('resolves codex on PATH and runs codex exec', () => {
    files['/home/u/.hive/agents/slack-watcher/AGENT.md'] = CODEX_MD;
    const built = build({
      adapter,
      env: () => ({ PATH: '/bin:/opt/bin', HOME: '/home/u' }),
      isExecutable: (path) => path === '/opt/bin/codex',
    })('slack-watcher', 'manual');

    if ('problem' in built) throw new Error(built.problem);

    expect(built.file).toBe('/opt/bin/codex');
    expect(built.args[0]).toBe('exec');
    expect(built.harness).toBe('codex');
  });

  /*
    A first codex wake learns its thread only from `thread.started` (HIVE-353), so the rotation
    it starts stays parked until the close records one; the run carries `startsRotation` there.
  */
  it('leaves a parked rotation for the close when codex starts it', () => {
    files['/home/u/.hive/agents/slack-watcher/AGENT.md'] = CODEX_MD;
    stored['slack-watcher'] = {
      status: 'sleeping', runsSinceRotate: 0, runs: [], sessionUuid: 'old-thread', harness: 'codex',
      pendingSession: { uuid: 'b2e1-new', handoff: 'I watch #ops.' },
    };
    const built = build({
      adapter,
      env: () => ({ PATH: '/opt/bin', HOME: '/home/u' }),
      isExecutable: (path) => path === '/opt/bin/codex',
    })('slack-watcher', 'schedule');

    if ('problem' in built) throw new Error(built.problem);

    expect(built.namesConversation).toBe(false);
    expect(built.startsRotation).toBe(true);
    expect(built.args.at(-1)).toContain('I watch #ops.');
    expect(stored['slack-watcher']?.pendingSession).toEqual({
      uuid: 'b2e1-new',
      handoff: 'I watch #ops.',
    });
  });

  it('marks no rotation for the close when Claude starts it', () => {
    stored['slack-watcher'] = {
      status: 'sleeping', runsSinceRotate: 0, runs: [], sessionUuid: 'old',
      pendingSession: { uuid: 'b2e1-new', handoff: 'I watch #ops.' },
    };
    const built = build()('slack-watcher', 'schedule');

    if ('problem' in built) throw new Error(built.problem);

    expect(built).not.toHaveProperty('startsRotation');
  });

  it('says codex was not found when it is not on PATH', () => {
    files['/home/u/.hive/agents/slack-watcher/AGENT.md'] = CODEX_MD;
    const built = build({ adapter })('slack-watcher', 'manual');

    expect('problem' in built ? built.problem : 'resolved').toMatch(
      /^No CLI can run slack-watcher: codex cannot start: `codex` was not found on PATH/,
    );
  });

  it('refuses a codex agent that runs in a container', () => {
    files['/home/u/.hive/agents/slack-watcher/AGENT.md'] = CODEX_MD.replace(
      'limits:',
      'container:\n  runtime: docker\n  name: devbox\n  workspace: /work\n  hive_dir: /hive\nlimits:',
    );
    const built = build({
      adapter,
      agentContainerSettingsPath: () => '/data/hive/container/claude-agent.settings.json',
    })('slack-watcher', 'manual');

    expect(built).toEqual({
      problem:
        'slack-watcher runs in a container, and codex agents cannot yet — run it on the host, or name claude-code first in harness:.',
    });
  });
});

describe('a copilot wake (HIVE-343)', () => {
  const COPILOT_MD = AGENT_MD.replace('limits:', 'harness: [copilot]\nlimits:');
  const HOME = '/home/u/.hive/cli/copilot';
  const WORKDIR = '/home/u/.hive/work/slack-watcher';
  const copilot = (over: Partial<WakeCommandDeps> = {}) =>
    build({
      adapter: (id) => (id === 'copilot' ? copilotAdapter : claudeCodeAdapter),
      env: () => ({ PATH: '/opt/bin', HOME: '/home/u', GH_TOKEN: 'gh-leak' }),
      isExecutable: (path) => path === '/opt/bin/copilot',
      cliToken: (id) => (id === 'copilot' ? 'gho_stored' : null),
      ...over,
    });

  beforeEach(() => {
    files['/home/u/.hive/agents/slack-watcher/AGENT.md'] = COPILOT_MD;
  });

  /*
    Copilot's argv names the id, but a wake that dies at auth has started nothing (HIVE-357), so
    the rotation stays parked for the close, as a codex start's does.
  */
  it('leaves a parked rotation for the close when copilot starts it (HIVE-357)', () => {
    stored['slack-watcher'] = {
      status: 'sleeping', runsSinceRotate: 0, runs: [], sessionUuid: 'old', harness: 'copilot',
      pendingSession: { uuid: 'b2e1-new', handoff: 'I watch #ops.' },
    };
    const built = copilot()('slack-watcher', 'schedule');

    if ('problem' in built) throw new Error(built.problem);

    // The argv names the id, and the id is the parked one.
    expect(built.namesConversation).toBe(true);
    expect(built.sessionUuid).toBe('b2e1-new');
    expect(built.startsRotation).toBe(true);
    expect(stored['slack-watcher']?.pendingSession).toEqual({ uuid: 'b2e1-new', handoff: 'I watch #ops.' });
  });

  it('resolves copilot on PATH, with its home and its token on the env only', () => {
    const built = copilot()('slack-watcher', 'manual');

    if ('problem' in built) throw new Error(built.problem);

    expect(built.file).toBe('/opt/bin/copilot');
    expect(built.harness).toBe('copilot');
    expect(built.env[COPILOT_TOKEN_ENV]).toBe('gho_stored');
    expect(built.env['COPILOT_HOME']).toBe(HOME);
    expect(built.env['GH_TOKEN']).toBeUndefined();
    expect(built.args.join(' ')).not.toContain('gho_stored');
    expect(built.usageFile).toBe(`${HOME}/usage/minted-uuid.json`);
  });

  it('writes the hooks and AGENTS.md, and makes the usage folder', () => {
    const built = copilot()('slack-watcher', 'manual');

    if ('problem' in built) throw new Error(built.problem);

    expect(written[`${HOME}/settings.json`]).toBe(copilotSettings());
    expect(written[`${WORKDIR}/AGENTS.md`]).toContain('Read the channel and report.');
    expect(made).toEqual(expect.arrayContaining([HOME, WORKDIR, `${HOME}/usage`]));
    expect(Object.values(written).join('\n')).not.toContain('gho_stored');
  });

  it('does not rewrite a file that already holds the same bytes', () => {
    files[`${HOME}/settings.json`] = copilotSettings();
    copilot()('slack-watcher', 'manual');

    expect(written).not.toHaveProperty(`${HOME}/settings.json`);
    expect(written).toHaveProperty(`${WORKDIR}/AGENTS.md`);
  });

  it('refuses with no stored token, and says where to add one', () => {
    expect(copilot({ cliToken: () => null })('slack-watcher', 'manual')).toEqual({
      problem:
        'No CLI can run slack-watcher: copilot cannot start: no Copilot token: add one in Settings › CLIs.',
    });
  });

  it("resolves under copilot's own fence, which enforces every rule (PR2)", () => {
    const built = copilot()('slack-watcher', 'manual');

    expect(built).not.toHaveProperty('problem');
    expect(built).toMatchObject({ harness: 'copilot' });
  });

  it('refuses a copilot agent that runs in a container', () => {
    files['/home/u/.hive/agents/slack-watcher/AGENT.md'] = COPILOT_MD.replace(
      'limits:',
      'container:\n  runtime: docker\n  name: devbox\n  workspace: /work\n  hive_dir: /hive\nlimits:',
    );
    const built = copilot({
      agentContainerSettingsPath: () => '/data/hive/container/claude-agent.settings.json',
    })('slack-watcher', 'manual');

    expect(built).toEqual({
      problem:
        'slack-watcher runs in a container, and copilot agents cannot yet — run it on the host, or name claude-code first in harness:.',
    });
  });

  it('says why when a file cannot be written', () => {
    const built = copilot({
      fs: {
        ...fs,
        write: (path, text) => {
          if (path.endsWith('settings.json')) throw new Error('EACCES');
          written[path] = text;
        },
      },
    })('slack-watcher', 'manual');

    expect(built).toEqual({ problem: 'Could not prepare the run: EACCES' });
  });

  it('refuses when the token is cleared between resolving and spawning', () => {
    let reads = 0;
    const built = copilot({ cliToken: () => (reads++ === 0 ? 'gho_stored' : null) })(
      'slack-watcher',
      'manual',
    );

    expect(built).toEqual({
      problem: 'No CLI can run slack-watcher: copilot cannot start: its token was just cleared.',
    });
  });

  it('names the same token variable as the adapter', () => {
    expect(CLI_TOKEN_ENV.copilot).toBe(COPILOT_TOKEN_ENV);
  });
});

