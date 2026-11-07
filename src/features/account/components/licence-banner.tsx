import { Button } from '@components/ui/button';
import { useChoosePlan } from '@features/account/hooks/use-choose-plan';
import { bannerFor } from '@features/account/lib/banner';
import { useLicence } from '@hooks/use-licence';
import { refreshLicence } from '@lib/licence';
import { useDismissedTrialThreshold, useDismissTrialBanner } from '@stores/ui-store';

const trialCopy = (days: number): string =>
  days === 0
    ? 'Your trial ends today.'
    : days === 1
      ? 'Your trial ends tomorrow.'
      : `Your trial ends in ${String(days)} days.`;

/**
 * Across the top of the stage, in `ReconnectLine`'s style (HIVE-265).
 * shortcut: re-evaluated on each render and licence push (daily renewal), not on a clock. Add a tick if a
 * threshold must show the moment it is crossed.
 */
export function LicenceBanner() {
  const licence = useLicence();
  const dismissed = useDismissedTrialThreshold();
  const dismiss = useDismissTrialBanner();
  const choose = useChoosePlan();
  const banner = bannerFor(licence, Date.now(), dismissed);
  if (banner === null) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-soft bg-amber-strong px-4 py-2 text-control text-amber-text"
    >
      {banner.kind === 'offline' ? (
        <>
          <span className="flex-1">
            <b>{`Offline for ${String(banner.days)} days.`}</b>
            {` Connect within ${String(banner.left)} day${banner.left === 1 ? '' : 's'} to keep working.`}
          </span>
          <Button size="sm" onClick={() => void refreshLicence()}>
            Retry
          </Button>
        </>
      ) : choose.waiting ? (
        <>
          <span className="flex-1">Finish in your browser…</span>
          <Button size="sm" onClick={choose.cancel}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1">
            <b>{trialCopy(banner.days)}</b>
          </span>
          <Button size="sm" variant="primary" onClick={choose.start}>
            Choose a plan
          </Button>
          <Button size="sm" variant="ghost" onClick={() => dismiss(banner.threshold)}>
            Dismiss
          </Button>
        </>
      )}
    </div>
  );
}
