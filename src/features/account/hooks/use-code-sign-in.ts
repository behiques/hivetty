import { useCallback, useEffect, useState } from 'react';

import type { CodeFlow } from '@features/account/lib/gate-view';
import { onDeviceCode, signInWithCode } from '@lib/account';

/**
 * A code sign-in, as the gate sees it (HIVE-265 over HIVE-266's flow). Main keeps the state at signing-in with
 * no code, so the renderer remembers that it asked, holds the pushed code, and keeps the failure sentence main
 * returns at the end. Cancelling is not a failure.
 */
export function useCodeSignIn(): CodeFlow & { start: () => void } {
  const [flow, setFlow] = useState<CodeFlow>({ active: false, code: null, error: null });
  useEffect(() => onDeviceCode((code) => setFlow((f) => (f.active ? { ...f, code } : f))), []);
  const start = useCallback(() => {
    setFlow({ active: true, code: null, error: null });
    void signInWithCode().then((result) => {
      const error = result && 'error' in result && result.failure !== 'aborted' ? result.error : null;
      setFlow({ active: false, code: null, error });
    });
  }, []);
  return { ...flow, start };
}
