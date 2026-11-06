// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  createDeepLinkRouter,
  findDeepLink,
  installDeepLinks,
  parseCallback,
  redirectUriFor,
  schemeFor,
} from '../../../../electron/main/licence/deep-link';

describe('schemeFor / redirectUriFor', () => {
  it('gives packaged builds hivetty and dev builds hivetty-dev', () => {
    expect(schemeFor(true)).toBe('hivetty');
    expect(schemeFor(false)).toBe('hivetty-dev');
    expect(redirectUriFor('hivetty')).toBe('hivetty://auth/callback');
    expect(redirectUriFor('hivetty-dev')).toBe('hivetty-dev://auth/callback');
  });
});

describe('parseCallback', () => {
  it('accepts the callback with code and state', () => {
    expect(parseCallback('hivetty://auth/callback?code=x&state=y', 'hivetty')).toEqual({ code: 'x', state: 'y' });
    expect(parseCallback('hivetty-dev://auth/callback?state=y&code=x', 'hivetty-dev')).toEqual({
      code: 'x',
      state: 'y',
    });
  });

  it.each([
    ['a dev build handed the packaged scheme', 'hivetty://auth/callback?code=x&state=y', 'hivetty-dev'],
    ['the packaged build handed the dev scheme', 'hivetty-dev://auth/callback?code=x&state=y', 'hivetty'],
    ['another host', 'hivetty://evil/callback?code=x&state=y', 'hivetty'],
    ['another path', 'hivetty://auth/other?code=x&state=y', 'hivetty'],
    ['a port', 'hivetty://auth:1/callback?code=x&state=y', 'hivetty'],
    ['no code', 'hivetty://auth/callback?state=y', 'hivetty'],
    ['no state', 'hivetty://auth/callback?code=x', 'hivetty'],
    ['not a URL', 'not a url', 'hivetty'],
    ['https', 'https://auth/callback?code=x&state=y', 'hivetty'],
  ] as const)('drops %s', (_name, url, scheme) => {
    expect(parseCallback(url, scheme)).toBeNull();
  });
});

describe('findDeepLink', () => {
  it('finds the first argv entry in this build scheme only', () => {
    const argv = ['/app', '--flag', 'hivetty-dev://auth/callback?code=x&state=y', 'hivetty://a'];
    expect(findDeepLink(argv, 'hivetty-dev')).toBe('hivetty-dev://auth/callback?code=x&state=y');
    expect(findDeepLink(argv, 'hivetty')).toBe('hivetty://a');
    expect(findDeepLink(['/app'], 'hivetty')).toBeNull();
  });
});

describe('createDeepLinkRouter', () => {
  it('holds links until attached, then replays them in order', () => {
    const router = createDeepLinkRouter('hivetty');
    router.deliver('hivetty://1');
    router.deliver('hivetty://2');
    const handler = vi.fn();
    router.attach(handler);
    expect(handler.mock.calls).toEqual([['hivetty://1'], ['hivetty://2']]);
    router.deliver('hivetty://3');
    expect(handler).toHaveBeenLastCalledWith('hivetty://3');
  });

  it('keeps only the last five held links', () => {
    const router = createDeepLinkRouter('hivetty');
    for (let i = 1; i <= 7; i += 1) router.deliver(`hivetty://${String(i)}`);
    const handler = vi.fn();
    router.attach(handler);
    expect(handler.mock.calls.map(([url]) => url)).toEqual([
      'hivetty://3', 'hivetty://4', 'hivetty://5', 'hivetty://6', 'hivetty://7',
    ]);
  });

  it('delivers the deep link found in a second instance argv, and nothing when there is none', () => {
    const router = createDeepLinkRouter('hivetty');
    const handler = vi.fn();
    router.attach(handler);
    router.deliverArgv(['/app', 'hivetty://auth/callback?code=x&state=y']);
    router.deliverArgv(['/app']);
    expect(handler.mock.calls).toEqual([['hivetty://auth/callback?code=x&state=y']]);
  });
});

function fakeApp(isPackaged: boolean) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    isPackaged,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler)),
    setAsDefaultProtocolClient: vi.fn(() => true),
    fire: (event: string, ...args: unknown[]) => handlers.get(event)?.(...args),
  };
}

describe('installDeepLinks', () => {
  it('listens for open-url inside will-finish-launching, so a cold start link is seen', () => {
    const app = fakeApp(true);
    const links = installDeepLinks({ app: app as never, execPath: '/x' });
    expect(app.on).toHaveBeenCalledTimes(1);
    expect(app.on).toHaveBeenCalledWith('will-finish-launching', expect.any(Function));

    app.fire('will-finish-launching');
    const preventDefault = vi.fn();
    app.fire('open-url', { preventDefault }, 'hivetty://auth/callback?code=x&state=y');

    const handler = vi.fn();
    links.attach(handler);
    expect(preventDefault).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith('hivetty://auth/callback?code=x&state=y');
    expect(links.scheme).toBe('hivetty');
  });

  it('registers nothing at runtime when packaged: Info.plist owns hivetty', () => {
    const app = fakeApp(true);
    installDeepLinks({ app: app as never, execPath: '/x', argv1: 'out/main/index.js' });
    expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
  });

  it('registers hivetty-dev with the resolved entry script when unpackaged', () => {
    const app = fakeApp(false);
    const links = installDeepLinks({ app: app as never, execPath: '/electron', argv1: 'out/main/index.js' });
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('hivetty-dev', '/electron', [
      expect.stringMatching(/\/out\/main\/index\.js$/),
    ]);
    expect(links.scheme).toBe('hivetty-dev');
  });

  it('registers hivetty-dev with no args when there is no entry script', () => {
    const app = fakeApp(false);
    installDeepLinks({ app: app as never, execPath: '/electron' });
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('hivetty-dev', '/electron', []);
  });
});
