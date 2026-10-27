/**
 * The harness port's shared vocabulary (HIVE-232, phase 1).
 *
 * A harness is the CLI that drives an agent session. Data and types only: this
 * module follows `electron/shared`'s rule and drags nothing in.
 */

/** Every CLI the app can drive (HIVE-342 added codex, HIVE-343 copilot; both headless only). */
export const HARNESS_IDS = ['claude-code', 'codex', 'copilot'] as const;

/** Which CLI drives an agent session. */
export type HarnessId = (typeof HARNESS_IDS)[number];

/** A definition's `harness:` entry, or a recorded one, names a CLI this build knows (HIVE-340). */
export const isHarnessId = (value: string): value is HarnessId =>
  (HARNESS_IDS as readonly string[]).includes(value);

/**
 * What a harness can do ("build one, shape for three"). A field lands only with the
 * story whose core code reads it (HIVE-239 brought the first two, HIVE-240 the third).
 */
export interface Capabilities {
  /**
   * `by-id`: a stopped conversation reopens under the uuid it was pinned with, so the
   * spawn asks the history for one. `none`: every spawn starts a new conversation.
   */
  resume: 'by-id' | 'none';
  /** The harness posts a status line that the receiver's `/statusline` route reads into metrics. */
  meters: boolean;
  /**
   * How a ledger entry reaches the agent (HIVE-240). `prompt-marker`: a marker typed at an idle,
   * empty prompt, which the prompt hook answers with the entry as context (`contextReply`).
   * `none`: nothing is typed; the session reads the ledger through its tools.
   */
  contextDelivery: 'prompt-marker' | 'none';
  /**
   * What a headless run reports and enforces (HIVE-338). They feed which CLI an agent may run on
   * (HIVE-340): an agent with a USD limit needs `reportsCostUsd`, and a meter a CLI does not report
   * is absent, never `0`.
   */
  /** The run's end carries its cost in USD. */
  reportsCostUsd: boolean;
  /** The CLI stops a run at the definition's turn limit. */
  enforcesTurns: boolean;
  /** The CLI stops a run at the definition's USD budget. */
  enforcesBudget: boolean;
  /** The run's output says which MCP servers connected (the Slack chip, HIVE-123). */
  reportsMcpStatus: boolean;
  /**
   * The `mcp:` integrations a headless run on this CLI can be given (HIVE-340). An agent naming
   * one that is not here does not resolve to this CLI.
   */
  agentMcp: readonly string[];
}

/** Why a session is blocked on a human (HIVE-237): a tool wants a yes, the agent asked, or a server wants input. */
export type WaitingReason = 'permission' | 'question' | 'input';

/** What a harness raises after the fact (HIVE-237): the turn ended and nobody typed, or a block echoed. */
export type NoticeReason = 'idle' | 'permission';

/**
 * What a hook says the session is doing, in the core's words (HIVE-237).
 *
 * The adapter maps its harness's events into this; the status tracker, the inbox and `/done` read only this.
 * A closed union of exactly what the core distinguishes: a new member is a decision, not a pass-through.
 */
export type StatusSignal =
  | {
      kind:
        | 'session-start'
        | 'prompt'
        | 'tool-start'
        | 'tool-end'
        | 'subagent-start'
        | 'subagent-end'
        | 'turn-end';
    }
  | { kind: 'waiting'; reason: WaitingReason }
  | { kind: 'notice'; reason: NoticeReason };
