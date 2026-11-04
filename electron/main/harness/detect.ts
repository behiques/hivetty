import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';

import type { CliDetection } from '../../shared/cli-contract';
import { HARNESS_IDS, type HarnessId } from '../../shared/harness-contract';
import { probeCommand } from '../config/probe';

/**
 * What HiveTTY finds for each CLI on this machine (HIVE-375).
 *
 * The rules are `integrations/gh.ts`'s: the PATH search is `probeCommand`, the one the command diagnostic uses, so
 * two screens never disagree about the same PATH. The resolved absolute path is what runs, with a constant argv and
 * no shell. The run is bounded, and only the matched version escapes. Async, unlike `gh`'s, because three
 * `spawnSync` calls in a row would block main for up to fifteen seconds.
 */
export const VERSION_TIMEOUT_MS = 5_000;
const MAX_BUFFER = 64 * 1024;
// A pre-release or build suffix may follow, but never ends on punctuation: Copilot prints "CLI 1.0.105.".
const VERSION = /\d+\.\d+\.\d+(?:[\w.+-]*\w)?/;

export type RunVersion = (
  file: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Set when a signal HiveTTY did not send ended the run (a crash, an OOM kill). */
  signal?: string;
}>;

export const runVersion: RunVersion = (file, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      file,
      [...args],
      // SIGKILL because a trapped TERM once blocked main for 20s against a 2s timeout (login-env.ts).
      { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: MAX_BUFFER, encoding: 'utf8', shell: false },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr, timedOut: false });
          return;
        }
        const failed = error as NodeJS.ErrnoException & { killed?: boolean; code?: number | string; signal?: string | null };
        if (failed.killed === true) {
          resolve({ code: null, stdout, stderr, timedOut: true });
          return;
        }
        // Node's message for this one is "Command failed" plus the raw stderr; answer the signal alone instead.
        if (typeof failed.signal === 'string') {
          resolve({ code: null, stdout, stderr, timedOut: false, signal: failed.signal });
          return;
        }
        if (typeof failed.code === 'number') {
          resolve({ code: failed.code, stdout, stderr, timedOut: false });
          return;
        }
        reject(error);
      },
    );
    // execFile forwards no stdio option: closing stdin is how a CLI that reads it gets an EOF.
    child.stdin?.end();
  });

export async function detectCli(command: string, env: NodeJS.ProcessEnv, run: RunVersion): Promise<CliDetection> {
  // D4: sessions type the whole string into a shell; the binary is its first word after any leading NAME=value
  // assignments (the shell's own rule). Those never reach the probe: it runs with a constant argv, no shell.
  const words = command.trim().split(/\s+/);
  while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!)) words.shift();
  let word = words[0] ?? '';
  // Only a leading "~/" is the home directory; the shell would expand it, execFile does not.
  if (word.startsWith('~/')) word = join(homedir(), word.slice(2));
  if (word === '') return { missing: 'No command is configured.' };

  const { resolved } = probeCommand(word, env.PATH ?? '');
  if (resolved === null) {
    return {
      missing: isAbsolute(word) ? `\`${word}\` is not an executable file.` : `\`${word}\` was not found on PATH.`,
    };
  }

  const name = isAbsolute(word) ? basename(word) : word;
  try {
    const out = await run(resolved, ['--version'], VERSION_TIMEOUT_MS);
    if (out.timedOut) {
      return { missing: `\`${name} --version\` did not answer within ${String(VERSION_TIMEOUT_MS / 1000)}s.` };
    }
    if (out.signal !== undefined) return { missing: `\`${name} --version\` was killed by ${out.signal}.` };
    if (out.code !== 0) return { missing: `\`${name} --version\` exited ${String(out.code)}.` };
    return { path: resolved, version: VERSION.exec(out.stdout)?.[0] ?? VERSION.exec(out.stderr)?.[0] ?? null };
  } catch (cause) {
    return { missing: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Codex and Copilot run as their bare names until HIVE-376 adds their command settings (D4). */
const COMMANDS: Record<HarnessId, (claudeCommand: string) => string> = {
  'claude-code': (claudeCommand) => claudeCommand,
  codex: () => 'codex',
  copilot: () => 'copilot',
};

export interface DetectDeps {
  /** The env a session would see, after the login-shell import (D6). */
  env: () => Promise<NodeJS.ProcessEnv>;
  claudeCommand: () => string;
  run?: RunVersion;
}

/** One answer per app run, the `login-env.ts` memo: concurrent callers share it, `rescanClis` drops it. */
let inFlight: Promise<Record<HarnessId, CliDetection>> | null = null;

export function detectClis(deps: DetectDeps): Promise<Record<HarnessId, CliDetection>> {
  if (inFlight !== null) return inFlight;
  const answer = (async () => {
    const env = await deps.env();
    const run = deps.run ?? runVersion;
    const answers = await Promise.all(
      HARNESS_IDS.map((id) => detectCli(COMMANDS[id](deps.claudeCommand()), env, run)),
    );
    return Object.fromEntries(HARNESS_IDS.map((id, index) => [id, answers[index]!])) as Record<
      HarnessId,
      CliDetection
    >;
  })();
  // A failed read (the env, not a CLI: detectCli never throws) is not kept, so the next ask tries again.
  answer.catch(() => {
    if (inFlight === answer) inFlight = null;
  });
  inFlight = answer;
  return answer;
}

export function rescanClis(deps: DetectDeps): Promise<Record<HarnessId, CliDetection>> {
  inFlight = null;
  return detectClis(deps);
}

/** Test seam. */
export function resetCliDetection(): void {
  inFlight = null;
}
