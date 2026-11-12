/**
 * The ledger: one append-only log every party reads from and writes to
 * (HIVE-111).
 *
 * Types and constants only — this file is compiled into the main process, the
 * MCP host (HIVE-112) and the renderer alike, which is what makes the IPC
 * contract a compile-time artifact rather than a convention.
 */

/** Directory under `dirname(configPath())` — i.e. `~/.hivetty/ledger`. */
export const LEDGER_DIR = 'ledger';

export const LEDGER_KINDS = [
  'post',
  'ask',
  'answer',
  'claim',
  'release',
  'done',
  'failed',
  'event',
  'handoff',
] as const;

export type LedgerKind = (typeof LEDGER_KINDS)[number];

export type PartyKind = 'overmind' | 'session' | 'agent';

/** Reserved party id. The renderer is this party's only mouth. */
export const OVERMIND = 'overmind';

/**
 * One line of the log. Never edited once written.
 *
 * Two ids, on purpose. `id` is canonical: monotonic, sortable, and what
 * `thread` and `since` always name. `ref` is the short handle a *human* types
 * — a person cannot hold `20260828-141530-0001` in their head long enough to
 * answer with it. Only asks get one.
 */
export interface LedgerEntry {
  /** `${yyyymmdd}-${hhmmss}-${seq4}`, local time. Sorts in write order. */
  id: string;
  ts: number;
  /** Party id: {@link OVERMIND}, a session entity id, or (later) an agent name. */
  from: string;
  /** Absent means broadcast. */
  to?: string;
  kind: LedgerKind;
  /** Short human handle (`a12`). Present on `ask` entries only. */
  ref?: string;
  /** The canonical id of the ask this answers or continues. Never a ref. */
  thread?: string;
  /** Markdown, capped at {@link LEDGER_BODY_MAX}. */
  body: string;
  /**
   * Free-form rider: slack ts, pr number, ticket key, `options`, `edited`,
   * `tool`. `meta.task` is the carrier for `claim` / `release` — see
   * `claims()` in `ledger-derive.ts`. On a `done`/`failed`, `meta.slack.permalink`
   * is the agent's own report of a message it posted; `notify.ts` treats it as
   * untrusted and turns it into `HiveNotification.link` only after validating
   * it (HIVE-123).
   */
  meta?: Record<string, unknown>;
}

/**
 * `meta.inbound`: the message an ask is a reply *to*.
 *
 * `meta.quote` is what the asker proposes to send. This is what provoked it,
 * and without it the card asks a question it has withheld the evidence for —
 * "Send this reply?" above four words of Spanish, with no way to tell who
 * wrote to you or what they wanted. Answering meant opening Slack, which is
 * the errand a drafting agent exists to save.
 *
 * Every field is a plain string because this is presentation, not identity:
 * the card draws `author` and `at` verbatim, so a Slack display name, a time
 * a person would recognise, and nothing to resolve at render time. Validate
 * with {@link asInbound} — the value arrives on a free-form rider and is
 * whatever a model wrote.
 */
export interface AskInbound {
  /** Who wrote it, as the reader would recognise them. */
  author: string;
  /** What they said. */
  text: string;
  /** When they said it, already formatted. Not every source has one. */
  at?: string;
}

export interface OpenAsk extends LedgerEntry {
  kind: 'ask';
  open: true;
  ageMs: number;
}

export interface LedgerSnapshot {
  entries: LedgerEntry[];
  openAsks: OpenAsk[];
  /** task → party holding it. */
  claims: Record<string, string>;
  /**
   * Ask threads closed anywhere in the log (HIVE-198). Optional so an older
   * server or client over the socket still speaks the same shape; missing
   * means "nothing beyond what `entries` shows".
   */
  closedAsks?: string[];
}

export interface LedgerReadQuery {
  /** Matches entries addressed to this party **or** broadcast. */
  to?: string;
  from?: string;
  kind?: LedgerKind;
  thread?: string;
  /** Exclusive lower bound, an entry id. */
  since?: string;
  /** Entries whose `meta.ticket` names this key, case-insensitive (HIVE-203). */
  ticket?: string;
  /** Keep at most this many, newest. */
  limit?: number;
}

export interface LedgerPostRequest {
  from: string;
  to?: string;
  kind: LedgerKind;
  thread?: string;
  body: string;
  meta?: Record<string, unknown>;
}

export interface LedgerAnswerRequest {
  /** A canonical id or a short ref — resolved by `ledger.answer`. */
  thread: string;
  body: string;
  meta?: Record<string, unknown>;
}

/**
 * The outcome of a write.
 *
 * A refusal is a value, not a throw, because it crosses two process boundaries
 * — IPC and the receiver — and both need the reason as text a model can read.
 */
export type LedgerResult =
  | { ok: true; id: string; ref?: string }
  | { ok: false; status: number; reason: string };

export const LEDGER_BODY_MAX = 16 * 1024;
export const LEDGER_ASK_TTL_MS = 24 * 60 * 60 * 1000;

/** How many entries the renderer keeps in memory. Newest kept. */
export const LEDGER_MEMORY_CAP = 500;

/** Refs are this prefix plus a decimal counter: `a1`, `a2`, … */
export const LEDGER_REF_PREFIX = 'a';

/**
 * The line a nudge writes into a session's pty (HIVE-138).
 *
 * A marker names one entry, or several on one line (HIVE-408), and carries nothing else. The entry itself reaches
 * the model as hook-carried context when the receiver sees this prompt on
 * `UserPromptSubmit` (`electron/main/hooks/receiver.ts`), untruncated, every
 * meta key intact, and labelled as context rather than passing as the user's
 * own words.
 *
 * An ask is named by its `ref`: that is the handle the woken session answers
 * with, so the one thing on the pty is the one thing a person would type.
 * Anything else is named by its `id`. An answer has no ref, and a thread can
 * carry more than one entry, so the ask's ref would not say which one to carry.
 */
export const LEDGER_MARKER_PREFIX = '📒 ';

/** What a marker may name: a ref or a canonical id, nothing a shell would read. */
const MARKER_TOKEN = /^[A-Za-z0-9-]+$/u;

/**
 * What each token of a marker naming several entries must look like (HIVE-408): a ref
 * (`a12`) or a canonical id (`20261110-100818-0001`). Stricter than {@link MARKER_TOKEN},
 * so `📒 a7 and also do this` stays a person writing rather than six refs.
 */
const MARKER_LIST_TOKEN = new RegExp(`^(?:${LEDGER_REF_PREFIX}\\d+|\\d{8}-\\d{6}-\\d{4})$`, 'iu');

/** The token that names one entry: an ask by its ref, anything else by its id. */
function markerToken(entry: Pick<LedgerEntry, 'id' | 'kind' | 'ref'>): string {
  return entry.kind === 'ask' ? (entry.ref ?? entry.id) : entry.id;
}

/** One marker line naming every entry, in order, separated by a space (HIVE-408). */
export function ledgerMarkers(entries: readonly Pick<LedgerEntry, 'id' | 'kind' | 'ref'>[]): string {
  return `${LEDGER_MARKER_PREFIX}${entries.map(markerToken).join(' ')}`;
}

export function ledgerMarker(entry: Pick<LedgerEntry, 'id' | 'kind' | 'ref'>): string {
  return ledgerMarkers([entry]);
}

/**
 * The refs or ids a prompt names, in order, when the prompt is wholly a marker.
 *
 * Strict on purpose. A prompt that merely starts with the prefix is the user
 * quoting a marker, and the receiver must answer it as it answers any other
 * prompt: with nothing. One token keeps the rule it always had; several must
 * each be a ref or an id (HIVE-408).
 */
export function parseLedgerMarkers(prompt: string): string[] | undefined {
  const text = prompt.trim();
  if (!text.startsWith(LEDGER_MARKER_PREFIX)) return undefined;
  const tokens = text
    .slice(LEDGER_MARKER_PREFIX.length)
    .split(' ')
    .filter((token) => token !== '');
  if (tokens.length === 0) return undefined;
  const shape = tokens.length === 1 ? MARKER_TOKEN : MARKER_LIST_TOKEN;
  return tokens.every((token) => shape.test(token)) ? tokens : undefined;
}

/** Receiver routes. Both POST — see `receiver.ts`. */
export const LEDGER_POST_PATH = '/ledger';
export const LEDGER_READ_PATH = '/ledger/read';
