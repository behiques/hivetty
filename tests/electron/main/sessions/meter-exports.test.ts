import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { meterExportPath, sweepMeterExports } from '../../../../electron/main/sessions/meter-exports';

describe('meter exports (HIVE-335)', () => {
  it('names a session’s export by its entity id, and refuses anything path-like', () => {
    expect(meterExportPath('/state', 'sess-07')).toBe(join('/state', 'otel', 'sess-07.jsonl'));
    for (const bad of ['', '../x', 'a/b', '.hidden', 'x'.repeat(129)]) expect(meterExportPath('/state', bad)).toBeNull();
  });

  it('the sweep keeps the history’s sessions and deletes the rest', async () => {
    const state = mkdtempSync(join(tmpdir(), 'hive-otel-'));
    mkdirSync(join(state, 'otel'));
    for (const id of ['sess-01', 'sess-02']) writeFileSync(join(state, 'otel', `${id}.jsonl`), '{}\n');
    writeFileSync(join(state, 'otel', 'notes.txt'), 'not ours');
    await sweepMeterExports(state, new Set(['sess-01']));
    expect(existsSync(join(state, 'otel', 'sess-01.jsonl'))).toBe(true);
    expect(existsSync(join(state, 'otel', 'sess-02.jsonl'))).toBe(false);
    expect(existsSync(join(state, 'otel', 'notes.txt'))).toBe(true);
  });

  it('the sweep is silent with no folder', async () => {
    await expect(sweepMeterExports(join(tmpdir(), 'hive-none-xyz'), new Set())).resolves.toBeUndefined();
  });
});
