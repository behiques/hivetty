import { Button } from '@components/ui/button';
import { useAccount } from '@hooks/use-account';
import { useSwarmActions } from '@hooks/use-swarm-actions';
import { useSwarms } from '@hooks/use-swarms';
import { standardOf } from '@lib/swarms';

/**
 * Install Standard and Browse swarms, for a place that is empty because nothing is installed (HIVE-447). A fragment:
 * the caller lays the buttons out. Install names the registry's Standard row (the consent dialog, sign-in first when
 * signed out) or, with no row, signs in; it is left out when Standard is installed already. Signed in with no row yet
 * (the listing still loading, or a failed read), signing in again would do nothing, so it opens Browse instead.
 */
export function SwarmStarters({ size }: { size?: 'sm' }) {
  const { listing } = useSwarms();
  const { install, browse } = useSwarmActions();
  const signedIn = useAccount()?.kind === 'signed-in';
  const standard = standardOf(listing);
  const onInstall = (): void => {
    if (standard === null && signedIn) browse();
    else install(standard?.id ?? null);
  };

  return (
    <>
      {standard?.installed === true ? null : (
        <Button size={size} variant="primary" onClick={onInstall}>
          Install Standard
        </Button>
      )}
      <Button size={size} onClick={browse}>
        Browse swarms
      </Button>
    </>
  );
}
