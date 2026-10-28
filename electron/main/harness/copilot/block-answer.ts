import type { BlockAnswer } from '../port';

const ESC = '\u001b';
const BEL = '\u0007';
/**
 * What the terminal sends on its own, never the user: cursor, status and mode reports, device
 * attributes, focus in and out, colour, keyboard-flag and DCS replies (xterm.js's answers).
 * Built from a string: ESC and BEL are control characters, which a regex literal may not hold
 * (no-control-regex).
 */
const TERMINAL_REPORTS = new RegExp(
  [
    `${ESC}\\[\\d+;\\d+R`,
    `${ESC}\\[\\d*n`,
    `${ESC}\\[[?>][\\d;]*[cu]`,
    `${ESC}\\[\\??[\\d;]*\\$y`,
    `${ESC}\\[[IO]`,
    `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
    `${ESC}P[^${ESC}]*${ESC}\\\\`,
  ].join('|'),
  'g',
);

/**
 * Moving through the dialog, which decides nothing yet: arrows (normal and application mode), Home,
 * End, the `~` keys (Page Up and Down, Insert, Delete), and mouse reports (SGR and legacy).
 */
const NAVIGATION = new RegExp(
  [`${ESC}\\[[\\d;]*[A-DHF]`, `${ESC}O[A-DHF]`, `${ESC}\\[[\\d;]*~`, `${ESC}\\[<[\\d;]*[Mm]`, `${ESC}\\[M[\\s\\S]{3}`].join('|'),
  'g',
);

/**
 * Whether a write into a Copilot session answered the prompt it is blocked on (HIVE-280, FINDINGS P1).
 * An approval fires `postToolUse`, but an Esc fires nothing at all and cancels the turn, so the user's
 * own keystroke is the only thing left to clear the card: a lone Esc is a cancel, any other key an
 * answer, and a write that is only terminal reports or moves through the dialog is neither.
 */
export function copilotBlockAnswer(data: string): BlockAnswer | null {
  const typed = data.replace(TERMINAL_REPORTS, '').replace(NAVIGATION, '');
  if (typed === '') return null;
  return typed === ESC ? 'cancelled' : 'answered';
}
