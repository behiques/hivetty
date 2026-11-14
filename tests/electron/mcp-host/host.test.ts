import { describe, expect, it, vi } from 'vitest';

import { createHandlers, readEnvironment, readGrants } from '../../../electron/mcp-host/host';

describe('readEnvironment', () => {
  it('reads the three variables the host needs', () => {
    expect(
      readEnvironment({
        HIVE_SESSION_ID: 'sess-a',
        HIVE_HOOK_TOKEN: 'tok',
        HIVE_RECEIVER_URL: 'http://127.0.0.1:4100',
      }),
    ).toEqual({ session: 'sess-a', token: 'tok', url: 'http://127.0.0.1:4100' });
  });

  it('answers null when any of them is missing', () => {
    expect(readEnvironment({ HIVE_SESSION_ID: 'sess-a', HIVE_HOOK_TOKEN: 'tok' })).toBeNull();
    expect(readEnvironment({})).toBeNull();
  });

  it('carries the run id when the process has one (HIVE-128)', () => {
    expect(
      readEnvironment({
        HIVE_SESSION_ID: 'pr-reviewer',
        HIVE_HOOK_TOKEN: 'tok',
        HIVE_RECEIVER_URL: 'http://127.0.0.1:4100',
        HIVE_RUN_ID: 'run-9',
        HIVE_RUN_TOKEN: 'rt',
      }),
    ).toEqual({
      session: 'pr-reviewer',
      token: 'tok',
      url: 'http://127.0.0.1:4100',
      run: 'run-9',
      runToken: 'rt',
    });
  });

  it('reads an empty run token as no token, even with a run (HIVE-184)', () => {
    expect(
      readEnvironment({
        HIVE_SESSION_ID: 'pr-reviewer',
        HIVE_HOOK_TOKEN: 'tok',
        HIVE_RECEIVER_URL: 'http://127.0.0.1:4100',
        HIVE_RUN_ID: 'run-9',
        HIVE_RUN_TOKEN: '',
      }),
    ).toEqual({ session: 'pr-reviewer', token: 'tok', url: 'http://127.0.0.1:4100', run: 'run-9' });
  });

  it('reads an empty run id as no run at all', () => {
    expect(
      readEnvironment({
        HIVE_SESSION_ID: 'sess-a',
        HIVE_HOOK_TOKEN: 'tok',
        HIVE_RECEIVER_URL: 'http://127.0.0.1:4100',
        HIVE_RUN_ID: '',
        HIVE_RUN_TOKEN: '',
      }),
    ).toEqual({ session: 'sess-a', token: 'tok', url: 'http://127.0.0.1:4100' });
  });
});

describe('readGrants', () => {
  it('reads grants from the environment, and fences everything without them', () => {
    expect(readGrants({ HIVE_GRANTS: '["Read","Bash"]' })).toEqual(['Read', 'Bash']);
    expect(readGrants({ HIVE_GRANTS: 'not json' })).toEqual([]);
    expect(readGrants({ HIVE_GRANTS: '{"a":1}' })).toEqual([]);
    expect(readGrants({})).toEqual([]);
  });
});

describe('createHandlers without an environment', () => {
  /*
    Eleven since HIVE-127 added the peer directory. The count matters here
    rather than in prose: this is the unreachable path, and a tool list that
    differed depending on how the process was started would make `/mcp` report
    a different server than the one an agent actually gets.
  */
  it('still lists the twenty-one tools, so /mcp shows the server connected', () => {
    const handlers = createHandlers({}, vi.fn() as never);
    // Twenty since HIVE-409 added pr_merge; twenty-one since HIVE-410 added ledger_accept.
    expect(handlers.listTools()).toHaveLength(21);
    expect(handlers.listTools().map((tool) => tool.name)).toContain('project_auto_merge');
    expect(handlers.listTools().map((tool) => tool.name)).toContain('pr_merge');
    expect(handlers.listTools().map((tool) => tool.name)).toContain('ledger_accept');
  });

  it('answers every call with a legible reason instead of hanging', async () => {
    const handlers = createHandlers({}, vi.fn() as never);
    const result = await handlers.callTool('ledger_read', {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not running|outside the Hive/i);
  });

  it('never calls fetch when it has no receiver to call', async () => {
    const fetchImpl = vi.fn();
    await createHandlers({}, fetchImpl as never).callTool('ledger_post', { body: 'x' });

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('createHandlers with an environment', () => {
  it('calls the receiver named in the environment', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ entries: [], openAsks: [], claims: {} }), { status: 200 }),
    );

    const handlers = createHandlers(
      {
        HIVE_SESSION_ID: 'sess-a',
        HIVE_HOOK_TOKEN: 'tok',
        HIVE_RECEIVER_URL: 'http://127.0.0.1:4100',
      },
      fetchImpl as never,
    );

    const result = await handlers.callTool('ledger_read', {});

    expect(result.isError).toBe(false);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/ledger/read',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('createHandlers — the session lane (HIVE-368)', () => {
  const SESSION = { HIVE_SESSION_ID: 'sess-a', HIVE_HOOK_TOKEN: 't', HIVE_RECEIVER_URL: 'http://127.0.0.1:1' };
  const names = (env: NodeJS.ProcessEnv) =>
    createHandlers(env, vi.fn() as never)
      .listTools()
      .map((tool) => tool.name);

  it('lists session_done for a session, reachable or not', () => {
    expect(names(SESSION)).toContain('session_done');
    expect(names({})).toContain('session_done');
  });
  it('hides it from an agent run, reachable or not', () => {
    expect(names({ ...SESSION, HIVE_RUN_ID: 'run-9', HIVE_RUN_TOKEN: 'rt' })).not.toContain('session_done');
    expect(names({ HIVE_RUN_ID: 'run-9' })).not.toContain('session_done');
  });
});

describe('createHandlers — the lane cursor (HIVE-412)', () => {
  const ENV = { HIVE_SESSION_ID: 'shipper', HIVE_HOOK_TOKEN: 't', HIVE_RECEIVER_URL: 'http://127.0.0.1:1', HIVE_RUN_ID: 'run-1' };
  const firstRead = async (env: NodeJS.ProcessEnv): Promise<unknown> => {
    const fetchImpl = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ entries: [], openAsks: [], claims: {} }), { status: 200 }),
    );
    await createHandlers(env, fetchImpl as never).callTool('ledger_read', {});
    return JSON.parse(String(fetchImpl.mock.calls[0]?.[1].body));
  };

  it('starts the first plain read after HIVE_LEDGER_SINCE', async () => {
    expect(await firstRead({ ...ENV, HIVE_LEDGER_SINCE: '20261113-100000-0001' })).toEqual({ since: '20261113-100000-0001' });
  });

  it('reads the newest page when it is empty or absent', async () => {
    expect(await firstRead({ ...ENV, HIVE_LEDGER_SINCE: '' })).toEqual({ limit: 50 });
    expect(await firstRead(ENV)).toEqual({ limit: 50 });
  });
});
