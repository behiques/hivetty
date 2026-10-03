import { cn } from '@/lib/utils';

import { Markdown } from '@features/shared/components/markdown';
import type { PrThread } from '@shared/github-contract';

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** The hunk's last lines with the new side's numbers; a removed line has none. */
export function hunkTail(hunk: string, count = 4): { n: number | null; text: string }[] {
  const [header = '', ...lines] = hunk.split('\n');
  let next = Number(HUNK_HEADER.exec(header)?.[1] ?? 0);
  const numbered = lines.map((text) => ({ n: text.startsWith('-') ? null : next++, text }));
  return numbered.slice(-count);
}

function Chip({ thread, fixerOnIt }: { thread: PrThread; fixerOnIt: boolean }) {
  const [text, tone] = thread.isResolved
    ? ['resolved', 'text-green bg-[color-mix(in_srgb,var(--cc-green)_14%,transparent)]']
    : fixerOnIt
      ? ['fixer on it', 'text-amber bg-[color-mix(in_srgb,var(--cc-amber)_14%,transparent)]']
      : ['open', 'text-muted bg-chip'];
  return <span className={cn('rounded-[5px] px-[7px] py-0.5 font-mono text-[10.5px] font-semibold', tone)}>{text}</span>;
}

/**
 * One review thread (HIVE-205): path:line, its state, the hunk's last lines,
 * the comment and the replies. Read-only but for Open the file; Reply and
 * Resolve are HIVE-207's. Shared with HIVE-207's Files tab.
 */
export function ThreadCard({
  thread,
  fixerOnIt,
  onOpenFile,
}: {
  thread: PrThread;
  /** The thread is open and the fixer holds the PR (D12). */
  fixerOnIt: boolean;
  /** Absent when the PR has no session or project to open it in (D19). */
  onOpenFile?: (path: string, line: number) => void;
}) {
  const [first, ...replies] = thread.comments;
  const line = thread.line ?? thread.originalLine;

  return (
    <div className="overflow-hidden rounded-[9px] border border-border-soft bg-panel text-[12.5px]">
      <div className="flex items-center gap-2 border-b border-border-soft px-2.5 py-[7px] text-[12px]">
        <span className="font-mono text-ink">
          <span>{thread.path}</span>
          {line === null ? null : <span className="text-muted">{`:${String(line)}`}</span>}
        </span>
        {thread.isOutdated ? <span className="text-[11px] text-subtle">outdated</span> : null}
        <span className="flex-1" />
        <Chip thread={thread} fixerOnIt={fixerOnIt} />
      </div>
      {first ? (
        <>
          <pre className="overflow-x-auto bg-term-bg px-2.5 py-2 font-mono text-[12px] leading-[1.55] text-muted">
            {hunkTail(first.diffHunk).map((row, i) => (
              <div key={i}>
                <span className="inline-block w-[30px] text-subtle">{row.n ?? ''}</span>
                {row.text}
              </div>
            ))}
          </pre>
          <div className="px-2.5 pt-[9px] pb-1">
            <Markdown source={first.body} />
          </div>
        </>
      ) : null}
      {replies.map((reply) => (
        <div key={reply.url} className="flex gap-2 px-2.5 py-1.5 text-muted">
          <span className="font-semibold text-ink">{reply.author ?? 'ghost'}</span>
          <div className="min-w-0">
            <Markdown source={reply.body} />
          </div>
        </div>
      ))}
      {onOpenFile !== undefined && line !== null ? (
        <div className="px-2.5 pt-1.5 pb-[9px] text-[12px]">
          <button type="button" onClick={() => onOpenFile(thread.path, line)} className="text-brand hover:underline">
            Open the file
          </button>
        </div>
      ) : null}
    </div>
  );
}
