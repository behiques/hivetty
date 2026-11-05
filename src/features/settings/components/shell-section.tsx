import { useEffect, useState } from 'react';

import { Button } from '@components/ui/button';
import { Switch } from '@components/ui/switch';
import { TextField } from '@components/ui/text-field';
import { EnvDiagnosticView } from '@features/settings/components/env-diagnostic-view';
import { EnvEditor } from '@features/settings/components/env-editor';
import { PathSourceGroup } from '@features/settings/components/path-source-group';
import { SettingsSectionHeader } from '@features/settings/components/settings-section-header';
import { SettingsGroup } from '@features/shared/components/settings-group';
import { useProjectConfig } from '@hooks/use-project-config';
import {
  diagnoseSessionEnv,
  readLoginEnvStatus,
  setRuntimeConfig,
} from '@lib/project-config';
import type { EnvDiagnostic } from '@shared/config-contract';
import type { LoginEnvStatus } from '@shared/ipc-contract';

/**
 * Harnesses › Runtime (HIVE-377): what every session starts in,
 * for every CLI. A project's own overrides open from its row in Workspace ›
 * Projects (`project-overrides-view.tsx`). The global agent command and its
 * diagnostic are on Settings › Harnesses › Claude Code (HIVE-376 D10).
 *
 * Every write goes through the same single write path as the rest of the epic
 * and returns a fresh `ConfigSnapshot`, so nothing here holds an optimistic
 * value to reconcile.
 */

export function ShellSection() {
  const snapshot = useProjectConfig();

  /**
   * Draft state for the top-level shell.
   *
   * Seeded from the snapshot and re-seeded whenever it changes — an explicit
   * reload, or another verb returning a fresh one, must not leave a stale
   * value sitting in an input the user is not looking at.
   */
  const [shell, setShell] = useState('');
  const [envDiagnostic, setEnvDiagnostic] = useState<EnvDiagnostic | null>(null);
  /**
   * Whether the env probe is in flight.
   *
   * The env diagnostic spawns a real login shell and waits for it — typically
   * a second or more with oh-my-zsh or nvm — on *every* run. The command
   * diagnostic is ordinarily a few filesystem stats, and only pays a
   * comparable cost when a container project configures a `probe`
   * (HIVE-133); the two share the same 5s timeout as a ceiling, not as a
   * typical cost. The asymmetry that justifies a spinner here and not there
   * is frequency, not magnitude: one is always slow, the other is usually
   * instant. A button with no feedback for that long reads as broken rather
   * than working.
   */
  const [envDiagnosticPending, setEnvDiagnosticPending] = useState(false);
  /**
   * `null` while the read is out, `'unavailable'` once it has failed.
   *
   * Three states rather than two, because `readLoginEnvStatus` answers `null`
   * for both "no bridge" and "the channel threw" — and a component that stores
   * that verbatim can never leave its loading state. The pane would go on
   * saying it was checking, forever, with no error and no retry.
   */
  const [loginEnv, setLoginEnv] = useState<LoginEnvStatus | 'unavailable' | null>(
    null,
  );

  useEffect(() => {
    if (!snapshot) return;
    setShell(snapshot.shell);
  }, [snapshot]);

  /**
   * The environment this app actually searched, for `PathSourceGroup` below.
   *
   * `integrations.loginEnv()`, not `integrations.status()`. The status verb
   * carries this same field, and reaching for it would have spent two
   * `spawnSync` calls looking for `gh` — blocking main for as long as they take
   * — to hand back a value resolved at boot. This pane wants the environment
   * and not the binary, so it asks for exactly that.
   *
   * Keyed on *whether* there is a snapshot, never on the snapshot itself: every
   * write in this pane installs a fresh object, and depending on it would
   * re-read on each committed keystroke. Nothing here can change the answer
   * before the next launch anyway — which is what the switch above says about
   * itself, and what `PathSourceGroup`'s copy is careful to repeat.
   */
  const hasSnapshot = snapshot !== null;

  useEffect(() => {
    if (!hasSnapshot) return;

    let cancelled = false;
    void readLoginEnvStatus().then((next) => {
      // `null` is a failure, not a slow answer — see the state's own note.
      if (!cancelled) setLoginEnv(next ?? 'unavailable');
    });

    return () => {
      cancelled = true;
    };
  }, [hasSnapshot]);

  if (!snapshot) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
        <SettingsSectionHeader
          title="Runtime"
          description="Shell and environment settings are only available in the desktop app."
        />
      </div>
    );
  }

  /** Commit a top-level field, but only when it actually changed. */
  const commitShell = () => {
    const next = shell.trim();
    // Empty is not a value here: there is no lower level to fall back to, and a
    // session with no shell cannot start. Restore rather than write.
    if (next === '' ) {
      setShell(snapshot.shell);
      return;
    }
    if (next !== snapshot.shell) void setRuntimeConfig({ shell: next });
  };

  const runEnvDiagnostic = async () => {
    setEnvDiagnosticPending(true);
    try {
      const result = await diagnoseSessionEnv({});
      setEnvDiagnostic(result);
    } finally {
      setEnvDiagnosticPending(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
      <SettingsSectionHeader
        title="Runtime"
        description="What every session starts in, for every CLI. A project can override these from Workspace › Projects › ⋯ › Runtime overrides."
      />

      {snapshot.errors.map((error) => (
        <p
          key={error}
          className="rounded-md border border-red px-2.5 py-1.5 text-ui-sm text-red"
        >
          {error}
        </p>
      ))}

      <SettingsGroup
        title="Shell"
        description="Used by every project that does not override it."
      >
        <div className="grid max-w-[520px] grid-cols-2 gap-3">
          <TextField
            label="Shell"
            value={shell}
            onChange={setShell}
            onCommit={commitShell}
            placeholder="/bin/zsh"
            hint="Started as a login shell."
          />
        </div>

        <div
          // A named group, not just a visually-adjacent block: `EnvEditor`
          // renders the same literal "Save variables" / "Add variable"
          // control names everywhere it is used, and `SettingsGroup`'s own
          // heading carries no `aria-labelledby` down to this `<section>`.
          // This `aria-label` names the editor. It reads differently from
          // the per-project group's name (`"Project environment variables"`,
          // in `project-overrides-view.tsx`), which keeps the two apart
          // for a screen reader and for the e2e selectors.
          role="group"
          aria-label="Workspace environment variables"
          className="flex flex-col gap-1.5 pt-1"
        >
          {/*
           * Two things a user hitting a wall needs to already know, before
           * they file a bug (story 108):
           *
           * - Order of operations: this is injected before the shell starts,
           *   but a login shell's rc file runs afterward and can silently
           *   clobber it. Without saying so, "I set FOO here and it's still
           *   the old value" reads as a bug in this editor rather than in
           *   `.zshrc`.
           * - Storage: `~/.hivetty/config.json` is plain JSON on disk, not a
           *   secrets store, so credentials belong in the rc file instead.
           *   This is guidance, not a guard — there is deliberately no
           *   secret-detection here, since a check that rejects `API_TOKEN`
           *   while waving through `TOKEN_API` teaches nothing.
           */}
          <p className="text-ui-sm text-subtle">
            Environment for every session, applied before the shell starts. A
            login shell’s rc file runs afterward and can override anything
            set here.
          </p>
          <p className="text-ui-sm text-subtle">
            Prefer your rc file for tokens and credentials — this file is
            stored in plain text.
          </p>
          {/*
           * A visible label, matching the per-project editor's pattern:
           * sighted users get the same visual parity a magnifier or a quick
           * scroll relies on, not just proximity to the section heading
           * above.
           */}
          <span className="text-control text-muted">Environment variables</span>
          <EnvEditor
            // `EnvEditor` seeds its rows once, from a lazy initializer with
            // no effect and no key of its own (see its doc comment). `shell`
            // and `command` above are re-seeded from every fresh snapshot via
            // the `useEffect` at the top of this component, and the
            // per-project editor gets the same property for free because
            // its view mounts per project — this is the
            // workspace editor's equivalent, so a stale value cannot sit in
            // an input a fresh snapshot has already superseded.
            key={JSON.stringify(snapshot.env)}
            value={snapshot.env}
            onSave={(env) => void setRuntimeConfig({ env })}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Environment diagnostic"
        description="Which variables survived the shell’s rc file."
      >
        <Button
          variant="ghost"
          onClick={() => void runEnvDiagnostic()}
          pending={envDiagnosticPending}
          className="w-fit rounded-md border-border px-2.5 py-1 text-control leading-normal text-muted hover:bg-hover hover:text-ink aria-disabled:opacity-60"
        >
          {envDiagnosticPending ? 'Checking…' : 'Check the default environment'}
        </Button>

        {/* Always mounted: a live region that mounts with its text is not reliably announced (HIVE-225). */}
        <div role="status" className="empty:-mt-2">
          {envDiagnostic ? <EnvDiagnosticView diagnostic={envDiagnostic} /> : null}
        </div>
      </SettingsGroup>

      {/*
        HIVE-84. An escape hatch, deliberately phrased as one.

        The default is on, and the overwhelming majority of users should leave
        it there — without it a Finder-launched build cannot find anything they
        installed. What earns the switch a place in Settings is the rc file this
        app should not fight: one that is slow, prompts, or has side effects
        worth not triggering once per launch. The description says what turning
        it off costs, because a switch whose consequence is invisible is one
        people flip to see what happens.
      */}
      <SettingsGroup
        title="Login shell environment"
        description="Whether this app adopts the PATH your terminal uses."
      >
        <Switch
          label="Import my login shell's PATH at startup"
          checked={snapshot.importLoginEnv}
          onCheckedChange={(next) => {
            void setRuntimeConfig({ importLoginEnv: next });
          }}
          description="Runs your login shell once when the app starts and adopts its PATH, plus GH_TOKEN or GITHUB_TOKEN if this app does not already have them. Off means the app searches only the environment it was launched with — which, opened from Finder, is launchd's four-entry PATH. Takes effect on the next launch."
        />
      </SettingsGroup>

      {/*
        Directly under the switch that decides it. This group used to sit in
        Integrations, where it explained a missing `gh` but could not offer the
        control that would fix it — so the pane owning the answer had to send
        the reader here by name. Now the answer and the switch are one group
        apart, and Integrations links this way instead.
      */}
      <PathSourceGroup loginEnv={loginEnv} />
    </div>
  );
}
