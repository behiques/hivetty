/**
 * Every colour the swarm canvas paints with (HIVE-199).
 *
 * The canvas reads colour from JS, as xterm does: nothing in `src/lib/swarm/`
 * holds a colour literal, so Home and the splash both draw in whatever theme
 * is active. `swarmPaletteOf` in `@lib/theme/colour` builds one from a theme's
 * ui group; `useSwarmPalette` hands Home the active one.
 */
export interface SwarmPalette {
  bg: string;
  panel2: string;
  ink: string;
  muted: string;
  subtle: string;
  brand: string;
  green: string;
  amber: string;
  red: string;
  creep: string;
  /** `creep` at alpha 0: the outer stop of the creep's radial gradient. */
  creepClear: string;
  chitin: string;
  /** The creature's body fill. Derived from chitin and bg; HIVE-210 settles it. */
  carapace: string;
}
