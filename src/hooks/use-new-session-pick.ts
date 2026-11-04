import { useCliDetection } from '@hooks/use-cli-detection';
import { useCodexModels } from '@hooks/use-codex-models';
import { useProjectConfig } from '@hooks/use-project-config';
import { cliAvailability, resolveSessionCli } from '@lib/harness/session-cli';
import { CLI_VOCAB } from '@shared/cli-contract';
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
 */
export function useNewSessionPick(fresh = false) {
  const { newCli: picked, newPicks } = useNewSessionDefaults();
  const snapshot = useProjectConfig();
  const { detection, settled: detected } = useCliDetection();
  const availability = cliAvailability(detection, snapshot?.clis ?? null);
  const resolved = resolveSessionCli(picked, snapshot?.sessionsDefaultCli, availability);
  const newCli = resolved ?? 'claude-code';
  const { model: newModel, effort: newEffort } = newPicks[newCli];
  const codex = newCli === 'codex';
  const { models: codexModels, settled } = useCodexModels(codex, fresh);
  const codexPick = codexModels.find((model) => model.slug === newModel) ?? codexModels[0]!;
  const efforts: readonly string[] = codex ? codexPick.efforts : CLI_VOCAB[newCli].efforts;

  return {
    cli: newCli,
    model: codex ? codexPick.slug : newModel,
    effort: codex && !efforts.includes(newEffort) ? codexPick.defaultEffort : newEffort,
    efforts,
    /** The picked Codex model's own default, for the stepper's mark; `undefined` on the other CLIs. */
    defaultEffort: codex ? codexPick.defaultEffort : undefined,
    codexModels,
    /** Whether each CLI may start a session, and why not. */
    availability,
    noneAvailable: resolved === null,
    /** Whether detection has answered: until it has, `noneAvailable` is only the Settings switches' word. */
    detected,
    /** Codex's list, detection, and a CLI to start on: a quick-start waits for all three (HIVE-375). */
    ready: (!codex || settled) && detected && resolved !== null,
  };
}
