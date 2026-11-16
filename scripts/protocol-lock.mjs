/**
 * The remote protocol lock (HIVE-417).
 *
 * `REMOTE_PROTOCOL_VERSION` must be bumped whenever `CH` gains or loses a
 * channel, and #252 is the PR that forgot: a client and a host one channel
 * apart attached cleanly and then refused each other's calls. The rule lived in
 * a comment, so nothing failed when it was broken.
 *
 * `scripts/remote-protocol.lock.json` holds `{ version, channelsHash }`. The hash
 * covers `FRAME_KIND`, the one table that names every channel (it `satisfies
 * Record<Channel, …>`) together with its frame kind, which is what a client and
 * a host have to agree on to talk at all. A channel added, removed, renamed or
 * moved between `call`, `notify` and `event` changes the hash.
 *
 * - Hash changed, version did not: "channels changed: bump REMOTE_PROTOCOL_VERSION".
 * - Version changed, lock did not: update the lock.
 *
 * `node scripts/protocol-lock.mjs --write` rewrites the lock, and refuses to
 * while the channels differ from the lock at the same version, so the lock
 * cannot be used to paper over a missing bump. `verify-boundaries.mjs` runs the
 * check and proves it fires.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findConstInitializer,
  parseSource,
  propertyKey,
  stringValue,
  ts,
} from './ts-source.mjs';

export const LOCK_PATH = 'scripts/remote-protocol.lock.json';
export const IPC_CONTRACT_PATH = 'electron/shared/ipc-contract.ts';
export const REMOTE_CONTRACT_PATH = 'electron/shared/remote-contract.ts';

/** `CH`'s member name → channel string. */
function readChannelNames(ipcContract) {
  const ch = findConstInitializer(parseSource(ipcContract, IPC_CONTRACT_PATH), 'CH');
  if (!ch || !ts.isObjectLiteralExpression(ch)) {
    throw new Error(`${IPC_CONTRACT_PATH}: no \`CH\` object literal`);
  }
  const names = new Map();
  for (const property of ch.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = propertyKey(property.name);
    const value = stringValue(property.initializer);
    if (key !== null && value !== null) names.set(key, value);
  }
  return names;
}

/**
 * Every `[CH.member]: 'kind'` in `FRAME_KIND`, resolved to `[channel, kind]`
 * and sorted by channel so the hash does not depend on declaration order.
 */
export function readChannelKinds({ ipcContract, remoteContract }) {
  const names = readChannelNames(ipcContract);
  const table = findConstInitializer(
    parseSource(remoteContract, REMOTE_CONTRACT_PATH),
    'FRAME_KIND',
  );
  if (!table || !ts.isObjectLiteralExpression(table)) {
    throw new Error(`${REMOTE_CONTRACT_PATH}: no \`FRAME_KIND\` object literal`);
  }
  const pairs = [];
  for (const property of table.properties) {
    if (!ts.isPropertyAssignment(property)) {
      throw new Error(`${REMOTE_CONTRACT_PATH}: FRAME_KIND holds a non-property entry`);
    }
    const kind = stringValue(property.initializer);
    let channel = null;
    if (ts.isComputedPropertyName(property.name)) {
      const expression = property.name.expression;
      if (
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === 'CH'
      ) {
        const member = expression.name.text;
        channel = names.get(member) ?? null;
        if (channel === null) {
          throw new Error(`${REMOTE_CONTRACT_PATH}: FRAME_KIND names CH.${member}, which CH lacks`);
        }
      }
    } else {
      channel = propertyKey(property.name);
    }
    if (channel === null || kind === null) {
      throw new Error(
        `${REMOTE_CONTRACT_PATH}: FRAME_KIND entry "${property.getText()}" is not [CH.x]: 'kind'`,
      );
    }
    pairs.push([channel, kind]);
  }
  return pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The numeric literal `REMOTE_PROTOCOL_VERSION` is set to. */
export function readProtocolVersion(remoteContract) {
  const value = findConstInitializer(
    parseSource(remoteContract, REMOTE_CONTRACT_PATH),
    'REMOTE_PROTOCOL_VERSION',
  );
  if (!value || !ts.isNumericLiteral(value)) {
    throw new Error(`${REMOTE_CONTRACT_PATH}: REMOTE_PROTOCOL_VERSION is not a number literal`);
  }
  return Number(value.text);
}

/** sha256 over `channel kind` lines. */
export function hashChannels(pairs) {
  const text = pairs.map(([channel, kind]) => `${channel} ${kind}\n`).join('');
  return createHash('sha256').update(text).digest('hex');
}

/** `{ version, channelsHash }` for the given contract sources. */
export function readProtocolState(sources) {
  return {
    version: readProtocolVersion(sources.remoteContract),
    channelsHash: hashChannels(readChannelKinds(sources)),
  };
}

/** What is wrong with `state` against `lock`; empty when they agree. */
export function protocolLockProblems(state, lock) {
  if (state.version !== lock.version) {
    return [
      `REMOTE_PROTOCOL_VERSION is ${state.version} but the lock says ${lock.version}: ` +
        'update the lock (`node scripts/protocol-lock.mjs --write`)',
    ];
  }
  if (state.channelsHash !== lock.channelsHash) {
    return [
      `channels changed: bump REMOTE_PROTOCOL_VERSION (still ${state.version}) and update the lock ` +
        '(`node scripts/protocol-lock.mjs --write`)',
    ];
  }
  return [];
}

/** Read the two contracts from disk. */
export function readSources(appRoot) {
  return {
    ipcContract: readFileSync(join(appRoot, IPC_CONTRACT_PATH), 'utf8'),
    remoteContract: readFileSync(join(appRoot, REMOTE_CONTRACT_PATH), 'utf8'),
  };
}

/** Read the committed lock. */
export function readLock(appRoot) {
  return JSON.parse(readFileSync(join(appRoot, LOCK_PATH), 'utf8'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const state = readProtocolState(readSources(appRoot));
  if (process.argv.includes('--write')) {
    const lock = readLock(appRoot);
    if (state.version === lock.version && state.channelsHash !== lock.channelsHash) {
      console.error(protocolLockProblems(state, lock)[0]);
      process.exit(1);
    }
    writeFileSync(join(appRoot, LOCK_PATH), `${JSON.stringify(state, null, 2)}\n`);
    console.log(`wrote ${LOCK_PATH}: version ${state.version}`);
  } else {
    const problems = protocolLockProblems(state, readLock(appRoot));
    for (const problem of problems) console.error(problem);
    process.exit(problems.length ? 1 : 0);
  }
}
