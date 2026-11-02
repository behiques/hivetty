import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SkillPortability } from '@features/settings/components/skill-portability';

const ISSUES = [
  {
    line: 3,
    found: 'mcp__hive__ledger_ask',
    fix: '{{tool:ledger_ask}}',
    message: '`mcp__hive__ledger_ask` only works in Claude Code and Codex. Write `{{tool:ledger_ask}}`.',
  },
  { line: 9, found: '{{skill:plann}}', fix: null, message: 'No skill is called `plann`.' },
];

describe('SkillPortability', () => {
  it('renders nothing when the file is portable', () => {
    const { container } = render(<SkillPortability issues={[]} onFixAll={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('lists each issue with its line', () => {
    render(<SkillPortability issues={ISSUES} onFixAll={() => {}} />);
    expect(screen.getByText(/Line 3:/)).toBeInTheDocument();
    expect(screen.getByText(/No skill is called `plann`\./)).toBeInTheDocument();
  });
  it('offers Fix all when something is fixable', () => {
    const onFixAll = vi.fn();
    render(<SkillPortability issues={ISSUES} onFixAll={onFixAll} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fix all' }));
    expect(onFixAll).toHaveBeenCalledOnce();
  });
  it('offers no Fix all when nothing is fixable', () => {
    render(<SkillPortability issues={[ISSUES[1]!]} onFixAll={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Fix all' })).toBeNull();
  });
});
