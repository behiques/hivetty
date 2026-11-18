import { describe, expect, it } from 'vitest';

import { splashEnabled } from '../../../core/ipc/splash-enabled';

describe('splashEnabled', () => {
  it('is on for an ordinary launch', () => {
    expect(splashEnabled({})).toBe(true);
  });

  it('is off under the e2e suite, which sets HIVE_E2E', () => {
    expect(splashEnabled({ HIVE_E2E: '1' })).toBe(false);
  });

  it('treats an empty HIVE_E2E as absent, so a spec can opt back in', () => {
    expect(splashEnabled({ HIVE_E2E: '' })).toBe(true);
  });
});
