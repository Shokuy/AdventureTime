import * as THREE from 'three';
import { audio } from '../../engine/audio';
import { clamp } from '../../engine/util';
import { basic, noOutline } from '../gfx';
import { createCherryBomb } from '../models';
import type { Level3D, Actor3, Hittable3 } from './level';
import type { Shot3 } from './objects';
import { NET_SPAWN, toV } from './netLevel';
import type { Netted } from './netLevel';

const tmp = new THREE.Vector3();
const RADIUS = 2.4;

/** floor ring that shows where a bomb will blow */
function blastRing() {
  const g = new THREE.Group();
  const ringM = basic('#ff5a2a', { additive: true, opacity: 0.85, depthWrite: false });
  const fillM = basic('#ff3a1a', { additive: true, opacity: 0.3, depthWrite: false });
  for (const m of [ringM, fillM]) { m.polygonOffset = true; m.polygonOffsetFactor = -6; }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 40).rotateX(-Math.PI / 2), ringM);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), fillM);
  ring.renderOrder = 4; fill.renderOrder = 3;
  g.add(fill, ring);
  noOutline(g);
  return { g, fill, ringM, fillM };
}

/**
 * A cherry bomb thrown by a bomber melon: flies in an arc, lands, fizzes, explodes (hurts the hero AND other melons).
 * The hero can bat it away with the sword (it flies off and blows up on the first melon it touches)
 * or pop it early with a pea.
 */
export class Bomb3 implements Actor3, Hittable3, Netted {
  netId = 0;
  netKind = 'bomb';
  dead = false;
  pos: THREE.Vector3;
  vel = new THREE.Vector3();
  state: 'fly' | 'fuse' = 'fly';
  t = 0; fuseT = 0;
  batted = false;
  private g = 16;
  private model = createCherryBomb();
  private ring = blastRing();
  private target = new THREE.Vector3();
  private landY: number;

  constructor(L: Level3D, from: THREE.Vector3, target: THREE.Vector3, T: number, public fuse = 0.8) {
    this.pos = from.clone();
    this.target.copy(target);
    this.landY = target.y;
    this.vel.set((target.x - from.x) / T, (target.y - from.y + 0.5 * this.g * T * T) / T, (target.z - from.z) / T);
    this.model.root.position.copy(this.pos);
    L.scene.add(this.model.root, this.ring.g);
    L.actors.push(this); L.hittables.push(this);
    audio.sfx('throw', { pitch: 1.3, volume: 0.6 });
    // co-op: every machine flies its own copy; each copy can only hurt its own hero
    L.nl?.spawned(this, 'bomb', { f: from, t: target, T, fuse });
  }

  netEvent(L: Level3D, ev: string, d: { pos?: THREE.Vector3; vel?: THREE.Vector3 }) {
    if (ev === 'bat' && d.pos && d.vel && !this.dead) { this.batted = true; this.state = 'fly'; this.pos.copy(d.pos); this.vel.copy(d.vel); }
    else if ((ev === 'boom' || ev === 'gone') && !this.dead) this.explode(L);
  }

  update(L: Level3D, dt: number) {
    if (this.dead) return;
    this.t += dt;
    if (this.state === 'fly') {
      this.vel.y -= this.g * dt;
      this.pos.addScaledVector(this.vel, dt);
      const p = L.player;
      const pc = p.center();
      if (!this.batted && !p.dead && pc.distanceTo(this.pos) < 0.7) { this.explode(L); return; }
      if (this.batted) {
        for (const e of L.enemies) if (!e.dead && e.spawnT <= 0 && e.center().distanceTo(this.pos) < e.body.r + 0.6) { this.explode(L); return; }
      }
      const solid = L.phys.pointInSolid(this.pos);
      if ((solid && this.vel.y < 0) || this.pos.y < this.landY - 0.05 && this.vel.y < 0 && !this.batted) {
        const gy = L.phys.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.6, 0.1);
        this.pos.y = gy > -1e8 ? gy + 0.3 : this.pos.y;
        this.state = 'fuse'; this.fuseT = this.batted ? 0.25 : this.fuse;
        this.vel.set(0, 0, 0);
        audio.sfx('thud', { volume: 0.4, pitch: 1.6 });
        audio.sfx('fuse', { volume: 0.7 });
        L.fx.dust(this.pos.clone(), 4);
      } else if (solid) { this.explode(L); return; }
      if (this.pos.y < L.killY) { this.remove(L); return; }
    } else {
      this.fuseT -= dt;
      if (this.fuseT <= 0) { this.explode(L); return; }
    }
    // model + telegraph
    const fuse01 = this.state === 'fuse' ? 1 - clamp(this.fuseT / Math.max(0.01, this.fuse), 0, 1) : clamp(this.t * 0.4, 0, 0.4);
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y += dt * 4;
    this.model.update(dt, fuse01);
    const at = this.state === 'fuse' ? this.pos : this.batted ? this.pos : this.target;
    const gy = this.state === 'fuse' ? this.pos.y - 0.3 : this.batted ? L.phys.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.1) : this.target.y;
    this.ring.g.visible = gy > -1e8;
    this.ring.g.position.set(at.x, gy + 0.05, at.z);
    this.ring.g.scale.setScalar(RADIUS);
    this.ring.fill.scale.setScalar(Math.max(0.02, fuse01 * 0.9 + 0.1));
    this.ring.ringM.opacity = 0.6 + 0.35 * Math.sin(this.t * (this.state === 'fuse' ? 30 : 12));
  }

  explode(L: Level3D) {
    if (this.dead) return;
    const c = this.pos.clone();
    this.remove(L);
    audio.sfx('boom');
    L.tcam.shake(0.45);
    L.fx.ring(c.clone(), RADIUS * 1.1, '#ffb02a', 0.35, false);
    L.fx.juice(c.clone(), 22, ['#e8283a', '#ff5a3a', '#ffd34a']);
    L.fx.emit(c.clone(), { count: 26, speed: [3, 8], life: [0.25, 0.5], size: [0.2, 0.45], colors: ['#ffd34a', '#ff8a2a', '#ffffff'], g: 4, drag: 3 });
    L.fx.dust(c.clone(), 10, '#5a4a4a');
    L.noise(c, 12);
    const p = L.player;
    if (!p.dead && p.center().distanceTo(c) < RADIUS + 0.3) p.hurt(L, 1, c);
    if (L.authority) for (const e of L.enemies) {
      if (e.dead || e.spawnT > 0) continue;
      if (e.center().distanceTo(c) < RADIUS + e.body.r) e.hurt(L, this.batted ? 3 : 2, c, 'bomb');
    }
  }

  private remove(L: Level3D) {
    this.dead = true;
    L.scene.remove(this.model.root, this.ring.g);
    L.nl?.remove(this);
  }

  meleeHit(L: Level3D, c: THREE.Vector3, dir: THREE.Vector3, range: number): boolean {
    if (this.dead || this.batted) return false;
    if (tmp.copy(this.pos).sub(c).length() > range + 0.7) return false;
    this.batted = true;
    this.state = 'fly';
    this.pos.y += 0.3;
    // lob it at the nearest melon in front of the swing (that's the fun of batting it back)
    const fwd = tmp.copy(dir).setY(0).normalize();
    let best: THREE.Vector3 | null = null, bd = 16;
    for (const e of L.enemies) {
      if (e.dead || e.spawnT > 0) continue;
      const c = e.center();
      const dx = c.x - this.pos.x, dz = c.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < bd && d > 0.5 && (dx * fwd.x + dz * fwd.z) / d > 0.45) { bd = d; best = c; }
    }
    if (best) {
      const T = clamp(bd / 15, 0.3, 0.9);
      this.vel.set((best.x - this.pos.x) / T, (best.y - this.pos.y + 0.5 * this.g * T * T) / T, (best.z - this.pos.z) / T);
    } else { this.vel.copy(fwd).multiplyScalar(15); this.vel.y = 6; }
    audio.sfx('reflect', { pitch: 1.4 });
    L.fx.sparks(this.pos.clone(), 10);
    L.fx.text(this.pos.clone().setY(this.pos.y + 1), 'Отбил!', '#ffe14a', 20);
    if (L.nl) L.nl.entEvent(this, 'bat', { pos: this.pos, vel: this.vel });
    return true;
  }

  shotHit(L: Level3D, s: Shot3): boolean {
    if (this.dead) return false;
    if (s.pos.distanceTo(this.pos) < 0.55 + s.r) { if (L.nl) L.nl.entEvent(this, 'boom'); this.explode(L); return true; }
    return false;
  }
}

NET_SPAWN.bomb = (L, a: { f: number[] | THREE.Vector3; t: number[] | THREE.Vector3; T: number; fuse: number }) => {
  const v = (x: number[] | THREE.Vector3) => (x instanceof THREE.Vector3 ? x : toV(x));
  return new Bomb3(L, v(a.f), v(a.t), a.T, a.fuse);
};
