import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { CliMark } from '@/components/ui/cli-mark';
import { Switch } from '@/components/ui/switch';

import { CopilotToken, HarnessAgentsGroup } from '@features/settings/components/harness-agents-group';
import { HarnessCapabilities } from '@features/settings/components/harness-capabilities';
import { SettingsSectionHeader } from '@features/settings/components/settings-section-header';
import { SettingsGroup } from '@features/shared/components/settings-group';
import { useCliDetection } from '@hooks/use-cli-detection';
import { useAttachedServer, useProjectConfig } from '@hooks/use-project-config';
import { readCliSignIn } from '@lib/cli-sign-in';
import { CLI_NAMES } from '@lib/harness/cli-names';
import { setCliSessionsConfig } from '@lib/project-config';
import { CLI_INSTALL_HINTS, type CliDetection, type CliSignIn } from '@shared/cli-contract';
import { HARNESS_IDS, type HarnessId } from '@shared/harness-contract';

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
  const { detection } = useCliDetection();
  const [signIn, setSignIn] = useState<CliSignIn | null>(null);

  // Read fresh each time the page opens (D7); a page left for another CLI drops a late answer.
  useEffect(() => {
    let current = true;
    setSignIn(null);
    void readCliSignIn(cli).then((next) => {
      if (current) setSignIn(next);
    });
    return () => {
      current = false;
    };
  }, [cli]);

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
      <SettingsGroup title="Sign-in" description={SIGN_IN_COPY[cli]}>
        <SignInLine signIn={signIn} />
        {cli === 'copilot' && <CopilotToken />}
      </SettingsGroup>
      <HarnessAgentsGroup cli={cli} agents={snapshot.clis[cli].agents} />
      <HarnessCapabilities cli={cli} />
    </div>
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
