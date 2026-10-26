import { describe, expect, it } from 'vitest';

import { CLI_VOCAB, resolveClis } from '../../../electron/shared/cli-contract';
import { SESSION_EFFORTS, SESSION_MODELS } from '../../../electron/shared/session-contract';

describe('cli-contract (HIVE-341)', () => {
  it("Claude's vocabulary is the session vocabulary", () => {
    expect(CLI_VOCAB['claude-code']).toEqual({ models: SESSION_MODELS, efforts: SESSION_EFFORTS });
  });

  it('resolves an absent block to every CLI enabled, with no defaults', () => {
    expect(resolveClis(undefined)).toEqual({ 'claude-code': { agents: { enabled: true } } });
  });

  it('keeps what the file named, over the defaults', () => {
    expect(
      resolveClis({ 'claude-code': { agents: { enabled: false, model: 'haiku' } } }),
    ).toEqual({ 'claude-code': { agents: { enabled: false, model: 'haiku' } } });
  });

  it('hands every call a fresh object', () => {
    expect(resolveClis(undefined)['claude-code']).not.toBe(resolveClis(undefined)['claude-code']);
  });
});
