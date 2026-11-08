import type { KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

import { AccountAvatar } from '@features/shared/components/account-avatar';
import { useAccount } from '@hooks/use-account';
import { useLicence } from '@hooks/use-licence';
import { initialOf } from '@lib/account';
import { planLine } from '@lib/licence';

/**
 * The top of the Settings nav: who is signed in and on which plan, opening the Account centre. It replaced the
 * Account group's three rows, which are the centre's tabs now. It is the nav row for all three account pane ids, so
 * it carries `data-pane="account-devices"` and is current whenever one of them is showing.
 */
export function SettingsProfileCard({
  active,
  onOpen,
  onKeyDown,
}: {
  active: boolean;
  onOpen: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const account = useAccount();
  const licence = useLicence();
  const signedIn = account?.kind === 'signed-in';
  const name = signedIn ? account.name || account.email : '';
  const plan = signedIn ? planLine(licence, Date.now()) : null;

  return (
    <button
      type="button"
      data-pane="account-devices"
      aria-label={name ? `Account, ${name}` : 'Account'}
      aria-current={active ? 'page' : undefined}
      tabIndex={active ? 0 : -1}
      onKeyDown={onKeyDown}
      onClick={onOpen}
      className={cn(
        'flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left outline-none',
        'focus-visible:ring-1 focus-visible:ring-brand',
        active ? 'border-border bg-active' : 'border-border-soft hover:bg-hover',
      )}
    >
      {signedIn ? (
        <AccountAvatar initial={initialOf(account)} />
      ) : (
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-chip text-micro text-muted">
          ?
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-ui font-semibold text-ink">{signedIn ? name : 'Account'}</span>
        <span className="truncate text-ui-sm text-subtle">{signedIn ? (plan ?? 'Account and plan') : 'Not signed in'}</span>
      </span>
    </button>
  );
}
