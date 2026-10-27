// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { CLI_TOKENS_FILE, createCliTokens } from '../../../../electron/main/agents/cli-tokens';
import type { SecretFile, SecretStore } from '../../../../electron/main/integrations/jira/auth';

/** Reversible, not secure — the point is the round trip, not the cipher. */
const fakeStore = (available = true): SecretStore => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
  decryptString: (cipher) => {
    const text = cipher.toString('utf8');
    if (!text.startsWith('enc:')) throw new Error('not mine');
    return text.slice(4);
  },
});

const fakeFile = (initial: Buffer | null = null): SecretFile & { bytes: () => Buffer | null } => {
  let bytes = initial;
  return {
    bytes: () => bytes,
    read: () => bytes,
    write: (b) => {
      bytes = b;
    },
    clear: () => {
      bytes = null;
    },
  };
};

describe('createCliTokens (HIVE-343)', () => {
  it('lives in its own file', () => {
    expect(CLI_TOKENS_FILE).toBe('cli-tokens.bin');
  });

  it('holds nothing before anything is saved', () => {
    const tokens = createCliTokens({ store: fakeStore(), file: fakeFile() });

    expect(tokens.state()).toEqual({ copilot: false, encryptionAvailable: true });
    expect(tokens.read('copilot')).toBeNull();
  });

  it('stores the trimmed token and reads it back', () => {
    const tokens = createCliTokens({ store: fakeStore(), file: fakeFile() });

    expect(tokens.save({ cli: 'copilot', token: '  gho_abc \n' })).toEqual({
      copilot: true,
      encryptionAvailable: true,
    });
    expect(tokens.read('copilot')).toBe('gho_abc');
    expect(tokens.state()).toEqual({ copilot: true, encryptionAvailable: true });
  });

  it('forgets the token on clear', () => {
    const tokens = createCliTokens({ store: fakeStore(), file: fakeFile() });

    tokens.save({ cli: 'copilot', token: 'gho_abc' });
    expect(tokens.clear({ cli: 'copilot' })).toEqual({ copilot: false, encryptionAvailable: true });
    expect(tokens.read('copilot')).toBeNull();
  });

  it('reads bytes it cannot decrypt, or that hold no map, as no token', () => {
    expect(
      createCliTokens({ store: fakeStore(), file: fakeFile(Buffer.from('junk')) }).read('copilot'),
    ).toBeNull();
    expect(
      createCliTokens({ store: fakeStore(), file: fakeFile(Buffer.from('enc:null')) }).read('copilot'),
    ).toBeNull();
    expect(
      createCliTokens({
        store: fakeStore(),
        file: fakeFile(Buffer.from('enc:{"copilot":7}')),
      }).read('copilot'),
    ).toBeNull();
  });

  it('refuses to save with no keyring, and writes nothing', () => {
    const file = fakeFile();
    const tokens = createCliTokens({ store: fakeStore(false), file });

    expect(() => tokens.save({ cli: 'copilot', token: 'gho_abc' })).toThrow(/keyring/);
    expect(file.bytes()).toBeNull();
    expect(tokens.state()).toEqual({ copilot: false, encryptionAvailable: false });
  });

  it('never answers with the token: every verb is presence only', () => {
    const tokens = createCliTokens({ store: fakeStore(), file: fakeFile() });
    const answers = [
      tokens.save({ cli: 'copilot', token: 'gho_secret' }),
      tokens.state(),
      tokens.clear({ cli: 'copilot' }),
    ];

    for (const answer of answers) expect(JSON.stringify(answer)).not.toContain('gho_secret');
  });

  it('never writes the token in the clear', () => {
    const file = fakeFile();

    createCliTokens({ store: fakeStore(), file }).save({ cli: 'copilot', token: 'gho_secret' });
    expect(file.bytes()?.toString('utf8').startsWith('enc:')).toBe(true);
  });
});
