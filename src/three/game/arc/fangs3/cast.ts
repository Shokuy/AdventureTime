import * as THREE from 'three';
import type { Waiter } from '../../../../game/coroutine';
import type { HeroAnim, HeroState, HeroExpr } from '../../../models/hero';
import type { Level3D, Npc3 } from '../../level';
import { net } from '../../../../net/session';

/**
 * «Сюжетный состав» (GDD §8): the canonical four — Тоша, Бублик, Ноки, Пастила — as NPC figures on their marks in
 * every scene of the episode (the players' figures are hidden while the bars are down: Level3Def.castScenes). Out of
 * scenes they are off stage (hidden), except the solo helpers on the dome's balconies during the boss fight.
 * Everything here is local presentation: scripts run on every machine and place the same figures the same way.
 */
export type CastKind = 'tosha' | 'bublik' | 'noki' | 'pastila';
export const CAST: CastKind[] = ['tosha', 'bublik', 'noki', 'pastila'];

interface Walk { to: THREE.Vector3; speed: number; t: number; max: number }

export class Cast {
  figs = {} as Record<CastKind, Npc3>;
  private walks = new Map<CastKind, Walk>();
  private faces = new Map<CastKind, THREE.Vector3 | null>();
  constructor(private L: Level3D) {
    for (const k of CAST) {
      const n = L.npc(k, 0, -50, 0, 0);
      n.root.visible = false;
      this.figs[k] = n;
    }
  }
  anim(k: CastKind) { return this.figs[k].anim as HeroAnim; }
  /** all four on / off stage */
  show(on: boolean, kinds: CastKind[] = CAST) {
    for (const k of kinds) {
      this.figs[k].root.visible = on;
      if (!on) { this.walks.delete(k); this.faces.delete(k); const a = this.anim(k); a.state = 'idle'; a.expr = 'normal'; a.attack = null; }
    }
  }
  place(k: CastKind, x: number, y: number, z: number, yaw: number) {
    const r = this.figs[k].root;
    r.position.set(x, y, z); r.rotation.y = yaw; r.visible = true;
    this.walks.delete(k);
  }
  /** turn to look at a point (null = keep the yaw) */
  look(k: CastKind, at: THREE.Vector3 | null) { this.faces.set(k, at ? at.clone() : null); }
  pose(k: CastKind, state: HeroState, expr: HeroExpr = 'normal') { const a = this.anim(k); a.state = state; a.expr = expr; }
  /** a face (the script's emotions mapped onto the rig's: sad → hurt, sly → happy) */
  expr(k: CastKind, e: HeroExpr | 'sad' | 'sly') { this.anim(k).expr = e === 'sad' ? 'hurt' : e === 'sly' ? 'happy' : e; }
  /** walk to (x, z) (a Waiter, capped) */
  walk(k: CastKind, x: number, z: number, speed = 2.4, max = 6): Waiter {
    const r = this.figs[k].root;
    this.walks.set(k, { to: new THREE.Vector3(x, r.position.y, z), speed, t: 0, max });
    return { update: () => !this.walks.has(k) };
  }
  pos(k: CastKind) { return this.figs[k].root.position; }
  head(k: CastKind, out = new THREE.Vector3()) { return out.copy(this.figs[k].root.position).setY(this.figs[k].root.position.y + (k === 'bublik' ? 0.8 : 1.2)); }

  update(dt: number) {
    for (const k of CAST) {
      const n = this.figs[k], r = n.root, a = n.anim as HeroAnim;
      const w = this.walks.get(k);
      if (w) {
        w.t += dt;
        const d = Math.hypot(w.to.x - r.position.x, w.to.z - r.position.z);
        if (d < 0.08 || w.t > w.max) { r.position.x = w.to.x; r.position.z = w.to.z; this.walks.delete(k); a.state = 'idle'; a.speed = 0; }
        else {
          const s = Math.min(d, w.speed * dt);
          r.position.x += ((w.to.x - r.position.x) / d) * s; r.position.z += ((w.to.z - r.position.z) / d) * s;
          r.rotation.y = lerpAng(r.rotation.y, Math.atan2(w.to.x - r.position.x, w.to.z - r.position.z), Math.min(1, dt * 10));
          a.state = w.speed > 3.2 ? 'run' : 'walk'; a.speed = Math.min(1, w.speed / 6);
        }
        continue;
      }
      const f = this.faces.get(k);
      if (f) r.rotation.y = lerpAng(r.rotation.y, Math.atan2(f.x - r.position.x, f.z - r.position.z), Math.min(1, dt * 6));
    }
  }
}
const lerpAng = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/** my slot in the room (0 solo) — for spreading the players out after a scene */
export function slotOf(L: Level3D) {
  if (!L.nl) return 0;
  const ids = [...net.members.keys()].sort();
  return Math.max(0, ids.indexOf(net.myId));
}
