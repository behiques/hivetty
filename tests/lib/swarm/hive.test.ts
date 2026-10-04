import { afterEach, describe, expect, it, vi } from 'vitest';

import { growHive, HIVE, hiveAnatomy } from '@lib/swarm/hive';
import { spRgb, toneOf } from '@lib/swarm/tone';
import { BUILT_IN_THEME } from '@lib/theme/built-in';
import { swarmPaletteOf } from '@lib/theme/colour';
import { coloursUsed, recordingContext, type Recorded } from '@tests/support/canvas-2d';

const DARK = toneOf(swarmPaletteOf(BUILT_IN_THEME.modes.dark.ui));
const LIGHT = toneOf(swarmPaletteOf(BUILT_IN_THEME.modes.light.ui));

/**
 * The window is drawn on its own layer, cached per canvas size, so every
 * recording gets a canvas size no other test has used.
 */
let size = 100;

/** Stub `OffscreenCanvas` so the window layer records into `layer`. */
function stubOffscreen(): { layer: Recorded[]; made: ReturnType<typeof vi.fn> } {
  const { ctx, calls } = recordingContext();
  const made = vi.fn();
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        made(w, h);
        this.width = w;
        this.height = h;
      }
      getContext(): CanvasRenderingContext2D {
        return ctx;
      }
    },
  );
  return { layer: calls, made };
}

function record(t: number, s: number, T = DARK, canvas: object = { width: size, height: size }): Recorded[] {
  const { ctx, calls } = recordingContext();
  Object.defineProperty(ctx, 'canvas', { value: canvas });
  HIVE.draw(ctx, t, s, T);
  return calls;
}

const ops = (calls: Recorded[]): string[] => calls.map((c) => c.op);
const balanced = (calls: Recorded[]): void => {
  const o = ops(calls);
  expect(o.filter((op) => op === 'save')).toHaveLength(o.filter((op) => op === 'restore').length);
};

afterEach(() => {
  vi.unstubAllGlobals();
  size += 1;
});

describe('the hive', () => {
  it('ports the artifact’s loop, still frame and box', () => {
    expect(HIVE.dur).toBe(10);
    expect(HIVE.rest).toBe(8.8);
    expect(HIVE.box).toEqual([-140, -104, 280, 224]);
  });

  it.each([
    [0, 0.5],
    [5, 0.5],
    [8.8, 0.5],
    [0, 2.4],
    [5, 2.4],
    [8.8, 2.4],
  ])('draws at t = %s, s = %s with save and restore balanced, on both layers', (t, s) => {
    for (const T of [DARK, LIGHT]) {
      const { layer } = stubOffscreen();
      size += 1;
      const calls = record(t, s, T);
      expect(calls.length).toBeGreaterThan(100);
      balanced(calls);
      expect(layer.length).toBeGreaterThan(50);
      balanced(layer);
    }
  });

  it('draws more detail above the s > 1.1 threshold', () => {
    stubOffscreen();
    expect(record(2, 2.4).length).toBeGreaterThan(record(2, 0.5).length);
  });

  it('paints every colour from the tone, as rgba strings, on both layers', () => {
    const { layer } = stubOffscreen();
    for (const t of [0, 2.5, 5.5, 8.8]) {
      const colours = [...coloursUsed(record(t, 2.4)), ...coloursUsed(layer)];
      expect(colours.length).toBeGreaterThan(0);
      for (const c of colours) expect(c).toMatch(/^rgba\(\d+,\d+,\d+,[-\d.e]+\)$/);
    }
  });

  it('builds its growths from the theme’s mineral ramp', () => {
    stubOffscreen();
    expect(coloursUsed(record(8.8, 2.4))).toContain(spRgb(DARK.mineralLit, 0.36));
  });

  it('glows additively on dark and tints on light', () => {
    stubOffscreen();
    const modes = (T = DARK): unknown[] =>
      record(5.5, 2.4, T)
        .filter((c) => c.op === 'set:globalCompositeOperation')
        .map((c) => c.args[0]);
    expect(modes(DARK)).toContain('lighter');
    expect(modes(LIGHT)).not.toContain('lighter');
  });

  it.each([0, 2.5, 5.5, 8.8])('closes its loop: t = %s and t + dur record the same op stream', (t) => {
    stubOffscreen();
    expect(ops(record(t + HIVE.dur, 2.4))).toEqual(ops(record(t, 2.4)));
  });

  it('draws the window on one offscreen layer per canvas size, and composites it once', () => {
    const { made } = stubOffscreen();
    const calls = record(5, 2.4, DARK, { width: 640, height: 512 });
    record(6, 2.4, DARK, { width: 640, height: 512 });
    expect(made).toHaveBeenCalledTimes(1);
    expect(made).toHaveBeenCalledWith(640, 512);
    expect(ops(calls).filter((op) => op === 'drawImage')).toHaveLength(1);
    record(5, 2.4, DARK, { width: 320, height: 256 });
    expect(made).toHaveBeenCalledTimes(2);
  });

  it('falls back to a document canvas where there is no OffscreenCanvas', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    const { ctx: layer, calls: layerCalls } = recordingContext();
    const createElement = vi.fn(() => ({ width: 0, height: 0, getContext: () => layer }));
    record(5, 2.4, DARK, { width: 333, height: 222, ownerDocument: { createElement } });
    expect(createElement).toHaveBeenCalledWith('canvas');
    expect(layerCalls.length).toBeGreaterThan(50);
  });

  it('grows its anatomy once, seeded', () => {
    const a = hiveAnatomy();
    expect(hiveAnatomy()).toBe(a);
    expect(growHive()).toEqual(a);
    expect(a.lobes).toHaveLength(7);
    expect(a.roots).toHaveLength(14);
    expect(a.growths).toHaveLength(2);
    expect(a.growths[0]!.branches).toHaveLength(2);
    expect(a.nodes.length).toBeGreaterThan(140);
  });
});
