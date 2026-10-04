import type { Tone } from '@lib/swarm/tone';

/**
 * A Brood creature (HIVE-221): a pure drawing on a loop, placed and clocked
 * by whoever hosts it (`SwarmCreature`).
 *
 * `dur` is the loop in seconds, `rest` the still frame reduced motion holds,
 * and `box` the `[x, y, w, h]` the drawing occupies in its own units. `draw`
 * takes the loop time, the drawing scale (the artifact's `det` threshold reads
 * it) and the active tone.
 */
export interface BroodCreature {
  readonly dur: number;
  readonly rest: number;
  readonly box: readonly [number, number, number, number];
  draw(ctx: CanvasRenderingContext2D, t: number, s: number, T: Tone, o?: { field?: boolean }): void;
}

/**
 * Clear the canvas and draw `c` fitted, centred, into `w`×`h` css pixels at
 * `dpr` device pixels each. The artifact's `paint()`, lines 1821–1828.
 */
export function paintCreature(
  ctx: CanvasRenderingContext2D,
  c: BroodCreature,
  t: number,
  w: number,
  h: number,
  dpr: number,
  T: Tone,
): void {
  if (!w || !h) return;
  const [bx, by, bw, bh] = c.box;
  const s = Math.min(w / bw, h / bh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, Math.round(w * dpr), Math.round(h * dpr));
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ((w - bw * s) / 2 - bx * s), dpr * ((h - bh * s) / 2 - by * s));
  c.draw(ctx, t, s, T, {});
}
