/*
 * Серия 4 «Стеклянная оранжерея» (episode `fangs3`, level `fangs3_garden`, boss Шёпот) — docs/script-fangs.md §7.
 * Registers the level, its scenes and the special hook with the arc registry, the grey flowers (enemy kind
 * 'gflower') and the level plugin (mirrors, pollen, whispers, the fight's helpers). Imported once from arc/index.ts.
 */
import '../vampires';
import './flowers';
import { LEVEL_PLUGINS } from '../../level';
import { addLevels, addScripts } from '../registry';
import { fangs3Level, LEVEL_ID, type Garden } from './level';
import { F3_SCRIPTS } from './scripts';

addLevels({ [LEVEL_ID]: fangs3Level });
addScripts(F3_SCRIPTS.scripts, F3_SCRIPTS.special);
LEVEL_PLUGINS.push((L) => (L.def.id === LEVEL_ID ? (L.refs.garden as Garden | undefined)?.plugin() ?? null : null));

export { fangs3Level, LEVEL_ID };
export { Shepot3, ARENA } from './boss';
