// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  DEV_CLOUD_URL,
  PROD_CLOUD_URL,
  resolveCloudUrl,
} from '../../../../electron/main/licence/cloud';

describe('resolveCloudUrl', () => {
  it('uses the prod cloud when packaged and the dev cloud when not', () => {
    expect(resolveCloudUrl({ isPackaged: true, env: {} })).toBe(PROD_CLOUD_URL);
    expect(resolveCloudUrl({ isPackaged: false, env: {} })).toBe(DEV_CLOUD_URL);
    expect(PROD_CLOUD_URL).toBe('https://api.hivetty.dev');
    expect(DEV_CLOUD_URL).toBe('https://api.dev.hivetty.dev');
  });

  it('lets account.cloudUrl override either build, for self-hosted Enterprise', () => {
    expect(resolveCloudUrl({ isPackaged: true, configUrl: 'https://hive.acme.test', env: {} })).toBe(
      'https://hive.acme.test',
    );
  });

  it('honours HIVETTY_CLOUD_URL only when unpackaged', () => {
    const env = { HIVETTY_CLOUD_URL: 'http://127.0.0.1:4010' };
    expect(resolveCloudUrl({ isPackaged: false, env })).toBe('http://127.0.0.1:4010');
    expect(resolveCloudUrl({ isPackaged: true, env })).toBe(PROD_CLOUD_URL);
  });

  it('prefers the config key over the env var', () => {
    expect(
      resolveCloudUrl({
        isPackaged: false,
        configUrl: 'https://hive.acme.test',
        env: { HIVETTY_CLOUD_URL: 'http://127.0.0.1:4010' },
      }),
    ).toBe('https://hive.acme.test');
  });

  it('strips trailing slashes', () => {
    expect(resolveCloudUrl({ isPackaged: true, configUrl: 'https://hive.acme.test//', env: {} })).toBe(
      'https://hive.acme.test',
    );
  });
});
