/**
 * The agents runtime (HIVE-114).
 *
 * A thin composition root: it binds the registry to the two roots it needs and
 * nothing else. The registry itself takes both as arguments so it stays
 * testable against a temp directory, which is why this file exists rather than
 * `registry.ts` reaching for `agentsRoot()` itself.
 *
 * `skillNames` is a *function*, not a snapshot: skills can be written while
 * the app runs, and an agent naming a skill the user added a minute ago must
 * validate against the folder as it is now, not as it was at boot.
 *
 * It reads HiveTTY's root, and each CLI the agent may run on answers through
 * its adapter's `installed` (HIVE-367). An agent runs the harness's CLI on this machine, which already
 * loads the user's own skills and plugins; validating against `~/.hivetty/skills` alone refused names
 * the agent could reach anyway, and refused every name at all on the fresh
 * install where that folder is empty. `available.ts` carries the argument in
 * full.
 */
import type { HarnessId } from '@shared/harness-contract';

import { adapterFor } from '../harness/registry';
import { readCliSkillNames } from '../skills/available';
import { skillsRoot } from '../skills/paths';

import { agentsRoot } from './paths';
import {
  createAgentRegistry,
  type AgentRegistry,
  type AgentRunFiles,
} from './registry';

interface AgentsRuntimeOptions {
  /**
   * How a delete or a rename reaches the run bookkeeping that is keyed by an
   * agent's name but does not live in its folder (HIVE-115).
   *
   * Passed in rather than built here for the reason this whole file exists: it
   * needs `agents.json`, which only `ipc/index.ts` opens.
   */
  runFiles?: AgentRunFiles;
  /** Settings › Agents' default CLI (HIVE-341): the CLI a definition with no `harness:` runs on, so its skills are the ones checked (HIVE-367). */
  defaultCli?: () => HarnessId | undefined;
}

export function createAgentsRuntime(
  options: AgentsRuntimeOptions = {},
): AgentRegistry {
  return createAgentRegistry({
    root: agentsRoot(),
    // HIVE-345, HIVE-367. The user's skills are each CLI's, so the agent's own CLIs answer them.
    skillNames: (clis) =>
      readCliSkillNames(
        skillsRoot(),
        clis.length > 0 ? clis : [options.defaultCli?.() ?? 'claude-code'],
        (id) => adapterFor(id).installed,
      ),
    ...(options.runFiles === undefined ? {} : { runFiles: options.runFiles }),
  });
}

export type { AgentRegistry, AgentRunFiles } from './registry';
