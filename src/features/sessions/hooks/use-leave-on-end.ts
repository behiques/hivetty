import { useLayoutEffect, useRef } from 'react';

import { isTerminated, type Entity } from '@/types/entity';

import { useBackToOrch } from '@stores/ui-store';

/**
 * Back to the Overmind when the session on stage ends while it is watched.
 *
 * `/exit` or `/done` typed into a live session is the user leaving it, so the
 * ended card would be one more click for a decision already made. Only the
 * live-to-ended transition leaves: a session opened after it ended keeps
 * `SessionEndedCover`, because Resume and the reason are what it came for.
 *
 * A layout effect, so the card never paints for the frame before the move.
 * `entity` is the session on a terminal view, or `null` for anything else, so
 * a session ending behind the editor or another tab moves nobody.
 */
export function useLeaveOnEnd(entity: Entity | null): void {
  const backToOrch = useBackToOrch();
  const liveId = useRef<string | null>(null);
  const id = entity?.id ?? null;
  const ended = entity !== null && isTerminated(entity);

  useLayoutEffect(() => {
    if (ended && id === liveId.current) backToOrch();
    liveId.current = ended ? null : id;
  }, [id, ended, backToOrch]);
}
