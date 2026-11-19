import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { fileBackedIo } from '../core/server/file-backed-io';
import { runOneShot } from '../core/server/one-shot';

import { bootServer, runServerAccount } from './boot';
import { dispatch } from './dispatch';
import { checkHealth, HEARTBEAT_FILE } from './heartbeat';
import { applyHome } from './home';
import { installLogPrefix } from './log';
import { generateKey, loadKey } from './secrets/key';
import { installSignals } from './signals';

/*
  hivetty-server (HIVE-422): `node out/server/index.js`. The only server file with a side effect at import.
  First, for every invocation: `--pair` writes the same config.json the server reads.
*/
const dataDir = applyHome(process.env);
// Next, before anything can spawn: read the key and take it out of the environment (HIVE-424).
const key = loadKey(process.env, { readFile: (path) => readFileSync(path, 'utf8'), homeDir: dirname(dataDir) });

const code = await dispatch(process.argv, {
  health: () => checkHealth(join(dataDir, HEARTBEAT_FILE)),
  genKey: generateKey,
  key,
  oneShot: (invocation) => runOneShot(invocation, fileBackedIo()),
  account: (invocation, secret) => runServerAccount(invocation, dataDir, secret),
  serve: (secret) => {
    installLogPrefix();
    const server = bootServer({ dataDir, listen: true, key: secret });
    installSignals({ quit: (exit) => void server.quit(exit), exitNow: (exit) => process.exit(exit) });
  },
  print: (line) => console.log(line),
});
if (code !== null) process.exit(code);
