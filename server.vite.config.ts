import { readFileSync } from 'node:fs';

import { defineConfig, type Plugin } from 'vite';

import { aliases } from './vite.aliases.mjs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * HIVE-422: the server edition has no Electron. Fail the build, naming the importer, the moment anything in its
 * graph resolves `electron` or an `electron/…` subpath. A relative reach into `../electron/` is the lint zone's to
 * catch, and the live suite greps the built files as the last check.
 */
const noElectron = (): Plugin => ({
  name: 'hivetty-no-electron',
  enforce: 'pre',
  resolveId(id, importer) {
    if (id === 'electron' || id.startsWith('electron/')) {
      this.error(`${importer ?? 'the server entry'} imports "${id}". The server edition has no Electron.`);
    }
    return null;
  },
});

/**
 * The SERVER target (HIVE-422): `node out/server/index.js`. A plain Vite SSR build, so dependencies stay external
 * (Vite's SSR default) and `node_modules` resolves them at run time, beside `out/server/mcp-host.js`, the MCP server
 * every session is given, launched with plain Node.
 */
export default defineConfig({
  resolve: { alias: aliases },
  plugins: [noElectron()],
  define: {
    // Literals in the bundle, never read at run time: see `server/release.ts`.
    __HIVETTY_RELEASE__: JSON.stringify(process.env.HIVETTY_RELEASE === '1'),
    __HIVETTY_VERSION__: JSON.stringify(version),
  },
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'out/server',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: { index: 'server/index.ts', 'mcp-host': 'mcp-host/index.ts' },
      output: { format: 'es', entryFileNames: '[name].js' },
    },
  },
});
