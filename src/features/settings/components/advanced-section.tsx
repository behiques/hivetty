import { ArrowClockwise, FolderOpen } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';

import { Hint } from '@components/ui/hint';
import { REMOTE_DISABLED_REASON } from '@config/runtime';
import { ConfigResetConfirm } from '@features/settings/components/config-reset-confirm';
import { SettingsSectionHeader } from '@features/settings/components/settings-section-header';
import { SettingsGroup } from '@features/shared/components/settings-group';
import { useProjectConfig, useRemoteCapabilities } from '@hooks/use-project-config';
import {
  readAppInfo,
  reloadProjectConfig,
  resetConfigToTemplate,
  revealConfigFile,
} from '@lib/project-config';
import type { AppInfo, PtyDiagnostics } from '@shared/ipc-contract';

/**
 * Advanced & diagnostics (story 107).
 *
 * The config file, Reset and the diagnostics: the pane that answers questions
 * about the app rather than setting anything in it. Server mode moved to
 * Machines, and the versions, updates and What's new to General › Updates &
 * about (HIVE-380).
 *
 * ## Why there is a Reload button at all
 *
 * The epic declined a config-file watcher and named this story as the
 * alternative: "a config that changes under a live session raises questions
 * about the PTY already running in the old directory … the explicit reload in
 * 107 is the answer." So reload is not a convenience here — it is the whole
 * mechanism by which a hand-edited file reaches a running app, and the same
 * goes for `~/.hivetty/skills` and `~/.hivetty/agents`: main regenerates the plugin
 * every agent run reads and re-lists the agents before it answers. It reports
 * what it found, because a button that flashes and says nothing leaves the user
 * unable to tell a successful reload from a broken one, which is precisely the
 * question they pressed it to answer.
 *
 * ## Why the counters have a Refresh and not an interval
 *
 * `appInfo()` is `invoke`-only and there is no push channel for the PTY
 * counters; this story does not add one. Polling would re-render a settings
 * pane every second for numbers nobody is watching, and the moment these become
 * useful is the moment the user deliberately asks for them.
 */

/**
 * What the reveal button is called, per platform.
 *
 * From `AppInfo.platform` — main's `process.platform` — rather than the user
 * agent, which in Electron is a Chrome UA and lies by design (story 083).
 */
function fileManager(platform: string | undefined): string {
  if (platform === 'darwin') return 'Reveal in Finder';
  if (platform === 'win32') return 'Reveal in Explorer';
  // Linux and everything else: there is no one file manager to name.
  return 'Show in file manager';
}

/**
 * The keys of {@link PtyDiagnostics} that hold a number.
 *
 * Narrower than `keyof PtyDiagnostics` deliberately. The union also contains
 * `sessionId` and `paused`, and **a boolean in JSX renders as nothing** — so a
 * later edit adding `paused` to the table below would produce a silently blank
 * cell rather than a type error. This makes that a type error.
 */
type CounterKey = {
  [K in keyof PtyDiagnostics]: PtyDiagnostics[K] extends number ? K : never;
}[keyof PtyDiagnostics];

/**
 * The counters, in the order that reads as a story.
 *
 * `in` and `acked` bracket `unacked`, which is the number the water marks
 * compare and the one a stall shows up in first.
 */
const COUNTERS: readonly { key: CounterKey; label: string }[] = [
  { key: 'bytesIn', label: 'in' },
  { key: 'bytesAcked', label: 'acked' },
  { key: 'unacked', label: 'unacked' },
  { key: 'pauses', label: 'pauses' },
  { key: 'batches', label: 'batches' },
  { key: 'dropped', label: 'dropped' },
];

function PtyCounters({ rows }: { rows: readonly PtyDiagnostics[] }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div
          key={row.sessionId}
          className="flex flex-col gap-1 rounded-lg border border-border-soft p-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate tabular-nums text-ui-sm text-ink">
              {row.sessionId}
            </span>
            {row.paused ? (
              <span className="shrink-0 text-micro text-amber-text">paused</span>
            ) : null}
          </div>
          <dl className="flex flex-wrap gap-x-4 gap-y-0.5">
            {COUNTERS.map((counter) => (
              <div key={counter.key} className="flex items-baseline gap-1">
                <dt className="text-micro text-subtle">{counter.label}</dt>
                <dd className="tabular-nums text-micro text-muted">
                  {/*
                    Raw numbers, deliberately not humanised. The *ratio* between
                    them is what diagnoses a flow-control bug — `bytesIn /
                    batches` is the coalescing ratio, and `unacked` against the
                    water marks is the pause decision — and "2.1 MB" destroys
                    exactly the precision that makes them worth reading.
                  */}
                  {row[counter.key]}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

export function AdvancedSection() {
  const snapshot = useProjectConfig();
  const { revealConfig } = useRemoteCapabilities();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reloaded, setReloaded] = useState<string | null>(null);
  // What the last reload read but the running app cannot apply (launch-only).
  const [restart, setRestart] = useState<string[]>([]);
  /** A reload has landed and its outcome has not been read off yet. */
  const [pending, setPending] = useState(false);
  /**
   * The last reload's channel failed, so `snapshot` never moved (Settings
   * review). Cleared by the next reload's own outcome, success or failure —
   * never implicitly, or a stale failure would linger under a success it no
   * longer describes.
   */
  const [reloadFailed, setReloadFailed] = useState(false);

  /**
   * Keyed on *whether* there is a snapshot, never on the snapshot itself.
   *
   * The trap story 106 documents: every mutating verb installs a fresh
   * `ConfigSnapshot` object, so an effect depending on `snapshot` would re-run
   * on every save. Here that would re-ask main for diagnostics on each click
   * of a button in this very pane, which Refresh exists to do on purpose.
   */
  const hasSnapshot = snapshot !== null;

  const refresh = useCallback(async (): Promise<void> => {
    setInfo(await readAppInfo());
  }, []);

  useEffect(() => {
    if (!hasSnapshot) return;

    let cancelled = false;
    void readAppInfo().then((next) => {
      if (!cancelled) setInfo(next);
    });

    return () => {
      cancelled = true;
    };
  }, [hasSnapshot]);

  /**
   * Report what the reload found, from the snapshot it installed.
   *
   * Two steps rather than one, and the split is the whole point: `snapshot`
   * read inside the click handler is that render's closure and is by definition
   * the *pre*-reload value, so counting there would always describe the config
   * the user was already looking at. Setting a marker and resolving it in an
   * effect keyed on the snapshot means the sentence names the file that was
   * actually just read.
   */
  useEffect(() => {
    if (!pending || !snapshot) return;
    setPending(false);

    const problems = snapshot.errors.length;
    if (problems > 0) {
      setReloaded(
        `Reloaded — ${problems === 1 ? '1 problem' : `${problems} problems`}, listed above.`,
      );
      return;
    }

    const count = snapshot.projects.length;
    setReloaded(
      `Reloaded — ${count === 1 ? '1 project' : `${count} projects`}; skills and agents refreshed.`,
    );
  }, [pending, snapshot]);

  if (!snapshot) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
        <SettingsSectionHeader
          title="Advanced"
          description="Diagnostics are only available in the desktop app."
        />
      </div>
    );
  }

  const onReload = async (): Promise<void> => {
    const next = await reloadProjectConfig();

    /*
      `null` means the channel failed and the snapshot never moved: report
      that distinctly rather than firing the success effect below against a
      stale read, and leave `restart` exactly as it was — a real "Restart to
      apply" from before this click is still true and must stay on screen.
    */
    if (next === null) {
      setReloadFailed(true);
      return;
    }

    setReloadFailed(false);
    setRestart(next);
    setPending(true);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
      <SettingsSectionHeader
        title="Advanced"
        description="The config file itself, and where to look when something goes wrong."
      />

      {/*
        Verbatim, like every other section renders them. Main writes these in
        words the person editing the file can act on, so re-phrasing here would
        lose the detail that makes them fixable — and the reload message above
        says "listed above" meaning exactly these.
      */}
      {snapshot.errors.map((error) => (
        <p
          key={error}
          className="rounded-md border border-red px-2.5 py-1.5 text-ui-sm text-red"
        >
          {error}
        </p>
      ))}

      <SettingsGroup
        title="Config file"
        description="Everything Settings writes goes in this one file, and it is meant to stay hand-editable."
      >
        <p className="break-all tabular-nums text-ui-sm text-muted">
          {snapshot.configPath}
        </p>
        <div className="flex items-center gap-2">
          <Hint label={revealConfig ? undefined : REMOTE_DISABLED_REASON.revealConfig}>
            <button
              type="button"
              onClick={() => {
                if (!revealConfig) return;
                void revealConfigFile();
              }}
              disabled={!revealConfig}
              className="flex w-fit items-center gap-1.5 rounded-full border border-edge px-4 py-1.5 text-control font-semibold text-ink hover:bg-hover disabled:opacity-60"
            >
              <FolderOpen size={12} weight="bold" />
              {fileManager(info?.platform)}
            </button>
          </Hint>
          <button
            type="button"
            onClick={() => void onReload()}
            className="flex w-fit items-center gap-1.5 rounded-full border border-edge px-4 py-1.5 text-control font-semibold text-ink hover:bg-hover"
          >
            <ArrowClockwise size={12} weight="bold" />
            Reload
          </button>
        </div>
        {reloadFailed ? (
          <p className="text-ui-sm text-red">
            Reload failed — config, skills and agents are unchanged. Check the
            log and try again.
          </p>
        ) : reloaded === null ? (
          <p className="text-ui-sm text-subtle">
            The file is deliberately not watched. Edit it by hand and reload here
            — a config that changed under a live session would leave the terminal
            already running in the old directory. Reload also picks up skills and
            agents edited on disk; the next session and agent run use them, and
            a running session keeps what it started with.
          </p>
        ) : (
          <p className="text-ui-sm text-green">{reloaded}</p>
        )}
        {/*
          Independent of `reloadFailed`: a restart requirement a past reload
          found is still true, and must not disappear because a later reload's
          channel happened to fail.
        */}
        {reloaded !== null && restart.length > 0 && (
          <p className="text-ui-sm text-amber-text">Restart to apply: {restart.join(', ')}.</p>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Reset"
        description="Put the file back to the commented template it started as."
      >
        {confirming ? (
          <ConfigResetConfirm
            projectCount={snapshot.projects.length}
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              void resetConfigToTemplate();
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="w-fit rounded-full border border-edge px-4 py-1.5 text-control font-semibold text-ink hover:bg-hover"
          >
            Reset to template
          </button>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Diagnostics"
        description="Per-session flow control, and where to look when something goes wrong."
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-ui-sm text-subtle">
            A snapshot, not a stream.
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="shrink-0 rounded-full border border-edge px-3 py-1 text-control font-semibold text-ink hover:bg-hover"
          >
            Refresh
          </button>
        </div>

        {/*
          Three states, and collapsing any two of them would make this pane lie.

          `info === null` means the question could not be *asked* — no bridge, or
          a failed channel. Saying "no session has run yet" there would assert a
          fact we do not have, in the one pane that exists to be honest.

          An absent `pty` means the question was asked and nothing has run. Main
          omits the field rather than sending an empty array precisely so this
          can be told apart from "sessions ran and moved no bytes", and that
          distinction survives to the screen here.
        */}
        {info === null ? (
          <p className="text-control text-subtle">
            Could not read diagnostics from the app.
          </p>
        ) : info.pty === undefined ? (
          <p className="text-control text-subtle">
            No session has run yet, so there is nothing to count.
          </p>
        ) : (
          <PtyCounters rows={info.pty} />
        )}

        {info === null ? null : (
          <div className="flex flex-col gap-0.5 border-t border-border-soft pt-2">
            <p className="text-control text-subtle">Log location</p>
            <p className="break-all tabular-nums text-ui-sm text-muted">
              {info.logPath}
            </p>
            <p className="text-ui-sm text-subtle">
              This app writes no log file — it logs to the terminal it was
              launched from. That directory is Electron&rsquo;s, and is where a
              crash report would land.
            </p>
          </div>
        )}
      </SettingsGroup>
    </div>
  );
}
