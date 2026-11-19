import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { SettingsSectionHeader } from '@/features/settings/components/settings-section-header';
import { SwarmConsent } from '@/features/settings/components/swarm-consent';
import { SwarmRow } from '@/features/settings/components/swarm-row';
import { SwarmsBrowse } from '@/features/settings/components/swarms-browse';
import {
  installedRows,
  keptFiles,
  needsConsent,
  resolveInstallLink,
} from '@/features/settings/lib/swarm-view';
import { useAccount } from '@/hooks/use-account';
import { useShipped } from '@/hooks/use-shipped';
import { useSwarms } from '@/hooks/use-swarms';
import { signIn } from '@/lib/account';
import { keepShippedMine, loadShipped, takeShippedPrompt } from '@/lib/shipped';
import {
  checkSwarms,
  dismissSwarmFailure,
  installSwarm,
  loadSwarms,
  removeSwarm,
  setSwarmAutoUpdate,
} from '@/lib/swarms';
import {
  useSetSwarmInstallRequest,
  useSetSwarmsBrowseRequest,
  useSwarmInstallRequest,
  useSwarmsBrowseRequest,
} from '@/stores/ui-store';

import type { SwarmListItem } from '@shared/swarm-contract';

const LEDE =
  'Sets of agents and skills that install together and update when their publisher releases a new version. Saved under ~/.hivetty.';

const idOf = (item: SwarmListItem): string => item.entry?.id ?? item.installed?.swarmId ?? '';

/** What an install link could not do yet, or at all (HIVE-442), above the list. */
function LinkNotice({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <div role="status" className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
      <p className="flex-1 text-ui-sm text-muted">{text}</p>
      <Button size="sm" onClick={onAction}>
        {action}
      </Button>
    </div>
  );
}

/** Settings › Automation › Swarms (HIVE-442): the installed list, Browse in place, and consent before installing. */
export function SwarmsSection() {
  const { listing, busy, removing, failures, lastUpdate } = useSwarms();
  const agents = useShipped('agents');
  const skills = useShipped('skills');
  const [browsing, setBrowsing] = useState(false);
  const [checking, setChecking] = useState(false);
  /*
    The id, not a copy of the item: the dialog draws the swarm as the listing has it now, so a
    `swarms:changed` that moves the version while it is open redraws it, and Install never sends main
    a version the person did not see. A swarm that left the listing closes it.
  */
  const [consentId, setConsentId] = useState<string | null>(null);
  const consent = consentId === null ? null : (listing?.items.find((item) => item.entry?.id === consentId) ?? null);
  const [notices, setNotices] = useState<ReadonlyMap<string, string>>(new Map());
  const account = useAccount();
  const signedIn = account?.kind === 'signed-in';
  const linkRequest = useSwarmInstallRequest();
  const setLinkRequest = useSetSwarmInstallRequest();
  const [linkUnavailable, setLinkUnavailable] = useState(false);
  const browseRequest = useSwarmsBrowseRequest();
  const setBrowseRequest = useSetSwarmsBrowseRequest();
  const wasSignedIn = useRef(signedIn);
  const linkResolution =
    linkRequest === null || account === null ? null : resolveInstallLink(linkRequest, signedIn, listing);
  const linkKind = linkResolution?.kind ?? null;
  const linkConsentId = linkResolution?.kind === 'consent' ? (linkResolution.item.entry?.id ?? null) : null;

  /*
    An install link (HIVE-442) goes no further than the consent dialog: `setConsentId`, never `request` and
    never `installSwarm`. Sign-in and wait keep the request; the other three answer it and clear it.
  */
  useEffect(() => {
    if (linkKind === 'consent') {
      setConsentId(linkConsentId);
      setLinkUnavailable(false);
      setLinkRequest(null);
    } else if (linkKind === 'installed') {
      setLinkUnavailable(false);
      setLinkRequest(null);
    } else if (linkKind === 'unavailable') {
      setLinkUnavailable(true);
      setLinkRequest(null);
    }
  }, [linkKind, linkConsentId, setLinkRequest]);

  // A missing-swarm notice's Browse swarms (HIVE-447): open on Browse, then clear the request. Nothing else.
  useEffect(() => {
    if (!browseRequest) return;
    setBrowsing(true);
    setBrowseRequest(false);
  }, [browseRequest, setBrowseRequest]);

  // Signed in with a link waiting: the list read signed out has no rows for this account, so read it again.
  useEffect(() => {
    const was = wasSignedIn.current;
    wasSignedIn.current = signedIn;
    if (signedIn && !was && linkRequest !== null) void loadSwarms();
  }, [signedIn, linkRequest]);

  // Kept files are read from the shipped status; ask again whenever the list moves.
  useEffect(() => {
    void loadShipped();
  }, [listing]);

  /** Every path to `swarms:install` (HIVE-442). Consent first for anything not installed, Try again included. */
  const request = (item: SwarmListItem): void => {
    if (item.entry === null) return; // no registry row: nothing can be installed
    if (needsConsent(item)) setConsentId(item.entry.id);
    else void installSwarm(item.entry.id);
  };

  const confirm = (): void => {
    const item = consent;
    setConsentId(null);
    if (!item?.entry) return;
    void installSwarm(item.entry.id);
  };

  const check = (): void => {
    setChecking(true);
    void checkSwarms().finally(() => setChecking(false));
  };

  const remove = (swarmId: string): void => {
    void removeSwarm(swarmId).then((message) => {
      setNotices((was) => {
        const next = new Map(was);
        if (message === null) next.delete(swarmId);
        else next.set(swarmId, message);
        return next;
      });
    });
  };

  const rows = listing === null ? [] : installedRows(listing, failures);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
      {linkKind === 'sign-in' ? (
        <LinkNotice text="Sign in to install this swarm." action="Sign in" onAction={() => void signIn()} />
      ) : null}
      {linkUnavailable ? (
        <LinkNotice
          text="This swarm isn't available to your account."
          action="Dismiss"
          onAction={() => setLinkUnavailable(false)}
        />
      ) : null}

      {browsing ? (
        <SwarmsBrowse
          listing={listing}
          busy={busy}
          failures={failures}
          onBack={() => setBrowsing(false)}
          onInstall={(item) => request(item)}
          onReview={(item) => request(item)}
          onRetry={() => void loadSwarms()}
        />
      ) : (
        <>
          <SettingsSectionHeader title="Swarms" description={LEDE} />

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={check} disabled={checking}>
              Check for updates
            </Button>
            <Button size="sm" onClick={() => setBrowsing(true)}>
              Browse swarms
            </Button>
            {lastUpdate === null ? null : (
              <span className="ml-auto flex items-center gap-1.5 text-ui-sm text-muted">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-green" />
                {`${lastUpdate.title} updated to v${lastUpdate.version}`}
              </span>
            )}
          </div>

          {listing === null ? null : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center">
              <p className="text-ui-sm text-muted">No swarms installed.</p>
              <Button size="sm" variant="primary" onClick={() => setBrowsing(true)}>
                Browse swarms
              </Button>
            </div>
          ) : (
            <ul className="flex flex-col rounded-lg border border-border">
              {rows.map((item) => {
                const id = idOf(item);
                const isBusy = busy.has(id);
                return (
                  <SwarmRow
                    key={id}
                    item={item}
                    source={listing.source}
                    busy={isBusy}
                    removing={removing.has(id)}
                    failure={failures.get(id)}
                    kept={item.installed === null ? [] : keptFiles(item.installed, agents, skills)}
                    notice={notices.get(id) ?? null}
                    onAction={() => request(item)}
                    onDismiss={() => dismissSwarmFailure(id)}
                    onAutoUpdate={(next) => void setSwarmAutoUpdate(id, next)}
                    onRemove={() => remove(id)}
                    onTake={(file) => void takeShippedPrompt({ kind: file.kind, name: file.name })}
                    onKeep={(file) => void keepShippedMine({ kind: file.kind, name: file.name })}
                  />
                );
              })}
            </ul>
          )}
        </>
      )}

      {consent?.entry ? (
        <SwarmConsent
          entry={consent.entry}
          installed={consent.installed}
          target={consent.update?.target ?? null}
          onConfirm={confirm}
          onCancel={() => setConsentId(null)}
        />
      ) : null}
    </div>
  );
}
