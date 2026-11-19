import { dirname, join } from 'node:path';

import { configPath } from '../config/paths';
import { platform } from '../platform';

import { SEED_MANIFEST_FILE, SHIPPED_HISTORY_FILE } from './paths';
import { seedShipped, type SeedOptions, type SeedReport } from './seed';

export { keepMine, resetShipped, shippedStatus, takeShippedPrompt } from './actions';

/** Where the shipped tree, `~/.hivetty`, the manifest and the history are. */
export function shippedOptions(source: string = platform().resources): SeedOptions {
  const target = dirname(configPath());

  return {
    source,
    target,
    manifestFile: join(target, SEED_MANIFEST_FILE),
    history: join(source, SHIPPED_HISTORY_FILE),
  };
}

/**
 * Seed the shipped skills and agents into `~/.hivetty` (HIVE-162).
 *
 * The composition: `seed.ts` knows nothing about Electron or where the config
 * lives, and this file knows nothing else. `ipc/index.ts` calls it once, at
 * registration, and hands the promise to the skills runtime so the first
 * plugin regeneration waits for it. The agents registry needs no such hand:
 * it watches its folder, and a definition the seed writes reaches it the way
 * a hand-written one does.
 *
 * `source` is a parameter so a test can name the tree it means; the shell
 * answers it otherwise, as `platform().resources` (HIVE-422).
 *
 * Never fatal. A `~/.hivetty` the app cannot write is a `~/.hivetty` the rest of the
 * app is about to complain about in its own words; a seed that failed costs
 * the shipped skills until the next launch, and says so on the console.
 */
export async function seedShippedIntoHive(
  source?: string,
  exclude?: ReadonlySet<string>,
): Promise<SeedReport | null> {
  // HIVE-441: `exclude` names the folders an installed swarm owns; the shipped tree never writes over them.
  const options = { ...shippedOptions(source), exclude };
  const { target } = options;
  try {
    const report = await seedShipped(options);
    const changed = report.created.length + report.upgraded.length + report.merged.length;
    if (changed > 0 || report.skipped.length > 0) {
      console.info(
        `[hive] seeded ${report.created.length} new, ${report.upgraded.length} updated and ${report.merged.length} merged shipped file(s) into ${target}` +
          (report.skipped.length > 0
            ? `; left alone (symlinked): ${report.skipped.join(', ')}`
            : ''),
      );
    }
    return report;
  } catch (cause) {
    console.info(
      `[hive] the shipped skills and agents could not be seeded into ${target} (${String(cause)})`,
    );
    return null;
  }
}
