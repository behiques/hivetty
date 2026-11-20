import { statSync } from 'node:fs';
import { join } from 'node:path';

import type { ConfigSnapshot } from '@shared/config-contract';
import type { HarnessId } from '@shared/harness-contract';

import { cliEntitled } from '../licence/entitled';

import type { HarnessGate } from './resolve-harness';

/**
 * Each CLI's Headless agents settings (Settings › Harnesses › <CLI>) as HIVE-340's gate (HIVE-341). Reads config per call, never captured, so a card
 * edited in Settings reaches the next wake with no restart. Entitlement is the
 * lease's (HIVE-332), through `licence/entitled.ts`; `entitled` is injected for tests and the e2e gate-off switch.
 */
export function createCliGate(
  read: () => Pick<ConfigSnapshot, 'clis' | 'agentsDefaultCli' | 'projects'>,
  entitled: (id: HarnessId) => string | null = cliEntitled,
): HarnessGate {
  return {
    entitled,
    enabled: (id) => read().clis[id].agents.enabled,
    defaultCli: () => read().agentsDefaultCli,
    defaults: (id) => {
      const { clis, projects } = read();
      const { model, effort, sandbox, deny, network, projectGit } = clis[id].agents;
      return {
        ...(model === undefined ? {} : { model }),
        ...(effort === undefined ? {} : { effort }),
        ...(sandbox === undefined ? {} : { sandbox }),
        ...(deny === undefined ? {} : { deny }),
        ...(network === true ? { network: true } : {}),
        ...(projectGit === true ? { writableRoots: projectGitDirs(projects) } : {}),
      };
    },
  };
}

/**
 * The `.git` folder of each configured project: what a Codex agent may write when the card's
 * `projectGit` is on. Git data only, so the agent can add a worktree under its own folder, commit
 * and fetch, and never the checkout's files.
 */
function projectGitDirs(projects: ConfigSnapshot['projects']): string[] {
  // shortcut: a project whose `.git` is a file (a submodule, a linked worktree) is left out; resolve its common dir if one ever needs an agent.
  return projects
    .flatMap((project) => (project.path === null ? [] : [join(project.path, '.git')]))
    .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true);
}
