import { CaretLeft } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@components/ui/button';
import { TextField } from '@components/ui/text-field';
import { CommandDiagnosticView } from '@features/settings/components/command-diagnostic-view';
import { ContainerGroup } from '@features/settings/components/container-group';
import { EnvDiagnosticView } from '@features/settings/components/env-diagnostic-view';
import { EnvEditor } from '@features/settings/components/env-editor';
import { SettingsSectionHeader } from '@features/settings/components/settings-section-header';
import { SettingsGroup } from '@features/shared/components/settings-group';
import { useProjectConfig } from '@hooks/use-project-config';
import {
  diagnoseAgentCommand,
  diagnoseSessionEnv,
  setProjectRuntimeConfig,
} from '@lib/project-config';
import type {
  CommandDiagnostic,
  ContainerConfig,
  EnvDiagnostic,
} from '@shared/config-contract';

/**
 * Workspace › Projects › ⋯ › Runtime overrides (HIVE-377): one project's own
 * shell, agent command, environment and container, with the checks that say
 * where its command and environment come from. The per-project half of what
 * used to be the Runtime pane; the global half is `shell-section.tsx`.
 *
 * Every write goes through the same single write path as the rest of the epic
 * and returns a fresh `ConfigSnapshot`, so nothing here holds an optimistic
 * value to reconcile.
 */
export function ProjectOverridesView({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: () => void;
}) {
  const snapshot = useProjectConfig();
  const project =
    snapshot?.projects.find((entry) => entry.id === projectId) ?? null;
  const [diagnostic, setDiagnostic] = useState<CommandDiagnostic | null>(null);
  const [envDiagnostic, setEnvDiagnostic] = useState<EnvDiagnostic | null>(null);
  /** The env probe spawns a real login shell: a second or more, every run (see `shell-section.tsx`). */
  const [envDiagnosticPending, setEnvDiagnosticPending] = useState(false);
  const back = useRef<HTMLButtonElement>(null);

  // Focus lands on the way back: the row menu that opened this view has unmounted.
  useEffect(() => back.current?.focus(), []);

  // A project removed underneath the view (another window, a reload) has nothing left to override.
  const gone = snapshot !== null && project === null;
  useEffect(() => {
    if (gone) onDone();
  }, [gone, onDone]);

  if (!snapshot || !project) return null;

  /** This project's own command (HIVE-376 D10). The default command's check is on the Claude Code page. */
  const runDiagnostic = async () => {
    setDiagnostic(await diagnoseAgentCommand({ id: projectId }));
  };

  const runEnvDiagnostic = async () => {
    setEnvDiagnosticPending(true);
    try {
      setEnvDiagnostic(await diagnoseSessionEnv({ id: projectId }));
    } finally {
      setEnvDiagnosticPending(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
      <button
        ref={back}
        type="button"
        onClick={onDone}
        aria-label="Back to Projects"
        className="flex w-fit items-center gap-1 text-control text-muted hover:text-ink"
      >
        <CaretLeft size={12} aria-hidden />
        Projects
      </button>

      <SettingsSectionHeader
        title={`${project.name}: runtime overrides`}
        description="This project’s own shell, command and environment. Blank inherits Harnesses › Runtime."
      />

      <ProjectOverrides
        key={project.id}
        id={project.id}
        shell={project.shell}
        claudeCommand={project.claudeCommand}
        env={project.env ?? {}}
        container={project.container}
        inheritedShell={snapshot.shell}
        inheritedCommand={snapshot.claudeCommand}
        inheritedAlias={snapshot.receiver.hostAlias}
        {...(diagnostic === null ? {} : { diagnostic })}
      />

      <SettingsGroup
        title="Command diagnostic"
        description="Where this project’s agent command is looked for, and whether it was found. The default command’s check is in Harnesses › Claude Code."
      >
        <button
          type="button"
          onClick={() => void runDiagnostic()}
          className="w-fit rounded-full border border-edge px-3 py-1 text-control font-semibold text-ink hover:bg-hover"
        >
          Check this project’s command
        </button>

        {diagnostic ? <CommandDiagnosticView diagnostic={diagnostic} /> : null}
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
          {envDiagnosticPending ? 'Checking…' : 'Check this project’s environment'}
        </Button>

        {/* Always mounted: a live region that mounts with its text is not reliably announced (HIVE-225). */}
        <div role="status" className="empty:-mt-2">
          {envDiagnostic ? <EnvDiagnosticView diagnostic={envDiagnostic} /> : null}
        </div>
      </SettingsGroup>
    </div>
  );
}

/**
 * One project's overrides.
 *
 * Split out and **keyed by project id** so another project remounts it —
 * that is what resets the draft inputs. Deriving the same behaviour with an
 * effect inside a single component would mean a stale override briefly
 * rendering under the newly opened project's name. `ProjectsSection` keys the
 * whole view by id too (HIVE-377), so this key is belt and braces.
 */
function ProjectOverrides({
  id,
  shell,
  claudeCommand,
  env,
  container,
  inheritedShell,
  inheritedCommand,
  inheritedAlias,
  diagnostic,
}: {
  id: string;
  shell?: string;
  claudeCommand?: string;
  env: Record<string, string>;
  /** HIVE-133. The **file** shape — an absent field means inherit. */
  container?: ContainerConfig;
  inheritedShell: string;
  inheritedCommand: string;
  /** What a blank `Host alias` field in `ContainerGroup` resolves to. */
  inheritedAlias: string;
  /**
   * Already fetched by this view for `CommandDiagnosticView`
   * (`ProjectOverridesView`'s own `diagnostic` state) — passed down rather
   * than fetched twice.
   */
  diagnostic?: CommandDiagnostic;
}) {
  const [shellDraft, setShellDraft] = useState(shell ?? '');
  const [commandDraft, setCommandDraft] = useState(claudeCommand ?? '');

  /**
   * Commit an override, mapping "emptied" to `null` — remove it.
   *
   * This is the distinction the whole three-state contract exists for. Storing
   * `""` would spawn a shell named `""` and fail with a message no user could
   * act on; `null` restores inheritance, which is what clearing a field means.
   */
  const commit = (
    field: 'shell' | 'claudeCommand',
    draft: string,
    current: string | undefined,
  ) => {
    const next = draft.trim() === '' ? null : draft.trim();
    if (next === (current ?? null)) return;
    void setProjectRuntimeConfig({ id, [field]: next });
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-soft p-3">
      <div className="grid max-w-[520px] grid-cols-2 gap-3">
        <TextField
          label="Shell override"
          value={shellDraft}
          onChange={setShellDraft}
          onCommit={() => commit('shell', shellDraft, shell)}
          placeholder={inheritedShell}
          muted={shellDraft === ''}
          hint="Blank inherits the default."
        />
        <TextField
          label="Agent command override"
          value={commandDraft}
          onChange={setCommandDraft}
          onCommit={() => commit('claudeCommand', commandDraft, claudeCommand)}
          placeholder={inheritedCommand}
          muted={commandDraft === ''}
          hint="Blank inherits the default."
        />
      </div>

      <div
        // Named distinctly from the workspace group in `shell-section.tsx`
        // (`"Workspace environment variables"`) — see the comment there. The
        // two no longer share a screen, but the pair keeps a screen reader's
        // and the e2e suite's names for them apart (HIVE-377).
        role="group"
        aria-label="Project environment variables"
        className="flex flex-col gap-1.5"
      >
        <span className="text-control text-muted">Environment variables</span>
        <EnvEditor
          value={env}
          onSave={(next) =>
            void setProjectRuntimeConfig({
              id,
              // An emptied map is `null`, not `{}` — removing the key entirely
              // keeps the config file clean rather than leaving `"env": {}`
              // behind for the user to wonder about.
              env: Object.keys(next).length === 0 ? null : next,
            })
          }
        />
      </div>

      {container === undefined ? null : (
        /*
          No `SettingsNestingContext` wrap here: `ContainerGroup` establishes
          it internally, the same way `SettingsProviderGroup` owns nesting for
          a provider band rather than making every caller remember to wrap it
          (`container-group.tsx`'s own comment on this). Wrapping again here
          would be redundant, not wrong, but a redundant wrap invites exactly
          the stale claim this comment used to make about it.
        */
        <ContainerGroup
          projectId={id}
          container={container}
          command={claudeCommand ?? inheritedCommand}
          inheritedAlias={inheritedAlias}
          {...(diagnostic?.container === undefined
            ? {}
            : { diagnostic: diagnostic.container })}
        />
      )}
    </div>
  );
}
