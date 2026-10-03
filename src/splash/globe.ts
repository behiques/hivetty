import { hexPath } from '@lib/swarm/comb';
import { drawMutalisk, REAL, withAlpha } from '@lib/swarm/mutalisk';
import type { SwarmPalette } from '@lib/swarm/palette';
import { clearColour } from '@lib/theme/colour';

import { LOG_SCHEDULE } from './chamber';

/**
 * The comb globe (HIVE-212; design §11), ported from the prototype's `ZD`
 * (`.hive/specs/hive-212-ref/round11-splash2.js` while it was being built).
 *
 * Everything is centred on the origin: the caller translates to the rings'
 * centre (the splash) or to its hero (About) and scales. Positions are pure
 * functions of `t`, seconds on the splash's clock, so the tests can ask where
 * anything is at any moment; `drawGlobe` only paints what they answer. No
 * colour lives here: every colour arrives in the palette.
 */

/** The globe's radius, in chamber pixels. */
export const GLOBE_R = 140;
const CELLS = 90;
/** The golden angle, as the prototype rounds it. */
const GOLDEN = 2.39996;
const SPIN = 0.45;
const TILT = 0.32;
const FORM_AT = 0.35;
const FORM_FOR = 1.3;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const after = (t: number, at: number, dur: number): number => clamp01((t - at) / dur);
const easeO = (x: number): number => 1 - (1 - clamp01(x)) ** 3;
const easeIO = (x: number): number => {
  const k = clamp01(x);
  return k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
};

/** Park–Miller, seed 9, as the prototype seeds its scatter: the same globe every launch. */
const seeded = (seed: number): (() => number) => {
  let s = seed % 2147483647;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

export type CellKind = 'green' | 'violet' | 'amber';

/** Each colour lights at the log line that names it: sessions, repositories, the two awaiting you. */
export const LIGHT_AT: Record<CellKind, number> = {
  green: LOG_SCHEDULE[0]!,
  violet: LOG_SCHEDULE[2]!,
  amber: LOG_SCHEDULE[3]!,
};

/**
 * Fixed cells, so the lights match the copy (4 sessions, 3 repositories, 2
 * awaiting). The Fibonacci order runs pole to pole, so even spacing in the
 * index spreads each colour over the sphere. The prototype drew these at
 * random and got eight, four and three.
 */
const LIT: Record<CellKind, readonly number[]> = {
  green: [8, 30, 52, 74],
  violet: [19, 41, 63],
  amber: [36, 80],
};

export interface GlobeCell {
  x: number;
  y: number;
  z: number;
  /** Where it starts, in globe radii before the 2.2 spread. */
  sx: number;
  sy: number;
  /** Its delay into the forming, 0 to 0.5s. */
  d: number;
  kind: CellKind | null;
}

const kindOf = (i: number): CellKind | null =>
  (Object.keys(LIT) as CellKind[]).find((kind) => LIT[kind].includes(i)) ?? null;

const rnd = seeded(9);

/** Ninety cells on a Fibonacci sphere; the scatter drawn sx, sy, d per cell, in that order. */
export const GLOBE_CELLS: readonly GlobeCell[] = Array.from({ length: CELLS }, (_, i) => {
  const y = 1 - (i / (CELLS - 1)) * 2;
  const r = Math.sqrt(1 - y * y);
  const th = i * GOLDEN;
  return {
    x: Math.cos(th) * r,
    y,
    z: Math.sin(th) * r,
    sx: (rnd() - 0.5) * 2.4,
    sy: (rnd() - 0.5) * 2.4,
    d: rnd() * 0.5,
    kind: kindOf(i),
  };
});

export interface PlacedCell {
  cell: GlobeCell;
  X: number;
  Y: number;
  /** 0 at the back of the globe, 1 at the front. */
  depth: number;
  /** 0 while scattered, 1 once in place. */
  formed: number;
}

/** Where a cell is at `t`: turned about the vertical axis, tilted toward the viewer, eased in from its scatter. */
export function cellAt(cell: GlobeCell, t: number): PlacedCell {
  const rot = t * SPIN;
  const x1 = cell.x * Math.cos(rot) + cell.z * Math.sin(rot);
  const z1 = -cell.x * Math.sin(rot) + cell.z * Math.cos(rot);
  const y2 = cell.y * Math.cos(TILT) - z1 * Math.sin(TILT);
  const z2 = cell.y * Math.sin(TILT) + z1 * Math.cos(TILT);
  const formed = easeIO(after(t, FORM_AT + cell.d, FORM_FOR));
  return {
    cell,
    X: lerp(cell.sx * 2.2, x1, formed) * GLOBE_R,
    Y: lerp(cell.sy * 2.2, y2, formed) * GLOBE_R,
    depth: (z2 + 1) / 2,
    formed,
  };
}

/** How lit a cell is, 0 to 1, easing in over 0.4s from its log line. */
export const cellLight = (cell: GlobeCell, t: number): number =>
  cell.kind ? easeO(after(t, LIGHT_AT[cell.kind], 0.4)) : 0;

/** The orbit: a circle of radius RO, flattened by its incline and rolled on screen. */
const RO = GLOBE_R * 1.22;
const FLAT = 0.24;
const ROLL = -0.42;
const HEART_R = 70;

/** "hive cluster online": the orbit draws itself, and the swarm follows 0.35s later. */
export const ORBIT_AT = LOG_SCHEDULE[4]!;
const FLY0 = ORBIT_AT + 0.35;
export const FLYER_COUNT = 7;
const GAP = 0.16;
const CLIMB = 0.75;
const LAP = 0.85;

/** The orbit's point at angle `a`: x, y and depth (`sin a`, the near half positive). */
export function orbitPoint(a: number): [number, number, number] {
  const x = Math.cos(a) * RO;
  const y = Math.sin(a) * RO * FLAT;
  return [x * Math.cos(ROLL) - y * Math.sin(ROLL), x * Math.sin(ROLL) + y * Math.cos(ROLL), Math.sin(a)];
}

/** When flyer `i` leaves the heart. */
export const flyerStart = (i: number): number => FLY0 + i * GAP;

export interface FlyerPos {
  x: number;
  y: number;
  /** -1 behind the globe to 1 in front; 1 while climbing out of the heart. */
  z: number;
  alpha: number;
  climbing: boolean;
}

/**
 * Flyer `i` at `t`: climbing from the heart to its slot on the orbit, lifted on
 * an arc, then circling. Answers for any `t`, before its start included (it is
 * at the centre then), because the heading is read from where it just was.
 */
export function flyerAt(i: number, t: number): FlyerPos {
  const d = t - flyerStart(i);
  const a0 = -Math.PI / 2 + i * ((Math.PI * 2) / FLYER_COUNT);
  // Against the landing moment, not `d < CLIMB`: the subtraction can land a hair short of it.
  if (t < flyerStart(i) + CLIMB) {
    const e = easeIO(d / CLIMB);
    const [ox, oy] = orbitPoint(a0);
    return {
      x: lerp(0, ox, e),
      y: lerp(0, oy, e) - Math.sin(e * Math.PI) * 26,
      z: 1,
      alpha: clamp01(d / 0.25),
      climbing: true,
    };
  }
  const [x, y, z] = orbitPoint(a0 + (d - CLIMB) * LAP);
  return { x, y, z, alpha: 1, climbing: false };
}

/** The heart's glow, 0 to 1: in as the swarm starts to rise, out once the last flyer is up. */
export const heartAt = (t: number): number =>
  easeO(after(t, FLY0 - 0.2, 0.4)) * (1 - easeO(after(t, FLY0 + FLYER_COUNT * GAP + 0.6, 0.6)));

/**
 * The still the splash holds under reduced motion, and where About's clock
 * starts: every flyer is on the orbit (the seventh lands at 4.34s) and the
 * heart has faded.
 */
export const GLOBE_STILL_T = 4.95;

type Ctx = CanvasRenderingContext2D;

/** The violet "repository" cells take the chitin rim. */
const COLOUR: Record<CellKind, keyof SwarmPalette> = { green: 'green', violet: 'chitin', amber: 'amber' };

/** Half the orbit: the far half faint behind the globe, the near half bright in front. */
function drawOrbit(ctx: Ctx, t: number, p: SwarmPalette, near: boolean): void {
  const on = easeO(after(t, ORBIT_AT, 0.5));
  if (on <= 0) return;
  const sweep = Math.PI * easeIO(after(t, ORBIT_AT, 0.7));
  const mid = near ? Math.PI / 2 : Math.PI * 1.5;
  ctx.save();
  ctx.strokeStyle = p.amber;
  ctx.lineWidth = near ? 2 : 1.4;
  ctx.shadowColor = p.amber;
  ctx.shadowBlur = (near ? 14 : 6) * on;
  ctx.beginPath();
  ctx.ellipse(0, 0, RO, RO * FLAT, ROLL, mid - sweep / 2, mid + sweep / 2);
  withAlpha(ctx, (near ? 0.85 : 0.35) * on, () => ctx.stroke());
  ctx.restore();
}

/** The creature at Home's size, larger in front of the globe; heading and turn read off its own path. */
function drawFlyer(ctx: Ctx, i: number, t: number, p: SwarmPalette): void {
  const at = flyerAt(i, t);
  const was = flyerAt(i, t - 0.03);
  const before = flyerAt(i, t - 0.09);
  const a1 = Math.atan2(at.y - was.y, at.x - was.x);
  const a0 = Math.atan2(was.y - before.y, was.x - before.x);
  const turn = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)) / 0.06;
  withAlpha(ctx, at.alpha * (0.7 + (0.3 * (at.z + 1)) / 2), () =>
    drawMutalisk(ctx, at.x, at.y, Math.cos(a1), Math.sin(a1), t, REAL * (0.85 + 0.15 * (at.z + 1)), { k: i * 1.3, turn }, p),
  );
}

/** A hex stroke growing from the cell and fading; `d` runs 0 to 1. */
function ripple(ctx: Ctx, x: number, y: number, s: number, d: number, colour: string): void {
  if (d < 0 || d > 1) return;
  hexPath(ctx, x, y, s * (1 + 1.2 * d));
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.6;
  withAlpha(ctx, 0.8 * (1 - d), () => ctx.stroke());
}

/** One cell: near ones larger and brighter; lit ones in their colour, with a ripple as they light. */
function drawCell(ctx: Ctx, placed: PlacedCell, t: number, p: SwarmPalette): void {
  const { cell, X, Y, depth, formed } = placed;
  const s = 7 + 9 * depth;
  const k = cellLight(cell, t);
  withAlpha(ctx, (0.25 + 0.75 * depth) * Math.min(1, formed * 1.5), () => {
    hexPath(ctx, X, Y, s);
    if (!cell.kind || k <= 0) {
      ctx.fillStyle = p.panel2;
      withAlpha(ctx, 0.8, () => ctx.fill());
      ctx.strokeStyle = p.chitin;
      ctx.lineWidth = 1.1;
      withAlpha(ctx, 0.45, () => ctx.stroke());
      return;
    }
    const colour = p[COLOUR[cell.kind]];
    const breath = cell.kind === 'green' ? 0.15 * Math.sin(t * 2.4 + X) : 0;
    ctx.fillStyle = colour;
    withAlpha(ctx, (cell.kind === 'violet' ? 0.18 : 0.32 + breath) * k, () => ctx.fill());
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.6;
    withAlpha(ctx, 0.95 * k, () => ctx.stroke());
    ripple(ctx, X, Y, s, (t - LIGHT_AT[cell.kind]) / 0.8, colour);
    // The two awaiting you keep rippling while the splash idles.
    if (cell.kind === 'amber' && t > 3) ripple(ctx, X, Y, s, ((t - 3) % 1.6) / 0.9, colour);
  });
}

/** The heart: a soft amber glow at the centre as the flyers rise out of it. */
function drawHeart(ctx: Ctx, t: number, p: SwarmPalette): void {
  const glow = heartAt(t);
  if (glow <= 0) return;
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, HEART_R);
  gradient.addColorStop(0, p.amber);
  gradient.addColorStop(1, clearColour(p.amber));
  ctx.fillStyle = gradient;
  withAlpha(ctx, 0.35 * glow, () => {
    ctx.beginPath();
    ctx.arc(0, 0, HEART_R, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * One frame at `t`, centred on the origin. The order is the depth: the orbit's
 * far half, flyers behind the globe, the heart, the cells back to front, the
 * orbit's near half, flyers in front or still climbing.
 */
export function drawGlobe(ctx: Ctx, t: number, palette: SwarmPalette): void {
  const cells = GLOBE_CELLS.map((cell) => cellAt(cell, t)).sort((a, b) => a.depth - b.depth);
  const out = Array.from({ length: FLYER_COUNT }, (_, i) => i).filter((i) => t >= flyerStart(i));
  const behind = (i: number): boolean => {
    const at = flyerAt(i, t);
    return !at.climbing && at.z < 0;
  };

  drawOrbit(ctx, t, palette, false);
  for (const i of out) if (behind(i)) drawFlyer(ctx, i, t, palette);
  drawHeart(ctx, t, palette);
  for (const placed of cells) drawCell(ctx, placed, t, palette);
  drawOrbit(ctx, t, palette, true);
  for (const i of out) if (!behind(i)) drawFlyer(ctx, i, t, palette);
}
