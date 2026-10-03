import { CombHeadline, headlineText, summaryText } from '@features/home/components/comb-headline';
import { TheComb } from '@features/home/components/the-comb';
import { useCombSummary } from '@stores/hive-store';

/**
 * Home under the Round two layout (HIVE-199): the headline over The Comb.
 *
 * The visually hidden `<h1>` keeps the page named for assistive tech and for
 * the shell's own tests; what a sighted reader sees first is the headline.
 */
export function HomePage() {
  const summary = useCombSummary();
  return (
    <section aria-label="Home" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <h1 className="sr-only">Home</h1>
      <div className="relative">
        <TheComb label={`${headlineText(summary.needs)}. ${summaryText(summary)}`} />
        <CombHeadline summary={summary} />
      </div>
      {/* HIVE-200's strip mounts here, under the comb. */}
    </section>
  );
}
