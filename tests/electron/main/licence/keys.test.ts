// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { LEASE_KEYS, leaseKeys } from '../../../../electron/main/licence/keys';

const TEST_KEY = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', kid: 'test-1', alg: 'ES256', use: 'sig' };

describe('leaseKeys', () => {
  it('ships the dev keys to an unpackaged build and the prod keys to a packaged one', () => {
    expect(leaseKeys({ isPackaged: false, env: {} })).toBe(LEASE_KEYS.dev);
    expect(leaseKeys({ isPackaged: true, env: {} })).toBe(LEASE_KEYS.prod);
  });

  it('holds both dev keys, current and next', () => {
    expect(LEASE_KEYS.dev).toHaveLength(2);
    for (const key of LEASE_KEYS.dev) expect(key).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256' });
  });

  it('takes HIVETTY_LEASE_KEYS only when unpackaged', () => {
    const env = { HIVETTY_LEASE_KEYS: JSON.stringify([TEST_KEY]) };
    expect(leaseKeys({ isPackaged: false, env })).toEqual([TEST_KEY]);
    expect(leaseKeys({ isPackaged: true, env })).toBe(LEASE_KEYS.prod);
  });

  it('ignores an override that is not a JSON array of keys with a kid', () => {
    for (const value of ['nope', '{}', '[{"kty":"EC"}]', '[]']) {
      expect(leaseKeys({ isPackaged: false, env: { HIVETTY_LEASE_KEYS: value } })).toBe(LEASE_KEYS.dev);
    }
  });
});
