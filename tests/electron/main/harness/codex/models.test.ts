import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readCodexModels } from '../../../../../electron/main/harness/codex/models';

const levels = (...efforts: string[]) => efforts.map((effort) => ({ effort, description: effort }));

/** A `CODEX_HOME` whose `models_cache.json` holds `body`, as 0.165 writes it. */
const homeWith = (body: unknown): string => {
  const home = mkdtempSync(join(tmpdir(), 'codex-models-'));
  writeFileSync(join(home, 'models_cache.json'), typeof body === 'string' ? body : JSON.stringify(body));
  return home;
};

describe('codex models', () => {
  it("reads the listed models in Codex's priority order, with their own efforts", async () => {
    const home = homeWith({
      fetched_at: '2026-10-28T00:00:00Z',
      models: [
        { slug: 'gpt-6-luna', description: 'Fast.', visibility: 'list', priority: 5, default_reasoning_level: 'medium', supported_reasoning_levels: levels('low', 'medium', 'max') },
        { slug: 'gpt-reserve', description: 'Hidden.', visibility: 'hide', priority: 4, default_reasoning_level: 'medium', supported_reasoning_levels: levels('low') },
        { slug: 'gpt-6.1-sol', description: 'Workhorse.', visibility: 'list', priority: 1, default_reasoning_level: 'low', supported_reasoning_levels: levels('low', 'ultra', 'galaxy') },
      ],
    });
    expect(await readCodexModels(() => home)).toEqual([
      { slug: 'gpt-6.1-sol', description: 'Workhorse.', defaultEffort: 'low', efforts: ['low', 'ultra'] },
      { slug: 'gpt-6-luna', description: 'Fast.', defaultEffort: 'medium', efforts: ['low', 'medium', 'max'] },
    ]);
  });

  it('drops an entry it cannot pass to codex safely, or one with no effort it knows', async () => {
    const home = homeWith({
      models: [
        { slug: 'gpt 6; rm', visibility: 'list', priority: 1, default_reasoning_level: 'low', supported_reasoning_levels: levels('low') },
        { slug: 'gpt-6-sol', visibility: 'list', priority: 2, default_reasoning_level: 'low', supported_reasoning_levels: levels('galaxy') },
        { slug: 'gpt-6-astra', visibility: 'list', priority: 3, default_reasoning_level: 'galaxy', supported_reasoning_levels: levels('high', 'max') },
      ],
    });
    expect(await readCodexModels(() => home)).toEqual([
      // An unknown default falls to the model's first known effort; a missing description is ''.
      { slug: 'gpt-6-astra', description: '', defaultEffort: 'high', efforts: ['high', 'max'] },
    ]);
  });

  it.each([['missing', '/nonexistent'], ['not json', homeWith('{')], ['no models array', homeWith({ models: 3 })]])(
    'answers [] for a cache that is %s',
    async (_why, home) => {
      expect(await readCodexModels(() => home)).toEqual([]);
    },
  );
});
