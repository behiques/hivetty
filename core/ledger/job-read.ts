import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { jobEntries } from '@shared/job-derive';
import { LEDGER_JOB_DAYS, type LedgerEntry, type LedgerJobQuery, type LedgerJobResult } from '@shared/ledger-contract';

import { dayOf, isEntry } from './store';

/**
 * One job across the last `days` day files (Job Flow, 2026-11-12).
 *
 * The store holds today and yesterday; a job runs for days. Read on demand,
 * one file at a time and asynchronously, so a long history never blocks main.
 * A bad line costs only itself, as in the store; a day that exists and cannot
 * be read is named in `warnings` rather than read as empty.
 */
export async function readJobEntries(input: {
  dir: string;
  query: LedgerJobQuery;
  now: number;
  days?: number;
}): Promise<LedgerJobResult> {
  const days = input.days ?? LEDGER_JOB_DAYS;
  const today = new Date(input.now);
  const byId = new Map<string, LedgerEntry>();
  const warnings: string[] = [];

  for (let back = days - 1; back >= 0; back -= 1) {
    // Date components, not a fixed 24h step: a DST day is 23 or 25 hours (see the store's `yesterdayOf`).
    const day = dayOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - back).getTime());
    let raw: string;
    try {
      raw = await readFile(join(input.dir, `${day}.jsonl`), 'utf8');
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException | null)?.code !== 'ENOENT') warnings.push(day);
      continue;
    }
    for (const text of raw.split('\n')) {
      if (text.trim() === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      if (isEntry(parsed)) byId.set(parsed.id, parsed);
    }
  }

  const all = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { entries: jobEntries(all, input.query), warnings };
}
