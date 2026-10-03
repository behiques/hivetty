import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrDiff } from '@features/pull-requests/components/pr-diff';
import { parseUnifiedDiff } from '@lib/unified-diff';
import { useUiStore } from '@stores/ui-store';
import { prFile } from '@tests/support/pr-detail';

const TEXT = [
  'diff --git a/src/fees/validator.ts b/src/fees/validator.ts', '--- a/src/fees/validator.ts', '+++ b/src/fees/validator.ts',
  '@@ -114,4 +114,4 @@', '   const fee = feeTable.for(filing.state, filing.year);',
  "-  if (filing.total < 400) return reject('underpaid');", "+  if (filing.total < fee.minimum) return reject('underpaid');",
  "   if (filing.entity === 'llc') return ok();", '   return checkFranchiseTax(filing);',
].join('\n');
const [DIFF] = parseUnifiedDiff(TEXT);
const ok = { ok: true as const, value: true as const };
const props = (over: Partial<Parameters<typeof PrDiff>[0]> = {}) => ({
  file: prFile(), diff: DIFF!, threads: [], prUrl: 'https://github.com/acme/x/pull/1', readOnly: false,
  onViewed: vi.fn().mockResolvedValue(ok), fixerOnIt: false, ...over,
});

beforeEach(() => useUiStore.getState().reset());

describe('PrDiff', () => {
  it('heads with the path, +/− and the Unified | Split switch', () => {
    render(<PrDiff {...props()} />);
    expect(screen.getByRole('heading', { name: 'src/fees/validator.ts' })).toBeInTheDocument();
    expect(screen.getByText('+88')).toHaveClass('text-green');
    expect(screen.getByText('−9')).toHaveClass('text-red');
    expect(screen.getByRole('radio', { name: 'Unified' })).toBeChecked();
  });

  it('draws Unified rows with numbers, signs and the add/remove wash', () => {
    render(<PrDiff {...props()} />);
    const added = screen.getByText("if (filing.total < fee.minimum) return reject('underpaid');").closest('[data-kind]');
    const removed = screen.getByText("if (filing.total < 400) return reject('underpaid');").closest('[data-kind]');
    expect(added).toHaveAttribute('data-kind', 'add');
    expect(added?.className).toContain('var(--cc-green)_11%');
    expect(removed?.className).toContain('var(--cc-red)_11%');
    expect(added).toHaveTextContent('115+');
  });

  it('marks viewed at once, and shows the reason and the old state on a refusal', async () => {
    const onViewed = vi.fn().mockResolvedValue({ ok: false, error: { kind: 'unknown', message: 'Resource not accessible' } });
    render(<PrDiff {...props({ onViewed })} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Viewed' }));
    expect(onViewed).toHaveBeenCalledWith(true);
    expect(await screen.findByText('Resource not accessible')).toBeInTheDocument();
  });

  it('shows a dismissed file unchecked and "changed"; read-only disables Viewed', () => {
    const { rerender } = render(<PrDiff {...props({ file: prFile({ viewed: 'dismissed' }) })} />);
    expect(screen.getByRole('checkbox', { name: 'Viewed' })).not.toBeChecked();
    expect(screen.getByText('changed since')).toBeInTheDocument();
    rerender(<PrDiff {...props({ readOnly: true })} />);
    expect(screen.getByRole('checkbox', { name: 'Viewed' })).toBeDisabled();
  });

  it('opens the editor at the selected line, else the first changed line', async () => {
    const onOpenFile = vi.fn();
    render(<PrDiff {...props({ onOpenFile })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open in the editor' }));
    expect(onOpenFile).toHaveBeenLastCalledWith('src/fees/validator.ts', 115);
    await userEvent.click(screen.getByRole('button', { name: 'Line 117' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open in the editor' }));
    expect(onOpenFile).toHaveBeenLastCalledWith('src/fees/validator.ts', 117);
  });

  it('has no Open in the editor without a root, or for a deleted file', () => {
    const { rerender } = render(<PrDiff {...props()} />);
    expect(screen.queryByRole('button', { name: 'Open in the editor' })).toBeNull();
    rerender(<PrDiff {...props({ onOpenFile: vi.fn(), diff: { ...DIFF!, status: 'deleted' } })} />);
    expect(screen.queryByRole('button', { name: 'Open in the editor' })).toBeNull();
  });

  it('reads "No diff to show" for a binary file, no diff, or a failed read, with a link', () => {
    const { rerender } = render(<PrDiff {...props({ diff: { ...DIFF!, binary: true, hunks: [] } })} />);
    expect(screen.getByText('No diff to show')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See it on GitHub' })).toHaveAttribute('href', 'https://github.com/acme/x/pull/1/files');
    rerender(<PrDiff {...props({ diff: null, problem: 'diff too large' })} />);
    expect(screen.getByText('No diff to show')).toBeInTheDocument();
    expect(screen.getByText('diff too large')).toBeInTheDocument();
  });

  it('disables Viewed while its write is pending (carry-over from #22)', async () => {
    let settle: (result: typeof ok) => void = () => undefined;
    const onViewed = vi.fn(() => new Promise<typeof ok>((resolve) => { settle = resolve; }));
    render(<PrDiff {...props({ onViewed })} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Viewed' }));
    expect(screen.getByRole('checkbox', { name: 'Viewed' })).toBeDisabled();
    await act(async () => settle(ok));
    expect(screen.getByRole('checkbox', { name: 'Viewed' })).toBeEnabled();
  });
});
