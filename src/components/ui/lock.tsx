import { useId, useState } from 'react';

import { cn } from '@/lib/utils';

import { Button } from '@components/ui/button';
import { Chip } from '@components/ui/chip';
import { Icon } from '@components/ui/icon';
import { openAccountWeb } from '@lib/account';
import { UPGRADE_PATH } from '@shared/entitlement';

/** Upgrade, through `account:open-web` (HIVE-268): the click and its error, shared by Lock and UpgradeLink. */
export function useUpgrade(): { upgrade: () => void; error: string | null } {
  const [error, setError] = useState<string | null>(null);
  const upgrade = () => {
    void openAccountWeb(UPGRADE_PATH).then((result) => setError(result && 'error' in result ? result.error : null));
  };
  return { upgrade, error };
}

/** The inline Upgrade beside a lock's reason (HIVE-332): the dock, an Overview row, the agents default. */
export function UpgradeLink({ className }: { className?: string }) {
  const { upgrade, error } = useUpgrade();
  return (
    <>
      <button type="button" onClick={upgrade} className={cn('text-brand hover:underline', className)}>
        Upgrade
      </button>
      {error && <span className="text-ui-sm text-red">{error}</span>}
    </>
  );
}

export type LockProps =
  | { kind: 'plan'; reason: string }
  | { kind: 'policy'; reason: string }
  | { kind: 'install'; reason: string; onInstall: () => void };

/**
 * A feature this machine can't use yet, shown rather than hidden (HIVE-268). Three reasons share one look:
 * not in the plan (Upgrade, through `account:open-web`), managed by policy (HIVE-313), not installed (HIVE-375).
 */
export function Lock(props: LockProps) {
  const reasonId = useId();
  const { upgrade, error } = useUpgrade();

  return (
    <div
      role="note"
      aria-labelledby={reasonId}
      className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-panel p-4"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-chip text-muted">
        <Icon name="ph-lock" size={14} />
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <span id={reasonId} className="text-ui text-ink">
          {props.reason}
        </span>
        {props.kind === 'plan' && (
          <div className="flex flex-col items-start gap-1">
            <Button variant="primary" onClick={upgrade}>
              Upgrade
            </Button>
            {error && <span className="text-ui-sm text-red">{error}</span>}
          </div>
        )}
        {props.kind === 'policy' && <span className="text-ui-sm text-subtle">Ask your admin.</span>}
        {props.kind === 'install' && (
          <Button onClick={props.onInstall} className="self-start">
            Install
          </Button>
        )}
      </div>
    </div>
  );
}

/** The nav row's lock: a glyph and the plan that includes it. */
export function LockMark({ plan, className }: { plan: string | null; className?: string }) {
  return (
    <span
      aria-label={plan ? `Locked: ${plan}` : 'Locked'}
      className={cn('ml-auto inline-flex items-center gap-1 text-subtle', className)}
    >
      <Icon name="ph-lock" size={12} />
      {plan && <Chip className="px-1.5 py-0 text-ui-sm">{plan}</Chip>}
    </span>
  );
}
