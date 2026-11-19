/**
 * Git for swarms (HIVE-441): fetch one commit or tag into a fresh repository,
 * and find a repository's newest released version.
 *
 * One runner, so every call fails fast and the same way: no prompt, English
 * messages for the classifier, a timeout, and a token only where one is
 * handed in. The token rides the child's environment for that one command and
 * is answered by a fixed askpass script. It is never in a URL, in
 * `.git/config`, in a message or in a file.
 */
import { execFile } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { compareVersions, parseSwarmTag } from '@shared/swarm-contract';

export type GitFailureKind = 'no_access' | 'offline' | 'failed';

export class GitError extends Error {
  readonly kind: GitFailureKind;
  readonly detail: string;

  constructor(kind: GitFailureKind, detail: string) {
    super(`${kind}: ${detail}`);
    this.kind = kind;
    this.detail = detail;
    this.name = 'GitError';
  }
}

export type Exec = (
  file: string,
  args: string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv },
  done: (error: Error | null, stdout: string, stderr: string) => void,
) => { kill(): unknown };

export interface GitDeps {
  /** The environment Git runs in: the app passes what its sessions get. */
  env: () => NodeJS.ProcessEnv;
  /** Where the askpass script is written, `swarmPaths().askpass`. */
  askpass: string;
  exec?: Exec;
}

export interface SwarmGit {
  /** Leaves `dir` checked out at `ref` (a commit, or `refs/tags/<tag>`) and answers the commit. */
  fetch(input: { dir: string; url: string; ref: string; token?: string }): Promise<string>;
  newestVersion(url: string, folder: string): Promise<string | null>;
}

export const FETCH_TIMEOUT_MS = 60_000;
export const LS_REMOTE_TIMEOUT_MS = 20_000;

/** Answers Git's two prompts. Holds no secret: the token is in the environment of the one command that needs it. */
export const ASKPASS_SCRIPT = `#!/bin/sh
case "$1" in
  Username*) printf '%s\\n' x-access-token ;;
  *) printf '%s\\n' "$HIVE_SWARM_TOKEN" ;;
esac
`;

const NO_ACCESS =
  /authentication failed|permission denied|repository not found|could not read username|terminal prompts disabled|returned error: 40[13]|access denied|host key verification failed|could not read from remote repository/i;
const OFFLINE =
  /could not resolve host|failed to connect|network is unreachable|connection timed out|connection refused|operation timed out/i;

export function classifyGit(stderr: string): GitFailureKind {
  // Offline first: ssh prints "Could not resolve hostname" and then "Could not read from remote repository".
  if (OFFLINE.test(stderr)) return 'offline';
  if (NO_ACCESS.test(stderr)) return 'no_access';
  return 'failed';
}

const COMMIT = /^[0-9a-f]{40}$/;
const tail = (text: string): string => text.trim().split('\n').slice(-3).join('\n');

export function createSwarmGit(deps: GitDeps): SwarmGit {
  const exec = deps.exec ?? (execFile as unknown as Exec);

  const run = (args: string[], options: { cwd?: string; timeoutMs: number; token?: string }): Promise<string> => {
    const env: NodeJS.ProcessEnv = { ...deps.env(), GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
    let full = args;
    const { token } = options;
    if (token !== undefined) {
      env['GIT_ASKPASS'] = deps.askpass;
      env['HIVE_SWARM_TOKEN'] = token;
      // No helper is asked, and none may store the token: macOS's keychain helper would, after a fetch that worked.
      full = ['-c', 'credential.helper=', ...args];
    }
    const clean = (text: string): string => (token === undefined ? text : text.split(token).join('***'));

    return new Promise((resolve, reject) => {
      let timedOut = false;
      // Started before the call: an injected `exec` may answer before it returns, and the
      // timer only reads `child` when it fires, by which time `child` is set.
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, options.timeoutMs);
      const child = exec('git', full, { cwd: options.cwd, env }, (error, stdout, stderr) => {
        clearTimeout(timer);
        if (error === null) {
          resolve(stdout.trim());
          return;
        }
        if (timedOut) {
          reject(new GitError('failed', `Git did not finish within ${String(options.timeoutMs / 1000)} seconds.`));
          return;
        }
        reject(new GitError(classifyGit(stderr), clean(tail(stderr) || error.message)));
      });
    });
  };

  return {
    async fetch({ dir, url, ref, token }) {
      // A ref is a commit or a full tag ref, so it can never read as an option.
      if (!COMMIT.test(ref) && !ref.startsWith('refs/tags/')) {
        throw new GitError('failed', 'Not a commit or a tag.');
      }
      if (token !== undefined) {
        await mkdir(dirname(deps.askpass), { recursive: true });
        await writeFile(deps.askpass, ASKPASS_SCRIPT);
        await chmod(deps.askpass, 0o700);
      }
      await mkdir(dir, { recursive: true });
      const at = { cwd: dir, timeoutMs: FETCH_TIMEOUT_MS };
      await run(['init', '--quiet'], at);
      await run(['remote', 'add', '--', 'origin', url], at);
      await run(['fetch', '--quiet', '--depth', '1', '--', 'origin', ref], { ...at, token });
      await run(['checkout', '--quiet', '--detach', 'FETCH_HEAD'], at);
      return run(['rev-parse', 'HEAD'], at);
    },

    async newestVersion(url, folder) {
      const out = await run(['ls-remote', '--tags', '--', url], { timeoutMs: LS_REMOTE_TIMEOUT_MS });
      let best: string | null = null;
      for (const line of out.split('\n')) {
        // `<hash>\trefs/tags/standard/v1.0.1`, and `…^{}` again for an annotated tag.
        const name = line
          .split('\t')[1]
          ?.replace(/^refs\/tags\//, '')
          .replace(/\^\{\}$/, '');
        const parsed = name === undefined ? null : parseSwarmTag(name);
        if (parsed === null || parsed.folder !== folder) continue;
        if (best === null || compareVersions(parsed.version, best) > 0) best = parsed.version;
      }
      return best;
    },
  };
}
