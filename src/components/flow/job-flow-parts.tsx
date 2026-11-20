import type { ReactNode } from 'react';

import { durationText, type FlowEdge, type JobFlow } from '@lib/job-flow';

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const laneName = (flow: JobFlow, id: string) => flow.lanes.find((lane) => lane.id === id)?.name ?? id;

const CARD = 'grid content-start gap-2.5 rounded-xl border border-border-soft bg-panel px-4 py-3.5';
const EYEBROW = 'text-micro font-semibold tracking-[.06em] text-subtle uppercase';
const BUTTON = 'rounded-md border border-border bg-chip px-3 py-1 text-control font-semibold text-ink hover:bg-hover';

/** The line above the chart: the live stage, elapsed and quiet time, parties, PRs, your wait (Job Flow). */
export function JobFlowSummary({ flow }: { flow: JobFlow }) {
  const quiet = flow.gaps.reduce((sum, gap) => sum + gap.to - gap.from, 0);
  const you = flow.buckets.find((bucket) => bucket.tone === 'you');
  const strong = 'font-semibold text-ink tabular-nums';
  return (
    <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 text-control text-muted">
      {flow.now === undefined ? null : (
        <span className="inline-flex items-center gap-[7px] rounded-full bg-chip py-[3px] pr-2.5 pl-2 font-semibold text-ink">
          <span aria-hidden className="size-2 rounded-full bg-green motion-safe:animate-pulse" />
          {flow.now.label}
        </span>
      )}
      <span>
        <b className={strong}>{durationText(flow.end - flow.start)}</b> since the first entry
        {quiet > 0 ? (
          <>
            , <b className={strong}>{durationText(quiet)}</b> of it quiet
          </>
        ) : null}
      </span>
      <span>
        <b className={strong}>{flow.lanes.length}</b> parties
      </span>
      {flow.prs.length === 0 ? null : (
        <span>
          PRs
          {flow.prs.map((pr) => (
            <b key={pr} className={`ml-1 ${strong}`}>
              {pr}
            </b>
          ))}
        </span>
      )}
      {you === undefined ? null : (
        <span>
          waiting on you <b className={strong}>{durationText(you.ms)}</b>
        </span>
      )}
    </div>
  );
}

function LegendItem({ swatch, text }: { swatch: ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-[7px]">
      <svg aria-hidden width={26} height={12} className="overflow-visible">
        {swatch}
      </svg>
      {text}
    </span>
  );
}

/** What each mark on the chart means: the Transit legend (Job Flow). */
export function JobFlowLegend() {
  const line = (className: string, width: number, dashed = false) => (
    <line
      x1={3}
      x2={23}
      y1={6}
      y2={6}
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      {...(dashed ? { strokeDasharray: '0.1 6' } : {})}
      className={className}
    />
  );
  return (
    <div aria-label="Legend" className="flex flex-wrap items-center gap-x-[18px] gap-y-1.5 text-ui-sm text-subtle">
      <LegendItem swatch={line('text-green', 6)} text="working" />
      <LegendItem swatch={line('text-amber', 6)} text="waiting on you" />
      <LegendItem swatch={line('text-subtle', 2.2, true)} text="waiting on someone else" />
      <LegendItem
        swatch={<path d="M2,10 C14,10 12,2 24,2" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" className="text-green" />}
        text="handoff"
      />
      <LegendItem
        swatch={<path d="M2,2 C14,2 12,10 24,10" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />}
        text="return"
      />
    </div>
  );
}

/** How an ask closed, or how long it has waited; nothing for a return. */
function closing(edge: FlowEdge, flow: JobFlow): string | null {
  if (edge.kind !== 'ask') return null;
  if (edge.closedAt === undefined) return `Open · ${durationText(flow.end - edge.at)} so far`;
  const closer = flow.edges.find((other) => other.thread === edge.thread && other.id !== edge.id && other.kind !== 'ask');
  return `Answered by ${laneName(flow, closer?.from ?? edge.to)} at ${clock(edge.closedAt)} · ${durationText(edge.closedAt - edge.at)}`;
}

/** The selected handoff, in full: what was asked or answered, its riders, and how it closed (Job Flow). */
export function JobFlowEntryCard({
  edge,
  flow,
  onClear,
  onGoTo,
}: {
  edge: FlowEdge;
  flow: JobFlow;
  onClear: () => void;
  /** Present when the caller can open a session; shown only when a session is a party to the handoff. */
  onGoTo?: () => void;
}) {
  const session = [edge.from, edge.to].find((id) => flow.lanes.find((lane) => lane.id === id)?.kind === 'session');
  const riders = Object.entries(edge.entry.meta ?? {}).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value));
  const closed = closing(edge, flow);
  return (
    <section aria-live="polite" className={CARD}>
      <h2 className={EYEBROW}>Selected handoff</h2>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5 text-control text-muted">
        {edge.ref === undefined ? null : <span className="font-mono font-semibold text-brand">{edge.ref}</span>}
        <span>{edge.kind}</span>
        <span className="font-semibold text-ink">{`${laneName(flow, edge.from)} → ${laneName(flow, edge.to)}`}</span>
        <span>{clock(edge.at)}</span>
      </div>
      <div className="rounded-lg border border-border-soft bg-panel-2 px-3 py-2.5 font-mono text-ui-sm leading-[1.55] break-words whitespace-pre-wrap text-ink">
        {edge.entry.body}
      </div>
      {riders.length === 0 ? null : (
        <div className="flex flex-wrap gap-1.5">
          {riders.map(([key, value]) => (
            <span key={key} className="rounded bg-chip px-1.5 py-0.5 font-mono text-micro text-muted">{`${key}: ${String(value)}`}</span>
          ))}
        </div>
      )}
      {closed === null ? null : <p className="text-control text-muted">{closed}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onClear} className={BUTTON}>
          Show the whole job
        </button>
        {onGoTo === undefined || session === undefined ? null : (
          <button type="button" onClick={onGoTo} className={BUTTON}>
            {`Go to ${laneName(flow, session)}`}
          </button>
        )}
      </div>
    </section>
  );
}

/** Where the time went: one bar per party, your waiting in amber, and the sentence (Job Flow). */
export function JobFlowBuckets({ flow }: { flow: JobFlow }) {
  const max = Math.max(1, ...flow.buckets.map((bucket) => bucket.ms));
  return (
    <section className={CARD}>
      <h2 className={EYEBROW}>Where the time went</h2>
      <div className="grid gap-2">
        {flow.buckets.map((bucket) => (
          <div
            key={bucket.party}
            data-testid="flow-bucket"
            className="grid grid-cols-[86px_minmax(0,1fr)_62px] items-center gap-2.5 text-ui-sm"
          >
            <span className="truncate font-semibold text-ink">{laneName(flow, bucket.party)}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-border-soft">
              <span
                className={`block h-full rounded-full ${bucket.tone === 'you' ? 'bg-amber' : 'bg-green'}`}
                style={{ width: `${(bucket.ms / max) * 100}%` }}
              />
            </span>
            <span className="text-right font-mono text-micro text-muted tabular-nums">{durationText(bucket.ms)}</span>
          </div>
        ))}
      </div>
      {flow.sentence === '' ? null : <p className="text-control leading-normal text-muted">{flow.sentence}</p>}
    </section>
  );
}
