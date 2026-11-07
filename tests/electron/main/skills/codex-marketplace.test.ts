// @vitest-environment node
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { writeCodexMarketplace } from '../../../../electron/main/skills/codex-marketplace';
import { readUserSkills } from '../../../../electron/main/skills/read';
import { SKILL_GUARD } from '../../../../electron/shared/skill-render';

describe('writeCodexMarketplace (HIVE-372)', () => {
  let source: string;
  let dir: string;
  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-mkt-'));
    source = join(root, 'source');
    dir = join(root, 'codex-marketplace');
    await mkdir(join(source, 'tdd'), { recursive: true });
    await writeFile(join(source, 'tdd', 'SKILL.md'), '---\nname: tdd\ndescription: Test first.\n---\nbody\n');
  });
  const write = async () =>
    writeCodexMarketplace(dir, await readUserSkills(source), { version: '0.42.0', doneUrl: null });

  it('writes a local marketplace naming one plugin, hive, at ./plugins/hive', async () => {
    await write();
    expect(JSON.parse(await readFile(join(dir, '.agents', 'plugins', 'marketplace.json'), 'utf8'))).toEqual({
      name: 'hivetty',
      plugins: [{ name: 'hive', source: { source: 'local', path: './plugins/hive' } }],
    });
  });

  it('versions the plugin <app>+<hash8> and points it at ./skills/', async () => {
    const { version } = await write();
    expect(version).toMatch(/^0\.42\.0\+[0-9a-f]{8}$/);
    const manifest = JSON.parse(await readFile(join(dir, 'plugins', 'hive', '.codex-plugin', 'plugin.json'), 'utf8'));
    expect(manifest).toMatchObject({ name: 'hive', version, skills: './skills/' });
  });

  it('guards every SKILL.md, done included, and keeps the hive- name', async () => {
    await write();
    const tdd = await readFile(join(dir, 'plugins', 'hive', 'skills', 'tdd', 'SKILL.md'), 'utf8');
    expect(tdd).toContain('name: hive-tdd');
    expect(tdd).toContain(SKILL_GUARD);
    expect(await readFile(join(dir, 'plugins', 'hive', 'skills', 'done', 'SKILL.md'), 'utf8')).toContain(SKILL_GUARD);
  });

  it('keeps the version while nothing changes and moves it when a skill does', async () => {
    const first = await write();
    expect((await write()).version).toBe(first.version);
    await writeFile(join(source, 'tdd', 'SKILL.md'), '---\nname: tdd\ndescription: Test first.\n---\nchanged\n');
    expect((await write()).version).not.toBe(first.version);
  });
});
