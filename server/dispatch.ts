import { parseInvocation, type Invocation } from '../core/cli';

import { KEY_EXIT, type KeyResult } from './secrets/key';

export const UPDATE_MESSAGE = 'Update through your package manager or image tag.';

export interface DispatchDeps {
  health(): number;
  genKey(): string;
  /** Loaded once, before dispatch (HIVE-424). Only signing in, signing out and serving need it. */
  key: KeyResult;
  oneShot(invocation: Exclude<Invocation, { kind: 'app' | 'update' | 'login' | 'logout' }>): number;
  account(invocation: Extract<Invocation, { kind: 'login' | 'logout' }>, key: Buffer): Promise<number>;
  serve(key: Buffer): void;
  print(line: string): void;
}

/** HIVE-422: which flag runs what. The exit code, or `null` when the process stays up to serve. */
export async function dispatch(argv: readonly string[], deps: DispatchDeps): Promise<number | null> {
  const flags = argv.slice(2);
  // Before the shared parser: `--health` is the server's own flag, and a probe must never start a second server.
  if (flags.includes('--health')) return deps.health();
  if (flags.includes('--gen-key')) {
    deps.print(deps.genKey());
    return 0;
  }
  const invocation = parseInvocation(argv, false);
  switch (invocation.kind) {
    case 'update':
      deps.print(UPDATE_MESSAGE);
      return 2;
    case 'login':
    case 'logout':
    case 'app':
      // No key, no boot (HIVE-424): there is no plaintext fallback, so nothing that stores a credential starts.
      if (!deps.key.ok) {
        deps.print(deps.key.message);
        return KEY_EXIT;
      }
      if (invocation.kind === 'app') {
        deps.serve(deps.key.key);
        return null;
      }
      return deps.account(invocation, deps.key.key);
    default:
      return deps.oneShot(invocation);
  }
}
