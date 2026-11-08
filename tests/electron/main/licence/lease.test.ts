// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudError } from '../../../../electron/main/licence/cloud';
import { createLeaseFile, renewLease } from '../../../../electron/main/licence/lease';

describe('createLeaseFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-lease-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads null before anything is written', () => {
    expect(createLeaseFile(join(dir, 'lease.jws')).read()).toBeNull();
  });

  it('round-trips, replacing the previous lease and leaving no temp file', () => {
    const file = createLeaseFile(join(dir, 'lease.jws'));
    file.write('a.b.c');
    file.write('d.e.f');
    expect(file.read()).toBe('d.e.f');
    expect(readdirSync(dir)).toEqual(['lease.jws']);
  });

  it('trims what it reads, and reads an empty file as null', () => {
    writeFileSync(join(dir, 'lease.jws'), '  a.b.c\n');
    expect(createLeaseFile(join(dir, 'lease.jws')).read()).toBe('a.b.c');
    writeFileSync(join(dir, 'lease.jws'), '\n');
    expect(createLeaseFile(join(dir, 'lease.jws')).read()).toBeNull();
  });
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('renewLease', () => {
  it('POSTs /api/lease with no body and answers the lease', async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, { lease: 'a.b.c' }));
    await expect(renewLease(fetch)).resolves.toEqual({ kind: 'lease', jws: 'a.b.c' });
    expect(fetch).toHaveBeenCalledWith('/api/lease', { method: 'POST' });
  });

  it('POSTs { org } as JSON when one is asked for (HIVE-291)', async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, { lease: 'a.b.c' }));
    await expect(renewLease(fetch, 'org-b')).resolves.toEqual({ kind: 'lease', jws: 'a.b.c' });
    expect(fetch).toHaveBeenCalledWith('/api/lease', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"org":"org-b"}',
    });
  });

  it.each(['trial_ended', 'plan_cancelled', 'payment_failed', 'device_revoked', 'seat_removed', 'no_plan'])(
    'answers a 403 refusal for %s',
    async (reason) => {
      const fetch = vi.fn().mockResolvedValue(json(403, { error: 'lease_refused', reason }));
      await expect(renewLease(fetch)).resolves.toEqual({ kind: 'refused', reason });
    },
  );

  it('answers unknown for a reason it does not know', async () => {
    const fetch = vi.fn().mockResolvedValue(json(403, { error: 'lease_refused', reason: 'gremlins' }));
    await expect(renewLease(fetch)).resolves.toEqual({ kind: 'refused', reason: 'unknown' });
  });

  it('fails, not refuses, on a 403 that is not lease_refused, a 401, a 5xx or a 200 without a lease', async () => {
    for (const response of [
      json(403, { error: 'forbidden' }),
      json(401, { error: 'invalid_token' }),
      json(503, {}),
      json(200, {}),
    ]) {
      await expect(renewLease(vi.fn().mockResolvedValue(response))).resolves.toMatchObject({ kind: 'failed' });
    }
  });

  it('answers signed-out when there is no token to send', async () => {
    const fetch = vi.fn().mockRejectedValue(new CloudError('refused', 'no access token'));
    await expect(renewLease(fetch)).resolves.toEqual({ kind: 'signed-out' });
  });

  it('fails on the network', async () => {
    const fetch = vi.fn().mockRejectedValue(new CloudError('network', 'ECONNREFUSED'));
    await expect(renewLease(fetch)).resolves.toEqual({ kind: 'failed', detail: 'network: ECONNREFUSED' });
  });
});
