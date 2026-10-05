import type { BroodCreature } from '@lib/swarm/brood';
import { clamp, creepPool, gauss, hash, mix, sm, spBlob, spN, spN2, spPath, spRng, TAU } from '@lib/swarm/kit';
import { ovLoop, ovM } from '@lib/swarm/overlord';
import { spMix, spRgb, spTone, type Rgb, type Tone } from '@lib/swarm/tone';

/**
 * The hive (HIVE-221): an ancient colony half sunk in its own territory.
 * Under its tissue, chambers, sacs and vessels gather round a buried organ
 * that contracts twice; each contraction sends green light through the colony
 * and out along the living network in the ground. Some of it stays lit.
 * Nothing opens; nothing emerges.
 *
 * Ported number for number from the artifact (`brood-v15.html`, lines
 * 945–1208). Where it read `spT()` or the global `C`, it reads the `Tone`
 * argument: its mineral ramp `M` is `T.mineralDeep`/`mineral`/`mineralLit`,
 * and the mat it mixes into the ground is `T.mat`. Where it built a `Path2D`,
 * the outline is traced on the context (happy-dom has none), which draws the
 * same pixels.
 */

type Pair = [number, number];
type P3 = [number, number, number];
/** A growth's spine node: position, width, heading. */
type P4 = [number, number, number, number];

interface HiveNode {
  u: number;
  v: number;
  w: number;
  arr: number;
  gain: number;
  flick: boolean;
  seed: number;
  depth: number;
  nod: number;
  root?: boolean;
  tip?: boolean;
  vis: number;
  min: number;
}

interface Growth {
  pts: P4[];
  rings: number[];
  lumps: P3[];
  branches: Growth[];
  cracks: P3[];
  pits: P3[];
  crust: P3[];
}

const HEART: Pair = [4, 12];

const LOBES = [
  { x: -24, y: -4, rx: 34, ry: 30, k: 0.3, old: true, main: false },
  { x: 30, y: -12, rx: 30, ry: 25, k: 0.32, old: false, main: false },
  { x: -54, y: 34, rx: 37, ry: 32, k: 0.26, old: true, main: false },
  { x: 54, y: 30, rx: 41, ry: 34, k: 0.3, old: false, main: false },
  { x: 2, y: 18, rx: 55, ry: 48, k: 0.36, old: false, main: true },
  { x: -16, y: 54, rx: 52, ry: 17, k: 0.25, old: false, main: false },
  { x: 70, y: 52, rx: 22, ry: 13, k: 0.22, old: true, main: false },
] as const;

/** The colony's growth, fixed once: every irregularity is seeded. */
export function growHive() {
  const r = spRng(41);
  const R = (a: number, b: number): number => a + (b - a) * r();
  const sg = (): number => (r() < 0.5 ? -1 : 1);
  const triple = (a0: number, a1: number, b0: number, b1: number, c0: number, c1: number): P3 => [
    R(a0, a1),
    R(b0, b1),
    R(c0, c1),
  ];
  /* the lobes, back to front; older ones carry mineral crust, the front one is thin enough to see into */
  const lobes = LOBES.map((l) => ({
    ...l,
    h: [
      [2, R(0.06, 0.12), R(0, TAU)],
      [3, R(0.05, 0.1), R(0, TAU)],
      [4, R(0.03, 0.06), R(0, TAU)],
      [6, R(0.01, 0.03), R(0, TAU)],
    ] as P3[],
    seed: R(0, 99),
    crust: l.old ? Array.from({ length: 3 }, () => triple(-0.6, 0.6, -0.6, 0.2, 0.25, 0.45)) : [],
    lumps: Array.from({ length: l.old ? 5 : 2 }, () => triple(-0.7, 0.7, -0.8, 0.1, 1.2, 3.4)),
    pores: Array.from({ length: 16 }, () => triple(-0.8, 0.8, -0.8, 0.6, 0.25, 0.7)),
    ridges: Array.from({ length: 2 + ((r() * 2) | 0) }, (): P3 => {
      const a0 = R(0, TAU);
      return [a0, a0 + R(0.6, 1.3), R(0.62, 0.86)];
    }),
  }));
  /* inside the front lobe */
  const chambers = Array.from({ length: 13 }, () => {
    const a = R(0, TAU);
    const d = Math.sqrt(r()) * 0.8;
    return {
      x: Math.cos(a) * d,
      y: Math.sin(a) * d * 0.9,
      rx: R(0.07, 0.2),
      ry: R(0.06, 0.16),
      dep: R(0.4, 1),
      seed: R(0, 50),
      wall: R(1.2, 3),
    };
  });
  const sacs = Array.from({ length: 8 }, () => {
    const a = R(0, TAU);
    const d = R(0.25, 0.8);
    return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.85, r: R(0.05, 0.11), seed: R(0, 50) };
  });
  const membranes = Array.from({ length: 6 }, () => ({
    p0: [R(-0.8, 0.8), R(-0.7, 0.7)] as Pair,
    c: [R(-0.5, 0.5), R(-0.5, 0.5)] as Pair,
    p1: [R(-0.8, 0.8), R(-0.7, 0.7)] as Pair,
    w: R(0.06, 0.14),
    seed: R(0, 50),
  }));
  const strands = Array.from(
    { length: 18 },
    (): [number, number, number, number, number] => [
      R(-0.75, 0.75),
      R(-0.7, 0.7),
      R(-0.75, 0.75),
      R(-0.7, 0.7),
      R(0.05, 0.2),
    ],
  );
  const clusters = Array.from({ length: 6 }, () => ({
    x: R(-0.7, 0.7),
    y: R(-0.6, 0.7),
    n: 3 + ((r() * 4) | 0),
    seed: R(0, 50),
  }));
  const openings = (
    [
      [-34, -12, 5.5, 3.2],
      [-64, 28, 4.6, 2.8],
      [60, 20, 4, 2.6],
    ] as const
  ).map(([x, y, rx, ry]) => ({ x, y, rx, ry, seed: R(0, 50) }));
  /* the territory: a living network grown out from under the colony. Every vertex knows when a pulse reaches it. */
  const nodes: HiveNode[] = [];
  const edges: Pair[] = [];
  const chains: number[][] = [];
  const grow = (pi: number, u0: number, v0: number, a0: number, w: number, depth: number, arr0: number): void => {
    let u = u0;
    let v = v0;
    let a = a0;
    let arr = arr0;
    const n = depth === 0 ? 8 + ((r() * 5) | 0) : depth === 1 ? 4 + ((r() * 4) | 0) : 2 + ((r() * 3) | 0);
    const speed = R(0.55, 1.45) * (depth === 0 ? 80 : 58);
    const gain = r() < 0.13 ? 0 : r() < 0.28 ? R(1.25, 1.8) : R(0.25, 1);
    const flick = r() < 0.16;
    let prev = pi;
    const ids = [pi];
    for (let k = 0; k < n; k++) {
      a += R(-0.45, 0.45);
      const L = R(5, 9) * (depth ? 0.8 : 1);
      u += Math.cos(a) * L;
      v += Math.sin(a) * L;
      if ((u / 165) ** 2 + (v / 82) ** 2 > 1) break;
      arr += L / speed;
      const id =
        nodes.push({
          u,
          v,
          w: Math.max(0.7, w * (1 - (k / n) * 0.55)),
          arr,
          gain,
          flick,
          seed: R(0, 99),
          depth,
          nod: r() < 0.14 ? R(1, 2.4) : 0,
          vis: 0,
          min: 0,
        }) - 1;
      edges.push([prev, id]);
      prev = id;
      ids.push(id);
      if (depth < 2 && r() < (depth === 0 ? 0.42 : 0.3)) grow(id, u, v, a + sg() * R(0.5, 1.1), w * 0.55, depth + 1, arr);
    }
    nodes[prev]!.tip = true;
    if (ids.length > 1) chains.push(ids);
  };
  const roots: number[] = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + R(-0.18, 0.18);
    const u = Math.cos(a) * 66;
    const v = Math.sin(a) * 26;
    const ga = Math.atan2(Math.sin(a) * 0.55, Math.cos(a));
    const id =
      nodes.push({
        u,
        v,
        w: R(3.4, 5),
        arr: 0.32,
        gain: 1,
        flick: false,
        seed: R(0, 99),
        depth: 0,
        nod: 0,
        root: true,
        vis: 0,
        min: 0,
      }) - 1;
    roots.push(id);
    grow(id, u, v, ga, nodes[id]!.w, 0, 0.32);
  }
  for (const nd of nodes) {
    nd.vis = clamp((spN2(nd.u * 0.045, nd.v * 0.09, 50) + 0.58) / 0.3);
    nd.min = clamp((spN2(nd.u * 0.03 + 9, nd.v * 0.05, 51) - 0.25) / 0.4);
  }
  /* a few places that keep some light after the pulse has gone */
  const resid = nodes
    .map((nd, i) => [i, nd] as const)
    .filter(([, nd]) => nd.gain > 0.5 && nd.arr > 0.8 && (nd.tip || nd.nod || nd.vis < 0.3))
    .filter(() => r() < 0.4)
    .slice(0, 9)
    .map(([i]) => ({ i, base: R(0.06, 0.16), peak: R(0.3, 0.6), tau: R(2, 4), seed: R(0, 50) }));
  /* inside: vessels from the organ out to where each root leaves the colony */
  const vessels = roots.map((id) => {
    const nd = nodes[id]!;
    const end: Pair = [nd.u * 0.8, 64 + nd.v * 0.32 - 4];
    const pts: P3[] = [];
    const j1 = R(-12, 12);
    const j2 = R(-5, 5);
    for (let k = 0; k <= 10; k++) {
      const f = k / 10;
      const j = Math.sin(Math.PI * f) * j1 + Math.sin(TAU * f) * j2;
      pts.push([mix(HEART[0], end[0], f) + j * 0.8, mix(HEART[1], end[1], f) - j * 0.25, f * 0.32]);
    }
    return { pts, w: R(1.6, 2.6), back: nd.v < -6 };
  });
  const ivs: { pts: P3[]; w: number; gain: number }[] = [];
  const ivGrow = (x0: number, y0: number, a0: number, n: number, w: number, arr0: number, depth: number): void => {
    let x = x0;
    let y = y0;
    let a = a0;
    let arr = arr0;
    const pts: P3[] = [[x, y, arr]];
    for (let k = 0; k < n; k++) {
      a += R(-0.4, 0.4);
      const L = R(3, 5.5);
      x += Math.cos(a) * L;
      y += Math.sin(a) * L * 0.9;
      if (((x - 2) / 52) ** 2 + ((y - 18) / 45) ** 2 > 0.85) break;
      arr += L / 90;
      pts.push([x, y, arr]);
      if (depth < 2 && r() < 0.28) ivGrow(x, y, a + sg() * R(0.5, 1.1), Math.max(2, (n * 0.5) | 0), w * 0.6, arr, depth + 1);
    }
    if (pts.length > 1) ivs.push({ pts, w, gain: r() < 0.15 ? 0.15 : R(0.5, 1.3) });
  };
  for (let i = 0; i < 9; i++) {
    ivGrow(HEART[0], HEART[1], (i / 9) * TAU + R(-0.3, 0.3), 9 + ((r() * 6) | 0), R(1.3, 2.1), 0, 0);
  }
  const iresid = [
    { x: -26, y: 30, r: 9, base: 0.1, peak: 0.45, tau: 3.2, arr: 0.2 },
    { x: 30, y: 4, r: 6, base: 0.07, peak: 0.35, tau: 2.4, arr: 0.15 },
  ];
  const mats = Array.from({ length: 16 }, () => {
    const a = R(0, TAU);
    const d = Math.sqrt(r());
    return { u: Math.cos(a) * d * 120, v: Math.sin(a) * d * 46, rx: R(14, 38), seed: R(0, 50) };
  });
  /* the growths: one tall and knobbled, hooked inward; one broad and faceted. Neither is a tooth. */
  const spine = (
    x0: number,
    y0: number,
    a0: number,
    n: number,
    L: number,
    w0: number,
    w1: number,
    curve: number,
    hook: number,
    knob: number,
    facet: boolean,
  ): P4[] => {
    let x = x0;
    let y = y0;
    let a = a0;
    const pts: P4[] = [];
    for (let k = 0; k <= n; k++) {
      const f = k / n;
      let w = mix(w0, w1, f ** 0.8);
      w *= facet ? 1 + 0.22 * (((k * 7919) % 5) / 4 - 0.5) : 1 + knob * spN(k * 0.9 + x, 60);
      pts.push([x, y, w, a]);
      a += curve + hook * Math.max(0, f - 0.4) * 2 + R(-0.06, 0.06);
      x += Math.cos(a) * L;
      y += Math.sin(a) * L;
    }
    return pts;
  };
  const growth = (pts: P4[], rings: number[], lumps: P3[]): Growth => ({
    pts,
    rings,
    lumps,
    branches: [],
    cracks: [],
    pits: [],
    crust: [],
  });
  const lump = (): P3 => [R(0.05, 0.98), sg(), R(0.28, 0.55)];
  const g0 = growth(
    spine(-68, 48, -1.98, 12, 7.8, 25, 6, 0.045, 0.12, 0.45, false),
    Array.from({ length: 9 }, () => R(0.05, 0.92)),
    Array.from({ length: 12 }, lump),
  );
  const g1 = growth(
    spine(70, 50, -0.95, 7, 6.8, 27, 8, -0.07, -0.18, 0.45, false),
    Array.from({ length: 6 }, () => R(0.05, 0.9)),
    Array.from({ length: 9 }, (): P3 => [R(0.05, 0.98), sg(), R(0.3, 0.55)]),
  );
  const growths = [g0, g1];
  const at4 = g0.pts[4]!;
  const b0 = growth(spine(at4[0], at4[1], -2.75, 3, 6, 10, 6, -0.1, 0, 0.4, false), [0.5], [[0.9, 1, 0.5]]);
  const at7 = g0.pts[7]!;
  const b1 = growth(spine(at7[0], at7[1], -0.75, 2, 5.5, 8, 5, 0.1, 0, 0.4, false), [], [[0.95, -1, 0.55]]);
  g0.branches.push(b0, b1);
  for (const g of growths) {
    for (const b of [g, ...g.branches]) {
      b.cracks = Array.from({ length: 4 }, () => triple(0.1, 0.85, -0.35, 0.35, 0.08, 0.2));
      b.pits = Array.from({ length: 7 }, () => triple(0.05, 0.95, -0.4, 0.4, 0.3, 0.9));
      b.crust = Array.from({ length: 4 }, () => triple(0.1, 0.9, -0.3, 0.3, 1.5, 4));
    }
  }
  return {
    HEART,
    lobes,
    chambers,
    sacs,
    membranes,
    strands,
    clusters,
    openings,
    nodes,
    edges,
    chains,
    roots,
    resid,
    vessels,
    ivs,
    iresid,
    mats,
    growths,
  };
}

type Anatomy = ReturnType<typeof growHive>;
type Lobe = Anatomy['lobes'][number];

let anatomy: Anatomy | null = null;

/** The hive's anatomy, grown on first draw rather than at import. */
export function hiveAnatomy(): Anatomy {
  anatomy ??= growHive();
  return anatomy;
}

type Layer = OffscreenCanvas | HTMLCanvasElement;

/** The window's own layer, one per canvas size (the artifact's `HIVE._off`). */
const LAYER_CAP = 8;
/** Insertion order is recency order; a resize drag evicts its stale sizes. */
const layers = new Map<string, Layer>();

function layerFor(ctx: CanvasRenderingContext2D): Layer {
  const { width, height } = ctx.canvas;
  const key = `${width}x${height}`;
  let off = layers.get(key);
  if (off) {
    layers.delete(key);
    layers.set(key, off);
  } else {
    if (typeof OffscreenCanvas !== 'undefined') {
      off = new OffscreenCanvas(width, height);
    } else {
      off = ctx.canvas.ownerDocument.createElement('canvas');
      off.width = width;
      off.height = height;
    }
    layers.set(key, off);
    if (layers.size > LAYER_CAP) layers.delete(layers.keys().next().value!);
  }
  return off;
}

/** Trace a closed curve through the midpoints of `pts`, each point its control. */
function traceSmooth(ctx: CanvasRenderingContext2D, pts: readonly Pair[]): void {
  const n = pts.length;
  const m = (a: Pair, b: Pair): Pair => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const q0 = m(pts[0]!, pts[1]!);
  ctx.moveTo(q0[0], q0[1]);
  for (let i = 1; i <= n; i++) {
    const a = pts[i % n]!;
    const q = m(a, pts[(i + 1) % n]!);
    ctx.quadraticCurveTo(a[0], a[1], q[0], q[1]);
  }
  ctx.closePath();
}

const ORGAN: readonly (readonly [number, number, number, number, number])[] = [
  [-4, -3, 8, 9, 0.4],
  [4, -1, 7.5, 8.5, -0.3],
  [-1, 5, 9, 7, 0.1],
  [6, 6, 5, 5.5, 0.6],
];

function drawHive(ctx: CanvasRenderingContext2D, t: number, s: number, T: Tone): void {
  const HVS = hiveAnatomy();
  const det = s > 1.1;
  const G = 64;
  const GM: GlobalCompositeOperation = T.dark ? 'lighter' : 'source-over';
  const w10 = TAU / 10;
  const H = HVS.HEART;
  const M = { lo: T.mineralDeep, mid: T.mineral, hi: T.mineralLit };
  const mTone = (k0: number): Rgb => {
    const k = clamp(k0);
    return k < 0.5 ? spMix(M.lo, M.mid, k * 2) : spMix(M.mid, M.hi, (k - 0.5) * 2);
  };
  /* two contractions, the second the stronger; light leaves the organ and travels at each branch's own pace */
  const BEATS: readonly P3[] = [
    [2.4, 0.6, 1.8],
    [5.4, 1, 0.7],
  ];
  const env = (dt: number): number => (dt <= 0 ? 0 : (dt / 0.12) * Math.exp(1 - dt / 0.12));
  const hp = BEATS.reduce((a, [tb, st]) => a + st * (gauss((t - tb) / 0.07) + 0.4 * gauss((t - tb - 0.22) / 0.08)), 0);
  const resp = (d: number): number => BEATS.reduce((a, [tb, st]) => a + st * env(t - tb - d / 90), 0);
  const lightAt = (arr: number, gain: number, flick: boolean, seed: number): number => {
    let l = 0;
    for (const [tb, st, att] of BEATS) l += st * env(t - tb - arr) * Math.exp(-arr * att);
    if (flick && l > 0.02) l *= 0.55 + 0.45 * Math.sin(t * 37 + seed);
    return l * gain;
  };
  const connected = 0.07 * sm(5.7, 6.2, t) * (1 - sm(6.9, 8, t));
  const breathe = Math.sin(w10 * t) * 0.006 + 0.004 * ovLoop(t, 7, 1.3);
  const P = (u: number, v: number): Pair => [u, G + v * 0.32];

  /* ---- the ground it has taken ---- */
  creepPool(ctx, 0, G + 4, 170, 52, 0.42, T);
  for (const m of HVS.mats) {
    const p = P(m.u, m.v);
    spBlob(ctx, p[0], p[1], m.rx, m.rx * 0.32, spMix(T.lo, T.mat, 0.5), 0.55, 0.55);
  }
  if (det) {
    ctx.beginPath();
    for (const m of HVS.mats) {
      const p = P(m.u, m.v);
      for (let j = 0; j < 6; j++) {
        const a = hash(m.seed + j) * TAU;
        const d = hash(m.seed + j + 9) * m.rx * 0.8;
        const x = p[0] + Math.cos(a) * d;
        const y = p[1] + Math.sin(a) * d * 0.32;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a + 1.3) * 4, y + Math.sin(a + 1.3) * 1.2);
      }
    }
    ctx.strokeStyle = spRgb(T.lo, 0.4);
    ctx.lineWidth = 0.4;
    ctx.stroke();
  }
  spBlob(ctx, 0, G + 2, 100, 18, T.lo, 0.7, 0.5);

  /* ---- the network: raised living tissue that sinks under the ground and comes up again ---- */
  const N = HVS.nodes;
  const twitch = 3 * gauss((ovM(t) - 7.7) / 0.3);
  const nodeL = N.map((nd) => lightAt(nd.arr, nd.gain, nd.flick, nd.seed));
  const scr = N.map((nd, i): P3 => {
    const p = P(nd.u, nd.v);
    const persp = 0.65 + 0.35 * clamp((nd.v + 64) / 128);
    return [p[0], p[1] - (i === 140 ? twitch : 0), nd.w * persp];
  });
  /* each branch is one continuous curve: pieces run midpoint to midpoint through each vertex */
  const pieces: { s0: Pair; c0: Pair; e0: Pair; w: number; vis: number; min: number; l: number; front: boolean }[] = [];
  for (const ids of HVS.chains) {
    const n = ids.length;
    const Q = (i: number): P3 => scr[ids[i]!]!;
    const m = (i: number): Pair => [(Q(i)[0] + Q(i + 1)[0]) / 2, (Q(i)[1] + Q(i + 1)[1]) / 2];
    for (let i = 0; i < n; i++) {
      let s0: Pair;
      let c0: Pair;
      let e0: Pair;
      if (i === 0) {
        s0 = [Q(0)[0], Q(0)[1]];
        e0 = m(0);
        c0 = [(s0[0] + e0[0]) / 2, (s0[1] + e0[1]) / 2];
      } else if (i === n - 1) {
        s0 = m(n - 2);
        e0 = [Q(n - 1)[0], Q(n - 1)[1]];
        c0 = [(s0[0] + e0[0]) / 2, (s0[1] + e0[1]) / 2];
      } else {
        s0 = m(i - 1);
        c0 = [Q(i)[0], Q(i)[1]];
        e0 = m(i);
      }
      const nd = N[ids[i]!]!;
      if (nd.root) continue;
      pieces.push({
        s0,
        c0,
        e0,
        w: Q(i)[2],
        vis: nd.vis,
        min: nd.min,
        l: nodeL[ids[i]!]! + (nd.gain > 0 ? connected : 0),
        front: nd.v >= -4,
      });
    }
  }
  const curve = (pc: (typeof pieces)[number], ox = 0, oy = 0): void => {
    ctx.beginPath();
    ctx.moveTo(pc.s0[0] + ox, pc.s0[1] + oy);
    ctx.quadraticCurveTo(pc.c0[0] + ox, pc.c0[1] + oy, pc.e0[0] + ox, pc.e0[1] + oy);
  };
  const drawNet = (front: boolean): void => {
    ctx.lineCap = 'round';
    const ps = pieces.filter((pc) => pc.front === front && pc.vis > 0.03);
    const matC = spMix(T.lo, T.mat, 0.55);
    for (const pc of ps) {
      curve(pc, 0, pc.w * 0.2);
      ctx.strokeStyle = spRgb(matC, 0.28 * pc.vis);
      ctx.lineWidth = pc.w * 3 + 3;
      ctx.stroke();
    }
    for (const pc of ps) {
      curve(pc, 0.6, pc.w * 0.38);
      ctx.strokeStyle = spRgb(T.lo, 0.45 * pc.vis);
      ctx.lineWidth = pc.w + 1.2;
      ctx.stroke();
    }
    for (const pc of ps) {
      curve(pc);
      ctx.strokeStyle = spRgb(spMix(spMix(spTone(T, 0.27), matC, 0.25), mTone(0.3), pc.min * 0.3), pc.vis);
      ctx.lineWidth = pc.w;
      ctx.stroke();
    }
    for (const pc of ps) {
      if (pc.w < 1.3 && !det) continue;
      curve(pc, -pc.w * 0.12, -pc.w * 0.26);
      ctx.strokeStyle = spRgb(spMix(spTone(T, 0.6), mTone(0.6), pc.min * 0.4), 0.18 * pc.vis);
      ctx.lineWidth = Math.max(0.3, pc.w * 0.26);
      ctx.stroke();
    }
    for (let i = 0; i < N.length; i++) {
      const nd = N[i]!;
      if (nd.v >= -4 !== front) continue;
      const p = scr[i]!;
      if (nd.nod && nd.vis > 0.2) {
        const rr = nd.nod * (0.7 + (0.3 * p[2]) / 4);
        spBlob(ctx, p[0] + 0.5, p[1] + rr * 0.5, rr * 1.4, rr * 0.5, T.lo, 0.5 * nd.vis);
        ctx.beginPath();
        ctx.ellipse(p[0], p[1] - rr * 0.3, rr, rr * 0.75, 0, 0, TAU);
        const g = ctx.createRadialGradient(p[0] - rr * 0.3, p[1] - rr * 0.7, 0, p[0], p[1] - rr * 0.3, rr);
        g.addColorStop(0, spRgb(spTone(T, 0.5), nd.vis));
        g.addColorStop(1, spRgb(spTone(T, 0.18), nd.vis));
        ctx.fillStyle = g;
        ctx.fill();
      } else if (nd.vis < 0.2 && (nd.tip || nd.nod)) spBlob(ctx, p[0], p[1], 2.6, 1, T.lo, 0.6);
      if (det && nd.vis > 0.5 && nd.min < 0.3 && hash(nd.seed) < 0.07) {
        ctx.fillStyle = spRgb(T.hi, 0.3);
        ctx.beginPath();
        ctx.arc(p[0] - p[2] * 0.2, p[1] - p[2] * 0.3, 0.45, 0, TAU);
        ctx.fill();
      }
    }
    /* the pulse, inside the tissue: scattered wide, concentrated in the core; buried runs show through the soil, dimmer */
    ctx.globalCompositeOperation = GM;
    for (const pc of pieces) {
      if (pc.front !== front || pc.l < 0.02) continue;
      const k = 0.3 + 0.7 * pc.vis;
      curve(pc);
      ctx.strokeStyle = spRgb(T.green, 0.2 * pc.l * k);
      ctx.lineWidth = pc.w + 5;
      ctx.stroke();
      ctx.strokeStyle = spRgb(T.green, Math.min(0.9, 0.7 * pc.l * k));
      ctx.lineWidth = Math.max(0.5, pc.w * 0.45);
      ctx.stroke();
    }
    for (let i = 0; i < N.length; i++) {
      const nd = N[i]!;
      if (nd.v >= -4 !== front || nodeL[i]! < 0.25 || i % 2) continue;
      const p = scr[i]!;
      spBlob(ctx, p[0], p[1] + 1, 12 * nodeL[i]!, 4 * nodeL[i]!, T.green, 0.14 * Math.min(1, nodeL[i]!));
    }
    for (const rs of HVS.resid) {
      const nd = N[rs.i]!;
      if (nd.v >= -4 !== front) continue;
      const p = scr[rs.i]!;
      const g =
        (rs.base + rs.peak * Math.exp(-ovM(t - 5.4 - nd.arr - 0.1) / rs.tau)) *
        (1 + 0.15 * ovLoop(t, rs.seed, 3)) *
        (nd.vis < 0.3 ? 0.6 : 1);
      spBlob(ctx, p[0], p[1], 5 + 4 * g, 2 + 1.5 * g, T.green, 0.7 * g, 0.4);
      spBlob(ctx, p[0], p[1] + 1, 16, 5, T.green, 0.12 * g);
    }
    ctx.globalCompositeOperation = 'source-over';
  };
  drawNet(false);

  /* ---- mineralized growths: grown for an age, lumped, cracked, crusted, stained where they leave the tissue ---- */
  const drawGrowth = (g: Growth): void => {
    const pts = g.pts;
    const n = pts.length - 1;
    const Lp: Pair[] = [];
    const Rp: Pair[] = [];
    pts.forEach(([x, y, w, a], k) => {
      const nx = -Math.sin(a);
      const ny = Math.cos(a);
      const jl = 1 + 0.2 * spN(k * 2.3 + x * 0.1, 70);
      const jr = 1 + 0.2 * spN(k * 2.3 + x * 0.1 + 31, 70);
      Lp.push([x - ((nx * w) / 2) * jl, y - ((ny * w) / 2) * jl]);
      Rp.push([x + ((nx * w) / 2) * jr, y + ((ny * w) / 2) * jr]);
    });
    const tip = pts[n]!;
    const ring: Pair[] = [
      ...Lp,
      [tip[0] + Math.cos(tip[3]) * tip[2] * 0.6, tip[1] + Math.sin(tip[3]) * tip[2] * 0.6],
      ...Rp.slice().reverse(),
    ];
    const mm = (a: Pair, b: Pair): Pair => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const tracePoly = (): void => {
      ctx.beginPath();
      ctx.moveTo(ring[0]![0], ring[0]![1]);
      for (let i = 1; i < ring.length - 1; i++) {
        const q = mm(ring[i]!, ring[i + 1]!);
        ctx.quadraticCurveTo(ring[i]![0], ring[i]![1], q[0], q[1]);
      }
      ctx.lineTo(ring[ring.length - 1]![0], ring[ring.length - 1]![1]);
      ctx.closePath();
    };
    const at = (f: number): P4 => {
      const x = f * n;
      const k = Math.min(n - 1, Math.floor(x));
      const q = x - k;
      const a = pts[k]!;
      const b = pts[k + 1]!;
      return [mix(a[0], b[0], q), mix(a[1], b[1], q), mix(a[2], b[2], q), mix(a[3], b[3], q)];
    };
    const lump = ([f, side, rf]: P3): void => {
      const [x, y, w, a] = at(f);
      const rr = w * rf;
      const cx2 = x - Math.sin(a) * w * 0.42 * side;
      const cy2 = y + Math.cos(a) * w * 0.42 * side;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const th = (i / 10) * TAU;
        const k = 1 + 0.28 * spN(i * 1.3 + f * 17, 71);
        const lx = Math.cos(th) * rr * 1.25 * k;
        const ly = Math.sin(th) * rr * 0.7 * k;
        ctx[i ? 'lineTo' : 'moveTo'](cx2 + lx * Math.cos(a) - ly * Math.sin(a), cy2 + lx * Math.sin(a) + ly * Math.cos(a));
      }
      ctx.closePath();
      const gg = ctx.createRadialGradient(cx2 - rr * 0.35, cy2 - rr * 0.4, 0, cx2, cy2, rr * 1.2);
      gg.addColorStop(0, spRgb(mTone(0.5)));
      gg.addColorStop(0.7, spRgb(spMix(mTone(0.26), spTone(T, 0.24), 0.3)));
      gg.addColorStop(1, spRgb(spMix(mTone(0.12), spTone(T, 0.14), 0.5)));
      ctx.fillStyle = gg;
      ctx.fill();
    };
    g.lumps.filter((l) => l[1] < 0).forEach(lump);
    {
      const gg = ctx.createLinearGradient(pts[0]![0], pts[0]![1], tip[0], tip[1]);
      gg.addColorStop(0, spRgb(spMix(mTone(0.3), spTone(T, 0.22), 0.55)));
      gg.addColorStop(0.5, spRgb(mTone(0.4)));
      gg.addColorStop(1, spRgb(mTone(0.46)));
      ctx.fillStyle = gg;
      tracePoly();
      ctx.fill();
    }
    ctx.save();
    tracePoly();
    ctx.clip();
    ctx.lineCap = 'round';
    const off = (k: number, f: number): Pair => {
      const [x, y, w, a] = pts[k]!;
      return [x - Math.sin(a) * w * f, y + Math.cos(a) * w * f];
    };
    for (const [f, col, wf] of [
      [0.32, spRgb(M.lo, 0.62), 0.6],
      [-0.3, spRgb(M.hi, 0.36), 0.3],
    ] as const) {
      ctx.beginPath();
      for (let k = 0; k <= n; k++) {
        const p = off(k, f);
        ctx[k ? 'lineTo' : 'moveTo'](p[0], p[1]);
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = (pts.reduce((a, p) => a + p[2], 0) / pts.length) * wf;
      ctx.stroke();
    }
    for (const f of g.rings) {
      const [x, y, w, a] = at(f);
      const nx = -Math.sin(a);
      const ny = Math.cos(a);
      const tx = Math.cos(a);
      const ty = Math.sin(a);
      const wob = spN(f * 13, 68) * w * 0.15;
      ctx.beginPath();
      ctx.moveTo(x - nx * w * 0.6, y - ny * w * 0.6);
      ctx.quadraticCurveTo(x - tx * (w * 0.18 + wob), y - ty * (w * 0.18 + wob), x + nx * w * 0.6, y + ny * w * 0.6);
      ctx.strokeStyle = spRgb(M.lo, 0.42);
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.strokeStyle = spRgb(M.hi, 0.16);
      ctx.lineWidth = 0.35;
      ctx.save();
      ctx.translate(tx * 0.8, ty * 0.8);
      ctx.beginPath();
      ctx.moveTo(x - nx * w * 0.6, y - ny * w * 0.6);
      ctx.quadraticCurveTo(x - tx * (w * 0.18 + wob), y - ty * (w * 0.18 + wob), x + nx * w * 0.6, y + ny * w * 0.6);
      ctx.stroke();
      ctx.restore();
    }
    if (det) {
      ctx.beginPath();
      for (const [f, o, len] of g.cracks) {
        const q0 = at(f);
        ctx.moveTo(q0[0] - Math.sin(q0[3]) * q0[2] * o, q0[1] + Math.cos(q0[3]) * q0[2] * o);
        for (let j = 1; j <= 4; j++) {
          const q = at(Math.min(0.98, f + (len * j) / 4));
          const oo = o + spN(j * 1.7 + f * 9, 61) * 0.12;
          ctx.lineTo(q[0] - Math.sin(q[3]) * q[2] * oo, q[1] + Math.cos(q[3]) * q[2] * oo);
        }
      }
      ctx.strokeStyle = spRgb(M.lo, 0.7);
      ctx.lineWidth = 0.5;
      ctx.stroke();
      for (const [f, o, rr] of g.pits) {
        const [x, y, w, a] = at(f);
        ctx.beginPath();
        ctx.ellipse(x - Math.sin(a) * w * o, y + Math.cos(a) * w * o, rr, rr * 0.7, a, 0, TAU);
        ctx.fillStyle = spRgb(M.lo, 0.55);
        ctx.fill();
      }
      for (const [f, o, rr] of g.crust) {
        const [x, y, w, a] = at(f);
        spBlob(ctx, x - Math.sin(a) * w * o, y + Math.cos(a) * w * o, rr, rr * 0.7, M.hi, 0.2);
      }
    }
    const b0 = pts[0]!;
    spBlob(ctx, b0[0], b0[1], b0[2] * 1.5, b0[2] * 1.5, spMix(T.lo, spTone(T, 0.2), 0.3), 0.8, 0.45);
    spBlob(ctx, b0[0] + 3, b0[1] - b0[2] * 1.1, b0[2] * 0.9, b0[2] * 0.8, T.green, 0.05);
    ctx.restore();
    g.lumps.filter((l) => l[1] > 0).forEach(lump);
    for (let j = 0; j < 3; j++) {
      const ta = tip[3] + (j - 1) * 0.9;
      const rr = tip[2] * (0.42 - j * 0.06);
      const x = tip[0] + Math.cos(ta) * tip[2] * 0.45;
      const y = tip[1] + Math.sin(ta) * tip[2] * 0.45;
      ctx.beginPath();
      ctx.ellipse(x, y, rr, rr * 0.8, ta, 0, TAU);
      const gg = ctx.createRadialGradient(x - rr * 0.4, y - rr * 0.4, 0, x, y, rr);
      gg.addColorStop(0, spRgb(mTone(0.55)));
      gg.addColorStop(1, spRgb(mTone(0.2)));
      ctx.fillStyle = gg;
      ctx.fill();
    }
  };
  const growthBase = (g: Growth): void => {
    /* tissue folded up round the root, holding it */
    const [x, y, w, a] = g.pts[0]!;
    for (let j = 0; j < 3; j++) {
      const rr = w * (0.62 - j * 0.08);
      const cx2 = x + Math.cos(a) * w * 0.25 + (j - 1) * w * 0.38;
      const cy2 = y + w * 0.14 + j;
      ctx.beginPath();
      ctx.ellipse(cx2, cy2, rr, rr * 0.5, (j - 1) * 0.5, 0, TAU);
      const gg = ctx.createLinearGradient(0, cy2 - rr * 0.5, 0, cy2 + rr * 0.5);
      gg.addColorStop(0, spRgb(spTone(T, 0.46)));
      gg.addColorStop(1, spRgb(spTone(T, 0.12)));
      ctx.fillStyle = gg;
      ctx.fill();
    }
  };
  const [g0, g1] = HVS.growths as [Growth, Growth];
  drawGrowth(g0);
  g0.branches.forEach(drawGrowth);

  /* ---- the colony: one mass of lobes, shaded as a whole, folded where lobes meet ---- */
  const lobePoints = (l: Lobe): Pair[] => {
    const n = det ? 56 : 28;
    const pts: Pair[] = [];
    const sc = 1 + breathe - 0.012 * resp(Math.hypot(l.x - H[0], l.y - H[1]));
    for (let i = 0; i < n; i++) {
      const th = (i / n) * TAU;
      let k = 1;
      for (const [m, a, p] of l.h) k += a * Math.sin(m * th + p);
      k += 0.05 * spN2(Math.cos(th) * 1.6 + l.seed, Math.sin(th) * 1.6, 62);
      pts.push([l.x + Math.cos(th) * l.rx * k * sc, Math.min(G + 7, l.y + Math.sin(th) * l.ry * k * sc)]);
    }
    return pts;
  };
  const LP = HVS.lobes.map(lobePoints);
  /** Trace one lobe's outline on `c`. */
  const traceLobe = (c: CanvasRenderingContext2D, pts: Pair[]): void => {
    c.beginPath();
    traceSmooth(c, pts);
  };
  {
    const g = ctx.createRadialGradient(-26, -18, 4, 0, 18, 115);
    for (const [q, k] of [
      [0, 0.58],
      [0.35, 0.38],
      [0.7, 0.2],
      [1, 0.08],
    ] as const) {
      g.addColorStop(q, spRgb(spTone(T, k)));
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    for (const pts of LP) traceSmooth(ctx, pts);
    ctx.fill();
  }

  /* Inside the front lobe, drawn on its own layer and faded into the body at the edges, so the tissue thins into
     a window rather than ending at one. */
  const drawWindow = (l: Lobe, lp: Pair[]): void => {
    const off = layerFor(ctx);
    const c = off.getContext('2d') as CanvasRenderingContext2D | null;
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, off.width, off.height);
    c.setTransform(ctx.getTransform());
    const U = (x: number, y: number): Pair => [l.x + x * l.rx, l.y + y * l.ry];
    c.save();
    traceLobe(c, lp);
    c.clip();
    {
      const g = c.createRadialGradient(H[0], H[1], 4, l.x, l.y, l.rx);
      g.addColorStop(0, spRgb(spTone(T, 0.1)));
      g.addColorStop(1, spRgb(spTone(T, 0.2)));
      c.fillStyle = g;
      traceLobe(c, lp);
      c.fill();
    }
    for (const ch of HVS.chambers) {
      const [x, y] = U(ch.x, ch.y);
      const rx = ch.rx * l.rx;
      const ry = ch.ry * l.ry;
      const pts: Pair[] = [];
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU;
        const k = 1 + 0.24 * spN(i * 0.9 + ch.seed, 64);
        pts.push([x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k]);
      }
      c.beginPath();
      pts.forEach((q, i) => c[i ? 'lineTo' : 'moveTo'](q[0], q[1]));
      c.closePath();
      c.strokeStyle = spRgb(spTone(T, 0.3), 0.75);
      c.lineWidth = ch.wall * 1.6;
      c.lineJoin = 'round';
      c.stroke();
      const g = c.createRadialGradient(x, y - ry * 0.25, 0, x, y, Math.max(rx, ry));
      g.addColorStop(0, spRgb(T.lo, ch.dep));
      g.addColorStop(1, spRgb(spTone(T, 0.14), 0.85));
      c.fillStyle = g;
      c.fill();
      c.beginPath();
      pts.slice(1, 6).forEach((q, i) => c[i ? 'lineTo' : 'moveTo'](q[0], q[1] - 0.6));
      c.strokeStyle = spRgb(T.hi, 0.14);
      c.lineWidth = 0.5;
      c.stroke();
    }
    for (const m of HVS.membranes) {
      const p0 = U(...m.p0);
      const cc = U(...m.c);
      const p1 = U(...m.p1);
      const sh = 1.5 * resp(30) + 0.6 * ovLoop(t, m.seed, 2);
      c.beginPath();
      c.moveTo(p0[0], p0[1]);
      c.quadraticCurveTo(cc[0] + sh, cc[1] - sh, p1[0], p1[1]);
      c.lineCap = 'round';
      c.strokeStyle = spRgb(T.hi, 0.08);
      c.lineWidth = m.w * l.rx;
      c.stroke();
      c.strokeStyle = spRgb(T.hi, 0.1);
      c.lineWidth = 0.5;
      c.stroke();
    }
    if (det) {
      c.beginPath();
      for (const [x0, y0, x1, y1, sag] of HVS.strands) {
        const a = U(x0, y0);
        const b = U(x1, y1);
        c.moveTo(a[0], a[1]);
        c.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + sag * l.ry, b[0], b[1]);
      }
      c.strokeStyle = spRgb(spTone(T, 0.4), 0.2);
      c.lineWidth = 0.4;
      c.stroke();
    }
    for (const v of tubes) {
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.beginPath();
      v.pts.forEach((q, i) => c[i ? 'lineTo' : 'moveTo'](q[0], q[1]));
      c.strokeStyle = spRgb(T.lo, 0.55);
      c.lineWidth = v.w + 1.3;
      c.stroke();
      c.strokeStyle = spRgb(spTone(T, 0.3));
      c.lineWidth = v.w;
      c.stroke();
      c.strokeStyle = spRgb(T.hi, 0.12);
      c.lineWidth = v.w * 0.3;
      c.stroke();
    }
    for (const sc of HVS.sacs) {
      const [x0, y0] = U(sc.x, sc.y);
      const d = Math.hypot(x0 - H[0], y0 - H[1]);
      const rsp = resp(d);
      const dx = (x0 - H[0]) / (d || 1);
      const dy = (y0 - H[1]) / (d || 1);
      const x = x0 + dx * rsp * 1.6;
      const y = y0 + dy * rsp * 1.6;
      const rr = sc.r * l.rx * (1 + 0.08 * rsp + 0.03 * ovLoop(t, sc.seed, 2));
      c.beginPath();
      c.ellipse(x, y, rr, rr * 0.85, 0, 0, TAU);
      const g = c.createRadialGradient(x - rr * 0.3, y - rr * 0.35, 0, x, y, rr);
      g.addColorStop(0, spRgb(spTone(T, 0.5), 0.85));
      g.addColorStop(0.7, spRgb(spTone(T, 0.24), 0.85));
      g.addColorStop(1, spRgb(T.lo, 0.9));
      c.fillStyle = g;
      c.fill();
      c.fillStyle = spRgb(T.hi, 0.32);
      c.beginPath();
      c.ellipse(x - rr * 0.35, y - rr * 0.4, rr * 0.25, rr * 0.13, -0.5, 0, TAU);
      c.fill();
    }
    for (const cl of HVS.clusters) {
      const [x, y] = U(cl.x, cl.y);
      for (let j = 0; j < cl.n; j++) {
        const a = hash(cl.seed + j) * TAU;
        const d = hash(cl.seed + j + 5) * 4;
        const rr = 0.8 + hash(cl.seed + j + 9) * 1.3;
        c.beginPath();
        c.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, rr, rr * 0.8, 0, 0, TAU);
        c.fillStyle = spRgb(spTone(T, 0.42), 0.9);
        c.fill();
      }
    }
    /* the organ: several swollen lobes in a thick sheath, squeezed on each beat */
    {
      const pts: Pair[] = [];
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TAU;
        const k = 1 + 0.18 * spN(i * 0.8, 65);
        pts.push([H[0] + Math.cos(a) * 22 * k * (1 - 0.04 * hp), H[1] + Math.sin(a) * 19 * k * (1 - 0.04 * hp)]);
      }
      c.beginPath();
      pts.forEach((q, i) => c[i ? 'lineTo' : 'moveTo'](q[0], q[1]));
      c.closePath();
      const g = c.createRadialGradient(H[0], H[1], 4, H[0], H[1], 24);
      g.addColorStop(0, spRgb(spTone(T, 0.08)));
      g.addColorStop(1, spRgb(spTone(T, 0.2), 0.6));
      c.fillStyle = g;
      c.fill();
    }
    const sq = 1 - 0.14 * Math.min(1, hp);
    const bob = Math.sin(w10 * 2 * t) * 0.02;
    for (const [ox, oy, rx, ry, rot] of ORGAN) {
      const x = H[0] + ox * sq;
      const y = H[1] + oy * sq;
      const rxx = rx * sq * (1 + bob);
      const ryy = ry * sq * (1 + bob);
      c.beginPath();
      c.ellipse(x, y, rxx, ryy, rot, 0, TAU);
      const g = c.createRadialGradient(x - rxx * 0.35, y - ryy * 0.4, 0, x, y, Math.max(rxx, ryy));
      g.addColorStop(0, spRgb(spTone(T, 0.46)));
      g.addColorStop(0.7, spRgb(spTone(T, 0.22)));
      g.addColorStop(1, spRgb(spTone(T, 0.1)));
      c.fillStyle = g;
      c.fill();
      c.fillStyle = spRgb(T.hi, 0.16);
      c.beginPath();
      c.ellipse(x - rxx * 0.35, y - ryy * 0.45, rxx * 0.3, ryy * 0.14, rot - 0.4, 0, TAU);
      c.fill();
    }
    c.restore();
    /* fade the whole layer out toward the lobe's rim; destination-in reads only the mask's alpha */
    c.globalCompositeOperation = 'destination-in';
    c.save();
    c.translate(H[0], H[1] + 6);
    c.scale(1.25, 1);
    const mg = c.createRadialGradient(0, 0, 8, 0, 0, 44);
    mg.addColorStop(0, spRgb(T.lo, 1));
    mg.addColorStop(0.55, spRgb(T.lo, 0.8));
    mg.addColorStop(1, spRgb(T.lo, 0));
    c.fillStyle = mg;
    c.fillRect(-60, -60, 120, 120);
    c.restore();
    c.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(off, 0, 0);
    ctx.restore();
    /* light, travelling through the anatomy; dimmer where more tissue lies over it */
    const mask = (x: number, y: number): number => clamp(1 - Math.hypot((x - H[0]) / 1.25, y - H[1] - 6) / 44);
    ctx.globalCompositeOperation = GM;
    spBlob(ctx, H[0], H[1], 6 + 16 * Math.min(1.2, hp), 7 + 16 * Math.min(1.2, hp), T.green, 0.04 + 0.65 * Math.min(1, hp), 0.35);
    for (const v of tubes) {
      const gain = v.gain ?? 1;
      if (gain < 0.05) continue;
      for (let i = 1; i < v.pts.length; i++) {
        const a = v.pts[i - 1]!;
        const b = v.pts[i]!;
        const l2 = lightAt(b[2], gain, false, 0) * (0.35 + 0.65 * mask(b[0], b[1]));
        if (l2 < 0.02) continue;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineCap = 'round';
        ctx.strokeStyle = spRgb(T.green, 0.22 * l2);
        ctx.lineWidth = v.w + 5;
        ctx.stroke();
        ctx.strokeStyle = spRgb(T.green, Math.min(0.85, 0.7 * l2));
        ctx.lineWidth = v.w * 0.45;
        ctx.stroke();
      }
    }
    for (const q of HVS.iresid) {
      const g = q.base + q.peak * Math.exp(-ovM(t - 5.4 - q.arr) / q.tau);
      spBlob(ctx, q.x, q.y, q.r * (1 + g), q.r * 0.8 * (1 + g), T.green, 0.5 * g, 0.4);
    }
    spBlob(ctx, H[0], H[1], 30 + 14 * hp, 26 + 12 * hp, T.green, 0.15 * Math.min(1, hp));
    ctx.globalCompositeOperation = 'source-over';
    /* the outer membrane over it, wet */
    ctx.save();
    traceLobe(ctx, lp);
    ctx.clip();
    spBlob(ctx, H[0], H[1] + 4, 52, 44, spTone(T, l.k), 0.22, 0.5);
    spBlob(ctx, l.x - l.rx * 0.32, l.y - l.ry * 0.5, l.rx * 0.3, l.ry * 0.1, T.hi, 0.14);
    ctx.restore();
  };
  const tubes: { pts: P3[]; w: number; gain?: number }[] = [...HVS.ivs, ...HVS.vessels.filter((v) => !v.back)];

  HVS.lobes.forEach((l, li) => {
    const pts = LP[li]!;
    ctx.save();
    traceLobe(ctx, pts);
    ctx.clip();
    spBlob(ctx, l.x - l.rx * 0.3, l.y - l.ry * 0.4, l.rx * 0.8, l.ry * 0.6, T.hi, l.old ? 0.07 : 0.11);
    spBlob(ctx, l.x + l.rx * 0.1, l.y + l.ry * 0.85, l.rx * 0.9, l.ry * 0.45, T.lo, 0.42);
    for (const [cx2, cy2, rr] of l.crust) {
      const x = l.x + cx2 * l.rx;
      const y = l.y + cy2 * l.ry;
      spBlob(ctx, x, y, rr * l.rx, rr * l.ry * 0.7, mTone(0.5), 0.3, 0.6);
      if (det) {
        ctx.beginPath();
        for (let j = 0; j < 3; j++) {
          const a = hash(rr * 99 + j) * TAU;
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(a) * rr * l.rx * 0.8, y + Math.sin(a) * rr * l.ry * 0.5);
        }
        ctx.strokeStyle = spRgb(M.lo, 0.4);
        ctx.lineWidth = 0.45;
        ctx.stroke();
      }
    }
    if (det && !l.main) {
      ctx.beginPath();
      for (const [px, py, pr] of l.pores) {
        const x = l.x + px * l.rx;
        const y = l.y + py * l.ry;
        ctx.moveTo(x + pr, y);
        ctx.ellipse(x, y, pr, pr * 0.65, 0, 0, TAU);
      }
      ctx.fillStyle = spRgb(T.lo, 0.38);
      ctx.fill();
      for (const [a0, a1, d] of l.ridges) {
        const rp: Pair[] = [];
        for (let j = 0; j <= 10; j++) {
          const a = mix(a0, a1, j / 10);
          rp.push([l.x + Math.cos(a) * l.rx * d + spN(j + a0, 63), l.y + Math.sin(a) * l.ry * d]);
        }
        spPath(ctx, rp);
        ctx.strokeStyle = spRgb(T.lo, 0.3);
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.save();
        ctx.translate(-0.4, -0.5);
        spPath(ctx, rp);
        ctx.strokeStyle = spRgb(T.hi, 0.13);
        ctx.lineWidth = 0.45;
        ctx.stroke();
        ctx.restore();
      }
    }
    if (!l.old) {
      spBlob(ctx, l.x - l.rx * 0.36, l.y - l.ry * 0.52, l.rx * 0.22, l.ry * 0.08, T.hi, 0.16);
      if (det) {
        ctx.fillStyle = spRgb(T.hi, 0.42);
        ctx.beginPath();
        ctx.arc(l.x - l.rx * 0.4, l.y - l.ry * 0.54, 0.55, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
    /* the fold: where this lobe rolls over the ones behind it */
    if (li > 1) {
      const top = pts.filter((_, i) => {
        const th = (i / pts.length) * TAU;
        return th > Math.PI * 1.08 && th < Math.PI * 1.92;
      });
      ctx.lineCap = 'round';
      ctx.save();
      ctx.translate(0, -1.5);
      spPath(ctx, top);
      ctx.strokeStyle = spRgb(T.lo, 0.14);
      ctx.lineWidth = 7;
      ctx.stroke();
      spPath(ctx, top);
      ctx.strokeStyle = spRgb(T.lo, 0.26);
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
      spPath(ctx, top);
      ctx.strokeStyle = spRgb(T.hi, l.old ? 0.04 : 0.07);
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    for (const [lx, ly, lr] of l.lumps) {
      const x = l.x + lx * l.rx;
      const y = l.y + ly * l.ry;
      spBlob(ctx, x + lr * 0.3, y + lr * 0.5, lr * 1.6, lr * 0.8, T.lo, 0.4);
      ctx.beginPath();
      ctx.ellipse(x, y, lr * 1.4, lr * 0.75, lx * 0.6, 0, TAU);
      const gg = ctx.createRadialGradient(x - lr * 0.5, y - lr * 0.35, 0, x, y, lr * 1.4);
      gg.addColorStop(0, spRgb(l.old ? mTone(0.42) : spTone(T, 0.46), 0.9));
      gg.addColorStop(1, spRgb(l.old ? spMix(mTone(0.15), spTone(T, 0.2), 0.5) : spTone(T, 0.2), 0));
      ctx.fillStyle = gg;
      ctx.fill();
    }
    if (l.main) drawWindow(l, pts);
  });

  for (const o2 of HVS.openings) {
    const g = ctx.createRadialGradient(o2.x, o2.y - o2.ry * 0.2, 0, o2.x, o2.y, o2.rx * 1.6);
    g.addColorStop(0, spRgb(T.lo, 0.98));
    g.addColorStop(0.45, spRgb(T.lo, 0.8));
    g.addColorStop(1, spRgb(T.lo, 0));
    ctx.save();
    ctx.translate(o2.x, o2.y);
    ctx.scale(1, o2.ry / o2.rx);
    ctx.translate(-o2.x, -o2.y);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(o2.x, o2.y, o2.rx * 1.6, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(o2.x, o2.y + o2.ry * 0.55, o2.rx * 0.9, o2.ry * 0.5, 0, 0.15, Math.PI - 0.15);
    ctx.strokeStyle = spRgb(T.hi, 0.16);
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  /* where it meets the ground, it is the ground */
  spBlob(ctx, 0, G + 4, 112, 14, T.lo, 0.8, 0.55);
  for (const m of HVS.mats) {
    if (m.v > 8 && Math.abs(m.u) < 90) {
      const p = P(m.u, m.v);
      spBlob(ctx, p[0], p[1] - 2, m.rx * 0.8, m.rx * 0.22, spMix(T.lo, spTone(T, 0.22), 0.4), 0.6, 0.5);
    }
  }
  drawNet(true);
  growthBase(g0);
  drawGrowth(g1);
  g1.branches.forEach(drawGrowth);
  growthBase(g1);
  ctx.globalCompositeOperation = GM;
  spBlob(ctx, H[0], H[1] + 10, 120, 70, T.green, 0.06 * Math.min(1, hp + resp(40) * 0.5));
  ctx.globalCompositeOperation = 'source-over';
}

export const HIVE: BroodCreature = {
  dur: 10,
  rest: 8.8,
  box: [-140, -104, 280, 224],
  // The artifact's player hands `draw` its time already wrapped to the loop.
  draw: (ctx, t, s, T) => drawHive(ctx, ovM(t), s, T),
};
