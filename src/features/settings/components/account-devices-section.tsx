import { ArrowSquareOut } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@components/ui/button";
import { AccountAvatar } from "@features/shared/components/account-avatar";
import { InlineConfirm } from "@features/shared/components/inline-confirm";
import { SettingsGroup } from "@features/shared/components/settings-group";
import { useAccount } from "@hooks/use-account";
import { useLicence } from "@hooks/use-licence";
import { formatLastUsed } from "@hooks/use-relative-time";
import {
  initialOf,
  listDevices,
  openAccountWeb,
  revokeDevice,
  signOut,
} from "@lib/account";
import { planLine } from "@lib/licence";
import type { AccountDevice } from "@shared/account-contract";

/** This Mac first, then the most recently seen. */
const ordered = (devices: AccountDevice[]): AccountDevice[] =>
  [...devices].sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt),
  );

/**
 * The Account centre's Profile & devices tab (HIVE-265's Account & devices pane): who is signed in, and this
 * account's devices from the cloud. Remove revokes another device in place, confirmed first; this Mac has Sign out
 * instead. Manage devices still opens the account site.
 */
export function AccountDevicesSection() {
  const account = useAccount();
  const licence = useLicence();
  const [devices, setDevices] = useState<AccountDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const signedIn = account?.kind === "signed-in";

  const load = useCallback(() => {
    setError(null);
    void listDevices().then((result) => {
      if (result === null) return;
      if ("error" in result) setError(result.error);
      else setDevices(ordered(result.devices));
    });
  }, []);
  useEffect(() => {
    if (signedIn) load();
  }, [signedIn, load]);

  if (!signedIn)
    return (
      <p className="text-control text-subtle">Sign in to see your account.</p>
    );

  const remove = async (id: string): Promise<void> => {
    setRemoving(null);
    const result = await revokeDevice(id);
    if (result && "error" in result) setRemoveError(result.error);
    else {
      setRemoveError(null);
      load();
    }
  };

  const now = Date.now();
  const plan = planLine(licence, now);
  const limit =
    licence?.kind === "licensed" || licence?.kind === "grace"
      ? licence.limits.devices
      : undefined;
  const count = devices
    ? ` · ${String(devices.length)}${limit === undefined ? "" : ` of ${String(limit)}`}`
    : "";

  return (
    <>
      {confirming ? (
        <InlineConfirm
          label="Sign out"
          title="Sign out of HiveTTY Pro?"
          confirmLabel="Sign out of HiveTTY Pro"
          className="rounded-lg border border-border"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void signOut();
          }}
        >
          Running work pauses until you sign in again.
        </InlineConfirm>
      ) : (
        <section className="flex items-center gap-3.5 rounded-lg border border-border bg-panel p-4">
          <AccountAvatar initial={initialOf(account)} size="lg" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-ui font-semibold text-ink">
              {account.name || account.email}
            </span>
            <span className="truncate text-ui-sm text-muted">
              {plan ? `${account.email} · ${plan}` : account.email}
            </span>
          </div>
          <Button onClick={() => setConfirming(true)}>Sign out</Button>
        </section>
      )}
      <SettingsGroup
        title={`Devices${count}`}
        description="The Macs signed in to this account."
      >
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => void openAccountWeb("/account/devices")}
          >
            Manage devices
            <ArrowSquareOut size={13} aria-hidden />
          </Button>
        </div>
        {error ? (
          <div className="flex items-center gap-2">
            <span className="text-ui-sm text-red">{error}</span>
            <Button size="sm" onClick={load}>
              Retry
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col rounded-lg border border-border bg-panel">
            {(devices ?? []).map((device) =>
              removing === device.id ? (
                <li
                  key={device.id}
                  className="border-b border-border-soft last:border-b-0"
                >
                  <InlineConfirm
                    label={`Remove ${device.name}`}
                    title={`Remove ${device.name}?`}
                    confirmLabel="Remove device"
                    className=""
                    onCancel={() => setRemoving(null)}
                    onConfirm={() => void remove(device.id)}
                  >
                    It is signed out of HiveTTY Pro and needs to sign in again.
                  </InlineConfirm>
                </li>
              ) : (
                <li
                  key={device.id}
                  className="flex items-center gap-3 border-b border-border-soft px-4 py-3 last:border-b-0"
                >
                  <span
                    data-testid="device-name"
                    className="flex-1 text-ui font-medium text-ink"
                  >
                    {device.name}
                  </span>
                  {device.current ? (
                    <span className="rounded border border-border px-1.5 font-mono text-micro font-semibold text-brand">
                      This Mac
                    </span>
                  ) : null}
                  <span className="w-[140px] text-right text-ui-sm text-subtle">
                    {device.current
                      ? "Active now"
                      : formatLastUsed(Date.parse(device.lastSeenAt), now)}
                  </span>
                  {device.current ? null : (
                    <Button
                      size="sm"
                      aria-label={`Remove ${device.name}`}
                      onClick={() => setRemoving(device.id)}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ),
            )}
          </ul>
        )}
        {removeError ? (
          <span className="text-ui-sm text-red">{removeError}</span>
        ) : null}
      </SettingsGroup>
    </>
  );
}
