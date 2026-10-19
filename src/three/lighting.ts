import * as THREE from 'three';

/**
 * Sun (DirectionalLight) shadow setup for the levels.
 *
 * The shadow frustum follows the player, but its centre is SNAPPED to whole shadow-map texels in
 * light space. Without the snap the shadow map is re-rasterised at a sub-texel offset every frame
 * the player moves, so every shadow edge crawls / shimmers ("shadow swimming"). With it, a texel
 * always covers the same patch of the world and shadows are rock-steady.
 */

export interface SunOpts {
  /** half size of the ortho shadow box (units) */
  size?: number;
  mapSize?: number;
  near?: number;
  far?: number;
  /** distance of the light from the focus point along its direction */
  dist?: number;
  bias?: number;
  normalBias?: number;
  /** PCF blur radius in texels */
  radius?: number;
  /** how far (units) the box is pushed ahead of the player along the camera's horizontal view */
  lead?: number;
}

// dist / near / far are the values the levels were lit with (casters up to ~59 units toward the sun);
// a longer reach would put e.g. the whole library floor into the tower walls' shadow.
const DEF: Required<SunOpts> = { size: 26, mapSize: 2048, near: 1, far: 160, dist: 60, bias: -0.00035, normalBias: 0.03, radius: 1.4, lead: 8 };

interface SunData { dist: number; lead: number }
const sunData = new WeakMap<THREE.DirectionalLight, SunData>();

/** Configure shadow casting for the level sun. Call once after creating the light. */
export function setupSun(sun: THREE.DirectionalLight, o: SunOpts = {}): THREE.DirectionalLight {
  const c = { ...DEF, ...o };
  sun.castShadow = true;
  sun.shadow.mapSize.set(c.mapSize, c.mapSize);
  const sc = sun.shadow.camera;
  sc.left = -c.size; sc.right = c.size; sc.top = c.size; sc.bottom = -c.size;
  sc.near = c.near; sc.far = c.far;
  sc.updateProjectionMatrix();
  sun.shadow.bias = c.bias;
  sun.shadow.normalBias = c.normalBias;
  sun.shadow.radius = c.radius;
  sunData.set(sun, { dist: c.dist, lead: c.lead });
  return sun;
}

const _dir = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _f = new THREE.Vector3();
const _fw = new THREE.Vector3();

/**
 * Move the sun so its shadow box is centred on `focus` (+ a lead toward where `view` looks),
 * texel-snapped in light space. `dir` points from the scene toward the sun (level def `sun.dir`).
 */
export function updateSun(
  sun: THREE.DirectionalLight,
  focus: THREE.Vector3,
  dir: THREE.Vector3 | readonly [number, number, number],
  view?: THREE.Camera,
): void {
  const d = sunData.get(sun) ?? { dist: DEF.dist, lead: 0 };
  if (dir instanceof THREE.Vector3) _dir.copy(dir); else _dir.set(dir[0], dir[1], dir[2]);
  if (_dir.lengthSq() < 1e-8) _dir.set(0, 1, 0);
  _dir.normalize();
  _f.copy(focus);
  if (view && d.lead > 0) {
    view.getWorldDirection(_fw);
    _fw.y = 0;
    const l = _fw.length();
    if (l > 1e-4) _f.addScaledVector(_fw, d.lead / l);
  }
  // Light-space basis exactly as LightShadow.updateMatrices builds it (camera.lookAt(target) with up = camera.up):
  // z = dir (eye - target), x = up × z, y = z × x.
  const up = sun.shadow.camera.up;
  _x.crossVectors(up, _dir);
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0);
  _x.normalize();
  _y.crossVectors(_dir, _x);
  const sc = sun.shadow.camera;
  const texel = (sc.right - sc.left) / Math.max(1, sun.shadow.mapSize.x);
  const fx = Math.round(_f.dot(_x) / texel) * texel;
  const fy = Math.round(_f.dot(_y) / texel) * texel;
  const fz = focus.dot(_dir); // depth stays anchored on the player (the lead only shifts the box sideways)
  _f.set(0, 0, 0).addScaledVector(_x, fx).addScaledVector(_y, fy).addScaledVector(_dir, fz);
  sun.target.position.copy(_f);
  sun.position.copy(_f).addScaledVector(_dir, d.dist);
}
