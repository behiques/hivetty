import { OVERMIND } from '@shared/ledger-contract';

import type { Ledger } from './index';

/**
 * A session that ends lets go of what it claimed (HIVE-415).
 *
 * Called from the sessions layer's `onEnded` funnel (a PTY exit, a lost PTY,
 * `/done`; never a restart), beside the HIVE-167 redirect of its open asks.
 * Each claim the session still holds gets one `release` written as the
 * overmind, the only party main may write as and the one the party rule lets
 * release a claim it does not hold. The shape matches what an agent run's
 * ending writes (`runs.ts`), with `releasedFrom` naming the session.
 *
 * `claims()` is the dedup: a claim another party has since taken is not this
 * session's, and a second ending finds nothing left to release. A release that
 * fails is logged and the rest still go out; that claim stays held until
 * someone releases it, or the session is resumed and ends again.
 */
export function releaseClaimsOf(ledger: Pick<Ledger, 'read' | 'append'>, entityId: string): void {
  let held: string[];
  try {
    const { claims } = ledger.read({});
    held = Object.keys(claims).filter((task) => claims[task] === entityId);
  } catch (cause) {
    console.warn(`[ledger] could not read claims after ${entityId} ended:`, cause);
    return;
  }

  for (const task of held) {
    const result = ledger.append({
      from: OVERMIND,
      kind: 'release',
      body: `released ${task}: ${entityId} ended`,
      meta: { task, releasedFrom: entityId },
    });
    if (!result.ok) {
      console.warn(`[ledger] could not release ${task} after ${entityId} ended: ${result.reason}`);
    }
  }
}
