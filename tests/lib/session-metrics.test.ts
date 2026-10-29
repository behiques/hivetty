import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  chipLabel,
  chipParts,
  clockLabel,
  creditsLabel,
  dayClockLabel,
  declaredMetrics,
  DEFAULT_EFFORT,
  modelLabel,
  pctLabel,
  pctOrNull,
  resetsDayLabel,
  timeLeftLabel,
} from '@/lib/session-metrics';
import { CAPABILITIES } from '@shared/harness-contract';

/**
 * These used to assert a *derivation* — that `contextPct('sess-01')` was stable
 * for an id. There is nothing left to derive: the numbers arrive from Claude
 * Code's status line, so what is worth testing is the boundary between "we were
 * told" and "we were not", and the formatting that has to survive both.
 */
describe('pctOrNull', () => {
  it('rounds a reported percentage', () => {
    expect(pctOrNull(46.4)).toBe(46);
    expect(pctOrNull(46.6)).toBe(47);
  });

  it('clamps a value outside 0–100 rather than trusting it', () => {
    // The number crossed a process boundary; a 140% arc would wrap past itself.
    expect(pctOrNull(140)).toBe(100);
    expect(pctOrNull(-3)).toBe(0);
  });

  /**
   * `null` is in this list for a different reason than the rest: it is what the
   * session says when it reports a context window it cannot put a percentage on
   * (after `/compact`), rather than a value that failed to parse. By the time it
   * reaches a gauge the two mean the same thing — not known — and only the store
   * needs to tell them apart.
   */
  it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY])(
    'answers null for %s — absence must never become a number',
    (value) => {
      expect(pctOrNull(value)).toBeNull();
    },
  );
});

describe('pctLabel', () => {
  it('renders a known percentage', () => {
    expect(pctLabel(46)).toBe('46%');
  });

  /**
   * A reported zero is still a fact and still renders.
   *
   * The em-dash case that used to live here is gone with the `null` argument
   * with it: the refusal to invent a number moved up to `model-chip.tsx`,
   * which renders no stat at all rather than a labelled empty one. What must
   * never happen — an unreported limit reading `0%` — is now unrepresentable
   * here rather than defended against.
   */
  it('renders a reported zero, which is not the same as no report', () => {
    expect(pctLabel(0)).toBe('0%');
  });
});

describe('clockLabel', () => {
  /**
   * Built from local components rather than a fixed epoch, because the label is
   * local-time by design and a hardcoded instant would assert the runner's
   * timezone instead of the formatting.
   */
  const at = (hours: number, minutes: number): number =>
    new Date(2026, 7, 11, hours, minutes, 0, 0).getTime() / 1000;

  it('drops the minutes when a reset lands on the hour', () => {
    expect(clockLabel(at(17, 0))).toBe('5p');
  });

  it('keeps them, zero-padded, when it does not', () => {
    expect(clockLabel(at(14, 30))).toBe('2:30p');
    expect(clockLabel(at(9, 5))).toBe('9:05a');
  });

  it('renders both noon and midnight as 12 rather than 0', () => {
    expect(clockLabel(at(12, 0))).toBe('12p');
    expect(clockLabel(at(0, 0))).toBe('12a');
  });

  /**
   * `resets_at` is epoch **seconds**. Forgetting the multiplication is the one
   * mistake in this area that silently produces a plausible-looking time in
   * 1970, so the seconds-to-milliseconds conversion is asserted directly.
   */
  it('reads its input as seconds, not milliseconds', () => {
    const seconds = at(14, 30);
    expect(clockLabel(seconds)).toBe('2:30p');
    // The same number read as milliseconds would land in January 1970.
    expect(new Date(seconds * 1000).getFullYear()).toBe(2026);
  });

  it.each([undefined, Number.NaN])('answers null for %s', (value) => {
    expect(clockLabel(value)).toBeNull();
  });

  /**
   * `0` is what a null becomes on its way through anything that defaults, and
   * it renders as a perfectly plausible `12a`. A confident wrong time is worse
   * than an em dash in the one module whose whole discipline is refusing to
   * invent numbers.
   */
  it('refuses epoch 0 rather than rendering it as midnight', () => {
    expect(clockLabel(0)).toBeNull();
    expect(dayClockLabel(0)).toBeNull();
  });

  it('refuses any timestamp from before this app could have produced one', () => {
    // 2019-06-01 — well before the earliest plausible reset.
    expect(clockLabel(1_559_347_200)).toBeNull();
  });
});

describe('dayClockLabel', () => {
  it('prefixes the weekday, because a weekly reset without one is not news', () => {
    // 2026-08-13 is a Thursday.
    const at = new Date(2026, 7, 13, 17, 0, 0, 0).getTime() / 1000;
    expect(dayClockLabel(at)).toBe('Thu 5p');
  });

  it('answers null when the five-hour label would', () => {
    expect(dayClockLabel(undefined)).toBeNull();
  });
});

describe('chipParts (HIVE-220)', () => {
  it('splits the label into the model, the window and the effort', () => {
    expect(
      chipParts({ model: 'Sonnet 4.5', effort: 'low', contextWindow: 1_000_000 }, 'opus', 'high'),
    ).toEqual({ name: 'Sonnet 4.5', window: ' (1M)', level: 'low' });
    expect(chipParts(undefined, 'haiku', 'low')).toEqual({ name: 'Haiku 4.5', window: '', level: 'low' });
  });

  it('is what chipLabel joins', () => {
    const { name, window, level } = chipParts({ contextWindow: 1_000_000 }, 'opus', 'high');
    expect(chipLabel({ contextWindow: 1_000_000 }, 'opus', 'high')).toBe(`${name}${window} · ${level}`);
  });
});

describe('chipLabel', () => {
  it('prefers what the session says about itself over what it was started with', () => {
    // `/model` and `/effort` change mid-conversation; the entity does not.
    expect(
      chipLabel({ model: 'Sonnet 4.5', effort: 'low' }, 'opus', 'high'),
    ).toBe('Sonnet 4.5 · low');
  });

  it('falls back to the entity, then to the concept defaults', () => {
    expect(chipLabel(undefined, 'haiku', 'low')).toBe('Haiku 4.5 · low');
    expect(chipLabel(undefined, undefined, undefined)).toBe(
      `${modelLabel()} · ${DEFAULT_EFFORT}`,
    );
  });

  it('takes no effort fallback for a CLI that has none to invent (HIVE-333)', () => {
    expect(chipLabel(undefined, 'gpt-6-luna', undefined, null)).toBe('gpt-6-luna');
    expect(chipLabel(undefined, 'gpt-6-luna', 'low', null)).toBe('gpt-6-luna · low');
  });

  /**
   * `(1M)` used to be hardcoded into the chip and was therefore wrong for every
   * 200k session. It is now a fact the session reports.
   */
  it('names the extended window only when the session reports one', () => {
    expect(chipLabel({ contextWindow: 1_000_000 }, 'opus', 'high')).toContain(
      '(1M)',
    );
    expect(chipLabel({ contextWindow: 200_000 }, 'opus', 'high')).not.toContain(
      '(1M)',
    );
    expect(chipLabel({}, 'opus', 'high')).not.toContain('(1M)');
  });

  /**
   * The suffix is derived, not the literal `(1M)` this first shipped as. The
   * threshold is documented as future-proof; a hardcoded label would have made
   * that only half true, announcing a 2M window as 1M in the one place the user
   * cannot otherwise see the size.
   */
  it('derives the size rather than hardcoding one megatoken', () => {
    expect(chipLabel({ contextWindow: 2_000_000 }, 'opus', 'high')).toContain(
      '(2M)',
    );
  });
});

describe('timeLeftLabel / resetsDayLabel (HIVE-200)', () => {
  // Mon 5 Oct 2026, 12:00 local — a fixed clock, never a real one.
  const NOW = new Date(2026, 9, 5, 12, 0, 0).getTime();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());
  const secs = (ms: number) => Math.floor(ms / 1000);

  it('says hours and minutes left', () => {
    expect(timeLeftLabel(secs(NOW + (3 * 60 + 12) * 60_000), NOW)).toBe('3h 12m left');
  });
  it('says minutes alone under an hour', () => {
    expect(timeLeftLabel(secs(NOW + 48 * 60_000), NOW)).toBe('48m left');
  });
  it('says <1m under a minute', () => {
    expect(timeLeftLabel(secs(NOW + 20_000), NOW)).toBe('<1m left');
  });
  it('is null for an absent, past or implausible reset', () => {
    expect(timeLeftLabel(undefined, NOW)).toBeNull();
    expect(timeLeftLabel(secs(NOW - 60_000), NOW)).toBeNull();
    expect(timeLeftLabel(0, NOW)).toBeNull();
  });
  it('names the reset weekday', () => {
    expect(resetsDayLabel(secs(new Date(2026, 9, 12, 9, 0).getTime()))).toBe(
      `resets ${new Date(2026, 9, 12).toLocaleDateString(undefined, { weekday: 'short' })}`,
    );
  });
  it('is null for an absent or implausible reset day', () => {
    expect(resetsDayLabel(undefined)).toBeNull();
    expect(resetsDayLabel(0)).toBeNull();
  });
});

it('labels a model that is not Claude’s by its own id (HIVE-279)', () => {
  expect(modelLabel('gpt-6-luna')).toBe('gpt-6-luna');
  expect(modelLabel('opus')).toBe('Opus 4.5');
});

describe('declaredMetrics (HIVE-333)', () => {
  it('keeps credits only for a CLI that declares them (HIVE-334)', () => {
    const reported = { model: 'gpt-6.1-sol', creditsBalance: '1234', creditsUnlimited: false };
    expect(declaredMetrics(reported, ['model', 'credits'])).toEqual(reported);
    expect(declaredMetrics(reported, CAPABILITIES['claude-code'].meters)).toEqual({ model: 'gpt-6.1-sol' });
  });

  const full = {
    model: 'Opus 4.5',
    effort: 'high',
    contextPct: 46,
    contextWindow: 1_000_000,
    fiveHourPct: 12,
    fiveHourResetsAt: 1_800_000_000,
    sevenDayPct: 71,
    sevenDayResetsAt: 1_800_000_000,
  };

  it('keeps every field when every meter is declared', () => {
    expect(declaredMetrics(full, ['model', 'effort', 'context', 'fiveHour', 'sevenDay'])).toEqual(full);
  });

  it('drops each undeclared meter with its companion fields', () => {
    expect(declaredMetrics(full, ['fiveHour'])).toEqual({ fiveHourPct: 12, fiveHourResetsAt: 1_800_000_000 });
    expect(declaredMetrics(full, ['context'])).toEqual({ contextPct: 46, contextWindow: 1_000_000 });
    expect(declaredMetrics(full, [])).toEqual({});
  });

  it('keeps a declared null, which clears the context', () => {
    expect(declaredMetrics({ contextPct: null }, ['context'])).toEqual({ contextPct: null });
  });

  it('passes no metrics through as none', () => {
    expect(declaredMetrics(undefined, ['model'])).toBeUndefined();
  });
});

describe('creditsLabel (HIVE-334)', () => {
  it('is ∞ for unlimited credits', () => {
    expect(creditsLabel({ creditsUnlimited: true })).toBe('∞');
    expect(creditsLabel({ creditsUnlimited: true, creditsBalance: '5' })).toBe('∞');
  });
  it('groups a balance’s digits', () => {
    expect(creditsLabel({ creditsBalance: '1234' })).toBe('1,234');
    expect(creditsLabel({ creditsBalance: '1234.5' })).toBe('1,234.5');
  });
  it('shows a balance that is not a number as Codex spelled it', () => {
    expect(creditsLabel({ creditsBalance: 'n/a' })).toBe('n/a');
    expect(creditsLabel({ creditsBalance: '' })).toBe('');
  });
  it('is null with no credits', () => {
    expect(creditsLabel(undefined)).toBeNull();
    expect(creditsLabel({ creditsUnlimited: false })).toBeNull();
  });
});
