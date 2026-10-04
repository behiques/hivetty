import { clamp, ease, hash, mix, sm, spCross, spDot, spN2, spNorm, spRng, spSub, TAU, type V3 } from '@lib/swarm/kit';

/**
 * The mutalisk, holding the air (HIVE-221): a flyer suspended in place over
 * the creep, beating slow heavy wings.
 *
 * Each stroke is phased (downstroke, compression, recovery, upstroke, a brief
 * spread at the top), lagging from the shoulder out to the tip, and lifts the
 * torso; the torso, its pitch and roll and drift, is simulated once as a
 * damped body, and the spine below it is a chain of vertebrae that follows its
 * parent's bend with stiffness falling off toward the tip, so every wingbeat
 * and correction travels down the tail late, later, latest.
 *
 * Ported number for number from the artifact (`brood-v15.html`, lines
 * 1404–1762). The simulation runs six loops and records the last, once per
 * module, on first draw rather than at import.
 */

type P3 = [number, number, number];
/** Torso state: x, y, z, pitch, roll, yaw. */
type State = readonly number[];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sc = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

/** Rotate `v` by the smallest rotation that takes unit `a` onto unit `b`. */
const swing = (a: V3, b: V3, v: V3): V3 => {
  const c = spDot(a, b);
  const k = spCross(a, b);
  if (c < -0.999) return v;
  const kv = spCross(k, v);
  const kd = spDot(k, v) / (1 + c);
  return [v[0] * c + kv[0] + k[0] * kd, v[1] * c + kv[1] + k[1] * kd, v[2] * c + kv[2] + k[2] * kd];
};

/** The torso's orientation as a rotation of body-frame vectors. */
const rot = (st: State): ((v: V3) => V3) => {
  const pit = st[3]!;
  const rol = st[4]!;
  const yaw = st[5]!;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(-pit);
  const sp = Math.sin(-pit);
  const cr = Math.cos(rol);
  const sr = Math.sin(rol);
  return (v) => {
    const x = v[0] * cr - v[1] * sr;
    const y = v[0] * sr + v[1] * cr;
    const z = v[2];
    const y2 = y * cp - z * sp;
    const z2 = y * sp + z * cp;
    return [x * cy + z2 * sy, y2, -x * sy + z2 * cy];
  };
};

function simulate() {
  const TP = 4;
  const BP = 2;
  const FPS = 120;
  const NF = TP * FPS;
  const dt = 1 / FPS;
  const L = 4;
  const r = spRng(211);
  const R = (a: number, b: number): number => a + (b - a) * r();
  const loopN = (t: number, sd: number, f = 1): number => {
    const a = (TAU * t) / TP;
    return spN2(Math.cos(a) * f + sd * 3.1, Math.sin(a) * f + sd * 1.7, sd);
  };
  /* the spine at rest, in the body's frame (chest at the origin, y up, z forward): head high and forward, the body
     hanging under the wings and hooking forward, the tail tip turned up. A little off the midline, never mirrored. */
  const ctl: P3[] = [
    [11, 17, 19],
    [6, 18, 12],
    [2, 12, 6],
    [0.5, 0, 0],
    [0, -14, -6],
    [-0.9, -29, -8],
    [-1.6, -43, -3],
    [-1.4, -55, 8],
    [-0.5, -60, 22],
    [0.7, -56, 35],
    [1.4, -47, 42],
  ];
  const dense: V3[] = [];
  for (let j = 0; j < ctl.length - 1; j++) {
    const p0 = ctl[Math.max(0, j - 1)]!;
    const p1 = ctl[j]!;
    const p2 = ctl[j + 1]!;
    const p3 = ctl[Math.min(ctl.length - 1, j + 2)]!;
    for (let q = 0; q < 40; q++) {
      const u = q / 40;
      const u2 = u * u;
      const u3 = u2 * u;
      const at = (k: 0 | 1 | 2): number =>
        0.5 *
        (2 * p1[k] +
          (-p0[k] + p2[k]) * u +
          (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 +
          (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3);
      dense.push([at(0), at(1), at(2)]);
    }
  }
  dense.push(ctl[ctl.length - 1]!);
  const rest: V3[] = [dense[0]!];
  {
    let prev = dense[0]!;
    let acc = 0;
    for (let i = 1; i < dense.length; i++) {
      const q = dense[i]!;
      let d = len(spSub(q, prev));
      while (acc + d >= L) {
        const k = (L - acc) / d;
        prev = [mix(prev[0], q[0], k), mix(prev[1], q[1], k), mix(prev[2], q[2], k)];
        rest.push(prev);
        d = len(spSub(q, prev));
        acc = 0;
      }
      acc += d;
      prev = q;
    }
  }
  const N = rest.length;
  let CH = 0;
  rest.forEach((p, i) => {
    if (len(p) < len(rest[CH]!)) CH = i;
  });
  /* head, neck and chest are carried; everything after TK is simulated */
  const TK = CH + 1;
  const radAt = (i: number): number => {
    const u = i / (N - 1);
    return (
      (u < 0.06
        ? mix(4.2, 4.8, u / 0.06)
        : u < 0.16
          ? mix(3.6, 4.4, (u - 0.06) / 0.1)
          : u < 0.3
            ? mix(5.2, 10.6, ease((u - 0.16) / 0.14))
            : u < 0.5
              ? mix(10.6, 6.6, ease((u - 0.3) / 0.2))
              : u < 0.95
                ? mix(6.2, 2.1, ((u - 0.5) / 0.45) ** 0.9)
                : mix(2.1, 2.9, (u - 0.95) / 0.05)) *
      (1 + 0.05 * Math.sin(i * 2.1))
    );
  };
  /* the stroke: downstroke (fast), compression at the bottom, recovery and upstroke (slow), a brief spread at the top */
  const WK: readonly (readonly [number, number])[] = [
    [0, 0],
    [0.36, 0.5],
    [0.46, 0.535],
    [0.84, 0.97],
    [1, 1],
  ];
  const warp = (u0: number): number => {
    const u = ((u0 % 1) + 1) % 1;
    for (let j = 1; j < WK.length; j++) {
      if (u <= WK[j]![0]) {
        const [a0, b0] = WK[j - 1]!;
        const [a1, b1] = WK[j]!;
        return b0 + ((b1 - b0) * (u - a0)) / (a1 - a0);
      }
    }
    return 1;
  };
  const thOf = (u: number, amp = 1): number => 0.32 + 0.52 * amp * Math.cos(TAU * warp(u));
  const press = (u: number): number => clamp(-(thOf(u + 0.004) - thOf(u - 0.004)) / 0.008 / 4.6);
  const foldOf = (u0: number): number => {
    const u = ((u0 % 1) + 1) % 1;
    return sm(0.33, 0.47, u) * (1 - sm(0.7, 0.9, u));
  };
  /* two wingbeats a loop, the second one harder on the right: [right strength, left strength, left lag (cycles), slack] */
  const BEAT: readonly (readonly number[])[] = [
    [1, 1, 0.02, 0],
    [1.13, 0.97, 0.02, 0],
  ];
  const bv = (t: number, j: number): number => {
    const x = (((t / BP) % 2) + 2) % 2;
    const k = Math.floor(x);
    const f = sm(0.82, 1, x - k);
    return mix(BEAT[k]![j]!, BEAT[(k + 1) % 2]![j]!, f);
  };
  const wrap = (t: number): number => ((t % TP) + TP) % TP;
  const uOf = (t: number, side: number): number => t / BP - (side < 0 ? bv(t, 2) : 0);
  const ampOf = (t: number, side: number): number => bv(t, side > 0 ? 0 : 1);
  /* the head: dwelling right, drifting left through the first beat, sweeping back right while the beam searches */
  const headYaw = (t: number): number => {
    const m = wrap(t);
    return 0.14 * (1 - 2 * sm(0.15, 1.7, m) + 2 * sm(2.3, 3.4, m)) + 0.015 * loopN(t, 7, 1.2);
  };
  const headPit = (t: number): number => 0.025 * loopN(t, 8, 1.1);
  /* the tail steers too: a slow bias that wanders, a long drift to one side and back, and a wide correction at the tip */
  const tailBias = (t: number): number => {
    const m = wrap(t);
    return 0.06 * loopN(t, 11, 1.1) - 0.32 * (sm(2.3, 3.2, m) - sm(3.4, 3.95, m));
  };
  const tipBias = (t: number): number => 0.06 * loopN(t, 12, 1.4);
  /* mean lift, so the torso hangs where it is put */
  let LM = 0;
  for (let j = 0; j < 400; j++) LM += press(j / 400);
  LM /= 400;
  const st = [0, 0, 0, 0, 0, 0];
  const vel = [0, 0, 0, 0, 0, 0];
  const nodes: V3[] = rest.map((p): V3 => [...p]);
  const prv: V3[] = rest.map((p): V3 => [...p]);
  const REC = 3 * N + 6;
  const rec = new Float32Array(NF * REC);
  /* the last vertebrae carry no momentum of their own: they ease toward their parent's bend, so the tip trails late
     and small and cannot whip */
  const TIP = N - 8;
  const Kt = (i: number): number => 0.55 * Math.exp(-(i - TK - 1) / 7) + 0.11;
  for (let step = 0; step < 6 * NF; step++) {
    const t = step * dt;
    const uL = uOf(t, -1);
    const uR = uOf(t, 1);
    const aL = ampOf(t, -1);
    const aR = ampOf(t, 1);
    const pL = press(uL) * aL;
    const pR = press(uR) * aR;
    const lift = (pL + pR) / (2 * LM) - 1;
    const ht = headYaw(t);
    const acc = [
      7 * (1.1 * loopN(t, 1, 0.9) - st[0]!) - 2.6 * vel[0]!,
      5 * lift - 34 * st[1]! - 4.2 * vel[1]!,
      6 * (0.9 * loopN(t, 2, 0.8) - 0.4 * lift - st[2]!) - 2.6 * vel[2]!,
      0.4 * lift - 46 * st[3]! - 5.5 * vel[3]!,
      (1.6 * (pR - pL)) / LM - 40 * st[4]! - 5 * vel[4]!,
      8 * (0.035 * loopN(t, 3, 0.9) - 0.3 * ht - st[5]!) - 3 * vel[5]!,
    ];
    for (let k = 0; k < 6; k++) {
      vel[k]! += acc[k]! * dt;
      st[k]! += vel[k]! * dt;
    }
    const Rt = rot(st);
    const pos: V3 = [st[0]!, st[1]!, st[2]!];
    const at = (p: V3): V3 => add(Rt(p), pos);
    /* carried: chest and neck with the torso; the head stabilised, absorbing most of the bob and roll, then its own look */
    const hst = [st[0]! * 0.85, st[1]! * 0.4, st[2]! * 0.85, st[3]! * 0.3 + headPit(t), st[4]! * 0.3, st[5]! * 0.4 + ht];
    const Rh = rot(hst);
    const piv = rest[CH - 1]!;
    for (let i = 0; i <= TK; i++) {
      const tp = at(rest[i]!);
      if (i >= CH - 1) {
        nodes[i] = tp;
        continue;
      }
      const hp = add(add(Rh(spSub(rest[i]!, piv)), Rt(piv)), [0, st[1]! * -0.6, 0]);
      const w = clamp((i - 2) / (CH - 3)) ** 1.5;
      nodes[i] = [mix(hp[0], tp[0], w), mix(hp[1], tp[1], w), mix(hp[2], tp[2], w)];
    }
    /* simulated: inertia, a little gravity, air drag */
    for (let i = TK + 1; i < TIP; i++) {
      const p = nodes[i]!;
      const q = prv[i]!;
      const d = 0.985;
      prv[i] = [...p];
      nodes[i] = [p[0] + (p[0] - q[0]) * d, p[1] + (p[1] - q[1]) * d - 0.002, p[2] + (p[2] - q[2]) * d];
    }
    const latW = Rt([1, 0, 0]);
    const tb = tailBias(t);
    const tpb = tipBias(t);
    for (let it = 0; it < 4; it++) {
      for (let i = TK + 1; i < N; i++) {
        const a = nodes[i - 1]!;
        const b = nodes[i - 2]!;
        const cur = spNorm(spSub(a, b));
        const rd = Rt(spNorm(spSub(rest[i - 1]!, rest[i - 2]!)));
        let dl = Rt(spSub(rest[i]!, rest[i - 1]!));
        const gb = i < TK + 12 ? 0.2 : 0;
        const gt = i > N - 11 ? 0.32 : 0;
        dl = add(dl, sc(latW, tb * gb + tpb * gt));
        const tg = add(a, swing(rd, cur, dl));
        const an = at(rest[i]!);
        const k = i >= TIP ? 0.07 : Kt(i);
        const p: P3 = [...nodes[i]!];
        for (let c = 0; c < 3; c++) p[c]! += (tg[c]! - p[c]!) * k + (an[c]! - p[c]!) * 0.02;
        const e = spSub(p, a);
        const el = len(e) || 1;
        nodes[i] = add(a, sc(e, L / el));
      }
    }
    if (step >= 5 * NF) {
      const o = (step - 5 * NF) * REC;
      for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) rec[o + i * 3 + c] = nodes[i]![c]!;
      for (let k = 0; k < 6; k++) rec[o + 3 * N + k] = st[k]!;
    }
  }
  const frame = (t: number): { ns: P3[]; st: number[] } => {
    const ft = (((t % TP) + TP) % TP) * FPS;
    const f0 = Math.floor(ft) % NF;
    const f1 = (f0 + 1) % NF;
    const k = ft - Math.floor(ft);
    const a = f0 * REC;
    const b = f1 * REC;
    const ns: P3[] = [];
    const lerp = (i: number): number => mix(rec[a + i]!, rec[b + i]!, k);
    for (let i = 0; i < N; i++) ns.push([lerp(i * 3), lerp(i * 3 + 1), lerp(i * 3 + 2)]);
    const s6 = [0, 1, 2, 3, 4, 5].map((c) => lerp(3 * N + c));
    return { ns, st: s6 };
  };
  /* anatomy, grown once */
  const lump = Array.from({ length: N }, () => R(-1, 1));
  const knobs = Array.from({ length: N }, (_, i) => ({
    k: i > CH - 3 && i < N - 4 && r() < 0.55,
    sz: R(0.3, 0.55),
    spine: i > CH - 2 && i < N - 4 && r() < 0.34,
    sl: R(1, 1.8),
    a: R(-0.5, 0.5),
  }));
  const wing = (side: number) => ({
    side,
    hum: 18 * R(0.95, 1.05),
    fore: 24 * R(0.95, 1.05),
    fin: [60, 52, 43, 33].map((l) => l * R(0.94, 1.06)),
    rel: [-0.12, -0.62, -1.08, -1.52].map((a) => a + R(-0.06, 0.06)),
    att: N - 1 - Math.round(N * 0.5) + (side > 0 ? 1 : 0),
    rag: Array.from({ length: 4 }, () =>
      Array.from({ length: 11 }, (_, j) => (j === 0 || j === 10 ? 0 : R(0, 1) ** 2 * (r() < 0.15 ? 2.6 : 1))),
    ),
    holes: Array.from(
      { length: 1 + ((r() * 2) | 0) },
      (): [number, number, number, number, number] => [(r() * 3) | 0, R(0.45, 0.8), R(0.3, 0.7), R(0.9, 1.7), R(0, 9)],
    ),
    veins: Array.from({ length: 4 }, (): [number, number, number, number] => [
      R(0.25, 0.4),
      R(0.6, 0.75),
      R(0.35, 0.6),
      R(-0.2, 0.2),
    ]),
    kink: Array.from({ length: 4 }, (): [number, number] => [R(-3, 3), R(-1.5, 2.5)]),
    ph: R(0, 6),
  });
  const wings = [wing(-1), wing(1)];
  /* the skin, grown once and pinned to the body by (vertebra, angle round the body): it bends with it and never
     swims. angle 0 is the belly, PI the back */
  const PI = Math.PI;
  const A2 = (): number => R(-PI, PI);
  const skin = Array.from({ length: N }, () => ({
    spots: Array.from({ length: 4 }, (): [number, number, number, number] => [A2(), R(0, 1), R(0.18, 0.42), r() < 0.45 ? 1 : 0]),
    pores: Array.from({ length: 7 }, (): [number, number, number] => [A2(), R(0, 1), r() < 0.25 ? R(0.35, 0.75) : 0]),
    glints: Array.from({ length: 7 }, (): [number, number, number] => [A2(), R(0, 1), R(0.3, 1)]),
    veins: [] as [number, number, number, number, number, number][],
    sacs: [] as [number, number, number][],
  }));
  const vein = (u0: number, u1: number, a0: number, a1: number, wob: number, kind: number): [number, number][] => {
    const n = Math.max(3, Math.round(Math.abs(u1 - u0) * 2.2));
    const ph = R(0, 9);
    const pts: [number, number][] = [];
    for (let j = 0; j <= n; j++) {
      const q = j / n;
      pts.push([mix(u0, u1, q), mix(a0, a1, q) + wob * Math.sin(q * 7 + ph) * Math.sin(PI * q)]);
    }
    for (let j = 0; j < n; j++) {
      const [ua, aa] = pts[j]!;
      const [ub, ab] = pts[j + 1]!;
      const i = clamp(Math.floor(Math.min(ua, ub)), 2, N - 2);
      skin[i]!.veins.push([ua, aa, ub, ab, kind, j / n]);
    }
    return pts;
  };
  vein(CH + 0.5, 2.2, 0.35, 0.12, 0.25, 0);
  vein(CH + 0.5, 2.5, -0.42, -0.6, 0.2, 0);
  vein(CH - 0.5, 2.8, 0.9, 1.3, 0.15, 0);
  for (const sd of [1, -1]) {
    vein(CH + 1.5, CH - 1, sd * 0.6, sd * 2.1, 0.2, 1);
    vein(CH + 3, CH - 0.2, sd * 0.95, sd * 2.4, 0.25, 1);
    const main = vein(CH + 1, N - 3, sd * 1.25, sd * 1.45, 0.35, 2);
    for (const j of [3, 8, 14, 21]) {
      const m = main[j];
      if (m) vein(m[0], m[0] + R(1.8, 3), m[1], m[1] * 0.25, 0.15, 2);
    }
  }
  vein(CH + 2, N * 0.62, 0.1, -0.25, 0.3, 2);
  const SACS: readonly [number, number, number][] = [
    [2.6, 0.25, 1.2],
    [3.7, -0.35, 0.95],
    [5.1, 0.4, 1.4],
    [CH + 2.5, 0.05, 1.7],
    [CH + 5, -0.32, 1.2],
    [CH + 8, 0.28, 1.35],
  ];
  for (const [u, a, sz] of SACS) skin[clamp(Math.floor(u), 2, N - 2)]!.sacs.push([u, a, sz]);
  /* teeth: uneven, a few broken, a few crooked; upper along the snout, lower along the jaw */
  const teeth: { low: boolean; f: number; sd: number; len: number; tilt: number; broken: boolean; w: number }[] = [];
  for (let k = 0; k < 18; k++) {
    const low = k >= 10;
    const f = low ? R(1.5, 9.5) : R(1.5, 10.5);
    teeth.push({
      low,
      f,
      sd: r() < 0.5 ? 1 : -1,
      len: R(0.7, 2.3) * (low ? 0.8 : 1),
      tilt: R(-0.35, 0.4),
      broken: r() < 0.2,
      w: R(0.45, 0.7),
    });
  }
  const hblots = Array.from({ length: 9 }, (): [number, number, number, number] => [R(-8, 9), R(-1, 4), R(0.8, 1), R(0.8, 1.8)]);
  const dust = Array.from({ length: 26 }, () => ({ a: R(0, TAU), r: R(14, 70), sz: R(0.5, 1.4), sd: R(0, 9) }));
  const blot = Array.from({ length: N }, (_, i): [number, number, number] => [
    hash(i * 3.1) * TAU,
    0.25 + 0.3 * hash(i * 7.7),
    hash(i * 1.9),
  ]);
  return {
    TP,
    BP,
    N,
    CH,
    L,
    rest,
    radAt,
    frame,
    rot,
    thOf,
    press,
    foldOf,
    uOf,
    ampOf,
    bv,
    lump,
    knobs,
    wings,
    dust,
    LM,
    headYaw,
    skin,
    teeth,
    hblots,
    blot,
  };
}

export type HoverSim = ReturnType<typeof simulate>;

let sim: HoverSim | null = null;

/** The artifact's `HM`: recorded on first use, then the same object every time. */
export function hoverSim(): HoverSim {
  sim ??= simulate();
  return sim;
}
