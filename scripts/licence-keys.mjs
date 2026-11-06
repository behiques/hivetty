// Rewrites electron/main/licence/keys.ts from each cloud's GET /api/lease/keys (HIVE-267, D2).
// An environment that does not answer keeps the keys it had, with a warning.
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../electron/main/licence/keys.ts', import.meta.url);
const CLOUDS = { prod: 'https://api.hivetty.dev', dev: 'https://api.dev.hivetty.dev' };

const source = readFileSync(FILE, 'utf8');
const start = source.indexOf('export const LEASE_KEYS');
const end = source.indexOf('\n};\n', start) + 4;
const current = Function(`return (${source.slice(source.indexOf('= {', start) + 2, end - 2)});`)();

for (const [env, url] of Object.entries(CLOUDS)) {
  try {
    const response = await fetch(`${url}/api/lease/keys`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { keys } = await response.json();
    if (!Array.isArray(keys) || keys.length !== 2) throw new Error('expected { keys: [current, next] }');
    current[env] = keys.map(({ kty, x, y, crv, kid, alg, use }) => ({ kty, x, y, crv, kid, alg, use }));
    console.log(`${env}: ${keys.map((key) => key.kid).join(', ')}`);
  } catch (cause) {
    console.warn(`${env}: kept the existing keys (${cause.message})`);
  }
}

// House style: unquoted keys, single-quoted values, trailing commas.
const keyLiteral = (key) =>
  `    {\n${Object.entries(key)
    .map(([name, value]) => `      ${name}: '${value}',\n`)
    .join('')}    },\n`;
const list = (keys) => (keys.length === 0 ? '[]' : `[\n${keys.map(keyLiteral).join('')}  ]`);
const body = `export const LEASE_KEYS: { prod: LeaseJwk[]; dev: LeaseJwk[] } = {\n  prod: ${list(current.prod)},\n  dev: ${list(current.dev)},\n};\n`;
writeFileSync(FILE, source.slice(0, start) + body + source.slice(end));
