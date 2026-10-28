import { describe, expect, it } from 'vitest';

import { copilotBlockAnswer } from '../../../../../electron/main/harness/copilot/block-answer';

describe('copilotBlockAnswer (HIVE-280)', () => {
  it('reads a lone Esc as a cancel: the dialog says "esc to cancel" and no hook follows (FINDINGS P1)', () => {
    expect(copilotBlockAnswer('\x1b')).toBe('cancelled');
  });

  it.each([
    ['Enter', '\r'],
    ['a digit', '2'],
    ['text', 'do it differently'],
  ])('reads %s as an answer', (_what, data) => {
    expect(copilotBlockAnswer(data)).toBe('answered');
  });

  it.each([
    ['a cursor report', '\x1b[12;40R'],
    ['a device attributes reply', '\x1b[?62;22c'],
    ['focus in and out', '\x1b[I\x1b[O'],
    ['a colour reply', '\x1b]11;rgb:1818/1818/1818\x1b\\'],
    ['a BEL colour reply', '\x1b]10;rgb:d8d8/d8d8/d8d8\x07'],
    ['a keyboard flags reply', '\x1b[?0u'],
    ['a mode report', '\x1b[?2026;2$y'],
    ['a secondary device attributes reply', '\x1b[>0;276;0c'],
    ['a status report', '\x1b[0n'],
    ['an ANSI mode report', '\x1b[4;2$y'],
    ['a DCS reply', '\x1bP>|xterm.js(5.5.0)\x1b\\'],
    ['nothing', ''],
  ])('reads %s as no answer: the terminal said it, not the user', (_what, data) => {
    expect(copilotBlockAnswer(data)).toBeNull();
  });

  it.each([
    ['an arrow', '\x1b[B'],
    ['an application-mode arrow', '\x1bOA'],
    ['Home', '\x1b[H'],
    ['Page Down', '\x1b[6~'],
    ['a mouse click', '\x1b[<0;10;5M'],
    ['a wheel scroll', '\x1b[<65;10;5M\x1b[<65;10;5M'],
    ['a legacy mouse report', '\x1b[M !!'],
  ])('reads %s as no answer yet: moving through the dialog decides nothing', (_what, data) => {
    expect(copilotBlockAnswer(data)).toBeNull();
  });

  it('reads a key beside a report as an answer', () => {
    expect(copilotBlockAnswer('\x1b[I\r')).toBe('answered');
  });
});
