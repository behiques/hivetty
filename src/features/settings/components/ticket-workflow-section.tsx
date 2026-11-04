import { SettingsSectionHeader } from '@features/settings/components/settings-section-header';
import { TicketWorkflowGroup } from '@features/settings/components/ticket-workflow-group';
import { useProjectConfig } from '@hooks/use-project-config';
import { useSettingsActions } from '@stores/ui-store';

/**
 * Automation › Ticket workflow (HIVE-379). Out of the Jira band in Integrations: it is about what a session does,
 * not how Jira is reached. Drawn with no Jira site too, since it only reads and writes `jira.workflow` in config.
 */
export function TicketWorkflowSection() {
  const snapshot = useProjectConfig();
  const { openSettings } = useSettingsActions();

  if (!snapshot) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
        <SettingsSectionHeader
          title="Ticket workflow"
          description="The ticket workflow is only available in the desktop app."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
      <SettingsSectionHeader
        title="Ticket workflow"
        description="What a session started from a Jira ticket in Work does first."
      />
      {snapshot.jira.site === null && (
        <p className="text-control text-subtle">
          Sessions start from tickets once Jira is connected in{' '}
          <button type="button" onClick={() => openSettings('integrations')} className="text-ink hover:underline">
            Integrations
          </button>
          .
        </p>
      )}
      <TicketWorkflowGroup workflow={snapshot.jira.workflow} />
    </div>
  );
}
