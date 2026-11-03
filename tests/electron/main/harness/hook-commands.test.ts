import { execFile, execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { contextCommand, fenceCommand, hookCommand, shellQuote } from '../../../../electron/main/harness/hook-commands';

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

  describe('contextCommand (HIVE-360)', () => {
    let server: Server | undefined;
    afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

    /** A receiver answering every POST with `status` and `body`; resolves with its origin. */
    const receiver = (status: number, body: string): Promise<string> =>
      new Promise((resolve) => {
        server = createServer((req, res) => {
          req.resume();
          req.on('end', () => res.writeHead(status, { 'content-type': 'application/json' }).end(body));
        }).listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`));
      });

    // Async: a sync spawn would block the event loop the receiver above answers on.
    const run = (command: string, url: string): Promise<{ code: number; stdout: string }> =>
      new Promise((resolve) => {
        const child = execFile('sh', ['-c', command], { env: { PATH: process.env['PATH'] ?? '', HIVE_RECEIVER_URL: url } }, (error, stdout) =>
          resolve({ code: error ? Number(error.code ?? 1) : 0, stdout }),
        );
        child.stdin?.end('{}');
      });

    it('prints the receiver’s reply, the context Codex reads from stdout', async () => {
      const reply = '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"entry"}}';
      expect(await run(contextCommand(), await receiver(200, reply))).toEqual({ code: 0, stdout: reply });
    });

    it('prints nothing for a refusal, so an error body never becomes context', async () => {
      expect(await run(contextCommand(), await receiver(403, '{"error":"bad token"}'))).toEqual({ code: 0, stdout: '' });
    });

    it('fails open: a dead receiver prints nothing and exits 0', async () => {
      expect(await run(contextCommand(), 'http://127.0.0.1:9')).toEqual({ code: 0, stdout: '' });
    });

    it('posts where hookCommand does, with the same identity', () => {
      expect(contextCommand()).toContain(hookCommand().replace(/ >\/dev\/null 2>&1 \|\| true$/, '').replace('curl -sS', 'curl -sf'));
    });
  });
});

