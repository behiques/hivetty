import { describe, expect, it } from 'vitest';

import { claudeCodeAdapter } from '../../../../../electron/main/harness/claude-code';
import { copilotAdapter, copilotFence } from '../../../../../electron/main/harness/copilot';
import { launchCopilotHeadless } from '../../../../../electron/main/harness/copilot/headless';
import { readCopilotHeadless } from '../../../../../electron/main/harness/copilot/headless-reader';

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
    });
  });

  it('wires the headless members', () => {
    expect(copilotAdapter.headless).toEqual({
      launch: launchCopilotHeadless,
      reader: readCopilotHeadless,
      fence: copilotFence,
    });
  });

  it('refuses every rule set until the fence lands (PR2)', () => {
    expect(copilotFence.express([])).toEqual({ ok: false, unexpressible: ['*'] });
    expect(copilotFence.express(['Read'])).toEqual({ ok: false, unexpressible: ['*'] });
  });

  it('refuses every interactive member (HIVE-280)', () => {
    expect(() => copilotAdapter.launch({ command: 'copilot' })).toThrow(/HIVE-280/);
    expect(() => copilotAdapter.promptMarker({} as never)).toThrow(/HIVE-280/);
    expect(copilotAdapter.meters('{}')).toBeNull();
    expect(copilotAdapter.record.transcriptPath('/c', 'u')).toBeNull();
    expect(copilotAdapter.record.hasTranscript('/c', 'u')).toBe(false);
    expect(copilotAdapter.record.titleOrigin('/c', 'u', 'n')).toBe('unknown');
    expect(copilotAdapter.record.nameFromTitle('t')).toBe('t');
    expect(copilotAdapter.foldEdits(new Map(), ['x']).size).toBe(0);
  });

  it('refuses to write any session file (HIVE-280)', async () => {
    const { prepare } = copilotAdapter;

    await expect(prepare.sessionSettings('/u', 'http://h')).rejects.toThrow(/HIVE-280/);
    await expect(prepare.agentSettings('/u', 'http://h')).rejects.toThrow(/HIVE-280/);
    await expect(prepare.plugin('/p', '1', {} as never)).rejects.toThrow(/HIVE-280/);
    await expect(prepare.containerSet('/r', {} as never)).rejects.toThrow(/HIVE-280/);
    await expect(prepare.mcpConfig('/m', {} as never)).rejects.toThrow(/HIVE-280/);
  });

  it('reports nothing installed', async () => {
    await expect(copilotAdapter.installed.skillNames()).resolves.toEqual([]);
    await expect(copilotAdapter.installed.pluginNames()).resolves.toEqual([]);
    await expect(copilotAdapter.installed.sessionOverrides([])).resolves.toEqual({});
  });

  it("reads hooks with Claude's reader until PR2 gives copilot its own", () => {
    expect(copilotAdapter.readHook).toBe(claudeCodeAdapter.readHook);
    expect(copilotAdapter.contextReply).toBe(claudeCodeAdapter.contextReply);
  });
});
