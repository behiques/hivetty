import { cn } from '@/lib/utils';

/** The account's letter on the brand fill (HIVE-265): the activity bar's trigger and the Account & devices card. */
export function AccountAvatar({ initial, size = 'sm' }: { initial: string; size?: 'sm' | 'lg' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-brand-fill font-bold text-on-brand',
        size === 'sm' ? 'size-6 text-micro' : 'size-10 text-ui',
      )}
    >
      {initial}
    </span>
  );
}
