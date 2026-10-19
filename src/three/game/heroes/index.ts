import type { HeroKind } from '../../../net/profile';
import type { HeroFx } from '../../models/hero';
import type { Player3 } from '../player';
import type { HeroKit, RemoteKitView } from './kit';
import { toshaKit } from './tosha';
import { bublikKit, BublikView } from './bublik';
import { nokiKit, NokiView } from './noki';
import { pastilaKit } from './pastila';
import { team } from './team';
import { LEVEL_PLUGINS } from '../level';

export type { HeroKit, RemoteKitView } from './kit';
export { openHeroPicker, heroPickerOpen, HeroPicker3D, type PickerOpts } from './picker';
export { heroKindFor, isPrologueLevel } from './where';
export { addGrappleRing } from './bublik';
export { team, heroEvents, vampOn, type HeroEv, type HeroTeam } from './team';
export { vampBane } from './bane';

/*
 * «Хрумляндия» heroes: which hero plays where, the kits (abilities) and how a friend's kit shows on my machine.
 *  • heroKindFor(def): the prologue's chapters (and PvP) are always Tosha; a level may force a hero (`def.hero`);
 *    everywhere else my pick (profile.kind; the picker / Зеркало героев sets it).
 *  • createKit(kind, player): the abilities Player3 asks (see kit.ts). Tosha's kit is empty = his classic moves.
 *  • kitNet(kind): 4 numbers of the kit's visible state on the wire (HS.k0..k3) ⇄ HeroFx.
 *  • remoteKitView(kind): colliders / effects of a friend's kit here (Бублик's bridge is solid for MY physics).
 *  • team(L) (team.ts): the per-level hub — kit events between friends, gadgets, kit shots, buff auras, the ability
 *    chip and first-time hints, hero events for other modules (heroEvents(L).on('chord', …)).
 */

/** the team hub is a level plugin in every level (registered on first use: level.ts imports this module, so not at load) */
let plugged = false;
function plugTeam() {
  if (plugged) return;
  plugged = true;
  LEVEL_PLUGINS.push((L) => {
    const t = team(L);
    return { update: (dt) => t.update(dt), draw: (ctx) => t.draw(ctx), dispose: () => t.dispose() };
  });
}

export function createKit(kind: HeroKind, p: Player3): HeroKit {
  plugTeam();
  switch (kind) {
    case 'bublik': return bublikKit(p);
    case 'noki': return nokiKit(p);
    case 'pastila': return pastilaKit(p);
    default: return toshaKit(p);
  }
}

/** the kit's visible state on the wire: which HeroFx field rides in HS.k0..k3 for each hero */
const NET_KEYS: Record<HeroKind, (keyof HeroFx)[]> = {
  tosha: [],
  bublik: ['reach', 'aim', 'bridge', 'puff'],
  noki: ['bat', 'glide', 'charge'],
  pastila: ['gadget'],
};
export function kitNet(kind: HeroKind) {
  const keys = NET_KEYS[kind] ?? [];
  return {
    encode(fx: HeroFx): number[] { return keys.map((k) => fx[k] ?? 0); },
    decode(a: ArrayLike<number>): HeroFx { const o: HeroFx = {}; keys.forEach((k, i) => { const v = Number(a[i]) || 0; if (v) o[k] = v; }); return o; },
  };
}

const NO_VIEW: RemoteKitView = { update() { /* */ }, dispose() { /* */ } };
export function remoteKitView(kind: HeroKind): RemoteKitView {
  return kind === 'bublik' ? new BublikView() : kind === 'noki' ? new NokiView() : NO_VIEW;
}

/** where a friend's hero can be stood on (his head / back; Бублик puffed: a trampoline) */
export const HERO_BODY: Record<HeroKind, { top: number; r: number; puffTop: number; puffR: number; bounce?: number }> = {
  tosha: { top: 1.0, r: 0.42, puffTop: 1.0, puffR: 0.42 },
  bublik: { top: 0.7, r: 0.45, puffTop: 1.16, puffR: 0.66, bounce: 21 },
  noki: { top: 1.12, r: 0.42, puffTop: 1.12, puffR: 0.42 },
  pastila: { top: 1.08, r: 0.42, puffTop: 1.08, puffR: 0.42 },
};
