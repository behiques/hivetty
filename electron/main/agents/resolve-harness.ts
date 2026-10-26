import type { AgentDefinition } from '@shared/agent-contract';
import type { HarnessId } from '@shared/harness-contract';

import type { HarnessAdapter } from '../harness/port';

/** The sentinel on a one-shot grant (`@shared/permission-rules`), whose specifier text must never be quoted. */
const LITERAL_PREFIX = 'literal:';

/**
 * What the licence (HIVE-332) and Settings › CLIs (HIVE-341) say about a CLI. Absent until they
 * land: every CLI entitled and enabled, and no Settings default.
 */
export interface HarnessGate {
  /** `null` when the lease allows it, else why not ("not in your plan (Starter or higher)"). */
  entitled(id: HarnessId): string | null;
  /** The per-CLI "Enabled for agents" switch. */
  enabled(id: HarnessId): boolean;
  /** "Default CLI for agents", when the person chose one. */
  defaultCli(): HarnessId | undefined;
}

export interface ResolveDeps {
  adapter(id: HarnessId): HarnessAdapter | undefined;
  /** The binary a run of this CLI spawns, or why there is none. */
  binary(id: HarnessId): { path: string } | { problem: string };
  gate?: HarnessGate;
}

export interface Resolved {
  adapter: HarnessAdapter;
  path: string;
}

type Check<T> = { pass: T } | { fail: string };

/** The first id `check` passes, else every id's reason in order. Generic over the id, so a test needs no real CLI. */
export function firstPassing<Id extends string, T>(
  ids: readonly Id[],
  check: (id: Id) => Check<T>,
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

function check(
  def: AgentDefinition,
  rules: readonly string[],
  deps: ResolveDeps,
  id: HarnessId,
): Check<Resolved> {
  const adapter = deps.adapter(id);

  if (adapter === undefined) return { fail: `${id} has no headless runner in this build` };

  const binary = deps.binary(id);

  if ('problem' in binary) return { fail: `${id} cannot start: ${binary.problem}` };

  const locked = deps.gate?.entitled(id) ?? null;

  if (locked !== null) return { fail: `${id} is ${locked}` };

  if (deps.gate !== undefined && !deps.gate.enabled(id)) {
    return { fail: `${id} is turned off for agents in Settings › CLIs` };
  }

  /*
    The fence (HIVE-339), asked about exactly what `HIVE_GRANTS` carries. A rule this CLI cannot
    enforce skips it: running with the rule dropped would leave the call it fenced unfenced.
  */
  const fence = adapter.headless.fence.express(rules);

  if (!fence.ok) {
    return { fail: `${id} cannot enforce ${[...new Set(fence.unexpressible.map(toolOf))].join(', ')}` };
  }

  const caps = adapter.capabilities;

  // A ceiling on a meter the CLI never reports would silently never trip.
  if ((def.limits.budgetUsd !== undefined || def.limits.dailyUsd !== undefined) && !caps.reportsCostUsd) {
    return { fail: `${id} does not report cost in USD, which ${def.name}'s budget limit needs` };
  }

  const unserved = def.mcp.filter((integration) => !caps.agentMcp.includes(integration));

  if (unserved.length > 0) return { fail: `${id} cannot serve the ${unserved.join(', ')} integration` };

  return { pass: { adapter, path: binary.path } };
}

/**
 * Which CLI runs this wake (HIVE-340): the definition's `harness:` list, else the Settings
 * default, else `claude-code`, taking the first that passes every check. Called once per wake,
 * so a lapse moves the next wake and never a live run.
 */
export function resolveHarness(
  def: AgentDefinition,
  rules: readonly string[],
  deps: ResolveDeps,
): Resolved | { problem: string } {
  const fallback = deps.gate?.defaultCli();
  const candidates: readonly HarnessId[] =
    def.harness ?? (fallback === undefined ? ['claude-code'] : [fallback]);
  const result = firstPassing(candidates, (id) => check(def, rules, deps, id));

  return 'pass' in result
    ? result.pass
    : { problem: `No CLI can run ${def.name}: ${result.fail.join('; ')}.` };
}
