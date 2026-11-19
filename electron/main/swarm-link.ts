import { parseSwarmInstall, type Scheme } from '../../core/licence/deep-link';

export interface DeepLinkRoutes {
  scheme: Scheme;
  handleCallback: (url: string) => void;
  requestInstall: (swarmId: string) => void;
  focus: () => void;
}

/** One router, two kinds of link (HIVE-442): a swarm install link, else the sign-in callback, which drops the rest. */
export function routeDeepLink(url: string, routes: DeepLinkRoutes): void {
  const install = parseSwarmInstall(url, routes.scheme);
  if (install === null) {
    routes.handleCallback(url);
    return;
  }
  routes.requestInstall(install.swarmId);
  routes.focus();
}
