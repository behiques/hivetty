import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { detectClis, lastCliDetection, rescanClis, subscribeCliDetection } from '@lib/cli-detection';

/**
 * The CLIs main found (HIVE-375): the last answer at once, read when there is none. `settled` once any read
 * answered. Every caller reads the one shared answer (HIVE-376), so a rescan started on a CLI's page also reaches
 * Overview and the picker.
 */
export function useCliDetection() {
  const answer = useSyncExternalStore(subscribeCliDetection, lastCliDetection);
  const [rescanning, setRescanning] = useState(false);
  useEffect(() => {
    if (answer === undefined) void detectClis();
  }, [answer]);
  const rescan = useCallback(async () => {
    setRescanning(true);
    await rescanClis();
    setRescanning(false);
  }, []);
  return { detection: answer ?? null, settled: answer !== undefined, rescan, rescanning };
}
