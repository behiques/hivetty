/**
 * A session's meters, read from its own record (HIVE-334), for a CLI with no status line.
 *
 * Every hook re-reads the record from where the last read stopped (D1): the CLI writes its usage
 * when it hears from the API, and a hook fires around every such moment, so a watcher would add
 * only moving parts. Shaped like `changed-files.ts`, whose read it shares.
 *
 * A `meterExport` CLI (Copilot, HIVE-335) is read from its telemetry export instead, which it
 * writes just after the hook fires; one trailing read per hook catches it. Still not a watcher.
 */
import { CH } from '@shared/ipc-contract';
import type { SessionMetrics, SessionMetricsEvent } from '@shared/metrics-contract';

import type { HarnessAdapter } from '../harness/port';

import { readAppended } from './read-appended';

/**
 * Copilot exports a turn's spans just after `agentStop` fires (HIVE-335, F3: within ~0.5 s), so a
 * read at the hook sees the turn before. One trailing read this long after the last hook catches it.
 */
export const METER_EXPORT_SETTLE_MS = 1_500;

export interface RecordMeters {
  /** A hook arrived: read what the record gained. Never rejects. */
  onHook(entityId: string): Promise<void>;
  /** The session ended: a read still in flight sends nothing. */
  drop(entityId: string): void;
}

export function createRecordMeters({
  send,
  transcriptOf,
  adapterOf,
  exportPathOf = () => null,
}: {
  send: (channel: string, payload: unknown) => void;
  /** The session's live conversation, from the sessions `transcripts` map; absent before the first hook. */
  transcriptOf: (entityId: string) => { cwd: string; sessionUuid: string } | undefined;
  adapterOf: (entityId: string) => HarnessAdapter;
  /** A `meterExport` CLI's telemetry file (HIVE-335); `null` when it has none. */
  exportPathOf?: (entityId: string) => string | null;
}): RecordMeters {
  const sessions = new Map<string, { uuid: string; offset: number; metrics: SessionMetrics }>();
  /** One read in flight per session; a hook during it chains behind it. */
  const queues = new Map<string, Promise<void>>();
  /** Bumped by `drop`: a read from before it is stale. */
  const generations = new Map<string, number>();
  /** A `meterExport` session's pending trailing read (HIVE-335). */
  const settles = new Map<string, ReturnType<typeof setTimeout>>();
  const generationOf = (entityId: string): number => generations.get(entityId) ?? 0;
  const publish = (entityId: string, metrics: SessionMetrics): void =>
    send(CH.sessionMetrics, { entityId, metrics } satisfies SessionMetricsEvent);

  async function readNew(entityId: string, generation: number): Promise<void> {
    const adapter = adapterOf(entityId);
    const transcript = transcriptOf(entityId);
    if (generationOf(entityId) !== generation || adapter.foldMeters === undefined || transcript === undefined) return;
    let state = sessions.get(entityId);
    if (state === undefined) {
      state = { uuid: transcript.sessionUuid, offset: 0, metrics: {} };
      sessions.set(entityId, state);
    } else if (state.uuid !== transcript.sessionUuid) {
      // `/new`: a new file with no usage in it yet. The old context is not this conversation's;
      // limits and credits are the account's, so they stay.
      state.uuid = transcript.sessionUuid;
      // An export is the session's one file, not the conversation's (HIVE-335 follow-up): reading
      // on from where it was keeps the session's totals and never brings back the old context.
      if (adapter.meterExport !== true) {
        state.offset = 0;
        state.metrics = {};
      }
      publish(entityId, { contextPct: null });
    }
    const path =
      adapter.meterExport === true
        ? exportPathOf(entityId)
        : adapter.record.transcriptPath(transcript.cwd, transcript.sessionUuid);
    if (path === null) return;
    const read = await readAppended(path, state.offset).catch((cause: unknown) => {
      // Before the CLI's first write there is no file: nothing to read yet, nothing to warn about.
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw cause;
    });
    if (read === null || generationOf(entityId) !== generation || sessions.get(entityId) !== state) return;
    state.offset = read.offset;
    const metrics = adapter.foldMeters(read.text.split('\n'), state.metrics);
    state.metrics = { ...state.metrics, ...metrics };
    if (Object.keys(metrics).length > 0) publish(entityId, metrics);
  }

  function enqueue(entityId: string): Promise<void> {
    const generation = generationOf(entityId);
    const next = (queues.get(entityId) ?? Promise.resolve())
      .then(() => readNew(entityId, generation))
      .catch((cause: unknown) => {
        // Unreadable: the offset stays, so the next hook retries.
        console.warn(`[hive] meters not read (${entityId}):`, cause);
      });
    queues.set(entityId, next);
    return next;
  }

  return {
    onHook(entityId) {
      if (adapterOf(entityId).meterExport === true) {
        clearTimeout(settles.get(entityId));
        settles.set(
          entityId,
          setTimeout(() => {
            settles.delete(entityId);
            void enqueue(entityId);
          }, METER_EXPORT_SETTLE_MS),
        );
      }
      return enqueue(entityId);
    },
    drop(entityId) {
      clearTimeout(settles.get(entityId));
      settles.delete(entityId);
      sessions.delete(entityId);
      queues.delete(entityId);
      generations.set(entityId, generationOf(entityId) + 1);
    },
  };
}
