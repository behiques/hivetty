import { useState } from 'react';

import { cn } from '@/lib/utils';

import { Button } from '@components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu';
import { AccountAvatar } from '@features/shared/components/account-avatar';
import { useAccount } from '@hooks/use-account';
import { useLicence } from '@hooks/use-licence';
import { initialOf, openAccountWeb, signOut } from '@lib/account';
import { planLine } from '@lib/licence';
import { useSettingsActions } from '@stores/ui-store';

/**
 * The account menu at the foot of the activity bar, above the gear (HIVE-265): who, which plan, the account site
 * signed in, Settings, and Sign out behind a confirm.
 */
export function AccountMenu() {
  const account = useAccount();
  const licence = useLicence();
  const { openSettings } = useSettingsActions();
  const [confirming, setConfirming] = useState(false);
  if (account?.kind !== 'signed-in') return null;
  const plan = planLine(licence, Date.now());

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Account"
          className={cn(
            'grid size-[52px] place-items-center rounded-lg hover:bg-hover',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          )}
        >
          <AccountAvatar initial={initialOf(account)} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" className="w-[230px]">
          <div className="flex flex-col gap-px px-2.5 pt-1.5 pb-2">
            <b className="text-control text-ink">{account.name || account.email}</b>
            <span className="text-ui-sm text-subtle">{account.email}</span>
            {plan ? <span className="text-ui-sm text-subtle">{plan}</span> : null}
          </div>
          <DropdownMenuSeparator className="my-1 bg-border-soft" />
          <DropdownMenuItem onSelect={() => void openAccountWeb('/account/plan')}>Plan &amp; billing…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void openAccountWeb('/account')}>Account…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openSettings('account-devices')}>Settings…</DropdownMenuItem>
          <DropdownMenuSeparator className="my-1 bg-border-soft" />
          <DropdownMenuItem onSelect={() => setConfirming(true)}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showCloseButton={false} className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Sign out of HiveTTY Pro?</DialogTitle>
            <DialogDescription className="text-control">Running work pauses until you sign in again.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                void signOut();
              }}
            >
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
