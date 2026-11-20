import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENT_NAME_POOL, resetAgents } from '@/lib/agents';
import type { SwarmsSnapshot } from '@/lib/swarms';
import { resetShippedState } from '@/lib/shipped';

import { AgentDefinition } from '@features/shared/components/agent-definition';
import { useEditorStore } from '@stores/editor-store';
import { useUiStore } from '@stores/ui-store';
import { setSurfaceText, surfaceText } from '@tests/support/editor-surface';

import type { AgentSummary } from '@shared/agent-contract';

import { shippedStatus } from '../../../support/shipped';
import { installedSwarm, swarmItem, swarmListing } from '../../../support/swarms';

const swarmState = vi.hoisted(() => ({
  snapshot: null as SwarmsSnapshot | null,
  setEnabled: null as unknown as import('vitest').Mock,
}));
swarmState.setEnabled = vi.fn();

vi.mock('@/lib/swarms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/swarms')>();
  return {
    ...actual,
    // The stub bridge has no `swarms`; the listing comes from `swarmState`.
    loadSwarms: () => Promise.resolve(),
    swarmsSnapshot: () => swarmState.snapshot ?? actual.swarmsSnapshot(),
    setSwarmItemEnabled: (...args: unknown[]) => swarmState.setEnabled(...args),
  };
});

/**
 * One agent's definition on its page (HIVE-204). The save, rename, delete,
 * problem and shipped cases moved here from Settings › Agents with the logic
 * they test; what is new is the draft in editor-store and the page it closes.
 */

const GOOD = `---
name: slack-watcher
description: Watches things.
icon: Ghost
---
Do the job.
`;

const agent = (name: string, over: Partial<AgentSummary> = {}): AgentSummary => ({
  name,
  description: `${name} watches things`,
  icon: 'Ghost',
  status: 'sleeping',
  wake: { on: [] },
  mcp: [],
  tools: [],
  skills: [],
  rotateAfter: 50,
  runs: [],
  ...over,
});

const stub = (agents: AgentSummary[], over: Record<string, unknown> = {}) => {
  const bridge = {
    list: vi.fn(async () => ({ agents, agentsRoot: '/root/agents' })),
    read: vi.fn(async () => GOOD),
    write: vi.fn(async () => ({ ok: true })),
    remove: vi.fn(async () => undefined),
    rename: vi.fn(async () => ({ ok: true })),
    onChanged: vi.fn(() => () => {}),
    ...over,
  };

  (window as unknown as { hive?: unknown }).hive = { agents: bridge };

  return bridge;
};

/**
 * What the agent page means by rename and delete: move the page to the new
 * name, close it. The tests that pass these prove the page follows.
 */
const page = {
  onRename: (name: string) => useUiStore.getState().openAgentPage(name, 'definition'),
  onClose: () => useUiStore.getState().closeAgentPage(),
};

/** Render one agent's definition and wait for its file to land. */
const open = async (name: string | null = 'slack-watcher') => {
  const view = render(<AgentDefinition {...page} name={name} notice={null} />);
  await screen.findByRole('textbox', { name: 'name' });
  if (name !== null) await waitFor(() => expect(useEditorStore.getState().agentDrafts[name]).toBeDefined());
  return view;
};

const description = () => screen.getByRole('textbox', { name: 'description' });

beforeEach(() => {
  delete (window as unknown as { hive?: unknown }).hive;
  resetAgents();
  resetShippedState();
  useEditorStore.getState().reset();
  useUiStore.getState().reset();
  vi.restoreAllMocks();
});

describe('AgentDefinition', () => {
  it('says agents are desktop-only without a bridge', () => {
    render(<AgentDefinition {...page} name="slack-watcher" notice={null} />);

    expect(screen.getByText(/only available in the desktop app/i)).toBeInTheDocument();
  });

  it('reads the agent into its draft and shows the form', async () => {
    const bridge = stub([agent('slack-watcher')]);
    await open();

    expect(bridge.read).toHaveBeenCalledWith({ name: 'slack-watcher' });
    expect(screen.getByRole('textbox', { name: 'name' })).toHaveValue('slack-watcher');
    expect(useEditorStore.getState().agentDrafts['slack-watcher']).toEqual({ text: GOOD, saved: GOOD });
  });

  it('loads the source into the editor', async () => {
    stub([agent('slack-watcher')]);
    await open();

    await userEvent.click(screen.getByRole('tab', { name: 'Source' }));

    expect(surfaceText('Agent source')).toBe(GOOD);
  });

  it('opens a broken definition, so the user can fix it', async () => {
    stub([agent('broken', { invalid: 'nope: Unknown key.' })]);
    await open('broken');

    expect(screen.getByRole('tab', { name: 'Source' })).toBeInTheDocument();
  });

  it('names an unreadable folder in the footer', async () => {
    stub([agent('Upper')], { read: vi.fn(async () => null) });
    render(<AgentDefinition {...page} name="Upper" notice={null} />);

    expect(await screen.findByText(/This folder cannot be opened/)).toBeInTheDocument();
  });

  it('keeps an unsaved edit across an unmount and a remount', async () => {
    stub([agent('slack-watcher')]);
    const { unmount } = await open();

    await userEvent.type(description(), ' More.');
    expect(screen.getByText('unsaved')).toBeInTheDocument();
    unmount();

    await open();

    expect(screen.getByText('unsaved')).toBeInTheDocument();
    expect(description()).toHaveValue('Watches things. More.');
  });

  it('draws the page notice in the footer', async () => {
    stub([agent('slack-watcher')]);
    render(<AgentDefinition {...page} name="slack-watcher" notice="slack-watcher is paused" />);

    expect(await screen.findByRole('status')).toHaveTextContent('slack-watcher is paused');
  });

  describe('a new agent', () => {
    it('starts already named, with no refusal to clear', async () => {
      stub([agent('slack-watcher')]);
      await open(null);

      expect(AGENT_NAME_POOL).toContain((screen.getByRole('textbox', { name: 'name' }) as HTMLInputElement).value);
      expect(screen.queryByText('Give the agent a name in its frontmatter.')).not.toBeInTheDocument();
      expect(screen.getByText('unsaved')).toBeInTheDocument();
    });

    it('never seeds a name the fleet already holds', async () => {
      stub(AGENT_NAME_POOL.slice(0, -1).map((name) => agent(name)));
      await open(null);

      expect(screen.getByRole('textbox', { name: 'name' })).toHaveValue(AGENT_NAME_POOL.at(-1) as string);
    });

    it('keeps a half-written new agent rather than reseeding it', async () => {
      stub([]);
      const { unmount } = await open(null);

      await userEvent.type(description(), '!');
      unmount();
      await open(null);

      expect(description()).toHaveValue('What this agent watches, and what it does about it!');
    });

    it('saves under the typed name and moves the page to it', async () => {
      const bridge = stub([]);
      useUiStore.getState().openAgentPage(null, 'definition');
      await open(null);

      const typed = (screen.getByRole('textbox', { name: 'name' }) as HTMLInputElement).value;
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(bridge.write).toHaveBeenCalledWith(expect.objectContaining({ name: typed })));
      await waitFor(() => expect(useUiStore.getState().agentPage).toEqual({ name: typed, view: 'definition' }));
      const drafts = useEditorStore.getState().agentDrafts;
      expect(drafts['']).toBeUndefined();
      expect(drafts[typed]?.saved).toBe(drafts[typed]?.text);
    });

    it('Delete closes the page without asking, since nothing is on disk', async () => {
      const bridge = stub([]);
      useUiStore.getState().openAgentPage(null, 'definition');
      await open(null);

      await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

      expect(bridge.remove).not.toHaveBeenCalled();
      expect(useUiStore.getState().agentPage).toBeNull();
      expect(useEditorStore.getState().agentDrafts['']).toBeUndefined();
    });

    it('Revert goes back to a fresh template', async () => {
      stub([]);
      await open(null);

      await userEvent.type(description(), '!');
      await userEvent.click(screen.getByRole('button', { name: 'Revert' }));

      expect(description()).toHaveValue('What this agent watches, and what it does about it');
    });
  });

  describe('saving', () => {
    it('writes the buffer under the name its frontmatter declares', async () => {
      const bridge = stub([agent('slack-watcher')]);
      await open();

      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(bridge.write).toHaveBeenCalledWith({ name: 'slack-watcher', source: GOOD }));
    });

    it('marks the draft saved once the write lands', async () => {
      stub([agent('slack-watcher')]);
      await open();

      await userEvent.type(description(), '!');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText('saved')).toBeInTheDocument();
    });

    it('shows a refusal beside the field it names, and keeps the draft dirty', async () => {
      stub([agent('slack-watcher')], {
        write: vi.fn(async () => ({
          ok: false,
          problems: [{ field: 'wake.every', reason: 'Cannot be faster than 1m.' }],
        })),
      });
      await open();

      await userEvent.type(description(), '!');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText('Cannot be faster than 1m.')).toBeInTheDocument();
      expect(screen.getByText('unsaved')).toBeInTheDocument();
    });

    it('renames in one call, carrying the buffer, and moves the page to the new name', async () => {
      const bridge = stub([agent('slack-watcher')]);
      useUiStore.getState().openAgentPage('slack-watcher', 'definition');
      await open();

      const renamed = GOOD.replace('slack-watcher', 'slack-bot');
      setSurfaceText('Agent source', renamed);
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(bridge.rename).toHaveBeenCalledWith({ from: 'slack-watcher', to: 'slack-bot', source: renamed }),
      );
      expect(bridge.write).not.toHaveBeenCalled();
      await waitFor(() => expect(useUiStore.getState().agentPage?.name).toBe('slack-bot'));
      expect(useEditorStore.getState().agentDrafts['slack-watcher']).toBeUndefined();
      expect(useEditorStore.getState().agentDrafts['slack-bot']).toEqual({ text: renamed, saved: renamed });
    });

    it('does not write when the rename is refused', async () => {
      const bridge = stub([agent('slack-watcher')], {
        rename: vi.fn(async () => ({
          ok: false,
          problems: [{ field: 'name', reason: 'slack-bot already exists.' }],
        })),
      });
      await open();

      setSurfaceText('Agent source', GOOD.replace('slack-watcher', 'slack-bot'));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText('slack-bot already exists.')).toBeInTheDocument();
      expect(bridge.write).not.toHaveBeenCalled();
    });

    it('refuses a name that collides with another agent', async () => {
      stub([agent('slack-watcher'), agent('taken')]);
      await open();

      setSurfaceText('Agent source', GOOD.replace('slack-watcher', 'taken'));

      expect(await screen.findByText('You already have an agent called taken.')).toBeInTheDocument();
    });

    it('refuses a reserved name before asking main', async () => {
      const bridge = stub([agent('slack-watcher')]);
      await open();

      setSurfaceText('Agent source', GOOD.replace('slack-watcher', 'overmind'));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText('"overmind" is reserved by HiveTTY.')).toBeInTheDocument();
      expect(bridge.write).not.toHaveBeenCalled();
    });
  });

  it('Revert restores the saved text', async () => {
    stub([agent('slack-watcher')]);
    await open();

    await userEvent.type(description(), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Revert' }));

    expect(screen.getByText('saved')).toBeInTheDocument();
    expect(description()).toHaveValue('Watches things.');
  });

  describe('its caller decides what rename and delete open', () => {
    it('hands a saved rename to onRename', async () => {
      stub([agent('slack-watcher')]);
      const rename = vi.fn();
      render(<AgentDefinition name="slack-watcher" notice={null} onRename={rename} onClose={vi.fn()} />);
      await waitFor(() => expect(useEditorStore.getState().agentDrafts['slack-watcher']).toBeDefined());

      setSurfaceText('Agent source', GOOD.replace('slack-watcher', 'slack-bot'));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(rename).toHaveBeenCalledWith('slack-bot'));
      expect(useUiStore.getState().agentPage).toBeNull();
    });

    it('hands a delete to onClose', async () => {
      stub([agent('slack-watcher')]);
      const close = vi.fn();
      render(<AgentDefinition name="slack-watcher" notice={null} onRename={vi.fn()} onClose={close} />);
      await waitFor(() => expect(useEditorStore.getState().agentDrafts['slack-watcher']).toBeDefined());

      await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await userEvent.click(
        within(screen.getByRole('alertdialog', { name: 'Delete slack-watcher?' })).getByRole('button', {
          name: 'Delete',
        }),
      );

      await waitFor(() => expect(close).toHaveBeenCalled());
    });
  });

  describe('deleting', () => {
    it('asks, removes the folder, drops the draft and closes the page', async () => {
      const bridge = stub([agent('slack-watcher')]);
      useUiStore.getState().openAgentPage('slack-watcher', 'definition');
      await open();

      await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
      const confirm = screen.getByRole('alertdialog', { name: 'Delete slack-watcher?' });

      // The editor's footer steps aside: the confirm's two are the only answers.
      expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

      await userEvent.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await userEvent.click(
        within(screen.getByRole('alertdialog', { name: 'Delete slack-watcher?' })).getByRole('button', {
          name: 'Delete',
        }),
      );

      await waitFor(() => expect(bridge.remove).toHaveBeenCalledWith({ name: 'slack-watcher' }));
      await waitFor(() => expect(useUiStore.getState().agentPage).toBeNull());
      expect(useEditorStore.getState().agentDrafts['slack-watcher']).toBeUndefined();
    });

    it('keeps the page open and says why when main refuses', async () => {
      stub([agent('slack-watcher')], {
        remove: vi.fn(async () => {
          throw new Error('locked');
        }),
      });
      useUiStore.getState().openAgentPage('slack-watcher', 'definition');
      await open();

      await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await userEvent.click(
        within(screen.getByRole('alertdialog', { name: 'Delete slack-watcher?' })).getByRole('button', {
          name: 'Delete',
        }),
      );

      await waitFor(() => expect(screen.getByText(/locked/)).toBeInTheDocument());
      expect(useUiStore.getState().agentPage).toEqual({ name: 'slack-watcher', view: 'definition' });
    });
  });
});

describe('AgentDefinition — a shipped agent the user changed', () => {
  const changed = shippedStatus({
    name: 'slack-watcher',
    customised: [{ path: 'limits.parallel', yours: '5', shipped: '2' }],
    bodyEdited: true,
    held: true,
  });

  const withShipped = (over: Record<string, unknown> = {}) => {
    const agents = stub([agent('slack-watcher')]);
    const shipped = {
      status: vi.fn(async () => [changed]),
      reset: vi.fn(async () => []),
      takePrompt: vi.fn(async () => []),
      keepMine: vi.fn(async () => []),
      ...over,
    };
    (window as unknown as { hive: Record<string, unknown> }).hive.shipped = shipped;

    return { agents, shipped };
  };

  it('shows the strip and the held banner, and resets after confirming, then re-reads the file', async () => {
    const { agents, shipped } = withShipped();
    await open();

    await screen.findByText(/1 setting differs from shipped: limits\.parallel\./);
    expect(screen.getByText(/Update held\./)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reset to shipped' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));

    await waitFor(() => expect(shipped.reset).toHaveBeenCalledWith({ kind: 'agents', name: 'slack-watcher' }));
    await waitFor(() => expect(agents.read).toHaveBeenCalledTimes(2));
  });

  it('hides them while the draft is dirty', async () => {
    withShipped();
    await open();
    await screen.findByText(/Update held\./);

    await userEvent.type(description(), '!');

    expect(screen.queryByText(/Update held\./)).toBeNull();
  });

  it('takes the shipped prompt from the banner, and says so when main refuses', async () => {
    const { shipped } = withShipped({
      takePrompt: vi.fn(async () => {
        throw new Error('slack-watcher is a symlink in ~/.hivetty');
      }),
    });
    await open();

    await userEvent.click(await screen.findByRole('button', { name: 'Take shipped prompt' }));

    expect(shipped.takePrompt).toHaveBeenCalledWith({ kind: 'agents', name: 'slack-watcher' });
    expect(await screen.findByText(/is a symlink/)).toBeInTheDocument();
  });

  it('keeps mine from the banner', async () => {
    const { shipped } = withShipped();
    await open();

    const banner = (await screen.findByText(/Update held\./)).closest('div') as HTMLElement;
    await userEvent.click(within(banner).getByRole('button', { name: 'Keep mine' }));

    expect(shipped.keepMine).toHaveBeenCalledWith({ kind: 'agents', name: 'slack-watcher' });
  });
});

describe('the Runs on context (HIVE-396)', () => {
  it('reaches the form: before any verdict every CLI is pickable and the default is Claude Code', async () => {
    stub([]);
    render(<AgentDefinition {...page} name={null} notice={null} />);

    const dock = await screen.findByRole('radiogroup', { name: 'cli' });
    for (const radio of within(dock).getAllByRole('radio')) {
      expect(radio).not.toHaveAttribute('aria-disabled');
    }
    expect(within(dock).getByRole('radio', { checked: true })).toHaveAccessibleName('Claude Code');
  });
});

describe('AgentDefinition — a swarm\'s agent is turned off, not deleted (HIVE-453)', () => {
  const useSquad = (off: string[] = []): void => {
    swarmState.snapshot = {
      listing: swarmListing([
        swarmItem({
          installed: installedSwarm({
            swarmId: 'sq1',
            title: 'Dev Squad',
            contents: {
              agents: ['builder', 'fixer', 'shipper', 'acr'].map((name) => ({ name, description: '', tools: [] })),
              skills: [],
            },
            disabled: { agents: off, skills: [] },
          }),
        }),
      ]),
      busy: new Set(),
      removing: new Set(),
      failures: new Map(),
      lastUpdate: null,
    };
  };
  const squad = [
    agent('builder'),
    agent('fixer', { asksFrom: ['shipper'] }),
    agent('shipper', { asksFrom: ['sess-*', 'builder'] }),
    agent('acr'),
    agent('slack-watcher'),
  ];

  beforeEach(() => {
    swarmState.setEnabled.mockReset();
    swarmState.setEnabled.mockResolvedValue(true);
  });

  afterEach(() => {
    swarmState.snapshot = null;
  });

  it('an owned agent has the switch and no Delete; the person\'s own keeps Delete', async () => {
    useSquad();
    stub(squad);
    const view = await open('acr');

    expect(screen.getByRole('switch', { name: 'Enabled' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    view.unmount();

    await open('slack-watcher');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /^(Enabled|Off)$/ })).toBeNull();
  });

  it('turning off acr, which nobody asks, writes at once', async () => {
    useSquad();
    stub(squad);
    await open('acr');

    await userEvent.click(screen.getByRole('switch', { name: 'Enabled' }));

    expect(swarmState.setEnabled).toHaveBeenCalledWith('sq1', 'agents', 'acr', false);
  });

  it('turning off shipper names builder, and Cancel writes nothing', async () => {
    useSquad();
    stub(squad);
    await open('shipper');

    await userEvent.click(screen.getByRole('switch', { name: 'Enabled' }));

    expect(
      screen.getByText(
        "builder asks shipper as part of Dev Squad's flow. With it off, those asks are refused and come back to you.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(swarmState.setEnabled).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('switch', { name: 'Enabled' }));
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(swarmState.setEnabled).toHaveBeenCalledWith('sq1', 'agents', 'shipper', false);
  });

  it('turning off fixer names shipper', async () => {
    useSquad();
    stub(squad);
    await open('fixer');

    await userEvent.click(screen.getByRole('switch', { name: 'Enabled' }));

    expect(screen.getByText(/^shipper asks fixer as part of Dev Squad's flow/)).toBeInTheDocument();
  });

  it('an off builder is not named', async () => {
    useSquad(['builder']);
    stub(squad);
    await open('shipper');

    await userEvent.click(screen.getByRole('switch', { name: 'Enabled' }));

    expect(swarmState.setEnabled).toHaveBeenCalledWith('sq1', 'agents', 'shipper', false);
  });

  it('turning on never asks, and a failed write says so in the notice', async () => {
    useSquad(['fixer']);
    swarmState.setEnabled.mockResolvedValue(false);
    // A definition whose name is the agent's own, so no name problem outranks the notice.
    stub(squad, { read: vi.fn(async ({ name }: { name: string }) => GOOD.replace('slack-watcher', name)) });
    await open('fixer');

    await userEvent.click(screen.getByRole('switch', { name: 'Off' }));

    expect(swarmState.setEnabled).toHaveBeenCalledWith('sq1', 'agents', 'fixer', true);
    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
  });
});
