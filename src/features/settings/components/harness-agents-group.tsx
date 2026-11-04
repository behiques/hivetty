import { Plus, Trash } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { SecretField } from '@/components/ui/secret-field';
import { SelectField } from '@/components/ui/select-field';
import { Switch } from '@/components/ui/switch';
import { TextField } from '@/components/ui/text-field';

import { SettingsGroup } from '@features/shared/components/settings-group';
import { useCodexModels } from '@hooks/use-codex-models';
import { clearCliToken, cliTokensState, setCliToken } from '@lib/cli-tokens';
import { CLI_NAMES } from '@lib/harness/cli-names';
import { setCliAgentsConfig } from '@lib/project-config';
import {
  CLI_VOCAB,
  COPILOT_DENY_PATTERN,
  HEADLESS_SANDBOXES,
  type CliAgents,
  type CliTokensState,
  type HeadlessSandbox,
} from '@shared/cli-contract';
import type { HarnessId } from '@shared/harness-contract';

// workspace-write first: it is what an unset card runs (HIVE-342). No "CLI default": codex's own is not ours.
const SANDBOX_OPTIONS = HEADLESS_SANDBOXES.map((value) => ({ value, label: value })).reverse();

const CLI_DEFAULT = { value: '', label: 'CLI default' };
/** `values` behind "CLI default", plus `saved` when it is not among them, so a saved value never shows blank. */
const options = (values: readonly string[], saved?: string) => [
  CLI_DEFAULT,
  ...(saved === undefined || values.includes(saved) ? values : [...values, saved]).map((value) => ({
    value,
    label: value,
  })),
];

/**
 * A CLI's headless agent defaults (HIVE-341), on its harness page since HIVE-376. Copilot's deny patterns render
 * inside it. Codex's list is read here, fresh: Settings is where the user chooses, so it reads the account as it is
 * now.
 */
export function HarnessAgentsGroup({ cli, agents }: { cli: HarnessId; agents: CliAgents }) {
  const { models: codexModels, settled: codexSettled } = useCodexModels(cli === 'codex', true);
  const name = CLI_NAMES[cli];
  // Codex's list is the account's, and each model takes its own efforts; Claude's and Copilot's are static.
  const live = cli === 'codex' ? codexModels : undefined;
  const models = live?.map((model) => model.slug) ?? CLI_VOCAB[cli].models;
  // "CLI default" is Codex's own default, the first model it lists.
  const modelFor = (slug: string | undefined) =>
    slug === undefined || slug === '' ? live?.[0] : live?.find((model) => model.slug === slug);
  const efforts = modelFor(agents.model)?.efforts ?? CLI_VOCAB[cli].efforts;

  /**
   * A new Codex model that may not take the saved effort clears it in the same write, or the run
   * would carry both. One off the account's list is unknown, so it clears too.
   */
  const pickModel = (value: string) => {
    const next = modelFor(value);
    const stale = live !== undefined && agents.effort !== undefined && !next?.efforts.includes(agents.effort);
    void setCliAgentsConfig({ cli, model: value || null, ...(stale ? { effort: null } : {}) });
  };

  return (
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
        {/*
          Codex's model and effort also wait for the account's list, so a pick is never judged
          against the fallback's efforts. `contents` keeps the row's layout; the sandbox stays free.
        */}
        <fieldset disabled={cli === 'codex' && !codexSettled} className="contents">
        <SelectField
          className="min-w-0 flex-1"
          label="Model"
          value={agents.model ?? ''}
          options={options(models, agents.model)}
          onChange={pickModel}
        />
        <SelectField
          className="min-w-0 flex-1"
          label="Effort"
          value={agents.effort ?? ''}
          options={options(efforts, agents.effort)}
          onChange={(value) =>
            void setCliAgentsConfig({ cli, effort: value || null })
          }
        />
        </fieldset>
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
      {cli === 'copilot' && <DenyPatterns deny={agents.deny ?? NO_PATTERNS} />}
    </SettingsGroup>
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
export function CopilotToken() {
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
