import { act, fireEvent, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '@/types/entity';
import type { AgentSummary } from '@shared/agent-contract';
import { RELAYOUT_MS, TheComb, TOOLTIP_MAX_W, TOOLTIP_SPARE, tooltipLeft } from '@features/home/components/the-comb';
import { COMB_W, layoutComb } from '@lib/swarm/comb';
import { resetSwarmsState } from '@/lib/swarms';
import { installedSwarm, swarmItem, swarmListing } from '@tests/support/swarms';
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

// The loop's own rules (on screen, visible, unmount) are useCanvasLoop's, and
// tested there; these hold the comb's use of it.
describe('TheComb — the loop', () => {
  it('labels the canvas and sizes it to the logical aspect', () => {
    const { getByRole } = render(<TheComb label="1 thing needs you" />);
    const canvas = getByRole('img', { name: '1 thing needs you' }) as HTMLCanvasElement;
    expect(canvas.width).toBe(COMB_W * Math.min(2, window.devicePixelRatio || 1));
  });

  it('paints a frame and asks for the next', () => {
    render(<TheComb label="x" />);
    FakeIntersectionObserver.last!.fire(true);
    const before = fills();
    act(() => raf.mock.calls[0]![0](16));
    expect(fills()).toBe(before + 1);
    expect(raf).toHaveBeenCalledTimes(2);
  });

  it('draws one still frame under reduced motion and schedules nothing', () => {
    motion.reduced = true;
    render(<TheComb label="x" />);
    FakeIntersectionObserver.last?.fire(true);
    expect(raf).not.toHaveBeenCalled();
    expect(fills()).toBeGreaterThan(0);
  });

  it('stops the loop when reduced motion turns on, and starts it when it turns off', () => {
    const { rerender } = render(<TheComb label="x" />);
    const running = FakeIntersectionObserver.last!;
    running.fire(true);
    expect(raf).toHaveBeenCalled();

    motion.reduced = true;
    rerender(<TheComb label="x" />);
    expect(caf).toHaveBeenCalledWith(1);
    // No new loop is wired up: nothing observes the canvas for a frame to start.
    expect(FakeIntersectionObserver.last).toBe(running);
    raf.mockClear();
    rerender(<TheComb label="x" />);
    expect(raf).not.toHaveBeenCalled();

    motion.reduced = false;
    rerender(<TheComb label="x" />);
    FakeIntersectionObserver.last?.fire(true);
    expect(raf).toHaveBeenCalled();
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

  it('shows the focused cell: its tooltip, and a ring on the canvas (HIVE-223)', () => {
    seed(2);
    render(<TheComb label="x" />);
    const button = screen.getAllByRole('button')[0]!;
    act(() => button.focus());
    expect(screen.getByRole('tooltip')).toHaveTextContent('s0');
    act(() => button.blur());
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

  it('commits nothing for a move inside the same cell, and follows a move to another (HIVE-224)', () => {
    const layout = seed(2);
    const commits = vi.fn();
    render(
      <Profiler id="comb" onRender={commits}>
        <TheComb label="x" />
      </Profiler>,
    );
    const s0 = layout.cells.find((c) => c.id === 's0')!;
    const s1 = layout.cells.find((c) => c.id === 's1')!;
    fireEvent.mouseMove(canvas(), { clientX: s0.x + 5, clientY: s0.y });
    const settled = commits.mock.calls.length;
    fireEvent.mouseMove(canvas(), { clientX: s0.x + 6, clientY: s0.y + 1 });
    fireEvent.mouseMove(canvas(), { clientX: s0.x + 4, clientY: s0.y - 1 });
    expect(commits).toHaveBeenCalledTimes(settled);
    fireEvent.mouseMove(canvas(), { clientX: s1.x + 5, clientY: s1.y });
    expect(commits.mock.calls.length).toBeGreaterThan(settled);
    expect(screen.getByRole('tooltip')).toHaveTextContent('s1');
  });

  it('focusing the cell already hovered moves only the ring, not the hover', () => {
    const layout = seed(2);
    render(<TheComb label="x" />);
    const s0 = layout.cells.find((c) => c.id === 's0')!;
    fireEvent.mouseMove(canvas(), { clientX: s0.x + 5, clientY: s0.y });
    const tip = screen.getByRole('tooltip');
    act(() => screen.getAllByRole('button')[0]!.focus());
    expect(screen.getByRole('tooltip')).toBe(tip);
  });
});

describe('TheComb — the cells that fold others (decision D6)', () => {
  const agentSummary = (name: string): AgentSummary => ({
    name, description: '', icon: 'Robot', status: 'working', wake: { on: [] }, mcp: [], tools: [], skills: [], rotateAfter: 50, runs: [],
  });

  beforeEach(() => {
    useUiStore.getState().reset();
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { left: 0, top: 0, width: COMB_W, height: 520, right: COMB_W, bottom: 520, x: 0, y: 0, toJSON: () => ({}) } as DOMRect,
    );
  });

  afterEach(() => {
    resetSwarmsState();
    delete (window as unknown as { hive?: unknown }).hive;
  });

  it('opens Agents from the swarm\'s "+N" cell', () => {
    useHiveStore.setState({ entities: {}, order: [], agentOrder: [] });
    act(() => useHiveStore.getState().hydrateAgents(Array.from({ length: 16 }, (_, i) => agentSummary(`agent-${i}`))));
    render(<TheComb label="x" />);
    fireEvent.click(screen.getByRole('button', { name: /^10 more in The swarm/ }));
    expect(useUiStore.getState().place).toBe('agents');
  });

  it('draws one patch per installed swarm, and none called THE SWARM, once the listing loads (HIVE-454)', async () => {
    const names = Array.from({ length: 16 }, (_, i) => `agent-${i}`);
    const listing = swarmListing([
      swarmItem({
        installed: installedSwarm({
          swarmId: 'sq1', title: 'Dev Squad',
          contents: { agents: names.map((name) => ({ name, description: '', tools: [] })), skills: [] },
        }),
      }),
    ]);
    (window as unknown as { hive?: unknown }).hive = {
      swarms: { list: vi.fn(() => Promise.resolve(listing)), onChanged: vi.fn(() => () => undefined) },
    };
    useHiveStore.setState({ entities: {}, order: [], agentOrder: [] });
    act(() => useHiveStore.getState().hydrateAgents(names.map(agentSummary)));
    render(<TheComb label="x" />);
    const rest = await screen.findByRole('button', { name: /^10 more in Dev Squad/ });
    expect(screen.getByRole('button', { name: /^agent-0, / })).toBeInTheDocument();
    FakeIntersectionObserver.last!.fire(true);
    const from = rec.calls.length;
    act(() => raf.mock.calls.at(-1)![0](16));
    const texts = rec.calls.slice(from).filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    expect(texts).toContain('DEV SQUAD');
    expect(texts).not.toContain('THE SWARM');
    fireEvent.click(rest);
    expect(useUiStore.getState().place).toBe('agents');
  });

  it('opens Sessions on every project from the "+N projects" cell', () => {
    const entities = Object.fromEntries(
      Array.from({ length: 13 }, (_, i) => [`s${i}`, { ...sess(`s${i}`, 'idle'), project: `p${i}` }]),
    );
    useHiveStore.setState({ entities, order: Object.keys(entities), agentOrder: [] });
    act(() => useUiStore.getState().setSessionsProject('p0'));
    render(<TheComb label="x" />);
    fireEvent.click(screen.getByRole('button', { name: /^4 more projects/ }));
    expect(useUiStore.getState()).toMatchObject({ place: 'sessions', sessionsProject: null });
  });

  it('does nothing over empty comb', () => {
    const openEntity = vi.fn(() => true);
    useHiveStore.setState({ openEntity });
    render(<TheComb label="x" />);
    fireEvent.mouseMove(screen.getByRole('img'), { clientX: 5, clientY: 5 });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(screen.getByRole('img'), { clientX: 5, clientY: 5 });
    expect(openEntity).not.toHaveBeenCalled();
  });

  it('draws a working cell to its plan, and steps on real elapsed time', () => {
    act(() =>
      useHiveStore.getState().setPlan('a', {
        entityId: 'a', source: 'task-tools', allDone: false,
        tasks: [{ id: '1', title: 'x', status: 'completed' }, { id: '2', title: 'y', status: 'pending' }],
      }),
    );
    render(<TheComb label="x" />);
    FakeIntersectionObserver.last!.fire(true);
    const before = rec.calls.filter((c) => c.op === 'fillRect').length;
    act(() => raf.mock.calls[0]![0](16));
    // A 30fps frame apart: the loop skips paints closer than that (HIVE-225).
    act(() => raf.mock.calls[1]![0](50));
    expect(rec.calls.filter((c) => c.op === 'fillRect').length).toBe(before + 2);
  });
});

describe('TheComb — the stage width (HIVE-454)', () => {
  class FakeResizeObserver {
    static all: FakeResizeObserver[] = [];
    observe = vi.fn();
    disconnect = vi.fn();
    callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
      FakeResizeObserver.all.push(this);
    }
  }
  /** The comb's own observer, on its wrapper; the canvas loop keeps another on the canvas. */
  const wrapper = () =>
    FakeResizeObserver.all.findLast((o) => o.observe.mock.calls.some(([el]) => el instanceof HTMLDivElement))!;
  let stage = 1000;

  beforeEach(() => {
    FakeResizeObserver.all = [];
    stage = 1000;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ left: 0, top: 0, width: stage, height: 520, right: stage, bottom: 520, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    );
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const aspect = () => (screen.getByRole('img') as HTMLCanvasElement).style.aspectRatio;

  it('lays out for the measured width on the first render', () => {
    render(<TheComb label="x" />);
    expect(aspect()).toBe('1000 / 520');
    expect(wrapper().observe).toHaveBeenCalledTimes(1);
  });

  it('clamps a narrow or unmeasured stage', () => {
    stage = 300;
    const { unmount } = render(<TheComb label="x" />);
    expect(aspect()).toBe('640 / 520');
    unmount();
    stage = 0;
    render(<TheComb label="x" />);
    expect(aspect()).toBe('1376 / 520');
  });

  it('relays out only after the resize has settled for RELAYOUT_MS', () => {
    vi.useFakeTimers();
    render(<TheComb label="x" />);
    stage = 900;
    act(() => wrapper().callback());
    act(() => vi.advanceTimersByTime(100));
    stage = 760;
    act(() => wrapper().callback());
    act(() => vi.advanceTimersByTime(RELAYOUT_MS - 1));
    expect(aspect()).toBe('1000 / 520');
    act(() => vi.advanceTimersByTime(1));
    expect(aspect()).toBe('760 / 520');
  });

  it('clears the pending relayout and disconnects on unmount', () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = render(<TheComb label="x" />);
    const observer = wrapper();
    stage = 760;
    act(() => observer.callback());
    clear.mockClear();
    unmount();
    expect(clear).toHaveBeenCalled();
    expect(observer.disconnect).toHaveBeenCalled();
    const measured = vi.mocked(HTMLDivElement.prototype.getBoundingClientRect);
    measured.mockClear();
    act(() => vi.advanceTimersByTime(RELAYOUT_MS));
    // The pending relayout never runs: nothing measures the unmounted wrapper.
    expect(measured).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it('measures once without a ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    render(<TheComb label="x" />);
    expect(aspect()).toBe('1000 / 520');
  });

  it('keeps the tooltip inside a 1000-wide canvas', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { left: 0, top: 0, width: 1000, height: 520, right: 1000, bottom: 520, x: 0, y: 0, toJSON: () => ({}) } as DOMRect,
    );
    const entities = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`s${i}`, sess(`s${i}`, 'idle')]));
    useHiveStore.setState({ entities, order: Object.keys(entities), agentOrder: [] });
    render(<TheComb label="x" />);
    const layout = layoutComb(Object.keys(entities).map((id) => ({ id, name: id, project: 'p1', state: 'burrowed' })), [], { width: 1000 });
    const last = layout.cells.at(-1)!;
    fireEvent.mouseMove(screen.getByRole('img'), { clientX: last.x, clientY: last.y });
    const left = Number.parseFloat(screen.getByRole('tooltip').style.left);
    expect(left).toBeLessThanOrEqual(1000 - TOOLTIP_MAX_W - TOOLTIP_SPARE);
  });
});

describe('tooltipLeft (HIVE-225)', () => {
  it('clamps to the layout width it is given (HIVE-454)', () => {
    expect(tooltipLeft(990, 1, 1000)).toBe(1000 - TOOLTIP_MAX_W - TOOLTIP_SPARE);
  });

  it('keeps a 240px tooltip inside the canvas at the 1100px window scale', () => {
    const k = 0.75;
    expect(tooltipLeft(COMB_W - 10, k) + TOOLTIP_MAX_W).toBeLessThanOrEqual(COMB_W * k);
  });
  it('sits 18 canvas units right of a cell away from the edge', () => {
    expect(tooltipLeft(100, 0.5)).toBe(59);
  });

  it('never places the tooltip left of the canvas, however narrow (HIVE-226)', () => {
    const k = 100 / COMB_W; // a 100px canvas, narrower than the tooltip itself
    expect(tooltipLeft(COMB_W - 10, k)).toBe(0);
  });

  it('keeps the tooltip TOOLTIP_SPARE short of the right edge', () => {
    const k = 0.75;
    expect(tooltipLeft(COMB_W - 10, k)).toBe(COMB_W * k - TOOLTIP_MAX_W - TOOLTIP_SPARE);
  });
});
