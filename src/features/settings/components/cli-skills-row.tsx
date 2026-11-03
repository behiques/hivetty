import { Fragment, useState } from 'react';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@components/ui/dialog';
import { TextField } from '@components/ui/text-field';
import { useCliSkills } from '@hooks/use-skills';
import { CLI_NAMES } from '@lib/harness/cli-names';

/**
 * The user's own skills per CLI (HIVE-367), as one row under the Skills header
 * with a read-only dialog behind it.
 *
 * Counts rather than names: Codex alone lists dozens (its system skills, the
 * user's folders, every plugin's), and the row has the width of one line. The
 * names live behind View, grouped by CLI with the places each CLI looks.
 * HiveTTY only reads these skills, from each CLI's own places; nothing here
 * writes them. Renders nothing before main answers, in the browser, and when
 * no CLI has any.
 */
export function CliSkillsRow() {
  const skills = useCliSkills();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  if (skills === null || skills.length === 0) return null;

  const query = filter.trim().toLowerCase();
  const sections = skills
    .map((entry) => ({ ...entry, shown: entry.names.filter((name) => name.toLowerCase().includes(query)) }))
    .filter((entry) => entry.shown.length > 0);

  return (
    <div className="flex items-center gap-2.5 rounded-md border border-border-soft bg-panel px-2.5 py-1.5 text-ui-sm">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap">
        <span className="shrink-0 text-subtle">Your CLI skills:</span>
        {skills.map((entry, index) => (
          <Fragment key={entry.cli}>
            {index > 0 ? (
              <span aria-hidden="true" className="text-subtle">
                ·
              </span>
            ) : null}
            <span>
              <span>{CLI_NAMES[entry.cli]}</span>{' '}
              <span className="tabular-nums text-ink">{entry.names.length}</span>
            </span>
          </Fragment>
        ))}
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setFilter('');
        }}
      >
        {/* A trigger, so closing the dialog returns focus to this button. */}
        <DialogTrigger asChild>
          <button type="button" className="shrink-0 text-brand hover:underline">
            View
          </button>
        </DialogTrigger>

        <DialogContent showCloseButton={false} className="gap-0 p-0 sm:max-w-[560px]">
          <DialogHeader className="gap-1 border-b border-border-soft px-3.5 pt-3 pb-2.5">
            <DialogTitle className="text-ui font-semibold text-ink">Your CLI skills</DialogTitle>
            <DialogDescription className="text-ui-sm text-subtle">
              Skills each CLI loads on its own. HiveTTY reads them and never changes them.
            </DialogDescription>
          </DialogHeader>

          <div className="px-3.5 pt-2.5">
            <TextField label="Filter skills" value={filter} onChange={setFilter} className="w-52" />
          </div>

          <div className="flex max-h-72 flex-col gap-3 overflow-y-auto px-3.5 py-2">
            {sections.length === 0 ? (
              <p className="py-1 text-ui-sm text-subtle">No skill matches “{filter.trim()}”.</p>
            ) : (
              sections.map((entry) => (
                <section key={entry.cli} className="flex flex-col gap-1">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-ui-sm font-semibold uppercase tracking-wide text-term-head">
                      {CLI_NAMES[entry.cli]} · {entry.shown.length}
                    </h3>
                    <span className="min-w-0 truncate text-ui-sm text-subtle">{entry.places}</span>
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {entry.shown.map((name) => (
                      <li key={name} className="text-control text-muted">
                        {name}
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>

          <DialogFooter className="border-t border-border-soft px-3.5 py-2.5">
            <DialogClose className="rounded border border-border bg-panel-2 px-[11px] py-[5px] text-control text-ink hover:bg-hover">
              Done
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
