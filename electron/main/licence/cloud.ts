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

export const REQUEST_TIMEOUT_MS = 15_000;

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface TokenResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  deviceId: string;
  user: { email: string; name: string };
}

/**
 * `invalid_grant` is the only refusal that ends a sign-in; `refused` (any other 4xx/5xx, or an answer
 * that is not a token response) and `network` keep the stored token and back off.
 */
export type CloudErrorKind = 'invalid_grant' | 'refused' | 'network';

export class CloudError extends Error {
  readonly kind: CloudErrorKind;
  readonly description?: string;

  constructor(kind: CloudErrorKind, description?: string) {
    super(description ? `${kind}: ${description}` : kind);
    this.kind = kind;
    this.description = description;
    this.name = 'CloudError';
  }
}

export interface Cloud {
  readonly baseUrl: string;
  authorizeUrl(params: { redirectUri: string; codeChallenge: string; state: string }): string;
  token(form: Record<string, string>): Promise<TokenResponse>;
  revoke(refreshToken: string): Promise<void>;
  /** Any call against the cloud, with a timeout; a transport failure rejects as `network`. */
  request(path: string, init?: RequestInit): Promise<Response>;
}

/** A member of a parsed JSON body, if it is a non-empty string. */
export function stringField(body: unknown, name: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>)[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function parseTokenResponse(body: unknown): TokenResponse | null {
  const accessToken = stringField(body, 'access_token');
  const refreshToken = stringField(body, 'refresh_token');
  const deviceId = stringField(body, 'device_id');
  const expiresIn = (body as { expires_in?: unknown } | null)?.expires_in;
  const user = (body as { user?: unknown } | null)?.user;
  const email = stringField(user, 'email');
  if (!accessToken || !refreshToken || !deviceId || !email) return null;
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  const name = (user as { name?: unknown }).name;
  return { accessToken, expiresIn, refreshToken, deviceId, user: { email, name: typeof name === 'string' ? name : '' } };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const reason = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export function createCloud({ baseUrl, fetch }: { baseUrl: string; fetch: Fetch }): Cloud {
  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    try {
      return await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...init });
    } catch (cause) {
      throw new CloudError('network', reason(cause));
    }
  };

  const postForm = (path: string, form: Record<string, string>): Promise<Response> =>
    request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...form }).toString(),
    });

  return {
    baseUrl,
    request,
    authorizeUrl({ redirectUri, codeChallenge, state }) {
      const query = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
      });
      return `${baseUrl}/api/oauth/authorize?${query.toString()}`;
    },
    async token(form) {
      const response = await postForm('/api/oauth/token', form);
      const body = await readJson(response);
      if (!response.ok) {
        const error = stringField(body, 'error');
        const description = stringField(body, 'error_description') ?? error ?? `HTTP ${String(response.status)}`;
        throw new CloudError(error === 'invalid_grant' ? 'invalid_grant' : 'refused', description);
      }
      const parsed = parseTokenResponse(body);
      if (!parsed) throw new CloudError('refused', 'the cloud answered with something that is not a token');
      return parsed;
    },
    async revoke(refreshToken) {
      await postForm('/api/oauth/revoke', { token: refreshToken });
    },
  };
}
