import { describe, expect, it } from 'vitest';

import {
  cliTakesEffort,
  CLI_VOCAB,
  CODEX_EFFORTS,
  CODEX_MODELS,
  resolveClis,
} from '../../../electron/shared/cli-contract';
import { HARNESS_IDS } from '../../../electron/shared/harness-contract';
import { SESSION_EFFORTS, SESSION_MODELS } from '../../../electron/shared/session-contract';

describe('cli-contract (HIVE-341)', () => {
  it("Claude's vocabulary is the session vocabulary", () => {
    expect(CLI_VOCAB['claude-code']).toEqual({
      models: SESSION_MODELS,
      efforts: SESSION_EFFORTS,
      noEffort: ['haiku'],
    });
  });

  it("Codex's vocabulary is its own (HIVE-342)", () => {
    expect(CLI_VOCAB.codex).toEqual({ models: CODEX_MODELS, efforts: CODEX_EFFORTS, noEffort: [] });
    expect(CODEX_MODELS[0]).toBe('gpt-6-luna');
  });

  it("dims Copilot's effort for kimi-k3, which refuses --reasoning-effort (HIVE-280, FINDINGS P8)", () => {
    expect(CLI_VOCAB.copilot.noEffort).toEqual(['kimi-k3']);
    expect(cliTakesEffort('copilot', 'kimi-k3')).toBe(false);
    expect(cliTakesEffort('copilot', 'auto')).toBe(true);
    for (const model of CLI_VOCAB.copilot.noEffort) expect(CLI_VOCAB.copilot.models).toContain(model);
  });

  it('resolves an absent block to every CLI enabled, with no defaults', () => {
    expect(resolveClis(undefined)).toEqual({
      'claude-code': { agents: { enabled: true } },
      codex: { agents: { enabled: true } },
      copilot: { agents: { enabled: true } },
    });
  });

  it('keeps what the file named, over the defaults', () => {
    expect(
      resolveClis({ 'claude-code': { agents: { enabled: false, model: 'haiku' } } }),
    ).toEqual({
      'claude-code': { agents: { enabled: false, model: 'haiku' } },
      codex: { agents: { enabled: true } },
      copilot: { agents: { enabled: true } },
    });
  });

  it('hands every call a fresh object', () => {
    expect(resolveClis(undefined)['claude-code']).not.toBe(resolveClis(undefined)['claude-code']);
  });
});

describe('cliTakesEffort (HIVE-279)', () => {
  it('says haiku takes no effort on Claude, and nothing else does', () => {
    expect(cliTakesEffort('claude-code', 'haiku')).toBe(false);
    expect(cliTakesEffort('claude-code', 'opus')).toBe(true);
    expect(cliTakesEffort('codex', 'gpt-6-luna')).toBe(true);
    expect(cliTakesEffort('copilot', 'auto')).toBe(true);
  });

  it('keeps every noEffort model inside its own CLI vocabulary', () => {
    for (const cli of HARNESS_IDS) {
      for (const model of CLI_VOCAB[cli].noEffort) {
        expect(CLI_VOCAB[cli].models as readonly string[]).toContain(model);
      }
    }
  });
});
