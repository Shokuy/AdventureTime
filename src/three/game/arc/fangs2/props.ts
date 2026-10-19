import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { net } from '../../../../net/session';
import { mat, matU, basic, noOutline, canvasTex } from '../../../gfx';
import { woodPlanksTex, glowTex } from '../../../world/textures';
import { G, TAU, clamp, damp, cached, merge } from '../../../models/kit';
import * as P from '../../../world/props';
import type { BoxCol, CylCol, Collider } from '../../../physics/types';
import type { Level3D, Hittable3 } from '../../level';
import type { Netted } from '../../netLevel';
import type { Shot3 } from '../../objects';
import { vamp, ambient, markCharacter } from '../vampires';
import { createLilyBoat, createKamysh, type SimpleRig } from './models';
import { FIREFLY, TOASTS } from './lines';

/**
 * The swamp's props (all built in the level's build(), the same on every machine):
 *  water with a hazard under it (the трясина), mud islands, boardwalks and decks on stilts, crooked willows, reeds,
 *  lily pads, stilt huts, drifting mist, firefly swarms; and the moving bits:
 *   • SinkPlank — a rotten plank that sinks a moment after someone stands on it (each machine for the heroes it draws);
 *   • Raft — Камыш's ferry / a drifting lily pad, moved by the room's shared clock (no replication needed), carries MY hero;
 *   • FireflyJar — break it (host decides, Netted) → the fireflies fly ahead and light the way (a temporary «sun» there);
 *   • Drawbridge — lowers when its grey zone is restored (every machine hears the zone).
 */

const v1 = new THREE.Vector3();
const m4 = new THREE.Matrix4();
const q1 = new THREE.Quaternion();
const e1 = new THREE.Euler();
const s1 = new THREE.Vector3();

/** the room's clock (co-op: shared by everyone) — moving platforms are pure functions of it */
export function swampClock(L: Level3D) { return L.nl ? net.time() : L.t; }

let rnd = 1;
const R = () => { rnd = (rnd * 16807) % 2147483647; return (rnd - 1) / 2147483646; };
const rr = (a: number, b: number) => a + (b - a) * R();

// ───────────────────────── textures ─────────────────────────
let waterTexCache: THREE.Texture | null = null;
function waterTexC() {
  if (waterTexCache) return waterTexCache;
  waterTexCache = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#1f3d36'; g.fillRect(0, 0, w, h);
    let s = 7;
    const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    for (let i = 0; i < 70; i++) {
      const x = r() * w, y = r() * h, rx = 6 + r() * 20;
      g.strokeStyle = `rgba(160,220,190,${0.05 + r() * 0.08})`; g.lineWidth = 1.5;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { g.beginPath(); g.ellipse(x + ox, y + oy, rx, rx * 0.35, 0, 0, TAU); g.stroke(); }
    }
    // duckweed specks
    for (let i = 0; i < 260; i++) {
      const x = r() * w, y = r() * h;
      g.fillStyle = `rgba(${90 + r() * 40},${140 + r() * 50},60,${0.25 + r() * 0.35})`;
      g.beginPath(); g.arc(x, y, 1 + r() * 2.2, 0, TAU); g.fill();
    }
  }, { wrap: true });
  return waterTexCache;
}
let thatchTexC: THREE.Texture | null = null;
function thatchTex() {
  if (thatchTexC) return thatchTexC;
  thatchTexC = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#8a7a4a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 220; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      g.strokeStyle = `rgba(${60 + Math.random() * 80},${50 + Math.random() * 60},20,0.5)`; g.lineWidth = 1 + Math.random() * 1.5;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 4, y + 10 + Math.random() * 14); g.stroke();
    }
    for (let y = 0; y < h; y += 32) { g.fillStyle = 'rgba(30,20,10,0.35)'; g.fillRect(0, y, w, 3); }
  }, { wrap: true });
  return thatchTexC;
}
let mistTexC: THREE.Texture | null = null;
function mistTex() {
  if (mistTexC) return mistTexC;
  mistTexC = canvasTex(128, 128, (g, w, h) => {
    for (let i = 0; i < 7; i++) {
      const x = w * (0.3 + Math.random() * 0.4), y = h * (0.35 + Math.random() * 0.3), r = w * (0.18 + Math.random() * 0.2);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
  });
  return mistTexC;
}

/** a box whose UVs tile the texture every `unit` m (planks run across the long side) */
function boxTiled(w: number, h: number, d: number, unit: number, alongX: boolean) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // faces: +x −x +y −y +z −z, 4 verts each; +x/−x: u←z v←y, +y/−y: u←x v←z, +z/−z: u←x v←y
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [a, b] = dims[f];
    const swap = (f === 2 || f === 3) && !alongX;
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      const u = uv.getX(k), vv = uv.getY(k);
      if (swap) uv.setXY(k, (vv * b) / unit, (u * a) / unit);
      else uv.setXY(k, (u * a) / unit, (vv * b) / unit);
    }
  }
  return g;
}

// ═════════════════════════════ THE KIT ═════════════════════════════
type Inst = { geo: THREE.BufferGeometry; mat: THREE.Material; list: THREE.Matrix4[]; cast: boolean };

export class SwampKit {
  readonly planks: THREE.MeshToonMaterial;
  readonly mud = mat('#4a3a2c');
  readonly moss = mat('#4c6a34');
  readonly bark = mat('#3e3428');
  readonly barkD = mat('#2e261e');
  private inst = new Map<string, Inst>();
  /** animated things (mist sprites, swarms…) */
  private ticks: ((t: number, dt: number) => void)[] = [];
  private t = 0;
  /** rafts (ferry, lily pads) carry MY hero */
  rafts: Raft[] = [];
  sinkers: SinkPlank[] = [];
  swarms: FireflySwarm[] = [];
  mist: THREE.Sprite[] = [];
  moonPath: THREE.Mesh | null = null;

  constructor(readonly L: Level3D, seed = 3) {
    rnd = seed;
    const t = woodPlanksTex('dark', 4);
    this.planks = matU('#9aa294', { map: t });
  }

  private add(key: string, geo: () => THREE.BufferGeometry, material: THREE.Material, m: THREE.Matrix4, cast = true) {
    let i = this.inst.get(key);
    if (!i) { i = { geo: geo(), mat: material, list: [], cast }; this.inst.set(key, i); }
    i.list.push(m.clone());
  }
  private put(key: string, geo: () => THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0, cast = true) {
    m4.compose(v1.set(x, y, z), q1.setFromEuler(e1.set(rx, ry, rz)), s1.set(sx, sy, sz));
    this.add(key, geo, material, m4, cast);
  }

  // ───────────────────────── water, islands, walks ─────────────────────────
  /** the bog: water at y = 0 and the трясина under it (−1 heart and back to safe ground) */
  water(x0: number, z0: number, x1: number, z1: number) {
    const L = this.L;
    const w = x1 - x0, d = z1 - z0;
    const tex = waterTexC().clone(); tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(w / 14, d / 14);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), matU('#ffffff', { map: tex }));
    m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    m.receiveShadow = true; m.castShadow = false;
    noOutline(m);
    L.scene.add(m);
    // (deep under the surface: you sink a moment before it takes you; and safe ground above the water still counts as safe)
    L.phys.addHazards([{ min: new THREE.Vector3(x0, -6, z0), max: new THREE.Vector3(x1, -1.5, z1), kind: 'soup', dmg: 1 }]);
    this.ticks.push((t) => { tex.offset.set(t * 0.004, t * 0.006); });
    // the moon's glimmer on the water (a soft band toward the moon that follows the camera)
    const pm = basic('#9fb8ff', { additive: true, transparent: true, opacity: 0.16, depthWrite: false, map: glowTex() });
    pm.polygonOffset = true; pm.polygonOffsetFactor = -2;
    const path = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), pm);
    path.renderOrder = 1;
    noOutline(path);
    L.scene.add(path);
    this.moonPath = path;
  }

  /** a round mud island (top at `top`), mossy, a few tufts and mushrooms */
  island(x: number, z: number, r: number, top = 0.7, o: { grass?: number; mush?: number } = {}) {
    const L = this.L;
    const geo = cached(`isl|${r.toFixed(2)}`, () => new THREE.CylinderGeometry(r, r * 1.18, 1.6, Math.max(14, Math.round(r * 6)), 1));
    const m = new THREE.Mesh(geo, this.mud);
    m.position.set(x, top - 0.8, z); m.castShadow = false; m.receiveShadow = true;
    L.scene.add(m);
    const capGeo = cached(`islcap|${r.toFixed(2)}`, () => new THREE.CylinderGeometry(r * 0.97, r, 0.12, Math.max(14, Math.round(r * 6))));
    const c = new THREE.Mesh(capGeo, this.moss);
    c.position.set(x, top - 0.05, z); c.receiveShadow = true; c.castShadow = false;
    L.scene.add(c);
    L.col({ kind: 'cyl', x, z, r, y0: -3, y1: top });
    const n = o.grass ?? Math.round(r * 2.5);
    for (let i = 0; i < n; i++) {
      const a = R() * TAU, d = Math.sqrt(R()) * r * 0.9;
      this.tuft(x + Math.cos(a) * d, top, z + Math.sin(a) * d, rr(0.6, 1.2));
    }
    for (let i = 0; i < (o.mush ?? (R() < 0.5 ? 2 : 0)); i++) {
      const a = R() * TAU, d = rr(0.3, 0.85) * r;
      this.mushroom(x + Math.cos(a) * d, top, z + Math.sin(a) * d, rr(0.6, 1.1));
    }
    // reeds around the shore
    this.reeds(x, z, r + 0.4, Math.round(r * 3), r * 0.25);
  }

  /** a straight boardwalk on stilts between two points along x or z (whichever is longer), top at y */
  walk(x0: number, z0: number, x1: number, z1: number, y = 1, w = 2.2, o: { rails?: boolean; stilts?: boolean } = {}) {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const lx = alongX ? Math.abs(x1 - x0) : w, lz = alongX ? w : Math.abs(z1 - z0);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    this.deck(cx - lx / 2, cz - lz / 2, cx + lx / 2, cz + lz / 2, y, { alongX: !alongX, stilts: o.stilts });
    if (o.rails) {
      if (alongX) { this.rail(cx - lx / 2, cz - lz / 2, cx + lx / 2, cz - lz / 2, y); this.rail(cx - lx / 2, cz + lz / 2, cx + lx / 2, cz + lz / 2, y); }
      else { this.rail(cx - lx / 2, cz - lz / 2, cx - lx / 2, cz + lz / 2, y); this.rail(cx + lx / 2, cz - lz / 2, cx + lx / 2, cz + lz / 2, y); }
    }
  }

  /** a rectangular plank deck on stilts (top at y); planks run along x unless alongX = false */
  deck(x0: number, z0: number, x1: number, z1: number, y: number, o: { alongX?: boolean; stilts?: boolean; th?: number } = {}) {
    const L = this.L;
    const w = x1 - x0, d = z1 - z0, th = o.th ?? 0.28;
    const m = new THREE.Mesh(boxTiled(w, th, d, 2.4, o.alongX ?? true), this.planks);
    m.position.set((x0 + x1) / 2, y - th / 2, (z0 + z1) / 2);
    m.castShadow = true; m.receiveShadow = true;
    L.scene.add(m);
    L.col({ kind: 'box', min: new THREE.Vector3(x0, y - th, z0), max: new THREE.Vector3(x1, y, z1) });
    // cross beams under the edges + stilts
    if (o.stilts !== false) {
      const nx = Math.max(1, Math.round(w / 2.6)), nz = Math.max(1, Math.round(d / 2.6));
      for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
        if (i > 0 && i < nx && j > 0 && j < nz) continue; // only the rim
        const sx = x0 + 0.15 + (w - 0.3) * (i / nx), sz = z0 + 0.15 + (d - 0.3) * (j / nz);
        this.put('stilt', () => new THREE.CylinderGeometry(0.11, 0.14, 1, 8), this.bark, sx, (y - 2.6) / 2 - 0.1, sz, 1, y + 2.6, 1, rr(-0.04, 0.04), 0, rr(-0.04, 0.04));
      }
    }
  }

  /** a low wooden railing (a collider you can't walk through, 1 m high) */
  rail(x0: number, z0: number, x1: number, z1: number, y: number, h = 0.95) {
    const L = this.L;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 1.6));
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      this.put('rpost', () => new THREE.BoxGeometry(0.14, 1, 0.14), this.barkD, x0 + (x1 - x0) * k, y + h / 2, z0 + (z1 - z0) * k, 1, h, 1, 0, yaw + rr(-0.1, 0.1), rr(-0.06, 0.06));
    }
    this.put('rbar', () => new THREE.BoxGeometry(0.1, 0.1, 1), this.bark, (x0 + x1) / 2, y + h - 0.08, (z0 + z1) / 2, 1, 1, len, rr(-0.02, 0.02), yaw, 0);
    this.put('rbar', () => new THREE.BoxGeometry(0.1, 0.1, 1), this.bark, (x0 + x1) / 2, y + h * 0.5, (z0 + z1) / 2, 1, 1, len, rr(-0.03, 0.03), yaw, 0);
    const pad = 0.12;
    L.col({ kind: 'box', min: new THREE.Vector3(Math.min(x0, x1) - pad, y, Math.min(z0, z1) - pad), max: new THREE.Vector3(Math.max(x0, x1) + pad, y + h, Math.max(z0, z1) + pad), tag: 'rail' });
  }

  // ───────────────────────── plants ─────────────────────────
  tuft(x: number, y: number, z: number, s = 1) {
    this.put('tuft', () => {
      const parts: { g: THREE.BufferGeometry; p: [number, number, number]; r: [number, number, number] }[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU, h = 0.45 + (i % 3) * 0.12;
        parts.push({ g: new THREE.ConeGeometry(0.045, h, 4).translate(0, h / 2, 0), p: [Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08], r: [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35] });
      }
      return merge(parts);
    }, mat('#6a8a3e'), x, y, z, s, s * rr(0.8, 1.3), s, 0, R() * TAU, 0, false);
  }
  mushroom(x: number, y: number, z: number, s = 1) {
    this.put('mstem', () => new THREE.CylinderGeometry(0.05, 0.07, 0.3, 8).translate(0, 0.15, 0), mat('#e8e0c8'), x, y, z, s, s, s, 0, 0, 0, false);
    this.put('mcap', () => new THREE.SphereGeometry(0.16, 12, 6, 0, TAU, 0, Math.PI / 2).translate(0, 0.28, 0), mat('#b8406a', { emissive: '#5a1030', emissiveIntensity: 0.6 }), x, y, z, s, s, s, 0, 0, 0, false);
  }
  /** cattails / reeds in a ring band around (x, z) */
  reeds(x: number, z: number, r: number, n: number, band = 0.8) {
    for (let i = 0; i < n; i++) {
      const a = R() * TAU, d = r + rr(-band, band);
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d, h = rr(1.2, 2.4);
      this.put('reed', () => new THREE.CylinderGeometry(0.025, 0.04, 1, 5).translate(0, 0.5, 0), mat('#6a8a3a'), px, -0.2, pz, 1, h, 1, rr(-0.15, 0.15), 0, rr(-0.15, 0.15), false);
      if (R() < 0.55) this.put('cattail', () => new THREE.CapsuleGeometry(0.06, 0.22, 3, 6), mat('#5a3a22'), px, h - 0.25, pz, 1, 1, 1, 0, 0, 0, false);
    }
  }
  /** lily pads on open water */
  pads(x: number, z: number, r: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = R() * TAU, d = Math.sqrt(R()) * r, s = rr(0.4, 1.0);
      this.put('pad', () => new THREE.CylinderGeometry(1, 1, 0.04, 16, 1, false, 0.3, TAU - 0.6), mat(R() < 0.5 ? '#4f8a3a' : '#5e9a44'), x + Math.cos(a) * d, 0.03, z + Math.sin(a) * d, s, 1, s, 0, R() * TAU, 0, false);
      if (R() < 0.12) this.put('flower', () => new THREE.SphereGeometry(0.12, 8, 6), mat('#ffe0ee'), x + Math.cos(a) * d + 0.2, 0.12, z + Math.sin(a) * d, 1, 0.6, 1, 0, 0, 0, false);
    }
  }
  /** a crooked weeping willow: twisted trunk, a few limbs (one merged mesh), mossy clumps and curtains of strands */
  willow(x: number, z: number, y = 0, s = 1) {
    const L = this.L;
    const h = 5.5 * s;
    const pts: THREE.Vector3[] = [];
    let px = x, pz = z;
    for (let i = 0; i <= 6; i++) { pts.push(new THREE.Vector3(px, y + (i / 6) * h, pz)); px += rr(-0.35, 0.45) * s; pz += rr(-0.3, 0.3) * s; }
    const tubes: { g: THREE.BufferGeometry }[] = [{ g: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.32 * s, 8) }];
    const top = pts[pts.length - 1];
    const leaf = mat('#476a38'), leafL = mat('#628a44');
    const strandGeo = () => new THREE.CylinderGeometry(0.09, 0.03, 1, 5, 1).translate(0, -0.5, 0);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU + R() * 0.6, len = rr(1.6, 2.8) * s;
      const limb = new THREE.Vector3(top.x + Math.cos(a) * len, top.y + rr(-0.6, 0.6) * s, top.z + Math.sin(a) * len);
      const lc = new THREE.QuadraticBezierCurve3(pts[4].clone(), top.clone().add(new THREE.Vector3(Math.cos(a) * len * 0.4, 0.9 * s, Math.sin(a) * len * 0.4)), limb);
      tubes.push({ g: new THREE.TubeGeometry(lc, 6, 0.13 * s, 6) });
      this.put(R() < 0.5 ? 'wclump' : 'wclumpL', () => new THREE.SphereGeometry(1, 14, 10), R() < 0.5 ? leaf : leafL, limb.x, limb.y, limb.z, 1.3 * s, 0.6 * s, 1.3 * s);
      for (let j = 0; j < 12; j++) {
        const sa = R() * TAU, sd = rr(0.2, 1.3) * s;
        const sl = rr(1.6, Math.max(1.8, limb.y - 0.6));
        this.put(j % 3 ? 'wstrand' : 'wstrandL', strandGeo, j % 3 ? leaf : leafL, limb.x + Math.cos(sa) * sd, limb.y, limb.z + Math.sin(sa) * sd, s, sl, s, rr(-0.06, 0.06), 0, rr(-0.06, 0.06), false);
      }
    }
    // roots splayed into the water
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + R();
      this.put('wroot', () => new THREE.ConeGeometry(1, 1, 7), this.barkD, x + Math.cos(a) * 0.35 * s, y + 0.1, z + Math.sin(a) * 0.35 * s, 0.16 * s, 1.0 * s, 0.16 * s, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
    }
    const trunk = new THREE.Mesh(merge(tubes), this.bark);
    trunk.castShadow = true; trunk.receiveShadow = true;
    L.scene.add(trunk);
    L.col({ kind: 'cyl', x, z, r: 0.38 * s, y0: y - 3, y1: y + h * 0.8 });
    return { top: top.clone() };
  }

  /** a stilt hut (on its own deck): log walls, a thatched cone roof, round windows with a dim jar glow */
  hut(x: number, z: number, y: number, o: { w?: number; d?: number; h?: number; yaw?: number; wall?: string; glow?: string; door?: boolean } = {}) {
    const L = this.L;
    const w = o.w ?? 4, d = o.d ?? 4, h = o.h ?? 2.8, yaw = o.yaw ?? 0;
    const g = new THREE.Group();
    g.position.set(x, y, z); g.rotation.y = yaw;
    const wallM = mat(o.wall ?? '#6a5640');
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallM);
    body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true;
    g.add(body);
    // log bands
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.1, d + 0.12), this.barkD);
      b.position.y = 0.4 + i * (h / 4); g.add(b);
    }
    const roofT = thatchTex().clone(); roofT.needsUpdate = true; roofT.repeat.set(3, 2);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.85, h * 0.95, 4, 1), matU('#ffffff', { map: roofT }));
    roof.position.y = h + h * 0.45; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
    g.add(roof);
    // a crooked chimney pipe
    const pipe = new THREE.Mesh(G.cyl(), this.barkD);
    pipe.position.set(w * 0.25, h + 1.0, -d * 0.15); pipe.scale.set(0.16, 1.4, 0.16); pipe.rotation.z = 0.15;
    g.add(pipe);
    // windows: dim jar glow (no real light)
    const glowC = o.glow ?? '#c8b060';
    for (const sx of [-1, 1]) {
      const win = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), basic(glowC));
      win.position.set(sx * w * 0.25, h * 0.6, d / 2 + 0.02);
      g.add(win);
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.06, 6, 18), this.barkD);
      frame.position.copy(win.position); g.add(frame);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: glowC, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35 }));
      sp.position.copy(win.position).add(new THREE.Vector3(0, 0, 0.3)); sp.scale.setScalar(1.6);
      noOutline(sp); g.add(sp);
    }
    if (o.door !== false) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.7, 0.08), this.barkD);
      door.position.set(0, 0.85, d / 2 + 0.03); g.add(door);
    }
    L.scene.add(g);
    // collider (rotated: an AABB of the footprint)
    const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
    const hx = (w * c + d * s) / 2, hz = (w * s + d * c) / 2;
    L.col({ kind: 'box', min: new THREE.Vector3(x - hx, y, z - hz), max: new THREE.Vector3(x + hx, y + h, z + hz) });
    return g;
  }

  /** a wooden signpost with a script sign (§11) */
  sign(x: number, y: number, z: number, text: string, yaw = 0, short?: string) {
    this.L.add(P.signpost({ x, y, z, rotY: yaw, text: short ?? text }));
    this.L.signAt(x, y, z, text);
  }

  // ───────────────────────── atmosphere ─────────────────────────
  /** low drifting mist puffs over the water (denser = more of them) */
  mistBank(x: number, z: number, r: number, n: number, o: { y?: number; size?: number; color?: string; opacity?: number } = {}) {
    const L = this.L;
    for (let i = 0; i < n; i++) {
      const a = R() * TAU, d = Math.sqrt(R()) * r;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistTex(), color: o.color ?? '#b4c8be', transparent: true, opacity: (o.opacity ?? 0.32) * rr(0.6, 1), depthWrite: false, fog: true }));
      const s = (o.size ?? 9) * rr(0.7, 1.4);
      sp.scale.set(s, s * 0.45, 1);
      const bx = x + Math.cos(a) * d, bz = z + Math.sin(a) * d, by = (o.y ?? 0.9) + rr(-0.3, 0.6);
      sp.position.set(bx, by, bz);
      sp.renderOrder = 4;
      noOutline(sp);
      L.scene.add(sp);
      this.mist.push(sp);
      const ph = R() * TAU, sp2 = rr(0.05, 0.12);
      this.ticks.push((t) => { sp.position.x = bx + Math.sin(t * sp2 + ph) * 2.2; sp.position.z = bz + Math.cos(t * sp2 * 0.7 + ph) * 1.4; });
    }
  }

  /** a far silhouette on the horizon (fog-free, like the moon): Замок Полночь on its rock */
  castle(dir: THREE.Vector3) {
    const L = this.L;
    const g = new THREE.Group();
    const m = basic('#1a0c20', { fog: false });
    const rock = new THREE.Mesh(new THREE.ConeGeometry(30, 70, 7), m); rock.position.y = -10; g.add(rock);
    const keep = new THREE.Mesh(new THREE.BoxGeometry(18, 26, 12), m); keep.position.y = 34; g.add(keep);
    for (const [px, h] of [[-12, 40], [12, 46], [0, 58], [-20, 30], [20, 34]] as const) {
      const tw = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, h, 8), m); tw.position.set(px, 20 + h / 2, 0); g.add(tw);
      const sp = new THREE.Mesh(new THREE.ConeGeometry(4.2, 12, 8), m); sp.position.set(px, 20 + h + 6, 0); g.add(sp);
    }
    for (let i = 0; i < 6; i++) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.2), basic('#ff5a4a', { fog: false })); w.position.set(-14 + i * 5.6, 30 + (i % 3) * 8, 6.2); g.add(w); }
    g.renderOrder = -990;
    g.traverse((o) => { o.renderOrder = -990; (o as THREE.Mesh).frustumCulled = false; });
    noOutline(g);
    g.scale.setScalar(0.7);
    L.scene.add(g);
    const d = dir.clone().setY(0).normalize();
    this.ticks.push(() => {
      const c = L.tcam.cam.position;
      g.position.set(c.x + d.x * 420, c.y - 32, c.z + d.z * 420);
      g.lookAt(c.x, g.position.y, c.z);
    });
  }

  /** finish the build: instanced meshes for all the small repeated things */
  finish() {
    for (const [, i] of this.inst) {
      const im = new THREE.InstancedMesh(i.geo, i.mat, i.list.length);
      i.list.forEach((m, k) => im.setMatrixAt(k, m));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = i.cast; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.L.scene.add(im);
    }
    this.inst.clear();
  }

  update(dt: number) {
    this.t += dt;
    const L = this.L;
    for (const f of this.ticks) f(this.t, dt);
    for (const r of this.rafts) r.update(L, dt);
    for (const s of this.sinkers) s.update(L, dt);
    for (const s of this.swarms) s.update(dt);
    if (this.moonPath) {
      const c = L.tcam.cam.position;
      const md = L.def.sun.dir;
      const dx = md[0], dz = md[2], l = Math.hypot(dx, dz) || 1;
      this.moonPath.position.set(c.x + (dx / l) * 45, 0.04, c.z + (dz / l) * 45);
      this.moonPath.rotation.y = Math.atan2(dx, dz);
      this.moonPath.scale.set(10, 1, 70);
    }
  }
}

// ═════════════════════════════ MOVING BITS ═════════════════════════════

/** a rotten plank floating on the bog: someone stands on it → it wobbles, sinks, comes back up a few seconds later */
export class SinkPlank {
  col: BoxCol;
  mesh: THREE.Mesh;
  private st: 'up' | 'wobble' | 'down' | 'under' | 'rise' = 'up';
  private t = 0;
  private dy = 0;
  private base: number;
  constructor(private kit: SwampKit, readonly x: number, readonly z: number, readonly w: number, readonly d: number, readonly top = 0.75) {
    const L = kit.L;
    this.base = top;
    this.mesh = new THREE.Mesh(boxTiled(w, 0.3, d, 2.4, true), matU('#8a8070', { map: kit.planks.map }));
    this.mesh.position.set(x, top - 0.15, z);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    L.scene.add(this.mesh);
    this.col = { kind: 'box', min: new THREE.Vector3(x - w / 2, top - 0.3, z - d / 2), max: new THREE.Vector3(x + w / 2, top, z + d / 2), obj: this.mesh, tag: 'moving' };
    L.col(this.col);
    kit.sinkers.push(this);
  }
  private stoodOn(L: Level3D) {
    if (L.player.body.ground === this.col && !L.player.dead) return true;
    for (const h of L.heroes()) {
      if (h.isLocal || h.dead || h.hidden) continue;
      if (Math.abs(h.pos.x - this.x) < this.w / 2 + 0.1 && Math.abs(h.pos.z - this.z) < this.d / 2 + 0.1 && Math.abs(h.pos.y - (this.base + this.dy)) < 0.35) return true;
    }
    return false;
  }
  update(L: Level3D, dt: number) {
    this.t += dt;
    switch (this.st) {
      case 'up': if (this.stoodOn(L)) { this.st = 'wobble'; this.t = 0; ambient(L, () => audio.sfx('crumble', { pitch: 0.6, volume: 0.4 })); L.hint('fangs2planks', TOASTS.planks); } break;
      case 'wobble': if (this.t > 0.45) { this.st = 'down'; this.t = 0; } break;
      case 'down': this.dy = Math.max(-1.1, this.dy - dt * 1.4); if (this.dy <= -1.1) { this.st = 'under'; this.t = 0; } break;
      case 'under': if (this.t > 2.4) { this.st = 'rise'; this.t = 0; } break;
      case 'rise': this.dy = Math.min(0, this.dy + dt * 1.2); if (this.dy >= 0) { this.st = 'up'; this.t = 0; } break;
    }
    const wob = this.st === 'wobble' ? Math.sin(this.t * 40) * 0.05 : 0;
    const y = this.base + this.dy;
    this.mesh.position.y = y - 0.15 + Math.sin(L.t * 1.3 + this.x) * 0.02;
    this.mesh.rotation.z = wob + (this.st === 'down' ? 0.08 : 0);
    this.col.min.y = y - 0.3; this.col.max.y = y;
    this.col.active = this.st !== 'under';
    if (this.st === 'down' && Math.random() < 0.3) ambient(L, () => L.fx.emit(v1.set(this.x, 0.05, this.z).clone(), { count: 1, speed: [0.3, 1], dir: new THREE.Vector3(0, 1, 0), spread: 0.6, life: [0.3, 0.6], size: [0.08, 0.14], colors: ['#7aa890', '#c8e0d0'], g: 4 }));
  }
}

/**
 * A raft that moves by the room's clock: shuttles between the ends of `path` (dwell s at each end, travel s between).
 * Every machine computes the same spot at the same moment; each carries its own hero when he stands on it.
 */
export class Raft {
  col: CylCol;
  obj = new THREE.Group();
  pos = new THREE.Vector3();
  private last = new THREE.Vector3();
  private first = true;
  kamysh: SimpleRig | null = null;
  /** 0..1 progress A→B (for barks), + docked at A / B */
  phase: 'A' | 'B' | 'go' | 'back' = 'A';
  private barkObj = new THREE.Object3D();
  constructor(private kit: SwampKit, readonly path: THREE.Vector3[], readonly o: { r: number; top: number; dwell: number; travel: number; offset?: number; ferry?: boolean; bob?: number }) {
    const L = kit.L;
    const boat = createLilyBoat(o.r);
    this.obj.add(boat);
    boat.position.y = -0.24;
    if (o.ferry) {
      const k = createKamysh();
      k.root.position.set(-o.r * 0.45, 0, -o.r * 0.3);
      k.root.rotation.y = Math.PI / 2;
      this.obj.add(k.root);
      markCharacter(k.root);
      this.kamysh = k;
      // his lantern: a warm (empty) glow
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ffcf70', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.25 }));
      sp.scale.setScalar(1.2); sp.position.set(-o.r * 0.45 + 0.6, 2.1, -o.r * 0.3 + 0.1); noOutline(sp); this.obj.add(sp);
    }
    this.barkObj.position.set(-o.r * 0.45, 1.0, -o.r * 0.3);
    this.obj.add(this.barkObj);
    L.scene.add(this.obj);
    this.col = { kind: 'cyl', x: path[0].x, z: path[0].z, r: o.r * 0.95, y0: o.top - 0.5, y1: o.top, tag: 'moving' };
    L.col(this.col);
    kit.rafts.push(this);
    this.place(swampClock(L));
  }
  get period() { return 2 * (this.o.dwell + this.o.travel); }
  /** where the raft is at room time t */
  at(t: number, out: THREE.Vector3) {
    const { dwell, travel } = this.o;
    const per = this.period;
    let u = ((t + (this.o.offset ?? 0)) % per + per) % per;
    let k: number;
    if (u < dwell) { k = 0; this.phase = 'A'; }
    else if ((u -= dwell) < travel) { k = smoothK(u / travel); this.phase = 'go'; }
    else if ((u -= travel) < dwell) { k = 1; this.phase = 'B'; }
    else { u -= dwell; k = 1 - smoothK(u / travel); this.phase = 'back'; }
    // along the polyline
    const p = this.path;
    let total = 0;
    for (let i = 1; i < p.length; i++) total += p[i].distanceTo(p[i - 1]);
    let s = k * total;
    for (let i = 1; i < p.length; i++) {
      const l = p[i].distanceTo(p[i - 1]);
      if (s <= l || i === p.length - 1) return out.copy(p[i - 1]).lerp(p[i], l > 0 ? clamp(s / l, 0, 1) : 0);
      s -= l;
    }
    return out.copy(p[p.length - 1]);
  }
  private place(t: number) {
    this.at(t, this.pos);
    this.obj.position.set(this.pos.x, this.o.top - 0.12 + Math.sin(t * 1.7) * (this.o.bob ?? 0.03), this.pos.z);
    this.col.x = this.pos.x; this.col.z = this.pos.z;
  }
  update(L: Level3D, dt: number) {
    this.last.copy(this.pos);
    const ph = this.phase;
    this.place(swampClock(L));
    if (this.first) { this.first = false; this.last.copy(this.pos); }
    const dx = this.pos.x - this.last.x, dz = this.pos.z - this.last.z;
    // carry my hero
    const b = L.player.body;
    if (b.ground === this.col && !L.player.dead && Math.hypot(dx, dz) < 1) { b.pos.x += dx; b.pos.z += dz; }
    if (Math.hypot(dx, dz) > 0.001) {
      this.obj.rotation.y = damp(this.obj.rotation.y, Math.atan2(dx, dz), 2, dt);
      if (Math.random() < 0.25) ambient(L, () => L.fx.emit(this.pos.clone().setY(0.08), { count: 1, speed: [0.2, 0.6], life: [0.5, 1], size: [0.12, 0.22], colors: ['#9ab8a8', '#d8e8e0'], drag: 2 }));
    }
    this.kamysh?.update(dt, 0, this.phase === 'go' || this.phase === 'back' ? 'pole' : 'idle');
    // Камыш calls out as he pushes off (local: every machine sees the same raft at the same moment)
    if (this.o.ferry && ph !== this.phase && (this.phase === 'go' || this.phase === 'back')) {
      const near = L.player.pos.distanceTo(this.pos) < 16;
      if (near) ambient(L, () => L.bark(this.barkObj, FERRY_LINES[Math.floor(swampClock(L) / 30) % FERRY_LINES.length], 1.6, 0.6));
    }
  }
}
const FERRY_LINES = ['Ква! Отчаливаем!', 'Держитесь за стебель!', 'Не раскачивайте кувшинку!'];
const smoothK = (k: number) => k * k * (3 - 2 * k);
/** the radius of a freed swarm's light (the plugin hides the kit's sun-orb over these: the swarm is the light) */
export const FIREFLY_LIGHT_R = 3.4;

// ───────────────────────── fireflies ─────────────────────────

/** a swarm of warm blinking fireflies around a point (Points, additive; each one blinks on its own) */
export class FireflySwarm {
  points: THREE.Points;
  private base: Float32Array;
  private col: Float32Array;
  private ph: Float32Array;
  private k = 0;
  /** 0..1 how many are lit (they arrive / fade in) */
  target = 1;
  center: THREE.Vector3;
  constructor(L: Level3D, center: THREE.Vector3, readonly r: number, readonly n: number, o: { height?: number; color?: string; on?: boolean; size?: number } = {}) {
    this.center = center.clone();
    const pos = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.ph = new Float32Array(n * 2);
    const h = o.height ?? 1.6;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * r;
      this.base[i * 3] = Math.cos(a) * d; this.base[i * 3 + 1] = Math.random() * h + 0.3; this.base[i * 3 + 2] = Math.sin(a) * d;
      this.ph[i * 2] = Math.random() * TAU; this.ph[i * 2 + 1] = 0.6 + Math.random() * 1.6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.PointsMaterial({ size: o.size ?? 0.42, map: glowTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, color: o.color ?? '#ffe36a' });
    this.points = new THREE.Points(g, m);
    this.points.position.copy(center);
    this.points.frustumCulled = false;
    noOutline(this.points);
    L.scene.add(this.points);
    this.k = o.on === false ? 0 : 1;
    this.target = this.k;
    (L.refs.swamp as SwampKit | undefined)?.swarms.push(this);
  }
  private t = Math.random() * 10;
  update(dt: number) {
    this.t += dt;
    this.k = damp(this.k, this.target, 1.5, dt);
    const p = (this.points.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      const a = this.ph[i * 2], s = this.ph[i * 2 + 1];
      p[i * 3] = this.base[i * 3] + Math.sin(this.t * 0.7 * s + a) * 0.5;
      p[i * 3 + 1] = this.base[i * 3 + 1] + Math.sin(this.t * 1.1 * s + a * 2) * 0.25;
      p[i * 3 + 2] = this.base[i * 3 + 2] + Math.cos(this.t * 0.6 * s + a) * 0.5;
      // a firefly blinks: mostly glowing, a quick dark-bright pulse now and then
      const blink = 0.35 + 0.65 * Math.max(0, Math.sin(this.t * s * 1.7 + a)) ** 2;
      const lit = (i / this.n) < this.k ? 1 : 0;
      const c = blink * lit;
      this.col[i * 3] = c; this.col[i * 3 + 1] = c * 0.92; this.col[i * 3 + 2] = c * 0.55;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
  moveTo(c: THREE.Vector3) { this.center.copy(c); this.points.position.copy(c); }
}

/**
 * A jar of caught fireflies on a hook post. A hit (sword, paw, axe, flask, pea) breaks it — the host decides; then
 * the fireflies fly off along `trail` and stay there, lighting the way («солнышко»-light: vampires keep out for a while).
 * Stays broken across respawns (L.seen).
 */
export class FireflyJar implements Netted, Hittable3 {
  netId = 0;
  dead = false;
  broken = false;
  readonly pos: THREE.Vector3;
  private jar = new THREE.Group();
  private inside: FireflySwarm;
  private flying: { sw: FireflySwarm; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number }[] = [];
  private shake = 0;
  constructor(private kit: SwampKit, x: number, y: number, z: number, readonly trail: THREE.Vector3[], private key: string) {
    const L = kit.L;
    this.pos = new THREE.Vector3(x, y, z);
    // the post with a hook
    const post = new THREE.Mesh(G.cyl(), kit.bark); post.position.set(x, y + 1.15, z); post.scale.set(0.09, 2.3, 0.09); post.castShadow = true; L.scene.add(post);
    const arm = new THREE.Mesh(G.cyl(), kit.bark); arm.position.set(x + 0.35, y + 2.25, z); arm.scale.set(0.05, 0.75, 0.05); arm.rotation.z = Math.PI / 2; L.scene.add(arm);
    L.col({ kind: 'cyl', x, z, r: 0.12, y0: y, y1: y + 2.3 });
    // the jar hanging from it
    this.jar.position.set(x + 0.65, y + 1.55, z);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.24, 0.55, 14), matU('#cfe8e0', { transparent: true, opacity: 0.4 }));
    glass.castShadow = false; this.jar.add(glass);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.08, 14), mat('#6a5a3a')); lid.position.y = 0.31; this.jar.add(lid);
    const rope = new THREE.Mesh(G.cyl(), mat('#b8955e')); rope.position.y = 0.52; rope.scale.set(0.015, 0.4, 0.015); this.jar.add(rope);
    const dim = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ffd860', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35 }));
    dim.scale.setScalar(0.9); noOutline(dim); this.jar.add(dim);
    noOutline(glass);
    L.scene.add(this.jar);
    this.inside = new FireflySwarm(L, this.jar.position.clone().setY(this.jar.position.y - 0.35), 0.14, 7, { height: 0.35, size: 0.22 });
    L.hittables.push(this);
    if (L.building) L.nl?.add(this);
    if (L.seen.has(key)) this.release(L, true);
  }
  netSnap() { return [this.broken ? 1 : 0]; }
  netApply(a: number[]) { if (a[0] && !this.broken) this.release(this.kit.L, false); }
  private near(c: THREE.Vector3, range: number) { const j = this.jar.position; return Math.hypot(c.x - j.x, c.z - j.z) < range + 0.5 && c.y > j.y - 1.8 && c.y < j.y + 1.2; }
  predictHit(_L: Level3D, c: THREE.Vector3, range: number) { return !this.broken && this.near(c, range); }
  meleeHit(L: Level3D, c: THREE.Vector3, _dir: THREE.Vector3, range: number): boolean {
    if (this.broken || !this.near(c, range)) return false;
    if (L.authority) this.release(L, false);
    return true;
  }
  shotHit(L: Level3D, s: Shot3): boolean {
    if (this.broken || s.pos.distanceTo(this.jar.position) > 0.6) return false;
    if (L.authority) this.release(L, false);
    return true;
  }
  /** the jar breaks: fireflies out (every machine; the host's snapshot tells the clients) */
  release(L: Level3D, quiet: boolean) {
    if (this.broken) return;
    this.broken = true;
    L.seen.add(this.key);
    this.jar.visible = false;
    this.inside.points.visible = false;
    const j = this.jar.position.clone();
    if (!quiet) {
      ambient(L, () => {
        audio.sfx('break', { pitch: 1.5, volume: 0.6 });
        L.fx.sparks(j.clone(), 14, ['#e8f8ff', '#ffffff', '#cfe8e0']);
        L.fx.stars(j.clone(), 16, ['#ffe36a', '#fff6c0']);
        L.bark(this.inside.points, FIREFLY[Math.abs(Math.round(j.x * 3 + j.z)) % FIREFLY.length], 1.6, 0.8);
      });
      L.hint('fangs2jar', TOASTS.jar);
    }
    // a swarm flies to every point of the trail and settles there
    this.trail.forEach((to, i) => {
      const sw = new FireflySwarm(L, quiet ? to : j, 1.6, 22, { height: 2 });
      this.flying.push({ sw, from: j.clone(), to: to.clone(), t: quiet ? 99 : -i * 0.35, dur: 1.2 + j.distanceTo(to) / 9 });
      if (L.authority) vamp(L).light(to.clone().setY(to.y), { r: FIREFLY_LIGHT_R, secs: 60 });
    });
    const kit = this.kit;
    kit.L.updaters.push((_t, dt) => this.fly(dt));
  }
  private fly(dt: number) {
    for (const f of this.flying) {
      if (f.t >= f.dur) continue;
      f.t += dt;
      const k = clamp(f.t / f.dur, 0, 1);
      const e = k * k * (3 - 2 * k);
      v1.copy(f.from).lerp(f.to, e); v1.y += Math.sin(k * Math.PI) * 2.5;
      f.sw.moveTo(v1);
    }
  }
  update() { /* (Hittable3 only) */ }
}

/** a plank bridge that is raised (pivoting at its near end) and lowers on `lower()` */
export class Drawbridge {
  pivot = new THREE.Group();
  col: BoxCol;
  private k = 0;
  private want = 0;
  private chains: { c: THREE.Mesh; s: number }[] = [];
  private geo = { x: 0, y: 0, z0: 0, len: 1, dir: 1, w: 1 };
  constructor(kit: SwampKit, x: number, z0: number, z1: number, y: number, w = 2.4) {
    const L = kit.L;
    const len = Math.abs(z1 - z0), dir = Math.sign(z1 - z0);
    this.pivot.position.set(x, y, z0);
    const deck = new THREE.Mesh(boxTiled(w, 0.24, len, 2.4, true), kit.planks);
    deck.position.set(0, -0.12, (dir * len) / 2);
    deck.castShadow = true; deck.receiveShadow = true;
    this.pivot.add(deck);
    L.scene.add(this.pivot);
    // gate posts with a crossbar on the near side; chains from the crossbar to the bridge's far end
    const postM = kit.barkD;
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(G.cyl(), postM); post.position.set(x + s * (w / 2 + 0.25), y + 2.2, z0 - dir * 0.2); post.scale.set(0.16, 4.4, 0.16); L.scene.add(post);
      L.col({ kind: 'cyl', x: x + s * (w / 2 + 0.25), z: z0 - dir * 0.2, r: 0.18, y0: y, y1: y + 4.4 });
    }
    const bar = new THREE.Mesh(G.cyl(), postM); bar.position.set(x, y + 4.2, z0 - dir * 0.2); bar.scale.set(0.12, w + 0.9, 0.12); bar.rotation.z = Math.PI / 2; L.scene.add(bar);
    const chainM = mat('#5a5a64');
    this.chains = [-1, 1].map((s) => { const c = new THREE.Mesh(G.cyl(), chainM); c.castShadow = false; L.scene.add(c); return { c, s }; });
    this.geo = { x, y, z0, len, dir, w };
    this.col = { kind: 'box', min: new THREE.Vector3(x - w / 2, y - 0.24, Math.min(z0, z1)), max: new THREE.Vector3(x + w / 2, y, Math.max(z0, z1)), active: false };
    L.col(this.col);
    this.pivot.rotation.x = -dir * 1.0;
    L.updaters.push((_t, dt) => this.update(dt, dir));
  }
  lower(now = false) { this.want = 1; if (now) this.k = 1; }
  get down() { return this.k > 0.97; }
  private update(dt: number, dir: number) {
    this.k = damp(this.k, this.want, 1.6, dt);
    const a = 1.0 * (1 - this.k);
    this.pivot.rotation.x = -dir * a;
    this.col.active = this.k > 0.9;
    // the chains: from the crossbar to the far end of the deck
    const g = this.geo;
    for (const { c, s } of this.chains) {
      const top = v1.set(g.x + s * (g.w / 2 + 0.05), g.y + 4.2, g.z0 - g.dir * 0.2);
      const tip = new THREE.Vector3(g.x + s * (g.w / 2 - 0.1), g.y + Math.sin(a) * g.len, g.z0 + g.dir * Math.cos(a) * g.len);
      const mid = top.clone().add(tip).multiplyScalar(0.5);
      c.position.copy(mid);
      c.scale.set(0.035, top.distanceTo(tip), 0.035);
      c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip.clone().sub(top).normalize());
    }
  }
}

export type { Collider };
