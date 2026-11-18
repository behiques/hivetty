import { randomBytes } from 'node:crypto';

import {
  MIN_PASSPHRASE,
  NO_ENCRYPTION,
  SYNC_PROBLEM_COPY,
  WRONG_PASSPHRASE,
  type SyncedAppearance,
  type SyncGroup,
  type SyncProblem,
  type SyncSetupResult,
  type SyncStatus,
} from '@shared/sync-contract';

import { CloudError } from '../licence/cloud';

import { groupOfId } from './allow-lists';
import { collectKeys, decodeBundle, encodeBundle } from './bundle';
import { open, SALT_BYTES, seal } from './crypto';
import { merge, type MergeResult, type View } from './merge';
import { freshState, type KeyStore, type StateStore, type StoredKey, type SyncState } from './state';

export const SYNC_PATH = '/api/sync';
export const DEBOUNCE_MS = 5_000;
export const POLL_MS = 5 * 60_000;
export const MAX_BLOB_BYTES = 5 * 1024 * 1024;
const MAX_RETRIES = 3;
const DEFAULT_WAIT_S = 60;
const SIGN_IN = 'Sign in to turn on sync.';
const TOO_SHORT = `Use at least ${String(MIN_PASSPHRASE)} characters.`;
const CANT_STORE = "Couldn't store the sync key on this Mac.";
const CANT_RESET = "Couldn't reset sync. Try again.";

export interface EngineDeps {
  /** `cloudSession().authedFetch`; rejects with a `CloudError` when the network fails. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** `leaseSubject`: the user the key is bound to. */
  userId(): string | null;
  keys: KeyStore;
  state: StateStore;
  /** `readConfigDocument` */
  readDocument(): Record<string, unknown> | null;
  /** `collectFiles(hiveDir, manifestFile)` */
  collectFiles(): Promise<View>;
  apply(result: MergeResult, kept: Record<string, string>): Promise<{ configOk: boolean; kept: Record<string, string> }>;
  conflicts(): Promise<{ count: number; latest: { path: string; at: number } | null }>;
  deriveKey(passphrase: string, salt: Buffer): Promise<Buffer>;
  now(): number;
  onStatus(status: SyncStatus): void;
}

export interface SyncEngine {
  status(): SyncStatus;
  /** Probes the cloud when off and unknown; answers the status afterwards. */
  refresh(): Promise<SyncStatus>;
  setup(passphrase: string): Promise<SyncSetupResult>;
  setGroup(group: SyncGroup, on: boolean): Promise<void>;
  reportAppearance(fields: SyncedAppearance): void;
  /** A listed key or a watched file changed: run 5 s after the last one. */
  changed(): void;
  /** Run now: the poll, a window focus, "Sync now". */
  now(): Promise<void>;
  /** Resolves once no run is in flight. */
  idle(): Promise<void>;
  reset(): Promise<SyncSetupResult>;
  start(): void;
  /** `wipe` on sign-out or another account: also deletes the key and the state. */
  stop(options?: { wipe: boolean }): void;
}

interface CloudBlob {
  revision: number;
  salt: string;
  ciphertext: string;
}

type Outcome = 'done' | 'retry' | SyncProblem | 'reset-none' | 'reset-present' | 'locked' | { wait: number };

const etag = (revision: number): string => `"${String(revision)}"`;
const isAppearance = (id: string): boolean => id.startsWith('workspace:k:appearance.');
const pick = <T>(all: Record<string, T>, keep: (id: string) => boolean): Record<string, T> =>
  Object.fromEntries(Object.entries(all).filter(([id]) => keep(id)));

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function asBlob(body: unknown): CloudBlob | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = body as Record<string, unknown>;
  return Number.isInteger(raw.revision) && typeof raw.salt === 'string' && typeof raw.ciphertext === 'string'
    ? { revision: raw.revision as number, salt: raw.salt, ciphertext: raw.ciphertext }
    : null;
}

/**
 * Settings sync (HIVE-284): one cycle serves every trigger. Collect this Mac's view, pull, merge three ways
 * against the base in `sync-state.json`, apply, push with a revision compare-and-swap. Only one runs at a time;
 * a trigger during a run queues exactly one more.
 */
export function createSyncEngine(deps: EngineDeps): SyncEngine {
  /** The decoded bundle of one revision, kept so an unchanged cloud costs a 304. */
  let cached: { revision: number; view: View } | null = null;
  /** The presence probe's answer, reused by the join so the blob is downloaded once. */
  let probe: CloudBlob | null = null;
  let appearance: SyncedAppearance | null = null;
  let cloud: 'none' | 'present' | 'unknown' = 'unknown';
  let resetElsewhere = false;
  let problem: SyncProblem | null = null;
  let locked = false;
  let stopped = true;
  let conflicts: { count: number; latest: { path: string; at: number } | null } = { count: 0, latest: null };
  let running: Promise<void> | null = null;
  let again = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let waitTimer: ReturnType<typeof setTimeout> | null = null;
  let published: string | null = null;

  function status(): SyncStatus {
    if (locked) return { kind: 'unavailable', reason: 'locked' };
    if (!deps.keys.available()) return { kind: 'unavailable', reason: 'no-encryption' };
    const key = deps.keys.read();
    const state = key === null ? null : deps.state.read();
    if (key === null || state === null) return { kind: 'off', cloud, resetElsewhere };
    return { kind: 'on', lastSyncedAt: state.lastSyncedAt, groups: { ...state.groups }, conflicts, problem };
  }

  function publish(): void {
    const next = status();
    const text = JSON.stringify(next);
    if (text === published) return;
    published = text;
    deps.onStatus(next);
  }

  function forget(): void {
    deps.keys.clear();
    deps.state.clear();
    cached = null;
    probe = null;
    problem = null;
  }

  /** A stored key belongs to the user saved with it; another user's is deleted before any request uses it. */
  function ownKey(): StoredKey | null {
    const key = deps.keys.read();
    const user = deps.userId();
    if (key !== null && user !== null && key.userId !== user) {
      forget();
      resetElsewhere = false;
      cloud = 'unknown';
      return null;
    }
    return key;
  }

  function clearTimers(): void {
    if (pollTimer !== null) clearInterval(pollTimer);
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    if (waitTimer !== null) clearTimeout(waitTimer);
    pollTimer = debounceTimer = waitTimer = null;
  }

  async function pull(key: StoredKey, state: SyncState): Promise<View | Outcome> {
    if (state.revision === 0 && cached?.revision === 0) return cached.view;
    const conditional = cached !== null && cached.revision === state.revision;
    const response = await deps.fetch(SYNC_PATH, conditional ? { headers: { 'if-none-match': etag(state.revision) } } : {});
    if (response.status === 304 && cached !== null) return cached.view;
    if (response.status === 403) return 'locked';
    if (response.status === 429) return { wait: Number(response.headers.get('retry-after')) || DEFAULT_WAIT_S };
    if (response.status === 404) {
      if (state.revision > 0) return 'reset-none';
      cached = { revision: 0, view: {} }; // never created, or this Mac died before its first push
      return cached.view;
    }
    if (!response.ok) return 'offline';
    const body = asBlob(await readJson(response));
    if (body === null) return 'offline';
    if (body.salt !== key.salt) return 'reset-present';
    const plain = open(Buffer.from(key.key, 'base64'), key.userId, Buffer.from(body.ciphertext, 'base64'));
    const view = plain === null ? null : await decodeBundle(plain);
    if (view === null) return 'reset-present';
    cached = { revision: body.revision, view };
    state.revision = body.revision;
    return view;
  }

  /** One pull, merge, apply and push. `retry` means the push lost a race and the caller should go again. */
  async function once(key: StoredKey, state: SyncState): Promise<Outcome> {
    const remote = await pull(key, state);
    if (typeof remote === 'string' || 'wait' in remote) return remote as Outcome;

    const document = deps.readDocument();
    if (document === null) return 'apply-failed';
    const keys = collectKeys(document, appearance, state.seen, deps.now());
    state.seen = keys.seen;
    const local: View = { ...keys.view, ...(await deps.collectFiles()) };
    const takesPart = (id: string): boolean =>
      state.groups[groupOfId(id)] && (!isAppearance(id) || appearance !== null);

    const result = merge(pick(state.base, takesPart), pick(local, takesPart), pick(remote, takesPart), !state.joined);
    const applied = await deps.apply(result, state.kept);
    state.kept = applied.kept;
    state.joined = true;

    // The base advances only where this Mac now agrees with the cloud. A key the config refused keeps its old base.
    const held = (id: string): boolean => !applied.configOk && id.includes(':k:') && !isAppearance(id);
    for (const id of new Set([...Object.keys(result.merged), ...Object.keys(pick(state.base, takesPart))])) {
      const agreed = result.merged[id]?.hash === remote[id]?.hash;
      if (!agreed || held(id)) continue;
      const hash = result.merged[id]?.hash;
      if (hash === undefined) delete state.base[id];
      else state.base[id] = hash;
    }
    deps.state.write(state);
    if (!applied.configOk) return 'apply-failed';
    if (!result.push) {
      state.lastSyncedAt = deps.now();
      deps.state.write(state);
      return 'done';
    }

    // Groups that are off, and appearance before any window reported it, are carried from the remote unchanged.
    const outgoing: View = { ...pick(remote, (id) => !takesPart(id)), ...result.merged };
    const blob = seal(Buffer.from(key.key, 'base64'), key.userId, await encodeBundle(outgoing));
    if (blob.length > MAX_BLOB_BYTES) return 'too-large';
    const response = await deps.fetch(SYNC_PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'if-match': etag(state.revision) },
      body: JSON.stringify({ salt: key.salt, ciphertext: blob.toString('base64') }),
    });
    if (response.status === 412) {
      cached = null;
      return 'retry';
    }
    if (response.status === 409) return 'reset-present';
    if (response.status === 403) return 'locked';
    if (response.status === 413) return 'too-large';
    if (response.status === 429) return { wait: Number(response.headers.get('retry-after')) || DEFAULT_WAIT_S };
    if (!response.ok) return 'offline';
    const body = (await readJson(response)) as { revision?: unknown } | null;
    if (!Number.isInteger(body?.revision)) return 'offline';
    const revision = body?.revision as number; // from the body, never the ETag
    state.revision = revision;
    cached = { revision, view: outgoing };
    for (const id of Object.keys(pick(state.base, takesPart))) delete state.base[id];
    for (const [id, item] of Object.entries(result.merged)) state.base[id] = item.hash;
    state.lastSyncedAt = deps.now();
    deps.state.write(state);
    return 'done';
  }

  async function cycle(key: StoredKey, state: SyncState): Promise<Outcome> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      let outcome: Outcome;
      try {
        outcome = await once(key, state);
      } catch (error) {
        // A CloudError is the network; anything else failed while applying or saving.
        return error instanceof CloudError ? 'offline' : 'apply-failed';
      }
      if (outcome !== 'retry') return outcome;
    }
    return 'busy';
  }

  function settle(outcome: Outcome): void {
    if (typeof outcome === 'object') {
      problem = null;
      if (waitTimer !== null) clearTimeout(waitTimer);
      waitTimer = setTimeout(() => {
        waitTimer = null;
        void now();
      }, outcome.wait * 1000);
      return;
    }
    switch (outcome) {
      case 'done':
      case 'retry':
        problem = null;
        return;
      case 'reset-none':
      case 'reset-present':
        forget();
        resetElsewhere = true;
        cloud = outcome === 'reset-none' ? 'none' : 'present';
        return;
      case 'locked':
        locked = true;
        clearTimers();
        return;
      default:
        problem = outcome;
    }
  }

  async function runOnce(): Promise<void> {
    if (stopped || locked) return;
    const key = ownKey();
    const state = key === null ? null : deps.state.read();
    if (key !== null && state !== null) {
      settle(await cycle(key, state));
      conflicts = await deps.conflicts().catch(() => conflicts);
    }
    publish();
  }

  function now(): Promise<void> {
    if (stopped || locked || waitTimer !== null) return running ?? Promise.resolve();
    if (running !== null) {
      again = true;
      return running;
    }
    const run = (async () => {
      do {
        again = false;
        await runOnce();
      } while (again && !stopped && !locked);
    })().finally(() => {
      running = null;
    });
    running = run;
    return run;
  }

  async function refresh(): Promise<SyncStatus> {
    const current = status();
    if (current.kind === 'off' && cloud === 'unknown') {
      try {
        const response = await deps.fetch(SYNC_PATH);
        if (response.status === 404) cloud = 'none';
        else if (response.status === 403) locked = true;
        else if (response.ok) {
          probe = asBlob(await readJson(response));
          if (probe !== null) cloud = 'present';
        }
      } catch {
        // Offline: the cloud stays unknown and the tab shows set up until it answers.
      }
    } else if (current.kind === 'on') {
      conflicts = await deps.conflicts().catch(() => conflicts);
    }
    publish();
    return status();
  }

  async function create(passphrase: string, user: string): Promise<SyncSetupResult> {
    if (passphrase.length < MIN_PASSPHRASE) return { ok: false, error: TOO_SHORT };
    const salt = randomBytes(SALT_BYTES);
    const key = await deps.deriveKey(passphrase, salt);
    return store({ key: key.toString('base64'), salt: salt.toString('base64'), userId: user }, freshState(true), {
      revision: 0,
      view: {},
    });
  }

  async function join(passphrase: string, user: string, blob: CloudBlob): Promise<SyncSetupResult> {
    const key = await deps.deriveKey(passphrase, Buffer.from(blob.salt, 'base64'));
    const plain = open(key, user, Buffer.from(blob.ciphertext, 'base64'));
    const view = plain === null ? null : await decodeBundle(plain);
    if (view === null) return { ok: false, error: WRONG_PASSPHRASE };
    const state = freshState(false);
    state.revision = blob.revision;
    return store({ key: key.toString('base64'), salt: blob.salt, userId: user }, state, { revision: blob.revision, view });
  }

  function store(key: StoredKey, state: SyncState, view: { revision: number; view: View }): SyncSetupResult {
    deps.state.write(state);
    if (!deps.keys.write(key)) {
      deps.state.clear();
      return { ok: false, error: CANT_STORE };
    }
    cached = view;
    probe = null;
    cloud = 'present';
    resetElsewhere = false;
    problem = null;
    publish();
    void now();
    return { ok: true };
  }

  async function setup(passphrase: string): Promise<SyncSetupResult> {
    if (!deps.keys.available()) return { ok: false, error: NO_ENCRYPTION };
    const user = deps.userId();
    if (user === null) return { ok: false, error: SIGN_IN };
    let blob = probe;
    if (blob === null) {
      let response: Response;
      try {
        response = await deps.fetch(SYNC_PATH);
      } catch {
        return { ok: false, error: SYNC_PROBLEM_COPY.offline };
      }
      if (response.status === 404) {
        cloud = 'none';
        return create(passphrase, user);
      }
      if (!response.ok) return { ok: false, error: SYNC_PROBLEM_COPY.offline };
      blob = asBlob(await readJson(response));
      if (blob === null) return { ok: false, error: SYNC_PROBLEM_COPY.offline };
      probe = blob;
    }
    return join(passphrase, user, blob);
  }

  async function reset(): Promise<SyncSetupResult> {
    let response: Response;
    try {
      response = await deps.fetch(SYNC_PATH, { method: 'DELETE' });
    } catch {
      return { ok: false, error: CANT_RESET };
    }
    if (response.status !== 204) return { ok: false, error: CANT_RESET };
    forget();
    cloud = 'none';
    resetElsewhere = false;
    publish();
    return { ok: true };
  }

  return {
    status,
    refresh,
    setup,
    async setGroup(group, on) {
      const state = deps.state.read();
      if (state === null) return;
      state.groups[group] = on;
      deps.state.write(state);
      publish();
      if (on) void now();
    },
    reportAppearance(fields) {
      if (appearance !== null && JSON.stringify(appearance) === JSON.stringify(fields)) return;
      appearance = { ...fields };
      this.changed();
    },
    changed() {
      if (stopped || locked) return;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void now();
      }, DEBOUNCE_MS);
    },
    now,
    idle: () => running ?? Promise.resolve(),
    reset,
    start() {
      if (!stopped) return;
      stopped = false;
      locked = false;
      const key = ownKey();
      pollTimer = setInterval(() => void now(), POLL_MS);
      if (key !== null) void now();
      else publish();
    },
    stop(options) {
      stopped = true;
      clearTimers();
      if (options?.wipe) {
        forget();
        cloud = 'unknown';
        resetElsewhere = false;
      }
    },
  };
}
