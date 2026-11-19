import { CaretLeft } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { SearchBox } from '@/components/ui/search-box';
import { Tag } from '@/components/ui/tag';
import { badgeOf, browseGroups, countsOf, matches, type BrowseGroup } from '@/features/settings/lib/swarm-view';
import { useAccount } from '@/hooks/use-account';
import { signIn } from '@/lib/account';

import type { SwarmListing, SwarmListItem } from '@shared/swarm-contract';

interface SwarmsBrowseProps {
  listing: SwarmListing | null;
  busy: ReadonlySet<string>;
  onBack: () => void;
  onInstall: (item: SwarmListItem) => void;
  onReview: (item: SwarmListItem) => void;
  onRetry: () => void;
}

type BrowseItem = BrowseGroup['items'][number];

function RowControl({
  item,
  busy,
  onInstall,
  onReview,
}: {
  item: BrowseItem;
  busy: boolean;
  onInstall: () => void;
  onReview: () => void;
}) {
  if (busy || item.update?.updating === true) {
    return (
      <span className="flex items-center gap-1.5 text-ui-sm text-muted">
        <span aria-hidden="true" className="size-2 rounded-full bg-brand animate-ccpulse" />
        Updating…
      </span>
    );
  }
  if (item.installed === null) {
    return (
      <Button size="sm" variant="primary" onClick={onInstall}>
        Install
      </Button>
    );
  }
  if (item.entry.kind === 'community' && item.update !== null) {
    return (
      <Button size="sm" variant="primary" onClick={onReview}>
        Review update
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-ui-sm text-muted">
      <span aria-hidden="true" className="size-2 rounded-full bg-green" />
      Installed
    </span>
  );
}

function Notice({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center">
      <p className="text-ui-sm text-muted">{text}</p>
      <Button size="sm" onClick={onAction}>
        {action}
      </Button>
    </div>
  );
}

/** Browse the swarm registry (HIVE-442), in place of the installed list. Install goes through the pane's consent. */
export function SwarmsBrowse({ listing, busy, onBack, onInstall, onReview, onRetry }: SwarmsBrowseProps) {
  const account = useAccount();
  const [query, setQuery] = useState('');

  /*
    The account first, never `source` alone: `none` also means a cloud that could not be reached, and
    asking a signed-in person to sign in would be wrong. A null account or listing is still loading.
  */
  let body: ReactNode = null;
  if (account !== null && account.kind !== 'signed-in') {
    body = <Notice text="Sign in to browse swarms." action="Sign in" onAction={() => void signIn()} />;
  } else if (account !== null && listing?.source === 'none') {
    body = <Notice text="Couldn't load swarms." action="Try again" onAction={onRetry} />;
  } else if (account !== null && listing !== null) {
    const groups = browseGroups(listing)
      .map((group) => ({ ...group, items: group.items.filter((item) => matches(item.entry, query)) }))
      .filter((group) => group.items.length > 0);

    body = (
      <>
        <SearchBox
          label="Search swarms, publishers, agents and skills"
          value={query}
          onChange={setQuery}
          onClear={() => setQuery('')}
        />
        {groups.length === 0 && query.trim() !== '' ? (
          <p className="text-ui-sm text-subtle">{`No swarms match “${query.trim()}”.`}</p>
        ) : null}
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label} className="flex flex-col gap-1.5">
            <h3 className="text-ui-sm font-semibold tracking-[0.06em] text-subtle uppercase">{group.label}</h3>
            <ul className="flex flex-col rounded-lg border border-border">
              {group.items.map((item) => {
                const meta = [
                  item.entry.publisher,
                  countsOf(item.entry),
                  item.entry.version === null ? '' : `v${item.entry.version}`,
                ].filter((part) => part !== '');
                return (
                  <li
                    key={item.entry.id}
                    className="flex items-start gap-3 border-b border-border-soft px-3 py-2.5 last:border-b-0"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-ui font-semibold text-ink">{item.entry.title}</span>
                        <Tag tone={item.entry.kind === 'community' ? 'subtle' : 'brand'} className="shrink-0">
                          {badgeOf(item)}
                        </Tag>
                      </div>
                      <span className="truncate text-ui-sm text-subtle">
                        {meta.join(' · ')}
                      </span>
                      {item.entry.description === '' ? null : (
                        <span className="text-ui-sm text-muted">{item.entry.description}</span>
                      )}
                    </div>
                    <div className="shrink-0">
                      <RowControl
                        item={item}
                        busy={busy.has(item.entry.id)}
                        onInstall={() => onInstall(item)}
                        onReview={() => onReview(item)}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      <button
        type="button"
        onClick={onBack}
        className="flex w-fit items-center gap-1 rounded-md text-ui-sm text-muted hover:text-ink"
      >
        <CaretLeft size={12} aria-hidden />
        Installed swarms
      </button>
      <h2 className="text-ui-lg font-semibold text-ink">Browse swarms</h2>
      {body}
    </div>
  );
}
