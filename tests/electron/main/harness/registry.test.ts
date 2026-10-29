import { describe, expect, it } from 'vitest';

import { claudeCodeAdapter } from '../../../../electron/main/harness/claude-code';
import { codexAdapter } from '../../../../electron/main/harness/codex';
import { copilotAdapter } from '../../../../electron/main/harness/copilot';
import {
  createHarnessRegistry,
  headlessAdapter,
  sessionAdapter,
} from '../../../../electron/main/harness/registry';
import type { HarnessId } from '../../../../electron/shared/harness-contract';

/** Stands in for the sessions closure, which alone knows what an entity is and what it runs. */
const agentSessions = new Map<string, HarnessId>([
  ['sess-01', 'claude-code'],
  ['sess-02', 'codex'],
]);
const registry = createHarnessRegistry({
  sessionHarness: (entityId) => agentSessions.get(entityId),
});

describe('harness registry', () => {
  it('resolves a session to the CLI it was opened with (HIVE-279)', () => {
    expect(registry.harnessOf('sess-01')).toBe('claude-code');
    expect(registry.harnessOf('sess-02')).toBe('codex');
  });

  it('resolves a plain terminal to no harness', () => {
    expect(registry.harnessOf('term-02')).toBeUndefined();
  });

  it('resolves a command to no harness (story 102: a command has no agent)', () => {
    expect(registry.harnessOf('cmd-03')).toBeUndefined();
  });

  it('hands back the Claude Code adapter for its id', () => {
    const adapter = registry.adapterFor('claude-code');
    expect(adapter).toBe(claudeCodeAdapter);
    expect(adapter.id).toBe('claude-code');
    expect(adapter.capabilities).toEqual({
      resume: 'by-id',
      // Its five, listed: `credits` is a meter kind Claude does not report (HIVE-334).
      meters: ['model', 'effort', 'context', 'fiveHour', 'sevenDay'],
      contextDelivery: 'prompt-marker',
      reportsCostUsd: true,
      enforcesTurns: true,
      enforcesBudget: true,
      reportsMcpStatus: true,
      agentMcp: ['slack'],
      conversationId: 'argv',
      hooks: true,
      permissionCards: true,
      plan: true,
      skills: true,
    });
  });

  it('hands the shared runtimes the Claude Code adapter (phase 1)', () => {
    expect(sessionAdapter()).toBe(claudeCodeAdapter);
  });
});

describe('headless runs (HIVE-340)', () => {
  it('serves the slack integration on Claude', () => {
    expect(claudeCodeAdapter.capabilities.agentMcp).toEqual(['slack']);
  });

  it('answers the adapter for a CLI id', () => {
    expect(headlessAdapter('claude-code')).toBe(claudeCodeAdapter);
  });

  it('runs a codex agent on the codex adapter, and every session still on claude (HIVE-342)', () => {
    expect(headlessAdapter('codex')).toBe(codexAdapter);
    expect(registry.adapterFor('codex')).toBe(codexAdapter);
    expect(sessionAdapter()).toBe(claudeCodeAdapter);
    expect(registry.harnessOf('sess-01')).toBe('claude-code');
  });

  it('runs a copilot agent on the copilot adapter, and every session still on claude (HIVE-343)', () => {
    expect(headlessAdapter('copilot')).toBe(copilotAdapter);
    expect(registry.adapterFor('copilot')).toBe(copilotAdapter);
    expect(sessionAdapter()).toBe(claudeCodeAdapter);
  });
});
