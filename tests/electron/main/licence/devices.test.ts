// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { listDevices, revokeDevice } from '../../../../electron/main/licence/devices';

const ROW = {
  id: 'd1',
  name: 'studio-mac',
  lastSeenAt: '2026-11-07T10:00:00.000Z',
  createdAt: '2026-11-01T10:00:00.000Z',
  current: true,
};
const answer = (status: number, body: unknown) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe('listDevices (HIVE-265, HIVE-262)', () => {
  it('GETs /api/account/devices and answers the rows', async () => {
    const fetch = answer(200, { devices: [ROW] });
    await expect(listDevices(fetch)).resolves.toEqual({ devices: [ROW] });
    expect(fetch).toHaveBeenCalledWith('/api/account/devices');
  });

  it.each([
    ['no devices array', { rows: [] }],
    ['a row missing its id', { devices: [{ ...ROW, id: undefined }] }],
    ['a non-boolean current', { devices: [{ ...ROW, current: 'yes' }] }],
    ['a non-string date', { devices: [{ ...ROW, lastSeenAt: 5 }] }],
  ])('refuses %s', async (_label, body) => {
    await expect(listDevices(answer(200, body))).resolves.toEqual({ error: "Couldn't load your devices." });
  });

  it('a refusal is one sentence', async () => {
    await expect(listDevices(answer(401, { error: 'invalid_token' }))).resolves.toEqual({
      error: "Couldn't load your devices.",
    });
  });

  it('a network failure is one sentence', async () => {
    await expect(listDevices(vi.fn(() => Promise.reject(new Error('offline'))))).resolves.toEqual({
      error: "Couldn't reach HiveTTY. Try again.",
    });
  });

  it('keeps only the five fields', async () => {
    await expect(listDevices(answer(200, { devices: [{ ...ROW, keyHash: 'x' }] }))).resolves.toEqual({
      devices: [ROW],
    });
  });
});

describe('revokeDevice (Remove, against POST /api/account/devices/:id/revoke)', () => {
  const noContent = () => vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));

  it('POSTs the revoke for the device, escaped, and answers ok', async () => {
    const fetch = noContent();
    await expect(revokeDevice(fetch, 'd/2')).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('/api/account/devices/d%2F2/revoke', { method: 'POST' });
  });

  it('a device already gone is one sentence', async () => {
    await expect(revokeDevice(answer(404, { error: 'not_found' }), 'd2')).resolves.toEqual({
      error: 'That device was already removed.',
    });
  });

  it('an older cloud refusing the bearer, or offline, points at Manage devices', async () => {
    const refused = { error: "Couldn't remove that device here. Use Manage devices." };
    await expect(revokeDevice(answer(403, { error: 'invalid_request' }), 'd2')).resolves.toEqual(refused);
    await expect(revokeDevice(vi.fn(() => Promise.reject(new Error('offline'))), 'd2')).resolves.toEqual(refused);
  });

  it.each([42, '', 'x'.repeat(129)])('refuses the id %j without a call', async (id) => {
    const fetch = noContent();
    await expect(revokeDevice(fetch, id)).resolves.toEqual({ error: expect.any(String) as string });
    expect(fetch).not.toHaveBeenCalled();
  });
});
