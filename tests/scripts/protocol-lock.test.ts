import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  hashChannels,
  protocolLockProblems,
  readChannelKinds,
  readProtocolState,
  readProtocolVersion,
} from '../../scripts/protocol-lock.mjs';

const appRoot = join(__dirname, '..', '..');

const IPC = `
export const CH = {
  configGet: 'config:get',
  /** a comment */
  ptyWrite: 'pty:write',
  ptyData: 'pty:data',
} as const;
`;

const REMOTE = `
import { CH } from './ipc-contract';
export const REMOTE_PROTOCOL_VERSION = 7;
export const FRAME_KIND = {
  [CH.configGet]: 'call',
  [CH.ptyWrite]: 'notify',
  [CH.ptyData]: 'event',
} as const satisfies Record<Channel, string>;
`;

describe('readChannelKinds', () => {
  it('resolves every FRAME_KIND key through CH, sorted by channel', () => {
    expect(readChannelKinds({ ipcContract: IPC, remoteContract: REMOTE })).toEqual([
      ['config:get', 'call'],
      ['pty:data', 'event'],
      ['pty:write', 'notify'],
    ]);
  });

  it('throws on a FRAME_KIND key CH does not define, rather than hashing a hole', () => {
    const remote = REMOTE.replace('[CH.ptyData]', '[CH.nope]');
    expect(() => readChannelKinds({ ipcContract: IPC, remoteContract: remote })).toThrow(
      /CH\.nope/,
    );
  });

  it('throws when a CH channel is absent from FRAME_KIND, rather than hashing a partial table', () => {
    const remote = REMOTE.replace("  [CH.ptyData]: 'event',\n", '');
    expect(() => readChannelKinds({ ipcContract: IPC, remoteContract: remote })).toThrow(
      /pty:data/,
    );
  });

  it('throws when FRAME_KIND is missing', () => {
    expect(() =>
      readChannelKinds({ ipcContract: IPC, remoteContract: 'export const X = 1;' }),
    ).toThrow(/FRAME_KIND/);
  });
});

describe('readProtocolVersion', () => {
  it('reads the numeric literal', () => {
    expect(readProtocolVersion(REMOTE)).toBe(7);
  });

  it('throws when the constant is absent', () => {
    expect(() => readProtocolVersion('export const X = 1;')).toThrow(
      /REMOTE_PROTOCOL_VERSION/,
    );
  });
});

describe('hashChannels', () => {
  it('is stable for the same pairs and changes when a pair changes', () => {
    const pairs: Array<[string, string]> = [
      ['a', 'call'],
      ['b', 'event'],
    ];
    expect(hashChannels(pairs)).toBe(hashChannels([...pairs]));
    expect(hashChannels(pairs)).not.toBe(hashChannels([['a', 'call'], ['b', 'notify']]));
    expect(hashChannels(pairs)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('protocolLockProblems', () => {
  const state = readProtocolState({ ipcContract: IPC, remoteContract: REMOTE });

  it('passes when version and hash both match the lock', () => {
    expect(protocolLockProblems(state, { ...state })).toEqual([]);
  });

  it("fires on #252's miss: a channel added with no version bump", () => {
    const ipc = IPC.replace("} as const;", "  probeNew: 'probe:new',\n} as const;");
    const remote = REMOTE.replace(
      '} as const satisfies',
      "  [CH.probeNew]: 'call',\n} as const satisfies",
    );
    const planted = readProtocolState({ ipcContract: ipc, remoteContract: remote });
    const problems = protocolLockProblems(planted, state);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/channels changed: bump REMOTE_PROTOCOL_VERSION/);
  });

  it('fires when a channel changes kind with no bump', () => {
    const remote = REMOTE.replace("[CH.ptyWrite]: 'notify'", "[CH.ptyWrite]: 'call'");
    const planted = readProtocolState({ ipcContract: IPC, remoteContract: remote });
    expect(protocolLockProblems(planted, state)[0]).toMatch(/channels changed/);
  });

  it('fires when the version was bumped but the lock was not updated', () => {
    const problems = protocolLockProblems({ ...state, version: 8 }, state);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/is 8 but the lock says 7/);
  });
});

describe('the committed lock', () => {
  it('matches the contract on this tree', () => {
    const state = readProtocolState({
      ipcContract: readFileSync(join(appRoot, 'shared/ipc-contract.ts'), 'utf8'),
      remoteContract: readFileSync(
        join(appRoot, 'shared/remote-contract.ts'),
        'utf8',
      ),
    });
    const lock = JSON.parse(
      readFileSync(join(appRoot, 'scripts/remote-protocol.lock.json'), 'utf8'),
    );
    expect(protocolLockProblems(state, lock)).toEqual([]);
  });
});
