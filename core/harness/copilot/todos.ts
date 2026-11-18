import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { PlanTaskStatus } from '@shared/plan-contract';

import { defaultHome, UUID } from './record';

/** Copilot's todo statuses as the plan's (HIVE-361). `blocked` has no plan status: it reads as not started. */
const STATUS: Record<string, PlanTaskStatus> = { pending: 'pending', in_progress: 'in_progress', done: 'completed' };

/**
 * A Copilot session's todo list, whole, from `$COPILOT_HOME/session-state/<id>/session.db` (HIVE-361).
 * Copilot keeps it as a SQL table its `sql` tool writes one statement at a time (FINDINGS P4), and the
 * call has committed by its `postToolUse`, so the table is read rather than the statements parsed.
 * Ordered by `created_at` then `rowid`: ids are free text, and one INSERT stamps every row the same second.
 * `undefined` when there is no list to read: no database, no table, or a read that failed.
 */
export function readCopilotTodos(
  sessionId: string,
  home: () => string = defaultHome,
): { content: string; status: PlanTaskStatus }[] | undefined {
  // Joined into a path: only a uuid gets that far.
  if (!UUID.test(sessionId)) return undefined;
  let db: DatabaseSync | undefined;
  try {
    // Loaded at run time, not imported: Vite's client bundling (the unit suite's happy-dom) refuses `node:sqlite`.
    const { DatabaseSync: Database } = process.getBuiltinModule('node:sqlite');
    db = new Database(join(home(), 'session-state', sessionId, 'session.db'), { readOnly: true });
    const rows = db.prepare('SELECT title, status FROM todos ORDER BY created_at, rowid').all();
    return rows.map((row) => ({ content: String(row['title']), status: STATUS[String(row['status'])] ?? 'pending' }));
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}
