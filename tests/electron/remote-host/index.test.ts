import { describe, expect, it } from 'vitest';

import { REMOTE_PROTOCOL_VERSION } from '@shared/remote-contract';

import { refusePlaintextClient, refuseProtocol } from '../../../electron/remote-host';

/**
 * The server half's only logic so far (HIVE-141).
 *
 * Small enough to look self-evident, which is exactly why it is tested: the
 * equal-version case below produced "client speaks 1, server speaks 1. Update
 * the server." until review caught it, and it is the one refusal every future
 * handshake path funnels through.
 */

describe('refuseProtocol', () => {
  it('tells an older client to update itself', () => {
    const refusal = refuseProtocol(REMOTE_PROTOCOL_VERSION - 1);

    expect(refusal.code).toBe('protocol-mismatch');
    expect(refusal.message).toContain('Update the client');
  });

  it('tells a newer client that the server is behind', () => {
    const refusal = refuseProtocol(REMOTE_PROTOCOL_VERSION + 1);

    expect(refusal.message).toContain('Update the server');
  });

  it('names both versions, so a mismatch reads without a second round trip', () => {
    const refusal = refuseProtocol(REMOTE_PROTOCOL_VERSION + 7);

    expect(refusal.message).toContain(String(REMOTE_PROTOCOL_VERSION + 7));
    expect(refusal.message).toContain(String(REMOTE_PROTOCOL_VERSION));
  });

  it('does not tell anyone to update when the versions already agree', () => {
    const refusal = refuseProtocol(REMOTE_PROTOCOL_VERSION);

    expect(refusal.message).not.toContain('Update the');
    expect(refusal.message).toContain('another reason');
  });

  it('always reports the server version it actually speaks', () => {
    for (const client of [0, 1, 2, 99]) {
      expect(refuseProtocol(client).protocol).toBe(REMOTE_PROTOCOL_VERSION);
    }
  });
});

describe('refusePlaintextClient (HIVE-428)', () => {
  it('tells a client that spoke in the clear to update, naming the protocol and the channel', () => {
    const refusal = refusePlaintextClient();

    expect(refusal).toMatchObject({
      kind: 'attach-refused',
      code: 'protocol-mismatch',
      protocol: REMOTE_PROTOCOL_VERSION,
    });
    expect(refusal.message).toContain(String(REMOTE_PROTOCOL_VERSION));
    expect(refusal.message).toContain('encrypted channel');
    expect(refusal.message).toContain('Update the client');
  });
});
