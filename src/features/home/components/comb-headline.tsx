import { cn } from '@/lib/utils';

import type { CombSummary } from '@stores/hive-store';

export const headlineText = (needs: number): string =>
  needs === 0 ? 'Nothing needs you' : needs === 1 ? '1 thing needs you' : `${String(needs)} things need you`;

export const summaryText = (s: CombSummary): string =>
  [
    `${String(s.working)} working`,
    s.failed > 0 ? `${String(s.failed)} failed` : null,
    `${String(s.resting)} resting`,
    `${String(s.projects)} projects`,
    `${String(s.agents)} agents`,
  ]
    .filter((part) => part !== null)
    .join(' · ');

/**
 * The line over the comb (HIVE-199): how many things need you, then the rest.
 *
 * `needs` is the comb's own Summons count for now (decision D1). When HIVE-214
 * lands `useSummonsCount`, the caller reads that instead, so Home, the strip
 * and the pill can never show two numbers for one fact.
 */
export function CombHeadline({ summary }: { summary: CombSummary }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex items-baseline gap-3.5 bg-linear-to-b from-bg to-transparent px-7 py-[18px]">
      <h2 className={cn('text-[22px] font-[650] tracking-tight', summary.needs > 0 ? 'text-amber' : 'text-green')}>
        {headlineText(summary.needs)}
      </h2>
      <span className="text-muted">{summaryText(summary)}</span>
      <span className="flex-1" />
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">The Comb</span>
    </div>
  );
}
