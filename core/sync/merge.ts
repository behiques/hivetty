/** One synced thing as one side has it: a config key's value or a file's base64, its hash, and when it changed. */
export interface Item {
  hash: string;
  at: number;
  data: unknown;
}
export type View = Record<string, Item>;

export interface MergeResult {
  /** What both sides should hold afterwards. */
  merged: View;
  /** What to write on this Mac. */
  set: View;
  /** What to remove on this Mac. */
  remove: string[];
  /** The losing copy of each id both sides changed differently. */
  conflicts: View;
  /** Whether `merged` differs from `remote`. */
  push: boolean;
}

/**
 * Three-way, per id, against the hash each id had when this Mac last agreed with the cloud (HIVE-284). A
 * missing entry means "not there", so a delete is told from "never existed" by the base. On a first join there
 * is no base, and where both sides differ the synced copy wins whatever the times say.
 */
export function merge(base: Record<string, string>, local: View, remote: View, firstJoin: boolean): MergeResult {
  const result: MergeResult = { merged: {}, set: {}, remove: [], conflicts: {}, push: false };
  for (const id of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const was = base[id];
    const mine = local[id];
    const theirs = remote[id];
    let winner: Item | undefined;
    if (mine?.hash === theirs?.hash) winner = mine;
    else if (theirs?.hash === was) winner = mine;
    else if (mine?.hash === was) winner = theirs;
    else if (!mine || !theirs) winner = mine ?? theirs;
    else {
      const remoteWins = firstJoin || theirs.at >= mine.at;
      winner = remoteWins ? theirs : mine;
      result.conflicts[id] = remoteWins ? mine : theirs;
    }
    if (winner) result.merged[id] = winner;
    if (winner?.hash !== mine?.hash) {
      if (winner) result.set[id] = winner;
      else result.remove.push(id);
    }
    if (winner?.hash !== theirs?.hash) result.push = true;
  }
  return result;
}
