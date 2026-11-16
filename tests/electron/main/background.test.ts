// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The background switch: a launcher-set `HIVE_BACKGROUND=1` keeps a test run
 * from taking the person's focus. Without it, every path is today's.
 */

const setActivationPolicy = vi.fn();

vi.mock('electron', () => ({
  app: { setActivationPolicy: (policy: string) => setActivationPolicy(policy) },
}));

const { applyBackgroundPolicy, bringForward, isBackground, reveal } = await import(
  '../../../electron/main/background'
);

function fakeWindow() {
  return { show: vi.fn(), showInactive: vi.fn(), focus: vi.fn() };
}

beforeEach(() => {
  setActivationPolicy.mockClear();
});

describe('isBackground', () => {
  it('is off for an ordinary launch', () => {
    expect(isBackground({})).toBe(false);
  });

  it('is on when the launcher sets HIVE_BACKGROUND=1', () => {
    expect(isBackground({ HIVE_BACKGROUND: '1' })).toBe(true);
  });

  it('stays off for any other value, so a stray 0 cannot turn it on', () => {
    expect(isBackground({ HIVE_BACKGROUND: '0' })).toBe(false);
    expect(isBackground({ HIVE_BACKGROUND: '' })).toBe(false);
  });

  it('reads process.env by default', () => {
    const before = process.env.HIVE_BACKGROUND;
    process.env.HIVE_BACKGROUND = '1';
    try {
      expect(isBackground()).toBe(true);
    } finally {
      if (before === undefined) delete process.env.HIVE_BACKGROUND;
      else process.env.HIVE_BACKGROUND = before;
    }
  });
});

describe('reveal', () => {
  it('shows the window as today without the switch', () => {
    const win = fakeWindow();
    reveal(win, {});
    expect(win.show).toHaveBeenCalledOnce();
    expect(win.showInactive).not.toHaveBeenCalled();
  });

  it('shows the window inactive with the switch', () => {
    const win = fakeWindow();
    reveal(win, { HIVE_BACKGROUND: '1' });
    expect(win.showInactive).toHaveBeenCalledOnce();
    expect(win.show).not.toHaveBeenCalled();
  });
});

describe('bringForward', () => {
  it('focuses the window as today without the switch', () => {
    const win = fakeWindow();
    bringForward(win, {});
    expect(win.focus).toHaveBeenCalledOnce();
    expect(win.showInactive).not.toHaveBeenCalled();
  });

  it('never focuses with the switch; the window is shown inactive instead', () => {
    const win = fakeWindow();
    bringForward(win, { HIVE_BACKGROUND: '1' });
    expect(win.focus).not.toHaveBeenCalled();
    expect(win.showInactive).toHaveBeenCalledOnce();
  });
});

describe('applyBackgroundPolicy', () => {
  it('makes the app an accessory on macOS with the switch: no Dock icon, never frontmost', () => {
    applyBackgroundPolicy('darwin', { HIVE_BACKGROUND: '1' });
    expect(setActivationPolicy).toHaveBeenCalledWith('accessory');
  });

  it('does nothing on macOS without the switch', () => {
    applyBackgroundPolicy('darwin', {});
    expect(setActivationPolicy).not.toHaveBeenCalled();
  });

  it('does nothing off macOS, where the policy does not exist', () => {
    applyBackgroundPolicy('linux', { HIVE_BACKGROUND: '1' });
    expect(setActivationPolicy).not.toHaveBeenCalled();
  });
});
