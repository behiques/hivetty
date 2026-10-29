import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Session } from '@/types/entity';

import { ModelChip } from '@components/layout/model-chip';
import type { SessionMetrics } from '@shared/metrics-contract';
import { useHiveStore } from '@stores/hive-store';
import { useUiStore } from '@stores/ui-store';
import { seedDemoFleet } from '@tests/support/demo-fleet';

/**
 * The chip is conditional on *what kind of thing* the active tab is — the
 * acceptance criterion story 021 cares most about. Each case gets its own
 * assertion rather than one parameterised loop, so a regression names itself.
 *
 * HIVE-79 changed what it renders. The numbers are no longer derived from the
 * session id, so the interesting cases are now the two ends: a session that has
 * reported, and one that has not.
 */
describe('ModelChip', () => {
  beforeEach(() => {
    useHiveStore.getState().reset();
    seedDemoFleet();
    useUiStore.getState().reset();
  });

  it('is absent for the orchestrator', () => {
    useUiStore.setState({ activeTab: 'orch' });

    const { container } = render(<ModelChip />);

    expect(container).toBeEmptyDOMElement();
  });

  it('is absent for an agent — agents are not a metered conversation', () => {
    useUiStore.setState({ activeTab: 'slack-agent' });

    const { container } = render(<ModelChip />);

    expect(container).toBeEmptyDOMElement();
  });

  it('is absent for an unknown tab id', () => {
    useUiStore.setState({ activeTab: 'no-such-entity' });

    const { container } = render(<ModelChip />);

    expect(container).toBeEmptyDOMElement();
  });

  it('is present for a session', () => {
    useUiStore.setState({ activeTab: 'hero-refresh' });

    render(<ModelChip />);

    expect(screen.getByText(/Opus 4.5 · high/)).toBeInTheDocument();
  });

  describe('before the session has reported anything', () => {
    /**
     * The whole point of this pass. A session that has not reported
     * — the first seconds of every session, and the entire life of one
     * authenticated with an API key — shows the model it is running and nothing
     * else. It used to show three em dashes beside three empty rings, which is
     * a promise of numbers rather than an absence of them.
     */
    it('renders the model alone — no stat, no placeholder, no zero', () => {
      useUiStore.setState({ activeTab: 'hero-refresh' });

      render(<ModelChip />);

      expect(screen.getByText(/Opus 4.5 · high/)).toBeInTheDocument();
      expect(screen.queryByText('—')).not.toBeInTheDocument();
      expect(screen.queryByText('0%')).not.toBeInTheDocument();
      expect(screen.queryByText('ctx')).not.toBeInTheDocument();
    });

    it('draws no gauge for a number nobody reported', () => {
      useUiStore.setState({ activeTab: 'hero-refresh' });

      const { container } = render(<ModelChip />);

      expect(container.querySelector('svg[role="img"]')).toBeNull();
    });

    /** Nothing to spell out, so the tooltip is the label and only the label. */
    it('keeps the tooltip free of stats it does not have', () => {
      useUiStore.setState({ activeTab: 'hero-refresh' });

      render(<ModelChip />);

      expect(screen.getByTitle('Opus 4.5 · high')).toBeInTheDocument();
    });
  });

  /**
   * The state a real session sits in for as long as the user takes to send a
   * first prompt, and the one that prompted this change.
   *
   * Claude Code reports `rate_limits` within seconds of launch — they follow the
   * session's first API response — while `context_window.used_percentage` stays
   * null until the first **assistant turn**, because it is computed from the
   * last message carrying a `usage` block. Verified against 2.1.228: an idle
   * session reports both limits every thirty seconds and no context percentage
   * at all. So the two windows must be able to appear without the context stat
   * waiting on them, or dragging an em dash along beside them.
   */
  describe('when the limits have arrived but the context has not', () => {
    beforeEach(() => {
      useUiStore.setState({ activeTab: 'hero-refresh' });
      useHiveStore.getState().setSessionMetrics('hero-refresh', {
        model: 'Opus 4.5',
        effort: 'high',
        fiveHourPct: 3,
        sevenDayPct: 46,
      });
    });

    it('renders the two limits and omits the context stat entirely', () => {
      render(<ModelChip />);

      expect(screen.getByText('3%')).toBeInTheDocument();
      expect(screen.getByText('46%')).toBeInTheDocument();
      expect(screen.queryByText('ctx')).not.toBeInTheDocument();
      expect(screen.queryByText('—')).not.toBeInTheDocument();
    });

    /**
     * A percentage with no reset keeps the window's *name* as its detail. The
     * two travel together in every payload observed, but the contract makes them
     * independently optional and a lone number has to say which window it counts.
     */
    it('names each window when the payload carried no reset time', () => {
      render(<ModelChip />);

      expect(screen.getByText('session')).toBeInTheDocument();
      expect(screen.getByText('week')).toBeInTheDocument();
    });

    it('leaves the context out of the tooltip too', () => {
      render(<ModelChip />);

      const title = screen.getByTitle(/weekly limit/).getAttribute('title');
      expect(title).toContain('session limit 3%');
      expect(title).not.toContain('context');
    });
  });

  /**
   * The other direction, and the one a merge could get wrong.
   *
   * After `/compact` the session reports a context window with a null
   * percentage. The stat must go away rather than keep showing the pre-compact
   * number, which describes a conversation that no longer exists — see the null
   * handling in `metrics-contract.ts` and the store's merge.
   */
  it('drops the context stat when a later report nulls it', () => {
    useUiStore.setState({ activeTab: 'hero-refresh' });
    useHiveStore.getState().setSessionMetrics('hero-refresh', {
      contextPct: 92,
    });

    const { rerender } = render(<ModelChip />);
    expect(screen.getByText('92%')).toBeInTheDocument();

    useHiveStore.getState().setSessionMetrics('hero-refresh', {
      contextPct: null,
    });
    rerender(<ModelChip />);

    expect(screen.queryByText('92%')).not.toBeInTheDocument();
    expect(screen.queryByText('ctx')).not.toBeInTheDocument();
  });

  describe('once it has', () => {
    /** 2026-08-11 14:30 and 2026-08-13 17:00 local, in epoch seconds. */
    const fiveHourResetsAt = new Date(2026, 7, 11, 14, 30).getTime() / 1000;
    const sevenDayResetsAt = new Date(2026, 7, 13, 17, 0).getTime() / 1000;

    beforeEach(() => {
      useUiStore.setState({ activeTab: 'hero-refresh' });
      useHiveStore.getState().setSessionMetrics('hero-refresh', {
        model: 'Opus 4.5',
        effort: 'high',
        contextPct: 46,
        contextWindow: 1_000_000,
        fiveHourPct: 12,
        fiveHourResetsAt,
        // Distinct from the context percentage on purpose: three stats that
        // share a number make an ambiguous assertion, not a stronger one.
        sevenDayPct: 63,
        sevenDayResetsAt,
      });
    });

    it('renders all three percentages', () => {
      render(<ModelChip />);

      expect(screen.getByText('46%')).toBeInTheDocument();
      expect(screen.getByText('12%')).toBeInTheDocument();
      expect(screen.getByText('63%')).toBeInTheDocument();
      expect(screen.getByText('ctx')).toBeInTheDocument();
    });

    /**
     * Both windows, each with its own reset — the gap this closed. The old chip
     * showed one unlabelled percentage and a reset time with **no day**, so
     * neither of those facts was recoverable from what was on screen.
     */
    it('renders a reset for each window, with the weekday on the weekly one', () => {
      render(<ModelChip />);

      expect(screen.getByText('↻ 2:30p')).toBeInTheDocument();
      expect(screen.getByText('↻ Thu 5p')).toBeInTheDocument();
    });

    it('names the extended context window the session reported', () => {
      render(<ModelChip />);

      expect(screen.getByText(/Opus 4.5 \(1M\) · high/)).toBeInTheDocument();
    });

    it('spells everything out in the tooltip, so truncation loses no meaning', () => {
      render(<ModelChip />);

      const title = screen.getByTitle(/weekly limit/);
      expect(title.getAttribute('title')).toContain('context 46%');
      expect(title.getAttribute('title')).toContain(
        'session limit 12%, resets 2:30p',
      );
      expect(title.getAttribute('title')).toContain(
        'weekly limit 63%, resets Thu 5p',
      );
    });
  });

  it('falls back to Opus at high effort when the session names neither', () => {
    useUiStore.setState({ activeTab: 'webhooks' });

    render(<ModelChip />);

    // Fixture sessions carry no model/effort; the concept defaults the same way.
    expect(screen.getByText(/Opus 4.5 · high/)).toBeInTheDocument();
  });

  it('reads the model and effort a spawned session was given', () => {
    const id = useHiveStore
      .getState()
      .spawnSession('nova-web', 'ship it', 'claude-code', 'haiku', 'low');
    useUiStore.setState({ activeTab: id });

    render(<ModelChip />);

    expect(screen.getByText(/Haiku 4.5 · low/)).toBeInTheDocument();
  });

  it('leads with the CLI for a session that is not Claude’s, and draws no gauges without metrics (HIVE-279)', () => {
    const id = useHiveStore
      .getState()
      .spawnSession('nova-web', '', 'codex', 'gpt-6-luna', 'high');
    useUiStore.setState({ activeTab: id });

    const { container } = render(<ModelChip />);

    expect(screen.getByText('Codex · gpt-6-luna · high')).toBeInTheDocument();
    // The mark beside it, decorative: the name is already written out.
    expect(container.querySelector('svg[data-cli="codex"]')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByText('ctx')).not.toBeInTheDocument();
  });

  it('says what it always said for Claude, now beside its mark', () => {
    const id = useHiveStore
      .getState()
      .spawnSession('nova-web', '', 'claude-code', 'opus', 'high');
    useUiStore.setState({ activeTab: id });

    const { container } = render(<ModelChip />);

    expect(screen.getByText('Opus 4.5 · high')).toBeInTheDocument();
    expect(container.querySelector('svg[data-cli="claude-code"]')).toBeInTheDocument();
  });

  /**
   * Each CLI shows exactly the meters its `capabilities.meters` declares (HIVE-333). Every case is
   * handed the full set, so a meter the filter let through would show.
   */
  describe('meters by capability (HIVE-333)', () => {
    const FULL = {
      model: 'Opus 4.5',
      effort: 'xhigh',
      contextPct: 46,
      contextWindow: 1_000_000,
      fiveHourPct: 12,
      fiveHourResetsAt: new Date(2026, 7, 11, 14, 30).getTime() / 1000,
      sevenDayPct: 71,
    };

    const show = (id: string) => {
      useHiveStore.getState().setSessionMetrics(id, FULL);
      useUiStore.setState({ activeTab: id });
      render(<ModelChip />);
      return screen.getByTestId('model-chip');
    };

    it('leaves Claude’s strip byte-identical', () => {
      const id = useHiveStore.getState().spawnSession('nova-web', '', 'claude-code', 'opus', 'high');
      expect(show(id).outerHTML).toMatchInlineSnapshot(`"<span title="Opus 4.5 (1M) · xhigh · context 46% · session limit 12%, resets 2:30p · weekly limit 71%" data-testid="model-chip" class="flex items-center gap-1.5 whitespace-nowrap tabular-nums text-xs text-muted"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 256 256" class="shrink-0 text-brand"><path d="M248,124a56.11,56.11,0,0,0-32-50.61V72a48,48,0,0,0-88-26.49A48,48,0,0,0,40,72v1.39a56,56,0,0,0,0,101.2V176a48,48,0,0,0,88,26.49A48,48,0,0,0,216,176v-1.41A56.09,56.09,0,0,0,248,124ZM88,208a32,32,0,0,1-31.81-28.56A55.87,55.87,0,0,0,64,180h8a8,8,0,0,0,0-16H64A40,40,0,0,1,50.67,86.27,8,8,0,0,0,56,78.73V72a32,32,0,0,1,64,0v68.26A47.8,47.8,0,0,0,88,128a8,8,0,0,0,0,16,32,32,0,0,1,0,64Zm104-44h-8a8,8,0,0,0,0,16h8a55.87,55.87,0,0,0,7.81-.56A32,32,0,1,1,168,144a8,8,0,0,0,0-16,47.8,47.8,0,0,0-32,12.26V72a32,32,0,0,1,64,0v6.73a8,8,0,0,0,5.33,7.54A40,40,0,0,1,192,164Zm16-52a8,8,0,0,1-8,8h-4a36,36,0,0,1-36-36V80a8,8,0,0,1,16,0v4a20,20,0,0,0,20,20h4A8,8,0,0,1,208,112ZM60,120H56a8,8,0,0,1,0-16h4A20,20,0,0,0,80,84V80a8,8,0,0,1,16,0v4A36,36,0,0,1,60,120Z"></path></svg><svg aria-hidden="true" data-cli="claude-code" viewBox="0 0 24 24" fill="currentColor" class="size-4 shrink-0"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"></path></svg><span class="flex items-center gap-2"><span data-label="full" class="shrink-0 @max-[700px]:hidden">Opus 4.5 (1M) · xhigh</span><span data-label="model" class="hidden shrink-0 @max-[700px]:inline @max-[560px]:hidden">Opus 4.5</span><span class="flex shrink-0 items-center gap-1 border-l border-border pl-2"><svg width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="context: 46%" class="shrink-0"><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="2" class="text-border"></circle><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="37.69911184307752" stroke-dashoffset="20.35752039526186" transform="rotate(-90 7 7)" class="text-brand"></circle></svg><span class="text-brand">46%</span><span data-detail="only" class="text-subtle @max-[620px]:hidden">ctx</span></span><span class="flex shrink-0 items-center gap-1 border-l border-border pl-2"><svg width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="session limit: 12%" class="shrink-0"><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="2" class="text-border"></circle><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="37.69911184307752" stroke-dashoffset="33.17521842190821" transform="rotate(-90 7 7)" class="text-brand"></circle></svg><span class="text-brand">12%</span><span data-detail="long" class="text-subtle @max-[880px]:hidden">↻ 2:30p</span><span data-detail="short" class="hidden text-subtle @max-[880px]:inline @max-[620px]:hidden">5h</span></span><span class="flex shrink-0 items-center gap-1 border-l border-border pl-2"><svg width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="weekly limit: 71%" class="shrink-0"><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="2" class="text-border"></circle><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="37.69911184307752" stroke-dashoffset="10.932742434492482" transform="rotate(-90 7 7)" class="text-amber-text"></circle></svg><span class="text-amber-text">71%</span><span data-detail="long" class="text-subtle @max-[880px]:hidden">week</span><span data-detail="short" class="hidden text-subtle @max-[880px]:inline @max-[620px]:hidden">wk</span></span></span></span>"`);
    });

    it('shows a Copilot session its CLI and picked model, and no meter', () => {
      const id = useHiveStore.getState().spawnSession('nova-web', '', 'copilot', 'gpt-5.2', 'medium');
      const chip = show(id);
      expect(chip.getAttribute('title')).toBe('Copilot · gpt-5.2 · medium');
      expect(chip.textContent).not.toMatch(/%|ctx|N\/A|Opus|xhigh/);
      expect(chip.querySelector('svg[data-cli="copilot"]')).toBeInTheDocument();
    });

    it('invents no effort for a CLI session that recorded none', () => {
      // A spawn always records one; a session restored without it has none to show.
      // Copilot declares no meters, so the effort its metrics report cannot fill the gap (HIVE-334).
      const id = useHiveStore.getState().spawnSession('nova-web', '', 'copilot', 'gpt-5.2', 'medium');
      useHiveStore.setState((state) => ({
        entities: { ...state.entities, [id]: { ...(state.entities[id] as Session), effort: undefined } },
      }));
      expect(show(id).getAttribute('title')).toBe('Copilot · gpt-5.2');
    });

    /** The chip for `id` given only `metrics`, where `show` would seed FULL over them. */
    const showOnly = (id: string, metrics: SessionMetrics) => {
      useHiveStore.getState().setSessionMetrics(id, metrics);
      useUiStore.setState({ activeTab: id });
      render(<ModelChip />);
      return screen.getByTestId('model-chip');
    };

    it('shows a Codex session what it reported, credits included (HIVE-334)', () => {
      const id = useHiveStore.getState().spawnSession('nova-web', '', 'codex', 'gpt-6-luna', 'high');
      const chip = showOnly(id, {
        model: 'gpt-6.1-sol',
        effort: 'medium',
        contextPct: 12,
        contextWindow: 475_000,
        fiveHourPct: 18,
        sevenDayPct: 3,
        creditsBalance: '1234',
        creditsUnlimited: false,
      });
      expect(chip.getAttribute('title')).toBe(
        'Codex · gpt-6.1-sol · medium · context 12% · session limit 18% · weekly limit 3% · credits 1,234',
      );
      expect(chip.textContent).toContain('1,234credits');
    });

    it('shows ∞ for unlimited credits (HIVE-334)', () => {
      const id = useHiveStore.getState().spawnSession('nova-web', '', 'codex', 'gpt-6-luna', 'high');
      useHiveStore.getState().setSessionMetrics(id, { creditsUnlimited: true });
      expect(show(id).textContent).toContain('∞credits');
    });

    it('shows no credits stat for a Codex session without credits (HIVE-334)', () => {
      const id = useHiveStore.getState().spawnSession('nova-web', '', 'codex', 'gpt-6-luna', 'high');
      const chip = show(id);
      expect(chip.textContent).toContain('12%');
      expect(chip.textContent).not.toContain('credits');
      expect(chip.getAttribute('title')).not.toContain('credits');
    });

    it('never shows credits on a Claude session (HIVE-334)', () => {
      const id = useHiveStore.getState().spawnSession('nova-web', '', 'claude-code', 'opus', 'high');
      useHiveStore.getState().setSessionMetrics(id, { creditsBalance: '5' });
      const chip = show(id);
      expect(chip.textContent).not.toContain('credits');
      expect(chip.getAttribute('title')).not.toContain('credits');
    });
  });

  it('swaps when the active tab moves from one session to another', () => {
    useHiveStore.getState().setSessionMetrics('hero-refresh', { contextPct: 46 });
    useHiveStore.getState().setSessionMetrics('webhooks', { contextPct: 12 });

    useUiStore.setState({ activeTab: 'hero-refresh' });
    const { rerender } = render(<ModelChip />);
    expect(screen.getByText('46%')).toBeInTheDocument();

    useUiStore.setState({ activeTab: 'webhooks' });
    rerender(<ModelChip />);
    expect(screen.getByText('12%')).toBeInTheDocument();
    expect(screen.queryByText('46%')).not.toBeInTheDocument();
  });

  it('carries 5h and wk for the narrow step, and the tooltip keeps both resets (HIVE-213)', () => {
    useUiStore.setState({ activeTab: 'hero-refresh' });
    const fiveHourResetsAt = new Date(2026, 7, 11, 14, 30).getTime() / 1000;
    const sevenDayResetsAt = new Date(2026, 7, 13, 17, 0).getTime() / 1000;
    act(() =>
      useHiveStore.getState().setSessionMetrics('hero-refresh', {
        contextPct: 46,
        fiveHourPct: 12,
        sevenDayPct: 46,
        fiveHourResetsAt,
        sevenDayResetsAt,
      }),
    );
    render(<ModelChip />);
    const chip = screen.getByTestId('model-chip');
    const shorts = [...chip.querySelectorAll('[data-detail="short"]')].map((n) => n.textContent);
    expect(shorts).toEqual(['5h', 'wk']);
    expect(chip.querySelectorAll('[data-detail="long"]')).toHaveLength(2);
    expect(chip.getAttribute('title')).toMatch(/session limit 12%, resets .+ · weekly limit 46%, resets /);
  });

  describe('the steps with both panels open (HIVE-220)', () => {
    beforeEach(() => {
      useUiStore.setState({ activeTab: 'hero-refresh' });
      act(() =>
        useHiveStore.getState().setSessionMetrics('hero-refresh', {
          model: 'Opus 4.5',
          effort: 'high',
          contextPct: 46,
          contextWindow: 1_000_000,
          fiveHourPct: 12,
          sevenDayPct: 63,
          fiveHourResetsAt: new Date(2026, 7, 11, 14, 30).getTime() / 1000,
          sevenDayResetsAt: new Date(2026, 7, 13, 17, 0).getTime() / 1000,
        }),
      );
    });

    it('shortens the label to the model name, then drops it for the icon alone', () => {
      render(<ModelChip />);
      const chip = screen.getByTestId('model-chip');
      const full = chip.querySelector('[data-label="full"]')!;
      const model = chip.querySelector('[data-label="model"]')!;
      expect(full).toHaveTextContent('Opus 4.5 (1M) · high');
      expect(full.className).toContain('@max-[700px]:hidden');
      expect(model.textContent).toBe('Opus 4.5');
      expect(model.className).toMatch(/(^| )hidden( |$)/);
      expect(model.className).toContain('@max-[700px]:inline');
      expect(model.className).toContain('@max-[560px]:hidden');
    });

    it('drops the detail words, keeping every ring and percentage', () => {
      render(<ModelChip />);
      const chip = screen.getByTestId('model-chip');
      const words = [...chip.querySelectorAll('[data-detail]')];
      // ctx, plus long and short for each window.
      expect(words).toHaveLength(5);
      const narrowest = words.filter((n) => n.getAttribute('data-detail') !== 'long');
      for (const word of narrowest) expect(word.className).toContain('@max-[620px]:hidden');
      for (const pct of ['46%', '12%', '63%']) {
        expect(screen.getByText(pct).className).not.toMatch(/hidden/);
      }
    });

    it('keeps model, window, effort, every stat and both resets in the tooltip', () => {
      render(<ModelChip />);
      const title = screen.getByTestId('model-chip').getAttribute('title')!;
      expect(title).toContain('Opus 4.5 (1M) · high');
      expect(title).toContain('context 46%');
      expect(title).toContain('session limit 12%, resets 2:30p');
      expect(title).toContain('weekly limit 63%, resets Thu 5p');
    });
  });

  it('never clips its stats row: the session header gives way instead (HIVE-213)', () => {
    useUiStore.setState({ activeTab: 'hero-refresh' });
    act(() => useHiveStore.getState().setSessionMetrics('hero-refresh', { contextPct: 46 }));
    render(<ModelChip />);
    const chip = screen.getByTestId('model-chip');
    expect(chip).not.toHaveClass('min-w-0');
    expect(chip.querySelector('.overflow-hidden')).toBeNull();
  });
});
