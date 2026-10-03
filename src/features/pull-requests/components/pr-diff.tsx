import { Fragment, useMemo, useState } from 'react';

import { lineKey, placeThreads } from '@/lib/pr-files';
import { splitRows, type DiffFile, type DiffLine } from '@/lib/unified-diff';
import { cn } from '@/lib/utils';

import { SegmentedControl } from '@components/ui/segmented-control';
import { ThreadCard, type ThreadWrites } from '@features/pull-requests/components/thread-card';
import type { GhResult, PrFile, PrThread } from '@shared/github-contract';
import { usePrDiffView, usePrPageActions, type PrDiffView } from '@stores/ui-store';

const VIEWS = [
  { value: 'unified', label: 'Unified' },
  { value: 'split', label: 'Split' },
] as const satisfies readonly { value: PrDiffView; label: string }[];

const WASH: Record<DiffLine['kind'], string> = {
  add: 'bg-[color-mix(in_srgb,var(--cc-green)_11%,transparent)]',
  del: 'bg-[color-mix(in_srgb,var(--cc-red)_11%,transparent)]',
  context: '',
};
const SIGN: Record<DiffLine['kind'], { text: string; tone: string }> = {
  add: { text: '+', tone: 'text-green' },
  del: { text: '−', tone: 'text-red' },
  context: { text: '', tone: 'text-subtle' },
};

/** The number a row is selected and opened at: the new side's, the old one for a removed line. */
const lineOf = (line: DiffLine): number => line.newN ?? line.oldN ?? 1;

/** One diff row: a 46px number gutter (a button, selecting the line), a 16px sign, the text. */
export function DiffRow({ line, n, selected, onSelect }: { line: DiffLine; n: number | null; selected: boolean; onSelect: (n: number) => void }) {
  const sign = SIGN[line.kind];
  return (
    <div data-kind={line.kind} className={cn('flex pr-4 whitespace-pre', WASH[line.kind], selected && 'shadow-[inset_2px_0_var(--cc-amber)]')}>
      {n === null ? (
        <span className="w-[46px] shrink-0" />
      ) : (
        <button type="button" aria-label={`Line ${String(n)}`} onClick={() => onSelect(n)} className="w-[46px] shrink-0 pr-2.5 text-right text-subtle hover:text-ink">
          {n}
        </button>
      )}
      <span className={cn('w-4 shrink-0', sign.tone)}>{sign.text}</span>
      <span className="text-ink">{line.text === '' ? ' ' : line.text}</span>
    </div>
  );
}

/**
 * The selected file's diff (HIVE-207): the header (path, +/−, Viewed, Unified
 * | Split, Open in the editor) and plain mono rows in the editor's font and
 * palette — no highlighting, so the editor seam is untouched.
 */
export interface PrDiffProps {
  file: PrFile;
  diff: DiffFile | null;
  threads: PrThread[];
  problem?: string;
  prUrl: string;
  readOnly: boolean;
  onViewed: (viewed: boolean) => Promise<GhResult<true>>;
  onOpenFile?: (path: string, line: number) => void;
  writes?: ThreadWrites;
  fixerOnIt: boolean;
}

export function PrDiff({ file, diff, threads, problem, prUrl, readOnly, onViewed, onOpenFile, writes, fixerOnIt }: PrDiffProps) {
  const view = usePrDiffView();
  const { setPrDiffView } = usePrPageActions();
  const [selected, setSelected] = useState<number | null>(null);
  const [viewedProblem, setViewedProblem] = useState<string | null>(null);
  // A re-toggle mid-write would roll back to the wrong state, so Viewed waits for its write (#22).
  const [pending, setPending] = useState(false);
  const firstChanged = diff?.hunks.flatMap((hunk) => hunk.lines).find((line) => line.kind !== 'context');
  const openAt = selected ?? (firstChanged === undefined ? 1 : lineOf(firstChanged));
  const showable = diff !== null && !diff.binary && diff.hunks.length > 0;
  const placed = useMemo(() => (diff === null ? null : placeThreads(diff, threads)), [diff, threads]);

  const card = (thread: PrThread) => (
    <div key={thread.id} data-thread={thread.id} className="my-1.5 mr-[18px] ml-[72px] font-sans">
      <ThreadCard thread={thread} fixerOnIt={fixerOnIt && !thread.isResolved} onOpenFile={onOpenFile} writes={writes} />
    </div>
  );
  const under = (key: string) => placed?.at.get(key)?.map(card);

  const toggleViewed = (next: boolean) => {
    setViewedProblem(null);
    setPending(true);
    void onViewed(next).then((result) => {
      setPending(false);
      if (!result.ok) setViewedProblem(result.error.message);
    });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5 border-b border-border-soft px-[18px] py-2.5 text-[12.5px]">
        <h2 className="truncate font-mono text-ink">{file.path}</h2>
        <span className="font-mono text-green">{`+${String(file.additions)}`}</span>
        <span className="font-mono text-red">{`−${String(file.deletions)}`}</span>
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <input
            type="checkbox"
            aria-label="Viewed"
            checked={file.viewed === 'viewed'}
            disabled={readOnly || pending}
            onChange={(event) => toggleViewed(event.target.checked)}
          />
          Viewed
          {file.viewed === 'dismissed' ? <span className="text-amber">changed since</span> : null}
        </label>
        <SegmentedControl label="Diff view" options={VIEWS} value={view} onChange={setPrDiffView} />
        {onOpenFile !== undefined && diff?.status !== 'deleted' ? (
          <button type="button" onClick={() => onOpenFile(file.path, openAt)} className="text-[12px] text-brand hover:underline">
            Open in the editor
          </button>
        ) : null}
      </div>
      {viewedProblem === null ? null : <p className="px-[18px] pt-2 text-[12px] text-amber">{viewedProblem}</p>}
      <div className="min-h-0 flex-1 overflow-auto py-2 font-mono text-[12.5px] leading-[1.75]">
        {showable ? (
          <>
            {placed?.outdated.map(card)}
            {diff.hunks.map((hunk, h) => (
              <div key={`${String(h)}${hunk.header}`}>
                <div className="px-[18px] py-0.5 text-subtle">{hunk.header}</div>
                {view === 'unified'
                  ? hunk.lines.map((line, i) => (
                      <Fragment key={i}>
                        <DiffRow line={line} n={line.newN ?? line.oldN} selected={selected === lineOf(line)} onSelect={setSelected} />
                        {line.oldN !== null && line.kind !== 'context' ? under(lineKey('L', line.oldN)) : null}
                        {line.newN !== null ? under(lineKey('R', line.newN)) : null}
                        {line.kind === 'context' && line.oldN !== null ? under(lineKey('L', line.oldN)) : null}
                      </Fragment>
                    ))
                  : splitRows(hunk).map((row, i) => (
                      <Fragment key={i}>
                        <div data-testid={`split-row-${String(i)}`} className="grid grid-cols-2">
                          <div data-side="left" className="min-w-0 border-r border-border-soft">
                            {row.left === null ? (
                              <div className="h-full" />
                            ) : (
                              <DiffRow line={row.left} n={row.left.oldN} selected={selected === lineOf(row.left)} onSelect={setSelected} />
                            )}
                          </div>
                          <div data-side="right" className="min-w-0">
                            {row.right === null ? (
                              <div className="h-full" />
                            ) : (
                              <DiffRow line={row.right} n={row.right.newN} selected={selected === lineOf(row.right)} onSelect={setSelected} />
                            )}
                          </div>
                        </div>
                        {row.left !== null && row.left.oldN !== null ? under(lineKey('L', row.left.oldN)) : null}
                        {row.right !== null && row.right.newN !== null ? under(lineKey('R', row.right.newN)) : null}
                      </Fragment>
                    ))}
              </div>
            ))}
          </>
        ) : (
          <div className="flex flex-col gap-1 px-[18px] py-4 font-sans text-[13px]">
            <p className="text-muted">No diff to show</p>
            {problem === undefined ? null : <p className="text-[12px] text-amber">{problem}</p>}
            <a href={`${prUrl}/files`} target="_blank" rel="noreferrer" className="text-[12px] text-brand hover:underline">
              See it on GitHub
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
