import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectClis, lastCliDetection, rescanClis, resetCliDetectionCache } from '@lib/cli-detection';

const found = {
  'claude-code': { path: '/bin/claude', version: '1.0.0' },
  codex: { missing: 'x' },
  copilot: { missing: 'y' },
};

const bridge = (cli: object) => {
  (window as unknown as { hive: unknown }).hive = { cli };
};

afterEach(() => {
  resetCliDetectionCache();
  delete (window as unknown as { hive?: unknown }).hive;
  vi.restoreAllMocks();
});

describe('cli-detection (HIVE-375)', () => {
  it('answers null with no bridge (the browser target, D10)', async () => {
    expect(lastCliDetection()).toBeUndefined();
    await expect(detectClis()).resolves.toBeNull();
    expect(lastCliDetection()).toBeNull();
  });

  it('shares one read, keeps the answer, and rescans through its own verb', async () => {
    const detect = vi.fn(async () => found);
    const rescan = vi.fn(async () => found);
    bridge({ detect, rescan });

    await Promise.all([detectClis(), detectClis()]);
    expect(detect).toHaveBeenCalledTimes(1);
    expect(lastCliDetection()).toEqual(found);
    await rescanClis();
    expect(rescan).toHaveBeenCalledTimes(1);
  });

  it('answers null and logs when the call rejects', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    bridge({ detect: vi.fn().mockRejectedValue(new Error('gone')) });
    await expect(detectClis()).resolves.toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
