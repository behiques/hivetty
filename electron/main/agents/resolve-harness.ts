import type { AgentDefinition } from '@shared/agent-contract';
import type { HarnessId } from '@shared/harness-contract';

import type { HarnessAdapter } from '../harness/port';

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

function check(
  _def: AgentDefinition,
  _rules: readonly string[],
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
