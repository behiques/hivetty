import { cn } from '@/lib/utils';
import type { ProjectRow as ProjectRowData } from '@/types/entity';
import { isTerminal } from '@/types/entity';

import { Icon } from '@components/ui/icon';
import { Tag } from '@components/ui/tag';
import { NewSessionLink } from '@features/projects/components/new-session-link';
import { NewTerminalLink } from '@features/projects/components/new-terminal-link';
import { SessionRow } from '@features/projects/components/session-row';
import { TerminalRow } from '@features/projects/components/terminal-row';
import { useProjectAccess } from '@hooks/use-project-config';
import { useEntity, useProjectCounts, useProjectSessions } from '@stores/hive-store';
import {
  useProjectExpanded,
  useSessionsProject,
  useSetSessionsProject,
  useSettingsActions,
  useToggleProjectFold,
} from '@stores/ui-store';

/** One entry under the project, by kind — `ProjectRow`'s rule, one line per session. */
function Entry({ id }: { id: string }) {
  const entity = useEntity(id);
  if (!entity) return null;
  return isTerminal(entity) ? <TerminalRow id={id} /> : <SessionRow id={id} compact />;
}

/**
 * One project in round two's Sessions panel (HIVE-197): folded by default, the
 * name filters the Overmind, the caret only folds. Classic's `ProjectRow` is
 * untouched until phase 2 deletes it.
 */
export function SessionsProjectRow({ project }: { project: ProjectRowData }) {
  const ids = useProjectSessions(project.id);
  const { needs, other } = useProjectCounts(project.id);
  const expanded = useProjectExpanded(project.id);
  const toggleFold = useToggleProjectFold();
  const filter = useSessionsProject();
  const setFilter = useSetSessionsProject();
  const access = useProjectAccess(project.id);
  const { openSettings } = useSettingsActions();
  const selected = filter === project.id;

  return (
    <div className="flex flex-col gap-0.5">
      <div className={cn('flex items-center gap-1 rounded-lg pr-2.5', selected ? 'bg-active' : 'hover:bg-hover')}>
        <button
          type="button"
          onClick={() => toggleFold(project.id)}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Fold' : 'Unfold'} ${project.name}`}
          className="shrink-0 rounded px-1.5 py-[var(--cc-row-py)] text-subtle hover:text-ink"
        >
          <Icon name={expanded ? 'ph-caret-down' : 'ph-caret-right'} size={11} />
        </button>
        <button
          type="button"
          onClick={() => setFilter(project.id)}
          aria-current={selected ? 'true' : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 py-[var(--cc-row-py)] text-left"
        >
          <Icon name={project.icon} size={15} className="shrink-0 text-brand" />
          <span className="flex-1 truncate font-mono text-[12.5px] text-brand">{project.name}</span>
          {access.reason ? (
            <Tag tone={access.invalid ? 'amber' : 'subtle'} title={access.reason} className="shrink-0">
              unmapped
            </Tag>
          ) : null}
          {needs > 0 ? <Count tone="text-amber-count" dot="bg-amber" n={needs} title="need you" /> : null}
          {other > 0 ? <Count tone="text-green" dot="bg-green" n={other} title="other live" /> : null}
          {needs + other === 0 ? (
            <span className="shrink-0 font-mono text-[11px] text-subtle">no sessions</span>
          ) : null}
        </button>
      </div>
      {/* The way out of "unmapped", once the row is the filter (HIVE-218); a sibling, never inside the row's buttons. */}
      {selected && access.reason ? (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 pr-2.5 pb-1.5 pl-[30px] text-[11.5px] text-muted">
          <span className="min-w-0 break-words">{access.reason}</span>
          <button
            type="button"
            onClick={() => openSettings('projects')}
            className="text-brand underline underline-offset-2 hover:text-ink"
          >
            {access.invalid ? 'Fix it in Settings' : 'Map it in Settings'}
          </button>
        </div>
      ) : null}
      {expanded ? (
        <>
          {ids.map((id) => (
            <Entry key={id} id={id} />
          ))}
          <div className="flex items-center">
            <NewSessionLink projectId={project.id} projectName={project.name} />
            <span aria-hidden="true" className="mx-1 h-3 w-px shrink-0 bg-border-soft" />
            <NewTerminalLink projectId={project.id} projectName={project.name} />
          </div>
        </>
      ) : null}
    </div>
  );
}

/** A coloured dot and a number; the word rides along for screen readers. */
function Count({ n, tone, dot, title }: { n: number; tone: string; dot: string; title: string }) {
  return (
    <span title={title} className={cn('flex shrink-0 items-center gap-1 font-mono text-[11px]', tone)}>
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', dot)} />
      {n}
      <span className="sr-only"> {title}</span>
    </span>
  );
}
