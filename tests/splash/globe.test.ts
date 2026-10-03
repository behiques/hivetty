import { describe, expect, it } from 'vitest';

import { LOG_SCHEDULE } from '@/splash/chamber';
import { cellAt, cellLight, GLOBE_CELLS, GLOBE_R, LIGHT_AT } from '@/splash/globe';

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
