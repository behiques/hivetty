import type { HarnessRecord } from '../port';

import { claudeDir } from './claude-dir';
import { nameFromTitle } from './title';
import { createTitleOriginReader, transcriptPath } from './title-origin';

/**
 * Claude Code's record (HIVE-239): its transcripts under `<Claude's folder>/projects`, and the
 * `custom-title` / `ai-title` lines in them. `home` is the test seam the moved callers
 * already had; without it, `CLAUDE_CONFIG_DIR` or `~/.claude` (HIVE-422).
 */
export function createClaudeRecord(home?: string): HarnessRecord {
  const origins = createTitleOriginReader({ home });
  const root = (): string => claudeDir(home);
  return {
    transcriptPath: (cwd, sessionUuid) => transcriptPath(root(), cwd, sessionUuid),
    hasTranscript: (cwd, sessionUuid) => transcriptPath(root(), cwd, sessionUuid) !== null,
    titleOrigin: (cwd, sessionUuid, name) => origins.classify(cwd, sessionUuid, name),
    nameFromTitle,
  };
}
