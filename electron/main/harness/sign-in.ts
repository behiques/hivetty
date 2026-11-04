import type { CliSignIn } from '../../shared/cli-contract';
import type { HarnessId } from '../../shared/harness-contract';
import { probeCommand } from '../config/probe';

import { commandWord, runVersion, VERSION_TIMEOUT_MS, type RunVersion } from './detect';

export interface SignInDeps {
  /** What HiveTTY runs for the CLI, `cliCommand`. Only its first word is run. */
  command: string;
  env: NodeJS.ProcessEnv;
  run?: RunVersion;
  /** Copilot only: the gh login, as `readGhStatus` reads it. */
  gh?: () => { installed: boolean; authenticated: boolean; account: string | null };
}

const ARGS = { 'claude-code': ['auth', 'status'], codex: ['login', 'status'] } as const;
const VERB = { 'claude-code': 'claude auth status', codex: 'codex login status' } as const;
const FIX = { 'claude-code': 'claude auth login', codex: 'codex login' } as const;
const out = (cli: 'claude-code' | 'codex'): CliSignIn => ({ state: 'out', label: 'Not signed in', fix: FIX[cli] });

/**
 * Whether a CLI is signed in, as its own status verb says (HIVE-376). The `detect.ts` rules: no shell, a bounded
 * run, and only a label escapes. Never the raw output, which for Codex can carry a key's tail.
 */
export async function readSignIn(cli: HarnessId, deps: SignInDeps): Promise<CliSignIn> {
  if (cli === 'copilot') return copilot(deps);
  const word = commandWord(deps.command);
  const { resolved } = probeCommand(word, deps.env.PATH ?? '');
  if (resolved === null) return { state: 'unknown', label: `\`${word}\` was not found.` };
  try {
    const answer = await (deps.run ?? runVersion)(resolved, [...ARGS[cli]], VERSION_TIMEOUT_MS);
    if (answer.timedOut) {
      return {
        state: 'unknown',
        label: `\`${VERB[cli]}\` did not answer within ${String(VERSION_TIMEOUT_MS / 1000)}s.`,
      };
    }
    return cli === 'codex' ? codex(answer.code, answer.stdout) : claude(answer.stdout);
  } catch {
    return { state: 'unknown', label: `\`${VERB[cli]}\` could not run.` };
  }
}

function claude(stdout: string): CliSignIn {
  let status: { loggedIn?: unknown; email?: unknown; subscriptionType?: unknown };
  try {
    status = JSON.parse(stdout) as typeof status;
  } catch {
    return { state: 'unknown', label: "Couldn't read `claude auth status`." };
  }
  if (status.loggedIn !== true) return out('claude-code');
  const email = typeof status.email === 'string' && status.email !== '' ? status.email : 'Signed in';
  const plan =
    typeof status.subscriptionType === 'string' && status.subscriptionType !== ''
      ? ` · ${status.subscriptionType.charAt(0).toUpperCase()}${status.subscriptionType.slice(1)} plan`
      : '';
  return { state: 'in', label: `${email}${plan}` };
}

/** Exit 0 is signed in. The label is a fixed mapping, never the raw line: Codex's API-key line ends in the key's tail. */
function codex(code: number | null, stdout: string): CliSignIn {
  if (code !== 0) return out('codex');
  if (/chatgpt/i.test(stdout)) return { state: 'in', label: 'Signed in with ChatGPT' };
  if (/api key/i.test(stdout)) return { state: 'in', label: 'Signed in with an API key' };
  return { state: 'in', label: 'Signed in' };
}

/** Copilot sessions sign in through the gh login; agents use the stored token instead. */
function copilot(deps: SignInDeps): CliSignIn {
  const gh = deps.gh?.();
  if (gh === undefined || !gh.installed) {
    return { state: 'unknown', label: '`gh` was not found, so the GitHub login cannot be read.' };
  }
  if (!gh.authenticated) return { state: 'out', label: 'Not signed in to GitHub', fix: 'gh auth login' };
  return { state: 'in', label: gh.account === null ? 'Signed in to GitHub' : `GitHub: ${gh.account}` };
}
