import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { HarnessRecord } from '../port';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const defaultHome = (): string => process.env['COPILOT_HOME'] ?? join(homedir(), '.copilot');

/**
 * Copilot's record (HIVE-280): a conversation is `$COPILOT_HOME/session-state/<id>/events.jsonl`
 * (FINDINGS P0, P3). Its folder exists from the launch, the file from the first prompt, so a session
 * that never got a prompt has none and restarts fresh.
 */
export function copilotRecord(home: () => string = defaultHome): HarnessRecord {
  const transcriptPath = (_cwd: string, sessionUuid: string): string | null =>
    // Joined into a path: only a uuid gets that far.
    UUID.test(sessionUuid) ? join(home(), 'session-state', sessionUuid, 'events.jsonl') : null;
  return {
    transcriptPath,
    hasTranscript: (cwd, sessionUuid) => {
      const path = transcriptPath(cwd, sessionUuid);
      return path !== null && existsSync(path);
    },
    titleOrigin: () => 'unknown',
    nameFromTitle: (title) => title,
  };
}
