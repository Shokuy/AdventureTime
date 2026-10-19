import type * as THREE from 'three';

/**
 * World collision primitives. The world is static axis-aligned boxes and vertical cylinders
 * (plus optional moving boxes). Characters are vertical cylinders (radius + height).
 * Y is up. All coordinates in world units (1 ≈ hero height).
 */
export interface BoxCol {
  kind: 'box';
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** bounce velocity when landed on (jelly) */
  bounce?: number;
  /** cookie platforms that crumble after standing on them */
  crumbly?: boolean;
  /** set false to disable (crumbled, gates opened) */
  active?: boolean;
  /** optional mesh to animate (wobble/crumble) */
  obj?: THREE.Object3D;
  tag?: string;
}

export interface CylCol {
  kind: 'cyl';
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
  bounce?: number;
  active?: boolean;
  obj?: THREE.Object3D;
  tag?: string;
  /** can only be landed on from above (a friend's head): never pushes sideways or blocks jumps */
  oneWay?: boolean;
}

export type Collider = BoxCol | CylCol;

/** Damaging volume (forks, soup, jam). Touching it hurts and returns the player to the last safe spot. */
export interface Hazard {
  min: THREE.Vector3;
  max: THREE.Vector3;
  kind: 'forks' | 'soup' | 'jam' | 'pins' | 'fire';
  dmg: number;
}

/** What every prop/room builder returns. */
export interface Built {
  obj: THREE.Object3D;
  colliders: Collider[];
  hazards?: Hazard[];
  /** point lights the level should register (they are already children of obj) */
  lights?: THREE.PointLight[];
  /** per-frame animation (flames flicker, liquids wobble...) */
  update?: (t: number, dt: number) => void;
}
