import { CheckCircle, GitPullRequest, Kanban, Robot } from '@phosphor-icons/react';

import { hhmm } from '@features/home/components/coming-up';
import { StripHead, StripRow } from '@features/home/components/strip-row';
import { useWhileAway } from '@stores/hive-store';
import { useAwaySince } from '@stores/ui-store';

export function hatchedLine(numbers: number[]): string {
  if (numbers.length === 1) return `#${numbers[0]} hatched`;
  if (numbers.length === 2) return `#${numbers[0]} and #${numbers[1]} hatched`;
  return `${numbers.length} PRs hatched`;
}

const RUNS_TIP = 'Counted from the last 500 ledger entries; can undercount on a busy day.';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** `merged it`, `merged both`, `merged them`. */
const mergedWhat = (n: number) => (n === 1 ? 'it' : n === 2 ? 'both' : 'them');

/** Home's While you were away (HIVE-200): column 1 when nothing needs you. */
export function WhileYouWereAway() {
  const since = useAwaySince();
  const { hatched, goals, runs, ready } = useWhileAway(since);
  const empty =
    hatched.numbers.length === 0 && goals.length === 0 && runs.total === 0 && ready.total === 0;
  const unnamed = ready.total - ready.keys.length;
  return (
    <section aria-labelledby="away-head" className="grid min-w-0 content-start gap-px">
      <StripHead
        aside={
          <span className="ml-auto font-mono font-normal tracking-normal text-muted normal-case">
            since {hhmm(since)}
          </span>
        }
      >
        <span id="away-head">While you were away</span>
      </StripHead>
      {empty && (
        <p className="px-1 py-[5px] text-[12px] text-muted">Nothing happened while you were away.</p>
      )}
      {hatched.numbers.length > 0 && (
        <StripRow
          icon={<GitPullRequest size={15} className="text-green" aria-hidden="true" />}
          name={hatchedLine(hatched.numbers)}
          detail={hatched.by === undefined ? '' : `${hatched.by} merged ${mergedWhat(hatched.numbers.length)}`}
        />
      )}
      {goals.map((title, i) => (
        <StripRow
          key={`${title}-${i}`}
          icon={<CheckCircle size={15} className="text-green" aria-hidden="true" />}
          name={title}
          detail=""
        />
      ))}
      {runs.total > 0 && (
        <StripRow
          icon={<Robot size={15} className="text-brand" aria-hidden="true" />}
          name={plural(runs.total, 'agent run')}
          detail={runs.failed > 0 ? `${runs.failed} failed` : ''}
          title={RUNS_TIP}
        />
      )}
      {ready.total > 0 && (
        <StripRow
          icon={<Kanban size={15} className="text-subtle" aria-hidden="true" />}
          name={`${plural(ready.total, 'ticket')} ready to start`}
          detail={`${ready.keys.join(', ')}${unnamed > 0 ? ` and ${unnamed} more` : ''} ${ready.total === 1 ? 'has' : 'have'} no session`}
        />
      )}
    </section>
  );
}
