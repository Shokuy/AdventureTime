import * as THREE from 'three';
import { audio } from '../../engine/audio';
import { rand } from '../../engine/util';
import * as P from '../world/props';
import type { Built } from '../physics/types';
import type { Level3D, Actor3, Hittable3 } from './level';
import type { Netted } from './netLevel';

export type BreakKind = 'crate' | 'jar';

const COLORS: Record<BreakKind, string[]> = {
  crate: ['#b47a46', '#7a4a2c', '#d89a5e'],
  jar: ['#e4f2ff', '#ffffff', '#d2323c', '#f2e2c0'],
};

/**
 * A little crate or jam jar that pops open with a hit (sword, fork, pea) and spills crumbs —
 * sometimes a heart or a honey jar. Breaks once per attempt (respawns don't refill it).
 */
export class Breakable3 implements Actor3, Hittable3, Netted {
  netId = 0;
  dead = false;
  hp: number;
  b: Built;
  private shake = 0;
  private base: THREE.Vector3;
  constructor(L: Level3D, public kind: BreakKind, public pos: THREE.Vector3, public loot: number, private key: string) {
    this.b = kind === 'crate'
      ? P.crate({ x: pos.x, y: pos.y, z: pos.z, w: 1.25, h: 1.1, d: 1.25, rotY: rand(-0.4, 0.4) })
      : P.jar({ x: pos.x, y: pos.y, z: pos.z, r: 0.55, h: 1.3, jam: (['red', 'orange', 'green', 'honey'] as const)[Math.floor(rand(0, 4))] });
    L.add(this.b);
    if (L.building) L.nl?.add(this);
    this.base = this.b.obj.position.clone();
    this.hp = kind === 'crate' ? 2 : 1;
  }

  center() { return this.pos.clone().setY(this.pos.y + 0.6); }

  update(_L: Level3D, dt: number) {
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 4);
      this.b.obj.position.set(this.base.x + Math.sin(this.shake * 60) * 0.06 * this.shake, this.base.y, this.base.z);
    }
  }

  /** co-op client: the host smashed it (loot arrives separately as per-player drops) */
  netEvent(L: Level3D, ev: string) { if (ev === 'gone' && !this.dead) this.smash(L, false); }

  private hit(L: Level3D, at: THREE.Vector3) {
    if (!L.authority) return;
    this.hp--;
    this.shake = 1;
    audio.sfx('thud', { pitch: 1.4, volume: 0.6 });
    L.fx.chunks(at, 4, COLORS[this.kind], this.pos.y, [0.05, 0.1]);
    if (this.hp <= 0) this.smash(L);
  }

  private smash(L: Level3D, loot = true) {
    this.dead = true;
    L.seen.add(this.key);
    if (loot) L.nl?.gone(this, 'smash');
    this.b.obj.visible = false;
    for (const c of this.b.colliders) c.active = false;
    const c = this.center();
    audio.sfx('break', { pitch: this.kind === 'jar' ? 1.5 : 1 });
    L.fx.chunks(c, 16, COLORS[this.kind], this.pos.y, [0.08, 0.2]);
    if (this.kind === 'jar') L.fx.juice(c, 10, ['#d2323c', '#ff8a2a', '#eaa01e']);
    L.fx.dust(c, 6);
    if (!loot) return;
    for (let i = 0; i < this.loot; i++) L.dropPickup(Math.random() < 0.15 ? 'bigcrumb' : 'crumb', c);
    const r = Math.random();
    if (r < 0.1) L.dropPickup('heart', c);
    else if (r < 0.14) L.dropPickup('honey', c);
  }

  private lastAtk = -1;
  meleeHit(L: Level3D, c: THREE.Vector3, dir: THREE.Vector3, range: number, _dmg: number, atkId: number): boolean {
    if (this.dead || atkId === this.lastAtk) return false;
    const d = Math.hypot(this.pos.x - c.x, this.pos.z - c.z);
    if (d > range + 0.8 || Math.abs(this.pos.y + 0.5 - c.y) > 1.6) return false;
    const to = new THREE.Vector3(this.pos.x - c.x, 0, this.pos.z - c.z);
    if (d > 0.5 && to.normalize().dot(dir) < 0.1) return false;
    this.lastAtk = atkId;
    this.hit(L, this.center());
    return true;
  }

  shotHit(L: Level3D, s: { pos: THREE.Vector3; r: number }): boolean {
    if (this.dead) return false;
    const c = this.center();
    if (Math.abs(s.pos.x - c.x) < 0.75 + s.r && Math.abs(s.pos.z - c.z) < 0.75 + s.r && s.pos.y > this.pos.y - 0.1 && s.pos.y < this.pos.y + 1.4) { this.hit(L, s.pos.clone()); return true; }
    return false;
  }
}
