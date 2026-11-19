import type { ReactNode } from 'react';

import { Button } from '@components/ui/button';
import { useSwarmActions } from '@hooks/use-swarm-actions';
import { useSwarms } from '@hooks/use-swarms';
import { providerOf } from '@lib/swarms';

/**
 * Said where a shipped skill or agent is needed and missing (HIVE-447): which swarm provides it and a button to
 * install that swarm, or, when the registry names none, that it isn't installed and a button to browse. It starts
 * and wakes nothing; the site that renders it stands in for the action. `children` is an extra control after the
 * button.
 */
export function MissingSwarm({
  kind,
  name,
  children,
}: {
  kind: 'agent' | 'skill';
  name: string;
  children?: ReactNode;
}) {
  const { listing } = useSwarms();
  const { install, browse } = useSwarmActions();
  const provider = providerOf(listing, kind, name);

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2"
    >
      <p className="min-w-0 flex-1 text-ui-sm text-muted">
        <code className="font-mono text-ink">{name}</code>
        {provider === null ? " isn't installed." : ` comes with the ${provider.title} swarm.`}
      </p>
      {provider === null ? (
        <Button size="sm" onClick={browse}>
          Browse swarms
        </Button>
      ) : (
        <Button size="sm" variant="primary" onClick={() => install(provider.id)}>
          {`Install ${provider.title}`}
        </Button>
      )}
      {children}
    </div>
  );
}
