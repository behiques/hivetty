import { ContainerAliasGroup } from '@features/settings/components/container-alias-group';
import { SettingsGroup } from '@features/shared/components/settings-group';
import { useProjectConfig } from '@hooks/use-project-config';
import { CLI_NAMES } from '@lib/harness/cli-names';
import { CAPABILITIES, HARNESS_IDS } from '@shared/harness-contract';
import { useSettingsActions } from '@stores/ui-store';

/**
 * Environment › Runtime › Containers (HIVE-377; its own pane until the Settings regroup folded it into Runtime as a
 * band). A container profile belongs to its project (there is no top-level one, `config-contract.ts`), so this holds
 * what is not per project: which CLIs can run in one, which projects do, and how a container reaches this app.
 */
export function ContainersGroups() {
  const snapshot = useProjectConfig();
  const { openSettings } = useSettingsActions();

  // Runtime says the desktop-only line once for the whole pane.
  if (!snapshot) return null;

  const inContainer = snapshot.projects
    .filter((project) => project.container !== undefined)
    .map((project) => project.name);

  return (
    <>
      <SettingsGroup title="Which CLIs run in a container" description="Each name opens that CLI’s page.">
        <table className="w-full max-w-[520px] text-ui">
          <tbody className="divide-y divide-border-soft">
            {HARNESS_IDS.map((cli) => {
              // The same flag main's refusals read (HIVE-377 D2).
              const ok = CAPABILITIES[cli].container;
              return (
                <tr key={cli}>
                  <th scope="row" className="py-2 pr-4 text-left font-normal">
                    <button
                      type="button"
                      onClick={() => openSettings(cli)}
                      className="text-ink hover:underline"
                    >
                      {CLI_NAMES[cli]}
                    </button>
                  </th>
                  <td className={ok ? 'py-2 text-muted' : 'py-2 text-subtle'}>
                    {ok ? 'Yes' : 'Not supported'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </SettingsGroup>

      {/* Plain text, no links (D5): a project's container is edited from its own row. */}
      <SettingsGroup title="Projects in a container" description="A container profile belongs to its project.">
        <p className="text-ui-sm text-muted">
          Running in a container: {inContainer.length === 0 ? 'None yet' : inContainer.join(', ')}. Edit a
          project’s container from Projects › Projects › ⋯ › Runtime overrides.
        </p>
      </SettingsGroup>

      <ContainerAliasGroup hostAlias={snapshot.receiver.hostAlias} bind={snapshot.receiver.bind} />
    </>
  );
}
