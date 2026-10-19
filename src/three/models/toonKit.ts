import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cached, taperedTube } from './kit';

/*
 * Small helpers for the cartoon characters (hair locks, puffs, baking static parts into one mesh per material).
 */

/**
 * Bake every mesh under `g` into one mesh per material (static parts: hair, clothes trims, studs …).
 * Meshes keep their look; the scene graph under `g` is replaced with the merged meshes. Draw calls drop a lot.
 * Meshes flagged `userData.keep` (animated bits) are left alone, as are their subtrees.
 */
export function flatten(g: THREE.Object3D, o: { cast?: boolean } = {}): THREE.Mesh[] {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const kill: THREE.Object3D[] = [];
  const layers = new Map<THREE.Material, number>();
  g.traverse((c) => {
    if (c === g) return;
    if (c.userData.keep) return;
    let p: THREE.Object3D | null = c.parent;
    while (p && p !== g) { if (p.userData.keep) return; p = p.parent; }
    const m = c as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone());
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((geo.attributes.position.count) * 2), 2));
    const mw = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    geo.applyMatrix4(mw);
    // mirrored transforms flip the winding: fix it so front faces stay front faces
    if (mw.determinant() < 0) {
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (const name of Object.keys(geo.attributes)) {
        const a = geo.attributes[name] as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i += 3) {
          for (let k = 0; k < a.itemSize; k++) { const t = a.getComponent(i + 1, k); a.setComponent(i + 1, k, a.getComponent(i + 2, k)); a.setComponent(i + 2, k, t); }
        }
      }
    }
    let list = byMat.get(m.material);
    if (!list) { list = []; byMat.set(m.material, list); layers.set(m.material, m.layers.mask); }
    list.push(geo);
    kill.push(m);
  });
  for (const k of kill) k.parent?.remove(k);
  // drop now-empty groups
  const empties: THREE.Object3D[] = [];
  g.traverse((c) => { if (c !== g && !(c as THREE.Mesh).isMesh && c.children.length === 0 && !c.userData.keep) empties.push(c); });
  for (const e of empties) e.parent?.remove(e);
  const out: THREE.Mesh[] = [];
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    for (const x of geos) x.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = o.cast ?? true;
    mesh.receiveShadow = true;
    mesh.layers.mask = layers.get(mat) ?? 1;
    g.add(mesh);
    out.push(mesh);
  }
  return out;
}

/**
 * A hair lock: a tapered, bent tube hanging from the origin along −Y (length 1), its tip curling toward +Z by `curl`
 * and sideways by `sweep`. Thick round root (radius `root`), pointy tip. Scale it per use (x = width, z = thickness).
 */
export function lockGeo(curl = 0.3, sweep = 0, root = 0.3, tipK = 1): THREE.BufferGeometry {
  return cached(`tk-lock|${curl}|${sweep}|${root}|${tipK}`, () => {
    const c = new THREE.CubicBezierCurve3(
      new THREE.Vector3(0, 0.05, -0.05),
      new THREE.Vector3(0, -0.35, 0.02),
      new THREE.Vector3(sweep * 0.5, -0.7, curl * 0.3),
      new THREE.Vector3(sweep, -1, curl),
    );
    return taperedTube(c, 18, 8, (t) => root * Math.pow(Math.max(0, 1 - t), 0.75 * tipK) * (0.75 + 0.25 * Math.sin(Math.min(1, t * 3) * Math.PI * 0.5)) + 0.002);
  });
}

/** a soft puffy blob (sphere with gentle lumps) — marshmallow hair, clouds of curls */
export function puffGeo(seed = 1, lump = 0.08): THREE.BufferGeometry {
  return cached(`tk-puff|${seed}|${lump}`, () => {
    const g = new THREE.SphereGeometry(1, 24, 18);
    const p = g.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = 1 + lump * Math.sin(v.x * 5.1 + seed) * Math.sin(v.y * 4.3 + seed * 2.1) * Math.sin(v.z * 4.7 + seed * 0.7) + lump * 0.5 * Math.sin(v.y * 9 + seed);
      v.multiplyScalar(n);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  });
}

/** lathe from (radius, y) pairs, smoothed by a Catmull-Rom spline */
export function smoothLathe(key: string, pts: Array<[number, number]>, segs = 28, steps = 40): THREE.BufferGeometry {
  return cached(`tk-lathe|${key}`, () => {
    const c = new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r, y)));
    const p = c.getPoints(steps).map((v) => new THREE.Vector2(Math.max(0, v.x), v.y));
    return new THREE.LatheGeometry(p, segs);
  });
}
