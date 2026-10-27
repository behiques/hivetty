import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { fenceCommand, hookCommand, shellQuote } from '../../../../electron/main/harness/hook-commands';

const DENY = JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: "it's down" });
const sh = (command: string, input: string) =>
  execFileSync('sh', ['-c', command], {
    input,
    env: { PATH: process.env['PATH'] ?? '', HIVE_RECEIVER_URL: 'http://127.0.0.1:9' },
  }).toString();

describe('hook commands', () => {
  it('quotes for sh', () => {
    expect(sh(`printf '%s' ${shellQuote("a'b \"c\" $HOME")}`, '')).toBe("a'b \"c\" $HOME");
  });

  it('fails closed: nothing listening prints the deny', () => {
    expect(JSON.parse(sh(fenceCommand({ denyJson: DENY }), '{}'))).toEqual(JSON.parse(DENY));
  });

  it('names the harness when asked, and only then', () => {
    expect(fenceCommand({ denyJson: DENY, harness: 'copilot' })).toContain('x-hive-harness: copilot');
    expect(fenceCommand({ denyJson: DENY })).not.toContain('x-hive-harness');
    expect(hookCommand({ harness: 'copilot' })).toContain('x-hive-harness: copilot');
    expect(hookCommand()).not.toContain('x-hive-harness');
  });

  it('wraps the body in an envelope, in sh', () => {
    const command = hookCommand({ wrap: 'agentStop' }).replace(/\| curl[^]*$/, '');

    expect(JSON.parse(sh(command, '{"sessionId":"u"}'))).toEqual({
      event: 'agentStop',
      payload: { sessionId: 'u' },
    });
  });

  it('never fails the CLI: a dead receiver exits 0', () => {
    expect(() => sh(hookCommand(), '{}')).not.toThrow();
    expect(() => sh(hookCommand({ wrap: 'agentStop' }), '{}')).not.toThrow();
  });
});
