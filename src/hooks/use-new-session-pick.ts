import { useCliDetection } from '@hooks/use-cli-detection';
import { useCodexModels } from '@hooks/use-codex-models';
import { useProjectConfig } from '@hooks/use-project-config';
import { cliAvailability, cliCaption, resolvePick, resolveSessionCli } from '@lib/harness/session-cli';
import { CLI_VOCAB } from '@shared/cli-contract';
import type { HarnessId } from '@shared/harness-contract';
import { useNewSessionDefaults } from '@stores/ui-store';

/**
 * What a new session starts on: the picker's pick, resolved against the account's Codex models.
 * Shared by the picker and both quick-start buttons, so all three start the same session.
 *
 * A Codex pick the account lacks starts as its first model, and an effort the picked model lacks
 * as that model's default. Both are resolved here, not written back, so switching back finds the
 * pick where it was (HIVE-100's rule). Claude's and Copilot's picks pass through untouched, and
 * Codex's list is read only while Codex is the pick. `fresh` is the picker's: it re-reads the list
 * where a quick-start button starts on the last answer.
 *
 * The CLI itself is resolved here too (HIVE-375 D2): the pick this run, else the configured default, else the
 * first CLI that is installed and turned on. With none, `cli` stays claude-code so callers keep their types, and
 * `noneAvailable` says why nothing can start.
 *
 * HIVE-378 puts the project between the two: `projectId` names the project the dock is for, and its `harness`
 * is the next rung after this run's pick. `startFor(id)` resolves one picker row the same way for its own
 * project, so each row starts on its project's CLI. Codex's list is read while any row could start on Codex,
 * so a row click never waits. `caption` says where the dock's choice came from.
 */
export function useNewSessionPick(fresh = false, projectId: string | null = null) {
  const { newCli: picked, newPicks } = useNewSessionDefaults();
  const snapshot = useProjectConfig();
  const { detection, settled: detected } = useCliDetection();
  const clis = snapshot?.clis ?? null;
  const availability = cliAvailability(detection, clis);
  const projects = snapshot?.projects ?? [];
  const choose = (id: string | null) =>
    resolveSessionCli(
      {
        picked,
        project: projects.find((project) => project.id === id)?.harness,
        sessionsDefault: snapshot?.sessionsDefaultCli,
      },
      availability,
    );
  const choice = choose(projectId);
  const newCli = choice.cli ?? 'claude-code';
  // Read Codex's list when the dock is on Codex, or when a row could start on it (HIVE-378).
  const codexInPlay =
    newCli === 'codex' || (picked === null && projects.some((project) => project.harness === 'codex'));
  const { models: codexModels, settled } = useCodexModels(codexInPlay, fresh);

  /** Model and effort for one CLI: this run's pick, else Settings', else built in; Codex checked against the account. */
  const pickFor = (cli: HarnessId) => {
    const { model, effort } = resolvePick(cli, newPicks, clis);
    if (cli !== 'codex') {
      return { model, effort, efforts: CLI_VOCAB[cli].efforts as readonly string[], defaultEffort: undefined };
    }
    const codexPick = codexModels.find((entry) => entry.slug === model) ?? codexModels[0]!;
    return {
      model: codexPick.slug,
      effort: codexPick.efforts.includes(effort) ? effort : codexPick.defaultEffort,
      efforts: codexPick.efforts as readonly string[],
      defaultEffort: codexPick.defaultEffort,
    };
  };
  const pick = pickFor(newCli);
  const codex = newCli === 'codex';

  return {
    cli: newCli,
    model: pick.model,
    effort: pick.effort,
    efforts: pick.efforts,
    /** The picked Codex model's own default, for the stepper's mark; `undefined` on the other CLIs. */
    defaultEffort: pick.defaultEffort,
    codexModels,
    /** Whether each CLI may start a session, and why not. */
    availability,
    /** Where the CLI came from and what was skipped to reach it (HIVE-378). */
    source: choice.source,
    skipped: choice.skipped,
    caption: cliCaption(choice, projects.find((project) => project.id === projectId)?.name),
    /** What one picker row starts on (HIVE-378): the same order, for that row's project. */
    startFor: (id: string) => {
      const row = choose(id);
      const cli = row.cli ?? 'claude-code';
      const { model, effort } = pickFor(cli);
      return { cli, model, effort, source: row.source };
    },
    noneAvailable: choice.cli === null,
    /** Whether detection has answered: until it has, `noneAvailable` is only the Settings switches' word. */
    detected,
    /** Codex's list, detection, and a CLI to start on: a quick-start waits for all three (HIVE-375). */
    ready: (!codex || settled) && detected && choice.cli !== null,
  };
}
