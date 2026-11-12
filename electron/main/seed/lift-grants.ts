import { parseList, patchFrontmatter, readFrontmatter } from '@shared/agent-contract';

/**
 * Scoped rules a bare tool never covers: `matches` lets only a rule naming the merge allow one, so a bare
 * `Bash` beside `Bash(gh pr merge …)` does not make the scoped one redundant (HIVE-409).
 */
const NAMES_THE_MERGE = /^(?:Bash\(gh pr merge |mcp__hive__pr_merge\()/;

/** What `permissions.ts` refuses to write into a list: a forged line, a list closed early, a quote the reread strips. */
const UNWRITABLE = /[\n\r[\]#]|^['"\s]|['"\s]$/;

/**
 * Lift a card's grants out of `tools:` into `grants:`, once (HIVE-409, D4).
 *
 * Before `grants:` existed a card wrote into `tools:`, which made `tools:` the person's, so every later
 * shipped change to it was held back. The shipper still carried nineteen scoped Bash rules PR #250 had
 * removed. The ledger only keeps two days, so which entries a card wrote cannot be read back. This keeps
 * every entry beyond the shipped list as a grant and hands `tools:` back to the seed. A scoped `X(…)` is
 * dropped when a bare `X` is held anyway, unless it names the merge, which no bare rule allows. A `tools:` missing a shipped entry was narrowed on purpose and
 * stays as it is. Either way `grants:` is written, which is what makes this run once.
 *
 * Its own file, not `merge.ts`: that one runs under plain Node in `scripts/shipped-history.ts` and takes
 * no path aliases. Pure; returns `current` unchanged when there is nothing to do, or nothing safe to do.
 */
export function liftGrants(current: string, shipped: string): string {
  const mineFields = readFrontmatter(current)?.fields;
  const shipFields = readFrontmatter(shipped)?.fields;
  if (mineFields === undefined || shipFields === undefined || mineFields.has('grants')) return current;

  const listOf = (fields: typeof mineFields, key: string): string[] | null => {
    const field = fields.get(key);
    return field === undefined ? [] : parseList(field.value);
  };
  const mine = listOf(mineFields, 'tools');
  const ship = listOf(shipFields, 'tools');
  if (mine === null || ship === null) return current;
  if (mine.length === ship.length && mine.every((rule, i) => rule === ship[i])) return current;

  if (ship.some((rule) => !mine.includes(rule))) return patchFrontmatter(current, 'grants', '[]');

  const bare = new Set([...ship, ...mine].filter((rule) => !rule.includes('(')));
  const extra = mine.filter((rule) => {
    if (ship.includes(rule)) return false;
    const open = rule.indexOf('(');
    return open === -1 || NAMES_THE_MERGE.test(rule) || !bare.has(rule.slice(0, open));
  });

  // The same shape check the card's write makes; a file that fails it keeps its tools: and is tried again next seed.
  if ([...ship, ...extra].some((rule) => UNWRITABLE.test(rule))) return current;

  const withTools = patchFrontmatter(current, 'tools', `[${ship.join(', ')}]`);
  return patchFrontmatter(withTools, 'grants', `[${extra.join(', ')}]`);
}
