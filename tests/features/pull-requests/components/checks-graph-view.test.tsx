import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChecksGraph, GraphNode } from '@/lib/checks-graph';
import { ChecksGraphView } from '@features/pull-requests/components/checks-graph-view';

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => reduced.value }));

const node = (key: string, state: GraphNode['state'], over: Partial<GraphNode> = {}): GraphNode => ({
  key, label: key, x: 0, y: 0, state, time: state === 'waiting' ? 'waits' : '38s', progress: null, jobId: 1, count: 1, matrix: null, ...over,
});
const graph: ChecksGraph = {
  nodes: [
    node('install', 'passed', { jobId: 11 }),
    node('integration', 'failed', { jobId: 12, time: 'failed · 3m 10s' }),
    node('e2e', 'running', { jobId: 13, progress: 0.5, time: 'running · 2m 14s' }),
    node('build', 'waiting', { jobId: null }),
    node('unit', 'passed', { jobId: null, count: 6, matrix: 'unit' }),
  ],
  edges: [
    { key: 'a>b', d: 'M0 0', state: 'ok' }, { key: 'a>c', d: 'M0 0', state: 'bad' },
    { key: 'a>d', d: 'M0 0', state: 'wait' }, { key: 'a>e', d: 'M0 0', state: 'flow' },
  ],
  groups: [{ file: 'preview.yml', x: 792, y: 118, w: 176, h: 64 }],
  files: ['ci.yml', 'preview.yml'], width: 960, height: 300,
};

beforeEach(() => { reduced.value = false; });

describe('ChecksGraphView', () => {
  it('draws every node state with its name and time', () => {
    render(<ChecksGraphView graph={graph} onJob={() => {}} onExpand={() => {}} />);
    expect(screen.getByRole('button', { name: 'integration, failed, failed · 3m 10s' })).toHaveAttribute('data-state', 'failed');
    expect(screen.getByRole('button', { name: /e2e, running/ })).toHaveAttribute('data-state', 'running');
    expect(screen.getByRole('button', { name: /build, waiting/ })).toHaveAttribute('data-state', 'waiting');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('draws each edge in its state, and the group box with its file', () => {
    const { container } = render(<ChecksGraphView graph={graph} onJob={() => {}} onExpand={() => {}} />);
    expect([...container.querySelectorAll('path[data-state]')].map((p) => p.getAttribute('data-state'))).toEqual(['ok', 'bad', 'wait', 'flow']);
    expect(container.querySelector('path[data-state="flow"]')?.getAttribute('class')).toContain('animate-ccflow');
    expect(screen.getByText('preview.yml')).toBeInTheDocument();
  });

  it('holds the edges still under reduced motion', () => {
    reduced.value = true;
    const { container } = render(<ChecksGraphView graph={graph} onJob={() => {}} onExpand={() => {}} />);
    expect(container.querySelector('path[data-state="flow"]')?.getAttribute('class')).not.toContain('animate-ccflow');
  });

  it('shows a job on click, and opens a matrix box into its legs', () => {
    const onJob = vi.fn();
    const onExpand = vi.fn();
    render(<ChecksGraphView graph={graph} onJob={onJob} onExpand={onExpand} />);
    fireEvent.click(screen.getByRole('button', { name: /integration/ }));
    fireEvent.click(screen.getByRole('button', { name: /unit × 6/ }));
    fireEvent.click(screen.getByRole('button', { name: /build/ }));
    expect(onJob).toHaveBeenCalledWith(12);
    expect(onJob).toHaveBeenCalledTimes(1);
    expect(onExpand).toHaveBeenCalledWith('unit');
  });
});
