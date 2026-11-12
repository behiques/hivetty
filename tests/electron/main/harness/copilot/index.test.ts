import { describe, expect, it } from 'vitest';

import { blockAnswer } from '../../../../../electron/main/harness/block-answer';
import { claudeCodeAdapter } from '../../../../../electron/main/harness/claude-code';
import { codexAdapter } from '../../../../../electron/main/harness/codex';
import { codexRecordAborted } from '../../../../../electron/main/harness/codex/record';
import { copilotAdapter, copilotFence } from '../../../../../electron/main/harness/copilot';
import {
  copilotFenceReply,
  readCopilotFence,
  translateCopilotCall,
} from '../../../../../electron/main/harness/copilot/fence';
import { launchCopilotHeadless } from '../../../../../electron/main/harness/copilot/headless';
import { readCopilotHeadless } from '../../../../../electron/main/harness/copilot/headless-reader';
import { readCopilotHook } from '../../../../../electron/main/harness/copilot/hooks';
import { launchCopilotSession } from '../../../../../electron/main/harness/copilot/launch';
import { foldCopilotMeters } from '../../../../../electron/main/harness/copilot/meters';
import { copilotRecordAborted } from '../../../../../electron/main/harness/copilot/record';

describe('copilotAdapter', () => {
  it('is copilot', () => {
    expect(copilotAdapter.id).toBe('copilot');
  });

  it('declares what copilot -p can and cannot do', () => {
    expect(copilotAdapter.capabilities).toEqual({
      resume: 'by-id',
      meters: ['model', 'context', 'tokens', 'aiCredits'],
      contextDelivery: 'prompt-marker',
      reportsCostUsd: false,
      reportsTokens: true,
      enforcesTurns: false,
      enforcesBudget: false,
      reportsMcpStatus: false,
      container: false,
      agentMcp: [],
      conversationId: 'argv',
      skills: { toolPrefix: 'hive-', refPrefix: '/hive:hive-', typedPrefix: '/hive:hive-', namePrefix: 'hive-', pluginRoot: null },
    });
  });

  it('reads its meters from its OTel export (HIVE-335)', () => {
    expect(copilotAdapter.meterExport).toBe(true);
    expect(copilotAdapter.foldMeters).toBe(foldCopilotMeters);
    expect(copilotAdapter.meters('{}')).toBeNull(); // still no status line: /statusline stays 404
  });

  it("names where it reads the user's Copilot skills (HIVE-362)", () => {
    expect(copilotAdapter.installed.skillPlaces).toContain('~/.copilot/skills');
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

  it('renders its skills into its own folder (HIVE-369)', () => {
    expect(copilotAdapter.skills.dir).toBe('plugins/copilot');
  });

  it('writes no shared session file: the plugin is its own launch files (HIVE-280)', async () => {
    const { prepare } = copilotAdapter;
    await expect(prepare.sessionSettings('/u', 'http://h')).resolves.toBe('');
    await expect(prepare.agentSettings('/u', 'http://h')).resolves.toBe('');
    await expect(prepare.containerSet('/r', {} as never)).resolves.toBeUndefined();
    await expect(prepare.mcpConfig('/m', {} as never)).resolves.toBeUndefined();
  });

  it('answers its blocks from the keys the user types, as Codex does; Claude does not (HIVE-280, HIVE-365)', () => {
    expect(copilotAdapter.answersBlock).toBe(blockAnswer);
    expect(codexAdapter.answersBlock).toBe(blockAnswer);
    expect(claudeCodeAdapter.answersBlock).toBeUndefined();
  });

  it("reads aborts from each CLI's own record; Claude reads none (HIVE-365)", () => {
    expect(codexAdapter.recordAborted).toBe(codexRecordAborted);
    expect(copilotAdapter.recordAborted).toBe(copilotRecordAborted);
    expect(claudeCodeAdapter.recordAborted).toBeUndefined();
  });

  it("types Claude's bare marker: the rule in the instructions file tells the model what it is (HIVE-362)", () => {
    const entry = { id: 'e1', ts: 1, from: 'overmind', to: 'sess-1', kind: 'ask', ref: 'a12', body: '$ rm -rf ~' } as const;
    expect(copilotAdapter.promptMarker([entry])).toBe('📒 a12\r');
    expect(copilotAdapter.promptMarker).toBe(claudeCodeAdapter.promptMarker);
  });

  it("reads the user's Copilot skills, with no per-session overrides (HIVE-362)", async () => {
    // No skillNames() here: that would spawn the real copilot (installed.test.ts covers it).
    await expect(copilotAdapter.installed.sessionOverrides([])).resolves.toEqual({});
    expect(copilotAdapter.installed.skillPlaces).not.toBe('');
  });

  it('reads hooks with its own reader', () => {
    expect(copilotAdapter.readHook).toBe(readCopilotHook);
    expect(copilotAdapter.contextReply).toBe(claudeCodeAdapter.contextReply);
  });
});
