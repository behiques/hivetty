import type { ComponentType } from 'react';

import { cn } from '@/lib/utils';

import { AccountDevicesSection } from '@features/settings/components/account-devices-section';
import { AccountOrgSection } from '@features/settings/components/account-org-section';
import { PlanLicenceSection } from '@features/settings/components/plan-licence-section';
import { SettingsSectionHeader } from '@features/settings/components/settings-section-header';
import { useActiveOrg } from '@hooks/use-orgs';
import { onTablistKeyDown } from '@lib/tablist';
import { isTeam } from '@shared/orgs';
import { useSettingsActions } from '@stores/ui-store';

/** The three account pane ids, each now a tab here. The ids stay, so every `openSettings` deep link still lands. */
export const ACCOUNT_TABS = [
  { id: 'account-devices', label: 'Profile & devices', Body: AccountDevicesSection },
  { id: 'plan-licence', label: 'Plan & billing', Body: PlanLicenceSection },
  { id: 'account-org', label: 'Organisation', Body: AccountOrgSection },
] as const satisfies readonly { id: string; label: string; Body: ComponentType }[];

export type AccountTab = (typeof ACCOUNT_TABS)[number]['id'];

/**
 * The native Account centre, inside Settings: reached from the profile card at the top of the Settings nav and from
 * the avatar menu's Account centre. One pane, three tabs. A tab is `openSettings(id)`, the same request a deep link
 * makes, so the nav, the menu and the tabs agree on where the user is. Organisation is a tab only for a team org.
 */
export function AccountCentre({ tab }: { tab: AccountTab }) {
  const active = useActiveOrg();
  const { openSettings } = useSettingsActions();
  const team = active !== undefined && isTeam(active);
  const tabs = ACCOUNT_TABS.filter((entry) => entry.id !== 'account-org' || team || tab === 'account-org');
  const current = ACCOUNT_TABS.find((entry) => entry.id === tab) ?? ACCOUNT_TABS[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
      <SettingsSectionHeader title="Account" description="Who is signed in, your plan and billing, and your team." />
      <div role="tablist" aria-label="Account" className="flex gap-1 text-ui-sm text-muted">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`account-tab-${entry.id}`}
            aria-selected={entry.id === current.id}
            aria-controls="account-tabpanel"
            tabIndex={entry.id === current.id ? 0 : -1}
            onKeyDown={onTablistKeyDown}
            onClick={() => openSettings(entry.id)}
            className={cn('rounded-full px-2.5 py-1', entry.id === current.id ? 'bg-active text-ink' : 'hover:bg-hover')}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="account-tabpanel"
        aria-labelledby={`account-tab-${current.id}`}
        className="flex flex-col gap-6"
      >
        <current.Body />
      </div>
    </div>
  );
}
