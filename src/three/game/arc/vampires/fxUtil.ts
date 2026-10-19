import * as THREE from 'three';
import type { Level3D } from '../../level';
import { basic, noOutline, canvasTex } from '../../../gfx';

/**
 * Effects every machine draws for itself from replicated state (mist clouds, smoke of a vampire in the light, the
 * grey drips of a «пресный» hero): on the co-op host they must not be captured and re-sent as fx batches every frame.
 */
export function ambient(L: Level3D, f: () => void) {
  const nl = L.nl;
  if (!nl || !nl.capturing) { f(); return; }
  nl.capturing = false;
  try { f(); } finally { nl.capturing = true; }
}

let poolTex: THREE.Texture | null = null;
/** soft radial disc (light pools on the ground, telegraph discs) */
export function discTex() {
  if (poolTex) return poolTex;
  poolTex = canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.55)');
    gr.addColorStop(0.85, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  return poolTex;
}
let ringTexC: THREE.Texture | null = null;
function ringTex() {
  if (ringTexC) return ringTexC;
  ringTexC = canvasTex(128, 128, (g, w, h) => {
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 9;
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 7, 0, Math.PI * 2); g.stroke();
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  return ringTexC;
}

/** a flat marker on the ground (attack telegraphs): ring or disc, any radius; lives in L.scene */
export class GroundMark {
  mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  constructor(color = '#ff3a4a', ring = true) {
    this.mat = basic(color, { additive: true, transparent: true, opacity: 0.6, depthWrite: false, map: ring ? ringTex() : discTex() });
    this.mat.polygonOffset = true; this.mat.polygonOffsetFactor = -4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), this.mat);
    this.mesh.renderOrder = 3;
    noOutline(this.mesh);
    this.mesh.visible = false;
  }
  show(L: Level3D, x: number, y: number, z: number, r: number, alpha: number) {
    if (!this.mesh.parent) L.scene.add(this.mesh);
    const gy = L.phys.groundAt(x, z, y + 0.6, 0.05);
    this.mesh.position.set(x, (gy > -1e8 ? gy : y) + 0.05, z);
    this.mesh.scale.set(r, 1, r);
    this.mat.opacity = alpha;
    this.mesh.visible = alpha > 0.01;
  }
  hide() { this.mesh.visible = false; }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); }
}
