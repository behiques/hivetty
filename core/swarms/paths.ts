/**
 * Every path under `~/.hivetty/swarms` (HIVE-441).
 *
 * `installed.json` lists the installed swarms, `registry.json` keeps the
 * cloud's last list for offline use, and `askpass.sh` answers Git's prompts
 * for a native fetch. Each swarm gets `<id>/repo` (its clone), `<id>/repo.new`
 * (the clone an install is staging) and `<id>/seed.json` (its seed manifest).
 *
 * The id comes from the cloud and from IPC, so it is checked here, where it
 * becomes a path: a bad id throws before it can name a folder.
 */
import { join } from 'node:path';

import { isSwarmId } from '@shared/swarm-contract';

export const SWARMS_DIR = 'swarms';

export interface SwarmPaths {
  root: string;
  installed: string;
  registry: string;
  askpass: string;
  dir(id: string): string;
  repo(id: string): string;
  staging(id: string): string;
  seed(id: string): string;
}

export function swarmPaths(hiveDir: string): SwarmPaths {
  const root = join(hiveDir, SWARMS_DIR);
  const dir = (id: string): string => {
    if (!isSwarmId(id)) throw new Error('not a swarm id');
    return join(root, id);
  };

  return {
    root,
    installed: join(root, 'installed.json'),
    registry: join(root, 'registry.json'),
    askpass: join(root, 'askpass.sh'),
    dir,
    repo: (id) => join(dir(id), 'repo'),
    staging: (id) => join(dir(id), 'repo.new'),
    seed: (id) => join(dir(id), 'seed.json'),
  };
}
