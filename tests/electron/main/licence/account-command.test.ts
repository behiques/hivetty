// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  KEYCHAIN_HINT,
  runLogin,
  runLogout,
  type AccountCommandDeps,
} from '../../../../electron/main/licence/account-command';
import type { StoredAccount } from '../../../../electron/main/licence/account-store';
import type { AuthClient, CodeSignInResult } from '../../../../electron/main/licence/auth-client';
import { claimsFor, DEVICE, ISS, makeSigner, NOW_S } from '../../../support/lease';

const ACCOUNT: StoredAccount = {
  refreshToken: 'rt-1',
  deviceId: DEVICE,
  deviceKey: { publicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'p' }, privateJwk: { kty: 'OKP', crv: 'Ed25519', x: 'p', d: 'q' } },
  email: 'ana@example.com',
  name: 'Ana',
};
const CODE = {
  userCode: 'WDJB-MJHT',
  verificationUri: 'https://api.hivetty.dev/device',
  verificationUriComplete: 'https://api.hivetty.dev/device?code=WDJB-MJHT',
  expiresIn: 600,
};
const leaseResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function harness(opts: {
  stored?: StoredAccount | null;
  canEncrypt?: boolean;
  result?: CodeSignInResult;
  lease?: Response | Error;
} = {}) {
  const signer = makeSigner('kid-cmd');
  let stored = opts.stored ?? null;
  const lines: string[] = [];
  const written: string[] = [];
  const client = {
    signInWithCode: vi.fn(async ({ onCode }: Parameters<AuthClient['signInWithCode']>[0]) => {
      onCode(CODE);
      const result = opts.result ?? { ok: true };
      if ('ok' in result) stored = ACCOUNT;
      return result;
    }),
    authedFetch: vi.fn(async () => {
      const answer = opts.lease ?? leaseResponse(200, { lease: signer.sign(claimsFor({ plan: 'team' })) });
      if (answer instanceof Error) throw answer;
      return answer;
    }),
    signOut: vi.fn(async () => {
      stored = null;
    }),
  };
  const deps: AccountCommandDeps = {
    client: client as unknown as AuthClient,
    store: { read: () => stored, write: vi.fn(), clear: vi.fn(), exists: () => stored !== null },
    canEncrypt: () => opts.canEncrypt ?? true,
    lease: { read: () => null, write: (jws) => written.push(jws) },
    keys: [signer.jwk],
    iss: ISS,
    now: () => NOW_S * 1000,
    hostname: () => 'studio-mac',
    print: (line) => lines.push(line),
    signal: new AbortController().signal,
  };
  return { deps, client, lines, written };
}

describe('runLogin', () => {
  it('prints the code, signs in, stores the lease and names the plan', async () => {
    const h = harness();
    await expect(runLogin({ force: false }, h.deps)).resolves.toBe(0);
    expect(h.lines).toEqual([
      'To sign in this machine, open:',
      '  https://api.hivetty.dev/device',
      'and enter the code:  WDJB-MJHT',
      'Or open: https://api.hivetty.dev/device?code=WDJB-MJHT',
      'Waiting… (expires in 10 minutes, Ctrl-C to cancel)',
      'Signed in as ana@example.com on studio-mac · plan team',
    ]);
    expect(h.written).toHaveLength(1);
  });

  it('exits 3 with the keychain hint and touches nothing when encryption fails', async () => {
    const h = harness({ canEncrypt: false });
    await expect(runLogin({ force: false }, h.deps)).resolves.toBe(3);
    expect(h.lines).toEqual([KEYCHAIN_HINT]);
    expect(h.client.signInWithCode).not.toHaveBeenCalled();
    expect(h.client.authedFetch).not.toHaveBeenCalled();
    expect(h.written).toEqual([]);
  });

  it('says who is signed in and exits 0 without --force', async () => {
    const h = harness({ stored: ACCOUNT });
    await expect(runLogin({ force: false }, h.deps)).resolves.toBe(0);
    expect(h.lines).toEqual([
      'Already signed in as ana@example.com on studio-mac. Run hivetty --login --force to sign in again.',
    ]);
    expect(h.client.signInWithCode).not.toHaveBeenCalled();
  });

  it('--force signs in again over a stored account', async () => {
    const h = harness({ stored: ACCOUNT });
    await expect(runLogin({ force: true }, h.deps)).resolves.toBe(0);
    expect(h.client.signInWithCode).toHaveBeenCalled();
  });

  it.each([
    ['denied', 1],
    ['expired', 1],
    ['network', 2],
    ['refused', 2],
    ['aborted', 130],
  ] as const)('a %s flow exits %i with its sentence', async (failure, code) => {
    const h = harness({ result: { error: `the ${failure} sentence`, failure } });
    await expect(runLogin({ force: false }, h.deps)).resolves.toBe(code);
    expect(h.lines.at(-1)).toBe(`the ${failure} sentence`);
  });

  it('a storage failure exits 3 with the keychain hint', async () => {
    const h = harness({ result: { error: 'x', failure: 'storage' } });
    await expect(runLogin({ force: false }, h.deps)).resolves.toBe(3);
    expect(h.lines.at(-1)).toBe(KEYCHAIN_HINT);
  });

  it('a refused lease is still a sign-in: no plan, and why', async () => {
    const h = harness({ lease: leaseResponse(403, { error: 'lease_refused', reason: 'no_plan' }) });
    await expect(runLogin({ force: false }, h.deps)).resolves.toBe(0);
    expect(h.lines.at(-1)).toBe('Signed in as ana@example.com on studio-mac · no plan (no_plan)');
    expect(h.written).toEqual([]);
  });

  it.each([
    ['an unreachable lease', new Error('offline')],
    ['a lease that does not verify', leaseResponse(200, { lease: 'a.b.c' })],
  ])('%s leaves the plan to the app', async (_name, lease) => {
    const h = harness({ lease });
    await expect(runLogin({ force: false }, h.deps)).resolves.toBe(0);
    expect(h.lines.at(-1)).toBe('Signed in as ana@example.com on studio-mac · plan pending (the app will fetch it)');
    expect(h.written).toEqual([]);
  });

  it('a lease that verifies but cannot be saved leaves the plan to the app', async () => {
    const h = harness();
    h.deps.lease = {
      read: () => null,
      write: () => {
        throw new Error('EACCES');
      },
    };
    await expect(runLogin({ force: false }, h.deps)).resolves.toBe(0);
    expect(h.lines.at(-1)).toBe('Signed in as ana@example.com on studio-mac · plan pending (the app will fetch it)');
  });
});

describe('runLogout', () => {
  it('revokes and clears through signOut, and names who left', async () => {
    const h = harness({ stored: ACCOUNT });
    await expect(runLogout(h.deps)).resolves.toBe(0);
    expect(h.client.signOut).toHaveBeenCalled();
    expect(h.lines).toEqual(['Signed out ana@example.com.']);
  });

  it('says so when nobody is signed in', async () => {
    const h = harness();
    await expect(runLogout(h.deps)).resolves.toBe(0);
    expect(h.client.signOut).not.toHaveBeenCalled();
    expect(h.lines).toEqual(['Not signed in.']);
  });

  it('exits 3 when the keychain cannot open the stored token', async () => {
    const h = harness({ stored: ACCOUNT, canEncrypt: false });
    await expect(runLogout(h.deps)).resolves.toBe(3);
    expect(h.client.signOut).not.toHaveBeenCalled();
    expect(h.lines).toEqual([KEYCHAIN_HINT]);
  });
});
