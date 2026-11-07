import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LicenceBanner } from '@features/account/components/licence-banner';
import { useUiStore } from '@stores/ui-store';

const licence = vi.hoisted(() => ({ current: null as unknown }));
const refreshLicence = vi.hoisted(() => vi.fn());
const choose = vi.hoisted(() => ({ waiting: false, error: null as string | null, start: vi.fn(), cancel: vi.fn() }));
vi.mock('@hooks/use-licence', () => ({ useLicence: () => licence.current }));
vi.mock('@lib/licence', async (real) => ({ ...(await real<object>()), refreshLicence }));
vi.mock('@features/account/hooks/use-choose-plan', () => ({ useChoosePlan: () => choose }));

const DAY = 86_400;
const NOW_S = Date.UTC(2026, 10, 7, 12) / 1000;
const trial = (trialEnds: number) => ({
  kind: 'licensed',
  plan: 'team',
  features: [],
  limits: {},
  exp: NOW_S + 30 * DAY,
  iat: NOW_S,
  trialEnds,
});

describe('LicenceBanner (HIVE-265)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW_S * 1000, shouldAdvanceTime: true });
    useUiStore.getState().reset();
    refreshLicence.mockReset().mockResolvedValue(null);
    Object.assign(choose, { waiting: false, error: null });
    choose.start.mockReset();
    choose.cancel.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('draws nothing with no licence', () => {
    licence.current = null;
    const { container } = render(<LicenceBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('trial at 3 days: the copy, Choose a plan, Dismiss records the threshold', async () => {
    licence.current = trial(NOW_S + 3 * DAY);
    render(<LicenceBanner />);
    expect(screen.getByText('Your trial ends in 3 days.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Choose a plan' }));
    expect(choose.start).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(useUiStore.getState().dismissedTrialThreshold).toBe(3);
    expect(screen.queryByText(/Your trial ends/)).toBeNull();
  });

  it('one day left reads "tomorrow"', async () => {
    licence.current = trial(NOW_S + 0.5 * DAY);
    render(<LicenceBanner />);
    expect(screen.getByText('Your trial ends tomorrow.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(useUiStore.getState().dismissedTrialThreshold).toBe(1);
    expect(screen.queryByText(/Your trial ends/)).toBeNull();
  });

  it('the last day reads "today"', () => {
    licence.current = trial(NOW_S - 60);
    render(<LicenceBanner />);
    expect(screen.getByText('Your trial ends today.')).toBeInTheDocument();
  });

  it('offline: "Offline for N days. Connect within M days to keep working." with Retry', async () => {
    licence.current = { ...trial(NOW_S + DAY), kind: 'grace', exp: NOW_S + 2 * DAY, iat: NOW_S - 28 * DAY };
    render(<LicenceBanner />);
    expect(screen.getByText('Offline for 28 days.')).toBeInTheDocument();
    expect(screen.getByText(/Connect within 2 days to keep working\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refreshLicence).toHaveBeenCalled();
  });

  it('offline with one day left says "day"', () => {
    licence.current = { ...trial(NOW_S + DAY), kind: 'grace', exp: NOW_S + 0.5 * DAY, iat: NOW_S - 29 * DAY };
    render(<LicenceBanner />);
    expect(screen.getByText(/Connect within 1 day to keep working\./)).toBeInTheDocument();
  });

  it('Choose a plan waiting says so, with Cancel', async () => {
    choose.waiting = true;
    licence.current = trial(NOW_S + 2 * DAY);
    render(<LicenceBanner />);
    expect(screen.getByText('Finish in your browser…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose a plan' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(choose.cancel).toHaveBeenCalled();
  });
});
