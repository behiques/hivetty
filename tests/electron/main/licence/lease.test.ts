// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLeaseFile } from '../../../../electron/main/licence/lease';

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
