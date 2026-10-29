import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readAppended } from '../../../../electron/main/sessions/read-appended';

describe('readAppended (HIVE-334)', () => {
  const file = () => join(mkdtempSync(join(tmpdir(), 'hive-append-')), 'r.jsonl');

  it('reads whole lines from the offset and says where it stopped', async () => {
    const path = file();
    writeFileSync(path, 'a\nb\n');
    expect(await readAppended(path, 0)).toEqual({ text: 'a\nb', offset: 4 });
    appendFileSync(path, 'c\n');
    expect(await readAppended(path, 4)).toEqual({ text: 'c', offset: 6 });
  });

  it('answers null with nothing new, or only a torn line', async () => {
    const path = file();
    writeFileSync(path, 'a\n');
    expect(await readAppended(path, 2)).toBeNull();
    appendFileSync(path, '{"half');
    expect(await readAppended(path, 2)).toBeNull();
  });

  it('rejects for a file that is not there', async () => {
    await expect(readAppended('/no/such/file', 0)).rejects.toThrow();
  });
});
