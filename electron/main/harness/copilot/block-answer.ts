import type { BlockAnswer } from '../port';

const ESC = '\u001b';
const BEL = '\u0007';
/**
 * What the terminal sends on its own, never the user: cursor and mode reports, device attributes,
 * focus in and out, colour and keyboard-flag replies (the queries `probe.py` answers).
 * Built from a string: ESC and BEL are control characters, which a regex literal may not hold
 * (no-control-regex).
 */
const TERMINAL_REPORTS = new RegExp(
  [
    `${ESC}\\[\\d+;\\d+R`,
    `${ESC}\\[\\?[\\d;]*[cu]`,
    `${ESC}\\[\\?[\\d;]*\\$y`,
    `${ESC}\\[[IO]`,
    `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
  ].join('|'),
  'g',
);

/**
 * Whether a write into a Copilot session answered the prompt it is blocked on (HIVE-280, FINDINGS P1).
 * An approval fires `postToolUse`, but an Esc fires nothing at all and cancels the turn, so the user's
 * own keystroke is the only thing left to clear the card: a lone Esc is a cancel, any other key an
 * answer, and a write that is only terminal reports is neither.
 */
export function copilotBlockAnswer(data: string): BlockAnswer | null {
  const typed = data.replace(TERMINAL_REPORTS, '');
  if (typed === '') return null;
  return typed === ESC ? 'cancelled' : 'answered';
}
