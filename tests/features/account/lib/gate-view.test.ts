import { describe, expect, it } from 'vitest';

import { type CodeFlow, gateView } from '@features/account/lib/gate-view';
import type { AccountState, DeviceCode } from '@shared/account-contract';
import type { LicenceState } from '@shared/licence-contract';

const IN: AccountState = { kind: 'signed-in', email: 'ana@example.com', name: 'Ana Ruiz', deviceId: 'd' };
const OUT: AccountState = { kind: 'signed-out' };
const TERMS = { plan: 'team', features: [], limits: {}, exp: 2e9, iat: 1.9e9 };
const CODE: DeviceCode = {
  userCode: 'WDJB-MJHT',
  verificationUri: 'https://c.test/device',
  verificationUriComplete: 'https://c.test/device?user_code=WDJB-MJHT',
  expiresIn: 600,
};
const NO_FLOW: CodeFlow = { active: false, code: null, error: null };

describe('gateView (HIVE-265)', () => {
  it.each<[string, AccountState | null, LicenceState | null, unknown, CodeFlow?]>([
    ['loading: no account yet', null, { kind: 'unlicensed' }, { kind: 'loading' }],
    ['loading: no licence yet', IN, null, { kind: 'loading' }],
    ['open: licensed', IN, { kind: 'licensed', ...TERMS }, { kind: 'open' }],
    ['open: grace', IN, { kind: 'grace', ...TERMS }, { kind: 'open' }],
    ['waiting for the browser', { kind: 'signing-in' }, { kind: 'unlicensed' }, { kind: 'waiting-browser' }],
    [
      'waiting on a code',
      { kind: 'signing-in' },
      { kind: 'unlicensed' },
      { kind: 'waiting-code', code: CODE },
      { active: true, code: CODE, error: null },
    ],
    [
      'waiting on a code not yet issued',
      { kind: 'signing-in' },
      { kind: 'unlicensed' },
      { kind: 'waiting-code', code: null },
      { active: true, code: null, error: null },
    ],
    ['signing in again from revoked', { kind: 'signing-in' }, { kind: 'lapsed', reason: 'device_revoked' }, { kind: 'waiting-browser' }],
    ['revoked: the licence says so', OUT, { kind: 'lapsed', reason: 'device_revoked' }, { kind: 'revoked' }],
    ['revoked: the account says so', { kind: 'signed-out', reason: 'device-revoked' }, { kind: 'unlicensed' }, { kind: 'revoked' }],
    ['sign-in: never signed in', OUT, { kind: 'unlicensed' }, { kind: 'sign-in' }],
    ['sign-in: signed out with a lease on file', OUT, { kind: 'lapsed', reason: 'signed_out' }, { kind: 'sign-in' }],
    ['sign-in: a timeout says so', { kind: 'signed-out', reason: 'timeout' }, { kind: 'unlicensed' }, { kind: 'sign-in', message: 'Sign-in timed out. Try again.' }],
    ['sign-in: an error carries its message', { kind: 'signed-out', reason: 'error', message: 'The sign-in was denied.' }, { kind: 'unlicensed' }, { kind: 'sign-in', message: 'The sign-in was denied.' }],
    [
      'sign-in: a code flow error shows',
      OUT,
      { kind: 'unlicensed' },
      { kind: 'sign-in', message: 'The code expired. Try again.' },
      { active: false, code: null, error: 'The code expired. Try again.' },
    ],
    ['welcome: signed in, unlicensed', IN, { kind: 'unlicensed' }, { kind: 'welcome', firstName: 'Ana', email: 'ana@example.com' }],
    ['welcome: no_plan', IN, { kind: 'lapsed', reason: 'no_plan' }, { kind: 'welcome', firstName: 'Ana', email: 'ana@example.com' }],
    ['loading: signed in while the licence still says signed_out', IN, { kind: 'lapsed', reason: 'signed_out' }, { kind: 'loading' }],
    ['lapsed: trial ended', IN, { kind: 'lapsed', reason: 'trial_ended' }, { kind: 'lapsed', reason: 'trial_ended', email: 'ana@example.com' }],
    ['lapsed: offline keeps checkedAt', IN, { kind: 'lapsed', reason: 'offline', checkedAt: 5 }, { kind: 'lapsed', reason: 'offline', email: 'ana@example.com', checkedAt: 5 }],
  ])('%s', (_label, account, licence, view, flow) => {
    expect(gateView(account, licence, flow ?? NO_FLOW)).toEqual(view);
  });

  it('firstName falls back to the email when there is no name', () => {
    expect(gateView({ ...IN, name: '' }, { kind: 'unlicensed' })).toMatchObject({ firstName: 'ana@example.com' });
  });
});
