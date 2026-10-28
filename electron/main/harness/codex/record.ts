import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { HarnessRecord } from '../port';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A braille spinner frame and its space: the title while a turn runs (FINDINGS P7). */
const SPINNER = /^[⠀-⣿] /;
/** The title's lead while an approval waits (FINDINGS P7). */
const ACTION_REQUIRED = '[ ! ] Action Required | ';

/** Codex's home: `$CODEX_HOME`, else `~/.codex`. */
export const codexHome = (): string => process.env.CODEX_HOME ?? join(homedir(), '.codex');

/** A directory's entries, newest-named first; `[]` for one that is not there. */
const entries = (dir: string): string[] => {
  try {
    return readdirSync(dir).sort().reverse();
  } catch {
    return [];
  }
};

/**
 * Codex's title is `<name> | <dir>`, or `<dir>` alone before the thread has a name (FINDINGS P7):
 * the last ` | ` segment is the directory, so a title without one is unnamed.
 */
const nameFromTitle = (title: string): string => {
  const bare = title.replace(SPINNER, '').replace(ACTION_REQUIRED, '');
  const cut = bare.lastIndexOf(' | ');
  return cut === -1 ? '' : bare.slice(0, cut).trim();
};

/**
 * Codex's record (HIVE-279): a conversation is its rollout,
 * `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<session_id>.jsonl` (FINDINGS P6), found by its id
 * whatever the cwd, newest day first. `home` is read on every call, the test seam included.
 */
export function codexRecord(home: () => string = codexHome): HarnessRecord {
  const transcriptPath = (_cwd: string, sessionUuid: string): string | null => {
    // Joined into a filename match: only a uuid gets that far.
    if (!UUID.test(sessionUuid)) return null;
    const suffix = `-${sessionUuid}.jsonl`;
    const sessions = join(home(), 'sessions');
    for (const year of entries(sessions)) {
      for (const month of entries(join(sessions, year))) {
        for (const day of entries(join(sessions, year, month))) {
          const dir = join(sessions, year, month, day);
          const hit = entries(dir).find((name) => name.endsWith(suffix));
          if (hit !== undefined) return join(dir, hit);
        }
      }
    }
    return null;
  };

  return {
    transcriptPath,
    hasTranscript: (cwd, sessionUuid) => transcriptPath(cwd, sessionUuid) !== null,
    // Codex writes no record of who named a thread.
    titleOrigin: () => 'unknown',
    nameFromTitle,
  };
}
