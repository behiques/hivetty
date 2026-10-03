import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ThreadCard, hunkTail } from '@features/pull-requests/components/thread-card';
import { prThread } from '@tests/support/pr-detail';

describe('hunkTail', () => {
  it("numbers the new side's lines from the hunk header and leaves removed lines unnumbered", () => {
    expect(hunkTail(prThread().comments[0]!.diffHunk, 3)).toEqual([
      { n: null, text: "-  if (filing.total < 400) return reject('underpaid');" },
      { n: 116, text: "   if (filing.entity === 'llc') return ok();" },
      { n: 117, text: '   return checkFranchiseTax(filing);' },
    ]);
  });
});

describe('ThreadCard', () => {
  it('heads with path:line and the open state, then the hunk and the comment', () => {
    render(<ThreadCard thread={prThread()} fixerOnIt={false} />);
    expect(screen.getByText('src/fees/validator.ts')).toBeInTheDocument();
    expect(screen.getByText(':118')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.getByText('An LLC without a registered agent passes validation.')).toBeInTheDocument();
    expect(screen.getByText('117')).toBeInTheDocument();
  });

  it('says the fixer is on an open thread, and resolved over everything', () => {
    const { rerender } = render(<ThreadCard thread={prThread()} fixerOnIt />);
    expect(screen.getByText('fixer on it')).toHaveClass('text-amber');
    rerender(<ThreadCard thread={prThread({ isResolved: true })} fixerOnIt />);
    expect(screen.getByText('resolved')).toHaveClass('text-green');
  });

  it('shows the replies', () => {
    const [first] = prThread().comments;
    render(
      <ThreadCard
        thread={prThread({ comments: [first!, { ...first!, url: 'r2', author: 'yunid', body: 'Agreed.' }] })}
        fixerOnIt={false}
      />,
    );
    expect(screen.getByText('yunid')).toBeInTheDocument();
    expect(screen.getByText('Agreed.')).toBeInTheDocument();
  });

  it('opens the file at the line, and has no Reply or Resolve (HIVE-207)', async () => {
    const onOpenFile = vi.fn();
    render(<ThreadCard thread={prThread()} fixerOnIt={false} onOpenFile={onOpenFile} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open the file' }));
    expect(onOpenFile).toHaveBeenCalledWith('src/fees/validator.ts', 118);
    expect(screen.queryByRole('button', { name: /reply|resolve/i })).toBeNull();
  });

  it('hides Open the file with nowhere to open it', () => {
    render(<ThreadCard thread={prThread()} fixerOnIt={false} />);
    expect(screen.queryByRole('button', { name: 'Open the file' })).toBeNull();
  });
});
