import * as THREE from 'three';
import { net } from '../../../../net/session';
import { mat, basic, noOutline } from '../../../gfx';
import type { Level3D } from '../../level';
import type { BoxCol } from '../../../physics/types';
import { M, P3 } from './props';
import { ambient } from '../vampires/fxUtil';

/**
 * Moving things of the glass hall, driven by the room's shared clock (net.time() in co-op, the level clock solo), so
 * every machine moves them the same with nothing to replicate:
 *  • SprinklerCart — a watering cart riding its rail back and forth over the pit; my hero standing on it rides along;
 *  • Sprinkler — a spinning watering arm with a jet of water at shin height: jump it, or it knocks you back (−1 ♥).
 *    Each machine tests only its own hero (the jets are in the same place everywhere).
 */
export const clockOf = (L: Level3D) => (L.nl ? net.time() : L.t);

export class SprinklerCart {
  readonly col: BoxCol;
  private obj = new THREE.Group();
  private last = new THREE.Vector3();
  private wheels: THREE.Mesh[] = [];
  constructor(private L: Level3D, readonly x: number, readonly y: number, readonly z0: number, readonly z1: number, readonly w = 2.4, readonly d = 2.4, readonly period = 6, readonly phase = 0) {
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.35, d), M.brass());
    top.position.y = -0.175; top.castShadow = true; top.receiveShadow = true;
    this.obj.add(top);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.06, d - 0.3), mat('#5a8a6a'));
    tray.position.y = 0.01;
    this.obj.add(tray);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.9, 12), M.iron());
    tank.position.set(w / 2 - 0.5, -0.8, 0); this.obj.add(tank);
    for (const s of [-1, 1]) for (const t of [-1, 1]) {
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 12), M.ironD());
      wh.rotation.z = Math.PI / 2; wh.position.set(s * (w / 2 - 0.15), -0.45, t * (d / 2 - 0.4));
      this.obj.add(wh); this.wheels.push(wh);
    }
    L.scene.add(this.obj);
    // the rail under it
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, Math.abs(z1 - z0) + d + 1.4), M.ironD());
    rail.position.set(x, y - 0.65, (z0 + z1) / 2);
    L.scene.add(rail);
    this.col = { kind: 'box', min: new THREE.Vector3(x - w / 2, y - 0.35, 0), max: new THREE.Vector3(x + w / 2, y, 0), tag: 'moving' };
    L.col(this.col);
    this.place(this.zAt(clockOf(L)));
    this.last.copy(this.obj.position);
  }
  private zAt(t: number) {
    const k = 0.5 - 0.5 * Math.cos(((t / this.period) + this.phase) * Math.PI * 2);
    // a little rest at each end
    const e = Math.min(1, Math.max(0, (k - 0.08) / 0.84));
    return this.z0 + (this.z1 - this.z0) * e;
  }
  private place(z: number) {
    this.obj.position.set(this.x, this.y, z);
    this.col.min.z = z - this.d / 2; this.col.max.z = z + this.d / 2;
  }
  update(dt: number) {
    const z = this.zAt(clockOf(this.L));
    const dz = z - this.obj.position.z;
    this.place(z);
    for (const wh of this.wheels) wh.rotation.x += dz / 0.22;
    // my hero rides along (friends ride on their own machines)
    const p = this.L.player;
    if (p.body.onGround && p.body.ground === this.col && Math.abs(dz) < 2) p.body.pos.z += dz;
    void dt;
  }
}

export class Sprinkler {
  private arm = new THREE.Group();
  private jet: THREE.Mesh;
  private ang = 0;
  private hitCd = 0;
  constructor(private L: Level3D, readonly x: number, readonly y: number, readonly z: number, readonly r = 1.6, readonly speed = 1.6, readonly phase = 0) {
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.5, 12), M.brass());
    hub.position.set(x, y + 0.25, z); hub.castShadow = true;
    L.scene.add(hub);
    this.arm.position.set(x, y + 0.42, z);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, r, 8), M.iron());
    pipe.rotation.z = Math.PI / 2; pipe.position.x = r / 2; pipe.position.y = 0.05;
    this.arm.add(pipe);
    this.jet = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.08, r, 10, 1, true), basic('#9ad8ff', { transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    this.jet.rotation.z = Math.PI / 2; this.jet.position.x = r / 2;
    noOutline(this.jet);
    this.arm.add(this.jet);
    L.scene.add(this.arm);
    L.col({ kind: 'cyl', x, z, r: 0.28, y0: y, y1: y + 0.5 });
  }
  update(dt: number) {
    const L = this.L;
    this.ang = clockOf(L) * this.speed + this.phase;
    this.arm.rotation.y = -this.ang;
    this.jet.scale.set(1 + Math.sin(L.t * 30) * 0.08, 1, 1 + Math.cos(L.t * 27) * 0.08);
    const tip = new THREE.Vector3(this.x + Math.cos(this.ang) * this.r, this.y + 0.45, this.z + Math.sin(this.ang) * this.r);
    if (Math.random() < dt * 30) ambient(L, () => L.fx.emit(tip, { count: 1, speed: [1, 2.5], life: [0.25, 0.5], size: [0.05, 0.1], colors: ['#bfe8ff', '#ffffff'], g: 14, drag: 0.5 }));
    // the jet against MY hero: shin height, along the arm
    this.hitCd -= dt;
    const p = L.player;
    if (this.hitCd > 0 || p.dead || p.downed || p.invuln > 0) return;
    const dx = p.pos.x - this.x, dz = p.pos.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d > this.r + 0.25 || d < 0.3 || p.pos.y > this.y + 0.75 || p.pos.y < this.y - 0.5) return;
    const a = Math.atan2(dz, dx);
    let da = a - this.ang; da = Math.atan2(Math.sin(da), Math.cos(da));
    if (Math.abs(da) > 0.28 + 0.3 / Math.max(0.5, d)) return;
    this.hitCd = 1.2;
    const tx = -Math.sin(this.ang), tz = Math.cos(this.ang); // the sweep direction
    p.hurt(L, 1, new THREE.Vector3(this.x, this.y + 0.5, this.z), new THREE.Vector3(tx * 7 * Math.sign(this.speed), 7, tz * 7 * Math.sign(this.speed)));
    ambient(L, () => L.fx.emit(p.center(), { count: 14, speed: [1.5, 4], life: [0.3, 0.6], size: [0.08, 0.16], colors: ['#bfe8ff', '#ffffff'], g: 10 }));
  }
}
void P3;
