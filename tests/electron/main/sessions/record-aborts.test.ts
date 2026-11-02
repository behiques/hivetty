import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { claudeCodeAdapter } from '../../../../electron/main/harness/claude-code';
import { codexAdapter } from '../../../../electron/main/harness/codex';
import type { HarnessAdapter } from '../../../../electron/main/harness/port';
import { readAppended } from '../../../../electron/main/sessions/read-appended';
import { createRecordAborts } from '../../../../electron/main/sessions/record-aborts';

const ABORTED = '{"type":"event_msg","payload":{"type":"turn_aborted","reason":"interrupted"}}\n';
const OTHER = '{"type":"event_msg","payload":{"type":"agent_message"}}\n';

describe('createRecordAborts (HIVE-365)', () => {
  let file: string;
  let busy: boolean;
  let transcript: { cwd: string; sessionUuid: string } | undefined;
  const onRecord = (base: HarnessAdapter): HarnessAdapter =>
    ({ ...base, record: { ...base.record, transcriptPath: () => file } }) as HarnessAdapter;
  const make = (adapter: HarnessAdapter = onRecord(codexAdapter), read = vi.fn(readAppended)) => {
    const onAbort = vi.fn();
    const aborts = createRecordAborts({
      transcriptOf: () => transcript,
      adapterOf: () => adapter,
      busy: () => busy,
      onAbort,
      read,
    });
    return { aborts, onAbort, read };
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    file = join(mkdtempSync(join(tmpdir(), 'hive-aborts-')), 'rollout.jsonl');
    writeFileSync(file, OTHER);
    busy = true;
    transcript = { cwd: '/repo', sessionUuid: 'u1' };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ends the turn on an abort the key caused, at the first read', async () => {
    const { aborts, onAbort, read } = make();
    const done = aborts.onKey('s', '\r');
    appendFileSync(file, ABORTED);
    await vi.advanceTimersByTimeAsync(500);
    await done;
    expect(onAbort).toHaveBeenCalledExactlyOnceWith('s');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('gives up after the second read when the record shows no abort: the key was an approval', async () => {
    const { aborts, onAbort, read } = make();
    const done = aborts.onKey('s', '\r');
    appendFileSync(file, OTHER);
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    expect(read).toHaveBeenCalledTimes(2);
    expect(onAbort).not.toHaveBeenCalled();
  });

  it('never takes an abort written before the key for this one', async () => {
    writeFileSync(file, ABORTED);
    const { aborts, onAbort } = make();
    const done = aborts.onKey('s', '\x1b');
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    expect(onAbort).not.toHaveBeenCalled();
  });

  it.each([
    ['an idle session', () => (busy = false), '\r'],
    ['navigation through the dialog', () => {}, '\x1b[B'],
    ['a terminal report', () => {}, '\x1b[I'],
    ['a session no hook has named yet', () => (transcript = undefined), '\r'],
    ['a record not written yet', () => (file = join(tmpdir(), 'hive-aborts-missing.jsonl')), '\r'],
  ])('watches nothing for %s', async (_what, arrange, data) => {
    arrange();
    const { aborts, read } = make();
    await aborts.onKey('s', data);
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).not.toHaveBeenCalled();
  });

  it('watches nothing for a CLI whose hooks report every end', async () => {
    const { aborts, read } = make(onRecord(claudeCodeAdapter));
    await aborts.onKey('s', '\x1b');
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).not.toHaveBeenCalled();
  });
});
