/**
 * Types for `protocol-lock.mjs`.
 *
 * The script stays `.mjs` because `verify-boundaries.mjs` runs it under bare
 * `node`, with no build step to compile a `.ts`. This declaration is what lets
 * it be unit-tested from the TypeScript test tree.
 */

export interface ContractSources {
  ipcContract: string;
  remoteContract: string;
}

export interface ProtocolState {
  version: number;
  channelsHash: string;
}

export const LOCK_PATH: string;
export const IPC_CONTRACT_PATH: string;
export const REMOTE_CONTRACT_PATH: string;

export function readChannelKinds(sources: ContractSources): Array<[string, string]>;

export function readProtocolVersion(remoteContract: string): number;

export function hashChannels(pairs: Array<[string, string]>): string;

export function readProtocolState(sources: ContractSources): ProtocolState;

export function protocolLockProblems(state: ProtocolState, lock: ProtocolState): string[];

export function readSources(appRoot: string): ContractSources;

export function readLock(appRoot: string): ProtocolState;
