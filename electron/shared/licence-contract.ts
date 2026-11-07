/**
 * The licence, as main reports it (HIVE-267). Types only: the renderer imports this file type-only.
 * Times are epoch **seconds**, as the lease carries them.
 */
export interface LeaseClaims {
  iss: string;
  sub: string;
  org: string;
  plan: string;
  device: string;
  features: string[];
  /** A missing key means uncapped. */
  limits: Record<string, number>;
  iat: number;
  exp: number;
  jti: string;
  trialEnds?: number;
}

export type LapseReason =
  | 'offline'
  | 'signed_out'
  | 'trial_ended'
  | 'plan_cancelled'
  | 'payment_failed'
  | 'device_revoked'
  | 'seat_removed'
  | 'no_plan'
  | 'unknown';

export interface LicenceTerms {
  plan: string;
  features: string[];
  limits: Record<string, number>;
  exp: number;
  /** Epoch s of the lease's issue: the last successful renewal. */
  iat: number;
  trialEnds?: number;
}

export type LicenceState =
  | { kind: 'unlicensed' }
  | ({ kind: 'licensed' } & LicenceTerms)
  /** The last renewal failed, but the lease is still valid. */
  | ({ kind: 'grace' } & LicenceTerms)
  | {
      kind: 'lapsed';
      reason: LapseReason;
      /** Epoch s of the latest renewal attempt; set for offline only. */
      checkedAt?: number;
    };

/** The sessions and agents a lapse paused (HIVE-265). */
export interface Paused {
  sessions: string[];
  agents: string[];
}
