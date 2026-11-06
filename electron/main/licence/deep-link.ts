/**
 * The `hivetty://` deep link (HIVE-264). Packaged builds own `hivetty` (Info.plist, through
 * electron-builder's `protocols`); unpackaged builds register `hivetty-dev` at runtime, so a dev build
 * never steals the installed app's links. The free HiveTTY never registers either.
 */

export type Scheme = 'hivetty' | 'hivetty-dev';

export const schemeFor = (isPackaged: boolean): Scheme => (isPackaged ? 'hivetty' : 'hivetty-dev');

export const redirectUriFor = (scheme: Scheme): string => `${scheme}://auth/callback`;

/** Only `<scheme>://auth/callback?code&state`; anything else is dropped. */
export function parseCallback(url: string, scheme: Scheme): { code: string; state: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${scheme}:` || parsed.host !== 'auth' || parsed.pathname !== '/callback') return null;
  const code = parsed.searchParams.get('code');
  const state = parsed.searchParams.get('state');
  return code && state ? { code, state } : null;
}

export function findDeepLink(argv: readonly string[], scheme: Scheme): string | null {
  return argv.find((arg) => arg.startsWith(`${scheme}://`)) ?? null;
}

export interface DeepLinkRouter {
  deliver(url: string): void;
  /** `second-instance` hands argv over; Windows and Linux carry the link there (macOS uses `open-url`). */
  deliverArgv(argv: readonly string[]): void;
  attach(handler: (url: string) => void): void;
}

const MAX_HELD = 5;

/** Links can arrive (`open-url` on a cold start) before `whenReady`, when there is no client to take them. */
export function createDeepLinkRouter(scheme: Scheme): DeepLinkRouter {
  let handler: ((url: string) => void) | null = null;
  const held: string[] = [];
  const deliver = (url: string): void => {
    if (handler) {
      handler(url);
      return;
    }
    held.push(url);
    if (held.length > MAX_HELD) held.shift();
  };
  return {
    deliver,
    deliverArgv(argv) {
      const url = findDeepLink(argv, scheme);
      if (url) deliver(url);
    },
    attach(next) {
      handler = next;
      for (const url of held.splice(0)) next(url);
    },
  };
}
