// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/** HIVE-268: every caller goes through `licence()`; only the licence module touches the stored lease. */
const ROOT = join(__dirname, '../../../..');
const ALLOWED = new Set(
  ['index.ts', 'lease.ts', 'licence-state.ts', 'verify.ts'].map((f) => `electron/main/licence/${f}`),
);
const NEEDLES = ['lease.jws', 'createLeaseFile', 'verifyLease'];

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(ts|tsx|mts)$/.test(name)) yield path;
  }
}

describe('the lease has one reader', () => {
  it('no module outside the licence core names the lease file or its verifier', () => {
    const offenders = [...files(join(ROOT, 'electron')), ...files(join(ROOT, 'src'))]
      .map((path) => relative(ROOT, path))
      .filter((path) => !ALLOWED.has(path))
      .filter((path) => NEEDLES.some((needle) => readFileSync(join(ROOT, path), 'utf8').includes(needle)));
    expect(offenders).toEqual([]);
  });
});
