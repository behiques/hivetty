import { FEATURE_PLANS, PLAN_NAMES, type PlanKey } from './feature-plans';
import type { HarnessId } from './harness-contract';
import type { LicenceState } from './licence-contract';

/**
 * Whether the lease grants a feature, and if not, why (HIVE-268). Pure, so main's `entitled()` and the
 * renderer's `useEntitlement()` give the same reason. Fails closed: no licence, unlicensed and lapsed all deny.
 */
export type Entitlement = { allowed: true } | { allowed: false; reason: string; plan: string | null };

export const FEATURE_LABELS: Readonly<Record<string, string>> = {
  'cli.codex': 'Codex',
  'cli.copilot': 'Copilot',
  'team.ledger': 'Team ledger',
  sync: 'Sync',
  relay: 'Relay',
  'runners.byo': 'Your own runners',
};

/** Where Upgrade and Manage plan land, through `account:open-web`. */
export const UPGRADE_PATH = '/account/plan';

/** `table` is a test seam: no real feature is Enterprise-only today (spec deviation 2). */
export function entitlementOf(
  state: LicenceState | null,
  feature: string,
  table: Readonly<Record<string, PlanKey>> = FEATURE_PLANS,
): Entitlement {
  const label = FEATURE_LABELS[feature] ?? feature;
  const key = table[feature];
  const plan = key ? PLAN_NAMES[key] : null;
  if (state === null || state.kind === 'unlicensed') return { allowed: false, reason: `Sign in to use ${label}`, plan };
  if (state.kind === 'lapsed') return { allowed: false, reason: 'Your licence has lapsed', plan };
  if (state.features.includes(feature)) return { allowed: true };
  if (!key) return { allowed: false, reason: `${label} isn't in your plan`, plan: null };
  if (key === 'enterprise') {
    const reason = state.trialEnds === undefined ? `${label} is in Enterprise` : 'Not in the trial: Enterprise only';
    return { allowed: false, reason, plan };
  }
  return { allowed: false, reason: `${label} is in ${PLAN_NAMES[key]} and above`, plan };
}

/** The lease feature each CLI needs (HIVE-332). Claude Code is every plan's, so it needs none. */
export const CLI_FEATURES: Readonly<Record<HarnessId, string | null>> = {
  'claude-code': null,
  codex: 'cli.codex',
  copilot: 'cli.copilot',
};

/** May this CLI run on this licence? Both processes ask through here, so main and the renderer agree. */
export function cliEntitlementOf(state: LicenceState | null, id: HarnessId): Entitlement {
  const feature = CLI_FEATURES[id];
  return feature === null ? { allowed: true } : entitlementOf(state, feature);
}
