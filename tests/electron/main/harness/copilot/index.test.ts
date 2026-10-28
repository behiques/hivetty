import { describe, expect, it } from 'vitest';

import { claudeCodeAdapter } from '../../../../../electron/main/harness/claude-code';
import { copilotAdapter, copilotFence } from '../../../../../electron/main/harness/copilot';
import {
  copilotFenceReply,
  readCopilotFence,
  translateCopilotCall,
} from '../../../../../electron/main/harness/copilot/fence';
import { launchCopilotHeadless } from '../../../../../electron/main/harness/copilot/headless';
import { readCopilotHeadless } from '../../../../../electron/main/harness/copilot/headless-reader';
import { copilotBlockAnswer } from '../../../../../electron/main/harness/copilot/block-answer';
import { readCopilotHook } from '../../../../../electron/main/harness/copilot/hooks';
import { codexAdapter } from '../../../../../electron/main/harness/codex';
import { launchCopilotSession } from '../../../../../electron/main/harness/copilot/launch';

describe('copilotAdapter', () => {
  it('is copilot', () => {
    expect(copilotAdapter.id).toBe('copilot');
  });

  it('declares what copilot -p can and cannot do', () => {
    expect(copilotAdapter.capabilities).toEqual({
      resume: 'by-id',
      meters: false,
      contextDelivery: 'none',
      reportsCostUsd: false,
      enforcesTurns: false,
      enforcesBudget: false,
      reportsMcpStatus: false,
      agentMcp: [],
      conversationId: 'argv',
    });
  });

  it('reads no skills of its own (HIVE-344)', () => {
    expect(copilotAdapter.installed.skillPlaces).toBe('');
  });

  it('wires the headless members', () => {
    expect(copilotAdapter.headless).toEqual({
      launch: launchCopilotHeadless,
      reader: readCopilotHeadless,
      fence: copilotFence,
      containerCommand: 'copilot',
    });
  });

  it('expresses every rule set: decide enforces each rule through /fence (PR2)', () => {
    expect(copilotFence.express([])).toEqual({ ok: true });
    expect(copilotFence.express(['Bash(git:*)', 'mcp__hive__*'])).toEqual({ ok: true });
  });

  it("answers /fence with Task 15's translator, reader and reply", () => {
    expect(copilotFence.translate).toBe(translateCopilotCall);
    expect(copilotFence.read).toBe(readCopilotFence);
    expect(copilotFence.reply).toBe(copilotFenceReply);
    expect(copilotFence.grants).toEqual(['ToolSearch']);
  });

  it('launches a session with launchCopilotSession (HIVE-280)', () => {
    expect(copilotAdapter.launch).toBe(launchCopilotSession);
    expect(copilotAdapter.meters('{}')).toBeNull();
    expect(copilotAdapter.record.transcriptPath('/c', 'u')).toBeNull();
    expect(copilotAdapter.foldEdits(new Map(), ['x']).size).toBe(0);
  });

  it('writes no shared session file: the plugin is its own launch files (HIVE-280)', async () => {
    const { prepare } = copilotAdapter;
    await expect(prepare.sessionSettings('/u', 'http://h')).resolves.toBe('');
    await expect(prepare.agentSettings('/u', 'http://h')).resolves.toBe('');
    await expect(prepare.plugin('/p', '1', {} as never)).resolves.toBeUndefined();
    await expect(prepare.containerSet('/r', {} as never)).resolves.toBeUndefined();
    await expect(prepare.mcpConfig('/m', {} as never)).resolves.toBeUndefined();
  });

  it('answers its own blocks from the keys the user types; Claude and Codex do not (HIVE-280)', () => {
    expect(copilotAdapter.answersBlock).toBe(copilotBlockAnswer);
    expect(claudeCodeAdapter.answersBlock).toBeUndefined();
    expect(codexAdapter.answersBlock).toBeUndefined();
  });

  it('still refuses prompt markers: a follow-up ticket', () => {
    expect(() => copilotAdapter.promptMarker({} as never)).toThrow(/copilot sessions take no prompt markers yet/);
  });

  it('reports nothing installed', async () => {
    await expect(copilotAdapter.installed.skillNames()).resolves.toEqual([]);
    await expect(copilotAdapter.installed.pluginNames()).resolves.toEqual([]);
    await expect(copilotAdapter.installed.sessionOverrides([])).resolves.toEqual({});
  });

  it('reads hooks with its own reader', () => {
    expect(copilotAdapter.readHook).toBe(readCopilotHook);
    expect(copilotAdapter.contextReply).toBe(claudeCodeAdapter.contextReply);
  });
});
