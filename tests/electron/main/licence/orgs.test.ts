// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createSeenOrgs, isOrgId, listOrgs } from '../../../../electron/main/licence/orgs';

const ROW = { id: 'org-a', name: 'Acme', role: 'Admin', seat: true, plan: 'team', status: 'active', personal: false };
const answer = (status: number, body: unknown) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe('listOrgs (HIVE-291)', () => {
  it('GETs /api/orgs and answers the rows, nulls included', async () => {
    const bare = { ...ROW, id: 'org-b', plan: null, status: null, personal: true };
    const fetch = answer(200, { orgs: [ROW, bare] });
    await expect(listOrgs(fetch)).resolves.toEqual([ROW, bare]);
    expect(fetch).toHaveBeenCalledWith('/api/orgs');
  });

  it.each([
    ['no orgs array', { rows: [] }],
    ['a row missing its id', { orgs: [{ ...ROW, id: undefined }] }],
    ['an empty name', { orgs: [{ ...ROW, name: '' }] }],
    ['a non-string role', { orgs: [{ ...ROW, role: 1 }] }],
    ['a non-boolean seat', { orgs: [{ ...ROW, seat: 'yes' }] }],
    ['a non-boolean personal', { orgs: [{ ...ROW, personal: 0 }] }],
    ['a numeric plan', { orgs: [{ ...ROW, plan: 3 }] }],
    ['a missing status', { orgs: [{ ...ROW, status: undefined }] }],
    ['a row that is not an object', { orgs: ['org-a'] }],
  ])('answers [] for %s', async (_label, body) => {
    await expect(listOrgs(answer(200, body))).resolves.toEqual([]);
  });

  it('answers [] on a non-200, a body that is not JSON, and the network', async () => {
    await expect(listOrgs(answer(401, { error: 'invalid_token' }))).resolves.toEqual([]);
    await expect(listOrgs(vi.fn(() => Promise.resolve(new Response('<html>', { status: 200 }))))).resolves.toEqual([]);
    await expect(listOrgs(vi.fn(() => Promise.reject(new Error('offline'))))).resolves.toEqual([]);
  });
});

describe('isOrgId (HIVE-291)', () => {
  it.each([
    ['org-a', true],
    ['x'.repeat(64), true],
    ['', false],
    ['x'.repeat(65), false],
    [5, false],
    [null, false],
    [undefined, false],
  ])('%j: %s', (id, ok) => {
    expect(isOrgId(id)).toBe(ok);
  });
});

describe('createSeenOrgs (HIVE-291 D5)', () => {
  const org = (id: string) => ({ ...ROW, id });

  it('the first list seeds; a later list with a new id calls onNew once; a repeat does not', () => {
    const onNew = vi.fn();
    const seen = createSeenOrgs(onNew);
    seen.note([org('a')]);
    seen.note([org('a')]);
    expect(onNew).not.toHaveBeenCalled();
    seen.note([org('a'), org('b')]);
    expect(onNew).toHaveBeenCalledTimes(1);
    seen.note([org('b')]);
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('an empty (failed) list seeds nothing', () => {
    const onNew = vi.fn();
    const seen = createSeenOrgs(onNew);
    seen.note([]);
    seen.note([org('a')]);
    expect(onNew).not.toHaveBeenCalled();
  });

  it('clear forgets, so the next list seeds again', () => {
    const onNew = vi.fn();
    const seen = createSeenOrgs(onNew);
    seen.note([org('a')]);
    seen.clear();
    seen.note([org('b')]);
    expect(onNew).not.toHaveBeenCalled();
  });
});
