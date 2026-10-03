import type { Flap, HatcheryRow } from '@/types/pull-request';

/**
 * The PR hatch status (HIVE-215): one rule for every surface that names a
 * PR's flap — the Hatchery (HIVE-205), Home's counts (HIVE-200) and the
 * session panel's PR tab (HIVE-209). In `lib` rather than `features/shared`
 * because the store composes it, and a store may not import a feature.
 */

/** The Hatchery's order. Open flaps by urgency; HATCHED after every open PR. */
export const FLAP_RANK: Record<Flap, number> = {
  SUMMONS: 0,
  HATCHING: 1,
  MUTATING: 2,
  INCUBATING: 3,
  COCOONING: 4,
  BURROWED: 5,
  LARVA: 6,
  HATCHED: 7,
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * HATCHED's words: `Merged 11:32` today, `Merged yesterday 18:10`, else
 * `Merged 12 Aug` (a search reaches old merges). Local time, 24-hour; days are
 * local calendar days against `now`.
 */
export function mergedWords(mergedAt: string | null, now: number): { at?: string; words: string } {
  const ms = mergedAt === null ? NaN : Date.parse(mergedAt);
  if (Number.isNaN(ms)) return { words: 'Merged' };

  const merged = new Date(ms);
  const at = `${pad(merged.getHours())}:${pad(merged.getMinutes())}`;
  const today = dayOf(new Date(now));
  const day = dayOf(merged);
  if (day === today) return { at, words: `Merged ${at}` };
  // Midday before today is always the previous calendar day, DST nights included.
  if (day === dayOf(new Date(today - 43_200_000))) return { at, words: `Merged yesterday ${at}` };
  return { at, words: `Merged ${merged.getDate()} ${MONTHS[merged.getMonth()]}` };
}

const newestFirst = (a: string | null, b: string | null) => (b ?? '').localeCompare(a ?? '');

/** Open by rank, then most recently updated; merged after, newest merge first. A copy. */
export function sortHatchery(rows: readonly HatcheryRow[]): HatcheryRow[] {
  return [...rows].sort((a, b) => {
    const landed = Number(a.pr.state === 'merged') - Number(b.pr.state === 'merged');
    if (landed !== 0) return landed;
    if (a.pr.state === 'merged') return newestFirst(a.pr.mergedAt, b.pr.mergedAt);
    return a.hatch.rank - b.hatch.rank || newestFirst(a.pr.updatedAt, b.pr.updatedAt);
  });
}
