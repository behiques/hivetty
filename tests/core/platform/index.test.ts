import { afterEach, describe, expect, it } from 'vitest';

import { platform, resetPlatform, setPlatform, type Platform } from '../../../core/platform';

const fake = (): Platform => ({
  secrets: {
    isEncryptionAvailable: () => false,
    encryptString: (text) => Buffer.from(text),
    decryptString: (data) => data.toString(),
  },
  paths: { stateDir: '/state', logsDir: '/logs' },
  notify: () => undefined,
  processHost: () => {
    throw new Error('not in this test');
  },
  mcpLaunch: { command: '/node', args: ['/mcp-host.js'], env: {} },
  lifecycle: { version: '0.0.0', isPackaged: false, quit: () => undefined },
});

describe('the platform holder (HIVE-422)', () => {
  afterEach(() => {
    resetPlatform();
  });

  it('throws by name when the shell has not set a platform', () => {
    expect(() => platform()).toThrow('No platform is set');
  });

  it('returns what setPlatform was last given', () => {
    const first = fake();
    const second = fake();
    setPlatform(first);
    expect(platform()).toBe(first);
    setPlatform(second);
    expect(platform()).toBe(second);
  });

  it('throws again after resetPlatform', () => {
    setPlatform(fake());
    resetPlatform();
    expect(() => platform()).toThrow('No platform is set');
  });
});
