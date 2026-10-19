import * as THREE from 'three';
import { rand, choose } from '../engine/util';
import { noOutline, canvasTex, mat } from './gfx';

const MAX = 2400;

interface P {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  life: number; max: number; size: number; size2: number; g: number; drag: number;
  r: number; gc: number; b: number; floor: number; bounce: number;
}

export interface Emit3 {
  count?: number;
  speed?: [number, number];
  dir?: THREE.Vector3;   // main direction (normalized); default up
  spread?: number;       // 0..1 (1 = full sphere)
  life?: [number, number];
  size?: [number, number];
  size2?: number;        // end size multiplier
  colors?: string[];
  g?: number;
  drag?: number;
  jitter?: number;       // spawn position jitter radius
  floor?: number;        // y to bounce on
  bounce?: number;
}

class PointSystem {
  points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private siz = new Float32Array(MAX);
  private alp = new Float32Array(MAX);
  list: P[] = [];
  private tmpC = new THREE.Color();

  constructor(additive: boolean) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alp, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 } },
      vertexShader: /* glsl */`
        attribute float size; attribute float alpha; attribute vec3 color;
        varying vec3 vColor; varying float vAlpha;
        uniform float scale;
        void main() {
          vColor = color; vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = vAlpha * smoothstep(0.5, 0.32, d);
          gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, m);
    this.points.frustumCulled = false;
    noOutline(this.points);
  }

  setScale(px: number) { (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = px; }

  emit(at: THREE.Vector3, o: Emit3) {
    const n = o.count ?? 8;
    const dir = o.dir ?? new THREE.Vector3(0, 1, 0);
    const spread = o.spread ?? 1;
    for (let i = 0; i < n; i++) {
      if (this.list.length >= MAX) this.list.shift();
      // random direction in a cone around dir
      const v = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
      v.lerp(dir, 1 - spread).normalize();
      const s = rand(o.speed?.[0] ?? 1, o.speed?.[1] ?? 4);
      const life = rand(o.life?.[0] ?? 0.4, o.life?.[1] ?? 0.9);
      this.tmpC.set(choose(o.colors ?? ['#ffffff']));
      const j = o.jitter ?? 0;
      this.list.push({
        x: at.x + rand(-j, j), y: at.y + rand(-j, j), z: at.z + rand(-j, j),
        vx: v.x * s, vy: v.y * s, vz: v.z * s, life, max: life,
        size: rand(o.size?.[0] ?? 0.1, o.size?.[1] ?? 0.25), size2: o.size2 ?? 0.3,
        g: o.g ?? 0, drag: o.drag ?? 1.5, r: this.tmpC.r, gc: this.tmpC.g, b: this.tmpC.b,
        floor: o.floor ?? -1e9, bounce: o.bounce ?? 0.3,
      });
    }
  }

  update(dt: number) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) { L[i] = L[L.length - 1]; L.pop(); continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vz *= d; p.vy = p.vy * d - p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < p.floor && p.vy < 0) { p.y = p.floor; p.vy *= -p.bounce; p.vx *= 0.6; p.vz *= 0.6; }
    }
    const n = L.length;
    for (let i = 0; i < n; i++) {
      const p = L[i];
      const k = p.life / p.max;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.col[i * 3] = p.r; this.col[i * 3 + 1] = p.gc; this.col[i * 3 + 2] = p.b;
      this.siz[i] = p.size * (p.size2 + (1 - p.size2) * k);
      this.alp[i] = Math.min(1, k * 2.5);
    }
    this.geo.setDrawRange(0, n);
    for (const a of ['position', 'color', 'size', 'alpha']) (this.geo.getAttribute(a) as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() { this.list.length = 0; }
}

// ───────────── debris: small tumbling chunks with bounce ─────────────
interface D { p: THREE.Vector3; v: THREE.Vector3; rot: THREE.Euler; vr: THREE.Vector3; life: number; s: number; floor: number; c: THREE.Color }
const DMAX = 260;

class Debris {
  mesh: THREE.InstancedMesh;
  list: D[] = [];
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private sc = new THREE.Vector3();
  constructor() {
    const g = new THREE.TetrahedronGeometry(1, 0);
    this.mesh = new THREE.InstancedMesh(g, mat('#ffffff'), DMAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    const c = new THREE.Color('#fff');
    for (let i = 0; i < DMAX; i++) this.mesh.setColorAt(i, c);
  }
  emit(at: THREE.Vector3, n: number, colors: string[], o: { speed?: [number, number]; size?: [number, number]; floor?: number; up?: number } = {}) {
    for (let i = 0; i < n; i++) {
      if (this.list.length >= DMAX) this.list.shift();
      const a = rand(0, Math.PI * 2);
      const sp = rand(o.speed?.[0] ?? 2, o.speed?.[1] ?? 6);
      this.list.push({
        p: at.clone().add(new THREE.Vector3(rand(-0.15, 0.15), rand(0, 0.2), rand(-0.15, 0.15))),
        v: new THREE.Vector3(Math.cos(a) * sp, rand(3, 7) + (o.up ?? 0), Math.sin(a) * sp),
        rot: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)),
        vr: new THREE.Vector3(rand(-10, 10), rand(-10, 10), rand(-10, 10)),
        life: rand(1.2, 2.2), s: rand(o.size?.[0] ?? 0.06, o.size?.[1] ?? 0.14), floor: o.floor ?? at.y,
        c: new THREE.Color(choose(colors)),
      });
    }
  }
  update(dt: number) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const d = L[i];
      d.life -= dt;
      if (d.life <= 0) { L.splice(i, 1); continue; }
      d.v.y -= 22 * dt;
      d.p.addScaledVector(d.v, dt);
      if (d.p.y < d.floor + d.s * 0.5 && d.v.y < 0) { d.p.y = d.floor + d.s * 0.5; d.v.y *= -0.35; d.v.x *= 0.6; d.v.z *= 0.6; d.vr.multiplyScalar(0.6); }
      d.rot.x += d.vr.x * dt; d.rot.y += d.vr.y * dt; d.rot.z += d.vr.z * dt;
    }
    const n = L.length;
    for (let i = 0; i < n; i++) {
      const d = L[i];
      const s = d.s * Math.min(1, d.life * 2);
      this.sc.set(s, s, s);
      this.q.setFromEuler(d.rot);
      this.m4.compose(d.p, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m4);
      this.mesh.setColorAt(i, d.c);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.list.length = 0; this.mesh.count = 0; }
}

// ───────────── rings (impacts / shockwaves visuals) ─────────────
interface R { m: THREE.Mesh; life: number; max: number; r0: number; r1: number }

export interface FloatText { pos: THREE.Vector3; text: string; color: string; size: number; life: number; max: number }

let blobTex: THREE.Texture | null = null;
function blobTexture() {
  if (blobTex) return blobTex;
  blobTex = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(20,6,10,0.6)');
    gr.addColorStop(0.6, 'rgba(20,6,10,0.35)');
    gr.addColorStop(1, 'rgba(20,6,10,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
  return blobTex;
}

export function makeBlob(radius: number) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  noOutline(m);
  return m;
}

export class FX3 {
  group = new THREE.Group();
  soft = new PointSystem(false);
  glow = new PointSystem(true);
  debris = new Debris();
  rings: R[] = [];
  texts: FloatText[] = [];
  private ringGeo = new THREE.RingGeometry(0.85, 1, 48);

  constructor() {
    this.group.add(this.soft.points, this.glow.points, this.debris.mesh);
  }

  setScale(px: number) { this.soft.setScale(px); this.glow.setScale(px); }

  emit(at: THREE.Vector3, o: Emit3) { this.soft.emit(at, o); }
  sparks(at: THREE.Vector3, n = 12, colors = ['#fff6c0', '#ffd34a', '#ffffff']) {
    this.glow.emit(at, { count: n, speed: [3, 9], life: [0.15, 0.4], size: [0.08, 0.18], colors, drag: 5 });
  }
  dust(at: THREE.Vector3, n = 8, color = '#e8d8c0') {
    this.soft.emit(at, { count: n, speed: [0.6, 2.2], dir: new THREE.Vector3(0, 1, 0), spread: 0.8, life: [0.3, 0.6], size: [0.12, 0.26], size2: 1.6, colors: [color], g: -0.6, drag: 3, jitter: 0.15 });
  }
  juice(at: THREE.Vector3, n = 16, colors = ['#ff4d6d', '#ff7a8a', '#d92b4a'], floor?: number) {
    this.soft.emit(at, { count: n, speed: [2, 6], dir: new THREE.Vector3(0, 1, 0), spread: 0.7, life: [0.5, 1], size: [0.08, 0.16], colors, g: 18, drag: 0.5, floor, bounce: 0.2 });
  }
  stars(at: THREE.Vector3, n = 20, colors = ['#ffe14a', '#ffffff', '#ffb02a']) {
    this.glow.emit(at, { count: n, speed: [1.5, 5], life: [0.5, 1.1], size: [0.1, 0.22], colors, drag: 2.5, g: -1 });
  }
  chunks(at: THREE.Vector3, n: number, colors: string[], floor?: number, size?: [number, number]) {
    this.debris.emit(at, n, colors, { floor, size });
  }
  ring(at: THREE.Vector3, r1: number, color = '#ffffff', life = 0.4, flatY = true) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false }));
    m.position.copy(at);
    if (flatY) m.rotation.x = -Math.PI / 2;
    noOutline(m);
    this.group.add(m);
    this.rings.push({ m, life, max: life, r0: r1 * 0.15, r1 });
  }
  text(at: THREE.Vector3, text: string, color = '#ffffff', size = 22) {
    this.texts.push({ pos: at.clone(), text, color, size, life: 0.9, max: 0.9 });
  }

  update(dt: number) {
    this.soft.update(dt);
    this.glow.update(dt);
    this.debris.update(dt);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const k = 1 - r.life / r.max;
      const s = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k));
      r.m.scale.set(s, s, s);
      (r.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k);
      if (r.life <= 0) { this.group.remove(r.m); (r.m.material as THREE.Material).dispose(); this.rings.splice(i, 1); }
    }
    for (const t of this.texts) { t.life -= dt; t.pos.y += dt * 1.2; }
    this.texts = this.texts.filter((t) => t.life > 0);
  }

  clear() {
    this.soft.clear(); this.glow.clear(); this.debris.clear();
    for (const r of this.rings) this.group.remove(r.m);
    this.rings.length = 0; this.texts.length = 0;
  }
}
