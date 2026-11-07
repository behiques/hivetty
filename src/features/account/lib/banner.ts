import { trialDaysLeft } from '@lib/licence';
import type { LicenceState } from '@shared/licence-contract';

export type Banner =
  | { kind: 'trial'; threshold: 1 | 3; days: number }
  | { kind: 'offline'; days: number; left: number }
  | null;

const DAY_MS = 86_400_000;
const WARN_DAYS = 3;

/**
 * The warnings before a lapse (HIVE-265): the trial at 3 days and 1 day, and offline 3 days before the lease
 * ends. Offline wins when both apply, and a trial dismissal does not hide it. A dismissal holds until the next
 * threshold.
 */
export function bannerFor(licence: LicenceState | null, now: number, dismissed: 1 | 3 | null): Banner {
  if (licence?.kind === 'grace' && licence.exp * 1000 - now <= WARN_DAYS * DAY_MS) {
    return {
      kind: 'offline',
      days: Math.max(1, Math.floor((now - licence.iat * 1000) / DAY_MS)),
      left: Math.max(0, Math.ceil((licence.exp * 1000 - now) / DAY_MS)),
    };
  }
  const days = trialDaysLeft(licence, now);
  if (days === null || days > WARN_DAYS) return null;
  const threshold = days <= 1 ? 1 : 3;
  if (dismissed !== null && dismissed <= threshold) return null;
  return { kind: 'trial', threshold, days };
}
