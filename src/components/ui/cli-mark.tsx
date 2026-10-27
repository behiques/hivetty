import { cn } from '@/lib/utils';

import type { HarnessId } from '@shared/harness-contract';

/** One letter on one token fill per CLI (HIVE-279): enough to tell a mixed fleet apart at a glance. */
const MARKS: Record<HarnessId, { letter: string; fill: string }> = {
  'claude-code': { letter: 'C', fill: 'bg-brand-fill' },
  codex: { letter: 'X', fill: 'bg-green' },
  copilot: { letter: 'G', fill: 'bg-subtle' },
};

/** Decorative: the CLI's name is always written beside it. */
export function CliMark({ cli, className }: { cli: HarnessId; className?: string }) {
  const { letter, fill } = MARKS[cli];
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-grid size-4 shrink-0 place-items-center rounded-xs font-mono text-micro font-bold text-on-brand',
        fill,
        className,
      )}
    >
      {letter}
    </span>
  );
}
