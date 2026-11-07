import { describe, expect, it } from 'vitest';

import { createCodexInstalled, CODEX_SKILL_PLACES, parseCodexSkillCatalog } from '../../../../../electron/main/harness/codex/installed';

// Trimmed from `codex debug prompt-input x` on codex-cli 0.166.0. A skill disabled by
// `[[skills.config]] enabled = false` is absent from Codex's own catalog, so it is absent here.
const CATALOG = [
  'Skill roots',
  '- `r0` = `/Users/u/.codex/skills`',
  '- `r1` = `/Users/u/.agents/skills`',
  '- `r2` = `/Users/u/.codex/skills/.system`',
  '- `r3` = `/Users/u/.codex/plugins/cache/openai-bundled`',
  '### Available skills',
  '- imagegen: Generate images (bitmaps). (file: r2/imagegen/SKILL.md)',
  '- content-engine: Writes copy (file: r0/content-engine/SKILL.md)',
  '- find-skills: Finds skills (file: r1/find-skills/SKILL.md)',
  '- workstream:work-on: Works a ticket: reads it (file: r1/work-on/SKILL.md)',
  '- visualize:visualize: Charts (file: r3/visualize/1.0.50/skills/visualize/SKILL.md)',
  '- abs: An absolute one (file: /etc/codex/skills/abs/SKILL.md)',
  '### How to use skills',
  '- not-a-skill: prose (file: r0/x/SKILL.md)',
].join('\n');

const OUTPUT = JSON.stringify([
  { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'other' }] },
  { type: 'message', role: 'developer', content: [{ type: 'input_text', text: CATALOG }] },
]);

describe('parseCodexSkillCatalog', () => {
  it('names every listed skill as Codex writes it, the bundled .system ones out', () => {
    expect(parseCodexSkillCatalog(OUTPUT)).toEqual([
      'content-engine',
      'find-skills',
      'workstream:work-on',
      'visualize:visualize',
      'abs',
    ]);
  });

  it('reads nothing from output that holds no catalog', () => {
    expect(parseCodexSkillCatalog('not json')).toEqual([]);
    expect(parseCodexSkillCatalog('{"a":1}')).toEqual([]);
    expect(parseCodexSkillCatalog(JSON.stringify([{ content: [{ text: 'no skills here' }] }]))).toEqual([]);
  });

  it('leaves HiveTTY’s own installed plugin out, by its path, not its name (HIVE-372)', () => {
    const text = [
      '- `r0` = `/Users/u/.codex/plugins/cache/hivetty`',
      '- `r1` = `/Users/u/.codex/plugins/cache/other`',
      '### Available skills',
      '- hive:hive-work-on: Works a ticket (file: r0/hive/1.0.0+abcd1234/skills/hive-work-on/SKILL.md)',
      '- hive:lint: Someone else’s hive plugin (file: r1/hive/2.0.0/skills/lint/SKILL.md)',
    ].join('\n');
    expect(parseCodexSkillCatalog(JSON.stringify([{ content: [{ text }] }]))).toEqual(['hive:lint']);
  });
});

describe('createCodexInstalled', () => {
  it('answers the catalog’s skills and the plugins behind the prefixed ones', async () => {
    const installed = createCodexInstalled(() => Promise.resolve(OUTPUT));
    expect(await installed.skillNames()).toContain('find-skills');
    expect(await installed.pluginNames()).toEqual(['visualize', 'workstream']);
    expect(await installed.sessionOverrides(['x'])).toEqual({});
    expect(installed.skillPlaces).toBe(CODEX_SKILL_PLACES);
  });

  it('answers nothing when codex is absent or fails', async () => {
    const installed = createCodexInstalled(() => Promise.reject(new Error('ENOENT')));
    expect(await installed.skillNames()).toEqual([]);
    expect(await installed.pluginNames()).toEqual([]);
  });
});
