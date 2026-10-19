import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { srand } from '../../../../engine/util';
import { mat, matU, basic, noOutline, canvasTex } from '../../../gfx';
import { lightBeam } from '../../../world/outdoor';
import * as O from '../../../world/outdoor';
import type { Level3D } from '../../level';

/**
 * The crystal greenhouse kit of «Стеклянная оранжерея»: iron frames with glass panes, tiled floors, lattice domes,
 * planters, giant night flowers, broken flasks, moonbeams, the hill outside and the castle on the horizon.
 * Frames / panes / floors are merged per material (a few draw calls per section); colliders are plain boxes.
 */

export const P3 = {
  iron: '#2c4a4e', ironD: '#1c3034', brass: '#c9a24a', glass: '#bfe6ff', glassEdge: '#e8f8ff',
  stone: '#8c90a8', stoneD: '#6c7088', moss: '#4f7a5a', soil: '#4a3428', terracotta: '#c0704a',
  petalV: '#7a3ac8', petalM: '#d0409a', petalB: '#3a7ad8', glowC: '#9af0ff', pollen: '#ffe27a',
} as const;

type V3 = [number, number, number];
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// ───────────────────────── merged batches ─────────────────────────
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10);
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), dv = new THREE.Vector3();

/** collects transformed geometry per material; flush() adds one mesh per material */
export class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private opts = new Map<THREE.Material, { cast: boolean; outline: boolean; order?: number }>();
  add(m: THREE.Material, g: THREE.BufferGeometry, o: { cast?: boolean; outline?: boolean; order?: number } = {}) {
    let l = this.parts.get(m);
    if (!l) { l = []; this.parts.set(m, l); this.opts.set(m, { cast: o.cast ?? true, outline: o.outline ?? true, order: o.order }); }
    l.push(g);
  }
  box(m: THREE.Material, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY = 0, o?: { cast?: boolean; outline?: boolean }) {
    m4.compose(V(cx, cy, cz), q.setFromAxisAngle(UP, rotY), sc.set(sx, sy, sz));
    this.add(m, unitBox.clone().applyMatrix4(m4), o);
  }
  /** a bar (cylinder) between two points */
  bar(m: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r: number, o?: { cast?: boolean; outline?: boolean }) {
    dv.subVectors(b, a);
    const len = dv.length();
    if (len < 1e-4) return;
    m4.compose(a.clone().add(b).multiplyScalar(0.5), q.setFromUnitVectors(UP, dv.multiplyScalar(1 / len)), sc.set(r, len, r));
    this.add(m, unitCyl.clone().applyMatrix4(m4), o);
  }
  geo(m: THREE.Material, g: THREE.BufferGeometry, at: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], s: V3 = [1, 1, 1], o?: { cast?: boolean; outline?: boolean; order?: number }) {
    m4.compose(V(...at), q.setFromEuler(new THREE.Euler(...rot)), sc.set(...s));
    this.add(m, g.clone().applyMatrix4(m4), o);
  }
  flush(L: Level3D) {
    for (const [m, list] of this.parts) {
      const o = this.opts.get(m)!;
      // (merge needs the same attribute set: drop uv-less mismatch by normalising to non-indexed with uv)
      const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
      for (const g of geos) if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      for (const g of geos) for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = o.cast; mesh.receiveShadow = true;
      if (!o.outline) noOutline(mesh);
      if (o.order !== undefined) mesh.renderOrder = o.order;
      L.deco(mesh);
    }
    this.parts.clear(); this.opts.clear();
  }
}

// ───────────────────────── materials & textures ─────────────────────────
let tilesT: THREE.Texture | null = null;
function tilesTex() {
  if (tilesT) return tilesT;
  tilesT = canvasTex(256, 256, (g, w, h) => {
    const R = srand(7);
    g.fillStyle = '#9ca0b8'; g.fillRect(0, 0, w, h);
    const n = 4, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = 0.86 + R() * 0.18;
      g.fillStyle = `rgb(${Math.round(150 * v)},${Math.round(156 * v)},${Math.round(182 * v)})`;
      g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
      if (R() < 0.35) { g.fillStyle = 'rgba(80,130,90,0.35)'; g.beginPath(); g.ellipse(i * s + R() * s, j * s + s - 4, 10 + R() * 14, 4 + R() * 3, 0, 0, Math.PI * 2); g.fill(); }
      if (R() < 0.2) { g.strokeStyle = 'rgba(40,40,60,0.45)'; g.lineWidth = 2; g.beginPath(); g.moveTo(i * s + R() * s, j * s + 4); g.lineTo(i * s + R() * s, j * s + s - 4); g.stroke(); }
    }
    g.strokeStyle = '#5a5e74'; g.lineWidth = 6;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, h); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(w, i * s); g.stroke(); }
  }, { wrap: true });
  return tilesT;
}
let grassT: THREE.Texture | null = null;
function grassTex() {
  if (grassT) return grassT;
  grassT = canvasTex(256, 256, (g, w, h) => {
    const R = srand(11);
    g.fillStyle = '#2f4a52'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { g.fillStyle = R() < 0.5 ? 'rgba(70,110,110,0.55)' : 'rgba(30,50,60,0.5)'; g.fillRect(R() * w, R() * h, 2, 5 + R() * 6); }
  }, { wrap: true });
  return grassT;
}
let pollenT: THREE.Texture | null = null;
/** a soft patch of pollen on the floor (alpha disc with specks) */
export function pollenTex() {
  if (pollenT) return pollenT;
  pollenT = canvasTex(256, 256, (g, w, h) => {
    const R = srand(5);
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,226,122,0.75)'); gr.addColorStop(0.7, 'rgba(255,214,100,0.45)'); gr.addColorStop(1, 'rgba(255,214,100,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      const a = R() * Math.PI * 2, r = Math.sqrt(R()) * w * 0.48;
      g.fillStyle = `rgba(255,${200 + Math.round(R() * 55)},120,${0.4 + R() * 0.5})`;
      g.beginPath(); g.arc(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, 1 + R() * 2.5, 0, Math.PI * 2); g.fill();
    }
  });
  return pollenT;
}

export const M = {
  iron: () => mat(P3.iron),
  ironD: () => mat(P3.ironD),
  brass: () => mat(P3.brass),
  stone: () => mat(P3.stone),
  stoneD: () => mat(P3.stoneD),
  soil: () => mat(P3.soil),
  terracotta: () => mat(P3.terracotta),
  moss: () => mat(P3.moss),
};
let glassM: THREE.MeshBasicMaterial | null = null;
/** the panes: faint cyan, unlit, never in the outline pass */
export function glassMat() {
  return (glassM ??= basic(P3.glass, { transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }));
}
let floorM: THREE.MeshToonMaterial | null = null;
function floorMat() { return (floorM ??= mat('#ffffff', { map: tilesTex() })); }

// ───────────────────────── floors & walls ─────────────────────────
/** a walkable slab (collider + tiled top); returns the collider */
export function slab(L: Level3D, B: Batch, x0: number, z0: number, x1: number, z1: number, top: number, th = 1, o: { tiles?: boolean; tag?: string; color?: string } = {}) {
  const w = x1 - x0, d = z1 - z0;
  const g = new THREE.BoxGeometry(w, th, d);
  // world-scaled uvs on the top (1 tile repeat = 4 m)
  const uv = g.attributes.uv as THREE.BufferAttribute, pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + x0 + w / 2) / 4, (pos.getZ(i) + z0 + d / 2) / 4);
  const mtl = o.tiles === false ? mat(o.color ?? P3.stoneD) : floorMat();
  B.geo(mtl, g, [(x0 + x1) / 2, top - th / 2, (z0 + z1) / 2]);
  const c = { kind: 'box' as const, min: V(x0, top - th, z0), max: V(x1, top, z1), tag: o.tag };
  L.col(c);
  return c;
}

/** a solid invisible box collider */
export function wallCol(L: Level3D, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  L.col({ kind: 'box', min: V(Math.min(x0, x1), y0, Math.min(z0, z1)), max: V(Math.max(x0, x1), y1, Math.max(z0, z1)) });
}

/**
 * A glass wall from (x0, z0) to (x1, z1) (axis-aligned) on floor y: iron posts every ~3 m, rails, panes; collider up
 * to y + h + 3 (no hopping over). Gaps (along the wall, [from, to] in m from its start) leave doorways.
 */
export function glassWall(L: Level3D, B: Batch, x0: number, z0: number, x1: number, z1: number, y: number, h: number, o: { gaps?: [number, number][]; noCol?: boolean; colH?: number } = {}) {
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const dir = alongX ? V(Math.sign(x1 - x0) || 1, 0, 0) : V(0, 0, Math.sign(z1 - z0) || 1);
  const at = (s: number) => V(x0, y, z0).addScaledVector(dir, s);
  const gaps = o.gaps ?? [];
  const inGap = (s: number) => gaps.some(([a, b]) => s > a + 0.05 && s < b - 0.05);
  const iron = M.iron(), brass = M.brass();
  // solid spans between gaps
  const spans: [number, number][] = [];
  let s0 = 0;
  for (const [a, b] of [...gaps].sort((p, r) => p[0] - r[0])) { if (a > s0) spans.push([s0, a]); s0 = Math.max(s0, b); }
  if (s0 < len) spans.push([s0, len]);
  for (const [a, b] of spans) {
    const n = Math.max(1, Math.round((b - a) / 3));
    for (let i = 0; i <= n; i++) {
      const s = a + ((b - a) * i) / n;
      const p = at(s);
      B.box(iron, p.x, y + h / 2, p.z, 0.16, h, 0.16);
      if (i < n) {
        const pa = at(s), pb = at(a + ((b - a) * (i + 1)) / n);
        const mid = pa.clone().add(pb).multiplyScalar(0.5);
        const w = pa.distanceTo(pb);
        // pane + a little arched top
        const pane = new THREE.PlaneGeometry(w - 0.16, h - 0.3);
        B.geo(glassMat(), pane, [mid.x, y + h / 2, mid.z], [0, alongX ? 0 : Math.PI / 2, 0], [1, 1, 1], { cast: false, outline: false, order: 5 });
        for (const ry of [0.12, h * 0.55, h - 0.06]) B.box(ry === h * 0.55 ? brass : iron, mid.x, y + ry, mid.z, alongX ? w : 0.1, ry === h * 0.55 ? 0.06 : 0.12, alongX ? 0.1 : w);
        // a low stone sill
        B.box(M.stoneD(), mid.x, y + 0.25, mid.z, alongX ? w : 0.4, 0.5, alongX ? 0.4 : w);
      }
    }
    if (!o.noCol) {
      const pa = at(a), pb = at(b);
      const t = 0.2;
      wallCol(L, Math.min(pa.x, pb.x) - (alongX ? 0 : t), y - 0.5, Math.min(pa.z, pb.z) - (alongX ? t : 0), Math.max(pa.x, pb.x) + (alongX ? 0 : t), y + (o.colH ?? h + 3), Math.max(pa.z, pb.z) + (alongX ? t : 0));
    }
  }
  void inGap;
}

/** a gabled glass roof over [x0, x1] × [z0, z1] (ridge along z): rafters every ~3 m, panes; visual only */
export function gableRoof(L: Level3D, B: Batch, x0: number, z0: number, x1: number, z1: number, eave: number, rise: number, o: { holes?: number[] } = {}) {
  const iron = M.iron();
  const cx = (x0 + x1) / 2, hw = (x1 - x0) / 2;
  const n = Math.max(1, Math.round((z1 - z0) / 3));
  const slope = Math.hypot(hw, rise);
  const ang = Math.atan2(rise, hw);
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    B.bar(iron, V(x0, eave, z), V(cx, eave + rise, z), 0.09);
    B.bar(iron, V(x1, eave, z), V(cx, eave + rise, z), 0.09);
    if (i < n) {
      const zm = z + (z1 - z0) / n / 2, dz = (z1 - z0) / n;
      if (o.holes?.includes(i)) continue; // a broken pane: the moon shines in
      for (const s of [-1, 1]) {
        // (a pane lying in xz, then tipped about z: up toward the ridge)
        const pane = new THREE.PlaneGeometry(slope, dz - 0.12).rotateX(-Math.PI / 2);
        B.geo(glassMat(), pane, [cx - s * hw / 2, eave + rise / 2, zm], [0, 0, s * ang], [1, 1, 1], { cast: false, outline: false, order: 5 });
      }
    }
  }
  B.bar(M.brass(), V(cx, eave + rise, z0), V(cx, eave + rise, z1), 0.12);
  for (const x of [x0, x1]) B.bar(iron, V(x, eave, z0), V(x, eave, z1), 0.1);
  void L;
}

/** a lattice dome (meridians, rings, panes); visual only */
export function latticeDome(L: Level3D, B: Batch, cx: number, cy: number, cz: number, R: number, o: { meridians?: number; rings?: number; open?: number; panes?: boolean } = {}) {
  const iron = M.iron();
  const nm = o.meridians ?? 16, nr = o.rings ?? 5;
  const open = o.open ?? 0.12; // the oculus at the top (fraction of the arc)
  const pt = (a: number, e: number) => V(cx + Math.cos(e) * Math.cos(a) * R, cy + Math.sin(e) * R, cz + Math.cos(e) * Math.sin(a) * R);
  const eTop = (Math.PI / 2) * (1 - open);
  for (let i = 0; i < nm; i++) {
    const a = (i / nm) * Math.PI * 2;
    let prev = pt(a, 0);
    for (let k = 1; k <= 8; k++) { const p = pt(a, (eTop * k) / 8); B.bar(iron, prev, p, 0.11); prev = p; }
  }
  for (let r = 0; r <= nr; r++) {
    const e = (eTop * r) / nr;
    let prev = pt(0, e);
    for (let i = 1; i <= nm * 2; i++) { const p = pt((i / (nm * 2)) * Math.PI * 2, e); B.bar(r === 0 || r === nr ? M.brass() : iron, prev, p, r === nr ? 0.14 : 0.08); prev = p; }
  }
  if (o.panes !== false) {
    const g = new THREE.SphereGeometry(R * 0.995, nm * 2, 10, 0, Math.PI * 2, Math.PI / 2 - eTop, eTop);
    B.geo(glassMat(), g, [cx, cy, cz], [0, 0, 0], [1, 1, 1], { cast: false, outline: false, order: 6 });
  }
  void L;
}

/** an arch of iron and glass over a doorway (x, z = middle; facing along z) */
export function arch(L: Level3D, B: Batch, x: number, y: number, z: number, w: number, h: number, alongX = true) {
  const iron = M.iron(), brass = M.brass();
  const r = w / 2;
  const P = (s: number, yy: number) => (alongX ? V(x + s, y + yy, z) : V(x, y + yy, z + s));
  for (const s of [-1, 1]) { B.bar(iron, P(s * r, 0), P(s * r, h - r), 0.16); B.bar(iron, P(s * (r + 0.4), 0), P(s * (r + 0.4), h - r), 0.12); }
  let prev = P(r, h - r);
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    const p = P(Math.cos(a) * r, h - r + Math.sin(a) * r);
    B.bar(brass, prev, p, 0.13);
    prev = p;
  }
  prev = P(r + 0.4, h - r);
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    const p = P(Math.cos(a) * (r + 0.4), h - r + Math.sin(a) * (r + 0.4));
    B.bar(iron, prev, p, 0.1);
    prev = p;
  }
  // a little glass star on top
  const st = new THREE.OctahedronGeometry(0.35);
  B.geo(basic('#cfefff'), st, (alongX ? [x, y + h + 0.6, z] : [x, y + h + 0.6, z]) as V3, [0, 0, 0], [1, 1.4, 1], { cast: false });
  for (const s of [-1, 1]) wallCol(L, ...(alongX ? [x + s * r - 0.2, y, z - 0.25, x + s * (r + 0.55), y + h, z + 0.25] : [x - 0.25, y, z + s * r - 0.2, x + 0.25, y + h, z + s * (r + 0.55)]) as [number, number, number, number, number, number]);
}

// ───────────────────────── planters, flowers, flasks ─────────────────────────
/** a round flowerbed: stone ring, soil; returns its top height. Walkable (collider). */
export function planter(L: Level3D, B: Batch, x: number, y: number, z: number, r: number, h = 0.6) {
  const ring = new THREE.CylinderGeometry(r, r + 0.12, h, 28, 1, true);
  B.geo(M.stoneD(), ring, [x, y + h / 2, z]);
  const rim = new THREE.TorusGeometry(r, 0.14, 8, 28);
  B.geo(M.stone(), rim, [x, y + h, z], [Math.PI / 2, 0, 0]);
  const soil = new THREE.CylinderGeometry(r - 0.05, r - 0.05, 0.1, 28);
  B.geo(M.soil(), soil, [x, y + h - 0.12, z]);
  L.col({ kind: 'cyl', x, z, r: r + 0.1, y0: y, y1: y + h });
  return y + h;
}

/** a decorative giant night flower (grey inside a grey zone until it is restored); returns its group */
export function nightFlower(L: Level3D, x: number, y: number, z: number, s = 1, petal: string = P3.petalV, seed = 1, B?: Batch): THREE.Group {
  const R = srand(seed);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const h = (2.2 + R() * 1.6) * s;
  const lean = (R() - 0.5) * 0.3;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * s, 0.12 * s, h, 8), mat('#3a7a4a'));
  stem.position.y = h / 2; stem.rotation.z = lean; stem.castShadow = true;
  g.add(stem);
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), mat('#4a9a5a'));
    leaf.scale.set(0.5 * s, 0.06 * s, 0.18 * s);
    const a = R() * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.35 * s, h * (0.2 + i * 0.2), Math.sin(a) * 0.35 * s);
    leaf.rotation.y = -a; leaf.rotation.z = 0.4;
    g.add(leaf);
  }
  const head = new THREE.Group();
  head.position.set(Math.sin(-lean) * h * 0.5, h, 0);
  head.rotation.x = 0.35 + R() * 0.3; head.rotation.y = R() * Math.PI * 2;
  const pm = mat(petal), pm2 = mat(new THREE.Color(petal).lerp(new THREE.Color('#ffffff'), 0.25));
  const n = 6;
  for (let i = 0; i < n; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), i % 2 ? pm : pm2);
    const a = (i / n) * Math.PI * 2;
    p.scale.set(0.34 * s, 0.07 * s, 0.75 * s);
    p.position.set(Math.cos(a) * 0.55 * s, 0.1 * s, Math.sin(a) * 0.55 * s);
    p.rotation.y = -a + Math.PI / 2; p.rotation.x = -0.5;
    p.castShadow = true;
    head.add(p);
  }
  const c = new THREE.Mesh(new THREE.SphereGeometry(0.22 * s, 12, 8), mat('#ffe27a', { emissive: '#ffb020', emissiveIntensity: 0.5 }));
  c.position.y = 0.15 * s;
  head.add(c);
  g.add(head);
  if (B) bake(B, g); else L.deco(g);
  return g;
}

/** put a built group's meshes into a batch (world transforms baked in) instead of the scene: fewer draw calls */
export function bake(B: Batch, g: THREE.Object3D) {
  g.updateMatrixWorld(true);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    B.add(m.material, m.geometry.clone().applyMatrix4(m.matrixWorld), { cast: m.castShadow });
  });
}

/** a little scatter of grey flowers in a bed (visual) */
export function bedFlowers(L: Level3D, x: number, y: number, z: number, r: number, n: number, seed = 3, B?: Batch) {
  const R = srand(seed);
  const cols = [P3.petalM, P3.petalV, '#ff8a3a', '#ffd34a', P3.petalB];
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, d = Math.sqrt(R()) * (r - 0.3);
    const h = 0.35 + R() * 0.5;
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, h, 5), mat('#3a8a4a'));
    st.position.set(x + Math.cos(a) * d, y + h / 2, z + Math.sin(a) * d);
    g.add(st);
    const bl = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), mat(cols[i % cols.length]));
    bl.scale.set(0.16, 0.1, 0.16);
    bl.position.set(st.position.x, y + h + 0.04, st.position.z);
    g.add(bl);
  }
  if (B) bake(B, g); else L.deco(g);
  return g;
}

/** a lab table with alembics, flasks and tubes (decor; the table top is walkable) */
export function flaskTable(L: Level3D, B: Batch, x: number, y: number, z: number, rotY = 0, seed = 1) {
  const R = srand(seed);
  const w = 2.6, d = 1.1, h = 1.0;
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const P = (u: number, yy: number, v: number) => V(x + u * c + v * s, y + yy, z - u * s + v * c);
  B.box(mat('#6a4a3a'), x, y + h - 0.05, z, w, 0.1, d, rotY);
  for (const u of [-1, 1]) for (const v of [-1, 1]) { const p = P(u * (w / 2 - 0.12), 0, v * (d / 2 - 0.12)); B.box(M.ironD(), p.x, y + h / 2, p.z, 0.08, h, 0.08); }
  const cols = ['#9af0ff', '#ff8ad8', '#c8ff8a', '#ffd34a'];
  for (let i = 0; i < 4; i++) {
    const u = -w / 2 + 0.4 + i * 0.6 + (R() - 0.5) * 0.15;
    const p = P(u, h, (R() - 0.5) * 0.4);
    const fr = 0.13 + R() * 0.08;
    const bulb = new THREE.SphereGeometry(fr, 12, 10);
    B.geo(glassMat(), bulb, [p.x, p.y + fr, p.z], [0, 0, 0], [1, 1, 1], { cast: false, outline: false, order: 7 });
    const neck = new THREE.CylinderGeometry(0.035, 0.04, 0.28, 8);
    B.geo(glassMat(), neck, [p.x, p.y + fr * 2 + 0.12, p.z], [0, 0, 0], [1, 1, 1], { cast: false, outline: false, order: 7 });
    const liq = new THREE.SphereGeometry(fr * 0.8, 10, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    B.geo(basic(cols[i], { transparent: true, opacity: 0.8 }), liq, [p.x, p.y + fr, p.z], [0, 0, 0], [1, 1, 1], { cast: false, outline: false });
  }
  L.col({ kind: 'box', min: V(x - (Math.abs(c) * w + Math.abs(s) * d) / 2, y, z - (Math.abs(s) * w + Math.abs(c) * d) / 2), max: V(x + (Math.abs(c) * w + Math.abs(s) * d) / 2, y + h, z + (Math.abs(s) * w + Math.abs(c) * d) / 2) });
}

/** broken glass and flask shards at the bottom of a pit (decor) */
export function shards(L: Level3D, B: Batch, x0: number, z0: number, x1: number, z1: number, y: number, seed = 9) {
  const R = srand(seed);
  const gm = basic('#bfe6ff', { transparent: true, opacity: 0.55 });
  const n = Math.round(((x1 - x0) * (z1 - z0)) / 6);
  for (let i = 0; i < n; i++) {
    const t = new THREE.TetrahedronGeometry(0.3 + R() * 0.5);
    B.geo(gm, t, [x0 + R() * (x1 - x0), y + 0.2, z0 + R() * (z1 - z0)], [R() * 3, R() * 3, R() * 3], [0.6, 1.6, 0.4], { cast: false, outline: false });
  }
  B.box(mat('#202438'), (x0 + x1) / 2, y - 0.5, (z0 + z1) / 2, x1 - x0, 1, z1 - z0);
}

/** railing along a walkway edge (visual; the collider is low and solid) */
export function railing(L: Level3D, B: Batch, x0: number, z0: number, x1: number, z1: number, y: number, h = 1.0) {
  const iron = M.iron();
  const a = V(x0, y, z0), b = V(x1, y, z1);
  const len = a.distanceTo(b);
  const n = Math.max(1, Math.round(len / 1.5));
  for (let i = 0; i <= n; i++) { const p = a.clone().lerp(b, i / n); B.bar(iron, p, p.clone().setY(y + h), 0.04); }
  B.bar(M.brass(), a.clone().setY(y + h), b.clone().setY(y + h), 0.05);
  B.bar(iron, a.clone().setY(y + h * 0.5), b.clone().setY(y + h * 0.5), 0.03);
  wallCol(L, Math.min(x0, x1) - 0.08, y, Math.min(z0, z1) - 0.08, Math.max(x0, x1) + 0.08, y + h, Math.max(z0, z1) + 0.08);
}

/** a pollen patch on the floor (decal) */
export function pollenPatch(L: Level3D, x: number, y: number, z: number, r: number, opacity = 1) {
  // (lit: the pollen dims with the dome when Шёпот darkens it)
  const pm = matU('#ffffff', { map: pollenTex(), transparent: true, opacity, emissive: '#5a4a10', emissiveIntensity: 0.6 });
  pm.depthWrite = false; pm.polygonOffset = true; pm.polygonOffsetFactor = -2;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * r, 2 * r).rotateX(-Math.PI / 2), pm);
  m.receiveShadow = true;
  m.position.set(x, y + 0.03, z);
  m.renderOrder = 1;
  noOutline(m);
  L.deco(m);
  return m;
}

/** a column of moonlight falling through the glass (visual) */
export function moonBeam(L: Level3D, x: number, y0: number, z: number, y1: number, r = 0.8) {
  const b = lightBeam(r * 0.8, r, y1 - y0, '#cfe0ff', 0.32);
  b.mesh.position.set(x, (y0 + y1) / 2, z);
  L.deco(b.mesh);
  return b;
}

/** the hill outside, the distant ridges and the black castle on its rock (the ending's last shot looks at it) */
export function outside(L: Level3D, castleAt: THREE.Vector3) {
  const ground = new THREE.Mesh(new THREE.CircleGeometry(260, 56).rotateX(-Math.PI / 2), mat('#ffffff', { map: grassTex() }));
  const uv = ground.geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 40, uv.getY(i) * 40);
  const t = (ground.material as THREE.MeshToonMaterial).map!;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  ground.position.set(0, -0.08, -40);
  ground.receiveShadow = true;
  L.deco(ground);
  L.deco(O.hillRings([
    { r: 190, base: -10, amp: 14, seed: 41, color: '#1e2240', rim: '#4a4a7a', haze: '#2a2448', bumps: 3, seg: 700 },
    { r: 260, base: -4, amp: 26, seed: 42, color: '#191a34', rim: '#3a3a64', haze: '#261e40', seg: 600 },
    { r: 360, base: 6, amp: 46, seed: 43, color: '#141428', rim: '#30305a', haze: '#221a38', seg: 512, notch: 0.2 },
  ], 0.4, '#2a2a5a'));
  // the castle on the horizon: a rock, towers, a lit window
  const g = new THREE.Group();
  const dark = basic('#100c1c', { fog: false }), dark2 = basic('#1a1428', { fog: false });
  const rock = new THREE.Mesh(new THREE.ConeGeometry(26, 60, 7), dark2); rock.position.y = 10; g.add(rock);
  for (const [x, y, h, r] of [[0, 40, 34, 4], [-8, 34, 24, 3], [8, 36, 28, 3], [-14, 30, 16, 2.4], [13, 30, 18, 2.4]] as const) {
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, h, 8), dark); tw.position.set(x, y + h / 2, 0); g.add(tw);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 1.35, h * 0.45, 8), dark2); cap.position.set(x, y + h + h * 0.22, 0); g.add(cap);
  }
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.6), basic('#ff3a4a', { fog: false })); win.position.set(0, 62, 4.2); g.add(win);
  g.position.copy(castleAt);
  g.lookAt(0, castleAt.y, 0);
  noOutline(g);
  L.deco(g);
  return g;
}

/** a glowing crystal (receivers, the bed's sun crystal) — returns { group, set(k) } */
export function crystal(L: Level3D, x: number, y: number, z: number, s = 1) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const m = basic('#a8c8ff');
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.32 * s), m);
  core.scale.set(1, 1.6, 1);
  g.add(core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: O.glowTex(), color: '#fff2a0', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  halo.scale.setScalar(2.6 * s);
  g.add(halo);
  const cage = new THREE.Mesh(new THREE.TorusGeometry(0.42 * s, 0.05 * s, 6, 16), M.brass());
  cage.rotation.x = Math.PI / 2;
  g.add(cage);
  noOutline(halo);
  L.deco(g);
  let k = 0;
  return {
    group: g,
    set(v: number) {
      k = v;
      m.color.set('#a8c8ff').lerp(new THREE.Color('#fff4b0'), k);
      (halo.material as THREE.SpriteMaterial).opacity = 0.9 * k;
    },
    spin(dt: number) { core.rotation.y += dt * (0.4 + k * 2); },
  };
}

export { V as v3 };
