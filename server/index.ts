import { join } from 'node:path';

import { fileBackedIo } from '../core/server/file-backed-io';
import { runOneShot } from '../core/server/one-shot';

import { bootServer, runServerAccount } from './boot';
import { dispatch } from './dispatch';
import { checkHealth, HEARTBEAT_FILE } from './heartbeat';
import { applyHome } from './home';
import { installLogPrefix } from './log';
import { installSignals } from './signals';

/*
  hivetty-server (HIVE-422): `node out/server/index.js`. The only server file with a side effect at import.
  First, for every invocation: `--pair` writes the same config.json the server reads.
*/
const dataDir = applyHome(process.env);

const code = await dispatch(process.argv, {
  health: () => checkHealth(join(dataDir, HEARTBEAT_FILE)),
  oneShot: (invocation) => runOneShot(invocation, fileBackedIo()),
  account: (invocation) => runServerAccount(invocation, dataDir),
  serve: () => {
    installLogPrefix();
    const server = bootServer({ dataDir, listen: true });
    installSignals({ quit: (exit) => void server.quit(exit), exitNow: (exit) => process.exit(exit) });
  },
  print: (line) => console.log(line),
});
if (code !== null) process.exit(code);
