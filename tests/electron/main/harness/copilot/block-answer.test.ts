import { describe, expect, it } from 'vitest';

import { copilotBlockAnswer } from '../../../../../electron/main/harness/copilot/block-answer';

describe('copilotBlockAnswer (HIVE-280)', () => {
  it('reads a lone Esc as a cancel: the dialog says "esc to cancel" and no hook follows (FINDINGS P1)', () => {
    expect(copilotBlockAnswer('\x1b')).toBe('cancelled');
  });

  it.each([
    ['Enter', '\r'],
    ['a digit', '2'],
    ['an arrow', '\x1b[B'],
    ['text', 'do it differently'],
    ['a mouse click', '\x1b[<0;10;5M'],
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
    ['nothing', ''],
  ])('reads %s as no answer: the terminal said it, not the user', (_what, data) => {
    expect(copilotBlockAnswer(data)).toBeNull();
  });

  it('reads a key beside a report as an answer', () => {
    expect(copilotBlockAnswer('\x1b[I\r')).toBe('answered');
  });
});
