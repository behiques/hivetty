import { describe, expect, it } from 'vitest';

import { CLI_NAMES } from '@lib/harness/cli-names';

describe('CLI_NAMES (HIVE-279)', () => {
  it('names every CLI', () => {
    expect(CLI_NAMES).toEqual({ 'claude-code': 'Claude Code', codex: 'Codex', copilot: 'Copilot' });
  });
});
