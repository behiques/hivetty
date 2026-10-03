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
