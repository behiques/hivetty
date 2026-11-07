import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';

import { CliMark } from '@/components/ui/cli-mark';
import { SelectField } from '@/components/ui/select-field';
import { Switch } from '@/components/ui/switch';
import { TextField } from '@/components/ui/text-field';

import { CodexPluginGroup } from '@features/settings/components/codex-plugin-group';
import { CommandDiagnosticView } from '@features/settings/components/command-diagnostic-view';
import { ConfigErrors } from '@features/settings/components/config-errors';
import { CopilotToken, HarnessAgentsGroup } from '@features/settings/components/harness-agents-group';
import { HarnessCapabilities } from '@features/settings/components/harness-capabilities';
import { SettingsSectionHeader } from '@features/settings/components/settings-section-header';
import { CodexModelField } from '@features/shared/components/codex-model-field';
import { OptionStepper } from '@features/shared/components/option-stepper';
import { SettingsGroup } from '@features/shared/components/settings-group';
import { useCliDetection } from '@hooks/use-cli-detection';
import { useCodexModels } from '@hooks/use-codex-models';
import { useAttachedServer, useProjectConfig } from '@hooks/use-project-config';
import { readCliSignIn } from '@lib/cli-sign-in';
import { CLI_NAMES } from '@lib/harness/cli-names';
import { resolvePick } from '@lib/harness/session-cli';
import { diagnoseAgentCommand, setCliConfig, setCliSessionsConfig, setRuntimeConfig } from '@lib/project-config';
import {
  CLI_INSTALL_HINTS,
  CLI_VOCAB,
  cliTakesEffort,
  type CliDetection,
  type ClisConfig,
  type CliSignIn,
} from '@shared/cli-contract';
import type { CommandDiagnostic, ConfigSnapshot } from '@shared/config-contract';
import { HARNESS_IDS, type HarnessId } from '@shared/harness-contract';

/** A model list longer than this is a select, as in the picker (`new-session-picker.tsx`, HIVE-280). */
const STEPPER_MAX = 8;

const SIGN_IN_COPY: Record<HarnessId, string> = {
  'claude-code': 'The account claude reports.',
  codex: 'The login codex reports.',
  copilot: 'Copilot sessions use your GitHub login; agents use the token below.',
};

/**
 * Settings › Harnesses › <CLI> (HIVE-376 D9): one page per CLI, the same component for all three. Top to bottom:
 * the header, sign-in, the command, new-session defaults, headless agents, and what the CLI supports.
 */
export function HarnessPage({ cli }: { cli: HarnessId }) {
  const snapshot = useProjectConfig();
  const server = useAttachedServer();
  const { detection, rescan } = useCliDetection();
  const [signIn, setSignIn] = useState<CliSignIn | null>(null);

  // The command sign-in runs: a saved change re-reads it, so the line never describes the previous binary.
  const command =
    snapshot === null ? '' : cli === 'claude-code' ? snapshot.claudeCommand : (snapshot.clis[cli].command ?? '');

  // Read fresh each time the page opens (D7) or the command changes; a page left for another CLI drops a late answer.
  useEffect(() => {
    let current = true;
    setSignIn(null);
    void readCliSignIn(cli).then((next) => {
      if (current) setSignIn(next);
    });
    return () => {
      current = false;
    };
  }, [cli, command]);

  const found = detection?.[cli];

  if (!snapshot) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
        <SettingsSectionHeader title={CLI_NAMES[cli]} description="CLI settings are only available in the desktop app." />
      </div>
    );
  }

  const on = snapshot.clis[cli].sessions;
  const onCount = HARNESS_IDS.filter((id) => snapshot.clis[id].sessions).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
      <div className="flex items-start gap-4">
        <CliMark cli={cli} className="mt-0.5 size-7 shrink-0" />
        <div className="min-w-0 flex-1">
          <SettingsSectionHeader
            title={
              <>
                {CLI_NAMES[cli]}{' '}
                {found !== undefined && 'path' in found && found.version != null && (
                  <span className="font-normal text-muted">{found.version}</span>
                )}
              </>
            }
            description={<HeaderLine cli={cli} found={found} server={server} />}
          />
        </div>
        <div className="w-48 shrink-0">
          <Switch
            label="Use for sessions"
            checked={on}
            disabled={on && onCount === 1}
            onCheckedChange={(next) => void setCliSessionsConfig({ sessions: { [cli]: next } })}
          />
        </div>
      </div>
      <ConfigErrors errors={snapshot.errors} />
      <SettingsGroup title="Sign-in" description={SIGN_IN_COPY[cli]}>
        <SignInLine signIn={signIn} />
        {cli === 'copilot' && <CopilotToken />}
      </SettingsGroup>
      <CommandGroup cli={cli} snapshot={snapshot} rescan={rescan} />
      <SessionDefaultsGroup cli={cli} clis={snapshot.clis} />
      {cli === 'codex' && <CodexPluginGroup snapshot={snapshot} server={server} />}
      <HarnessAgentsGroup cli={cli} agents={snapshot.clis[cli].agents} />
      <HarnessCapabilities cli={cli} />
    </div>
  );
}

/**
 * What HiveTTY runs for the CLI, and why it was or wasn't found (HIVE-376). Claude's is the global `claudeCommand`,
 * moved from Runtime (D10), and never empty; Codex's and Copilot's are `clis.<id>.command`, where empty runs the bare
 * name from the login shell's PATH (D3). The diagnostic re-runs once the snapshot reflects a write.
 */
/** What a session accepts but an agent run refuses (`resolveCommand`): arguments, a leading NAME=val, a leading ~/. */
const NEEDS_SHELL = /\s|^[A-Za-z_][A-Za-z0-9_]*=|^~\//;

function CommandGroup({
  cli,
  snapshot,
  rescan,
}: {
  cli: HarnessId;
  snapshot: ConfigSnapshot;
  rescan: () => Promise<void>;
}) {
  const saved = cli === 'claude-code' ? snapshot.claudeCommand : (snapshot.clis[cli].command ?? '');
  const [draft, setDraft] = useState(saved);
  const [diagnostic, setDiagnostic] = useState<CommandDiagnostic | null>(null);

  useEffect(() => setDraft(saved), [saved]);

  const diagnose = useCallback(async () => setDiagnostic(await diagnoseAgentCommand({ cli })), [cli]);

  useEffect(() => {
    void diagnose();
  }, [diagnose, saved]);

  const commit = async () => {
    const next = draft.trim();
    if (cli === 'claude-code' && next === '') {
      setDraft(saved);
      return;
    }
    if (next === saved) return;
    if (cli === 'claude-code') await setRuntimeConfig({ claudeCommand: next });
    else await setCliConfig({ cli, command: next === '' ? null : next });
    await rescan();
  };

  return (
    <SettingsGroup title="Command" description={`What HiveTTY runs for ${CLI_NAMES[cli]}, in sessions and agent runs.`}>
      <TextField
        className="max-w-md"
        label="Command"
        value={draft}
        onChange={setDraft}
        onCommit={() => void commit()}
        placeholder={cli === 'claude-code' ? 'claude' : cli}
        hint={
          NEEDS_SHELL.test(draft.trim())
            ? 'Sessions accept this; agent runs need a plain command.'
            : cli === 'claude-code'
              ? 'Typed into a login shell, arguments included.'
              : `Empty runs ${cli} from the login shell's PATH.`
        }
      />
      {diagnostic ? <CommandDiagnosticView diagnostic={diagnostic} /> : null}
    </SettingsGroup>
  );
}

/**
 * What the picker starts the CLI on (HIVE-376 D4, D5), with the picker's own controls (D12). The values shown are the
 * configured default, else the built-in one. A Codex model that does not take the saved effort clears it in the same
 * write, the agents group's `pickModel` rule.
 */
function SessionDefaultsGroup({ cli, clis }: { cli: HarnessId; clis: ClisConfig }) {
  const { model, effort } = resolvePick(cli, {}, clis);
  const { models: codexModels } = useCodexModels(cli === 'codex', true);
  const codexPick = cli === 'codex' ? (codexModels.find((each) => each.slug === model) ?? codexModels[0]) : undefined;
  const efforts: readonly string[] = codexPick?.efforts ?? CLI_VOCAB[cli].efforts;
  const savedEffort = clis[cli].sessionEffort;

  const pickModel = (next: string) => {
    const nextEfforts = cli === 'codex' ? codexModels.find((each) => each.slug === next)?.efforts : undefined;
    const stale = savedEffort !== undefined && nextEfforts !== undefined && !nextEfforts.includes(savedEffort);
    void setCliConfig({ cli, sessionModel: next, ...(stale ? { sessionEffort: null } : {}) });
  };

  return (
    <SettingsGroup
      title="New sessions"
      description={`What the picker starts ${CLI_NAMES[cli]} on. A pick you make in the picker wins until the app restarts.`}
    >
      <div className="flex flex-wrap items-end gap-6">
        {cli === 'codex' && codexPick !== undefined ? (
          <CodexModelField models={codexModels} value={codexPick.slug} onChange={pickModel} />
        ) : CLI_VOCAB[cli].models.length > STEPPER_MAX ? (
          <SelectField
            className="min-w-0 flex-1"
            label="Model"
            value={model}
            options={CLI_VOCAB[cli].models.map((option) => ({ value: option, label: option }))}
            onChange={pickModel}
          />
        ) : (
          <OptionStepper label="model" options={CLI_VOCAB[cli].models} value={model} onChange={pickModel} />
        )}
        <OptionStepper
          label="thinking effort"
          options={efforts}
          value={effort}
          onChange={(next) => void setCliConfig({ cli, sessionEffort: next })}
          marks={codexPick === undefined ? undefined : { [codexPick.defaultEffort]: 'default' }}
          disabled={!cliTakesEffort(cli, model)}
          disabledReason={`not for ${model}`}
        />
      </div>
    </SettingsGroup>
  );
}

/** Where the CLI was found, or why it wasn't, as on Overview (HIVE-375), and the server when attached. */
function HeaderLine({ cli, found, server }: { cli: HarnessId; found: CliDetection | undefined; server: string | null }) {
  const where = server === null ? null : <span>{`On ${server}. `}</span>;
  if (found === undefined) return <>{where}</>;
  if ('path' in found) {
    return (
      <>
        {where}
        <code className="truncate">{found.path}</code>
      </>
    );
  }
  if ('unchecked' in found) {
    return (
      <>
        {where}
        {found.unchecked}
      </>
    );
  }
  return (
    <>
      {where}
      {found.missing} Install it with{' '}
      <code className="rounded bg-chip px-1 text-ink">{CLI_INSTALL_HINTS[cli]}</code>, then Rescan on Overview.
    </>
  );
}

function SignInLine({ signIn }: { signIn: CliSignIn | null }) {
  if (signIn === null) return <p className="text-ui-sm text-subtle">Reading the sign-in…</p>;
  return (
    <p className="flex flex-wrap items-start gap-2 text-control">
      {signIn.state === 'in' ? (
        <CheckCircle size={14} className="mt-px shrink-0 text-green" aria-hidden="true" />
      ) : (
        <WarningCircle size={14} className="mt-px shrink-0 text-amber-text" aria-hidden="true" />
      )}
      <span className={signIn.state === 'in' ? 'text-ink' : 'text-amber-text'}>{signIn.label}</span>
      {signIn.state === 'out' && (
        <span className="text-subtle">
          Run <code className="rounded bg-chip px-1 text-ink">{signIn.fix}</code> in a terminal.
        </span>
      )}
    </p>
  );
}
