import type { HarnessId } from '@shared/harness-contract';
import { renderSkillText } from '@shared/skill-render';

/** One line, so Codex's catalog can repeat it; Claude's `done-skill.ts` says the same in its own frontmatter. */
export const DONE_DESCRIPTION =
  'Finish this session — mark it done in HiveTTY and close its terminal. Use it when the work a session was opened for is complete, either because the user asked to finish or because a skill has finished its task and is handing off. Closing is recoverable; the transcript stays readable afterwards.';

/**
 * `done` for a CLI whose shell cannot reach the receiver (HIVE-368): one hive tool call instead of
 * Claude's `curl`. Written with HIVE-369's neutral names and filled per CLI. No `allowed-tools` and
 * no inert variant: the launch pre-approves the tool, and an unreachable Hive answers the call
 * with a sentence the model relays.
 */
export function doneToolSkill(cli: HarnessId): string {
  return renderSkillText(
    `---
name: done
description: >-
  ${DONE_DESCRIPTION}
---

Call \`{{tool:session_done}}\`. It tells HiveTTY this session is finished, and the app closes
the terminal itself once the turn ends — you cannot close it yourself, and you do not need to.

Then stop. Do not summarise, do not explain, and do not run anything else.
`,
    cli,
  );
}
