/**
 * The calls a Copilot session's launch pre-approves (HIVE-368), in both of Copilot's spellings:
 * `allowTool` is what `--allow-tool` takes (`server(tool)`, COPILOT_DENY_PATTERN's shape), and
 * `requested` is the `toolName` its `permissionRequest` hook names. Copilot fires that hook even for an
 * allowed call and only skips drawing the prompt (HIVE-362, FINDINGS P11), so the hook reader drops it
 * by this list rather than raise a card nobody needs to answer.
 */
export const COPILOT_SESSION_PREAPPROVED = [
  { allowTool: 'hive(session_done)', requested: 'hive/session_done' },
] as const;

const REQUESTED: ReadonlySet<string> = new Set(COPILOT_SESSION_PREAPPROVED.map((tool) => tool.requested));

/** Whether a `permissionRequest` names a call the launch already allowed. */
export const copilotPreapproved = (toolName: string | undefined): boolean =>
  toolName !== undefined && REQUESTED.has(toolName);
