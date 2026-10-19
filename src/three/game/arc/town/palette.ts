/*
 * Colours of Пастильное королевство. The day palette is the hub; the night one is the base the vampire episode
 * («Клыки в пастиле») builds its look on (it may pass its own palette to buildTown, e.g. greyer for the bitten town).
 */

export interface TownPalette {
  night: boolean;
  /** sugar grass, paths, the square, the creek */
  grass: string; grassDots: string; cobble: string[]; cobbleGap: string; plaza: string[]; plazaGap: string;
  /** strawberry-syrup creek (surface, swirls) and the layered pastila banks */
  syrup: string; syrupLight: string; bank: string[];
  /** marshmallow / pastila walls (picked per building) and roofs (cones, icing tints) */
  walls: string[]; roofs: string[]; icing: string;
  /** gingerbread */
  ginger: string; gingerDark: string;
  /** windows: frame glass by day; at night they glow */
  glass: string; windowGlow: string;
  /** candy accents (gumdrops, sprinkles, flags, awnings) */
  candy: string[];
  /** marmalade lamps: jelly colours, whether they are lit, light colour */
  jelly: string[]; lampsLit: boolean; lampLight: string;
  /** the town wall */
  wall: string; wallTop: string;
  /** sky / fog / lights for a level that uses this palette */
  sky: { zenith: string; upper: string; lower: string; horizon: string; anti: string; glow: string; sun: string; moon: string };
  bg: string; fog: [string, number, number];
  hemi: [string, string, number];
  sun: { color: string; intensity: number; dir: [number, number, number] };
  /** distant candy hills (near → far) */
  hills: { color: string; rim: string; haze: string }[];
  clouds: { top: string; bottom: string; glow: string };
}

export const DAY: TownPalette = {
  night: false,
  grass: '#9fe3a6', grassDots: '#e9fff0',
  cobble: ['#ffd9e4', '#fff1d6', '#d9f3e6', '#e9defa', '#ffe6cc'], cobbleGap: '#e7b9b0',
  plaza: ['#fff4ea', '#ffd3e0', '#fff4ea', '#d6f0ff'], plazaGap: '#e0b2b8',
  syrup: '#ff6f9a', syrupLight: '#ffb3c9', bank: ['#ffd1dd', '#fff6ee', '#ff9fbc', '#fff6ee', '#c8f0d8'],
  walls: ['#fff4f6', '#ffd6e4', '#e8f6ff', '#fff0d8', '#d8ffe8', '#fde8ff', '#ffe9c7'],
  roofs: ['#ff7aa8', '#6fd8b8', '#f29ac0', '#8ab8ff', '#ffb04a', '#c88aff', '#ff5a7a'],
  icing: '#fffaf5',
  ginger: '#c8803e', gingerDark: '#8a4f22',
  glass: '#bfe6ff', windowGlow: '#ffd27a',
  candy: ['#ff5a8a', '#7ad8ff', '#ffd04a', '#9af08a', '#c88aff', '#ff9a4a'],
  jelly: ['#ff8a2a', '#ff4f6a', '#ffcf3a', '#7fe07a'], lampsLit: false, lampLight: '#ffb85a',
  wall: '#ffe2ea', wallTop: '#fffaf5',
  sky: { zenith: '#4a8fe8', upper: '#8cc4ff', lower: '#ffd6ea', horizon: '#fff0d8', anti: '#d6c4ff', glow: '#fff0b8', sun: '#fffbe8', moon: '#f4f2ff' },
  bg: '#bfe0ff', fog: ['#f4dcef', 70, 330],
  hemi: ['#fff2fb', '#a8d8b0', 1.25],
  sun: { color: '#fff1d6', intensity: 2.55, dir: [0.55, 1, 0.35] },
  hills: [
    { color: '#9ee0b4', rim: '#e8fff0', haze: '#f0d8ee' },
    { color: '#f7b6d2', rim: '#fff0f6', haze: '#f4dcef' },
    { color: '#c9b8f4', rim: '#f8f0ff', haze: '#f6e4f4' },
    { color: '#e6c8f0', rim: '#fff6ff', haze: '#f9ecf6' },
  ],
  clouds: { top: '#ffffff', bottom: '#ffd6ea', glow: '#fff6e0' },
};

export const NIGHT: TownPalette = {
  ...DAY,
  night: true,
  grass: '#4f7f6e', grassDots: '#9fc8bc',
  cobble: ['#8a7a96', '#9a8aa0', '#7f8aa0', '#8f86a8', '#9a8a92'], cobbleGap: '#4e4058',
  plaza: ['#a89ab4', '#8e7a9e', '#a89ab4', '#7e8eae'], plazaGap: '#4a3c56',
  syrup: '#8a2f5a', syrupLight: '#c45a86', bank: ['#9a7a92', '#b8a8b8', '#8a5a7a', '#b8a8b8', '#6a8a86'],
  walls: ['#c8bcd2', '#b8a2c0', '#a8b8d2', '#c8b8a8', '#a8c8bc', '#bcaad2', '#c8b49a'],
  roofs: ['#9a4a74', '#3e8a7a', '#9a5a86', '#4e6aa8', '#a0702e', '#7a52a8', '#9a3a58'],
  icing: '#d8d2e6',
  ginger: '#7a5232', gingerDark: '#4a2e18',
  glass: '#3a4a6e', windowGlow: '#ffc25a',
  candy: ['#c84a7a', '#4a9ac8', '#c8a03a', '#6ab86a', '#9a6ad8', '#c8743a'],
  jelly: ['#ff9a3a', '#ff5a7a', '#ffd84a', '#8af08a'], lampsLit: true, lampLight: '#ffb060',
  wall: '#8e7a9a', wallTop: '#b8a8c8',
  sky: { zenith: '#0a0a24', upper: '#1c1a46', lower: '#3a2a5a', horizon: '#5a2a4a', anti: '#2a2a52', glow: '#ff4a4a', sun: '#ff5a4a', moon: '#ff6a5a' },
  bg: '#141232', fog: ['#2a2244', 40, 200],
  hemi: ['#6a6aa8', '#2a2038', 0.65],
  sun: { color: '#ff9a9a', intensity: 0.9, dir: [-0.4, 0.8, -0.6] },
  hills: [
    { color: '#2a3a46', rim: '#5a5a86', haze: '#2a2244' },
    { color: '#3a2a4a', rim: '#6a4a7a', haze: '#2a2244' },
    { color: '#2e2a52', rim: '#5a4a86', haze: '#2a2448' },
    { color: '#3a2e56', rim: '#6a5a8e', haze: '#2c264a' },
  ],
  clouds: { top: '#3a3a6a', bottom: '#5a2a4a', glow: '#ff6a5a' },
};
