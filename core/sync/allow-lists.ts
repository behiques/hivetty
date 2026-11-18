import { SYNC_GROUPS, type SyncGroup } from '@shared/sync-contract';

const CLIS = ['claude-code', 'codex', 'copilot'] as const;
const PER_CLI = ['sessions', 'sessionModel', 'sessionEffort', 'agents.enabled', 'agents.model', 'agents.effort'] as const;

/**
 * What sync may read from and write to config.json, one list per switch (HIVE-284). Anything not here never
 * leaves this Mac and is never written from a bundle. `clis.codex.installSkills` (HIVE-372) and every
 * `skipPermissions` are left out on purpose: each Mac opts into those itself.
 */
export const KEY_PATHS: Record<SyncGroup, readonly string[]> = {
  harnesses: [
    'claudeCommand',
    'clis.codex.command',
    'clis.copilot.command',
    ...CLIS.flatMap((cli) => PER_CLI.map((key) => `clis.${cli}.${key}`)),
    'clis.codex.agents.sandbox',
    'clis.copilot.agents.deny',
    'agentsDefaultCli',
    'sessionsDefaultCli',
  ],
  automation: ['jira.workflow'],
  workspace: ['notifications', 'jira.jql'],
};

/** Every listed id, mapped to its config path. Only these paths are ever walked. */
const LISTED = new Map<string, string>(
  SYNC_GROUPS.flatMap((group) => KEY_PATHS[group].map((path) => [`${group}:k:${path}`, path] as const)),
);

/** The group an id belongs to; throws for an id of no known group. */
export function groupOfId(id: string): SyncGroup {
  const at = id.indexOf(':');
  const group = at < 0 ? '' : id.slice(0, at);
  if (!(SYNC_GROUPS as readonly string[]).includes(group)) throw new Error(`not a sync id: ${id}`);
  return group as SyncGroup;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function get(doc: Record<string, unknown>, path: string): unknown {
  let at: unknown = doc;
  for (const part of path.split('.')) {
    if (!isObject(at) || !Object.hasOwn(at, part)) return undefined;
    at = at[part];
  }
  return at;
}

/** Every listed path that is set, by id. */
export function readKeys(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, path] of LISTED) {
    const value = get(doc, path);
    if (value !== undefined) out[id] = value;
  }
  return out;
}

function put(doc: Record<string, unknown>, parts: readonly string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = parts as [string, ...string[]];
  if (rest.length === 0) return { ...doc, [head]: value };
  const current = Object.hasOwn(doc, head) ? doc[head] : undefined;
  const child = isObject(current) ? current : {};
  return { ...doc, [head]: put(child, rest, value) };
}

function drop(doc: Record<string, unknown>, parts: readonly string[]): Record<string, unknown> {
  const [head, ...rest] = parts as [string, ...string[]];
  if (!Object.hasOwn(doc, head)) return doc;
  if (rest.length === 0) {
    const next = { ...doc };
    delete next[head];
    return next;
  }
  const current = doc[head];
  if (!isObject(current)) return doc;
  const child = drop(current, rest);
  if (child === current) return doc;
  const next = { ...doc };
  if (Object.keys(child).length === 0) delete next[head];
  else next[head] = child;
  return next;
}

/** Sets and removes listed paths only; an id that is not on a list (appearance ids included) is ignored. */
export function writeKeys(
  draft: Record<string, unknown>,
  set: Record<string, unknown>,
  remove: readonly string[],
): Record<string, unknown> {
  let next = draft;
  for (const [id, value] of Object.entries(set)) {
    const path = LISTED.get(id);
    if (path !== undefined) next = put(next, path.split('.'), value);
  }
  for (const id of remove) {
    const path = LISTED.get(id);
    if (path !== undefined) next = drop(next, path.split('.'));
  }
  return next;
}
