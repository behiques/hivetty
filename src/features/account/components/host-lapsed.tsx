import { useState } from 'react';

import { Button } from '@components/ui/button';
import { setRemoteConfig } from '@lib/project-config';
import { useApplyModeChange } from '@stores/hive-store';

/** An attached server's licence lapsed (HIVE-265): its sessions are paused there, so the one way on is to leave. */
export function HostLapsed({ serverName }: { serverName: string }) {
  const applyModeChange = useApplyModeChange();
  const [leaving, setLeaving] = useState(false);
  const disconnect = (): void => {
    setLeaving(true);
    void setRemoteConfig({ mode: 'local' }).then(({ changed }) => {
      setLeaving(false);
      // As server-mode-group's handleDetach: coming back to this machine clears the server's fleet.
      if (changed) applyModeChange(changed);
    });
  };
  return (
    <div className="flex w-full max-w-[460px] flex-col gap-4 rounded-xl border border-border bg-panel p-6">
      <div className="flex items-start gap-2.5">
        <span className="mt-2.5 size-2 shrink-0 rounded-full bg-red" aria-hidden />
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-ink">{`${serverName}'s licence has lapsed`}</h2>
          <p className="text-control text-muted">Its sessions are paused.</p>
        </div>
      </div>
      <div className="flex justify-end">
        <Button pending={leaving} disabled={leaving} onClick={disconnect}>
          Disconnect
        </Button>
      </div>
    </div>
  );
}
