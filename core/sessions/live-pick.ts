import { CLI_VOCAB, cliAcceptsModel } from '@shared/cli-contract';
import type { HarnessId } from '@shared/harness-contract';
import type { SessionMetrics } from '@shared/metrics-contract';
import { SESSION_MODELS } from '@shared/session-contract';

/**
 * The model and effort a session is running now, as its CLI reported them, in the words a resume can launch with.
 *
 * A `/model` or `/effort` inside the session changes what it runs on without HiveTTY choosing it, so a resume that
 * replayed the spawn's pick would bring it back on the wrong model. Claude reports a display name (`Opus 5.5`), mapped
 * to its alias; Codex and Copilot report the id their flag takes. Anything the CLI's closed list refuses is dropped:
 * these become shell words in the launchers.
 */
export function livePick(harness: HarnessId, metrics: SessionMetrics): { model?: string; effort?: string } {
  const pick: { model?: string; effort?: string } = {};
  const reported = metrics.model;
  if (reported !== undefined) {
    const model =
      harness === 'claude-code'
        ? SESSION_MODELS.find((alias) => reported.toLowerCase().split(/\W+/).includes(alias))
        : reported;
    if (model !== undefined && cliAcceptsModel(harness, model)) pick.model = model;
  }
  if (metrics.effort !== undefined && (CLI_VOCAB[harness].efforts as readonly string[]).includes(metrics.effort)) {
    pick.effort = metrics.effort;
  }
  return pick;
}
