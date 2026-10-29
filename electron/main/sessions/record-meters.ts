/**
 * A session's meters, read from its own record (HIVE-334), for a CLI with no status line.
 *
 * Every hook re-reads the record from where the last read stopped (D1): the CLI writes its usage
 * when it hears from the API, and a hook fires around every such moment, so a watcher would add
 * only moving parts. Shaped like `changed-files.ts`, whose read it shares.
 */
import { CH } from '@shared/ipc-contract';
import type { SessionMetrics, SessionMetricsEvent } from '@shared/metrics-contract';

import type { HarnessAdapter } from '../harness/port';

import { readAppended } from './read-appended';

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
}: {
  send: (channel: string, payload: unknown) => void;
  /** The session's live conversation, from the sessions `transcripts` map; absent before the first hook. */
  transcriptOf: (entityId: string) => { cwd: string; sessionUuid: string } | undefined;
  adapterOf: (entityId: string) => HarnessAdapter;
}): RecordMeters {
  const sessions = new Map<string, { uuid: string; offset: number }>();
  /** One read in flight per session; a hook during it chains behind it. */
  const queues = new Map<string, Promise<void>>();
  /** Bumped by `drop`: a read from before it is stale. */
  const generations = new Map<string, number>();
  const generationOf = (entityId: string): number => generations.get(entityId) ?? 0;
  const publish = (entityId: string, metrics: SessionMetrics): void =>
    send(CH.sessionMetrics, { entityId, metrics } satisfies SessionMetricsEvent);

  async function readNew(entityId: string, generation: number): Promise<void> {
    const adapter = adapterOf(entityId);
    const transcript = transcriptOf(entityId);
    if (generationOf(entityId) !== generation || adapter.foldMeters === undefined || transcript === undefined) return;
    let state = sessions.get(entityId);
    if (state === undefined) {
      state = { uuid: transcript.sessionUuid, offset: 0 };
      sessions.set(entityId, state);
    } else if (state.uuid !== transcript.sessionUuid) {
      // `/new`: a new file with no usage in it yet. The old context is not this conversation's;
      // limits and credits are the account's, so they stay.
      state.uuid = transcript.sessionUuid;
      state.offset = 0;
      publish(entityId, { contextPct: null });
    }
    const path = adapter.record.transcriptPath(transcript.cwd, transcript.sessionUuid);
    if (path === null) return;
    const read = await readAppended(path, state.offset);
    if (read === null || generationOf(entityId) !== generation || sessions.get(entityId) !== state) return;
    state.offset = read.offset;
    const metrics = adapter.foldMeters(read.text.split('\n'));
    if (Object.keys(metrics).length > 0) publish(entityId, metrics);
  }

  return {
    onHook(entityId) {
      const generation = generationOf(entityId);
      const next = (queues.get(entityId) ?? Promise.resolve())
        .then(() => readNew(entityId, generation))
        .catch((cause: unknown) => {
          // Unreadable: the offset stays, so the next hook retries.
          console.warn(`[hive] meters not read (${entityId}):`, cause);
        });
      queues.set(entityId, next);
      return next;
    },
    drop(entityId) {
      sessions.delete(entityId);
      queues.delete(entityId);
      generations.set(entityId, generationOf(entityId) + 1);
    },
  };
}
