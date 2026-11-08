import { cn } from '@/lib/utils';

/**
 * The account's letter on the brand fill (HIVE-265): the activity bar's trigger and the Account & devices card.
 * HIVE-291: `badge`, the active org's letters, in the corner while there is a second org to switch to.
 */
export function AccountAvatar({
  initial,
  size = 'sm',
  badge,
}: {
  initial: string;
  size?: 'sm' | 'lg';
  badge?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative grid shrink-0 place-items-center rounded-full bg-brand-fill font-bold text-on-brand',
        size === 'sm' ? 'size-6 text-micro' : 'size-10 text-ui',
      )}
    >
      {initial}
      {badge ? (
        <span className="absolute -right-2 -bottom-1.5 rounded border border-border bg-chip px-0.5 font-mono text-micro leading-none text-ink">
          {badge}
        </span>
      ) : null}
    </span>
  );
}
