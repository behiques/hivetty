import { describe, expect, it } from 'vitest';

import { hookEntry, toml, tomlList, tomlTable } from '../../../../../electron/main/harness/codex/toml';

describe('codex toml (HIVE-279)', () => {
  it('writes TOML basic strings TOML accepts', () => {
    expect(toml('a"b')).toBe('"a\\"b"');
    expect(toml('\u007f')).toBe('"\\u007f"');
    expect(toml('\uD800x')).toBe('"�x"');
  });

  it('writes lists and inline tables of strings', () => {
    expect(tomlList(['a', 'b"'])).toBe('["a","b\\""]');
    expect(tomlTable({ K: 'v' })).toBe('{"K"="v"}');
  });

  it('builds one hook event entry, with and without a matcher', () => {
    expect(hookEntry('Stop', 'run')).toBe('hooks.Stop=[{hooks=[{type="command",command="run"}]}]');
    expect(hookEntry('PostToolUse', 'run', '*')).toBe(
      'hooks.PostToolUse=[{matcher="*",hooks=[{type="command",command="run"}]}]',
    );
  });
});
