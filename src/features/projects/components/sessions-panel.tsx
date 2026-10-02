import { Eye, Plus } from '@phosphor-icons/react';

import { cn } from '@/lib/utils';

import { EmptyState, EmptyStatePath } from '@components/ui/empty-state';
import { NewProjectLink } from '@features/projects/components/new-project-link';
import { SessionsProjectRow } from '@features/projects/components/sessions-project-row';
import { useProjects, useSessionsHeadCounts } from '@stores/hive-store';
import { usePickerActions, useSessionsProject, useSetSessionsProject } from '@stores/ui-store';

/**
 * Round two's Sessions list panel (HIVE-197): always the projects, folded, with
 * "All projects" on top to widen the Overmind again. Classic's `LeftRail` keeps
 * `ProjectsPanel`.
 */
export function SessionsPanel() {
  const projects = useProjects();
  const { live, needs } = useSessionsHeadCounts();
  const filter = useSessionsProject();
  const setFilter = useSetSessionsProject();
  const { openPicker } = usePickerActions();

  // The same empty state `ProjectsPanel` draws, and for its reasons.
  if (projects.length === 0) {
    return (
      <div data-panel="sessions">
        <EmptyState
          phrase="empty.projects"
          creature="overlord"
          control={<NewProjectLink variant="cta" />}
          action={
            <>
              Or clone one in <EmptyStatePath>Settings → Projects</EmptyStatePath>.
            </>
          }
        />
      </div>
    );
  }

  return (
    <div data-panel="sessions" className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2.5 px-2 pt-1 pb-2">
        <h2 className="text-[14px] font-semibold text-ink">Projects</h2>
        <span className="text-[12px] text-muted">
          <span className="text-green">{live} live</span> ·{' '}
          <span className="text-amber">{needs} needs you</span>
        </span>
        <button
          type="button"
          onClick={() => openPicker()}
          aria-label="New session"
          className="ml-auto self-center rounded p-1 text-muted hover:bg-hover hover:text-ink"
        >
          <Plus size={14} weight="bold" aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        onClick={() => setFilter(null)}
        aria-current={filter === null ? 'true' : undefined}
        className={cn(
          'mb-1.5 flex items-center gap-2 rounded-lg border-b border-border-soft px-2.5 py-[var(--cc-row-py)] text-left',
          filter === null ? 'bg-active' : 'hover:bg-hover',
        )}
      >
        <Eye size={15} aria-hidden="true" className="shrink-0 text-brand" />
        <span className="flex-1 text-[13px] font-medium text-ink">All projects</span>
        <span className="font-mono text-[11px] text-muted">{live}</span>
      </button>
      {projects.map((project) => (
        <SessionsProjectRow key={project.id} project={project} />
      ))}
      <div className="mt-1.5">
        <NewProjectLink />
      </div>
    </div>
  );
}
