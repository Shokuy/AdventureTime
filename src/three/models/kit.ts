import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { matU, mesh, type MatOpts } from '../gfx';

/* Small toolkit shared by the procedural character models (geometry cache, per-rig materials, math). */

export const TAU = Math.PI * 2;
export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent exponential smoothing toward `b`. */
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smooth = (t: number) => { t = clamp(t); return t * t * (3 - 2 * t); };
/** Normalised progress of `p` inside [a, b]. */
export const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
export const easeOut = (t: number) => 1 - (1 - clamp(t)) ** 3;
export const easeIn = (t: number) => clamp(t) ** 2;
export const easeInOut = (t: number) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };
/** Wrap an angle to (-PI, PI]. */
export const wrapAngle = (a: number) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

// ───────────────────────── geometry cache ─────────────────────────
const gcache = new Map<string, THREE.BufferGeometry>();
export function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = gcache.get(key) as T | undefined;
  if (!g) { g = make(); gcache.set(key, g); }
  return g;
}

export const G = {
  /** unit sphere, 32×24 */
  sphere: () => cached('sphere', () => new THREE.SphereGeometry(1, 32, 24)),
  /** unit sphere, 16×12 (small details) */
  ball: () => cached('ball', () => new THREE.SphereGeometry(1, 16, 12)),
  /** upper unit hemisphere (dome, open at the bottom) */
  dome: () => cached('dome', () => new THREE.SphereGeometry(1, 32, 12, 0, TAU, 0, Math.PI / 2)),
  /** unit cylinder along Y, height 1 centred at origin */
  cyl: () => cached('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 20)),
  /** cone (tip at +Y), height 1 centred */
  cone: () => cached('cone', () => new THREE.CylinderGeometry(0, 1, 1, 16)),
  capsule: (r: number, len: number, seg = 14) =>
    cached(`cap|${r}|${len}|${seg}`, () => new THREE.CapsuleGeometry(r, len, 5, seg)),
  /** torus arc in the XY plane starting at +X going counter-clockwise (arc = PI → upper half "∩") */
  arc: (R: number, tube: number, arc: number) =>
    cached(`arc|${R}|${tube}|${arc}`, () => {
      const g = new THREE.TorusGeometry(R, tube, 8, 20, arc);
      return g;
    }),
  torus: (R: number, tube: number, rs = 12, ts = 32) => cached(`torus|${R}|${tube}|${rs}|${ts}`, () => new THREE.TorusGeometry(R, tube, rs, ts)),
};

// ───────────────────────── per-rig materials ─────────────────────────
/** Unique toon materials per rig instance, so the whole rig can hit-flash without touching shared materials. */
export class Mats {
  readonly all: THREE.MeshToonMaterial[] = [];
  private byKey = new Map<string, THREE.MeshToonMaterial>();
  private last = -1;
  get(color: THREE.ColorRepresentation, o: MatOpts = {}): THREE.MeshToonMaterial {
    const key = `${new THREE.Color(color).getHexString()}|${o.transparent ? o.opacity : ''}|${o.side ?? ''}|${o.map ? o.map.uuid : ''}`;
    let m = this.byKey.get(key);
    if (!m) { m = matU(color, o); this.byKey.set(key, m); this.all.push(m); }
    return m;
  }
  /** Brand-new material that is still flashed with the rest (e.g. something whose colour you tint per-frame). */
  own(color: THREE.ColorRepresentation, o: MatOpts = {}): THREE.MeshToonMaterial {
    const m = matU(color, o); this.all.push(m); return m;
  }
  flash(f: number) {
    f = clamp(f);
    if (Math.abs(f - this.last) < 0.004) return;
    this.last = f;
    const v = f * 0.9;
    for (const m of this.all) m.emissive.setRGB(v, v, v);
  }
}

// ───────────────────────── scene-graph helpers ─────────────────────────
type V3 = [number, number, number];

export function grp(parent: THREE.Object3D | null, p?: V3, r?: V3, name?: string): THREE.Group {
  const g = new THREE.Group();
  if (p) g.position.set(p[0], p[1], p[2]);
  if (r) g.rotation.set(r[0], r[1], r[2]);
  if (name) g.name = name;
  if (parent) parent.add(g);
  return g;
}

export function part(
  parent: THREE.Object3D | null,
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  p?: V3,
  s?: number | V3,
  r?: V3,
  o: { cast?: boolean; receive?: boolean } = {},
): THREE.Mesh {
  const m = mesh(geo, material, o);
  if (p) m.position.set(p[0], p[1], p[2]);
  if (s !== undefined) { if (typeof s === 'number') m.scale.setScalar(s); else m.scale.set(s[0], s[1], s[2]); }
  if (r) m.rotation.set(r[0], r[1], r[2]);
  if (parent) parent.add(m);
  return m;
}

/** Orient a group (placed at a sphere centre) so that its local +Z points at (yaw, pitch); children at z=R sit on the surface. */
export function aim(o: THREE.Object3D, yaw: number, pitch: number, roll = 0) {
  o.rotation.set(-pitch, yaw, roll, 'YXZ');
  return o;
}
/** Surface anchor on a sphere: returns a group whose +Z is the surface normal at (yaw, pitch) and whose origin is on the surface at radius R. */
export function surf(parent: THREE.Object3D, yaw: number, pitch: number, R: number, center: V3 = [0, 0, 0]): THREE.Group {
  const pivot = grp(parent, center);
  aim(pivot, yaw, pitch);
  return grp(pivot, [0, 0, R]);
}

const _up = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
/** Place a unit Y-aligned mesh (e.g. G.cyl()) between a and b with radius r (scale.x/z). */
export function between(o: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, rz = r) {
  _d.subVectors(b, a);
  const len = _d.length();
  o.position.addVectors(a, b).multiplyScalar(0.5);
  if (len > 1e-6) o.quaternion.setFromUnitVectors(_up, _d.multiplyScalar(1 / len));
  o.scale.set(r, Math.max(len, 1e-4), rz);
}

/** Merge several (geometry, transform) pairs into one static geometry. */
export function merge(parts: Array<{ g: THREE.BufferGeometry; p?: V3; s?: number | V3; r?: V3 }>): THREE.BufferGeometry {
  const list: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const allIndexed = parts.every((it) => !!it.g.index);
  for (const it of parts) {
    const g = allIndexed || !it.g.index ? it.g.clone() : it.g.toNonIndexed();
    pos.set(...(it.p ?? [0, 0, 0]));
    if (it.s === undefined) sc.set(1, 1, 1); else if (typeof it.s === 'number') sc.setScalar(it.s); else sc.set(...it.s);
    e.set(...(it.r ?? [0, 0, 0]));
    q.setFromEuler(e);
    m.compose(pos, q, sc);
    g.applyMatrix4(m);
    // keep only the common attributes
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    list.push(g);
  }
  const out = mergeGeometries(list, false);
  if (!out) throw new Error('merge failed');
  return out;
}

/**
 * Tube along a curve whose radius follows `radius(t)` (t = 0..1). Built once (no per-frame cost).
 */
export function taperedTube(curve: THREE.Curve<THREE.Vector3>, tubular: number, radial: number, radius: (t: number) => number, closed = true): THREE.BufferGeometry {
  const g = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, c);
    const r = radius(t);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  if (!closed) return g;
  // round end caps (small spheres) so tapered ends don't look hollow
  const r0 = radius(0), r1 = radius(1);
  const p0 = curve.getPointAt(0), p1 = curve.getPointAt(1);
  const caps: Array<{ g: THREE.BufferGeometry; p: V3; s: number }> = [];
  if (r0 > 1e-3) caps.push({ g: new THREE.SphereGeometry(1, radial, Math.max(6, radial >> 1)), p: [p0.x, p0.y, p0.z], s: r0 });
  if (r1 > 1e-3) caps.push({ g: new THREE.SphereGeometry(1, radial, Math.max(6, radial >> 1)), p: [p1.x, p1.y, p1.z], s: r1 });
  if (!caps.length) return g;
  return merge([{ g }, ...caps]);
}

/**
 * Lathe-like surface of revolution with an opening in front (+Z) whose half-angle is `gap(i)` at profile point i.
 * Profile points are (radius, y). Optional vertex colours via `color(phi, i)`. `ripple(phi, i)` scales the radius (folds).
 */
export function openLathe(
  profile: Array<[number, number]>,
  gap: (i: number) => number,
  segs: number,
  opts: { ripple?: (phi: number, i: number) => number; color?: (phi: number, i: number, out: THREE.Color) => void; zScale?: number } = {},
): THREE.BufferGeometry {
  const rows = profile.length;
  const cols = segs + 1;
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const col = opts.color ? new Float32Array(rows * cols * 3) : null;
  const c = new THREE.Color();
  const zs = opts.zScale ?? 1;
  for (let i = 0; i < rows; i++) {
    const [r, y] = profile[i];
    const g = gap(i);
    for (let j = 0; j < cols; j++) {
      const phi = g + (TAU - 2 * g) * (j / segs);
      const rr = r * (opts.ripple ? opts.ripple(phi, i) : 1);
      const k = (i * cols + j);
      pos[k * 3] = rr * Math.sin(phi);
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = rr * Math.cos(phi) * zs;
      uv[k * 2] = j / segs;
      uv[k * 2 + 1] = i / (rows - 1);
      if (col && opts.color) { opts.color(phi, i, c); col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b; }
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * cols + j, b = a + 1, d = a + cols, e = d + 1;
      // outward-facing winding (profile goes bottom→top)
      idx.push(a, b, d, b, e, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Points along the edge of an openLathe (left = +phi side / right = -phi side), slightly pushed outward. */
export function openLatheEdge(profile: Array<[number, number]>, gap: (i: number) => number, side: 1 | -1, push = 1.02, zScale = 1): THREE.Vector3[] {
  return profile.map(([r, y], i) => {
    const phi = side > 0 ? gap(i) : TAU - gap(i);
    return new THREE.Vector3(r * push * Math.sin(phi), y, r * push * Math.cos(phi) * zScale);
  });
}

/**
 * Flat ring-sector in the XZ plane (y = 0), angles measured from +Z toward +X (same as yaw).
 * uv.x = 0 at angle a0 → 1 at a1; uv.y = 0 inner → 1 outer. Used for swing trails.
 */
export function arcRibbon(r0: number, r1: number, a0: number, a1: number, segs: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = a0 + (a1 - a0) * t;
    const s = Math.sin(a), c = Math.cos(a);
    pos.push(s * r0, 0, c * r0, s * r1, 0, c * r1);
    uv.push(t, 0, t, 1);
    if (i < segs) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Teardrop (lathe) with the point at +Y, unit height 2 (y −1..1), max radius ≈ 0.75. */
export function teardrop(): THREE.BufferGeometry {
  return cached('teardrop', () => {
    const pts: THREE.Vector2[] = [];
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const th = (i / n) * Math.PI;
      const y = -Math.cos(th);
      const r = Math.sin(th) * Math.pow((1 + Math.cos(th)) / 2, 0.55);
      pts.push(new THREE.Vector2(Math.max(r, i === 0 || i === n ? 0 : 1e-3), y));
    }
    return new THREE.LatheGeometry(pts, 20);
  });
}

/** Five-point star (extruded), lying in XY, centred, ~1 unit across. */
export function starGeo(): THREE.BufferGeometry {
  return cached('star', () => {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + Math.PI / 2;
      const r = i % 2 === 0 ? 0.5 : 0.22;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 });
    g.translate(0, 0, -0.06);
    return g;
  });
}

/** Simple blinker: returns 0..1 eyelid closure, blinking every few seconds. */
export class Blinker {
  private t = 0;
  private next = 1.5 + Math.random() * 2.5;
  private dur = 0.14;
  update(dt: number): number {
    this.t += dt;
    if (this.t > this.next + this.dur) {
      this.t = 0;
      this.next = 2 + Math.random() * 3;
      if (Math.random() < 0.2) this.next = 0.25; // occasional double blink
    }
    const k = this.t - this.next;
    if (k < 0) return 0;
    return Math.sin((k / this.dur) * Math.PI);
  }
}

/** Hide/show without changing scene graph. */
export function vis(o: THREE.Object3D, v: boolean) { if (o.visible !== v) o.visible = v; }
