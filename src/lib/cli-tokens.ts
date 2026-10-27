import type {
  ClearCliTokenRequest,
  CliTokensState,
  SetCliTokenRequest,
} from '@shared/cli-contract';

/**
 * The renderer's half of the CLI token verbs (HIVE-343). As `slack.ts` does: no bridge is the
 * browser demo and answers `null` silently; a rejected verb answers `null` too, logged once. Every
 * answer is presence only: there is no wrapper that reads a token back, because no channel does.
 */

async function call<T>(
  verb: string,
  run: (bridge: NonNullable<Window['hive']>) => Promise<T>,
): Promise<T | null> {
  const bridge = window.hive;
  if (!bridge) return null;

  try {
    return await run(bridge);
  } catch (cause) {
    console.error(`[hive] cli.${verb} failed:`, cause);
    return null;
  }
}

/** Which CLIs hold a token, and whether one can be stored at all. */
export const cliTokensState = (): Promise<CliTokensState | null> =>
  call('tokensState', (bridge) => bridge.cli.tokensState());

/** Store one CLI's token, replacing what it held. */
export const setCliToken = (request: SetCliTokenRequest): Promise<CliTokensState | null> =>
  call('setToken', (bridge) => bridge.cli.setToken(request));

/** Forget one CLI's token. */
export const clearCliToken = (request: ClearCliTokenRequest): Promise<CliTokensState | null> =>
  call('clearToken', (bridge) => bridge.cli.clearToken(request));
