import { Button } from '@components/ui/button';
import { useSwarmActions } from '@hooks/use-swarm-actions';
import { useSwarms } from '@hooks/use-swarms';
import { standardOf } from '@lib/swarms';

/**
 * Install Standard and Browse swarms, for a place that is empty because nothing is installed (HIVE-447). A fragment:
 * the caller lays the buttons out. Install names the registry's Standard row (the consent dialog, sign-in first when
 * signed out) or, with no row, signs in; it is left out when Standard is installed already.
 */
export function SwarmStarters({ size }: { size?: 'sm' }) {
  const { listing } = useSwarms();
  const { install, browse } = useSwarmActions();
  const standard = standardOf(listing);

  return (
    <>
      {standard?.installed === true ? null : (
        <Button size={size} variant="primary" onClick={() => install(standard?.id ?? null)}>
          Install Standard
        </Button>
      )}
      <Button size={size} onClick={browse}>
        Browse swarms
      </Button>
    </>
  );
}
