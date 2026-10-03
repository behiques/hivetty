import { beforeEach, describe, expect, it } from 'vitest';

import { useUiStore } from '@stores/ui-store';

/**
 * Reference pattern for store tests (story 013): call the action against a
 * fresh store and assert the resulting state. No React involved — the stores
 * are plain functions and are the highest-value target in the repo.
 *
 * Theme moved to `appearance-store` in story 105 — see
 * `tests/stores/appearance-store.test.ts` for its coverage.
 */
describe('ui-store — view state', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
  });

  it('starts on the orchestrator with the projects and inbox tabs', () => {
    const state = useUiStore.getState();

    expect(state.activeTab).toBe('orch');
    expect(state.leftTab).toBe('projects');
    expect(state.railTab).toBe('inbox');
    expect(state.showActivityRail).toBe(true);
  });

  it('openTab switches the center stage and dismisses the picker', () => {
    useUiStore.getState().openPicker();
    useUiStore.getState().openTab('webhooks');

    expect(useUiStore.getState().activeTab).toBe('webhooks');
    // The user has made their choice; leaving the overlay up would cover it.
    expect(useUiStore.getState().picker).toBe(false);
  });

  /**
   * The other half of `openSettings`, which has always dismissed the picker.
   *
   * `resolveView` gives settings precedence, so a picker opened underneath it
   * changed nothing on screen and then ambushed the user the next time they
   * closed settings. Unreachable while the header was inert behind an overlay;
   * reachable now that the chrome is live.
   */
  it('openPicker dismisses settings, the way openSettings dismisses the picker', () => {
    useUiStore.getState().openSettings();

    useUiStore.getState().openPicker();

    expect(useUiStore.getState()).toMatchObject({ picker: true, settings: false });
  });

  it('openSettings still dismisses the picker', () => {
    useUiStore.getState().openPicker();

    useUiStore.getState().openSettings();

    expect(useUiStore.getState()).toMatchObject({ picker: false, settings: true });
  });

  /**
   * For an action in the chrome whose destination is already correct — opening
   * a file from the explorer — where only the overlay is in the way.
   */
  it('revealStage clears both overlays and moves nothing else', () => {
    useUiStore.getState().openTab('webhooks');
    useUiStore.getState().openSettings();

    useUiStore.getState().revealStage();

    expect(useUiStore.getState()).toMatchObject({
      picker: false,
      settings: false,
      activeTab: 'webhooks',
    });
  });

  it('backToOrch returns to the orchestrator from any tab', () => {
    useUiStore.getState().openTab('webhooks');

    useUiStore.getState().backToOrch();

    expect(useUiStore.getState().activeTab).toBe('orch');
  });

  it('backToOrch also dismisses the picker', () => {
    useUiStore.getState().openTab('webhooks');
    useUiStore.getState().openPicker();

    useUiStore.getState().backToOrch();

    // Going home means going home: leaving the overlay up would cover the
    // orchestrator the user just asked for.
    expect(useUiStore.getState()).toMatchObject({
      activeTab: 'orch',
      picker: false,
    });
  });

  it('toggleProject collapses and expands', () => {
    const { toggleProject } = useUiStore.getState();

    toggleProject('nova-web');
    expect(useUiStore.getState().collapsed['nova-web']).toBe(true);

    toggleProject('nova-web');
    expect(useUiStore.getState().collapsed['nova-web']).toBe(false);
  });

  it('tracks each project independently', () => {
    useUiStore.getState().toggleProject('nova-web');

    expect(useUiStore.getState().collapsed['nova-web']).toBe(true);
    expect(useUiStore.getState().collapsed['referral-api']).toBeUndefined();
  });

  it('switches left and rail tabs', () => {
    useUiStore.getState().setLeftTab('agents');
    useUiStore.getState().setRailTab('prs');

    expect(useUiStore.getState().leftTab).toBe('agents');
    expect(useUiStore.getState().railTab).toBe('prs');
  });

  it('clears a stale query when the picker reopens', () => {
    const { openPicker, setPickerQuery, closePicker } = useUiStore.getState();

    openPicker();
    setPickerQuery('nova');
    closePicker();
    expect(useUiStore.getState().pickerQuery).toBe('nova');

    openPicker();
    expect(useUiStore.getState().pickerQuery).toBe('');
  });

  it('defaults new sessions to opus / high and lets both change', () => {
    expect(useUiStore.getState().newModel).toBe('opus');
    expect(useUiStore.getState().newEffort).toBe('high');

    useUiStore.getState().setNewModel('haiku');
    useUiStore.getState().setNewEffort('low');

    expect(useUiStore.getState().newModel).toBe('haiku');
    expect(useUiStore.getState().newEffort).toBe('low');
  });

  it('toggles the activity rail', () => {
    useUiStore.getState().toggleActivityRail();
    expect(useUiStore.getState().showActivityRail).toBe(false);
  });

  it('tracks the orchestrator table selection by id', () => {
    useUiStore.getState().setSelId('webhooks');
    expect(useUiStore.getState().selId).toBe('webhooks');
  });

  /**
   * An id, not a position. The nav order is sorted by recency, so an index is a
   * fact about the current fleet rather than about the caret — a session
   * spawning in the background renumbers every row and would move a selection
   * the user had not touched.
   */
  it('clears the selection with null', () => {
    useUiStore.getState().setSelId('webhooks');
    useUiStore.getState().setSelId(null);
    expect(useUiStore.getState().selId).toBeNull();
  });

  it('reset returns every field to its initial value', () => {
    const state = useUiStore.getState();
    state.openTab('webhooks');
    state.setLeftTab('agents');
    state.setSelId('webhooks');
    state.toggleProject('nova-web');

    useUiStore.getState().reset();

    expect(useUiStore.getState()).toMatchObject({
      activeTab: 'orch',
      leftTab: 'projects',
      selId: null,
      collapsed: {},
    });
  });
});

describe('settings overlay (story 101)', () => {
  it('openSettings clears the picker and leaves activeTab untouched', () => {
    useUiStore.getState().openTab('s1');
    useUiStore.getState().openPicker();

    useUiStore.getState().openSettings();

    const state = useUiStore.getState();
    expect(state.settings).toBe(true);
    // Two stacked full-stage overlays is the thing this prevents.
    expect(state.picker).toBe(false);
    // Closing settings has to return the user to the terminal they were
    // watching, which only works if the tab underneath is untouched.
    expect(state.activeTab).toBe('s1');
  });

  it('closeSettings changes nothing else — nothing was changed on open', () => {
    useUiStore.getState().openTab('s1');
    useUiStore.getState().openSettings();

    useUiStore.getState().closeSettings();

    expect(useUiStore.getState().settings).toBe(false);
    expect(useUiStore.getState().activeTab).toBe('s1');
  });

  it('reset clears the settings flag', () => {
    useUiStore.getState().openSettings();

    useUiStore.getState().reset();

    expect(useUiStore.getState().settings).toBe(false);
  });

  /**
   * The rails stay visible behind a full-stage overlay, so they remain
   * clickable while settings is open. `resolveView` returns `'settings'`
   * whatever `activeTab` says — so a rail click that left the overlay up would
   * change the tab underneath and look, to the user, like nothing happened.
   */
  it('opening a tab closes settings, as it closes the picker', () => {
    useUiStore.getState().openSettings();

    useUiStore.getState().openTab('s2');

    expect(useUiStore.getState().settings).toBe(false);
    expect(useUiStore.getState().activeTab).toBe('s2');
  });

  it('backToOrch closes settings', () => {
    useUiStore.getState().openSettings();

    useUiStore.getState().backToOrch();

    expect(useUiStore.getState().settings).toBe(false);
    expect(useUiStore.getState().activeTab).toBe('orch');
  });
});

/**
 * The explorer's view state.
 *
 * Which directories are open, and which repository the tree is rooted at while
 * no session is. Both are facts about a panel, both die with the window — which
 * is why they are here and not in `editor-store` beside the buffers.
 */
describe('the explorer tree', () => {
  it('toggles a directory open and closed', () => {
    useUiStore.getState().toggleExplorerDir('nova-web', 'src');
    expect(useUiStore.getState().explorerExpanded['nova-web:src']).toBe(true);

    useUiStore.getState().toggleExplorerDir('nova-web', 'src');
    expect(useUiStore.getState().explorerExpanded['nova-web:src']).toBe(false);
  });

  /**
   * Keyed by project as well as path, so returning to a repository finds it as
   * it was left rather than inheriting whatever the last one had expanded.
   */
  it('keeps one project’s expansion separate from another’s', () => {
    useUiStore.getState().toggleExplorerDir('nova-web', 'src');

    expect(useUiStore.getState().explorerExpanded['referral-api:src']).toBeUndefined();
  });

  /**
   * Everything, in every project. "Collapse all" that left another
   * repository's tree open would surprise the user the next time they opened a
   * session in it.
   */
  it('collapses every project at once', () => {
    useUiStore.getState().toggleExplorerDir('nova-web', 'src');
    useUiStore.getState().toggleExplorerDir('referral-api', 'lib');

    useUiStore.getState().collapseExplorer();

    expect(useUiStore.getState().explorerExpanded).toEqual({});
  });

  /**
   * The sticky project is gone (HIVE-93).
   *
   * It existed so the tree kept its last repository on the overmind tab. The
   * explorer now follows the active session or shows nothing, so there is
   * nothing to remember — see `use-explorer-project.ts` for why showing the
   * wrong repository is worse than showing none.
   */
  it('starts with nothing expanded', () => {
    useUiStore.getState().toggleExplorerDir('nova-web', 'src');

    useUiStore.getState().reset();

    expect(useUiStore.getState().explorerExpanded).toEqual({});
  });
});

describe('revealRailTab (HIVE-93)', () => {
  it('selects the tab and opens the rail', () => {
    useUiStore.setState({ railTab: 'prs', showActivityRail: false });

    useUiStore.getState().revealRailTab('inbox');

    expect(useUiStore.getState().railTab).toBe('inbox');
    expect(useUiStore.getState().showActivityRail).toBe(true);
  });

  it('is idempotent, so a second click does not hide the rail', () => {
    /**
     * The distinction from `toggleActivityRail`, which is what the header bell
     * must not do: a user clicking the bell twice is asking for the inbox twice,
     * not asking for it and then asking for it to go away.
     */
    useUiStore.getState().revealRailTab('inbox');
    useUiStore.getState().revealRailTab('inbox');

    expect(useUiStore.getState().showActivityRail).toBe(true);
    expect(useUiStore.getState().railTab).toBe('inbox');
  });

  it('does not disturb the rail when only the tab differs', () => {
    useUiStore.setState({ railTab: 'explorer', showActivityRail: true });

    useUiStore.getState().revealRailTab('inbox');

    expect(useUiStore.getState().railTab).toBe('inbox');
    expect(useUiStore.getState().showActivityRail).toBe(true);
  });
});

/**
 * Which pane settings opens on (HIVE-116).
 *
 * The overlay's rule — always land on Projects — was written for the route
 * that dominates: the picker discovering there are no projects. A caller that
 * *names* a pane is answering a question the user just asked, and the rule has
 * to make room for it without losing the default.
 */
describe('openSettings and its pane', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
  });

  it('records the pane a caller asked for', () => {
    useUiStore.getState().openSettings('agents');

    expect(useUiStore.getState().settings).toBe(true);
    expect(useUiStore.getState().settingsSection).toBe('agents');
  });

  it('asks for nothing when called bare, so the default still wins', () => {
    useUiStore.getState().openSettings();

    expect(useUiStore.getState().settings).toBe(true);
    expect(useUiStore.getState().settingsSection).toBeNull();
  });

  it('does not strand the next bare open on the last pane asked for', () => {
    // The bug this guards: `+ New agent…` opens Agents, the user closes, then
    // the header's gear opens — and lands on Agents with no idea why.
    useUiStore.getState().openSettings('agents');
    useUiStore.getState().closeSettings();
    useUiStore.getState().openSettings();

    expect(useUiStore.getState().settingsSection).toBeNull();
  });

  it('still dismisses the picker when a pane is named', () => {
    useUiStore.getState().openPicker();

    useUiStore.getState().openSettings('agents');

    expect(useUiStore.getState().picker).toBe(false);
  });

  it('is cleared by reset', () => {
    useUiStore.getState().openSettings('agents');

    useUiStore.getState().reset();

    expect(useUiStore.getState().settingsSection).toBeNull();
  });
});

/**
 * The WORK tab's search box, whose term lives here for the reason
 * `prSearchTerm` does: the term is what the user is looking at, and the issues
 * that come back are data.
 */
describe('ui-store — the work search', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
  });

  it('starts empty and searching everyone’s tickets', () => {
    const state = useUiStore.getState();

    expect(state.workSearchTerm).toBe('');
    expect(state.workSearchMineOnly).toBe(false);
  });

  it('holds what is typed', () => {
    useUiStore.getState().setWorkSearchTerm('rails');

    expect(useUiStore.getState().workSearchTerm).toBe('rails');
  });

  it('narrows to the user when asked', () => {
    useUiStore.getState().setWorkSearchMineOnly(true);

    expect(useUiStore.getState().workSearchMineOnly).toBe(true);
  });

  it('drops the scope when the box is emptied by hand', () => {
    // The failure this guards: a scope set for one question silently governing
    // the next. `prSearchAllRepos` follows the same rule, for the same reason.
    useUiStore.getState().setWorkSearchTerm('rails');
    useUiStore.getState().setWorkSearchMineOnly(true);

    useUiStore.getState().setWorkSearchTerm('');

    expect(useUiStore.getState().workSearchMineOnly).toBe(false);
  });

  it('drops the scope when the box is cleared by its button', () => {
    useUiStore.getState().setWorkSearchTerm('rails');
    useUiStore.getState().setWorkSearchMineOnly(true);

    useUiStore.getState().clearWorkSearch();

    expect(useUiStore.getState().workSearchTerm).toBe('');
    expect(useUiStore.getState().workSearchMineOnly).toBe(false);
  });

  it('keeps the scope while the term is only being edited', () => {
    useUiStore.getState().setWorkSearchMineOnly(true);

    useUiStore.getState().setWorkSearchTerm('rail');
    useUiStore.getState().setWorkSearchTerm('rails');

    expect(useUiStore.getState().workSearchMineOnly).toBe(true);
  });

  it('is cleared by reset', () => {
    useUiStore.getState().setWorkSearchTerm('rails');
    useUiStore.getState().setWorkSearchMineOnly(true);

    useUiStore.getState().reset();

    expect(useUiStore.getState().workSearchTerm).toBe('');
    expect(useUiStore.getState().workSearchMineOnly).toBe(false);
  });
});

describe('ui-store — the place machine (HIVE-195)', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
  });

  const ui = () => useUiStore.getState();

  it('opens on Home with the panel open', () => {
    expect(ui().place).toBe('home');
    expect(ui().panelOpen).toBe(true);
  });

  it('a new place opens its panel and dismisses the picker and settings', () => {
    useUiStore.setState({ panelOpen: false, picker: true, settings: true });

    ui().selectPlace('work');

    expect(ui()).toMatchObject({ place: 'work', panelOpen: true, picker: false, settings: false });
  });

  it('the active place toggles its panel', () => {
    ui().selectPlace('work');

    ui().selectPlace('work');
    expect(ui().panelOpen).toBe(false);

    ui().selectPlace('work');
    expect(ui().panelOpen).toBe(true);
  });

  it('Sessions with a session on stage goes back to the Overmind, panel untouched, then toggles', () => {
    ui().selectPlace('sessions');
    ui().openTab('hero-refresh');
    useUiStore.setState({ panelOpen: false });

    ui().selectPlace('sessions');
    expect(ui()).toMatchObject({ activeTab: 'orch', panelOpen: false, place: 'sessions' });

    ui().selectPlace('sessions');
    expect(ui().panelOpen).toBe(true);
  });

  it('togglePanel flips panelOpen', () => {
    ui().togglePanel();
    expect(ui().panelOpen).toBe(false);
    ui().togglePanel();
    expect(ui().panelOpen).toBe(true);
  });

  it('openTab with a place moves it; without one it stays', () => {
    ui().openTab('slack-agent', 'agents');
    expect(ui().place).toBe('agents');

    ui().openTab('hero-refresh');
    expect(ui()).toMatchObject({ place: 'agents', activeTab: 'hero-refresh' });
  });

  it('backToOrch lands on Sessions', () => {
    ui().backToOrch();
    expect(ui()).toMatchObject({ activeTab: 'orch', place: 'sessions' });
  });

  it('reset restores Home with the panel open', () => {
    ui().selectPlace('prs');
    ui().togglePanel();

    ui().reset();

    expect(ui()).toMatchObject({ place: 'home', panelOpen: true });
  });
});

describe('Sessions place view state (HIVE-197)', () => {
  beforeEach(() => useUiStore.getState().reset());

  it('starts unfiltered, folded, Ended folded', () => {
    const s = useUiStore.getState();
    expect(s.sessionsProject).toBeNull();
    expect(s.sessionsFilter).toBe('all');
    expect(s.endedExpanded).toBe(false);
    expect(s.expanded).toEqual({});
  });

  it('setSessionsProject filters and unfolds that project; null clears and keeps folds', () => {
    useUiStore.getState().setSessionsProject('nova-web');
    expect(useUiStore.getState().sessionsProject).toBe('nova-web');
    expect(useUiStore.getState().expanded['nova-web']).toBe(true);
    useUiStore.getState().setSessionsProject(null);
    expect(useUiStore.getState().sessionsProject).toBeNull();
    expect(useUiStore.getState().expanded['nova-web']).toBe(true);
  });

  it('toggleProjectFold flips, expandProject only opens, and neither touches Classic collapsed', () => {
    useUiStore.getState().toggleProjectFold('a');
    expect(useUiStore.getState().expanded.a).toBe(true);
    useUiStore.getState().toggleProjectFold('a');
    expect(useUiStore.getState().expanded.a).toBe(false);
    useUiStore.getState().expandProject('a');
    useUiStore.getState().expandProject('a');
    expect(useUiStore.getState().expanded.a).toBe(true);
    expect(useUiStore.getState().collapsed).toEqual({});
  });

  it('setSessionsFilter and expandEnded', () => {
    useUiStore.getState().setSessionsFilter('ended');
    useUiStore.getState().expandEnded();
    expect(useUiStore.getState().sessionsFilter).toBe('ended');
    expect(useUiStore.getState().endedExpanded).toBe(true);
  });

  it('the console starts folded and toggles (HIVE-197)', () => {
    useUiStore.getState().reset();
    expect(useUiStore.getState().consoleShown).toBe(false);
    useUiStore.getState().toggleConsole();
    expect(useUiStore.getState().consoleShown).toBe(true);
  });
});

describe('back to the Overmind (HIVE-197)', () => {
  beforeEach(() => useUiStore.getState().reset());

  it('backToOrch selects the session left and keeps filters and folds', () => {
    useUiStore.setState({
      activeTab: 'hero-refresh',
      sessionsProject: 'nova-web',
      sessionsFilter: 'live',
      expanded: { 'nova-web': true },
    });
    useUiStore.getState().backToOrch();
    const s = useUiStore.getState();
    expect(s.activeTab).toBe('orch');
    expect(s.selId).toBe('hero-refresh');
    expect(s.sessionsProject).toBe('nova-web');
    expect(s.sessionsFilter).toBe('live');
    expect(s.expanded).toEqual({ 'nova-web': true });
  });

  it('backToOrch from the Overmind leaves selId alone', () => {
    useUiStore.setState({ activeTab: 'orch', selId: 'x' });
    useUiStore.getState().backToOrch();
    expect(useUiStore.getState().selId).toBe('x');
  });

  it('the Sessions icon with a session on stage does the same', () => {
    useUiStore.setState({ place: 'sessions', activeTab: 'lead-form', selId: null });
    useUiStore.getState().selectPlace('sessions');
    expect(useUiStore.getState().activeTab).toBe('orch');
    expect(useUiStore.getState().selId).toBe('lead-form');
    expect(useUiStore.getState().panelOpen).toBe(true);
  });
});

describe('Work place (HIVE-203)', () => {
  beforeEach(() => useUiStore.getState().reset());

  it('opens a ticket on the Work place, on Comments, closing overlays', () => {
    useUiStore.setState({ picker: true, settings: true, workConversation: 'everything' });
    useUiStore.getState().openWorkTicket('HIVE-7');
    expect(useUiStore.getState()).toMatchObject({
      workTicket: 'HIVE-7',
      place: 'work',
      panelOpen: true,
      workConversation: 'comments',
      picker: false,
      settings: false,
    });
  });

  it('starts with Done folded and toggles one group', () => {
    expect(useUiStore.getState().workFolded).toEqual({ todo: false, 'in-progress': false, done: true });
    useUiStore.getState().toggleWorkGroup('done');
    expect(useUiStore.getState().workFolded.done).toBe(false);
  });

  it('starts with every agent lane unfolded and folds one (HIVE-204)', () => {
    expect(useUiStore.getState().agentsFolded).toEqual({ summons: false, morphing: false, burrowed: false });
    useUiStore.getState().toggleAgentGroup('burrowed');
    expect(useUiStore.getState().agentsFolded.burrowed).toBe(true);
  });

  it('switches the conversation mode', () => {
    useUiStore.getState().setWorkConversation('everything');
    expect(useUiStore.getState().workConversation).toBe('everything');
  });
});

describe('ui-store — the agent page (HIVE-204)', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
  });

  it('starts with no agent page', () => {
    expect(useUiStore.getState().agentPage).toBeNull();
  });

  it('openAgentPage opens the Agents place on the asked view and dismisses overlays', () => {
    useUiStore.getState().openSettings('agents');
    useUiStore.getState().openAgentPage('acr', 'definition');
    expect(useUiStore.getState()).toMatchObject({
      agentPage: { name: 'acr', view: 'definition' },
      place: 'agents',
      panelOpen: true,
      picker: false,
      settings: false,
    });
  });

  it('opening a named page also makes it the active tab; a new agent returns the tab to the orchestrator', () => {
    useUiStore.getState().openAgentPage('acr', 'activity');
    expect(useUiStore.getState().activeTab).toBe('acr');
    useUiStore.getState().openAgentPage(null, 'definition');
    expect(useUiStore.getState().activeTab).toBe('orch');
    expect(useUiStore.getState().agentPage).toEqual({ name: null, view: 'definition' });
  });

  it('openTab to the agents place opens that agent on Activity', () => {
    useUiStore.getState().openTab('shipper', 'agents');
    expect(useUiStore.getState().agentPage).toEqual({ name: 'shipper', view: 'activity' });
  });

  it('openTab to another place leaves the agent page as it was', () => {
    useUiStore.getState().openAgentPage('acr', 'definition');
    useUiStore.getState().openTab('sess-1', 'sessions');
    expect(useUiStore.getState().agentPage).toEqual({ name: 'acr', view: 'definition' });
  });

  it('setAgentPageView changes the view and keeps the agent', () => {
    useUiStore.getState().openAgentPage('acr', 'activity');
    useUiStore.getState().setAgentPageView('definition');
    expect(useUiStore.getState().agentPage).toEqual({ name: 'acr', view: 'definition' });
  });

  it('setAgentPageView with nothing open does nothing', () => {
    useUiStore.getState().setAgentPageView('definition');
    expect(useUiStore.getState().agentPage).toBeNull();
  });

  it('closeAgentPage leaves nothing open and stays on the place', () => {
    useUiStore.getState().openAgentPage('acr', 'activity');
    useUiStore.getState().closeAgentPage();
    expect(useUiStore.getState().agentPage).toBeNull();
    expect(useUiStore.getState().place).toBe('agents');
  });
});

describe('ui-store — the PRs place (HIVE-205)', () => {
  beforeEach(() => useUiStore.getState().reset());

  it('starts with no PR open, on Conversation, Hatched folded, Comments, no search', () => {
    expect(useUiStore.getState()).toMatchObject({
      prPage: null, prTab: 'conversation', prsFolded: true, prConversation: 'comments', prSearchOpen: false,
    });
  });

  it('openPrPage opens the PRs place on the PR, dismisses overlays, keeps the tab and resets the filter', () => {
    useUiStore.getState().openPicker();
    useUiStore.getState().setPrConversation('everything');
    useUiStore.setState({ panelOpen: false });

    useUiStore.getState().openPrPage({ owner: 'acme', repo: 'server', n: 1182 });

    expect(useUiStore.getState()).toMatchObject({
      prPage: { owner: 'acme', repo: 'server', n: 1182 },
      place: 'prs', panelOpen: true, picker: false, settings: false,
      prTab: 'conversation', prConversation: 'comments',
    });
  });

  it('toggles the fold, sets the tab, the filter and the search', () => {
    const ui = useUiStore.getState();
    ui.togglePrsFolded();
    ui.setPrTab('conversation');
    ui.setPrConversation('everything');
    ui.setPrSearchOpen(true);
    expect(useUiStore.getState()).toMatchObject({ prsFolded: false, prTab: 'conversation', prConversation: 'everything', prSearchOpen: true });
  });

  it('is reset with the rest of the view state', () => {
    useUiStore.getState().openPrPage({ owner: 'acme', repo: 'server', n: 1 });
    useUiStore.getState().reset();
    expect(useUiStore.getState().prPage).toBeNull();
  });
});

describe('ui-store — the inbox arrival queue (HIVE-198)', () => {
  beforeEach(() => useUiStore.getState().reset());

  it('starts empty with the drawer shut', () => {
    const s = useUiStore.getState();
    expect(s.arrivals).toEqual([]);
    expect(s.arrivalPulse).toBeNull();
    expect(s.inboxDrawer).toEqual({ open: false, thread: null });
  });

  it('pushes newest first and never twice', () => {
    const { pushArrival } = useUiStore.getState();
    pushArrival('a', false);
    pushArrival('b', false);
    pushArrival('a', false);
    expect(useUiStore.getState().arrivals).toEqual(['a', 'b']);
  });

  it('a quiet arrival pulses instead of rising', () => {
    useUiStore.getState().pushArrival('a', true);
    expect(useUiStore.getState().arrivals).toEqual([]);
    expect(useUiStore.getState().arrivalPulse).toBe('a');
  });

  it('nothing rises while the drawer is open', () => {
    useUiStore.getState().openInboxDrawer();
    useUiStore.getState().pushArrival('a', false);
    expect(useUiStore.getState().arrivals).toEqual([]);
  });

  it('folds the queue', () => {
    useUiStore.getState().pushArrival('a', false);
    useUiStore.getState().foldArrivals();
    expect(useUiStore.getState().arrivals).toEqual([]);
  });

  it('opens the drawer on a thread, folding what was up, and closes it', () => {
    useUiStore.getState().pushArrival('a', false);
    useUiStore.getState().openInboxDrawer('t1');
    expect(useUiStore.getState().inboxDrawer).toEqual({ open: true, thread: 't1' });
    expect(useUiStore.getState().arrivals).toEqual([]);
    useUiStore.getState().closeInboxDrawer();
    expect(useUiStore.getState().inboxDrawer).toEqual({ open: false, thread: null });
  });

  it('opens without a thread', () => {
    useUiStore.getState().openInboxDrawer();
    expect(useUiStore.getState().inboxDrawer).toEqual({ open: true, thread: null });
  });
});

describe('awaySince (HIVE-200)', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
  });

  it('starts at store creation and moves with markAway', () => {
    expect(typeof useUiStore.getState().awaySince).toBe('number');
    useUiStore.getState().markAway(1_700_000_000_000);
    expect(useUiStore.getState().awaySince).toBe(1_700_000_000_000);
  });
});
