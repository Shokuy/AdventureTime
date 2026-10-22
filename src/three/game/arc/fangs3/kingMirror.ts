import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { clamp } from '../../../../engine/util';
import { drawPortrait } from '../../../../art/portraits';
import { basic, noOutline } from '../../../gfx';
import type { BoxCol } from '../../../physics/types';
import type { Level3D } from '../../level';
import { ambient } from '../vampires';
import { M, type Batch } from './props';
import { mirrorFaceMat, mirrorTex, type Panel } from './mirrors';

/**
 * The big north mirror of the dome (docs/script-fangs-v2.md §7.6): it stands in front of the way out. In the ending
 * the dome's mirrors go dark at once, and in this one, instead of a reflection, the face of Король Полночь looks out
 * and talks (a canvas of his portrait behind the glass, the mouth moving with his lines). Ноки breaks it — ДЗЫНЬ —
 * and the way out behind it is free. Visuals local to every machine; the scene drives it.
 */
export class KingMirror {
  readonly pos: THREE.Vector3;
  panel: Panel;
  private glass: THREE.Mesh;
  private glassM: THREE.MeshBasicMaterial;
  private face: THREE.Mesh;
  private faceM: THREE.MeshBasicMaterial;
  private cv: HTMLCanvasElement;
  private tex: THREE.CanvasTexture;
  private col: BoxCol;
  private stubs: THREE.Group;
  private glow: THREE.PointLight | null = null;
  /** 0 a mirror .. 1 the King's face fully there */
  king = 0;
  /** 0..1 the mouth (set while he talks) */
  talk = 0;
  broken = false;
  private t = 0;
  private drawnT = -1;
  constructor(private L: Level3D, B: Batch, x: number, z: number, readonly w = 4.6, readonly h = 6.4) {
    this.pos = new THREE.Vector3(x, 0, z);
    const iron = M.iron(), brass = M.brass();
    // the frame: two posts, a crown arch on top, a plinth (batched: it stays when the glass breaks)
    for (const s of [-1, 1]) B.box(iron, x + s * (w / 2 + 0.1), h / 2, z, 0.34, h, 0.34);
    B.box(brass, x, h + 0.1, z, w + 0.6, 0.3, 0.4);
    B.box(iron, x, 0.2, z, w + 0.7, 0.4, 0.6);
    const crown = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.12, 8, 24, Math.PI), brass);
    crown.position.set(x, h + 0.25, z); L.deco(crown);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), basic('#e8e4f4'));
    moon.position.set(x, h + 0.9, z); L.deco(moon);
    // the glass (its own material: it can go dark without the other mirrors' batch) and the face behind it
    this.glassM = new THREE.MeshBasicMaterial({ map: mirrorTex(), color: '#ffffff' });
    this.glass = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, h - 0.4), this.glassM);
    this.glass.position.set(x, h / 2 + 0.1, z + 0.14);
    noOutline(this.glass); L.deco(this.glass);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, h - 0.4), mirrorFaceMat());
    back.position.set(x, h / 2 + 0.1, z - 0.14); back.rotation.y = Math.PI;
    noOutline(back); L.deco(back);
    this.cv = document.createElement('canvas'); this.cv.width = 256; this.cv.height = 352;
    this.tex = new THREE.CanvasTexture(this.cv); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.faceM = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, opacity: 0, depthWrite: false });
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, h - 0.4), this.faceM);
    this.face.position.set(x, h / 2 + 0.1, z + 0.16);
    this.face.renderOrder = 8;
    noOutline(this.face); L.scene.add(this.face);
    this.face.visible = false;
    // jagged stubs of glass left in the frame once it's broken
    this.stubs = new THREE.Group();
    const sm = basic('#cfe8ff', { transparent: true, opacity: 0.75 });
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.22 + (i % 3) * 0.08, 0.6 + (i % 4) * 0.3, 3), sm);
      const side = i % 3; // left post, right post, top
      if (side === 2) { s.position.set(x - w / 2 + 0.4 + (i / 9) * (w - 0.8), h - 0.4, z); s.rotation.z = Math.PI; }
      else { const sx = side ? 1 : -1; s.position.set(x + sx * (w / 2 - 0.25), 0.8 + (i / 9) * (h - 1.6), z); s.rotation.z = sx * Math.PI / 2; }
      s.scale.z = 0.25;
      noOutline(s); this.stubs.add(s);
    }
    this.stubs.visible = false;
    L.scene.add(this.stubs);
    // the wall it stands for (until broken)
    this.col = { kind: 'box', min: new THREE.Vector3(x - w / 2 - 0.3, -0.5, z - 0.3), max: new THREE.Vector3(x + w / 2 + 0.3, h + 0.4, z + 0.3) };
    L.col(this.col);
    this.panel = { c: new THREE.Vector3(x, 0, z + 0.14), n: new THREE.Vector3(0, 0, 1), u: new THREE.Vector3(1, 0, 0), hw: w / 2 - 0.25, y0: 0.4, y1: h - 0.3 };
  }

  /** 0..1 how dark the glass is (the dome's mirrors darken at once, К3) */
  setDark(k: number) { this.glassM.color.setScalar(1 - 0.85 * clamp(k, 0, 1)); }

  update(dt: number) {
    this.t += dt;
    const on = this.king > 0.01 && !this.broken;
    this.face.visible = on;
    if (!on) { if (this.glow) this.glow.intensity = 0; return; }
    this.faceM.opacity = this.king;
    // (redrawn ~30 times a second while he is there)
    if (this.t - this.drawnT > 0.033) { this.drawnT = this.t; this.paint(); }
  }

  private paint() {
    const g = this.cv.getContext('2d')!;
    const w = this.cv.width, h = this.cv.height;
    g.clearRect(0, 0, w, h);
    // a dark red-black depth behind the glass
    const bg = g.createRadialGradient(w / 2, h * 0.42, 10, w / 2, h * 0.45, h * 0.7);
    bg.addColorStop(0, '#5a2030'); bg.addColorStop(0.55, '#24101c'); bg.addColorStop(1, '#0a0408');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    // his face, big (the round portrait's rim is lost in the vignette)
    drawPortrait(g, 'polnoch', w / 2, h * 0.43, 132, this.t, this.talk, 'normal');
    const vg = g.createRadialGradient(w / 2, h * 0.43, 90, w / 2, h * 0.45, 190);
    vg.addColorStop(0, 'rgba(10,4,8,0)'); vg.addColorStop(0.55, 'rgba(10,4,8,0.55)'); vg.addColorStop(1, 'rgba(10,4,8,0.98)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
    // a sheen of glass over it
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.beginPath(); g.moveTo(0, h * 0.2); g.lineTo(w * 0.55, 0); g.lineTo(w * 0.75, 0); g.lineTo(0, h * 0.35); g.fill();
    this.tex.needsUpdate = true;
  }

  /** ДЗЫНЬ: the glass flies to pieces, the way behind is free (every machine) */
  shatter(fx = true) {
    if (this.broken) return;
    this.broken = true;
    this.king = 0;
    this.glass.visible = false; this.face.visible = false;
    this.stubs.visible = true;
    this.col.active = false;
    this.panel.fake = true;
    if (!fx) return;
    const L = this.L, c = this.glass.position.clone();
    ambient(L, () => {
      for (let i = 0; i < 4; i++) L.fx.emit(c.clone().add(new THREE.Vector3((i - 1.5) * 1.1, (i % 2) * 1.2 - 0.6, 0.3)), { count: 22, speed: [2, 7], dir: new THREE.Vector3(0, 0.4, 1), spread: 1.2, life: [0.6, 1.3], size: [0.12, 0.32], size2: 0.6, colors: ['#e8f6ff', '#bfe0ff', '#ffffff', '#9ac8f0'], g: -14, drag: 0.6 });
      L.fx.sparks(c, 18, ['#ffffff', '#cfe8ff']);
      audio.sfx('break', { pitch: 1.2 }); audio.sfx('clang', { pitch: 1.6, volume: 0.8 }); audio.sfx('reflect', { pitch: 0.7 });
    });
    L.tcam.shake(0.3);
    L.whiteFlash = Math.max(L.whiteFlash, 0.35);
  }
}
