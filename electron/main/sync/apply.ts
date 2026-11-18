import { lstat, mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { parseSyncedAppearance, type SyncedAppearance } from '@shared/sync-contract';

import { readManifest, throughLink, walk } from '../seed/seed';

import { writeKeys } from './allow-lists';
import { safeRel } from './bundle';
import type { MergeResult, View } from './merge';

/** Losing copies live here, beside config.json, one stamped folder per merge that had any. */
export const CONFLICTS_DIR = 'sync-conflicts';
const SETTINGS_FILE = 'settings.json';

const FILE = /^automation:f:(.+)$/s;
const KEY = /^[a-z]+:k:(.+)$/s;
const APPEARANCE = /^workspace:k:appearance\.(.+)$/s;

export interface ApplyDeps {
  hiveDir: string;
  manifestFile: string;
  /** `writeSyncedKeys`: false when the config refused the write. */
  writeConfig(mutate: (draft: Record<string, unknown>) => Record<string, unknown>): boolean;
  /** Puts `<kind>/<name>` back to what this build ships; rejects when this build does not ship it. */
  resetShipped(kind: 'skills' | 'agents', name: string): Promise<void>;
  sendAppearance(fields: SyncedAppearance): void;
  afterSkills(): void;
  afterAgents(): void;
  now(): number;
}

/** Where a synced file may land, or null. Only under skills/ and agents/, and never through a link. */
async function landing(hiveDir: string, rel: string): Promise<string | null> {
  if (!safeRel(rel)) return null;
  const [root, ...rest] = rel.split('/') as [string, ...string[]];
  const top = await lstat(join(hiveDir, root)).catch(() => null);
  if (top !== null && !top.isDirectory()) return null;
  if (await throughLink(join(hiveDir, root), rest.join('/'))) return null;
  const full = resolve(hiveDir, rel);
  return full.startsWith(resolve(hiveDir, root) + sep) ? full : null;
}

/** A dot-led temp file beside the target, then a rename: `collectFiles` never reads a half-written file. */
async function writeAtomic(full: string, bytes: Buffer | string): Promise<void> {
  await mkdir(dirname(full), { recursive: true });
  const tmp = join(dirname(full), `.${basename(full)}.sync.tmp`);
  try {
    await writeFile(tmp, bytes);
    await rename(tmp, full);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/** Removes `dir` while it is empty and is not `stop`, then its parent, and so on up. */
async function pruneEmpty(dir: string, stop: string): Promise<void> {
  let at = dir;
  while (at !== stop && at.startsWith(stop + sep)) {
    const left = await readdir(at).catch(() => null);
    if (left === null || left.length > 0) return;
    await rmdir(at);
    at = dirname(at);
  }
}

const stampOf = (at: number): string => new Date(at).toISOString().replaceAll(':', '-');

/**
 * Copies each losing side into one stamped folder before anything is overwritten. A loser whose hash is already
 * in `kept` was copied by an earlier try of the same merge and is not copied again. Throws when a copy cannot be
 * written, so the caller stops before touching the winner.
 */
async function keepConflicts(deps: ApplyDeps, conflicts: View, kept: Record<string, string>): Promise<Record<string, string>> {
  const next = { ...kept };
  if (Object.entries(conflicts).every(([id, item]) => kept[id] === item.hash)) return next;
  const top = await lstat(join(deps.hiveDir, CONFLICTS_DIR)).catch(() => null);
  if (top !== null && !top.isDirectory()) throw new Error(`${CONFLICTS_DIR} is not a folder; nothing was overwritten`);
  const folder = join(deps.hiveDir, CONFLICTS_DIR, stampOf(deps.now()));
  const settings: Record<string, unknown> = {};
  for (const [id, item] of Object.entries(conflicts)) {
    if (kept[id] === item.hash) continue;
    const rel = FILE.exec(id)?.[1];
    if (rel !== undefined) {
      if (!safeRel(rel) || typeof item.data !== 'string') continue;
      await writeAtomic(join(folder, rel), Buffer.from(item.data, 'base64'));
      next[id] = item.hash;
      continue;
    }
    const path = KEY.exec(id)?.[1];
    if (path === undefined) continue;
    Object.defineProperty(settings, path, { value: item.data, enumerable: true, writable: true, configurable: true });
    next[id] = item.hash;
  }
  if (Object.keys(settings).length > 0) {
    await writeAtomic(join(folder, SETTINGS_FILE), `${JSON.stringify(settings, null, 2)}\n`);
  }
  return next;
}

/**
 * Writes what a merge says must change on this Mac (HIVE-284). Conflict copies first, so nothing is overwritten
 * before its copy exists; then files; then config keys in one validated write; then appearance. A file write
 * that fails throws: what was written stays, the caller does not advance the base, and the next cycle finishes.
 */
export async function applyMerge(
  deps: ApplyDeps,
  result: MergeResult,
  kept: Record<string, string>,
): Promise<{ configOk: boolean; kept: Record<string, string> }> {
  const nextKept = await keepConflicts(deps, result.conflicts, kept);

  const shipped = (await readManifest(deps.manifestFile)).files;
  const touched = new Set<string>();
  const reset = new Set<string>();
  for (const id of result.remove) {
    const rel = FILE.exec(id)?.[1];
    if (rel === undefined) continue;
    const full = await landing(deps.hiveDir, rel);
    if (full === null) continue;
    const [root, name] = rel.split('/') as ['skills' | 'agents', string];
    touched.add(root);
    const folder = `${root}/${name}`;
    if (shipped[rel] !== undefined && reset.has(folder)) continue; // the reset already put it back
    if (shipped[rel] !== undefined) {
      // Another Mac went back to the shipped copy: this one restores its own build's, not nothing.
      const restored = await deps.resetShipped(root, name).then(
        () => true,
        () => false,
      );
      if (restored) {
        reset.add(folder);
        continue;
      }
    }
    await rm(full, { force: true });
    await pruneEmpty(dirname(full), resolve(deps.hiveDir, root));
  }
  // A reset overwrites every shipped file in its folder, so the merged copy of each file there is written back
  // too, not only what changed: "merged files as merged, everything else as shipped".
  const writes: View = { ...result.set };
  for (const [id, item] of Object.entries(result.merged)) {
    const rel = FILE.exec(id)?.[1];
    const folder = rel?.split('/').slice(0, 2).join('/');
    if (folder !== undefined && reset.has(folder) && !Object.hasOwn(writes, id)) writes[id] = item;
  }
  for (const [id, item] of Object.entries(writes)) {
    const rel = FILE.exec(id)?.[1];
    if (rel === undefined || typeof item.data !== 'string') continue;
    const full = await landing(deps.hiveDir, rel);
    if (full === null) continue;
    await writeAtomic(full, Buffer.from(item.data, 'base64'));
    touched.add(rel.split('/')[0] ?? '');
  }

  const appearance: Record<string, unknown> = {};
  const keys: Record<string, unknown> = {};
  const gone: string[] = [];
  for (const [id, item] of Object.entries(result.set)) {
    const field = APPEARANCE.exec(id)?.[1];
    if (field !== undefined) appearance[field] = item.data;
    else if (!FILE.test(id)) keys[id] = item.data;
  }
  for (const id of result.remove) {
    const field = APPEARANCE.exec(id)?.[1];
    if (field !== undefined) appearance[field] = undefined;
    else if (!FILE.test(id)) gone.push(id);
  }
  const configOk =
    Object.keys(keys).length + gone.length === 0 || deps.writeConfig((draft) => writeKeys(draft, keys, gone));
  const fields = parseSyncedAppearance(appearance);
  if (Object.keys(fields).length > 0) deps.sendAppearance(fields);
  if (touched.has('skills')) deps.afterSkills();
  if (touched.has('agents')) deps.afterAgents();
  return { configOk, kept: nextKept };
}

const STAMP = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2}(?:\.\d+)?Z)$/;

/** Entries in one conflicts folder: each file, except `settings.json`, which counts one per key it holds. */
async function entriesOf(folder: string): Promise<string[]> {
  // Finder's `.DS_Store` and the like are not kept copies.
  const files = (await walk(folder)).filter((file) => file.split('/').every((part) => !part.startsWith('.')));
  const entries = files.filter((file) => file !== SETTINGS_FILE);
  if (files.includes(SETTINGS_FILE)) {
    const parsed: unknown = await readFile(join(folder, SETTINGS_FILE), 'utf8')
      .then((text) => JSON.parse(text) as unknown)
      .catch(() => null);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) entries.push(...Object.keys(parsed));
    else entries.push(SETTINGS_FILE);
  }
  return entries;
}

/** How many losing copies are kept, and the newest folder's first one with its time, for the Sync tab. */
export async function conflictsSummary(hiveDir: string): Promise<{ count: number; latest: { path: string; at: number } | null }> {
  const root = join(hiveDir, CONFLICTS_DIR);
  const listing = await readdir(root, { withFileTypes: true }).catch(() => []);
  let count = 0;
  let latest: { path: string; at: number } | null = null;
  for (const entry of listing) {
    if (!entry.isDirectory()) continue;
    const entries = await entriesOf(join(root, entry.name));
    count += entries.length;
    const stamp = STAMP.exec(entry.name);
    const at = stamp === null ? Number.NaN : Date.parse(`${stamp[1] ?? ''}:${stamp[2] ?? ''}:${stamp[3] ?? ''}`);
    const first = entries[0];
    if (Number.isFinite(at) && first !== undefined && (latest === null || at > latest.at)) latest = { path: first, at };
  }
  return { count, latest };
}
