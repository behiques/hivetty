import { describe, expect, it } from 'vitest';

import {
  createCopilotInstalled,
  listCopilotSkills,
  parseCopilotSkillList,
} from '../../../../../electron/main/harness/copilot/installed';

const LIST = JSON.stringify([
  { name: 'find-skills', source: 'personal-agents', path: '/Users/u/.agents/skills/find-skills', enabled: true },
  {
    name: 'brainstorming',
    source: 'plugin',
    path: '/Users/u/.copilot/installed-plugins/mkt/superpowers/skills/brainstorming',
    enabled: true,
  },
  { name: 'workstream:work-on', source: 'plugin', path: '/Users/u/kit/plugins/workstream/skills/work-on', enabled: true },
  { name: 'off', source: 'personal-agents', path: '/x/off', enabled: false },
  { name: 'github-pr-media', source: 'builtin', path: '', enabled: true },
]);

describe('parseCopilotSkillList', () => {
  it('names personal skills bare and plugin skills plugin:skill, never twice, builtins and disabled out', () => {
    expect(parseCopilotSkillList(LIST)).toEqual({
      skills: ['find-skills', 'superpowers:brainstorming', 'workstream:work-on'],
      plugins: ['superpowers', 'workstream'],
    });
  });

  it('reads what precedes the prose Copilot prints after the list for a refused skill', () => {
    expect(parseCopilotSkillList(`${LIST}\n\n✖ The following skills failed to load:\n  • /x: y`).skills).toHaveLength(3);
  });

  it('reads nothing from output that is not a skill list', () => {
    expect(parseCopilotSkillList('not json')).toEqual({ skills: [], plugins: [] });
    expect(parseCopilotSkillList('{"a":1}')).toEqual({ skills: [], plugins: [] });
  });
});

describe('createCopilotInstalled', () => {
  it('answers from the list, and nothing when listing fails', async () => {
    const ok = createCopilotInstalled(() => Promise.resolve(LIST));
    await expect(ok.skillNames()).resolves.toContain('superpowers:brainstorming');
    await expect(ok.pluginNames()).resolves.toEqual(['superpowers', 'workstream']);
    await expect(ok.sessionOverrides([])).resolves.toEqual({});
    expect(ok.skillPlaces).not.toBe('');
    const failing = createCopilotInstalled(() => Promise.reject(new Error('no copilot')));
    await expect(failing.skillNames()).resolves.toEqual([]);
    await expect(failing.pluginNames()).resolves.toEqual([]);
  });

  it('rejects when the binary is missing, which the installed list reads as nothing', async () => {
    await expect(listCopilotSkills('hivetty-no-such-binary')).rejects.toThrow();
  });
});
