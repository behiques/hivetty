import { CaretRight } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';

interface SwarmGroupProps {
  /** The swarm's name; drawn uppercase by CSS, so the DOM keeps "Dev Squad". */
  title: string;
  /** Right-aligned after the title: "13 of 14 on" for a swarm, a plain count for My swarm. */
  counts: string;
  children: ReactNode;
}

/**
 * One folding section of a Settings list grouped by swarm: a caret header in
 * the rail's uppercase style, then its rows. Fold state is local and not
 * persisted, and deliberately not the Agents place's `agentsFolded`.
 */
export function SwarmGroup({ title, counts, children }: SwarmGroupProps) {
  const [folded, setFolded] = useState(false);

  return (
    <section aria-label={title} className="flex flex-col">
      <button
        type="button"
        aria-expanded={!folded}
        onClick={() => setFolded((value) => !value)}
        className="flex items-center gap-2 border-b border-border-soft bg-panel px-2.5 pt-2 pb-1.5 text-ui-sm font-semibold tracking-[0.06em] text-subtle uppercase hover:text-ink"
      >
        <CaretRight size={12} aria-hidden="true" className={folded ? '' : 'rotate-90'} />
        {title}
        <span className="ml-auto font-medium tracking-normal normal-case">{counts}</span>
      </button>

      {folded ? null : children}
    </section>
  );
}
