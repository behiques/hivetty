import { Fragment } from 'react';

import { useCliSkills } from '@hooks/use-skills';
import { CLI_NAMES } from '@lib/harness/cli-names';

/**
 * The user's own skills per CLI (HIVE-367), as one row under the Skills header.
 *
 * Counts rather than names: Codex alone lists dozens (its system skills, the
 * user's folders, every plugin's), and the row has the width of one line. The
 * names live behind View. HiveTTY only reads these skills, from each CLI's own
 * places; nothing here writes them. Renders nothing before main answers, in
 * the browser, and when no CLI has any.
 */
export function CliSkillsRow() {
  const skills = useCliSkills();

  if (skills === null || skills.length === 0) return null;

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
      <button type="button" className="shrink-0 text-brand hover:underline">
        View
      </button>
    </div>
  );
}
