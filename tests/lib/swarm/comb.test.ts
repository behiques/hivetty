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
