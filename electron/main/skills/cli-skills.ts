import { HARNESS_IDS, type HarnessId } from '@shared/harness-contract';
import type { CliSkills } from '@shared/skills-contract';

import type { HarnessInstalled } from '../harness/port';

/** Every CLI's own skills, read and never written (HIVE-367). A CLI that fails or has none is left out. */
export async function readCliSkills(installedOf: (id: HarnessId) => HarnessInstalled): Promise<CliSkills> {
  const read = await Promise.all(
    HARNESS_IDS.map(async (cli) => {
      const installed = installedOf(cli);
      const names = await installed.skillNames().catch((): string[] => []);
      return { cli, names: [...new Set(names)].sort(), places: installed.skillPlaces };
    }),
  );
  return read.filter((entry) => entry.names.length > 0);
}
