/**
 * Install reports (HIVE-442 against HIVE-443's route): one `POST /api/swarms/:id/installs` per install, update,
 * removal or `no_access` failure. The cloud counts installs from these and, for an organization swarm it cannot
 * read, learns the contents from the first app that installs a version. A report never blocks an install.
 */
import type { SwarmContents, SwarmEntry, SwarmInstallResult } from '@shared/swarm-contract';

import type { AuthedFetch } from './registry';

export type InstallReport =
  | { state: 'installed'; version: string; contents?: SwarmContents & { title: string; description: string } }
  | { state: 'no_access' }
  | { state: 'removed'; version: string };

/** What an install's outcome reports, or null when it reports nothing. */
export function reportFor(entry: SwarmEntry, result: SwarmInstallResult): InstallReport | null {
  if (!result.ok) return result.failure.code === 'no_access' ? { state: 'no_access' } : null;
  const { installed } = result;
  if (entry.kind !== 'organization') return { state: 'installed', version: installed.version };
  return {
    state: 'installed',
    version: installed.version,
    contents: {
      title: installed.title,
      // An entry written before HIVE-442 has no description, and an empty one says nothing either.
      description: installed.description || entry.description,
      agents: installed.contents.agents,
      skills: installed.contents.skills,
    },
  };
}

export async function reportInstall(
  authedFetch: AuthedFetch | null,
  swarmId: string,
  report: InstallReport,
): Promise<void> {
  if (authedFetch === null) return;
  try {
    // The answer is not read: 404 until the route ships, 400 and 429 change nothing here.
    await authedFetch(`/api/swarms/${encodeURIComponent(swarmId)}/installs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
  } catch {
    // Offline or signed out: the install already happened.
  }
}
