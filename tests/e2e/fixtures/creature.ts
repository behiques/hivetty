import { expect, type Locator } from '@playwright/test';

/**
 * A `SwarmCreature`'s canvas, read back (HIVE-221).
 *
 * The creatures are drawn, not decoded, so "it rendered" means pixels: the
 * share of the canvas with any alpha, and a digest of every byte so two reads
 * can be compared for a still frame.
 */
export async function readCreature(creature: Locator): Promise<{ painted: number; digest: number }> {
  return creature.evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    let digest = 0;
    for (let i = 0; i < data.length; i++) {
      digest = (digest * 31 + data[i]!) | 0;
      if (i % 4 === 3 && data[i]! > 0) lit++;
    }
    return { painted: lit / (data.length / 4), digest };
  });
}

/**
 * The creature is laid out at a real size and, once a frame has run, has
 * painted more than 3% of its canvas: a blank or collapsed canvas fails here.
 */
export async function expectCreatureDrawn(creature: Locator): Promise<void> {
  await expect(creature).toBeVisible();
  expect(await creature.evaluate((el) => el.tagName)).toBe('CANVAS');
  const box = await creature.boundingBox();
  expect(box?.height).toBeGreaterThan(50);
  await expect.poll(async () => (await readCreature(creature)).painted).toBeGreaterThan(0.03);
}
