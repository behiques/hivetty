import type { CliDetection } from '@shared/cli-contract';
import type { HarnessId } from '@shared/harness-contract';

type Detection = Record<HarnessId, CliDetection>;

/** The read under way, shared by every caller that asks before it lands (the `cli-models.ts` shape). */
let inFlight: Promise<Detection | null> | null = null;
/** The last answer; `undefined` until one has landed. */
let last: Detection | null | undefined;

export const lastCliDetection = (): Detection | null | undefined => last;

/** Who is told when `last` changes (HIVE-376): a rescan from one page must reach Overview and the picker too. */
const listeners = new Set<() => void>();

export function subscribeCliDetection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function land(answer: Detection | null): Detection | null {
  last = answer;
  for (const listener of listeners) listener();
  return answer;
}

/** Test seam. */
export function resetCliDetectionCache(): void {
  inFlight = null;
  last = undefined;
}

/**
 * What main found for each CLI (HIVE-375). No bridge, or a rejected call, answers `null`: every CLI then counts as
 * available (D10).
 */
export function detectClis(): Promise<Detection | null> {
  inFlight ??= read('detect').finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Look again, after an install. */
export const rescanClis = (): Promise<Detection | null> => read('rescan');

async function read(verb: 'detect' | 'rescan'): Promise<Detection | null> {
  const bridge = window.hive;
  if (!bridge) return land(null);
  try {
    return land(await bridge.cli[verb]());
  } catch (cause) {
    console.error(`[hive] cli.${verb} failed:`, cause);
    return land(null);
  }
}
