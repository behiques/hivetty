import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { codexRecord } from '../../../../../electron/main/harness/codex/record';

const ID = '0199a2b3-4c5d-7e6f-8a9b-0c1d2e3f4a5b';

/** A `CODEX_HOME` holding rollouts at FINDINGS P6's layout. */
const homeWith = (...days: Array<[string, string]>): string => {
  const home = mkdtempSync(join(tmpdir(), 'codex-home-'));
  for (const [day, id] of days) {
    mkdirSync(join(home, 'sessions', day), { recursive: true });
    writeFileSync(join(home, 'sessions', day, `rollout-${day.replaceAll('/', '-')}T10-00-00-${id}.jsonl`), '{}\n');
  }
  return home;
};

describe('codex record (HIVE-279)', () => {
  it('finds a conversation by its id under sessions/, and nothing else', () => {
    const home = homeWith(['2026/10/26', '0199a2b3-4c5d-7e6f-8a9b-111111111111'], ['2026/10/27', ID]);
    const record = codexRecord(() => home);
    expect(record.hasTranscript('/any/cwd', ID)).toBe(true);
    expect(record.transcriptPath('/any/cwd', ID)).toBe(
      join(home, `sessions/2026/10/27/rollout-2026-10-27T10-00-00-${ID}.jsonl`),
    );
    expect(record.hasTranscript('/any/cwd', '0199a2b3-4c5d-7e6f-8a9b-000000000000')).toBe(false);
    expect(record.titleOrigin('/any/cwd', ID, 'x')).toBe('unknown');
  });

  it('finds an older day’s conversation too', () => {
    const home = homeWith(['2025/12/31', ID], ['2026/10/27', '0199a2b3-4c5d-7e6f-8a9b-111111111111']);
    expect(codexRecord(() => home).hasTranscript('/', ID)).toBe(true);
  });

  it('answers no transcript for a home that does not exist', () => {
    expect(codexRecord(() => '/nonexistent').hasTranscript('/', ID)).toBe(false);
  });

  it('refuses an id that is not a uuid rather than match a filename by it', () => {
    const home = homeWith(['2026/10/27', ID]);
    expect(codexRecord(() => home).transcriptPath('/', '*')).toBeNull();
    expect(codexRecord(() => home).transcriptPath('/', '')).toBeNull();
  });

  it('reads the home each time, so CODEX_HOME set later is honoured', () => {
    let home = '/nonexistent';
    const record = codexRecord(() => home);
    expect(record.hasTranscript('/', ID)).toBe(false);
    home = homeWith(['2026/10/27', ID]);
    expect(record.hasTranscript('/', ID)).toBe(true);
  });

  it('defaults to $CODEX_HOME, then ~/.codex', () => {
    const home = homeWith(['2026/10/27', ID]);
    const before = process.env.CODEX_HOME;
    process.env.CODEX_HOME = home;
    try {
      expect(codexRecord().hasTranscript('/', ID)).toBe(true);
    } finally {
      if (before === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = before;
    }
  });

  it('names a session from codex’s title: spinner, approval lead and directory stripped (FINDINGS P7)', () => {
    const { nameFromTitle } = codexRecord(() => '/nonexistent');
    expect(nameFromTitle('Create probe file | repo')).toBe('Create probe file');
    expect(nameFromTitle('⠏ Create probe file | repo')).toBe('Create probe file');
    expect(nameFromTitle('[ ! ] Action Required | Create probe file | repo')).toBe('Create probe file');
    expect(nameFromTitle('a | b | repo')).toBe('a | b');
    // Before the thread has a name the title is the directory alone: unnamed.
    expect(nameFromTitle('repo')).toBe('');
    expect(nameFromTitle('⠙ repo')).toBe('');
  });
});
