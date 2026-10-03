import { expect, test } from '@playwright/test';

import { PHRASES } from '../../../src/lib/swarm/phrases';
import { goToOvermind } from '../fixtures/places';

/**
 * The swarm layer, in a real browser against production output.
 *
 * Unit tests prove the pools and the hook. They cannot prove that an animated
 * WebP survives the asset pipeline, that the creature is laid out rather than
 * collapsed to nothing, or that a flavour line actually reaches the stage — all
 * three are build-and-layout claims, and happy-dom performs no layout.
 *
 * The app boots empty, which is exactly the state this whole change is about,
 * so every surface asserted here is on screen at load with no setup.
 */

const APP_URL = '/?sim=0';

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await goToOvermind(page);
});

test('the dormant orchestrator holds a creature and a line', async ({ page }) => {
  const empty = page.getByTestId('session-table-empty');
  await expect(empty).toBeVisible();

  const creature = empty.locator('[data-creature="hive"]');
  await expect(creature).toBeVisible();

  /**
   * The asset has to have *decoded*, not merely resolved to a URL. A 404 still
   * produces a visible <img>; a zero natural width is what a broken sprite
   * looks like from the outside.
   */
  const decoded = await creature.evaluate(
    (img) => (img as HTMLImageElement).naturalWidth,
  );
  expect(decoded).toBeGreaterThan(0);

  // Laid out at the size it was asked for, not collapsed.
  const box = await creature.boundingBox();
  expect(box?.height).toBeGreaterThan(50);

  await expect(empty).toContainText('No sessions running — start one with New session.');

  const text = (await empty.textContent()) ?? '';
  const drew = PHRASES['empty.sessions'].some((phrase) => text.includes(phrase));
  expect(drew, `no phrase from empty.sessions in: ${text}`).toBe(true);
});

/*
  Round two draws no empty panel (HIVE-211): the stage pages that say why are
  asserted by round-two.spec.ts, and the pools by the unit tests.
*/
