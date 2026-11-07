import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { guardSkill } from '@shared/skill-render';

import type { SkillsRead } from './read';
import { renderSkills, writeIfChanged } from './render';

export const CODEX_MARKETPLACE = 'hivetty';
export const CODEX_PLUGIN = 'hive';

export interface CodexMarketplace {
  /** The folder `codex plugin marketplace add` is given. */
  dir: string;
  /** `<app>+<hash8>`: Codex keys its plugin cache by version (probed on 0.167), so a changed skill is a new version. */
  version: string;
}

/** Every file under `root`, as sorted `path\0bytes` records, hashed: the same tree always gives the same version. */
async function hashTree(root: string): Promise<string> {
  const hash = createHash('sha256');
  const walk = async (dir: string): Promise<string[]> =>
    (
      await Promise.all(
        (await readdir(dir, { withFileTypes: true })).map((entry) =>
          entry.isDirectory() ? walk(join(dir, entry.name)) : Promise.resolve([join(dir, entry.name)]),
        ),
      )
    ).flat();
  for (const file of (await walk(root)).sort()) {
    hash.update(relative(root, file)).update('\0').update(await readFile(file)).update('\0');
  }
  return hash.digest('hex').slice(0, 8);
}

/**
 * HIVE-372: HiveTTY's Codex rendering as a local Codex marketplace, for the opt-in `codex plugin add hive@hivetty`.
 * Each SKILL.md is guarded, because an installed plugin also loads in Codex sessions HiveTTY did not start.
 */
export async function writeCodexMarketplace(
  dir: string,
  read: SkillsRead,
  { version, doneUrl }: { version: string; doneUrl: string | null },
): Promise<CodexMarketplace> {
  const plugin = join(dir, 'plugins', CODEX_PLUGIN);
  await renderSkills(plugin, 'codex', read, { version, doneUrl, transform: guardSkill });
  const full = `${version}+${await hashTree(join(plugin, 'skills'))}`;
  await mkdir(join(plugin, '.codex-plugin'), { recursive: true });
  await writeIfChanged(
    join(plugin, '.codex-plugin', 'plugin.json'),
    `${JSON.stringify({ name: CODEX_PLUGIN, version: full, description: "HiveTTY's skills", skills: './skills/' }, null, 2)}\n`,
  );
  await mkdir(join(dir, '.agents', 'plugins'), { recursive: true });
  await writeIfChanged(
    join(dir, '.agents', 'plugins', 'marketplace.json'),
    `${JSON.stringify(
      {
        name: CODEX_MARKETPLACE,
        plugins: [{ name: CODEX_PLUGIN, source: { source: 'local', path: `./plugins/${CODEX_PLUGIN}` } }],
      },
      null,
      2,
    )}\n`,
  );
  return { dir, version: full };
}
