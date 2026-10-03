import { cn } from '@/lib/utils';
import { isAgent } from '@/types/entity';

import { STATUS_LABEL } from '@components/ui/status-dot';
import { AgentTile, type TileTone } from '@features/agents/components/agent-tile';
import { useAge } from '@hooks/use-relative-time';
import type { LedgerKind } from '@shared/ledger-contract';
import {
  useAgentLastWord,
  useAgentLiveCount,
  useEntity,
  useOpenEntity,
} from '@stores/hive-store';
import { useAgentPage } from '@stores/ui-store';

interface AgentRowProps {
  id: string;
}

/** Line 2's keyword, in the colour of what the entry was. */
const KEYWORD_TONE: Partial<Record<LedgerKind, string>> = {
  ask: 'text-amber',
  failed: 'text-red',
  event: 'text-brand',
  post: 'text-subtle',
  done: 'text-green',
};

/**
 * One background agent in the panel (HIVE-204): a hexagon tile, the name with
 * the age of its last word, and the last word itself.
 *
 * Renders nothing for an id that is not an agent, matching the session rows —
 * panels stay defensive about a store that other stories mutate underneath
 * them.
 *
 * ## Line 2 is what the agent last said
 *
 * The row used to carry a status word and a detail column (the next wake, the
 * skip count). The lane already says the state, so line 2 now answers the next
 * question, *what is it doing?*, with the agent's newest ledger entry: its kind
 * as a coloured keyword (an ask by its ref, so it can be answered by name) and
 * the entry's first line. A definition that does not parse shows `invalid` and
 * its reason instead, because that is the one thing that helps; a paused agent
 * that has never written says `paused`.
 *
 * ## The state in words
 *
 * The tile is decoration. The accessible name says the state, the live-run
 * count and the last word, so the colour is never the only carrier.
 */
export function AgentRow({ id }: AgentRowProps) {
  const entity = useEntity(id);
  const page = useAgentPage();
  const openEntity = useOpenEntity();
  const live = useAgentLiveCount(id);
  const last = useAgentLastWord(id);
  // `0` when it has never written: a fixed timestamp keeps the ticking clock's
  // effect from re-arming on every render, and the age is not drawn then.
  const age = useAge(last?.ts ?? 0);

  if (!entity || !isAgent(entity)) return null;

  const broken = entity.invalid !== undefined;
  const current = page?.name === id;

  let tone: TileTone = 'resting';
  if (entity.status === 'asking') tone = 'asking';
  else if (entity.status === 'failed') tone = 'failed';
  else if (broken) tone = 'invalid';
  else if (entity.status === 'working') tone = 'working';

  let keyword = '';
  if (broken) keyword = 'invalid';
  else if (last !== undefined) keyword = last.kind === 'ask' && last.ref !== undefined ? `ask ${last.ref}` : last.kind;
  else if (entity.status === 'paused') keyword = 'paused';

  const text = broken ? entity.invalid : (last?.line ?? '');
  const keywordTone =
    broken || last === undefined ? 'text-amber' : (KEYWORD_TONE[last.kind] ?? 'text-subtle');

  const state = broken ? 'invalid' : STATUS_LABEL[entity.status];
  const name =
    [`${id}, ${state}`, live > 1 ? `${String(live)} runs live` : null].filter(Boolean).join(', ') +
    (last === undefined ? '' : `. Last: ${last.kind}, ${last.line}, ${age}`);

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => openEntity(id)}
        aria-current={current ? 'true' : undefined}
        aria-label={name}
        className={cn(
          'flex w-full gap-3 rounded-[10px] p-2 text-left',
          current ? 'bg-panel-2' : 'hover:bg-hover',
        )}
      >
        <AgentTile icon={entity.icon} tone={tone} live={live} />
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="flex items-center gap-2">
            <b className="truncate font-mono text-[14.5px] font-semibold">{id}</b>
            <span className="flex-1" />
            <span className="w-[44px] shrink-0 text-right font-mono text-[11.5px] text-subtle group-focus-within:invisible group-hover:invisible">
              {last === undefined ? '' : age}
            </span>
          </span>
          <span className="truncate text-[12.5px] text-muted">
            {keyword === '' ? null : (
              <i className={cn('mr-1 font-mono text-[12px] not-italic', keywordTone)}>{keyword}</i>
            )}
            {text}
          </span>
        </span>
      </button>
    </div>
  );
}
