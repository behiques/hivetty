import { join } from 'node:path';

import { MAX_TYPED_LINE_BYTES } from '@shared/session-contract';

import { shellQuote } from '../container/shell-quote';

/**
 * A launch line too long to type (see `MAX_TYPED_LINE_BYTES`) is written here and sourced. Keyed
 * by entity id as `meter-exports` is; needed only until the shell has read it.
 */
export const LAUNCH_LINE_DIR = 'launch';

/** The same shape `assertId` accepts at the IPC boundary: nothing in it can leave the folder. */
const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const launchLinePath = (stateDir: string, entityId: string): string | null =>
  ENTITY_ID.test(entityId) ? join(stateDir, LAUNCH_LINE_DIR, `${entityId}.sh`) : null;

/**
 * What to type for `command`: itself when it fits, else `. '<file>'`, with the text the file
 * must hold first. `.` and not `source`: the same login shell reads it, so `unset` and `&& exit`
 * mean what they meant typed, and every POSIX shell has it.
 */
export function typedLaunchLine(command: string, file: string | null): { line: string; text?: string } {
  if (file === null || Buffer.byteLength(command) <= MAX_TYPED_LINE_BYTES) return { line: command };
  return { line: `. ${shellQuote(file)}`, text: `${command}\n` };
}
