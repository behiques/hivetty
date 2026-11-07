import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'smol-toml';

import type { CodexPluginStatus } from '@shared/cli-contract';

import type { RunVersion } from '../detect';

export const CODEX_PLUGIN_ID = 'hive@hivetty';
const MARKETPLACE = 'hivetty';
const PLUGIN = 'hive';
const TIMEOUT_MS = 30_000;

export interface CodexPluginState {
  /** `[plugins."hive@hivetty"]` exists. */
  installed: boolean;
  /** …and says `enabled = true`. */
  enabled: boolean;
  /** `[marketplaces.hivetty]` exists. */
  marketplace: boolean;
}

/** Read-only (HIVE-372): HiveTTY never writes ~/.codex; Codex's own commands do. A malformed file reads as nothing. */
export function readCodexPluginState(codexHome: string): CodexPluginState {
  try {
    const config = parse(readFileSync(join(codexHome, 'config.toml'), 'utf8')) as {
      plugins?: Record<string, { enabled?: unknown } | undefined>;
      marketplaces?: Record<string, unknown>;
    };
    const plugin = config.plugins?.[CODEX_PLUGIN_ID];
    return {
      installed: plugin !== undefined,
      enabled: plugin?.enabled === true,
      marketplace: config.marketplaces?.[MARKETPLACE] !== undefined,
    };
  } catch {
    return { installed: false, enabled: false, marketplace: false };
  }
}

export interface CodexPluginInstallerDeps {
  run: RunVersion;
  /** The resolved `codex` command, or why it could not be resolved. */
  command: () => { path: string } | { problem: string };
  codexHome: () => string;
  /** The environment Codex runs in. Absent inherits main's. */
  env?: () => NodeJS.ProcessEnv;
  /** The folder and version to install from: the skills runtime's `codexMarketplace()`, redeclared because harness/ may not import skills/. */
  marketplace: () => { dir: string; version: string } | null;
  /** `clis.codex.installSkills === true`. */
  wanted: () => boolean;
}

export interface CodexPluginInstaller {
  /** Run the Codex commands, if any, that bring `~/.codex` in line with the setting. */
  reconcile(): Promise<CodexPluginStatus>;
  /** The last reconcile's answer, waiting for one in flight. */
  status(): Promise<CodexPluginStatus>;
}

/**
 * HIVE-372: the opt-in `hive@hivetty` Codex plugin, installed, updated and removed only through `codex plugin`.
 * Runs nothing when the setting is off and nothing is installed, or when the installed version is current.
 */
export function createCodexPluginInstaller(deps: CodexPluginInstallerDeps): CodexPluginInstaller {
  const once = async (): Promise<CodexPluginStatus> => {
    const home = deps.codexHome();
    const state = readCodexPluginState(home);
    const steps: string[][] = [];
    let installedVersion: string | null = null;
    if (deps.wanted()) {
      const marketplace = deps.marketplace();
      // Task 8: a null marketplace fails
      const { dir, version } = marketplace as { dir: string; version: string };
      // Codex keys its cache by version and prunes the old folder, so the folder is the "current" answer (D2).
      const current = state.installed && existsSync(join(home, 'plugins', 'cache', MARKETPLACE, PLUGIN, version));
      if (!current) steps.push(['plugin', 'marketplace', 'add', dir], ['plugin', 'add', CODEX_PLUGIN_ID]);
      installedVersion = version;
    } else {
      // Plugin first: `marketplace remove` leaves `[plugins."hive@hivetty"]` behind.
      if (state.installed) steps.push(['plugin', 'remove', CODEX_PLUGIN_ID]);
      if (state.marketplace) steps.push(['plugin', 'marketplace', 'remove', MARKETPLACE]);
    }
    if (steps.length > 0) {
      const command = deps.command();
      // Task 8: a command problem fails
      for (const args of steps) {
        await deps.run((command as { path: string }).path, args, TIMEOUT_MS, { env: deps.env?.() });
        // Task 8: a non-zero exit or a timeout fails
      }
    }
    return installedVersion === null ? { state: 'off' } : { state: 'installed', version: installedVersion };
  };
  let last: Promise<CodexPluginStatus> = Promise.resolve({ state: 'off' });
  return {
    reconcile: () => (last = once()),
    status: () => last,
  };
}
