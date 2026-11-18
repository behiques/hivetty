import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'smol-toml';

import { codexPluginStateOf } from './plugin-install';

export interface CodexInstructionsInput {
  /** The CLI's plugin folder (`<userData>/hive/plugins/codex`); `undefined` = none written. */
  pluginDir?: string;
  /** Codex's home; read for `config.toml` only when `userConfig` is true. */
  codexHome: string;
  /** A headless definition's instructions. */
  own?: string;
  /** Interactive sessions keep the user's config (D2); headless runs pass --ignore-user-config. */
  userConfig: boolean;
}

const read = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/** The user's `config.toml`, parsed once, or `undefined` when missing or malformed. */
const usersConfig = (codexHome: string): Record<string, unknown> | undefined => {
  const text = read(join(codexHome, 'config.toml'));
  if (text === undefined) return undefined;
  try {
    return parse(text);
  } catch {
    return undefined;
  }
};

/**
 * The `developer_instructions` a Codex session or run starts with (HIVE-360).
 *
 * Codex 0.165 replaces, never appends: a `-c developer_instructions` hides the user's own value
 * (probed 2026-11-02), so the user's top-level key is read here, read-only, and goes first. A
 * profile is a separate `<name>.config.toml` chosen by `--profile`, which HiveTTY never passes.
 * `model_instructions_file` is left alone. Nothing here throws: a malformed config or a missing
 * catalog only drops that part.
 */
export function codexDeveloperInstructions({
  pluginDir,
  codexHome,
  own,
  userConfig,
}: CodexInstructionsInput): string | undefined {
  const config = userConfig ? usersConfig(codexHome) : undefined;
  const usersOwn = config?.['developer_instructions'];
  // HIVE-372: the installed plugin already lists these skills; the block would show each one twice.
  const pluginListsThem = config !== undefined && codexPluginStateOf(config).enabled;
  const parts = [
    typeof usersOwn === 'string' ? usersOwn : undefined,
    own,
    pluginDir === undefined || pluginListsThem ? undefined : read(join(pluginDir, 'catalog.md')),
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => part !== undefined && part !== '');
  return parts.length === 0 ? undefined : parts.join('\n\n');
}
