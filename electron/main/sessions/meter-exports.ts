import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A session's telemetry export (HIVE-335): Copilot writes its OTel spans here, and `record-meters`
 * reads them. Keyed by entity id, which a resume and a `/clear` both keep, and which the history
 * is keyed by, so the boot sweep can tell a live file from an orphan.
 */
export const METER_EXPORT_DIR = 'otel';

/** The same shape `assertId` accepts at the IPC boundary: nothing in it can leave the folder. */
const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const meterExportPath = (stateDir: string, entityId: string): string | null =>
  ENTITY_ID.test(entityId) ? join(stateDir, METER_EXPORT_DIR, `${entityId}.jsonl`) : null;

/** Delete every export whose session the history no longer holds. Never rejects. */
export async function sweepMeterExports(stateDir: string, keep: ReadonlySet<string>): Promise<void> {
  const dir = join(stateDir, METER_EXPORT_DIR);
  const names = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((name) => name.endsWith('.jsonl') && !keep.has(name.slice(0, -'.jsonl'.length)))
      .map((name) => rm(join(dir, name), { force: true }).catch(() => undefined)),
  );
}
