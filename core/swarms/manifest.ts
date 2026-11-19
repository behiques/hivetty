/**
 * Read a swarm folder (HIVE-439): `swarm.json`, `agents/<name>/AGENT.md`,
 * `skills/<name>/`.
 *
 * Pure over the directory handed in, like `core/skills/bundle.ts`, so the app,
 * the installer (HIVE-441) and `scripts/validate-swarm.mjs` apply one set of
 * rules. It reports and never throws: a swarm is somebody else's repository,
 * and every way it can be wrong is a row somebody has to read.
 */
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isReservedAgentName, KNOWN_AGENT_MCP } from '@shared/agent-contract';
import {
  SWARM_MANIFEST_FILE,
  compareVersions,
  parseSwarmManifest,
  type SwarmContents,
  type SwarmManifest,
  type SwarmProblem,
} from '@shared/swarm-contract';

import { parseAgent } from '../agents/definition';
import { readSkillFolder } from '../skills/read';

export interface SwarmRead {
  manifest: SwarmManifest | null;
  contents: SwarmContents;
  problems: SwarmProblem[];
}

const NOT_FOLLOWED = 'is a symlink. A symlink is never followed.';

/** `lstat`, so the answer is about the link and never about its target. */
async function isLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false; // Nothing there. The read that follows says so.
  }
}

/**
 * The real folders under `<dir>/<kind>`, sorted.
 *
 * `Dirent` answers with `lstat`, so a link is never a directory here: it gets a
 * problem, is left out, and is never opened by this module.
 */
async function entriesOf(
  dir: string,
  kind: 'agents' | 'skills',
  problems: SwarmProblem[],
): Promise<{ folders: string[] }> {
  const root = join(dir, kind);

  if (await isLink(root)) {
    problems.push({ field: kind, reason: `${kind} ${NOT_FOLLOWED}` });
    return { folders: [] };
  }

  let listing;
  try {
    listing = await readdir(root, { withFileTypes: true });
  } catch {
    return { folders: [] }; // The swarm has no folder of this kind.
  }

  const folders: string[] = [];

  for (const entry of [...listing].sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) {
      problems.push({ field: `${kind}/${entry.name}`, reason: `${entry.name} ${NOT_FOLLOWED}` });
    } else if (entry.isDirectory()) folders.push(entry.name);
  }

  return { folders };
}

async function readManifest(dir: string, problems: SwarmProblem[]): Promise<SwarmManifest | null> {
  const path = join(dir, SWARM_MANIFEST_FILE);

  if (await isLink(path)) {
    problems.push({ field: '', reason: `${SWARM_MANIFEST_FILE} ${NOT_FOLLOWED}` });
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    problems.push({
      field: '',
      reason:
        error instanceof SyntaxError
          ? `${SWARM_MANIFEST_FILE} is not valid JSON.`
          : `No ${SWARM_MANIFEST_FILE} in this folder.`,
    });
    return null;
  }

  const parsed = parseSwarmManifest(value);
  problems.push(...parsed.problems);
  return parsed.manifest;
}

export async function readSkills(dir: string, problems: SwarmProblem[]): Promise<SwarmContents['skills']> {
  // Only real folders reach the app's own skill rules. `readUserSkills` follows
  // a linked folder for a user's own skills, so a swarm's skills are read one
  // folder at a time and a linked entry is never opened.
  const { folders } = await entriesOf(dir, 'skills', problems);
  const root = join(dir, 'skills');
  const skills: SwarmContents['skills'] = [];

  for (const name of folders) {
    const field = `skills/${name}`;

    // `readSkillFolder` reads SKILL.md with `readFile`, which follows a link.
    if (await isLink(join(root, name, 'SKILL.md'))) {
      problems.push({ field, reason: `SKILL.md ${NOT_FOLLOWED}` });
      continue;
    }

    const read = await readSkillFolder(root, name);
    if ('invalid' in read) {
      problems.push({ field, reason: read.invalid.reason });
      continue;
    }

    const { skill } = read;
    // `skipped` is a name the app never sends (`.DS_Store`); it is not a fault.
    const refused = skill.manifest.entries.find(
      (entry) => entry.excluded !== null && entry.excluded.code !== 'skipped',
    );

    if (refused?.excluded) problems.push({ field, reason: `${refused.path}: ${refused.excluded.reason}` });
    else if (skill.manifest.capped !== null) problems.push({ field, reason: skill.manifest.capped });
    else skills.push({ name: skill.name, description: skill.description });
  }

  return skills;
}

export async function readAgents(
  dir: string,
  skillNames: readonly string[],
  problems: SwarmProblem[],
): Promise<SwarmContents['agents']> {
  const { folders } = await entriesOf(dir, 'agents', problems);
  const agents: SwarmContents['agents'] = [];

  for (const name of folders) {
    const field = `agents/${name}`;
    const path = join(dir, 'agents', name, 'AGENT.md');

    if (isReservedAgentName(name)) {
      problems.push({ field, reason: `${name} is reserved by HiveTTY. Rename the folder.` });
      continue;
    }
    if (await isLink(path)) {
      problems.push({ field, reason: `AGENT.md ${NOT_FOLLOWED}` });
      continue;
    }

    let source: string;
    try {
      source = await readFile(path, 'utf8');
    } catch {
      problems.push({ field, reason: 'No AGENT.md in this folder.' });
      continue;
    }

    // A swarm's agent may name only its own swarm's skills (HIVE-441 may widen this).
    const result = parseAgent(source, {
      folder: name,
      skillNames,
      hiveSkillNames: skillNames,
      integrations: KNOWN_AGENT_MCP,
    });

    if ('problems' in result) {
      for (const problem of result.problems) {
        problems.push({
          field,
          reason: problem.field === '' ? problem.reason : `${problem.field}: ${problem.reason}`,
        });
      }
      continue;
    }

    agents.push({ name, description: result.def.description, tools: result.def.tools });
  }

  return agents;
}

export async function readSwarm(dir: string, options: { appVersion?: string } = {}): Promise<SwarmRead> {
  const problems: SwarmProblem[] = [];
  const manifest = await readManifest(dir, problems);
  const skills = await readSkills(dir, problems);
  const agents = await readAgents(
    dir,
    skills.map((skill) => skill.name),
    problems,
  );

  if (agents.length === 0 && skills.length === 0) {
    problems.push({ field: '', reason: 'A swarm needs at least one agent or one skill.' });
  }

  if (
    manifest?.minApp !== undefined &&
    options.appVersion !== undefined &&
    compareVersions(manifest.minApp, options.appVersion) > 0
  ) {
    problems.push({
      field: 'minApp',
      code: 'needs-newer-app',
      reason: `Needs HiveTTY Pro ${manifest.minApp} or newer. This is ${options.appVersion}.`,
    });
  }

  return { manifest, contents: { agents, skills }, problems };
}
