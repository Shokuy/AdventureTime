import * as THREE from 'three';
import type { Built } from '../../../physics/types';
import { B, TAU, cg, tmat, bmat, rng, rr, latheC, type LP } from '../../../world/kit';
import { glowTex } from '../../../world/textures';
import { LAYER_NO_OUTLINE } from '../../../gfx';

/* Small shared helpers of the candy-town kit (materials, icing, glows, round walls, merging a whole quarter). */

export { B, TAU, tmat, bmat, rng, rr, cg, latheC };
export type { LP };

/** plain cached toon material */
export const tm = (c: string, o: Parameters<typeof tmat>[2] = {}) => tmat(null, c, o);

/** additive glow billboard (lamps, magic, windows at night); never outlined */
const sprites = new Map<string, THREE.SpriteMaterial>();
export function glow(color: string, size: number, opacity = 0.7): THREE.Sprite {
  const k = `${color}|${opacity}`;
  let m = sprites.get(k);
  if (!m) { m = new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }); sprites.set(k, m); }
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  s.layers.set(LAYER_NO_OUTLINE);
  return s;
}

/** a marshmallow puff: a bulging cylinder with rounded rims (unit radius, unit height, base at 0) */
export const puffGeo = () => latheC('town-puff', [[0, 0, 0], [0.9, 0, 0.02], [0.985, 0.05, 0.06], [1.0, 0.25, 0.25], [1.012, 0.5, 0.5], [1.0, 0.75, 0.75], [0.985, 0.95, 0.94], [0.9, 1, 0.98], [0, 1, 1]], 28);
/** a gumdrop: wide sugary dome with a soft shoulder (unit radius, unit height) */
export const gumdropGeo = () => latheC('town-gumdrop', [[0, 0, 0], [0.96, 0, 0.02], [1, 0.08, 0.08], [0.97, 0.3, 0.3], [0.85, 0.6, 0.6], [0.6, 0.86, 0.85], [0.3, 0.98, 0.95], [0, 1, 1]], 22);
/** jelly lantern blob */
export const jellyGeo = () => latheC('town-jelly', [[0, 0, 0], [0.55, 0.02, 0.05], [0.9, 0.18, 0.2], [1, 0.45, 0.45], [0.92, 0.75, 0.75], [0.6, 0.95, 0.95], [0, 1, 1]], 18);

/**
 * Piped icing drips along an edge from a to b (local space of the builder), hanging down from it:
 * a thick bead line plus random-length drops with round tips.
 */
export function icingEdge(b: B, mat: THREE.Material, ax: number, ay: number, az: number, bx: number, by: number, bz: number, seed: number, o: { bead?: number; drips?: number; maxLen?: number; parent?: THREE.Object3D } = {}) {
  const R = rng(seed);
  const bead = o.bead ?? 0.11;
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  // the bead line: one cylinder along the edge + round ends
  const mid = new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az).normalize();
  const m = b.m(cg('town-cyl12', () => new THREE.CylinderGeometry(1, 1, 1, 12)), mat, mid.x, mid.y, mid.z, { parent: o.parent, sx: bead, sy: len, sz: bead });
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  b.sp(mat, bead, ax, ay, az, 10, { parent: o.parent });
  b.sp(mat, bead, bx, by, bz, 10, { parent: o.parent });
  const n = o.drips ?? Math.max(2, Math.round(len * 1.6));
  const maxL = o.maxLen ?? 0.45;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.3 + R() * 0.4) / n;
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
    const L = rr(R, 0.08, maxL), r = bead * rr(R, 0.55, 0.85);
    b.m(cg('town-cap', () => new THREE.CapsuleGeometry(1, 1, 3, 7)), mat, x, y - L / 2, z, { parent: o.parent, sx: r, sy: L / 2, sz: r });
    b.sp(mat, r * 1.25, x, y - L, z, 7, { parent: o.parent });
  }
}

/**
 * A round wall as a ring of overlapping cylinders (smooth to walk along, no gaps), optionally with a gap
 * (angles measured from +Z toward +X, like yaw). Local space of the builder.
 */
export function ringCols(b: B, cx: number, cz: number, r: number, y0: number, y1: number, o: { n?: number; post?: number; gapAt?: number; gapHalf?: number } = {}) {
  const n = o.n ?? Math.max(10, Math.round((TAU * r) / 0.9));
  const post = o.post ?? (TAU * r / n) * 0.62;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    if (o.gapAt !== undefined) {
      const d = Math.atan2(Math.sin(a - o.gapAt), Math.cos(a - o.gapAt));
      if (Math.abs(d) < (o.gapHalf ?? 0.3)) continue;
    }
    b.cyl(cx + Math.sin(a) * r, cz + Math.cos(a) * r, post, y0, y1);
  }
}

/**
 * Many Builts → one: their static meshes are merged per material (a whole quarter = a handful of draw calls),
 * colliders / hazards / lights / animations are kept. Animated parts (dyn groups) stay separate.
 */
export function mergeBuilts(name: string, parts: Built[]): Built {
  const b = new B(name);
  const cols: Built['colliders'] = [];
  const hz: NonNullable<Built['hazards']> = [];
  const lights: THREE.PointLight[] = [];
  const ups: ((t: number, dt: number) => void)[] = [];
  for (const p of parts) {
    b.root.add(p.obj);
    cols.push(...p.colliders);
    if (p.hazards) hz.push(...p.hazards);
    if (p.lights) lights.push(...p.lights);
    if (p.update) ups.push(p.update);
  }
  const out = b.done(0, 0, 0, 0);
  out.colliders = cols;
  if (hz.length) out.hazards = hz;
  if (lights.length) out.lights = lights;
  if (ups.length) out.update = (t, dt) => { for (const u of ups) u(t, dt); };
  return out;
}

/** world-space collider box helper (for layout code) */
export function boxCol(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  return { kind: 'box' as const, min: new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)), max: new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)) };
}
