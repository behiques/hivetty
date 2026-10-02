/**
 * The Comb (HIVE-199; design §2): one hex cell per live session, terminal and
 * agent. Agents sit together as the swarm; every project is its own patch.
 *
 * Laid out and drawn in a logical {@link COMB_W} × {@link COMB_H} space — the
 * prototype's canvas — which the host scales to the stage. The layout is pure
 * and has no randomness: a cell's phase is a hash of its id, so a data change
 * never re-phases the cells that did not change. Ported from `heroComb()` in
 * the prototype's `round3.js`.
 */
export const COMB_W = 1376;
export const COMB_H = 520;
export const SWARM = 'swarm';
/** The project of the "+N projects" rest cell: every project. */
export const ALL_PROJECTS = '*';

export type CellState = 'morphing' | 'summons' | 'failed' | 'burrowed' | 'terminal';

/** Capped patches keep the most urgent (decision D8). */
export const URGENCY: readonly CellState[] = ['summons', 'failed', 'morphing', 'burrowed', 'terminal'];

export interface CombInput {
  id: string;
  name: string;
  /** A project id, or {@link SWARM} for an agent. */
  project: string;
  state: CellState;
  /** Plan progress, 0–1; absent draws half full. */
  progress?: number;
}

export interface CombProject {
  id: string;
  name: string;
}

export interface CombCell {
  id: string;
  kind: 'entity' | 'rest';
  name: string;
  project: string;
  state: CellState | 'rest';
  progress?: number;
  /** A rest cell's N. */
  more?: number;
  x: number;
  y: number;
  phase: number;
}

export interface CombPatch {
  project: string;
  label: string;
  x: number;
  y: number;
}

export interface CombLayout {
  mode: 'normal' | 'scale';
  R: number;
  cells: CombCell[];
  patches: CombPatch[];
  grid: { x: number; y: number }[];
}

type Slot = [col: number, row: number];

export const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const rank = (state: CellState): number => URGENCY.indexOf(state);

/** 0–6, stable per id: cells never pulse in step, and never jump on a relayout. */
function phaseOf(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (hash % 600) / 100;
}

/** Pointy-top hexes: column pitch √3·R, row pitch 1.5·R, odd rows offset half a column. */
function placer(R: number): (slot: Slot) => { x: number; y: number } {
  const w = Math.sqrt(3) * R;
  return ([c, r]) => ({ x: c * w + (r & 1 ? w / 2 : 0), y: r * 1.5 * R + 14 });
}

function gridFor(R: number): { x: number; y: number }[] {
  const at = placer(R);
  const w = Math.sqrt(3) * R;
  const cells: { x: number; y: number }[] = [];
  for (let r = -1; r < COMB_H / (1.5 * R) + 1; r++) {
    for (let c = -1; c < COMB_W / w + 1; c++) cells.push(at([c, r]));
  }
  return cells;
}

/** The project ids with something live, in config order, unknown ids last in first-seen order. */
function liveProjects(entities: CombInput[], projects: CombProject[]): CombProject[] {
  const live = new Set(entities.filter((e) => e.project !== SWARM).map((e) => e.project));
  const known = projects.filter((p) => live.has(p.id));
  const unknown = [...live].filter((id) => !projects.some((p) => p.id === id)).map((id) => ({ id, name: id }));
  return [...known, ...unknown];
}

interface Patch {
  project: string;
  label: string;
  list: CombInput[];
  slots: Slot[];
  cap: number;
}

function place(R: number, patches: Patch[]): Pick<CombLayout, 'cells' | 'patches'> {
  const at = placer(R);
  const cells: CombCell[] = [];
  const labels: CombPatch[] = [];
  for (const { project, label, list, slots, cap } of patches) {
    const over = list.length > cap;
    const shown = over
      ? [...list].sort((a, b) => rank(a.state) - rank(b.state)).slice(0, cap - 1)
      : list;
    const mine: CombCell[] = shown.map((e, i) => ({
      id: e.id, kind: 'entity', name: e.name, project, state: e.state, progress: e.progress,
      ...at(slots[i]!), phase: phaseOf(e.id),
    }));
    if (over) {
      const more = list.length - cap + 1;
      mine.push({
        id: `rest:${project}`, kind: 'rest', name: `+${more}`, project, state: 'rest', more,
        ...at(slots[cap - 1]!), phase: 0,
      });
    }
    cells.push(...mine);
    labels.push({
      project, label,
      x: mine.reduce((sum, c) => sum + c.x, 0) / mine.length,
      y: Math.min(...mine.map((c) => c.y)) - R - 9,
    });
  }
  return { cells, patches: labels };
}

const NORMAL_CAP = 7;

/** The normal layout, or null when it does not fit (then the scale layout takes over). */
function normal(entities: CombInput[], projects: CombProject[]): CombLayout | null {
  const R = 36;
  const agents = entities.filter((e) => e.project === SWARM);
  if (agents.length > NORMAL_CAP) return null;

  const patches: Patch[] = [];
  if (agents.length > 0) {
    const c0 = Math.round(COMB_W / (Math.sqrt(3) * R) / 2 - (agents.length - 1));
    patches.push({ project: SWARM, label: 'THE SWARM', list: agents, slots: agents.map((_, i) => [c0 + 2 * i, 3]), cap: NORMAL_CAP });
  }
  let col = 2;
  for (const p of liveProjects(entities, projects)) {
    const list = entities.filter((e) => e.project === p.id);
    const n = Math.min(list.length, NORMAL_CAP);
    patches.push({ project: p.id, label: p.name.toUpperCase(), list, slots: Array.from({ length: n }, (_, i) => [col + 2 * i, 7]), cap: NORMAL_CAP });
    col += 2 * (n - 1) + 3;
  }

  const placed = place(R, patches);
  if (placed.cells.some((c) => c.x + R > COMB_W)) return null;
  return { mode: 'normal', R, ...placed, grid: gridFor(R) };
}

export function layoutComb(entities: CombInput[], projects: CombProject[]): CombLayout {
  return normal(entities, projects) ?? scale(entities, projects);
}

const SCALE_SWARM_CAP = 14;
const SCALE_PATCH_CAP = 4;
const SCALE_PATCHES = 12;

/** A project's most urgent cell, for ordering when they no longer all fit. */
const urgencyOf = (entities: CombInput[], project: string): number =>
  Math.min(...entities.filter((e) => e.project === project).map((e) => rank(e.state)));

/**
 * The heavy day: cells nest like real comb. The swarm is two staggered rows of
 * seven; each project a 2×2 patch of at most four with a "+N" rest cell, the
 * rule the rail combs already follow; names only as tags (drawn later).
 */
function scale(entities: CombInput[], projects: CombProject[]): CombLayout {
  const R = 21;
  const agents = entities.filter((e) => e.project === SWARM);
  const patches: Patch[] = [];
  if (agents.length > 0) {
    const slots: Slot[] = [
      ...Array.from({ length: 7 }, (_, i): Slot => [12 + 2 * i, 4]),
      ...Array.from({ length: 7 }, (_, i): Slot => [13 + 2 * i, 6]),
    ];
    patches.push({ project: SWARM, label: 'THE SWARM', list: agents, slots, cap: SCALE_SWARM_CAP });
  }

  let live = liveProjects(entities, projects);
  const folded = live.length > SCALE_PATCHES;
  if (folded) {
    // Decision D10: the most urgent projects keep their patches.
    live = live
      .map((p, i) => ({ p, i, u: urgencyOf(entities, p.id) }))
      .sort((a, b) => a.u - b.u || a.i - b.i)
      .map(({ p }) => p);
  }
  const shown = folded ? live.slice(0, SCALE_PATCHES - 1) : live;
  const origin = (i: number): Slot => [2 + (i % 6) * 6, i < 6 ? 9 : 13];
  shown.forEach((p, i) => {
    const [c0, r0] = origin(i);
    patches.push({
      project: p.id, label: truncate(p.name, 18).toUpperCase(),
      list: entities.filter((e) => e.project === p.id),
      slots: [[c0, r0], [c0 + 1, r0], [c0, r0 + 1], [c0 + 1, r0 + 1]], cap: SCALE_PATCH_CAP,
    });
  });

  const placed = place(R, patches);
  if (folded) {
    const more = live.length - shown.length;
    const { x, y } = placer(R)(origin(SCALE_PATCHES - 1));
    placed.cells.push({ id: `rest:${ALL_PROJECTS}`, kind: 'rest', name: `+${more}`, project: ALL_PROJECTS, state: 'rest', more, x, y, phase: 0 });
  }
  return { mode: 'scale', R, ...placed, grid: gridFor(R) };
}
