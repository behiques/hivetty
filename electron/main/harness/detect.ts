import { execFile } from 'node:child_process';
import { basename, isAbsolute } from 'node:path';

import type { CliDetection } from '../../shared/cli-contract';
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
const VERSION = /\d+\.\d+\.\d+[\w.+-]*/;

export type RunVersion = (
  file: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>;

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
        const failed = error as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
        if (failed.killed === true) {
          resolve({ code: null, stdout, stderr, timedOut: true });
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
  // D4: sessions type the whole string into a shell; the binary is its first word.
  const word = command.trim().split(/\s+/)[0] ?? '';
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
    if (out.code !== 0) return { missing: `\`${name} --version\` exited ${String(out.code)}.` };
    return { path: resolved, version: VERSION.exec(out.stdout)?.[0] ?? VERSION.exec(out.stderr)?.[0] ?? null };
  } catch (cause) {
    return { missing: cause instanceof Error ? cause.message : String(cause) };
  }
}
