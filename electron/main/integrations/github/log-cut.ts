import type { JobLog } from '../../../shared/github-contract';

/**
 * A failed job's log, cut to the failure before it crosses IPC (HIVE-206, D3).
 *
 * The first failure marker with 5 lines above and 60 below; else the last 80.
 * A summary line (`Tests: …`) outside the window is kept after an ellipsis.
 * Never more than 64 KB, dropped from the front.
 */
/* The renderer's `classifyLogLine` keeps a copy of this marker; change both. */
const FAILURE = /✕|✗|\bFAIL\b|\bError\b|##\[error\]/;
const SUMMARY = /^\s*(Tests?|Test Files|Test Suites):/;
const PREFIX = /^[^\t]*\t[^\t]*\t\d{4}-\d\d-\d\dT[\d:.]+Z ?/;
/* Built from a string: an ANSI escape is a control character, which a regex literal may not hold (no-control-regex). */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const ABOVE = 5;
const BELOW = 60;
const TAIL = 80;
const CAP = 64 * 1024;

export function cutLog(raw: string): JobLog {
  const all = raw.split(/\r?\n/).map((line) => line.replace(PREFIX, '').replace(ANSI, ''));
  while (all.length > 0 && all[all.length - 1] === '') all.pop();

  const at = all.findIndex((line) => FAILURE.test(line));
  const start = at === -1 ? Math.max(0, all.length - TAIL) : Math.max(0, at - ABOVE);
  const end = at === -1 ? all.length : Math.min(all.length, at + BELOW + 1);
  let lines = all.slice(start, end);
  const summary = all.slice(end).filter((line) => SUMMARY.test(line));
  if (summary.length > 0) lines = [...lines, '…', ...summary];
  let truncated = start > 0 || end < all.length;

  while (lines.length > 1 && lines.join('\n').length > CAP) {
    lines = lines.slice(1);
    truncated = true;
  }
  return { lines, truncated };
}
