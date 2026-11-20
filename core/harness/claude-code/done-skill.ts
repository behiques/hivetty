import { doneToolSkill } from '../done-tool-skill';

/**
 * The built-in `/done`, owned by the app and rewritten on every launch.
 *
 * ## What it does, and why it cannot do it alone
 *
 * A skill is prompt text. It can make the model reach for tools it already has
 * and nothing else — and **no tool ends an interactive Claude Code session**.
 * Not even Claude Code's own `EndConversation`, which ends the *conversation*
 * and leaves the process running; only its non-interactive branch shuts down.
 * `/exit` is a REPL input-handler built-in, so the model cannot reach that
 * either: it never enters the tool space, and nothing can type into its own
 * stdin.
 *
 * So this skill does the one thing a skill can do — make a request — and the
 * app does the rest. The POST says "this session is finished"; `sessions/index.ts`
 * writes `/exit\r` into the pty at the end of the turn, which is the *only*
 * clean shutdown available and the one `bootstrap.ts`'s `&&` requires: a signal
 * would make `claude` exit non-zero, the `&&` would short-circuit, and the login
 * shell would sit there alive with a dead agent in it.
 *
 * ## Why there is no summary
 *
 * An earlier draft had the agent write one and post it. It was dropped because
 * `/done` has two callers and only one of them can write prose: a user typing it
 * wants the session closed, not narrated, and a skill handing off has already
 * said whatever it had to say. A summary would also make the request's success
 * depend on the model composing something first — turning "close this session"
 * into a generation that can fail, ramble, or be refused.
 *
 * ## Why `disable-model-invocation` is gone
 *
 * It shipped with the inert version, reasoning that "the agent decided we were
 * finished" is not a behaviour anyone asked for. That reasoning was right about
 * the risk and wrong about the cost, because Claude Code enforces the flag
 * exactly as it reads:
 *
 * ```
 * Skill "/done" is user-invocable only (disable-model-invocation)
 * done cannot be used with Skill tool due to disable-model-invocation.
 * Do not replicate this skill's workflow by other means — it is reserved for
 * explicit user invocation.
 * ```
 *
 * The third line is the decisive one: with the flag set, a finishing skill can
 * neither hand off to `/done` **nor** work around it. Handoff is half of what
 * this exists for, so the flag had to go. What replaces it is not a guard but a
 * consequence — the description below says when to use it, and the transcript
 * survives, so a session closed in error costs a reopen rather than the work.
 */

/**
 * The skill, pointed at a receiver that is listening.
 *
 * `doneUrl` is a **liveness signal only**: it chooses between an inert body and a working one,
 * and is never interpolated.
 *
 * The working body is the `session_done` call Codex and Copilot already make (HIVE-368), not the
 * `curl` it was until rc.14. That `curl` read `$HIVE_RECEIVER_URL` and the session's token from
 * the environment, and a repo's own PreToolUse:Bash hook that refuses `curl` with a `$` in it
 * blocked it before `allowed-tools` was consulted, so `/done` failed in that repo. The MCP host
 * makes the same POST from its own process, which no Bash hook sees, and the container set's
 * HTTP server answers the call with the same `/done` handler.
 *
 * `null` writes a body that promises nothing. A built-in whose first act is a failed request is
 * worse than one that is honestly inert.
 */
export const doneSkill = (doneUrl: string | null): string =>
  doneUrl === null ? INERT : doneToolSkill('claude-code');

const frontmatter = `---
name: done
description: >-
  Finish this session — mark it done in HiveTTY and close its terminal. Use it
  when the work a session was opened for is complete, either because the user
  asked to finish or because a skill has finished its task and is handing off.
  Closing is recoverable; the transcript stays readable afterwards.
---
`;

/**
 * What it says when no receiver is listening.
 *
 * Reports the fact rather than failing quietly or pretending. A session whose
 * app cannot hear it is a session the user has to close by hand, and knowing
 * that is the difference between one keystroke and a stare.
 */
const INERT = `${frontmatter}
This session cannot be closed automatically: HiveTTY is not reachable from it,
so there is nowhere to report that the work is finished.

Tell the user exactly that, in one line, and suggest they type \`/exit\` to close
the terminal themselves. Do not run any command.
`;
