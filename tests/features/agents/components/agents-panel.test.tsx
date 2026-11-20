import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentsPanel } from '@features/agents/components/agents-panel';
import type { AgentSummary } from '@shared/agent-contract';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';
import { seedDemoFleet } from '@tests/support/demo-fleet';
import { installedSwarm, swarmEntry, swarmItem, swarmListing } from '@tests/support/swarms';

import { resetSwarmsState } from '@/lib/swarms';

/** The three fixture agents, in `agentOrder`. */
const FIXTURE_AGENTS = [['slack-agent'], ['pr-reviewer'], ['standup-agent']] as const;

const agentRow = (id: string) =>
  screen.getByRole('button', { name: new RegExp(`^${id}`) });

/**
 * Every row, and never the header's +, a lane
 * header or a row's slot actions (HIVE-116, HIVE-204).
 *
 * Those are buttons in the same panel, so a bare `getAllByRole('button')`
 * counts them as tenants. Filtering here keeps these assertions exact rather
 * than loosening them to "a few more than the rows".
 */
const agentRows = () =>
  screen
    .getAllByRole('button')
    .filter(
      (button) =>
        button.getAttribute('aria-label') !== 'New agent' &&
        !/^(Run .* now|Pause .*|Resume .*)$/.test(button.getAttribute('aria-label') ?? '') &&
        !button.hasAttribute('aria-expanded') &&
        // The Stalls row is a toggle, not an agent (HIVE-411).
        !button.hasAttribute('aria-pressed'),
    );

describe('AgentsPanel', () => {
  beforeEach(() => {
    useHiveStore.getState().reset();
    seedDemoFleet();
    useUiStore.getState().reset();
  });

  /**
   * The state a fresh launch is actually in.
   *
   * Three agents used to be seeded into the store at boot — a Slack watcher, a
   * PR reviewer, a standup writer — none of which anything could start or stop.
   * Nothing creates a background agent yet, so the panel says that instead of
   * listing three that do not exist.
   */
  it('offers New agent when empty', () => {
    useHiveStore.getState().reset();

    render(<AgentsPanel />);

    expect(screen.getByText(/No agents yet\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New agent' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ New agent…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('renders every seeded agent, in agentOrder', () => {
    render(<AgentsPanel />);

    const ids = agentRows().map(
      (row) => row.textContent?.match(/^[a-z-]+/)?.[0],
    );

    expect(ids).toEqual(FIXTURE_AGENTS.map(([id]) => id));
  });

  it.each(FIXTURE_AGENTS)('shows %s by name', (id) => {
    render(<AgentsPanel />);

    expect(agentRow(id)).toBeInTheDocument();
    expect(screen.getByText(id)).toBeInTheDocument();
  });

  it('gives each agent its own icon', () => {
    render(<AgentsPanel />);

    // The first svg is the hexagon every tile shares; the glyph sits inside it.
    const glyphs = agentRows().map((row) => row.querySelectorAll('svg')[1]?.innerHTML);

    expect(new Set(glyphs).size).toBe(3);
    expect(glyphs.every(Boolean)).toBe(true);
  });

  it('opens an agent’s terminal when clicked', async () => {
    render(<AgentsPanel />);

    await userEvent.click(agentRow('pr-reviewer'));

    expect(useUiStore.getState().activeTab).toBe('pr-reviewer');
  });

  it('highlights the agent whose page is open', () => {
    useUiStore.getState().openAgentPage('standup-agent', 'activity');
    render(<AgentsPanel />);

    expect(agentRow('standup-agent')).toHaveClass('bg-active');
    expect(agentRow('standup-agent')).toHaveAttribute('aria-current', 'true');
    expect(agentRow('slack-agent')).not.toHaveClass('bg-active');
  });

  it('moves the highlight when another agent opens', async () => {
    render(<AgentsPanel />);

    await userEvent.click(agentRow('slack-agent'));
    expect(agentRow('slack-agent')).toHaveClass('bg-active');

    await userEvent.click(agentRow('pr-reviewer'));
    expect(agentRow('pr-reviewer')).toHaveClass('bg-active');
    expect(agentRow('slack-agent')).not.toHaveClass('bg-active');
  });

  it('highlights nothing while a session tab is open', () => {
    useUiStore.getState().openTab('hero-refresh');
    render(<AgentsPanel />);

    for (const [id] of FIXTURE_AGENTS) {
      expect(agentRow(id)).not.toHaveClass('bg-panel-2');
    }
  });

  /** State is never carried by the tile's colour alone (HIVE-114, HIVE-204). */
  it('names each state in words as well as colour', () => {
    render(<AgentsPanel />);

    for (const [id] of FIXTURE_AGENTS) {
      expect(agentRow(id)).toHaveAccessibleName(new RegExp(`^${id}, sleeping`));
    }
  });

  /**
   * A definition that failed to parse is *listed*, not hidden (HIVE-114).
   *
   * The row shows the reason where a working agent shows its description,
   * because a broken file has no description to show and the reason is the one
   * thing that helps the user fix it.
   */
  it('shows a broken definition with its reason', () => {
    act(() => {
      useHiveStore.getState().hydrateAgents([
        {
          name: 'broken',
          description: '',
          icon: 'Warning',
          status: 'sleeping',
          wake: { on: [] },
          mcp: [],
          tools: [],
          skills: [],
          rotateAfter: 50,
          runs: [],
          invalid: 'nope: Unknown key. Remove it or fix the spelling.',
        },
      ]);
    });

    render(<AgentsPanel />);

    expect(screen.getByText(/Unknown key/)).toBeInTheDocument();
    expect(screen.getByText('invalid')).toBeInTheDocument();
  });

  it('still lets a broken definition be opened, so it can be fixed', () => {
    act(() => {
      useHiveStore.getState().hydrateAgents([
        {
          name: 'broken',
          description: '',
          icon: 'Warning',
          status: 'sleeping',
          wake: { on: [] },
          mcp: [],
          tools: [],
          skills: [],
          rotateAfter: 50,
          runs: [],
          invalid: 'nope: Unknown key.',
        },
      ]);
    });

    render(<AgentsPanel />);

    expect(agentRow('broken')).toBeEnabled();
  });

  it('skips an id that is not an agent', () => {
    act(() => {
      useHiveStore.setState({ agentOrder: ['hero-refresh', 'slack-agent'] });
    });

    render(<AgentsPanel />);

    expect(agentRows()).toHaveLength(1);
    expect(agentRow('slack-agent')).toBeInTheDocument();
  });

  it('skips an id the store does not know', () => {
    act(() => {
      useHiveStore.setState({ agentOrder: ['ghost', 'slack-agent'] });
    });

    render(<AgentsPanel />);

    expect(agentRows()).toHaveLength(1);
  });

  /**
   * Grouping (HIVE-116, HIVE-454).
   *
   * A rail is read to answer "what needs me", not "what do I have", which is
   * what Summons puts first; below it, one folding section per swarm. The
   * ordering rules themselves are `useAgentsByGroup`'s and `agentGroups`'s and
   * are tested there; these are about the panel drawing what it is handed.
   */
  describe('grouped by swarm under a Summons lane', () => {
    afterEach(() => {
      resetSwarmsState();
      delete (window as unknown as { hive?: unknown }).hive;
    });

    const summary = (name: string, status: AgentSummary['status']) => ({
      name,
      description: `${name} watches things`,
      icon: 'ph-robot',
      status,
      wake: { on: [] },
      mcp: [],
      tools: [],
      skills: [],
      rotateAfter: 50,
      runs: [],
    });

    const seed = (...agents: ReturnType<typeof summary>[]) => {
      act(() => {
        useHiveStore.getState().hydrateAgents(agents);
      });
    };

    const swarm = (swarmId: string, title: string, agents: string[]) =>
      swarmItem({
        entry: swarmEntry({ id: swarmId, slug: swarmId, title }),
        installed: installedSwarm({
          swarmId,
          slug: swarmId,
          title,
          contents: { agents: agents.map((name) => ({ name, description: '', tools: [] })), skills: [] },
        }),
      });

    /** Installs swarm A (asker, worker) then swarm B (sleeper), and waits for the panel to read them. */
    const installAB = async () => {
      const listing = swarmListing([swarm('A', 'Alpha', ['asker', 'worker']), swarm('B', 'Beta', ['sleeper'])]);
      (window as unknown as { hive?: unknown }).hive = {
        swarms: { list: vi.fn(() => Promise.resolve(listing)), onChanged: vi.fn(() => () => undefined) },
      };
      seed(
        summary('asker', 'asking'),
        summary('worker', 'working'),
        summary('sleeper', 'sleeping'),
        summary('mine', 'sleeping'),
      );
      render(<AgentsPanel />);
      await screen.findByRole('region', { name: 'Alpha' });
    };

    const regions = () => screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'));

    /** A region's caret header, found by its fold key so a folded one is found too. */
    const laneHeader = (label: string) => {
      const region = screen.getByRole('region', { name: label });
      const key = region.getAttribute('data-group') ?? '';
      return within(region).getByRole('button', { expanded: !useUiStore.getState().agentsFolded[key] });
    };

    it('draws Summons, then one section per swarm in Settings order, then My swarm (HIVE-454)', async () => {
      await installAB();

      expect(regions()).toEqual(['Summons', 'Alpha', 'Beta', 'My swarm']);

      const summons = screen.getByRole('region', { name: 'Summons' });
      expect(within(summons).getByRole('button', { name: /^asker, asking, Alpha/ })).toBeInTheDocument();
      expect(within(summons).getByText('Alpha')).toHaveClass('text-micro');

      const alpha = screen.getByRole('region', { name: 'Alpha' });
      expect(within(alpha).getByRole('button', { name: /^worker, working/ })).toBeInTheDocument();
      expect(within(alpha).queryByRole('button', { name: /^asker/ })).not.toBeInTheDocument();
      // No swarm tag outside Summons: the section already says it.
      expect(within(alpha).getByRole('button', { name: /^worker, working/ })).not.toHaveAccessibleName(/Alpha/);
      expect(laneHeader('Alpha')).toHaveTextContent(/^Alpha1 · 1$/);
      expect(within(laneHeader('Alpha')).getByText('1', { selector: '.text-green' })).toBeInTheDocument();

      expect(within(screen.getByRole('region', { name: 'Beta' })).getByRole('button', { name: /^sleeper/ })).toBeInTheDocument();
      expect(within(screen.getByRole('region', { name: 'My swarm' })).getByRole('button', { name: /^mine/ })).toBeInTheDocument();
    });

    it('draws a section with nothing working with its total alone', async () => {
      await installAB();

      expect(laneHeader('Beta')).toHaveTextContent(/^Beta1$/);
      expect(laneHeader('Summons')).toHaveTextContent('Summons1');
    });

    it('folds one section, keeps it folded across a re-render, and leaves the others open (HIVE-454)', async () => {
      await installAB();

      await userEvent.click(laneHeader('Beta'));

      expect(laneHeader('Beta')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('button', { name: /^sleeper/ })).not.toBeInTheDocument();
      expect(useUiStore.getState().agentsFolded).toEqual({ B: true });

      seed(
        summary('asker', 'asking'),
        summary('worker', 'working'),
        summary('sleeper', 'sleeping'),
        summary('mine', 'sleeping'),
        summary('extra', 'sleeping'),
      );

      expect(laneHeader('Beta')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('button', { name: /^sleeper/ })).not.toBeInTheDocument();
      expect(laneHeader('Alpha')).toHaveAttribute('aria-expanded', 'true');
      expect(agentRow('worker')).toBeInTheDocument();
    });

    it('still draws a single section’s header', () => {
      seed(summary('sleeper', 'sleeping'));

      render(<AgentsPanel />);

      expect(regions()).toEqual(['The swarm']);
      expect(laneHeader('The swarm')).toHaveTextContent(/^The swarm1$/);
    });

    it('puts every agent in one section named The swarm before the listing loads', () => {
      seed(summary('asker', 'asking'), summary('busy', 'working'), summary('held', 'paused'));

      render(<AgentsPanel />);

      expect(regions()).toEqual(['Summons', 'The swarm']);
      // No tag before the listing loads: which swarm is not known yet.
      expect(agentRow('asker')).toHaveAccessibleName(/^asker, asking(\.|$)/);
      const rows = within(screen.getByRole('region', { name: 'The swarm' })).getAllByRole('button', {
        name: /^(busy|held),/,
      });
      expect(rows.map((row) => row.getAttribute('aria-label')?.split(',')[0])).toEqual(['busy', 'held']);
    });

    it('omits Summons with nothing in it, rather than a header reading zero', () => {
      seed(summary('sleeper', 'sleeping'));

      render(<AgentsPanel />);

      expect(screen.queryByRole('region', { name: 'Summons' })).not.toBeInTheDocument();
    });

    it('scrolls the section openAgentsAt names into view, then clears the focus (HIVE-454)', async () => {
      const scrolled: Element[] = [];
      const original = Element.prototype.scrollIntoView;
      const scrollIntoView = vi.fn(function (this: Element) {
        scrolled.push(this);
      });
      Element.prototype.scrollIntoView = scrollIntoView;

      try {
        await installAB();
        await userEvent.click(laneHeader('Beta'));

        act(() => useUiStore.getState().openAgentsAt('B'));

        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
        expect(scrolled).toEqual([screen.getByRole('region', { name: 'Beta' })]);
        expect(useUiStore.getState().agentsFocus).toBeNull();
        expect(agentRow('sleeper')).toBeInTheDocument();
      } finally {
        Element.prototype.scrollIntoView = original;
      }
    });

    it('scrolls to Summons, unfolded, when every agent of the focused swarm sits there (HIVE-454)', async () => {
      const scrolled: Element[] = [];
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
        scrolled.push(this);
      });

      try {
        await installAB();
        // Alpha's working agent fails too: both of Alpha's agents are in Summons, so Alpha has no section.
        seed(
          summary('asker', 'asking'),
          summary('worker', 'failed'),
          summary('sleeper', 'sleeping'),
          summary('mine', 'sleeping'),
        );
        expect(screen.queryByRole('region', { name: 'Alpha' })).not.toBeInTheDocument();
        await userEvent.click(laneHeader('Summons'));

        act(() => useUiStore.getState().openAgentsAt('A'));

        expect(scrolled).toEqual([screen.getByRole('region', { name: 'Summons' })]);
        expect(laneHeader('Summons')).toHaveAttribute('aria-expanded', 'true');
        expect(agentRow('asker')).toBeInTheDocument();
        expect(useUiStore.getState().agentsFocus).toBeNull();
      } finally {
        Element.prototype.scrollIntoView = original;
      }
    });

    it('clears a focus with no such section, and scrolls nothing', async () => {
      const scrollIntoView = vi.fn();
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scrollIntoView;

      try {
        await installAB();

        act(() => useUiStore.getState().openAgentsAt('gone'));

        expect(scrollIntoView).not.toHaveBeenCalled();
        expect(useUiStore.getState().agentsFocus).toBeNull();
      } finally {
        Element.prototype.scrollIntoView = original;
      }
    });

    it('clears the focus where the DOM has no scrollIntoView', async () => {
      const original = Element.prototype.scrollIntoView;
      // happy-dom may lack it; the panel must not throw.
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');

      try {
        await installAB();

        act(() => useUiStore.getState().openAgentsAt('B'));

        expect(useUiStore.getState().agentsFocus).toBeNull();
      } finally {
        Element.prototype.scrollIntoView = original;
      }
    });

    it('counts summons in amber and morphing in green in the header', () => {
      seed(
        summary('asker', 'asking'),
        summary('broke', 'failed'),
        summary('busy', 'working'),
        summary('builder', 'working'),
      );

      render(<AgentsPanel />);

      const heading = screen.getByRole('heading', { name: 'Agents' });
      const counts = heading.nextElementSibling as HTMLElement;

      expect(counts).toHaveTextContent('2 summons · 2 morphing');
      expect(screen.getByText('2 summons')).toHaveClass('text-amber-text');
      expect(screen.getByText('2 morphing')).toHaveClass('text-green');
    });

    it('drops a count at zero, and its separator', () => {
      seed(summary('busy', 'working'), summary('sleeper', 'sleeping'));

      render(<AgentsPanel />);

      const counts = screen.getByRole('heading', { name: 'Agents' })
        .nextElementSibling as HTMLElement;

      expect(counts).toHaveTextContent(/^1 morphing$/);
    });
  });

  describe('the way to make another one', () => {
    it('the head’s + opens a never-saved agent page on Definition (HIVE-204)', async () => {
      render(<AgentsPanel />);

      await userEvent.click(screen.getByRole('button', { name: 'New agent' }));

      expect(useUiStore.getState().agentPage).toEqual({ name: null, view: 'definition' });
      expect(useUiStore.getState().settings).toBe(false);
    });

    it('draws no footer line beside it', () => {
      render(<AgentsPanel />);

      expect(screen.queryByRole('button', { name: '+ New agent…' })).not.toBeInTheDocument();
    });

    it('does the same from the empty state', async () => {
      useHiveStore.getState().reset();

      render(<AgentsPanel />);

      await userEvent.click(screen.getByRole('button', { name: 'New agent' }));

      expect(useUiStore.getState().agentPage).toEqual({ name: null, view: 'definition' });
    });
  });
});

describe('AgentsPanel — the Stalls row (HIVE-411)', () => {
  beforeEach(() => {
    useHiveStore.getState().reset();
    seedDemoFleet();
    useUiStore.getState().reset();
  });

  const stallsRow = () => screen.getByRole('button', { name: /^Stalls/ });

  it('sits above the first group, with no badge while nothing is stalled', () => {
    render(<AgentsPanel />);
    const row = stallsRow();
    const firstGroup = screen.getAllByRole('region')[0] as HTMLElement;
    expect(row.compareDocumentPosition(firstGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row).toHaveAttribute('aria-pressed', 'false');
    expect(row).toHaveTextContent(/^Stalls$/);
  });

  it('counts what needs a look, and shows the stalls when clicked, unselecting the agent rows', async () => {
    act(() => {
      useHiveStore.setState({
        ledger: [{ id: '20261111-000000-0001', ts: Date.now() - 2 * 24 * 60 * 60_000, from: 'sess-1c', kind: 'claim', body: '', meta: { task: 'HIVE-393' } }],
      });
      useUiStore.getState().openAgentPage('slack-agent', 'activity');
    });
    render(<AgentsPanel />);
    expect(stallsRow()).toHaveTextContent('1');
    expect(agentRow('slack-agent')).toHaveAttribute('aria-current', 'true');

    await userEvent.click(stallsRow());

    expect(useUiStore.getState().stallsShown).toBe(true);
    expect(stallsRow()).toHaveAttribute('aria-pressed', 'true');
    expect(agentRow('slack-agent')).not.toHaveAttribute('aria-current');
  });
});
