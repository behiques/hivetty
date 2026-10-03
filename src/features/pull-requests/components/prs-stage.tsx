import { EmptyHatchery } from '@features/pull-requests/components/empty-hatchery';
import { GhSetupPage } from '@features/pull-requests/components/gh-setup-page';
import { PrPage } from '@features/pull-requests/components/pr-page';
import { useOpenPr } from '@features/pull-requests/open-pr';
import { prKey, usePrsListed, usePrsQuiet } from '@stores/hive-store';

/**
 * The PRs place's stage (HIVE-205): the empty Hatchery when the live sweep is
 * empty, else the page the opening rule picks (D14), else why gh gave nothing
 * (HIVE-211), else a prompt while the sweep is loading.
 */
export function PrsStage() {
  const quiet = usePrsQuiet();
  const row = useOpenPr();
  const listed = usePrsListed();

  if (quiet) return <EmptyHatchery />;
  if (row === null && !listed) return <GhSetupPage />;
  if (row === null) {
    return (
      <section aria-label="Pull requests" className="flex flex-1 items-center justify-center">
        <p className="text-[13px] text-subtle">Pick a pull request</p>
      </section>
    );
  }
  return <PrPage key={prKey(row.pr.owner, row.pr.repo, row.pr.n)} row={row} />;
}
