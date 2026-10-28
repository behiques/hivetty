import { useEffect, useState } from 'react';

import { codexModels, lastCodexModels } from '@lib/cli-models';
import { CODEX_FALLBACK_MODELS, type CliModel } from '@shared/cli-contract';

/**
 * The Codex models this account has; the static fallback until and unless they arrive. `settled`
 * once a read has answered, whatever it answered, so a caller that starts a session can wait for it.
 *
 * A mount starts on the last answer any read gave and reads only if there is none, so a project row
 * that appears later costs nothing. `fresh` reads anyway: the picker and Settings, where the user
 * chooses, see the account as it is now. Off Codex, pass `enabled: false` and nothing is read.
 */
export function useCodexModels(
  enabled = true,
  fresh = false,
): { models: readonly CliModel[]; settled: boolean } {
  const [answer, setAnswer] = useState(lastCodexModels);
  useEffect(() => {
    if (!enabled || (!fresh && lastCodexModels() !== undefined)) return;
    let current = true;
    void codexModels().then((models) => {
      if (current) setAnswer(models);
    });
    return () => {
      current = false;
    };
  }, [enabled, fresh]);
  return {
    models: answer !== undefined && answer !== null && answer.length > 0 ? answer : CODEX_FALLBACK_MODELS,
    settled: answer !== undefined,
  };
}
