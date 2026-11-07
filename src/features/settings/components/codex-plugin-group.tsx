import { useEffect, useState } from 'react';

import { Switch } from '@/components/ui/switch';

import { SettingsGroup } from '@features/shared/components/settings-group';
import { readCodexPluginStatus, setCliConfig } from '@lib/project-config';
import type { CodexPluginStatus } from '@shared/cli-contract';
import type { ConfigSnapshot } from '@shared/config-contract';

/**
 * Settings › Harnesses › Codex (HIVE-372): the opt-in `codex plugin add hive@hivetty`, for Codex's own /skills list
 * and $ completion. Off by default; main runs Codex's commands and this row shows what they last found or did.
 */
export function CodexPluginGroup({ snapshot, server }: { snapshot: ConfigSnapshot; server: string | null }) {
  const on = snapshot.clis.codex.installSkills === true;
  const [status, setStatus] = useState<CodexPluginStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void readCodexPluginStatus().then((next) => {
      if (current) setStatus(next);
    });
    return () => {
      current = false;
    };
  }, []);

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      await setCliConfig({ cli: 'codex', installSkills: next });
      setStatus(await readCodexPluginStatus());
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsGroup
      title="Codex's own skill list"
      description="HiveTTY's skills already reach every Codex session it starts. Installing them as a Codex plugin also lists them in /skills and $ completion, as hive:hive-work-on."
    >
      <Switch
        label="Install HiveTTY's skills into Codex"
        description={`On ${server ?? 'this Mac'}, Codex will write to ~/.codex and list the plugin under codex plugin list. These skills will also load when Codex runs outside HiveTTY, where they only say they need a HiveTTY session. Turning this off removes the plugin.`}
        checked={on}
        disabled={busy}
        onCheckedChange={(next) => void toggle(next)}
      />
      {status?.state === 'installed' && (
        <p className="text-ui-sm text-muted">Installed as hive@hivetty {status.version}</p>
      )}
      {status?.state === 'failed' && (
        <p role="alert" className="rounded-md border border-red px-2.5 py-1.5 text-ui-sm text-red">
          {status.command} failed: {status.message}
        </p>
      )}
    </SettingsGroup>
  );
}
