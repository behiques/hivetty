/**
 * A turn the user aborted with no hook to say so (HIVE-365), read from the CLI's own record.
 *
 * Codex's decline by any key and Esc mid-turn, and Copilot's Esc Esc, fire no hook; each CLI
 * writes its abort to its record within milliseconds of the key. So a deciding key on a busy
 * session notes the record's size **before** the key reaches the pty, and what the record gained
 * since is read twice. Shaped like `record-meters.ts`, whose read it shares.
 */
import { statSync } from 'node:fs';

import { blockAnswer } from '../harness/block-answer';
import type { HarnessAdapter } from '../harness/port';

import { readAppended } from './read-appended';

/**
 * When the record is read after the key. ponytail: an abort recorded later than the last read (a
 * stalled disk, a container's bind mount) is missed and the row waits for the next prompt, as
 * before HIVE-365; fold the check into `record-meters`' per-hook read if that is ever seen.
 */
const READS_MS = [500, 2000];

export interface RecordAborts {
  /**
   * A user write is about to reach the pty: watch the record for the abort it may cause. One watch
   * per session; the earliest key's baseline stands. Resolves when the watch ends (found, given up,
   * dropped or never started). Never rejects.
   */
  onKey(entityId: string, data: string): Promise<void>;
  /** The session ended: a watch in flight ends nothing. */
  drop(entityId: string): void;
}

/** `false` when the watch was dropped, or ended, first. */
const wait = (ms: number, signal: AbortSignal): Promise<boolean> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve(false);
      },
      { once: true },
    );
  });

export function createRecordAborts({
  transcriptOf,
  adapterOf,
  busy,
  onAbort,
  read = readAppended,
}: {
  /** The session's live conversation, from the sessions `transcripts` map; absent before the first hook. */
  transcriptOf: (entityId: string) => { cwd: string; sessionUuid: string } | undefined;
  adapterOf: (entityId: string) => HarnessAdapter;
  /** A block held or a turn running (`StatusTracker.busy`). */
  busy: (entityId: string) => boolean;
  onAbort: (entityId: string) => void;
  read?: typeof readAppended;
}): RecordAborts {
  const watches = new Map<string, AbortController>();

  async function watch(
    entityId: string,
    path: string,
    baseline: number,
    aborted: (lines: readonly string[]) => boolean,
    signal: AbortSignal,
  ): Promise<void> {
    // Every read is timed from the key, not from the read before it, whose I/O takes its own time.
    for (const due of READS_MS.map((ms) => wait(ms, signal))) {
      if (!(await due)) return;
      const gained = await read(path, baseline);
      if (signal.aborted) return;
      if (gained !== null && aborted(gained.text.split('\n'))) {
        onAbort(entityId);
        return;
      }
    }
  }

  return {
    onKey(entityId, data) {
      const adapter = adapterOf(entityId);
      const aborted = adapter.recordAborted;
      if (aborted === undefined || watches.has(entityId) || blockAnswer(data) === null || !busy(entityId)) {
        return Promise.resolve();
      }
      const transcript = transcriptOf(entityId);
      const path = transcript === undefined ? null : adapter.record.transcriptPath(transcript.cwd, transcript.sessionUuid);
      if (path === null) return Promise.resolve();
      let baseline: number;
      try {
        baseline = statSync(path).size;
      } catch (cause) {
        // No record yet: there is nothing an abort could have been written to. Anything else is worth a line.
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn(`[hive] record not read for an abort (${entityId}):`, cause);
        }
        return Promise.resolve();
      }
      const controller = new AbortController();
      watches.set(entityId, controller);
      return watch(entityId, path, baseline, aborted, controller.signal)
        .catch((cause: unknown) => {
          console.warn(`[hive] record not read for an abort (${entityId}):`, cause);
        })
        .finally(() => {
          if (watches.get(entityId) === controller) watches.delete(entityId);
          // A watch that ended early leaves no read timer behind.
          controller.abort();
        });
    },
    drop(entityId) {
      watches.get(entityId)?.abort();
      watches.delete(entityId);
    },
  };
}
