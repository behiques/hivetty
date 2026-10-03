import { useMemo } from 'react';

import { cn } from '@/lib/utils';
import type { HiveNotification } from '@/types/notification';

import { useReducedMotion } from '@hooks/use-reduced-motion';
import { useSummons } from '@stores/hive-store';
import { useArrivals, useInboxActions, useSettingsOpen } from '@stores/ui-store';

import { AskCard } from './ask-card';
import { NotificationCard } from './notification-card';
import { SessionNote } from './session-note';

/** What the corner's polite live region says for the newest arrival. */
export const announcement = (row: HiveNotification, asker: string): string =>
  row.kind === 'session.blocked'
    ? `${asker} asked a question`
    : `${asker} ${row.kind === 'agent.permission' ? 'wants to run a command' : 'asks'}: ${row.title}`;

/**
 * Arrivals still in the queue, newest first (HIVE-198).
 *
 * Filtered here rather than when pushed: the on-stage session, an answered
 * ask, a dismissed row all drop out of `useSummons`, and so out of this.
 */
export function useVisibleArrivals(onStage: string | null): HiveNotification[] {
  const arrivals = useArrivals();
  const { asks, sessions } = useSummons(onStage);
  return useMemo(() => {
    const byId = new Map([...asks, ...sessions].map((row) => [row.id, row]));
    return arrivals.flatMap((id) => byId.get(id) ?? []);
  }, [arrivals, asks, sessions]);
}

interface ArrivalStackProps {
  /** The terminal on this window's stage, never drawn. */
  onStage: string | null;
}

/**
 * What just arrived, over the pill (HIVE-198): the newest as an answerable
 * card, or a note for a session off stage, with up to two slivers under it
 * for the rest of a burst. It never takes focus.
 *
 * Not drawn while Settings is open: the queue waits, and rises when it closes.
 */
export function ArrivalStack({ onStage }: ArrivalStackProps) {
  const visible = useVisibleArrivals(onStage);
  const settings = useSettingsOpen();
  const { foldArrivals } = useInboxActions();
  const reduced = useReducedMotion();

  const [newest] = visible;
  if (settings || newest === undefined) return null;

  const slivers = Math.min(visible.length - 1, 2);

  return (
    <div className="flex flex-col items-end gap-1.5">
      {visible.length > 1 ? (
        <span className="rounded-full border border-border bg-panel-2 px-2.5 py-1 text-[11.5px] text-muted">
          {`${String(visible.length)} arrived just now · newest first`}
        </span>
      ) : null}
      <div className={cn('relative w-[380px]', !reduced && 'motion-safe:animate-ccslidein')}>
        <div className="relative z-[2] rounded-[10px] shadow-xl [&>article]:border-[color-mix(in_srgb,var(--cc-amber)_55%,var(--cc-border))]">
          {newest.kind === 'session.blocked' ? (
            <SessionNote notif={newest} variant="note" onFold={foldArrivals} />
          ) : newest.action.type === 'ask' ? (
            <AskCard notif={newest} thread={newest.action.thread} variant="float" onClose={foldArrivals} />
          ) : (
            <NotificationCard notif={newest} />
          )}
        </div>
        {slivers >= 1 ? (
          <span
            data-sliver
            aria-hidden
            className="absolute inset-x-3 -bottom-[7px] z-[1] h-3 rounded-b-[10px] border border-t-0 border-border bg-panel-2"
          />
        ) : null}
        {slivers >= 2 ? (
          <span
            data-sliver
            aria-hidden
            className="absolute inset-x-6 -bottom-[13px] z-0 h-3 rounded-b-[10px] border border-t-0 border-border bg-panel-2 opacity-70"
          />
        ) : null}
      </div>
    </div>
  );
}
