import { Circle } from '@phosphor-icons/react';

import type { HiveNotification } from '@/types/notification';

import { waitText } from '@features/home/cell-text';
import { StripHead, StripRow } from '@features/home/components/strip-row';
import { useOnStage } from '@hooks/use-on-stage';
import {
  currentRowFor,
  isAgentId,
  useDisplayName,
  useOpenEntity,
  useSummons,
} from '@stores/hive-store';

export const NEEDS_YOU_MAX = 5;

/** Who asked: the asker named on the row, else the session the row is about. */
const askerOf = (n: HiveNotification): string =>
  n.subject ?? (n.action.type === 'session' ? n.action.entityId : '');

function NeedsYouRow({ notif, now }: { notif: HiveNotification; now: number }) {
  const who = askerOf(notif);
  const name = useDisplayName(who);
  const openEntity = useOpenEntity();
  return (
    <StripRow
      icon={<Circle size={9} weight="fill" className="text-amber" aria-hidden="true" />}
      name={who === '' ? notif.title : name}
      detail={who === '' ? (notif.body.split('\n')[0] ?? '') : notif.title}
      value={waitText(notif.createdAt, now)}
      valueClass="text-amber"
      // Until HIVE-198's drawer: open the asker. HIVE-198 swaps this for its drawer-on-an-ask action.
      onClick={
        who === '' ? undefined : () => openEntity(isAgentId(who) ? who : currentRowFor(who))
      }
    />
  );
}

/** Home's Needs you (HIVE-200): HIVE-214's queue, the pill's count, oldest wait first, at most five rows. */
export function NeedsYou() {
  const { asks, sessions } = useSummons(useOnStage());
  const queue = [...asks, ...sessions].sort((a, b) => a.createdAt - b.createdAt);
  const now = Date.now();
  const more = queue.length - NEEDS_YOU_MAX;
  return (
    <section aria-labelledby="needs-you-head" className="grid min-w-0 content-start gap-px">
      <StripHead>
        <span id="needs-you-head">
          Needs you <b className="font-mono text-[12px] text-amber">{queue.length}</b>
        </span>
      </StripHead>
      {queue.slice(0, NEEDS_YOU_MAX).map((n) => (
        <NeedsYouRow key={n.id} notif={n} now={now} />
      ))}
      {more > 0 && <p className="px-1 py-[5px] text-[12px] text-muted">{more} more in the Inbox ›</p>}
    </section>
  );
}
