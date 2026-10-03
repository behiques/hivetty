// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  IpcValidationError,
  parsePrCommentRequest,
  parsePrDetailRequest,
  parsePrRunsRequest,
  parseRunRef,
} from '../../../electron/shared/guards';

/** The PR page's two payloads (HIVE-205): a repository, a number, and a comment's body. */
describe('parsePrDetailRequest', () => {
  it('accepts an owner, a repository and a positive whole number', () => {
    expect(parsePrDetailRequest({ owner: 'acme', repo: 'nova-web.v2_x', n: 482 })).toEqual({ owner: 'acme', repo: 'nova-web.v2_x', n: 482 });
  });

  it.each([
    ['a fractional number', { owner: 'acme', repo: 'web', n: 1.5 }],
    ['zero', { owner: 'acme', repo: 'web', n: 0 }],
    ['a numeric string', { owner: 'acme', repo: 'web', n: '482' }],
    ['an unsafe integer', { owner: 'acme', repo: 'web', n: 2 ** 53 }],
    ['an owner with a slash', { owner: 'acme/x', repo: 'web', n: 1 }],
    ['an owner starting with a hyphen', { owner: '-acme', repo: 'web', n: 1 }],
    ['a repository of ..', { owner: 'acme', repo: '..', n: 1 }],
    ['a repository with a space', { owner: 'acme', repo: 'a b', n: 1 }],
    ['an extra key', { owner: 'acme', repo: 'web', n: 1, host: 'evil' }],
    ['a missing key', { owner: 'acme', repo: 'web' }],
  ])('refuses %s', (_name, input) => {
    expect(() => parsePrDetailRequest(input)).toThrow(IpcValidationError);
  });
});

describe('parsePrCommentRequest', () => {
  const ref = { owner: 'acme', repo: 'web', n: 7 };

  it('keeps the body as written, newlines and tabs included', () => {
    expect(parsePrCommentRequest({ ...ref, body: 'Line one\n\n\t- two' })).toEqual({ ...ref, body: 'Line one\n\n\t- two' });
  });

  it('accepts GitHub’s limit and refuses one character over it', () => {
    expect(parsePrCommentRequest({ ...ref, body: 'x'.repeat(65_536) }).body).toHaveLength(65_536);
    expect(() => parsePrCommentRequest({ ...ref, body: 'x'.repeat(65_537) })).toThrow(IpcValidationError);
  });

  it.each([
    ['a blank body', { ...ref, body: ' \n ' }],
    ['a control character', { ...ref, body: 'bell\u0007' }],
    ['a non-string body', { ...ref, body: 42 }],
    ['an unmapped number', { ...ref, n: -1, body: 'hi' }],
  ])('refuses %s', (_name, input) => {
    expect(() => parsePrCommentRequest(input)).toThrow(IpcValidationError);
  });
});

describe('Checks payloads (HIVE-206)', () => {
  it('accepts a repository and a branch', () => {
    expect(parsePrRunsRequest({ owner: 'acme', repo: 'nova-web', branch: 'feat/hive-206-x' }))
      .toEqual({ owner: 'acme', repo: 'nova-web', branch: 'feat/hive-206-x' });
  });

  it.each(['', '-x', 'a b', 'a\tb', 'a\u0000b', 'x'.repeat(256)])('refuses the branch %j', (branch) => {
    expect(() => parsePrRunsRequest({ owner: 'acme', repo: 'nova-web', branch })).toThrow(/prRuns\.branch/);
  });

  it('refuses a malformed owner as prDetail does', () => {
    expect(() => parsePrRunsRequest({ owner: '-acme', repo: 'nova-web', branch: 'main' })).toThrow(/prRuns\.owner/);
  });

  it('accepts a positive whole id', () => {
    expect(parseRunRef({ owner: 'acme', repo: 'nova-web', id: 2207 }, 'runJobs')).toEqual({ owner: 'acme', repo: 'nova-web', id: 2207 });
  });

  it.each([0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1, null])('refuses the id %j', (id) => {
    expect(() => parseRunRef({ owner: 'acme', repo: 'nova-web', id }, 'jobLog')).toThrow(/jobLog\.id/);
  });

  it('refuses an extra key', () => {
    expect(() => parseRunRef({ owner: 'acme', repo: 'nova-web', id: 1, cmd: 'x' }, 'rerunFailed')).toThrow();
  });
});
