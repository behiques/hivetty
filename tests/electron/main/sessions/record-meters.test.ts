import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { claudeCodeAdapter } from '../../../../electron/main/harness/claude-code';
import { foldCodexMeters } from '../../../../electron/main/harness/codex/meters';
import { foldCopilotMeters } from '../../../../electron/main/harness/copilot/meters';
import type { HarnessAdapter } from '../../../../electron/main/harness/port';
import { createRecordMeters, METER_EXPORT_SETTLE_MS } from '../../../../electron/main/sessions/record-meters';
import { CH } from '../../../../electron/shared/ipc-contract';
import type { SessionMetrics } from '../../../../electron/shared/metrics-contract';

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

describe('prior totals (HIVE-335)', () => {
  it('hands each fold the merge of every fold before it, and a new conversation none', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hive-meters-'));
    const file = (uuid: string) => join(dir, `${uuid}.jsonl`);
    let transcript = { cwd: '/repo', sessionUuid: 'u1' };
    const priors: unknown[] = [];
    const fold = (lines: readonly string[], prior: SessionMetrics): SessionMetrics => {
      priors.push(prior);
      return { tokensIn: (prior.tokensIn ?? 0) + lines.filter(Boolean).length };
    };
    const adapter = {
      ...claudeCodeAdapter,
      record: { ...claudeCodeAdapter.record, transcriptPath: (_c: string, u: string) => file(u) },
      foldMeters: fold,
    } as HarnessAdapter;
    const send = vi.fn();
    const meters = createRecordMeters({ send, transcriptOf: () => transcript, adapterOf: () => adapter });
    writeFileSync(file('u1'), 'a\n');
    await meters.onHook('sess-01');
    appendFileSync(file('u1'), 'b\nc\n');
    await meters.onHook('sess-01');
    expect(send).toHaveBeenLastCalledWith(CH.sessionMetrics, { entityId: 'sess-01', metrics: { tokensIn: 3 } });
    writeFileSync(file('u2'), 'x\n');
    transcript = { cwd: '/repo', sessionUuid: 'u2' };
    await meters.onHook('sess-01');
    expect(priors).toEqual([{}, { tokensIn: 1 }, {}]);
  });
});

describe('an export-read CLI (HIVE-335)', () => {
  const span = (n: number) =>
    JSON.stringify({ type: 'span', attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.usage.input_tokens': n } }) + '\n';
  let dir: string;
  let exportFile: string;
  const make = (send = vi.fn()) => {
    const adapter = {
      ...claudeCodeAdapter,
      // The record must not be read: a transcript path that would throw if opened.
      record: { ...claudeCodeAdapter.record, transcriptPath: () => join(dir, 'never') },
      foldMeters: foldCopilotMeters,
      meterExport: true,
    } as HarnessAdapter;
    const meters = createRecordMeters({
      send,
      transcriptOf: () => ({ cwd: '/repo', sessionUuid: 'u1' }),
      adapterOf: () => adapter,
      exportPathOf: () => exportFile,
    });
    return { send, meters };
  };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-otel-'));
    exportFile = join(dir, 'sess-01.jsonl');
  });
  afterEach(() => vi.useRealTimers());

  it('reads the export, summing across reads', async () => {
    writeFileSync(exportFile, span(10));
    const { send, meters } = make();
    await meters.onHook('sess-01');
    appendFileSync(exportFile, span(5));
    await meters.onHook('sess-01');
    expect(send).toHaveBeenLastCalledWith(CH.sessionMetrics, { entityId: 'sess-01', metrics: { tokensIn: 15 } });
    meters.drop('sess-01');
  });

  it('a hook before the export exists sends nothing and warns nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { send, meters } = make();
    await meters.onHook('sess-01');
    expect(send).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    meters.drop('sess-01');
  });

  it('reads once more after the turn’s spans land, with no second hook', async () => {
    vi.useFakeTimers();
    const { send, meters } = make();
    await meters.onHook('sess-01'); // agentStop: the spans are not written yet
    writeFileSync(exportFile, span(7)); // ~0.5 s later, Copilot exports the turn
    await vi.advanceTimersByTimeAsync(METER_EXPORT_SETTLE_MS - 1);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    // The timer fired; its read is real file I/O, so wait for it rather than for another timer.
    await vi.waitFor(() =>
      expect(send).toHaveBeenLastCalledWith(CH.sessionMetrics, { entityId: 'sess-01', metrics: { tokensIn: 7 } }),
    );
  });

  it('debounces the trailing read, and drop cancels it', async () => {
    vi.useFakeTimers();
    writeFileSync(exportFile, span(1));
    const { send, meters } = make();
    await meters.onHook('sess-01');
    await meters.onHook('sess-01');
    appendFileSync(exportFile, span(1));
    meters.drop('sess-01');
    await vi.advanceTimersByTimeAsync(METER_EXPORT_SETTLE_MS * 2);
    // Give a read the timer might have started the time real file I/O takes.
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(send).toHaveBeenCalledTimes(1);
  });
});
