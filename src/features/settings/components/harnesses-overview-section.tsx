import { ArrowClockwise } from '@phosphor-icons/react';

import { Button } from '@/components/ui/button';
import { CliMark } from '@/components/ui/cli-mark';
import { Switch } from '@/components/ui/switch';

import { capabilitySummary } from '@features/settings/components/harness-capabilities';
import { SettingsSectionHeader } from '@features/settings/components/settings-section-header';
import { useCliDetection } from '@hooks/use-cli-detection';
import { useAttachedServer, useProjectConfig } from '@hooks/use-project-config';
import { CLI_NAMES } from '@lib/harness/cli-names';
import { cliAvailability, resolveSessionCli } from '@lib/harness/session-cli';
import { setCliSessionsConfig } from '@lib/project-config';
import { CLI_INSTALL_HINTS } from '@shared/cli-contract';
import { HARNESS_IDS } from '@shared/harness-contract';
import { useSettingsActions } from '@stores/ui-store';

/**
 * Settings › Harnesses › Overview (HIVE-375): what was found, what sessions may use, and what they start on.
 * Detection runs where the sessions run, so attached to a server it names that machine (D9). Each row opens that
 * CLI's own page, with how much of what HiveTTY can do it supports (HIVE-376 D13).
 */
export function HarnessesOverviewSection() {
  const snapshot = useProjectConfig();
  const server = useAttachedServer();
  const { detection, rescan, rescanning } = useCliDetection();
  const { openSettings } = useSettingsActions();

  // The browser target has no config, so nothing here can be read or set.
  if (!snapshot) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
        <SettingsSectionHeader title="Overview" description="CLI settings are only available in the desktop app." />
      </div>
    );
  }

  const configuredDefault = snapshot.sessionsDefaultCli ?? 'claude-code';
  const availability = cliAvailability(detection, snapshot.clis);
  const startsOn = resolveSessionCli({ picked: null, sessionsDefault: snapshot.sessionsDefaultCli }, availability).cli;
  const onCount = HARNESS_IDS.filter((id) => snapshot.clis[id].sessions).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <SettingsSectionHeader
          title="Overview"
          description={`The CLIs HiveTTY found on ${server ?? 'this Mac'}, which ones sessions may use, and which one a new session starts with.`}
        />
        <Button variant="secondary" size="sm" onClick={() => void rescan()} pending={rescanning}>
          <ArrowClockwise aria-hidden="true" /> Rescan
        </Button>
      </div>
      <ul className="flex flex-col divide-y divide-border-soft rounded-lg border border-border bg-panel">
        {HARNESS_IDS.map((cli) => {
          const found = detection?.[cli];
          const missing = found !== undefined && 'missing' in found ? found.missing : null;
          const located = found !== undefined && 'path' in found ? found : null;
          const on = snapshot.clis[cli].sessions;
          const summary = capabilitySummary(cli);
          return (
            <li key={cli} className="flex flex-wrap items-start gap-4 px-4 py-3.5">
              <CliMark cli={cli} className="mt-0.5 size-7 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-ui text-ink">
                  {CLI_NAMES[cli]}{' '}
                  {located?.version != null && <span className="text-muted">{located.version}</span>}
                </span>
                {located !== null && <code className="truncate text-ui-sm text-subtle">{located.path}</code>}
                {found !== undefined && 'unchecked' in found && (
                  <span className="text-ui-sm text-subtle">{found.unchecked}</span>
                )}
                {missing !== null && (
                  <span className="text-ui-sm text-subtle">
                    {missing} Install it with{' '}
                    <code className="rounded bg-chip px-1 text-ink">{CLI_INSTALL_HINTS[cli]}</code>, then Rescan.
                  </span>
                )}
                <button
                  type="button"
                  className="self-start text-ui-sm text-brand hover:underline"
                  onClick={() => openSettings(cli)}
                >
                  {`${String(summary.supported)} of ${String(summary.total)} supported · Open ${CLI_NAMES[cli]}`}
                </button>
                {cli === configuredDefault && startsOn !== null && startsOn !== cli && (
                  <span className="text-ui-sm text-amber-text">{`New sessions start on ${CLI_NAMES[startsOn]} instead`}</span>
                )}
              </div>
              <div className="w-56 shrink-0">
                <Switch
                  label={`Use ${CLI_NAMES[cli]} for sessions`}
                  checked={on}
                  disabled={on && onCount === 1}
                  onCheckedChange={(next) => void setCliSessionsConfig({ sessions: { [cli]: next } })}
                />
              </div>
              <label className="flex items-center gap-2 py-1 text-ui text-muted">
                <input
                  type="radio"
                  name="sessions-default-cli"
                  className="size-4 accent-brand"
                  aria-label={`${CLI_NAMES[cli]} is the default for new sessions`}
                  checked={cli === configuredDefault}
                  onChange={() => void setCliSessionsConfig({ defaultCli: cli })}
                />
                Default
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
