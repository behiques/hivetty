// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { baseOf } from '../../../../electron/main/seed/merge';

/**
 * The composition around `seedShipped` (HIVE-162): where it reads from, where
 * it writes to, and that it never throws into `registerIpcHandlers`.
 */

const appMock = { isPackaged: false };
vi.mock('electron', () => ({ app: appMock }));
// `tests/setup.ts` mocks the seed for every other spec (HIVE-230).
vi.unmock('../../../../electron/main/seed');

const { seedShippedIntoHive } = await import('../../../../electron/main/seed');

/** Where `out/main/` sits in the real tree, so `../../resources` is the repo's. */
const outMain = new URL('../../../../out/main', import.meta.url).pathname;

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'hive-seed-index-'));
  process.env['HIVE_CONFIG_PATH'] = join(base, 'hive', 'config.json');
  appMock.isPackaged = false;
});

afterEach(async () => {
  delete process.env['HIVE_CONFIG_PATH'];
  await rm(base, { recursive: true, force: true });
});

describe('seedShippedIntoHive', () => {
  it('seeds the repository resources beside the config file and writes the manifest there', async () => {
    const report = await seedShippedIntoHive(outMain);

    expect(report).not.toBeNull();
    expect(report?.created).toContain('skills/worktree/SKILL.md');
    const manifest = await readFile(join(base, 'hive', '.seed.json'), 'utf8');
    expect(manifest).toContain('skills/worktree/SKILL.md');
  });

  it('reads the shipped history, so a pre-manifest edit has a base', async () => {
    const shipped = await readFile(new URL('../../../../resources/agents/builder/AGENT.md', import.meta.url), 'utf8');
    await mkdir(join(base, 'hive', 'agents', 'builder'), { recursive: true });
    await writeFile(join(base, 'hive', 'agents', 'builder', 'AGENT.md'), shipped.replace(/parallel: \d+/, 'parallel: 9'), 'utf8');

    await seedShippedIntoHive(outMain);

    const manifest = JSON.parse(await readFile(join(base, 'hive', '.seed.json'), 'utf8')) as {
      parts: Record<string, { keys: Record<string, string> }>;
    };
    // With no history the edited key has no base; with it, the base is the shipped value.
    expect(manifest.parts['agents/builder/AGENT.md']?.keys['limits.parallel']).toBeDefined();
  });

  it.each(['parts', 'whole-file'] as const)(
    'adds shipped CLI models without replacing an edited Claude model (%s manifest)',
    async (kind) => {
      const names = ['builder', 'fixer', 'shipper', 'acr'];
      const files: Record<string, string> = {};
      const parts: Record<string, ReturnType<typeof baseOf>> = {};

      for (const name of names) {
        const shipped = await readFile(
          new URL(`../../../../resources/agents/${name}/AGENT.md`, import.meta.url),
          'utf8',
        );
        // The preceding release had only Claude's top-level model.
        const previous = shipped.replace(/^(?:codex|copilot):\n(?:[ \t]+.*\n)*/gm, '');
        const rel = `agents/${name}/AGENT.md`;
        files[rel] = createHash('sha256').update(previous).digest('hex');
        parts[rel] = baseOf(previous);
        await mkdir(join(base, 'hive', 'agents', name), { recursive: true });
        await writeFile(
          join(base, 'hive', rel),
          previous.replace(/^model:.*$/m, 'model: haiku # my choice'),
          'utf8',
        );
      }
      await writeFile(
        join(base, 'hive', '.seed.json'),
        JSON.stringify(kind === 'parts' ? { files, parts } : { files }),
        'utf8',
      );

      const report = await seedShippedIntoHive(outMain);

      for (const name of names) {
        const rel = `agents/${name}/AGENT.md`;
        const merged = await readFile(join(base, 'hive', rel), 'utf8');
        const builds = name === 'builder' || name === 'fixer';
        expect(merged).toContain('model: haiku # my choice\n');
        expect(merged).toContain(
          builds
            ? 'codex:\n  model: gpt-6.1-sol\n  effort: high\n'
            : 'codex:\n  model: gpt-6.1-terra\n  effort: medium\n',
        );
        expect(merged).toContain(
          builds ? 'copilot:\n  model: claude-opus-5.5\n' : 'copilot:\n  model: claude-sonnet-5.5\n',
        );
        expect(report?.merged).toContain(rel);
      }
    },
  );

  it('answers null rather than throwing when ~/.hivetty cannot be written', async () => {
    // A file where the folder should be: every mkdir under it fails.
    await mkdir(base, { recursive: true });
    await writeFile(join(base, 'hive'), 'not a folder', 'utf8');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    const report = await seedShippedIntoHive(outMain);

    expect(report).toBeNull();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('could not be seeded'));
    info.mockRestore();
  });
});
