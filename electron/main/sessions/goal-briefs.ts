import { mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * goal-on's briefs, cleared out of a new conversation's way (follow-up to HIVE-370).
 *
 * A brief is named by `$HIVE_SESSION_ID`, and that id is a counter the renderer rebuilds from live
 * rows only, so `sess-07` comes round again after a restart. The verifier ignores a brief bound to
 * another CLI session (`cli_session:`), but an unbound one, left by a session that died before its
 * first turn end, would hold the new `sess-07` for up to its whole turn budget. So a fresh
 * conversation under an id moves any unbound brief that answers to it into `archive/`, matched the
 * way `verify-goal.mjs`'s `resolveBrief` matches: by name, or by the header's `session:`.
 *
 * A bound brief is left where it is: the verifier already skips it, and with two apps sharing the
 * folder (a dev build beside the installed one) it may be the other app's live goal.
 */

/** The verifier's own folder (`briefDir` in `verify-goal.mjs`), not the app's dev-or-not hive dir. */
export const goalsDir = (): string => process.env['HIVE_GOALS_DIR'] || join(homedir(), '.hivetty', 'goals');

/** `sessionIdOf`'s rule: the id becomes a filename. */
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** `cli_session:`'s value, a trailing or comment-only `# …` dropped as the verifier drops it. */
const boundTo = (header: string): string => {
  const raw = /^cli_session:[ \t]*(.*)$/m.exec(header)?.[1] ?? '';
  return raw.replace(/(^|\s+)#.*$/, '').trim().replace(/^["']|["']$/g, '');
};

export function archiveStaleBriefs(sessionId: string, dir: string = goalsDir(), now: Date = new Date()): void {
  if (!SAFE_ID.test(sessionId) || sessionId === '.' || sessionId === '..') return;

  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.md'));
  } catch {
    return; // no goals folder yet
  }

  const byName = new Set([`${sessionId}.md`, `session_${sessionId}.md`]);
  const byHeader = new RegExp(`^session:[ \\t]*["']?${sessionId.replace(/\./g, '\\.')}["']?[ \\t]*$`, 'm');
  const stamp = now.toISOString().replace(/[:.]/g, '-');

  for (const name of names) {
    try {
      const header = FRONTMATTER.exec(readFileSync(join(dir, name), 'utf8'))?.[1];
      if (header === undefined) continue;
      if (!byName.has(name) && !byHeader.test(header)) continue;
      if (boundTo(header) !== '') continue;
      mkdirSync(join(dir, 'archive'), { recursive: true });
      renameSync(join(dir, name), join(dir, 'archive', `${name.slice(0, -'.md'.length)}.${stamp}.md`));
    } catch {
      /* an unreadable neighbour, or a rename that lost a race: never the spawn's problem */
    }
  }
}
