import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PrRow } from '@features/pull-requests/components/pr-row';
import { hatchRow } from '@tests/support/hatchery';

describe('PrRow', () => {
  const row = hatchRow({}, { flap: 'MUTATING', tone: 'green', github: 'Open · 2 open findings, fixer on it' });

  it('draws the number, the repo, the flap and the title', () => {
    render(<PrRow row={row} open={false} onOpen={() => {}} />);
    expect(screen.getByText('1182')).toBeInTheDocument();
    expect(screen.getByText('incorpx-server')).toHaveClass('uppercase');
    expect(screen.getByText('MUTATING')).toBeInTheDocument();
    expect(screen.getByText('Fee rule validator for Delaware filings')).toHaveClass('truncate');
  });

  it("carries GitHub's words in its name and tooltip", () => {
    render(<PrRow row={row} open={false} onOpen={() => {}} />);
    const button = screen.getByRole('button', { name: /MUTATING: Open · 2 open findings, fixer on it/ });
    expect(button).toHaveAttribute('title', 'Open · 2 open findings, fixer on it');
  });

  it('marks the open PR', () => {
    render(<PrRow row={row} open onOpen={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button')).toHaveClass('bg-panel-2');
  });

  it('draws the draft glyph for LARVA and COCOONING', () => {
    const { container } = render(<PrRow row={hatchRow({ state: 'draft' }, { flap: 'LARVA' })} open={false} onOpen={() => {}} />);
    expect(container.querySelector('[data-glyph="draft"]')).not.toBeNull();
  });

  it('opens on click', async () => {
    const onOpen = vi.fn();
    render(<PrRow row={row} open={false} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith(row);
  });
});
