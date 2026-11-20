// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { routeDeepLink } from '../../../electron/main/swarm-link';

const routes = () => ({
  scheme: 'hivetty' as const,
  handleCallback: vi.fn(),
  requestInstall: vi.fn(),
  focus: vi.fn(),
});

describe('routeDeepLink (HIVE-442)', () => {
  it('holds a swarm install link in core and brings the window forward, never the sign-in callback', () => {
    const deps = routes();
    routeDeepLink('hivetty://swarms/install?id=a1', deps);
    expect(deps.requestInstall).toHaveBeenCalledTimes(1);
    expect(deps.requestInstall).toHaveBeenCalledWith('a1');
    expect(deps.focus).toHaveBeenCalledTimes(1);
    expect(deps.handleCallback).not.toHaveBeenCalled();
  });

  it.each([
    ['the sign-in callback', 'hivetty://auth/callback?code=c&state=s'],
    ['a malformed swarm link', 'hivetty://swarms/install?id=../x'],
    ['the release candidate scheme in a packaged release', 'hivetty-dev://swarms/install?id=a1'],
    ['garbage', 'garbage'],
  ])('hands %s to the sign-in callback exactly as before', (_name, url) => {
    const deps = routes();
    routeDeepLink(url, deps);
    expect(deps.handleCallback).toHaveBeenCalledTimes(1);
    expect(deps.handleCallback).toHaveBeenCalledWith(url);
    expect(deps.requestInstall).not.toHaveBeenCalled();
    expect(deps.focus).not.toHaveBeenCalled();
  });
});
