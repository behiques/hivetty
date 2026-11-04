import type { CliSignIn } from '@shared/cli-contract';
import type { HarnessId } from '@shared/harness-contract';

const UNREAD: CliSignIn = { state: 'unknown', label: "Couldn't read the sign-in." };

/** Whether a CLI is signed in (HIVE-376), read fresh each time its Settings page opens. Never throws. */
export async function readCliSignIn(cli: HarnessId): Promise<CliSignIn> {
  const bridge = window.hive;
  if (!bridge) return UNREAD;
  try {
    return await bridge.cli.signIn({ cli });
  } catch (cause) {
    console.error('[hive] cli.signIn failed:', cause);
    return UNREAD;
  }
}
