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
const TAG = /^(?:(.+)\/)?v(\d+\.\d+\.\d+)$/;

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
