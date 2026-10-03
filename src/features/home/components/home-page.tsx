import { CombHeadline, headlineText, summaryText } from '@features/home/components/comb-headline';
import { FirstRun } from '@features/home/components/first-run';
import { HomeStrip } from '@features/home/components/home-strip';
import { TheComb } from '@features/home/components/the-comb';
import { useCombSummary, useProjects } from '@stores/hive-store';

/**
 * Home under the Round two layout: the headline over The Comb (HIVE-199), the
 * strip under it (HIVE-200), or the first-run page while no project is mapped.
 *
 * The visually hidden `<h1>` keeps the page named for assistive tech and for
 * the shell's own tests; what a sighted reader sees first is the headline.
 */
export function HomePage() {
  const summary = useCombSummary();
  const firstRun = useProjects().length === 0;
  return (
    <section aria-label="Home" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <h1 className="sr-only">Home</h1>
      {firstRun ? (
        <FirstRun />
      ) : (
        <>
          <div className="relative">
            <TheComb label={`${headlineText(summary.needs)}. ${summaryText(summary)}`} />
            <CombHeadline summary={summary} />
          </div>
          <HomeStrip />
        </>
      )}
    </section>
  );
}
