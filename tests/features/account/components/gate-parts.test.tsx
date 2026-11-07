import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GateFooter, Heading, PlanWait, Waiting } from '@features/account/components/gate-parts';

const signOut = vi.hoisted(() => vi.fn());
vi.mock('@lib/account', () => ({ signOut }));

const appQuit = vi.fn();

beforeEach(() => {
  signOut.mockReset();
  appQuit.mockReset();
  (window as unknown as { hive: unknown }).hive = { appQuit };
});

afterEach(() => {
  delete (window as unknown as { hive?: unknown }).hive;
});

describe('gate parts (HIVE-265)', () => {
  it('Heading is a level-2 heading', () => {
    render(<Heading>Welcome</Heading>);
    expect(screen.getByRole('heading', { level: 2, name: 'Welcome' })).toBeInTheDocument();
  });

  it('Waiting shows its children beside the spinner', () => {
    render(
      <Waiting>
        <span>Working…</span>
      </Waiting>,
    );
    expect(screen.getByText('Working…')).toBeInTheDocument();
  });

  it('GateFooter with an email: email · Sign out, which signs out with no confirm, and Quit', async () => {
    render(<GateFooter email="ana@example.com" />);
    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Quit' }));
    expect(appQuit).toHaveBeenCalledOnce();
  });

  it('GateFooter revoked: "Signed out" and Quit, no Sign out', () => {
    render(<GateFooter revoked />);
    expect(screen.getByText('Signed out')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quit' })).toBeInTheDocument();
  });

  it('GateFooter signed out: Quit alone', () => {
    render(<GateFooter />);
    expect(screen.queryByText('Signed out')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quit' })).toBeInTheDocument();
  });

  it('PlanWait says to finish in the browser, and Cancel cancels', async () => {
    const cancel = vi.fn();
    render(<PlanWait cancel={cancel} />);
    expect(screen.getByText('Finish in your browser…')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalledOnce();
  });
});
