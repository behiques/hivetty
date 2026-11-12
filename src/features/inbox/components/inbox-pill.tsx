import { Bell, LockSimple } from '@phosphor-icons/react';

import { cn } from '@/lib/utils';

import { useReducedMotion } from '@hooks/use-reduced-motion';
import { useAge } from '@hooks/use-relative-time';
import { useEchoes, usePermissionCards, useSummons } from '@stores/hive-store';
import { NEWS_SECTION, useArrivalPulse, useInboxActions, useInboxDrawer, useSettingsOpen, useStackUp } from '@stores/ui-store';

interface InboxPillProps {
  /** The terminal on this window's stage, left out of the count. */
  onStage: string | null;
}

/** The rule between the pill's segments, amber while anything needs you. */
const Divider = ({ amber }: { amber: boolean }) => (
  <span aria-hidden className={cn('my-1.5 w-px', amber ? 'bg-amber-edge' : 'bg-border')} />
);

interface CardSegmentProps {
  count: number;
  oldestTs: number;
  expanded: boolean;
  onClick: () => void;
}

/**
 * The open permission cards and the oldest one's age (HIVE-409). A child of
 * its own, so the ticking age only mounts while a card waits.
 */
function CardSegment({ count, oldestTs, expanded, onClick }: CardSegmentProps) {
  const age = useAge(oldestTs);
  const cards = count === 1 ? 'card' : 'cards';
  return (
    <button
      type="button"
      aria-label={`${String(count)} permission ${cards}, oldest waiting ${age}`}
      aria-expanded={expanded}
      onClick={onClick}
      className="flex items-center gap-[7px] py-1.5 pr-3 pl-2.5 hover:bg-hover aria-expanded:bg-amber-soft aria-expanded:text-ink"
    >
      <LockSimple size={14} className="text-amber-text" aria-hidden />
      <b className="tabular-nums font-semibold text-amber-text">{count}</b>
      <span>{`${cards} · oldest ${age}`}</span>
    </button>
  );
}

/**
 * What needs you, as a count in the stage's corner (HIVE-198). Nothing
 * waiting draws nothing; the drawer open hides it, since the drawer is the
 * same queue whole.
 *
 * Two halves past one row (HIVE-228): the count shows or hides the stack over
 * it, and `Open all` opens the drawer. With one row there is nothing to open
 * that the stack does not already show.
 *
 * A quiet arrival (the keyboard was in a terminal) never rises as a card; the
 * pill pulses once for it instead, and only when the row is one it counts, so
 * the session you are typing into never pulses it.
 *
 * News sits beside the count as `N new` (HIVE-231), neutral rather than amber:
 * every row in the Inbox must be reachable, but news never needs you, so it
 * never joins the count, the dock badge or Home's headline. It opens the drawer
 * at its New section.
 */
export function InboxPill({ onStage }: InboxPillProps) {
  const { asks, sessions } = useSummons(onStage);
  const permissionCards = usePermissionCards(onStage);
  const echoes = useEchoes();
  const pulse = useArrivalPulse();
  const { open } = useInboxDrawer();
  const stackUp = useStackUp();
  const settings = useSettingsOpen();
  const { openInboxDrawer, toggleStack } = useInboxActions();
  const reduced = useReducedMotion();

  const count = asks.length + sessions.length;
  const news = echoes.length;
  if (count + news === 0 || open) return null;

  const counted = pulse !== null && [...asks, ...sessions, ...echoes].some((row) => row.id === pulse);
  const needs = count === 1 ? 'needs' : 'need';
  const amber = count > 0;

  return (
    <div
      // Keyed by the pulsing id, so each quiet arrival plays the pulse once.
      key={counted ? pulse : 'still'}
      className={cn(
        'flex items-stretch overflow-hidden rounded-full border bg-panel-2 text-control text-muted shadow-lg',
        amber ? 'border-amber-edge' : 'border-border',
        counted && !reduced && 'motion-safe:animate-ccpulse motion-safe:[animation-iteration-count:1]',
      )}
    >
      {amber ? (
        <button
          type="button"
          // The exact number, singular-aware, even when the face says 99+ (HIVE-211).
          aria-label={`Inbox, ${String(count)} ${needs} you`}
          aria-expanded={stackUp && !settings}
          onClick={toggleStack}
          className="flex items-center gap-[7px] py-1.5 pr-3 pl-2.5 hover:bg-hover aria-expanded:bg-amber-soft aria-expanded:text-ink"
        >
          <Bell size={14} className="text-amber-text" aria-hidden />
          <b className="tabular-nums font-semibold text-amber-text">{count > 99 ? '99+' : count}</b>
          <span>{`${needs} you`}</span>
        </button>
      ) : null}
      {/* A permission card is one of `asks`, so this only ever shows beside the amber count. */}
      {permissionCards.oldestTs !== null ? (
        <>
          <Divider amber />
          <CardSegment
            count={permissionCards.count}
            oldestTs={permissionCards.oldestTs}
            expanded={stackUp && !settings}
            onClick={toggleStack}
          />
        </>
      ) : null}
      {amber && news > 0 ? <Divider amber /> : null}
      {news > 0 ? (
        <button
          type="button"
          aria-label={`Inbox news, ${String(news)} new`}
          onClick={() => openInboxDrawer(NEWS_SECTION)}
          className="flex items-center gap-[7px] py-1.5 pr-3 pl-2.5 hover:bg-hover"
        >
          {amber ? null : <Bell size={14} aria-hidden />}
          <span className="tabular-nums">{`${String(news)} new`}</span>
        </button>
      ) : null}
      {count > 1 ? (
        <>
          <Divider amber={amber} />
          <button type="button" onClick={() => openInboxDrawer()} className="px-3 py-1.5 text-brand hover:bg-hover">
            Open all
          </button>
        </>
      ) : null}
    </div>
  );
}
