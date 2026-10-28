import { useEffect, useState } from 'react';

import { codexModels } from '@lib/cli-models';
import { CODEX_FALLBACK_MODELS, type CliModel } from '@shared/cli-contract';

/**
 * The Codex models this account has, read once each time it is enabled; the static fallback until
 * and unless they arrive. `settled` once the read has answered, whatever it answered, so a caller
 * that starts a session can wait for it. Off Codex, pass `enabled: false` and nothing is read.
 */
export function useCodexModels(enabled = true): { models: readonly CliModel[]; settled: boolean } {
  const [live, setLive] = useState<readonly CliModel[] | null>(null);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void codexModels().then((models) => {
      if (!current) return;
      if (models !== null && models.length > 0) setLive(models);
      setSettled(true);
    });
    return () => {
      current = false;
    };
  }, [enabled]);
  return { models: live ?? CODEX_FALLBACK_MODELS, settled };
}
