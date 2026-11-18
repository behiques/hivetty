import type { AccountStore } from './account-store';
import type { AuthClient, CodeSignInResult } from './auth-client';
import type { LeaseJwk } from './keys';
import { type LeaseFile, renewLease } from './lease';
import { verifyLease } from './verify';

/**
 * `hivetty --login` and `--logout` (HIVE-266), as exit codes. Pure behind its deps. The client is never
 * `start()`ed: a one-shot that refreshed would rotate the token from under a running server. A sign-in still
 * schedules its first refresh (`accept`), so the caller exits as soon as this resolves.
 */

export const KEYCHAIN_HINT =
  "HiveTTY can't use this Mac's keychain, so it can't keep a sign-in. Log in to the Mac's desktop once " +
  '(in person or over Screen Sharing) so the login keychain unlocks, then run this again.';

export const EXIT: Record<Exclude<CodeSignInResult, { ok: true }>['failure'], number> = {
  denied: 1,
  expired: 1,
  network: 2,
  refused: 2,
  storage: 3,
  aborted: 130,
};

export interface AccountCommandDeps {
  client: Pick<AuthClient, 'signInWithCode' | 'authedFetch' | 'signOut'>;
  store: AccountStore;
  /** safeStorage can encrypt now: available, and a trial `encryptString` does not throw. */
  canEncrypt: () => boolean;
  lease: LeaseFile;
  keys: readonly LeaseJwk[];
  iss: string;
  now: () => number;
  hostname: () => string;
  print: (line: string) => void;
  signal: AbortSignal;
}

async function planLine(deps: AccountCommandDeps, deviceId: string): Promise<string> {
  const pending = 'plan pending (the app will fetch it)';
  const renewed = await renewLease(deps.client.authedFetch);
  if (renewed.kind === 'refused') return `no plan (${renewed.reason})`;
  if (renewed.kind !== 'lease') return pending;
  const verdict = verifyLease(renewed.jws, { keys: deps.keys, iss: deps.iss, deviceId, now: deps.now() });
  if (!verdict.ok) return pending;
  try {
    deps.lease.write(renewed.jws);
  } catch {
    return pending;
  }
  return `plan ${verdict.claims.plan}`;
}

export async function runLogin({ force }: { force: boolean }, deps: AccountCommandDeps): Promise<number> {
  const { print } = deps;
  if (!deps.canEncrypt()) {
    print(KEYCHAIN_HINT);
    return EXIT.storage;
  }
  const stored = deps.store.read();
  if (stored && !force) {
    print(`Already signed in as ${stored.email} on ${deps.hostname()}. Run hivetty --login --force to sign in again.`);
    return 0;
  }
  const result = await deps.client.signInWithCode({
    signal: deps.signal,
    onCode: (code) => {
      print('To sign in this machine, open:');
      print(`  ${code.verificationUri}`);
      print(`and enter the code:  ${code.userCode}`);
      print(`Or open: ${code.verificationUriComplete}`);
      print(`Waiting… (expires in ${String(Math.max(1, Math.round(code.expiresIn / 60)))} minutes, Ctrl-C to cancel)`);
    },
  });
  if (!('ok' in result)) {
    print(result.failure === 'storage' ? KEYCHAIN_HINT : result.error);
    return EXIT[result.failure];
  }
  const account = deps.store.read();
  const plan = await planLine(deps, account?.deviceId ?? '');
  // The first lease can sign the device out (a device_revoked 401 clears the store inside authedFetch).
  if (!deps.store.read()) {
    print("This Mac's device was revoked before it could fetch a licence. Run hivetty --login again.");
    return 1;
  }
  print(`Signed in as ${account?.email ?? 'your account'} on ${deps.hostname()} · ${plan}`);
  return 0;
}

/** `hivetty --logout`: revoke (best effort) and clear. A running instance sees account.bin go and gates. */
export async function runLogout(deps: AccountCommandDeps): Promise<number> {
  if (!deps.canEncrypt()) {
    deps.print(KEYCHAIN_HINT);
    return EXIT.storage;
  }
  const stored = deps.store.read();
  if (!stored) {
    deps.print('Not signed in.');
    return 0;
  }
  await deps.client.signOut();
  deps.print(`Signed out ${stored.email}.`);
  return 0;
}
