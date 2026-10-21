import type { HookNotificationType, ObservedStatus, StatusHookEvent } from '@shared/hook-contract';

/**
 * Claude Code's hook vocabulary (HIVE-236): the events it is subscribed to, what each means
 * for status, its notification types and its reply shape. Adapter-owned and fenced: the core
 * sees only `@shared/hook-contract`'s transport and event shapes.
 */

/**
 * The hook events the app subscribes to.
 *
 * Deliberately a small subset. Claude Code emits far more, and every extra event
 * is another POST per session per turn on a channel whose only job is to keep a
 * status dot honest.
 *
 * ## `SessionEnd`, and why it reports `done` rather than `terminated`
 *
 * It looks like the obvious source for "this session is over" and it is not.
 * Claude Code fires `SessionEnd` with a `reason` of
 * `clear | logout | prompt_input_exit | other`, and only some of those mean the
 * process ended — `/clear` fires it on a session that is alive and sitting at
 * its prompt.
 *
 * Subscribing it and mapping it to `terminated` regardless, which is what this
 * shipped as first, made `/clear` lock the user out of a working session:
 * `isTerminated` closes the tab to new visits and disables its input, and
 * because a hook event outranks the activity inference nothing could correct it.
 * The event was then dropped entirely, on the reasoning that reading `reason`
 * would still leave a hook asserting a process death it cannot observe.
 *
 * That reasoning weighed two options and both were wrong, because the third had
 * no target: `done` had no producer, so "map it to something that is *not* a
 * death" was not available. It is now. `reason: 'clear'` means the
 * **conversation** ended while the process kept running — a boundary a hook can
 * see and a pty cannot — and that is exactly `done`.
 *
 * Measured, not assumed (real claude 2.1.225, real pty, outside the app):
 *
 * ```
 * /clear -> SessionEnd   reason "clear"              pty alive
 *           SessionStart source "clear"              new session_id
 * /exit  -> SessionEnd   reason "prompt_input_exit"  pty exits, code 0
 * ```
 *
 * Every other reason is still ignored here, and `terminated` still comes from
 * the pty. So the division holds and gets sharper: hooks report what the agent
 * is *doing* and whether its conversation ended; the pty reports whether the
 * process is still *there*.
 */
export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PermissionRequest',
  'Elicitation',
  /**
   * The bookkeeping pair (HIVE-83).
   *
   * `PreToolUse` carries the `tool_use_id` that `PermissionRequest` does not,
   * and its `PostToolUse` carries the same one — which is the only way to tell
   * the blocked tool's completion from a sibling's in a parallel batch.
   *
   * The cost is honest: this is the second high-frequency hook subscribed, and
   * `PreToolUse` is a *blocking* hook — Claude waits for it before running the
   * tool. Both are loopback POSTs the receiver answers 204 to.
   */
  'PreToolUse',
  'PostToolUse',
  /**
   * How a stopped main agent is told apart from a finished session (HIVE-83).
   *
   * Both carry `agent_id`. Only agents seen starting are ever removed: Claude
   * Code emits `SubagentStop` for internal helper agents that never announced a
   * start.
   */
  'SubagentStart',
  'SubagentStop',
  'Notification',
  'Stop',
  'SessionEnd',
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

/** A `StatusHookEvent` the list lacks fails here; a list member the union lacks fails where readHook publishes it. */
const statusEventsListed: [Exclude<StatusHookEvent, HookEvent>] extends [never] ? true : never = true;
void statusEventsListed;

/**
 * `SessionStart` is subscribed and does not arrive. Measured, not assumed.
 *
 * Claude Code 2.1.227, real pty, both handlers on the same event:
 *
 * ```
 * SessionStart  command hook  -> ran
 * SessionStart  http hook     -> never reached the receiver
 * ```
 *
 * Every other subscribed event delivers over `http` normally, so this is
 * specific to `SessionStart` — plausibly a hook dispatched before the http
 * transport is up. It is left subscribed rather than removed: the entry costs
 * one key in a file the app writes once per launch, and a future release that
 * starts delivering it would mark a session {@link HOOK_STATUS}-driven from the
 * moment it opens, which is strictly better than the current floor.
 *
 * The consequence today is the thing worth knowing: a session is **not**
 * hook-driven until its first `UserPromptSubmit`, so until the user types,
 * status comes from `activity.ts`'s pty inference.
 */

/**
 * A hook's response puts text into the session's context. Measured, not
 * assumed (HIVE-136).
 *
 * Claude Code 2.1.263, real pty, a stub receiver answering
 * `{"hookSpecificOutput":{"hookEventName":…,"additionalContext":…}}` with a
 * distinct token per handler, and the model asked to echo every token it could
 * see. `tests/live/hook-context-conformance.test.ts` is the measurement and
 * pins each line below:
 *
 * ```
 * UserPromptSubmit  http 200 + body  -> in context, echoed
 * UserPromptSubmit  command stdout   -> in context, echoed
 * PreToolUse        http / command   -> in context, echoed
 * PostToolUse       http / command   -> in context, echoed
 * SessionStart      command stdout   -> in context, echoed
 * SessionStart      http             -> never reached the receiver (still)
 * ```
 *
 * An http response is honoured exactly as a command's stdout. The transcript
 * records it as a `hook_success` attachment with the HTTP status as `exitCode`
 * and the body as `stdout`, then a `hook_additional_context` attachment
 * carrying the text, which the model reads and acts on. So on those three
 * events the receiver can carry a ledger entry whole, labelled as context
 * rather than passing as the user's own words. The other subscribed events
 * were not measured and are not assumed; `SessionStart` keeps the finding
 * above.
 *
 * What that costs was measured in the same runs, one session each, and it is
 * why the ten-second `timeout` in `electron/main/harness/claude-code/settings.ts` loses its
 * rationale the moment a response carries context:
 *
 * ```
 * response at once              -> turn ends +7.5s after the prompt
 * response in 5s  (timeout 10)  -> context lands; turn ends +11.8s
 * response in 15s (timeout 5)   -> "UserPromptSubmit hook timed out after 5s —
 *                                  output discarded", on screen; turn ends +12.3s
 * HTTP 500, same body           -> "UserPromptSubmit hook error · HTTP 500 from
 *                                  <url>", on screen; body discarded; turn runs
 * nothing listening on the port -> "UserPromptSubmit hook error · connect
 *                                  ECONNREFUSED 127.0.0.1:<port>", on screen at
 *                                  once, not after the timeout; turn runs
 * 204, empty                    -> nothing drawn, as today
 * ```
 *
 * **The prompt waits behind the hook.** A slow receiver adds its whole latency
 * to every prompt round trip, and the timeout is what bounds it, at the price
 * of a line the user sees. A receiver that has gone away costs no wait, but
 * it is no longer silent either: the refused connection is drawn on every
 * prompt, which is not what the `timeout` docblock in `settings.ts` promises.
 * A non-2xx status is shown the same way, never swallowed, so a receiver with
 * nothing to say must say 204 with nothing in it, not an error.
 *
 * What HIVE-138 made of it. The nudge is a marker ({@link ledgerMarker} in
 * `ledger-contract.ts`), and the receiver answers that prompt with the entry
 * whole as {@link HookContextReply}. The hook route answers 204 and logs
 * where `reject()` computes a refusal, and where the body is not JSON; every
 * other route keeps its 4xx, since curl and MCP read those and hooks do not.
 * The one non-2xx left on the hook route is the dispatcher's 500 on a thrown
 * handler, accepted: a handler that throws is a bug, and a line on screen is
 * the honest signal. The timeout is 3 s, and its docblock in `settings.ts`
 * carries the measurements above as its reason.
 */

/**
 * What the receiver answers when a `UserPromptSubmit` prompt is a ledger
 * marker (HIVE-138): the shape Claude Code reads from a hook's body, measured
 * above. Typed once so the receiver and the tests that read it cannot drift.
 */
export interface HookContextReply {
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit';
    additionalContext: string;
  };
}

export const hookContextReply = (additionalContext: string): HookContextReply => ({
  hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext },
});

/**
 * The `SessionEnd` reason that means "the conversation ended, the process did
 * not". The only one this app acts on.
 */
export const CLEAR_REASON = 'clear';

/**
 * What each event means for the fleet view.
 *
 * `PermissionRequest` and `Elicitation` are the two ways Claude blocks on a
 * human — a tool needing approval, and an MCP server asking for input. They are
 * different mechanisms and the same fact about the session, so they map to the
 * same status rather than being distinguished for their own sake.
 *
 * `Stop` is `idle`, not `done`: the turn ended, which says nothing about whether
 * the work did. `/clear` is what says that, and it arrives as `SessionEnd` —
 * which is why this record is keyed on {@link StatusHookEvent} and cannot hold
 * an entry for it.
 */
export const HOOK_STATUS: Record<Exclude<HookEvent, 'SessionEnd'>, ObservedStatus> = {
  SessionStart: 'idle',
  UserPromptSubmit: 'working',
  PermissionRequest: 'waiting',
  Elicitation: 'waiting',
  /**
   * Not a status on its own — see {@link NOTIFICATION_TYPE_STATUS}.
   *
   * `Notification` is the only subscribed event whose meaning depends on a
   * second field, and the entry here is the *floor*: a type this build does not
   * recognise still means Claude raised something at the user, and `waiting` is
   * the honest reading of that. The receiver refuses to publish an unrecognised
   * type anyway, so this value is reached only if that guard is ever relaxed.
   *
   * This floor is unchanged by `NOTIFICATION_TYPE_STATUS` splitting `idle_prompt`
   * from `permission_prompt`: an unrecognised type has no per-type reading to
   * fall back to, so `waiting` — Claude raised *something*, unread — is still
   * the honest default for it.
   */
  Notification: 'waiting',
  /**
   * `PreToolUse` and `PostToolUse` are both `working` as a *fallback only*.
   *
   * Since HIVE-83 the status the renderer sees is derived by
   * `hooks/tracker.ts` from what the session is, not looked up here. These
   * entries survive so the record stays total and so a consumer that has no
   * tracker still gets a defensible answer.
   */
  PreToolUse: 'working',
  PostToolUse: 'working',
  /** Bookkeeping only — the tracker decides what a live subagent means. */
  SubagentStart: 'working',
  SubagentStop: 'working',
  Stop: 'idle',
};

/**
 * What Claude Code calls the thing it is interrupting the user about.
 *
 * Measured against 2.1.227 in a real pty, and the two observed values are the
 * two that matter:
 *
 * ```
 * turn ends            -> Stop
 * +60s, no input       -> Notification  idle_prompt        "Claude is waiting for your input"   (see below)
 * tool needs approval  -> PermissionRequest
 * +6s                  -> Notification  permission_prompt  "Claude needs your permission"
 * ```
 *
 * **`idle_prompt` is the event this whole subscription exists for.** It is the
 * only signal Claude emits for the most common way a session blocks on a human —
 * the turn ended and nobody typed — which `Stop` cannot express, because `Stop`
 * fires on every turn including the ones the user is sitting and watching. The
 * wait is Claude's own debounce, and it is exactly the difference between
 * "waiting" and "you walked away".
 *
 * **That wait is a default, not a constant, and nothing in this codebase may
 * assume it.** Claude Code reads `messageIdleNotifThresholdMs` from the user's
 * global config (`~/.claude.json`, default `60000`) when it arms the timer, so
 * the trace above is what a machine whose owner has never set it does. It is
 * not a `settings.json` key, so the app's own `--settings` file cannot pin it,
 * and there is no env var to override it: the machine's value is the value.
 * `tests/live/hook-conformance.test.ts` reads it for exactly that reason, and
 * every other comment about this wait points here rather than naming a number.
 */
export const NOTIFICATION_TYPES = ['idle_prompt', 'permission_prompt'] as const;

/** A `HookNotificationType` the list lacks fails here; a list member the union lacks fails where readHook publishes it. */
const notificationTypesListed: [
  Exclude<HookNotificationType, (typeof NOTIFICATION_TYPES)[number]>,
] extends [never]
  ? true
  : never = true;
void notificationTypesListed;

export const isHookNotificationType = (
  value: unknown,
): value is HookNotificationType =>
  typeof value === 'string' &&
  (NOTIFICATION_TYPES as readonly string[]).includes(value);

/**
 * What each recognised type means for the **status**, which is no longer the
 * same question as what it means for the **inbox**.
 *
 * `permission_prompt` is a session blocked on a human: a tool is waiting for a
 * yes and nothing proceeds until it gets one. `waiting` is the honest reading.
 *
 * `idle_prompt` is **not** that, and calling it `waiting` is what made the dot
 * lie. It fires once the idle wait elapses after `Stop`, when the turn is
 * already over and the agent is sitting at an empty prompt — nothing is blocked, and there is no
 * question outstanding. `Stop` set `idle` when the turn ended and `idle` is
 * what the session still is.
 *
 * The signal is not lost by this: it moves to where it belongs. The inbox row
 * is raised off the hook *event* in `notifications/index.ts`, independently of
 * the status, so "you walked away and your agent wants you" still reaches the
 * user — it just stops painting the fleet view amber for a session nobody is
 * waiting on.
 */
export const NOTIFICATION_TYPE_STATUS: Record<(typeof NOTIFICATION_TYPES)[number], ObservedStatus> = {
  idle_prompt: 'idle',
  permission_prompt: 'waiting',
};
