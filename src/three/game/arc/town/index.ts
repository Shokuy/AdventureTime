/*
 * Пастильное королевство: the candy-town kit (props.ts, layout.ts → buildTown), its townsfolk (people.ts) and the hub
 * level `hub` (hub.ts). Registered with the arc registry at import time (arc/index.ts imports this module).
 */
import { addLevels, addScripts } from '../registry';
import type { Level3Def } from '../../levels';
import { hubLevel, HUB_SCRIPTS } from './hub';
import { buildTown } from './layout';
import { NIGHT } from './palette';

addLevels({ hub: hubLevel });
addScripts(HUB_SCRIPTS.scripts, HUB_SCRIPTS.special);

/** dev only: the same town at night, empty (a look at the night variant): __goLevel('town_night', 0) */
function townNight(): Level3Def {
  const p = NIGHT;
  return {
    id: 'town_night', chapter: 0, title: 'Пастильное королевство', subtitle: 'Ночь (предпросмотр)', music: 'night_town',
    spawn: [0, 0, 46], yaw: Math.PI, killY: -12, bg: p.bg, fog: p.fog, hemi: p.hemi, sun: p.sun,
    build(L) { buildTown(L, { night: true }); },
  };
}
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) addLevels({ town_night: townNight });

export { buildTown } from './layout';
export type { TownLayout, TownOpts, V3 } from './layout';
export { DAY as TOWN_DAY, NIGHT as TOWN_NIGHT } from './palette';
export type { TownPalette } from './palette';
export * as townProps from './props';
export { createFolk } from './people';
export type { FolkKind, FolkRig, FolkAnim } from './people';
export { TOWN_HOOKS } from './hooks';
