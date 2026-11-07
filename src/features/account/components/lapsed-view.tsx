import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

import { Button } from '@components/ui/button';
import { GateFooter, Heading, LINK, PlanWait } from '@features/account/components/gate-parts';
import { useChoosePlan } from '@features/account/hooks/use-choose-plan';
import type { GateView, LapsedReason } from '@features/account/lib/gate-view';
import { formatLastUsed } from '@hooks/use-relative-time';
import { readPaused, refreshLicence } from '@lib/licence';
import type { Paused } from '@shared/licence-contract';

/** The ticket's lapse table (HIVE-265), with the prototype's one line each. `unknown` has none. */
const LAPSE: Record<LapsedReason, { heading: string; line?: string; action: 'plan' | 'payment' | 'retry'; warn?: true }> = {
  trial_ended: { heading: 'Your trial has ended', line: 'Your work is paused until you choose a plan.', action: 'plan' },
  plan_cancelled: { heading: 'Your plan has ended', line: 'Your work is paused until you choose a plan.', action: 'plan' },
  payment_failed: {
    heading: 'Your payment failed',
    line: 'Update your payment method to continue.',
    action: 'payment',
    warn: true,
  },
  seat_removed: { heading: 'Your seat was removed', line: 'Your work is paused until you choose a plan.', action: 'plan' },
  offline: {
    heading: "Can't reach HiveTTY",
    line: 'Connect to the internet to renew your licence.',
    action: 'retry',
    warn: true,
  },
  unknown: { heading: 'Your licence has lapsed', action: 'retry' },
};

const LABEL = { plan: 'Choose a plan', payment: 'Update payment method', retry: 'Retry' } as const;

const count = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? '' : 's'}`;

function PausedLine({ paused }: { paused: Paused }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-soft bg-panel-2 px-3 py-2.5">
      <div className="flex items-center gap-2 text-control">
        <span className="size-[7px] shrink-0 rounded-full bg-brand" aria-hidden />
        <span className="flex-1">{`Paused: ${count(paused.sessions.length, 'session')}, ${count(paused.agents.length, 'agent')}`}</span>
        <button type="button" aria-expanded={open} className={LINK} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Details'}
        </button>
      </div>
      {open ? (
        <ul className="flex flex-col gap-0.5 pl-4 font-mono text-ui-sm text-muted">
          {paused.sessions.map((name, i) => (
            <li key={`s${String(i)}`}>{`${name} · session`}</li>
          ))}
          {paused.agents.map((name) => (
            <li key={`a${name}`}>{`${name} · agent`}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function LapsedView({ view }: { view: Extract<GateView, { kind: 'lapsed' }> }) {
  const row = LAPSE[view.reason];
  const choose = useChoosePlan();
  const [paused, setPaused] = useState<Paused | null>(null);
  const [retrying, setRetrying] = useState(false);

  // Read once on mount: while lapsed nothing new can start, so the list cannot grow.
  useEffect(() => {
    let live = true;
    void readPaused().then((read) => {
      if (live) setPaused(read);
    });
    return () => {
      live = false;
    };
  }, []);

  const onRetry = async (): Promise<void> => {
    setRetrying(true);
    try {
      await refreshLicence();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <>
      <div className="flex items-start gap-2.5">
        <span className={cn('mt-2.5 size-2 shrink-0 rounded-full', row.warn ? 'bg-brand' : 'bg-red')} aria-hidden />
        <div className="flex flex-col gap-1">
          <Heading>{row.heading}</Heading>
          {row.line ? <p className="text-control text-muted">{row.line}</p> : null}
        </div>
      </div>
      {choose.waiting ? (
        <PlanWait cancel={choose.cancel} />
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            className="w-full"
            pending={retrying}
            onClick={row.action === 'retry' ? () => void onRetry() : choose.start}
          >
            {LABEL[row.action]}
          </Button>
          {view.reason === 'offline' && view.checkedAt !== undefined ? (
            <span className="text-ui-sm text-subtle">{`Last checked ${formatLastUsed(view.checkedAt * 1000, Date.now())}`}</span>
          ) : null}
          {choose.error ? <p className="text-ui-sm text-red">{choose.error}</p> : null}
        </div>
      )}
      {paused && paused.sessions.length + paused.agents.length > 0 ? <PausedLine paused={paused} /> : null}
      <GateFooter email={view.email} />
    </>
  );
}
