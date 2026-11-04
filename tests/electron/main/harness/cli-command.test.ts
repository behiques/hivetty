// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { cliCommand } from '../../../../electron/main/harness/cli-command';
import { resolveClis } from '../../../../electron/shared/cli-contract';

describe('cliCommand (HIVE-376)', () => {
  it('is claudeCommand for Claude, the set command for the others, else the bare name', () => {
    const clis = resolveClis({ codex: { command: '/opt/bin/codex' } });
    expect(cliCommand('claude-code', clis, 'claude --x')).toBe('claude --x');
    expect(cliCommand('codex', clis, 'claude')).toBe('/opt/bin/codex');
    expect(cliCommand('copilot', clis, 'claude')).toBe('copilot');
  });
});
