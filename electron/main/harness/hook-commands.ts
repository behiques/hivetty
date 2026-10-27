import {
  FENCE_PATH,
  HOOK_ENV_RECEIVER_URL,
  HOOK_ENV_RUN,
  HOOK_ENV_RUN_TOKEN,
  HOOK_ENV_SESSION,
  HOOK_ENV_TOKEN,
  HOOK_HEADER_HARNESS,
  HOOK_HEADER_RUN,
  HOOK_HEADER_RUN_TOKEN,
  HOOK_HEADER_SESSION,
  HOOK_HEADER_TOKEN,
  HOOK_PATH,
} from '@shared/hook-contract';

/**
 * The `sh` commands a hook-configured CLI runs (HIVE-342, shared with copilot by HIVE-343). They
 * read the identity from the run's environment by name, as the container transport does, so no
 * value is written into a CLI's config.
 */

/** Single quotes for `sh`, a `'` inside written as `'\''`. */
export const shellQuote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

const harnessHeader = (harness?: string): string =>
  harness === undefined ? '' : ` -H '${HOOK_HEADER_HARNESS}: ${harness}'`;

/** POSTs stdin to `/hook`. `wrap` names the event for a CLI whose bodies do not (copilot). */
export const hookCommand = (opts: { harness?: string; wrap?: string } = {}): string =>
  `${
    opts.wrap === undefined
      ? ''
      : `{ printf '%s' ${shellQuote(`{"event":${JSON.stringify(opts.wrap)},"payload":`)}; cat; printf '}'; } | `
  }` +
  `curl -sS -m 3 -X POST "$${HOOK_ENV_RECEIVER_URL}${HOOK_PATH}"` +
  ` -H 'content-type: application/json'` +
  ` -H "${HOOK_HEADER_SESSION}: $${HOOK_ENV_SESSION}"` +
  ` -H "${HOOK_HEADER_TOKEN}: $${HOOK_ENV_TOKEN}"${harnessHeader(opts.harness)}` +
  ` --data-binary @- >/dev/null 2>&1 || true`;

/**
 * POSTs stdin to `/fence`; prints `denyJson` when no non-empty answer comes back. Fails closed: a
 * receiver that is down, slow, refusing or silent gives the deny, never the empty reply a CLI would
 * run.
 */
export const fenceCommand = ({ denyJson, harness }: { denyJson: string; harness?: string }): string =>
  `out=$(curl -sf -m 30 -X POST "$${HOOK_ENV_RECEIVER_URL}${FENCE_PATH}"` +
  ` -H 'content-type: application/json'` +
  ` -H "${HOOK_HEADER_SESSION}: $${HOOK_ENV_SESSION}" -H "${HOOK_HEADER_TOKEN}: $${HOOK_ENV_TOKEN}"` +
  ` -H "${HOOK_HEADER_RUN}: $${HOOK_ENV_RUN}" -H "${HOOK_HEADER_RUN_TOKEN}: $${HOOK_ENV_RUN_TOKEN}"${harnessHeader(harness)}` +
  ` --data-binary @- 2>/dev/null) && [ -n "$out" ] && printf '%s' "$out"` +
  ` || printf '%s' ${shellQuote(denyJson)}`;
