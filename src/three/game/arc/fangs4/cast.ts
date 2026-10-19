import * as THREE from 'three';
import type { Level3D, Npc3, Actor3 } from '../../level';
import type { HeroKind } from '../../../../net/profile';

/**
 * The story cast of the scenes (GDD §8 «сюжетный состав»): NPC figures of Тоша, Бублик, Ноки and Пастила stand on
 * marks while the bars are down (the players' figures are hidden by `castScenes`), and are hidden again after.
 * Party barks during play (8.2.1–8.2.3: «бары над отрядом», no bars) go over the head of whoever plays that hero —
 * or, when nobody does, over my own hero with the speaker's name.
 */

export type CastKind = 'tosha' | 'bublik' | 'noki' | 'pastila';
export const CAST: CastKind[] = ['tosha', 'bublik', 'noki', 'pastila'];
export const CAST_NAME: Record<CastKind, string> = { tosha: 'Тоша', bublik: 'Бублик', noki: 'Ноки', pastila: 'Пастила' };

/** the four figures (made once per level build, hidden) */
export function cast(L: Level3D): Record<CastKind, Npc3> {
  let c = L.refs.f4cast as Record<CastKind, Npc3> | undefined;
  if (!c) {
    c = {} as Record<CastKind, Npc3>;
    for (const k of CAST) { const n = L.npc(k, 0, -500, 0, 0); n.root.visible = false; c[k] = n; }
    L.refs.f4cast = c;
  }
  return c;
}

/** put a cast figure on its mark (feet at y), facing yaw, shown */
export function mark(L: Level3D, k: CastKind, x: number, y: number, z: number, yaw: number, state = 'idle') {
  const n = cast(L)[k];
  n.root.position.set(x, y, z);
  n.root.rotation.y = yaw;
  n.root.visible = true;
  n.anim.state = state; n.anim.expr = 'normal'; n.anim.speed = 0; n.anim.attack = null; n.anim.fx = {};
  return n;
}
/** face a point */
export function faceTo(n: Npc3, x: number, z: number) { n.root.rotation.y = Math.atan2(x - n.root.position.x, z - n.root.position.z); }
export function hideCast(L: Level3D, except?: CastKind[]) { for (const k of CAST) if (!except?.includes(k)) cast(L)[k].root.visible = false; }
export function expr(L: Level3D, k: CastKind, e: string) { cast(L)[k].anim.expr = e; }

/** the hero figure of a kind somebody plays here (mine first), or null */
export function heroOf(L: Level3D, kind: CastKind): THREE.Object3D | null {
  const p = L.player as unknown as { kind: HeroKind; root: THREE.Object3D; dead: boolean };
  if (p.kind === kind && !p.dead) return p.root;
  for (const r of L.nl?.remotes.values() ?? []) if (r.kind === kind && !r.dead && !r.hidden) return r.root;
  return null;
}

/** a party line over the hero who plays `kind` (else over mine, with the speaker's name) — on this machine */
export function partyBark(L: Level3D, kind: CastKind, str: string, dur = 2.4) {
  const o = heroOf(L, kind);
  if (o) L.bark(o, str, dur, 1.95);
  else L.bark(L.player.root, `${CAST_NAME[kind]}: ${str}`, dur, 1.95);
}

/** barks in a row on this machine (seconds from now) — an actor, not a script: it never holds triggers or the exit */
export function barkSeq(L: Level3D, items: [number, CastKind, string][]) {
  let t = 0;
  const left = [...items].sort((a, b) => a[0] - b[0]);
  const a: Actor3 = {
    dead: false,
    update(L2, dt) {
      t += dt;
      while (left.length && t >= left[0][0]) { const [, k, s] = left.shift()!; partyBark(L2, k, s); }
      if (!left.length) a.dead = true;
    },
  };
  L.actors.push(a);
}

/** run f on this machine only (a co-op host must not capture it for the others: they run it themselves) */
export function mine(L: Level3D, f: () => void) {
  const nl = L.nl, cap = !!nl?.capturing;
  if (nl) nl.capturing = false;
  try { f(); } finally { if (nl) nl.capturing = cap; }
}
