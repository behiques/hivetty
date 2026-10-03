import { GitPullRequest, Hexagon } from '@phosphor-icons/react';
import { type RefObject, useMemo, useRef, useState } from 'react';

import { addJiraComment } from '@/lib/jira';
import { BRIDGE_ERROR } from '@/lib/utils';

import { SegmentedControl } from '@components/ui/segmented-control';
import { AdfBlocks } from '@features/work/components/adf-blocks';
import { LinesSkeleton, TicketProblem } from '@features/work/components/ticket-page-parts';
import { commentTime } from '@features/work/ticket-presentation';
import type { JiraComment } from '@shared/jira-contract';
import type { LedgerEntry } from '@shared/ledger-contract';
import {
  useAppendTicketComment,
  useLoadTicketDetail,
  useOpenTicket,
  useTicketDetail,
  useTicketEvents,
} from '@stores/hive-store';
import { useSetWorkConversation, useWorkConversation, type WorkConversation } from '@stores/ui-store';

const MODES = [
  { value: 'comments', label: 'Comments' },
  { value: 'everything', label: 'Everything' },
] as const satisfies readonly { value: WorkConversation; label: string }[];

type Item =
  | { kind: 'comment'; at: number; comment: JiraComment }
  | { kind: 'event'; at: number; entry: LedgerEntry };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** `Dana Kim` → `DK`; a one-word name gives its first two letters, `acr` → `AC`. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length >= 2 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? '').slice(0, 2);
  return letters.toUpperCase();
}

const ROW = 'group grid grid-cols-[30px_minmax(0,1fr)] gap-2.5 rounded-lg px-1.5 py-[7px] hover:bg-panel focus-within:bg-panel';
const ACTION = 'text-[12px] text-brand hover:underline';

/**
 * One comment: a face, the author, and a fixed slot that holds the time until
 * the row is hovered or focused, when Reply and Copy link take its place. The
 * slot keeps its width either way, so revealing them never shifts the line.
 */
function CommentItem({
  comment,
  url,
  onReply,
}: {
  comment: JiraComment;
  url: string | undefined;
  onReply: (author: string) => void;
}) {
  const copy = () => {
    if (url === undefined) return;
    void navigator.clipboard.writeText(`${url}?focusedCommentId=${comment.id}`);
  };

  return (
    <li className={ROW}>
      <span
        aria-hidden
        className="grid size-[26px] place-items-center rounded-full bg-panel-2 text-[10px] font-semibold text-ink"
      >
        {initials(comment.author)}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-baseline gap-2 text-[12.5px]">
          <span className="font-medium text-ink">{comment.author}</span>
          <span className="flex-1" />
          <span className="relative w-[120px] shrink-0 text-right">
            <time
              dateTime={comment.created}
              className="font-mono text-[11px] text-subtle group-focus-within:invisible group-hover:invisible"
            >
              {commentTime(comment.created)}
            </time>
            <span className="invisible absolute inset-0 flex justify-end gap-3 group-focus-within:visible group-hover:visible">
              <button type="button" className={ACTION} onClick={() => onReply(comment.author)}>
                Reply
              </button>
              <button type="button" className={ACTION} onClick={copy}>
                Copy link
              </button>
            </span>
          </span>
        </div>
        <div className="text-[13px]">
          <AdfBlocks blocks={comment.body} />
        </div>
      </div>
    </li>
  );
}

/** One ledger event: a glyph and one line, `<from> <the body's first line>`. No actions. */
function EventItem({ entry }: { entry: LedgerEntry }) {
  const pr = entry.meta?.['pr'] !== undefined;
  const Glyph = pr ? GitPullRequest : Hexagon;

  return (
    <li className="grid grid-cols-[30px_minmax(0,1fr)] items-center gap-2.5 px-1.5 py-1 text-[12px] text-muted">
      <span data-glyph={pr ? 'pr' : 'session'} className="grid place-items-center text-subtle">
        <Glyph size={13} aria-hidden />
      </span>
      <span className="min-w-0 truncate">
        <span className="text-ink">{entry.from}</span> {entry.body.split('\n')[0]}
      </span>
    </li>
  );
}

/**
 * Comment on Jira from the page (HIVE-203). The post logic is the card
 * conversation's: the trimmed markdown goes to main, and the comment Jira
 * answers with is shown at once rather than re-reading the thread. A refusal
 * keeps the draft, with Jira's own words, in amber.
 */
function ReplyBox({
  ticketKey,
  replyTo,
  onForget,
  box,
}: {
  ticketKey: string;
  /** The author Reply was pressed on; only the placeholder says so. */
  replyTo: string | null;
  onForget: () => void;
  box: RefObject<HTMLTextAreaElement | null>;
}) {
  const append = useAppendTicketComment();
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [problem, setProblem] = useState<string[] | null>(null);

  const post = () => {
    const markdown = draft.trim();
    if (markdown === '') return;

    setPosting(true);
    setProblem(null);
    void addJiraComment({ key: ticketKey, markdown }).then((result) => {
      setPosting(false);
      if (result === null) return setProblem([BRIDGE_ERROR]);
      if (!result.ok) return setProblem([result.error.message, ...(result.error.details ?? [])]);
      setDraft('');
      onForget();
      append(ticketKey, result.value);
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-soft bg-panel p-3">
      <textarea
        ref={box}
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && draft === '') onForget();
        }}
        aria-label={`Comment on ${ticketKey}`}
        placeholder={replyTo === null ? 'Add a comment — markdown works' : `Reply to ${replyTo}…`}
        className="resize-y bg-transparent text-[13px] text-ink outline-none placeholder:text-subtle"
      />
      <div className="flex items-center gap-2 text-[12px]">
        <span className="rounded-md border border-border-soft px-2 py-0.5 text-ink">Comment on Jira</span>
        <span className="text-muted">everyone on the ticket sees it</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={post}
          disabled={posting || draft.trim() === ''}
          className="rounded-md bg-brand-fill px-3 py-1 text-ink hover:bg-brand-fill-hover disabled:cursor-not-allowed disabled:text-subtle disabled:hover:bg-brand-fill"
        >
          {posting ? 'Posting…' : 'Comment'}
        </button>
      </div>
      {problem?.map((line) => (
        <p key={line} className="text-[12px] text-amber">
          {line}
        </p>
      ))}
    </div>
  );
}

/**
 * The ticket page's conversation (HIVE-203): Jira's comments, newest
 * `JIRA_MAX_COMMENTS` oldest-first, and — on Everything — the ledger's events
 * for the ticket interleaved with them by time.
 */
export function TicketPageConversation({ ticketKey }: { ticketKey: string }) {
  const detail = useTicketDetail();
  const events = useTicketEvents(ticketKey);
  const ticket = useOpenTicket(ticketKey);
  const mode = useWorkConversation();
  const setMode = useSetWorkConversation();
  const load = useLoadTicketDetail();
  const mine = detail?.key === ticketKey ? detail : null;
  const comments = mine?.comments;
  const total = mine?.total ?? comments?.length ?? 0;
  const problem = mine?.problems.comments;
  const retry = () => void load(ticketKey);
  const box = useRef<HTMLTextAreaElement>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const reply = (author: string) => {
    setReplyTo(author);
    box.current?.focus();
  };

  const items = useMemo<Item[]>(() => {
    const said: Item[] = (comments ?? []).map((comment) => ({
      kind: 'comment',
      at: Date.parse(comment.created),
      comment,
    }));
    if (mode === 'comments') return said;
    const done: Item[] = events.map((entry) => ({ kind: 'event', at: entry.ts, entry }));
    return [...said, ...done].sort((a, b) => a.at - b.at);
  }, [comments, events, mode]);

  return (
    <section aria-labelledby={`${ticketKey}-conversation`} className="mt-7 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 id={`${ticketKey}-conversation`} className="text-[14px] font-semibold text-ink">
          Conversation
        </h2>
        <span className="text-[12px] text-muted">
          {plural(total, 'comment', 'comments')} · {plural(events.length, 'event', 'events')}
        </span>
        <span className="flex-1" />
        <SegmentedControl label="Show" options={MODES} value={mode} onChange={setMode} />
      </div>

      {comments === undefined ? (
        problem === undefined ? (
          <LinesSkeleton label="Loading conversation" />
        ) : (
          <TicketProblem message={problem} onRetry={retry} />
        )
      ) : (
        <>
          {total > comments.length ? (
            <p className="text-[12px] text-subtle">
              {`Showing the latest ${comments.length} of ${total}`}
              {ticket?.url ? (
                <>
                  {' · '}
                  <a href={ticket.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                    Open in Jira
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          {problem === undefined ? null : (
            <TicketProblem message={problem} onRetry={retry} readAt={mine?.readAt} />
          )}
          {items.length === 0 ? (
            <p className="text-[12px] text-subtle">No comments yet.</p>
          ) : (
            <ul aria-label="Conversation" className="flex flex-col gap-0.5">
              {items.map((item) =>
                item.kind === 'comment' ? (
                  <CommentItem key={`c-${item.comment.id}`} comment={item.comment} url={ticket?.url} onReply={reply} />
                ) : (
                  <EventItem key={`e-${item.entry.id}`} entry={item.entry} />
                ),
              )}
            </ul>
          )}
        </>
      )}

      <ReplyBox ticketKey={ticketKey} replyTo={replyTo} onForget={() => setReplyTo(null)} box={box} />
    </section>
  );
}
