import { ArrowsIn, MagnifyingGlassMinus, MagnifyingGlassPlus } from '@phosphor-icons/react';
import { useState } from 'react';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { NODE_H, NODE_W, type ChecksGraph, type EdgeState, type GraphNode } from '@/lib/checks-graph';
import { cn } from '@/lib/utils';

import { StateIcon } from '@features/pull-requests/components/state-icon';
import { useMeasuredWidth } from '@features/pull-requests/components/timeline-lane';

const EDGE: Record<EdgeState, string> = {
  ok: 'stroke-[color-mix(in_srgb,var(--cc-green)_45%,var(--cc-border))]',
  bad: 'stroke-[color-mix(in_srgb,var(--cc-red)_55%,var(--cc-border))]',
  wait: 'stroke-border [stroke-dasharray:3_5]',
  flow: 'stroke-green [stroke-dasharray:6_5]',
};

const NODE: Record<GraphNode['state'], string> = {
  passed: 'border-[color-mix(in_srgb,var(--cc-green)_35%,var(--cc-border))]',
  failed: 'border-red bg-[color-mix(in_srgb,var(--cc-red)_10%,var(--cc-panel))] shadow-[0_0_18px_color-mix(in_srgb,var(--cc-red)_25%,transparent)]',
  running: 'border-green shadow-[0_0_0_3px_color-mix(in_srgb,var(--cc-green)_12%,transparent)]',
  waiting: 'border-dashed border-border opacity-60',
  skipped: 'border-dashed border-border opacity-60',
};

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.25;

const ZOOM_BUTTON = 'grid size-7 place-items-center rounded-[6px] text-muted hover:bg-hover hover:text-ink aria-pressed:bg-hover aria-pressed:text-ink disabled:opacity-40 disabled:hover:bg-transparent';

/**
 * The Checks graph (HIVE-206): a box per job at the layout's place, its
 * `needs` as edges in the state of their target, later workflows in a dashed
 * group. Edges into a running job flow unless motion is reduced; every state
 * still reads from colour, border and icon. It takes the stage's whole width;
 * a graph wider still scrolls, or zooms out: −, +, Fit (to the width), and the
 * percentage back to 100%.
 */
export function ChecksGraphView({ graph, onJob, onExpand }: { graph: ChecksGraph; onJob: (id: number) => void; onExpand: (defId: string) => void }) {
  const still = useReducedMotion();
  const [ref, viewport] = useMeasuredWidth();
  const [zoom, setZoom] = useState<number | 'fit'>(1);
  // Unmeasured (happy-dom, the first frame) fits at 100%.
  const fit = viewport > 0 ? Math.min(1, viewport / graph.width) : 1;
  const scale = zoom === 'fit' ? fit : zoom;
  const step = (by: number) => setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((scale + by) / ZOOM_STEP) * ZOOM_STEP)));
  return (
    <div className="mx-6 mt-3">
      <div role="group" aria-label="Zoom" className="ml-auto flex w-fit items-center gap-0.5 rounded-[8px] border border-border-soft bg-panel p-0.5">
        <button type="button" aria-label="Zoom out" title="Zoom out" disabled={scale <= ZOOM_MIN} onClick={() => step(-ZOOM_STEP)} className={ZOOM_BUTTON}>
          <MagnifyingGlassMinus size={14} aria-hidden />
        </button>
        <button type="button" aria-label="Reset zoom" title="Back to 100%" onClick={() => setZoom(1)} className="h-7 min-w-11 rounded-[6px] px-1 tabular-nums text-[11.5px] text-muted hover:bg-hover hover:text-ink">
          {`${String(Math.round(scale * 100))}%`}
        </button>
        <button type="button" aria-label="Zoom in" title="Zoom in" disabled={scale >= ZOOM_MAX} onClick={() => step(ZOOM_STEP)} className={ZOOM_BUTTON}>
          <MagnifyingGlassPlus size={14} aria-hidden />
        </button>
        <button type="button" aria-label="Fit to width" title="Fit to width" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')} className={ZOOM_BUTTON}>
          <ArrowsIn size={14} aria-hidden />
        </button>
      </div>
      <div ref={ref} className="overflow-x-auto pt-2 pb-3">
        <div style={{ width: graph.width * scale, height: graph.height * scale }}>
          <div className="relative origin-top-left" style={{ width: graph.width, height: graph.height, transform: scale === 1 ? undefined : `scale(${String(scale)})` }}>
            {graph.groups.map((group) => (
              <div key={group.file} className="absolute rounded-[14px] border border-dashed border-border" style={{ left: group.x, top: group.y, width: group.w, height: group.h }}>
                <span className="absolute -top-[9px] left-3 bg-bg px-1.5 tabular-nums text-[11px] text-subtle">{group.file}</span>
              </div>
            ))}
            <svg aria-hidden className="absolute inset-0 overflow-visible" width={graph.width} height={graph.height}>
              {graph.edges.map((edge) => (
                <path
                  key={edge.key}
                  d={edge.d}
                  data-state={edge.state}
                  className={cn('fill-none [stroke-width:1.6]', EDGE[edge.state], edge.state === 'flow' && !still && 'animate-ccflow')}
                />
              ))}
            </svg>
            {graph.nodes.map((node) => {
              const label = node.count > 1 ? `${node.label} × ${String(node.count)}` : node.label;
              return (
                <button
                  key={node.key}
                  type="button"
                  data-state={node.state}
                  aria-label={`${label}, ${node.state}, ${node.time}`}
                  title={label}
                  onClick={() => {
                    if (node.matrix !== null) onExpand(node.matrix);
                    else if (node.jobId !== null) onJob(node.jobId);
                  }}
                  className={cn('absolute flex items-center gap-2.5 overflow-hidden rounded-[10px] border bg-panel px-3 text-left hover:bg-hover', NODE[node.state])}
                  style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
                >
                  <StateIcon state={node.state} />
                  <span className="flex min-w-0 flex-col gap-px">
                    <b className="truncate tabular-nums text-[12.5px] text-ink">{label}</b>
                    <span className="truncate tabular-nums text-[11px] text-muted">{node.time}</span>
                  </span>
                  {node.progress === null ? null : (
                    <span role="progressbar" aria-label={`${node.label} progress`} aria-valuenow={Math.round(node.progress * 100)} aria-valuemin={0} aria-valuemax={100} className="absolute inset-x-0 bottom-0 h-[3px] bg-border">
                      <span className="block h-full bg-green" style={{ width: `${String(node.progress * 100)}%` }} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
