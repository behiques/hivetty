import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import {
  CODEX_AUTH_ENV_KEYS,
  CODEX_SESSION_ENV_KEYS,
  fenceCommand,
  launchCodexHeadless,
  toml,
} from '../../../../../electron/main/harness/codex/headless';
import type { HeadlessSandbox, HeadlessSpec } from '../../../../../electron/main/harness/port';

const spec = (over: Partial<HeadlessSpec> = {}): HeadlessSpec => ({
  conversation: { start: 'new-uuid' },
  name: 'watcher',
  limits: { turns: 40 },
  files: {
    settings: '/u/hive/s.json',
    pluginDir: '/u/hive/plugin',
    mcpConfig: '/u/hive/m.json',
    systemPrompt: '/u/hive/p.md',
  },
  grants: ['mcp__hive__ledger_*'],
  prompt: 'You were woken.',
  subscriptionAuth: true,
  instructions: 'You are "watcher".\nBe \\brief\\.',
  hiveServer: {
    command: '/Applications/HiveTTY.app/Contents/MacOS/HiveTTY',
    args: ['/u/hive/mcp-host.js'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  },
  ...over,
});

describe('launchCodexHeadless', () => {
  it('spells a first wake', () => {
    expect(
      launchCodexHeadless(spec({ model: 'gpt-6-luna', effort: 'high', sandbox: 'workspace-write' }))
        .args,
    ).toMatchSnapshot();
  });

  it('spells a resume, without the instructions it keeps', () => {
    const plan = launchCodexHeadless(spec({ conversation: { resume: 'thread-1' } }));

    expect(plan.args.slice(0, 3)).toEqual(['exec', 'resume', 'thread-1']);
    expect(plan.args.join(' ')).not.toContain('developer_instructions');
    expect(plan.args).toMatchSnapshot();
  });

  it('spells the read-only sandbox on both shapes', () => {
    expect(launchCodexHeadless(spec({ sandbox: 'read-only' })).args).toContain(
      'sandbox_mode="read-only"',
    );
    expect(
      launchCodexHeadless(spec({ sandbox: 'read-only', conversation: { resume: 't' } })).args,
    ).toContain('sandbox_mode="read-only"');
  });

  it('omits -m and the effort when the card chose none, and defaults the sandbox', () => {
    const args = launchCodexHeadless(spec()).args;

    expect(args).not.toContain('-m');
    expect(args.join(' ')).not.toContain('model_reasoning_effort');
    expect(args).toContain('sandbox_mode="workspace-write"');
  });

  it('always skips the git check, ignores user config and bypasses hook trust', () => {
    expect(launchCodexHeadless(spec()).args).toEqual(
      expect.arrayContaining([
        '--json',
        '--skip-git-repo-check',
        '--ignore-user-config',
        '--dangerously-bypass-hook-trust',
      ]),
    );
  });

  it('quotes text as TOML that parses back to itself', () => {
    for (const text of ['plain', 'a "quote"', 'back\\slash', 'line\nbreak', 'tab\tand é']) {
      expect(JSON.parse(toml(text))).toBe(text); // a TOML basic string is a JSON string
    }
  });

  it('escapes what JSON leaves raw but TOML forbids, and replaces what TOML cannot hold', () => {
    // DEL is a control character TOML requires escaped; a lone surrogate is no scalar value.
    expect(toml('a\u007fb')).toBe('"a\\u007fb"');
    expect(toml('x\ud800y')).toBe('"x\ufffdy"');
    expect(toml('\udc00')).toBe('"\ufffd"');
    expect(toml('😀')).toBe('"😀"');
  });

  it('refuses a sandbox outside HEADLESS_SANDBOXES rather than putting it on the argv', () => {
    for (const sandbox of ['danger-full-access', 'workspace-write" -c x="y', '']) {
      expect(() => launchCodexHeadless(spec({ sandbox: sandbox as HeadlessSandbox }))).toThrow(
        /sandbox/,
      );
    }
  });

  /*
    TOML v1.0.0's basic string, as a grammar: '"', then unescaped characters or escapes, then '"'.
    Unescaped is tab, 0x20-0x21, 0x23-0x5B, 0x5D-0x7E, or any non-ASCII scalar value. Decoding
    it back by that grammar must give the input, a lone surrogate excepted (it becomes U+FFFD).
  */
  const BASIC =
    /^"(?:[\t\x20\x21\x23-\x5b\x5d-\x7e\u0080-퟿-￿]|[\ud800-\udbff][\udc00-\udfff]|\\[btnfr"\\]|\\u[0-9a-fA-F]{4}|\\U[0-9a-fA-F]{8})*"$/;
  const ESCAPES: Record<string, string> = {
    b: '\b',
    t: '\t',
    n: '\n',
    f: '\f',
    r: '\r',
    '"': '"',
    '\\': '\\',
  };
  const decode = (quoted: string): string =>
    quoted
      .slice(1, -1)
      .replace(
        /\\(?:u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|(.))/g,
        (_, u4?: string, u8?: string, c?: string) =>
          u4 !== undefined || u8 !== undefined
            ? String.fromCodePoint(parseInt(u4 ?? u8 ?? '', 16))
            : (ESCAPES[c ?? ''] ?? ''),
      );
  const NASTY = [
    '',
    'plain',
    'a"b',
    'back\\slash',
    'line\nbreak\r\n',
    '\t\b\f',
    '\u0000\u001f',
    'del\u007fmid',
    'é ü 中 🐝',
    '\ud83d',
    'x\udc00y',
    '"""',
    "'''",
    '${HOME} $(id) `id`',
    '# not a comment',
    'key = "value"\n[table]\n[[hooks.Stop]]',
    '  \u0085',
  ];
  const scalar = (text: string) =>
    text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '�');

  it('writes every string as a TOML basic string that decodes back to it', () => {
    for (const text of NASTY) {
      const quoted = toml(text);
      expect(quoted, JSON.stringify(text)).toMatch(BASIC);
      expect(quoted).not.toMatch(/\\u[dD][89a-fA-F][0-9a-fA-F]{2}/);
      expect(decode(quoted), JSON.stringify(text)).toBe(scalar(text));
    }
  });

  it('never puts a token on the argv: the identity is forwarded by name', () => {
    const args = launchCodexHeadless(spec()).args;
    const value = (key: string) => args.find((arg) => arg.startsWith(`${key}=`));

    expect(value('mcp_servers.hive.env_vars')).toBe(
      'mcp_servers.hive.env_vars=["HIVE_RECEIVER_URL","HIVE_SESSION_ID","HIVE_HOOK_TOKEN","HIVE_RUN_ID","HIVE_RUN_TOKEN","HIVE_GRANTS"]',
    );
    expect(value('hooks.Stop')).toContain('x-hive-session: $HIVE_SESSION_ID');
    expect(value('hooks.Stop')).toContain('x-hive-token: $HIVE_HOOK_TOKEN');
    expect(args.join(' ')).not.toContain('HIVE_HOOK_TOKEN=');
  });

  it('stops on the wake id, which a first wake does not otherwise name', () => {
    const plan = launchCodexHeadless(spec({ conversation: { start: 'uuid-1' } }));

    expect(plan.stopPattern).toBe('uuid-1');
    expect(plan.args).toContain('mcp_servers.hive_wake.command="uuid-1"');
    expect(plan.namesConversation).toBe(false);
    expect(launchCodexHeadless(spec({ conversation: { resume: 't' } })).namesConversation).toBe(
      true,
    );
  });

  it('strips the parent session always, and the API keys under subscription auth', () => {
    expect(launchCodexHeadless(spec({ subscriptionAuth: false })).stripEnv).toEqual(
      CODEX_SESSION_ENV_KEYS,
    );
    expect(launchCodexHeadless(spec({ subscriptionAuth: true })).stripEnv).toEqual([
      ...CODEX_SESSION_ENV_KEYS,
      ...CODEX_AUTH_ENV_KEYS,
    ]);
    expect(CODEX_SESSION_ENV_KEYS).not.toContain('CODEX_HOME');
    expect(CODEX_SESSION_ENV_KEYS).not.toContain('CODEX_API_KEY');
  });

  it('refuses an http hive server: containers are not supported yet', () => {
    expect(() =>
      launchCodexHeadless(
        spec({ hiveServer: { type: 'http', url: 'http://h/mcp', headers: {} } }),
      ),
    ).toThrow(/container/);
  });
});


/** Runs a hook command as codex does: through a shell, the payload on stdin, the run's env. */
const runHook = (command: string, env: Record<string, string>): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', command], { env: { PATH: process.env['PATH'] ?? '', ...env } });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.on('error', reject);
    child.on('close', () => resolve(out));
    child.stdin.end('{"tool_name":"Bash","tool_input":{"command":"ls"}}');
  });

/** A receiver stand-in answering every POST with one status and body, and recording headers. */
const serve = async (status: number, body: string) => {
  const seen: Record<string, string | string[] | undefined>[] = [];
  const server = createServer((req, res) => {
    seen.push(req.headers);
    req.resume();
    req.on('end', () => res.writeHead(status, { 'content-type': 'application/json' }).end(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return { url, seen, close: () => new Promise((resolve) => server.close(resolve)) };
};

const ENV = {
  HIVE_SESSION_ID: 'watcher',
  HIVE_HOOK_TOKEN: 'tok',
  HIVE_RUN_ID: 'run-1',
  HIVE_RUN_TOKEN: 'run-tok',
};

const decisionOf = (out: string) =>
  (JSON.parse(out) as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput
    ?.permissionDecision;

describe('the PreToolUse fence hook (HIVE-342)', () => {
  it('is on every wake, for every tool', () => {
    for (const conversation of [{ start: 'u' }, { resume: 't' }]) {
      const args = launchCodexHeadless(spec({ conversation })).args;
      expect(args).toContain(
        `hooks.PreToolUse=[{matcher="*",hooks=[{type="command",command=${toml(fenceCommand())}}]}]`,
      );
    }
  });

  it('posts to /fence with the identity and the run, all read from the env', async () => {
    const receiver = await serve(200, '{}');
    const out = await runHook(fenceCommand(), { ...ENV, HIVE_RECEIVER_URL: receiver.url });
    await receiver.close();

    expect(out).toBe('{}');
    expect(receiver.seen[0]).toMatchObject({
      'x-hive-session': 'watcher',
      'x-hive-token': 'tok',
      'x-hive-run': 'run-1',
      'x-hive-run-token': 'run-tok',
    });
    expect(fenceCommand()).toContain('/fence');
    expect(fenceCommand()).not.toMatch(/watcher|run-1/);
  });

  it('passes the receiver\'s deny through as it came', async () => {
    const deny = '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"no"}}';
    const receiver = await serve(200, deny);
    const out = await runHook(fenceCommand(), { ...ENV, HIVE_RECEIVER_URL: receiver.url });
    await receiver.close();

    expect(out).toBe(deny);
  });

  it('fails closed: a refusal or a receiver that is not there is a deny, never an empty allow', async () => {
    const refusing = await serve(403, '{}');
    expect(decisionOf(await runHook(fenceCommand(), { ...ENV, HIVE_RECEIVER_URL: refusing.url }))).toBe(
      'deny',
    );
    await refusing.close();

    // A 2xx with nothing in it would read as "no decision", which codex runs.
    const empty = await serve(204, '');
    expect(decisionOf(await runHook(fenceCommand(), { ...ENV, HIVE_RECEIVER_URL: empty.url }))).toBe(
      'deny',
    );
    await empty.close();

    expect(
      decisionOf(await runHook(fenceCommand(), { ...ENV, HIVE_RECEIVER_URL: 'http://127.0.0.1:9' })),
    ).toBe('deny');
    expect(decisionOf(await runHook(fenceCommand(), { ...ENV, HIVE_RECEIVER_URL: '' }))).toBe('deny');
  });
});
