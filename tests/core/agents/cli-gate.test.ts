import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../core/licence/entitled', () => ({
  cliEntitled: (id: string) => (id === 'claude-code' ? null : 'Sign in to use it'),
}));

import { createCliGate } from '../../../core/agents/cli-gate';
import { resolveClis } from '../../../shared/cli-contract';
import type { ProjectConfig } from '../../../shared/config-contract';

const project = (path: string | null): ProjectConfig => ({ path }) as ProjectConfig;

describe('createCliGate (HIVE-341)', () => {
  it('reads enabled, the default CLI and the card defaults from config', () => {
    const gate = createCliGate(() => ({
      clis: resolveClis({ 'claude-code': { agents: { enabled: false, model: 'haiku' } } }),
      agentsDefaultCli: 'claude-code',
      projects: [],
    }));

    expect(gate.enabled('claude-code')).toBe(false);
    expect(gate.defaultCli()).toBe('claude-code');
    expect(gate.defaults('claude-code')).toEqual({ model: 'haiku' });
    expect(gate.entitled('claude-code')).toBeNull();
  });

  it('reads config on every call, so an edit reaches the next wake', () => {
    let clis = resolveClis(undefined);
    const gate = createCliGate(() => ({ clis, projects: [] }));

    expect(gate.enabled('claude-code')).toBe(true);
    expect(gate.defaults('claude-code')).toEqual({});
    clis = resolveClis({ 'claude-code': { agents: { enabled: false, effort: 'max' } } });
    expect(gate.enabled('claude-code')).toBe(false);
    expect(gate.defaults('claude-code')).toEqual({ effort: 'max' });
    expect(gate.defaultCli()).toBeUndefined();
  });

  it("reads codex's model and sandbox from its card (HIVE-342)", () => {
    const gate = createCliGate(() => ({
      clis: resolveClis({
        codex: { agents: { enabled: true, model: 'gpt-6-luna', sandbox: 'read-only' } },
      }),
      projects: [],
    }));

    expect(gate.defaults('codex')).toEqual({ model: 'gpt-6-luna', sandbox: 'read-only' });
  });

  it("reads copilot's deny patterns from its card (HIVE-343)", () => {
    const gate = createCliGate(() => ({
      clis: resolveClis({ copilot: { agents: { enabled: true, deny: ['shell(rm:*)'] } } }),
      projects: [],
    }));

    expect(gate.defaults('copilot')).toEqual({ deny: ['shell(rm:*)'] });
  });

  describe("codex's two sandbox grants", () => {
    /** Two repositories, a folder with no `.git`, and one whose `.git` is a file (a linked worktree). */
    const projects = () => {
      const root = mkdtempSync(join(tmpdir(), 'gate-projects-'));
      for (const name of ['web', 'api']) mkdirSync(join(root, name, '.git'), { recursive: true });
      mkdirSync(join(root, 'plain'));
      mkdirSync(join(root, 'linked'));
      writeFileSync(join(root, 'linked', '.git'), 'gitdir: /elsewhere\n');
      return {
        root,
        list: [
          project(join(root, 'web')),
          project(null),
          project(join(root, 'plain')),
          project(join(root, 'linked')),
          project(join(root, 'api')),
        ],
      };
    };
    const codex = (agents: { network?: boolean; projectGit?: boolean }) => resolveClis({ codex: { agents } });

    it('hands a wake neither while the card has neither on', () => {
      const gate = createCliGate(() => ({ clis: codex({}), projects: projects().list }));

      expect(gate.defaults('codex')).toEqual({});
    });

    it('hands a wake the network grant', () => {
      const gate = createCliGate(() => ({ clis: codex({ network: true }), projects: [] }));

      expect(gate.defaults('codex')).toEqual({ network: true });
    });

    it('resolves project git access to the `.git` folder of each configured project, and nothing else', () => {
      const { root, list } = projects();
      const gate = createCliGate(() => ({ clis: codex({ projectGit: true }), projects: list }));

      // Never the checkout itself; a project with no path, no `.git`, or a `.git` file is left out.
      expect(gate.defaults('codex')).toEqual({
        writableRoots: [join(root, 'web', '.git'), join(root, 'api', '.git')],
      });
    });

    it('reads the projects on every call, so one added in Settings reaches the next wake', () => {
      const { root, list } = projects();
      let configured = list.slice(0, 1);
      const gate = createCliGate(() => ({ clis: codex({ projectGit: true }), projects: configured }));

      expect(gate.defaults('codex').writableRoots).toEqual([join(root, 'web', '.git')]);
      configured = list;
      expect(gate.defaults('codex').writableRoots).toHaveLength(2);
    });
  });

  it('answers entitled from the injected lease check (HIVE-332)', () => {
    const gate = createCliGate(
      () => ({ clis: resolveClis(undefined), projects: [] }),
      (id) => (id === 'copilot' ? 'Copilot is in Team and above' : null),
    );

    expect(gate.entitled('codex')).toBeNull();
    expect(gate.entitled('copilot')).toBe('Copilot is in Team and above');
  });

  it('defaults entitled to the licence read (HIVE-332)', () => {
    expect(createCliGate(() => ({ clis: resolveClis(undefined), projects: [] })).entitled('codex')).toBe('Sign in to use it');
  });
});
