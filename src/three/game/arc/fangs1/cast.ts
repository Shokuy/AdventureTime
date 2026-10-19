import * as THREE from 'three';
import type { Waiter } from '../../../../game/coroutine';
import type { HeroAnim, HeroState, HeroExpr } from '../../../models/hero';
import type { Level3D, Npc3 } from '../../level';
import { talkingNow } from './speech';
import { markCharacter } from '../vampires';

/**
 * «Сюжетный состав» of fangs1 (GDD §8): the story four as NPC figures (L.npc) — they act every scene while the bars
 * are down (the players' figures are hidden, def.castScenes), stand at the boss arena's rim in solo, and are hidden
 * otherwise. Built at level build on every machine; scripts place / walk / turn them (scripts run everywhere).
 */
export type CastKind = 'tosha' | 'bublik' | 'noki' | 'pastila';
export const CAST: CastKind[] = ['tosha', 'bublik', 'noki', 'pastila'];

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const lerpAng = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

interface Member { n: Npc3; walk: { to: THREE.Vector3; speed: number } | null; face: number | null; state: HeroState | null }

export class Cast {
  m = {} as Record<CastKind, Member>;
  constructor(private L: Level3D) {
    for (const k of CAST) {
      const n = L.npc(k, 0, -200, 0, 0);
      n.root.visible = false;
      markCharacter(n.root); // (keeps its colours in grey zones)
      this.m[k] = { n, walk: null, face: null, state: null };
    }
    L.updaters.push((_t, dt) => this.update(dt));
  }
  npc(k: CastKind) { return this.m[k].n; }
  anim(k: CastKind) { return this.m[k].n.anim as unknown as HeroAnim; }
  /** stand `k` at (x, y, z) facing yaw (shown) */
  place(k: CastKind, x: number, y: number, z: number, yaw: number) {
    const c = this.m[k];
    c.n.root.position.set(x, y, z);
    c.n.root.rotation.y = yaw;
    c.n.root.visible = true;
    c.walk = null; c.face = null;
    return c.n;
  }
  hide(k: CastKind) { const c = this.m[k]; c.n.root.visible = false; c.walk = null; c.face = null; c.state = null; this.anim(k).state = 'idle'; this.anim(k).expr = 'normal'; this.anim(k).attack = null; }
  hideAll() { for (const k of CAST) this.hide(k); }
  shown(k: CastKind) { return this.m[k].n.root.visible; }
  pos(k: CastKind) { return this.m[k].n.root.position; }
  /** turn toward a point (smoothly) */
  look(k: CastKind, at: THREE.Vector3) { const p = this.pos(k); this.m[k].face = Math.atan2(at.x - p.x, at.z - p.z); }
  lookAll(at: THREE.Vector3) { for (const k of CAST) if (this.shown(k)) this.look(k, at); }
  expr(k: CastKind, e: HeroExpr) { this.anim(k).expr = e; }
  /** hold a pose (wave, cheer, lookUp…) until cleared with null */
  pose(k: CastKind, s: HeroState | null) { this.m[k].state = s; }
  /** walk to (x, z) on the ground under it; a Waiter capped at `max` s (then it is put there) */
  walk(k: CastKind, x: number, z: number, speed = 2.6, max = 6): Waiter {
    const c = this.m[k];
    c.walk = { to: V(x, c.n.root.position.y, z), speed };
    let t = 0;
    return { update: (dt) => { t += dt; if (t > max && c.walk) { c.n.root.position.x = x; c.n.root.position.z = z; c.walk = null; } return !c.walk; } };
  }

  update(dt: number) {
    const L = this.L;
    const talking = talkingNow(L);
    for (const k of CAST) {
      const c = this.m[k], a = this.anim(k), r = c.n.root;
      if (!r.visible) continue;
      if (c.walk) {
        const p = r.position, to = c.walk.to;
        const dx = to.x - p.x, dz = to.z - p.z, d = Math.hypot(dx, dz);
        const step = c.walk.speed * dt;
        if (d <= step) { p.x = to.x; p.z = to.z; c.walk = null; }
        else {
          p.x += dx / d * step; p.z += dz / d * step;
          r.rotation.y = lerpAng(r.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 10));
          const gy = L.phys.groundAt(p.x, p.z, p.y + 1.2, 0.25);
          if (gy > p.y - 3) p.y = gy;
        }
      }
      if (c.face !== null && !c.walk) r.rotation.y = lerpAng(r.rotation.y, c.face, Math.min(1, dt * 6));
      a.state = c.walk ? 'walk' : c.state ?? 'idle';
      a.speed = c.walk ? Math.min(1, c.walk.speed / 7.6) : 0;
      // Пастила / Ноки speak through the candy speech box: their mouths move while their line is typed
      if (talking === k) c.n.talk = 0.35;
    }
  }
}
