import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Lock, LockMark, UpgradeLink } from '@components/ui/lock';

const openAccountWeb = vi.hoisted(() => vi.fn());
vi.mock('@lib/account', () => ({ openAccountWeb }));

describe('Lock', () => {
  it('not in the plan: Upgrade opens /account/plan signed in', async () => {
    openAccountWeb.mockResolvedValueOnce({ ok: true });
    render(<Lock kind="plan" reason="Copilot is in Team and above" />);
    expect(screen.getByRole('note', { name: 'Copilot is in Team and above' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Upgrade' }));
    expect(openAccountWeb).toHaveBeenCalledWith('/account/plan');
  });

  it('an Upgrade that fails says why under the button', async () => {
    openAccountWeb.mockResolvedValueOnce({ error: 'Sign in to HiveTTY first.' });
    render(<Lock kind="plan" reason="Codex is in Solo and above" />);
    await userEvent.click(screen.getByRole('button', { name: 'Upgrade' }));
    expect(await screen.findByText('Sign in to HiveTTY first.')).toBeInTheDocument();
  });

  it('managed by policy: ask your admin, and no button', () => {
    render(<Lock kind="policy" reason="Your organization manages Copilot." />);
    expect(screen.getByText('Ask your admin.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('not installed: Install calls back', async () => {
    const onInstall = vi.fn();
    render(<Lock kind="install" reason="Copilot isn't installed on this Mac." onInstall={onInstall} />);
    await userEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });
});

describe('LockMark', () => {
  it('shows the glyph and the plan chip, labelled for assistive tech', () => {
    render(<LockMark plan="Team" />);
    expect(screen.getByLabelText('Locked: Team')).toHaveTextContent('Team');
  });

  it('with no plan, the glyph alone', () => {
    render(<LockMark plan={null} />);
    expect(screen.getByLabelText('Locked')).toBeInTheDocument();
  });
});

describe('UpgradeLink (HIVE-332)', () => {
  it('opens the plan page and shows a failure', async () => {
    openAccountWeb.mockResolvedValueOnce({ error: 'Could not open the browser' });
    render(<UpgradeLink />);
    await userEvent.click(screen.getByRole('button', { name: 'Upgrade' }));
    expect(openAccountWeb).toHaveBeenCalledWith('/account/plan');
    expect(await screen.findByText('Could not open the browser')).toBeInTheDocument();
  });
});
