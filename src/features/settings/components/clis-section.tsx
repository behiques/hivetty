import { SelectField } from '@/components/ui/select-field';

import { CopilotToken, HarnessAgentsGroup } from '@features/settings/components/harness-agents-group';
import { SettingsProviderGroup } from '@features/settings/components/settings-provider-group';
import { SettingsSectionHeader } from '@features/settings/components/settings-section-header';
import { SettingsGroup } from '@features/shared/components/settings-group';
import { useProjectConfig } from '@hooks/use-project-config';
import { CLI_NAMES } from '@lib/harness/cli-names';
import { setAgentsDefaultCliConfig } from '@lib/project-config';
import type { CliAgents } from '@shared/cli-contract';
import { HARNESS_IDS, type HarnessId } from '@shared/harness-contract';

const CLI_OPTIONS = HARNESS_IDS.map((cli) => ({ value: cli, label: CLI_NAMES[cli] }));

/**
 * Settings › CLIs (HIVE-341): each CLI's headless agent defaults. HIVE-332 adds the CLI's command,
 * version and sign-in above the Headless agents group, on this same page.
 *
 * Since HIVE-375 it sits below Settings › Harnesses › Overview, `embedded` in that pane's scroller and
 * titled "Headless agents", until HIVE-376 gives each CLI its own page (D7).
 */
export function ClisSection({ title = 'CLIs', embedded = false }: { title?: string; embedded?: boolean }) {
  const snapshot = useProjectConfig();

  if (!snapshot) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
        <SettingsSectionHeader title={title} description="CLI settings are only available in the desktop app." />
      </div>
    );
  }

  return (
    <div className={embedded ? 'flex flex-col gap-6' : 'flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4'}>
      <SettingsSectionHeader
        title={title}
        description="The agent CLIs this app drives, and how each one runs headless agents."
      />
      <SelectField
        className="max-w-xs"
        label="Default CLI for agents"
        value={snapshot.agentsDefaultCli ?? 'claude-code'}
        options={CLI_OPTIONS}
        onChange={(value) => void setAgentsDefaultCliConfig({ cli: value as HarnessId })}
        hint="For agents whose AGENT.md has no harness: field."
      />
      {HARNESS_IDS.map((cli) => (
        <CliCard key={cli} cli={cli} agents={snapshot.clis[cli].agents} />
      ))}
    </div>
  );
}

function CliCard({ cli, agents }: { cli: HarnessId; agents: CliAgents }) {
  return (
    <SettingsProviderGroup name={CLI_NAMES[cli]}>
      {cli === 'copilot' && (
        <SettingsGroup
          title="Sign-in"
          description="Copilot agents sign in with a token HiveTTY holds, never your own copilot login."
        >
          <CopilotToken />
        </SettingsGroup>
      )}
      <HarnessAgentsGroup cli={cli} agents={agents} />
    </SettingsProviderGroup>
  );
}
