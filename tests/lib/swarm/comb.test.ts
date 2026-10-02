import { describe, expect, it } from 'vitest';

import { type CellState, type CombInput, COMB_W, layoutComb, SWARM } from '@lib/swarm/comb';

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

  it('switches when there are more than seven agents, even with room', () => {
    expect(layoutComb([...Array.from({ length: 8 }, (_, i) => agent(`a${i}`, 'morphing'))], []).mode).toBe('scale');
  });

  it('switches when the normal layout does not fit the canvas', () => {
    const wide = heavy([['p1', 7], ['p2', 7], ['p3', 7]], 0);
    expect(layoutComb(wide.entities, wide.projects).mode).toBe('scale');
  });

  it('stacks the swarm as two staggered rows of seven', () => {
    const swarm = layout.cells.filter((c) => c.project === SWARM);
    expect(swarm).toHaveLength(14);
    expect(swarm[0]).toMatchObject(at(12, 4));
    expect(swarm[6]).toMatchObject(at(24, 4));
    expect(swarm[7]).toMatchObject(at(13, 6));
  });

  it('nests each project as a 2×2 patch, six per row', () => {
    const first = layout.cells.filter((c) => c.project === 'the-hive');
    expect(first.map(({ x, y }) => ({ x, y }))).toEqual([at(2, 9), at(3, 9), at(2, 10), at(3, 10)]);
    expect(layout.cells.find((c) => c.project === 'incorpx-customer-onboarding-portal')).toMatchObject(at(2, 13));
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

  it('folds projects past twelve into one "+N projects" cell, keeping the urgent ones', () => {
    const counts: [string, number][] = [...HEAVY_COUNTS, ['zz-urgent', 1]];
    const many = heavy(counts);
    many.entities = many.entities.map((e) => (e.project === 'zz-urgent' ? { ...e, state: 'summons' } : e));
    const l = layoutComb(many.entities, many.projects);
    expect(l.cells.find((c) => c.id === 'rest:*')).toMatchObject({ project: '*', name: '+2', more: 2, ...at(32, 13) });
    expect(l.cells.some((c) => c.project === 'zz-urgent')).toBe(true);
  });

  it('turns a fifteenth agent into a "+N" swarm cell', () => {
    const l = layoutComb(heavy([['p', 1]], 16).entities, [{ id: 'p', name: 'p' }]);
    expect(l.cells.find((c) => c.id === 'rest:swarm')).toMatchObject({ name: '+3', more: 3 });
  });
});
