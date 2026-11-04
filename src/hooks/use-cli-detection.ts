import { useCallback, useEffect, useState } from 'react';

import { detectClis, lastCliDetection, rescanClis } from '@lib/cli-detection';

/**
 * The CLIs main found (HIVE-375): the last answer at once, read when there is none. `settled` once any read
 * answered.
 */
export function useCliDetection() {
  const [answer, setAnswer] = useState(lastCliDetection);
  const [rescanning, setRescanning] = useState(false);
  useEffect(() => {
    if (answer !== undefined) return;
    let current = true;
    void detectClis().then((next) => {
      if (current) setAnswer(next);
    });
    return () => {
      current = false;
    };
  }, [answer]);
  const rescan = useCallback(async () => {
    setRescanning(true);
    setAnswer(await rescanClis());
    setRescanning(false);
  }, []);
  return { detection: answer ?? null, settled: answer !== undefined, rescan, rescanning };
}
