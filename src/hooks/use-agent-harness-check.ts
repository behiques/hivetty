import { useEffect, useState } from 'react';

import { checkAgentHarness } from '@/lib/agents';

import type { HarnessVerdict } from '@shared/agent-contract';
import type { HarnessId } from '@shared/harness-contract';

/** How long a draft must be still before main is asked about it: one ask per pause, not per keystroke. */
export const HARNESS_CHECK_DEBOUNCE_MS = 300;

/**
 * Every CLI's verdict on the draft being edited (HIVE-396). `null` until main answers, and for good
 * with no bridge: the form reads it as "every CLI pickable". A draft that cannot be read, or a
 * channel that rejects, keeps the last answer: half a keystroke should not make the dock flicker.
 */
export function useAgentHarnessCheck(source: string): Record<HarnessId, HarnessVerdict> | null {
  const [verdicts, setVerdicts] = useState<Record<HarnessId, HarnessVerdict> | null>(null);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      checkAgentHarness(source).then(
        (result) => {
          if (live && result !== null && 'verdicts' in result) setVerdicts(result.verdicts);
        },
        () => {
          // The last answer stands; the next pause asks again.
        },
      );
    }, HARNESS_CHECK_DEBOUNCE_MS);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [source]);

  return verdicts;
}
