// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { verifyLease } from '../../../../electron/main/licence/verify';
import { claimsFor, DEVICE, ISS, makeSigner, NOW_S } from '../../../support/lease';

const current = makeSigner('kid-current');
const next = makeSigner('kid-next');
const stranger = makeSigner('kid-current'); // same kid, different key
const ctx = { keys: [current.jwk, next.jwk], iss: ISS, deviceId: DEVICE, now: NOW_S * 1000 };

describe('verifyLease', () => {
  it('accepts a lease signed by the current key or the next key', () => {
    expect(verifyLease(current.sign(claimsFor()), ctx)).toEqual({ ok: true, claims: claimsFor() });
    expect(verifyLease(next.sign(claimsFor()), ctx)).toMatchObject({ ok: true });
  });

  it('keeps an optional trialEnds', () => {
    const verdict = verifyLease(current.sign(claimsFor({ trialEnds: NOW_S + 10 })), ctx);
    expect(verdict).toMatchObject({ ok: true, claims: { trialEnds: NOW_S + 10 } });
  });

  it.each([
    ['an unknown kid', makeSigner('kid-other').sign(claimsFor()), 'kid'],
    ['a forged signature', stranger.sign(claimsFor()), 'signature'],
    ['alg none', current.sign(claimsFor(), { alg: 'none', kid: 'kid-current' }), 'alg'],
    ['the wrong iss', current.sign(claimsFor({ iss: 'https://evil.test' })), 'iss'],
    ['another device', current.sign(claimsFor({ device: 'dev-2' })), 'device'],
    ['an expired lease', current.sign(claimsFor({ exp: NOW_S })), 'expired'],
    ['two parts', 'a.b', 'malformed'],
    ['a header that is not JSON', 'bm9wZQ.e30.c2ln', 'malformed'],
    ['claims missing a field', current.sign({ ...claimsFor(), jti: undefined }), 'claims'],
    ['features that are not strings', current.sign(claimsFor({ features: [1] as unknown as string[] })), 'claims'],
  ])('refuses %s', (_label, jws, why) => {
    expect(verifyLease(jws, ctx)).toEqual({ ok: false, why });
  });

  it('compares iss without a trailing slash', () => {
    expect(verifyLease(current.sign(claimsFor({ iss: `${ISS}/` })), ctx)).toMatchObject({ ok: true });
  });

  it('skips the device check when there is no device id', () => {
    const jws = current.sign(claimsFor({ device: 'dev-2' }));
    expect(verifyLease(jws, { ...ctx, deviceId: null })).toMatchObject({ ok: true });
  });

  it('refuses everything with no keys, as a packaged build does today', () => {
    expect(verifyLease(current.sign(claimsFor()), { ...ctx, keys: [] })).toEqual({ ok: false, why: 'kid' });
  });
});
