// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readJobEntries } from '../../../core/ledger/job-read';

const NOW = new Date(2026, 10, 12, 12, 0).getTime();
const day = (back: number) => {
  const at = new Date(2026, 10, 12 - back);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
};
const line = (id: string, meta: Record<string, unknown>) =>
  `${JSON.stringify({ id, ts: NOW, from: 'builder', kind: 'post', body: '', meta })}\n`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hive-job-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('readJobEntries (Job Flow)', () => {
  it('reads every day file in the window, oldest first, and keeps only the job', async () => {
    writeFileSync(join(dir, `${day(5)}.jsonl`), line('20261107-090000-0001', { ticket: 'HIVE-401' }));
    writeFileSync(
      join(dir, `${day(0)}.jsonl`),
      line('20261112-090000-0001', { ticket: 'HIVE-401' }) + line('20261112-090000-0002', { ticket: 'HIVE-9' }),
    );
    writeFileSync(join(dir, `${day(40)}.jsonl`), line('20261003-090000-0001', { ticket: 'HIVE-401' }));
    const result = await readJobEntries({ dir, query: { ticket: 'HIVE-401', prs: [] }, now: NOW });
    expect(result.entries.map((e) => e.id)).toEqual(['20261107-090000-0001', '20261112-090000-0001']);
    expect(result.warnings).toEqual([]);
  });

  it('skips a malformed line and keeps the rest of its file', async () => {
    writeFileSync(join(dir, `${day(1)}.jsonl`), `{not json\nnull\n\n${line('20261111-090000-0001', { ticket: 'HIVE-401' })}`);
    const result = await readJobEntries({ dir, query: { ticket: 'HIVE-401', prs: [] }, now: NOW });
    expect(result.entries).toHaveLength(1);
  });

  it('names a day it could not read, and is silent about a missing one', async () => {
    mkdirSync(join(dir, `${day(2)}.jsonl`)); // a directory where a file should be: EISDIR
    const result = await readJobEntries({ dir, query: { ticket: 'HIVE-401', prs: [] }, now: NOW, days: 3 });
    expect(result.warnings).toEqual([day(2)]);
  });
});
