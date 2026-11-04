import { ServerModeGroup } from '@features/settings/components/server-mode-group';
import { SettingsSectionHeader } from '@features/settings/components/settings-section-header';
import {
  useAttachedServer,
  useLocalRemote,
  useProjectConfig,
  useServing,
} from '@hooks/use-project-config';
import { useRemoteLink } from '@stores/hive-store';

/**
 * Machines › Server mode (HIVE-380): serving this Mac and attaching to
 * another, moved out of Advanced unchanged. Runners (HIVE-302) and Relay
 * (HIVE-285) join Machines with their own stories.
 *
 * Whose settings these are while attached is the group's own business: its
 * hints name the server's bind and roster where they appear (HIVE-156).
 */
export function ServerModeSection() {
  const snapshot = useProjectConfig();
  /*
    The runtime half of the attach half's state (Ruling 29): whether a socket
    is open right now, which the snapshot cannot say.
  */
  const attachedServerName = useAttachedServer();
  /* Whether that attachment is reachable right now, for the status line (HIVE-150). */
  const remoteLink = useRemoteLink();
  /*
    Whether *this* process was launched to serve (HIVE-144 review, I3) — not
    `snapshot.server.enabled`, which while attached describes the server's file.
  */
  const serving = useServing();
  /*
    This machine's own `remote` block (HIVE-149), for the two address fields
    whose subject is this window: `snapshot.remote` comes from the server
    while attached.
  */
  const localRemote = useLocalRemote();

  if (!snapshot) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
        <SettingsSectionHeader
          title="Server mode"
          description="Server mode is only available in the desktop app."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
      <SettingsSectionHeader
        title="Server mode"
        description="Serve this Mac's sessions to your other machines, or drive one that serves."
      />

      <ServerModeGroup
        enabled={snapshot.server.enabled}
        bind={snapshot.server.bind}
        devices={snapshot.server.devices}
        remote={snapshot.remote}
        localRemote={localRemote}
        attachedServer={snapshot.attachedServer}
        attachedServerName={attachedServerName}
        serving={serving}
        link={remoteLink}
      />
    </div>
  );
}
