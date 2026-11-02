import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { copilotRecord, copilotRecordAborted } from '../../../../../electron/main/harness/copilot/record';

const UUID = '11111111-2222-4333-8444-555555555551';

describe('copilotRecord', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('finds a conversation at session-state/<id>/events.jsonl under the home', () => {
    const home = mkdtempSync(join(tmpdir(), 'cop-home-'));
    const record = copilotRecord(() => home);
    // The folder exists before the first prompt, the transcript does not (FINDINGS P3).
    mkdirSync(join(home, 'session-state', UUID), { recursive: true });
    expect(record.hasTranscript('/any', UUID)).toBe(false);
    writeFileSync(join(home, 'session-state', UUID, 'events.jsonl'), '{}\n');
    expect(record.transcriptPath('/any', UUID)).toBe(join(home, 'session-state', UUID, 'events.jsonl'));
    expect(record.hasTranscript('/any', UUID)).toBe(true);
  });

  it('answers nothing for an id that is not a uuid', () => {
    const record = copilotRecord(() => '/h');
    expect(record.transcriptPath('/c', '../etc')).toBeNull();
    expect(record.hasTranscript('/c', '../etc')).toBe(false);
  });

  it('keeps titles as Copilot gives them', () => {
    const record = copilotRecord(() => '/h');
    expect(record.titleOrigin('/c', UUID, 't')).toBe('unknown');
    expect(record.nameFromTitle('t')).toBe('t');
  });

  it("reads the user's home: COPILOT_HOME, else ~/.copilot", () => {
    vi.stubEnv('COPILOT_HOME', '/elsewhere');
    expect(copilotRecord().transcriptPath('/c', UUID)).toBe(join('/elsewhere', 'session-state', UUID, 'events.jsonl'));
    vi.stubEnv('COPILOT_HOME', undefined);
    expect(copilotRecord().transcriptPath('/c', UUID)).toBe(
      join(homedir(), '.copilot', 'session-state', UUID, 'events.jsonl'),
    );
  });
});

describe('copilotRecordAborted (HIVE-365)', () => {
  // Scrubbed from the 1.0.105 probe: Esc on the dialog, and Esc Esc mid-turn.
  it.each([
    ['an Esc on the dialog', '{"type":"abort","data":{"reason":"user_initiated"},"id":"e1","timestamp":"2026-11-02T15:27:02.265Z"}'],
    ['an Esc Esc mid-turn', '{"type":"abort","data":{"reason":"user_abort"},"id":"e2","timestamp":"2026-11-02T15:30:47.763Z"}'],
  ])('finds the abort written by %s', (_what, line) => {
    expect(copilotRecordAborted(['{"type":"assistant.turn_end","data":{"turnId":"0"}}', line])).toBe(true);
  });

  it.each([
    ['a turn that ended', ['{"type":"assistant.turn_end","data":{"turnId":"0"}}']],
    ['a declined call the turn goes on from', ['{"type":"permission.completed","data":{"result":{"kind":"denied-interactively"}}}']],
    ['the word in a message', ['{"type":"user.message","data":{"content":"abort"}}']],
    ['a torn line', ['{"type":"abo']],
  ])('finds nothing in %s', (_what, lines) => {
    expect(copilotRecordAborted(lines)).toBe(false);
  });
});
