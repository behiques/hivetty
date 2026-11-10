import type { AgentDefinition, HarnessFix } from '@shared/agent-contract';
import type { CliAgents } from '@shared/cli-contract';
import type { HarnessId } from '@shared/harness-contract';

import type { HarnessAdapter } from '../harness/port';

/** The sentinel on a one-shot grant (`@shared/permission-rules`), whose specifier text must never be quoted. */
const LITERAL_PREFIX = 'literal:';

/**
 * What the licence (HIVE-332) and Settings › Harnesses › <CLI> (HIVE-341, HIVE-376) say about a CLI. Absent: only
 * Claude Code is entitled (fail closed), every CLI enabled, no Settings default.
 */
export interface HarnessGate {
  /** `null` when the lease allows it, else the sentence a person reads ("Copilot is in Team and above"). */
  entitled(id: HarnessId): string | null;
  /** The per-CLI "Enabled for agents" switch. */
  enabled(id: HarnessId): boolean;
  /** "Default CLI for agents", when the person chose one. */
  defaultCli(): HarnessId | undefined;
  /**
   * The card's model, effort and sandbox for agents on this CLI (HIVE-341, HIVE-342). On Claude,
   * `AGENT.md`'s model and effort win; on another CLI they are not its words, and the card's apply.
   */
  defaults(id: HarnessId): Pick<CliAgents, 'model' | 'effort' | 'sandbox' | 'deny'>;
}

export interface ResolveDeps {
  adapter(id: HarnessId): HarnessAdapter | undefined;
  /** The binary a run of this CLI spawns, or why there is none and what would fix it (HIVE-396). */
  binary(id: HarnessId): { path: string } | { problem: string; fix?: HarnessFix };
  gate?: HarnessGate;
}

export interface Resolved {
  adapter: HarnessAdapter;
  path: string;
}

type Check<T> = { pass: T } | { fail: string; fix?: HarnessFix };

/** The first id `check` passes, else every id's reason in order. Generic over the id, so a test needs no real CLI. */
export function firstPassing<Id extends string, T>(
  ids: readonly Id[],
  check: (id: Id) => { pass: T } | { fail: string },
): { pass: T } | { fail: string[] } {
  const reasons: string[] = [];

  for (const id of ids) {
    const result = check(id);

    if ('pass' in result) return result;

    reasons.push(result.fail);
  }

  return { fail: reasons };
}

/**
 * The tool a rule names, never its argument: an argument can carry a host path or a secret (PR #141).
 * A one-shot grant is `literal:<tool>:<specifier>`, so its tool sits between the first two colons.
 */
const toolOf = (rule: string): string =>
  rule.startsWith(LITERAL_PREFIX)
    ? (rule.slice(LITERAL_PREFIX.length).split(':')[0] ?? rule)
    : (rule.split('(')[0] ?? rule);

/** Whether one CLI can run this definition, and the fix when not (HIVE-396). `resolveHarness` asks it of each candidate; the form asks it of all three. */
export function checkHarness(
  def: AgentDefinition,
  rules: readonly string[],
  deps: ResolveDeps,
  id: HarnessId,
): Check<Resolved> {
  const adapter = deps.adapter(id);

  if (adapter === undefined) return { fail: `${id} has no headless runner in this build` };

  const binary = deps.binary(id);

  if ('problem' in binary) return { fail: `${id} cannot start: ${binary.problem}`, fix: binary.fix ?? 'install' };

  // HIVE-332: fail closed. No gate means no licence was consulted, and only Claude is every plan's.
  const locked =
    deps.gate === undefined ? (id === 'claude-code' ? null : 'not entitled: no licence gate') : deps.gate.entitled(id);

  if (locked !== null) return { fail: `${id}: ${locked}`, fix: 'upgrade' };

  if (deps.gate !== undefined && !deps.gate.enabled(id)) {
    return { fail: `${id} is turned off for agents in Settings › Harnesses`, fix: 'enable' };
  }

  /*
    The fence (HIVE-339), asked about what `HIVE_GRANTS` carries less its own `grants` (HIVE-344),
    which it can express by construction. A rule this CLI cannot
    enforce skips it: running with the rule dropped would leave the call it fenced unfenced.
  */
  const fence = adapter.headless.fence.express(rules);

  if (!fence.ok) {
    return { fail: `${id} cannot enforce ${[...new Set(fence.unexpressible.map(toolOf))].join(', ')}` };
  }

  const caps = adapter.capabilities;

  // A ceiling on a meter the CLI never reports would silently never trip.
  if ((def.limits.budgetUsd !== undefined || def.limits.dailyUsd !== undefined) && !caps.reportsCostUsd) {
    return {
      fail: `${id} does not report cost in USD, which ${def.name}'s budget limit needs`,
      fix: 'remove-budget',
    };
  }

  if (def.limits.dailyTokens !== undefined && !caps.reportsTokens) {
    return { fail: `${id} does not report token usage, which ${def.name}'s daily token cap needs`, fix: 'remove-budget' };
  }

  const unserved = def.mcp.filter((integration) => !caps.agentMcp.includes(integration));

  if (unserved.length > 0) {
    return { fail: `${id} cannot serve the ${unserved.join(', ')} integration`, fix: 'remove-mcp' };
  }

  return { pass: { adapter, path: binary.path } };
}

/** The failures that clear up on their own (HIVE-399): a `wait` agent queues behind these and switches on any other. */
const WAITABLE: ReadonlySet<HarnessFix> = new Set<HarnessFix>(['install', 'sign-in', 'upgrade', 'enable']);

/**
 * Which CLI runs this wake (HIVE-340): the definition's `harness:` list, else the Settings
 * default, else `claude-code`, taking the first that passes every check. Called once per wake,
 * so a lapse moves the next wake and never a live run.
 * With `fallback: wait` and a `held` CLI, see HIVE-399 below.
 */
export function resolveHarness(
  def: AgentDefinition,
  rules: readonly string[],
  deps: ResolveDeps,
  held?: HarnessId,
): Resolved | { problem: string; waitFor?: HarnessId } {
  const defaultCli = deps.gate?.defaultCli();
  const candidates: readonly HarnessId[] =
    def.harness ?? (defaultCli === undefined ? ['claude-code'] : [defaultCli]);

  /*
    HIVE-399. A `wait` agent whose lane holds a conversation on a CLI it still lists keeps that
    conversation: only that CLI is asked, and a failure that clears up on its own queues the wake.
    One the definition itself causes would never clear, so it walks the list as `switch` does.
  */
  if (def.fallback === 'wait' && held !== undefined && candidates.includes(held)) {
    const own = checkHarness(def, rules, deps, held);

    if ('pass' in own) return own.pass;
    if (own.fix !== undefined && WAITABLE.has(own.fix)) return { problem: own.fail, waitFor: held };
  }

  const result = firstPassing(candidates, (id) => checkHarness(def, rules, deps, id));

  return 'pass' in result
    ? result.pass
    : { problem: `No CLI can run ${def.name}: ${result.fail.map((reason) => reason.replace(/\.$/, '')).join('; ')}.` };
}
