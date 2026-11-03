// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { CAPABILITIES, HARNESS_IDS, isHarnessId } from '../../../electron/shared/harness-contract';

describe('isHarnessId (HIVE-340)', () => {
  it('accepts every id the app can drive', () => {
    for (const id of HARNESS_IDS) expect(isHarnessId(id)).toBe(true);
  });

  it('knows codex (HIVE-342)', () => {
    expect(isHarnessId('codex')).toBe(true);
  });

  it('knows copilot (HIVE-343)', () => {
    expect(isHarnessId('copilot')).toBe(true);
  });

  it('refuses a CLI with no adapter yet, and a near-miss spelling', () => {
    expect(isHarnessId('gemini')).toBe(false);
    expect(isHarnessId('claude')).toBe(false);
  });
});

describe('CAPABILITIES', () => {
  it('has a table for every CLI', () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual([...HARNESS_IDS].sort());
  });
});

describe('skills vocabulary (HIVE-369)', () => {
  it('gives each CLI its prefixes', () => {
    expect(CAPABILITIES['claude-code'].skills).toEqual({
      toolPrefix: 'mcp__hive__',
      refPrefix: 'hive:',
      typedPrefix: '/hive:',
      namePrefix: '',
      pluginRoot: '$CLAUDE_PLUGIN_ROOT',
    });
    expect(CAPABILITIES.codex.skills).toEqual({
      toolPrefix: 'mcp__hive__',
      refPrefix: '$hive-',
      typedPrefix: '$hive-',
      namePrefix: 'hive-',
      pluginRoot: null,
    });
    expect(CAPABILITIES.copilot.skills).toEqual({
      toolPrefix: 'hive-',
      refPrefix: '/hive:hive-',
      typedPrefix: '/hive:hive-',
      namePrefix: 'hive-',
      pluginRoot: null,
    });
  });
});

describe('context delivery', () => {
  it('delivers markers to every CLI (HIVE-362, HIVE-360)', () => {
    expect(CAPABILITIES['claude-code'].contextDelivery).toBe('prompt-marker');
    expect(CAPABILITIES.copilot.contextDelivery).toBe('prompt-marker');
    expect(CAPABILITIES.codex.contextDelivery).toBe('prompt-marker');
  });
});
