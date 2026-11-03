import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CliSkills } from '@shared/skills-contract';

import { CliSkillsRow } from '@features/settings/components/cli-skills-row';

let skills: CliSkills | null = null;
vi.mock('@/hooks/use-skills', () => ({ useCliSkills: () => skills }));

const SOME: CliSkills = [
  { cli: 'claude-code', names: ['graphify', 'pretty-mermaid'], places: '~/.claude/skills and your installed plugins' },
  { cli: 'codex', names: ['content-engine', 'find-skills', 'pdf:pdf'], places: '~/.agents/skills, …' },
];

describe('CliSkillsRow', () => {
  it('counts each CLI’s own skills', () => {
    skills = SOME;
    render(<CliSkillsRow />);
    expect(screen.getByText('Your CLI skills:')).toBeTruthy();
    expect(screen.getByText('Claude Code').parentElement?.textContent).toBe('Claude Code 2');
    expect(screen.getByText('Codex').parentElement?.textContent).toBe('Codex 3');
    expect(screen.getByRole('button', { name: 'View' })).toBeTruthy();
  });

  it('renders nothing before the answer, in the browser, or with no skills', () => {
    for (const value of [null, []]) {
      skills = value;
      const { container, unmount } = render(<CliSkillsRow />);
      expect(container.textContent).toBe('');
      unmount();
    }
  });
});
