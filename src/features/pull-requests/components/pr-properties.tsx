import { ArrowSquareOut, Binoculars, Check, GitMerge, Hexagon, Minus, X } from '@phosphor-icons/react';
import { useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { isSession } from '@/types/entity';
import type { HatcheryRow } from '@/types/pull-request';

import { statusLabel } from '@components/ui/status-dot';
import { Flap } from '@features/pull-requests/components/flap';
import { checkTime } from '@features/pull-requests/session-pr';
import type { PrCheck, PrDetail, PrReview } from '@shared/github-contract';
import type { LedgerResult } from '@shared/ledger-contract';
import { useAnswerAsk, useEntity, useMergeAsk, useOpenEntity, useReviewUrls } from '@stores/hive-store';
import { usePrPageActions } from '@stores/ui-store';

const HEADING = 'flex items-center pt-3 pb-1 text-[10.5px] font-semibold tracking-[0.06em] text-subtle uppercase';
const CHECK_ROW = 'flex items-center gap-[9px] rounded px-1 py-[5px] text-[12.5px]';

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <h2 className={HEADING}>
        {title}
        {aside === undefined ? null : <span className="ml-auto tracking-normal normal-case">{aside}</span>}
      </h2>
      {children}
    </div>
  );
}

function CheckIcon({ status }: { status: PrCheck['status'] }) {
  if (status === 'success') return <Check size={14} data-check="success" aria-hidden className="text-green" />;
  if (status === 'failure') return <X size={14} data-check="failure" aria-hidden className="text-red" />;
  if (status === 'neutral') return <Minus size={14} data-check="neutral" aria-hidden className="text-subtle" />;
  return (
    <span
      data-check={status}
      aria-hidden
      className={cn(
        'mx-px size-3 rounded-full border-2',
        status === 'running' ? 'border-green motion-safe:animate-ccpulse' : 'border-dashed border-subtle',
      )}
    />
  );
}

const VERDICT: Record<string, string> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes requested',
  COMMENTED: 'commented',
  DISMISSED: 'dismissed',
};

/** A pending review has no `submittedAt`; it sorts last, so it is the latest. */
const submitted = (review: PrReview) => (review.submittedAt === null ? Number.MAX_SAFE_INTEGER : Date.parse(review.submittedAt));

/** The latest review per author, then anyone requested who has not reviewed. */
export function reviewers(detail: PrDetail, viaHive: ReadonlySet<string>): { who: string; verdict: string }[] {
  const latest = new Map<string, PrReview>();
  for (const review of [...detail.reviews].sort((a, b) => submitted(a) - submitted(b))) {
    latest.set(viaHive.has(review.url) ? 'acr' : (review.author ?? 'ghost'), review);
  }
  const done = [...latest].map(([who, review]) => ({ who, verdict: VERDICT[review.state] ?? review.state.toLowerCase() }));
  const asked = detail.reviewRequests.filter((who) => !latest.has(who)).map((who) => ({ who, verdict: 'requested' }));
  return [...done, ...asked];
}

/** A check: with `onOpen` a button (the PR page opens its Checks tab, HIVE-206), else a link to its page on GitHub. */
export function CheckRow({ check, onOpen }: { check: PrCheck; onOpen?: (check: PrCheck) => void }) {
  const body = (
    <>
      <CheckIcon status={check.status} />
      <span data-testid="check-name" className="tabular-nums text-ink">{check.name}</span>
      <span className="flex-1" />
      <span className="tabular-nums text-[11.5px] text-muted">{checkTime(check, Date.now())}</span>
    </>
  );
  if (onOpen !== undefined) {
    return (
      <button type="button" onClick={() => onOpen(check)} className={cn(CHECK_ROW, 'w-full text-left hover:bg-hover')}>
        {body}
      </button>
    );
  }
  /* A StatusContext may carry no page; then there is nothing to open. */
  if (check.url === null) return <div className={CHECK_ROW}>{body}</div>;
  return (
    <a href={check.url} target="_blank" rel="noreferrer" className={cn(CHECK_ROW, 'hover:bg-hover')}>
      {body}
    </a>
  );
}

/**
 * The PR page's right column (HIVE-205): status, checks, reviewers, the linked
 * ticket and the actions. A check opens the Checks tab on its job (HIVE-206).
 * A section with nothing to say is left out.
 */
export function PrProperties({
  row,
  detail,
  actions,
}: {
  row: HatcheryRow;
  detail: PrDetail | undefined;
  actions?: ReactNode;
}) {
  const { pr, hatch } = row;
  const { openPrChecks } = usePrPageActions();
  const viaHive = useReviewUrls();
  const entity = useEntity(pr.session ?? '');
  const session = entity !== undefined && isSession(entity) ? entity : null;
  const failing = detail?.checks.filter((check) => check.status === 'failure').length ?? 0;
  const people = detail === undefined ? [] : reviewers(detail, viaHive);

  return (
    <div className="flex flex-col gap-1.5">
      <Section title="Status">
        <div className="flex flex-col items-start gap-1.5 px-1 pt-0.5 pb-1.5 text-[12px]">
          <Flap hatch={hatch} />
          {/* The flap says merged and the time; the line stays when it adds the day, or when there is no time. */}
          {hatch.flap === 'HATCHED' && hatch.at !== undefined && hatch.github === `Merged ${hatch.at}` ? null : (
            <span className="text-muted">{hatch.github}</span>
          )}
        </div>
      </Section>

      {detail !== undefined && detail.checks.length > 0 ? (
        <Section
          title="Checks"
          aside={
            failing > 0 ? (
              <span className="tabular-nums text-[12px] font-semibold text-red">{`${String(failing)} failing`}</span>
            ) : undefined
          }
        >
          {detail.checks.map((check, i) => (
            <CheckRow key={`${check.name}-${String(i)}`} check={check} onOpen={(one) => openPrChecks(one.jobId)} />
          ))}
        </Section>
      ) : null}

      {people.length > 0 ? (
        <Section title="Reviewers">
          {people.map(({ who, verdict }) => (
            <div key={who} className="flex items-baseline gap-2 px-1 py-1 text-[12.5px]">
              <span className="font-semibold text-ink">{who}</span>
              <span className="text-muted">{verdict}</span>
            </div>
          ))}
        </Section>
      ) : null}

      {session !== null ? (
        <Section title="Linked">
          <div className="flex items-baseline gap-2 px-1 py-1 text-[12.5px]">
            {session.ticket === undefined ? null : <span className="tabular-nums text-brand">{session.ticket}</span>}
            <span className="text-muted">{`session ${statusLabel(session.status, session.idleDetail)}`}</span>
          </div>
        </Section>
      ) : null}

      {actions === undefined ? null : <Section title="Actions">{actions}</Section>}
    </div>
  );
}

const ACTION =
  'flex items-center gap-2 px-1 py-1.5 text-left text-[12.5px] text-brand hover:underline disabled:cursor-not-allowed disabled:text-subtle disabled:no-underline';

/**
 * What can be done from the page (HIVE-205, D16). No new `gh` writes: Merge
 * answers the shipper's waiting merge card with the narrowest rung, as the
 * Inbox card's Allow does, and is disabled until there is one; Ready for review
 * on a draft nobody holds opens GitHub; Ask acr is a ledger ask; Open the
 * session needs a live session. A merged PR keeps GitHub alone.
 */
export function PrActions({ row }: { row: HatcheryRow }) {
  const { pr, hatch } = row;
  const slug = `${pr.owner}/${pr.repo}`;
  const card = useMergeAsk(slug, pr.n);
  const answerAsk = useAnswerAsk();
  const openEntity = useOpenEntity();
  const [note, setNote] = useState<{ text: string; tone: 'muted' | 'amber' } | null>(null);
  const [sending, setSending] = useState(false);
  /* A ref as well as the state: two clicks inside one frame both read `sending` false. */
  const inFlight = useRef(false);
  const session = pr.session;

  const github = (
    <a className={ACTION} href={pr.url} target="_blank" rel="noreferrer">
      <ArrowSquareOut size={13} aria-hidden />
      Open on GitHub
    </a>
  );
  if (pr.state === 'merged') return github;

  /**
   * One ledger write at a time, as the Inbox card does: a second click would
   * answer the merge card twice (the ledger refuses the second, which reads as
   * a failure after a merge that worked), and a rejected call is shown as a
   * refusal rather than left unhandled. `undefined` is the browser target: no
   * bridge, nothing written, nothing to say.
   */
  const run = (call: () => Promise<LedgerResult | undefined> | undefined, done?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setNote(null);
    void (async () => {
      try {
        const result = await call();
        if (result === undefined) return;
        if (!result.ok) setNote({ text: result.reason, tone: 'amber' });
        else if (done !== undefined) setNote({ text: done, tone: 'muted' });
      } catch (error) {
        setNote({ text: error instanceof Error ? error.message : String(error), tone: 'amber' });
      } finally {
        inFlight.current = false;
        setSending(false);
      }
    })();
  };

  const merge = () => {
    if (card !== undefined) run(() => answerAsk(card.id, 'allow-once'));
  };

  const askAcr = () =>
    run(
      () =>
        window.hive?.ledger.post({
          to: 'acr',
          kind: 'ask',
          body: `Review ${pr.url} again`,
          meta: { pr: pr.n, repo: slug },
        }),
      'Asked acr',
    );

  return (
    <div className="flex flex-col">
      <button type="button" className={ACTION} disabled={card === undefined || sending} onClick={merge}>
        <GitMerge size={13} aria-hidden />
        Merge
        {card === undefined ? <span className="text-subtle">· after approval</span> : null}
      </button>
      {hatch.flap === 'LARVA' ? (
        <a className={ACTION} href={pr.url} target="_blank" rel="noreferrer">
          <ArrowSquareOut size={13} aria-hidden />
          Ready for review
        </a>
      ) : null}
      <button type="button" className={ACTION} disabled={sending} onClick={askAcr}>
        <Binoculars size={13} aria-hidden />
        Ask acr to look again
      </button>
      {session === null ? null : (
        <button type="button" className={ACTION} onClick={() => openEntity(session)}>
          <Hexagon size={13} aria-hidden />
          Open the session
        </button>
      )}
      {github}
      {note === null ? null : (
        <p className={cn('px-1 pt-1 text-[12px]', note.tone === 'amber' ? 'text-amber' : 'text-muted')}>{note.text}</p>
      )}
    </div>
  );
}
