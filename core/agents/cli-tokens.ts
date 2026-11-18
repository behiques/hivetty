import type {
  ClearCliTokenRequest,
  CliTokenId,
  CliTokensState,
  SetCliTokenRequest,
} from '@shared/cli-contract';

import type { SecretFile, SecretStore } from '../integrations/jira/auth';

/**
 * The tokens HiveTTY holds for a CLI's agents (HIVE-343): Copilot's, which a run gets as
 * `COPILOT_GITHUB_TOKEN` on its env and nowhere else. Stored as Slack's are (HIVE-124): one
 * `safeStorage`-encrypted JSON map in one file in `userData`.
 *
 * {@link CliTokens.read} is main-internal. No IPC verb returns it and no channel carries it;
 * {@link CliTokens.state} is presence alone, and the unit test asserts that by scanning every
 * answer serialised.
 */

/** `<userData>/cli-tokens.bin`. */
export const CLI_TOKENS_FILE = 'cli-tokens.bin';

type StoredTokens = Partial<Record<CliTokenId, string>>;

export interface CliTokens {
  state(): CliTokensState;
  save(request: SetCliTokenRequest): CliTokensState;
  clear(request: ClearCliTokenRequest): CliTokensState;
  /** **Main-internal.** There is no IPC verb that reaches this. */
  read(cli: CliTokenId): string | null;
}

const NO_ENCRYPTION =
  'This system has no keyring available to encrypt with, so no CLI token can be stored.';

export function createCliTokens(deps: { store: SecretStore; file: SecretFile }): CliTokens {
  const { store, file } = deps;

  const all = (): StoredTokens => {
    const bytes = file.read();
    if (bytes === null) return {};
    try {
      const parsed: unknown = JSON.parse(store.decryptString(bytes));
      if (typeof parsed !== 'object' || parsed === null) return {};
      const { copilot } = parsed as Record<string, unknown>;
      return typeof copilot === 'string' && copilot !== '' ? { copilot } : {};
    } catch {
      // Ciphertext this machine cannot read (a copied `userData`, a rotated OS key) is no token:
      // the remedy is to paste it again, which an empty state invites and a throw does not.
      return {};
    }
  };

  const state = (): CliTokensState => ({
    copilot: all().copilot !== undefined,
    encryptionAvailable: store.isEncryptionAvailable(),
  });

  const write = (next: StoredTokens): void => {
    if (Object.keys(next).length === 0) file.clear();
    else file.write(store.encryptString(JSON.stringify(next)));
  };

  return {
    state,
    read: (cli) => all()[cli] ?? null,
    save({ cli, token }) {
      if (!store.isEncryptionAvailable()) throw new Error(NO_ENCRYPTION);
      write({ ...all(), [cli]: token.trim() });
      return state();
    },
    clear({ cli }) {
      const { [cli]: _gone, ...rest } = all();
      write(rest);
      return state();
    },
  };
}
