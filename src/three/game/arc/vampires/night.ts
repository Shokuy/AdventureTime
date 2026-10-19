import * as THREE from 'three';
import type { Level3D } from '../../level';
import { noOutline, canvasTex } from '../../../gfx';
import { clamp, lerp } from '../../../models/kit';
import { discTex } from './fxUtil';

/**
 * Night look of «Ночь клыков»: a lighting preset (moonlight, fog, sky gradient) with a «red moon» variant, and a big
 * moon in the sky (pale ↔ red). `red` is 0..1 and can be blended over a few seconds (the Алая луна rising / paling).
 * Scripts run on every machine, so calling set() from a story script looks the same for everyone.
 */

export interface NightOpts {
  /** 0 = pale moonlit night, 1 = red moon night */
  red?: number;
  /** fog near / far (m) */
  fog?: [number, number];
  /** direction toward the moon (moonlight + the moon in the sky); default from the south-west, high */
  moonDir?: [number, number, number];
  /** 0..1 how dark (0.5 default) */
  dark?: number;
}

const PALE = { bg: '#141a3c', fog: '#1d2450', sky: '#7d8cd0', ground: '#2a1d40', light: '#c4d0ff', zenith: '#070a1e', horizon: '#2e3a74' };
const RED = { bg: '#2a0d20', fog: '#3a1028', sky: '#d07890', ground: '#2c1022', light: '#ff9e9e', zenith: '#12040c', horizon: '#6a1a34' };
const c1 = new THREE.Color(), c2 = new THREE.Color();
const mix = (a: string, b: string, k: number, out: THREE.Color) => out.set(a).lerp(c2.set(b), k);

export class NightCtl {
  red: number;
  private from = 0; private to = 0; private t = 0; private dur = 0;
  private sky: THREE.Mesh;
  private skyCols: THREE.BufferAttribute;
  private dark: number;
  /** the fog colour this preset wants (zones tint on top of it) */
  fogColor = new THREE.Color();
  constructor(private L: Level3D, o: NightOpts) {
    this.red = clamp(o.red ?? 0, 0, 1);
    this.dark = clamp(o.dark ?? 0.5, 0, 1);
    const d = L.def;
    const md = o.moonDir ?? [-0.45, 0.62, -0.65];
    d.sun.dir[0] = md[0]; d.sun.dir[1] = md[1]; d.sun.dir[2] = md[2];
    const fog = L.scene.fog as THREE.Fog | null;
    if (fog) { fog.near = o.fog?.[0] ?? 28; fog.far = o.fog?.[1] ?? 105; }
    // gradient sky dome (follows the camera; fog-free, behind everything)
    const g = new THREE.SphereGeometry(480, 24, 12);
    const n = g.attributes.position.count;
    this.skyCols = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    g.setAttribute('color', this.skyCols);
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false });
    this.sky = new THREE.Mesh(g, m);
    this.sky.renderOrder = -1000; this.sky.frustumCulled = false;
    noOutline(this.sky);
    L.scene.add(this.sky);
    this.apply();
  }
  /** blend to `red` (0 pale … 1 red) over `secs` */
  set(red: number, secs = 2) {
    this.from = this.red; this.to = clamp(red, 0, 1); this.t = 0; this.dur = Math.max(0.001, secs);
    if (secs <= 0) { this.red = this.to; this.dur = 0; this.apply(); }
  }
  update(dt: number) {
    if (this.dur > 0) {
      this.t += dt;
      const k = clamp(this.t / this.dur, 0, 1);
      this.red = lerp(this.from, this.to, k * k * (3 - 2 * k));
      if (k >= 1) this.dur = 0;
      this.apply();
    }
    this.sky.position.copy(this.L.tcam.cam.position);
  }
  private apply() {
    const L = this.L, r = this.red, dk = this.dark;
    mix(PALE.bg, RED.bg, r, c1);
    if (L.scene.background instanceof THREE.Color) L.scene.background.copy(c1); else L.scene.background = c1.clone();
    mix(PALE.fog, RED.fog, r, this.fogColor);
    const fog = L.scene.fog as THREE.Fog | null;
    if (fog) fog.color.copy(this.fogColor);
    mix(PALE.sky, RED.sky, r, L.hemi.color);
    mix(PALE.ground, RED.ground, r, L.hemi.groundColor);
    L.hemi.intensity = lerp(1.15, 0.7, dk);
    mix(PALE.light, RED.light, r, L.sun.color);
    L.sun.intensity = lerp(1.7, 1.0, dk);
    // sky gradient by height
    const pos = this.sky.geometry.attributes.position as THREE.BufferAttribute;
    const zen = mix(PALE.zenith, RED.zenith, r, new THREE.Color()), hor = mix(PALE.horizon, RED.horizon, r, new THREE.Color());
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 480;
      const k = clamp((y + 0.05) / 0.6, 0, 1);
      c1.copy(hor).lerp(zen, Math.sqrt(k));
      this.skyCols.setXYZ(i, c1.r, c1.g, c1.b);
    }
    this.skyCols.needsUpdate = true;
  }
  dispose() { this.sky.removeFromParent(); this.sky.geometry.dispose(); (this.sky.material as THREE.Material).dispose(); }
}

// ───────────────────────── the moon ─────────────────────────

export interface MoonOpts {
  /** direction from the viewer (default: the night's moon direction) */
  dir?: [number, number, number];
  /** apparent size (radius at 300 m) */
  size?: number;
  /** 0 pale … 1 red */
  red?: number;
  /** a few hundred stars around (default true) */
  stars?: boolean;
}

let moonTexC: THREE.Texture | null = null;
function moonTex() {
  if (moonTexC) return moonTexC;
  moonTexC = canvasTex(256, 256, (g, w, h) => {
    const cx = w / 2, cy = h / 2, R = w / 2 - 2;
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    // craters (cartoon blobs), a soft terminator
    const cr: [number, number, number][] = [[-0.35, -0.25, 0.2], [0.25, -0.38, 0.12], [0.3, 0.15, 0.22], [-0.2, 0.35, 0.14], [0.02, 0.0, 0.09], [-0.5, 0.1, 0.08]];
    for (const [x, y, r] of cr) {
      g.fillStyle = 'rgba(150,150,170,0.55)'; g.beginPath(); g.arc(cx + x * R, cy + y * R, r * R, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(cx + x * R - r * R * 0.25, cy + y * R - r * R * 0.25, r * R * 0.6, 0, Math.PI * 2); g.fill();
    }
    const sh = g.createRadialGradient(cx + R * 0.5, cy + R * 0.4, R * 0.2, cx, cy, R * 1.2);
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(60,50,90,0.35)');
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = sh; g.fillRect(0, 0, w, h);
  });
  return moonTexC;
}

export class MoonCtl {
  red: number;
  group = new THREE.Group();
  private disc: THREE.Mesh;
  private halo: THREE.Mesh;
  private stars: THREE.Points | null = null;
  private from = 0; private to = 0; private t = 0; private dur = 0;
  private dir: THREE.Vector3;
  constructor(private L: Level3D, o: MoonOpts) {
    this.red = clamp(o.red ?? 0, 0, 1);
    const d = o.dir ?? L.def.sun.dir;
    this.dir = new THREE.Vector3(d[0], d[1], d[2]).normalize();
    const size = o.size ?? 26;
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(size, 48), new THREE.MeshBasicMaterial({ map: moonTex(), transparent: true, fog: false, depthWrite: false }));
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(size * 5.5, size * 5.5), new THREE.MeshBasicMaterial({ map: discTex(), transparent: true, blending: THREE.AdditiveBlending, fog: false, depthWrite: false, opacity: 0.55 }));
    this.halo.position.z = -1;
    this.group.add(this.halo, this.disc);
    if (o.stars !== false) {
      const n = 420, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, y = Math.abs(u) * 0.95 + 0.05;
        const r = Math.sqrt(1 - y * y);
        a[i * 3] = Math.cos(th) * r * 420; a[i * 3 + 1] = y * 420; a[i * 3 + 2] = Math.sin(th) * r * 420;
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3));
      this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#e8ecff', size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
      this.stars.frustumCulled = false; this.stars.renderOrder = -999;
    }
    this.group.renderOrder = -998;
    this.disc.renderOrder = -997; this.halo.renderOrder = -998;
    noOutline(this.group);
    L.scene.add(this.group);
    if (this.stars) { noOutline(this.stars); L.scene.add(this.stars); }
    this.apply();
  }
  /** blend to `red` (0 pale … 1 red) over `secs` */
  set(red: number, secs = 2) {
    this.from = this.red; this.to = clamp(red, 0, 1); this.t = 0; this.dur = Math.max(0.001, secs);
  }
  update(dt: number) {
    if (this.dur > 0) {
      this.t += dt;
      const k = clamp(this.t / this.dur, 0, 1);
      this.red = lerp(this.from, this.to, k * k * (3 - 2 * k));
      if (k >= 1) this.dur = 0;
      this.apply();
    }
    const cam = this.L.tcam.cam;
    this.group.position.copy(cam.position).addScaledVector(this.dir, 300);
    this.group.lookAt(cam.position);
    if (this.stars) this.stars.position.copy(cam.position);
  }
  private apply() {
    (this.disc.material as THREE.MeshBasicMaterial).color.set('#fff6e0').lerp(c2.set('#ff3a3a'), this.red);
    const hm = this.halo.material as THREE.MeshBasicMaterial;
    hm.color.set('#7f94ff').lerp(c2.set('#ff2030'), this.red);
    hm.opacity = 0.45 + this.red * 0.25;
  }
  dispose() { this.group.removeFromParent(); this.stars?.removeFromParent(); }
}
