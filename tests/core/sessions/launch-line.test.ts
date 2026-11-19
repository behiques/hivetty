import { describe, expect, it } from 'vitest';

import { launchLinePath, typedLaunchLine } from '../../../core/sessions/launch-line';
import { MAX_TYPED_LINE_BYTES } from '../../../shared/session-contract';

const FILE = "/state/it's here/launch/sess-07.sh";

describe('launchLinePath', () => {
  it('keys the file by entity id, under the state folder', () => {
    expect(launchLinePath('/state', 'sess-07')).toBe('/state/launch/sess-07.sh');
  });

  it('refuses an id that could leave the folder', () => {
    expect(launchLinePath('/state', '../sess-07')).toBeNull();
    expect(launchLinePath('/state', '')).toBeNull();
  });
});

describe('typedLaunchLine', () => {
  it('types a line that fits as it is', () => {
    const command = `claude ${'a'.repeat(MAX_TYPED_LINE_BYTES - 'claude '.length)}`;
    expect(typedLaunchLine(command, FILE)).toEqual({ line: command });
  });

  it('sources a longer line from the file, quoted, and says what the file holds', () => {
    const command = `codex ${'a'.repeat(MAX_TYPED_LINE_BYTES)} && exit`;
    expect(typedLaunchLine(command, FILE)).toEqual({
      line: `. '/state/it'\\''s here/launch/sess-07.sh'`,
      text: `${command}\n`,
    });
  });

  it('measures bytes, not characters: the tty counts what is written', () => {
    // 450 characters, 1,350 bytes.
    const command = 'あ'.repeat(MAX_TYPED_LINE_BYTES / 2);
    expect(typedLaunchLine(command, FILE).text).toBe(`${command}\n`);
  });

  it('types a long line whole when there is no file to hold it', () => {
    const command = 'a'.repeat(MAX_TYPED_LINE_BYTES + 1);
    expect(typedLaunchLine(command, null)).toEqual({ line: command });
  });
});
