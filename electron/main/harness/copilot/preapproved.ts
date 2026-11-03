/**
 * The calls a Copilot session's launch pre-approves (HIVE-368), as `--allow-tool` takes them:
 * `server(tool)`, COPILOT_DENY_PATTERN's shape. Copilot fires its `permissionRequest` hook even for an
 * allowed call and only skips drawing the prompt (HIVE-362, FINDINGS P11), naming it `server/tool`, so
 * the hook reader drops it by this same list rather than raise a card nobody needs to answer. One list,
 * one spelling: a tool approved at launch cannot be missed by the filter (HIVE-383).
 */
export const COPILOT_SESSION_PREAPPROVED = ['hive(session_done)'] as const;

const REQUESTED: ReadonlySet<string> = new Set(
  COPILOT_SESSION_PREAPPROVED.map((allowTool) => allowTool.replace(/^([^(]+)\((.+)\)$/, '$1/$2')),
);

/** Whether a `permissionRequest` names a call the launch already allowed. */
export const copilotPreapproved = (toolName: string | undefined): boolean =>
  toolName !== undefined && REQUESTED.has(toolName);
