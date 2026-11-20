import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The swarm's folder (HIVE-448): a hivetty-swarms checkout holding
 * `swarm.json`, `agents/` and `skills/`. `HIVE_SWARM_DIR` names it; without
 * it, the sibling checkout `../hivetty-swarms/dev-squad`. The tests that read
 * the swarm's content skip when it is not there.
 */
export const SWARM_DIR: string =
  process.env['HIVE_SWARM_DIR'] || fileURLToPath(new URL('../../../hivetty-swarms/dev-squad', import.meta.url));

/** Whether `SWARM_DIR` holds a swarm. */
export const HAS_SWARM: boolean = existsSync(join(SWARM_DIR, 'swarm.json'));
