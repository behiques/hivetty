import type { WebSocket } from 'ws';

import type { AccountState } from '@shared/account-contract';
import { relaySocketUrl, type RelayServeStatus } from '@shared/relay-contract';

import { createRelayServe } from './serve-loop';

/** What the relay needs of the signed-in cloud session; `licence/index.ts`'s `cloudSession()` satisfies it. */
interface RelaySession {
  baseUrl: string;
  getAccessToken(): Promise<string | null>;
  account(): AccountState;
  onAccountChange(listener: (state: AccountState) => void): () => void;
}

export interface RelayDeps {
  /** `server.relay.enabled`, read fresh. */
  enabled: () => boolean;
  onConfigChange: (listener: () => void) => () => void;
  /** Whether this process booted in server mode: the listener exists only then. */
  serverMode: () => boolean;
  session: () => RelaySession | null;
  /** `entitled('relay')`: `null` is yes, otherwise the sentence a person reads. */
  entitled: () => string | null;
  onLicenceChange: (listener: () => void) => () => void;
  accept: (socket: WebSocket) => void;
  createServe?: typeof createRelayServe;
}

let current: RelayServeStatus = { state: 'off' };
const listeners = new Set<(status: RelayServeStatus) => void>();

/** The serving side's relay state, for `relay:status`. */
export function relayStatus(): RelayServeStatus {
  return current;
}

export function onRelayStatus(listener: (status: RelayServeStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function same(a: RelayServeStatus, b: RelayServeStatus): boolean {
  return a.state === b.state && a.since === b.since && a.nextAttemptAt === b.nextAttemptAt && a.reason === b.reason;
}

function publish(status: RelayServeStatus): void {
  // An unrelated config write re-evaluates the gate; the same resting status is not news.
  if (same(status, current)) return;
  current = status;
  for (const listener of listeners) listener(status);
}

/**
 * The loop's own verdicts that end it: another dial would be answered the same way. `sign-in` and `locked`
 * restart on the next evaluation that still says run; `replaced` waits for the switch to go off and on.
 */
const HALTED = new Set<RelayServeStatus['state']>(['sign-in', 'locked', 'replaced']);

/**
 * Decides whether the serve loop runs (HIVE-429): the switch, server mode at boot, sign-in, and the `relay`
 * entitlement. Re-evaluated on every config, account and licence change. A `replaced` halt holds until the
 * switch is turned off and on, as the status line tells the person.
 */
export function startRelay(deps: RelayDeps): { stop(): void } {
  const session = deps.session();
  let running = false;
  /**
   * Set by a `replaced` halt and cleared only by the switch going off: another install of this device holds
   * the relay, and retaking it on any config or licence event would trade the socket between the two.
   */
  let replaced = false;

  const serve = (deps.createServe ?? createRelayServe)({
    url: (path) => relaySocketUrl(session?.baseUrl ?? '', path),
    token: () => session?.getAccessToken() ?? Promise.resolve(null),
    accept: deps.accept,
    onStatus: (status) => {
      // The loop stopped itself; the next evaluation that still wants it starts it again.
      if (HALTED.has(status.state)) running = false;
      if (status.state === 'replaced') replaced = true;
      publish(status);
    },
  });

  /** Why the loop should not run, or `null` when it should. The first failing condition wins. */
  const resting = (): RelayServeStatus | null => {
    if (!deps.enabled()) return { state: 'off' };
    if (!deps.serverMode()) return { state: 'pending-launch' };
    if (session?.account().kind !== 'signed-in') return { state: 'sign-in' };
    const reason = deps.entitled();
    return reason === null ? null : { state: 'locked', reason };
  };

  const sync = (): void => {
    if (!deps.enabled()) replaced = false;
    const rest = resting();
    if (rest === null) {
      // A sign-in or locked rest may have been published over the hold; the hold is what the person must act on.
      if (replaced) publish({ state: 'replaced' });
      else if (!running) {
        running = true;
        serve.start();
      }
      return;
    }
    if (running) {
      running = false;
      serve.stop();
    }
    publish(rest);
  };

  const unsubscribe = [
    deps.onConfigChange(sync),
    session?.onAccountChange(sync) ?? (() => undefined),
    deps.onLicenceChange(sync),
  ];
  sync();

  return {
    stop() {
      for (const stop of unsubscribe) stop();
      if (running) serve.stop();
      running = false;
      publish({ state: 'off' });
    },
  };
}
