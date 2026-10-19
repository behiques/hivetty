import {
  BUILT_IN_THEME_ID,
  HIVE_THEME_VERSION,
  type HiveTheme,
} from '@lib/theme/contract';

/**
 * The HiveTTY theme, as data: amber CRT phosphor on a warm carbon ground (HIVE-241).
 *
 * Every value here also appears in `tokens.css` (ui, syntax) or was the source
 * of `ansi.ts`'s palettes (terminal). `built-in.test.ts` reads the stylesheet
 * and fails if the two drift, which is why this file may hold hex literals and
 * component code may not.
 *
 * The dark `terminal` group is NOT derived from the ui group and must not be:
 * dark terminal text needs more lift than the chrome around it, and
 * `ansi.test.ts` asserts those colours never appear in `tokens.css`. The light
 * group is the opposite — a deliberate mirror.
 */
export const BUILT_IN_THEME: HiveTheme = {
  hiveThemeVersion: HIVE_THEME_VERSION,
  name: 'HiveTTY',
  author: 'Built in',
  version: '1.0.0',
  modes: {
    dark: {
      ui: {
        bg: '#191613', panel: '#1f1b18', panel2: '#1c1915',
        hover: '#292520', active: '#342f28',
        border: '#39332d', borderSoft: '#2d2824',
        ink: '#f0eeec', muted: '#b0aba5', subtle: '#9c9792',
        brand: '#ffb348', green: '#74b79c', amber: '#fea97c', red: '#ff8d85',
        chip: '#2c2822', chipHover: '#36302a',
        termBg: '#14110e', termInput: '#1a1612',
        termRowHover: '#27221c', termRowActive: '#2d2721',
        termHead: '#95908b', termTrack: '#4e4841',
        brandFill: '#fea91e', brandFillHover: '#f19f05',
        brandFillStrong: '#b67703', onBrand: '#110f0d', dangerSolid: '#d3372f',
        onDanger: '#ffffff',
        // No tissue ramp: like every other dark theme it is derived from `bg`,
        // `chitin` and `ink` (`swarmPaletteOf`). The hand-picked one sat almost
        // on the ground (body 1.23:1, lit 4.5:1) and the creatures disappeared.
        creep: '#6a4404', chitin: '#eab26b',
        glowCore: '#e2ffee', ground: '#171411',
      },
      syntax: {
        keyword: '#b39ff0', string: '#74b79c', number: '#fea97c',
        comment: '#7d7872', name: '#ffb348', type: '#7fd0e0',
        operator: '#aaa49e', constant: '#ff8d85', invalid: '#ff8d85',
        activeLine: '#322d27', selection: '#4b371c',
      },
      terminal: {
        bg: '#14110e', ink: '#fae0c1', dim: '#9b8871', black: '#14110e',
        green: '#7ee2b8', blue: '#8fb5ff', amber: '#febc9b', red: '#ff8d85',
        cyan: '#7edce2', magenta: '#7edce2', selection: '#3f2b10',
        // The two surfaces (HIVE-82) — `--cc-term-input` and `--cc-hover`,
        // the raised fills the app already uses over this ground.
        surface: '#1a1612', surfaceAlt: '#292520',
      },
    },
    light: {
      ui: {
        bg: '#fefdfc', panel: '#ffffff', panel2: '#faf9f8',
        hover: '#fbf8f4', active: '#f6f1eb',
        border: '#e0dbd7', borderSoft: '#f3f1ee',
        ink: '#312e2c', muted: '#5f5c59', subtle: '#6f6c68',
        brand: '#885703', green: '#2e6b52', amber: '#b15313', red: '#cd332b',
        chip: '#f3f1ee', chipHover: '#ebe8e4',
        termBg: '#faf9f8', termInput: '#ffffff',
        termRowHover: '#f6f2ef', termRowActive: '#f0ebe6',
        termHead: '#6d6a67', termTrack: '#e0dbd7',
        // Theme-invariant: tokens.css does not override these in light.
        brandFill: '#fea91e', brandFillHover: '#f19f05',
        brandFillStrong: '#b67703', onBrand: '#110f0d', dangerSolid: '#d3372f',
        onDanger: '#ffffff',
        creep: '#dfad6d', chitin: '#885703',
        tissueDeep: '#926d3d', tissue: '#e2cdb5', tissueLit: '#fef9f3',
        glowCore: '#96deb8', ground: '#f3ebe4',
      },
      syntax: {
        keyword: '#6f42c1', string: '#2e6b52', number: '#a35223',
        comment: '#94908b', name: '#885703', type: '#0b6b7d',
        operator: '#75726f', constant: '#b3271f', invalid: '#d3372f',
        activeLine: '#faf5f0', selection: '#fadbb5',
      },
      terminal: {
        bg: '#faf9f8', ink: '#312e2c', dim: '#6d6a67', black: '#312e2c',
        green: '#2e6b52',
        // Not `--cc-code-name` (the amber brand): ANSI blue stays blue (HIVE-241).
        blue: '#334fa9',
        amber: '#a35223', red: '#b3271f',
        cyan: '#0b6b7d', magenta: '#6f42c1',
        // `--cc-code-selection`, so a terminal selection matches the editor's (HIVE-241).
        selection: '#fadbb5',
        // `--cc-panel` and `--cc-chip`. The mirror of dark's pair: the ground
        // raised one step, then two.
        surface: '#ffffff', surfaceAlt: '#f3f1ee',
      },
    },
  },
};

export { BUILT_IN_THEME_ID };
