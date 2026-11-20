// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseAgent, readFrontmatter } from '../../core/agents/definition';
import { AGENT_PREAMBLE } from '../../core/agents/preamble';
import { systemPromptFor } from '../../core/agents/waker';
import { parseList } from '../../shared/agent-contract';
import { HAS_SWARM, SWARM_DIR } from '../support/swarm-tree';

/** The swarm's agents, read through the parser (moved from tests/core/agents/definition.test.ts, HIVE-448). */
const ROOT = SWARM_DIR;

/** As definition.test.ts's helper reads them: its BASE, with each agent's own folder and skills. */
const BASE = { integrations: ['slack'] };

const definition = (source: string, over: { folder: string; skillNames: string[]; hiveSkillNames: string[] }) => {
  const result = parseAgent(source, { ...BASE, ...over });

  if ('problems' in result) {
    throw new Error(`expected a definition: ${JSON.stringify(result.problems)}`);
  }

  return result.def;
};

describe.skipIf(!HAS_SWARM)('codex: and copilot: blocks in the shipped agents (HIVE-396)', () => {
  it('parses every shipped agent with a model for each CLI', () => {
    const root = join(ROOT, 'agents');
    const folders = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());

    expect(folders.length).toBeGreaterThan(0);
    for (const folder of folders) {
      const source = readFileSync(join(root, folder.name, 'AGENT.md'), 'utf8');
      // The skills each file declares, as `parseForWake` reads them: the machine's catalog is not the question here.
      const declared = parseList(readFrontmatter(source)?.fields.get('skills')?.value ?? '[]') ?? [];
      const def = definition(source, { folder: folder.name, skillNames: declared, hiveSkillNames: [] });

      const builds = folder.name === 'builder' || folder.name === 'fixer';
      expect(def.model).toBe(builds ? 'opus' : 'sonnet');
      expect(def.codex).toEqual({
        model: builds ? 'gpt-6.1-sol' : 'gpt-6.1-terra',
        // acr reviews at high effort from Dev Squad 1.1.0: its verifier decides what reaches a PR.
        effort: builds || (folder.name === 'acr' && def.codex?.effort === 'high') ? 'high' : 'medium',
      });
      expect(def.copilot).toEqual({
        model: builds ? 'claude-opus-5.5' : 'claude-sonnet-5.5',
      });
    }
  });

  it('renders the run contract exactly once in every shipped agent prompt (HIVE-413)', () => {
    const root = join(ROOT, 'agents');
    const folders = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());

    for (const folder of folders) {
      const source = readFileSync(join(root, folder.name, 'AGENT.md'), 'utf8');
      const declared = parseList(readFrontmatter(source)?.fields.get('skills')?.value ?? '[]') ?? [];
      const def = definition(source, { folder: folder.name, skillNames: declared, hiveSkillNames: [] });

      const prompt = systemPromptFor(AGENT_PREAMBLE, def);
      expect(prompt.match(/\*\*Run contract\*\*/g), folder.name).toHaveLength(1);
    }
  });
});

describe.skipIf(!HAS_SWARM)('the shipped asks_from lists (HIVE-412)', () => {
  const shipped = (name: string) => readFileSync(join(ROOT, 'agents', name, 'AGENT.md'), 'utf8');
  const asksOf = (name: string) => readFrontmatter(shipped(name))?.fields.get('asks_from')?.value;

  it('lets sessions and the builder hand the shipper a PR, and the shipper or a session hand the fixer one', () => {
    expect(asksOf('shipper')).toBe('[sess-*, builder]');
    expect(asksOf('fixer')).toBe('[shipper, sess-*]');
  });

  it('leaves acr and the builder open', () => {
    expect(asksOf('acr')).toBeUndefined();
    expect(asksOf('builder')).toBeUndefined();
  });

  it('tells acr to act on the ask its wake delivers', () => {
    expect(shipped('acr')).toContain('act on the ask your wake prompt delivers');
    expect(shipped('acr')).not.toContain('take\nthe oldest open ask');
  });
});
