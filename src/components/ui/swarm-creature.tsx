import { useCallback, useRef } from 'react';

import { type CanvasPaint, useCanvasLoop } from '@hooks/use-canvas-loop';
import { useReducedMotion } from '@hooks/use-reduced-motion';
import { BLEED, type BroodCreature, paintCreature } from '@lib/swarm/brood';
import { HIVE } from '@lib/swarm/hive';
import { HOVER } from '@lib/swarm/hover';
import { OVERLORD } from '@lib/swarm/overlord';
import { SPIRE } from '@lib/swarm/spire';
import { toneOf } from '@lib/swarm/tone';
import { useSwarmPalette } from '@stores/appearance-store';

/**
 * A small breathing creature, for the surfaces that have nothing else on them.
 *
 * ## Where this is allowed, and at what size
 *
 * Two registers, and the size is what separates them:
 *
 * - **Full-stage surfaces at 72–120 px** — the picker's first run, the dormant
 *   orchestrator, the editor with no file, the settings card. Those own the
 *   whole centre and have nothing to compete with.
 * - **Rails at 44 px** — small enough to read as a mark rather than an
 *   illustration.
 *
 * The header's 40 px brand mark (HIVE-100) was a third, and the only one that
 * was never an empty state; the header went in HIVE-213 and the brand is the
 * Phosphor hexagon now.
 *
 * The rails were text-only when this shipped, on the argument that a decorative
 * empty state in a 320 px column beside a live terminal takes more attention
 * than the thing it is apologising for. That argument is about *size*, not about
 * whether a creature may appear at all: at 44 px the creature occupies less height
 * than the two lines of copy beneath it, and the copy is still what the eye
 * lands on. Anything larger in a rail is the thing the original argument
 * correctly rules out.
 *
 * ## Why a canvas
 *
 * The creatures are the Brood's (HIVE-221): drawn every frame from the theme's
 * own colours, so a light theme or an imported one gets a creature that belongs
 * to it, where the WebP sprites they replaced were painted once in one palette. Each is a pure drawing
 * in `src/lib/swarm/` on its own loop; this component only sizes the canvas to
 * the creature's box and clocks it.
 *
 * ## Motion
 *
 * The canvas animates only while it is on screen and the document is visible
 * (`useCanvasLoop`), so a creature in a hidden pane costs nothing. Under
 * `prefers-reduced-motion` it paints the creature's `rest` frame once and
 * schedules no frame at all. The creature is still there and simply holds
 * still.
 */

export type Creature = 'hive' | 'overlord' | 'spire' | 'mutalisk';

const CANVAS: Record<Creature, BroodCreature> = { hive: HIVE, overlord: OVERLORD, spire: SPIRE, mutalisk: HOVER };

/** A Brood creature on its own canvas, `size` tall and as wide as its box. */
function BroodCanvas({
  creature,
  brood,
  size,
  reduced,
}: {
  creature: Creature;
  brood: BroodCreature;
  size: number;
  reduced: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const palette = useSwarmPalette();
  const paint = useCallback<CanvasPaint>(
    (ctx, t, _dt, { w, h, dpr }) => paintCreature(ctx, brood, t % brood.dur, w, h, dpr, toneOf(palette), BLEED),
    [brood, palette],
  );
  useCanvasLoop(ref, paint, { still: reduced ? brood.rest : null });
  const [, , bw, bh] = brood.box;
  const width = (size * bw) / bh;

  return (
    <span
      /**
       * Decorative in the strict sense: the flavour line beneath it is real
       * text and says the same thing, and announcing the creature too would
       * make a screen reader read the state twice.
       */
      aria-hidden="true"
      data-creature={creature}
      style={{ display: 'inline-block', position: 'relative', height: size, width }}
      className="select-none"
    >
      {/*
        The layout keeps `size`; the canvas bleeds BLEED past it on every side
        (HIVE-222), so a ring, a glow or a wingtip drawn past the box fades out
        instead of ending in a hard edge. It takes no pointer events, so the air
        around the creature never covers what sits beside it.
      */}
      <canvas
        ref={ref}
        style={{
          position: 'absolute',
          left: -width * BLEED,
          top: -size * BLEED,
          width: width * (1 + 2 * BLEED),
          height: size * (1 + 2 * BLEED),
          pointerEvents: 'none',
        }}
      />
    </span>
  );
}

export function SwarmCreature({
  creature,
  size = 96,
}: {
  /**
   * Which one. The casting is a second channel, not decoration, so it is fixed
   * per surface rather than chosen per render:
   *
   * - **Hive** — the overmind's empty fleet, the new-session picker (both
   *   states), the settings projects **and skills** cards, and the explorer's
   *   empty states. The app's own face, and territory.
   * - **Overlord** — the projects rail. It hovers and watches without acting,
   *   which is what that state is.
   * - **Spire** — work, pull requests, and the editor with no file. Things with
   *   a lifecycle, caught mid-morph.
   * - **Mutalisk** — agents. The unit that does the work, holding the air until
   *   it is sent. It took the hydralisk's place when the creatures became the
   *   Brood's (HIVE-221).
   * - **A session booting** is the one surface that draws, not casts: the boot
   *   cover picks the overlord, the mutalisk or the spire once per mount. It
   *   has no neighbour in that state for a different creature to clash with.
   *
   * That is every call site; a reviewer should be able to check any one of them
   * against this list and find it here.
   *
   * ## The picker's two states share one creature
   *
   * **First run** has no projects, so a 120px hive stands in for the missing
   * content. Once projects exist, a 96px hive sits above the title as a mark.
   * Only ever one of the two renders; see the condition in
   * `new-session-picker.tsx`.
   *
   * ## Skills is a hive, not a mutalisk (HIVE-96)
   *
   * The tempting reading is that a skill belongs to the agent that runs it, and
   * agents are the mutalisk's. But the casting is per **surface**, not per
   * subject: Skills is a settings card, its only neighbour in that state is the
   * projects card, and the two are looked at in the same breath. Casting it for
   * its subject would put two different creatures side by side in one pane and
   * make the channel mean nothing — which is precisely what the rule below
   * forbids.
   *
   * A surface that picks a different creature than its neighbours in the same
   * state turns the channel back into noise, which is the whole reason this is
   * a fixed prop and not a random draw like the phrase beneath it. The boot
   * cover's draw happens at its call site, not here.
   */
  creature: Creature;
  /** Rendered height in px. The width follows the creature's own box. */
  size?: number;
}) {
  const reduced = useReducedMotion();

  return <BroodCanvas creature={creature} brood={CANVAS[creature]} size={size} reduced={reduced} />;
}
