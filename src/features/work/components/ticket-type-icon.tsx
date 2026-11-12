import { ArrowElbowDownRight, BookmarkSimple, Bug, CheckSquare, Circle, Lightning, type Icon } from '@phosphor-icons/react';

import { cn } from '@/lib/utils';

import { Hint } from '@components/ui/hint';

/** Jira's stock types, lower-cased. Any other name (Spike, a custom type) draws the quiet circle. */
const TYPES: Record<string, { icon: Icon; tint: string }> = {
  bug: { icon: Bug, tint: 'text-red' },
  story: { icon: BookmarkSimple, tint: 'text-green' },
  task: { icon: CheckSquare, tint: 'text-code-type' },
  'sub-task': { icon: ArrowElbowDownRight, tint: 'text-code-type' },
  subtask: { icon: ArrowElbowDownRight, tint: 'text-code-type' },
  epic: { icon: Lightning, tint: 'text-code-keyword' },
};

const OTHER = { icon: Circle, tint: 'text-subtle' };

/**
 * A ticket's Jira issue type as a glyph beside its key, so a bug reads apart
 * from a story at a glance. Nothing without a type: fixtures carry none.
 */
export function TicketTypeIcon({
  type,
  size = 12,
  className,
}: {
  type: string | undefined;
  size?: number;
  className?: string;
}) {
  if (!type) return null;
  const { icon: Glyph, tint } = TYPES[type.toLowerCase()] ?? OTHER;

  return (
    <Hint label={type}>
      <span role="img" aria-label={type} className={cn('inline-flex shrink-0', tint, className)}>
        <Glyph size={size} weight="bold" aria-hidden />
      </span>
    </Hint>
  );
}
