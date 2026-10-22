import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { input } from '../../../../engine/input';
import { clamp, damp } from '../../../models/kit';
import { mat, basic, noOutline, canvasTex } from '../../../gfx';
import { glowTex } from '../../../world/outdoor';
import type { Level3D, Hittable3, HeroLike } from '../../level';
import type { Netted } from '../../netLevel';
import type { Shot3 } from '../../objects';
import type { BoxCol } from '../../../physics/types';
import { Batch, M, moonBeam, crystal } from './props';

/**
 * Mirrors of the greenhouse:
 *  • BeamMirror — a turning mirror on a stand under a moonbeam (`[E]` / a swing turns it 45°): when it faces its
 *    target the beam locks (gold) and lights the target (a door's crystal, a flowerbed, the dome). Netted: a client's
 *    turn goes to the host; the step / lock ride in snapshots, so late loaders see the same.
 *  • CrystalDoor — glass leaves that slide open when its crystal is lit (on every machine, from the mirror's state).
 *  • Reflections — tall mirror panels (the maze, the dome) show what is in front of them, seen from MY camera: the
 *    heroes (pale; Ноки has no reflection), invisible things (Невидимки, Шёпот — the real one, never his decoys), the
 *    hidden way out of the maze. Every machine draws its own from replicated positions.
 */

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// ═════════════════════════════ BEAM MIRROR ═════════════════════════════
export interface BeamMirrorOpts {
  /** the point the beam must reach (world) */
  target: THREE.Vector3;
  /** steps off the target at the start (0..7) */
  start: number;
  /** stays locked once it faces the target (level mirrors); arena mirrors can be turned away again */
  sticky?: boolean;
  /** save key (sticky mirrors remember being locked across respawns: L.seen) */
  key?: string;
  /** moonbeam column height above the mirror (0 = none) */
  moon?: number;
}

export class BeamMirror implements Netted, Hittable3 {
  netId = 0;
  netKind = 'f3mir';
  readonly pos: THREE.Vector3;
  step: number;
  locked = false;
  /** host: the boss is shaking it (a telegraph before he turns it away) */
  shake = 0;
  private yaw: number;
  private baseYaw: number;
  private head = new THREE.Group();
  private obj = new THREE.Group();
  private beam: THREE.Mesh;
  private beamM: THREE.MeshBasicMaterial;
  private glow: THREE.Sprite;
  private cd = 0;
  private t = Math.random() * 5;
  private lockCbs: ((m: BeamMirror, fromNet: boolean) => void)[] = [];
  private unlockCbs: ((m: BeamMirror) => void)[] = [];
  private beamLen = 0;
  /** hero near enough to turn it (mine) */
  near = false;
  readonly pivot: THREE.Vector3;

  constructor(private L: Level3D, x: number, y: number, z: number, readonly o: BeamMirrorOpts) {
    this.pos = new THREE.Vector3(x, y, z);
    this.pivot = new THREE.Vector3(x, y + 1.7, z);
    const d = v1.copy(o.target).sub(this.pivot);
    this.baseYaw = Math.atan2(d.x, d.z);
    const done = !!o.key && L.seen.has(o.key);
    this.step = done ? 0 : ((o.start % 8) + 8) % 8;
    this.yaw = this.yawOf(this.step);
    // the stand: a stone drum, a brass fork, an oval mirror in an iron rim
    const stone = M.stoneD(), brass = M.brass(), iron = M.iron();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.5, 14), stone); base.position.y = 0.25; base.castShadow = true;
    this.obj.add(base);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.2, 8), iron); post.position.y = 0.95;
    this.obj.add(post);
    this.head.position.y = 1.7;
    const fork = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 6, 20, Math.PI), brass); fork.rotation.z = Math.PI; fork.position.y = 0.05;
    this.head.add(fork);
    const tilt = new THREE.Group();
    tilt.rotation.x = -0.6; // tipped back: catches the moon above, sends it ahead
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 8, 28), iron); rim.scale.set(1, 1.25, 1);
    tilt.add(rim);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.6, 28), mirrorFaceMat()); face.scale.set(1, 1.25, 1); face.position.z = 0.02;
    tilt.add(face);
    const back = new THREE.Mesh(new THREE.CircleGeometry(0.62, 28), mat('#3a3448')); back.scale.set(1, 1.25, 1); back.rotation.y = Math.PI; back.position.z = -0.02;
    tilt.add(back);
    this.head.add(tilt);
    this.obj.add(this.head);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#cfe0ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
    this.glow.scale.setScalar(2.2); this.glow.position.y = 1.7;
    noOutline(this.glow);
    this.obj.add(this.glow);
    this.obj.position.copy(this.pos);
    L.scene.add(this.obj);
    // the reflected beam
    this.beamM = basic('#d8e6ff', { additive: true, transparent: true, opacity: 0.55, depthWrite: false });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 8, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), this.beamM);
    noOutline(this.beam);
    this.beam.frustumCulled = false;
    L.scene.add(this.beam);
    if ((o.moon ?? 14) > 0) moonBeam(L, x, y + 1.7, z, y + 1.7 + (o.moon ?? 14), 0.75);
    L.col({ kind: 'cyl', x, z, r: 0.6, y0: y, y1: y + 2.2 });
    L.hittables.push(this);
    if (L.building) L.nl?.add(this);
    if (done) this.locked = true;
    this.head.rotation.y = this.yaw;
    this.updateBeam(0);
  }

  private yawOf(step: number) { return this.baseYaw + step * (Math.PI / 4); }
  /** far from the camera: not drawn (the beam stays) */
  cull(on: boolean) { this.obj.visible = on; }
  get faces() { return this.step === 0; }

  onLock(cb: (m: BeamMirror, fromNet: boolean) => void) { this.lockCbs.push(cb); if (this.locked) cb(this, false); }
  onUnlock(cb: (m: BeamMirror) => void) { this.unlockCbs.push(cb); }

  /** turn one step (host / solo); a client asks the host */
  turn(by: 'me' | string = 'me', fromNet = false) {
    const L = this.L;
    if (!L.authority) { L.nl?.entEvent(this, 'turn', {}); this.turnFx(); return; }
    if (this.cd > 0 || this.locked) return; // (facing its target: nothing to turn — a swing at the boss won't knock it off)
    this.cd = 0.3;
    this.step = (this.step + 1) % 8;
    this.applyStep(fromNet);
    L.nl?.entEvent(this, 'turned', { s: this.step });
    void by;
  }
  /** host: turn it away (the boss); `steps` off the target */
  turnAway(steps = 3) {
    if (!this.L.authority) return;
    this.step = steps % 8;
    this.applyStep(false);
    this.L.nl?.entEvent(this, 'turned', { s: this.step, k: 1 });
  }
  private applyStep(fromNet: boolean) {
    const L = this.L;
    if (L.authority) this.turnFx();
    const was = this.locked;
    this.locked = this.step === 0 || (this.locked && this.o.sticky !== false);
    if (this.locked && !was) this.lockNow(fromNet);
    else if (!this.locked && was) for (const cb of this.unlockCbs) cb(this);
  }
  private lockNow(fromNet: boolean) {
    if (this.o.key && this.L.authority) this.L.seen.add(this.o.key);
    audio.sfx('lanternOn', { pitch: 0.8 }); audio.sfx('reflect', { pitch: 0.9, volume: 0.6 });
    this.L.fx.stars(this.pivot.clone(), 20, ['#fff3a0', '#ffffff', '#cfe0ff']);
    for (const cb of this.lockCbs) { try { cb(this, fromNet); } catch (e) { console.error('[fangs3] mirror lock', e); } }
  }
  private turnFx() {
    audio.sfx('clang', { pitch: 1.8, volume: 0.35 });
    this.L.fx.sparks(this.pivot.clone(), 5);
  }

  // ── co-op ──
  netSnap() { return [this.step, this.locked ? 1 : 0]; }
  netApply(a: number[]) {
    const s = a[0] | 0, lk = !!a[1];
    if (s !== this.step) this.step = s;
    if (lk && !this.locked) { this.locked = true; this.lockNow(true); }
    else if (!lk && this.locked) { this.locked = false; for (const cb of this.unlockCbs) cb(this); }
  }
  netEvent(L: Level3D, ev: string, d: { s?: number; k?: number; from?: string }) {
    if (L.authority) { if (ev === 'turn') this.turn(d.from ?? 'x', true); return; }
    if (ev === 'shake') { this.shake = 1; return; }
    if (ev === 'turned' && typeof d.s === 'number') {
      this.step = d.s; this.turnFx();
      const lk = this.step === 0 || (this.locked && this.o.sticky !== false);
      if (lk && !this.locked) { this.locked = true; this.lockNow(true); }
      else if (!lk && this.locked) { this.locked = false; for (const cb of this.unlockCbs) cb(this); }
    }
  }

  // ── swings / peas turn it too ──
  meleeHit(L: Level3D, c: THREE.Vector3, _dir: THREE.Vector3, range: number): boolean {
    if (Math.hypot(c.x - this.pos.x, c.z - this.pos.z) > range + 0.5 || c.y > this.pos.y + 3 || c.y < this.pos.y - 1) return false;
    if (this.locked) return false;
    if (L.authority) this.turn(L.attacker ?? 'me', !!L.attacker);
    return true;
  }
  predictHit(_L: Level3D, c: THREE.Vector3, range: number): boolean {
    return !this.locked && Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < range + 0.5 && c.y < this.pos.y + 3 && c.y > this.pos.y - 1;
  }
  shotHit(_L: Level3D, s: Shot3): boolean { return !this.locked && s.pos.distanceTo(this.pivot) < 0.7; }

  /** every machine: my hero near → the [E] prompt; pressing it turns the mirror */
  interact(p: HeroLike, busy: boolean) {
    const L = this.L;
    const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    this.near = !busy && !p.dead && !p.downed && d < 2.6 && Math.abs(p.pos.y - this.pos.y) < 1.6 && !this.locked;
    if (this.near && input.pressed('interact')) { input.consume?.('interact'); this.turn(); return true; }
    void L;
    return false;
  }

  update(dt: number) {
    this.t += dt; this.cd -= dt;
    const want = this.yawOf(this.step);
    // turn the short way, smoothly
    let dd = want - this.yaw; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
    this.yaw += dd * Math.min(1, dt * 10);
    this.head.rotation.y = this.yaw + (this.shake > 0 ? Math.sin(this.t * 40) * 0.08 * this.shake : 0);
    this.shake = Math.max(0, this.shake - dt * 0.5);
    this.updateBeam(dt);
  }

  private updateBeam(dt: number) {
    const L = this.L;
    const aligned = Math.abs(Math.atan2(Math.sin(this.yaw - this.baseYaw), Math.cos(this.yaw - this.baseYaw))) < 0.02 && this.step === 0;
    const from = this.pivot;
    let to: THREE.Vector3;
    if (aligned) to = this.o.target;
    else {
      const dir = v1.set(Math.sin(this.yaw), -0.08, Math.cos(this.yaw)).normalize();
      const o = v2.copy(from).addScaledVector(dir, 0.8);
      const hit = L.phys.raycast(o, dir, 26);
      to = v3.copy(o).addScaledVector(dir, hit);
    }
    const len = from.distanceTo(to);
    this.beamLen = dt > 0 ? damp(this.beamLen, len, 14, dt) : len;
    this.beam.position.copy(from);
    this.beam.lookAt(to);
    this.beam.scale.set(this.locked ? 1.6 : 1, this.locked ? 1.6 : 1, this.beamLen);
    this.beamM.color.set(this.locked ? '#ffe9a0' : '#c8d8ff');
    this.beamM.opacity = (this.locked ? 0.75 : 0.4) * (0.85 + 0.15 * Math.sin(this.t * 6));
    (this.glow.material as THREE.SpriteMaterial).color.set(this.locked ? '#ffe9a0' : '#cfe0ff');
  }
}

let faceT: THREE.Texture | null = null;
export function mirrorTex() {
  return (faceT ??= canvasTex(128, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#dfe8ff'); gr.addColorStop(0.45, '#9aa8d0'); gr.addColorStop(0.55, '#c8d4f4'); gr.addColorStop(1, '#6a7aa8');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 6;
    for (const k of [0.25, 0.32, 0.7]) { g.beginPath(); g.moveTo(w * k, 0); g.lineTo(w * (k - 0.5), h); g.stroke(); }
  }));
}
let faceM: THREE.MeshBasicMaterial | null = null;
export function mirrorFaceMat() { return (faceM ??= basic('#ffffff', { map: mirrorTex() })); }

// ═════════════════════════════ CRYSTAL DOOR ═════════════════════════════
/** glass leaves in a frame (across x at z, or across z at x) with a crystal on top; open() slides them apart */
export class CrystalDoor {
  readonly crystal: ReturnType<typeof crystal>;
  private leaves: THREE.Mesh[] = [];
  private col: BoxCol;
  private k = 0;
  open = false;
  constructor(private L: Level3D, B: Batch, readonly x: number, readonly y: number, readonly z: number, readonly w: number, readonly h: number, readonly alongX = true) {
    const iron = M.iron();
    const lm = basic('#cfeeff', { transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false });
    for (const s of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(alongX ? w / 2 : 0.12, h, alongX ? 0.12 : w / 2), lm);
      leaf.position.set(alongX ? x + s * w / 4 : x, y + h / 2, alongX ? z : z + s * w / 4);
      noOutline(leaf); leaf.renderOrder = 8;
      L.scene.add(leaf);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(alongX ? w / 2 : 0.16, 0.14, alongX ? 0.16 : w / 2), M.brass());
      edge.position.y = h / 2 - 0.1; leaf.add(edge);
      const edge2 = edge.clone(); edge2.position.y = -h / 2 + 0.1; leaf.add(edge2);
      this.leaves.push(leaf);
    }
    for (const s of [-1, 1]) B.box(iron, alongX ? x + s * (w / 2 + 0.15) : x, y + h / 2 + 0.3, alongX ? z : z + s * (w / 2 + 0.15), 0.3, h + 0.6, 0.3);
    B.box(iron, x, y + h + 0.45, z, alongX ? w + 0.6 : 0.3, 0.3, alongX ? 0.3 : w + 0.6);
    this.crystal = crystal(L, x, y + h + 1.0, z, 1.1);
    this.col = { kind: 'box', min: new THREE.Vector3(alongX ? x - w / 2 : x - 0.3, y - 0.2, alongX ? z - 0.3 : z - w / 2), max: new THREE.Vector3(alongX ? x + w / 2 : x + 0.3, y + h + 3, alongX ? z + 0.3 : z + w / 2) };
    L.col(this.col);
  }
  get center() { return new THREE.Vector3(this.x, this.y + this.h + 1.0, this.z); }
  setOpen(on: boolean, fx = true) {
    if (on === this.open) return;
    this.open = on;
    this.col.active = !on;
    if (fx) { audio.sfx(on ? 'door' : 'thud', { pitch: on ? 1.2 : 0.8 }); this.L.fx.sparks(this.center, 12, ['#fff3a0', '#cfe0ff']); }
  }
  update(dt: number) {
    this.k = damp(this.k, this.open ? 1 : 0, 3, dt);
    this.crystal.set(this.k);
    this.crystal.spin(dt);
    this.leaves.forEach((l, i) => {
      const s = i ? 1 : -1;
      const off = this.k * (this.w / 2 - 0.1);
      if (this.alongX) l.position.x = this.x + s * (this.w / 4 + off);
      else l.position.z = this.z + s * (this.w / 4 + off);
    });
  }
}

// ═════════════════════════════ REFLECTIONS ═════════════════════════════
export interface Panel { c: THREE.Vector3; n: THREE.Vector3; u: THREE.Vector3; hw: number; y0: number; y1: number; fake?: boolean }
export type GhostKind = 'hero' | 'servant' | 'boss' | 'exit' | 'girl';
/** a thing the mirrors show; `flip` mirrors the picture (the girl points the other way) */
export interface GhostSrc { kind: GhostKind; pos: THREE.Vector3; h: number; flip?: boolean; alpha?: number }

/** a tall mirror panel (visual + collider unless fake); returns its Panel (normal = `facing` direction) */
export function mirrorPanel(L: Level3D, B: Batch, x: number, y: number, z: number, w: number, h: number, facing: THREE.Vector3, o: { fake?: boolean; col?: boolean } = {}): Panel {
  const n = facing.clone().setY(0).normalize();
  const u = new THREE.Vector3(n.z, 0, -n.x);
  const yaw = Math.atan2(n.x, n.z);
  // the two faces (batched: one draw call for every mirror of the level)
  const fg = new THREE.PlaneGeometry(w - 0.3, h - 0.3);
  const fp = new THREE.Vector3(x, y + h / 2, z).addScaledVector(n, 0.13);
  B.geo(mirrorFaceMat(), fg, [fp.x, fp.y, fp.z], [0, yaw, 0], [1, 1, 1], { cast: false });
  const bp = new THREE.Vector3(x, y + h / 2, z).addScaledVector(n, -0.13);
  B.geo(mirrorFaceMat(), fg, [bp.x, bp.y, bp.z], [0, yaw + Math.PI, 0], [1, 1, 1], { cast: false });
  const iron = M.iron(), brass = M.brass();
  // frame
  for (const s of [-1, 1]) { const p = new THREE.Vector3(x, 0, z).addScaledVector(u, s * (w / 2 - 0.08)); B.box(iron, p.x, y + h / 2, p.z, 0.2, h, 0.2, yaw); }
  B.box(brass, x, y + h - 0.08, z, w * Math.abs(u.x) + 0.24 * Math.abs(u.z), 0.18, w * Math.abs(u.z) + 0.24 * Math.abs(u.x));
  B.box(iron, x, y + 0.12, z, w * Math.abs(u.x) + 0.3 * Math.abs(u.z), 0.24, w * Math.abs(u.z) + 0.3 * Math.abs(u.x));
  // a little crown ornament
  const orn = new THREE.TorusGeometry(0.28, 0.05, 6, 14, Math.PI);
  B.geo(brass, orn, [x, y + h + 0.05, z], [0, yaw + Math.PI / 2, 0]);
  if (o.col !== false && !o.fake) {
    if (Math.abs(n.x) > 0.01 && Math.abs(n.z) > 0.01) {
      // a slanted panel: a row of posts (a box around it would stick out far in front of the glass)
      for (let k = -2; k <= 2; k++) { const px = x + u.x * k * (w / 5), pz = z + u.z * k * (w / 5); L.col({ kind: 'cyl', x: px, z: pz, r: 0.32, y0: y - 0.2, y1: y + h + 2.5 }); }
    } else {
      const hx = Math.abs(u.x) * w / 2 + Math.abs(n.x) * 0.15, hz = Math.abs(u.z) * w / 2 + Math.abs(n.z) * 0.15;
      L.col({ kind: 'box', min: new THREE.Vector3(x - hx, y - 0.2, z - hz), max: new THREE.Vector3(x + hx, y + h + 2.5, z + hz) });
    }
  }
  return { c: new THREE.Vector3(x, y, z).addScaledVector(n, 0.13), n, u, hw: w / 2 - 0.2, y0: y + 0.2, y1: y + h - 0.2, fake: o.fake };
}
/** the other face of a two-sided panel */
export function backOf(p: Panel): Panel {
  const n = p.n.clone().negate();
  return { c: p.c.clone().addScaledVector(p.n, -0.26), n, u: new THREE.Vector3(n.z, 0, -n.x), hw: p.hw, y0: p.y0, y1: p.y1, fake: p.fake };
}

const SIL: Partial<Record<GhostKind, THREE.Texture>> = {};
function silTex(kind: GhostKind) {
  const have = SIL[kind];
  if (have) return have;
  const t = canvasTex(128, 256, (g, w, h) => {
    const glow = (x: number, y: number, r: number, c: string) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); };
    if (kind === 'hero') {
      g.fillStyle = 'rgba(235,240,255,0.85)';
      g.beginPath(); g.ellipse(w / 2, h * 0.36, 30, 32, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(w / 2, h * 0.66, 28, 46, 0, 0, Math.PI * 2); g.fill();
      g.fillRect(w / 2 - 22, h * 0.7, 14, h * 0.28); g.fillRect(w / 2 + 8, h * 0.7, 14, h * 0.28);
    } else if (kind === 'servant') {
      g.fillStyle = 'rgba(40,24,70,0.92)';
      g.beginPath(); g.ellipse(w / 2, h * 0.42, 30, 30, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(w / 2, h * 0.7, 36, 50, 0, 0, Math.PI * 2); g.fill();
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(w / 2 + s * 24, h * 0.36); g.lineTo(w / 2 + s * 52, h * 0.3); g.lineTo(w / 2 + s * 28, h * 0.46); g.fill(); }
      glow(w / 2 - 11, h * 0.42, 14, 'rgba(255,60,80,1)'); glow(w / 2 + 11, h * 0.42, 14, 'rgba(255,60,80,1)');
    } else if (kind === 'boss') {
      g.fillStyle = 'rgba(28,16,52,0.95)';
      g.beginPath(); g.moveTo(w / 2, h * 0.12); g.quadraticCurveTo(w * 0.95, h * 0.5, w * 0.98, h); g.lineTo(w * 0.02, h); g.quadraticCurveTo(w * 0.05, h * 0.5, w / 2, h * 0.12); g.fill();
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(w / 2 + s * 10, h * 0.16); g.quadraticCurveTo(w / 2 + s * 62, h * 0.0, w / 2 + s * 40, h * 0.24); g.fill(); }
      glow(w / 2 - 12, h * 0.24, 13, 'rgba(210,225,255,1)'); glow(w / 2 + 12, h * 0.24, 13, 'rgba(210,225,255,1)');
    } else if (kind === 'girl') {
      // the shadow without an owner (v2 закладка А): a girl with pigtails and a guitar on her back, pointing the way
      glow(w / 2, h * 0.5, 70, 'rgba(150,120,255,0.35)');
      g.fillStyle = 'rgba(26,14,48,0.95)';
      g.beginPath(); g.arc(w / 2, h * 0.22, 17, 0, Math.PI * 2); g.fill();
      for (const s of [-1, 1]) { g.beginPath(); g.ellipse(w / 2 + s * 22, h * 0.25, 6, 16, s * 0.35, 0, Math.PI * 2); g.fill(); }
      // the guitar on her back (its neck over the shoulder)
      g.save(); g.translate(w / 2 - 14, h * 0.5); g.rotate(0.45);
      g.beginPath(); g.ellipse(0, 18, 17, 22, 0, 0, Math.PI * 2); g.fill(); g.fillRect(-3, -44, 6, 48); g.restore();
      // a dress, legs
      g.beginPath(); g.moveTo(w / 2 - 15, h * 0.31); g.lineTo(w / 2 + 15, h * 0.31); g.lineTo(w / 2 + 26, h * 0.68); g.lineTo(w / 2 - 26, h * 0.68); g.closePath(); g.fill();
      g.fillRect(w / 2 - 15, h * 0.67, 10, h * 0.28); g.fillRect(w / 2 + 5, h * 0.67, 10, h * 0.28);
      // the arm pointing out (to the right of the picture)
      g.save(); g.translate(w / 2 + 12, h * 0.36); g.rotate(-0.5); g.fillRect(0, -4, 46, 9); g.beginPath(); g.arc(48, 0, 6, 0, Math.PI * 2); g.fill(); g.restore();
      // eyes: two little lights
      glow(w / 2 - 6, h * 0.22, 6, 'rgba(255,240,200,1)'); glow(w / 2 + 6, h * 0.22, 6, 'rgba(255,240,200,1)');
    } else {
      // the way out: a glowing arch with a little moon
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,240,160,0.95)'); gr.addColorStop(1, 'rgba(255,200,90,0.5)');
      g.strokeStyle = gr; g.lineWidth = 12;
      g.beginPath(); g.moveTo(16, h - 4); g.lineTo(16, h * 0.35); g.arc(w / 2, h * 0.35, w / 2 - 16, Math.PI, 0); g.lineTo(w - 16, h - 4); g.stroke();
      g.fillStyle = 'rgba(255,240,170,0.25)'; g.fillRect(22, h * 0.35, w - 44, h * 0.65);
      g.fillStyle = 'rgba(255,250,210,1)'; g.beginPath(); g.arc(w / 2, h * 0.4, 18, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,240,160,0.4)'; g.beginPath(); g.arc(w / 2 + 8, h * 0.38, 15, 0, Math.PI * 2); g.fill();
    }
  });
  SIL[kind] = t;
  return t;
}

interface Ghost { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; used: boolean }

export class Reflections {
  panels: Panel[] = [];
  private pool: Ghost[] = [];
  private geo = new THREE.PlaneGeometry(1, 1);
  constructor(private L: Level3D, private sources: () => GhostSrc[]) {}
  add(p: Panel) { this.panels.push(p); return p; }

  private ghost(i: number): Ghost {
    let g = this.pool[i];
    if (!g) {
      const m = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, map: silTex('hero'), side: THREE.DoubleSide });
      m.polygonOffset = true; m.polygonOffsetFactor = -4;
      const mesh = new THREE.Mesh(this.geo, m);
      mesh.renderOrder = 9;
      noOutline(mesh);
      mesh.frustumCulled = false;
      this.L.scene.add(mesh);
      g = { mesh, mat: m, used: false };
      this.pool[i] = g;
    }
    return g;
  }

  /** every frame on every machine: put each source's reflection on the panels my camera can see */
  update(t: number) {
    const L = this.L;
    const E = L.tcam.cam.position;
    let n = 0;
    const src = this.panels.length ? this.sources() : [];
    for (const pnl of this.panels) {
      if (n >= 28) break;
      if (pnl.fake) continue;
      const toCam = v1.copy(E).sub(pnl.c);
      const side = toCam.dot(pnl.n);
      if (side < 0.2 || toCam.length() > 34) continue;
      for (const s of src) {
        if (n >= 28) break;
        const P = v2.copy(s.pos).setY(s.pos.y + s.h * 0.5);
        const sd = v3.copy(P).sub(pnl.c).dot(pnl.n);
        if (sd < 0.15 || sd > 22) continue;
        // P reflected across the mirror plane, then the ray from my eye to it: where it crosses the mirror
        const Pr = P.clone().addScaledVector(pnl.n, -2 * sd);
        const dir = Pr.clone().sub(E);
        const den = dir.dot(pnl.n);
        if (Math.abs(den) < 1e-4) continue;
        const k = pnl.c.clone().sub(E).dot(pnl.n) / den;
        if (k <= 0 || k >= 1) continue;
        const X = E.clone().addScaledVector(dir, k);
        const along = X.clone().sub(pnl.c).dot(pnl.u);
        const size = s.h * 1.15 * k;
        if (Math.abs(along) > pnl.hw + size * 0.2 || X.y < pnl.y0 - size * 0.3 || X.y > pnl.y1 + size * 0.3) continue;
        // (a thing behind a wall in front of the mirror isn't reflected)
        if (s.kind !== 'exit') {
          const toX = X.clone().sub(P);
          const dl = toX.length();
          if (dl > 1.4 && L.phys.raycast(P, toX.multiplyScalar(1 / dl), dl - 1.0) < dl - 1.1) continue;
        }
        const g = this.ghost(n++);
        g.used = true;
        g.mat.map = silTex(s.kind);
        const fade = clamp(1 - (Math.abs(along) - pnl.hw + size * 0.3) / (size * 0.5 + 0.01), 0, 1) * clamp(1 - (sd - 16) / 6, 0, 1);
        const base = s.kind === 'hero' ? 0.42 : s.kind === 'exit' ? 0.85 + 0.15 * Math.sin(t * 3) : s.kind === 'girl' ? 0.8 + 0.15 * Math.sin(t * 2.2) : 0.95;
        g.mat.opacity = base * fade * (s.alpha ?? 1);
        g.mesh.visible = g.mat.opacity > 0.02;
        g.mesh.position.copy(X).addScaledVector(pnl.n, 0.03);
        g.mesh.quaternion.setFromUnitVectors(v3.set(0, 0, 1), pnl.n);
        const aspect = 0.5;
        g.mesh.scale.set(size * aspect * (s.kind === 'boss' ? 1.15 : 1) * (s.flip ? -1 : 1), size, 1);
        // clip to the panel (cheap: shrink near the edges via the fade above)
      }
    }
    for (let i = n; i < this.pool.length; i++) { const g = this.pool[i]; if (g.used) { g.used = false; g.mesh.visible = false; } }
    void UP;
  }
}
