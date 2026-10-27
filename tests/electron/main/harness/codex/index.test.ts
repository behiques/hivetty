import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { claudeCodeAdapter } from '../../../../../electron/main/harness/claude-code';
import { codexAdapter } from '../../../../../electron/main/harness/codex';
import { codexFence } from '../../../../../electron/main/harness/codex/fence';
import { launchCodexHeadless } from '../../../../../electron/main/harness/codex/headless';
import { readCodexHeadless } from '../../../../../electron/main/harness/codex/headless-reader';

describe('codexAdapter', () => {
  it('is codex', () => {
    expect(codexAdapter.id).toBe('codex');
  });

  it('declares what codex exec can and cannot do', () => {
    expect(codexAdapter.capabilities).toEqual({
      resume: 'by-id',
      meters: false,
      contextDelivery: 'none',
      reportsCostUsd: false,
      enforcesTurns: false,
      enforcesBudget: false,
      reportsMcpStatus: false,
      agentMcp: [],
    });
  });

  it('wires the headless members', () => {
    expect(codexAdapter.headless).toEqual({
      launch: launchCodexHeadless,
      reader: readCodexHeadless,
      fence: codexFence,
      containerCommand: 'codex',
    });
  });

  it('grants no built-in of its own (HIVE-344)', () => {
    expect(codexFence.grants).toBeUndefined();
  });

  it('refuses every interactive member (HIVE-279)', () => {
    expect(() => codexAdapter.launch({ command: 'codex' })).toThrow(/HIVE-279/);
    expect(() => codexAdapter.promptMarker({} as never)).toThrow(/HIVE-279/);
    expect(codexAdapter.meters('{}')).toBeNull();
    expect(codexAdapter.record.transcriptPath('/c', 'u')).toBeNull();
    expect(codexAdapter.record.hasTranscript('/c', 'u')).toBe(false);
    expect(codexAdapter.record.titleOrigin('/c', 'u', 'n')).toBe('unknown');
    expect(codexAdapter.record.nameFromTitle('t')).toBe('t');
    expect(codexAdapter.foldEdits(new Map(), ['x']).size).toBe(0);
  });

  it('refuses to write any session file (HIVE-279)', async () => {
    const { prepare } = codexAdapter;

    await expect(prepare.sessionSettings('/u', 'http://h')).rejects.toThrow(/HIVE-279/);
    await expect(prepare.agentSettings('/u', 'http://h')).rejects.toThrow(/HIVE-279/);
    await expect(prepare.plugin('/p', '1', {} as never)).rejects.toThrow(/HIVE-279/);
    await expect(prepare.containerSet('/r', {} as never)).rejects.toThrow(/HIVE-279/);
    await expect(prepare.mcpConfig('/m', {} as never)).rejects.toThrow(/HIVE-279/);
  });

  it('reports nothing installed', async () => {
    await expect(codexAdapter.installed.skillNames()).resolves.toEqual([]);
    await expect(codexAdapter.installed.pluginNames()).resolves.toEqual([]);
    await expect(codexAdapter.installed.sessionOverrides([])).resolves.toEqual({});
  });

  it('reads an agent-lane hook as Claude-shaped, since codex payloads are', () => {
    const lines = readFileSync(join(__dirname, '../../../../fixtures/codex/hooks-0.164.0.jsonl'), 'utf8').split('\n');
    for (const body of lines.filter((line) => line !== '')) {
      const input = { lane: 'agent' as const, entityId: 'a', body, truncated: false };
      expect(codexAdapter.readHook(input)).toEqual(claudeCodeAdapter.readHook(input));
    }
    expect(codexAdapter.contextReply).toBe(claudeCodeAdapter.contextReply);
  });
});
