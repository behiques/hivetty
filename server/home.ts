import { mkdirSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { join } from 'node:path';

import { CONFIG_PATH_ENV } from '@shared/config-contract';

const blank = (value: string | undefined): boolean => value === undefined || value.trim() === '';

/**
 * HIVE-422: the server's one folder. `HIVETTY_HOME`, else `~/.hivetty`: `config.json` and `goals/` inside it (an
 * explicit `HIVE_CONFIG_PATH` or `HIVE_GOALS_DIR` wins), and `data/` for what the desktop keeps in `userData`.
 * Returns the data folder, created private to its owner. A non-blank `TMPDIR` is created too (HIVE-426): a fresh
 * image volume has no `tmp/`, and the image's entrypoint has no shell step to make it.
 */
export function applyHome(
  env: NodeJS.ProcessEnv,
  homedir: () => string = osHomedir,
  mkdir: (dir: string) => void = (dir) => mkdirSync(dir, { recursive: true, mode: 0o700 }),
): string {
  const root = blank(env.HIVETTY_HOME) ? join(homedir(), '.hivetty') : (env.HIVETTY_HOME as string);
  if (blank(env[CONFIG_PATH_ENV])) env[CONFIG_PATH_ENV] = join(root, 'config.json');
  if (blank(env.HIVE_GOALS_DIR)) env.HIVE_GOALS_DIR = join(root, 'goals');
  const dataDir = join(root, 'data');
  mkdir(dataDir);
  if (!blank(env.TMPDIR)) mkdir(env.TMPDIR as string);
  return dataDir;
}
