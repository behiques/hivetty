import { readFile, rm } from 'node:fs/promises';

import type { RunUsage } from '@shared/agent-contract';

import type { RunEvent, RunEventReader } from '../port';

/**
 * `copilot -p -s` read into run events (HIVE-343). Under `-s` stdout is the answer and nothing
 * else, so it is one `say`. The id is pinned on the argv (`namesConversation`), the turn's end
 * comes from the hooks, and the usage comes from `--usage-output-file`, which only the exit makes
 * final. Recorded against 1.0.104 (`tests/fixtures/copilot/`).
 */

const TOKEN_REFUSED = /could not be validated|Bad credentials|\b401\b/;
// These two are unverified (no account to produce them on); upgrade from a real failure's text.
const NO_SUBSCRIPTION =
  /(no|not have an) active (copilot )?subscription|not (entitled|licensed) (to|for) copilot/i;
const ORG_DISABLED = /disabled by (your |an )?(organization|enterprise|admin)|organization policy/i;

/** The reason a person reads on a failed run: a licence problem by name, else stderr's last line. */
export function classifyFailure(stderr: string, exit: number | null): string {
  if (TOKEN_REFUSED.test(stderr)) return 'the Copilot token was refused: replace it in Settings › CLIs';
  if (NO_SUBSCRIPTION.test(stderr)) return 'no active Copilot subscription for this token';
  if (ORG_DISABLED.test(stderr)) return 'Copilot CLI is disabled by an organization admin';

  const last = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .at(-1);

  if (last !== undefined) return last.slice(0, 200);
  return exit === null ? 'copilot was stopped' : `copilot exited ${String(exit)}`;
}

const count = (value: unknown): number | undefined => {
  const tokens = (value as { tokenCount?: unknown } | undefined)?.tokenCount;

  return typeof tokens === 'number' ? tokens : undefined;
};

async function usageOf(file: string | undefined): Promise<RunUsage | undefined> {
  if (file === undefined) return undefined;

  try {
    const details = (
      JSON.parse(await readFile(file, 'utf8')) as { tokenDetails?: Record<string, unknown> }
    ).tokenDetails;
    const inputTokens = count(details?.['input']);
    const outputTokens = count(details?.['output']);
    const cachedTokens = count(details?.['cache_read']);

    if (inputTokens === undefined && outputTokens === undefined && cachedTokens === undefined) {
      return undefined;
    }
    return {
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      ...(cachedTokens === undefined ? {} : { cachedTokens }),
    };
  } catch {
    return undefined;
  } finally {
    // Read once: a later wake on this conversation that dies first must not report this one's usage.
    await rm(file, { force: true }).catch(() => undefined);
  }
}

export function readCopilotHeadless(usageFile?: string): RunEventReader {
  let said = '';

  return {
    push(chunk) {
      said += chunk;
      return [];
    },
    flush() {
      const text = said.trim();

      said = '';
      return text === '' ? [] : [{ kind: 'say', text }];
    },
    async finish(exit, stderr) {
      const usage = await usageOf(usageFile);
      const end: RunEvent =
        exit === 0
          ? { kind: 'end', stop: 'done', detail: 'completed', ...(usage === undefined ? {} : { usage }) }
          : {
              kind: 'end',
              stop: 'error',
              detail: classifyFailure(stderr, exit),
              ...(usage === undefined ? {} : { usage }),
            };

      return [end];
    },
  };
}
