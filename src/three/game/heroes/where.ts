import { STORY } from '../../../game/game';
import { profile, isHeroKind, type HeroKind } from '../../../net/profile';

/** the prologue's chapters (+ PvP on the feast table): everyone plays Tosha there */
const PROLOGUE = new Set(STORY.filter((s) => s.kind === 'level').map((s) => (s as { id: string }).id));
PROLOGUE.add('pvp');

/** a level of the prologue (or PvP) */
export const isPrologueLevel = (id: string) => PROLOGUE.has(id);

/** the hero I play in a level: forced by the level (`def.hero`), Tosha in the prologue, else my pick */
export function heroKindFor(def: { id: string; hero?: HeroKind }): HeroKind {
  if (def.hero && isHeroKind(def.hero)) return def.hero;
  if (PROLOGUE.has(def.id)) return 'tosha';
  return profile.kind;
}
