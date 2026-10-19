import type { Level3D } from '../level';

/** the hit kinds Ноки deals up close (axe chops / sweep / air spin / slam, the chord) — not her pluck ('pea'), sun or syrup */
const NOKI_HITS = new Set(['sword', 'fork', 'spin', 'chord']);

/**
 * Ноки hunts vampires: her hits do ×1.5 to them. For the vampire side's damage path (host / solo):
 * `d *= vampBane(L, kind)` in a vampire's hurt(). The hitter is the hero whose hit the host is resolving
 * (`L.attacker` = a friend's member id while his swing / shot is resolved) or, without one, my own hero.
 * A leaf module (type imports only): safe to import from enemy code without import cycles.
 */
export function vampBane(L: Level3D, kind: string): number {
  if (!NOKI_HITS.has(kind)) return 1;
  const h = L.attacker ? L.remote(L.attacker) : L.player;
  return h?.kind === 'noki' ? 1.5 : 1;
}
