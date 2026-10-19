import * as THREE from 'three';
import type { Renderer3D } from './render';

/** Window/overlay mapping shared by all 3D scenes. UI is drawn in a 1280×720 logical space centered in the window. */
export const RT = {
  r3: null as Renderer3D | null,
  winW: 1280,
  winH: 720,
  scale: 1,
  ox: 0,
  oy: 0,
};

const tmp = new THREE.Vector3();

/**
 * Camera zoom (≤ 1) that makes a window narrower than 16:9 show a cinematic shot's whole 16:9 framing inside the
 * UI band (the black bars cover the rest); 1 for 16:9 and wider windows.
 */
export function cineZoom() {
  return Math.min(1, RT.winW / RT.winH / (1280 / 720));
}

/** the part of the window that is visible, in UI logical coordinates (wider/taller than 1280×720 off-16:9) */
export function viewUI() {
  return { x0: -RT.ox / RT.scale, y0: -RT.oy / RT.scale, x1: (RT.winW - RT.ox) / RT.scale, y1: (RT.winH - RT.oy) / RT.scale };
}

/** project a world point into UI logical coordinates */
export function toUI(p: THREE.Vector3, cam: THREE.Camera): { x: number; y: number; vis: boolean } {
  tmp.copy(p).project(cam);
  const vis = tmp.z < 1 && tmp.z > -1;
  const wx = (tmp.x * 0.5 + 0.5) * RT.winW;
  const wy = (-tmp.y * 0.5 + 0.5) * RT.winH;
  return { x: (wx - RT.ox) / RT.scale, y: (wy - RT.oy) / RT.scale, vis };
}
