/**
 * The lease's public keys (HIVE-267, D2): current and next, as `GET /api/lease/keys` publishes them. Written by
 * `pnpm licence:keys`; edit by running it, not by hand. Prod stays empty until the prod cloud answers, so a
 * packaged build accepts no lease.
 */
export interface LeaseJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  kid: string;
  alg: 'ES256';
  use: 'sig';
}

export const LEASE_KEYS: { prod: LeaseJwk[]; dev: LeaseJwk[] } = {
  prod: [],
  dev: [
    {
      kty: 'EC',
      x: 'ggHg6MibKU9y5YTPuUFJxifBu8v19RiMInW-6Wn966I',
      y: 'TGwROUUa5TBblHVqrmQlPMQbbqFUMtaZ88qNYbKI8XA',
      crv: 'P-256',
      kid: 'c16d431e-2ab9-419e-bbe8-bfb2c72e4ccc',
      alg: 'ES256',
      use: 'sig',
    },
    {
      kty: 'EC',
      x: 'ljbfIE5sRGAVQ8fVGp9rxIJtXnRO_ut81BfYVYj6SKw',
      y: '1rN4bN0jc0S6F4rRhScSktbHa6ds7tVCgYdozaoBSgg',
      crv: 'P-256',
      kid: '460bdc35-d907-4501-af48-313a6ac49b68',
      alg: 'ES256',
      use: 'sig',
    },
  ],
};

const isKey = (value: unknown): value is LeaseJwk =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { kid?: unknown }).kid === 'string' &&
  typeof (value as { x?: unknown }).x === 'string' &&
  typeof (value as { y?: unknown }).y === 'string';

/**
 * `HIVETTY_LEASE_KEYS` (a JSON array of JWKs) is honoured only unpackaged, for the stub cloud (HIVE-270). A packaged
 * prerelease talks to the dev cloud (`resolveCloudUrl`), so it trusts the dev keys.
 */
export function leaseKeys({
  isPackaged,
  prerelease,
  env,
}: {
  isPackaged: boolean;
  prerelease?: boolean;
  env: Record<string, string | undefined>;
}): LeaseJwk[] {
  if (isPackaged) return prerelease ? LEASE_KEYS.dev : LEASE_KEYS.prod;
  const raw = env.HIVETTY_LEASE_KEYS;
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isKey)) return parsed;
    } catch {
      // A malformed override falls back to the built-in keys.
    }
  }
  return LEASE_KEYS.dev;
}
