import type * as THREE from 'three';

/** A procedural character: `root` goes into the scene, `update` animates it from a plain anim-state object. */
export interface Rig<A> {
  root: THREE.Group;
  update(dt: number, a: A): void;
}
