import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CliDock } from '@features/sessions/components/cli-dock';
import { openAccountWeb } from '@lib/account';
import type { HarnessId } from '@shared/harness-contract';

vi.mock('@lib/account', () => ({ openAccountWeb: vi.fn(() => Promise.resolve(null)) }));

function Harness({
  onChange = () => {},
  unavailable,
  locked,
  start = 'claude-code',
}: {
  onChange?: (cli: HarnessId) => void;
  unavailable?: Partial<Record<HarnessId, string>>;
  locked?: Partial<Record<HarnessId, string>>;
  start?: HarnessId;
}) {
  const [cli, setCli] = useState<HarnessId>(start);
  return (
    <CliDock
      value={cli}
      unavailable={unavailable}
      locked={locked}
      onChange={(next) => {
        setCli(next);
        onChange(next);
      }}
    />
  );
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

  it('dims an unavailable CLI, names why, refuses the click and steps past it (HIVE-375)', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} unavailable={{ codex: '`codex` was not found on PATH.' }} />);

    const codex = screen.getByRole('radio', { name: 'Codex: `codex` was not found on PATH.' });
    expect(codex).toHaveAttribute('aria-disabled', 'true');
    expect(codex).toHaveAttribute('aria-description', "Codex isn't available: `codex` was not found on PATH.");
    expect(screen.getByRole('radio', { name: 'Copilot' })).not.toHaveAttribute('aria-disabled');
    // The reason is a hover hint, not a line under the dock.
    expect(screen.queryByText(/isn't available/)).toBeNull();

    await user.click(codex);
    expect(onChange).not.toHaveBeenCalled();

    screen.getByRole('radio', { name: 'Claude Code' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('copilot');
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('claude-code');
  });

  it('jumps Home and End to the first and last CLI that is available (HIVE-375)', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} start="codex" unavailable={{ 'claude-code': 'off', copilot: 'off' }} />);

    screen.getByRole('radio', { name: 'Codex' }).focus();
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('codex');
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('codex');
  });

  it('steps from the first available CLI when the current one is itself unavailable (HIVE-375)', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} unavailable={{ 'claude-code': 'off' }} />);

    screen.getByRole('radio', { name: 'Claude Code: off' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('copilot');
  });
});

describe('CliDock caption (HIVE-378)', () => {
  it('writes the source caption under the name', () => {
    render(<CliDock value="codex" onChange={vi.fn()} caption="Default for hivetty" />);
    expect(screen.getByText('Default for hivetty')).toBeInTheDocument();
  });

  it('draws no caption when there is none', () => {
    const { container } = render(<CliDock value="codex" onChange={vi.fn()} caption={null} />);
    expect(container.querySelector('[data-slot="cli-caption"]')).toBeNull();
  });

  it('a plan-locked CLI is dimmed with a lock, refuses a click, and offers Upgrade (HIVE-332)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const reason = 'Copilot is in Team and above';
    render(<Harness onChange={onChange} unavailable={{ copilot: reason }} locked={{ copilot: reason }} />);

    const square = screen.getByRole('radio', { name: `Copilot: ${reason}` });
    expect(square).toHaveAttribute('aria-disabled', 'true');
    expect(square.querySelector('[data-slot="cli-lock"]')).not.toBeNull();
    await user.click(square);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.queryByText(/isn't available/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Upgrade' }));
    expect(openAccountWeb).toHaveBeenCalledWith('/account/plan');
  });
});
