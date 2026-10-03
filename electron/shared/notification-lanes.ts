/**
 * The Inbox's lanes, as behaviour (HIVE-214).
 *
 * A sibling of the contract rather than part of it, because the contract is
 * types and constants only and this ships logic both processes run: the hub
 * trims and counts its buffer with it, the renderer its mirror, and the two
 * must leave the same rows and the same number.
 */

import {
  NOTIFICATION_CAP,
  NOTIFICATION_KIND_SPECS,
  type HiveNotification,
  type NotificationKind,
  type NotificationLane,
} from './notification-contract';

/** Is this ask's thread still open? Main answers from its ledger, the renderer from its mirror. */
export type AskOpen = (thread: string) => boolean;

export const laneOf = (kind: NotificationKind): NotificationLane => NOTIFICATION_KIND_SPECS[kind].lane;

/**
 * Does this row wait on the user right now?
 *
 * A Summons row does, unless it is an ask whose thread has closed: an answer
 * only marks its row read, so the row stays while the question is gone.
 */
export const waitsOnYou = (row: HiveNotification, isAskOpen: AskOpen): boolean =>
  laneOf(row.kind) === 'summons' && (row.action.type !== 'ask' || isAskOpen(row.action.thread));

/**
 * The buffer's cap, without ever dropping a row that waits on you.
 *
 * Rows arrive newest first. At most {@link NOTIFICATION_CAP} of the rest stay:
 * Echoes leave oldest first, then Burrowed oldest first. A closed ask is news
 * now and leaves with the Echoes. Rows that wait on you are bounded elsewhere —
 * the ask TTL and the session sweeps.
 */
export function trimNotifications(
  rows: readonly HiveNotification[],
  isAskOpen: AskOpen,
): HiveNotification[] {
  const waiting = rows.map((row) => waitsOnYou(row, isAskOpen));
  let excess = waiting.filter((kept) => !kept).length - NOTIFICATION_CAP;
  if (excess <= 0) return [...rows];

  const drop = new Set<number>();
  for (const lane of ['echo', 'burrowed'] as const) {
    for (let i = rows.length - 1; i >= 0 && excess > 0; i -= 1) {
      if (waiting[i]) continue;
      const evicts = laneOf(rows[i].kind) === 'burrowed' ? 'burrowed' : 'echo';
      if (evicts !== lane) continue;
      drop.add(i);
      excess -= 1;
    }
  }
  return rows.filter((_, i) => !drop.has(i));
}
