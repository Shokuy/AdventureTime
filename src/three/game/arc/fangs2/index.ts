/*
 * «Ночь клыков», series 3 «Туманные топи» (episode `fangs2`, level `fangs2_swamp`, boss Мадам Морок).
 * Registered with the arc registry at import time (arc/index.ts imports this module).
 */
import './enemies';
import { addLevels, addScripts } from '../registry';
import { LEVEL_PLUGINS } from '../../level';
import { fangs2Level, fangs2Special, fangs2Plugin } from './level';
import { FANGS2_SCRIPTS, castShadows } from './scripts';

addLevels({ fangs2_swamp: fangs2Level });
addScripts(FANGS2_SCRIPTS, { fangs2_swamp: (L) => { castShadows(L); fangs2Special(L); } });
LEVEL_PLUGINS.push(fangs2Plugin);

export { Morok3, ARENA } from './boss';
export { swampOf } from './level';
