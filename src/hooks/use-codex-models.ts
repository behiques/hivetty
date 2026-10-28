import { useEffect, useState } from 'react';

import { codexModels } from '@lib/cli-models';
import { CODEX_FALLBACK_MODELS, type CliModel } from '@shared/cli-contract';

/** The Codex models this account has, read once per mount; the static fallback until and unless they arrive. */
export function useCodexModels(): readonly CliModel[] {
  const [live, setLive] = useState<readonly CliModel[] | null>(null);
  useEffect(() => {
    let current = true;
    void codexModels().then((models) => {
      if (current && models !== null && models.length > 0) setLive(models);
    });
    return () => {
      current = false;
    };
  }, []);
  return live ?? CODEX_FALLBACK_MODELS;
}
