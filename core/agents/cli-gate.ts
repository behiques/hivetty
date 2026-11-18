import type { ConfigSnapshot } from '@shared/config-contract';
import type { HarnessId } from '@shared/harness-contract';

import { cliEntitled } from '../licence/entitled';

import type { HarnessGate } from './resolve-harness';

/**
 * Each CLI's Headless agents settings (Settings › Harnesses › <CLI>) as HIVE-340's gate (HIVE-341). Reads config per call, never captured, so a card
 * edited in Settings reaches the next wake with no restart. Entitlement is the
 * lease's (HIVE-332), through `licence/entitled.ts`; `entitled` is injected for tests and the e2e gate-off switch.
 */
export function createCliGate(
  read: () => Pick<ConfigSnapshot, 'clis' | 'agentsDefaultCli'>,
  entitled: (id: HarnessId) => string | null = cliEntitled,
): HarnessGate {
  return {
    entitled,
    enabled: (id) => read().clis[id].agents.enabled,
    defaultCli: () => read().agentsDefaultCli,
    defaults: (id) => {
      const { model, effort, sandbox, deny } = read().clis[id].agents;
      return {
        ...(model === undefined ? {} : { model }),
        ...(effort === undefined ? {} : { effort }),
        ...(sandbox === undefined ? {} : { sandbox }),
        ...(deny === undefined ? {} : { deny }),
      };
    },
  };
}
