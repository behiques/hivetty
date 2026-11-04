import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptySnapshot } from '@shared/config-contract';

import {
  SettingsOverlay,
  escapeIsClaimed,
} from '@features/settings/components/settings-overlay';
import { resetProjectConfig, setProjectConfigForTest } from '@lib/project-config';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';

/**
 * The settings overlay shell (story 101).
 *
 * The section list is the part worth pinning: story 105 turned it into a real
 * switcher, and the sections that do not exist yet are *absent* rather than
 * disabled — a nav full of dead items teaches the user that settings are
 * broken.
 */
describe('SettingsOverlay', () => {
  beforeEach(() => {
    useHiveStore.getState().reset();
    useUiStore.getState().reset();
    resetProjectConfig();
    setProjectConfigForTest(emptySnapshot('/tmp/hive/config.json'));
    useUiStore.getState().openSettings();
  });

  afterEach(() => {
    resetProjectConfig();
  });

  it('names itself and shows the Projects section', () => {
    render(<SettingsOverlay />);

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Projects', level: 2 }),
    ).toBeInTheDocument();
  });

  it('ships the sections that exist, and no placeholders', () => {
    render(<SettingsOverlay />);

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });

    expect(nav).toBeInTheDocument();

    /*
      Story 107 fills the last slot, so every section the epic named now exists
      and there is nothing left to be absent. The rule that produced the old
      "and no placeholders" half of this test still stands for whatever comes
      next: a section stays out of this list until it exists, because a nav full
      of dead items teaches the user that settings are broken.
    */
    for (const present of [
      'Projects',
      'Shell & environment',
      'Containers',
      'Overview',
      'Claude Code',
      'Codex',
      'Copilot',
      'Skills',
      'Agents',
      'Ticket workflow',
      'Appearance',
      'Integrations',
      'Server mode',
      'Updates & about',
      'Advanced',
    ]) {
      expect(within(nav).getByRole('button', { name: present })).toBeInTheDocument();
    }
  });

  it('opens the CLIs pane from the nav (HIVE-341)', async () => {
    const user = userEvent.setup();
    render(<SettingsOverlay />);

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    await user.click(within(nav).getByRole('button', { name: 'Overview' }));

    expect(screen.getByRole('heading', { name: 'Overview', level: 2 })).toBeInTheDocument();
  });

  /**
   * The grouped nav (HIVE-374). Groups are labels, not buttons, and a group
   * with no pane yet is absent: Account arrives with its panes. Machines
   * arrived with Server mode (HIVE-380).
   */
  it('reads in five groups, in the epic order, with no empty group', () => {
    render(<SettingsOverlay />);

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const groups = within(nav).getAllByRole('group');
    const heading = (group: HTMLElement) =>
      document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent;

    expect(groups.map(heading)).toEqual(['Harnesses', 'Automation', 'Workspace', 'Machines', 'General']);
    expect(
      groups.map((group) =>
        within(group)
          .getAllByRole('button')
          .map((button) => button.textContent),
      ),
    ).toEqual([
      ['Overview', 'Claude Code', 'Codex', 'Copilot', 'Shell & environment', 'Containers'],
      ['Agents', 'Skills', 'Ticket workflow'],
      ['Projects', 'Appearance', 'Editor', 'Integrations', 'Notifications'],
      ['Server mode'],
      ['Updates & about', 'Advanced'],
    ]);
    expect(within(nav).queryByText('Account')).not.toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: 'Harnesses' })).not.toBeInTheDocument();
  });

  it.each([
    ['harnesses-overview', 'Overview'],
    ['claude-code', 'Claude Code'],
    ['codex', 'Codex'],
    ['copilot', 'Copilot'],
    ['shell', 'Shell & environment'],
    ['containers', 'Containers'],
    ['agents', 'Agents'],
    ['skills', 'Skills'],
    ['ticket-workflow', 'Ticket workflow'],
    ['projects', 'Projects'],
    ['appearance', 'Appearance'],
    ['editor', 'Editor'],
    ['integrations', 'Integrations'],
    ['notifications', 'Notifications'],
    ['server-mode', 'Server mode'],
    ['updates-about', 'Updates & about'],
    ['advanced', 'Advanced'],
  ] as const)('pane id %s renders its section', (id, title) => {
    useUiStore.getState().openSettings(id);
    render(<SettingsOverlay />);

    expect(screen.getByRole('heading', { name: title, level: 2 })).toBeInTheDocument();
  });

  it.each([
    ['runtime', 'Shell & environment'],
    ['clis', 'Overview'],
    ['advanced', 'Advanced'],
  ] as const)('the legacy id %s opens its new pane', (legacy, label) => {
    useUiStore.getState().openSettings(legacy);
    render(<SettingsOverlay />);

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });

    expect(within(nav).getByRole('button', { name: label })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  /**
   * One tab stop, arrows across groups, Home and End (HIVE-374): the nav is a
   * roving list, so Tab leaves it rather than walking ten buttons.
   */
  it('is one tab stop, the current pane', () => {
    render(<SettingsOverlay />);

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const reachable = within(nav)
      .getAllByRole('button')
      .filter((button) => button.tabIndex === 0);

    expect(reachable.map((button) => button.textContent)).toEqual(['Projects']);
  });

  it('moves through panes across groups on the arrow keys, and jumps on Home and End', async () => {
    const user = userEvent.setup();
    render(<SettingsOverlay />);

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    within(nav).getByRole('button', { name: 'Projects' }).focus();

    await user.keyboard('{ArrowUp}');

    const workflow = within(nav).getByRole('button', { name: 'Ticket workflow' });
    expect(workflow).toHaveFocus();
    expect(workflow).toHaveAttribute('aria-current', 'page');
    expect(workflow).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('heading', { name: 'Ticket workflow', level: 2 })).toBeInTheDocument();

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(within(nav).getByRole('button', { name: 'Appearance' })).toHaveFocus();

    await user.keyboard('{End}');
    expect(within(nav).getByRole('button', { name: 'Advanced' })).toHaveFocus();

    // The ends hold rather than wrap.
    await user.keyboard('{ArrowDown}');
    expect(within(nav).getByRole('button', { name: 'Advanced' })).toHaveFocus();

    await user.keyboard('{Home}');
    expect(within(nav).getByRole('button', { name: 'Overview' })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Overview', level: 2 })).toBeInTheDocument();
  });

  it('steps from Overview to Claude Code on ArrowDown (HIVE-376)', async () => {
    const user = userEvent.setup();
    useUiStore.getState().openSettings('harnesses-overview');
    render(<SettingsOverlay />);

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    within(nav).getByRole('button', { name: 'Overview' }).focus();
    await user.keyboard('{ArrowDown}');

    expect(within(nav).getByRole('button', { name: 'Claude Code' })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Claude Code', level: 2 })).toBeInTheDocument();
  });

  /**
   * The narrow layout (HIVE-374). Which half shows below the breakpoint is a
   * container query, so happy-dom can only see which view is asked for; the
   * layout itself is the web spec's (`settings-narrow.spec.ts`).
   */
  describe('narrow view', () => {
    const view = () => screen.getByTestId('settings-body').dataset.view;

    it('opens bare on the group list', () => {
      render(<SettingsOverlay />);

      expect(view()).toBe('list');
    });

    it('opens on the pane a caller named', () => {
      useUiStore.getState().openSettings('integrations');
      render(<SettingsOverlay />);

      expect(view()).toBe('pane');
    });

    it('opens a pane on click, and goes back to the list', async () => {
      const user = userEvent.setup();
      render(<SettingsOverlay />);

      const nav = screen.getByRole('navigation', { name: 'Settings sections' });
      await user.click(within(nav).getByRole('button', { name: 'Editor' }));

      expect(view()).toBe('pane');

      await user.click(screen.getByRole('button', { name: 'Back to Workspace' }));

      expect(view()).toBe('list');
    });

    /**
     * Opening a pane hides the list, and Back hides the pane, with
     * `display: none` under the breakpoint. Focus sitting in the half that hid
     * would fall to the body, so each move hands it across. Wide, the back
     * control is hidden itself, so focusing it is a no-op and focus stays
     * on the row that was clicked.
     */
    it('hands focus to the back control on open, and to the row on back', async () => {
      const user = userEvent.setup();
      render(<SettingsOverlay />);

      const nav = screen.getByRole('navigation', { name: 'Settings sections' });
      await user.click(within(nav).getByRole('button', { name: 'Editor' }));

      expect(screen.getByRole('button', { name: 'Back to Workspace' })).toHaveFocus();

      await user.click(screen.getByRole('button', { name: 'Back to Workspace' }));

      expect(within(nav).getByRole('button', { name: 'Editor' })).toHaveFocus();
    });

    it('leaves focus alone when a caller opens a pane by name', () => {
      useUiStore.getState().openSettings('integrations');
      render(<SettingsOverlay />);

      expect(screen.getByRole('button', { name: 'Back to Workspace' })).not.toHaveFocus();
    });

    it('moves on the arrows without leaving the list', async () => {
      const user = userEvent.setup();
      render(<SettingsOverlay />);

      const nav = screen.getByRole('navigation', { name: 'Settings sections' });
      within(nav).getByRole('button', { name: 'Projects' }).focus();
      await user.keyboard('{ArrowDown}');

      expect(view()).toBe('list');
    });
  });

  it('switches to Advanced (story 107)', async () => {
    const user = userEvent.setup();
    render(<SettingsOverlay />);

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const advanced = within(nav).getByRole('button', { name: 'Advanced' });

    await user.click(advanced);

    expect(advanced).toHaveAttribute('aria-current', 'page');
    expect(
      screen.getByRole('heading', { name: 'Advanced', level: 2 }),
    ).toBeInTheDocument();
  });

  it('opens on Projects and switches panes on click', async () => {
    const user = userEvent.setup();
    render(<SettingsOverlay />);

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const projects = within(nav).getByRole('button', { name: 'Projects' });
    const appearance = within(nav).getByRole('button', { name: 'Appearance' });

    // Always Projects on open: the realistic route in is the picker finding no
    // projects to offer, and landing that user in Appearance would strand them.
    expect(projects).toHaveAttribute('aria-current', 'page');
    expect(appearance).not.toHaveAttribute('aria-current');

    await user.click(appearance);

    expect(
      screen.getByRole('heading', { name: 'Appearance', level: 2 }),
    ).toBeInTheDocument();
    expect(appearance).toHaveAttribute('aria-current', 'page');
    expect(projects).not.toHaveAttribute('aria-current');

    await user.click(projects);

    expect(
      screen.getByRole('heading', { name: 'Projects', level: 2 }),
    ).toBeInTheDocument();
  });

  it('closes on the close button', async () => {
    const user = userEvent.setup();
    render(<SettingsOverlay />);

    await user.click(screen.getByRole('button', { name: 'Close settings' }));

    expect(useUiStore.getState().settings).toBe(false);
  });

  it('closes on Escape, matching the picker', async () => {
    const user = userEvent.setup();
    render(<SettingsOverlay />);

    await user.keyboard('{Escape}');

    expect(useUiStore.getState().settings).toBe(false);
  });

  /**
   * The half that `stopPropagation` cannot cover (story 103).
   *
   * Radix listens for Escape on the document in the **capture** phase, so it
   * decides before the key reaches whatever is focused — a nested control can
   * never win that race by stopping propagation. Anything that owns Escape for
   * itself marks its subtree `data-escape-scope`, and the overlay declines
   * those; without it, cancelling a rename closed the whole of Settings.
   */
  it('ignores an Escape a nested control has claimed', async () => {
    const user = userEvent.setup();
    render(<SettingsOverlay />);

    const claimed = document.createElement('input');
    claimed.setAttribute('data-escape-scope', '');
    screen.getByRole('dialog').append(claimed);
    claimed.focus();

    await user.keyboard('{Escape}');

    expect(useUiStore.getState().settings).toBe(true);
  });

  it('still closes on an Escape from an unclaimed element', async () => {
    const user = userEvent.setup();
    render(<SettingsOverlay />);

    const plain = document.createElement('input');
    screen.getByRole('dialog').append(plain);
    plain.focus();

    await user.keyboard('{Escape}');

    expect(useUiStore.getState().settings).toBe(false);
  });

  it('leaves activeTab untouched when it closes', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ activeTab: 'hero-refresh' });
    render(<SettingsOverlay />);

    await user.click(screen.getByRole('button', { name: 'Close settings' }));

    // Closing settings returns the user to the terminal they were watching.
    expect(useUiStore.getState().activeTab).toBe('hero-refresh');
  });

  /**
   * A caller may name the pane (HIVE-116).
   *
   * The always-Projects rule above is about the route that dominates — the
   * picker with nothing to offer. `+ New agent…` in the rail is the other
   * kind: it is answering a question the user just asked, and Projects would
   * lose it.
   */
  it('opens on the pane the caller asked for', () => {
    useUiStore.getState().openSettings('agents');

    render(<SettingsOverlay />);

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });

    expect(within(nav).getByRole('button', { name: 'Agents' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      within(nav).getByRole('button', { name: 'Projects' }),
    ).not.toHaveAttribute('aria-current');
  });

  /**
   * The overlay is `modal={false}` so the rails stay clickable underneath it,
   * which means `+ New agent…` can fire while Settings is already open. Reading
   * the request only at mount made that click do visibly nothing.
   */
  it('navigates on a request that arrives while it is already open', async () => {
    const user = userEvent.setup();
    render(<SettingsOverlay />);

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    await user.click(within(nav).getByRole('button', { name: 'Appearance' }));

    act(() => {
      useUiStore.getState().openSettings('agents');
    });

    expect(within(nav).getByRole('button', { name: 'Agents' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('consumes the request, so it cannot re-apply after the user moves on', async () => {
    // The other half of the same rule: a request acts exactly once. Left set,
    // any later re-render would drag the reader back to that pane.
    const user = userEvent.setup();
    useUiStore.getState().openSettings('agents');
    render(<SettingsOverlay />);

    expect(useUiStore.getState().settingsSection).toBeNull();

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    await user.click(within(nav).getByRole('button', { name: 'Appearance' }));

    act(() => {
      useUiStore.setState({ activeTab: 'hero-refresh' });
    });

    expect(
      within(nav).getByRole('button', { name: 'Appearance' }),
    ).toHaveAttribute('aria-current', 'page');
  });
});

/**
 * The predicate behind that guard, on its own.
 *
 * It was inline until the overlay stopped being modal. The two tests above
 * cover the focused cases; the branch that only exists *without* a focus trap —
 * the key pressed after focus has already left — needs a target outside the
 * dialog, which is easier to state here than to stage through the component.
 */
describe('escapeIsClaimed', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is false when nothing has claimed the key', () => {
    document.body.innerHTML = '<input id="plain" />';

    expect(escapeIsClaimed(document.getElementById('plain'))).toBe(false);
  });

  it('is true for a target inside a claiming subtree', () => {
    document.body.innerHTML = '<div data-escape-scope=""><input id="inner" /></div>';

    expect(escapeIsClaimed(document.getElementById('inner'))).toBe(true);
  });

  /**
   * The branch the non-modal overlay made reachable.
   *
   * With no focus trap a keyboard user can Tab out to the header while a rename
   * editor is still open. Escape pressed there has a target outside every
   * scope; keying off the target alone would let the overlay close and discard
   * the edit — the exact loss `data-escape-scope` exists to prevent.
   */
  it('is true when focus has left the overlay but an editor is still open', () => {
    document.body.innerHTML =
      '<header><button id="theme">theme</button></header>' +
      '<input id="editor" data-escape-scope="" />';

    expect(escapeIsClaimed(document.getElementById('theme'))).toBe(true);
  });

  it('is false once the claiming control unmounts', () => {
    document.body.innerHTML = '<header><button id="theme">theme</button></header>';

    expect(escapeIsClaimed(document.getElementById('theme'))).toBe(false);
  });

  it('survives a null target, and one that is not an element', () => {
    // `event.target` is typed `EventTarget`; `document` has no `closest`.
    expect(escapeIsClaimed(null)).toBe(false);
    expect(escapeIsClaimed(document)).toBe(false);
  });
});
