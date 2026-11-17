// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { readRelayHosts, relayHostsFor } from '../../../../electron/main/relay/hosts';

/**
 * `GET /relay/hosts` (HIVE-429): this person's Macs holding `/relay/serve` now. The body is input
 * from the network, so every row is validated and the list is bounded.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const row = (serverId: string, name = 'Studio mini') => ({ serverId, name, since: '2026-11-17T14:14:00Z' });

describe('readRelayHosts', () => {
  it('asks for /relay/hosts and returns the good rows', async () => {
    const authedFetch = vi.fn(async () => json([row('dev_1'), row('dev_2', 'Laptop')]));

    await expect(readRelayHosts(authedFetch)).resolves.toEqual({
      ok: true,
      hosts: [row('dev_1'), row('dev_2', 'Laptop')],
    });
    expect(authedFetch).toHaveBeenCalledExactlyOnceWith('/relay/hosts');
  });

  it('drops each row that fails validation and keeps the good ones', async () => {
    const { serverId: _unused, ...missingId } = row('x');
    const { since: _gone, ...missingSince } = row('dev_3');
    const authedFetch = vi.fn(async () =>
      json([
        row('a/b'),
        missingSince,
        'not an object',
        null,
        missingId,
        { serverId: 'dev_4', name: 42, since: '2026-11-17T14:14:00Z' },
        row('dev_1'),
      ]),
    );

    await expect(readRelayHosts(authedFetch)).resolves.toEqual({ ok: true, hosts: [row('dev_1')] });
  });

  it('cuts a long name to 80 characters', async () => {
    const authedFetch = vi.fn(async () => json([row('dev_1', 'n'.repeat(300))]));

    const result = await readRelayHosts(authedFetch);

    expect(result.ok && result.hosts[0].name).toBe('n'.repeat(80));
  });

  it('returns at most 16 rows', async () => {
    const authedFetch = vi.fn(async () =>
      json(Array.from({ length: 20 }, (_, index) => row(`dev_${String(index)}`))),
    );

    const result = await readRelayHosts(authedFetch);

    expect(result.ok && result.hosts.map((host) => host.serverId)).toEqual(
      Array.from({ length: 16 }, (_, index) => `dev_${String(index)}`),
    );
  });

  it.each([
    [401, 'signed-out'],
    [403, 'not-entitled'],
    [500, 'unavailable'],
    [404, 'unavailable'],
  ])('maps a %i to %s', async (status, reason) => {
    const authedFetch = vi.fn(async () => json({ error: 'x' }, status));

    await expect(readRelayHosts(authedFetch)).resolves.toEqual({ ok: false, reason });
  });

  it('is unavailable when the request itself fails', async () => {
    const authedFetch = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });

    await expect(readRelayHosts(authedFetch)).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('is unavailable when the body is not an array', async () => {
    await expect(readRelayHosts(vi.fn(async () => json({})))).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('is unavailable when the body is not JSON', async () => {
    const authedFetch = vi.fn(async () => new Response('<html>', { status: 200 }));

    await expect(readRelayHosts(authedFetch)).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('relayHostsFor', () => {
  const session = (kind: string) => ({
    account: () => ({ kind }) as never,
    authedFetch: vi.fn(async () => json([row('dev_1')])),
  });

  it('is signed-out with no session, without a request', async () => {
    await expect(relayHostsFor(null)).resolves.toEqual({ ok: false, reason: 'signed-out' });
  });

  it('is signed-out without a request when the account is not signed in', async () => {
    const held = session('signed-out');

    await expect(relayHostsFor(held)).resolves.toEqual({ ok: false, reason: 'signed-out' });
    expect(held.authedFetch).not.toHaveBeenCalled();
  });

  it('reads the list through the signed-in session', async () => {
    const held = session('signed-in');

    await expect(relayHostsFor(held)).resolves.toEqual({ ok: true, hosts: [row('dev_1')] });
    expect(held.authedFetch).toHaveBeenCalledExactlyOnceWith('/relay/hosts');
  });
});
