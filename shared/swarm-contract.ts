/**
 * The swarm format (HIVE-439): `swarm.json`, what a swarm holds, and the tag rule.
 *
 * hivetty-cloud mirrors these rules by hand in
 * `apps/api/src/module/swarm/domain/swarm-contract.ts` (HIVE-440). The two repos
 * share no package: a rule changed here is changed there in the same week.
 */

export const SWARM_MANIFEST_FILE = 'swarm.json';

export const SWARM_NAME_MAX = 64;
export const SWARM_TITLE_MAX = 64;
export const SWARM_DESCRIPTION_MAX = 280;
export const SWARM_PUBLISHER_MAX = 64;
export const SWARM_TAGS_MAX = 8;
export const SWARM_TAG_MAX = 24;

const SLUG = /^[a-z0-9-]+$/;
const VERSION = /^\d+\.\d+\.\d+$/;
/** The folder is slug segments: `swarm:pull` (HIVE-439 PR 2) joins it onto a path, so no `..`, no `//`, no leading `/`. */
const TAG = /^(?:([a-z0-9-]+(?:\/[a-z0-9-]+)*)\/)?v(\d+\.\d+\.\d+)$/;

export interface SwarmManifest {
  /** The swarm's slug. */
  name: string;
  title: string;
  description: string;
  publisher: string;
  /** `x.y.z`. A release is the Git tag that carries it: see {@link swarmTag}. */
  version: string;
  tags: string[];
  /** The oldest app that can run this swarm, `x.y.z`. */
  minApp?: string;
}

export interface SwarmContents {
  agents: { name: string; description: string; tools: string[] }[];
  skills: { name: string; description: string }[];
}

export interface SwarmProblem {
  /** A manifest field (`version`), an entry (`agents/builder`, `skills/tdd`), or `''` for the whole swarm. */
  field: string;
  reason: string;
  /** Set on the one problem a newer app would clear. */
  code?: 'needs-newer-app';
}

const isSlug = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max && SLUG.test(value);

const isText = (value: unknown, max: number): value is string => {
  if (typeof value !== 'string') return false;
  const { length } = value.trim();
  return length >= 1 && length <= max;
};

const isVersion = (value: unknown): value is string =>
  typeof value === 'string' && VERSION.test(value);

const isTags = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= SWARM_TAGS_MAX &&
  value.every((tag) => isSlug(tag, SWARM_TAG_MAX));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const VERSION_REASON = 'Must be x.y.z, like 1.2.0.';

/** Validate a parsed `swarm.json`. Unknown keys are ignored. */
export function parseSwarmManifest(value: unknown): {
  manifest: SwarmManifest | null;
  problems: SwarmProblem[];
} {
  if (!isRecord(value)) {
    return {
      manifest: null,
      problems: [{ field: '', reason: `${SWARM_MANIFEST_FILE} must hold a JSON object.` }],
    };
  }

  const raw = value;
  const problems: SwarmProblem[] = [];
  const bad = (field: string, reason: string): null => {
    problems.push({ field, reason });
    return null;
  };
  const text = (field: 'title' | 'description' | 'publisher', max: number): string | null => {
    const found = raw[field];
    return isText(found, max) ? found.trim() : bad(field, `Required, 1 to ${String(max)} characters.`);
  };

  const name = isSlug(raw.name, SWARM_NAME_MAX)
    ? raw.name
    : bad('name', `Lowercase letters, digits and hyphens, 1 to ${String(SWARM_NAME_MAX)}.`);
  const title = text('title', SWARM_TITLE_MAX);
  const description = text('description', SWARM_DESCRIPTION_MAX);
  const publisher = text('publisher', SWARM_PUBLISHER_MAX);
  const version = isVersion(raw.version) ? raw.version : bad('version', VERSION_REASON);
  const tags = isTags(raw.tags)
    ? raw.tags
    : bad(
        'tags',
        `A list of up to ${String(SWARM_TAGS_MAX)} tags, each lowercase letters, digits and hyphens, 1 to ${String(SWARM_TAG_MAX)}.`,
      );
  let minApp: string | null | undefined;
  if (raw.minApp !== undefined) minApp = isVersion(raw.minApp) ? raw.minApp : bad('minApp', VERSION_REASON);

  if (
    name === null ||
    title === null ||
    description === null ||
    publisher === null ||
    version === null ||
    tags === null ||
    minApp === null
  ) {
    return { manifest: null, problems };
  }

  return {
    manifest: { name, title, description, publisher, version, tags, ...(minApp === undefined ? {} : { minApp }) },
    problems,
  };
}

/**
 * The tag that releases a version: `v1.2.0` for a repo with one swarm at its
 * root, `standard/v1.2.0` for a repo that holds several by folder.
 */
export function parseSwarmTag(tag: string): { folder: string; version: string } | null {
  const match = TAG.exec(tag);
  if (match?.[2] === undefined) return null;
  return { folder: match[1] ?? '', version: match[2] };
}

export function swarmTag({ folder, version }: { folder: string; version: string }): string {
  return folder === '' ? `v${version}` : `${folder}/v${version}`;
}

/**
 * Negative when `a` is older than `b`, zero when equal, positive when newer.
 *
 * Everything from the first `-` is ignored, so `1.1.0-rc.3` equals `1.1.0`: a
 * release candidate of an app runs a swarm that needs that release.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string): number[] =>
    (version.split('-')[0] ?? '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);

  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }

  return 0;
}

export type SwarmKind = 'native' | 'community' | 'organization';
export type SwarmAccess = 'token' | 'anonymous' | 'user';
export type SwarmPolicy = 'latest' | 'pinned';

/** One row of `GET /api/swarms` (HIVE-440), field for field. */
export interface SwarmEntry {
  id: string;
  slug: string;
  kind: SwarmKind;
  title: string;
  description: string;
  publisher: string;
  tags: string[];
  /** Null for an organization swarm the cloud has not seen a version of. */
  version: string | null;
  updatedAt: string;
  installs: number;
  agents: SwarmContents['agents'];
  skills: SwarmContents['skills'];
  repoUrl: string;
  folder: string;
  commit: string | null;
  access: SwarmAccess;
  policy: SwarmPolicy;
  pinnedVersion: string | null;
  org: { id: string; name: string } | null;
}

export type SwarmFailureCode =
  | 'invalid'
  | 'needs-newer-app'
  | 'collision'
  | 'no_access'
  | 'offline'
  | 'unavailable'
  | 'failed';

export interface SwarmFailure {
  code: SwarmFailureCode;
  /** The sentence a person reads. */
  message: string;
  /** The reader's problems, on `invalid` and `needs-newer-app`. */
  problems?: SwarmProblem[];
}

export interface InstalledSwarm {
  swarmId: string;
  slug: string;
  kind: SwarmKind;
  org: { id: string; name: string } | null;
  repoUrl: string;
  folder: string;
  version: string;
  commit: string;
  /** ISO 8601. */
  installedAt: string;
  autoUpdate: boolean;
  /** Set when a later install of an installed swarm failed (HIVE-442's updates). */
  lastError: SwarmFailure | null;
  title: string;
  contents: SwarmContents;
}

export interface SwarmListItem {
  entry: SwarmEntry | null;
  installed: InstalledSwarm | null;
}

export interface SwarmListing {
  /** `cloud`: fresh. `cache`: the last list, offline. `none`: signed out or never listed. */
  source: 'cloud' | 'cache' | 'none';
  items: SwarmListItem[];
}

export type SwarmInstallResult = { ok: true; installed: InstalledSwarm } | { ok: false; failure: SwarmFailure };
export type SwarmRemoveResult = { ok: true } | { ok: false; failure: SwarmFailure };

export interface SwarmRequest {
  swarmId: string;
}

const SWARM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const FOLDER = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const REPO_URL_MAX = 512;
/** `https://…` and `ssh://…`: the host starts with a letter or digit, and no `?`, `#` or space follows. */
const SCHEME_URL = /^(?:https|ssh):\/\/[A-Za-z0-9][A-Za-z0-9._~/:@%+-]*$/;
/** `git@github.com:acme/tools.git`. */
const SCP_URL = /^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*:[A-Za-z0-9._~/-]+$/;
/** A host, user or path segment that starts with `-` reads as an option to ssh or git. */
const OPTION_SHAPED = /[@:/]-/;

/** A swarm's id is a folder name under `~/.hivetty/swarms`, so it is one path segment. */
export const isSwarmId = (value: unknown): value is string => typeof value === 'string' && SWARM_ID.test(value);

/** Empty for a swarm at its repository's root, else slug segments: the tag rule's folder. */
export const isSwarmFolder = (value: unknown): value is string =>
  typeof value === 'string' && (value === '' || FOLDER.test(value));

/**
 * The only URLs handed to Git. Git also speaks `ext::` (runs a command) and
 * `file://`, and reads a leading `-` as an option; an organization's admin
 * types this URL, so none of those may pass.
 */
export const isSwarmRepoUrl = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= REPO_URL_MAX &&
  (SCHEME_URL.test(value) || SCP_URL.test(value)) &&
  !OPTION_SHAPED.test(value);

const isString = (value: unknown): value is string => typeof value === 'string';
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value);

function agentsOf(value: unknown): SwarmContents['agents'] | null {
  if (!Array.isArray(value)) return null;
  const agents: SwarmContents['agents'] = [];
  for (const row of value) {
    if (!isRecord(row) || !isString(row['name']) || !isString(row['description'])) return null;
    const tools = row['tools'];
    if (!Array.isArray(tools) || !tools.every(isString)) return null;
    agents.push({ name: row['name'], description: row['description'], tools });
  }
  return agents;
}

function skillsOf(value: unknown): SwarmContents['skills'] | null {
  if (!Array.isArray(value)) return null;
  const skills: SwarmContents['skills'] = [];
  for (const row of value) {
    if (!isRecord(row) || !isString(row['name']) || !isString(row['description'])) return null;
    skills.push({ name: row['name'], description: row['description'] });
  }
  return skills;
}

function orgOf(value: unknown): SwarmEntry['org'] | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isString(value['id']) || !isString(value['name'])) return undefined;
  return { id: value['id'], name: value['name'] };
}

/** A registry row, checked field by field at the trust boundary. `null` drops the row. */
export function parseSwarmEntry(row: unknown): SwarmEntry | null {
  if (!isRecord(row)) return null;
  const { id, slug, kind, title, description, publisher, tags, version, updatedAt, installs } = row;
  const { repoUrl, folder, commit, access, policy, pinnedVersion } = row;
  const agents = agentsOf(row['agents']);
  const skills = skillsOf(row['skills']);
  const org = orgOf(row['org']);

  if (!isSwarmId(id) || !isString(slug) || !SLUG.test(slug)) return null;
  if (!oneOf(['native', 'community', 'organization'] as const, kind)) return null;
  if (!isString(title) || !isString(description) || !isString(publisher)) return null;
  if (!Array.isArray(tags) || !tags.every(isString)) return null;
  if (version !== null && !(isString(version) && VERSION.test(version))) return null;
  if (!isString(updatedAt) || typeof installs !== 'number') return null;
  if (agents === null || skills === null || org === undefined) return null;
  if (!isSwarmRepoUrl(repoUrl) || !isSwarmFolder(folder)) return null;
  if (commit !== null && !(isString(commit) && COMMIT.test(commit))) return null;
  if (!oneOf(['token', 'anonymous', 'user'] as const, access)) return null;
  if (!oneOf(['latest', 'pinned'] as const, policy)) return null;
  if (pinnedVersion !== null && !(isString(pinnedVersion) && VERSION.test(pinnedVersion))) return null;

  return {
    id,
    slug,
    kind,
    title,
    description,
    publisher,
    tags,
    version,
    updatedAt,
    installs,
    agents,
    skills,
    repoUrl,
    folder,
    commit,
    access,
    policy,
    pinnedVersion,
    org,
  };
}

/** `swarms:install` and `swarms:remove` carry an id and nothing else. */
export function parseSwarmRequest(payload: unknown): SwarmRequest {
  const swarmId = isRecord(payload) ? payload['swarmId'] : undefined;
  if (!isSwarmId(swarmId)) throw new Error('swarmId is not a swarm id');
  return { swarmId };
}
