import type { PromptInput } from '../../shared/ipc-contract';
import { markerListable, OVERMIND, type LedgerEntry, type LedgerKind } from '../../shared/ledger-contract';
import { afterTarget, isHeld, releasesAfter } from '../../shared/ledger-derive';
import type { HarnessAdapter } from '../harness/port';
import type { SurfaceId } from '../ipc/surfaces';

import type { Ledger } from './index';

/**
 * Delivery: what happens to a ledger entry after it is written (HIVE-113).
 *
 * The ledger itself has no opinion about who should be told what — it records.
 * This module is the first rule on top of it: an `ask`, an `answer`, a `post`,
 * a `failed` or a `done` addressed to a live session is announced in that session's terminal as one marker
 * line, at a moment when the terminal is actually at an empty prompt.
 *
 * The line is a marker, not the entry (HIVE-138), and its bytes are the
 * session's adapter's (HIVE-240): `promptMarker`, Claude's in
 * `harness/claude-code/prompt-marker.ts`, names the entry and carries nothing
 * else. The receiver recognises the marker on the prompt hook it produces and
 * answers with the entry whole as hook context (`electron/main/hooks/receiver.ts`,
 * `context.ts`), untruncated and labelled as context rather than passing as the
 * user's own words. What this module decides is only *when* the marker is
 * written and *that* it landed; a harness whose `contextDelivery` is not
 * `prompt-marker` is never typed into.
 *
 * No party-authored byte reaches the pty from here any more. Before HIVE-138
 * this was the one path that typed another party's body into a prompt
 * terminated by `\r`, and stripping control characters from it was this
 * module's security boundary. The marker is built from a ref or an id main
 * minted, and the body travels as JSON the model reads, not bytes a terminal
 * interprets, so the boundary moved out of the pty path with the body.
 *
 * Collaborators arrive as narrow functions rather than whole modules, the way
 * `createLedger` takes `knowsParty`: the tests fake them as three closures and
 * load no Electron, no pty and no session layer.
 */

/**
 * The only kinds that reach a terminal.
 *
 * **This is a loop guard, not a filter.** This module subscribes to
 * `ledger.onChange` *and* appends a receipt to the same log for every nudge it
 * writes. Without a hard gate on the kind, each receipt would re-enter
 * {@link Deliver.onEntry} and the module would feed itself.
 *
 * A `post` addressed to a session is a one-way notice (the shipper's "PR
 * merged"): it reaches the terminal as an answer does, and owes nothing back.
 * Broadcast posts stay silent, because `onEntry` returns on a missing `to` and
 * `undelivered` re-checks `entry.to === entityId`. Receipts are `event`, so
 * adding `post` leaves the guard whole.
 *
 * `failed` and `done` close a thread the session asked (HIVE-408): a builder
 * run that died, a job reported finished. Receipts stay `event`, so the guard
 * still holds.
 */
const DELIVERABLE: readonly LedgerKind[] = ['ask', 'answer', 'post', 'failed', 'done'];

/**
 * The shipper's intake receipt says nothing the session must act on (HIVE-408).
 * shortcut: matches the body; key on `meta.accepted` once HIVE-410 lands `ledger_accept`.
 */
const isAcceptance = (entry: LedgerEntry): boolean =>
  entry.kind === 'answer' && entry.body.trim().toLowerCase() === 'accepted';

/** How long after a person's keystroke a session is not typed into (HIVE-408): the renderer's draft report trails the echo by a frame. */
export const TYPING_HOLD_MS = 2_000;

interface DeliverOptions {
  ledger: Pick<Ledger, 'read' | 'append'>;
  isLive: (entityId: string) => boolean;
  isIdle: (entityId: string) => boolean;
  /**
   * Write into a session's pty.
   *
   * Returns whether the line actually reached one. The caller in
   * `ipc/index.ts` reaches the session layer through a nullable binding — it is
   * constructed after the ledger — and a receipt written for a nudge that never
   * landed would suppress the retry forever.
   */
  write: (entityId: string, data: string) => boolean;
  /**
   * The harness behind a session, or `undefined` while the session layer is not up (HIVE-240).
   * Only a `prompt-marker` harness is typed into, and the bytes are its own: this module decides
   * *when*, the adapter decides *what*.
   */
  adapterOf: (entityId: string) => Pick<HarnessAdapter, 'capabilities' | 'promptMarker'> | undefined;
  /** The clock the typing hold reads (HIVE-408). Defaults to `Date.now`. */
  now?: () => number;
  /** The timer the typing hold retries on (HIVE-408). Defaults to `setTimeout`. */
  setTimeoutFn?: typeof setTimeout;
}

export interface Deliver {
  /** One entry landed, from any party. */
  onEntry(entry: LedgerEntry): void;
  /** A session reached an empty prompt with nothing running behind it. */
  onIdle(entityId: string): void;
  /** A session's agent came up, including after a resume. */
  onReady(entityId: string): void;
  /**
   * A terminal surface reported what its input box holds (HIVE-135). `empty`
   * and `draft` make that session the focused one **for that surface**;
   * `unfocused` releases it, if that surface still holds it.
   */
  onPrompt(surfaceId: SurfaceId, entityId: string, input: PromptInput): void;
  /**
   * One surface went away — a renderer reloaded or died, or a socket dropped.
   * Its record goes with it, and every other surface's stays (HIVE-145).
   */
  onSurfaceGone(surfaceId: SurfaceId): void;
  /**
   * A person's keystroke reached this session's pty (HIVE-408). Nothing is
   * typed into it for {@link TYPING_HOLD_MS}, and the backlog is retried when
   * the hold lapses: the renderer's `draft` report trails the keystroke by a
   * frame, and an entry landing in that frame got past {@link clear}.
   */
  onInput(entityId: string): void;
}

export function createDeliver({
  ledger,
  isLive,
  isIdle,
  write,
  adapterOf,
  now = Date.now,
  setTimeoutFn = setTimeout,
}: DeliverOptions): Deliver {
  /** When a person last typed into each session, and the retry armed behind it (HIVE-408). */
  const typedAt = new Map<string, number>();
  const retries = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * What each surface's input box holds, and for which session (HIVE-135).
   *
   * A map keyed by surface, not one record (HIVE-145). It *was* one record,
   * justified by "the stage shows one terminal at a time and a user can only
   * type into the terminal they can see" — a fact about a single renderer.
   * Server mode makes every attached socket a surface and all of them report
   * down the same `pty:prompt` notify, so the single record held whatever the
   * last surface to speak said, about whichever session that one was watching.
   *
   * Two silent failures came out of that, and both are what this map closes:
   * device B reporting on its own session released a hold device A had asked
   * for, and a socket dropping wiped a hold a still-live surface was relying
   * on — landing the nudge in a half-typed box, which is exactly the
   * regression HIVE-135 exists to prevent.
   *
   * Everything not focused *anywhere* delivers on idleness alone, as it did
   * before this existed. Empty means no surface has reported, which is the
   * conservative default in disguise: a surface reports in the same effect
   * that reveals it.
   */
  const focus = new Map<SurfaceId, { entityId: string; input: 'empty' | 'draft' }>();

  /**
   * May a line be written into this session's box right now?
   *
   * Refusing is always safe — a held nudge writes no receipt and the next
   * transition retries it. Writing into a draft never is.
   */
  function clear(entityId: string): boolean {
    // A keystroke inside the hold refuses too (HIVE-408): its draft report may not have arrived yet.
    const typed = typedAt.get(entityId);
    if (typed !== undefined && now() - typed < TYPING_HOLD_MS) return false;
    /*
      **Any** surface holding a draft refuses the write, not "the" surface
      (HIVE-145). Refusing is always safe — a held nudge writes no receipt and
      the next transition retries it — so with two devices on one session the
      right question is whether anyone is mid-sentence, not whether the last
      one to report was.
    */
    for (const held of focus.values()) {
      if (held.entityId === entityId && held.input === 'draft') return false;
    }
    return true;
  }

  /**
   * The short handle a person would use for this entry's conversation.
   *
   * An ask carries its own `ref`. An answer names a `thread`, which is always a
   * canonical id — so the ask it closes is looked up to recover the ref the
   * console printed. Falling back to the id is correct rather than merely safe:
   * an id always identifies the thread, it is just longer than a person wants.
   */
  /** The ask an answer closes, if the log still has it. */
  function askFor(entry: LedgerEntry): LedgerEntry | undefined {
    if (entry.kind === 'ask') return entry;
    const threadId = entry.thread;
    if (threadId === undefined) return undefined;
    return ledger.read({ thread: threadId }).entries.find((e) => e.kind === 'ask');
  }

  function handleFor(entry: LedgerEntry): string {
    if (entry.kind === 'ask') return entry.ref ?? entry.id;
    return askFor(entry)?.ref ?? entry.thread ?? entry.id;
  }

  /**
   * What this session has been asked but not told.
   *
   * A query rather than a queue, which is the whole reason delivery is recorded
   * in the log: an in-memory list dies with the process, and a nudge pending at
   * quit would never be written. Three things follow — a restart cannot lose
   * one, a duplicate `session:ready` (which `/clear` produces on purpose) costs
   * a read rather than a second line in the terminal, and "who was told what,
   * and when" is answerable from the log itself.
   */
  function undelivered(entityId: string): LedgerEntry[] {
    const { entries, openAsks } = ledger.read({ to: entityId });
    // An ask answered while this session was away (HIVE-167 redirects one
    // to the inbox) is settled; a marker for it would invite an answer the
    // ledger refuses as "thread is not open".
    const open = new Set(openAsks.map((ask) => ask.id));

    const delivered = new Set<string>();
    for (const entry of entries) {
      const id = entry.meta?.delivered;
      if (typeof id === 'string') delivered.add(id);
    }

    /*
      Where in this log the newest entry this session was told sits. Delivery
      keeps ledger order, so a `failed` or `done` behind it went unreceipted
      because the build that wrote the receipt did not deliver those kinds
      (before HIVE-408), not because it is owed: backfilling them would put every
      stale one on one line at the first idle after the upgrade.
    */
    let toldUpTo = -1;
    entries.forEach((entry, index) => {
      if (delivered.has(entry.id)) toldUpTo = index;
    });

    const owed = entries.filter(
      (entry, index) =>
        DELIVERABLE.includes(entry.kind) &&
        ((entry.kind !== 'failed' && entry.kind !== 'done') || index > toldUpTo) &&
        /*
          `read({ to })` matches entries addressed to this party *or* broadcast.
          Only the addressed half is deliverable, so the recipient is re-checked
          exactly rather than trusted from the query.
        */
        entry.to === entityId &&
        (entry.kind !== 'ask' || open.has(entry.id)) &&
        !isAcceptance(entry) &&
        !delivered.has(entry.id),
    );

    /*
      A held ask (`meta.after`, retro C) is not owed until its PR's `closed`
      entry is in the log. That entry is addressed to whoever the shipper
      reports to, not to this session, so the whole log is read, and only when
      something owed is waiting on a PR at all.
    */
    if (!owed.some((entry) => afterTarget(entry) !== undefined)) return owed;
    const log = ledger.read({}).entries;
    return owed.filter((entry) => !isHeld(entry, log));
  }

  /** Write one nudge line naming `entries`, and receipt each only if it landed. */
  function deliverAll(entityId: string, entries: readonly LedgerEntry[]): void {
    /*
      Not delivering is the same answer as a write that did not land: no receipt, so the next idle
      or ready transition asks again. A `none` harness reads the ledger through its tools.
    */
    const adapter = adapterOf(entityId);
    if (adapter?.capabilities.contextDelivery !== 'prompt-marker') return;
    if (!write(entityId, adapter.promptMarker(entries))) return;

    for (const entry of entries) {
      const handle = handleFor(entry);
      /*
        `from: OVERMIND` is asserted rather than derived. The party set is
        `overmind | session | agent` and there is no identity for "the app
        itself" — main is the coordinator's body, so the coordinator is who this
        is from. Addressed `to` the session so `visibleTo` lets that session read
        its own receipts, and so a broadcast is never created by accident.
      */
      const recorded = ledger.append({
        from: OVERMIND,
        to: entityId,
        kind: 'event',
        body: `nudge written (${handle})`,
        meta: { delivered: entry.id },
      });

      /*
        A refused receipt is reported, not swallowed. `Ledger.append` returns a
        refusal as a value (ENOSPC, a `~/.hivetty` moved out from under the app), and
        without a receipt this exact nudge is rewritten on every subsequent idle —
        forever, into a real terminal. Saying so once is what makes that
        diagnosable; the alternative is a session that mysteriously repeats a
        question it already asked.
      */
      if (!recorded.ok) {
        console.warn(
          `[ledger] nudge ${handle} was written to ${entityId} but its receipt was refused ` +
            `(${recorded.status}: ${recorded.reason}) — it may be delivered again`,
        );
      }
    }
  }

  /**
   * Retry a session's backlog when its typing hold lapses (HIVE-408). Re-armed for what is left
   * when the clock says the hold has not lapsed yet, so a timer firing a tick early is not a
   * nudge left waiting for the next idle.
   */
  function armRetry(entityId: string, delay: number): void {
    clearTimeout(retries.get(entityId));
    retries.set(
      entityId,
      setTimeoutFn(() => {
        retries.delete(entityId);
        const left = TYPING_HOLD_MS - (now() - (typedAt.get(entityId) ?? -Infinity));
        if (left > 0) armRetry(entityId, left);
        else flush(entityId);
      }, delay),
    );
  }

  /**
   * The owed entries one line can carry (HIVE-408): the longest run from the
   * front whose tokens may share a line, or the first entry alone when even it
   * may not. The rest has no receipt and goes on the next idle, in order.
   */
  function batch(owed: readonly LedgerEntry[]): readonly LedgerEntry[] {
    const stop = owed.findIndex((entry) => !markerListable(entry));
    if (stop === -1) return owed;
    return owed.slice(0, Math.max(stop, 1));
  }

  /**
   * Write everything this session is owed, on one line (HIVE-408).
   *
   * **The preconditions are checked once, and one line is written.** The line
   * ends in a single `\r`, which submits it, so the instant it lands the
   * session is mid-turn: one submit carries the whole backlog, and nothing is
   * typed behind it, which is the single invariant this module exists to hold.
   * An entry left off the line (see {@link batch}) has no receipt, so the next
   * idle transition picks it up.
   */
  function flush(entityId: string): void {
    if (!isLive(entityId) || !isIdle(entityId) || !clear(entityId)) return;
    const owed = undelivered(entityId);
    if (owed.length > 0) deliverAll(entityId, batch(owed));
  }

  /**
   * Flush every session holding an ask this `closed` entry releases (retro C),
   * and say which sessions were flushed. A held ask has no arrival of its own
   * to be delivered on: the PR merging is its arrival.
   */
  function releaseHeld(entry: LedgerEntry): Set<string> {
    const flushed = new Set<string>();
    if (entry.meta?.['stage'] !== 'closed') return flushed;

    for (const ask of ledger.read({}).openAsks) {
      const target = afterTarget(ask);
      const to = ask.to;
      if (target === undefined || to === undefined || to === OVERMIND) continue;
      if (flushed.has(to) || !releasesAfter(entry, target)) continue;
      flushed.add(to);
      flush(to);
    }
    return flushed;
  }

  return {
    onEntry(entry) {
      /*
        A `closed` entry may release held asks (retro C). Their sessions flush
        first, and a session flushed here has already taken its backlog on one
        line (HIVE-408), this entry included, so the path below must not write
        into it a second time in the same tick.
      */
      const flushed = releaseHeld(entry);

      if (!DELIVERABLE.includes(entry.kind)) return;

      const to = entry.to;
      // A broadcast wakes nobody — parties read those on their own schedule.
      if (to === undefined) return;
      // The overmind's copy is an inbox card (HIVE-118), not a terminal line.
      if (to === OVERMIND) return;
      if (flushed.has(to)) return;
      /*
        The backlog goes first, in ledger order (HIVE-408): `flush` reads every
        owed entry, this one included. It also holds every gate this path used
        to check itself: an agent or unknown party is not live (the scheduler
        wakes agents, HIVE-120), a session mid-turn is not idle and is flushed by
        `onIdle`, a draft is not clear and is flushed by `onPrompt` (HIVE-135),
        and `undelivered` drops a held ask until its PR's `closed` (retro C).
      */
      flush(to);
    },

    onIdle(entityId) {
      flush(entityId);
    },

    onReady(entityId) {
      flush(entityId);
    },

    onPrompt(surfaceId, entityId, input) {
      const before = focus.get(surfaceId);

      if (input === 'unfocused') {
        // Only the holder releases its own record: a late report naming a
        // session this surface has already left must not clear the entry it
        // has since made, nor any other surface's.
        if (before?.entityId === entityId) focus.delete(surfaceId);
        return;
      }

      focus.set(surfaceId, { entityId, input });

      /*
        The third flush trigger, beside idle and ready. Not on a report that
        changes nothing: after a nudge is submitted the next screen read says
        `empty` again while main's idle answer can lag the busy-state hook,
        and re-running the flush then would find the backlog behind the turn
        the last nudge started. Every other arrival at `empty` — first report,
        after a reset, after a draft, after a focus round-trip — is a
        transition, and the held nudge is what the user is waiting on.
      */
      const unchanged = before?.entityId === entityId && before.input === 'empty';
      if (input === 'empty' && !unchanged) flush(entityId);
    },

    onInput(entityId) {
      typedAt.set(entityId, now());
      armRetry(entityId, TYPING_HOLD_MS);
    },

    onSurfaceGone(surfaceId) {
      /*
        One entry, not the whole map. No flush follows, for the same reason an
        `unfocused` report does not flush: a surface going away is not a
        transition to an empty box, and the next idle, ready or empty report
        from a surface that *is* live takes the backlog.
      */
      focus.delete(surfaceId);
    },
  };
}
