import type { LedgerEntry } from '@shared/ledger-contract';

/**
 * The reminder for a permission card nobody answered (HIVE-409).
 *
 * One toast at raise was all a card got, and nine cards sat 24 hours between
 * them. This re-presents the oldest card's toast when the app regains focus and
 * after every fifteen minutes the Mac is in use. An idle minute does not count,
 * so nothing piles up overnight. It never answers a card (D7): the reminder is
 * the whole escalation.
 */
export const REMIND_AFTER_ACTIVE_MINUTES = 15;
/** A minute counts as active while the Mac has been idle for less than this (D2). */
export const IDLE_CUTOFF_SECONDS = 120;
const MINUTE_MS = 60_000;

export interface PermissionReminderDeps {
  /** Open permission cards addressed to the overmind, any order. */
  openCards: () => readonly LedgerEntry[];
  /** `hub.remind`. */
  remind: (id: string) => boolean;
  /** `powerMonitor.getSystemIdleTime`, in seconds. */
  idleSeconds: () => number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export interface PermissionReminder {
  start(): void;
  stop(): void;
  onFocus(): void;
}

export function createPermissionReminder(deps: PermissionReminderDeps): PermissionReminder {
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
  let active = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const oldest = (): LedgerEntry | undefined =>
    deps
      .openCards()
      .reduce<LedgerEntry | undefined>((min, card) => (min === undefined || card.ts < min.ts ? card : min), undefined);

  const remindOldest = (card: LedgerEntry): void => {
    active = 0;
    deps.remind(card.id);
  };

  const minute = (): void => {
    const card = oldest();
    if (card === undefined) {
      active = 0;
      return;
    }
    if (deps.idleSeconds() >= IDLE_CUTOFF_SECONDS) return;
    active += 1;
    if (active >= REMIND_AFTER_ACTIVE_MINUTES) remindOldest(card);
  };

  return {
    start() {
      if (timer === null) timer = setIntervalFn(minute, MINUTE_MS);
    },
    stop() {
      if (timer === null) return;
      clearIntervalFn(timer);
      timer = null;
    },
    onFocus() {
      const card = oldest();
      if (card !== undefined) remindOldest(card);
    },
  };
}
