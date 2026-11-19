// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ASKPASS_SCRIPT,
  classifyGit,
  createSwarmGit,
  type Exec,
  GitError,
  LS_REMOTE_TIMEOUT_MS,
} from '../../../core/swarms/git';

let root: string;
let work: string;
let bare: string;
let first: string;

const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hive-swarm-git-test-'));
  work = join(root, 'work');
  bare = join(root, 'bare.git');

  mkdirSync(work);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'user.name', 'Test');
  git(work, 'config', 'commit.gpgsign', 'false');
  git(work, 'config', 'tag.gpgsign', 'false');
  write(join(work, 'standard', 'swarm.json'), '{"version":"1.0.0"}\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'one');
  first = git(work, 'rev-parse', 'HEAD');
  git(work, 'tag', 'standard/v1.0.0');
  write(join(work, 'standard', 'swarm.json'), '{"version":"1.0.1"}\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'two');
  git(work, 'tag', '-a', 'standard/v1.0.1', '-m', 'x');
  git(work, 'tag', 'other/v9.0.0');
  git(work, 'tag', 'v0.1.0');
  git(work, 'tag', 'standard/not-a-version');
  git(root, 'clone', '-q', '--bare', work, bare);
  git(bare, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

const realGit = () => createSwarmGit({ env: () => process.env, askpass: join(root, 'askpass.sh') });

const rejection = async (promise: Promise<unknown>): Promise<GitError> => {
  const error = await promise.then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(GitError);
  return error as GitError;
};

describe('fetch, against a real bare repository', () => {
  it('checks out a commit by hash and answers it', async () => {
    const dir = join(root, 'out');
    await expect(realGit().fetch({ dir, url: bare, ref: first })).resolves.toBe(first);
    expect(readFileSync(join(dir, 'standard', 'swarm.json'), 'utf8')).toBe('{"version":"1.0.0"}\n');
  });

  it('checks out an annotated tag and answers its commit', async () => {
    const dir = join(root, 'out');
    const commit = git(work, 'rev-parse', 'standard/v1.0.1^{commit}');
    await expect(realGit().fetch({ dir, url: bare, ref: 'refs/tags/standard/v1.0.1' })).resolves.toBe(commit);
    expect(readFileSync(join(dir, 'standard', 'swarm.json'), 'utf8')).toBe('{"version":"1.0.1"}\n');
  });

  it.each(['--upload-pack=x', 'main'])('refuses the ref %j before Git runs', async (ref) => {
    const dir = join(root, 'out');
    const error = await rejection(realGit().fetch({ dir, url: bare, ref }));
    expect(error.kind).toBe('failed');
    expect(existsSync(dir)).toBe(false);
  });

  it('reports a missing repository as no access', async () => {
    const error = await rejection(
      realGit().fetch({ dir: join(root, 'out'), url: join(root, 'no-such-repo'), ref: first }),
    );
    expect(error.kind).toBe('no_access');
  });
});

describe('newestVersion, against a real bare repository', () => {
  it('answers the highest version for a folder, folding the peeled tag', async () => {
    await expect(realGit().newestVersion(bare, 'standard')).resolves.toBe('1.0.1');
  });

  it('answers the root folder on its own', async () => {
    await expect(realGit().newestVersion(bare, '')).resolves.toBe('0.1.0');
  });

  it('answers null when no tag fits', async () => {
    await expect(realGit().newestVersion(bare, 'missing')).resolves.toBeNull();
  });
});

describe('classifyGit', () => {
  it.each<[string, string]>([
    ["fatal: Authentication failed for 'https://github.com/a/b.git/'", 'no_access'],
    ['remote: Repository not found.', 'no_access'],
    ["fatal: could not read Username for 'https://github.com': terminal prompts disabled", 'no_access'],
    ['git@github.com: Permission denied (publickey).', 'no_access'],
    ['The requested URL returned error: 403', 'no_access'],
    ["fatal: unable to access 'https://x/': Could not resolve host: x", 'offline'],
    ['Failed to connect to github.com port 443', 'offline'],
    [
      'ssh: Could not resolve hostname github.com\nfatal: Could not read from remote repository.',
      'offline',
    ],
    [
      'ssh: connect to host github.com port 22: No route to host\nfatal: Could not read from remote repository.',
      'offline',
    ],
    [
      'kex_exchange_identification: read: Connection reset by peer\nfatal: Could not read from remote repository.',
      'offline',
    ],
    [
      "fatal: '/tmp/no-such-repo' does not appear to be a git repository\nfatal: Could not read from remote repository.",
      'no_access',
    ],
    ['fatal: Could not read from remote repository.', 'failed'],
    ['fatal: couldn\'t find remote ref refs/tags/x', 'failed'],
  ])('%j is %s', (stderr, kind) => {
    expect(classifyGit(stderr)).toBe(kind);
  });
});

interface Call {
  args: string[];
  env: NodeJS.ProcessEnv;
}

const recording = (fail?: { when: (args: string[]) => boolean; stderr: string; error?: Error }) => {
  const calls: Call[] = [];
  const exec: Exec = (_file, args, options, done) => {
    calls.push({ args, env: options.env });
    if (fail?.when(args)) {
      done(fail.error ?? new Error('Command failed'), '', fail.stderr);
    } else {
      done(null, 'abc\n', '');
    }
    return { kill: () => undefined };
  };
  return { calls, exec };
};

describe('the token', () => {
  const askpass = (): string => join(root, 'swarms', 'askpass.sh');

  it('rides only the fetch command, through askpass and an empty credential helper', async () => {
    const { calls, exec } = recording();
    const swarmGit = createSwarmGit({ env: () => ({ HOME: '/home/x' }), askpass: askpass(), exec });

    await swarmGit.fetch({ dir: join(root, 'out'), url: 'https://github.com/a/b.git', ref: first, token: 'ghs_secret' });

    const fetchCall = calls.find((call) => call.args.includes('fetch'));
    expect(fetchCall?.args.slice(0, 3)).toEqual(['-c', 'credential.helper=', 'fetch']);
    expect(fetchCall?.env['GIT_ASKPASS']).toBe(askpass());
    expect(fetchCall?.env['HIVE_SWARM_TOKEN']).toBe('ghs_secret');

    const others = calls.filter((call) => call !== fetchCall);
    expect(others.map((call) => call.args[0])).toEqual(['init', 'remote', 'checkout', 'rev-parse']);
    for (const call of others) {
      expect(call.env).not.toHaveProperty('GIT_ASKPASS');
      expect(call.env).not.toHaveProperty('HIVE_SWARM_TOKEN');
      expect(call.args).not.toContain('credential.helper=');
    }
    for (const call of calls) {
      expect(call.args.join(' ')).not.toContain('ghs_secret');
      expect(call.env['GIT_TERMINAL_PROMPT']).toBe('0');
      expect(call.env['LC_ALL']).toBe('C');
      expect(call.env['HOME']).toBe('/home/x');
    }

    expect(statSync(askpass()).mode & 0o777).toBe(0o700);
    expect(readFileSync(askpass(), 'utf8')).not.toContain('ghs_secret');
  });

  it('is absent from a run without one, and no askpass is written', async () => {
    const { calls, exec } = recording();
    const swarmGit = createSwarmGit({ env: () => ({}), askpass: askpass(), exec });

    await swarmGit.fetch({ dir: join(root, 'out'), url: 'https://github.com/a/b.git', ref: first });

    for (const call of calls) {
      expect(call.env).not.toHaveProperty('GIT_ASKPASS');
      expect(call.env).not.toHaveProperty('HIVE_SWARM_TOKEN');
      expect(call.args[0]).not.toBe('-c');
    }
    expect(existsSync(askpass())).toBe(false);
  });

  it('is masked in a failure detail', async () => {
    const { exec } = recording({ when: (args) => args.includes('fetch'), stderr: 'fatal: bad ghs_secret here\n' });
    const swarmGit = createSwarmGit({ env: () => ({}), askpass: askpass(), exec });

    const error = await rejection(
      swarmGit.fetch({ dir: join(root, 'out'), url: 'https://github.com/a/b.git', ref: first, token: 'ghs_secret' }),
    );
    expect(error.detail).toContain('***');
    expect(error.detail).not.toContain('ghs_secret');
    expect(error.message).not.toContain('ghs_secret');
  });

  it('is answered by the askpass script for the password prompt only', () => {
    const file = join(root, 'askpass.sh');
    writeFileSync(file, ASKPASS_SCRIPT);
    chmodSync(file, 0o700);
    const run = (prompt: string): string =>
      execFileSync(file, [prompt], { env: { HIVE_SWARM_TOKEN: 't0k' }, encoding: 'utf8' });

    expect(run("Username for 'https://github.com': ")).toBe('x-access-token\n');
    expect(run("Password for 'https://x-access-token@github.com': ")).toBe('t0k\n');
  });
});

describe('newestVersion, over a fake runner', () => {
  it('answers null for output with no tag lines', async () => {
    const { exec } = recording();
    const swarmGit = createSwarmGit({ env: () => ({}), askpass: join(root, 'askpass.sh'), exec });
    await expect(swarmGit.newestVersion('https://github.com/a/b.git', '')).resolves.toBeNull();
  });
});

describe('failures from the runner', () => {
  it('kills a run past its timeout and says so', async () => {
    vi.useFakeTimers();
    const kill = vi.fn();
    const exec: Exec = (_file, _args, _options, done) => {
      kill.mockImplementation(() => {
        done(new Error('killed'), '', '');
      });
      return { kill };
    };
    const swarmGit = createSwarmGit({ env: () => ({}), askpass: join(root, 'askpass.sh'), exec });

    const pending = rejection(swarmGit.newestVersion('https://github.com/a/b.git', ''));
    await vi.advanceTimersByTimeAsync(LS_REMOTE_TIMEOUT_MS);
    const error = await pending;

    expect(error.kind).toBe('failed');
    expect(error.detail).toBe('Git did not finish within 20 seconds.');
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('turns an exec that throws into a masked GitError and leaves no timer behind', async () => {
    vi.useFakeTimers();
    // Only the fetch carries the token, so only the fetch can quote it.
    const exec: Exec = (_file, args, _options, done) => {
      if (!args.includes('fetch')) {
        done(null, '', '');
        return { kill: () => undefined };
      }
      throw new TypeError("The property 'options.env['HIVE_SWARM_TOKEN']' must be a string. Received 'ghs_secret\\x00'");
    };
    const swarmGit = createSwarmGit({ env: () => ({}), askpass: join(root, 'swarms', 'askpass.sh'), exec });

    const error = await rejection(
      swarmGit.fetch({ dir: join(root, 'out'), url: 'https://github.com/a/b.git', ref: first, token: 'ghs_secret' }),
    );
    expect(error.kind).toBe('failed');
    expect(error.message).not.toContain('ghs_secret');
    expect(error.detail).toContain('***');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('falls back to the error message when stderr is empty', async () => {
    const { exec } = recording({ when: () => true, stderr: '', error: new Error('spawn git ENOENT') });
    const swarmGit = createSwarmGit({ env: () => ({}), askpass: join(root, 'askpass.sh'), exec });

    const error = await rejection(swarmGit.newestVersion('https://github.com/a/b.git', ''));
    expect(error.detail).toBe('spawn git ENOENT');
  });
});
