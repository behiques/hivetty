// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { HarnessInstalled } from '../../../../electron/main/harness/port';
import { readCliSkills } from '../../../../electron/main/skills/cli-skills';

const fake = (names: string[] | Error, places: string): HarnessInstalled => ({
  skillNames: () => (names instanceof Error ? Promise.reject(names) : Promise.resolve(names)),
  pluginNames: () => Promise.resolve([]),
  sessionOverrides: () => Promise.resolve({}),
  skillPlaces: places,
});

describe('readCliSkills', () => {
  it('lists each CLI with skills, in HARNESS_IDS order, names sorted and deduplicated; empty and failing CLIs out', async () => {
    const byCli = {
      'claude-code': fake(['pretty-mermaid', 'graphify', 'graphify'], '~/.claude/skills'),
      codex: fake(new Error('boom'), '~/.agents/skills'),
      copilot: fake([], '~/.copilot/skills'),
    } as const;
    expect(await readCliSkills((id) => byCli[id])).toEqual([
      { cli: 'claude-code', names: ['graphify', 'pretty-mermaid'], places: '~/.claude/skills' },
    ]);
  });
});
