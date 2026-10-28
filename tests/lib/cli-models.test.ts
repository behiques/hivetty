import { afterEach, describe, expect, it, vi } from 'vitest';

import { codexModels, lastCodexModels } from '@lib/cli-models';

const LUNA = { slug: 'gpt-6-luna', description: '', defaultEffort: 'medium', efforts: ['medium'] };

const bridge = (cli: object) => {
  (window as unknown as { hive: unknown }).hive = { cli };
};

describe('codexModels', () => {
  afterEach(() => {
    delete (window as unknown as { hive?: unknown }).hive;
    vi.restoreAllMocks();
  });

  it('answers null with no bridge (the browser demo)', async () => {
    expect(await codexModels()).toBeNull();
  });

  it("answers the bridge's list", async () => {
    bridge({ codexModels: vi.fn().mockResolvedValue([LUNA]) });
    expect(await codexModels()).toEqual([LUNA]);
  });

  it('answers null, logged once, when the call rejects', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    bridge({ codexModels: vi.fn().mockRejectedValue(new Error('down')) });
    expect(await codexModels()).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('shares one read between callers that ask at once, and reads afresh after', async () => {
    const read = vi.fn().mockResolvedValue([LUNA]);
    bridge({ codexModels: read });
    expect(await Promise.all([codexModels(), codexModels(), codexModels()])).toEqual([[LUNA], [LUNA], [LUNA]]);
    expect(read).toHaveBeenCalledTimes(1);
    await codexModels();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps the last answer for a later mount to start on', async () => {
    bridge({ codexModels: vi.fn().mockResolvedValue([LUNA]) });
    await codexModels();
    expect(lastCodexModels()).toEqual([LUNA]);
  });
});
