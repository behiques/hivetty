import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { claudeCodeAdapter } from '../../../../../electron/main/harness/claude-code';
import { codexAdapter } from '../../../../../electron/main/harness/codex';
import { codexFence } from '../../../../../electron/main/harness/codex/fence';
import { launchCodexHeadless } from '../../../../../electron/main/harness/codex/headless';
import { launchCodexSession } from '../../../../../electron/main/harness/codex/launch';
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
      // Codex picks its own conversation id; the first hook reports it (HIVE-279).
      conversationId: 'first-hook',
    });
  });

  it('reads no skills of its own (HIVE-344)', () => {
    expect(codexAdapter.installed.skillPlaces).toBe('');
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

  it('launches interactive sessions (HIVE-279)', () => {
    expect(codexAdapter.launch).toBe(launchCodexSession);
    expect(codexAdapter.launch({ command: 'codex' }).command).toMatch(/^codex /);
  });

  it('finds its conversations by their rollout (HIVE-279)', () => {
    expect(codexAdapter.record.hasTranscript('/c', 'u')).toBe(false);
    expect(codexAdapter.record.titleOrigin('/c', 'u', 'n')).toBe('unknown');
    expect(codexAdapter.record.nameFromTitle('Fix it | repo')).toBe('Fix it');
  });

  it('draws no meters and folds no edits', () => {
    expect(codexAdapter.meters('{}')).toBeNull();
    expect(codexAdapter.foldEdits(new Map(), ['x']).size).toBe(0);
  });

  it('needs no files before a session starts: everything is on the argv', async () => {
    const { prepare } = codexAdapter;

    await expect(prepare.sessionSettings('/u', 'http://x')).resolves.toBe('');
    await expect(prepare.agentSettings('/u', 'http://x')).resolves.toBe('');
    await expect(prepare.plugin('/p', '1', {} as never)).resolves.toBeUndefined();
    await expect(prepare.containerSet('/r', {} as never)).resolves.toBeUndefined();
    await expect(prepare.mcpConfig('/u/m.json', {} as never)).resolves.toBeUndefined();
  });

  it('still refuses prompt markers, which are the follow-up’s (D1)', () => {
    expect(() => codexAdapter.promptMarker({} as never)).toThrow(/codex sessions take no markers yet/);
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
