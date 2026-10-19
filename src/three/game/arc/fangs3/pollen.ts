import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { srand } from '../../../../engine/util';
import { mat, basic, noOutline, canvasTex } from '../../../gfx';
import { clamp, damp } from '../../../models/kit';
import type { Level3D, Hittable3 } from '../../level';
import type { Netted } from '../../netLevel';
import type { Shot3 } from '../../objects';
import { vamp } from '../vampires';
import { ambient } from '../vampires/fxUtil';

/**
 * Pollen — what gives the invisible away:
 *  • PollenMotes: golden specks drifting in the air of a hall (looks only);
 *  • Footprints: invisible things walking on pollen leave prints that fade (every machine stamps them from the
 *    positions it draws, so friends see the same trail);
 *  • PollenFlower: a giant night flower — hit it (sword, pea) and it bursts into a golden cloud: everything invisible
 *    around shows for a few seconds (vampires through the kit, the boss through onBurst). Regrows after a while. Netted.
 */

const v1 = new THREE.Vector3();

// ═════════════════════════════ MOTES ═════════════════════════════
export class PollenMotes {
  private pts: THREE.Points;
  private base: Float32Array;
  private t = 0;
  constructor(L: Level3D, private x0: number, private y0: number, private z0: number, private x1: number, private y1: number, private z1: number, n = 260, seed = 1) {
    const R = srand(seed);
    const a = new Float32Array(n * 3);
    this.base = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      a[i * 3] = x0 + R() * (x1 - x0); a[i * 3 + 1] = y0 + R() * (y1 - y0); a[i * 3 + 2] = z0 + R() * (z1 - z0);
      this.base[i * 4] = a[i * 3]; this.base[i * 4 + 1] = a[i * 3 + 1]; this.base[i * 4 + 2] = a[i * 3 + 2]; this.base[i * 4 + 3] = R() * 10;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a, 3));
    const m = new THREE.PointsMaterial({ color: '#ffe27a', size: 0.09, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, map: dotTex() });
    this.pts = new THREE.Points(g, m);
    this.pts.frustumCulled = false;
    noOutline(this.pts);
    L.scene.add(this.pts);
  }
  update(dt: number) {
    this.t += dt;
    const a = this.pts.geometry.attributes.position as THREE.BufferAttribute;
    const n = a.count, b = this.base, t = this.t;
    const h = this.y1 - this.y0;
    for (let i = 0; i < n; i++) {
      const s = b[i * 4 + 3];
      let y = b[i * 4 + 1] - ((t * 0.18 + s) % 1) * 0.6;
      if (y < this.y0) y += h;
      a.setXYZ(i, b[i * 4] + Math.sin(t * 0.5 + s) * 0.6, y, b[i * 4 + 2] + Math.cos(t * 0.4 + s * 1.3) * 0.6);
    }
    a.needsUpdate = true;
    void this.x0; void this.z0; void this.x1; void this.z1;
  }
}
let dotT: THREE.Texture | null = null;
function dotTex() {
  return (dotT ??= canvasTex(32, 32, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }));
}

// ═════════════════════════════ FOOTPRINTS ═════════════════════════════
let printT: THREE.Texture | null = null;
function printTex() {
  return (printT ??= canvasTex(64, 128, (g, w, h) => {
    // a long clawed print (vampire feet), dark gold pressed into the pollen, a bright rim
    g.fillStyle = 'rgba(120,80,20,0.9)';
    g.beginPath(); g.ellipse(w / 2, h * 0.62, w * 0.28, h * 0.3, 0, 0, Math.PI * 2); g.fill();
    for (const dx of [-0.25, 0, 0.25]) { g.beginPath(); g.ellipse(w / 2 + dx * w, h * 0.2, w * 0.09, h * 0.12, dx * 0.6, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = 'rgba(255,240,160,0.9)'; g.lineWidth = 3;
    g.beginPath(); g.ellipse(w / 2, h * 0.62, w * 0.3, h * 0.32, 0, 0, Math.PI * 2); g.stroke();
  }));
}
interface Print { mesh: THREE.Mesh; m: THREE.MeshBasicMaterial; t: number; life: number }
interface Track { last: THREE.Vector3; side: number }

export class Footprints {
  /** where pollen lies on the floor (xz discs); `all` = anywhere within */
  zones: { x: number; z: number; r: number }[] = [];
  private pool: Print[] = [];
  private next = 0;
  private tracks = new Map<object, Track>();
  private geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  /** every machine: a print was stamped here */
  onStamp: ((x: number, z: number) => void) | null = null;
  constructor(private L: Level3D) {}
  addZone(x: number, z: number, r: number) { this.zones.push({ x, z, r }); }
  inPollen(p: THREE.Vector3) { return this.zones.some((d) => Math.hypot(p.x - d.x, p.z - d.z) < d.r); }

  /** call every frame for each invisible walker (any machine, from the drawn position) */
  track(who: object, pos: THREE.Vector3, size = 1, onGround = true) {
    let tr = this.tracks.get(who);
    if (!tr) { tr = { last: pos.clone(), side: 1 }; this.tracks.set(who, tr); return; }
    const d = Math.hypot(pos.x - tr.last.x, pos.z - tr.last.z);
    if (d > 6) { tr.last.copy(pos); return; } // a jump / teleport
    if (d < 0.55 * size) return;
    const dx = (pos.x - tr.last.x) / d, dz = (pos.z - tr.last.z) / d;
    tr.last.copy(pos);
    if (!onGround || !this.inPollen(pos)) return;
    tr.side = -tr.side;
    const x = pos.x - dz * 0.16 * size * tr.side, z = pos.z + dx * 0.16 * size * tr.side;
    const gy = this.L.phys.groundAt(x, z, pos.y + 0.5, 0.05);
    this.stamp(x, (gy > -1e8 ? gy : pos.y) + 0.035, z, Math.atan2(dx, dz), size);
  }
  forget(who: object) { this.tracks.delete(who); }

  private stamp(x: number, y: number, z: number, yaw: number, size: number) {
    let p = this.pool[this.next];
    if (!p) {
      const m = basic('#ffffff', { transparent: true, map: printTex(), depthWrite: false });
      m.polygonOffset = true; m.polygonOffsetFactor = -6;
      const mesh = new THREE.Mesh(this.geo, m);
      mesh.renderOrder = 3;
      noOutline(mesh);
      this.L.scene.add(mesh);
      p = { mesh, m, t: 0, life: 0 };
      this.pool[this.next] = p;
    }
    this.next = (this.next + 1) % 120;
    p.mesh.position.set(x, y, z);
    p.mesh.rotation.y = yaw;
    p.mesh.scale.set(0.32 * size, 1, 0.5 * size);
    p.t = 0; p.life = 5.5;
    p.mesh.visible = true;
    this.onStamp?.(x, z);
  }
  update(dt: number) {
    for (const p of this.pool) {
      if (!p || !p.mesh.visible) continue;
      p.t += dt;
      p.m.opacity = clamp(Math.min(p.t / 0.15, (p.life - p.t) / 1.5), 0, 1);
      if (p.t >= p.life) p.mesh.visible = false;
    }
  }
}

// ═════════════════════════════ POLLEN FLOWER ═════════════════════════════
export class PollenFlower implements Netted, Hittable3 {
  netId = 0;
  netKind = 'f3pf';
  readonly pos: THREE.Vector3;
  readonly bulb: THREE.Vector3;
  private obj = new THREE.Group();
  private head = new THREE.Group();
  private budM: THREE.MeshToonMaterial;
  /** seconds until it is full again (0 = ready) */
  regrow = 0;
  private k = 1;
  private t = Math.random() * 5;
  private cbs: ((at: THREE.Vector3) => void)[] = [];
  private hinted = false;
  constructor(private L: Level3D, x: number, y: number, z: number, readonly r = 6.5, private s = 1) {
    this.pos = new THREE.Vector3(x, y, z);
    this.bulb = new THREE.Vector3(x, y + 2.3 * s, z);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * s, 0.18 * s, 2.2 * s, 8), mat('#2f6a46'));
    stem.position.y = 1.1 * s; stem.castShadow = true;
    this.obj.add(stem);
    for (let i = 0; i < 4; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), mat('#3f8a5a'));
      const a = (i / 4) * Math.PI * 2 + 0.4;
      leaf.scale.set(0.8 * s, 0.08 * s, 0.28 * s);
      leaf.position.set(Math.cos(a) * 0.55 * s, 0.25 * s, Math.sin(a) * 0.55 * s);
      leaf.rotation.y = -a; leaf.rotation.z = 0.25;
      this.obj.add(leaf);
    }
    this.head.position.y = 2.3 * s;
    // a fat closed bud of glowing petals full of pollen
    this.budM = mat('#ffd04a', { emissive: '#ff9a10', emissiveIntensity: 0.6 });
    const bud = new THREE.Mesh(new THREE.SphereGeometry(0.42 * s, 14, 10), this.budM);
    bud.scale.set(1, 1.15, 1);
    this.head.add(bud);
    const pm = mat('#8a3ad8');
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), pm);
      const a = (i / 6) * Math.PI * 2;
      p.scale.set(0.26 * s, 0.6 * s, 0.1 * s);
      p.position.set(Math.cos(a) * 0.36 * s, 0.05 * s, Math.sin(a) * 0.36 * s);
      p.rotation.y = -a + Math.PI / 2; p.rotation.z = 0.2;
      p.castShadow = true;
      this.head.add(p);
    }
    this.obj.add(this.head);
    this.obj.position.copy(this.pos);
    L.scene.add(this.obj);
    L.col({ kind: 'cyl', x, z, r: 0.25 * s, y0: y, y1: y + 2 * s });
    L.hittables.push(this);
    if (L.building) L.nl?.add(this);
  }
  onBurst(cb: (at: THREE.Vector3) => void) { this.cbs.push(cb); }
  /** far from the camera: not drawn */
  cull(on: boolean) { this.obj.visible = on; }
  get ready() { return this.regrow <= 0; }

  /** host / solo: burst it (a hit, a script) */
  burst() {
    const L = this.L;
    if (!L.authority || !this.ready) return;
    this.regrow = 11;
    this.burstFx();
    L.nl?.entEvent(this, 'burst', {});
    vamp(L).revealAround(this.bulb.clone().setY(this.pos.y + 1), this.r, 4.5);
    for (const cb of this.cbs) { try { cb(this.bulb.clone()); } catch (e) { console.error('[fangs3] burst', e); } }
  }
  private burstFx() {
    const L = this.L, c = this.bulb.clone();
    ambient(L, () => {
      audio.sfx('splash', { pitch: 1.6, volume: 0.6 }); audio.sfx('whoosh', { pitch: 1.4, volume: 0.5 });
      L.fx.emit(c, { count: 70, speed: [1.5, 5.5], life: [1.2, 2.4], size: [0.25, 0.55], size2: 2.4, colors: ['#ffe27a', '#ffd04a', '#fff3c0'], g: -0.3, drag: 2.2 });
      L.fx.ring(this.pos.clone().setY(this.pos.y + 0.1), this.r, '#ffe27a', 0.6);
      L.fx.stars(c, 14, ['#ffe27a', '#ffffff']);
    });
    // a short-lived dust cloud: the half-invisible show in it too
    const K = vamp(L);
    const d = { c: this.pos.clone(), r: this.r * 0.7 };
    K.dust.push(d);
    setTimeout(() => { const i = K.dust.indexOf(d); if (i >= 0) K.dust.splice(i, 1); }, 4500);
  }
  netSnap() { return [this.regrow > 0 ? 1 : 0]; }
  netApply(a: number[]) { if (!a[0] && this.regrow > 0) this.regrow = 0; }
  netEvent(L: Level3D, ev: string) {
    if (ev === 'burst' && !L.authority) { this.regrow = 11; this.burstFx(); for (const cb of this.cbs) { try { cb(this.bulb.clone()); } catch (e) { console.error(e); } } }
  }
  meleeHit(L: Level3D, c: THREE.Vector3, _dir: THREE.Vector3, range: number): boolean {
    if (!this.ready) return false;
    if (Math.hypot(c.x - this.pos.x, c.z - this.pos.z) > range + 0.6 || c.y > this.bulb.y + 1.2 || c.y < this.pos.y - 0.5) return false;
    if (L.authority) this.burst();
    return true;
  }
  predictHit(_L: Level3D, c: THREE.Vector3, range: number): boolean {
    return this.ready && Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < range + 0.6 && c.y < this.bulb.y + 1.2 && c.y > this.pos.y - 0.5;
  }
  shotHit(L: Level3D, s: Shot3): boolean {
    if (!this.ready || s.pos.distanceTo(this.bulb) > 0.75 * this.s) return false;
    if (L.authority) this.burst();
    return true;
  }
  update(dt: number, hint?: (str: string) => void) {
    this.t += dt;
    if (this.regrow > 0) this.regrow = Math.max(0, this.regrow - dt);
    this.k = damp(this.k, this.ready ? 1 : 0.25, this.ready ? 1.5 : 6, dt);
    this.head.scale.setScalar(0.55 + 0.45 * this.k + Math.sin(this.t * 2) * 0.02);
    this.head.rotation.y += dt * 0.2;
    this.budM.emissiveIntensity = 0.25 + 0.55 * this.k;
    if (this.ready && Math.random() < dt * 4) {
      ambient(this.L, () => this.L.fx.glow.emit(this.bulb.clone().add(v1.set((Math.random() - 0.5) * 0.6, 0.3, (Math.random() - 0.5) * 0.6)), { count: 1, speed: [0.1, 0.4], life: [0.8, 1.6], size: [0.05, 0.1], colors: ['#ffe27a', '#fff3c0'], g: -0.2 }));
    }
    if (hint && !this.hinted && this.ready && this.L.player.pos.distanceTo(this.pos) < 6) { this.hinted = true; hint('pollen'); }
  }
}
