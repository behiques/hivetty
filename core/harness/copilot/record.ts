import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { HarnessRecord } from '../port';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const defaultHome = (): string => process.env['COPILOT_HOME'] ?? join(homedir(), '.copilot');

/**
 * Copilot's record (HIVE-280): a conversation is `$COPILOT_HOME/session-state/<id>/events.jsonl`
 * (FINDINGS P0, P3). Its folder exists from the launch, the file from the first prompt, so a session
 * that never got a prompt has none and restarts fresh.
 */
export function copilotRecord(home: () => string = defaultHome): HarnessRecord {
  const pathUnder = (dir: string, sessionUuid: string): string | null =>
    // Joined into a path: only a uuid gets that far.
    UUID.test(sessionUuid) ? join(dir, 'session-state', sessionUuid, 'events.jsonl') : null;
  return {
    transcriptPath: (_cwd, sessionUuid) => pathUnder(home(), sessionUuid),
    // A headless run's home is app-owned, `COPILOT_HOME` on its env alone (HIVE-404).
    hasTranscript: (_cwd, sessionUuid, stateDir) => {
      const path = pathUnder(stateDir ?? home(), sessionUuid);
      return path !== null && existsSync(path);
    },
    titleOrigin: () => 'unknown',
    nameFromTitle: (title) => title,
  };
}

/**
 * Whether `events.jsonl` lines hold Copilot's `abort` (HIVE-365): an Esc on its prompt, or Esc Esc
 * mid-turn, neither of which fires `agentStop`. "No, and tell Copilot…" writes none: that turn
 * goes on. The substring test only spares a parse of every line; the parse decides.
 */
export const copilotRecordAborted = (lines: readonly string[]): boolean =>
  lines.some((line) => {
    if (!line.includes('"abort"')) return false;
    try {
      return (JSON.parse(line) as { type?: unknown }).type === 'abort';
    } catch {
      return false;
    }
  });
