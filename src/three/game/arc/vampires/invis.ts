import * as THREE from 'three';
import { LAYER_NO_OUTLINE } from '../../../gfx';
import { damp } from '../../../models/kit';

/**
 * Invisibility — a reusable flag for any enemy or boss: give it `new Invisibility(rigRoot, blob)`, decide on the host
 * what should show with think(), replicate `vis` (one number) and call apply() every frame on every machine.
 * Shows in light (lanterns, beacons), in dust / pollen, for a while after a hit or a reveal (Ноки's chord).
 * Drawn with dithered alpha (alphaHash: no sorting trouble, a ghostly shimmer when half-seen); while mostly invisible
 * it drops out of the outline pass and casts no shadow (both would give it away).
 */
export class Invisibility {
  /** what is drawn (0 invisible … 1 fully visible) */
  vis = 0;
  /** host: where vis is heading */
  goal = 0;
  /** seconds of forced visibility left (hit, chord) */
  revealT = 0;
  /** faint shimmer while moving in the dark (0 = truly invisible) */
  shimmer = 0.08;
  private mats: THREE.Material[] = [];
  private meshes: { m: THREE.Mesh; mask: number; cast: boolean }[] = [];
  private outlined = true;
  private shadowed = true;
  private last = -1;
  constructor(root: THREE.Object3D, private blob?: THREE.Object3D | null) {
    const seen = new Set<THREE.Material>();
    root.traverse((o) => {
      const me = o as THREE.Mesh;
      if (!me.isMesh) return;
      this.meshes.push({ m: me, mask: me.layers.mask, cast: me.castShadow });
      for (const m of Array.isArray(me.material) ? me.material : [me.material]) {
        if (seen.has(m)) continue;
        seen.add(m);
        m.alphaHash = true;
        m.needsUpdate = true;
        this.mats.push(m);
      }
    });
  }
  reveal(secs: number) { this.revealT = Math.max(this.revealT, secs); }
  /** host: what should show now (`sun` = light on it 0..1, `dust` = in dust / pollen) */
  think(dt: number, o: { sun: number; dust: boolean; moving: boolean; extra?: number }) {
    this.revealT = Math.max(0, this.revealT - dt);
    let g = o.moving ? this.shimmer : this.shimmer * 0.4;
    if (o.dust) g = Math.max(g, 0.5);
    if (o.sun > 0.25) g = Math.max(g, 0.9);
    if (this.revealT > 0) g = 1;
    if (o.extra !== undefined) g = Math.max(g, o.extra);
    this.goal = g;
  }
  /** every machine: ease toward the goal (host) or the replicated value (clients pass `to`) */
  apply(dt: number, to = this.goal) {
    this.vis = damp(this.vis, to, to > this.vis ? 9 : 3, dt);
    if (this.blob && this.vis <= 0.4) this.blob.visible = false; // (Enemy3.sync shows it every frame)
    if (Math.abs(this.vis - this.last) < 0.004) return;
    this.last = this.vis;
    // (dithered alpha: snap the ends, or a "visible" one keeps a few holes)
    const v = this.vis > 0.97 ? 1 : this.vis < 0.02 ? 0 : this.vis;
    for (const m of this.mats) m.opacity = v;
    const outl = v > 0.6, shad = v > 0.45;
    if (outl !== this.outlined) {
      this.outlined = outl;
      for (const x of this.meshes) { if (outl) x.m.layers.mask = x.mask; else x.m.layers.set(LAYER_NO_OUTLINE); }
    }
    if (shad !== this.shadowed) {
      this.shadowed = shad;
      for (const x of this.meshes) x.m.castShadow = shad && x.cast;
    }
  }
}
