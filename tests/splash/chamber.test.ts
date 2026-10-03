import { describe, expect, it } from 'vitest';

import { LOG_SCHEDULE, scheduleCopy, WORDMARK_START, WORDMARK_STEP } from '@/splash/chamber';

/**
 * The chamber's copy schedule, away from the document that runs it.
 *
 * `splash.ts` reaches for the document the moment it loads, so everything
 * worth asserting lives in `chamber.ts`, `globe.ts` and `stage.ts`. What a real
 * browser has to prove instead (that the globe is actually on screen) is in
 * `tests/e2e/electron/splash.spec.ts`.
 */

describe('scheduleCopy', () => {
  const chamber = (letters: number, lines: number) => {
    const root = document.createElement('div');
    const wordmark = document.createElement('p');
    wordmark.className = 'wordmark';
    for (let i = 0; i < letters; i++) wordmark.append(document.createElement('span'));
    const log = document.createElement('ul');
    log.className = 'log';
    for (let i = 0; i < lines; i++) log.append(document.createElement('li'));
    root.append(wordmark, log);
    return root;
  };

  it('walks the wordmark out one letter at a time', () => {
    const root = chamber(3, 0);
    scheduleCopy(root);

    const delays = [...root.querySelectorAll<HTMLElement>('.wordmark span')].map(
      (span) => span.style.animationDelay,
    );
    expect(delays).toEqual([
      `${WORDMARK_START}s`,
      `${WORDMARK_START + WORDMARK_STEP}s`,
      `${WORDMARK_START + WORDMARK_STEP * 2}s`,
    ]);
  });

  it('lands every log line on its scheduled second', () => {
    const root = chamber(0, LOG_SCHEDULE.length);
    scheduleCopy(root);

    const delays = [...root.querySelectorAll<HTMLElement>('.log li')].map(
      (line) => line.style.animationDelay,
    );
    expect(delays).toEqual(LOG_SCHEDULE.map((at) => `${at}s`));
  });

  it('finishes inside the floor the main process holds', async () => {
    const { SPLASH_MIN_MS } = await import('@shared/splash');
    expect(Math.max(...LOG_SCHEDULE) * 1000).toBeLessThan(SPLASH_MIN_MS);
  });

  it('holds an unscheduled extra line with the last one rather than showing it first', () => {
    const root = chamber(0, LOG_SCHEDULE.length + 1);
    scheduleCopy(root);

    const delays = [...root.querySelectorAll<HTMLElement>('.log li')].map(
      (line) => line.style.animationDelay,
    );
    expect(delays.at(-1)).toBe(`${LOG_SCHEDULE.at(-1)}s`);
    expect(delays.at(-1)).not.toBe('0s');
  });
});
