import type { LicenceState } from '@shared/licence-contract';

/** HIVE-422: plain hivetty-server is part of a plan that carries this feature. `--runner` is HIVE-300's. */
export const EDITION_FEATURE = 'runners.byo';
export const EDITION_REFUSAL = "This edition isn't part of your plan";
export const EDITION_EXIT = 3;

export interface EditionDeps {
  read(): LicenceState;
  /** The features of the lease on disk; a lapsed state carries none of its own. */
  leaseFeatures(): string[] | null;
  subscribe(listener: (state: LicenceState) => void): () => void;
  /** Start serving. Called at most once. */
  start(): void;
  /** Say why and exit. May be called more than once; it must tolerate that. */
  refuse(): void;
}

/**
 * Serve only for a lease whose plan carries `runners.byo`. Returns the unsubscribe.
 *
 * A lapsed state carries no terms, so before the server has started the lease on disk decides; once serving, a lapse
 * never stops it, so its clients see the lapse instead of a dropped connection.
 */
export function gateEdition(deps: EditionDeps): () => void {
  let started = false;
  const check = (state: LicenceState): void => {
    // Never held a lease: serve nothing and wait, as `startWhenLicensed` does.
    if (state.kind === 'unlicensed') return;
    if (state.kind === 'lapsed' && started) return;
    const features = state.kind === 'lapsed' ? (deps.leaseFeatures() ?? []) : state.features;
    if (!features.includes(EDITION_FEATURE)) {
      deps.refuse();
      return;
    }
    if (started) return;
    started = true;
    deps.start();
  };
  check(deps.read());
  return deps.subscribe(check);
}
