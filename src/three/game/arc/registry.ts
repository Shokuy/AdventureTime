import { LEVELS3, type Level3Def } from '../levels';
import { SCRIPTS3 } from '../scripts';

/**
 * «Хрумляндия» content beyond the prologue (the hub town, the vampire arc, later arcs) registers itself here, so
 * levels.ts / scripts.ts stay the prologue's. A module calls addLevels / addScripts at import time and is imported
 * once from arc/index.ts. Episode level ids are listed in episodes.ts.
 */
type ScriptFn = (typeof SCRIPTS3.scripts)[string];
type SpecialFn = (typeof SCRIPTS3.special)[string];

export function addLevels(defs: Record<string, () => Level3Def>) { Object.assign(LEVELS3, defs); }

/** story scripts by name (L.run / triggers / startScript / 'exit_<level id>'), and per-level special hooks */
export function addScripts(scripts: Record<string, ScriptFn>, special: Record<string, SpecialFn> = {}) {
  Object.assign(SCRIPTS3.scripts, scripts);
  Object.assign(SCRIPTS3.special, special);
}
