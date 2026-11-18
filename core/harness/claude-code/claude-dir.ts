import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where Claude Code keeps its folder: `CLAUDE_CONFIG_DIR` when set, else `~/.claude` (HIVE-422). The one spelling
 * the adapter uses, for plugins, skills, transcripts and titles alike. An explicit `home` (the readers' test seam)
 * still means `<home>/.claude`.
 */
export function claudeDir(home?: string): string {
  if (home !== undefined) return join(home, '.claude');
  return process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude');
}
