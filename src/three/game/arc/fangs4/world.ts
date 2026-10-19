import * as THREE from 'three';
import { canvasTex, noOutline } from '../../../gfx';
import { boxGeo, tmat, bmat } from '../../../world/kit';
import { glowTex } from '../../../world/textures';
import { srand } from '../../../../engine/util';
import type { Level3D } from '../../level';
import type { BoxCol, CylCol } from '../../../physics/types';

/**
 * Building blocks of the mountain road (fangs4): rock slabs and cliffs (box colliders with a slate texture and a dusty
 * path on top), boulders along the edges (one instanced mesh per level), the «bones of the old world» — rusty pipes,
 * concrete posts with rebar, old road signs with missing letters — flags that show the wind, ice, a campfire.
 * Everything here is static and built identically on every machine.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

let rockT: THREE.Texture | null = null;
/** slate rock face (tiles every 4 m) */
export function rockTex() {
  if (rockT) return rockT;
  rockT = canvasTex(256, 256, (g, w, h) => {
    const R = srand(404);
    g.fillStyle = '#b8b0c4'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      // strata
      const y = R() * h, th = 3 + R() * 10, v = (150 + R() * 70) | 0;
      g.fillStyle = `rgba(${v - 10},${v - 14},${v},0.55)`;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 4 + (R() - 0.5) * 3);
      g.lineTo(w, y + th); g.lineTo(0, y + th); g.closePath(); g.fill();
    }
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(40,30,50,${0.08 + R() * 0.2})`; g.fillRect(R() * w, R() * h, 2, 2); }
    g.strokeStyle = 'rgba(50,40,60,0.45)'; g.lineWidth = 1.5;
    for (let i = 0; i < 10; i++) {
      let x = R() * w, y = R() * h; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (R() - 0.5) * 40; y += R() * 26; g.lineTo(x, y); }
      g.stroke();
    }
  }, { wrap: true });
  return rockT;
}
let pathT: THREE.Texture | null = null;
/** the dusty trail on top of the rock (pebbles, cracks) */
export function pathTex() {
  if (pathT) return pathT;
  pathT = canvasTex(256, 256, (g, w, h) => {
    const R = srand(77);
    g.fillStyle = '#c8bcc8'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) {
      const v = (170 + R() * 60) | 0;
      g.fillStyle = `rgba(${v},${v - 12},${v - 4},0.5)`;
      g.beginPath(); g.ellipse(R() * w, R() * h, 3 + R() * 9, 2 + R() * 6, R() * 3, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(60,40,60,${0.1 + R() * 0.2})`; g.fillRect(R() * w, R() * h, 2, 2); }
  }, { wrap: true });
  return pathT;
}
let concT: THREE.Texture | null = null;
/** old concrete: stains, a few cracks, panel seams */
export function concreteTex() {
  if (concT) return concT;
  concT = canvasTex(128, 128, (g, w, h) => {
    const R = srand(9);
    g.fillStyle = '#c4c0b8'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(90,80,70,${0.05 + R() * 0.12})`; g.beginPath(); g.ellipse(R() * w, R() * h, 4 + R() * 16, 3 + R() * 10, 0, 0, Math.PI * 2); g.fill(); }
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(60,55,50,${0.1 + R() * 0.2})`; g.fillRect(R() * w, R() * h, 1.5, 1.5); }
    g.strokeStyle = 'rgba(60,50,45,0.6)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(R() * w, 0); g.lineTo(R() * w, h * 0.6); g.lineTo(R() * w, h); g.stroke();
    g.fillStyle = 'rgba(120,60,30,0.35)'; g.fillRect(0, h * 0.85, w, h * 0.15);
  }, { wrap: true });
  return concT;
}
let rustT: THREE.Texture | null = null;
export function rustTex() {
  if (rustT) return rustT;
  rustT = canvasTex(128, 128, (g, w, h) => {
    const R = srand(31);
    g.fillStyle = '#8a4a28'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { const c = ['#a85a2a', '#6a3418', '#c87a3a', '#5a2a18'][Math.floor(R() * 4)]; g.fillStyle = c; g.globalAlpha = 0.5; g.beginPath(); g.ellipse(R() * w, R() * h, 2 + R() * 8, 1 + R() * 5, R() * 3, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
  }, { wrap: true });
  return rustT;
}

export const ROCK = '#6a6078', ROCK_D = '#4e4560', PATH = '#9a8ca0', ICE = '#a8d8ff';

/** the level's boulders (collected while building, one instanced draw) */
interface Spot { x: number; y: number; z: number; s: number }
const SPOTS = new WeakMap<Level3D, Spot[]>();
export function boulder(L: Level3D, x: number, y: number, z: number, s: number) { let a = SPOTS.get(L); if (!a) { a = []; SPOTS.set(L, a); } a.push({ x, y, z, s }); }
export function flushBoulders(L: Level3D) {
  const a = SPOTS.get(L);
  if (!a?.length) return;
  const R = srand(91);
  const m = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), tmat(rockTex(), '#ffffff', { flat: true }), a.length);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), mt = new THREE.Matrix4();
  const cols = [ROCK, ROCK_D, '#7a6e86', '#5a5068'].map((c) => new THREE.Color(c));
  a.forEach((t, i) => {
    e.set(R() * 6, R() * 6, R() * 6); q.setFromEuler(e);
    p.set(t.x, t.y + t.s * 0.2, t.z); s.set(t.s * (0.9 + R() * 0.5), t.s * (0.6 + R() * 0.35), t.s * (0.9 + R() * 0.4));
    mt.compose(p, q, s); m.setMatrixAt(i, mt);
    m.setColorAt(i, cols[Math.floor(R() * cols.length)].clone().multiplyScalar(0.85 + R() * 0.3));
  });
  m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
  L.deco(m);
  SPOTS.delete(L);
}

/**
 * A rock slab whose top is walkable: [x0..x1] × [z0..z1], top at `top`, `depth` deep (a cliff underneath).
 * `edges` sprinkles boulders on the rim (not on the path).
 */
export function slab(L: Level3D, x0: number, x1: number, z0: number, z1: number, top: number, o: { depth?: number; edges?: boolean; color?: string; path?: boolean; tag?: string } = {}) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), az = Math.min(z0, z1), bz = Math.max(z0, z1);
  const d = o.depth ?? 26;
  const w = bx - ax, l = bz - az;
  const side = tmat(rockTex(), o.color ?? ROCK);
  const topM = o.path === false ? side : tmat(pathTex(), PATH);
  const m = new THREE.Mesh(boxGeo(w, d, l, 4), [side, side, topM, side, side, side]);
  m.position.set((ax + bx) / 2, top - d / 2, (az + bz) / 2);
  m.castShadow = true; m.receiveShadow = true;
  L.deco(m);
  const c: BoxCol = { kind: 'box', min: V(ax, top - d, az), max: V(bx, top, bz), ...(o.tag ? { tag: o.tag } : {}) };
  L.col(c);
  if (o.edges) {
    const R = srand(Math.round(ax * 13 + az * 7));
    for (let z = az + 1; z < bz - 0.5; z += 2.5 + R() * 2) { boulder(L, ax + 0.2, top - 0.3, z, 0.5 + R() * 0.5); boulder(L, bx - 0.2, top - 0.3, z + 1, 0.5 + R() * 0.5); }
  }
  return c;
}

/** a tall rock wall (box) from y0 up to y1 */
export function cliff(L: Level3D, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, color = ROCK_D) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), az = Math.min(z0, z1), bz = Math.max(z0, z1);
  const m = new THREE.Mesh(boxGeo(bx - ax, y1 - y0, bz - az, 5), tmat(rockTex(), color));
  m.position.set((ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2);
  m.castShadow = true; m.receiveShadow = true;
  L.deco(m);
  const c: BoxCol = { kind: 'box', min: V(ax, y0, az), max: V(bx, y1, bz) };
  L.col(c);
  return c;
}

/** an invisible blocker */
export function wall(L: Level3D, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tag?: string) {
  const c: BoxCol = { kind: 'box', min: V(Math.min(x0, x1), y0, Math.min(z0, z1)), max: V(Math.max(x0, x1), y1, Math.max(z0, z1)), ...(tag ? { tag } : {}) };
  L.col(c);
  return c;
}

/** a rusty pipe from a to b (decor; `solid` adds a box collider when it lies along X or Z) */
export function pipe(L: Level3D, a: THREE.Vector3, b: THREE.Vector3, r: number, solid = false) {
  const len = a.distanceTo(b);
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14, 1, true), tmat(rustTex(), '#ffffff', { side: THREE.DoubleSide }));
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(r * 0.92, 14), bmat('#120a10'));
  inner.rotation.x = -Math.PI / 2; inner.position.y = len / 2 - 0.02; noOutline(inner); g.add(inner);
  for (const k of [-0.5, -0.15, 0.25]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.04, r * 0.09, 6, 16), tmat(null, '#6a3418'));
    ring.rotation.x = Math.PI / 2; ring.position.y = len * k; g.add(ring);
  }
  g.position.copy(a).lerp(b, 0.5);
  g.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  L.deco(g);
  if (solid) {
    const min = V(Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.min(a.z, b.z) - r), max = V(Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, Math.max(a.z, b.z) + r);
    L.col({ kind: 'box', min, max });
  }
  return g;
}

/** an old concrete post / block with rebar sticking out (solid) */
export function concrete(L: Level3D, x: number, y: number, z: number, w: number, h: number, d: number, o: { rebar?: boolean; tilt?: number; solid?: boolean } = {}) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(boxGeo(w, h, d, 2), tmat(concreteTex(), '#ffffff'));
  m.position.y = h / 2; m.castShadow = true; m.receiveShadow = true; g.add(m);
  if (o.rebar !== false) {
    const R = srand(Math.round(x * 31 + z * 17));
    const rebar = tmat(null, '#6a3a22');
    for (let i = 0; i < 3; i++) {
      const rb = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6 + R() * 0.8, 5), rebar);
      rb.position.set((R() - 0.5) * w * 0.7, h + 0.3, (R() - 0.5) * d * 0.7);
      rb.rotation.set((R() - 0.5) * 0.8, 0, (R() - 0.5) * 0.8);
      g.add(rb);
    }
  }
  g.position.set(x, y, z);
  if (o.tilt) g.rotation.z = o.tilt;
  L.deco(g);
  if (o.solid !== false) L.col({ kind: 'box', min: V(x - w / 2, y, z - d / 2), max: V(x + w / 2, y + h, z + d / 2) });
  return g;
}

/** an old-world road sign on a rusty post (blue plate, white letters — some fell off) + the sign tooltip */
export function roadSign(L: Level3D, x: number, y: number, z: number, label: string, tooltip: string, rotY = 0, o: { w?: number; color?: string } = {}) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8), tmat(rustTex(), '#ffffff'));
  post.position.y = 1.2; post.castShadow = true; g.add(post);
  const w = o.w ?? Math.max(1.4, label.length * 0.22);
  const tex = canvasTex(Math.round(w * 96), 96, (c, cw, ch) => {
    c.fillStyle = o.color ?? '#2e5aa8'; c.fillRect(0, 0, cw, ch);
    c.strokeStyle = '#ffffff'; c.lineWidth = 5; c.strokeRect(6, 6, cw - 12, ch - 12);
    c.fillStyle = 'rgba(120,60,30,0.45)';
    for (let i = 0; i < 6; i++) c.fillRect(Math.random() * cw, Math.random() * ch, 8 + Math.random() * 18, 6 + Math.random() * 10);
    c.fillStyle = '#ffffff'; c.font = '700 44px Rubik, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(label, cw / 2, ch / 2 + 2);
  });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.75), tmat(tex, '#ffffff', { side: THREE.DoubleSide }));
  plate.position.set(0, 2.2, 0.07); plate.rotation.z = (Math.random() - 0.5) * 0.12;
  g.add(plate);
  g.position.set(x, y, z); g.rotation.y = rotY;
  L.deco(g);
  L.signAt(x, y, z, tooltip);
  return g;
}

/** a tattered flag on a pole: shows the wind (returns a setter: 0 limp … 1 straight out, t = time) */
export function windFlag(L: Level3D, x: number, y: number, z: number, color = '#c83a5a') {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 3.2, 6), tmat(rustTex(), '#ffffff'));
  pole.position.y = 1.6; g.add(pole);
  const geo = new THREE.PlaneGeometry(1.4, 0.7, 8, 2);
  geo.translate(0.7, 0, 0);
  const base = (geo.attributes.position.array as Float32Array).slice();
  const cloth = new THREE.Mesh(geo, tmat(null, color, { side: THREE.DoubleSide }));
  cloth.position.y = 2.8; g.add(cloth);
  g.position.set(x, y, z);
  L.deco(g);
  return (k: number, t: number, dirYaw: number) => {
    cloth.rotation.y = dirYaw;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3], by = base[i * 3 + 1];
      const u = bx / 1.4;
      const droop = (1 - k) * 0.9;
      pos.setXYZ(i, bx * (1 - droop * 0.5), by - u * droop * 0.6, Math.sin(t * (6 + k * 14) - u * 5) * u * (0.12 + k * 0.25));
    }
    pos.needsUpdate = true;
  };
}

/** translucent ice (frozen waterfall pieces) */
export function iceMat(op = 0.75) { return tmat(null, ICE, { transparent: true, opacity: op, emissive: '#4a8ac8', emissiveIntensity: 0.35 }); }

/** a solid ice block (walkable) */
export function iceBlock(L: Level3D, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) {
  const m = new THREE.Mesh(boxGeo(x1 - x0, y1 - y0, z1 - z0), iceMat(0.85));
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = true; m.receiveShadow = true;
  L.deco(m);
  L.col({ kind: 'box', min: V(Math.min(x0, x1), y0, Math.min(z0, z1)), max: V(Math.max(x0, x1), y1, Math.max(z0, z1)) });
}

/** a frozen waterfall hanging on a wall (decor): icicle columns from y0 to y1 around x, z */
export function frozenFall(L: Level3D, x: number, z: number, y0: number, y1: number, width: number) {
  const R = srand(Math.round(x * 3 + z));
  const g = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const h = (y1 - y0) * (0.55 + R() * 0.45), r = 0.6 + R() * 1.1;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r, h, 7), iceMat(0.6 + R() * 0.25));
    c.position.set((R() - 0.5) * width, y1 - h / 2, (R() - 0.5) * 1.6);
    g.add(c);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(r * 0.6, 1.4, 7), iceMat(0.7));
    tip.rotation.x = Math.PI; tip.position.set(c.position.x, y1 - h - 0.7, c.position.z);
    g.add(tip);
  }
  g.position.set(x, 0, z);
  noOutline(g);
  L.deco(g);
}

export interface Campfire { root: THREE.Group; light: THREE.PointLight; lit: boolean; set(on: boolean): void }
/** a ring of stones, logs and a fire (off until set(true)); its PointLight is made now (light count never changes) */
export function campfire(L: Level3D, x: number, y: number, z: number): Campfire {
  const root = new THREE.Group();
  root.position.set(x, y, z);
  const stone = tmat(rockTex(), ROCK);
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), stone); s.position.set(Math.cos(a) * 0.75, 0.12, Math.sin(a) * 0.75); s.castShadow = true; root.add(s); }
  const wood = tmat(null, '#7a4a2c');
  for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 1.1, 6), wood); l.rotation.z = Math.PI / 2 - 0.35; l.rotation.y = (i / 4) * Math.PI * 2; l.position.y = 0.25; root.add(l); }
  const flames = new THREE.Group();
  const f1 = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.2, 8), bmat('#ff8a2a', { additive: true, opacity: 0.9 }));
  const f2 = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.8, 8), bmat('#fff0a0', { additive: true, opacity: 1 }));
  f1.position.y = 0.75; f2.position.y = 0.6; flames.add(f1, f2);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ffa040', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
  glow.scale.setScalar(4); glow.position.y = 0.8; flames.add(glow);
  noOutline(flames);
  flames.visible = false;
  root.add(flames);
  const light = new THREE.PointLight('#ffa040', 0, 16, 1.4);
  light.position.y = 1.4; root.add(light);
  L.deco(root);
  const cf: Campfire = {
    root, light, lit: false,
    set(on: boolean) { cf.lit = on; flames.visible = on; light.intensity = on ? 22 : 0; },
  };
  L.updaters.push((t) => {
    if (!cf.lit) return;
    const k = 0.85 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.07;
    f1.scale.set(1, k, 1); f2.scale.set(1, 2 - k, 1);
    light.intensity = 22 * k;
  });
  return cf;
}

/** big dark mountains around the pass (never fogged: silhouettes against the night sky) */
export function farMountains(L: Level3D, cx: number, cz: number) {
  const R = srand(5);
  const g = new THREE.Group();
  const ms = [new THREE.MeshBasicMaterial({ color: '#241630', fog: false }), new THREE.MeshBasicMaterial({ color: '#2e1c3a', fog: false }), new THREE.MeshBasicMaterial({ color: '#1c1028', fog: false })];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + R() * 0.2;
    const d = 330 + R() * 90, h = 90 + R() * 150, r = 60 + R() * 70;
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5 + Math.floor(R() * 3)), ms[i % 3]);
    c.position.set(cx + Math.cos(a) * d, h / 2 - 50, cz + Math.sin(a) * d);
    c.rotation.y = R() * 3;
    g.add(c);
    // snow caps
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.34, h * 0.28, 5), new THREE.MeshBasicMaterial({ color: '#8a7a9a', fog: false }));
    cap.position.set(c.position.x, c.position.y + h * 0.36, c.position.z); cap.rotation.y = c.rotation.y;
    g.add(cap);
  }
  g.renderOrder = -900;
  noOutline(g);
  L.deco(g);
}

export type { BoxCol, CylCol };
