import { ArrowCircleUp } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';

import { useSwarmPhrase } from '@/hooks/use-swarm-phrase';

import { Button } from '@components/ui/button';
import { Switch } from '@components/ui/switch';
import { SettingsSectionHeader } from '@features/settings/components/settings-section-header';
import { SettingsGroup } from '@features/shared/components/settings-group';
import { useProjectConfig } from '@hooks/use-project-config';
import { readAppInfo } from '@lib/project-config';
import { checkForUpdates, readUpdateStatus } from '@lib/updates';
import type { AppInfo } from '@shared/ipc-contract';
import type { UpdateStatus } from '@shared/update-contract';
import { useWhatsNewPrefs } from '@stores/appearance-store';
import { useSetWhatsNewOpen } from '@stores/ui-store';

/**
 * General › Updates & about (HIVE-380): which build this is, whether a newer
 * one exists, and What's new. Moved out of Advanced unchanged.
 *
 * There is no update channel to pick: the app has one release feed. The
 * capability sentence under the check says where updates come from and
 * whether this copy installs them itself. Licences arrive with HIVE-248.
 */

/** One label/value row — the shape every fact in this pane takes. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-control text-subtle">{label}</span>
      <span className="truncate tabular-nums text-ui-sm text-ink">{value}</span>
    </div>
  );
}

/**
 * One line describing where the app is in the update cycle.
 *
 * A function rather than a map, because two of the seven states need the
 * version interpolated and a map would either lose that or store a template.
 */
function updateLine(
  status: UpdateStatus,
  /**
   * Drawn by the caller, not here.
   *
   * This function runs on every render of the section, so a `pickPhrase` inside
   * it would re-roll the wording while the user watched a download progress —
   * the exact flicker `use-swarm-phrase` exists to prevent. The component holds
   * the phrase steady and passes it down.
   */
  phrases: { downloading: string; ready: string },
): string {
  switch (status.state) {
    case 'unsupported':
      return `Version ${status.currentVersion}.`;
    case 'checking':
      return 'Checking…';
    case 'available':
      return `Version ${status.availableVersion} is available.`;
    case 'downloading':
      return `Downloading ${status.availableVersion}… · ${phrases.downloading}`;
    case 'ready':
      return `Version ${status.availableVersion} is ready — restart to install. · ${phrases.ready}`;
    case 'error':
      return 'The last check did not complete.';
    default:
      /**
       * `idle` is also the state before the first check has run — thirty
       * seconds of every launch — so "up to date" has to be earned by an actual
       * answer from the server. Saying it unconditionally was a claim the app
       * had not established, and it was visibly wrong in Settings while a newer
       * release sat published.
       */
      return status.checked
        ? `Version ${status.currentVersion} — up to date.`
        : `Version ${status.currentVersion}.`;
  }
}

/**
 * What the screen reader hears: only an answer to a check, never the steps on
 * the way or the rotating phrase (HIVE-226). Empty means "say nothing".
 */
export function announceLine(status: UpdateStatus): string {
  switch (status.state) {
    case 'available':
      return `Version ${status.availableVersion} is available.`;
    case 'ready':
      return `Version ${status.availableVersion} is ready — restart to install.`;
    case 'error':
      return 'The last check did not complete.';
    case 'idle':
      return status.checked ? `Version ${status.currentVersion} — up to date.` : '';
    default:
      return '';
  }
}

export function UpdatesAboutSection() {
  const snapshot = useProjectConfig();
  const whatsNew = useWhatsNewPrefs();
  const setWhatsNewOpen = useSetWhatsNewOpen();
  const downloadingPhrase = useSwarmPhrase('loading.update');
  const readyPhrase = useSwarmPhrase('complete.update');
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);

  /**
   * Keyed on *whether* there is a snapshot, never on the snapshot itself:
   * every mutating verb installs a fresh `ConfigSnapshot`, and the versions
   * cannot have changed under a save (story 106).
   */
  const hasSnapshot = snapshot !== null;

  useEffect(() => {
    if (!hasSnapshot) return;

    let cancelled = false;
    void readAppInfo().then((next) => {
      if (!cancelled) setInfo(next);
    });
    /**
     * Re-read on mount, not on a timer.
     *
     * The status changes only in response to something the user did — opening
     * this pane, pressing Check now, clicking an inbox row — and the capability
     * probe settles within a second of launch, long before any settings pane is
     * open. Polling would re-render for a value that is almost always identical.
     */
    void readUpdateStatus().then((next) => {
      if (!cancelled) setUpdate(next);
    });

    return () => {
      cancelled = true;
    };
  }, [hasSnapshot]);

  /**
   * Main raises its own dialog and this resolves once the user has answered it,
   * so the re-read afterwards reports the state the answer produced.
   */
  const onCheck = useCallback(async (): Promise<void> => {
    setChecking(true);
    try {
      await checkForUpdates();
      setUpdate(await readUpdateStatus());
    } finally {
      setChecking(false);
    }
  }, []);

  if (!snapshot) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
        <SettingsSectionHeader
          title="Updates & about"
          description="Versions and updates are only available in the desktop app."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
      <SettingsSectionHeader
        title="Updates & about"
        description="Which build this is, and whether a newer one is out."
      />

      <SettingsGroup title="About" description="What this build is made of.">
        {info === null ? (
          <p className="text-control text-subtle">Reading…</p>
        ) : (
          <div className="flex flex-col gap-1 rounded-lg border border-border-soft p-3">
            <Fact label="HiveTTY" value={info.version} />
            <Fact label="Electron" value={info.electron} />
            <Fact label="Chromium" value={info.chrome} />
            <Fact label="Node" value={info.node} />
            <Fact label="Platform" value={info.platform} />
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Updates"
        description="Where a new version comes from, and whether this copy can install one."
      >
        {update === null ? (
          <p className="text-control text-subtle">
            Updates are only available in the desktop app.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              {/* Shown, not announced: the steps and the phrase change too often to read out (HIVE-226). */}
              <p className="text-control text-muted">{updateLine(update, { downloading: downloadingPhrase, ready: readyPhrase })}</p>
              {/* Always mounted, so a check's result is announced; empty while nothing has been answered (HIVE-225, HIVE-226). */}
              <p role="status" data-testid="update-announce" className="sr-only">{announceLine(update)}</p>
              <Button
                variant="ghost"
                disabled={!update.capability.canCheck}
                pending={checking}
                onClick={() => void onCheck()}
                className="flex shrink-0 items-center gap-1.5 rounded-md border-border px-3 py-1.5 text-control leading-normal text-muted hover:bg-hover hover:text-ink disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted"
              >
                <ArrowCircleUp size={12} weight="bold" />
                {checking ? 'Checking…' : 'Check now'}
              </Button>
            </div>
            {/*
              The capability sentence, always, not only when something is
              wrong. A user whose app sends them to a web page is owed the
              reason at the moment they wonder — and on a build that *can*
              self-install, the same line is the reassurance that it will.
            */}
            <p className="text-ui-sm text-subtle">
              {update.capability.reason}
            </p>
          </>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="What’s new"
        description="The three-slide card a new major version opens with."
      >
        <Switch
          label="Show What’s new after an update"
          checked={!whatsNew.off}
          onCheckedChange={(on) => whatsNew.setOff(!on)}
        />
        <div>
          <button
            type="button"
            onClick={() => setWhatsNewOpen(true)}
            className="rounded-full border border-edge px-4 py-1.5 text-control font-semibold text-ink hover:bg-hover"
          >
            Open What’s new
          </button>
        </div>
      </SettingsGroup>
    </div>
  );
}
