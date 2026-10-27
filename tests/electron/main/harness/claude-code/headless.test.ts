import { describe, expect, it } from 'vitest';

import { claudeCodeAdapter } from '../../../../../electron/main/harness/claude-code';
import {
  claudeFence,
  launchHeadless,
} from '../../../../../electron/main/harness/claude-code/headless';
import type { HeadlessSpec } from '../../../../../electron/main/harness/port';
import { AUTH_ENV_KEYS } from '../../../../../electron/shared/config-contract';

const spec = (over: Partial<HeadlessSpec> = {}): HeadlessSpec => ({
  conversation: { start: 'new-uuid' },
  name: 'slack-watcher',
  limits: { turns: 40 },
  files: {
    settings: '/u/hive/s.json',
    pluginDir: '/u/hive/plugin',
    mcpConfig: '/u/hive/m.json',
    systemPrompt: '/u/hive/p.md',
  },
  grants: ['mcp__hive__ledger_*', 'Read'],
  prompt: 'You were woken.',
  subscriptionAuth: true,
  instructions: 'p',
  hiveServer: { command: '/e', args: ['/h.js'], env: {} },
  stateDir: '/h/cli',
  workdir: '/w',
  ...over,
});
const flag = (args: readonly string[], name: string) => args[args.indexOf(name) + 1];

describe('launchHeadless', () => {
  it('is the adapter member', () => {
    expect(claudeCodeAdapter.headless.launch).toBe(launchHeadless);
  });

  it('ignores the CLI home and the workdir (HIVE-343)', () => {
    expect(launchHeadless(spec({ stateDir: '/other', workdir: '/x' })).args).toEqual(
      launchHeadless(spec()).args,
    );
  });

  it('starts with --session-id and stops on that id', () => {
    const plan = launchHeadless(spec());

    expect(plan.args.slice(0, 3)).toEqual(['-p', '--session-id', 'new-uuid']);
    expect(plan.args).not.toContain('--resume');
    expect(plan.stopPattern).toBe('new-uuid');
  });

  it('names the conversation on its argv, starting or resuming (HIVE-342)', () => {
    expect(launchHeadless(spec()).namesConversation).toBe(true);
    expect(launchHeadless(spec({ conversation: { resume: 'old' } })).namesConversation).toBe(true);
  });

  it('resumes with --resume and stops on that id', () => {
    const plan = launchHeadless(spec({ conversation: { resume: 'old-uuid' } }));

    expect(plan.args.slice(0, 3)).toEqual(['-p', '--resume', 'old-uuid']);
    expect(plan.args).not.toContain('--session-id');
    expect(plan.stopPattern).toBe('old-uuid');
  });

  it('omits --model, --effort and --max-budget-usd when unset', () => {
    const { args } = launchHeadless(spec());

    expect(args).not.toContain('--model');
    expect(args).not.toContain('--effort');
    expect(args).not.toContain('--max-budget-usd');
  });

  it('passes model, effort and budget when set', () => {
    const { args } = launchHeadless(
      spec({ model: 'opus', effort: 'high', limits: { turns: 9, budgetUsd: 2.5 } }),
    );

    expect(flag(args, '--model')).toBe('opus');
    expect(flag(args, '--effort')).toBe('high');
    expect(flag(args, '--max-turns')).toBe('9');
    expect(flag(args, '--max-budget-usd')).toBe('2.5');
  });

  it('isolates the run and routes every call to the fence', () => {
    const { args } = launchHeadless(spec());

    expect(flag(args, '--setting-sources')).toBe('');
    expect(flag(args, '--permission-prompt-tool')).toBe('mcp__hive__approve');
    expect(args).toContain('--strict-mcp-config');
    expect(args.some((a) => a.startsWith('--permission-mode'))).toBe(false);
  });

  it('names every file it was handed', () => {
    const { args } = launchHeadless(spec());

    expect(flag(args, '--settings')).toBe('/u/hive/s.json');
    expect(flag(args, '--plugin-dir')).toBe('/u/hive/plugin');
    expect(flag(args, '--mcp-config')).toBe('/u/hive/m.json');
    expect(flag(args, '--append-system-prompt-file')).toBe('/u/hive/p.md');
  });

  it('grants what it was handed, less a once-only tool', () => {
    expect(flag(launchHeadless(spec()).args, '--allowedTools')).toBe('mcp__hive__ledger_*,Read');

    const narrowed = flag(
      launchHeadless(spec({ grants: ['Read', '*', 'mcp__hive__project_auto_merge'] })).args,
      '--allowedTools',
    )!.split(',');

    expect(narrowed).not.toContain('*');
    expect(narrowed).not.toContain('mcp__hive__project_auto_merge');
    expect(narrowed).toContain('mcp__hive__jira_transition');
    expect(narrowed[0]).toBe('Read');
  });

  it('asks for stream-json and ends with the prompt', () => {
    const { args } = launchHeadless(spec());

    expect(flag(args, '--output-format')).toBe('stream-json');
    expect(args).toContain('--verbose');
    expect(args.at(-1)).toBe('You were woken.');
  });

  it('keeps subagents in the foreground', () => {
    expect(launchHeadless(spec()).addEnv).toEqual({ CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' });
  });

  it('strips the API credentials only under subscription auth', () => {
    expect(launchHeadless(spec()).stripEnv).toEqual(AUTH_ENV_KEYS);
    expect(launchHeadless(spec({ subscriptionAuth: false })).stripEnv).toEqual([]);
  });

  it('leaves the container binary to the adapter (HIVE-344)', () => {
    expect(launchHeadless(spec())).not.toHaveProperty('defaultContainerCommand');
  });
});

describe('claudeFence (HIVE-339)', () => {
  it('is the adapter member', () => {
    expect(claudeCodeAdapter.headless.fence).toBe(claudeFence);
  });

  it('expresses every rule shape the grammar has, malformed ones included', () => {
    expect(
      claudeFence.express([
        '*',
        'Edit',
        'Bash(git status:*)',
        'Read(/repo/**)',
        'WebFetch(domain:example.com)',
        'mcp__hive__ledger_*',
        'literal:Bash:git push',
        'Bash(',
        '',
      ]),
    ).toEqual({ ok: true });
  });
});
