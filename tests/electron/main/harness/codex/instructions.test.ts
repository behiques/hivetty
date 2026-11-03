// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { codexDeveloperInstructions } from '../../../../../electron/main/harness/codex/instructions';

const CATALOG = '### HiveTTY skills\nSkills like the ones above.\n- done: Finish. (file: /p/skills/done/SKILL.md)\n';

describe('codexDeveloperInstructions (HIVE-360)', () => {
  let root: string;
  let plugin: string;
  let home: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'codex-instr-'));
    plugin = join(root, 'plugins', 'codex');
    home = join(root, 'home');
    mkdirSync(plugin, { recursive: true });
    mkdirSync(home);
  });
  const catalog = () => writeFileSync(join(plugin, 'catalog.md'), CATALOG);
  const config = (text: string) => writeFileSync(join(home, 'config.toml'), text);

  it('is the catalog alone when the user sets nothing', () => {
    catalog();
    expect(codexDeveloperInstructions({ pluginDir: plugin, codexHome: home, userConfig: true })).toBe(CATALOG.trimEnd());
  });

  it('keeps the user’s developer_instructions first, then the catalog', () => {
    catalog();
    config('developer_instructions = """\nBe terse.\nAlways test."""\nmodel = "x"\n');
    expect(codexDeveloperInstructions({ pluginDir: plugin, codexHome: home, userConfig: true })).toBe(
      `Be terse.\nAlways test.\n\n${CATALOG.trimEnd()}`,
    );
  });

  it('ignores the user’s config when told to (headless --ignore-user-config)', () => {
    catalog();
    config('developer_instructions = "Be terse."\n');
    expect(
      codexDeveloperInstructions({ pluginDir: plugin, codexHome: home, own: 'You are "watcher".', userConfig: false }),
    ).toBe(`You are "watcher".\n\n${CATALOG.trimEnd()}`);
  });

  it('drops a malformed config, a non-string key, and a key under a table', () => {
    catalog();
    for (const text of [
      'developer_instructions = "unterminated',
      'developer_instructions = 3',
      '[profiles.x]\ndeveloper_instructions = "no"',
    ]) {
      config(text);
      expect(codexDeveloperInstructions({ pluginDir: plugin, codexHome: home, userConfig: true })).toBe(CATALOG.trimEnd());
    }
  });

  it('is the user’s text alone when no catalog was written, and undefined when nothing is', () => {
    config('developer_instructions = "Be terse."');
    expect(codexDeveloperInstructions({ codexHome: home, userConfig: true })).toBe('Be terse.');
    expect(
      codexDeveloperInstructions({ pluginDir: join(root, 'missing'), codexHome: join(root, 'nohome'), userConfig: true }),
    ).toBeUndefined();
  });
});
