import { SelectField } from '@/components/ui/select-field';
import { Switch } from '@/components/ui/switch';

import { SettingsProviderGroup } from '@features/settings/components/settings-provider-group';
import { SettingsSectionHeader } from '@features/settings/components/settings-section-header';
import { SettingsGroup } from '@features/shared/components/settings-group';
import { useProjectConfig } from '@hooks/use-project-config';
import { setCliAgentsConfig } from '@lib/project-config';
import { CLI_VOCAB, type CliAgents } from '@shared/cli-contract';
import { HARNESS_IDS, type HarnessId } from '@shared/harness-contract';

/** A CLI's name as a person reads it. A new CLI adds a row (HIVE-342, HIVE-343). */
const CLI_NAMES: Record<HarnessId, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };

const CLI_DEFAULT = { value: '', label: 'CLI default' };
const options = (values: readonly string[]) => [
  CLI_DEFAULT,
  ...values.map((value) => ({ value, label: value })),
];

/**
 * Settings › CLIs (HIVE-341): each CLI's headless agent defaults. HIVE-332 adds the CLI's command,
 * version and sign-in above the Headless agents group, on this same page.
 */
export function ClisSection() {
  const snapshot = useProjectConfig();

  if (!snapshot) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
        <SettingsSectionHeader
          title="CLIs"
          description="CLI settings are only available in the desktop app."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
      <SettingsSectionHeader
        title="CLIs"
        description="The agent CLIs this app drives, and how each one runs headless agents."
      />
      {HARNESS_IDS.map((cli) => (
        <CliCard key={cli} cli={cli} agents={snapshot.clis[cli].agents} />
      ))}
    </div>
  );
}

function CliCard({ cli, agents }: { cli: HarnessId; agents: CliAgents }) {
  const name = CLI_NAMES[cli];
  const { models, efforts } = CLI_VOCAB[cli];

  return (
    <SettingsProviderGroup name={name}>
      <SettingsGroup
        title="Headless agents"
        description={`Defaults for agent runs on ${name}. An agent's own model: or effort: in AGENT.md wins.`}
      >
        <Switch
          label="Enabled for agents"
          checked={agents.enabled}
          onCheckedChange={(enabled) => void setCliAgentsConfig({ cli, enabled })}
          description={
            agents.enabled
              ? `Agents run on ${name} unless their harness: says otherwise.`
              : `Off: agents skip ${name}, and with no other CLI enabled they refuse to run.`
          }
        />
        {/* A native fieldset disables both selects at once; the dim says they are inert. */}
        <fieldset disabled={!agents.enabled} className="flex gap-3 disabled:opacity-50">
          <SelectField
            className="min-w-0 flex-1"
            label="Model"
            value={agents.model ?? ''}
            options={options(models)}
            onChange={(value) =>
              void setCliAgentsConfig({ cli, model: value || null })
            }
          />
          <SelectField
            className="min-w-0 flex-1"
            label="Effort"
            value={agents.effort ?? ''}
            options={options(efforts)}
            onChange={(value) =>
              void setCliAgentsConfig({ cli, effort: value || null })
            }
          />
        </fieldset>
        <p className="text-ui-sm text-subtle">CLI default leaves the flag off, so {name} picks.</p>
      </SettingsGroup>
    </SettingsProviderGroup>
  );
}
