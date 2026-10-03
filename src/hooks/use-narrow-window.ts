import { useSyncExternalStore } from 'react';

/** Under this, round two's session panel stays a strip (HIVE-201; HIVE-211 owns the rest). */
const NARROW = '(max-width: 1199px)';

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(NARROW);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

/** Whether the window is narrower than 1,200px. */
export function useNarrowWindow(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(NARROW).matches);
}
