// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { SEED_MANIFEST_FILE } from '../../../core/seed/paths';

describe('SEED_MANIFEST_FILE', () => {
  it('keeps the manifest a dotfile beside config.json', () => {
    expect(SEED_MANIFEST_FILE).toBe('.seed.json');
  });
});
