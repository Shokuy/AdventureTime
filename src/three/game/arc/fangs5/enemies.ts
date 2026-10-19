import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { approach, choose, clamp, rand } from '../../../../engine/util';
import { ENEMY_KINDS, type EnemyOpts } from '../../enemies';
import type { Level3D, HeroLike } from '../../level';
import { basic, noOutline } from '../../../gfx';
import { Vamp3, type VampKit } from '../vampires';
import { createPortrait, createBookBat, createShade, type PaintKind } from './rigs';
import { F5 } from './lines';

/**
 * Enemies of «Замок Полночь» (vampire-kit Vamp3s: they keep out of the light, burn in it, a chord stuns them, and a
 * beaten one flies off as a little bat):
 *   portrait — a living portrait: hangs on the wall (its eyes follow you), wakes, flies on little bat wings, rises over
 *              a hero (a red frame-shaped shadow on the floor) and drops face-down on the spot; then it lies there
 *              stuck (hit it ×1.5) and gets up again.
 *   bookbat  — a library book that turns into a bat: closed on its shelf until a hero comes near, then it flutters
 *              round him and dives to bite. «ТИШИНА В БИБЛИОТЕКЕ!»
 *   shade    — the King's shadow imp (the last phase): runs at Пастила and the Солнечная пушка; a hero in its way gets
 *              clawed. Two hits.
 */

declare module '../../enemies' {
  interface ExtraEnemyKinds { portrait: true; bookbat: true; shade: true }
  interface EnemyOpts {
    /** portrait: what is painted on it */
    paint?: PaintKind;
    /** bookbat: cover colour */
    cover?: string;
    /** portrait / bookbat: wakes when a hero comes this close (m) */
    wake?: number;
  }
}

const v = new THREE.Vector3();
const v2 = new THREE.Vector3();
const TAU = Math.PI * 2;
const PAINTS: PaintKind[] = ['lady', 'knight', 'candy', 'bear', 'baker', 'owl'];
const COVERS = ['#8a1c30', '#2a4a8a', '#3a7a4a', '#6a3a8a', '#b07a20', '#2a6a6a'];

/** a red frame-shaped telegraph lying on the floor (the portrait's drop zone) */
class FrameMark {
  mesh: THREE.Mesh;
  private m = basic('#ff3040', { additive: true, transparent: true, opacity: 0.5, depthWrite: false });
  constructor(w: number, d: number) {
    this.m.polygonOffset = true; this.m.polygonOffsetFactor = -4;
    const s = new THREE.Shape();
    s.moveTo(-w / 2, -d / 2); s.lineTo(w / 2, -d / 2); s.lineTo(w / 2, d / 2); s.lineTo(-w / 2, d / 2); s.lineTo(-w / 2, -d / 2);
    const hole = new THREE.Path();
    const k = 0.18;
    hole.moveTo(-w / 2 + k, -d / 2 + k); hole.lineTo(-w / 2 + k, d / 2 - k); hole.lineTo(w / 2 - k, d / 2 - k); hole.lineTo(w / 2 - k, -d / 2 + k); hole.lineTo(-w / 2 + k, -d / 2 + k);
    s.holes.push(hole);
    this.mesh = new THREE.Mesh(new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2), this.m);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(w - 2 * k, d - 2 * k).rotateX(-Math.PI / 2), basic('#ff3040', { additive: true, transparent: true, opacity: 0.18, depthWrite: false }));
    this.mesh.add(fill);
    this.mesh.renderOrder = 3; this.mesh.visible = false;
    noOutline(this.mesh);
  }
  show(L: Level3D, x: number, y: number, z: number, yaw: number, a: number) {
    if (!this.mesh.parent) L.scene.add(this.mesh);
    this.mesh.position.set(x, y + 0.06, z); this.mesh.rotation.y = yaw;
    this.m.opacity = a; this.mesh.visible = a > 0.01;
  }
  hide() { this.mesh.visible = false; }
  dispose() { this.mesh.removeFromParent(); }
}

// ═════════════════════════════ ЖИВОЙ ПОРТРЕТ ═════════════════════════════
export class Portrait3 extends Vamp3 {
  protected readonly ACTS = ['hang', 'wake', 'fly', 'aim', 'drop', 'stuck', 'rise', 'stun', 'burn', 'home', 'idle'] as const;
  declare rig: ReturnType<typeof createPortrait>;
  private spot = new THREE.Vector3();
  private dropYaw = 0;
  private hit = false;
  private wakeR: number;
  private mark = new FrameMark(1.5, 1.9);
  private orbitA = rand(0, TAU);
  private wall = new THREE.Vector3();
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('portrait', pos, 0.6, 1.6, createPortrait(o.paint ?? choose(PAINTS)), { aggro: 10, leash: 40, ...o });
    this.hp = this.maxHp = 5; this.loot = 3;
    this.flying = true; this.body.gravity = 0;
    this.wakeR = o.wake ?? 7;
    this.wall.copy(pos);
    this.blob.visible = false;
    this.go(o.wake === 0 ? 'fly' : 'hang');
  }
  protected sense(L: Level3D, dt: number) {
    if (this.act === 'hang') {
      // (a hit wakes it too: Vamp3.hurt sets the target)
      if (this.hunting && this.target) { this.go('wake', 0.6); return; }
      if ((this.senseT -= dt) > 0) return;
      this.senseT = 0.25;
      for (const h of L.alivePlayers()) if (h.pos.distanceTo(this.body.pos) < this.wakeR) {
        this.target = h; this.hunting = true;
        this.go('wake', 0.8);
        this.bark(L, F5.portraitBarks, 1);
        audio.sfx('hiss', { pitch: 0.7, volume: 0.5 });
        return;
      }
      return;
    }
    super.sense(L, dt);
  }
  provoke(L: Level3D) { super.provoke(L); if (this.act === 'hang') this.go('wake', 0.6); }
  protected burnsNow() { return this.act !== 'hang' && this.act !== 'stuck'; }
  protected brain(L: Level3D, K: VampKit, dt: number) {
    const b = this.body, t = this.target;
    switch (this.act) {
      case 'hang': this.halt(dt, 30); return;
      case 'wake': {
        // off the wall: a little hop forward
        b.vel.set(Math.sin(this.yaw) * 1.2, 0.8, Math.cos(this.yaw) * 1.2);
        if (this.at <= 0) this.go('fly');
        return;
      }
      case 'aim':
        if (t && this.pr < 0.75) {
          this.spot.x += (t.pos.x - this.spot.x) * Math.min(1, dt * 5);
          this.spot.z += (t.pos.z - this.spot.z) * Math.min(1, dt * 5);
          const gy = L.phys.groundAt(this.spot.x, this.spot.z, t.pos.y + 1, 0.1);
          this.spot.y = gy > -1e8 ? gy : t.pos.y;
        }
        b.vel.set((this.spot.x - b.pos.x) * 6, (this.spot.y + 2.9 - b.pos.y) * 5, (this.spot.z - b.pos.z) * 6);
        if (this.at <= 0) { this.go('drop', 0.5); this.hit = false; audio.sfx('whoosh', { pitch: 0.7, volume: 0.6 }); }
        return;
      case 'drop':
        b.vel.set((this.spot.x - b.pos.x) * 8, -16, (this.spot.z - b.pos.z) * 8);
        if (b.pos.y <= this.spot.y + 0.35 || this.at <= 0) {
          b.pos.y = this.spot.y + 0.2; b.vel.set(0, 0, 0);
          this.go('stuck', 1.9);
          L.tcam.shake(0.2); audio.sfx('thud', { volume: 0.7, pitch: 0.8 }); audio.sfx('break', { pitch: 0.6, volume: 0.4 });
          L.fx.dust(this.spot.clone(), 14, '#b8a8d0');
          const c = Math.cos(this.dropYaw), s = Math.sin(this.dropYaw);
          for (const h of L.alivePlayers()) {
            const dx = h.pos.x - this.spot.x, dz = h.pos.z - this.spot.z;
            const lx = dx * c - dz * s, lz = dx * s + dz * c;
            if (Math.abs(lx) < 0.95 && Math.abs(lz) < 1.15 && Math.abs(h.pos.y - this.spot.y) < 1.2) h.hurt(L, 1, this.spot.clone());
          }
        }
        return;
      case 'stuck': this.halt(dt, 30); if (this.at <= 0) { this.go('rise', 0.7); } return;
      case 'rise': b.vel.set(0, 3, 0); if (this.at <= 0) { this.go('fly'); this.cd = rand(1.4, 2.4) * this.cdMul(L); } return;
    }
    if (!t) {
      // back to its place on the wall
      const d = this.steerFly(this.wall.x, this.wall.y, this.wall.z, 3, dt);
      this.faceToward(this.wall.x + Math.sin(this.yaw), this.wall.z + Math.cos(this.yaw), dt, 2);
      if (d < 0.3) { this.go('hang'); this.yaw = (this.home as THREE.Vector3 & { yaw0?: number }).yaw0 ?? this.yaw; }
      return;
    }
    if (this.act !== 'fly') this.go('fly');
    const lit = K.sunAt(t.pos) > 0.3;
    this.orbitA += dt * 0.8;
    const R = lit ? 7 : 3.8;
    const gx = t.pos.x + Math.cos(this.orbitA) * R, gz = t.pos.z + Math.sin(this.orbitA) * R;
    this.steerFly(gx, t.pos.y + 2.2 + Math.sin(this.t * 2) * 0.3, gz, 5, dt);
    this.faceToward(t.pos.x, t.pos.z, dt, 6);
    if (!lit && this.cd <= 0 && this.los(L, t)) {
      this.spot.set(t.pos.x, t.pos.y, t.pos.z);
      this.dropYaw = this.yaw;
      this.go('aim', 1.15);
      audio.sfx('warn', { volume: 0.3, pitch: 1.2 });
      this.bark(L, F5.portraitBarks, 0.35);
    }
  }
  private steerFly(x: number, y: number, z: number, sp: number, dt: number) {
    const b = this.body;
    const dx = x - b.pos.x, dy = y - b.pos.y, dz = z - b.pos.z, d = Math.hypot(dx, dy, dz);
    const k = d > 0.01 ? Math.min(sp, d * 2.5) / d : 0;
    b.vel.x = approach(b.vel.x, dx * k, 20 * dt); b.vel.y = approach(b.vel.y, dy * k, 20 * dt); b.vel.z = approach(b.vel.z, dz * k, 20 * dt);
    return d;
  }
  protected burn(L: Level3D, K: VampKit, dt: number) {
    if (this.act !== 'burn') { this.go('burn', 0); audio.sfx('hiss', { pitch: 1.2 }); }
    const away = K.sunAway(this.body.pos, v2);
    if (away) this.body.vel.set(away.x * 4.5, 1, away.z * 4.5); else this.halt(dt);
  }
  protected dmgMul() { return this.act === 'stuck' ? 1.5 : 1; }
  protected pose() { return this.act === 'home' || this.act === 'idle' ? 'fly' : this.act; }
  protected netMore() { return [this.spot.x, this.spot.y, this.spot.z, this.dropYaw]; }
  protected netMoreApply(a: number[], i: number) { this.spot.set(a[i], a[i + 1], a[i + 2]); this.dropYaw = a[i + 3]; }
  protected visuals(L: Level3D) {
    if (this.act === 'aim' || this.act === 'drop') this.mark.show(L, this.spot.x, this.spot.y, this.spot.z, this.dropYaw, this.act === 'aim' ? 0.25 + 0.55 * this.pr : 0.85);
    else this.mark.hide();
    // eyes: the nearest hero on this machine (the painting's gaze is just for looks)
    if (this.act === 'hang' || this.act === 'fly' || this.act === 'aim') this.rig.eyes.look(L.player.center(v).setY(L.player.pos.y + 1));
  }
  protected cleanup() { super.cleanup(); this.mark.dispose(); }
}

// ═════════════════════════════ КНИГА-МЫШЬ ═════════════════════════════
export class BookBat3 extends Vamp3 {
  protected readonly ACTS = ['perch', 'wake', 'fly', 'orbit', 'prep', 'dive', 'stun', 'burn', 'home', 'idle'] as const;
  private dir = new THREE.Vector3();
  private orbitA = rand(0, TAU);
  private orbitDir = Math.random() < 0.5 ? 1 : -1;
  private hit = false;
  private wakeR: number;
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('bookbat', pos, 0.3, 0.55, createBookBat(o.cover ?? choose(COVERS)), { aggro: 12, leash: 30, ...o });
    this.hp = this.maxHp = 2; this.loot = 1;
    this.flying = true; this.body.gravity = 0;
    this.blob.visible = false;
    this.wakeR = o.wake ?? 8;
    this.go(o.wake === 0 ? 'fly' : 'perch');
  }
  protected sense(L: Level3D, dt: number) {
    if (this.act === 'perch') {
      if ((this.senseT -= dt) > 0) return;
      this.senseT = 0.2;
      for (const h of L.alivePlayers()) if (h.pos.distanceTo(this.body.pos) < this.wakeR) {
        this.target = h; this.hunting = true;
        this.go('wake', 0.6);
        this.bark(L, F5.bookBarks, 0.6);
        audio.sfx('batFlap', { volume: 0.4, pitch: 1.3 });
        return;
      }
      return;
    }
    super.sense(L, dt);
  }
  provoke(L: Level3D) { super.provoke(L); if (this.act === 'perch') this.go('wake', 0.4); }
  protected burnsNow() { return this.act !== 'perch'; }
  protected brain(L: Level3D, K: VampKit, dt: number) {
    const b = this.body, t = this.target;
    if (this.act === 'perch') { this.halt(dt, 30); return; }
    if (this.act === 'wake') { b.vel.set(Math.sin(this.yaw) * 2, 1.5, Math.cos(this.yaw) * 2); if (this.at <= 0) this.go('orbit', rand(0.6, 1.2)); return; }
    if (this.act === 'dive') {
      b.vel.copy(this.dir).multiplyScalar(10);
      if (!this.hit) for (const h of L.alivePlayers()) {
        if (h.center(v2).distanceTo(this.center(v)) < 0.7) { this.hit = true; h.hurt(L, 1, b.pos.clone()); audio.sfx('bite', { pitch: 1.3 }); break; }
      }
      if (this.at <= 0 || b.hitWall || b.onGround || this.hit) { this.go('orbit', rand(1.2, 2)); b.vel.multiplyScalar(0.3); }
      return;
    }
    if (!t) {
      if (this.act !== 'fly' && this.act !== 'home') this.go('fly');
      const gx = this.home.x + Math.sin(this.t * 0.9) * 1.4, gz = this.home.z + Math.cos(this.t * 0.7) * 1.4, gy = this.home.y + Math.sin(this.t * 2.3) * 0.3;
      b.vel.set((gx - b.pos.x) * 2, (gy - b.pos.y) * 2, (gz - b.pos.z) * 2);
      this.faceToward(gx + Math.cos(this.t), gz - Math.sin(this.t), dt, 4);
      return;
    }
    const tc = t.center(v2);
    if (this.act === 'prep') {
      this.halt(dt, 16); this.faceToward(tc.x, tc.z, dt, 12);
      if (this.at <= 0) { this.dir.copy(tc).addScaledVector(t.vel, 0.12).sub(this.center(v)).normalize(); this.go('dive', 0.75); this.hit = false; audio.sfx('whoosh', { volume: 0.35, pitch: 1.7 }); }
      return;
    }
    if (this.act !== 'orbit') this.go('orbit', rand(0.8, 1.6));
    const lit = K.sunAt(t.pos) > 0.3;
    this.orbitA += dt * 1.6 * this.orbitDir;
    const R = lit ? 6.5 : 3.2;
    const gx = tc.x + Math.cos(this.orbitA) * R, gz = tc.z + Math.sin(this.orbitA) * R, gy = tc.y + 1.9 + Math.sin(this.t * 3) * 0.3;
    b.vel.set(clamp((gx - b.pos.x) * 3, -8, 8), clamp((gy - b.pos.y) * 3, -6, 6), clamp((gz - b.pos.z) * 3, -8, 8));
    this.faceToward(tc.x, tc.z, dt, 8);
    const key = 'bookDive:' + ((t as { id?: string }).id ?? 'me');
    const last = (L.refs[key] as number | undefined) ?? -99;
    if (!lit && this.at <= 0 && L.t - last > 0.8 && this.los(L, t)) { L.refs[key] = L.t; this.go('prep', 0.45); if (Math.random() < 0.25) this.bark(L, F5.bookBarks, 1); }
  }
  protected burn(L: Level3D, K: VampKit, dt: number) {
    if (this.act !== 'burn') { this.go('burn', 0); audio.sfx('batScreech', { pitch: 1.6, volume: 0.4 }); }
    const away = K.sunAway(this.body.pos, v2);
    if (away) this.body.vel.set(away.x * 5, 2, away.z * 5); else this.halt(dt);
  }
  protected pose() { return this.act === 'home' || this.act === 'idle' || this.act === 'orbit' ? 'fly' : this.act; }
}

// ═════════════════════════════ ТЕНЬ-ПРИХВОСТЕНЬ ═════════════════════════════
/** where Пастила stands at the cannon and what happens when a shade reaches her (set by the boss on every machine) */
export interface CannonHooks { at: THREE.Vector3; hit(L: Level3D, from: THREE.Vector3): void }

export class Shade3 extends Vamp3 {
  protected readonly ACTS = ['spawn', 'run', 'claw', 'recover', 'stun', 'burn', 'home', 'idle'] as const;
  private clawed = false;
  private victim: HeroLike | null = null;
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('shade', pos, 0.36, 1.0, createShade(), { aggro: 6, leash: 999, ...o });
    this.hp = this.maxHp = 2; this.loot = 1;
    this.go('spawn', 0.7);
  }
  // (shades don't hunt: they go for the cannon; a hero close by gets clawed on the way)
  protected sense() { /* */ }
  provoke() { /* */ }
  protected brain(L: Level3D, K: VampKit, dt: number) {
    const b = this.body;
    const hooks = L.refs.f5cannon as CannonHooks | undefined;
    if (this.act === 'spawn') { this.halt(dt, 30); if (this.at <= 0) this.go('run'); return; }
    if (this.act === 'claw') {
      this.halt(dt, 20);
      if (!this.clawed && this.pr > 0.5) {
        this.clawed = true;
        const h = this.victim;
        const mouth = this.center(v).add(v2.set(Math.sin(this.yaw) * 0.8, 0, Math.cos(this.yaw) * 0.8));
        if (h && this.valid(L, h) && h.center(v2).distanceTo(mouth) < 1.3) h.hurt(L, 1, b.pos.clone());
        else if (!h && hooks && mouth.distanceTo(hooks.at) < 1.8) hooks.hit(L, b.pos.clone());
        audio.sfx('swing', { pitch: 1.5, volume: 0.6 });
      }
      if (this.at <= 0) this.go('recover', this.victim ? 0.6 : 1.1);
      return;
    }
    if (this.act === 'recover') { this.halt(dt, 14); if (this.at <= 0) this.go('run'); return; }
    // a hero right in the way?
    let near: HeroLike | null = null, nd = 1.7;
    for (const h of L.alivePlayers()) { const d = Math.hypot(h.pos.x - b.pos.x, h.pos.z - b.pos.z); if (d < nd && Math.abs(h.pos.y - b.pos.y) < 1.5) { nd = d; near = h; } }
    if (near) { this.faceToward(near.pos.x, near.pos.z, dt, 14); this.victim = near; this.clawed = false; this.go('claw', 0.7); return; }
    if (!hooks) { this.halt(dt); return; }
    const d = this.steer(L, K, hooks.at.x, hooks.at.z, 4.6, dt);
    if (this.act !== 'run') this.go('run');
    if (d < 1.4) { this.faceToward(hooks.at.x, hooks.at.z, dt, 14); this.victim = null; this.clawed = false; this.go('claw', 1.0); }
  }
  protected dmgMul() { return this.act === 'recover' ? 1.5 : 1; }
  protected pose() { return this.act === 'home' || this.act === 'idle' ? 'run' : this.act; }
}

ENEMY_KINDS.portrait = (p, o) => {
  const e = new Portrait3(p, o);
  (e.home as THREE.Vector3 & { yaw0?: number }).yaw0 = o.yaw ?? e.yaw;
  if (o.yaw !== undefined) e.yaw = o.yaw;
  return e;
};
ENEMY_KINDS.bookbat = (p, o) => new BookBat3(p, o);
ENEMY_KINDS.shade = (p, o) => new Shade3(p, o);
