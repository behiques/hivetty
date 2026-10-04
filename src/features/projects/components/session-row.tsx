import { Hexagon } from '@phosphor-icons/react';

import { cn } from '@/lib/utils';
import { branchLabel, entityLabel, isSession, terminalOf } from '@/types/entity';

import { Badge } from '@components/ui/badge';
import { statusLabel, statusText } from '@components/ui/status-dot';
import { useEntity, useOpenEntity, usePlanProgress, useYoursAgain } from '@stores/hive-store';
import { useActiveTab } from '@stores/ui-store';

interface SessionRowProps {
  id: string;
  /** One line, round two's panel (HIVE-197): the branch line is dropped. */
  compact?: boolean;
}

/**
 * One session beneath its project.
 *
 * Two lines: status comb + id + status label, then the branch indented under it.
 * The comb is a hexagon in the status colour: filled while the main agent is
 * busy, hollow once it is idle — so `working (agents)` is still a hollow green
 * comb beside a solid one (HIVE-83's distinction, carried by the glyph).
 * The 26px left padding aligns the comb with the project name above rather than
 * with its caret, so the tree reads as one column of names.
 *
 * Renders nothing for an id the store does not know. The simulation (061) and
 * the spawn flow (044) both add and remove entities underneath open panels, so
 * a row that insists its entity exists is a crash waiting for a race.
 */
export function SessionRow({ id, compact = false }: SessionRowProps) {
  const entity = useEntity(id);
  const activeTab = useActiveTab();
  const openEntity = useOpenEntity();
  // Before the guard: a hook cannot sit behind an early return (HIVE-182).
  const progress = usePlanProgress(id);
  // Also before the guard, with '' when there is no session to name (HIVE-198).
  const yoursAgain = useYoursAgain(entity && isSession(entity) ? terminalOf(entity) : '');

  if (!entity || !isSession(entity)) return null;

  const active = activeTab === id;

  return (
    <button
      type="button"
      onClick={() => openEntity(id)}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex flex-col rounded-lg py-[3px] pr-2.5 pl-[26px] leading-[1.35]',
        active ? 'bg-active' : 'hover:bg-hover',
      )}
    >
      <span className="flex w-full items-center gap-2">
        {/* Decoration: the status label sits right beside it. */}
        <Hexagon
          size={11}
          weight={entity.status === 'idle' ? 'bold' : 'fill'}
          aria-hidden="true"
          className={cn(
            'shrink-0',
            statusText(entity.status, entity.idleDetail),
            entity.status === 'working' && 'animate-ccpulse',
          )}
        />
        <span className="flex-1 truncate text-left text-ui">
          {entityLabel(entity)}
        </span>
        <span
          className={cn(
            'shrink-0 text-ui-sm',
            statusText(entity.status, entity.idleDetail),
          )}
        >
          {/*
            Round two's panel says a session that finished for you is yours
            again, until opening it sweeps the row (HIVE-198). Idle's tone.
          */}
          {compact && yoursAgain && entity.status === 'idle'
            ? 'yours again'
            : statusLabel(entity.status, entity.idleDetail)}
        </span>
        {/*
          The session's plan progress (HIVE-182), after the status label: the
          dot and the label keep priority, and the count is only ever extra.
        */}
        {progress === undefined ? null : (
          <Badge
            count={progress.total}
            text={`${String(progress.done)}/${String(progress.total)}`}
            tone="green"
            label="tasks done"
            className="shrink-0"
          />
        )}
      </span>

      {compact ? null : (
        <span className="w-full truncate pl-[15px] text-left tabular-nums text-ui-sm text-subtle">
          {branchLabel(entity)}
        </span>
      )}
    </button>
  );
}
