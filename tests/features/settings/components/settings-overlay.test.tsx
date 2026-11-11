import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptySnapshot } from '@shared/config-contract';
import type { LicenceState } from '@shared/licence-contract';

import {
  SETTINGS_GROUPS,
  SettingsOverlay,
  escapeIsClaimed,
  paneLock,
} from '@features/settings/components/settings-overlay';
import { resetProjectConfig, setProjectConfigForTest } from '@lib/project-config';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';

let locks: { licence: LicenceState | null; settled: boolean } = { licence: null, settled: true };
vi.mock('@hooks/use-licence-locks', () => ({ useLicenceLocks: () => locks }));
const SOLO = {
  kind: 'licensed',
  plan: 'solo',
  features: ['cli.codex'],
  limits: {},
  exp: 2_000_000_000,
  iat: 1_800_000_000,
} as LicenceState;

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
      'Runtime',
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
      'Updates & About',
      'Advanced',
    ]) {
      expect(within(nav).getByRole('button', { name: present })).toBeInTheDocument();
    }
    // Containers is a band inside Runtime now, not a row; the account rows are the Account center's tabs.
    expect(within(nav).queryByRole('button', { name: 'Containers' })).toBeNull();
    expect(within(nav).queryByRole('button', { name: 'Plan & licence' })).toBeNull();
    expect(within(nav).getByRole('button', { name: /^Account/ })).toHaveAttribute('data-pane', 'account-devices');
  });

  it('opens the CLIs pane from the nav (HIVE-341)', async () => {
    const user = userEvent.setup();
    render(<SettingsOverlay />);

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    await user.click(within(nav).getByRole('button', { name: 'Overview' }));

    expect(screen.getByRole('heading', { name: 'Overview', level: 2 })).toBeInTheDocument();
  });

  /**
   * The grouped nav (HIVE-374), regrouped after the account-menu reorg: General first with Updates & About and
   * Advanced inside it, Projects with its services, Harnesses only the CLIs, Environment for where sessions run.
   * Groups are labels, not buttons, and a group with no pane yet is absent.
   */
  it('reads in five groups under the profile card, General first, with no empty group', () => {
    render(<SettingsOverlay />);

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const groups = within(nav).getAllByRole('group');
    const heading = (group: HTMLElement) =>
      document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent;

    expect(groups.map(heading)).toEqual(['General', 'Projects', 'Harnesses', 'Environment', 'Automation']);
    expect(
      groups.map((group) =>
        within(group)
          .getAllByRole('button')
          .map((button) => button.textContent),
      ),
    ).toEqual([
      ['Appearance', 'Editor', 'Notifications', 'Updates & About', 'Advanced'],
      ['Projects', 'Integrations', 'Ticket workflow'],
      ['Overview', 'Claude Code', 'Codex', 'Copilot'],
      ['Runtime', 'Server mode'],
      ['Agents', 'Skills'],
    ]);
    expect(within(nav).queryByRole('button', { name: 'Harnesses' })).not.toBeInTheDocument();
  });

  it.each([
    ['harnesses-overview', 'Overview'],
    ['claude-code', 'Claude Code'],
    ['codex', 'Codex'],
    ['copilot', 'Copilot'],
    ['shell', 'Runtime'],
    ['agents', 'Agents'],
    ['skills', 'Skills'],
    ['ticket-workflow', 'Ticket workflow'],
    ['projects', 'Projects'],
    ['appearance', 'Appearance'],
    ['editor', 'Editor'],
    ['integrations', 'Integrations'],
    ['notifications', 'Notifications'],
    ['server-mode', 'Server mode'],
    ['account-devices', 'Account'],
    ['plan-licence', 'Account'],
    ['account-org', 'Account'],
    ['updates-about', 'Updates & About'],
    ['advanced', 'Advanced'],
  ] as const)('pane id %s renders its section', (id, title) => {
    useUiStore.getState().openSettings(id);
    render(<SettingsOverlay />);

    expect(screen.getByRole('heading', { name: title, level: 2 })).toBeInTheDocument();
  });

  it.each([
    ['runtime', 'Runtime'],
    ['clis', 'Overview'],
    ['containers', 'Runtime'],
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

  it.each(['account-devices', 'plan-licence', 'account-org'] as const)(
    'the profile card is the current row for %s, and opens the Account center',
    async (id) => {
      const user = userEvent.setup();
      useUiStore.getState().openSettings(id);
      render(<SettingsOverlay />);
      const nav = screen.getByRole('navigation', { name: 'Settings sections' });
      const card = within(nav).getByRole('button', { name: /^Account/ });

      expect(card).toHaveAttribute('aria-current', 'page');
      expect(card).toHaveAttribute('tabindex', '0');
      expect(screen.getByRole('tablist', { name: 'Account' })).toBeInTheDocument();

      await user.click(within(nav).getByRole('button', { name: 'Editor' }));
      expect(card).not.toHaveAttribute('aria-current');
      await user.click(card);
      expect(screen.getByRole('tab', { name: 'Profile & devices' })).toHaveAttribute('aria-selected', 'true');
    },
  );

  it('the retired containers id lands on Runtime, scrolled to its Containers band', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    useUiStore.getState().openSettings('containers');
    render(<SettingsOverlay />);

    const band = screen.getByRole('region', { name: 'Containers' });
    expect(band).toHaveAttribute('data-settings-anchor', 'containers');
    expect(scroll.mock.contexts).toEqual([band]);
    expect(useUiStore.getState().settingsAnchor).toBeNull();
    scroll.mockRestore();
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

    const advanced = within(nav).getByRole('button', { name: 'Advanced' });
    expect(advanced).toHaveFocus();
    expect(advanced).toHaveAttribute('aria-current', 'page');
    expect(advanced).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('heading', { name: 'Advanced', level: 2 })).toBeInTheDocument();

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(within(nav).getByRole('button', { name: 'Integrations' })).toHaveFocus();

    await user.keyboard('{End}');
    expect(within(nav).getByRole('button', { name: 'Skills' })).toHaveFocus();

    // The ends hold rather than wrap.
    await user.keyboard('{ArrowDown}');
    expect(within(nav).getByRole('button', { name: 'Skills' })).toHaveFocus();

    // Home is the profile card, the first row.
    await user.keyboard('{Home}');
    expect(within(nav).getByRole('button', { name: /^Account/ })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Account', level: 2 })).toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    expect(within(nav).getByRole('button', { name: 'Appearance' })).toHaveFocus();
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

    it('an account tab goes back to the list as Account', () => {
      useUiStore.getState().openSettings('plan-licence');
      render(<SettingsOverlay />);

      expect(screen.getByRole('button', { name: 'Back to Account' })).toBeInTheDocument();
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

      await user.click(screen.getByRole('button', { name: 'Back to General' }));

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

      expect(screen.getByRole('button', { name: 'Back to General' })).toHaveFocus();

      await user.click(screen.getByRole('button', { name: 'Back to General' }));

      expect(within(nav).getByRole('button', { name: 'Editor' })).toHaveFocus();
    });

    it('leaves focus alone when a caller opens a pane by name', () => {
      useUiStore.getState().openSettings('integrations');
      render(<SettingsOverlay />);

      expect(screen.getByRole('button', { name: 'Back to Projects' })).not.toHaveFocus();
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

    // Projects before any pane was shown; the picker names it, so its no-projects user lands there regardless.
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

  it('a bare open comes back to the pane last shown; a named pane still wins', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SettingsOverlay />);
    await user.click(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: 'Appearance' }));
    unmount();

    render(<SettingsOverlay />);
    expect(screen.getByRole('heading', { name: 'Appearance', level: 2 })).toBeInTheDocument();

    act(() => useUiStore.getState().openSettings('projects'));
    expect(screen.getByRole('heading', { name: 'Projects', level: 2 })).toBeInTheDocument();
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

describe('Account › Plan & licence (HIVE-268)', () => {
  beforeEach(() => {
    locks = { licence: null, settled: true };
  });

  it('opens from the profile card, as the Account center’s Plan & billing tab', async () => {
    const user = userEvent.setup();
    render(<SettingsOverlay />);
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    await user.click(within(nav).getByRole('button', { name: /^Account/ }));
    await user.click(screen.getByRole('tab', { name: 'Plan & billing' }));
    expect(screen.getByRole('tabpanel', { name: 'Plan & billing' })).toHaveTextContent('Sign in to see your plan.');
  });

  it('the Codex and Copilot panes carry their lease features (HIVE-332)', () => {
    const panes = SETTINGS_GROUPS.flatMap((g) => g.panes).filter((p) => p.feature !== undefined);
    expect(panes.map((p) => [p.id, p.feature])).toEqual([
      ['codex', 'cli.codex'],
      ['copilot', 'cli.copilot'],
    ]);
  });

  it('on a Solo lease the Copilot pane shows Locked: Team and the Lock, and Codex is open (HIVE-332)', async () => {
    locks = { licence: SOLO, settled: true };
    const user = userEvent.setup();
    render(<SettingsOverlay />);
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav.querySelector('[data-pane="codex"]') as HTMLElement).queryByLabelText(/Locked/)).toBeNull();
    const row = nav.querySelector('[data-pane="copilot"]') as HTMLElement;
    expect(within(row).getByLabelText('Locked: Team')).toBeInTheDocument();
    await user.click(row);
    expect(screen.getByRole('note', { name: 'Copilot is in Team and above' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeInTheDocument();
  });

  it('locks no pane while the licence locks nothing (gate off, unread) (HIVE-332)', () => {
    render(<SettingsOverlay />);
    expect(screen.queryByLabelText(/Locked/)).toBeNull();
  });
});

describe('Account › Account & devices (HIVE-265)', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
  });

  it('the profile card opens the Account center on Profile & devices; signed out it says so', async () => {
    const user = userEvent.setup();
    useUiStore.getState().openSettings();
    render(<SettingsOverlay />);
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const card = within(nav).getByRole('button', { name: 'Account' });
    expect(card).toHaveTextContent('Not signed in');
    await user.click(card);
    expect(screen.getByRole('tabpanel', { name: 'Profile & devices' })).toHaveTextContent('Sign in to see your account.');
  });

  it("openSettings('account-devices') shows the Account center on that tab", () => {
    useUiStore.getState().openSettings('account-devices');
    render(<SettingsOverlay />);
    expect(screen.getByRole('heading', { name: 'Account', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Profile & devices' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('paneLock (HIVE-268)', () => {
  it('no feature, no lock', () => {
    expect(paneLock(undefined, null)).toBeNull();
  });
  it('a feature the lease grants, no lock', () => {
    expect(paneLock('cli.codex', { kind: 'licensed', org: 'org_1', plan: 'solo', features: ['cli.codex'], limits: {}, exp: 2e9, iat: 1.8e9 })).toBeNull();
  });
  it('a feature the lease lacks: its reason and plan', () => {
    expect(paneLock('cli.copilot', { kind: 'licensed', org: 'org_1', plan: 'solo', features: [], limits: {}, exp: 2e9, iat: 1.8e9 })).toEqual({
      reason: 'Copilot is in Team and above',
      plan: 'Team',
    });
  });
});
