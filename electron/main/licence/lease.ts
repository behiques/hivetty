import { readFileSync, renameSync, writeFileSync } from 'node:fs';

/**
 * `<userData>/lease.jws` (HIVE-267). Plain text: a lease is signed, not secret, and verified on every launch.
 * Written to a temp file and renamed, so a crash mid-write never leaves half a lease.
 */
export interface LeaseFile {
  read(): string | null;
  write(jws: string): void;
}

export function createLeaseFile(filePath: string): LeaseFile {
  return {
    read() {
      try {
        const text = readFileSync(filePath, 'utf8').trim();
        return text === '' ? null : text;
      } catch {
        return null;
      }
    },
    write(jws) {
      const temp = `${filePath}.tmp`;
      writeFileSync(temp, jws, 'utf8');
      renameSync(temp, filePath);
    },
  };
}
