import { describe, expect, it } from 'vitest';

import { arcCounts, isBlocks, linkArcs, ticketLinksModel, verdict } from '@/lib/ticket-links';
import type { JiraLink, JiraStatusCategory } from '@shared/jira-contract';

const link = (
  key: string,
  statusCategory: JiraStatusCategory,
  linkType: string,
  direction: 'inward' | 'outward',
): JiraLink => ({
  kind: 'issue',
  title: `${key} — t`,
  url: `https://x/browse/${key}`,
  relationship: 'r',
  status: 'S',
  key,
  summary: `${key} title`,
  statusCategory,
  linkType,
  direction,
});
const remote: JiraLink = { kind: 'remote', title: 'Doc', url: 'https://doc' };

describe('linkArcs (HIVE-202, D5)', () => {
  it('sorts by the Blocks type name and direction; everything else relates; remote links dropped', () => {
    const arcs = linkArcs([
      link('HIVE-188', 'done', 'Blocks', 'inward'),
      link('HIVE-194', 'todo', 'blocks', 'outward'),
      link('HIVE-179', 'done', 'Relates', 'outward'),
      link('HIVE-170', 'todo', 'Duplicate', 'inward'),
      remote,
    ]);
    expect(arcs.waitsOn.map((t) => t.key)).toEqual(['HIVE-188']);
    expect(arcs.blocks.map((t) => t.key)).toEqual(['HIVE-194']);
    expect(arcs.relates.map((t) => t.key)).toEqual(['HIVE-179', 'HIVE-170']);
    expect(arcs.total).toBe(4);
  });

  it("attaches the second hop's first outward Blocks ticket to a blocked ticket", () => {
    const arcs = linkArcs([link('HIVE-194', 'todo', 'Blocks', 'outward')], {
      'HIVE-194': [link('HIVE-196', 'todo', 'Blocks', 'outward')],
    });
    expect(arcs.blocks[0]?.next?.key).toBe('HIVE-196');
  });

  it('skips a remote second hop, and leaves a blocked ticket with no hop without a next', () => {
    const arcs = linkArcs([link('A-1', 'todo', 'Blocks', 'outward'), link('A-2', 'todo', 'Blocks', 'outward')], {
      'A-1': [remote, link('A-3', 'done', 'Blocks', 'outward')],
    });
    expect(arcs.blocks[0]?.next?.key).toBe('A-3');
    expect(arcs.blocks[1]).not.toHaveProperty('next');
  });

  it('drops an issue link without a key; defaults a missing summary, status and category', () => {
    const arcs = linkArcs([
      { kind: 'issue', title: 'No key', url: 'https://x' },
      { kind: 'issue', title: 'Bare', url: 'https://x/browse/A-9', key: 'A-9' },
    ]);
    expect(arcs.total).toBe(1);
    expect(arcs.relates).toEqual([{ key: 'A-9', summary: '', status: '', statusCategory: 'todo' }]);
  });

  it('a Blocks link with no direction goes on the lower arc', () => {
    const arcs = linkArcs([{ ...link('A-1', 'todo', 'Blocks', 'inward'), direction: undefined }]);
    expect(arcs.blocks.map((t) => t.key)).toEqual(['A-1']);
  });

  it('isBlocks ignores case and a missing type', () => {
    expect(isBlocks(link('A-1', 'todo', 'BLOCKS', 'inward'))).toBe(true);
    expect(isBlocks(remote)).toBe(false);
  });
});

describe('arcCounts', () => {
  it('counts each category', () => {
    const arcs = linkArcs([
      link('A-1', 'done', 'Blocks', 'inward'),
      link('A-2', 'in-progress', 'Blocks', 'inward'),
      link('A-3', 'in-progress', 'Blocks', 'inward'),
    ]);
    expect(arcCounts(arcs.waitsOn)).toEqual({ done: 1, 'in-progress': 2, todo: 0 });
  });
});

describe('verdict — the exact copy', () => {
  const v = (links: JiraLink[]) => verdict(linkArcs(links));
  it('amber with every open blocker, full keys, Jira order', () => {
    expect(v([link('HIVE-209', 'in-progress', 'Blocks', 'inward')])).toEqual({
      tone: 'amber',
      lead: 'Blocked by 1 open:',
      rest: ' HIVE-209.',
    });
    expect(
      v([
        link('HIVE-193', 'todo', 'Blocks', 'inward'),
        link('HIVE-188', 'done', 'Blocks', 'inward'),
        link('HIVE-194', 'in-progress', 'Blocks', 'inward'),
      ]),
    ).toEqual({ tone: 'amber', lead: 'Blocked by 2 open:', rest: ' HIVE-193, HIVE-194.' });
  });
  it('green: one blocker done, one waits', () => {
    expect(v([link('A-1', 'done', 'Blocks', 'inward'), link('A-2', 'todo', 'Blocks', 'outward')])).toEqual({
      tone: 'green',
      lead: 'Clear to go.',
      rest: ' Its one blocker is done; 1 ticket waits on it.',
    });
  });
  it('green: all N done, N wait', () => {
    expect(
      v([
        link('A-1', 'done', 'Blocks', 'inward'),
        link('A-2', 'done', 'Blocks', 'inward'),
        link('A-3', 'todo', 'Blocks', 'outward'),
        link('A-4', 'todo', 'Blocks', 'outward'),
      ]),
    ).toEqual({ tone: 'green', lead: 'Clear to go.', rest: ' All 2 blockers are done; 2 tickets wait on it.' });
  });
  it('green: nothing blocks it, nothing waits', () => {
    expect(v([])).toEqual({ tone: 'green', lead: 'Clear to go.', rest: ' Nothing blocks it.' });
  });
});

describe('ticketLinksModel', () => {
  it('bundles arcs, open blockers, verdict and per-arc counts', () => {
    const model = ticketLinksModel([link('A-1', 'todo', 'Blocks', 'inward'), link('A-2', 'done', 'Relates', 'inward')]);
    expect(model.openBlockers.map((t) => t.key)).toEqual(['A-1']);
    expect(model.verdict.tone).toBe('amber');
    expect(model.counts.relates).toEqual({ done: 1, 'in-progress': 0, todo: 0 });
  });
});
