import type { ConfigSnapshot } from '@shared/config-contract';

import type { HarnessGate } from './resolve-harness';

/**
 * Settings › CLIs as HIVE-340's gate (HIVE-341). Reads config per call, never captured, so a card
 * edited in Settings reaches the next wake with no restart. Entitlement is HIVE-332's: until a
 * lease exists every CLI is allowed.
 */
export function createCliGate(
  read: () => Pick<ConfigSnapshot, 'clis' | 'agentsDefaultCli'>,
): HarnessGate {
  return {
    entitled: () => null,
    enabled: (id) => read().clis[id].agents.enabled,
    defaultCli: () => read().agentsDefaultCli,
    defaults: (id) => {
      const { model, effort, sandbox } = read().clis[id].agents;
      return {
        ...(model === undefined ? {} : { model }),
        ...(effort === undefined ? {} : { effort }),
        ...(sandbox === undefined ? {} : { sandbox }),
      };
    },
  };
}
