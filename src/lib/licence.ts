import type { TrialResult } from '@shared/account-contract';
import { PLAN_NAMES, type PlanKey } from '@shared/feature-plans';
import type { LicenceState, Paused } from '@shared/licence-contract';

/**
 * The renderer's door onto the licence (HIVE-267); HIVE-265's gate and HIVE-268's locks use it.
 * The `account.ts` shape: no bridge (the browser target) answers `null`, and a refusal from main is logged
 * and answered `null` rather than thrown into a render.
 */

export async function readLicence(): Promise<LicenceState | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.licence.state();
  } catch (cause) {
    console.error('[hive] reading the licence failed:', cause);
    return null;
  }
}

/** Renews the lease now; resolves to the state after. */
export async function refreshLicence(): Promise<LicenceState | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.licence.refresh();
  } catch (cause) {
    console.error('[hive] renewing the licence failed:', cause);
    return null;
  }
}

/** HIVE-265's Choose a plan: `true` renews every 5 s for up to 15 min, `false` stops. */
export async function watchPurchase(on: boolean): Promise<void> {
  try {
    await window.hive?.licence.watchPurchase(on);
  } catch (cause) {
    console.error('[hive] watching for a purchase failed:', cause);
  }
}

/** HIVE-265: start the account's trial; the licence follows on `licence:changed`. */
export async function startTrial(): Promise<TrialResult | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.licence.startTrial();
  } catch (cause) {
    console.error('[hive] starting the trial failed:', cause);
    return null;
  }
}

/** HIVE-265: the sessions and agents a lapse paused. */
export async function readPaused(): Promise<Paused | null> {
  const bridge = window.hive;
  if (!bridge) return null;
  try {
    return await bridge.licence.paused();
  } catch (cause) {
    console.error('[hive] reading what is paused failed:', cause);
    return null;
  }
}

export function onLicenceChanged(callback: (state: LicenceState) => void): () => void {
  return window.hive?.licence.onChanged(callback) ?? (() => undefined);
}

/** Whole days left in the trial, part days rounded up, floored at 0; `null` with no trial. HIVE-265's account menu reads it too. */
export function trialDaysLeft(state: LicenceState | null, now: number): number | null {
  if (!state || (state.kind !== 'licensed' && state.kind !== 'grace') || state.trialEnds === undefined) return null;
  return Math.max(0, Math.ceil((state.trialEnds * 1000 - now) / 86_400_000));
}

/** "Team trial · 3 days left", or the plan's name; `null` with no live licence. */
export function planLine(state: LicenceState | null, now: number): string | null {
  if (!state || (state.kind !== 'licensed' && state.kind !== 'grace')) return null;
  const name = PLAN_NAMES[state.plan as PlanKey] ?? state.plan;
  const days = trialDaysLeft(state, now);
  return days === null ? name : `${name} trial · ${String(days)} day${days === 1 ? '' : 's'} left`;
}
