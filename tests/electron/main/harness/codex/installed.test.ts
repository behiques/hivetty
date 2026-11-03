import { describe, expect, it } from 'vitest';

import { parseCodexSkillCatalog } from '../../../../../electron/main/harness/codex/installed';

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
});
