import { Fragment, useState } from 'react';

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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu';
import { AccountAvatar } from '@features/shared/components/account-avatar';
import { useAccount } from '@hooks/use-account';
import { useLicence } from '@hooks/use-licence';
import { refreshOrgs, useActiveOrg, useOrgs } from '@hooks/use-orgs';
import { initialOf, openAccountWeb, signOut, switchOrg } from '@lib/account';
import { planLine } from '@lib/licence';
import { PLAN_NAMES, type PlanKey } from '@shared/feature-plans';
import { canManage, isTeam, orgBadge, type OrgSummary } from '@shared/orgs';
import { useSettingsActions } from '@stores/ui-store';

/** A switcher row's second line: "Team · Admin", or the role alone when the org has no plan. */
const orgLine = (org: OrgSummary): string =>
  org.plan ? `${PLAN_NAMES[org.plan as PlanKey] ?? org.plan} · ${org.role}` : org.role;

/**
 * The account menu, last at the foot of the activity bar (HIVE-265): who, which plan, the account site signed in,
 * Settings (the bar's only way in while signed in; a bare open, so it lands on the last pane), and Sign out behind a
 * confirm. HIVE-291: with two or more orgs, an Organisation section to
 * switch the org the lease comes from, and the active org's badge on the avatar.
 */
export function AccountMenu() {
  const account = useAccount();
  const licence = useLicence();
  const orgs = useOrgs();
  const active = useActiveOrg();
  const { openSettings } = useSettingsActions();
  const [confirming, setConfirming] = useState(false);
  if (account?.kind !== 'signed-in') return null;
  const plan = planLine(licence, Date.now());
  // The switcher and the badge only mean something with a second org to switch to.
  const switching = orgs.length >= 2;
  // D6: asked for one org, leased from another (no seat there). The line sits under the one asked for.
  const askedId = active && account.activeOrg !== active.id ? account.activeOrg : undefined;
  // D1: Owner, Admin and Billing of a team; with one org too.
  const managed = active && isTeam(active) && canManage(active.role) ? active : undefined;

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) refreshOrgs();
        }}
      >
        <DropdownMenuTrigger
          aria-label={active ? `Account, ${active.name}` : 'Account'}
          className={cn(
            'grid size-[52px] place-items-center rounded-lg hover:bg-hover',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          )}
        >
          <AccountAvatar
            initial={initialOf(account)}
            badge={switching && active ? orgBadge(active.name) : undefined}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" className="w-[230px]">
          <div className="flex flex-col gap-px px-2.5 pt-1.5 pb-2">
            <b className="text-control text-ink">{account.name || account.email}</b>
            <span className="text-ui-sm text-subtle">{account.email}</span>
            {plan ? <span className="text-ui-sm text-subtle">{plan}</span> : null}
          </div>
          {switching ? (
            <>
              <DropdownMenuLabel className="pt-0 pb-1 text-ui-sm font-semibold tracking-[0.06em] text-subtle uppercase">
                Organisation
              </DropdownMenuLabel>
              {orgs.map((org) => (
                <Fragment key={org.id}>
                  <DropdownMenuCheckboxItem checked={org.id === active?.id} onSelect={() => void switchOrg(org.id)}>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-ink">{org.name}</span>
                      <span className="text-ui-sm text-subtle">{orgLine(org)}</span>
                    </span>
                    {org.seat ? null : (
                      <span className="rounded border border-border px-1 text-micro text-subtle">No seat</span>
                    )}
                  </DropdownMenuCheckboxItem>
                  {org.id === askedId && active ? (
                    <p className="px-2 pb-1 pl-7 text-ui-sm text-amber-text">{`No seat in ${org.name}, using ${active.name}`}</p>
                  ) : null}
                </Fragment>
              ))}
            </>
          ) : null}
          <DropdownMenuSeparator className="my-1 bg-border-soft" />
          <DropdownMenuItem onSelect={() => void openAccountWeb('/account/plan')}>Plan &amp; billing…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void openAccountWeb('/account')}>Account…</DropdownMenuItem>
          {managed ? (
            <DropdownMenuItem onSelect={() => void openAccountWeb(`/admin?org=${encodeURIComponent(managed.id)}`)}>
              Manage organisation…
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => openSettings()}>Settings…</DropdownMenuItem>
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
