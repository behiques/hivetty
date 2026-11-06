import { generateKeyPairSync, sign } from 'node:crypto';

import type { LeaseJwk } from '../../electron/main/licence/keys';
import type { LeaseClaims } from '../../electron/shared/licence-contract';

export const ISS = 'https://cloud.test';
export const DEVICE = 'dev-1';
export const NOW_S = 1_800_000_000;

const b64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A real P-256 key pair, signing the way the cloud's KMS signer does (P1363, base64url). */
export function makeSigner(kid: string): { jwk: LeaseJwk; sign(claims: object, header?: object): string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const { x, y } = publicKey.export({ format: 'jwk' });
  const jwk: LeaseJwk = { kty: 'EC', crv: 'P-256', x: x as string, y: y as string, kid, alg: 'ES256', use: 'sig' };
  return {
    jwk,
    sign(claims, header = { alg: 'ES256', typ: 'JWT', kid }) {
      const input = `${b64(header)}.${b64(claims)}`;
      const sig = sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
      return `${input}.${sig.toString('base64url')}`;
    },
  };
}

export function claimsFor(overrides: Partial<LeaseClaims> = {}): LeaseClaims {
  return {
    iss: ISS,
    sub: 'usr_1',
    org: 'org_1',
    plan: 'team',
    device: DEVICE,
    features: ['agents'],
    limits: { sessions: 10 },
    iat: NOW_S,
    exp: NOW_S + 7 * 86_400,
    jti: 'ls_1',
    ...overrides,
  };
}
