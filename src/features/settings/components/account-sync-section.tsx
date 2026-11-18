import { useState } from 'react';

import { Button } from '@components/ui/button';
import { Lock } from '@components/ui/lock';
import { SecretField } from '@components/ui/secret-field';
import { Switch } from '@components/ui/switch';
import { InlineConfirm } from '@features/shared/components/inline-confirm';
import { SettingsGroup } from '@features/shared/components/settings-group';
import { useEntitlement } from '@hooks/use-entitlement';
import { formatLastUsed } from '@hooks/use-relative-time';
import { useSyncStatus } from '@hooks/use-sync-status';
import { openSyncConflicts, resetSync, setSyncGroup, setupSync, syncNow } from '@lib/sync';
import {
  MIN_PASSPHRASE,
  NO_ENCRYPTION,
  RESET_ELSEWHERE,
  SYNC_GROUP_LABELS,
  SYNC_GROUPS,
  SYNC_PROBLEM_COPY,
  type SyncGroup,
  type SyncStatus,
} from '@shared/sync-contract';

/** What each switch carries, in the words of the mockup's rows. */
const GROUP_DESCRIPTIONS: Record<SyncGroup, string> = {
  harnesses: 'CLI commands, models, effort and agent defaults.',
  automation: 'Your skills and agents, and the ticket workflow.',
  workspace: 'Theme, fonts, density, notifications and your Jira query.',
};

const NEVER_SYNCED =
  "Never synced: projects, environment variables, tokens, server and remote settings, and each CLI's permission prompt setting.";

const card = 'flex flex-col gap-3 rounded-lg border border-border bg-panel p-4';

function GroupList() {
  return (
    <ul className="flex flex-col gap-2">
      {SYNC_GROUPS.map((group) => (
        <li key={group} className="flex flex-col">
          <span className="text-ui text-ink">{SYNC_GROUP_LABELS[group]}</span>
          <span className="text-ui-sm text-muted">{GROUP_DESCRIPTIONS[group]}</span>
        </li>
      ))}
    </ul>
  );
}

function ResetSync({ label = 'Reset sync' }: { label?: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = async (): Promise<void> => {
    setConfirming(false);
    setPending(true);
    const result = await resetSync();
    setPending(false);
    setError(result && !result.ok ? result.error : null);
  };

  return (
    <SettingsGroup
      title="Reset sync"
      description="Starts over from this Mac with a new passphrase. Use it if the passphrase is lost."
    >
      {confirming ? (
        <InlineConfirm
          label="Reset sync"
          title="Reset sync?"
          confirmLabel="Reset sync"
          className="rounded-lg border border-border"
          onCancel={() => setConfirming(false)}
          onConfirm={() => void reset()}
        >
          The synced copy is deleted for every Mac. Files on this Mac stay as they are, and your other Macs stop syncing
          until they join again with the new passphrase.
        </InlineConfirm>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="danger" pending={pending} onClick={() => setConfirming(true)}>
            {label}
          </Button>
          {error ? (
            <span role="alert" className="text-ui-sm text-red">
              {error}
            </span>
          ) : null}
        </div>
      )}
    </SettingsGroup>
  );
}

function SetUp({ resetElsewhere }: { resetElsewhere: boolean }) {
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = passphrase.length >= MIN_PASSPHRASE && passphrase === again;

  const turnOn = async (): Promise<void> => {
    if (!ready) return;
    setPending(true);
    const result = await setupSync(passphrase);
    setPending(false);
    // The passphrase lives here only for the call; it is cleared whatever the answer.
    setPassphrase('');
    setAgain('');
    setError(result && !result.ok ? result.error : null);
  };

  return (
    <>
      {resetElsewhere ? (
        <p role="status" className="text-ui-sm text-ink">
          {RESET_ELSEWHERE}
        </p>
      ) : null}
      <section className={card}>
        <h3 className="text-ui font-semibold text-ink">Your setup, on every Mac</h3>
        <p className="text-ui-sm text-muted">
          Sync keeps your harness settings, skills, agents and appearance the same on each Mac you sign in to. It is
          encrypted with a passphrase only you know.
        </p>
        <SecretField
          label="Sync passphrase"
          value={passphrase}
          onChange={setPassphrase}
          hint={`At least ${String(MIN_PASSPHRASE)} characters. You type it once on each Mac.`}
          autoComplete="new-password"
          secretName="passphrase"
        />
        <SecretField
          label="Type it again"
          value={again}
          onChange={setAgain}
          onCommit={() => void turnOn()}
          autoComplete="new-password"
          secretName="passphrase"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!ready} pending={pending} onClick={() => void turnOn()}>
            Turn on sync
          </Button>
          {error ? (
            <span role="alert" className="text-ui-sm text-red">
              {error}
            </span>
          ) : null}
        </div>
        <p className="text-ui-sm text-muted">
          Keep the passphrase somewhere safe. It can't be recovered. If you forget it, Reset sync starts over from one
          Mac.
        </p>
      </section>
      <SettingsGroup title="What syncs" description="Each Mac can switch these off for itself once sync is on.">
        <GroupList />
      </SettingsGroup>
    </>
  );
}

function Join({ resetElsewhere }: { resetElsewhere: boolean }) {
  const [passphrase, setPassphrase] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async (): Promise<void> => {
    if (passphrase === '') return;
    setPending(true);
    const result = await setupSync(passphrase);
    setPending(false);
    setPassphrase('');
    setError(result && !result.ok ? result.error : null);
  };

  return (
    <>
      {resetElsewhere ? (
        <p role="status" className="text-ui-sm text-ink">
          {RESET_ELSEWHERE}
        </p>
      ) : null}
      <section className={card}>
        <h3 className="text-ui font-semibold text-ink">This account already syncs</h3>
        <p className="text-ui-sm text-muted">Enter the passphrase you chose on your other Mac.</p>
        <SecretField
          label="Sync passphrase"
          value={passphrase}
          onChange={(next) => {
            setPassphrase(next);
            setError(null);
          }}
          onCommit={() => void join()}
          invalid={error !== null}
          secretName="passphrase"
        />
        {error ? (
          <span role="alert" className="text-ui-sm text-red">
            {error}
          </span>
        ) : null}
        <div>
          <Button variant="primary" disabled={passphrase === ''} pending={pending} onClick={() => void join()}>
            Join sync
          </Button>
        </div>
      </section>
      <SettingsGroup title="What happens to this Mac's setup" description="When this Mac joins, for each thing that syncs:">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-ui-sm text-muted">
          <li>What only this Mac has is kept, and sent to your other Macs.</li>
          <li>Where this Mac and the synced copy differ, the synced copy wins.</li>
          <li>This Mac's differing copy is kept in the conflicts folder.</li>
        </ul>
      </SettingsGroup>
      <ResetSync />
    </>
  );
}

function statusLine(status: Extract<SyncStatus, { kind: 'on' }>, now: number): string {
  const last = status.lastSyncedAt === null ? null : formatLastUsed(status.lastSyncedAt, now);
  if (status.problem === 'offline') {
    return last === null ? SYNC_PROBLEM_COPY.offline : `${SYNC_PROBLEM_COPY.offline} · last synced ${last}`;
  }
  if (status.problem !== null) return SYNC_PROBLEM_COPY[status.problem];
  return last === null ? 'Not synced yet' : `Last synced ${last} · encrypted with your passphrase`;
}

function On({ status }: { status: Extract<SyncStatus, { kind: 'on' }> }) {
  const [syncing, setSyncing] = useState(false);
  const now = Date.now();
  const { count, latest } = status.conflicts;

  return (
    <>
      <section className={card}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-ui font-semibold text-ink">Sync is on</span>
            <span className={status.problem === null ? 'text-ui-sm text-muted' : 'text-ui-sm text-red'}>
              {statusLine(status, now)}
            </span>
          </div>
          <Button
            pending={syncing}
            onClick={() => {
              setSyncing(true);
              void syncNow().finally(() => setSyncing(false));
            }}
          >
            Sync now
          </Button>
        </div>
      </section>
      <SettingsGroup title="What syncs" description="These switches are for this Mac only.">
        <div className="flex flex-col gap-3">
          {SYNC_GROUPS.map((group) => (
            <Switch
              key={group}
              label={SYNC_GROUP_LABELS[group]}
              description={GROUP_DESCRIPTIONS[group]}
              checked={status.groups[group]}
              onCheckedChange={(on) => void setSyncGroup({ group, on })}
            />
          ))}
          <p className="text-ui-sm text-subtle">{NEVER_SYNCED}</p>
        </div>
      </SettingsGroup>
      <SettingsGroup
        title="Conflicts"
        description="When two Macs change the same thing, the newer change wins and the other copy is kept here."
      >
        {count === 0 ? (
          <p className="text-ui-sm text-muted">No conflicts kept.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-ui text-ink">{count === 1 ? '1 conflict kept' : `${String(count)} conflicts kept`}</span>
              {latest ? (
                <span className="truncate text-ui-sm text-muted">{`${latest.path} · ${formatLastUsed(latest.at, now)}`}</span>
              ) : null}
            </div>
            <Button onClick={() => void openSyncConflicts()}>Open folder</Button>
          </div>
        )}
      </SettingsGroup>
      <ResetSync />
    </>
  );
}

/**
 * The Account center's Sync tab (HIVE-284): turn sync on with a passphrase, join from another Mac, the three
 * switches, kept conflicts and Reset sync. The passphrase lives in component state only, for one call.
 */
export function AccountSyncSection() {
  const entitlement = useEntitlement('sync');
  const status = useSyncStatus();

  if (!entitlement.allowed) return <Lock kind="plan" reason={entitlement.reason} />;
  if (status === null) return <p className="text-control text-subtle">Checking sync…</p>;
  if (status.kind === 'unavailable') {
    if (status.reason === 'locked') return <Lock kind="plan" reason="Sync isn't included in your plan." />;
    return (
      <p className="text-control text-subtle">{status.reason === 'signed-out' ? 'Sign in to use sync.' : NO_ENCRYPTION}</p>
    );
  }
  if (status.kind === 'off') {
    return status.cloud === 'present' ? (
      <Join resetElsewhere={status.resetElsewhere} />
    ) : (
      <SetUp resetElsewhere={status.resetElsewhere} />
    );
  }
  return <On status={status} />;
}
