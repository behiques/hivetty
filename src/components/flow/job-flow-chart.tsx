import { useMemo } from 'react';

import { durationText, type EdgeTone, type FlowEdge, flowScale, GAP_PX, type JobFlow } from '@lib/job-flow';
import { ticks } from '@lib/pr-timeline';
import { cn } from '@lib/utils';

export const CHART_W = 1100;
export const LABEL_W = 150;
const RIGHT = 28;
const TOP = 40;
const LANE_H = 58;
const PLOT_W = CHART_W - LABEL_W - RIGHT;
/** Two axis labels closer than this would overlap. */
const TICK_MIN_PX = 64;

export interface JobFlowChartProps {
  flow: JobFlow;
  /** The selected handoff's edge id; its thread is lit and the rest dims. */
  selected: string | null;
  onSelect: (edgeId: string) => void;
}

/**
 * One job as a route (Job Flow, variant A "Transit"): a quiet track per party,
 * work as a thick line, each handoff a curve onto the next track. Props only:
 * colour through `currentColor` and token utilities, never a literal.
 */
export function JobFlowChart({ flow, selected, onSelect }: JobFlowChartProps) {
  // Handoffs are the scale's anchors: two that land together are moved apart (flowScale), so each curve can be read and clicked.
  const scale = useMemo(
    () =>
      flowScale(
        flow.start,
        flow.end,
        flow.gaps,
        PLOT_W,
        flow.edges.map((edge) => edge.at),
      ),
    [flow],
  );
  const x = (t: number) => LABEL_W + scale.x(t);
  const nameOf = (id: string) => flow.lanes.find((lane) => lane.id === id)?.name ?? id;
  const focus = selected === null ? null : (flow.edges.find((edge) => edge.id === selected)?.thread ?? null);
  /** Off the selected thread, a mark dims; with nothing selected, nothing does. */
  const dim = (thread: string | undefined) => (focus !== null && thread !== focus ? 'opacity-25' : undefined);
  const laneY = (id: string) => TOP + 18 + flow.lanes.findIndex((lane) => lane.id === id) * LANE_H + LANE_H / 2;
  const height = TOP + 18 + flow.lanes.length * LANE_H + 12;
  /** The axis labels, each where the scale puts its time, dropping one that would run into the label before it. */
  const axis = scale.spans
    .flatMap((span) => ticks(span.from, span.to, span.w).map((tick) => ({ key: `${span.from}-${tick.at}`, label: tick.label, px: x(tick.at) })))
    .reduce<{ key: string; label: string; px: number }[]>(
      (kept, tick) => (tick.px - (kept.at(-1)?.px ?? -TICK_MIN_PX) >= TICK_MIN_PX ? [...kept, tick] : kept),
      [],
    );
  /** Where each gap's break sits: the right edge of the span before it. */
  const breakAt = (i: number) => LABEL_W + (scale.spans[i]?.x ?? 0) + (scale.spans[i]?.w ?? 0) + GAP_PX / 2;

  return (
    <svg
      role="img"
      aria-label="The job's parties over time"
      viewBox={`0 0 ${CHART_W} ${height}`}
      width={CHART_W}
      height={height}
      className="block"
    >
      {axis.map((tick) => (
        <g key={tick.key} data-testid="flow-tick">
          <line x1={tick.px} x2={tick.px} y1={TOP - 2} y2={height - 12} stroke="currentColor" strokeDasharray="2 4" className="text-border-soft" />
          <text x={tick.px} y={TOP - 12} textAnchor="middle" className="fill-current font-mono text-micro text-subtle">
            {tick.label}
          </text>
        </g>
      ))}
      {flow.gaps.map((gap, i) => (
        <text
          key={gap.from}
          data-testid="flow-gap"
          x={breakAt(i)}
          y={TOP - 12}
          textAnchor="middle"
          className="fill-current font-mono text-micro text-subtle"
        >
          {durationText(gap.to - gap.from)}
        </text>
      ))}
      {flow.lanes.map((lane) => {
        const y = laneY(lane.id);
        return (
          <g key={lane.id} data-testid="flow-lane" data-lane={lane.id}>
            <text x={18} y={y - 2} className="fill-current text-control font-semibold text-ink">
              {lane.name}
            </text>
            <text x={18} y={y + 13} className="fill-current text-micro text-subtle">
              {lane.kind}
            </text>
            {scale.spans.map((span) => (
              <line
                key={span.from}
                x1={LABEL_W + span.x}
                x2={LABEL_W + span.x + span.w}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                className="text-border-soft"
              />
            ))}
            {flow.gaps.map((gap, i) => (
              <path
                key={gap.from}
                d={`M${breakAt(i) - 6},${y + 5} l5,-10 M${breakAt(i) + 1},${y + 5} l5,-10`}
                stroke="currentColor"
                strokeWidth={1.2}
                strokeLinecap="round"
                fill="none"
                className="text-subtle"
              />
            ))}
          </g>
        );
      })}
      {flow.segments
        .filter((s) => s.tone === 'wait')
        .map((s) => (
          <line
            key={`wait-${s.lane}-${s.from}-${s.thread ?? ''}`}
            data-testid="flow-segment"
            data-tone="wait"
            data-thread={s.thread ?? ''}
            x1={x(s.from)}
            x2={x(s.to)}
            y1={laneY(s.lane)}
            y2={laneY(s.lane)}
            stroke="currentColor"
            strokeWidth={2.2}
            strokeDasharray="0.1 6"
            strokeLinecap="round"
            className={cn('text-subtle transition-opacity', dim(s.thread))}
          />
        ))}
      {flow.edges.map((edge) => (
        <Handoff
          key={edge.id}
          edge={edge}
          x={x(edge.at)}
          y1={laneY(edge.from)}
          y2={laneY(edge.to)}
          label={`${edge.ref ?? edge.kind}: ${nameOf(edge.from)} to ${nameOf(edge.to)}`}
          dimmed={dim(edge.thread) !== undefined}
          onSelect={onSelect}
        />
      ))}
      {flow.segments
        .filter((s) => s.tone !== 'wait')
        .map((s) => (
          <line
            key={`${s.tone}-${s.lane}-${s.from}-${s.thread ?? ''}`}
            data-testid="flow-segment"
            data-tone={s.tone}
            data-thread={s.thread ?? ''}
            x1={x(s.from)}
            x2={Math.max(x(s.to), x(s.from) + 1)}
            y1={laneY(s.lane)}
            y2={laneY(s.lane)}
            stroke="currentColor"
            strokeWidth={6}
            strokeLinecap="round"
            className={cn(s.tone === 'you' ? 'text-amber' : 'text-green', 'transition-opacity', dim(s.thread))}
          />
        ))}
      {flow.stations.map((station) => (
        <circle
          key={`station-${station.lane}-${station.at}`}
          data-testid="flow-station"
          cx={x(station.at)}
          cy={laneY(station.lane)}
          r={1.6}
          className="fill-current text-panel"
        />
      ))}
      {flow.marks
        // A label needs room before the lane's next one; the last on a lane always shows.
        .filter((m) => m.until === flow.end || x(m.until) - x(m.at) >= m.text.length * 5.6)
        .map((m) => (
          <text
            key={`mark-${m.lane}-${m.at}`}
            x={x(m.at) + 1}
            y={laneY(m.lane) - 12}
            className="pointer-events-none fill-current text-micro font-medium text-muted"
          >
            {m.text}
          </text>
        ))}
      {flow.now === undefined ? null : (
        <g data-testid="flow-now" className="text-green">
          <line x1={x(flow.end)} x2={x(flow.end)} y1={TOP + 10} y2={height - 12} stroke="currentColor" opacity={0.45} />
          <circle
            cx={x(flow.end)}
            cy={laneY(flow.now.lane)}
            r={4.5}
            fill="currentColor"
            className="origin-center [transform-box:fill-box] motion-safe:animate-ping"
          />
          <circle cx={x(flow.end)} cy={laneY(flow.now.lane)} r={3.5} fill="currentColor" />
        </g>
      )}
    </svg>
  );
}

const EDGE_TONE: Record<EdgeTone, string> = {
  work: 'text-green',
  you: 'text-amber',
  return: 'text-subtle',
  fail: 'text-red',
};

/** One ask or return: an S-curve from the sender's track to the receiver's, a station where it leaves, the ref beside it. */
function Handoff({
  edge,
  x,
  y1,
  y2,
  label,
  dimmed,
  onSelect,
}: {
  edge: FlowEdge;
  x: number;
  y1: number;
  y2: number;
  label: string;
  dimmed: boolean;
  onSelect: (id: string) => void;
}) {
  const run = 14;
  const d = `M${x - run / 2},${y1} C${x + 2},${y1} ${x - 2},${y2} ${x + run / 2},${y2}`;
  const ask = edge.kind === 'ask';
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      data-thread={edge.thread}
      className={cn('cursor-pointer outline-none transition-opacity focus-visible:[&>path:first-child]:[stroke-width:3.5]', EDGE_TONE[edge.tone], dimmed && 'opacity-25')}
      onClick={() => onSelect(edge.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(edge.id);
        }
      }}
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={ask ? 2.4 : 1.6} strokeLinecap="round" opacity={ask ? 1 : 0.85} />
      <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
      <circle cx={x - run / 2} cy={y1} r={3.6} strokeWidth={2} stroke="currentColor" className="fill-panel" />
      {edge.ref === undefined ? null : (
        <text x={x + 9} y={(y1 + y2) / 2 + 4} className="pointer-events-none fill-current font-mono text-micro text-subtle">
          {edge.ref}
        </text>
      )}
    </g>
  );
}
