import { WhatsNewDialog } from '@features/whats-new/components/whats-new-dialog';
import { useWhatsNewAtLaunch } from '@features/whats-new/hooks/use-whats-new-at-launch';
import { latestWhatsNew, majorMinor, RELEASES } from '@features/whats-new/releases';
import { useWhatsNewPrefs } from '@stores/appearance-store';
import { useSetWhatsNewOpen, useWhatsNewOpen } from '@stores/ui-store';

/**
 * What's new (1.0), mounted once by the shell: opens itself at launch for a
 * release that has an entry, or when Settings asks. The running version's
 * entry when there is one, else the newest. Closing it any way records that
 * entry as seen; the box also turns future ones off.
 */
export function WhatsNew() {
  const version = useWhatsNewAtLaunch();
  const open = useWhatsNewOpen();
  const setOpen = useSetWhatsNewOpen();
  const { setSeen, setOff } = useWhatsNewPrefs();

  if (!open) return null;
  const entry = (version === null ? undefined : RELEASES.find((r) => r.version === majorMinor(version))) ?? latestWhatsNew();

  return (
    <WhatsNewDialog
      entry={entry}
      onClose={(optOut) => {
        setSeen(entry.version);
        if (optOut) setOff(true);
        setOpen(false);
      }}
    />
  );
}
