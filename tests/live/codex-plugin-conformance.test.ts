// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCodexPluginInstaller, readCodexPluginState } from '../../electron/main/harness/codex/plugin-install';
import { runVersion } from '../../electron/main/harness/detect';
import { writeCodexMarketplace } from '../../electron/main/skills/codex-marketplace';
import { readUserSkills } from '../../electron/main/skills/read';

/**
 * HIVE-372, live: HiveTTY's real skills, rendered as the marketplace, installed by the real installer into a scratch
 * CODEX_HOME through Codex's own commands, listed by `codex debug prompt-input`, then removed. No model call.
 * Opt-in: `pnpm test:codex-plugin`. Skipped when `codex` is absent.
 */
const LIVE = process.env['HIVE_LIVE_CODEX_PLUGIN_PROOF'] === '1';
const READY = LIVE && /^codex-cli /.test(spawnSync('codex', ['--version'], { encoding: 'utf8' }).stdout ?? '');

describe.skipIf(!READY)('codex plugin install, live (HIVE-372)', () => {
  it('installs HiveTTY’s skills as hive:hive-<name>, then removes them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codex-plugin-live-'));
    const home = join(root, 'home');
    // Codex refuses a CODEX_HOME that does not exist; ~/.codex always does.
    mkdirSync(home);
    const env = { ...process.env, CODEX_HOME: home };
    const read = await readUserSkills(resolve('resources/skills'));
    expect(read.skills.length).toBeGreaterThan(0);
    const marketplace = await writeCodexMarketplace(join(root, 'mkt'), read, { version: '0.0.0', doneUrl: null });
    let wanted = true;
    const installer = createCodexPluginInstaller({
      run: runVersion,
      command: () => ({ path: 'codex' }),
      codexHome: () => home,
      env: () => env,
      marketplace: () => marketplace,
      wanted: () => wanted,
    });
    const prompt = () => spawnSync('codex', ['debug', 'prompt-input', 'x'], { encoding: 'utf8', env, cwd: root }).stdout;

    expect(await installer.reconcile()).toEqual({ state: 'installed', version: marketplace.version });
    const listed = prompt();
    for (const skill of [...read.skills.map((s) => s.name), 'done']) expect(listed).toContain(`hive:hive-${skill}:`);
    // Folders keep the source name (skills/done/); only the frontmatter name carries hive-.
    expect(
      readFileSync(join(home, 'plugins', 'cache', 'hivetty', 'hive', marketplace.version, 'skills', 'done', 'SKILL.md'), 'utf8'),
    ).toContain('HIVE_RECEIVER_URL');
    // Current: a second reconcile runs nothing and answers the same.
    expect(await installer.reconcile()).toEqual({ state: 'installed', version: marketplace.version });

    wanted = false;
    expect(await installer.reconcile()).toEqual({ state: 'off' });
    expect(prompt()).not.toContain('hive:hive-');
    expect(readCodexPluginState(home)).toEqual({ installed: false, enabled: false, marketplace: false });
  }, 120_000);
});
