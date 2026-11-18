import { describe, expect, it } from 'vitest';

import { hiveServerSpec } from '../../../core/mcp/config';

describe('hiveServerSpec (HIVE-422)', () => {
  it("is the shell's launch, exactly, with nothing of Electron's added", () => {
    expect(hiveServerSpec({ command: '/n', args: ['/s.js'], env: {} })).toEqual({
      command: '/n',
      args: ['/s.js'],
      env: {},
    });
  });
});
