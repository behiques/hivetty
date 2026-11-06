import { createPublicKey, verify } from 'node:crypto';

import type { LeaseClaims } from '@shared/licence-contract';

import type { LeaseJwk } from './keys';

/**
 * A lease is a compact JWS the cloud signs through KMS (HIVE-272): ES256, the signature as r||s (P1363), the
 * signing key named by the header's `kid`. D1: `node:crypto`, no `jose`.
 */
export type LeaseRejection = 'malformed' | 'alg' | 'kid' | 'signature' | 'claims' | 'iss' | 'device' | 'expired';
export type LeaseVerdict = { ok: true; claims: LeaseClaims } | { ok: false; why: LeaseRejection };

const STRINGS = ['iss', 'sub', 'org', 'plan', 'device', 'jti'] as const;

function decode(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

function parseClaims(value: unknown): LeaseClaims | null {
  if (typeof value !== 'object' || value === null) return null;
  const c = value as Record<string, unknown>;
  if (!STRINGS.every((key) => typeof c[key] === 'string' && c[key] !== '')) return null;
  if (!Array.isArray(c.features) || !c.features.every((f) => typeof f === 'string')) return null;
  const limits = c.limits;
  if (typeof limits !== 'object' || limits === null || Array.isArray(limits)) return null;
  if (!Object.values(limits).every((n) => typeof n === 'number')) return null;
  if (typeof c.iat !== 'number' || typeof c.exp !== 'number') return null;
  if (c.trialEnds !== undefined && typeof c.trialEnds !== 'number') return null;
  return {
    iss: c.iss as string,
    sub: c.sub as string,
    org: c.org as string,
    plan: c.plan as string,
    device: c.device as string,
    jti: c.jti as string,
    features: c.features as string[],
    limits: limits as Record<string, number>,
    iat: c.iat,
    exp: c.exp,
    ...(c.trialEnds === undefined ? {} : { trialEnds: c.trialEnds }),
  };
}

const bare = (url: string): string => url.replace(/\/+$/, '');

export function verifyLease(
  jws: string,
  ctx: { keys: readonly LeaseJwk[]; iss: string; deviceId: string | null; now: number },
): LeaseVerdict {
  const parts = jws.trim().split('.');
  if (parts.length !== 3) return { ok: false, why: 'malformed' };
  const [head, body, sig] = parts as [string, string, string];
  const header = decode(head);
  if (typeof header !== 'object' || header === null) return { ok: false, why: 'malformed' };
  const { alg, kid } = header as { alg?: unknown; kid?: unknown };
  if (alg !== 'ES256') return { ok: false, why: 'alg' };
  const jwk = ctx.keys.find((key) => key.kid === kid);
  if (!jwk) return { ok: false, why: 'kid' };
  let valid = false;
  try {
    const key = createPublicKey({ key: { ...jwk }, format: 'jwk' });
    valid = verify(
      'sha256',
      Buffer.from(`${head}.${body}`),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(sig, 'base64url'),
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, why: 'signature' };
  const claims = parseClaims(decode(body));
  if (!claims) return { ok: false, why: 'claims' };
  if (bare(claims.iss) !== bare(ctx.iss)) return { ok: false, why: 'iss' };
  if (ctx.deviceId !== null && claims.device !== ctx.deviceId) return { ok: false, why: 'device' };
  if (claims.exp * 1000 <= ctx.now) return { ok: false, why: 'expired' };
  return { ok: true, claims };
}
