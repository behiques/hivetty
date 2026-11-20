import { CaretRight, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tag } from '@/components/ui/tag';
import {
  badgeOf,
  countsOf,
  itemLabel,
  missingOf,
  needsConsent,
  offHeading,
  onCountsText,
  publisherOf,
  rowState,
  stateText,
  turnedOff,
  type KeptFile,
  type SwarmItemRow,
  type SwarmRowState,
} from '@/features/settings/lib/swarm-view';
import { InlineConfirm } from '@/features/shared/components/inline-confirm';
import { HeldBanner } from '@/features/shared/components/shipped-marker';
import { cn } from '@/lib/utils';

import { isBundled, type SwarmFailure, type SwarmItemKind, type SwarmListing, type SwarmListItem } from '@shared/swarm-contract';

interface SwarmRowProps {
  item: SwarmListItem;
  source: SwarmListing['source'];
  busy: boolean;
  /** The call in flight is a removal. */
  removing?: boolean;
  /** A first install that failed in this run: the row is "Not installed" with this message. */
  failure: SwarmFailure | undefined;
  kept: KeptFile[];
  /** A sentence the pane holds for this row, such as why Remove was refused. */
  notice?: string | null;
  onAction: () => void;
  onDismiss: () => void;
  onAutoUpdate: (next: boolean) => void;
  onRemove: () => void;
  onTake: (file: KeptFile) => void;
  onKeep: (file: KeptFile) => void;
  /** HIVE-453: turn one of this swarm's items back on. */
  onTurnOn: (kind: SwarmItemKind, name: string) => void;
  /** HIVE-453: put a missing item back from the swarm. */
  onRestore: (kind: SwarmItemKind, name: string) => void;
}

/** The dot repeats the state text, so it is decoration; its colour is a token. */
const DOT: Record<SwarmRowState, string> = {
  current: 'bg-green',
  ready: 'bg-amber',
  available: 'bg-amber',
  'not-installed': 'bg-red',
  'failed-update': 'bg-red',
  // ccpulse is collapsed by the reduced-motion rule in global.css, so the dot stands still there.
  updating: 'bg-brand animate-ccpulse',
  removing: 'bg-brand animate-ccpulse',
  gone: 'bg-muted',
};

/** The row's one action, or null. A community update is reviewed; the rest apply. */
function actionOf(state: SwarmRowState, item: SwarmListItem): string | null {
  switch (state) {
    case 'available':
      return 'Review update';
    case 'ready':
    case 'failed-update':
      return needsConsent(item) ? 'Review update' : 'Update now';
    case 'not-installed':
      return 'Try again';
    default:
      return null;
  }
}

/** The line under the row: why it failed, or why it will not update. */
function messageOf(state: SwarmRowState, item: SwarmListItem, failure: SwarmFailure | undefined): string | null {
  if (state === 'not-installed') return failure?.message ?? null;
  if (state === 'failed-update') return item.installed?.lastError?.message ?? null;
  // A rejected update call: main recorded no lastError, so the pane's held failure is all there is.
  if (state === 'ready' || state === 'available') return failure?.message ?? null;
  if (state === 'gone') {
    const org = item.installed?.kind === 'organization' ? item.installed.org?.name : undefined;
    return org === undefined ? "No longer available. It won't update." : `No longer available from ${org}. It won't update.`;
  }
  return null;
}

function KeptFiles({
  kept,
  onTake,
  onKeep,
}: {
  kept: KeptFile[];
  onTake: (file: KeptFile) => void;
  onKeep: (file: KeptFile) => void;
}) {
  const [open, setOpen] = useState(false);
  const label =
    kept.length === 1 ? '1 file kept as you edited it' : `${String(kept.length)} files kept as you edited them`;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex w-fit items-center gap-1 rounded-md text-ui-sm text-amber-text hover:text-ink"
      >
        <CaretRight size={11} className={cn('shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
        {label}
      </button>
      {open
        ? kept.map((file) => (
            <div key={`${file.kind}/${file.name}`} className="flex flex-col gap-1">
              <p className="text-ui-sm font-semibold text-ink">{file.kind === 'skills' ? `/${file.name}` : file.name}</p>
              <HeldBanner status={file.status} onTake={() => onTake(file)} onKeep={() => onKeep(file)} />
            </div>
          ))
        : null}
    </div>
  );
}

/** A heading and one line per item, each with its action or the reason there is none (HIVE-453). */
function ItemSection({
  heading,
  warning = false,
  note,
  rows,
  action,
  disabled,
  waiting,
  onAction,
}: {
  heading: string;
  warning?: boolean;
  note?: string;
  rows: SwarmItemRow[];
  action: string;
  disabled: boolean;
  /** Said in place of the button when the action cannot happen yet. */
  waiting?: string | null;
  onAction: (row: SwarmItemRow) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className={cn('flex items-center gap-1 text-ui-sm', warning ? 'text-amber-text' : 'text-muted')}>
        {warning ? <WarningCircle size={12} className="shrink-0" aria-hidden /> : null}
        {heading}
      </p>
      {rows.map((row) => (
        <div key={`${row.kind}/${row.name}`} className="flex items-center gap-3 pl-4">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-ui-sm font-semibold text-ink">{itemLabel(row)}</span>
            {note === undefined ? null : <span className="text-ui-sm text-subtle">{note}</span>}
          </div>
          {waiting === null || waiting === undefined ? (
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${action} ${itemLabel(row)}`}
              disabled={disabled}
              onClick={() => onAction(row)}
            >
              {action}
            </Button>
          ) : (
            <span className="shrink-0 text-ui-sm text-subtle">{waiting}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** One swarm in Settings › Swarms (HIVE-442). Presentational: the pane owns every call. */
export function SwarmRow({
  item,
  source,
  busy,
  removing = false,
  failure,
  kept,
  notice = null,
  onAction,
  onDismiss,
  onAutoUpdate,
  onRemove,
  onTake,
  onKeep,
  onTurnOn,
  onRestore,
}: SwarmRowProps) {
  const [confirming, setConfirming] = useState(false);
  const state = rowState(item, source, busy, removing);
  const action = actionOf(state, item);
  const message = messageOf(state, item, failure);
  const title = item.installed?.title ?? item.entry?.title ?? '';
  const contents = item.installed?.contents ?? item.entry ?? { agents: [], skills: [] };
  const publisher = publisherOf(item);
  const updating = state === 'updating' || state === 'removing';
  const org = item.entry?.org ?? item.installed?.org ?? null;
  const off = turnedOff(item);
  const missing = missingOf(item);
  const counts =
    item.installed === null ? countsOf(contents) : `${countsOf(contents)} · ${onCountsText(item)}`;
  const pinned =
    item.entry?.kind === 'organization' && item.entry.policy === 'pinned' && item.entry.pinnedVersion !== null
      ? `Pinned to v${item.entry.pinnedVersion} by ${org?.name ?? 'your organization'}`
      : null;

  return (
    <li className="flex flex-col gap-2 border-b border-border-soft px-3 py-2.5 last:border-b-0">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-ui font-semibold text-ink">{title}</span>
            <Tag tone={badgeOf(item) === 'Community' ? 'subtle' : 'brand'} className="shrink-0">
              {badgeOf(item)}
            </Tag>
          </div>
          <span className="truncate text-ui-sm text-subtle">
            {publisher === '' ? counts : `${publisher} · ${counts}`}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-1.5 text-ui-sm text-muted">
            <span data-dot aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT[state])} />
            {stateText(state, item)}
          </span>
          {action === null ? null : (
            <Button size="sm" variant={action === 'Try again' ? 'secondary' : 'primary'} onClick={onAction}>
              {action}
            </Button>
          )}
          {state === 'not-installed' ? (
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          ) : null}
        </div>
      </div>

      {message === null ? null : (
        <p className={cn('text-ui-sm', state === 'gone' ? 'text-subtle' : 'text-red')}>{message}</p>
      )}

      {notice === null ? null : <p className="text-ui-sm text-red">{notice}</p>}

      {off.length === 0 ? null : (
        <ItemSection
          heading={offHeading(off, 'turned off')}
          rows={off}
          action="Turn on"
          disabled={busy || updating}
          onAction={(row) => onTurnOn(row.kind, row.name)}
        />
      )}

      {missing.length === 0 ? null : (
        <ItemSection
          heading={offHeading(missing, 'missing')}
          warning
          note="Deleted outside HiveTTY. Updates won't bring it back by themselves."
          rows={missing}
          action="Restore"
          disabled={busy || updating}
          // The bundled Dev Squad has no clone to copy from until its first update.
          waiting={
            item.installed !== null && isBundled(item.installed.version)
              ? `Can be restored after ${title}'s first update.`
              : null
          }
          onAction={(row) => onRestore(row.kind, row.name)}
        />
      )}

      {kept.length === 0 ? null : <KeptFiles kept={kept} onTake={onTake} onKeep={onKeep} />}

      {item.installed === null ? null : confirming ? (
        <InlineConfirm
          label={`Remove ${title}`}
          title={`Remove ${title}?`}
          confirmLabel="Remove"
          className="rounded-md"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onRemove();
          }}
        >
          Files you edited are kept.
        </InlineConfirm>
      ) : (
        <div className="flex items-center gap-3 border-t border-border-soft pt-2">
          {state === 'gone' ? null : pinned === null ? (
            <div className="w-fit">
              <Switch
                label="Update automatically"
                checked={item.installed.autoUpdate}
                onCheckedChange={onAutoUpdate}
                disabled={updating}
              />
            </div>
          ) : (
            <span className="text-ui-sm text-subtle">{pinned}</span>
          )}
          <Button size="sm" variant="ghost" className="ml-auto" disabled={updating} onClick={() => setConfirming(true)}>
            Remove
          </Button>
        </div>
      )}
    </li>
  );
}
