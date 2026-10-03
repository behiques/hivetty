import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrDiff } from '@features/pull-requests/components/pr-diff';
import { parseUnifiedDiff } from '@lib/unified-diff';
import { useUiStore } from '@stores/ui-store';
import { prFile, prThread } from '@tests/support/pr-detail';

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

  it('keeps a removed line and an added one of the same number apart, and opens at the new side (#24)', async () => {
    const onOpenFile = vi.fn();
    render(<PrDiff {...props({ onOpenFile })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Old line 115' }));
    const rows = (kind: string) => document.querySelector(`[data-kind="${kind}"]`);
    expect(rows('del')?.className).toContain('inset_2px');
    expect(rows('add')?.className).not.toContain('inset_2px');
    await userEvent.click(screen.getByRole('button', { name: 'Open in the editor' }));
    expect(onOpenFile).toHaveBeenLastCalledWith('src/fees/validator.ts', 115);
  });

  it('in Split, selecting the left gutter highlights the left row only (#24)', async () => {
    useUiStore.getState().setPrDiffView('split');
    render(<PrDiff {...props({ onOpenFile: vi.fn() })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Old line 115' }));
    const left = document.querySelector('[data-side="left"] [data-kind="del"]');
    const right = document.querySelector('[data-side="right"] [data-kind="add"]');
    expect(left?.className).toContain('inset_2px');
    expect(right?.className).not.toContain('inset_2px');
  });

  it('offers Retry beside a failed read (#24)', async () => {
    const onRetry = vi.fn();
    render(<PrDiff {...props({ problem: 'GitHub said no.', onRetry })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
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

describe('PrDiff — Split and threads (HIVE-207)', () => {
  it('draws Split with each side’s own numbers, a removal beside its replacement', async () => {
    render(<PrDiff {...props()} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Split' }));
    const pair = screen.getByTestId('split-row-1');
    expect(pair.querySelector('[data-side="left"] [data-kind="del"]')).toHaveTextContent('115−');
    expect(pair.querySelector('[data-side="right"] [data-kind="add"]')).toHaveTextContent('115+');
  });

  it('puts a RIGHT thread under its new line and a LEFT thread under its old line', () => {
    const right = prThread({ id: 'R', line: 116, diffSide: 'RIGHT', comments: [{ ...prThread().comments[0]!, body: 'right side' }] });
    const left = prThread({ id: 'L', line: 115, diffSide: 'LEFT', comments: [{ ...prThread().comments[0]!, body: 'left side' }] });
    render(<PrDiff {...props({ threads: [right, left] })} />);
    const rows = [...document.querySelectorAll('[data-kind], [data-thread]')].map((el) => el.getAttribute('data-thread') ?? el.getAttribute('data-kind'));
    // context 114, del 115, [L], add 115, context 116, [R], context 117
    expect(rows).toEqual(['context', 'del', 'L', 'add', 'context', 'R', 'context']);
    expect(screen.getByText('right side')).toBeInTheDocument();
  });

  it('lists an outdated thread at the top, marked outdated', () => {
    render(<PrDiff {...props({ threads: [prThread({ id: 'O', isOutdated: true, line: null })] })} />);
    const first = document.querySelector('[data-kind], [data-thread]');
    expect(first).toHaveAttribute('data-thread', 'O');
    expect(screen.getByText('outdated')).toBeInTheDocument();
  });

  it('hands the thread its writes and Open the file', async () => {
    const writes = { reply: vi.fn(), setResolved: vi.fn().mockResolvedValue({ ok: true, value: true }) };
    render(<PrDiff {...props({ threads: [prThread({ line: 116 })], writes })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(writes.setResolved).toHaveBeenCalledWith('PRRT_1', true);
  });

  it('shows a skeleton while the diff is loading (HIVE-207)', () => {
    render(<PrDiff {...props({ diff: null, loading: true })} />);
    expect(screen.getByRole('status', { name: 'Loading diff' })).toBeInTheDocument();
    expect(screen.queryByText('No diff to show')).toBeNull();
  });

  it('shows a failed re-read as a banner over the diff it still has (carry-over from #22)', () => {
    render(<PrDiff {...props({ problem: 'rate limited' })} />);
    expect(screen.getByText('rate limited')).toBeInTheDocument();
    expect(screen.queryByText('No diff to show')).toBeNull();
  });
});
