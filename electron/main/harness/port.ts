import type { RunUsage } from '@shared/agent-contract';
import type { ChangeMark } from '@shared/changed-files-contract';
import type { HeadlessSandbox } from '@shared/cli-contract';
import type { ContainerFreshness, ResolvedContainer } from '@shared/config-contract';
import type { Capabilities, HarnessId } from '@shared/harness-contract';
import type { HookAgentEvent, HookIdentity, HookStatusEvent } from '@shared/hook-contract';
import type { LedgerEntry } from '@shared/ledger-contract';
import type { SessionMetrics } from '@shared/metrics-contract';
import type { PlanUpdate } from '@shared/plan-contract';
import type { SessionEffort, SessionModel } from '@shared/session-contract';

import type { ContainerOrigins } from '../container/layout';
import type { PathMap } from '../container/path-map';
import type { McpServerSpec } from '../mcp/agent-config';
import type { McpConfigOptions } from '../mcp/config';
import type { SkillsRead } from '../skills/read';

/**
 * The port every harness adapter implements (HIVE-233).
 *
 * Methods arrive with the stories that move code behind them: `launch`
 * (HIVE-234, landed), `prepare` (HIVE-235, landed), `readHook` (HIVE-236, landed;
 * HIVE-237 normalised its signals, HIVE-238 its plan ops), `foldEdits` (HIVE-238),
 * `record` and `meters` (HIVE-239, landed),
 * `promptMarker` (HIVE-240, landed), `installed` (HIVE-345), `headless` (HIVE-337). See
 * `docs/harness-architecture.md`.
 */
export interface HarnessAdapter {
  readonly id: HarnessId;
  readonly capabilities: Capabilities;
  /** The command line, stripped env and submit delay a session starts with (HIVE-234). */
  launch(spec: LaunchSpec): LaunchPlan;
  /** What a session needs written before it starts (HIVE-235). */
  readonly prepare: HarnessFiles;
  /** A hook body read into effects, in the order the receiver acts on them (HIVE-236). */
  readHook(input: HookInput): HookReading;
  /** The response body that hands `text` to the model as context, for a prompt hook (HIVE-138). */
  contextReply(text: string): unknown;
  /** What to type into a `prompt-marker` session to hand it `entry`; `contextReply` answers it (HIVE-240). */
  promptMarker(entry: LedgerEntry): string;
  /** Transcript lines folded into per-file edit tallies, for the changed-files list (HIVE-201, HIVE-238). */
  foldEdits(tallies: Map<string, FileTally>, lines: readonly string[]): Map<string, FileTally>;
  /** A status-line body read into metrics; `null` for one that is not an object, which the receiver answers 400 (HIVE-239). */
  meters(body: string): SessionMetrics | null;
  /** Where the harness keeps a conversation, and what it says about it (HIVE-239). */
  readonly record: HarnessRecord;
  /** What the user installed for the harness themselves, which HiveTTY reads and never manages (HIVE-345). */
  readonly installed: HarnessInstalled;
  /** Agent runs (HIVE-337). */
  readonly headless: HeadlessHarness;
}

/** What wrote a title, as far as the harness's own record can say (HIVE-239). */
export type TitleVerdict =
  /** A `custom-title` record carries exactly this name — the user renamed. */
  | 'rename'
  /** An `ai-title` record carries exactly this name — Claude guessed. */
  | 'agent'
  /** No record for this name yet: not written, not readable, not there. */
  | 'unknown';

/** Where a harness keeps a conversation, and what it says about it (HIVE-239). */
export interface HarnessRecord {
  /** The conversation's transcript on disk, or `null` when there is none yet. */
  transcriptPath(cwd: string, sessionUuid: string): string | null;
  /** Whether there is a conversation behind the uuid for `--resume` to open. */
  hasTranscript(cwd: string, sessionUuid: string): boolean;
  /** Whether `name` was a rename or the harness's own guess; never throws, `unknown` on any doubt. */
  titleOrigin(cwd: string, sessionUuid: string, name: string): TitleVerdict;
  /** A raw terminal title as a session name: activity marks stripped, `''` for the harness's "unnamed". */
  nameFromTitle(title: string): string;
}

/** What the user installed for a harness themselves: its skills and plugins (HIVE-345). */
export interface HarnessInstalled {
  /** Skill names the harness loads beyond HiveTTY's own: the user's skills, and `plugin:skill` per installed plugin. Unsorted. */
  skillNames(): Promise<string[]>;
  /** Installed plugin names a session switch can act on, sorted; `[]` with no registry. */
  pluginNames(): Promise<string[]>;
  /** `enabledPlugins` overrides that keep the `disabled` plugins out of a session; `{}` with no registry. */
  sessionOverrides(disabled: readonly string[]): Promise<Record<string, false>>;
}

/** One file's edits in a session, as the changed-files list counts them (HIVE-201). */
export interface FileTally {
  mark: ChangeMark;
  added: number;
  removed: number;
}

/**
 * How a status hook reaches the receiver.
 *
 * `http` on the host. `command` for a set that runs inside a container
 * (HIVE-137), where the binary refuses an http hook to `host.docker.internal`
 * — see `statusCommand` in `claude-code/hook-vocabulary.ts` for the measurement.
 * The core picks it from the bound host (HIVE-134).
 */
export type HookTransport = 'http' | 'command';

/** The paths `prepareSession` hands `spawn`, for `LaunchSpec` (HIVE-235). Absent means no flag. */
export interface PreparedFiles {
  settingsPath?: string;
  pluginDir?: string;
  mcpConfig?: string;
}

/** One container set's harness files, written into a directory the caller already made (HIVE-235). */
export interface ContainerSetInput {
  origins: ContainerOrigins;
  freshness: ContainerFreshness;
  /** `0600` when `identity` bakes a token, `0644` otherwise; the caller decides. */
  mode: number;
  identity?: HookIdentity;
  /** Where the set is visible inside the container, when that differs from `root`. */
  containerRoot?: string;
  /** The run a `rewrite` set belongs to, when it is an agent's. */
  run?: string;
}

/**
 * The files a harness needs on disk before it starts (HIVE-235), by purpose. The core's runtimes
 * call these at the moments they always have; they own when, the adapter owns what.
 */
export interface HarnessFiles {
  /** The interactive session's settings file. Answers its path. */
  sessionSettings(
    userDataPath: string,
    url: string,
    metricsUrl?: string,
    readyUrl?: string,
    transport?: HookTransport,
    enabledPlugins?: Record<string, boolean>,
  ): Promise<string>;
  /** The headless agent's settings file. Answers its path. */
  agentSettings(
    userDataPath: string,
    url: string,
    readyUrl?: string,
    transport?: HookTransport,
  ): Promise<string>;
  /** The skills source rendered into the harness's plugin directory, `/done` included. */
  plugin(pluginRoot: string, version: string, read: SkillsRead, doneUrl?: string | null): Promise<void>;
  /** One container set's harness files. */
  containerSet(root: string, input: ContainerSetInput): Promise<void>;
  /** The session `--mcp-config` file. */
  mcpConfig(path: string, options: McpConfigOptions): Promise<void>;
}

/**
 * What a container project's session needs beyond the host shape (HIVE-133).
 *
 * `docker exec` carries nothing across the boundary it crosses, so a spawn
 * needs both halves of the fix: {@link PathMap} to rewrite the three flag
 * paths, and `env` — already fully assembled, `HIVE_*` written last — to
 * expand at `claudeCommand`'s `{env}` placeholder.
 *
 * `config` is {@link ResolvedContainer}, not the raw `ContainerConfig` a file
 * or the IPC guard produces: `envArg` is read here unconditionally, and only
 * the resolved shape guarantees it is a `string` rather than `string | undefined`.
 * `effectiveRuntime` is the one place that turns one into the other.
 */
export interface ContainerSpawn {
  config: ResolvedContainer;
  map: PathMap;
  /** Everything that must reach the container, HIVE_* written last. */
  env: Record<string, string>;
}

/**
 * What the session was started *as* (story 109), and what the core knows
 * about it before any harness reads it (HIVE-234).
 *
 * Both optional, and omitting one omits its flag rather than substituting a
 * default. A spawn that names neither produces exactly the command line this
 * module has always produced, which is what keeps a fixture opened for the
 * first time — or a `spawn` typed into the console — running under whatever the
 * user's own `claude` configuration says.
 */
export interface LaunchSpec {
  /**
   * The configured binary the core read from `claudeCommand` (story 090),
   * `{env}` placeholder and all.
   */
  command: string;
  /**
   * Whether to unset the API credentials before invoking `claude` (HIVE-79).
   *
   * Defaults to `false` here rather than to the config's own default, so a
   * caller that does not know about authentication cannot silently opt a
   * session into a billing change. `sessions/index.ts` is the one caller that
   * reads the config and passes it.
   */
  subscriptionAuth?: boolean;
  model?: SessionModel;
  effort?: SessionEffort;
  /**
   * What to call the session inside Claude (HIVE-61).
   *
   * HiveTTY's own entity id, so the agent's prompt box, its `/resume` picker
   * entry and its terminal title all say `sess-07` rather than an auto-title
   * derived from whatever the first message happened to be.
   *
   * Filtered by `isSendableSessionName` rather than trusted: unlike
   * `--model` and `--effort` this has no closed list behind it, so the
   * no-quoting rule below does not cover it on its own. A name that fails the
   * pattern omits the flag — the session starts unnamed, which is what it did
   * before this story, rather than starting with a mangled command line.
   */
  name?: string;
  /**
   * The conversation's session id, pinned rather than left to Claude.
   *
   * Pinning it makes the transcript path deterministic
   * (`~/.claude/projects/<escaped-cwd>/<uuid>.jsonl`), which is what later work
   * needs to resume a session, read its cost, or read the `custom-title` and
   * `ai-title` records back. Cheap to add now and impossible to add
   * retroactively for a session that has already started.
   */
  sessionUuid?: string;
  /**
   * Continue the conversation {@link LaunchSpec.sessionUuid} names rather
   * than start one under it (HIVE-88).
   *
   * `--resume <uuid>` where `--session-id <uuid>` would have gone: the same
   * identifier, the opposite claim about it. Ignored without a uuid — there is
   * nothing to resume — so a caller that asked to resume a record written
   * before uuids were recorded gets the plain spawn it would have got anyway.
   */
  resume?: boolean;
  /**
   * A settings file to merge on top of the user's own (HIVE-62).
   *
   * Carries the hook configuration that reports session status back to the app.
   * `--settings` *merges*, so the user's own hooks, permissions and preferences
   * are untouched; the app never writes to `~/.claude/settings.json`.
   *
   * A path rather than the inline JSON `--settings` also accepts: inline JSON
   * on a shell-parsed command line is braces, quotes and colons in exactly the
   * position the no-quoting rule below does not cover.
   *
   * The path is **quoted** by `shellQuote`, and that is not belt and
   * braces. It is `app.getPath('userData')`, which on macOS contains a space —
   * so the unquoted version split into two arguments on every Mac.
   */
  settingsPath?: string;
  /**
   * A generated plugin directory whose skills this session may use (HIVE-96).
   *
   * The app-only half of custom skills, and the reason it is a **flag** rather
   * than a key in the settings file above: `--plugin-dir` loads for this
   * process alone and writes nothing to `~/.claude`, so a `claude` the user
   * starts in Terminal.app has none of these commands. Checked against the
   * binary rather than assumed — `--settings` cannot carry skills at all, and
   * `--add-dir` only finds a `.claude/` *inside* the directory it adds.
   *
   * Omitted when main has no directory to offer, which is what a failed
   * generation looks like: a session with no custom skills starts and works.
   *
   * `shellQuote`d for exactly the reason `settingsPath` is — it lives
   * under `app.getPath('userData')`, which contains a space on every Mac.
   */
  pluginDir?: string;
  /**
   * The generated `--mcp-config`, giving this session the ledger tools
   * (HIVE-112).
   *
   * A **separate flag from `--plugin-dir`**, and that is the whole design: a
   * server delivered inside the plugin is named `mcp__plugin_hive_hive__*`,
   * while one delivered here is `mcp__hive__*` — the name HIVE-115's agent
   * preamble and HIVE-119's `--permission-prompt-tool` both use. Two names for
   * one tool set would mean the preamble had to branch on who was reading it.
   *
   * Deliberately **without** `--strict-mcp-config`: verified against the CLI,
   * this flag merges rather than replaces, so a session inside the Hive keeps
   * whatever MCP servers the user configured for themselves. Adding `--strict`
   * here would silently take them away.
   *
   * `shellQuote`d for the reason `pluginDir` is — it lives under
   * `app.getPath('userData')`, which contains a space on every Mac.
   */
  mcpConfig?: string;
  /**
   * The session's opening instruction, as `claude`'s initial prompt.
   *
   * An **argument**, not a second thing typed into the shell afterwards, and
   * that distinction is the whole of HIVE-91. See `sessionCommand` for
   * what the two-stage version did when `claude` failed to start.
   *
   * Untrusted free text — it comes from the console's `spawn <project> <task…>` and
   * from the picker's message box — so unlike every other value here it is
   * `shellQuote`d rather than covered by a closed-list guard. It is the
   * second argument on this command line to need that, for the same reason
   * `settingsPath` does and a much more obvious one.
   */
  task?: string;
  /**
   * The project runs inside a container (HIVE-133).
   *
   * Two things happen when this is present, and both are about a boundary
   * `docker exec` does not carry anything across:
   *
   * - **Environment moves onto the command line.** `docker exec` does not
   *   inherit the pty's environment, so `envFor`'s three variables — which
   *   reach a host session through the spawn env — would never arrive. They are
   *   expanded through `config.envArg` and substituted at `{env}`.
   * - **Paths are rewritten.** `--settings`, `--plugin-dir` and `--mcp-config`
   *   all name host paths under `<userData>/hive`, which mean nothing inside
   *   the container.
   */
  container?: ContainerSpawn;
}

/** What a harness answers a {@link LaunchSpec} with (HIVE-234). */
export interface LaunchPlan {
  /** What `bootstrap.arm` types into the session's shell. */
  command: string;
  /** What `startProcess` removes from the pty's environment. */
  stripEnv: readonly string[];
  /** The bootstrap's gap between the text and its `\r` (HIVE-63). */
  submitDelayMs: number;
}

/** Agent runs: no tty, one turn per process (HIVE-337). */
export interface HeadlessHarness {
  launch(spec: HeadlessSpec): HeadlessPlan;
  /** A fresh reader for one run's stdout (HIVE-338); `usageFile` is the plan's (HIVE-343). */
  reader(usageFile?: string): RunEventReader;
  /** The permission fence (HIVE-339). */
  fence: PermissionFence;
}

/**
 * Can this CLI enforce these rules (HIVE-339)? `permission-rules.ts` stays their only parser;
 * an adapter answers whether its own mechanism can route every call they do not allow to
 * `decide`. A rule it cannot express blocks the CLI for the run: never dropped, never widened.
 */
export interface PermissionFence {
  express(rules: readonly string[]): { ok: true } | { ok: false; unexpressible: string[] };
  /** A hook-based fence's calls in Claude's vocabulary, so `decide` stays the only matcher (HIVE-342). */
  translate?(tool: string, input: Record<string, unknown>, cwd: string): FenceCall[];
  /** The CLI's PreToolUse body as one call (HIVE-343). Absent: Claude's shape (`tool_name`, `tool_input`). */
  read?(body: Record<string, unknown>): { tool: string; input: Record<string, unknown>; cwd: string } | null;
  /** The CLI's answer (HIVE-343). Absent: Claude's `hookSpecificOutput` shape. */
  reply?(reason?: string): Record<string, unknown>;
}

/** One call as `decide` reads it. */
export interface FenceCall {
  tool: string;
  input: Record<string, unknown>;
}

export type { HeadlessSandbox } from '@shared/cli-contract';

/** What the core knows about one headless wake, harness-neutral (HIVE-337). */
export interface HeadlessSpec {
  /** Start a fresh conversation with this id, or resume this one. */
  conversation: { start: string } | { resume: string };
  name: string;
  /** Each CLI's own vocabulary (HIVE-342): the core passes what the definition or the card named. */
  model?: string;
  effort?: string;
  limits: { turns: number; budgetUsd?: number };
  /** Already in the container's spelling for a container run. */
  files: { settings: string; pluginDir: string; mcpConfig: string; systemPrompt: string };
  /** Raw, unnarrowed: the standing Hive grants plus the definition's tools. */
  grants: readonly string[];
  /** The core's `wakePrompt()` output: what the agent is told. */
  prompt: string;
  subscriptionAuth: boolean;
  /** The system prompt's text, for a CLI that takes it inline. `files.systemPrompt` is the same text on disk. */
  instructions: string;
  sandbox?: HeadlessSandbox;
  /** The hive MCP server, for a CLI that takes it inline (`mcp.hiveServerSpec()`). */
  hiveServer: McpServerSpec;
  /** The CLI's app-owned home (`~/.hivetty/cli/<id>`, HIVE-343). Claude and Codex ignore it. */
  stateDir: string;
  /** The run's cwd, for a CLI that reads its instructions from there (HIVE-343). */
  workdir: string;
  /** The card's deny patterns, in the CLI's own spelling (HIVE-343, copilot only). */
  deny?: readonly string[];
}

/** What a harness answers a {@link HeadlessSpec} with (HIVE-337). */
export interface HeadlessPlan {
  args: readonly string[];
  /** Env the harness adds, written after everything but the container's hook identity. */
  addEnv: Record<string, string>;
  /** Env the harness removes from a host run's environment. A container's is built from scratch. */
  stripEnv: readonly string[];
  /** Prefixes the harness removes, for a family whose next member it cannot name yet (HIVE-357). */
  stripPrefixes?: readonly string[];
  /** The binary inside a container whose block names none. */
  defaultContainerCommand: string;
  /** What `pkill -f` matches inside a container to stop this run. */
  stopPattern: string;
  /**
   * Whether the argv names the conversation (HIVE-342). Claude always does; a first Codex wake
   * learns its id only from `thread.started`, so the argv's uuid must never be persisted for it.
   */
  namesConversation: boolean;
  /** A file the CLI writes its usage to, read by the reader's `finish` (HIVE-343). */
  usageFile?: string;
  /** Absolute paths the core writes before the spawn, only when the bytes differ (HIVE-343). */
  files?: readonly { path: string; text: string }[];
}

/** One MCP server a headless run started with, and what the CLI said about it (HIVE-123). */
export interface McpServerStatus {
  name: string;
  status: string;
}

/**
 * How a headless turn stopped, in the core's words (HIVE-338). `error` is any stop the CLI
 * called a failure; the exit code still decides whether the run failed.
 */
export type RunStop = 'done' | 'turns' | 'budget' | 'error';

/** A headless turn's end (HIVE-338). `detail` is the CLI's own word for it, shown on the run line. */
export interface RunEnd {
  kind: 'end';
  stop: RunStop;
  detail: string;
  costUsd?: number;
  turns?: number;
  usage?: RunUsage;
}

/** What a headless run's output says, whatever CLI wrote it (HIVE-338). */
export type RunEvent =
  /** The conversation this run is part of; a later one replaces an earlier one. */
  | { kind: 'conversation'; id: string }
  | { kind: 'mcp'; servers: McpServerStatus[] }
  /** The agent speaking. Trimmed, never empty. */
  | { kind: 'say'; text: string }
  /** `args`: what a reader recognises the call by, uncut. `ask`: the ledger ask tool. */
  | { kind: 'tool'; name: string; args: string; ask?: true }
  | RunEnd;

/**
 * One run's stdout read into events (HIVE-338). Chunk-safe: a pipe splits wherever it likes, so
 * the reader carries an unterminated tail between pushes. Never throws: it runs inside a stdout
 * handler, and a throw would take the rest of the run's log with it.
 */
export interface RunEventReader {
  push(chunk: string): RunEvent[];
  /** The carried tail, read as a final line, at close. */
  flush(): RunEvent[];
  /**
   * After the exit flush, before the run is finalized (HIVE-343): what only the exit can tell.
   * `stderr` is the run's last 4 KiB of stderr. Never rejects.
   */
  finish?(exit: number | null, stderr: string): Promise<RunEvent[]>;
}

/** Which side of the receiver a hook arrived on: an entity session, or an agent's headless run (HIVE-236). */
export type HookLane = 'session' | 'agent';

/** One thing a hook body says, in the order the receiver acts on it (HIVE-236). */
export type HookEffect =
  | { kind: 'status'; event: HookStatusEvent }
  | { kind: 'agent'; event: HookAgentEvent }
  | { kind: 'cleared' }
  | { kind: 'plan'; update: PlanUpdate }
  | { kind: 'file-edit' }
  | { kind: 'prompt'; text?: string; conversation?: string };

/** A body that did not parse is `malformed`; empty `effects` means answer 204 and publish nothing. */
export interface HookReading {
  malformed?: true;
  effects: HookEffect[];
  /** Running background-task kinds with no reading; the receiver warns once per kind. */
  unknownTaskTypes?: string[];
}

/** What a hook body is read from (HIVE-236): its lane, the entity it names, and whether it was cut at the cap. */
export interface HookInput {
  lane: HookLane;
  entityId: string;
  body: string;
  truncated: boolean;
}
