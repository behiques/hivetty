import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { drawMuta, spineNodes } from '@lib/swarm/muta';
import type { SwarmPalette } from '@lib/swarm/palette';
import { coloursUsed, recordingContext } from '@tests/support/canvas-2d';

import { LOG_SCHEDULE } from '@/splash/chamber';
import {
  cellAt,
  cellLight,
  drawGlobe,
  FLYER_COUNT,
  flyerAt,
  flyerStart,
  GLOBE_CELLS,
  GLOBE_R,
  GLOBE_STILL_T,
  heartAt,
  LIGHT_AT,
  ORBIT_AT,
  orbitPoint,
} from '@/splash/globe';

vi.mock('@lib/swarm/muta', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/swarm/muta')>()),
  drawMuta: vi.fn(),
}));

describe('the globe cells', () => {
  it('are ninety points on the unit sphere', () => {
    expect(GLOBE_CELLS).toHaveLength(90);
    for (const { x, y, z } of GLOBE_CELLS) expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
  });

  it('scatter within ±1.2 and start within half a second of each other', () => {
    for (const { sx, sy, d } of GLOBE_CELLS) {
      expect(Math.abs(sx)).toBeLessThanOrEqual(1.2);
      expect(Math.abs(sy)).toBeLessThanOrEqual(1.2);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(0.5);
    }
  });

  it('light 4 green, 3 violet and 2 amber, as the log lines say', () => {
    const count = (kind: string) => GLOBE_CELLS.filter((c) => c.kind === kind).length;
    expect([count('green'), count('violet'), count('amber')]).toEqual([4, 3, 2]);
  });

  it('light each colour at its log line', () => {
    expect(LIGHT_AT).toEqual({ green: LOG_SCHEDULE[0], violet: LOG_SCHEDULE[2], amber: LOG_SCHEDULE[3] });
    for (const cell of GLOBE_CELLS.filter((c) => c.kind !== null)) {
      const at = LIGHT_AT[cell.kind!];
      expect(cellLight(cell, at - 0.01)).toBe(0);
      expect(cellLight(cell, at + 0.4)).toBe(1);
    }
  });

  it('never lights an unlit cell', () => {
    expect(cellLight(GLOBE_CELLS.find((c) => c.kind === null)!, 10)).toBe(0);
  });

  it('drift in from the scatter and close into the globe', () => {
    const cell = GLOBE_CELLS[45]!;
    expect(cellAt(cell, 0.3).formed).toBe(0);
    expect(cellAt(cell, 0.3).X).toBeCloseTo(cell.sx * 2.2 * GLOBE_R, 9);
    const formed = cellAt(cell, 2.2);
    expect(formed.formed).toBe(1);
    for (const c of GLOBE_CELLS) {
      const p = cellAt(c, 3);
      expect(Math.hypot(p.X, p.Y)).toBeLessThanOrEqual(GLOBE_R + 1e-9);
      expect(p.depth).toBeGreaterThanOrEqual(0);
      expect(p.depth).toBeLessThanOrEqual(1);
    }
  });

  it('turns: the same cell is somewhere else a second later', () => {
    const cell = GLOBE_CELLS[20]!;
    expect(cellAt(cell, 4).X).not.toBeCloseTo(cellAt(cell, 5).X, 3);
  });
});

describe('the orbit', () => {
  it('is in front at π/2 and behind at 3π/2', () => {
    expect(orbitPoint(Math.PI / 2)[2]).toBeGreaterThan(0);
    expect(orbitPoint((3 * Math.PI) / 2)[2]).toBeLessThan(0);
  });

  it('draws at "hive cluster online"', () => {
    expect(ORBIT_AT).toBe(LOG_SCHEDULE[4]);
  });
});

describe('the flyers', () => {
  it('are seven, one every 0.16s from 2.63s', () => {
    expect(FLYER_COUNT).toBe(7);
    for (let i = 0; i < FLYER_COUNT; i++) expect(flyerStart(i)).toBeCloseTo(2.63 + 0.16 * i, 9);
  });

  it('appear at the centre and climb to their slot in 0.75s', () => {
    for (let i = 0; i < FLYER_COUNT; i++) {
      const born = flyerAt(i, flyerStart(i));
      expect(born.x).toBeCloseTo(0, 9);
      expect(born.y).toBeCloseTo(0, 9);
      expect(born.alpha).toBe(0);
      expect(born.climbing).toBe(true);

      const slot = orbitPoint(-Math.PI / 2 + (i * 2 * Math.PI) / 7);
      const landed = flyerAt(i, flyerStart(i) + 0.75);
      expect(landed.x).toBeCloseTo(slot[0], 6);
      expect(landed.y).toBeCloseTo(slot[1], 6);
      expect(landed.climbing).toBe(false);
      expect(landed.alpha).toBe(1);
    }
  });

  it('circle the orbit once landed', () => {
    const a = flyerAt(0, 4);
    const b = flyerAt(0, 5);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1);
  });

  it('are all out by the still the splash holds under reduced motion', () => {
    expect(GLOBE_STILL_T).toBeGreaterThanOrEqual(flyerStart(FLYER_COUNT - 1) + 0.75);
    for (let i = 0; i < FLYER_COUNT; i++) expect(flyerAt(i, GLOBE_STILL_T).climbing).toBe(false);
  });
});

describe('the heart', () => {
  it('is dark before 2.43s and after 4.95s, and glows between', () => {
    expect(heartAt(2.42)).toBe(0);
    expect(heartAt(3.5)).toBeGreaterThan(0.99);
    expect(heartAt(4.95)).toBe(0);
    expect(heartAt(6)).toBe(0);
  });
});

const PALETTE: SwarmPalette = {
  bg: 'c-bg',
  panel2: 'c-panel2',
  ink: 'c-ink',
  muted: 'c-muted',
  subtle: 'c-subtle',
  brand: 'c-brand',
  green: 'c-green',
  amber: 'c-amber',
  red: 'c-red',
  creep: 'c-creep',
  creepClear: 'c-creep-clear',
  chitin: 'c-chitin',
  carapace: 'c-carapace',
  tissueDeep: 'c-tissue-deep',
  tissue: 'c-tissue',
  tissueLit: 'c-tissue-lit',
  glowCore: 'c-glow-core',
  ground: 'c-ground',
  membrane: 'c-membrane',
  maw: 'c-maw',
  gum: 'c-gum',
  stain: 'c-stain',
  glint: 'c-glint',
};

describe('drawGlobe', () => {
  const draw = (t: number) => {
    vi.mocked(drawMuta).mockClear();
    const { ctx, calls } = recordingContext();
    drawGlobe(ctx, t, PALETTE);
    return { ctx, calls, count: (op: string) => calls.filter((c) => c.op === op).length };
  };

  it('draws all ninety cells, and no creature, while the globe forms', () => {
    const { count } = draw(0.2);
    expect(count('closePath')).toBe(90);
    expect(count('ellipse')).toBe(0);
    expect(drawMuta).not.toHaveBeenCalled();
  });

  it('draws both halves of the orbit once it is online', () => {
    expect(draw(2.2).count('ellipse')).toBe(0);
    expect(draw(3).count('ellipse')).toBe(2);
  });

  it('draws all seven flyers at the still, each on its own warmed spine', () => {
    draw(GLOBE_STILL_T);
    expect(drawMuta).toHaveBeenCalledTimes(7);
    for (const call of vi.mocked(drawMuta).mock.calls) {
      const [, spine, t, , turn, scale, , tone] = call;
      const [x, y] = spineNodes(spine)[0]!;
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      expect(t).toBe(GLOBE_STILL_T);
      expect(scale).toBeGreaterThanOrEqual(0.08);
      expect(scale).toBeLessThanOrEqual(0.13);
      expect(Number.isFinite(turn)).toBe(true);
      expect(tone).toMatchObject({ dark: expect.any(Boolean), lo: expect.any(Array) });
    }
  });

  it('puts each spine head where its flyer is', () => {
    draw(GLOBE_STILL_T);
    const heads = vi.mocked(drawMuta).mock.calls.map(([, spine]) => spineNodes(spine)[0]!);
    const flyers = Array.from({ length: FLYER_COUNT }, (_, i) => flyerAt(i, GLOBE_STILL_T));
    for (const [x, y] of heads) {
      expect(flyers.some((f) => Math.hypot(f.x - x, f.y - y) < 1e-6)).toBe(true);
    }
  });

  it('holds the same still frame on every read', () => {
    draw(GLOBE_STILL_T);
    const first = vi.mocked(drawMuta).mock.calls.map(([, spine]) => spineNodes(spine));
    draw(3.2);
    draw(GLOBE_STILL_T);
    expect(vi.mocked(drawMuta).mock.calls.map(([, spine]) => spineNodes(spine))).toEqual(first);
  });

  it('releases the flyers one at a time', () => {
    draw(flyerStart(2) + 0.01);
    expect(drawMuta).toHaveBeenCalledTimes(3);
  });

  it('paints only with palette colours, and puts the context back', () => {
    const { calls, ctx, count } = draw(3.2);
    const allowed = new Set(Object.values(PALETTE));
    for (const colour of coloursUsed(calls)) expect(allowed.has(colour as string)).toBe(true);
    for (const stop of calls.filter((c) => c.op === 'addColorStop')) expect(allowed.has(stop.args[1] as string)).toBe(true);
    expect(count('save')).toBe(count('restore'));
    expect(ctx.globalAlpha).toBe(1);
  });

  it('holds no colour literal', () => {
    const source = readFileSync(join(import.meta.dirname, '../../src/splash/globe.ts'), 'utf8');
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(/i);
  });
});
