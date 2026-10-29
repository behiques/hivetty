import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { claudeCodeAdapter } from '../../../../electron/main/harness/claude-code';
import { foldCodexMeters } from '../../../../electron/main/harness/codex/meters';
import type { HarnessAdapter } from '../../../../electron/main/harness/port';
import { createRecordMeters } from '../../../../electron/main/sessions/record-meters';
import { CH } from '../../../../electron/shared/ipc-contract';

const ctx = (model: string) => JSON.stringify({ type: 'turn_context', payload: { model } }) + '\n';

describe('createRecordMeters (HIVE-334)', () => {
  let dir: string;
  let transcript: { cwd: string; sessionUuid: string } | undefined;
  const fileOf = (uuid: string) => join(dir, `rollout-${uuid}.jsonl`);
  const adapter = (fold = true) =>
    ({
      ...claudeCodeAdapter,
      record: { ...claudeCodeAdapter.record, transcriptPath: (_cwd: string, uuid: string) => fileOf(uuid) },
      ...(fold ? { foldMeters: foldCodexMeters } : {}),
    }) as HarnessAdapter;
  const make = (fold = true, send = vi.fn()) => ({
    send,
    meters: createRecordMeters({ send, transcriptOf: () => transcript, adapterOf: () => adapter(fold) }),
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-meters-'));
    transcript = { cwd: '/repo', sessionUuid: 'u1' };
  });

  it('sends what the record gained, once per read', async () => {
    writeFileSync(fileOf('u1'), ctx('a'));
    const { send, meters } = make();
    await meters.onHook('sess-01');
    expect(send).toHaveBeenLastCalledWith(CH.sessionMetrics, { entityId: 'sess-01', metrics: { model: 'a' } });
    await meters.onHook('sess-01');
    expect(send).toHaveBeenCalledTimes(1);
    appendFileSync(fileOf('u1'), ctx('b'));
    await meters.onHook('sess-01');
    expect(send).toHaveBeenLastCalledWith(CH.sessionMetrics, { entityId: 'sess-01', metrics: { model: 'b' } });
  });

  it('waits on a torn last line until its newline lands', async () => {
    writeFileSync(fileOf('u1'), '{"type":"turn_context","payload":{"model":"a"');
    const { send, meters } = make();
    await meters.onHook('sess-01');
    expect(send).not.toHaveBeenCalled();
    appendFileSync(fileOf('u1'), '}}\n');
    await meters.onHook('sess-01');
    expect(send).toHaveBeenCalledWith(CH.sessionMetrics, { entityId: 'sess-01', metrics: { model: 'a' } });
  });

  it('reads nothing before the first hook named the conversation', async () => {
    transcript = undefined;
    const { send, meters } = make();
    await meters.onHook('sess-01');
    expect(send).not.toHaveBeenCalled();
  });

  it('reads nothing for a CLI whose meters come from its status line', async () => {
    writeFileSync(fileOf('u1'), ctx('a'));
    const { send, meters } = make(false);
    await meters.onHook('sess-01');
    expect(send).not.toHaveBeenCalled();
  });

  it('a new conversation reads its own file from the start, and clears the old context', async () => {
    writeFileSync(fileOf('u1'), ctx('a'));
    writeFileSync(fileOf('u2'), ctx('b'));
    const { send, meters } = make();
    await meters.onHook('sess-01');
    transcript = { cwd: '/repo', sessionUuid: 'u2' };
    await meters.onHook('sess-01');
    expect(send.mock.calls.slice(1).map((call) => (call[1] as { metrics: unknown }).metrics)).toEqual([
      { contextPct: null },
      { model: 'b' },
    ]);
  });

  it('a missing file is retried on the next hook', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { send, meters } = make();
    await meters.onHook('sess-01');
    expect(send).not.toHaveBeenCalled();
    writeFileSync(fileOf('u1'), ctx('a'));
    await meters.onHook('sess-01');
    expect(send).toHaveBeenCalledWith(CH.sessionMetrics, { entityId: 'sess-01', metrics: { model: 'a' } });
    warn.mockRestore();
  });

  it('a read in flight when the session ends sends nothing', async () => {
    writeFileSync(fileOf('u1'), ctx('a'));
    const { send, meters } = make();
    const pending = meters.onHook('sess-01');
    meters.drop('sess-01');
    await pending;
    expect(send).not.toHaveBeenCalled();
  });
});
