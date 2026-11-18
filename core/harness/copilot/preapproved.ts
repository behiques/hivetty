/**
 * The calls a Copilot session's launch pre-approves (HIVE-368), as `--allow-tool` takes them:
 * `server(tool)`, COPILOT_DENY_PATTERN's shape. Copilot still fires its `permissionRequest` hook for an
 * allowed call but draws no prompt (HIVE-362, FINDINGS P11), and the hook reader raises a card only for a
 * drawn prompt (HIVE-385, P12), so no filter needs this list.
 */
export const COPILOT_SESSION_PREAPPROVED = ['hive(session_done)'] as const;
