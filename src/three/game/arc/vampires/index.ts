/**
 * «Вампирский набор» — the shared kit of the «Ночь клыков» arc (docs/MULTIPLAYER.md, section «Вампирский набор»).
 *
 *   import { vamp } from '../vampires';
 *   build(L) {
 *     const V = vamp(L);
 *     V.nightLook({ red: 1 });            V.moon();                 // night + the red moon
 *     V.greyZone('square', [0, 0, 0], 16);                          // grey until its vampires & townsfolk are done
 *     V.lantern(4, 0, 6);                                           // «солнышко»: vampires keep out of its light
 *     L.enemy('fanger', 2, 0, -3);  V.flock(0, 4, -8, 5);  V.folk(-3, 0, 2, 'zefir');
 *   }
 *   // runtime: V.restoreZone('square'), V.light(pos, { r, secs }), V.chord(pos, r, by), V.bland(hero), V.onRestore(cb)…
 *
 * Importing this module: patches the toon shader (grey zones), registers the enemy kinds (fanger, bat, flyer, mist,
 * servant, brute, presnyak), the per-level kit plugin and the `vamp_test` level.
 */
import './greyShader';
import './vampires';
import './townsfolk';
import { LEVEL_PLUGINS } from '../../level';
import { addLevels } from '../registry';
import { vamp } from './kit';
import { vampTestLevel } from './testLevel';

LEVEL_PLUGINS.push((L) => vamp(L).plugin());
addLevels({ vamp_test: vampTestLevel });

export { vamp, VampKit, GreyZone, Lantern, TempLight, KIT_NET_ID, isVamp, isFolk, heroId } from './kit';
export type { ZoneOpts, ZoneState, LanternOpts, LightOpts, VampLike, FolkLike } from './kit';
export { Vamp3, Fanger3, Bat3, Flyer3, Mist3, Servant3, Brute3 } from './vampires';
export { Folk3 } from './townsfolk';
export { Invisibility } from './invis';
export { NightCtl, MoonCtl } from './night';
export type { NightOpts, MoonOpts } from './night';
export { markCharacter, setGrey, greyHandle } from './greyShader';
export { GroundMark, ambient } from './fxUtil';
export { createFanger, createBat, createFlyer, createMistling, createServant, createBrute, createFolk, createStars, spinStars, FOLK_KINDS, FOLK_COLORS } from './models';
export type { VAnim, VRig, FolkKind } from './models';
export { LINES as VAMP_LINES } from './lines';
