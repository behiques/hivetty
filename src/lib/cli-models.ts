import type { CliModel } from '@shared/cli-contract';

/**
 * The account's Codex models, as `cli-tokens.ts` reads its verbs: no bridge is the browser demo and
 * answers `null` silently; a rejected call answers `null` too, logged once.
 */
export async function codexModels(): Promise<CliModel[] | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.cli.codexModels();
  } catch (cause) {
    console.error('[hive] cli.codexModels failed:', cause);
    return null;
  }
}
