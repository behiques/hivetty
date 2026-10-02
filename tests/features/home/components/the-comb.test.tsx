import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '@/types/entity';
import { TheComb } from '@features/home/components/the-comb';
import { COMB_W } from '@lib/swarm/comb';
import { useAppearanceStore } from '@stores/appearance-store';
import { useHiveStore } from '@stores/hive-store';
import { recordingContext } from '@tests/support/canvas-2d';

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('@hooks/use-reduced-motion', () => ({ useReducedMotion: () => motion.reduced }));

class FakeIntersectionObserver {
  static last: FakeIntersectionObserver | undefined;
  observe = vi.fn();
  disconnect = vi.fn();
  callback: (entries: { isIntersecting: boolean }[]) => void;
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    this.callback = callback;
    FakeIntersectionObserver.last = this;
  }
  fire(isIntersecting: boolean) {
    act(() => this.callback([{ isIntersecting }]));
  }
}

const sess = (id: string, status: Session['status']): Session => ({
  kind: 'session', id, project: 'p1', branch: `b/${id}`, status, task: id, cost: '$0', lines: [],
});

let rec: ReturnType<typeof recordingContext>;
const raf = vi.fn((_cb: FrameRequestCallback) => 1);
const caf = vi.fn();
const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
};
const fills = () => rec.calls.filter((c) => c.op === 'fillRect').length;

beforeEach(() => {
  // A previous test's observer would otherwise answer `last`, and firing it
  // would drive that unmounted comb's callback.
  FakeIntersectionObserver.last = undefined;
  motion.reduced = false;
  rec = recordingContext();
  raf.mockClear();
  caf.mockClear();
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec.ctx as never);
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, get: () => COMB_W });
  useHiveStore.getState().reset();
  useHiveStore.setState({ entities: { a: sess('a', 'working'), b: sess('b', 'waiting') }, order: ['a', 'b'], agentOrder: [] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setHidden(false);
});

describe('TheComb — the loop', () => {
  it('labels the canvas and sizes it to the logical aspect', () => {
    const { getByRole } = render(<TheComb label="1 thing needs you" />);
    const canvas = getByRole('img', { name: '1 thing needs you' }) as HTMLCanvasElement;
    expect(canvas.width).toBe(COMB_W * Math.min(2, window.devicePixelRatio || 1));
  });

  it('starts only once the canvas is on screen', () => {
    render(<TheComb label="x" />);
    expect(raf).not.toHaveBeenCalled();
    FakeIntersectionObserver.last!.fire(true);
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('paints a frame and asks for the next', () => {
    render(<TheComb label="x" />);
    FakeIntersectionObserver.last!.fire(true);
    const before = fills();
    act(() => raf.mock.calls[0]![0](16));
    expect(fills()).toBe(before + 1);
    expect(raf).toHaveBeenCalledTimes(2);
  });

  it('pauses while the document is hidden and resumes when shown', () => {
    render(<TheComb label="x" />);
    FakeIntersectionObserver.last!.fire(true);
    setHidden(true);
    expect(caf).toHaveBeenCalledWith(1);
    raf.mockClear();
    setHidden(false);
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('stops when it leaves the viewport', () => {
    render(<TheComb label="x" />);
    FakeIntersectionObserver.last!.fire(true);
    FakeIntersectionObserver.last!.fire(false);
    expect(caf).toHaveBeenCalledWith(1);
  });

  it('stops on unmount', () => {
    const { unmount } = render(<TheComb label="x" />);
    FakeIntersectionObserver.last!.fire(true);
    unmount();
    expect(caf).toHaveBeenCalledWith(1);
    expect(FakeIntersectionObserver.last!.disconnect).toHaveBeenCalled();
  });

  it('draws one still frame under reduced motion and schedules nothing', () => {
    motion.reduced = true;
    render(<TheComb label="x" />);
    FakeIntersectionObserver.last?.fire(true);
    expect(raf).not.toHaveBeenCalled();
    expect(fills()).toBeGreaterThan(0);
  });

  it('repaints the still frame at once on a theme switch', () => {
    motion.reduced = true;
    act(() => useAppearanceStore.getState().setTheme('dark'));
    render(<TheComb label="x" />);
    const before = fills();
    act(() => useAppearanceStore.getState().setTheme('light'));
    expect(fills()).toBeGreaterThan(before);
  });
});
