import type { CliModel } from '@shared/cli-contract';

/** The read under way, shared by every caller that asks before it lands: one per project row otherwise. */
let inFlight: Promise<CliModel[] | null> | null = null;

/** The last answer a read gave; `undefined` until one has. */
let last: CliModel[] | null | undefined;

/** The last answer a read gave, so a row that mounts later starts on it without reading again. */
export const lastCodexModels = (): CliModel[] | null | undefined => last;

/**
 * The account's Codex models, as `cli-tokens.ts` reads its verbs: no bridge is the browser demo and
 * answers `null` silently; a rejected call answers `null` too, logged once. Concurrent callers share
 * one read; a later call reads afresh.
 */
export function codexModels(): Promise<CliModel[] | null> {
  inFlight ??= read()
    .then((models) => {
      last = models;
      return models;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function read(): Promise<CliModel[] | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.cli.codexModels();
  } catch (cause) {
    console.error('[hive] cli.codexModels failed:', cause);
    return null;
  }
}
