import * as THREE from 'three';
import { rand, choose } from '../../../../engine/util';
import { canvasTex, noOutline, mat } from '../../../gfx';
import { TAU, clamp, cached } from '../../../models/kit';
import type { Level3D, Actor3 } from '../../level';
import { ambient } from './fxUtil';

/**
 * Hand-made VFX of «Ночь клыков» (no assets, all procedural):
 *   puffTex / glintTex / crackTex — canvas textures (wispy noise puffs atlas, a 4-point eye glint, radial ground cracks);
 *   Billboards — one draw call of camera-facing, rotating, tinted puffs (instanced quads, fog-aware);
 *   PuffFx     — per-level simulated soft puffs (mist, smoke, dust, ash) — local on every machine (never captured);
 *   MistBody   — a rig-attached swirling mist column (Туманник's lower body, mist form, dissolving);
 *   TeleMark   — animated ground telegraphs (filling disc, target, lane);
 *   QuakeFx    — the brute's shockwave: shimmering wall with height falloff, ground ripple, cracks, shards, dust, debris;
 *   DeathPoof  — a beaten vampire's rig pops into smoke / mist / ash and little bats.
 * Everything here is drawn from replicated state on every machine, so L.fx calls inside are wrapped in ambient().
 */

// ───────────────────────── noise ─────────────────────────
function hash2(x: number, y: number, s: number) {
  const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, s: number, oct = 4) {
  let f = 0, amp = 0.5, k = 1;
  for (let i = 0; i < oct; i++) { f += vnoise(x * k, y * k, s + i * 13) * amp; k *= 2.03; amp *= 0.5; }
  return f / 0.9375;
}

// ───────────────────────── textures ─────────────────────────
let puffT: THREE.Texture | null = null;
/**
 * 2×2 atlas of soft noisy puffs (alpha = density, rgb = self-shading: lit top-left, darker bottom-right):
 * 0 round cauliflower puff · 1 wispy stretched curl · 2 clumpy cloud · 3 thin smoky wisp
 */
export function puffTex() {
  if (puffT) return puffT;
  const N = 128;
  puffT = canvasTex(N * 2, N * 2, (g) => {
    const img = g.createImageData(N * 2, N * 2);
    for (let tile = 0; tile < 4; tile++) {
      const ox = (tile % 2) * N, oy = Math.floor(tile / 2) * N;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1;
        if (tile === 1) { u *= 0.8; v *= 1.35; }
        if (tile === 3) { u *= 0.7; v *= 1.7; }
        // domain warp: curly edges
        const wx = fbm(u * 2 + 3, v * 2, tile + 1, 3) - 0.5, wy = fbm(u * 2, v * 2 + 7, tile + 5, 3) - 0.5;
        const uu = u + wx * (tile === 1 || tile === 3 ? 0.9 : 0.55), vv = v + wy * (tile === 1 || tile === 3 ? 0.9 : 0.55);
        const r = Math.hypot(uu, vv);
        const n = fbm(uu * (tile === 2 ? 3.2 : 2.4) + 10, vv * (tile === 2 ? 3.2 : 2.4), tile * 7 + 2, 5);
        let dens = clamp((1 - r) * 1.6 - 0.15 + (n - 0.5) * (tile === 3 ? 1.6 : 1.1), 0, 1);
        dens = dens * dens * (3 - 2 * dens);
        if (tile === 3) dens *= 0.85;
        // edge fade (no square borders ever)
        const edge = clamp((1 - Math.hypot(u / (tile === 1 ? 0.8 : tile === 3 ? 0.7 : 1), v / (tile === 1 ? 1.35 : tile === 3 ? 1.7 : 1))) * 4, 0, 1);
        dens *= edge;
        // self shading: light from the top-left + density darkens the core a bit
        const shade = clamp(0.62 + 0.3 * (-u * 0.45 - v * 0.75) * 0.5 + (n - 0.5) * 0.5 + 0.18 * (1 - dens), 0.3, 1);
        const i = ((oy + y) * N * 2 + ox + x) * 4;
        const c = Math.round(shade * 255);
        img.data[i] = c; img.data[i + 1] = c; img.data[i + 2] = c;
        img.data[i + 3] = Math.round(dens * 255);
      }
    }
    g.putImageData(img, 0, 0);
  });
  puffT.colorSpace = THREE.NoColorSpace;
  return puffT;
}

let glintT: THREE.Texture | null = null;
/** a four-point star glint with a soft core (eye glints, sparkles) */
export function glintTex() {
  if (glintT) return glintT;
  glintT = canvasTex(128, 128, (g, w, h) => {
    const c = w / 2;
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    for (const [sx, sy] of [[1, 0.06], [0.06, 1], [0.55, 0.035], [0.035, 0.55]] as const) {
      g.save(); g.translate(c, c);
      if (sx === 0.55 || sy === 0.55) g.rotate(Math.PI / 4);
      const lg = g.createRadialGradient(0, 0, 0, 0, 0, c);
      lg.addColorStop(0, 'rgba(255,255,255,0.95)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.scale(sx, sy); g.fillStyle = lg; g.beginPath(); g.arc(0, 0, c, 0, TAU); g.fill();
      g.restore();
    }
  });
  return glintT;
}

let crackT: THREE.Texture | null = null;
/** radial ground cracks (white lines on transparent; tint with the material colour) */
export function crackTex() {
  if (crackT) return crackT;
  crackT = canvasTex(256, 256, (g, w) => {
    const c = w / 2;
    // scorched dent
    const gr = g.createRadialGradient(c, c, 0, c, c, c * 0.42);
    gr.addColorStop(0, 'rgba(255,255,255,0.7)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineCap = 'round'; g.lineJoin = 'round';
    let seed = 3;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const branch = (x: number, y: number, a: number, len: number, wd: number, depth: number) => {
      let px = x, py = y;
      g.lineWidth = wd; g.beginPath(); g.moveTo(px, py);
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        a += (rnd() - 0.5) * 0.7;
        px += Math.cos(a) * len / steps; py += Math.sin(a) * len / steps;
        g.lineTo(px, py);
        if (depth > 0 && rnd() < 0.28) { g.stroke(); branch(px, py, a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5), len * 0.45, wd * 0.6, depth - 1); g.lineWidth = wd * (1 - i / steps * 0.5); g.beginPath(); g.moveTo(px, py); }
      }
      g.stroke();
    };
    for (let i = 0; i < 9; i++) branch(c, c, (i / 9) * TAU + rnd() * 0.4, c * (0.6 + rnd() * 0.35), 5, 2);
    // a ring of chipped stone
    g.lineWidth = 3;
    g.beginPath();
    for (let i = 0; i <= 40; i++) { const a = (i / 40) * TAU; const r = c * (0.3 + rnd() * 0.05); if (i === 0) g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r); else g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); }
    g.stroke();
  });
  return crackT;
}

/** an additive glow sprite (eye glints, flashes) */
export function glintSprite(color: string, size: number, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  s.scale.setScalar(size);
  s.renderOrder = 5;
  noOutline(s);
  return s;
}

// ───────────────────────── billboards ─────────────────────────
const BB_VERT = /* glsl */`
  attribute vec3 iPos; attribute vec4 iData; attribute vec3 iColor;
  varying vec2 vUv; varying float vA; varying vec3 vC;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
    float c = cos(iData.y), s = sin(iData.y);
    vec2 q = position.xy;
    mvPosition.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y) * iData.x;
    gl_Position = projectionMatrix * mvPosition;
    float t = iData.w;
    vUv = (uv + vec2(mod(t, 2.0), floor(t / 2.0 + 0.01))) * 0.5;
    vA = iData.z; vC = iColor;
    #include <fog_vertex>
  }`;
const BB_FRAG = /* glsl */`
  uniform sampler2D map; uniform float uLit;
  varying vec2 vUv; varying float vA; varying vec3 vC;
  #include <fog_pars_fragment>
  void main() {
    vec4 tx = texture2D(map, vUv);
    float a = tx.a * vA;
    if (a < 0.004) discard;
    vec3 col = vC * mix(1.0, 0.55 + tx.r * 0.75, uLit);
    gl_FragColor = vec4(col, a);
    #include <fog_fragment>
    #include <colorspace_fragment>
  }`;

/** N camera-facing quads in one draw call: fill with push() between begin() and end() each frame */
export class Billboards {
  mesh: THREE.Mesh;
  readonly max: number;
  n = 0;
  private pos: Float32Array; private data: Float32Array; private col: Float32Array;
  private geo: THREE.InstancedBufferGeometry;
  constructor(max: number, o: { additive?: boolean; lit?: number; map?: THREE.Texture; order?: number } = {}) {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = this.geo = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.getAttribute('position')); g.setAttribute('uv', base.getAttribute('uv'));
    this.pos = new Float32Array(max * 3); this.data = new Float32Array(max * 4); this.col = new Float32Array(max * 3);
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iData', new THREE.InstancedBufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iColor', new THREE.InstancedBufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, uLit: { value: o.lit ?? 1 } }]),
      vertexShader: BB_VERT, fragmentShader: BB_FRAG,
      transparent: true, depthWrite: false, fog: true,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    m.uniforms.map.value = o.map ?? puffTex();
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.order ?? 4;
    noOutline(this.mesh);
  }
  begin() { this.n = 0; }
  push(x: number, y: number, z: number, size: number, rot: number, alpha: number, c: THREE.Color, tile = 0) {
    if (this.n >= this.max || alpha <= 0.003 || size <= 0) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.data[i * 4] = size; this.data[i * 4 + 1] = rot; this.data[i * 4 + 2] = alpha; this.data[i * 4 + 3] = tile;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
  }
  end() {
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    for (const a of ['iPos', 'iData', 'iColor']) {
      const at = this.geo.getAttribute(a) as THREE.InstancedBufferAttribute;
      at.needsUpdate = true;
      at.clearUpdateRanges(); at.addUpdateRange(0, this.n * at.itemSize);
    }
  }
  dispose() { this.mesh.removeFromParent(); this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

// ───────────────────────── simulated puffs (per level) ─────────────────────────
export interface PuffOpts {
  count?: number;
  speed?: [number, number];
  dir?: THREE.Vector3;
  spread?: number;
  life?: [number, number];
  size?: [number, number];
  /** end size multiplier */
  grow?: number;
  colors?: string[];
  /** peak alpha */
  alpha?: number;
  g?: number;
  drag?: number;
  jitter?: number;
  /** spin (rad/s, random sign) */
  spin?: number;
  /** atlas tiles to pick from */
  tiles?: number[];
  additive?: boolean;
  /** swirl around the vertical axis through the spawn point (rad/s) */
  swirl?: number;
  /** flatten the random direction (0..1: 1 = horizontal only) */
  flat?: number;
}
interface Puff {
  x: number; y: number; z: number; vx: number; vy: number; vz: number; cx: number; cz: number;
  life: number; max: number; s0: number; s1: number; rot: number; vr: number;
  c: THREE.Color; a: number; tile: number; g: number; drag: number; swirl: number;
}
const tmpV = new THREE.Vector3();
const tmpC = new THREE.Color();
export class PuffFx {
  private soft = new Billboards(700, { lit: 1 });
  private glow = new Billboards(300, { additive: true, lit: 0.4 });
  private listS: Puff[] = [];
  private listG: Puff[] = [];
  static get(L: Level3D): PuffFx {
    let p = L.refs.__vampPuffs as PuffFx | undefined;
    if (!p) {
      p = new PuffFx();
      L.refs.__vampPuffs = p;
      L.scene.add(p.soft.mesh, p.glow.mesh);
      L.updaters.push((_t, dt) => p!.update(dt));
    }
    return p;
  }
  emit(at: THREE.Vector3, o: PuffOpts) {
    const n = o.count ?? 6;
    const list = o.additive ? this.listG : this.listS;
    const cap = o.additive ? 300 : 700;
    const dir = o.dir ?? tmpV.set(0, 1, 0);
    const spread = o.spread ?? 1;
    const j = o.jitter ?? 0;
    for (let i = 0; i < n; i++) {
      if (list.length >= cap) list.shift();
      const d = new THREE.Vector3(rand(-1, 1), rand(-1, 1) * (1 - (o.flat ?? 0)), rand(-1, 1)).normalize();
      d.lerp(dir, 1 - spread).normalize();
      const sp = rand(o.speed?.[0] ?? 0.3, o.speed?.[1] ?? 1.2);
      const life = rand(o.life?.[0] ?? 0.6, o.life?.[1] ?? 1.2);
      const s0 = rand(o.size?.[0] ?? 0.3, o.size?.[1] ?? 0.6);
      const x = at.x + rand(-j, j), y = at.y + rand(-j, j) * 0.6, z = at.z + rand(-j, j);
      list.push({
        x, y, z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, cx: at.x, cz: at.z,
        life, max: life, s0, s1: s0 * (o.grow ?? 1.8), rot: rand(0, TAU), vr: rand(-1, 1) * (o.spin ?? 1),
        c: new THREE.Color(choose(o.colors ?? ['#c3cdee'])), a: o.alpha ?? 0.7, tile: o.tiles ? choose(o.tiles) : Math.floor(rand(0, 3.99)),
        g: o.g ?? -0.3, drag: o.drag ?? 1.6, swirl: o.swirl ?? 0,
      });
    }
  }
  private step(list: Puff[], bb: Billboards, dt: number) {
    bb.begin();
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) { list[i] = list[list.length - 1]; list.pop(); continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vz *= d; p.vy = p.vy * d - p.g * dt;
      if (p.swirl) {
        const ox = p.x - p.cx, oz = p.z - p.cz, s = p.swirl * dt;
        p.x = p.cx + ox * Math.cos(s) - oz * Math.sin(s); p.z = p.cz + ox * Math.sin(s) + oz * Math.cos(s);
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.vr * dt;
    }
    for (const p of list) {
      const k = 1 - p.life / p.max; // 0 → 1
      const a = p.a * Math.min(1, k * 7) * (1 - k) ** 1.3;
      const s = p.s0 + (p.s1 - p.s0) * (1 - (1 - k) ** 2);
      bb.push(p.x, p.y, p.z, s, p.rot, a, p.c, p.tile);
    }
    bb.end();
  }
  update(dt: number) {
    this.step(this.listS, this.soft, dt);
    this.step(this.listG, this.glow, dt);
  }
}
/** emit local puffs (every machine draws its own) */
export function puffs(L: Level3D, at: THREE.Vector3, o: PuffOpts) { PuffFx.get(L).emit(at, o); }

// ───────────────────────── rig-attached mist column ─────────────────────────
interface MistP { a: number; r: number; u: number; sp: number; s: number; ph: number; tile: number; spin: number }
/**
 * A swirling, flowing mist column in its parent's local space. Puffs stream from `top` down to the ground (or up,
 * with rise < 0), spiral, grow and fade; `trail` (local velocity) bends the stream behind a moving owner.
 */
export class MistBody {
  bb: Billboards;
  private ps: MistP[] = [];
  private t = Math.random() * 10;
  private c1: THREE.Color; private c2: THREE.Color;
  /** 0..1 how much mist is drawn */
  density = 1;
  /** puffs per column */
  constructor(parent: THREE.Object3D, n: number, colors: [string, string] = ['#c9d2f4', '#7d86b8'], additiveGlow = false) {
    this.bb = new Billboards(n, { lit: 1, additive: additiveGlow, order: 4 });
    parent.add(this.bb.mesh);
    this.c1 = new THREE.Color(colors[0]); this.c2 = new THREE.Color(colors[1]);
    for (let i = 0; i < n; i++) this.ps.push({ a: (i / n) * TAU * 3.1, r: rand(0.5, 1.1), u: (i / n + rand(0, 0.08)) % 1, sp: rand(0.7, 1.3), s: rand(0.8, 1.25), ph: rand(0, TAU), tile: i % 3, spin: rand(-1, 1) });
  }
  /**
   * top/bottom: heights of the stream; r0/r1: radius at top / bottom; size0/size1: puff sizes; speed: cycles per second;
   * swirl: turns over the stream; trail: local (x, z) velocity of the owner (bends the mist behind); cy: centre offset
   */
  update(dt: number, o: { top: number; bottom: number; r0: number; r1: number; size0: number; size1: number; speed: number; swirl: number; alpha: number; trailX?: number; trailZ?: number; cz?: number; wobble?: number; inward?: number }) {
    this.t += dt;
    const bb = this.bb;
    bb.begin();
    const dens = clamp(this.density);
    if (dens > 0.01) {
      for (const p of this.ps) {
        p.u += dt * o.speed * p.sp;
        if (p.u >= 1) { p.u -= 1; p.a = rand(0, TAU); p.r = rand(0.5, 1.1); p.ph = rand(0, TAU); }
        const u = p.u;
        const y = o.top + (o.bottom - o.top) * u;
        const R = (o.r0 + (o.r1 - o.r0) * u) * p.r * (1 - (o.inward ?? 0) * Math.sin(u * Math.PI) * 0.4);
        const ang = p.a + u * o.swirl * TAU + this.t * 0.9 * (p.spin > 0 ? 1 : 0.7);
        const wob = (o.wobble ?? 0.06) * Math.sin(this.t * 2.3 + p.ph);
        const tr = u * u;
        const x = Math.sin(ang) * R - (o.trailX ?? 0) * tr * 0.22 + wob;
        const z = Math.cos(ang) * R - (o.trailZ ?? 0) * tr * 0.22 + (o.cz ?? 0);
        const s = (o.size0 + (o.size1 - o.size0) * u) * p.s;
        const a = o.alpha * dens * Math.min(1, u * 6) * (1 - u) ** 0.8;
        tmpC.copy(this.c1).lerp(this.c2, clamp(u * 0.8 + (Math.sin(ang) * 0.5 + 0.5) * 0.25));
        bb.push(x, y + Math.sin(this.t * 1.7 + p.ph) * 0.03, z, s, p.ph + this.t * 0.4 * p.spin, a, tmpC, p.tile);
      }
    }
    bb.end();
  }
}

// ───────────────────────── ground telegraphs ─────────────────────────
const TM_VERT = /* glsl */`
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const TM_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uP; uniform float uT; uniform float uA; uniform float uMode;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float r = length(q);
    float ang = atan(q.y, q.x);
    float a = 0.0;
    if (uMode < 0.5) {
      // filling disc: outer ring + rising inner fill + rim ticks
      float ring = smoothstep(0.86, 0.92, r) * (1.0 - smoothstep(0.96, 1.0, r));
      float fill = (1.0 - smoothstep(uP - 0.03, uP, r)) * (0.22 + 0.25 * uP);
      float edge = smoothstep(uP - 0.07, uP - 0.01, r) * (1.0 - smoothstep(uP - 0.01, uP + 0.01, r)) * 0.9;
      float ticks = step(0.7, fract(ang * 16.0 / 6.2832 + uT * 0.2)) * smoothstep(0.76, 0.8, r) * (1.0 - smoothstep(0.84, 0.86, r));
      float pulse = 0.75 + 0.25 * sin(uT * (8.0 + uP * 18.0));
      a = (ring * pulse + fill + edge + ticks * 0.6) * (1.0 - step(1.0, r));
    } else if (uMode < 1.5) {
      // target: shrinking ring + rotating brackets + centre dot
      float rr = mix(1.0, 0.5, uP);
      float ring = smoothstep(rr - 0.08, rr - 0.03, r) * (1.0 - smoothstep(rr, rr + 0.03, r));
      float br = step(0.55, fract(ang * 4.0 / 6.2832 + uT * 0.35)) * smoothstep(0.88, 0.9, r) * (1.0 - smoothstep(0.96, 0.98, r));
      float dot_ = 1.0 - smoothstep(0.1, 0.16, r);
      float fill = (1.0 - smoothstep(rr - 0.1, rr, r)) * 0.18;
      a = ring + br * 0.85 + dot_ * 0.8 + fill;
    } else {
      // lane (uv.y = along): chevrons sliding forward, fill up to uP
      float side = 1.0 - smoothstep(0.75, 0.95, abs(q.x));
      float ch = step(0.5, fract((vUv.y - abs(q.x) * 0.35) * 4.0 - uT * 2.2));
      float upto = 1.0 - smoothstep(uP - 0.02, uP + 0.02, vUv.y);
      float tip = smoothstep(0.85, 1.0, vUv.y);
      a = side * (0.18 + ch * 0.45 * upto) * (1.0 - tip) + side * upto * 0.15;
    }
    gl_FragColor = vec4(uColor, clamp(a * uA, 0.0, 1.0));
    #include <fog_fragment>
  }`;
/** an animated ground telegraph: 'fill' disc (brute slam), 'target' (dive spot), 'lane' (lunge) */
export class TeleMark {
  mesh: THREE.Mesh;
  private m: THREE.ShaderMaterial;
  private t = 0;
  constructor(color = '#ff3040', readonly mode: 'fill' | 'target' | 'lane' = 'fill') {
    this.m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(color) }, uP: { value: 0 }, uT: { value: 0 }, uA: { value: 1 }, uMode: { value: mode === 'fill' ? 0 : mode === 'target' ? 1 : 2 } }]),
      vertexShader: TM_VERT, fragmentShader: TM_FRAG, transparent: true, depthWrite: false, fog: true, blending: THREE.AdditiveBlending,
    });
    this.m.polygonOffset = true; this.m.polygonOffsetFactor = -4;
    const g = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    if (mode === 'lane') g.translate(0, 0, 1);
    this.mesh = new THREE.Mesh(g, this.m);
    this.mesh.renderOrder = 3;
    noOutline(this.mesh);
    this.mesh.visible = false;
  }
  /** r = radius (lane: half width); len = lane length; yaw = lane direction */
  show(L: Level3D, x: number, y: number, z: number, r: number, p: number, alpha = 1, dt = 1 / 60, len = 2, yaw = 0) {
    if (!this.mesh.parent) L.scene.add(this.mesh);
    this.t += dt;
    const gy = L.phys.groundAt(x, z, y + 0.6, 0.05);
    this.mesh.position.set(x, (gy > -1e8 ? gy : y) + 0.04, z);
    if (this.mode === 'lane') { this.mesh.scale.set(r, 1, len / 2); this.mesh.rotation.y = yaw; } else this.mesh.scale.set(r, 1, r);
    this.m.uniforms.uP.value = clamp(p);
    this.m.uniforms.uT.value = this.t;
    this.m.uniforms.uA.value = alpha;
    this.mesh.visible = alpha > 0.01;
  }
  hide() { this.mesh.visible = false; }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.m.dispose(); }
}

// ───────────────────────── the brute's shockwave ─────────────────────────
const WALL_VERT = /* glsl */`
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }`;
const WALL_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uT; uniform float uA;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  float h(float n) { return fract(sin(n) * 43758.5453); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = h(i.x + i.y * 57.0), b = h(i.x + 1.0 + i.y * 57.0), c = h(i.x + (i.y + 1.0) * 57.0), d = h(i.x + 1.0 + (i.y + 1.0) * 57.0);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
  void main() {
    float y = vUv.y;
    // height falloff: dense at the ground, ragged top
    float n = noise(vec2(vUv.x * 40.0, y * 3.0 - uT * 6.0)) * 0.6 + noise(vec2(vUv.x * 90.0 + uT * 3.0, y * 7.0)) * 0.4;
    float top = 0.55 + n * 0.45;
    float body = (1.0 - smoothstep(top * 0.4, top, y));
    // shimmering bands (fake heat distortion)
    float bands = 0.65 + 0.35 * sin(y * 28.0 - uT * 30.0 + n * 6.0);
    // fresnel: brighter at the silhouette, so the wall reads as a transparent sheet
    float fr = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float a = body * bands * (0.35 + 0.65 * fr) * uA;
    vec3 col = mix(uColor, vec3(1.0), smoothstep(0.0, 0.25, 1.0 - y) * 0.35 * fr);
    gl_FragColor = vec4(col, a);
  }`;
let wallGeo: THREE.CylinderGeometry | null = null;
/**
 * The brute's slam: a wall of shimmering air rolling out (r = r0 + speed·t, exactly the gameplay Wave3's radius),
 * a bright ground ripple under it, dust rolling off its front, debris, stone shards bursting up and radial cracks.
 * Purely visual and local (every machine makes its own from the replicated slam); hides the plain torus of the Wave3.
 */
export class QuakeFx implements Actor3 {
  dead = false;
  private t = 0;
  private g = new THREE.Group();
  private wall: THREE.Mesh; private wall2: THREE.Mesh;
  private wallM: THREE.ShaderMaterial; private wall2M: THREE.ShaderMaterial;
  private ripple: THREE.Mesh; private rippleM: THREE.MeshBasicMaterial;
  private crack: THREE.Mesh; private crackM: THREE.MeshBasicMaterial;
  private flash: THREE.Sprite;
  private shards: { m: THREE.Mesh; h: number; d: number }[] = [];
  private hidden = new Set<object>();
  constructor(L: Level3D, private c: THREE.Vector3, private r0: number, private speed: number, private maxR: number, color = '#ffc8e6') {
    this.g.position.copy(c);
    wallGeo ??= cached('vamp-quake-wall', () => new THREE.CylinderGeometry(1, 1.06, 1, 72, 6, true).translate(0, 0.5, 0));
    const mk = (a: number, col: string) => new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(col) }, uT: { value: rand(0, 9) }, uA: { value: a } }, vertexShader: WALL_VERT, fragmentShader: WALL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.wallM = mk(1, color); this.wall2M = mk(0.5, '#b58cff');
    this.wall = new THREE.Mesh(wallGeo, this.wallM); this.wall2 = new THREE.Mesh(wallGeo, this.wall2M);
    this.wall.renderOrder = 6; this.wall2.renderOrder = 6;
    this.rippleM = new THREE.MeshBasicMaterial({ color: '#ffd6f0', map: rippleTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 });
    this.ripple = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), this.rippleM);
    this.ripple.position.y = 0.05; this.ripple.renderOrder = 3;
    this.crackM = new THREE.MeshBasicMaterial({ color: '#1a1022', map: crackTex(), transparent: true, depthWrite: false, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -3 });
    this.crack = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), this.crackM);
    this.crack.position.y = 0.03; this.crack.rotation.y = rand(0, TAU); this.crack.renderOrder = 2;
    this.flash = glintSprite('#ffe0f0', 3.2, 1);
    this.flash.position.y = 0.4;
    this.g.add(this.wall, this.wall2, this.ripple, this.crack, this.flash);
    // stone shards bursting out of the cracks
    const stone = mat('#6d6380', { flat: true }), stone2 = mat('#8a7f9c', { flat: true });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + rand(-0.2, 0.2), d = rand(0.7, 1.7);
      const m = new THREE.Mesh(cached('vamp-shard', () => new THREE.ConeGeometry(0.2, 0.42, 5, 1).translate(0, 0.21, 0)), i % 2 ? stone : stone2);
      m.position.set(Math.cos(a) * d, -0.5, Math.sin(a) * d);
      m.rotation.set(rand(-0.4, 0.4) + Math.sin(a) * 0.35, rand(0, TAU), rand(-0.4, 0.4) - Math.cos(a) * 0.35);
      m.scale.set(rand(0.45, 0.8), rand(0.4, 0.85), rand(0.45, 0.8));
      m.castShadow = true;
      this.g.add(m);
      this.shards.push({ m, h: rand(0.12, 0.3), d: rand(0, 0.08) });
    }
    noOutline(this.wall); noOutline(this.wall2); noOutline(this.ripple); noOutline(this.crack);
    L.scene.add(this.g);
    // the burst: dust, debris, a flash
    ambient(L, () => {
      L.fx.chunks(c.clone().setY(c.y + 0.2), 16, ['#6d6380', '#8a7f9c', '#4a4258', '#b8a8d0'], c.y, [0.07, 0.18]);
      L.fx.emit(c.clone().setY(c.y + 0.3), { count: 18, speed: [3, 8], dir: new THREE.Vector3(0, 1, 0), spread: 0.55, life: [0.25, 0.5], size: [0.06, 0.12], colors: ['#ffd0e8', '#ffffff', '#ff8ab0'], g: 14, drag: 1.2 });
    });
    puffs(L, c.clone().setY(c.y + 0.25), { count: 16, speed: [2.5, 5], spread: 1, flat: 0.85, life: [0.7, 1.3], size: [0.5, 0.9], grow: 2.2, colors: ['#a898c0', '#857799', '#c8bcd8'], alpha: 0.75, g: -0.4, drag: 2.6, jitter: 0.4, tiles: [0, 2] });
  }
  update(L: Level3D, dt: number) {
    this.t += dt;
    const t = this.t;
    const r = this.r0 + this.speed * t;
    const live = r < this.maxR;
    const k = clamp((r - this.r0) / (this.maxR - this.r0));
    // the gameplay wave's torus: hidden (we draw the wave ourselves)
    if (t < 1) for (const w of L.waves) {
      if (this.hidden.has(w)) continue;
      if (Math.hypot(w.center.x - this.c.x, w.center.z - this.c.z) < 1.2 && Math.abs(w.center.y - this.c.y) < 1) { w.obj.visible = false; this.hidden.add(w); }
    }
    for (const w of this.hidden) (w as { obj: THREE.Object3D }).obj.visible = false;
    // wall: tall and bright at first, lower and fainter as it spreads
    const hgt = 1.1 * (1 - k * 0.55);
    this.wall.visible = this.wall2.visible = live;
    if (live) {
      this.wall.scale.set(r, hgt, r);
      this.wall2.scale.set(Math.max(0.1, r - 0.35), hgt * 0.75, Math.max(0.1, r - 0.35));
      this.wallM.uniforms.uT.value += dt; this.wall2M.uniforms.uT.value += dt * 1.3;
      this.wallM.uniforms.uA.value = (1 - k * 0.7) * Math.min(1, t * 20);
      this.wall2M.uniforms.uA.value = 0.5 * (1 - k);
      // dust rolling off the front + a few chips
      const n = 3;
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU);
        tmpV.set(this.c.x + Math.cos(a) * r, this.c.y + 0.12, this.c.z + Math.sin(a) * r);
        puffs(L, tmpV, { count: 1, speed: [1, 2.4], dir: new THREE.Vector3(Math.cos(a), 0.35, Math.sin(a)), spread: 0.3, life: [0.5, 0.9], size: [0.35, 0.6], grow: 2, colors: ['#a898c0', '#8a7c9e', '#c4b8d4'], alpha: 0.6, g: -0.3, drag: 2.2, tiles: [0, 2] });
      }
      if (Math.random() < 0.5) {
        const a = rand(0, TAU);
        ambient(L, () => L.fx.chunks(new THREE.Vector3(this.c.x + Math.cos(a) * r, this.c.y + 0.1, this.c.z + Math.sin(a) * r), 1, ['#6d6380', '#8a7f9c'], this.c.y, [0.05, 0.1]));
      }
    }
    // ground ripple follows the wall then fades
    const rr = Math.min(r, this.maxR);
    this.ripple.scale.set(rr + 0.4, 1, rr + 0.4);
    this.rippleM.opacity = live ? 0.9 * (1 - k * 0.8) : Math.max(0, this.rippleM.opacity - dt * 4);
    // cracks: snap in, linger, fade
    const cs = 2.6 * (1 - (1 - Math.min(1, t * 9)) ** 3);
    this.crack.scale.set(cs, 1, cs);
    this.crackM.opacity = 0.85 * clamp((3 - t) / 0.8);
    // flash
    this.flash.material.opacity = Math.max(0, 1 - t * 6);
    this.flash.scale.setScalar(2.4 + t * 8);
    // shards: burst up, wobble, sink back
    for (const s of this.shards) {
      const u = t - s.d;
      const up = u < 0 ? 0 : u < 0.12 ? (u / 0.12) : u < 1.6 ? 1 : Math.max(0, 1 - (u - 1.6) / 0.6);
      s.m.position.y = -0.55 + (0.55 + s.h) * (1 - (1 - up) ** 3) - (u > 0.12 && u < 0.3 ? Math.sin((u - 0.12) * 30) * 0.04 : 0);
    }
    if (t > 3.2) this.dispose();
  }
  dispose() {
    this.dead = true;
    this.g.removeFromParent();
    this.wallM.dispose(); this.wall2M.dispose(); this.rippleM.dispose(); this.crackM.dispose(); this.flash.material.dispose();
    this.ripple.geometry.dispose(); this.crack.geometry.dispose();
  }
}
let rippleT: THREE.Texture | null = null;
function rippleTex() {
  if (rippleT) return rippleT;
  rippleT = canvasTex(256, 256, (g, w) => {
    const c = w / 2;
    const gr = g.createRadialGradient(c, c, c * 0.55, c, c, c);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.72, 'rgba(255,255,255,0.12)'); gr.addColorStop(0.9, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.95, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });
  return rippleT;
}

// ───────────────────────── death poof ─────────────────────────
export interface PoofStyle {
  /** smoke / mist colours */
  smoke: string[];
  /** glowing ash / sparkle colours */
  ash: string[];
  /** little bats flying off */
  bats: number;
  /** overall size */
  size: number;
  /** 'pop' (squash & poof), 'topple' (falls over first), 'dissolve' (melts into mist) */
  kind?: 'pop' | 'topple' | 'dissolve';
}
/**
 * A beaten vampire: its rig (detached from the enemy, kept where it stood) flashes, squashes and wobbles for a
 * moment, then pops into a cloud of smoke with glowing ash; `onPop` lets the caller add little bats.
 */
export class DeathPoof implements Actor3 {
  dead = false;
  private t = 0;
  private popped = false;
  private anim = { st: 'die', p: 0, speed: 0, flash: 1 };
  private dur: number;
  private baseScale: THREE.Vector3;
  private baseQ: THREE.Quaternion;
  constructor(private L: Level3D, private rig: { root: THREE.Object3D; update(dt: number, a: { st: string; p: number; speed: number; flash: number }): void }, private holder: THREE.Object3D, private style: PoofStyle, private onPop: (at: THREE.Vector3) => void) {
    L.scene.add(holder);
    this.dur = style.kind === 'topple' ? 0.55 : style.kind === 'dissolve' ? 0.45 : 0.32;
    this.baseScale = holder.scale.clone();
    this.baseQ = holder.quaternion.clone();
  }
  update(L: Level3D, dt: number) {
    this.t += dt;
    const t = this.t, s = this.style, k = Math.min(1, t / this.dur);
    const h = this.holder;
    if (!this.popped) {
      this.anim.flash = 0.45 + 0.35 * Math.sin(t * 40);
      this.anim.p = k;
      this.rig.update(dt, this.anim);
      if (s.kind === 'topple') {
        h.quaternion.copy(this.baseQ).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-k * k * 1.3, 0, Math.sin(t * 20) * 0.05)));
        h.scale.copy(this.baseScale).multiplyScalar(1 - k * 0.1);
      } else if (s.kind === 'dissolve') {
        h.scale.set(this.baseScale.x * (1 + k * 0.25), this.baseScale.y * (1 - k * 0.7), this.baseScale.z * (1 + k * 0.25));
        h.rotateY(dt * 9 * k);
        if (Math.random() < 0.7) puffs(L, h.position.clone().setY(h.position.y + 0.5 * s.size * (1 - k)), { count: 2, speed: [0.4, 1.4], spread: 1, life: [0.5, 1], size: [0.3, 0.5].map((x) => x * s.size) as [number, number], grow: 2, colors: s.smoke, alpha: 0.6, g: -0.6, tiles: [1, 3], swirl: 3 });
      } else {
        // anticipation: stretch up, then squash before the pop
        const sy = k < 0.5 ? 1 + Math.sin(k / 0.5 * Math.PI) * 0.22 : 1 - (k - 0.5) * 0.7;
        const sxz = k < 0.5 ? 1 - Math.sin(k / 0.5 * Math.PI) * 0.12 : 1 + (k - 0.5) * 0.6;
        h.scale.set(this.baseScale.x * sxz, this.baseScale.y * sy, this.baseScale.z * sxz);
        h.rotateY(dt * 6 * k);
      }
      if (t >= this.dur) this.pop();
    } else if (t > this.dur + 0.05) this.finish();
  }
  private pop() {
    this.popped = true;
    const L = this.L, s = this.style;
    const c = this.holder.position.clone().setY(this.holder.position.y + 0.45 * s.size);
    this.holder.visible = false;
    puffs(L, c, { count: Math.round(14 * s.size + 6), speed: [1.2, 3.6].map((x) => x * Math.sqrt(s.size)) as [number, number], spread: 1, life: [0.6, 1.2], size: [0.35, 0.7].map((x) => x * s.size) as [number, number], grow: 2.1, colors: s.smoke, alpha: 0.85, g: -0.8, drag: 3, jitter: 0.2 * s.size, tiles: [0, 1, 2] });
    puffs(L, c, { count: Math.round(10 * s.size + 4), speed: [0.6, 2.4], spread: 1, life: [0.8, 1.6], size: [0.08, 0.16], grow: 0.4, colors: s.ash, alpha: 1, g: -0.9, drag: 1.5, jitter: 0.3 * s.size, additive: true, tiles: [0, 2] });
    ambient(L, () => {
      L.fx.stars(c, 8 + Math.round(s.size * 4), ['#ffe14a', '#ffffff', '#ff9ac0']);
      L.fx.glow.emit(c, { count: 10, speed: [1, 3], life: [0.6, 1.2], size: [0.05, 0.1], colors: s.ash, g: -1.5, drag: 1.2 });
    });
    this.onPop(c);
  }
  private finish() {
    this.dead = true;
    this.holder.removeFromParent();
  }
}
