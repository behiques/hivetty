import { ArrowSquareOut } from '@phosphor-icons/react';

import { Button } from '@components/ui/button';
import { Fact } from '@features/settings/components/plan-licence-section';
import { SettingsGroup } from '@features/shared/components/settings-group';
import { useActiveOrg } from '@hooks/use-orgs';
import { openAccountWeb } from '@lib/account';
import { PLAN_NAMES, type PlanKey } from '@shared/feature-plans';
import { canManage, isTeam } from '@shared/orgs';

/**
 * The Account center's Organization tab (HIVE-291's pane): the active org, when it is a team (D2). The tab is shown
 * only then; a deep link with no team org says so (D3). Members and seats are managed on the web (D1).
 */
export function AccountOrgSection() {
  const active = useActiveOrg();
  const org = active && isTeam(active) ? active : undefined;

  return org ? (
        <SettingsGroup title="Membership" description="Read from HiveTTY each time the account menu opens.">
          <div className="flex flex-col gap-1 rounded-lg border border-border-soft p-3">
            <Fact label="Name" value={org.name} />
            <Fact label="Your role" value={org.role} />
            <Fact label="Seat" value={org.seat ? 'Seated' : 'No seat'} />
            <Fact label="Plan" value={org.plan ? (PLAN_NAMES[org.plan as PlanKey] ?? org.plan) : 'No plan'} />
          </div>
          {canManage(org.role) ? (
            <div className="flex">
              <Button size="sm" onClick={() => void openAccountWeb(`/admin?org=${encodeURIComponent(org.id)}`)}>
                Manage members and seats
                <ArrowSquareOut size={13} aria-hidden />
              </Button>
            </div>
          ) : null}
        </SettingsGroup>
  ) : (
    <p className="text-control text-subtle">You&apos;re not in a team organization.</p>
  );
}
