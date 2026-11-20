import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ALL_SWARMS,
  type CellState,
  type CombInput,
  type CombLayout,
  COMB_W,
  drawComb,
  type Flyer,
  flyerCount,
  hitTest,
  isCalm,
  layoutComb,
  layoutWidth,
  MIN_W,
  newFlyer,
  seededRng,
  stepFlyers,
  stillFlyers,
  SWARM,
  syncFlyers,
  truncate,
} from '@lib/swarm/comb';
import { createSpine, drawMuta, spineNodes } from '@lib/swarm/muta';
import type { SwarmPalette } from '@lib/swarm/palette';
import { coloursUsed, recordingContext } from '@tests/support/canvas-2d';

vi.mock('@lib/swarm/muta', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lib/swarm/muta')>();
  return { ...actual, drawMuta: vi.fn(actual.drawMuta) };
});

const agent = (id: string, state: CellState): CombInput => ({ id, name: id, project: SWARM, state });
const cell = (id: string, project: string, state: CellState): CombInput => ({ id, name: id, project, state });

/** The design's busy afternoon: 3 projects, 6 agents. */
const BUSY: CombInput[] = [
  agent('shipper', 'summons'), agent('fixer', 'failed'), agent('builder', 'summons'),
  agent('slack', 'summons'), agent('pr-patrol', 'summons'), agent('acr', 'morphing'),
  cell('hive-193-history-spec', 'the-hive', 'morphing'), cell('inbox-redesign', 'the-hive', 'summons'),
  cell('explorer-tree', 'the-hive', 'burrowed'), cell('INCORP-598', 'incorpx-server', 'morphing'),
  cell('INCORP-589', 'incorpx-server', 'morphing'), cell('INCORP-586', 'incorpx-server', 'burrowed'),
  cell('term-5', 'ai-sdk', 'terminal'),
];
const PROJECTS = [
  { id: 'the-hive', name: 'the-hive' }, { id: 'incorpx-server', name: 'incorpx-server' },
  { id: 'ai-sdk', name: 'ai-sdk' }, { id: 'legacy-api', name: 'legacy-api' },
];

const R = 36;
const w = Math.sqrt(3) * R;

describe('layoutComb — normal', () => {
  const layout = layoutComb(BUSY, PROJECTS);

  it('stays normal for the busy fixture, at R 36', () => {
    expect(layout.mode).toBe('normal');
    expect(layout.R).toBe(36);
  });

  it('draws one cell per entity', () => {
    expect(layout.cells.map((c) => c.id).sort()).toEqual(BUSY.map((e) => e.id).sort());
  });

  it('puts the swarm on odd row 3, centred, one empty cell between agents', () => {
    const swarm = layout.cells.filter((c) => c.project === SWARM);
    swarm.forEach((c, i) => {
      expect(c.x).toBeCloseTo((6 + 2 * i) * w + w / 2);
      expect(c.y).toBeCloseTo(3 * 1.5 * R + 14);
    });
  });

  it('lays patches on row 7 in config order, three columns apart', () => {
    const xs = (project: string) => layout.cells.filter((c) => c.project === project).map((c) => (c.x - w / 2) / w);
    expect(xs('the-hive').map(Math.round)).toEqual([2, 4, 6]);
    expect(xs('incorpx-server').map(Math.round)).toEqual([9, 11, 13]);
    expect(xs('ai-sdk').map(Math.round)).toEqual([16]);
    expect(layout.cells.find((c) => c.id === 'term-5')!.y).toBeCloseTo(7 * 1.5 * R + 14);
  });

  it('gives a project with nothing live no patch', () => {
    expect(layout.patches.map((p) => p.project)).toEqual([SWARM, 'the-hive', 'incorpx-server', 'ai-sdk']);
  });

  it('labels the swarm and each patch above its top cell', () => {
    const swarm = layout.patches[0]!;
    expect(swarm.label).toBe('THE SWARM');
    expect(swarm.y).toBeCloseTo(3 * 1.5 * R + 14 - R - 9);
    expect(layout.patches[1]!.label).toBe('THE-HIVE');
  });

  it('fills the canvas with a background grid', () => {
    expect(layout.grid.length).toBeGreaterThan(200);
  });

  it("keeps a cell's phase across a relayout", () => {
    const again = layoutComb([...BUSY].reverse(), PROJECTS);
    const phase = (l: typeof layout) => l.cells.find((c) => c.id === 'acr')!.phase;
    expect(phase(again)).toBe(phase(layout));
    expect(phase(layout)).toBeGreaterThanOrEqual(0);
    expect(phase(layout)).toBeLessThan(6);
  });

  it('caps a normal patch at seven, the seventh a "+N" rest cell', () => {
    const many = Array.from({ length: 9 }, (_, i) => cell(`s${i}`, 'the-hive', 'burrowed'));
    const l = layoutComb(many, PROJECTS);
    const rest = l.cells.find((c) => c.kind === 'rest')!;
    expect(l.cells).toHaveLength(7);
    expect(rest).toMatchObject({ id: 'rest:the-hive', name: '+3', more: 3, project: 'the-hive' });
  });

  it('fits inside the canvas', () => {
    for (const c of layout.cells) expect(c.x + R).toBeLessThanOrEqual(COMB_W);
  });
});

/** The design's heavy day: 12 projects, 14 agents. */
const HEAVY_COUNTS: [string, number][] = [
  ['the-hive', 5], ['incorpx-server', 6], ['incorpx', 4], ['ai-sdk', 2], ['apfm-provider-scraper', 3], ['aps', 3],
  ['incorpx-customer-onboarding-portal', 2], ['legacy-api', 1], ['billing-svc', 3], ['docs-site', 1], ['infra', 2], ['mobile-app', 4],
];
const HEAVY_STATES: CellState[] = ['morphing', 'burrowed', 'summons', 'morphing', 'terminal', 'burrowed'];
const heavy = (counts: [string, number][], agents = 14): { entities: CombInput[]; projects: { id: string; name: string }[] } => ({
  entities: [
    ...Array.from({ length: agents }, (_, i) => agent(`agent-${i}`, i % 4 === 0 ? 'summons' : i % 4 === 1 ? 'failed' : 'morphing')),
    ...counts.flatMap(([p, n]) => Array.from({ length: n }, (_, k) => cell(`${p}-${k}`, p, HEAVY_STATES[k % HEAVY_STATES.length]!))),
  ],
  projects: counts.map(([id]) => ({ id, name: id })),
});

describe('layoutComb — at scale', () => {
  const { entities, projects } = heavy(HEAVY_COUNTS);
  const layout = layoutComb(entities, projects);
  const r = 21;
  const ws = Math.sqrt(3) * r;
  const at = (c: number, row: number) => ({ x: c * ws + (row & 1 ? ws / 2 : 0), y: row * 1.5 * r + 14 });

  it('switches to scale for the heavy fixture, at R 21', () => {
    expect(layout.mode).toBe('scale');
    expect(layout.R).toBe(21);
  });

  it('clusters, not side by side, when a group has more than seven agents and there is room (HIVE-454)', () => {
    const l = layoutComb([...Array.from({ length: 8 }, (_, i) => agent(`a${i}`, 'morphing'))], []);
    expect(l).toMatchObject({ mode: 'normal', agents: 'clusters' });
  });

  it('switches when the normal layout does not fit the canvas', () => {
    const wide = heavy([['p1', 7], ['p2', 7], ['p3', 7]], 0);
    expect(layoutComb(wide.entities, wide.projects).mode).toBe('scale');
  });

  it('clusters the swarm small on row 5: its 6 most urgent and a "+8" (HIVE-454 §2 step 3)', () => {
    const swarm = layout.cells.filter((c) => c.project === SWARM);
    expect(swarm).toHaveLength(7);
    expect(swarm[0]!.y).toBeCloseTo(at(0, 5).y);
    expect(swarm[6]).toMatchObject({ id: 'rest:swarm', more: 8 });
  });

  it('nests each project as a 2×2 patch, five per row at 1376, on rows 10 and 14 (HIVE-454 §2 step 3)', () => {
    const first = layout.cells.filter((c) => c.project === 'the-hive');
    expect(first.map(({ x, y }) => ({ x, y }))).toEqual([at(2, 10), at(3, 10), at(2, 11), at(3, 11)]);
    expect(layout.cells.find((c) => c.project === 'billing-svc')).toMatchObject(at(2, 14));
  });

  it('caps a patch at four, the fourth "+N" (N = count − 3), the most urgent first', () => {
    const cells = layout.cells.filter((c) => c.project === 'incorpx-server');
    expect(cells).toHaveLength(4);
    expect(cells[3]).toMatchObject({ kind: 'rest', name: '+3', more: 3 });
    expect(cells.slice(0, 3).map((c) => c.state)).toEqual(['summons', 'morphing', 'morphing']);
  });

  it('truncates patch names to 18 characters', () => {
    expect(layout.patches.find((p) => p.project === 'incorpx-customer-onboarding-portal')!.label).toBe('INCORPX-CUSTOMER-…');
  });

  it('folds projects past ten at 1376 into one "+N projects" cell, keeping the urgent ones', () => {
    const counts: [string, number][] = [...HEAVY_COUNTS, ['zz-urgent', 1]];
    const many = heavy(counts);
    many.entities = many.entities.map((e) => (e.project === 'zz-urgent' ? { ...e, state: 'summons' } : e));
    const l = layoutComb(many.entities, many.projects);
    expect(l.cells.find((c) => c.id === 'rest:*')).toMatchObject({ project: '*', name: '+4', more: 4, ...at(26, 14) });
    expect(l.cells.some((c) => c.project === 'zz-urgent')).toBe(true);
  });

  it('turns a seventh agent of a big group into a "+N" swarm cell', () => {
    const l = layoutComb(heavy([['p', 1]], 16).entities, [{ id: 'p', name: 'p' }]);
    expect(l.cells.find((c) => c.id === 'rest:swarm')).toMatchObject({ name: '+10', more: 10 });
  });
});

const fixed = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]!; };
const flyer = (over: Partial<Flyer> = {}): Flyer => ({
  x: 100, y: 100, a: 0, k: 0, leg: 1, target: null, turn: 0, spine: createSpine(100, 100, 0), ...over,
});

describe('layoutComb — width and agent groups (HIVE-454)', () => {
  it('clamps the stage to 640–1376, an unknown stage to 1376', () => {
    expect(MIN_W).toBe(640);
    expect(layoutWidth(0)).toBe(1376);
    expect(layoutWidth(500)).toBe(640);
    expect(layoutWidth(2000)).toBe(1376);
    expect(layoutWidth(1000)).toBe(1000);
  });

  it('defaults to COMB_W and lays out inside a given width', () => {
    expect(layoutComb(BUSY, PROJECTS).width).toBe(COMB_W);
    const l = layoutComb(BUSY, PROJECTS, { width: 900 });
    expect(l.width).toBe(900);
    for (const g of l.grid) expect(g.x).toBeLessThan(900 + Math.sqrt(3) * l.R);
    for (const c of l.cells) expect(c.x).toBeLessThanOrEqual(900 - l.R);
  });

  it('marks agent cells, rest cells included, and only those', () => {
    const l = layoutComb(BUSY, PROJECTS);
    for (const c of l.cells) expect(c.agent).toBe(c.project === SWARM);
    const big = layoutComb(heavy([['p', 1]], 16).entities, [{ id: 'p', name: 'p' }]);
    expect(big.cells.find((c) => c.id === 'rest:swarm')!.agent).toBe(true);
  });

  it('draws agents of a named group as one patch labelled with its name', () => {
    const entities = [cell('a1', 'g1', 'morphing'), cell('a2', 'g1', 'burrowed'), cell('s1', 'the-hive', 'morphing')];
    const l = layoutComb(entities, PROJECTS, { groups: [{ id: 'g1', name: 'Dev Squad' }] });
    expect(l.patches.map((p) => p.label)).toEqual(['DEV SQUAD', 'THE-HIVE']);
    expect(l.cells.filter((c) => c.agent).map((c) => c.id)).toEqual(['a1', 'a2']);
  });

  it('sends flyers from a non-SWARM group to a project and back', () => {
    const entities = [cell('a1', 'g1', 'morphing'), cell('s1', 'the-hive', 'morphing')];
    const l = layoutComb(entities, PROJECTS, { groups: [{ id: 'g1', name: 'Dev Squad' }] });
    const a1 = l.cells.find((c) => c.id === 'a1')!;
    const [next] = stepFlyers([flyer({ x: a1.x, y: a1.y - 18, leg: 1, target: 'a1' })], l, 1 / 60, fixed(0), false);
    expect(next).toMatchObject({ leg: 0, target: 's1' });
    const s1 = l.cells.find((c) => c.id === 's1')!;
    const [back] = stepFlyers([flyer({ x: s1.x, y: s1.y - 18, leg: 0, target: 's1' })], l, 1 / 60, fixed(0), false);
    expect(back).toMatchObject({ leg: 1, target: 'a1' });
  });

  it('spawns and wanders flyers inside the given width', () => {
    expect(newFlyer(0, fixed(0.99), 700).x).toBeCloseTo(693);
    expect(syncFlyers([], 1, fixed(0.5), 700)[0]!.x).toBeCloseTo(350);
    const resting = layoutComb([cell('a', 'the-hive', 'burrowed')], PROJECTS, { width: 700 });
    const [next] = stepFlyers([flyer()], resting, 1 / 60, fixed(0.5), true);
    expect(next!.target).toEqual({ x: 350, y: 260 });
  });

  it('clears the given width', () => {
    const { ctx, calls } = recordingContext();
    drawComb(ctx, layoutComb(BUSY, PROJECTS, { width: 800 }), [], 0, PALETTE);
    expect(calls.find((c) => c.op === 'fillRect')?.args).toEqual([0, 0, 800, 520]);
  });
});

// HIVE-454: the design's three loads.
const swarmOf = (id: string, specs: (string | [string, CellState])[]): CombInput[] =>
  specs.map((spec) => (typeof spec === 'string' ? cell(spec, id, 'burrowed') : cell(spec[0], id, spec[1])));
const sessionsOf = (project: string, states: CellState[]): CombInput[] =>
  states.map((state, i) => cell(`${project}-${i}`, project, state));

const DEV = swarmOf('dev', ['acr', ['builder', 'morphing'], 'clerk', ['fixer', 'summons'], 'shipper']);
const OPS2 = swarmOf('ops', [['pager', 'morphing'], 'triage']);
const OPS3 = swarmOf('ops', [['pager', 'morphing'], 'triage', 'backup']);
const ACME6 = swarmOf('acme', [['deployer', 'morphing'], 'auditor', ['oncall', 'summons'], 'migrator', 'costs', 'janitor']);
const ACME8 = [...ACME6, ...swarmOf('acme', [['reviewer', 'morphing'], 'sbom'])];
const DOCS = swarmOf('docs', [['writer', 'morphing'], ['linkcheck', 'failed']]);
const SEC = swarmOf('sec', [['scanner', 'morphing'], 'secrets', ['deps', 'summons']]);
const DATA = swarmOf('data', [['etl', 'morphing'], 'dbt', 'quality', 'reports']);
const MINE1 = swarmOf('swarm:mine', ['standup']);
const MINE2 = swarmOf('swarm:mine', ['standup', 'inbox']);
const TWO = [...sessionsOf('hivetty', ['morphing', 'summons', 'terminal']), ...sessionsOf('hivetty-cloud', ['morphing', 'burrowed'])];
const TEN_COUNTS: [string, CellState[]][] = [
  ['hivetty', ['morphing', 'summons', 'terminal', 'burrowed', 'morphing']], ['hivetty-cloud', ['morphing', 'burrowed']],
  ['hivetty-swarms', ['summons']], ['site', ['morphing', 'terminal']], ['billing', ['burrowed', 'morphing', 'terminal']],
  ['acme-api', ['failed', 'burrowed']], ['acme-web', ['terminal']], ['infra', ['morphing', 'burrowed']],
  ['design', ['burrowed']], ['mobile', ['terminal']],
];
const TEN = TEN_COUNTS.flatMap(([project, states]) => sessionsOf(project, states));
const projectsOf = (ids: string[]) => ids.map((id) => ({ id, name: id }));
const TITLES: Record<string, string> = {
  dev: 'Dev Squad', acme: 'Acme Platform', ops: 'Ops Watch', docs: 'Docs Crew', sec: 'Security', data: 'Data Team',
  'swarm:mine': 'My swarm',
};
const groupsFor = (ids: string[]) => ids.map((id) => ({ id, name: TITLES[id]! }));
const LOADS = {
  few: { entities: [...DEV, ...OPS2, ...MINE1, ...TWO], projects: projectsOf(['hivetty', 'hivetty-cloud']), groups: groupsFor(['dev', 'ops', 'swarm:mine']) },
  more: {
    entities: [...DEV, ...ACME6, ...OPS3, ...DOCS, ...MINE2, ...TWO], projects: projectsOf(['hivetty', 'hivetty-cloud']),
    groups: groupsFor(['dev', 'acme', 'ops', 'docs', 'swarm:mine']),
  },
  many: {
    entities: [...DEV, ...ACME8, ...OPS3, ...DOCS, ...SEC, ...DATA, ...MINE2, ...TEN], projects: projectsOf(TEN_COUNTS.map(([id]) => id)),
    groups: groupsFor(['dev', 'acme', 'ops', 'docs', 'sec', 'data', 'swarm:mine']),
  },
};
type Load = keyof typeof LOADS;
const layoutOf = (load: Load, width: number) => {
  const { entities, projects, groups } = LOADS[load];
  return layoutComb(entities, projects, { width, groups });
};
const PICKS: [Load, number, CombLayout['agents']][] = [
  ['few', 1376, 'side'], ['few', 1024, 'clusters'], ['few', 760, 'clusters'],
  ['more', 1376, 'clusters'], ['more', 1024, 'small'], ['more', 760, 'small'],
  ['many', 1376, 'small'], ['many', 1024, 'small'], ['many', 760, 'small'],
];

describe('layoutComb — the pick (HIVE-454)', () => {
  it.each(PICKS)('%s at %i lays agents out %s', (load, width, agents) => {
    const l = layoutOf(load, width);
    expect(l.agents).toBe(agents);
    expect(l.mode).toBe(agents === 'small' ? 'scale' : 'normal');
    expect(l.R).toBe(agents === 'small' ? 21 : 36);
  });

  it.each(PICKS)('%s at %i keeps every cell inside the width', (load, width) => {
    const l = layoutOf(load, width);
    for (const c of l.cells) {
      expect(c.x, c.id).toBeGreaterThan(l.R);
      expect(c.x, c.id).toBeLessThan(width - l.R);
    }
  });

  it('draws one patch per group, labelled with its full name, in group order', () => {
    expect(layoutOf('few', 1376).patches.map((p) => p.label)).toEqual(['DEV SQUAD', 'OPS WATCH', 'MY SWARM', 'HIVETTY', 'HIVETTY-CLOUD']);
    expect(layoutOf('more', 1376).patches.slice(0, 5).map((p) => p.project)).toEqual(['dev', 'acme', 'ops', 'docs', 'swarm:mine']);
  });

  it('lays side by side two columns apart within a group, the run centred on row 3', () => {
    const l = layoutOf('few', 1376);
    const cols = (project: string) => l.cells.filter((c) => c.project === project).map((c) => Math.round((c.x - w / 2) / w));
    expect(cols('dev')).toEqual([3, 5, 7, 9, 11]);
    expect(cols('ops')).toEqual([14, 16]);
    expect(cols('swarm:mine')).toEqual([19]);
    for (const c of l.cells.filter((cell) => cell.agent)) expect(c.y).toBeCloseTo(3 * 1.5 * R + 14);
  });

  it('builds a cluster as a centre and its ring, the label above its top cell', () => {
    const l = layoutOf('few', 1024);
    const dev = l.cells.filter((c) => c.project === 'dev');
    const [centre] = dev;
    const offsets = dev.map((c) => [(c.x - centre!.x) / w, (c.y - centre!.y) / (1.5 * R)]);
    const expected = [[0, 0], [1, 0], [0.5, -1], [-0.5, -1], [-1, 0]];
    offsets.forEach(([dc, dr], i) => {
      expect(dc).toBeCloseTo(expected[i]![0]!);
      expect(dr).toBeCloseTo(expected[i]![1]!);
    });
    expect(centre!.y).toBeCloseTo(3 * 1.5 * R + 14);
    expect(l.patches.find((p) => p.project === 'dev')!.y).toBeCloseTo(centre!.y - 1.5 * R - R - 12);
  });

  it('shows a cluster of 9 as its 6 most urgent and a "+3" rest cell', () => {
    const nine = swarmOf('big', ['a', 'b', ['c', 'summons'], 'd', ['e', 'morphing'], 'f', ['g', 'failed'], 'h', ['i', 'morphing']]);
    const l = layoutComb(nine, [], { groups: [{ id: 'big', name: 'Big' }] });
    expect(l.agents).toBe('clusters');
    const cells = l.cells.filter((c) => c.project === 'big');
    expect(cells).toHaveLength(7);
    expect(cells[6]).toMatchObject({ id: 'rest:big', kind: 'rest', name: '+3', more: 3, agent: true });
    expect(cells.slice(0, 4).map((c) => c.id)).toEqual(['c', 'g', 'e', 'i']);
  });

  it('folds the least urgent groups at many@760 into one "+2" SWARMS cell, the rest in input order', () => {
    const l = layoutOf('many', 760);
    expect(l.cells.find((c) => c.id === 'rest:**')).toMatchObject({ project: ALL_SWARMS, kind: 'rest', more: 2, name: '+2', agent: true });
    const agentPatches = l.patches.filter((p) => l.cells.some((c) => c.agent && c.project === p.project)).map((p) => p.project);
    expect(agentPatches).toEqual(['dev', 'acme', 'ops', 'docs', 'sec', ALL_SWARMS]);
    expect(l.patches.find((p) => p.project === ALL_SWARMS)!.label).toBe('SWARMS');
  });

  it('puts small clusters on row 5 and cuts their labels to 18', () => {
    const long = swarmOf('long', ['x']);
    const l = layoutComb([...long, ...LOADS.many.entities], LOADS.many.projects, {
      width: 1376, groups: [{ id: 'long', name: 'A very long swarm title' }, ...LOADS.many.groups],
    });
    expect(l.agents).toBe('small');
    expect(l.cells.find((c) => c.id === 'x')!.y).toBeCloseTo(5 * 1.5 * 21 + 14);
    expect(l.patches[0]!.label).toBe('A VERY LONG SWARM…');
  });

  it('lays small projects as 2×2 patches, perRow from the width, on rows 10 and 14', () => {
    const l = layoutOf('many', 1376);
    const ws = Math.sqrt(3) * 21;
    const at = (c: number, row: number) => ({ x: c * ws + (row & 1 ? ws / 2 : 0), y: row * 1.5 * 21 + 14 });
    // perRow = floor((1376 / ws − 2) / 6) = 5
    expect(l.cells.find((c) => c.project === 'hivetty')).toMatchObject(at(2, 10));
    expect(l.cells.find((c) => c.project === 'hivetty-cloud')).toMatchObject(at(8, 10));
    expect(l.cells.find((c) => c.project === TEN_COUNTS[5]![0])).toMatchObject(at(2, 14));
    expect(l.cells.some((c) => c.id === 'rest:*')).toBe(false);
    const narrow = layoutOf('many', 760); // perRow 3: 6 patches, the sixth "+5"
    expect(narrow.cells.find((c) => c.id === 'rest:*')).toMatchObject({ more: 5, ...at(14, 14) });
  });

  it('with no agents lays projects side by side, else small', () => {
    expect(layoutComb(TWO, LOADS.few.projects, { groups: [] }).agents).toBe('side');
    expect(layoutComb(TEN, LOADS.many.projects, { groups: [] }).agents).toBe('small');
  });

  it('hit-tests each layout at its first agent cell', () => {
    for (const [load, width] of PICKS) {
      const l = layoutOf(load, width);
      const first = l.cells.find((c) => c.agent)!;
      expect(hitTest(l, first.x + 2, first.y - 2)?.id).toBe(first.id);
    }
  });

  it('hit-tests the nearest of two touching small cells, within 0.87·R', () => {
    const l = layoutOf('many', 1376);
    const [a, b] = l.cells.filter((c) => c.project === 'dev');
    const ws = Math.sqrt(3) * 21;
    expect(b!.x - a!.x).toBeCloseTo(ws);
    expect(hitTest(l, a!.x + ws * 0.45, a!.y)?.id).toBe(a!.id);
    expect(hitTest(l, a!.x + ws * 0.55, a!.y)?.id).toBe(b!.id);
    expect(hitTest(l, a!.x, a!.y + 19)).toBeNull();
  });

  it('sends flyers to agent cells in more than one group', () => {
    const l = layoutOf('few', 1376);
    const rng = seededRng(3);
    const flock = Array.from({ length: 30 }, () => flyer({ leg: 0, target: null }));
    const projects = new Set(
      stepFlyers(flock, l, 1 / 60, rng, false).map((f) => l.cells.find((c) => c.id === f.target)!.project),
    );
    expect(projects.size).toBeGreaterThan(1);
    for (const project of projects) expect(['dev', 'ops', 'swarm:mine']).toContain(project);
  });

  it('labels one group before load THE SWARM', () => {
    expect(layoutComb([agent('a', 'morphing')], []).patches[0]!.label).toBe('THE SWARM');
  });
});

describe('flyers', () => {
  const busy = layoutComb(BUSY, PROJECTS);
  const swarmTarget = busy.cells.find((c) => c.id === 'acr')!; // morphing, in the swarm
  const projectTargets = busy.cells.filter((c) => c.project !== SWARM && (c.state === 'morphing' || c.state === 'summons'));

  it('counts 9 normally, 14 at scale, 5 when nothing needs you', () => {
    expect(flyerCount(busy, 5)).toBe(9);
    expect(flyerCount(busy, 0)).toBe(5);
    expect(flyerCount({ ...busy, mode: 'scale' }, 5)).toBe(14);
  });

  it('alternates legs: arriving at a swarm cell sends it to a project', () => {
    const f = flyer({ x: swarmTarget.x, y: swarmTarget.y - 18, leg: 1, target: swarmTarget.id });
    const [next] = stepFlyers([f], busy, 1 / 60, fixed(0), false);
    expect(next!.leg).toBe(0);
    expect(projectTargets.map((c) => c.id)).toContain(next!.target);
  });

  it('retargets when its target cell is gone', () => {
    const [next] = stepFlyers([flyer({ target: 'gone', leg: 0 })], busy, 1 / 60, fixed(0), false);
    expect(next).toMatchObject({ leg: 1, target: 'shipper' }); // the first summoning agent
  });

  it('wanders to random points when no cell is working or summoning (D9)', () => {
    const resting = layoutComb([cell('a', 'the-hive', 'burrowed')], PROJECTS);
    expect(isCalm(resting, 3)).toBe(true);
    expect(flyerCount(resting, 3)).toBe(5);
    const [next] = stepFlyers([flyer()], resting, 1 / 60, fixed(0.5), true);
    expect(next!.target).toEqual({ x: COMB_W * 0.5, y: 60 + 0.5 * (520 - 120) });
  });

  it('flies at 108 px/s, 66 when calm, and clamps a long frame', () => {
    // One target cell straight ahead (18 px above it is the flyer's own height).
    const straight = { ...busy, cells: [{ ...swarmTarget, x: 10_000, y: 118 }] };
    const go = (dt: number, calm: boolean) =>
      stepFlyers([flyer({ target: swarmTarget.id, leg: 1 })], straight, dt, fixed(0), calm)[0]!;
    expect(go(1 / 60, false).x - 100).toBeCloseTo(1.8);
    expect(go(1 / 60, true).x - 100).toBeCloseTo(1.1);
    expect(go(1, false).x - 100).toBeCloseTo(108 / 15);
  });

  it('is frame-rate independent: one 1/30 step steers like two 1/60 steps would at a fixed bearing', () => {
    const target = { ...swarmTarget, x: 100, y: 10_000 + 18 }; // straight down: bearing π/2
    const l = { ...busy, cells: [target] };
    const [once] = stepFlyers([flyer({ target: target.id, leg: 1 })], l, 1 / 30, fixed(0), false);
    expect(once!.a).toBeCloseTo((Math.PI / 2) * (1 - 0.965 ** 2), 5);
    expect(once!.turn).toBeCloseTo(once!.a / (1 / 30), 5);
  });

  it('syncs the flock to a new count, keeping the flyers it has', () => {
    const rng = seededRng(1);
    const three = syncFlyers([], 3, rng);
    expect(syncFlyers(three, 5, rng).slice(0, 3)).toEqual(three);
    expect(syncFlyers(three, 2, rng)).toEqual(three.slice(0, 2));
    expect(newFlyer(2, fixed(0)).k).toBeCloseTo(3.4);
  });

  it('carries each spine along: after 0.5s its head is the flyer', () => {
    let flock = syncFlyers([], 3, seededRng(2));
    for (let i = 0; i < 30; i++) flock = stepFlyers(flock, busy, 1 / 60, seededRng(i), false);
    for (const f of flock) {
      const [hx, hy] = spineNodes(f.spine)[0]!;
      expect(hx).toBeCloseTo(f.x, 6);
      expect(hy).toBeCloseTo(f.y, 6);
    }
  });

  it('warms each still spine straight in behind its flyer', () => {
    for (const f of stillFlyers(busy, 5)) {
      const nodes = spineNodes(f.spine);
      expect(nodes[0]![0]).toBeCloseTo(f.x, 6);
      expect(nodes[0]![1]).toBeCloseTo(f.y, 6);
      const back = Math.atan2(nodes[0]![1] - nodes[10]![1], nodes[0]![0] - nodes[10]![0]);
      expect(Math.abs(Math.atan2(Math.sin(back - f.a), Math.cos(back - f.a)))).toBeLessThan(0.05);
    }
  });

  it('places a still frame deterministically', () => {
    expect(stillFlyers(busy, 5)).toEqual(stillFlyers(busy, 5));
    expect(stillFlyers(busy, 5)).toHaveLength(9);
  });

  it('hit-tests within 24 logical px of a cell centre', () => {
    expect(hitTest(busy, swarmTarget.x + 20, swarmTarget.y)?.id).toBe('acr');
    expect(hitTest(busy, swarmTarget.x + 30, swarmTarget.y)).toBeNull();
  });
});

const PALETTE: SwarmPalette = {
  bg: 'c-bg', panel2: 'c-panel2', ink: 'c-ink', muted: 'c-muted', subtle: 'c-subtle',
  brand: 'c-brand', green: 'c-green', amber: 'c-amber', red: 'c-red', creep: 'c-creep',
  creepClear: 'c-creep-clear', chitin: 'c-chitin', carapace: 'c-carapace',
  tissueDeep: 'c-tissue-deep', tissue: 'c-tissue', tissueLit: 'c-tissue-lit',
  glowCore: 'c-glow-core', ground: 'c-ground', membrane: 'c-membrane', maw: 'c-maw',
  gum: 'c-gum', stain: 'c-stain', glint: 'c-glint',
};

describe('drawComb', () => {
  const draw = (layout: CombLayout, flyers: Flyer[] = []) => {
    const { ctx, calls } = recordingContext();
    drawComb(ctx, layout, flyers, 2.5, PALETTE);
    return { ctx, calls, texts: calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]) };
  };

  it('clears to bg first and leaves alpha at 1', () => {
    const { calls, ctx } = draw(layoutComb(BUSY, PROJECTS));
    expect(calls.find((c) => c.op === 'fillRect')?.args).toEqual([0, 0, COMB_W, 520]);
    expect(calls.find((c) => c.op === 'set:fillStyle')?.args).toEqual(['c-bg']);
    expect(ctx.globalAlpha).toBe(1);
  });

  it('paints only with palette colours, or the tone formatted from them', () => {
    const allowed = new Set(Object.values(PALETTE));
    const { calls } = draw(layoutComb(BUSY, PROJECTS), stillFlyers(layoutComb(BUSY, PROJECTS), 5));
    for (const colour of coloursUsed(calls)) {
      expect(allowed.has(colour as string) || /^rgba\(/.test(colour as string), String(colour)).toBe(true);
    }
  });

  it('names every cell under it, truncated to 14, in the normal layout', () => {
    const { texts } = draw(layoutComb(BUSY, PROJECTS));
    expect(texts).toContain('hive-193-hist…');
    expect(texts).toContain('THE SWARM');
  });

  it('names no agent at scale, and tags none: the tooltip has them (HIVE-454 §2 step 3)', () => {
    const { entities, projects } = heavy(HEAVY_COUNTS);
    const l = layoutComb(entities, projects);
    const { texts } = draw(l);
    for (const c of l.cells.filter((cell) => cell.agent && cell.kind === 'entity')) expect(texts).not.toContain(truncate(c.name, 12));
  });

  it('names a clustered agent inside its cell, cut to 8, at 11 px (HIVE-454)', () => {
    const l = layoutComb([...Array.from({ length: 7 }, (_, i) => agent(`a${i}`, 'burrowed')), agent('release-notes-writer', 'morphing')], []);
    expect(l.agents).toBe('clusters');
    const { calls } = draw(l);
    const c = l.cells.find((cell) => cell.id === 'release-notes-writer')!;
    const at = calls.findIndex((call) => call.op === 'fillText' && call.args[0] === 'release…');
    expect(calls[at]!.args.slice(1)).toEqual([c.x, c.y + 4]);
    expect(calls.slice(0, at).findLast((call) => call.op === 'set:font')?.args[0]).toMatch(/^500 11px /);
  });

  it('tags only Summons and Failed sessions at scale, small', () => {
    const l = layoutComb(heavy(HEAVY_COUNTS).entities, heavy(HEAVY_COUNTS).projects);
    const { calls, texts } = draw(l);
    const urgent = l.cells.filter((c) => c.project !== SWARM && (c.state === 'summons' || c.state === 'failed'));
    expect(urgent.length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.op === 'roundRect')).toHaveLength(urgent.length);
    for (const c of urgent) expect(texts).toContain(truncate(c.name, 12));
    expect(texts).not.toContain('the-hive-0'); // morphing session
    const at = calls.findIndex((c) => c.op === 'fillText' && c.args[0] === truncate(urgent[0]!.name, 12));
    expect(calls.slice(0, at).findLast((c) => c.op === 'set:font')?.args[0]).toMatch(/^600 8px /);
  });

  it('rings the focused cell in brand, and nothing without one (HIVE-223)', () => {
    const layout = layoutComb([agent('s1', 'morphing')], []);
    const ringed = (focusedId: string | null) => {
      const { ctx, calls } = recordingContext();
      drawComb(ctx, layout, [], 0, PALETTE, 1, focusedId);
      // The recorder keeps no per-call state, so replay the style setters up to each stroke.
      let lineWidth: unknown = 1;
      let strokeStyle: unknown;
      let count = 0;
      for (const c of calls) {
        if (c.op === 'set:lineWidth') lineWidth = c.args[0];
        if (c.op === 'set:strokeStyle') strokeStyle = c.args[0];
        if (c.op === 'stroke' && lineWidth === 2 && strokeStyle === PALETTE.brand) count += 1;
      }
      return count;
    };
    expect(ringed(null)).toBe(0);
    expect(ringed('s1')).toBe(1);
  });

  describe('the flyers', () => {
    beforeEach(() => {
      vi.mocked(drawMuta).mockClear();
    });

    it('draws one Brood mutalisk per flyer, on its own spine and clock', () => {
      const l = layoutComb(BUSY, PROJECTS);
      const flyers = stillFlyers(l, 5);
      draw(l, flyers);
      const placed = vi.mocked(drawMuta).mock.calls;
      expect(placed).toHaveLength(9);
      placed.forEach(([, spine, t, k, turn, scale], i) => {
        expect(spine).toBe(flyers[i]!.spine);
        expect(t).toBe(2.5);
        expect(k).toBeCloseTo(flyers[i]!.k * 3.7);
        expect(turn).toBe(flyers[i]!.turn);
        expect(scale).toBeCloseTo(0.108);
      });
    });

    it('keeps the small-screen ratio at scale, and passes the device scale through', () => {
      const l = layoutComb(heavy(HEAVY_COUNTS).entities, heavy(HEAVY_COUNTS).projects);
      const { ctx } = recordingContext();
      drawComb(ctx, l, stillFlyers(l, 5), 1, PALETTE, 2);
      const [, , , , , scale, ps] = vi.mocked(drawMuta).mock.calls[0]!;
      expect(scale).toBeCloseTo(0.108 * 0.7);
      expect(ps).toBe(2);
    });
  });
});
