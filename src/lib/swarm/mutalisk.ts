import type { SwarmPalette } from '@lib/swarm/palette';

/**
 * The mutalisk, from above (HIVE-199; design §11.1).
 *
 * A port of the prototype's `round12-creature.js`, number for number: head
 * forward, horns swept back, spikes down the spine; each wing an arm out to the
 * elbow, a leading edge up to the wrist and its thumb claw, the outer finger
 * arching back to the tip, spars fanning to clawed points, a scalloped,
 * battle-worn membrane. The tail carries the life: a slow S travels down it,
 * and it swings wide on every turn. Local units, heading +x: wingspan about
 * 70, nose to tail tip about 75.
 *
 * Pure: it imports only the palette type, so the splash (HIVE-212) draws the
 * same creature. Every colour arrives in the palette; alpha is applied with
 * `globalAlpha`, never by editing a colour string.
 */

/** The creature's size on Home and the splash: about 14px across. */
export const REAL = 0.2;

export interface MutaliskMotion {
  /** Per-creature phase, so a flock never beats in step. */
  k: number;
  /** Angular rate in radians per second; the tail lags it and the wings bank. */
  turn: number;
}

/** `[x, y, heading, radius]` along the tail. */
export type SpinePoint = [number, number, number, number];
type Point = [number, number];

const FULL = Math.PI * 2;
const mixv = (a: number, b: number, k: number): number => a + (b - a) * k;
const clamp = (value: number, limit: number): number => Math.max(-limit, Math.min(limit, value));

/** Draw at `alpha` times the current alpha, then put it back. */
export function withAlpha(ctx: CanvasRenderingContext2D, alpha: number, draw: () => void): void {
  const base = ctx.globalAlpha;
  ctx.globalAlpha = base * alpha;
  draw();
  ctx.globalAlpha = base;
}

function segment(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** A curved claw from `(x, y)` along heading `a`. */
export function talon(
  ctx: CanvasRenderingContext2D, x: number, y: number, a: number,
  len: number, bend: number, w: number, palette: SwarmPalette,
): void {
  const px = -Math.sin(a);
  const py = Math.cos(a);
  ctx.beginPath();
  ctx.moveTo(x + px * w, y + py * w);
  ctx.quadraticCurveTo(
    x + Math.cos(a) * len * 0.6 + px * (w + bend * 0.5), y + Math.sin(a) * len * 0.6 + py * (w + bend * 0.5),
    x + Math.cos(a) * len + px * bend, y + Math.sin(a) * len + py * bend,
  );
  ctx.quadraticCurveTo(
    x + Math.cos(a) * len * 0.5 + px * bend * 0.3, y + Math.sin(a) * len * 0.5 + py * bend * 0.3,
    x - px * w, y - py * w,
  );
  ctx.closePath();
  ctx.fillStyle = palette.chitin;
  withAlpha(ctx, 0.95, () => ctx.fill());
}

/** The tail's spine: each segment turns by the travelling wave and by the turn it lags. */
export function tailSpine(t: number, k: number, turn: number): SpinePoint[] {
  const points: SpinePoint[] = [];
  let x = -9;
  let y = 0;
  let heading = Math.PI;
  const bend = clamp(-turn * 0.05, 0.09);
  for (let i = 0; i < 14; i++) {
    heading += 0.11 * Math.sin(t * 2.1 - i * 0.48 + k) + bend * (0.4 + i * 0.07);
    x += Math.cos(heading) * 2.9;
    y += Math.sin(heading) * 2.9;
    points.push([x, y, heading, 2.2 * (1 - i / 17)]);
  }
  return points;
}

const HOLES: [number, number, number, number][] = [[-4, 30, 1.3, 0.9], [-8, 19, 0.9, 0.7]];
const EYES: Point[] = [[15, -1.3], [15, 1.3], [13.6, -1.9], [13.6, 1.9]];

export function drawMutalisk(
  ctx: CanvasRenderingContext2D, x: number, y: number, vx: number, vy: number,
  t: number, scale: number, { k, turn }: MutaliskMotion, palette: SwarmPalette,
): void {
  const { bg, carapace, chitin } = palette;
  const ph = Math.sin(t * 6 + k);
  const up = (ph + 1) / 2;
  const kf = 0.45 + 0.55 * Math.sqrt(1 - ph * ph); // lateral foreshortening as the wing tilts
  const bank = clamp(turn * 0.12, 0.25);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(vy || 0, vx || 1));
  ctx.scale(scale, scale);

  // Shadow.
  ctx.fillStyle = carapace;
  withAlpha(ctx, 0.16, () => {
    ctx.beginPath();
    ctx.ellipse(-2, 5, 14, 22 * kf, 0, 0, FULL);
    ctx.fill();
  });

  // The tail, first, so the body sits on it.
  const tail = tailSpine(t, k, turn);
  ctx.lineCap = 'round';
  let px = -9;
  let py = 0;
  for (const [tx, ty, , r] of tail) {
    ctx.strokeStyle = carapace;
    ctx.lineWidth = r * 2 + 1;
    segment(ctx, px, py, tx, ty);
    ctx.strokeStyle = chitin;
    ctx.lineWidth = 0.7;
    withAlpha(ctx, 0.85, () => segment(ctx, px, py, tx, ty));
    px = tx;
    py = ty;
  }
  ctx.strokeStyle = chitin;
  ctx.lineWidth = 0.6;
  withAlpha(ctx, 0.6, () => {
    tail.forEach(([tx, ty, th, r], i) => {
      if (i % 2) return;
      const nx = -Math.sin(th);
      const ny = Math.cos(th);
      segment(ctx, tx + nx * (r + 0.6), ty + ny * (r + 0.6), tx - nx * (r + 0.6), ty - ny * (r + 0.6));
    });
  });
  const [tx, ty, th] = tail[tail.length - 1]!;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx + c * 3 - sn * 3, ty + sn * 3 + c * 3);
  ctx.lineTo(tx + c * 8, ty + sn * 8);
  ctx.lineTo(tx + c * 3 + sn * 3, ty + sn * 3 - c * 3);
  ctx.closePath();
  ctx.fillStyle = carapace;
  ctx.fill();
  ctx.strokeStyle = chitin;
  ctx.lineWidth = 0.7;
  withAlpha(ctx, 0.95, () => ctx.stroke());
  for (const sg of [-1, 1]) {
    for (const f of [0.6, 1.4]) talon(ctx, tx + c * f, ty + sn * f, th + sg * 1.9, 3.2, -sg * 0.9, 0.55, palette);
  }

  // Hind legs, tucked back.
  for (const sg of [-1, 1]) {
    ctx.strokeStyle = chitin;
    ctx.lineWidth = 1.1;
    withAlpha(ctx, 0.85, () => {
      ctx.beginPath();
      ctx.moveTo(-6, sg * 3.5);
      ctx.lineTo(-10, sg * 6.5);
      ctx.lineTo(-13, sg * 6);
      ctx.stroke();
    });
    talon(ctx, -13, sg * 6, Math.PI + sg * 0.3, 2.6, -sg * 0.6, 0.5, palette);
  }

  // The wings.
  for (const sg of [-1, 1]) {
    const L = (wx: number, wy: number): Point => [wx, sg * wy * kf + bank * wy * 0.6]; // banking: the outer wing reads longer
    const fold = mixv(1, 0.84, up);
    const S = L(3, 3.6);
    const E = L(1, 15);
    const W = L(10, 23);
    const T1 = L(10 - 7 * fold, 23 + 21 * fold);
    const T2 = L(10 - 21 * fold, 23 + 13 * fold);
    const T3 = L(10 - 25 * fold, 23 + 1 * fold);
    const T4 = L(10 - 21 * fold, 23 - 9 * fold);
    const root = L(-8, 3.6);
    const arc = L(19, 40 * fold);

    ctx.beginPath();
    ctx.moveTo(S[0], S[1]);
    ctx.lineTo(E[0], E[1]);
    ctx.lineTo(W[0], W[1]);
    ctx.quadraticCurveTo(arc[0], arc[1], T1[0], T1[1]);
    let prev = T1;
    for (const b of [T2, T3, T4, root]) {
      const mx = (prev[0] + b[0]) / 2;
      const my = (prev[1] + b[1]) / 2;
      ctx.quadraticCurveTo(mixv(mx, W[0], 0.33), mixv(my, W[1], 0.33), b[0], b[1]);
      prev = b;
    }
    ctx.closePath();
    ctx.fillStyle = chitin;
    withAlpha(ctx, 0.16, () => ctx.fill());
    ctx.strokeStyle = chitin;
    ctx.lineWidth = 0.45;
    withAlpha(ctx, 0.55, () => ctx.stroke());

    // Battle wear: two holes in the membrane.
    ctx.fillStyle = bg;
    withAlpha(ctx, 0.8, () => {
      for (const [hx, hy, rx, ry] of HOLES) {
        const [X, Y] = L(hx, hy);
        ctx.beginPath();
        ctx.ellipse(X, Y, rx, ry * kf + 0.2, 0, 0, FULL);
        ctx.fill();
      }
    });

    // Bones.
    ctx.strokeStyle = chitin;
    ctx.lineCap = 'round';
    withAlpha(ctx, 0.95, () => {
      ctx.lineWidth = 1.5;
      segment(ctx, S[0], S[1], E[0], E[1]);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(E[0], E[1]);
      ctx.lineTo(W[0], W[1]);
      ctx.quadraticCurveTo(arc[0], arc[1], T1[0], T1[1]);
      ctx.stroke();
      ctx.lineWidth = 0.7;
      for (const p of [T2, T3, T4]) segment(ctx, W[0], W[1], p[0], p[1]);
    });
    for (const [jx, jy] of [E, W]) {
      ctx.beginPath();
      ctx.arc(jx, jy, 1.25, 0, FULL);
      ctx.fillStyle = carapace;
      ctx.fill();
      withAlpha(ctx, 0.95, () => ctx.stroke());
    }

    // Claws: the thumb at the wrist, forward and out; one at every finger tip.
    talon(ctx, W[0], W[1], sg * 0.55 * kf, 4.2, -sg * 1.4, 0.75, palette);
    talon(ctx, T1[0], T1[1], Math.atan2(T1[1] - arc[1], T1[0] - arc[0]), 3.6, sg * 1.2, 0.6, palette);
    for (const p of [T2, T3, T4]) talon(ctx, p[0], p[1], Math.atan2(p[1] - W[1], p[0] - W[0]), 3, sg * 0.9, 0.5, palette);
  }

  // Body: torso, shoulder plates, neck, head; spikes down the spine.
  ctx.lineWidth = 0.8;
  const plate = (path: () => void): void => {
    ctx.fillStyle = carapace;
    ctx.strokeStyle = chitin;
    ctx.beginPath();
    path();
    ctx.fill();
    withAlpha(ctx, 0.95, () => ctx.stroke());
  };
  plate(() => ctx.ellipse(-1, 0, 9.5, 3.8, 0, 0, FULL));
  for (const sg of [-1, 1]) plate(() => ctx.ellipse(3.5, sg * 3.2, 3, 1.6, sg * 0.25, 0, FULL));
  plate(() => {
    ctx.moveTo(7, -2.4);
    ctx.lineTo(11, -1.8);
    ctx.lineTo(11, 1.8);
    ctx.lineTo(7, 2.4);
    ctx.closePath();
  });
  plate(() => {
    ctx.moveTo(10, -3);
    ctx.lineTo(15.5, -2.2);
    ctx.lineTo(19, 0);
    ctx.lineTo(15.5, 2.2);
    ctx.lineTo(10, 3);
    ctx.closePath();
  });
  for (const sg of [-1, 1]) {
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = chitin;
    withAlpha(ctx, 0.95, () => {
      ctx.beginPath();
      ctx.moveTo(12, sg * 2.6);
      ctx.quadraticCurveTo(10, sg * 5.5, 7, sg * 6);
      ctx.stroke();
    });
    talon(ctx, 18, sg * 1.3, sg * 0.35, 2.4, -sg * 0.5, 0.4, palette);
  }
  ctx.fillStyle = chitin;
  withAlpha(ctx, 0.9, () => {
    for (let i = 0; i < 7; i++) {
      const sx = 12 - i * 3.2;
      ctx.beginPath();
      ctx.moveTo(sx + 1.4, 0);
      ctx.lineTo(sx - 1.2, -1.1);
      ctx.lineTo(sx - 0.4, 0);
      ctx.lineTo(sx - 1.2, 1.1);
      ctx.closePath();
      ctx.fill();
    }
  });

  // Eyes, with a chitin glow.
  ctx.save();
  ctx.fillStyle = chitin;
  ctx.shadowColor = chitin;
  ctx.shadowBlur = 5;
  withAlpha(ctx, 0.9, () => {
    for (const [ex, ey] of EYES) {
      ctx.beginPath();
      ctx.arc(ex, ey, 0.5, 0, FULL);
      ctx.fill();
    }
  });
  ctx.restore();

  ctx.restore();
}
