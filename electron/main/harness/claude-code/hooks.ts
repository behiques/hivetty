import {
  HOOK_EVENTS,
  HOOK_STATUS,
  type HookEvent,
} from '@shared/hook-contract';

import type { HookInput, HookReading } from '../port';

/** Whether a string is one of the events the app subscribes to. */
const isHookEvent = (value: unknown): value is HookEvent =>
  typeof value === 'string' && (HOOK_EVENTS as readonly string[]).includes(value);

/**
 * Whether a payload's `background_tasks` lists work that keeps a headless
 * `claude -p` alive past its turn: a running workflow or subagent, anything
 * but a shell. Measured against 2.1.286, `-p` waits for a background workflow
 * or subagent and takes another turn when it lands, but exits at once with only
 * a shell still running. `undefined` when the key is absent, as for
 * {@link liveBackgroundShellIds}.
 */
function holdsTheProcess(value: unknown): boolean | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as { status?: unknown }).status === 'running' &&
      (entry as { type?: unknown }).type !== 'shell',
  );
}

/**
 * Pull the event name out of a body too large to have been kept whole.
 *
 * `JSON.parse` cannot help on a truncated prefix, and the field is a fixed,
 * unambiguous shape near the front of every payload, so a direct match is
 * both sufficient and honest about what it is doing.
 */
const EVENT_IN_PREFIX = /"hook_event_name"\s*:\s*"([A-Za-z]+)"/;

/**
 * And once more for `session_id`, which correlates an agent's `Stop` with the
 * run it belongs to (HIVE-115).
 *
 * A uuid is the narrowest vocabulary of any of these, so the shape is the
 * strictest: hex and hyphens only, which no truncated tail can half-satisfy.
 * It survives truncation on every payload measured — `session_id` is the
 * first key Claude Code writes — but the regex is here rather than assumed,
 * because dropping the uuid silently is exactly the failure this correlation
 * exists to prevent: a `Stop` with no uuid arms a watchdog against whatever
 * is live under that name, which after a fast turnaround is the *next* run.
 */
const SESSION_ID_IN_PREFIX = /"session_id"\s*:\s*"([0-9a-fA-F-]+)"/;

/** Claude Code's hook body read into effects (HIVE-236). Pure: no callbacks, no state. */
export function readHook({ lane, entityId, body, truncated }: HookInput): HookReading {
  return lane === 'agent' ? readAgent(entityId, body, truncated) : { effects: [] };
}

/**
 * A hook from an **agent's** headless turn (HIVE-115).
 *
 * Its own reader rather than a flag inside the session one, and that is the
 * whole of the story: the only callback reachable from here is
 * `onAgentEvent`. An agent therefore cannot produce a `session:status` push,
 * a session history record, a ticket rename or a `/clear` — not because
 * something downstream remembers to skip it, but because the code that would
 * do any of those is on a path this function never joins.
 *
 * It reads two fields where `handle` reads nine, which is honest rather than
 * lazy. Measured against `claude` 2.1.251, a `-p` run fires `SessionStart`,
 * `PreToolUse`, `PostToolUse`, `Stop` and `SubagentStop` — `Notification` and
 * `PermissionRequest` do not fire headless — and the only one the app acts on
 * today is `Stop`. The rest are accepted so the run does not print a hook
 * failure into its own log, and are carried no further until HIVE-116 has
 * somewhere to draw them. When it does, this is the one place that has to
 * learn a field, and it can learn it without touching the session path.
 */
function readAgent(entityId: string, body: string, truncated: boolean): HookReading {
  let event: unknown;
  let sessionUuid: unknown;
  let backgroundWork: boolean | undefined;

  if (truncated) {
    // The prefix is all there is; see EVENT_IN_PREFIX and SESSION_ID_IN_PREFIX.
    event = EVENT_IN_PREFIX.exec(body)?.[1];
    sessionUuid = SESSION_ID_IN_PREFIX.exec(body)?.[1];
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { malformed: true, effects: [] };
    }
    const fields =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as {
            hook_event_name?: unknown;
            session_id?: unknown;
            background_tasks?: unknown;
          })
        : undefined;
    event = fields?.hook_event_name;
    sessionUuid = fields?.session_id;
    backgroundWork = holdsTheProcess(fields?.background_tasks);
  }

  // An event outside the subscribed set is a success, not an error — the
  // same reading the session path takes, and for the same reason.
  if (!isHookEvent(event)) return { effects: [] };

  /*
    `SessionEnd` leaves here with no callback at all. It is a lifecycle event
    about a conversation, and a run's lifecycle is the *process* — which
    `runs.ts` watches on 'close' and 'exit', where the exit code is. There is
    nothing this could add that is not already known more accurately a moment
    later, and `HOOK_STATUS` has no entry for it by construction.
  */
  if (event === 'SessionEnd') return { effects: [] };

  return {
    effects: [
      {
        kind: 'agent',
        event: {
          entityId,
          event,
          status: HOOK_STATUS[event],
          // Absent rather than empty when the payload did not carry one, the same
          // discipline every optional field on the session event follows.
          ...(typeof sessionUuid === 'string' && sessionUuid !== '' ? { sessionUuid } : {}),
          ...(backgroundWork === undefined ? {} : { backgroundWork }),
        },
      },
    ],
  };
}
