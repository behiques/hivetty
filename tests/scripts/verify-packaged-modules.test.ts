// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { forbiddenResources } from '../../scripts/verify-packaged-modules.mjs';

/** HIVE-448: the app ships no agents and no skills, so the built app's Contents/Resources must not hold them. */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hive-resources-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('forbiddenResources', () => {
  it('names agents beside the tray icon', () => {
    mkdirSync(join(dir, 'agents'));
    mkdirSync(join(dir, 'tray'));

    expect(forbiddenResources(dir)).toEqual(['agents']);
  });

  it('names nothing when only the tray icon is there', () => {
    mkdirSync(join(dir, 'tray'));

    expect(forbiddenResources(dir)).toEqual([]);
  });

  it('names skills and shipped-history.json, in that order', () => {
    writeFileSync(join(dir, 'shipped-history.json'), '{}');
    mkdirSync(join(dir, 'skills'));

    expect(forbiddenResources(dir)).toEqual(['skills', 'shipped-history.json']);
  });
});
