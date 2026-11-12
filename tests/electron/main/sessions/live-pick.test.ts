import { describe, expect, it } from 'vitest';

import { livePick } from '../../../../electron/main/sessions/live-pick';

describe('livePick', () => {
  it("maps Claude's display name to its alias and keeps a known effort", () => {
    expect(livePick('claude-code', { model: 'Sonnet 5.5', effort: 'low' })).toEqual({
      model: 'sonnet',
      effort: 'low',
    });
    expect(livePick('claude-code', { model: 'Opus 5.5 (1M context)' })).toEqual({ model: 'opus' });
  });

  it('takes Codex and Copilot ids their CLI accepts', () => {
    expect(livePick('codex', { model: 'gpt-6-luna', effort: 'low' })).toEqual({ model: 'gpt-6-luna', effort: 'low' });
    expect(livePick('copilot', { model: 'claude-opus-5.5' })).toEqual({ model: 'claude-opus-5.5' });
  });

  it('drops what the CLI would refuse', () => {
    expect(livePick('claude-code', { model: 'Mystery 9', effort: 'xhigh' })).toEqual({});
    expect(livePick('codex', { model: 'GPT 6 Luna; rm -rf', effort: 'turbo' })).toEqual({});
    expect(livePick('copilot', { model: 'not-a-copilot-model' })).toEqual({});
    expect(livePick('claude-code', { contextPct: 12 })).toEqual({});
  });
});
