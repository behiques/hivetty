import { describe, expect, it } from 'vitest';

import {
  RELAY_CLOSE,
  RELAY_ID,
  RELAY_PATH,
  RELAY_PING_MS,
  incomingFrame,
  parseIncoming,
  relaySocketUrl,
} from '../../../electron/shared/relay-contract';

describe('RELAY_CLOSE', () => {
  it('carries the cloud relay’s close codes', () => {
    expect(RELAY_CLOSE).toEqual({
      goingAway: 1001,
      restarting: 1012,
      unauthorized: 4401,
      notEntitled: 4403,
      notFound: 4404,
      acceptTimeout: 4408,
      replaced: 4409,
      rateLimited: 4429,
    });
  });

  it('pings at the cloud’s interval', () => {
    expect(RELAY_PING_MS).toBe(25_000);
  });
});

describe('RELAY_PATH', () => {
  it('builds the fixed and the id paths', () => {
    expect(RELAY_PATH.serve).toBe('/relay/serve');
    expect(RELAY_PATH.hosts).toBe('/relay/hosts');
    expect(RELAY_PATH.attach('dev_1')).toBe('/relay/attach/dev_1');
    expect(RELAY_PATH.accept('abc-123')).toBe('/relay/accept/abc-123');
    expect(RELAY_PATH.attach('a'.repeat(64))).toBe(`/relay/attach/${'a'.repeat(64)}`);
  });

  it.each([
    ['a slash', () => RELAY_PATH.accept('a/b')],
    ['an empty id', () => RELAY_PATH.attach('')],
    ['a query', () => RELAY_PATH.attach('x?y=1')],
    ['a 65-character id', () => RELAY_PATH.attach('a'.repeat(65))],
    ['a dot segment', () => RELAY_PATH.accept('..')],
    ['an encoded slash', () => RELAY_PATH.attach('a%2Fb')],
  ])('refuses %s', (_name, build) => {
    expect(build).toThrow('Not a relay id.');
  });

  it('matches the cloud route pattern', () => {
    expect(RELAY_ID.test('A-z_09')).toBe(true);
    expect(RELAY_ID.test('a b')).toBe(false);
  });
});

describe('parseIncoming', () => {
  it('answers the conn id of an incoming frame', () => {
    expect(parseIncoming(incomingFrame('abc-123'))).toBe('abc-123');
  });

  it.each([
    'not json',
    '[]',
    'null',
    '5',
    '"incoming"',
    '{"t":"other","conn":"abc"}',
    '{"t":"incoming","conn":"a/b"}',
    '{"t":"incoming","conn":5}',
    '{"t":"incoming"}',
  ])('answers null for %s', (text) => {
    expect(parseIncoming(text)).toBeNull();
  });
});

describe('relaySocketUrl', () => {
  it.each([
    ['https://api.hivetty.dev', 'wss://api.hivetty.dev/relay/serve'],
    ['https://api.hivetty.dev/', 'wss://api.hivetty.dev/relay/serve'],
    ['https://cloud.example/hive/', 'wss://cloud.example/hive/relay/serve'],
    ['https://cloud.example:8443/hive', 'wss://cloud.example:8443/hive/relay/serve'],
    ['http://localhost:4010', 'ws://localhost:4010/relay/serve'],
    ['http://127.0.0.1:4010', 'ws://127.0.0.1:4010/relay/serve'],
    ['http://[::1]:4010', 'ws://[::1]:4010/relay/serve'],
    ['https://user:pw@host.example', 'wss://host.example/relay/serve'],
  ])('maps %s to %s', (base, expected) => {
    expect(relaySocketUrl(base, RELAY_PATH.serve)).toBe(expected);
  });

  it('drops a query and a fragment on the base', () => {
    expect(relaySocketUrl('https://cloud.example/hive?x=1#y', RELAY_PATH.serve)).toBe(
      'wss://cloud.example/hive/relay/serve',
    );
  });

  it.each([
    'http://example.com',
    'http://localhost.example.com',
    'http://127.0.0.2',
    'ftp://example.com',
    'wss://example.com',
    'ws://localhost:4010',
  ])('refuses %s', (base) => {
    expect(() => relaySocketUrl(base, RELAY_PATH.serve)).toThrow(
      'The relay is reached only over TLS, or on loopback.',
    );
  });

  it('composes with every relay path', () => {
    const base = 'https://api.hivetty.dev';
    expect(relaySocketUrl(base, RELAY_PATH.hosts)).toBe('wss://api.hivetty.dev/relay/hosts');
    expect(relaySocketUrl(base, RELAY_PATH.attach('dev_1'))).toBe('wss://api.hivetty.dev/relay/attach/dev_1');
    expect(relaySocketUrl(base, RELAY_PATH.accept('c-1'))).toBe('wss://api.hivetty.dev/relay/accept/c-1');
  });

  // A path is pasted after the host: one that is not a relay route could move the host, the userinfo or the port.
  it.each(['.evil.com/x', '@evil.com/x', ':9/x', 'relay/serve', '/relay/serve/x', '/relay/attach/a/b', '/other', ''])(
    'refuses the path %j',
    (path) => {
      expect(() => relaySocketUrl('https://api.hivetty.dev', path)).toThrow('Not a relay path.');
    },
  );

  it.each(['nonsense', ''])('refuses the non-URL %j', (base) => {
    expect(() => relaySocketUrl(base, RELAY_PATH.serve)).toThrow('The cloud address is not a URL.');
  });
});
