// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { IS_RELEASE, VERSION } from '../../server/release';

describe('the release constants (HIVE-422)', () => {
  it('are the unit suite defines: not a release, a test version', () => {
    expect(IS_RELEASE).toBe(false);
    expect(VERSION).toBe('0.0.0-test');
  });
});
