/**
 * The HiveTTY cloud, as the desktop app's one OAuth client sees it (HIVE-264, HIVE-259).
 */

/** The one public client the cloud knows (hivetty-cloud `session/domain/client.ts`). */
export const CLIENT_ID = 'hivetty-desktop';
export const PROD_CLOUD_URL = 'https://api.hivetty.dev';
export const DEV_CLOUD_URL = 'https://api.dev.hivetty.dev';

/**
 * `account.cloudUrl` (self-hosted Enterprise, HIVE-316) wins; then `HIVETTY_CLOUD_URL`, honoured only
 * unpackaged so a shipped app can never be pointed elsewhere by its environment (e2e, HIVE-270).
 */
export function resolveCloudUrl(input: {
  isPackaged: boolean;
  configUrl?: string;
  env: Record<string, string | undefined>;
}): string {
  const fromEnv = input.isPackaged ? undefined : input.env.HIVETTY_CLOUD_URL;
  const url = input.configUrl || fromEnv || (input.isPackaged ? PROD_CLOUD_URL : DEV_CLOUD_URL);
  return url.replace(/\/+$/, '');
}
