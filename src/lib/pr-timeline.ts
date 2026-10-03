/**
 * The PR Timeline's pure half (HIVE-208): the time scale, the lanes and
 * "where the time went", from the timeline read, the ledger and the ship
 * track. No React and no store; every function takes its clock.
 */

export const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const STEPS = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map((m) => m * MIN);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');

export interface Tick { at: number; f: number; label: string }

/** Where `t` sits between `start` and `end`, 0 to 1. */
export function fraction(t: number, start: number, end: number): number {
  if (end <= start) return 0;
  return Math.min(1, Math.max(0, (t - start) / (end - start)));
}

/** `HH:MM`, local; with the weekday once the axis spans more than a day. */
const clock = (t: number, days: boolean) => {
  const d = new Date(t);
  return `${days ? `${DAYS[d.getDay()]} ` : ''}${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Ticks on round local times, the smallest step whose labels sit `minGapPx`
 * apart (HIVE-208). Steps of an hour or more start on the first whole local
 * hour, so a long axis still opens near its start.
 */
export function ticks(start: number, end: number, widthPx: number, minGapPx = 72): Tick[] {
  const span = Math.max(end - start, MIN);
  const step = STEPS.find((s) => (s / span) * widthPx >= minGapPx) ?? DAY;
  const round = Math.min(step, HOUR);
  const offset = new Date(start).getTimezoneOffset() * MIN;
  const first = Math.ceil((start - offset) / round) * round + offset;
  const days = span > DAY;
  const out: Tick[] = [];
  for (let at = first; at <= end; at += step) out.push({ at, f: fraction(at, start, end), label: clock(at, days) });
  return out;
}
