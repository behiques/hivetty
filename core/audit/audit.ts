import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { configPath, describe } from '../config/paths';

/**
 * The server's audit trail (HIVE-427): who attached and what they ran. Called from
 * `remote-host/listener.ts` only, never from a handler. Payloads are never written.
 */
export type AuditEvent = 'attach' | 'detach' | 'refused' | 'call' | 'input';
export type AuditOutcome = 'unauthorized' | 'device-mismatch' | 'protocol-mismatch' | 'revoked';

export interface AuditEntry {
  at: string;
  event: AuditEvent;
  deviceId: string;
  /** Absent when the id matches no paired device. */
  deviceName?: string;
  via: 'direct' | 'relay';
  channel?: string;
  sessionId?: string;
  outcome?: AuditOutcome;
}
export type AuditInput = Omit<AuditEntry, 'at'>;

const RETENTION_DAYS = 30;
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

const listeners = new Set<(entry: AuditEntry) => void>();
let lastFile = '';
let failing = false;

const pad = (value: number): string => String(value).padStart(2, '0');
const localDay = (date: Date): string =>
  `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function writeToFile(line: string, now: Date): void {
  const dir = join(dirname(configPath()), 'audit');
  const file = join(dir, `${localDay(now)}.jsonl`);
  // A new day (or the first line after boot): make the folder and drop what is past retention.
  if (file !== lastFile) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const oldest = `${localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - RETENTION_DAYS))}.jsonl`;
    for (const name of readdirSync(dir)) {
      if (DAY_FILE.test(name) && name < oldest) rmSync(join(dir, name), { force: true });
    }
    lastFile = file;
  }
  appendFileSync(file, `${line}\n`, { mode: 0o600 });
}

/** Write one audit line and tell every {@link onAudit} subscriber. Never throws. */
export function audit(input: AuditInput): void {
  const now = new Date();
  const entry: AuditEntry = { at: now.toISOString(), ...input };
  const line = JSON.stringify(entry);
  try {
    // `process.stdout.write`, not `console.log`: the server's log prefix must not touch the line.
    if (process.env.HIVETTY_AUDIT === 'stdout') process.stdout.write(`audit ${line}\n`);
    else writeToFile(line, now);
    failing = false;
  } catch (cause) {
    // A trail that cannot be written never refuses a call. Said once per failure streak.
    if (!failing) console.error(`[hive] the audit trail could not be written: ${describe(cause)}`);
    failing = true;
    // The folder may have gone mid-day: the next write makes it again rather than waiting for midnight.
    lastFile = '';
  }
  for (const listener of listeners) {
    try {
      listener(entry);
    } catch (cause) {
      console.error(`[hive] an audit listener threw: ${describe(cause)}`);
    }
  }
}

/** Every line, as it is written (HIVE-311 ships them to the cloud). Returns the unsubscribe. */
export function onAudit(listener: (entry: AuditEntry) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
