// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { keepAwake } from '../../../electron/main/keep-awake';

const fakeBlocker = () => {
  let next = 7;
  return { start: vi.fn(() => next++), stop: vi.fn() };
};

describe('keepAwake', () => {
  it('starts one blocker when runs go live and stops that id when they end, then starts afresh', () => {
    const blocker = fakeBlocker();
    const onLive = keepAwake(blocker);

    onLive(true);
    expect(blocker.start).toHaveBeenCalledExactlyOnceWith('prevent-app-suspension');

    onLive(false);
    expect(blocker.stop).toHaveBeenCalledExactlyOnceWith(7);

    onLive(true);
    onLive(false);
    expect(blocker.stop).toHaveBeenLastCalledWith(8);
  });

  it('starts nothing on a repeated live', () => {
    const blocker = fakeBlocker();
    const onLive = keepAwake(blocker);

    onLive(true);
    onLive(true);

    expect(blocker.start).toHaveBeenCalledOnce();
  });

  it('stops nothing when nothing was started', () => {
    const blocker = fakeBlocker();

    keepAwake(blocker)(false);

    expect(blocker.stop).not.toHaveBeenCalled();
  });
});
