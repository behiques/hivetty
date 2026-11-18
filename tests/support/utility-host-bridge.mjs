// A real Electron main for `pnpm test:pty-host` (HIVE-423).
//
//   electron tests/support/utility-host-bridge.mjs <absolute path of out/main/pty-host.js>
//
// Forks the desktop's PTY host with `utilityProcess`, exactly as `electron/main/platform.ts` does, and relays it
// over the IPC channel the test gave this process:
//   up:   { bridge: 'spawn', pid } · { bridge: 'message', message } · { bridge: 'exit', code }
//   down: { bridge: 'post', message } · { bridge: 'kill' }
// One relay hop the app does not have; the app's own path is the e2e suite's.
import { app, utilityProcess } from 'electron';

const entry = process.argv[2];
if (!entry || typeof process.send !== 'function') {
  console.error('[utility-host-bridge] needs the host entry as its argument and an IPC channel from its parent');
  app.exit(2);
} else {
  // A test run that dies leaves no Electron behind.
  process.on('disconnect', () => app.exit(0));
  const up = (frame, done) => {
    if (process.connected) process.send(frame, done);
    else done?.();
  };

  app.dock?.hide();
  // `.then`, not a top-level await: Electron fires `ready` only once the entry module has finished loading.
  void app.whenReady().then(() => {
    const child = utilityProcess.fork(entry, [], { serviceName: 'hive-pty-host-conformance' });
    child.on('spawn', () => up({ bridge: 'spawn', pid: child.pid }));
    child.on('message', (message) => up({ bridge: 'message', message }));
    child.on('exit', (code) => up({ bridge: 'exit', code }, () => app.exit(0)));
    process.on('message', (frame) => {
      if (frame?.bridge === 'post') child.postMessage(frame.message);
      else if (frame?.bridge === 'kill') child.kill();
    });
  });
}
