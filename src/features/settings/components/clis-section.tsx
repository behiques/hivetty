import { Plus, Trash } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { SecretField } from '@/components/ui/secret-field';
import { SelectField } from '@/components/ui/select-field';
import { Switch } from '@/components/ui/switch';
import { TextField } from '@/components/ui/text-field';

import { SettingsProviderGroup } from '@features/settings/components/settings-provider-group';
import { SettingsSectionHeader } from '@features/settings/components/settings-section-header';
import { SettingsGroup } from '@features/shared/components/settings-group';
import { useProjectConfig } from '@hooks/use-project-config';
import { clearCliToken, cliTokensState, setCliToken } from '@lib/cli-tokens';
import { setAgentsDefaultCliConfig, setCliAgentsConfig } from '@lib/project-config';
import {
  CLI_VOCAB,
  COPILOT_DENY_PATTERN,
  HEADLESS_SANDBOXES,
  type CliAgents,
  type CliTokensState,
  type HeadlessSandbox,
} from '@shared/cli-contract';
import { HARNESS_IDS, type HarnessId } from '@shared/harness-contract';

/** A CLI's name as a person reads it. A new CLI adds a row (HIVE-342, HIVE-343). */
const CLI_NAMES: Record<HarnessId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  copilot: 'Copilot',
};

const CLI_OPTIONS = HARNESS_IDS.map((cli) => ({ value: cli, label: CLI_NAMES[cli] }));
// workspace-write first: it is what an unset card runs (HIVE-342). No "CLI default": codex's own is not ours.
const SANDBOX_OPTIONS = HEADLESS_SANDBOXES.map((value) => ({ value, label: value })).reverse();

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
  const name = CLI_NAMES[cli];
  const { models, efforts } = CLI_VOCAB[cli];

  return (
    <SettingsProviderGroup name={name}>
      {cli === 'copilot' && (
        <SettingsGroup
          title="Sign-in"
          description="Copilot agents sign in with a token HiveTTY holds, never your own copilot login."
        >
          <CopilotToken />
          <DenyPatterns deny={agents.deny ?? NO_PATTERNS} />
        </SettingsGroup>
      )}
      <SettingsGroup
        title="Headless agents"
        description={`Defaults for agent runs on ${name}. ${
          cli === 'claude-code'
            ? "An agent's own model: or effort: in AGENT.md wins."
            : "AGENT.md's model: and effort: are Claude's, so these always apply."
        }`}
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
          {cli === 'codex' && (
            <SelectField
              className="min-w-0 flex-1"
              label="Sandbox"
              value={agents.sandbox ?? 'workspace-write'}
              options={SANDBOX_OPTIONS}
              onChange={(value) =>
                void setCliAgentsConfig({ cli, sandbox: value as HeadlessSandbox })
              }
            />
          )}
        </fieldset>
        <p className="text-ui-sm text-subtle">CLI default leaves the flag off, so {name} picks.</p>
        {cli === 'codex' && (
          <p className="text-ui-sm text-subtle">
            The sandbox defaults to workspace-write: an agent writes only inside its own workdir.
          </p>
        )}
      </SettingsGroup>
    </SettingsProviderGroup>
  );
}

const NO_PATTERNS: readonly string[] = [];

/**
 * Which CLIs hold a token (HIVE-343): read once on mount, then replaced by each write's answer.
 * `null` until the read lands, and when there is no bridge. Local to this file: nothing else reads it.
 */
function useCliTokens(): [CliTokensState | null, (next: CliTokensState) => void] {
  const [tokens, setTokens] = useState<CliTokensState | null>(null);

  useEffect(() => {
    let cancelled = false;

    void cliTokensState().then((next) => {
      if (!cancelled) setTokens(next);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return [tokens, setTokens];
}

/** Copilot's token: write-only, presence described by the placeholder (HIVE-343). */
function CopilotToken() {
  const [tokens, setTokens] = useCliTokens();
  const [draft, setDraft] = useState('');

  if (tokens === null) return null;
  if (!tokens.encryptionAvailable) {
    return (
      <p className="text-ui-sm text-subtle">This system has no keyring, so no token can be stored.</p>
    );
  }

  const commit = () => {
    const token = draft.trim();
    if (token === '') return;
    setDraft('');
    void setCliToken({ cli: 'copilot', token }).then((next) => next && setTokens(next));
  };

  return (
    <>
      <SecretField
        label="Token"
        value={draft}
        onChange={setDraft}
        onCommit={commit}
        placeholder={tokens.copilot ? 'Replace the stored token' : 'gho_… or github_pat_…'}
        hint="A fine-grained PAT with Copilot Requests, or an OAuth token (gho_…). Stored encrypted; agents get it as COPILOT_GITHUB_TOKEN."
      />
      {tokens.copilot && (
        <div>
          <Button
            variant="danger"
            size="sm"
            onClick={() =>
              void clearCliToken({ cli: 'copilot' }).then((next) => next && setTokens(next))
            }
          >
            Clear token
          </Button>
        </div>
      )}
    </>
  );
}

const valid = (row: string) => COPILOT_DENY_PATTERN.test(row.trim());

/** Copilot's `--deny-tool` patterns (HIVE-343). A list with any invalid row commits nothing. */
function DenyPatterns({ deny }: { deny: readonly string[] }) {
  const [rows, setRows] = useState<string[]>([...deny]);

  useEffect(() => setRows([...deny]), [deny]);

  const save = (next: string[]) => {
    const kept = next.map((row) => row.trim()).filter((row) => row !== '');
    if (!kept.every(valid)) return;
    void setCliAgentsConfig({ cli: 'copilot', deny: kept.length === 0 ? null : kept });
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-control text-muted">Deny patterns</span>
      {rows.map((row, index) => (
        <div key={index} className="flex items-end gap-2">
          <TextField
            className="min-w-0 flex-1"
            label={`Deny pattern ${String(index + 1)}`}
            value={row}
            placeholder="shell(git push)"
            onChange={(value) =>
              setRows((current) => current.map((old, at) => (at === index ? value : old)))
            }
            onCommit={() => save(rows)}
            {...(row.trim() === '' || valid(row)
              ? {}
              : { hint: 'Use kind(argument), like shell(git push) or write(.env)' })}
          />
          <button
            type="button"
            aria-label={`Remove deny pattern ${String(index + 1)}`}
            onClick={() => {
              const next = rows.filter((_, at) => at !== index);
              setRows(next);
              save(next);
            }}
            className="rounded-full p-1.5 text-subtle hover:bg-hover hover:text-red"
          >
            <Trash size={13} />
          </button>
        </div>
      ))}
      <div>
        <Button
          size="sm"
          className="inline-flex items-center gap-1.5"
          onClick={() => setRows((current) => [...current, ''])}
        >
          <Plus size={12} weight="bold" />
          Add pattern
        </Button>
      </div>
      <p className="text-ui-sm text-subtle">Each one becomes --deny-tool, and wins over every grant.</p>
    </div>
  );
}
