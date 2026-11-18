import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';

import { SYNC_GROUPS, type SyncedAppearance, type SyncGroup } from '@shared/sync-contract';

import { readManifest, walk } from '../seed/seed';

import { readKeys } from './allow-lists';
import type { Item, View } from './merge';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const ROOTS = ['skills', 'agents'] as const;
const APPEARANCE_PREFIX = 'workspace:k:appearance.';

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

const sorted = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sorted)
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
        )
      : value;

/** sha256 of the value's JSON with object keys sorted at every depth, so key order never reads as a change. */
export const hashOf = (value: unknown): string => sha256(JSON.stringify(sorted(value)));

/** A relpath a bundle may name: under skills/ or agents/, no empty, dot-led or parent segment, no backslash. */
export function safeRel(rel: string): boolean {
  const parts = rel.split('/');
  return (
    !rel.includes('\\') &&
    parts.length >= 2 &&
    (ROOTS as readonly string[]).includes(parts[0] ?? '') &&
    parts.every((part) => part !== '' && !part.startsWith('.'))
  );
}

type Seen = Record<string, { hash: string; at: number }>;

/**
 * The listed config keys and the reported appearance fields, by id. A key's `at` is when its current value was
 * first seen on this Mac; config keys carry no time on disk, so `seen` is where that time lives.
 */
export function collectKeys(
  doc: Record<string, unknown>,
  appearance: SyncedAppearance | null,
  seen: Seen,
  now: number,
): { view: View; seen: Seen } {
  const values: Record<string, unknown> = readKeys(doc);
  for (const [field, value] of Object.entries(appearance ?? {})) {
    if (value !== undefined) values[`${APPEARANCE_PREFIX}${field}`] = value;
  }
  const view: View = {};
  const nextSeen: Seen = {};
  for (const [id, value] of Object.entries(values)) {
    const hash = hashOf(value);
    const previous = seen[id];
    const at = previous?.hash === hash ? previous.at : now;
    view[id] = { hash, at, data: value };
    nextSeen[id] = { hash, at };
  }
  return { view, seen: nextSeen };
}

/**
 * The person's own skill and agent files. A file that is still exactly what this Mac's seed wrote is left out:
 * each Mac keeps the shipped files of its own build, so an older build can never overwrite a newer one's.
 * `walk` lists only real files and folders, so a linked folder inside a root is never entered.
 */
export async function collectFiles(hiveDir: string, manifestFile: string): Promise<View> {
  const shipped = (await readManifest(manifestFile)).files;
  const view: View = {};
  for (const root of ROOTS) {
    const top = await lstat(join(hiveDir, root)).catch(() => null);
    if (!top?.isDirectory()) continue; // absent, or a link: skipped whole, as the seed does
    for (const file of await walk(join(hiveDir, root))) {
      const rel = `${root}/${file.split(sep).join('/')}`;
      if (!safeRel(rel)) continue;
      const full = join(hiveDir, rel);
      const info = await lstat(full).catch(() => null);
      if (!info?.isFile()) continue;
      const bytes = await readFile(full).catch(() => null);
      if (bytes === null) continue; // vanished between listing and reading
      const hash = sha256(bytes);
      if (shipped[rel] === hash) continue;
      view[`automation:f:${rel}`] = { hash, at: Math.floor(info.mtimeMs), data: bytes.toString('base64') };
    }
  }
  return view;
}

interface KeyEntry {
  value: unknown;
  at: number;
}
interface FileEntry {
  sha256: string;
  mtime: number;
  b64: string;
}
interface GroupEntries {
  keys: Record<string, KeyEntry>;
  files: Record<string, FileEntry>;
}

const ID = /^([a-z]+):([kf]):(.+)$/s;

/** gzip of `{ v: 1, groups: { <group>: { keys: { <path>: { value, at } }, files: { <rel>: { sha256, mtime, b64 } } } } }`. */
export async function encodeBundle(view: View): Promise<Buffer> {
  const groups = Object.fromEntries(SYNC_GROUPS.map((group) => [group, { keys: {}, files: {} } as GroupEntries])) as Record<
    SyncGroup,
    GroupEntries
  >;
  for (const [id, item] of Object.entries(view)) {
    const match = ID.exec(id);
    const group = match?.[1] as SyncGroup | undefined;
    if (match === null || group === undefined || !(SYNC_GROUPS as readonly string[]).includes(group)) continue;
    const [, , kind, name] = match as unknown as [string, string, 'k' | 'f', string];
    if (kind === 'k') groups[group].keys[name] = { value: item.data, at: item.at };
    else groups[group].files[name] = { sha256: item.hash, mtime: item.at, b64: String(item.data) };
  }
  return gzipAsync(Buffer.from(JSON.stringify({ v: 1, groups }), 'utf8'));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * The view a pulled bundle holds, or null for anything that is not a whole v1 bundle. Every hash is recomputed
 * from the content; a file whose bytes do not match its sha256, or whose path is not under skills/ or agents/,
 * refuses the whole bundle. Key paths are not checked here: `writeKeys` only ever writes listed ones.
 */
export async function decodeBundle(bytes: Buffer): Promise<View | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse((await gunzipAsync(bytes)).toString('utf8'));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.v !== 1 || !isRecord(parsed.groups)) return null;
  const view: View = {};
  for (const [group, entries] of Object.entries(parsed.groups)) {
    if (!(SYNC_GROUPS as readonly string[]).includes(group) || !isRecord(entries)) return null;
    const keys = entries.keys ?? {};
    const files = entries.files ?? {};
    if (!isRecord(keys) || !isRecord(files)) return null;
    for (const [path, entry] of Object.entries(keys)) {
      if (!isRecord(entry) || !isTime(entry.at) || !Object.hasOwn(entry, 'value') || entry.value === undefined) return null;
      view[`${group}:k:${path}`] = { hash: hashOf(entry.value), at: entry.at, data: entry.value } satisfies Item;
    }
    for (const [rel, entry] of Object.entries(files)) {
      if (!safeRel(rel) || !isRecord(entry) || !isTime(entry.mtime)) return null;
      if (typeof entry.b64 !== 'string' || typeof entry.sha256 !== 'string') return null;
      const content = Buffer.from(entry.b64, 'base64');
      const hash = sha256(content);
      if (hash !== entry.sha256) return null;
      view[`${group}:f:${rel}`] = { hash, at: entry.mtime, data: content.toString('base64') };
    }
  }
  return view;
}
