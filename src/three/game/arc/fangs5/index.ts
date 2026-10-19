/*
 * Серия 6 «Замок Полночь» (episode `fangs5`, level `fangs5_castle`) — the finale of «Ночь клыков»: the castle on the
 * sea cliff (bridge, courtyard siege, portrait hall, book-bat library, spiral tower), Король Полночь on the roof
 * (3 phases), Ноки's shadow, the morning square and Граф Кислоплюй's letter. See level.ts, boss.ts, scripts.ts.
 * Registered with the arc registry at import time (arc/index.ts imports this module).
 */
import './enemies';
import { addLevels, addScripts } from '../registry';
import { fangs5Level } from './level';
import { F5_SCRIPTS } from './scripts';

addLevels({ fangs5_castle: fangs5Level });
addScripts(F5_SCRIPTS.scripts, F5_SCRIPTS.special);

export { Midnight3, ROOF } from './boss';
