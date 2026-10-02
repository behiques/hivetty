import { describe, expect, it } from 'vitest';

import type { SwarmPalette } from '@lib/swarm/palette';
import { drawMutalisk, REAL, tailSpine } from '@lib/swarm/mutalisk';
import { coloursUsed, recordingContext } from '@tests/support/canvas-2d';

const PALETTE: SwarmPalette = {
  bg: 'c-bg', panel2: 'c-panel2', ink: 'c-ink', muted: 'c-muted', subtle: 'c-subtle',
  brand: 'c-brand', green: 'c-green', amber: 'c-amber', red: 'c-red', creep: 'c-creep',
  creepClear: 'c-creep-clear', chitin: 'c-chitin', carapace: 'c-carapace',
};

describe('tailSpine', () => {
  it('has fourteen segments', () => {
    expect(tailSpine(0, 0, 0)).toHaveLength(14);
  });

  it('runs straight-ish back from the body with no turn', () => {
    const tip = tailSpine(0, 0, 0).at(-1)!;
    expect(tip[0]).toBeLessThan(-40);
    expect(Math.abs(tip[1])).toBeLessThan(15);
  });

  it('lags behind a turn: the tip swings with the sign of the turn', () => {
    const tip = (turn: number) => tailSpine(0, 0, turn).at(-1)![1];
    expect(tip(2)).toBeGreaterThan(tip(0));
    expect(tip(-2)).toBeLessThan(tip(0));
  });

  it('caps the bend, so a violent turn swings no wider than a hard one', () => {
    expect(tailSpine(0, 0, 50)).toEqual(tailSpine(0, 0, 1.8));
  });
});

describe('drawMutalisk', () => {
  const draw = () => {
    const { ctx, calls } = recordingContext();
    drawMutalisk(ctx, 100, 50, 1, 0, 1.3, REAL, { k: 0.7, turn: 0.4 }, PALETTE);
    return { ctx, calls, count: (op: string) => calls.filter((c) => c.op === op).length };
  };

  it('places itself and restores the context', () => {
    const { calls, count, ctx } = draw();
    expect(calls[0]).toEqual({ op: 'save', args: [] });
    expect(calls.find((c) => c.op === 'translate')?.args).toEqual([100, 50]);
    expect(calls.find((c) => c.op === 'scale')?.args).toEqual([REAL, REAL]);
    expect(count('save')).toBe(count('restore'));
    expect(ctx.globalAlpha).toBe(1);
  });

  it('draws the shadow, the holes and the body ellipses, the wings and the tail', () => {
    const { count } = draw();
    expect(count('ellipse')).toBe(1 + 4 + 3); // shadow, two holes per wing, torso and two plates
    expect(count('quadraticCurveTo')).toBeGreaterThan(40); // membrane, finger arc, talons, neck
    expect(count('lineTo')).toBeGreaterThan(14); // tail segments at least
  });

  it('paints only with palette colours', () => {
    const { calls } = draw();
    const allowed = new Set(Object.values(PALETTE));
    for (const colour of coloursUsed(calls)) expect(allowed.has(colour as string), String(colour)).toBe(true);
  });
});
