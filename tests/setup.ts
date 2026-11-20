import '@testing-library/jest-dom/vitest';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, vi } from 'vitest';

/**
 * No test reaches the developer's real home folder. `os.homedir()` reads
 * `HOME`, so every `~/.hivetty` path the main process builds lands here instead.
 *
 * `registerIpcHandlers` once seeded `~/.hivetty` at start-up (adoption alone
 * since HIVE-448), and the ipc specs that never set `HIVE_CONFIG_PATH` wrote
 * the real `~/.hivetty/.seed.json` on every run. Per spec rather
 * than per `HIVE_CONFIG_PATH` so a spec that deletes that variable in its
 * `afterEach` falls back here, not to the real folder.
 *
 * Not under a live proof (`pnpm test:hooks` and its siblings set a
 * `HIVE_LIVE_*_PROOF` flag): those drive a real `claude`, which needs the real
 * home for its login, and they isolate their own `HIVE_*` paths.
 */
if (
  !Object.entries(process.env).some(
    ([key, value]) => /^HIVE_LIVE_\w+_PROOF$/.test(key) && value === '1',
  )
) {
  const home = mkdtempSync(join(tmpdir(), 'hive-test-home-'));
  process.env['HOME'] = home;
  afterAll(() => {
    rmSync(home, { recursive: true, force: true });
  });
}

/**
 * No spec adopts `~/.hivetty` behind its own back (HIVE-230, HIVE-448). `registerIpcHandlers` starts boot's adoption
 * without awaiting it, so a spec could end with it still writing `swarms/adopted` while the `afterAll` above removes
 * the folder: ENOTEMPTY from `rmSync`. Mocked here, beside the teardown it races; the specs about adoption opt back in
 * with `vi.unmock`.
 */
vi.mock('../core/swarms', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/swarms')>()),
  adopt: () => Promise.resolve(),
}));

/**
 * happy-dom does not implement ResizeObserver, which the terminal surface uses
 * to refit xterm when its container changes size. Stub it so components can
 * mount; observed-size behaviour is asserted in Playwright (story 070).
 */
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  } as unknown as typeof globalThis.ResizeObserver;
}

/**
 * Unmount anything a test rendered. Without this, `screen` queries in a later
 * test can match a previous test's DOM and pass for the wrong reason.
 */
afterEach(() => {
  cleanup();
});
