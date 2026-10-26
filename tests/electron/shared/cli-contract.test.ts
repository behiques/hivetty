import { describe, expect, it } from 'vitest';

import {
  CLI_VOCAB,
  CODEX_EFFORTS,
  CODEX_MODELS,
  resolveClis,
} from '../../../electron/shared/cli-contract';
import { SESSION_EFFORTS, SESSION_MODELS } from '../../../electron/shared/session-contract';

describe('cli-contract (HIVE-341)', () => {
  it("Claude's vocabulary is the session vocabulary", () => {
    expect(CLI_VOCAB['claude-code']).toEqual({ models: SESSION_MODELS, efforts: SESSION_EFFORTS });
  });

  it("Codex's vocabulary is its own (HIVE-342)", () => {
    expect(CLI_VOCAB.codex).toEqual({ models: CODEX_MODELS, efforts: CODEX_EFFORTS });
    expect(CODEX_MODELS[0]).toBe('gpt-6-luna');
  });

  it('resolves an absent block to every CLI enabled, with no defaults', () => {
    expect(resolveClis(undefined)).toEqual({
      'claude-code': { agents: { enabled: true } },
      codex: { agents: { enabled: true } },
    });
  });

  it('keeps what the file named, over the defaults', () => {
    expect(
      resolveClis({ 'claude-code': { agents: { enabled: false, model: 'haiku' } } }),
    ).toEqual({
      'claude-code': { agents: { enabled: false, model: 'haiku' } },
      codex: { agents: { enabled: true } },
    });
  });

  it('hands every call a fresh object', () => {
    expect(resolveClis(undefined)['claude-code']).not.toBe(resolveClis(undefined)['claude-code']);
  });
});
