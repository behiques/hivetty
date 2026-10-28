import { useCodexModels } from '@hooks/use-codex-models';
import { CLI_VOCAB } from '@shared/cli-contract';
import { useNewSessionDefaults } from '@stores/ui-store';

/**
 * What a new session starts on: the picker's pick, resolved against the account's Codex models.
 * Shared by the picker and both quick-start buttons, so all three start the same session.
 *
 * A Codex pick the account lacks starts as its first model, and an effort the picked model lacks
 * as that model's default. Both are resolved here, not written back, so switching back finds the
 * pick where it was (HIVE-100's rule). Claude's and Copilot's picks pass through untouched.
 */
export function useNewSessionPick() {
  const { newCli, newModel, newEffort } = useNewSessionDefaults();
  const codexModels = useCodexModels();
  const codexPick = codexModels.find((model) => model.slug === newModel) ?? codexModels[0]!;
  const codex = newCli === 'codex';
  const efforts: readonly string[] = codex ? codexPick.efforts : CLI_VOCAB[newCli].efforts;

  return {
    cli: newCli,
    model: codex ? codexPick.slug : newModel,
    effort: codex && !efforts.includes(newEffort) ? codexPick.defaultEffort : newEffort,
    efforts,
    /** The picked Codex model's own default, for the stepper's mark; `undefined` on the other CLIs. */
    defaultEffort: codex ? codexPick.defaultEffort : undefined,
    codexModels,
  };
}
