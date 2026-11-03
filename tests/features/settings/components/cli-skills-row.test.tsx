import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('View opens every CLI’s skills, grouped with their places, and filters them', async () => {
    skills = SOME;
    render(<CliSkillsRow />);
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    const dialog = screen.getByRole('dialog', { name: 'Your CLI skills' });
    expect(within(dialog).getByText('HiveTTY reads them and never changes them.', { exact: false })).toBeTruthy();
    expect(within(dialog).getByText('~/.claude/skills and your installed plugins')).toBeTruthy();
    expect(within(dialog).getByText('find-skills')).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText('Filter skills'), 'pdf');
    expect(within(dialog).queryByText('find-skills')).toBeNull();
    expect(within(dialog).getByText('pdf:pdf')).toBeTruthy();
    expect(within(dialog).queryByText('Claude Code', { exact: false })).toBeNull(); // a CLI with no match hides
    await userEvent.clear(within(dialog).getByLabelText('Filter skills'));
    await userEvent.type(within(dialog).getByLabelText('Filter skills'), 'zzz');
    expect(within(dialog).getByText('No skill matches “zzz”.')).toBeTruthy();
  });

  it('Done closes the dialog and clears the filter', async () => {
    skills = SOME;
    render(<CliSkillsRow />);
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    await userEvent.type(screen.getByLabelText('Filter skills'), 'pdf');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    expect((screen.getByLabelText('Filter skills') as HTMLInputElement).value).toBe('');
  });
});
