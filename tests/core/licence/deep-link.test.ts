// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  createDeepLinkRouter,
  findDeepLink,
  installDeepLinks,
  parseCallback,
  parseSwarmInstall,
  redirectUriFor,
  schemeFor,
} from '../../../core/licence/deep-link';

const SCHEMES = ['hivetty', 'hivetty-dev', 'hivetty-local'] as const;
/** Every build paired with each scheme that is not its own. */
const OTHERS = SCHEMES.flatMap((own) => SCHEMES.filter((s) => s !== own).map((other) => [own, other] as const));

describe('schemeFor / redirectUriFor', () => {
  it('names the build channel: release hivetty, release candidate hivetty-dev, unpackaged hivetty-local', () => {
    expect(schemeFor({ isPackaged: true, prerelease: false })).toBe('hivetty');
    expect(schemeFor({ isPackaged: true, prerelease: true })).toBe('hivetty-dev');
    expect(schemeFor({ isPackaged: false, prerelease: false })).toBe('hivetty-local');
    expect(schemeFor({ isPackaged: false, prerelease: true })).toBe('hivetty-local');
    expect(redirectUriFor('hivetty')).toBe('hivetty://auth/callback');
    expect(redirectUriFor('hivetty-local')).toBe('hivetty-local://auth/callback');
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

  it.each(OTHERS)('a %s build drops a %s callback', (own, other) => {
    expect(parseCallback(`${other}://auth/callback?code=x&state=y`, own)).toBeNull();
  });

  it.each([
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

describe('parseSwarmInstall', () => {
  it.each([
    ['the packaged scheme', 'hivetty://swarms/install?id=a1_B-9', 'hivetty', 'a1_B-9'],
    ['the release candidate scheme', 'hivetty-dev://swarms/install?id=x', 'hivetty-dev', 'x'],
    ['the local scheme', 'hivetty-local://swarms/install?id=x', 'hivetty-local', 'x'],
  ] as const)('accepts %s', (_name, url, scheme, swarmId) => {
    expect(parseSwarmInstall(url, scheme)).toEqual({ swarmId });
  });

  it.each(OTHERS)('a %s build drops a %s install link', (own, other) => {
    expect(parseSwarmInstall(`${other}://swarms/install?id=x`, own)).toBeNull();
  });

  it.each([
    ['https', 'https://swarms/install?id=x', 'hivetty'],
    ['host swarm', 'hivetty://swarm/install?id=x', 'hivetty'],
    ['host auth', 'hivetty://auth/install?id=x', 'hivetty'],
    ['a trailing slash', 'hivetty://swarms/install/?id=x', 'hivetty'],
    ['a longer path', 'hivetty://swarms/install/x?id=x', 'hivetty'],
    ['another path', 'hivetty://swarms/remove?id=x', 'hivetty'],
    ['no path', 'hivetty://swarms?id=x', 'hivetty'],
    ['a port', 'hivetty://swarms:80/install?id=x', 'hivetty'],
    ['a user and password', 'hivetty://u:p@swarms/install?id=x', 'hivetty'],
    ['a fragment', 'hivetty://swarms/install?id=x#frag', 'hivetty'],
    ['no id', 'hivetty://swarms/install', 'hivetty'],
    ['an empty id', 'hivetty://swarms/install?id=', 'hivetty'],
    ['a path in the id', 'hivetty://swarms/install?id=../x', 'hivetty'],
    ['an encoded slash in the id', 'hivetty://swarms/install?id=a%2Fb', 'hivetty'],
    ['a 65-character id', `hivetty://swarms/install?id=${'a'.repeat(65)}`, 'hivetty'],
    ['a repeated id', 'hivetty://swarms/install?id=x&id=y', 'hivetty'],
    ['another parameter', 'hivetty://swarms/install?id=x&repoUrl=https://evil', 'hivetty'],
    ['not a URL', 'not a url', 'hivetty'],
    ['the sign-in callback', 'hivetty://auth/callback?code=x&state=y', 'hivetty'],
  ] as const)('drops %s', (_name, url, scheme) => {
    expect(parseSwarmInstall(url, scheme)).toBeNull();
  });

  it('leaves parseCallback dropping a swarm link', () => {
    expect(parseCallback('hivetty://swarms/install?id=x', 'hivetty')).toBeNull();
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

function fakeApp(isPackaged: boolean, version = '1.0.0') {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    isPackaged,
    getVersion: () => version,
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

  it.each([
    ['a release', '1.0.0', 'hivetty'],
    ['a release candidate', '1.0.0-rc.13', 'hivetty-dev'],
  ])('claims its own scheme at launch when packaged: %s takes %s back from any earlier owner', (_name, version, scheme) => {
    const app = fakeApp(true, version);
    const links = installDeepLinks({ app: app as never, execPath: '/x', argv1: 'out/main/index.js' });
    expect(app.setAsDefaultProtocolClient.mock.calls).toEqual([[scheme]]);
    expect(links.scheme).toBe(scheme);
  });

  it('registers hivetty-local, and only that, with the resolved entry script when unpackaged', () => {
    const app = fakeApp(false);
    const links = installDeepLinks({ app: app as never, execPath: '/electron', argv1: 'out/main/index.js' });
    expect(app.setAsDefaultProtocolClient.mock.calls).toEqual([
      ['hivetty-local', '/electron', [expect.stringMatching(/\/out\/main\/index\.js$/)]],
    ]);
    expect(links.scheme).toBe('hivetty-local');
  });

  it('registers hivetty-local with no args when there is no entry script', () => {
    const app = fakeApp(false);
    installDeepLinks({ app: app as never, execPath: '/electron' });
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('hivetty-local', '/electron', []);
  });
});
