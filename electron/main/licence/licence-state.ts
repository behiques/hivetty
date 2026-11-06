import type { AccountState } from '@shared/account-contract';
import type { LeaseClaims, LicenceState, LicenceTerms } from '@shared/licence-contract';

import type { LeaseJwk } from './keys';
import type { LeaseFile, RenewResult } from './lease';
import { verifyLease } from './verify';

export const RENEW_EVERY_MS = 24 * 60 * 60_000;
export const GRACE_RETRY_MS = 5 * 60_000;
export const PURCHASE_POLL_MS = 5_000;
export const PURCHASE_WATCH_MS = 15 * 60_000;

export interface LicenceStateDeps {
  account: { state(): AccountState; onChange(listener: (state: AccountState) => void): () => void };
  file: LeaseFile;
  renew: () => Promise<RenewResult>;
  keys: readonly LeaseJwk[];
  iss: string;
  now: () => number;
}

export interface LicenceStateMachine {
  state(): LicenceState;
  onChange(listener: (state: LicenceState) => void): () => void;
  /** Read the stored lease, then renew. Idempotent. */
  start(): void;
  /** Renew now. Joins a renewal already in flight. */
  refresh(): Promise<LicenceState>;
  /** HIVE-265's Choose a plan: renew every 5 s for up to 15 min while true. */
  watchPurchase(on: boolean): void;
  dispose(): void;
}

const termsOf = (c: LeaseClaims): LicenceTerms => ({
  plan: c.plan,
  features: c.features,
  limits: c.limits,
  exp: c.exp,
  ...(c.trialEnds === undefined ? {} : { trialEnds: c.trialEnds }),
});

const same = (a: LicenceState, b: LicenceState): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The licence (HIVE-267). The lease's own length is the offline grace: nothing here counts days. A refusal
 * lapses at once, whatever is left on the lease, because the cloud has said no. No clock anti-rollback.
 */
export function createLicenceState(deps: LicenceStateDeps): LicenceStateMachine {
  let current: LicenceState = { kind: 'unlicensed' };
  let claims: LeaseClaims | null = null;
  let started = false;
  let inFlight: Promise<LicenceState> | null = null;
  let renewTimer: ReturnType<typeof setInterval> | null = null;
  let graceTimer: ReturnType<typeof setInterval> | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let purchaseTimer: ReturnType<typeof setInterval> | null = null;
  let purchaseEnds = 0;
  let unsubscribe: (() => void) | null = null;
  const listeners = new Set<(state: LicenceState) => void>();

  const deviceId = (): string | null => {
    const account = deps.account.state();
    return account.kind === 'signed-in' ? account.deviceId : null;
  };
  const signedIn = (): boolean => deps.account.state().kind === 'signed-in';

  function set(next: LicenceState): void {
    if (same(current, next)) return;
    current = next;
    armExpiry();
    armGrace();
    for (const listener of listeners) listener(next);
  }

  /** One timer at min(exp − now, 24 h), re-checked when it fires: a 30-day lease overflows setTimeout. */
  function armExpiry(): void {
    if (expiryTimer !== null) clearTimeout(expiryTimer);
    expiryTimer = null;
    if ((current.kind !== 'licensed' && current.kind !== 'grace') || claims === null) return;
    const left = claims.exp * 1000 - deps.now();
    expiryTimer = setTimeout(
      () => {
        if (claims !== null && claims.exp * 1000 <= deps.now()) set({ kind: 'lapsed', reason: 'offline' });
        else armExpiry();
      },
      Math.max(0, Math.min(left, RENEW_EVERY_MS)),
    );
  }

  /** "When the network comes back": the app has no online event, so grace retries every 5 min. */
  function armGrace(): void {
    if (current.kind === 'grace' && graceTimer === null) {
      graceTimer = setInterval(() => void refresh(), GRACE_RETRY_MS);
    } else if (current.kind !== 'grace' && graceTimer !== null) {
      clearInterval(graceTimer);
      graceTimer = null;
    }
  }

  /** What the stored lease says, with no network. */
  function fromFile(): LicenceState {
    const jws = deps.file.read();
    claims = null;
    if (jws === null) return { kind: 'unlicensed' };
    const verdict = verifyLease(jws, { keys: deps.keys, iss: deps.iss, deviceId: deviceId(), now: deps.now() });
    if (!verdict.ok && verdict.why !== 'expired') return { kind: 'unlicensed' };
    if (!signedIn()) return { kind: 'lapsed', reason: 'signed_out' };
    if (!verdict.ok) return { kind: 'lapsed', reason: 'offline' };
    claims = verdict.claims;
    return { kind: 'licensed', ...termsOf(verdict.claims) };
  }

  /** A renewal that did not produce a lease: grace while the lease holds, else what the file says. */
  function failed(): LicenceState {
    if (
      (current.kind === 'licensed' || current.kind === 'grace') &&
      claims !== null &&
      claims.exp * 1000 > deps.now()
    ) {
      return { kind: 'grace', ...termsOf(claims) };
    }
    return current.kind === 'lapsed' ? current : fromFile();
  }

  function apply(result: RenewResult): LicenceState {
    switch (result.kind) {
      case 'lease': {
        const verdict = verifyLease(result.jws, {
          keys: deps.keys,
          iss: deps.iss,
          deviceId: deviceId(),
          now: deps.now(),
        });
        if (!verdict.ok) return failed();
        deps.file.write(result.jws);
        claims = verdict.claims;
        return { kind: 'licensed', ...termsOf(verdict.claims) };
      }
      case 'refused':
        return { kind: 'lapsed', reason: result.reason };
      case 'signed-out':
        // `authedFetch` throws `refused` whenever the account is not signed in (auth-client.ts), signing-in
        // included. A sign-in under way is a failed renewal; otherwise the file says what is left.
        return deps.account.state().kind === 'signing-in' ? failed() : fromFile();
      case 'failed':
        return failed();
    }
  }

  function refresh(): Promise<LicenceState> {
    if (!signedIn()) return Promise.resolve(current);
    inFlight ??= deps
      .renew()
      .then(
        (result) => {
          set(apply(result));
          return current;
        },
        () => {
          set(failed());
          return current;
        },
      )
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  function onAccount(account: AccountState): void {
    if (account.kind === 'signed-out') {
      if (account.reason === 'device-revoked') set({ kind: 'lapsed', reason: 'device_revoked' });
      else if (deps.file.read() !== null) set({ kind: 'lapsed', reason: 'signed_out' });
      else set({ kind: 'unlicensed' });
    } else if (account.kind === 'signed-in') {
      void refresh();
    }
  }

  function stopPurchaseWatch(): void {
    if (purchaseTimer !== null) clearInterval(purchaseTimer);
    purchaseTimer = null;
  }

  return {
    state: () => current,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (started) return;
      started = true;
      set(fromFile());
      unsubscribe = deps.account.onChange(onAccount);
      renewTimer = setInterval(() => void refresh(), RENEW_EVERY_MS);
      void refresh();
    },
    refresh,
    watchPurchase(on) {
      stopPurchaseWatch();
      if (!on) return;
      purchaseEnds = deps.now() + PURCHASE_WATCH_MS;
      purchaseTimer = setInterval(() => {
        if (current.kind === 'licensed' || deps.now() >= purchaseEnds) stopPurchaseWatch();
        else void refresh();
      }, PURCHASE_POLL_MS);
    },
    dispose() {
      unsubscribe?.();
      for (const timer of [renewTimer, graceTimer, purchaseTimer]) if (timer !== null) clearInterval(timer);
      if (expiryTimer !== null) clearTimeout(expiryTimer);
      renewTimer = graceTimer = purchaseTimer = expiryTimer = null;
      listeners.clear();
    },
  };
}
