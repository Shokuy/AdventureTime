/*
 * «Ночь клыков», Серия 2 «Клыки в пастиле» (episode `fangs1`: `fangs1_town` → `fangs1_roofs`, boss Граф Нетопырь) and
 * the hub's lab interludes between the series of the arc. Registered with the arc registry at import time
 * (arc/index.ts imports this module). Script: docs/script-fangs.md §5 (+ §5.9 / §6.7 / §7.7 / §8.8).
 */
import { addLevels, addScripts } from '../registry';
import { townLevel, TOWN_ID } from './town';
import { roofsLevel, ROOFS_ID } from './roofs';
import { FANGS1_SCRIPTS, FANGS1_SPECIAL } from './scenes';
import { INTERLUDE_SCRIPTS, installLabHook, installHubLook } from './interludes';
import './boss';

addLevels({ [TOWN_ID]: townLevel, [ROOFS_ID]: roofsLevel });
addScripts({ ...FANGS1_SCRIPTS, ...INTERLUDE_SCRIPTS }, FANGS1_SPECIAL);
installLabHook();
installHubLook();

export { Count3, MarshBomb } from './boss';
export { NightTown } from './town';
export { Roofs, HALL } from './roofs';
