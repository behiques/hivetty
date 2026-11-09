import { ArrowSquareOut } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { Button } from '@components/ui/button';
import { BillingPayments } from '@features/settings/components/billing-payments';
import { SettingsGroup } from '@features/shared/components/settings-group';
import { useLicence } from '@hooks/use-licence';
import { useActiveOrg } from '@hooks/use-orgs';
import { openAccountWeb, openBilling, readBilling } from '@lib/account';
import { refreshLicence, trialDaysLeft } from '@lib/licence';
import type { BillingSubscription, BillingSummary } from '@shared/account-contract';
import { UPGRADE_PATH } from '@shared/entitlement';
import { PLAN_NAMES, type PlanKey } from '@shared/feature-plans';
import type { LapseReason, LicenceTerms } from '@shared/licence-contract';

/**
 * The Account centre's Plan & billing tab (HIVE-268's Plan & licence pane): the org's subscription from the cloud,
 * then what this Mac's lease includes and until when it works offline. The subscription (seats, period, renewal) is
 * read with `GET /api/billing`; when the cloud has nothing to show this caller it is left out and the lease stands
 * alone. The card and invoices are BillingPayments'; Manage billing opens Stripe's portal. Changing the plan stays on
 * the account site.
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
export function Fact({ label, value }: { label: string; value: string }) {
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

const STATUS: Record<string, string> = {
  active: 'Active',
  trialing: 'Trial',
  past_due: 'Payment due',
  unpaid: 'Unpaid',
  canceled: 'Cancelled',
  incomplete: 'Awaiting payment',
};

const day = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

function Subscription({ billing, sub, orgId }: { billing: BillingSummary; sub: BillingSubscription; orgId?: string }) {
  const used = Math.min(billing.seated, sub.seats);
  const [error, setError] = useState<string | null>(null);
  const onManage = async (): Promise<void> => {
    const result = await openBilling(orgId);
    setError(result && 'error' in result ? result.error : null);
  };
  return (
    <SettingsGroup title="Subscription" description="What the account site bills for this organisation.">
      <div className="flex flex-col gap-1 rounded-lg border border-border-soft p-3">
        <Fact label="Plan" value={PLAN_NAMES[sub.plan as PlanKey] ?? sub.plan} />
        <Fact label="Status" value={STATUS[sub.status] ?? sub.status} />
        {sub.interval ? <Fact label="Billed" value={sub.interval === 'month' ? 'Monthly' : 'Yearly'} /> : null}
        <Fact label="Seats" value={`${String(billing.seated)} of ${String(sub.seats)} in use`} />
        <div
          role="meter"
          aria-label="Seats in use"
          aria-valuemin={0}
          aria-valuemax={sub.seats}
          aria-valuenow={billing.seated}
          className="h-1.5 overflow-hidden rounded-full bg-chip"
        >
          <div className="h-full bg-brand-fill" style={{ width: `${String(sub.seats > 0 ? (used / sub.seats) * 100 : 0)}%` }} />
        </div>
        {sub.renewsAt ? <Fact label={sub.cancelAtPeriodEnd ? 'Ends on' : 'Renews on'} value={day(sub.renewsAt)} /> : null}
      </div>
      <div className="flex flex-col items-start gap-1">
        <Button size="sm" onClick={() => void onManage()}>
          Manage billing
          <ArrowSquareOut size={13} aria-hidden />
        </Button>
        {error ? <span className="text-ui-sm text-red">{error}</span> : null}
      </div>
    </SettingsGroup>
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
  const orgId = useActiveOrg()?.id;
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  useEffect(() => {
    if (signedOut) return;
    let cancelled = false;
    void readBilling(orgId).then((next) => {
      if (!cancelled) setBilling(next);
    });
    return () => {
      cancelled = true;
    };
  }, [signedOut, orgId]);

  return (
    <>
      {!signedOut && billing?.subscription ? (
        <Subscription billing={billing} sub={billing.subscription} orgId={orgId} />
      ) : null}
      {signedOut ? null : <BillingPayments key={orgId ?? ''} orgId={orgId} />}
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
    </>
  );
}
