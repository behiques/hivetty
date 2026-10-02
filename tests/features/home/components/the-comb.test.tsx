import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '@/types/entity';
import { TheComb } from '@features/home/components/the-comb';
import { COMB_W, layoutComb } from '@lib/swarm/comb';
import { useAppearanceStore } from '@stores/appearance-store';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';
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

describe('TheComb — hover, click and the hidden list', () => {
  const seed = (n: number) => {
    const entities = Object.fromEntries(Array.from({ length: n }, (_, i) => [`s${i}`, sess(`s${i}`, i === 0 ? 'waiting' : 'idle')]));
    useHiveStore.setState({ entities, order: Object.keys(entities), agentOrder: [] });
    return layoutComb(Object.keys(entities).map((id, i) => ({ id, name: id, project: 'p1', state: i === 0 ? 'summons' : 'burrowed' })), []);
  };
  const canvas = () => screen.getByRole('img') as HTMLCanvasElement;

  beforeEach(() => {
    useUiStore.getState().reset();
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { left: 0, top: 0, width: COMB_W, height: 520, right: COMB_W, bottom: 520, x: 0, y: 0, toJSON: () => ({}) } as DOMRect,
    );
  });

  it('shows a tooltip over a cell, and hides it on leave', () => {
    const layout = seed(2);
    render(<TheComb label="x" />);
    const cell = layout.cells.find((c) => c.id === 's0')!;
    fireEvent.mouseMove(canvas(), { clientX: cell.x + 5, clientY: cell.y });
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('s0');
    expect(tip).toHaveTextContent('Summons · p1');
    expect(tip).toHaveTextContent('needs input');
    fireEvent.mouseLeave(canvas());
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens a session cell on click', () => {
    const layout = seed(2);
    const openEntity = vi.fn(() => true);
    useHiveStore.setState({ openEntity });
    render(<TheComb label="x" />);
    const cell = layout.cells.find((c) => c.id === 's1')!;
    fireEvent.click(canvas(), { clientX: cell.x, clientY: cell.y });
    expect(openEntity).toHaveBeenCalledWith('s1');
  });

  it('opens Sessions on its project from a rest cell', () => {
    const layout = seed(9); // nine in one normal patch: six shown and "+3"
    render(<TheComb label="x" />);
    const rest = layout.cells.find((c) => c.kind === 'rest')!;
    fireEvent.mouseMove(canvas(), { clientX: rest.x, clientY: rest.y });
    expect(screen.getByRole('tooltip')).toHaveTextContent('3 more in p1');
    fireEvent.click(canvas(), { clientX: rest.x, clientY: rest.y });
    expect(useUiStore.getState()).toMatchObject({ place: 'sessions', sessionsProject: 'p1' });
  });

  it('mirrors every cell, in order, as a hidden button', () => {
    const layout = seed(2);
    const openEntity = vi.fn(() => true);
    useHiveStore.setState({ openEntity });
    render(<TheComb label="x" />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(layout.cells.length);
    expect(buttons[0]).toHaveAccessibleName('s0, Summons · p1, needs input');
    fireEvent.click(buttons[1]!);
    expect(openEntity).toHaveBeenCalledWith('s1');
  });
});
