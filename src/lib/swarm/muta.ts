/**
 * The Brood's top-down mutalisk (HIVE-221), the flyer over Home's comb and
 * the splash globe.
 *
 * The artifact (`brood-v15.html`, lines 1209–1352) records one figure-eight
 * flight and replays it. Here every flyer owns its spine instead, simulated
 * live from the flyer's real head position: the same verlet body and
 * constraint loop, stiff through the neck and torso and looser down the tail,
 * so a turn swings the tail wide and lets it settle by momentum.
 */

/** A flyer's body: 34 nodes, as flat `[x0, y0, x1, y1, …]` arrays. */
export interface Spine {
  pos: Float64Array;
  /** Each node's position one substep ago, the verlet velocity. */
  prv: Float64Array;
  /** Time not yet stepped, under one substep. */
  acc: number;
  /** Where the head was last put. */
  hx: number;
  hy: number;
}

export const SPINE_NODES = 34;
export const SPINE_L = 3.5;

/** The simulation's fixed step, as the artifact's recording. */
const SUB = 1 / 120;
/** How far ahead the neck aims, the artifact's `P(t + 0.03)`, in substeps. */
const LEAD = 0.03 / SUB;

/** Stiffness down the spine (line 1216). */
const kAt = (i: number): number => (i < 13 ? 0.72 : 0.22 * Math.exp(-(i - 13) / 6) + 0.015);

/** A spine at `x, y`, its nodes laid straight back from `heading` (line 1217). */
export function createSpine(x: number, y: number, heading: number): Spine {
  const pos = new Float64Array(SPINE_NODES * 2);
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  for (let i = 0; i < SPINE_NODES; i++) {
    pos[i * 2] = x - c * SPINE_L * i;
    pos[i * 2 + 1] = y - s * SPINE_L * i;
  }
  return { pos, prv: pos.slice(), acc: 0, hx: x, hy: y };
}

/** One 1/120 s step with the head at `x, y`: lines 1221–1233. */
function substep(s: Spine, x: number, y: number): void {
  const { pos, prv } = s;
  prv[0] = pos[0]!;
  prv[1] = pos[1]!;
  pos[0] = x;
  pos[1] = y;
  for (let i = 1; i < SPINE_NODES; i++) {
    const ix = i * 2;
    const iy = ix + 1;
    let vx = pos[ix]! - prv[ix]!;
    let vy = pos[iy]! - prv[iy]!;
    const sx = pos[ix - 2]! - pos[ix]!;
    const sy = pos[iy - 2]! - pos[iy]!;
    const sl = Math.hypot(sx, sy) || 1;
    const ux = sx / sl;
    const uy = sy / sl;
    const par = vx * ux + vy * uy;
    const cp = i < 13 ? 0.2 : 0.03;
    vx = par * ux * 0.996 + (vx - par * ux) * (1 - cp);
    vy = par * uy * 0.996 + (vy - par * uy) * (1 - cp);
    prv[ix] = pos[ix]!;
    prv[iy] = pos[iy]!;
    pos[ix] = pos[ix]! + vx;
    pos[iy] = pos[iy]! + vy;
  }
  // The head's own heading, projected ahead, stands in for P(t + 0.03).
  const leadX = x + (x - prv[0]!) * LEAD;
  const leadY = y + (y - prv[1]!) * LEAD;
  for (let it = 0; it < 4; it++) {
    for (let i = 1; i < SPINE_NODES; i++) {
      const ix = i * 2;
      const iy = ix + 1;
      const ax = pos[ix - 2]!;
      const ay = pos[iy - 2]!;
      const bx = i >= 2 ? pos[ix - 4]! : leadX;
      const by = i >= 2 ? pos[iy - 4]! : leadY;
      let fx = ax - bx;
      let fy = ay - by;
      const fl = Math.hypot(fx, fy) || 1;
      fx /= fl;
      fy /= fl;
      const k = kAt(i);
      pos[ix] = pos[ix]! + (ax + fx * SPINE_L - pos[ix]!) * k;
      pos[iy] = pos[iy]! + (ay + fy * SPINE_L - pos[iy]!) * k;
      const ex = pos[ix]! - ax;
      const ey = pos[iy]! - ay;
      const el = Math.hypot(ex, ey) || 1;
      pos[ix] = ax + (ex / el) * SPINE_L;
      pos[iy] = ay + (ey / el) * SPINE_L;
    }
  }
}

/**
 * Advance the spine by `dt` with the head now at `x, y`. The time is cut into
 * fixed 1/120 s substeps, the head lerped across them from where it was last
 * put; what is left over waits for the next frame.
 */
export function stepSpine(s: Spine, x: number, y: number, dt: number): void {
  s.acc += dt;
  const n = Math.floor(s.acc / SUB + 1e-9);
  if (n <= 0) return;
  s.acc = Math.max(0, s.acc - n * SUB);
  const x0 = s.hx;
  const y0 = s.hy;
  for (let j = 1; j <= n; j++) {
    const k = j / n;
    substep(s, x0 + (x - x0) * k, y0 + (y - y0) * k);
  }
  s.hx = x;
  s.hy = y;
}

/** The spine's nodes as points, head first. */
export function spineNodes(s: Spine): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < SPINE_NODES; i++) out.push([s.pos[i * 2]!, s.pos[i * 2 + 1]!]);
  return out;
}

/**
 * Fly the spine along `path` for `seconds` at the fixed step, ending at
 * `path(seconds)`: a deterministic body for a still frame.
 */
export function warmSpine(s: Spine, path: (t: number) => [number, number], seconds: number): void {
  const steps = Math.round(seconds / SUB);
  for (let k = 1; k <= steps; k++) {
    const [x, y] = path(k * SUB);
    substep(s, x, y);
    s.hx = x;
    s.hy = y;
  }
  s.acc = 0;
}
