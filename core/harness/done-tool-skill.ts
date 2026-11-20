import type { HarnessId } from '@shared/harness-contract';
import { renderSkillText } from '@shared/skill-render';

/** One line, so Codex's catalog can repeat it; Claude's `done-skill.ts` says the same in its own frontmatter. */
export const DONE_DESCRIPTION =
  'Finish this session — mark it done in HiveTTY and close its terminal. Use it when the work a session was opened for is complete, either because the user asked to finish or because a skill has finished its task and is handing off. Closing is recoverable; the transcript stays readable afterwards.';

/**
 * `done` as one hive tool call (HIVE-368), for every CLI. Written with HIVE-369's neutral names and
 * filled per CLI. Not a shell command: a repo's own PreToolUse:Bash hook may refuse a `curl` that
 * reads `$HIVE_RECEIVER_URL`, and an MCP call never passes through Bash. Codex and Copilot
 * pre-approve the tool at launch; Claude reads `allowed-tools` per skill, so its copy carries the
 * grant, scoped to this one tool. An unreachable Hive answers the call with a sentence the model
 * relays.
 */
export function doneToolSkill(cli: HarnessId): string {
  return renderSkillText(
    `---
name: done
description: >-
  ${DONE_DESCRIPTION}
${cli === 'claude-code' ? 'allowed-tools: {{tool:session_done}}\n' : ''}---

Call \`{{tool:session_done}}\`. It tells HiveTTY this session is finished, and the app closes
the terminal itself once the turn ends — you cannot close it yourself, and you do not need to.

Then stop. Do not summarise, do not explain, and do not run anything else.
`,
    cli,
  );
}
