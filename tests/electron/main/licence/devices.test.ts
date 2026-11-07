// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { listDevices } from '../../../../electron/main/licence/devices';

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
