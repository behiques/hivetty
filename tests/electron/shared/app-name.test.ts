import { describe, expect, it } from 'vitest';

import { APP_NAME, DEV_USER_DATA_NAME } from '@shared/app-name';

describe('APP_NAME', () => {
  /** HIVE-242: one name everywhere, so userData, the Keychain item and the bundle all say it. */
  it('is HiveTTY', () => {
    expect(APP_NAME).toBe('HiveTTY');
  });
});

describe('DEV_USER_DATA_NAME', () => {
  /**
   * APFS is case-insensitive by default, so `hivetty` and `HiveTTY` are one
   * folder: a dev run would share the packaged app's single-instance lock and state.
   */
  it('differs from the packaged userData name even ignoring case', () => {
    expect(DEV_USER_DATA_NAME.toLowerCase()).not.toBe(APP_NAME.toLowerCase());
  });
});
