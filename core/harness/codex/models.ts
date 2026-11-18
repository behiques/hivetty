import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { CODEX_EFFORTS, CODEX_MODEL_ID, type CliModel } from '@shared/cli-contract';

import { codexHome } from './record';

const KNOWN_EFFORTS: readonly string[] = CODEX_EFFORTS;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** One cache entry as a picker model, or `null` for one that is hidden, unsafe or has no known effort. */
function toModel(entry: unknown): (CliModel & { priority: number }) | null {
  if (!isObject(entry) || entry.visibility !== 'list') return null;
  if (typeof entry.slug !== 'string' || !CODEX_MODEL_ID.test(entry.slug)) return null;
  const levels: unknown[] = Array.isArray(entry.supported_reasoning_levels) ? entry.supported_reasoning_levels : [];
  const efforts = levels
    .map((level) => (isObject(level) ? level.effort : undefined))
    .filter((effort): effort is string => typeof effort === 'string' && KNOWN_EFFORTS.includes(effort));
  if (efforts.length === 0) return null;
  const preferred = entry.default_reasoning_level;
  return {
    slug: entry.slug,
    description: typeof entry.description === 'string' ? entry.description : '',
    defaultEffort: typeof preferred === 'string' && efforts.includes(preferred) ? preferred : efforts[0]!,
    efforts,
    priority: typeof entry.priority === 'number' ? entry.priority : Number.MAX_SAFE_INTEGER,
  };
}

/**
 * The models this account has, from the `models_cache.json` Codex keeps in its home: the listed
 * entries in Codex's own priority order, each with the efforts it takes. `[]` on any doubt, which
 * sends the picker to `CODEX_FALLBACK_MODELS`. The file is Codex's, so it is read as untrusted.
 */
export async function readCodexModels(home: () => string = codexHome): Promise<CliModel[]> {
  let cache: unknown;
  try {
    cache = JSON.parse(await readFile(join(home(), 'models_cache.json'), 'utf8'));
  } catch {
    return [];
  }
  const entries: unknown[] = isObject(cache) && Array.isArray(cache.models) ? cache.models : [];
  return entries
    .map(toModel)
    .filter((model) => model !== null)
    .sort((a, b) => a.priority - b.priority)
    .map(({ priority: _priority, ...model }) => model);
}
