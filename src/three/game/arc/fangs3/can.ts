import * as THREE from 'three';
import { mat, basic, noOutline } from '../../../gfx';
import { clamp, damp } from '../../../models/kit';
import type { Level3D } from '../../level';

/**
 * Карамель's old watering can (docs/script-fangs-v2.md §7.0, §7.4 phase 3) — one and the same prop in the cold open
 * (it waters a grey flower by itself and drops) and in the fight (Шёпот floats it over a hero, it tilts with a thin
 * white stream as the telegraph, then pours a grey puddle). Plus the grey puddles themselves. Visuals only, local to
 * every machine; whoever drives it (the cold open script / the boss's snapshots) sets pos / tilt / pour.
 */
export class WateringCan {
  root = new THREE.Group();
  /** the can itself (tilts about its handle) */
  private body = new THREE.Group();
  private rose = new THREE.Object3D();
  private stream: THREE.Mesh;
  private streamM: THREE.MeshBasicMaterial;
  private drops: THREE.Mesh[] = [];
  /** 0 upright .. 1 tipped (spout down) */
  tilt = 0;
  /** 0..1 how much water runs (the telegraph is a thin white trickle, the pour a full stream) */
  pour = 0;
  /** lying on the floor (the cold open's end) */
  lying = false;
  private t = Math.random() * 6;
  private k = 0;
  constructor(L: Level3D) {
    const tin = mat('#7a9a8a'), tinD = mat('#5a7a6a'), brass = mat('#c9a24a');
    const b = this.body;
    // the tank: a slightly tapered tin drum
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.46, 16), tin); tank.position.y = 0.23; b.add(tank);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.03, 6, 18), tinD); rim.rotation.x = Math.PI / 2; rim.position.y = 0.46; b.add(rim);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.025, 6, 18), brass); band.rotation.x = Math.PI / 2; band.position.y = 0.12; b.add(band);
    // the handle over the top, front to back
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 6, 14, Math.PI), tinD); handle.position.set(0, 0.46, -0.04); handle.rotation.y = Math.PI / 2; b.add(handle);
    // the spout out of the front, up and forward (+Z), the rose at its end
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.62, 8), tin);
    spout.position.set(0, 0.32, 0.42); spout.rotation.x = Math.PI / 2 - 0.75; b.add(spout);
    const roseM = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.04, 0.08, 10), brass);
    roseM.position.set(0, 0.54, 0.64); roseM.rotation.x = Math.PI / 2 - 0.75; b.add(roseM);
    this.rose.position.set(0, 0.57, 0.68); b.add(this.rose);
    b.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    // (the handle is the pivot: the can swings forward about it)
    this.body.position.y = -0.5;
    const pivot = new THREE.Group(); pivot.position.y = 0.5; pivot.add(this.body);
    this.root.add(pivot);
    this.pivot = pivot;
    // the water: a thin stream from the rose to the ground (world space, set each frame) + a few drops
    this.streamM = basic('#f4f8ff', { transparent: true, opacity: 0, depthWrite: false });
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, -0.5, 0), this.streamM);
    noOutline(this.stream);
    this.stream.visible = false;
    L.scene.add(this.stream);
    for (let i = 0; i < 5; i++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), this.streamM);
      noOutline(d); d.visible = false; L.scene.add(d); this.drops.push(d);
    }
    this.root.visible = false;
    L.scene.add(this.root);
  }
  private pivot: THREE.Group;

  /** the rose (where the water comes out), world */
  roseAt(out = new THREE.Vector3()) { this.root.updateMatrixWorld(true); return this.rose.getWorldPosition(out); }

  update(dt: number, groundY = 0) {
    this.t += dt;
    this.k = damp(this.k, this.tilt, 8, dt);
    const r = this.root;
    if (this.lying) {
      this.pivot.rotation.set(0, 0, Math.PI / 2 - 0.1);
      this.pivot.position.y = 0.3;
    } else {
      // a ghostly bob and sway (nobody holds it)
      this.pivot.position.y = 0.5 + Math.sin(this.t * 2.1) * 0.05;
      this.pivot.rotation.set(this.k * 1.15 + Math.sin(this.t * 1.3) * 0.04, 0, Math.sin(this.t * 1.7) * 0.06);
    }
    const on = r.visible && this.pour > 0.02 && !this.lying;
    this.stream.visible = on;
    for (const d of this.drops) d.visible = on;
    if (!on) return;
    const a = this.roseAt(v1);
    const len = Math.max(0.1, a.y - groundY);
    this.stream.position.copy(a);
    const w = 0.015 + this.pour * 0.05;
    this.stream.scale.set(w, len, w);
    this.streamM.opacity = clamp(0.35 + this.pour * 0.5, 0, 0.85);
    this.drops.forEach((d, i) => {
      const f = (this.t * 2.2 + i / this.drops.length) % 1;
      d.position.set(a.x + Math.sin(i * 2.3) * 0.06, a.y - f * len, a.z + Math.cos(i * 1.7) * 0.06);
      d.scale.setScalar(0.6 + this.pour);
    });
  }
  dispose() { this.root.removeFromParent(); this.stream.removeFromParent(); for (const d of this.drops) d.removeFromParent(); }
}
const v1 = new THREE.Vector3();

/** a grey puddle on the floor (fight phase 3): a grey disc with a darker ring that fades out */
interface Pud { x: number; z: number; y: number; t: number; life: number; mesh: THREE.Group; disc: THREE.MeshBasicMaterial; ring: THREE.MeshBasicMaterial }
export const PUDDLE_R = 1.6;

export class Puddles {
  list: Pud[] = [];
  constructor(private L: Level3D) {}
  add(x: number, z: number, y = 0, life = 6) {
    const g = new THREE.Group();
    const disc = basic('#8a8a96', { transparent: true, opacity: 0, depthWrite: false });
    disc.polygonOffset = true; disc.polygonOffsetFactor = -3;
    const ring = basic('#5a5a68', { transparent: true, opacity: 0, depthWrite: false });
    ring.polygonOffset = true; ring.polygonOffsetFactor = -4;
    const dm = new THREE.Mesh(new THREE.CircleGeometry(PUDDLE_R, 28).rotateX(-Math.PI / 2), disc);
    const rm = new THREE.Mesh(new THREE.RingGeometry(PUDDLE_R - 0.18, PUDDLE_R, 32).rotateX(-Math.PI / 2), ring);
    rm.position.y = 0.005;
    noOutline(dm); noOutline(rm);
    g.add(dm, rm);
    g.position.set(x, y + 0.04, z);
    this.L.scene.add(g);
    this.list.push({ x, z, y, t: 0, life, mesh: g, disc, ring });
    if (this.list.length > 6) this.drop(this.list[0]);
  }
  /** is (x, z) in a puddle (that hasn't dried up yet)? */
  inside(x: number, z: number, y: number) {
    return this.list.some((p) => p.t > 0.15 && p.t < p.life - 0.6 && Math.hypot(x - p.x, z - p.z) < PUDDLE_R - 0.15 && Math.abs(y - p.y) < 1.2);
  }
  update(dt: number) {
    for (const p of [...this.list]) {
      p.t += dt;
      const grow = clamp(p.t / 0.35, 0, 1), fade = clamp((p.life - p.t) / 0.8, 0, 1);
      p.mesh.scale.set(0.3 + 0.7 * grow, 1, 0.3 + 0.7 * grow);
      p.disc.opacity = 0.62 * fade; p.ring.opacity = 0.85 * fade;
      if (p.t >= p.life) this.drop(p);
    }
  }
  private drop(p: Pud) { p.mesh.removeFromParent(); this.list = this.list.filter((q) => q !== p); }
  clear() { for (const p of [...this.list]) this.drop(p); }
}
