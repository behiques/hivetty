import { useEffect, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { TitleBar } from '@components/layout/title-bar';
import { Gate } from '@features/account/components/gate';
import { HostLapsed } from '@features/account/components/host-lapsed';
import { useCodeSignIn } from '@features/account/hooks/use-code-sign-in';
import { useHostLicence } from '@features/account/hooks/use-host-licence';
import { gateView } from '@features/account/lib/gate-view';
import { useAccount } from '@hooks/use-account';
import { useGateOff } from '@hooks/use-gate-off';
import { useLicence } from '@hooks/use-licence';
import { useRemoteLink } from '@stores/hive-store';
import { useSetGated } from '@stores/ui-store';

/**
 * The hard gate (HIVE-265). Until this window first sees a licence, the gate renders **instead of** the shell,
 * so no watcher, chord or session subscription runs. After that, a lapse renders the gate **over** the shell,
 * which stays mounted (the terminals keep their buffers for the resume), `inert` and dimmed. `gated` tells the
 * window keydown listeners to stand down, because `inert` does not reach `window`.
 *
 * While attached, a server whose licence lapsed draws its own card over the shell the same way. This window's own
 * gate comes first: the host's card shows only when this machine is not gated itself.
 */
export function LicenceGate({ children }: { children: ReactNode }) {
  const off = useGateOff();
  const account = useAccount();
  const licence = useLicence();
  const code = useCodeSignIn();
  const view =
    off === null ? { kind: 'loading' as const } : off ? { kind: 'open' as const } : gateView(account, licence, code);
  const [opened, setOpened] = useState(false);
  if (view.kind === 'open' && !opened) setOpened(true); // derived once, during render: no frame of gate after a licence
  const shown = view.kind !== 'open' && view.kind !== 'loading' ? view : null;
  const host = useHostLicence();
  const link = useRemoteLink();
  const hostLapsed = shown === null && host?.lapsed === true && link !== null;
  const setGated = useSetGated();
  const gated = opened && (shown !== null || hostLapsed);
  useEffect(() => {
    setGated(gated);
  }, [gated, setGated]);

  if (!opened) {
    if (!shown) return null;
    return (
      <div className="flex h-full flex-col bg-bg">
        <TitleBar />
        <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-4 py-7">
          <Gate view={shown} onSignInWithCode={code.start} />
        </div>
      </div>
    );
  }
  return (
    <div className="relative h-full">
      <div className={cn('h-full', gated && 'opacity-40')} inert={gated}>
        {children}
      </div>
      {gated ? (
        <div className="absolute inset-0 z-[60] grid place-items-center overflow-y-auto bg-scrim px-4 py-7 backdrop-blur-[3px]">
          {shown ? (
            <Gate view={shown} onSignInWithCode={code.start} />
          ) : link ? (
            <HostLapsed serverName={link.serverName} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
