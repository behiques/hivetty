import { parseInvocation, type Invocation } from '../core/cli';

export const UPDATE_MESSAGE = 'Update through your package manager or image tag.';

export interface DispatchDeps {
  health(): number;
  oneShot(invocation: Exclude<Invocation, { kind: 'app' | 'update' | 'login' | 'logout' }>): number;
  account(invocation: Extract<Invocation, { kind: 'login' | 'logout' }>): Promise<number>;
  serve(): void;
  print(line: string): void;
}

/** HIVE-422: which flag runs what. The exit code, or `null` when the process stays up to serve. */
export async function dispatch(argv: readonly string[], deps: DispatchDeps): Promise<number | null> {
  // Before the shared parser: `--health` is the server's own flag, and a probe must never start a second server.
  if (argv.slice(2).includes('--health')) return deps.health();
  const invocation = parseInvocation(argv, false);
  switch (invocation.kind) {
    case 'update':
      deps.print(UPDATE_MESSAGE);
      return 2;
    case 'login':
    case 'logout':
      return deps.account(invocation);
    case 'app':
      deps.serve();
      return null;
    default:
      return deps.oneShot(invocation);
  }
}
