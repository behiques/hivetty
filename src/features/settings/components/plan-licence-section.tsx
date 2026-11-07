import { useState } from 'react';

import { Button } from '@components/ui/button';
import { SettingsSectionHeader } from '@features/settings/components/settings-section-header';
import { SettingsGroup } from '@features/shared/components/settings-group';
import { useLicence } from '@hooks/use-licence';
import { openAccountWeb } from '@lib/account';
import { refreshLicence, trialDaysLeft } from '@lib/licence';
import { UPGRADE_PATH } from '@shared/entitlement';
import { PLAN_NAMES, type PlanKey } from '@shared/feature-plans';
import type { LapseReason, LicenceTerms } from '@shared/licence-contract';

/**
 * Account › Plan & licence (HIVE-268): what this Mac's lease includes, and until when it works offline.
 * Read from `useLicence()`; seats are not in the lease, so they are not shown here.
 */

const LAPSE: Record<LapseReason, string> = {
  offline: 'HiveTTY has been unreachable for longer than the licence lasts offline.',
  signed_out: 'Sign in to see your plan.',
  trial_ended: 'Your trial has ended.',
  plan_cancelled: 'Your plan was cancelled.',
  payment_failed: 'The last payment failed.',
  device_revoked: 'This Mac was removed from your account.',
  seat_removed: 'Your seat was removed.',
  no_plan: 'Your account has no plan.',
  unknown: 'Your licence has lapsed.',
};

/** One label/value row, as in Updates & About. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-control text-subtle">{label}</span>
      <span className="truncate tabular-nums text-ui-sm text-ink">{value}</span>
    </div>
  );
}

const expiry = (exp: number): string =>
  new Date(exp * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function Facts({ terms, grace }: { terms: LicenceTerms & { kind: 'licensed' | 'grace' }; grace: boolean }) {
  const days = trialDaysLeft(terms, Date.now());
  const runners = terms.limits.runners;
  return (
    <>
      <div className="flex flex-col gap-1 rounded-lg border border-border-soft p-3">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-control text-subtle">Plan</span>
          <span className="flex items-baseline gap-2">
            {days !== null && (
              <span className="text-ui-sm text-muted">{`Trial · ${String(days)} day${days === 1 ? '' : 's'} left`}</span>
            )}
            <span className="text-ui-sm text-ink">{PLAN_NAMES[terms.plan as PlanKey] ?? terms.plan}</span>
          </span>
        </div>
        <Fact label="Devices per seat" value={String(terms.limits.devices ?? '')} />
        <Fact label="Runners" value={runners === undefined ? 'Uncapped' : String(runners)} />
        <Fact label="Works offline until" value={expiry(terms.exp)} />
      </div>
      {grace && (
        <p className="text-ui-sm text-subtle">
          {`Couldn't reach HiveTTY. This licence keeps working until ${expiry(terms.exp)}.`}
        </p>
      )}
    </>
  );
}

export function PlanLicenceSection() {
  const licence = useLicence();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await refreshLicence();
    } finally {
      setRefreshing(false);
    }
  };

  const onManage = async (): Promise<void> => {
    const result = await openAccountWeb(UPGRADE_PATH);
    setError(result && 'error' in result ? result.error : null);
  };

  const signedOut = licence === null || licence.kind === 'unlicensed';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
      <SettingsSectionHeader
        title="Plan & licence"
        description="What this Mac's licence includes, and until when it works offline."
      />

      {signedOut ? (
        <p className="text-control text-subtle">Sign in to see your plan.</p>
      ) : (
        <SettingsGroup title="Licence" description="The plan this Mac's lease carries.">
          {licence.kind === 'lapsed' ? (
            <p className="text-control text-muted">{LAPSE[licence.reason]}</p>
          ) : (
            <Facts terms={licence} grace={licence.kind === 'grace'} />
          )}
          <div className="flex flex-col items-start gap-1">
            <div className="flex items-center gap-2">
              <Button pending={refreshing} disabled={refreshing} onClick={() => void onRefresh()}>
                Refresh licence
              </Button>
              <Button variant="primary" onClick={() => void onManage()}>
                Manage plan
              </Button>
            </div>
            {error && <span className="text-ui-sm text-red">{error}</span>}
          </div>
        </SettingsGroup>
      )}
    </div>
  );
}
