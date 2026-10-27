import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  classifyFailure,
  readCopilotHeadless,
} from '../../../../../electron/main/harness/copilot/headless-reader';

const FIX = join(__dirname, '../../../../fixtures/copilot');
const usageAt = () => {
  const file = join(mkdtempSync(join(tmpdir(), 'cop-')), 'u.json');

  copyFileSync(join(FIX, 'usage-1.0.104.json'), file);
  return file;
};

describe('readCopilotHeadless', () => {
  it('says the silent answer once, at flush, across chunks', () => {
    const reader = readCopilotHeadless();

    expect(reader.push('DO')).toEqual([]);
    expect(reader.push('NE\n')).toEqual([]);
    expect(reader.flush()).toEqual([{ kind: 'say', text: 'DONE' }]);
    expect(reader.flush()).toEqual([]);
    expect(readCopilotHeadless().flush()).toEqual([]);
  });

  it('names the conversation when the usage file shows the prompt was taken (HIVE-357)', async () => {
    const events = await readCopilotHeadless(usageAt(), 'pinned').finish!(0, '');

    expect(events[0]).toEqual({ kind: 'conversation', id: 'pinned' });
    expect(events[1]).toMatchObject({ kind: 'end', stop: 'done' });
  });

  it('names none when the run failed before taking it, or there is no file', async () => {
    const failed = join(mkdtempSync(join(tmpdir(), 'cop-')), 'u.json');

    copyFileSync(join(FIX, 'usage-failed-auth-1.0.104.json'), failed);
    expect(await readCopilotHeadless(failed, 'pinned').finish!(1, '')).toEqual([
      { kind: 'end', stop: 'error', detail: 'copilot exited 1' },
    ]);
    expect(await readCopilotHeadless('/nope/u.json', 'pinned').finish!(1, '')).toEqual([
      { kind: 'end', stop: 'error', detail: 'copilot exited 1' },
    ]);
  });

  it('names the conversation on a clean exit whose usage file is missing or unread (HIVE-357)', async () => {
    // A clean exit is a run that started: only a failed one is in doubt.
    expect((await readCopilotHeadless('/nope/u.json', 'pinned').finish!(0, ''))[0]).toEqual({
      kind: 'conversation',
      id: 'pinned',
    });
  });

  it('ends done with the usage file read, then deletes it', async () => {
    const file = usageAt();
    const events = await readCopilotHeadless(file).finish!(0, '');

    expect(events).toEqual([
      {
        kind: 'end',
        stop: 'done',
        detail: 'completed',
        usage: { inputTokens: 6, outputTokens: 85, cachedTokens: 23244 },
      },
    ]);
    expect(existsSync(file)).toBe(false);
  });

  it('ends done with no usage when the file is missing, bad or names no counts', async () => {
    expect(await readCopilotHeadless('/nope/u.json').finish!(0, '')).toEqual([
      { kind: 'end', stop: 'done', detail: 'completed' },
    ]);

    const bad = usageAt();

    writeFileSync(bad, '{not json');
    expect(await readCopilotHeadless(bad).finish!(0, '')).toEqual([
      { kind: 'end', stop: 'done', detail: 'completed' },
    ]);

    const empty = usageAt();

    writeFileSync(empty, '{"tokenDetails":{}}');
    expect(await readCopilotHeadless(empty).finish!(0, '')).toEqual([
      { kind: 'end', stop: 'done', detail: 'completed' },
    ]);
    expect(await readCopilotHeadless().finish!(0, '')).toEqual([
      { kind: 'end', stop: 'done', detail: 'completed' },
    ]);
  });

  it('keeps the counts it has when only some are present', async () => {
    const partial = usageAt();

    writeFileSync(partial, '{"tokenDetails":{"output":{"tokenCount":3}}}');
    expect(await readCopilotHeadless(partial).finish!(0, '')).toEqual([
      { kind: 'end', stop: 'done', detail: 'completed', usage: { outputTokens: 3 } },
    ]);
  });

  it('ends error on a failing exit, with the reason a person reads', async () => {
    const stderr = readFileSync(join(FIX, 'stderr-bad-token-1.0.104.txt'), 'utf8');

    expect(await readCopilotHeadless().finish!(1, stderr)).toEqual([
      {
        kind: 'end',
        stop: 'error',
        detail: 'the Copilot token was refused: replace it in Settings › CLIs',
      },
    ]);
  });

  it('keeps the usage on a failing exit', async () => {
    expect(await readCopilotHeadless(usageAt()).finish!(2, 'boom')).toEqual([
      {
        kind: 'end',
        stop: 'error',
        detail: 'boom',
        usage: { inputTokens: 6, outputTokens: 85, cachedTokens: 23244 },
      },
    ]);
  });
});

describe('classifyFailure', () => {
  it('reads the headline without a 401 as a token it could not check, never a bad one (HIVE-357)', () => {
    const stderr = readFileSync(join(FIX, 'stderr-network-1.0.104.txt'), 'utf8');

    expect(classifyFailure(stderr, 1)).toBe(
      'could not check the Copilot token (it may still be valid): Failed to fetch PAT user login: network fetch failed: request failed: error sending request for url (https://api.github.com/copilot_internal/',
    );
  });

  it('still names a refused token on the 401 line', () => {
    expect(classifyFailure(readFileSync(join(FIX, 'stderr-bad-token-1.0.104.txt'), 'utf8'), 1)).toBe(
      'the Copilot token was refused: replace it in Settings › CLIs',
    );
  });

  it('names a classic token by what to store instead', () => {
    expect(classifyFailure(readFileSync(join(FIX, 'stderr-classic-pat-1.0.104.txt'), 'utf8'), 1)).toBe(
      'Copilot does not accept classic tokens (ghp_): store a fine-grained token in Settings › CLIs',
    );
  });

  it('names a token Copilot could not use at all, rather than its sign-in hint (HIVE-357)', () => {
    expect(classifyFailure(readFileSync(join(FIX, 'stderr-no-auth-1.0.104.txt'), 'utf8'), 1)).toBe(
      'Copilot found no token it could use: store an OAuth or fine-grained token in Settings › CLIs',
    );
  });

  it('reads the headline alone, with no detail line, as unchecked', () => {
    expect(classifyFailure('Error: Authentication token found but could not be validated.\n', 1)).toBe(
      'could not check the Copilot token (it may still be valid)',
    );
  });

  it('names the licence reasons, else the last stderr line, else the exit', () => {
    expect(classifyFailure('Error: You do not have an active Copilot subscription.', 1)).toBe(
      'no active Copilot subscription for this token',
    );
    expect(classifyFailure('Copilot CLI has been disabled by your organization policy', 1)).toBe(
      'Copilot CLI is disabled by an organization admin',
    );
    expect(classifyFailure('one\n\nlast line  \n', 2)).toBe('last line');
    expect(classifyFailure('', 3)).toBe('copilot exited 3');
    expect(classifyFailure('', null)).toBe('copilot was stopped');
  });

  it('reads a 401 from anything but the token as the last line', () => {
    expect(classifyFailure('MCP server foo returned HTTP 401', 1)).toBe('MCP server foo returned HTTP 401');
  });
});
