import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CliDock } from '@features/sessions/components/cli-dock';
import type { HarnessId } from '@shared/harness-contract';

function Harness({ onChange = () => {} }: { onChange?: (cli: HarnessId) => void }) {
  const [cli, setCli] = useState<HarnessId>('claude-code');
  return <CliDock value={cli} onChange={(next) => { setCli(next); onChange(next); }} />;
}

describe('CliDock', () => {
  it('draws one mark per CLI, named for the reader, the chosen one checked and named below', () => {
    render(<Harness />);

    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual(['Claude Code', 'Codex', 'Copilot']);
    expect(radios.map((radio) => radio.querySelector('svg')?.getAttribute('data-cli'))).toEqual([
      'claude-code',
      'codex',
      'copilot',
    ]);
    expect(screen.getByRole('radio', { name: 'Claude Code' })).toBeChecked();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
  });

  it('chooses on click and writes the new name under the dock', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Codex' }));

    expect(onChange).toHaveBeenCalledWith('codex');
    expect(screen.getByRole('radio', { name: 'Codex' })).toBeChecked();
    expect(screen.getByText('Codex')).toBeInTheDocument();
  });

  it('is one tab stop, and the arrows, Home and End choose as they move', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.tab();
    expect(screen.getByRole('radio', { name: 'Claude Code' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Codex' })).toHaveAttribute('tabindex', '-1');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Codex' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Codex' })).toBeChecked();

    await user.keyboard('{End}');
    expect(screen.getByRole('radio', { name: 'Copilot' })).toBeChecked();

    // Wraps at the end.
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Claude Code' })).toBeChecked();

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Copilot' })).toBeChecked();

    await user.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: 'Claude Code' })).toHaveFocus();

    // Any other key does nothing.
    await user.keyboard('a');
    expect(screen.getByRole('radio', { name: 'Claude Code' })).toBeChecked();
  });
});
