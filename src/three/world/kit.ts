import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Built, BoxCol, CylCol, Collider, Hazard } from '../physics/types';
import { toonGradient, LAYER_NO_OUTLINE } from '../gfx';

/**
 * Shared helpers for the world kit (props / rooms):
 *  - `B` builder: build a prop in LOCAL space (origin = bottom-center, front = +Z),
 *    add local colliders, then `done(x,y,z,quarterTurns)` places it in the world, converts
 *    colliders to world space, merges static meshes per material and freezes matrices.
 *  - geometry helpers with world-scaled UVs, lathe with explicit V, cached materials.
 */

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** deterministic PRNG (mulberry32) */
export function rng(seed: number): () => number {
  let a = (seed | 0) ^ 0x2545f491;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** hash numbers (e.g. a position) into a seed */
export function hashSeed(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) { h ^= Math.round(v * 977) | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; }
  return h >>> 0;
}
export const rr = (R: () => number, a: number, b: number) => a + (b - a) * R();

// ───────────────────────── materials ─────────────────────────

export interface TMatOpts {
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  alphaTest?: number;
  depthWrite?: boolean;
  flat?: boolean;
  /**
   * Decal / inlay lying (almost) flat on another surface (labels, discs, liquid tops, plaques):
   * pulled toward the camera with polygonOffset so it never z-fights with the surface under it.
   * Still give it a small real offset (≥0.01) so shadows and the outline pass see it on top.
   */
  decal?: boolean;
}
/** polygonOffset used by decal materials (negative = toward the camera) */
export function asDecal<M extends THREE.Material>(m: M): M {
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1.5;
  m.polygonOffsetUnits = -4;
  return m;
}
const tcache = new Map<string, THREE.MeshToonMaterial>();
/** Cached toon material with an optional texture (gfx.mat() doesn't cache textured ones). Never mutate. */
export function tmat(map: THREE.Texture | null, color: THREE.ColorRepresentation = '#ffffff', o: TMatOpts = {}): THREE.MeshToonMaterial {
  const key = `${map ? map.uuid : '-'}|${new THREE.Color(color).getHexString()}|${o.emissive === undefined ? '' : new THREE.Color(o.emissive).getHexString()}|${o.emissiveIntensity ?? ''}|${o.transparent ? 1 : 0}|${o.opacity ?? ''}|${o.side ?? ''}|${o.alphaTest ?? ''}|${o.depthWrite ?? ''}|${o.flat ? 1 : 0}|${o.decal ? 1 : 0}`;
  let m = tcache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color: new THREE.Color(color), gradientMap: toonGradient(), map,
      transparent: !!o.transparent, opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide,
    });
    if (o.alphaTest !== undefined) m.alphaTest = o.alphaTest;
    if (o.emissive !== undefined) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.emissiveIntensity ?? 1; }
    if (o.depthWrite !== undefined) m.depthWrite = o.depthWrite;
    if (o.flat) (m as unknown as { flatShading: boolean }).flatShading = true;
    if (o.decal) asDecal(m);
    tcache.set(key, m);
  }
  return m;
}

const bcache = new Map<string, THREE.MeshBasicMaterial>();
/** Cached unlit material (flames, glows, windows, sky). `decal`: see TMatOpts.decal. */
export function bmat(color: THREE.ColorRepresentation, o: { map?: THREE.Texture | null; transparent?: boolean; opacity?: number; additive?: boolean; side?: THREE.Side; depthWrite?: boolean; fog?: boolean; decal?: boolean } = {}): THREE.MeshBasicMaterial {
  const key = `${new THREE.Color(color).getHexString()}|${o.map ? o.map.uuid : ''}|${o.transparent ? 1 : 0}|${o.opacity ?? ''}|${o.additive ? 1 : 0}|${o.side ?? ''}|${o.depthWrite ?? ''}|${o.fog ?? ''}|${o.decal ? 1 : 0}`;
  let m = bcache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color), map: o.map ?? null,
      transparent: !!o.transparent || !!o.additive || o.opacity !== undefined,
      opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: o.depthWrite ?? !(o.additive || o.transparent || o.opacity !== undefined),
      fog: o.fog ?? true,
    });
    if (o.decal) asDecal(m);
    bcache.set(key, m);
  }
  return m;
}

// ───────────────────────── geometry ─────────────────────────

const gcache = new Map<string, THREE.BufferGeometry>();
/** cache a geometry by key (only for shapes that are reused a lot — unit shapes, profiles). */
export function cg<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = gcache.get(key) as T | undefined;
  if (!g) { g = make(); gcache.set(key, g); }
  return g;
}
export const unitBox = () => cg('ubox', () => new THREE.BoxGeometry(1, 1, 1));
/** unit cylinder r=1, h=1 with its base at y=0 */
export const unitCyl = (seg = 24) => cg(`ucyl${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg).translate(0, 0.5, 0));
export const unitSphere = (seg = 16) => cg(`usph${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.6))));
/** upper hemisphere r=1 (dome), base at y=0 */
export const unitDome = (seg = 20) => cg(`udome${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(5, Math.round(seg * 0.35)), 0, TAU, 0, Math.PI / 2));

/** Box whose UVs are in world units: one texture tile per `tile` units (0 = plain 0..1 per face). */
export function boxGeo(w: number, h: number, d: number, tile = 0, ou = 0, ov = 0): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (tile > 0) {
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile + ou, uv.getY(i) * dims[f][1] / tile + ov);
    }
  }
  return g;
}

export interface UVRect { u0: number; v0: number; u1: number; v1: number }
/** Box faces order: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z. rot = rotate the rect 90° on that face. */
export function atlasBox(w: number, h: number, d: number, faces: (UVRect | null)[], rot: boolean[] = []): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    const r = faces[f];
    if (!r) continue;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      let u = uv.getX(i), v = uv.getY(i);
      if (rot[f]) { const t = u; u = 1 - v; v = t; }
      uv.setXY(i, lerp(r.u0, r.u1, u), lerp(r.v0, r.v1, v));
    }
  }
  return g;
}

/** Recompute UVs by planar projection of vertex positions: u = p[a]*su+ou, v = p[b]*sv+ov */
export function planarUV(g: THREE.BufferGeometry, a: 'x' | 'y' | 'z', b: 'x' | 'y' | 'z', su: number, sv: number, ou = 0, ov = 0) {
  const p = g.attributes.position as THREE.BufferAttribute;
  const arr = new Float32Array(p.count * 2);
  const ia = a === 'x' ? 0 : a === 'y' ? 1 : 2, ib = b === 'x' ? 0 : b === 'y' ? 1 : 2;
  for (let i = 0; i < p.count; i++) {
    arr[i * 2] = p.getComponent(i, ia) * su + ou;
    arr[i * 2 + 1] = p.getComponent(i, ib) * sv + ov;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
  return g;
}
export function scaleUV(g: THREE.BufferGeometry, su: number, sv = su, ou = 0, ov = 0) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su + ou, uv.getY(i) * sv + ov);
  return g;
}

/**
 * Lathe from (radius, y, v) points (bottom → top for outward faces; go out along the bottom,
 * up the side, and in across the top for a closed solid). `sharp` duplicates a point to get a crisp edge.
 */
export type LP = [number, number, number] | [number, number, number, 1];
export function latheV(pts: LP[], seg = 32): THREE.LatheGeometry {
  const P: [number, number, number][] = [];
  for (const p of pts) { P.push([p[0], p[1], p[2]]); if (p.length === 4) P.push([p[0], p[1], p[2]]); }
  // phiStart = π puts the texture seam (u=0) at -Z, so u=0.5 faces +Z (the front)
  const g = new THREE.LatheGeometry(P.map((p) => new THREE.Vector2(Math.max(0, p[0]), p[1])), seg, Math.PI);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const n = P.length;
  for (let i = 0; i <= seg; i++) for (let j = 0; j < n; j++) uv.setY(i * n + j, P[j][2]);
  return g;
}
/** cached latheV by key */
export const latheC = (key: string, pts: LP[], seg = 32) => cg(`lathe:${key}:${seg}`, () => latheV(pts, seg));

/** Partial open cylinder band (for labels) centered on +Z, from y0 to y1. */
export function bandGeo(r: number, y0: number, y1: number, arc: number, seg = 16): THREE.CylinderGeometry {
  // CylinderGeometry: theta 0 is at +Z and u grows toward +X, so the band reads left→right from the front
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, seg, 1, true, -arc / 2, arc);
  g.translate(0, (y0 + y1) / 2, 0);
  return g;
}

/** Shape → flat geometry in XY with UVs normalized to the shape bbox (0..1). */
export function shapeGeo(shape: THREE.Shape, curveSeg = 12): THREE.ShapeGeometry {
  const g = new THREE.ShapeGeometry(shape, curveSeg);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const sx = bb.max.x - bb.min.x || 1, sy = bb.max.y - bb.min.y || 1;
  planarUV(g, 'x', 'y', 1 / sx, 1 / sy, -bb.min.x / sx, -bb.min.y / sy);
  return g;
}

/** Arch outline (rect with a half-circle top) of width w and top at h, bottom at y0, in XY. */
export function archShape(w: number, h: number, y0 = 0): THREE.Shape {
  const r = w / 2, ys = Math.max(y0 + 0.01, h - r);
  const s = new THREE.Shape();
  s.moveTo(-r, y0); s.lineTo(r, y0); s.lineTo(r, ys);
  s.absarc(0, ys, r, 0, Math.PI, false);
  s.lineTo(-r, y0);
  return s;
}
/** U-shaped arch frame (no bottom bar): inner opening w×h, frame width fw, standing on y=0. */
export function archRing(w: number, h: number, fw: number): THREE.Shape {
  const ri = w / 2, ro = ri + fw, ys = Math.max(0.01, h - ri);
  const s = new THREE.Shape();
  s.moveTo(-ro, 0); s.lineTo(-ro, ys);
  s.absarc(0, ys, ro, Math.PI, 0, true);
  s.lineTo(ro, 0); s.lineTo(ri, 0); s.lineTo(ri, ys);
  s.absarc(0, ys, ri, 0, Math.PI, false);
  s.lineTo(-ri, 0); s.closePath();
  return s;
}

// ───────────────────────── builder ─────────────────────────

export interface MOpts {
  rx?: number; ry?: number; rz?: number;
  s?: number; sx?: number; sy?: number; sz?: number;
  cast?: boolean; receive?: boolean;
  parent?: THREE.Object3D;
  /** exclude from the outline pass (flames, glows), no shadows */
  glow?: boolean;
  /** animated: keeps matrixAutoUpdate and is never merged */
  dyn?: boolean;
  /** never merged (but still frozen) */
  keep?: boolean;
  order?: number;
  name?: string;
}

type BoxExtra = Partial<Omit<BoxCol, 'kind' | 'min' | 'max'>>;
type CylExtra = Partial<Omit<CylCol, 'kind' | 'x' | 'z' | 'r' | 'y0' | 'y1'>>;

export class B {
  readonly root = new THREE.Group();
  readonly cols: Collider[] = [];
  readonly hz: Hazard[] = [];
  readonly lights: THREE.PointLight[] = [];
  readonly ups: Array<(t: number, dt: number) => void> = [];
  readonly tag: string;
  constructor(tag: string) { this.tag = tag; this.root.name = tag; }

  /** add a mesh in local space */
  m(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, o: MOpts = {}): THREE.Mesh {
    const me = new THREE.Mesh(geo, material);
    me.castShadow = o.cast ?? true;
    me.receiveShadow = o.receive ?? true;
    me.position.set(x, y, z);
    if (o.rx || o.ry || o.rz) me.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
    const sb = o.s ?? 1;
    if (o.sx !== undefined || o.sy !== undefined || o.sz !== undefined) me.scale.set(o.sx ?? sb, o.sy ?? sb, o.sz ?? sb);
    else if (o.s !== undefined) me.scale.setScalar(o.s);
    if (o.glow) { me.layers.set(LAYER_NO_OUTLINE); me.castShadow = false; me.receiveShadow = false; }
    if (o.dyn) me.userData.dyn = true;
    if (o.keep) me.userData.keep = true;
    if (o.order !== undefined) me.renderOrder = o.order;
    if (o.name) me.name = o.name;
    (o.parent ?? this.root).add(me);
    return me;
  }
  /** box mesh centered at (x,y,z) sized w×h×d; tile>0 = world-scaled UVs */
  bx(material: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, tile = 0, o: MOpts = {}) {
    return this.m(tile > 0 ? boxGeo(w, h, d, tile) : unitBox(), material, x, y, z, tile > 0 ? o : { ...o, sx: w, sy: h, sz: d });
  }
  /** cylinder mesh with base at y0 */
  cy(material: THREE.Material, r: number, h: number, x: number, y0: number, z: number, seg = 24, o: MOpts = {}) {
    return this.m(unitCyl(seg), material, x, y0, z, { ...o, sx: r, sy: h, sz: r });
  }
  sp(material: THREE.Material, r: number, x: number, y: number, z: number, seg = 14, o: MOpts = {}) {
    return this.m(unitSphere(seg), material, x, y, z, { s: r, ...o });
  }
  group(x = 0, y = 0, z = 0, parent?: THREE.Object3D, dyn = false) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    if (dyn) g.userData.dyn = true;
    (parent ?? this.root).add(g);
    return g;
  }

  /** local-space box collider */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, extra: BoxExtra = {}): BoxCol {
    const c: BoxCol = {
      kind: 'box',
      min: new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)),
      max: new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)),
      tag: this.tag, ...extra,
    };
    this.cols.push(c);
    return c;
  }
  /** centered box collider: center (cx,cz), half sizes hx,hz, from y0 to y1 */
  boxC(cx: number, cz: number, hx: number, hz: number, y0: number, y1: number, extra: BoxExtra = {}) {
    return this.box(cx - hx, y0, cz - hz, cx + hx, y1, cz + hz, extra);
  }
  cyl(x: number, z: number, r: number, y0: number, y1: number, extra: CylExtra = {}): CylCol {
    const c: CylCol = { kind: 'cyl', x, z, r, y0, y1, tag: this.tag, ...extra };
    this.cols.push(c);
    return c;
  }
  hazard(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, kind: Hazard['kind'], dmg = 1): Hazard {
    const h: Hazard = {
      min: new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)),
      max: new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)),
      kind, dmg,
    };
    this.hz.push(h);
    return h;
  }
  light(color: THREE.ColorRepresentation, intensity: number, distance: number, decay: number, x: number, y: number, z: number, parent?: THREE.Object3D) {
    const l = new THREE.PointLight(color, intensity, distance, decay);
    l.position.set(x, y, z);
    l.castShadow = false;
    (parent ?? this.root).add(l);
    this.lights.push(l);
    return l;
  }
  update(fn: (t: number, dt: number) => void) { this.ups.push(fn); }

  /**
   * Place at world (x,y,z) rotated by q quarter turns about Y (rounded when the prop has colliders),
   * convert colliders/hazards to world space, merge static meshes and freeze matrices.
   */
  done(x: number, y: number, z: number, q = 0, opt: { merge?: boolean } = {}): Built {
    const hasCols = this.cols.length > 0 || this.hz.length > 0;
    const qq = hasCols ? Math.round(q) : q;
    const ang = qq * Math.PI / 2;
    let c = Math.cos(ang), s = Math.sin(ang);
    if (hasCols) { c = Math.round(c); s = Math.round(s); }
    const tx = (lx: number, lz: number): [number, number] => [c * lx + s * lz + x, -s * lx + c * lz + z];
    const boxw = (mn: THREE.Vector3, mx: THREE.Vector3) => {
      const [ax, az] = tx(mn.x, mn.z), [bx, bz] = tx(mx.x, mx.z);
      mn.set(Math.min(ax, bx), mn.y + y, Math.min(az, bz));
      mx.set(Math.max(ax, bx), mx.y + y, Math.max(az, bz));
    };
    for (const col of this.cols) {
      if (col.kind === 'box') boxw(col.min, col.max);
      else { const [wx, wz] = tx(col.x, col.z); col.x = wx; col.z = wz; col.y0 += y; col.y1 += y; }
    }
    for (const h of this.hz) boxw(h.min, h.max);
    if (opt.merge !== false) mergeStatic(this.root);
    this.root.position.set(x, y, z);
    this.root.rotation.y = ang;
    freeze(this.root);
    const built: Built = { obj: this.root, colliders: this.cols };
    if (this.hz.length) built.hazards = this.hz;
    if (this.lights.length) built.lights = this.lights;
    if (this.ups.length) {
      const ups = this.ups;
      built.update = ups.length === 1 ? ups[0] : (t, dt) => { for (const u of ups) u(t, dt); };
    }
    return built;
  }
}

/** Combine several Builts into one (e.g. a room with decorations). */
export function combine(name: string, parts: Built[]): Built {
  const g = new THREE.Group(); g.name = name;
  const out: Built = { obj: g, colliders: [] };
  const hz: Hazard[] = [], lights: THREE.PointLight[] = [], ups: ((t: number, dt: number) => void)[] = [];
  for (const p of parts) {
    g.add(p.obj);
    out.colliders.push(...p.colliders);
    if (p.hazards) hz.push(...p.hazards);
    if (p.lights) lights.push(...p.lights);
    if (p.update) ups.push(p.update);
  }
  g.updateMatrix(); g.matrixAutoUpdate = false;
  if (hz.length) out.hazards = hz;
  if (lights.length) out.lights = lights;
  if (ups.length) out.update = (t, dt) => { for (const u of ups) u(t, dt); };
  return out;
}

function freeze(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o.userData.dyn) return;
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
}

const KEEP_ATTRS = new Set(['position', 'normal', 'uv']);
function flipWinding(g: THREE.BufferGeometry) {
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    g.index.needsUpdate = true;
  } else {
    for (const name of Object.keys(g.attributes)) {
      const at = g.attributes[name] as THREE.BufferAttribute;
      const n = at.itemSize, arr = at.array;
      for (let i = 0; i < at.count; i += 3) for (let k = 0; k < n; k++) {
        const a = (i + 1) * n + k, b = (i + 2) * n + k;
        const t = arr[a]; arr[a] = arr[b]; arr[b] = t;
      }
    }
  }
}

/**
 * Merge static child meshes sharing a material into one mesh per material (fewer draw calls).
 * Works per "container": the root and every dyn (animated) object get their own merge, so meshes inside
 * an animated group are batched in that group's local space and still move with it.
 */
function mergeStatic(root: THREE.Object3D) {
  root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  mergeIn(root);
}
const _inv = new THREE.Matrix4(), _rel = new THREE.Matrix4();
function mergeIn(container: THREE.Object3D) {
  const groups = new Map<string, THREE.Mesh[]>();
  const nested: THREE.Object3D[] = [];
  const visit = (o: THREE.Object3D) => {
    for (const ch of o.children) {
      if (ch.userData.dyn) { nested.push(ch); continue; }
      const me = ch as THREE.Mesh;
      if (me.isMesh && !ch.userData.keep && !(me as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(me.material) && ch.children.length === 0 && ch.visible) {
        const k = `${(me.material as THREE.Material).uuid}|${me.castShadow ? 1 : 0}${me.receiveShadow ? 1 : 0}|${me.layers.mask}|${me.renderOrder}`;
        let l = groups.get(k);
        if (!l) { l = []; groups.set(k, l); }
        l.push(me);
      }
      if (ch.children.length) visit(ch);
    }
  };
  visit(container);
  _inv.copy(container.matrixWorld).invert();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const allIndexed = list.every((m) => m.geometry.index !== null);
    const geos: THREE.BufferGeometry[] = [];
    for (const m of list) {
      let g = m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!KEEP_ATTRS.has(name)) g.deleteAttribute(name);
      g.morphAttributes = {};
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!allIndexed && g.index) g = g.toNonIndexed();
      g.clearGroups();
      _rel.multiplyMatrices(_inv, m.matrixWorld);
      g.applyMatrix4(_rel);
      if (_rel.determinant() < 0) flipWinding(g);
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const f = list[0];
    const nm = new THREE.Mesh(merged, f.material);
    nm.castShadow = f.castShadow; nm.receiveShadow = f.receiveShadow;
    nm.layers.mask = f.layers.mask; nm.renderOrder = f.renderOrder;
    nm.name = f.name || 'merged';
    for (const m of list) m.removeFromParent();
    container.add(nm);
    nm.updateMatrixWorld(true);
  }
  for (const d of nested) mergeIn(d);
}
