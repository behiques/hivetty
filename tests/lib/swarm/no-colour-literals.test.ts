import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `src/lib/swarm/` paints every colour from the palette argument (HIVE-199):
 * a literal here would draw the built-in's colour under every theme. And it
 * imports nothing outside itself, so the splash (HIVE-212) can take it whole.
 */
const DIR = join(import.meta.dirname, '../../../src/lib/swarm');
const files = readdirSync(DIR).filter((f) => f.endsWith('.ts') && f !== 'phrases.ts');
const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(/i;

describe('src/lib/swarm', () => {
  it.each(files)('%s holds no colour literal', (file) => {
    expect(readFileSync(join(DIR, file), 'utf8')).not.toMatch(COLOUR);
  });

  it.each(files)('%s imports only from src/lib/swarm', (file) => {
    const specifiers = [...readFileSync(join(DIR, file), 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const spec of specifiers) expect(spec).toMatch(/^@lib\/swarm\//);
  });

  it('covers the three canvas modules', () => {
    expect(files).toEqual(expect.arrayContaining(['comb.ts', 'mutalisk.ts', 'palette.ts']));
  });
});
