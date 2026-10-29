import { open } from 'node:fs/promises';

/**
 * What a record gained since `offset`, up to its last newline (HIVE-201, shared by HIVE-334): a torn
 * last line is the writer mid-append, not a record. `null` when there is no whole new line.
 */
export async function readAppended(path: string, offset: number): Promise<{ text: string; offset: number } | null> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    if (size <= offset) return null;
    const buffer = Buffer.alloc(size - offset);
    await handle.read(buffer, 0, buffer.length, offset);
    const end = buffer.lastIndexOf(0x0a);
    if (end === -1) return null;
    return { text: buffer.subarray(0, end).toString('utf8'), offset: offset + end + 1 };
  } finally {
    await handle.close();
  }
}
