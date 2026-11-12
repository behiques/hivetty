import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LedgerEntry } from '@shared/ledger-contract';

import { createPermissionReminder } from '../../../../electron/main/ledger/reminders';

const card = (id: string, ts: number): LedgerEntry => ({
  id,
  ts,
  from: 'shipper',
  to: 'overmind',
  kind: 'ask',
  body: 'Allow Bash?',
  meta: { kind: 'permission' },
});

describe('the permission reminder (HIVE-409)', () => {
  let cards: LedgerEntry[];
  let idle: number;
  const remind = vi.fn((_id: string) => true);

  beforeEach(() => {
    vi.useFakeTimers();
    cards = [card('a2', 20), card('a1', 10)];
    idle = 0;
    remind.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const make = () => createPermissionReminder({ openCards: () => cards, remind, idleSeconds: () => idle });

  it('reminds of the oldest card after fifteen active minutes, then counts again', () => {
    make().start();
    vi.advanceTimersByTime(14 * 60_000);
    expect(remind).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(remind).toHaveBeenCalledExactlyOnceWith('a1');
    vi.advanceTimersByTime(14 * 60_000);
    expect(remind).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(remind).toHaveBeenCalledTimes(2);
  });

  it('an idle minute does not count', () => {
    make().start();
    idle = 300;
    vi.advanceTimersByTime(60 * 60_000);
    expect(remind).not.toHaveBeenCalled();
  });

  it('no card resets the count', () => {
    make().start();
    vi.advanceTimersByTime(10 * 60_000);
    cards = [];
    vi.advanceTimersByTime(60_000);
    cards = [card('a3', 30)];
    vi.advanceTimersByTime(14 * 60_000);
    expect(remind).not.toHaveBeenCalled();
  });

  it('focus reminds at once and restarts the count', () => {
    const reminder = make();
    reminder.start();
    vi.advanceTimersByTime(10 * 60_000);
    reminder.onFocus();
    expect(remind).toHaveBeenCalledExactlyOnceWith('a1');
    vi.advanceTimersByTime(14 * 60_000);
    expect(remind).toHaveBeenCalledTimes(1);
  });

  it('focus with no card does nothing; stop clears the timer; start twice arms once', () => {
    cards = [];
    const reminder = make();
    reminder.start();
    reminder.start();
    reminder.onFocus();
    reminder.stop();
    reminder.stop();
    cards = [card('a1', 10)];
    vi.advanceTimersByTime(60 * 60_000);
    expect(remind).not.toHaveBeenCalled();
  });
});
