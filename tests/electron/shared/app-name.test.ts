import { describe, expect, it } from 'vitest';

import { APP_NAME } from '@shared/app-name';

describe('APP_NAME', () => {
  /** HIVE-242: one name everywhere, so userData, the Keychain item and the bundle all say it. */
  it('is HiveTTY', () => {
    expect(APP_NAME).toBe('HiveTTY');
  });
});
