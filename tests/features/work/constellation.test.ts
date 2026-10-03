import { describe, expect, it } from 'vitest';

import type { LinkArcs, LinkedTicket } from '@/lib/ticket-links';
import { layoutConstellation, shortKey, spread } from '@features/work/constellation';
import type { JiraStatusCategory } from '@shared/jira-contract';

const t = (key: string, statusCategory: JiraStatusCategory = 'todo'): LinkedTicket => ({ key, summary: `${key} title`, status: 'S', statusCategory });
const arcs = (over: Partial<LinkArcs>): LinkArcs => {
  const base = { waitsOn: [], blocks: [], relates: [], ...over };
  return { ...base, total: base.waitsOn.length + base.blocks.length + base.relates.length };
};
const angles = (cells: { angle: number }[]) => cells.map((cell) => Math.round(cell.angle));

const normal = arcs({ waitsOn: [t('HIVE-188', 'done')], blocks: [{ ...t('HIVE-194'), next: t('HIVE-196') }], relates: [t('HIVE-179', 'done')] });

describe('spread', () => {
  it('centres, 26° apart, never wider than the arc; past six, five and a rest', () => {
    expect(spread([1], -150, -30).map((s) => s.angle)).toEqual([-90]);
    expect(spread([1, 2], 30, 150).map((s) => s.angle)).toEqual([77, 103]);
    const seven = spread([1, 2, 3, 4, 5, 6, 7], -150, -30);
    expect(seven.map((s) => s.angle)).toEqual([-150, -126, -102, -78, -54, -30]);
    expect(seven.at(-1)?.item).toEqual({ rest: 2 });
  });
});

describe('shortKey', () => {
  it("drops the ticket's own project prefix only", () => {
    expect(shortKey('HIVE-188', 'HIVE-193')).toBe('188');
    expect(shortKey('INCORP-598', 'HIVE-196')).toBe('INCORP-598');
  });
});

describe('layoutConstellation — the artifact densities', () => {
  it('normal (HIVE-193): cell radius 11, one done blocker above, one blocked below with its second hop', () => {
    const layout = layoutConstellation({ me: 'HIVE-193', arcs: normal, epicLabel: null, pr: null });
    expect(layout.centre).toMatchObject({ x: 148, y: 150, r: 26, label: '193', blocked: false });
    expect(layout.cells.map((c) => [c.label, c.arc, Math.round(c.angle), c.r, c.state])).toEqual([
      ['188', 'waitsOn', -90, 11, 'done'],
      ['194', 'blocks', 90, 11, 'todo'],
    ]);
    expect(layout.hops).toHaveLength(1);
    expect(layout.hops[0]).toMatchObject({ label: '196', r: 9, angle: 116 });
    expect(layout.edges.map((e) => e.kind)).toEqual(['in', 'out', 'far']);
  });

  it('simple (HIVE-212): an open blocker is amber, its arrow hot, the centre blocked', () => {
    const layout = layoutConstellation({ me: 'HIVE-212', arcs: arcs({ waitsOn: [t('HIVE-209', 'in-progress')], blocks: [t('HIVE-214')] }), epicLabel: null, pr: null });
    expect(layout.cells[0]).toMatchObject({ label: '209', state: 'prog', open: true });
    expect(layout.edges[0]?.kind).toBe('in-open');
    expect(layout.centre.blocked).toBe(true);
  });

  it('many blockers (HIVE-196): five cells and "+2", radius 9, other-project key whole', () => {
    const by = [t('HIVE-188', 'done'), t('HIVE-190', 'done'), t('HIVE-193', 'in-progress'), t('HIVE-194'), t('HIVE-195', 'in-progress'), t('INCORP-598', 'done'), t('HIVE-199')];
    const layout = layoutConstellation({ me: 'HIVE-196', arcs: arcs({ waitsOn: by, blocks: [t('HIVE-201')], relates: [t('HIVE-170', 'done')] }), epicLabel: null, pr: null });
    const upper = layout.cells.filter((c) => c.arc === 'waitsOn');
    expect(angles(upper)).toEqual([-150, -126, -102, -78, -54, -30]);
    expect(upper.map((c) => c.label)).toEqual(['188', '190', '193', '194', '195', '+2']);
    expect(upper.at(-1)).toMatchObject({ state: 'rest', rest: 2, open: false });
    expect(upper.every((c) => c.r === 9)).toBe(true);
  });

  it('blocks many (HIVE-140): a lower arc of six, no second hop at eight links', () => {
    const blocks = [t('HIVE-141', 'done'), t('HIVE-142', 'done'), t('HIVE-143', 'in-progress'), t('HIVE-144', 'in-progress'), t('HIVE-145'), { ...t('HIVE-146'), next: t('HIVE-147') }];
    const layout = layoutConstellation({ me: 'HIVE-140', arcs: arcs({ waitsOn: [t('HIVE-111', 'done')], blocks, relates: [t('HIVE-124', 'done')] }), epicLabel: null, pr: null });
    expect(angles(layout.cells.filter((c) => c.arc === 'blocks'))).toEqual([30, 54, 78, 102, 126, 150]);
    expect(layout.hops).toEqual([]);
  });
});
