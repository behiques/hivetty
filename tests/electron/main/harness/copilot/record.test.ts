import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { copilotRecord } from '../../../../../electron/main/harness/copilot/record';

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
