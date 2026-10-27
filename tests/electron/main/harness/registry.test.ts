import { describe, expect, it } from 'vitest';

import { claudeCodeAdapter } from '../../../../electron/main/harness/claude-code';
import { codexAdapter } from '../../../../electron/main/harness/codex';
import { copilotAdapter } from '../../../../electron/main/harness/copilot';
import {
  createHarnessRegistry,
  headlessAdapter,
  sessionAdapter,
} from '../../../../electron/main/harness/registry';

/** Stands in for the sessions closure, which alone knows what an entity is. */
const agentSessions = new Set(['sess-01']);
const registry = createHarnessRegistry({
  isAgentSession: (entityId) => agentSessions.has(entityId),
});

describe('harness registry', () => {
  it('resolves an agent session to claude-code', () => {
    expect(registry.harnessOf('sess-01')).toBe('claude-code');
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
      meters: true,
      contextDelivery: 'prompt-marker',
      reportsCostUsd: true,
      enforcesTurns: true,
      enforcesBudget: true,
      reportsMcpStatus: true,
      agentMcp: ['slack'],
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
