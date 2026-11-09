import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Gate, resetTrialLatch } from '@features/account/components/gate';

const account = vi.hoisted(() => ({ signIn: vi.fn(), signInWithCode: vi.fn(), cancelSignIn: vi.fn(), signOut: vi.fn() }));
const startTrial = vi.hoisted(() => vi.fn());
const choose = vi.hoisted(() => ({ waiting: false, error: null as string | null, start: vi.fn(), cancel: vi.fn() }));
vi.mock('@lib/account', () => account);
vi.mock('@lib/licence', async (real) => ({
  ...(await real<object>()),
  startTrial,
  readPaused: vi.fn().mockResolvedValue(null),
  refreshLicence: vi.fn(),
}));
vi.mock('@features/account/hooks/use-choose-plan', () => ({ useChoosePlan: () => choose }));
const appQuit = vi.fn();
const onSignInWithCode = vi.fn();

const CODE = {
  userCode: 'WDJB-MJHT',
  verificationUri: 'https://api.hivetty.dev/device',
  verificationUriComplete: 'https://api.hivetty.dev/device?user_code=WDJB-MJHT',
  expiresIn: 600,
};

beforeEach(() => {
  (window as { hive?: unknown }).hive = { appQuit };
  for (const fn of Object.values(account)) fn.mockReset().mockResolvedValue(undefined);
  startTrial.mockReset();
  onSignInWithCode.mockReset();
  Object.assign(choose, { waiting: false, error: null });
  resetTrialLatch();
});
afterEach(() => {
  delete (window as { hive?: unknown }).hive;
});

describe('Gate (HIVE-265)', () => {
  it('sign-in: the heading, the browser button, the code link, and Quit alone in the footer', async () => {
    render(<Gate view={{ kind: 'sign-in' }} onSignInWithCode={onSignInWithCode} />);
    expect(screen.getByRole('heading', { name: 'Sign in to HiveTTY Pro' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with browser' }));
    expect(account.signIn).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with a code' }));
    expect(onSignInWithCode).toHaveBeenCalled();
    expect(account.signInWithCode).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Quit' }));
    expect(appQuit).toHaveBeenCalled();
  });

  it('sign-in shows the last failure in one line', () => {
    render(<Gate view={{ kind: 'sign-in', message: 'The sign-in was denied.' }} onSignInWithCode={onSignInWithCode} />);
    expect(screen.getByText('The sign-in was denied.')).toBeInTheDocument();
  });

  it('waiting for the browser: Open again re-runs sign-in, Cancel cancels', async () => {
    render(<Gate view={{ kind: 'waiting-browser' }} onSignInWithCode={onSignInWithCode} />);
    expect(screen.getByRole('heading', { name: 'Continue in your browser' })).toBeInTheDocument();
    expect(screen.getByText('Waiting for the browser…')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open again' }));
    expect(account.signIn).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(account.cancelSignIn).toHaveBeenCalled();
  });

  it('waiting on a code: the code, the page to open, Cancel', async () => {
    render(<Gate view={{ kind: 'waiting-code', code: CODE }} onSignInWithCode={onSignInWithCode} />);
    expect(screen.getByRole('heading', { name: 'Sign in with a code' })).toBeInTheDocument();
    expect(screen.getByText('WDJB-MJHT')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'api.hivetty.dev/device' })).toBeInTheDocument();
    expect(screen.getByText('Waiting for approval…')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(account.cancelSignIn).toHaveBeenCalled();
  });

  it('the code link prefers the complete URI', () => {
    render(<Gate view={{ kind: 'waiting-code', code: CODE }} onSignInWithCode={onSignInWithCode} />);
    expect(screen.getByRole('link', { name: 'api.hivetty.dev/device' })).toHaveAttribute(
      'href',
      'https://api.hivetty.dev/device?user_code=WDJB-MJHT',
    );
  });

  it('asked for a code, none yet: the heading, "Getting a code…", Cancel', async () => {
    render(<Gate view={{ kind: 'waiting-code', code: null }} onSignInWithCode={onSignInWithCode} />);
    expect(screen.getByRole('heading', { name: 'Sign in with a code' })).toBeInTheDocument();
    expect(screen.getByText('Getting a code…')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('Waiting for approval…')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(account.cancelSignIn).toHaveBeenCalled();
  });

  it('revoked: "This Mac was signed out", Sign in again, footer "Signed out"', async () => {
    render(<Gate view={{ kind: 'revoked' }} onSignInWithCode={onSignInWithCode} />);
    expect(screen.getByRole('heading', { name: 'This Mac was signed out' })).toBeInTheDocument();
    expect(screen.getByText('It was removed from your account.')).toBeInTheDocument();
    expect(screen.getByText('Signed out')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(account.signIn).toHaveBeenCalled();
  });

  it('welcome: the first name, Start trial with "No card needed.", Choose a plan, the footer', async () => {
    startTrial.mockResolvedValue({ ok: true });
    render(<Gate view={{ kind: 'welcome', firstName: 'Ana', email: 'ana@example.com' }} onSignInWithCode={onSignInWithCode} />);
    expect(screen.getByRole('heading', { name: 'Welcome, Ana' })).toBeInTheDocument();
    expect(screen.getByText('No card needed.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start 14-day free trial' }));
    expect(startTrial).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Choose a plan' }));
    expect(choose.start).toHaveBeenCalled();
    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(account.signOut).toHaveBeenCalled(); // no confirm on the gate
  });

  it.each(['trial_used', 'already_subscribed'])('a 409 %s hides Start trial for good', async (code) => {
    startTrial.mockResolvedValue({ error: code });
    const view = { kind: 'welcome' as const, firstName: 'Ana', email: 'a@b.c' };
    const { unmount } = render(<Gate view={view} onSignInWithCode={onSignInWithCode} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start 14-day free trial' }));
    expect(screen.queryByRole('button', { name: 'Start 14-day free trial' })).toBeNull();
    expect(screen.queryByText('No card needed.')).toBeNull();
    unmount();
    render(<Gate view={view} onSignInWithCode={onSignInWithCode} />);
    expect(screen.queryByRole('button', { name: 'Start 14-day free trial' })).toBeNull();
  });

  it('any other trial failure shows its sentence and keeps the button', async () => {
    startTrial.mockResolvedValue({ error: "The trial didn't start. Try again." });
    render(<Gate view={{ kind: 'welcome', firstName: 'Ana', email: 'a@b.c' }} onSignInWithCode={onSignInWithCode} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start 14-day free trial' }));
    expect(screen.getByText("The trial didn't start. Try again.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start 14-day free trial' })).toBeInTheDocument();
  });

  it('Choose a plan waiting: "Finish in your browser…" with Cancel', async () => {
    choose.waiting = true;
    render(<Gate view={{ kind: 'welcome', firstName: 'Ana', email: 'a@b.c' }} onSignInWithCode={onSignInWithCode} />);
    expect(screen.getByText('Finish in your browser…')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(choose.cancel).toHaveBeenCalled();
  });

  it('a plan page that would not open says why', () => {
    choose.error = "HiveTTY couldn't open that page. Try again.";
    render(<Gate view={{ kind: 'welcome', firstName: 'Ana', email: 'a@b.c' }} onSignInWithCode={onSignInWithCode} />);
    expect(screen.getByText("HiveTTY couldn't open that page. Try again.")).toBeInTheDocument();
  });
});
