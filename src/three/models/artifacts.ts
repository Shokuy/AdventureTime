import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PAL, mat, matU, basic, canvasTex, noOutline } from '../gfx';
import { G, TAU, clamp, lerp, smooth, grp, part, cached, taperedTube, merge, between, openLathe, starGeo } from './kit';

/*
 * Showcase models for the permanent artifacts (pedestal pickups + the "item get" pose).
 * Each model is ~0.9–1.3 units tall, centred at the origin, faces +Z and looks good from every angle
 * (pickups spin about Y). update(dt) drives the idle animation (cloth, sway, pulse, sparkles).
 */

export type ArtifactKind = 'doubleJump' | 'dash' | 'fork' | 'sling' | 'container';
export interface Artifact { root: THREE.Group; update(dt: number): void }

type V3 = [number, number, number];
const fo = { cast: false };
const nob = { cast: false, receive: false };

// ───────────────────────── shared fx textures ─────────────────────────
let glowTexC: THREE.Texture | null = null;
function glowTex() {
  if (!glowTexC) {
    glowTexC = canvasTex(128, 128, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.22, 'rgba(255,255,255,0.6)');
      r.addColorStop(0.55, 'rgba(255,255,255,0.16)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    });
  }
  return glowTexC;
}
let sparkTexC: THREE.Texture | null = null;
/** four-point twinkle with a soft core */
function sparkTex() {
  if (!sparkTexC) {
    sparkTexC = canvasTex(128, 128, (g, w) => {
      const c = w / 2;
      const r = g.createRadialGradient(c, c, 0, c, c, c * 0.42);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.35, 'rgba(255,255,255,0.5)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, w);
      g.fillStyle = '#ffffff';
      for (const rot of [0, Math.PI / 2]) {
        g.save(); g.translate(c, c); g.rotate(rot);
        g.beginPath();
        g.moveTo(-c * 0.98, 0); g.quadraticCurveTo(0, -c * 0.07, c * 0.98, 0); g.quadraticCurveTo(0, c * 0.07, -c * 0.98, 0);
        g.fill();
        g.restore();
      }
    });
  }
  return sparkTexC;
}

function fxSprite(parent: THREE.Object3D, tex: THREE.Texture, color: THREE.ColorRepresentation, size: number, opacity = 1, p?: V3): THREE.Sprite {
  const m = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(color), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  if (p) s.position.set(p[0], p[1], p[2]);
  noOutline(s);
  parent.add(s);
  return s;
}

/** twinkling sparkles drifting around the item on a loose orbit */
function twinkles(parent: THREE.Object3D, n: number, colors: string[], r: [number, number], y: [number, number], size: [number, number], seed = 1) {
  let a = seed * 9301 + 49297;
  const rnd = () => { a = (a * 9301 + 49297) % 233280; return a / 233280; };
  const items = Array.from({ length: n }, (_, i) => {
    const s = fxSprite(parent, sparkTex(), colors[i % colors.length], 0.1);
    return { s, a: rnd() * TAU, r: lerp(r[0], r[1], rnd()), y: lerp(y[0], y[1], rnd()), sp: (0.25 + rnd() * 0.35) * (rnd() < 0.5 ? -1 : 1), size: lerp(size[0], size[1], rnd()), ph: rnd() * TAU, f: 2.2 + rnd() * 2.2 };
  });
  return (t: number) => {
    for (const it of items) {
      const ang = it.a + t * it.sp;
      it.s.position.set(Math.cos(ang) * it.r, it.y + Math.sin(t * 0.9 + it.ph) * 0.06, Math.sin(ang) * it.r);
      const k = Math.max(0, Math.sin(t * it.f + it.ph));
      it.s.scale.setScalar(it.size * (0.15 + 0.85 * k * k));
      const m = it.s.material;
      m.rotation = t * 0.6 + it.ph;
      m.opacity = 0.25 + 0.75 * k;
    }
  };
}

/** Soft additive ribbon that follows a parametric path (frame-rate independent comet tail). Width is along local Y. */
class PathTrail {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private geo = new THREE.BufferGeometry();
  private tmp = new THREE.Vector3();
  constructor(parent: THREE.Object3D, private n: number, private width: number, head: THREE.ColorRepresentation, tail: THREE.ColorRepresentation) {
    // 3 vertices across: dark edge / bright centre / dark edge → soft additive falloff
    this.pos = new Float32Array(n * 3 * 3);
    const col = new Float32Array(n * 3 * 3);
    const ch = new THREE.Color(head), ct = new THREE.Color(tail), c = new THREE.Color();
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      c.copy(ch).lerp(ct, Math.min(1, k * 1.6)).multiplyScalar(Math.pow(1 - k, 1.3));
      col.set([0, 0, 0, c.r, c.g, c.b, 0, 0, 0], i * 9);
      if (i < n - 1) {
        const q = i * 3;
        idx.push(q, q + 1, q + 3, q + 1, q + 4, q + 3, q + 1, q + 2, q + 4, q + 2, q + 5, q + 4);
      }
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geo.setIndex(idx);
    const m = basic('#ffffff', { additive: true, side: THREE.DoubleSide });
    m.vertexColors = true;
    this.mesh = new THREE.Mesh(this.geo, m);
    this.mesh.frustumCulled = false;
    noOutline(this.mesh);
    parent.add(this.mesh);
  }
  /** f(s, out): position along the path; s = 0 is the head, then -step, -2·step … toward the tail */
  update(f: (s: number, out: THREE.Vector3) => void, step: number) {
    for (let i = 0; i < this.n; i++) {
      f(-i * step, this.tmp);
      const w = this.width * Math.pow(1 - i / (this.n - 1), 0.7) * 0.5;
      const p = this.tmp;
      this.pos.set([p.x, p.y + w, p.z, p.x, p.y, p.z, p.x, p.y - w, p.z], i * 9);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

const flipCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
/** cached flippedView for static geometry */
function flippedViewStatic(src: THREE.BufferGeometry) {
  let g = flipCache.get(src);
  if (!g) { g = flippedView(src); flipCache.set(src, g); }
  return g;
}

/** A second view of `src` with reversed winding (shares position/uv), so its "inside" is front-facing too
 *  (the outline pass renders normals with front faces only). Call computeVertexNormals() after edits. */
function flippedView(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.attributes.position);
  if (src.attributes.uv) g.setAttribute('uv', src.attributes.uv);
  const s = src.index!.array;
  const out: number[] = new Array(s.length);
  for (let i = 0; i < s.length; i += 3) { out[i] = s[i]; out[i + 1] = s[i + 2]; out[i + 2] = s[i + 1]; }
  g.setIndex(out);
  g.computeVertexNormals();
  return g;
}

class Helix extends THREE.Curve<THREE.Vector3> {
  constructor(private r: number, private y0: number, private y1: number, private turns: number, private phase = 0) { super(); }
  override getPoint(t: number, target = new THREE.Vector3()) {
    const a = this.phase + t * this.turns * TAU;
    return target.set(Math.cos(a) * this.r, lerp(this.y0, this.y1, t), Math.sin(a) * this.r);
  }
}

/** simple pseudo-random generator for deterministic texture painting */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function starPath(g: CanvasRenderingContext2D, x: number, y: number, r1: number, r2: number, n = 5, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = rot + (i / (n * 2)) * TAU;
    if (i === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
}
function twinklePath(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r);
  g.closePath();
}

/** Thin extruded leaf lying in XY, stem at the origin, tip at +X (length 1, width ≈0.42), gently cupped. */
const leafGeo = () => cached('art-leaf', () => {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.2, 0.24, 0.62, 0.24, 1, 0);
  s.bezierCurveTo(0.62, -0.2, 0.2, -0.2, 0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 2, curveSegments: 14 });
  g.translate(0, 0, -0.01);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, p.getZ(i) - 0.32 * y * y + 0.12 * x * x);
  }
  g.computeVertexNormals();
  return g;
});
const leafVeinGeo = () => cached('art-leaf-vein', () => {
  const pts = [new THREE.Vector3(0.02, 0, 0.022), new THREE.Vector3(0.5, 0, 0.05), new THREE.Vector3(0.92, 0, 0.115)];
  const parts: Array<{ g: THREE.BufferGeometry }> = [{ g: taperedTube(new THREE.CatmullRomCurve3(pts), 12, 5, (t) => 0.018 * (1 - t * 0.8), false) }];
  for (const [x0, s] of [[0.25, 1], [0.45, -1], [0.6, 1], [0.32, -1]] as const) {
    const a = new THREE.Vector3(x0, 0, 0.03 + 0.12 * x0 * x0);
    const b = new THREE.Vector3(x0 + 0.16, s * 0.11, 0.03 + 0.12 * (x0 + 0.16) ** 2 - 0.32 * 0.0121 + 0.01);
    parts.push({ g: taperedTube(new THREE.LineCurve3(a, b), 4, 4, (t) => 0.01 * (1 - t * 0.7), false) });
  }
  return merge(parts);
});
function leaf(parent: THREE.Object3D, p: V3, r: V3, s: number, color = '#56b23e', vein = '#2f7a28') {
  const g = grp(parent, p, r);
  g.scale.setScalar(s);
  part(g, leafGeo(), mat(color));
  part(g, leafVeinGeo(), mat(vein), undefined, undefined, undefined, fo);
  part(g, leafVeinGeo(), mat(vein), undefined, [1, 1, -1], undefined, fo).position.z = -0.0;
  return g;
}

// ════════════════════════════════════════════════════════════════════
//  DASH — «Плащ-Рывок»: a flowing violet hero cape
// ════════════════════════════════════════════════════════════════════
const NU = 32, NV = 26;
const CAPE_Y0 = 0.5;
const capeSpan = (v: number) => lerp(TAU * 0.84, TAU * 0.64, smooth(clamp(v / 0.16))) - TAU * 0.06 * v;
const capeRad = (v: number) => 0.1 + 0.27 * Math.pow(clamp(v / 0.1), 0.5) * (1 - 0.2 * clamp(v / 0.1)) + 0.2 * clamp((v - 0.1) / 0.9);
/** hem: longer at the back centre, with a soft swallow-tail dip */
const capeLen = (u: number) => {
  const c = Math.abs(u - 0.5) * 2;
  return 1.06 * (0.8 + 0.2 * Math.sin(Math.PI * u)) - 0.07 * Math.exp(-((u - 0.5) ** 2) / 0.003) + 0.04 * Math.exp(-((c - 0.3) ** 2) / 0.01);
};
/** horizontal texture stretch at row v (surface arc length / cape length), used to paint undistorted shapes */
const capeStretch = (v: number) => (capeRad(v) * capeSpan(v)) / capeLen(0.5);

let capeOutTex: THREE.Texture | null = null;
function capeOutsideTex() {
  if (capeOutTex) return capeOutTex;
  capeOutTex = canvasTex(1024, 1024, (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#2b2170');
    gr.addColorStop(0.35, '#3d2a92');
    gr.addColorStop(0.75, '#5a33b4');
    gr.addColorStop(1, '#6d3cc8');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // soft vertical fold bands
    for (let i = 0; i < 9; i++) {
      const x = (i + 0.5) / 9 * W;
      const lg = g.createLinearGradient(x - W / 18, 0, x + W / 18, 0);
      lg.addColorStop(0, 'rgba(20,8,60,0)'); lg.addColorStop(0.5, i % 2 ? 'rgba(20,8,60,0.16)' : 'rgba(160,120,255,0.08)'); lg.addColorStop(1, 'rgba(20,8,60,0)');
      g.fillStyle = lg; g.fillRect(x - W / 18, H * 0.15, W / 9, H);
    }
    const R = prng(7);
    const EX = 0.5, EY = 0.47;
    const inEmblem = (x: number, y: number) => Math.hypot((x - W * EX) * capeStretch(y / H), y - H * EY) < 190;
    const sq = (y: number) => 1 / capeStretch(y / H);
    // tiny dots
    for (let i = 0; i < 120; i++) {
      const x = R() * W, y = H * 0.08 + R() * H * 0.86;
      if (inEmblem(x, y)) continue;
      g.fillStyle = R() < 0.5 ? 'rgba(255,240,200,0.75)' : 'rgba(190,210,255,0.6)';
      g.beginPath(); g.ellipse(x, y, (1.5 + R() * 2) * sq(y), 1.5 + R() * 2, 0, 0, TAU); g.fill();
    }
    // constellations: little groups of stars joined with thin lines
    const groups: Array<Array<[number, number]>> = [
      [[0.1, 0.2], [0.17, 0.27], [0.15, 0.37], [0.23, 0.42]],
      [[0.78, 0.2], [0.86, 0.27], [0.82, 0.36]],
      [[0.08, 0.64], [0.15, 0.58], [0.21, 0.69], [0.16, 0.79], [0.25, 0.84]],
      [[0.76, 0.64], [0.84, 0.6], [0.91, 0.7], [0.84, 0.8]],
      [[0.4, 0.84], [0.5, 0.89], [0.6, 0.83]],
    ];
    g.strokeStyle = 'rgba(255,232,170,0.55)'; g.lineWidth = 3; g.lineCap = 'round';
    for (const grp_ of groups) {
      g.beginPath();
      grp_.forEach(([u, v], i) => { const x = u * W, y = v * H; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
      g.stroke();
    }
    for (const grp_ of groups) for (const [u, v] of grp_) {
      const x = u * W, y = v * H, s = sq(y);
      g.save(); g.translate(x, y); g.scale(s, 1);
      g.fillStyle = 'rgba(255,240,190,0.35)'; g.beginPath(); g.arc(0, 0, 14, 0, TAU); g.fill();
      g.fillStyle = '#fff4c8'; twinklePath(g, 0, 0, 15); g.fill();
      g.restore();
    }
    // scattered gold stars
    for (let i = 0; i < 30; i++) {
      const x = R() * W, y = H * 0.1 + R() * H * 0.84;
      if (inEmblem(x, y)) continue;
      const s = sq(y), r = 8 + R() * 10;
      g.save(); g.translate(x, y); g.scale(s, 1); g.rotate(R() * 0.6 - 0.3);
      if (R() < 0.55) { starPath(g, 0, 0, r, r * 0.45); g.fillStyle = '#ffd860'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#a8761a'; g.stroke(); }
      else { twinklePath(g, 0, 0, r * 1.1); g.fillStyle = '#fff2c0'; g.fill(); }
      g.restore();
    }
    // emblem: golden shooting star with speed streaks (the "dash")
    {
      const cx = W * EX, cy = H * EY, s = sq(cy);
      g.save(); g.translate(cx, cy); g.scale(s, 1);
      g.lineCap = 'round';
      const streaks: Array<[number, number, number]> = [[-230, -150, 30], [-275, -62, 22], [-210, 22, 16]];
      for (const [x1, y1, w] of streaks) {
        const lg = g.createLinearGradient(x1, y1, -20, -30);
        lg.addColorStop(0, 'rgba(255,214,90,0)'); lg.addColorStop(1, 'rgba(255,214,90,1)');
        g.strokeStyle = lg; g.lineWidth = w;
        g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo((x1 - 20) * 0.5, (y1 - 30) * 0.5 - 16, -20, -30); g.stroke();
      }
      g.strokeStyle = 'rgba(255,220,120,0.55)'; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 140, 0, TAU); g.stroke();
      starPath(g, 0, 0, 112, 50, 5, -Math.PI / 2 + 0.15);
      g.fillStyle = '#ffd34a'; g.fill(); g.lineWidth = 12; g.strokeStyle = '#7a4a10'; g.lineJoin = 'round'; g.stroke();
      starPath(g, -5, -8, 74, 31, 5, -Math.PI / 2 + 0.15);
      g.fillStyle = '#ffe98a'; g.fill();
      g.fillStyle = '#fffbe6'; g.beginPath(); g.ellipse(-22, -30, 16, 9, -0.6, 0, TAU); g.fill();
      g.restore();
    }
    // embroidered inner border (gold line + dots), inset from the edges
    g.strokeStyle = '#e8b83a'; g.lineWidth = 8;
    const ix = W * 0.045, iy = H * 0.95;
    g.beginPath(); g.moveTo(ix, H * 0.09); g.lineTo(ix, iy); g.lineTo(W - ix, iy); g.lineTo(W - ix, H * 0.09); g.stroke();
    g.fillStyle = '#ffd860';
    for (let y = H * 0.12; y < iy - 20; y += 44) for (const x of [ix + 20, W - ix - 20]) { g.beginPath(); g.ellipse(x, y, 6 * sq(y), 6, 0, 0, TAU); g.fill(); }
    for (let x = ix + 40; x < W - ix - 20; x += 46) { g.beginPath(); g.ellipse(x, iy - 20, 5.5 * sq(iy), 6, 0, 0, TAU); g.fill(); }
    // darker yoke under the collar
    const yk = g.createLinearGradient(0, 0, 0, H * 0.14);
    yk.addColorStop(0, 'rgba(14,6,40,0.55)'); yk.addColorStop(1, 'rgba(14,6,40,0)');
    g.fillStyle = yk; g.fillRect(0, 0, W, H * 0.14);
  });
  return capeOutTex;
}
let capeInTex: THREE.Texture | null = null;
function capeLiningTex() {
  if (capeInTex) return capeInTex;
  capeInTex = canvasTex(512, 512, (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#6a36b8'); gr.addColorStop(0.45, '#9550d8'); gr.addColorStop(1, '#b06ce8');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // quilted diamond pattern
    g.strokeStyle = 'rgba(255,220,255,0.22)'; g.lineWidth = 3;
    for (let k = -W; k < W * 2; k += 64) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k + H * 0.7, H); g.stroke();
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k - H * 0.7, H); g.stroke();
    }
    g.fillStyle = 'rgba(255,236,190,0.8)';
    for (let y = 32; y < H; y += 64) for (let x = (y / 64) % 2 ? 0 : 22; x < W + 40; x += 45) { twinklePath(g, x, y, 7); g.fill(); }
    g.strokeStyle = '#e8b83a'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(W * 0.03, H * 0.08); g.lineTo(W * 0.03, H * 0.965); g.lineTo(W * 0.97, H * 0.965); g.lineTo(W * 0.97, H * 0.08); g.stroke();
    const yk = g.createLinearGradient(0, 0, 0, H * 0.2);
    yk.addColorStop(0, 'rgba(30,8,60,0.5)'); yk.addColorStop(1, 'rgba(30,8,60,0)');
    g.fillStyle = yk; g.fillRect(0, 0, W, H * 0.2);
  });
  return capeInTex;
}

let capeletTexC: THREE.Texture | null = null;
function capeletTex() {
  if (capeletTexC) return capeletTexC;
  capeletTexC = canvasTex(512, 128, (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#2a1f6c'); gr.addColorStop(1, '#4a30a8');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // gold band near the hem (uv.y = 0 → canvas bottom)
    g.fillStyle = '#e8b83a'; g.fillRect(0, H * 0.74, W, H * 0.06);
    g.fillStyle = '#ffd860';
    for (let x = 16; x < W; x += 32) { twinklePath(g, x, H * 0.55, 7); g.fill(); }
    const R = prng(3);
    g.fillStyle = 'rgba(255,240,200,0.7)';
    for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(R() * W, R() * H * 0.42, 1 + R() * 1.5, 0, TAU); g.fill(); }
  });
  return capeletTexC;
}

/** gold wing (for the clasp), base at the origin, pointing +X */
const wingGeo = () => cached('art-wing', () => {
  const s = new THREE.Shape();
  s.moveTo(0, 0.03);
  s.bezierCurveTo(0.04, 0.085, 0.1, 0.1, 0.155, 0.095);
  s.quadraticCurveTo(0.125, 0.07, 0.1, 0.062);
  s.quadraticCurveTo(0.125, 0.045, 0.135, 0.032);
  s.quadraticCurveTo(0.1, 0.022, 0.08, 0.02);
  s.quadraticCurveTo(0.1, 0.0, 0.105, -0.018);
  s.quadraticCurveTo(0.06, -0.022, 0.035, -0.018);
  s.quadraticCurveTo(0.01, -0.02, 0, -0.012);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -0.007);
  return g;
});

function createDash(): Artifact {
  const root = new THREE.Group();
  root.name = 'artifact-dash';
  // the emblem side (the cape's back) faces +Z: that's the side you want to show off
  const body = grp(root, [0, -0.17, -0.28], [0, Math.PI, 0]);

  // ── cloth (animated grid; outside + lining views of the same vertices) ──
  const count = NU * NV;
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const k = j * NU + i;
    uv[k * 2] = i / (NU - 1); uv[k * 2 + 1] = 1 - j / (NV - 1);
  }
  const idx: number[] = [];
  for (let j = 0; j < NV - 1; j++) for (let i = 0; i < NU - 1; i++) {
    const a = j * NU + i, b = a + 1, c = a + NU, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const geoIn = flippedView(geo);
  const outside = part(body, geo, matU('#ffffff', { map: capeOutsideTex() }));
  const lining = part(body, geoIn, matU('#ffffff', { map: capeLiningTex() }));
  outside.frustumCulled = lining.frustumCulled = false;

  // ── gold trim: a tube around the whole border, rebuilt from the cloth each frame ──
  const border: number[] = [];
  for (let j = 0; j < NV; j++) border.push(j * NU);
  for (let i = 1; i < NU; i++) border.push((NV - 1) * NU + i);
  for (let j = NV - 2; j >= 0; j--) border.push(j * NU + NU - 1);
  for (let i = NU - 2; i >= 1; i--) border.push(i);
  const NB = border.length, RS = 6;
  const tpos = new Float32Array(NB * RS * 3);
  const tnrm = new Float32Array(NB * RS * 3);
  const tidx: number[] = [];
  for (let b = 0; b < NB; b++) for (let r = 0; r < RS; r++) {
    const a0 = b * RS + r, a1 = b * RS + ((r + 1) % RS);
    const b0 = ((b + 1) % NB) * RS + r, b1 = ((b + 1) % NB) * RS + ((r + 1) % RS);
    tidx.push(a0, b0, a1, a1, b0, b1);
  }
  const tgeo = new THREE.BufferGeometry();
  tgeo.setAttribute('position', new THREE.BufferAttribute(tpos, 3).setUsage(THREE.DynamicDrawUsage));
  tgeo.setAttribute('normal', new THREE.BufferAttribute(tnrm, 3).setUsage(THREE.DynamicDrawUsage));
  tgeo.setIndex(tidx);
  const trim = part(body, tgeo, mat(PAL.gold));
  trim.frustumCulled = false;

  // ── shoulder capelet (mantle) with a scalloped, gold-piped hem ──
  const capeletGeo = cached('art-capelet', () => {
    const prof: Array<[number, number]> = [[0.45, -0.21], [0.435, -0.14], [0.4, -0.075], [0.32, -0.035], [0.21, -0.01], [0.115, 0]];
    const gap = (i: number) => lerp(0.36, 0.62, i / (prof.length - 1));
    const g = openLathe(prof, gap, 56);
    const p = g.attributes.position as THREE.BufferAttribute;
    const hem: THREE.Vector3[] = [];
    for (let j = 0; j <= 56; j++) {
      const phi = gap(0) + (TAU - 2 * gap(0)) * (j / 56);
      const sc = -0.045 * (1 - Math.abs(Math.cos(phi * 4.5))) - 0.09 * ((1 - Math.cos(phi)) / 2) ** 2;
      p.setY(j, p.getY(j) + sc);
      // the row above follows a little so the drape stays smooth
      p.setY(j + 57, p.getY(j + 57) - 0.035 * ((1 - Math.cos(phi)) / 2) ** 2);
      hem.push(new THREE.Vector3(p.getX(j) * 1.015, p.getY(j), p.getZ(j) * 1.015));
    }
    g.computeVertexNormals();
    const side = (sd: 1 | -1) => prof.map(([r, y], i) => { const phi = sd > 0 ? gap(i) : TAU - gap(i); return new THREE.Vector3(r * 1.015 * Math.sin(phi), y + (i === 0 ? -0.045 * (1 - Math.abs(Math.cos(phi * 4.5))) : 0), r * 1.015 * Math.cos(phi)); });
    g.userData.trim = merge([
      { g: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hem), 140, 0.016, 6, false) },
      { g: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(side(1)), 12, 0.014, 6, false) },
      { g: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(side(-1)), 12, 0.014, 6, false) },
    ]);
    return g;
  });
  const capelet = grp(body, [0, CAPE_Y0 + 0.005, 0]);
  part(capelet, capeletGeo, matU('#ffffff', { map: capeletTex() }));
  part(capelet, flippedViewStatic(capeletGeo), mat('#7a40c8'), undefined, undefined, undefined, fo);
  part(capelet, capeletGeo.userData.trim as THREE.BufferGeometry, mat(PAL.gold), undefined, undefined, undefined, fo);

  // ── high sorcerer collar: tallest at the back, sweeping down toward the clasp ──
  const collarGeo = cached('art-cape-collar', () => {
    const rows = 6, segs = 36, g0 = 0.95;
    const cols = segs + 1;
    const p = new Float32Array(rows * cols * 3);
    const uvs = new Float32Array(rows * cols * 2);
    const ix: number[] = [];
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const k = i / (rows - 1);
      const phi = g0 + (TAU - 2 * g0) * (j / segs);
      const back = ((1 - Math.cos(phi)) / 2) ** 1.5;
      const h = 0.06 + 0.085 * back;
      const r = 0.112 + (0.06 + 0.1 * back) * Math.pow(k, 1.2);
      const q = (i * cols + j) * 3;
      p[q] = r * Math.sin(phi); p[q + 1] = h * k - 0.01; p[q + 2] = r * Math.cos(phi);
      uvs[(i * cols + j) * 2] = j / segs; uvs[(i * cols + j) * 2 + 1] = k;
    }
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < segs; j++) {
      const a = i * cols + j, b = a + 1, d = a + cols, e = d + 1;
      ix.push(a, b, d, b, e, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(ix);
    g.computeVertexNormals();
    // gold piping along the top and front edges
    const edge: THREE.Vector3[] = [];
    for (let i = 0; i < rows; i++) edge.push(new THREE.Vector3().fromArray(p, (i * cols) * 3));
    for (let j = 1; j < cols; j++) edge.push(new THREE.Vector3().fromArray(p, ((rows - 1) * cols + j) * 3));
    for (let i = rows - 2; i >= 0; i--) edge.push(new THREE.Vector3().fromArray(p, (i * cols + cols - 1) * 3));
    g.userData.trim = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge, false, 'catmullrom', 0.2), 96, 0.014, 6, false);
    return g;
  });
  const collar = grp(body, [0, CAPE_Y0, 0]);
  part(collar, collarGeo, mat('#35268a'));
  part(collar, flippedViewStatic(collarGeo), mat('#8a48d0'), undefined, undefined, undefined, fo);
  part(collar, collarGeo.userData.trim as THREE.BufferGeometry, mat(PAL.gold), undefined, undefined, undefined, fo);

  // ── winged clasp with a glowing gem ──
  const clasp = grp(body, [0, CAPE_Y0 - 0.03, 0.14]);
  const gold = mat(PAL.gold);
  const goldD = mat('#c98f1c');
  part(clasp, G.cyl(), gold, [0, 0, 0], [0.058, 0.03, 0.058], [Math.PI / 2, 0, 0]);
  part(clasp, G.torus(0.058, 0.013, 8, 28), goldD, [0, 0, 0.012]);
  for (const s of [1, -1]) {
    const w = part(clasp, wingGeo(), gold, [s * 0.05, 0.005, -0.004], [s, 1, 1], [0, -s * 0.35, s * 0.12]);
    w.castShadow = false;
  }
  const gemM = matU('#5ff4ff', { emissive: '#2ad8ff', emissiveIntensity: 0.55, flat: true });
  const gem = part(clasp, cached('art-gem', () => new THREE.OctahedronGeometry(1, 0)), gemM, [0, 0, 0.032], [0.04, 0.05, 0.026], undefined, fo);
  part(clasp, G.ball(), basic('#ffffff', { transparent: true }), [-0.012, 0.016, 0.052], 0.008, undefined, nob);
  const gemGlow = fxSprite(clasp, glowTex(), '#4fe8ff', 0.3, 0.7, [0, 0, 0.05]);

  // ── magic: orbiting comet with a soft trail, twinkles ──
  const fx = grp(root);
  const comet = grp(fx);
  fxSprite(comet, glowTex(), '#b48cff', 0.4, 0.7);
  const cometCore = fxSprite(comet, sparkTex(), '#ffffff', 0.24, 1);
  const trail = new PathTrail(fx, 34, 0.09, '#dff0ff', '#8a5cff');
  const orbit = (s: number, out: THREE.Vector3) => {
    const a = s * 2.0;
    return out.set(Math.cos(a) * 0.7, -0.02 + Math.sin(a + 0.8) * 0.3, Math.sin(a) * 0.7);
  };
  const tw = twinkles(fx, 8, ['#fff2b0', '#c9b0ff', '#9ff0ff'], [0.45, 0.75], [-0.45, 0.55], [0.09, 0.17], 3);

  // ── procedural wind ──
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  function cloth(t: number) {
    const gust = 0.5 + 0.5 * Math.sin(t * 0.85);
    const flowZ = 0.34 + 0.12 * gust;
    const flowX = 0.12 + 0.12 * Math.sin(t * 0.55);
    const lift = 0.28 + 0.1 * gust;
    for (let j = 0; j < NV; j++) {
      const v = j / (NV - 1);
      const w = Math.pow(clamp((v - 0.14) / 0.86), 1.15);
      const R = capeRad(v), sp = capeSpan(v);
      for (let i = 0; i < NU; i++) {
        const u = i / (NU - 1);
        const e = Math.abs(2 * u - 1);
        const th = (u - 0.5) * sp;
        // big travelling waves down the cloth + small fast flutter, stronger at the free edges
        const wave = Math.sin(v * 6.0 - t * 5.0 + u * 3.0) * 0.07 + Math.sin(v * 11 - t * 8.4 - u * 7) * 0.02 * (1 + 1.5 * e);
        const billow = 0.05 + 0.04 * Math.sin(t * 2.1 + u * 3);
        const r = R + w * (billow + wave * 0.6);
        let x = r * Math.sin(th), z = -r * Math.cos(th);
        let y = CAPE_Y0 - v * capeLen(u);
        z -= w * flowZ;
        x += Math.pow(w, 1.5) * flowX + w * (0.05 * Math.sin(v * 4 - t * 2.2) + 0.03 * Math.sin(t * 1.7 + v * 3 + u * 2));
        y += w * w * lift * (1 + 0.35 * (2 * u - 1) * Math.sin(t * 0.7)) + w * wave * 0.7;
        const k = (j * NU + i) * 3;
        pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      }
    }
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    geo.computeVertexNormals();
    geoIn.computeVertexNormals();
    const n = geo.attributes.normal as THREE.BufferAttribute;
    // trim tube
    for (let b = 0; b < NB; b++) {
      const vi = border[b];
      pA.fromArray(pos, vi * 3);
      pB.fromArray(pos, border[(b + NB - 1) % NB] * 3);
      pC.fromArray(pos, border[(b + 1) % NB] * 3);
      T.subVectors(pC, pB).normalize();
      N.fromBufferAttribute(n, vi);
      B.crossVectors(T, N).normalize();
      N.crossVectors(B, T).normalize();
      const rr = 0.02;
      for (let r = 0; r < RS; r++) {
        const a = (r / RS) * TAU;
        const cx = Math.cos(a), sx = Math.sin(a);
        const nx = N.x * cx + B.x * sx, ny = N.y * cx + B.y * sx, nz = N.z * cx + B.z * sx;
        const q = (b * RS + r) * 3;
        tpos[q] = pA.x + nx * rr; tpos[q + 1] = pA.y + ny * rr; tpos[q + 2] = pA.z + nz * rr;
        tnrm[q] = nx; tnrm[q + 1] = ny; tnrm[q + 2] = nz;
      }
    }
    (tgeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (tgeo.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
  }

  let t = Math.random() * 10;
  cloth(t);
  const cp = new THREE.Vector3();
  return {
    root,
    update(dt: number) {
      dt = Math.min(dt, 0.1);
      t += dt;
      cloth(t);
      body.rotation.z = Math.sin(t * 1.1) * 0.03;
      const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
      gemM.emissiveIntensity = 0.45 + 0.45 * pulse;
      gemGlow.scale.setScalar(0.26 + 0.1 * pulse);
      gem.rotation.z = Math.sin(t * 0.8) * 0.15;
      orbit(t, cp);
      comet.position.copy(cp);
      cometCore.material.rotation = t * 2;
      cometCore.scale.setScalar(0.2 + 0.06 * Math.sin(t * 9));
      trail.update((s, out) => orbit(t + s, out), 0.03);
      tw(t);
    },
  };
}

// ════════════════════════════════════════════════════════════════════
//  DOUBLE JUMP — «Перо Прыгуна»: an elegant cyan feather
// ════════════════════════════════════════════════════════════════════
const F_BASE = -0.3, F_TIP = 0.56, F_QUILL = -0.56;
/** in-plane curve of the rachis and slight out-of-plane bow */
const fBendX = (y: number) => { const s = (y - F_QUILL) / (F_TIP - F_QUILL); return 0.2 * s * s - 0.04 * s; };
const fBendZ = (y: number) => { const s = (y - F_QUILL) / (F_TIP - F_QUILL); return -0.1 * Math.sin(s * Math.PI) ; };
const featherVaneGeo = () => cached('art-feather-vane', () => {
  const L = F_TIP - F_BASE;
  const hw = (s: number, side: number) => {
    // half-width along the vane; the left (leading) side is narrower
    const base = Math.pow(Math.sin(Math.PI * Math.pow(clamp(s), 0.72)), 0.75);
    return (side > 0 ? 0.165 : 0.12) * base * (1 - 0.15 * s);
  };
  const notches: Record<string, number[]> = { r: [0.32, 0.55, 0.74], l: [0.42, 0.66] };
  const edge = (side: 1 | -1) => {
    const out: Array<[number, number]> = [];
    const n = 40;
    const ns = notches[side > 0 ? 'r' : 'l'];
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      // barb clumps bulge slightly between notches
      let bulge = 1;
      for (const c of ns) bulge -= 0.07 * Math.exp(-((s - c) ** 2) / 0.0006);
      const yy = F_BASE + s * L;
      out.push([side * hw(s, side) * bulge, yy]);
      for (const c of ns) {
        if (s < c && (i + 1) / n >= c) {
          // V-cut following the barb angle (inward and down)
          const w = hw(c, side);
          out.push([side * w * 0.97, F_BASE + (c - 0.012) * L]);
          out.push([side * w * 0.32, F_BASE + (c - 0.1) * L]);
          out.push([side * w * 0.97, F_BASE + (c + 0.01) * L]);
        }
      }
    }
    return out;
  };
  const right = edge(1), left = edge(-1);
  const s = new THREE.Shape();
  s.moveTo(0, F_BASE);
  for (const [x, y] of right) s.lineTo(x, y);
  for (let i = left.length - 1; i >= 0; i--) s.lineTo(left[i][0], left[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -0.006);
  const p = g.attributes.position as THREE.BufferAttribute;
  const uvA = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    uvA.setXY(i, (x + 0.2) / 0.4, (y - F_BASE) / L);
    // cupped barbs + bent rachis
    p.setXYZ(i, x + fBendX(y), y, z + fBendZ(y) - 0.35 * x * x + 0.05 * Math.abs(x));
  }
  g.computeVertexNormals();
  return g;
});
let featherTexC: THREE.Texture | null = null;
function featherTex() {
  if (featherTexC) return featherTexC;
  featherTexC = canvasTex(256, 512, (g, W, H) => {
    // H: v=0 (base) at the canvas bottom
    const gr = g.createLinearGradient(0, H, 0, 0);
    gr.addColorStop(0, '#1e8fd0');
    gr.addColorStop(0.3, '#36b8f0');
    gr.addColorStop(0.62, '#8ae4ff');
    gr.addColorStop(0.88, '#e4f9ff');
    gr.addColorStop(1, '#ffffff');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const cx = W / 2;
    // soft darker bars across the vane
    for (const [v, a] of [[0.2, 0.22], [0.36, 0.14]] as const) {
      const y = H * (1 - v);
      const lg = g.createLinearGradient(0, y - 26, 0, y + 26);
      lg.addColorStop(0, 'rgba(10,60,140,0)'); lg.addColorStop(0.5, `rgba(10,60,140,${a})`); lg.addColorStop(1, 'rgba(10,60,140,0)');
      g.fillStyle = lg; g.fillRect(0, y - 26, W, 52);
    }
    // barbs: fine lines angling up from the rachis
    for (let y = H + 40; y > -60; y -= 7) {
      for (const s of [1, -1]) {
        g.strokeStyle = (y / 7) % 2 < 1 ? 'rgba(255,255,255,0.32)' : 'rgba(14,70,150,0.18)';
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(cx, y); g.quadraticCurveTo(cx + s * W * 0.25, y - 38, cx + s * W * 0.55, y - 92); g.stroke();
      }
    }
    // white tips at the outer edges
    const eg = g.createLinearGradient(0, 0, W, 0);
    eg.addColorStop(0, 'rgba(255,255,255,0.5)'); eg.addColorStop(0.12, 'rgba(255,255,255,0)'); eg.addColorStop(0.88, 'rgba(255,255,255,0)'); eg.addColorStop(1, 'rgba(255,255,255,0.5)');
    g.fillStyle = eg; g.fillRect(0, 0, W, H);
    // rachis line
    g.strokeStyle = '#f4fcff'; g.lineWidth = 6; g.beginPath(); g.moveTo(cx, H); g.lineTo(cx, 0); g.stroke();
  });
  return featherTexC;
}

/** flat "wind curl" in the XY plane: a long gentle tail that rolls into a spiral */
const swirlGeo = () => cached('art-swirl', () => {
  const pts: THREE.Vector3[] = [];
  const n = 60, r0 = 0.075;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    if (s < 0.4) {
      const k = s / 0.4;
      pts.push(new THREE.Vector3(-0.3 * (1 - k), -0.025 * Math.sin(Math.PI * k) , 0));
    } else {
      const k = (s - 0.4) / 0.6;
      const a = -Math.PI / 2 + k * TAU * 1.2;
      const r = r0 * (1 - 0.72 * k);
      pts.push(new THREE.Vector3(r * Math.cos(a), r0 + r * Math.sin(a), 0));
    }
  }
  return taperedTube(new THREE.CatmullRomCurve3(pts), 90, 5, (t) => 0.0085 * Math.min(1, t / 0.12, (1 - t) / 0.15) + 0.0015, false);
});

function createFeather(): Artifact {
  const root = new THREE.Group();
  root.name = 'artifact-feather';
  const sway = grp(root);
  const f = grp(sway, [-0.06, 0.02, 0], [0, 0, -0.28]);
  part(f, featherVaneGeo(), matU('#ffffff', { map: featherTex() }));
  // rachis + bare quill
  const rachis = cached('art-feather-rachis', () => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const y = lerp(F_QUILL + 0.06, F_TIP - 0.02, i / 16);
      pts.push(new THREE.Vector3(fBendX(y), y, fBendZ(y) + 0.004));
    }
    return taperedTube(new THREE.CatmullRomCurve3(pts), 40, 8, (t) => lerp(0.021, 0.004, Math.pow(t, 0.8)));
  });
  part(f, rachis, mat('#f2fbff'));
  // golden nib at the quill end
  const nib = grp(f, [fBendX(F_QUILL + 0.06), F_QUILL + 0.06, fBendZ(F_QUILL + 0.06)], [0, 0, 0.04]);
  const gold = mat(PAL.gold);
  part(nib, G.cone(), gold, [0, -0.07, 0], [0.026, 0.12, 0.026], [Math.PI, 0, 0]);
  part(nib, G.torus(0.024, 0.008, 8, 20), mat('#c98f1c'), [0, -0.005, 0], 1, [Math.PI / 2, 0, 0], fo);
  part(nib, G.torus(0.02, 0.006, 8, 20), gold, [0, -0.03, 0], 1, [Math.PI / 2, 0, 0], fo);
  part(nib, G.ball(), mat('#5ff4ff', { emissive: '#2ad8ff', emissiveIntensity: 0.5 }), [0, -0.05, 0.02], [0.01, 0.014, 0.006], undefined, fo);
  // downy fluff at the base of the vane
  const fluffM = mat('#bfeeff');
  for (const [x, y, a, l] of [[0.03, F_BASE + 0.02, -0.9, 0.11], [-0.025, F_BASE + 0.03, 0.95, 0.1], [0.02, F_BASE - 0.02, -1.25, 0.08], [-0.02, F_BASE - 0.01, 1.3, 0.075]] as const) {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(Math.sin(-a) * l * 0.6, Math.cos(a) * l * 0.5, 0.0),
      new THREE.Vector3(Math.sin(-a) * l, Math.cos(a) * l * 0.2 + 0.03, -0.01),
    );
    part(f, taperedTube(curve, 8, 5, (t) => 0.012 * (1 - t) + 0.003), fluffM, [fBendX(y) + x * 0.3, y, fBendZ(y)], undefined, undefined, fo);
  }

  // wind swirls + sparkles
  const fx = grp(root);
  const swirlM = basic('#e8fbff', { transparent: true, opacity: 0.8, depthWrite: false });
  const swirls: Array<{ g: THREE.Group; ph: number }> = [];
  for (const [x, y, z, s, ry, ph] of [[0.32, -0.16, 0.08, 1, 0.3, 0], [-0.3, 0.2, -0.05, -0.85, -0.4, 1.7], [0.18, 0.42, -0.1, 0.7, 0.2, 3.1]] as const) {
    const g = grp(fx, [x, y, z], [0, ry, 0]);
    const m = part(g, swirlGeo(), swirlM.clone(), undefined, [s, Math.abs(s), 1], undefined, nob);
    noOutline(m);
    swirls.push({ g, ph });
  }
  const glow = fxSprite(root, glowTex(), '#6fdcff', 1.3, 0.25, [0, 0, -0.1]);
  const tw = twinkles(fx, 7, ['#ffffff', '#a8f0ff', '#fff4c0'], [0.35, 0.6], [-0.45, 0.55], [0.08, 0.15], 11);

  let t = Math.random() * 10;
  return {
    root,
    update(dt: number) {
      dt = Math.min(dt, 0.1);
      t += dt;
      sway.rotation.z = Math.sin(t * 1.3) * 0.12;
      sway.rotation.x = Math.sin(t * 0.9 + 1) * 0.08;
      sway.position.y = Math.sin(t * 1.3 + 0.8) * 0.03;
      sway.position.x = Math.sin(t * 0.65) * 0.03;
      for (const s of swirls) {
        const k = ((t * 0.45 + s.ph / TAU) % 1);
        const m = (s.g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
        m.opacity = 0.85 * Math.sin(Math.PI * k);
        s.g.scale.setScalar(0.7 + 0.5 * k);
        s.g.position.y += 0;
        s.g.rotation.z = -k * 0.8;
      }
      glow.material.opacity = 0.2 + 0.06 * Math.sin(t * 2.4);
      tw(t);
    },
  };
}

// ════════════════════════════════════════════════════════════════════
//  FORK — «Вилка-Копьё»: a hero-sized fork turned spear
// ════════════════════════════════════════════════════════════════════
const forkHeadGeo = () => cached('art-fork-head', () => {
  const s = new THREE.Shape();
  const tw = 0.0185, gapBot = 0.18, tineTop = 0.4;
  const xs = [-0.0855, -0.0285, 0.0285, 0.0855];
  const tips = [0.455, 0.49, 0.49, 0.455];
  s.moveTo(-0.026, 0);
  s.bezierCurveTo(-0.028, 0.07, xs[0] - tw - 0.004, 0.08, xs[0] - tw, 0.17);
  for (let k = 0; k < 4; k++) {
    const l = xs[k] - tw, r = xs[k] + tw;
    if (k > 0) s.lineTo(l, gapBot);
    s.lineTo(l, tineTop - (k === 0 ? 0.02 : 0));
    s.quadraticCurveTo(l + 0.002, tips[k] - 0.035, xs[k], tips[k]);
    s.quadraticCurveTo(r - 0.002, tips[k] - 0.035, r, tineTop - (k === 3 ? 0.02 : 0));
    if (k < 3) {
      s.lineTo(r, gapBot);
      const cx = (r + xs[k + 1] - tw) / 2, rad = (xs[k + 1] - tw - r) / 2;
      s.absarc(cx, gapBot, rad, Math.PI, TAU, false);
    }
  }
  s.lineTo(xs[3] + tw, 0.17);
  s.bezierCurveTo(xs[3] + tw + 0.004, 0.08, 0.028, 0.07, 0.026, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.007, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -0.013);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, p.getZ(i) + 0.22 * y * y); }
  g.computeVertexNormals();
  return g;
});

let pennantTexC: THREE.Texture | null = null;
function pennantTexture() {
  if (pennantTexC) return pennantTexC;
  pennantTexC = canvasTex(256, 96, (c, W, H) => {
    c.fillStyle = '#e8383d'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#b8222c'; c.fillRect(0, H * 0.42, W, H * 0.16);
    c.fillStyle = '#f2c23a'; c.fillRect(0, 0, W, H * 0.1); c.fillRect(0, H * 0.9, W, H * 0.1); c.fillRect(0, 0, W * 0.07, H);
    c.save(); c.translate(W * 0.3, H / 2);
    starPath(c, 0, 0, 30, 13);
    c.fillStyle = '#fff6da'; c.fill(); c.lineWidth = 4; c.strokeStyle = '#8a2a20'; c.stroke();
    c.restore();
  });
  return pennantTexC;
}

function createFork(): Artifact {
  const root = new THREE.Group();
  root.name = 'artifact-fork';
  const tilt = grp(root, [0, 0, 0], [0, 0, -0.32]);
  tilt.scale.setScalar(0.86);
  const f = grp(tilt, [0, -0.0, 0]);
  // cool, slightly self-lit steel so it stays "silver" under the warm pickup light
  const silver = mat('#7086a8', { emissive: '#1c2e4c', emissiveIntensity: 0.35 });
  const silverD = mat('#566884', { emissive: '#16243c', emissiveIntensity: 0.3 });
  const gold = mat(PAL.gold);
  const goldD = mat('#c98f1c');
  const shine = basic('#ffffff', { transparent: true, opacity: 0.9 });

  // head
  part(f, forkHeadGeo(), silver, [0, 0.27, 0]);
  // highlights on the tines (both faces)
  for (const zs of [1, -1]) {
    for (const x of [-0.0855, -0.0285, 0.0285, 0.0855]) {
      const y = 0.27 + 0.29;
      part(f, G.capsule(0.005, 0.12, 6), shine, [x - 0.006, y, zs * 0.026 + 0.22 * 0.29 * 0.29 * 1.0], 1, undefined, nob);
    }
    part(f, G.sphere(), shine, [-0.03, 0.27 + 0.1, zs * 0.024 + 0.003], [0.024, 0.012, 0.004], [0, 0, 0.5], nob);
  }
  // gold star inlay on the palm (both faces)
  for (const zs of [1, -1]) part(f, starGeo(), gold, [0, 0.27 + 0.1, zs * 0.026], [0.07, 0.07, 0.06], [0, zs > 0 ? 0 : Math.PI, 0], fo);
  // ornate collar
  part(f, G.cyl(), goldD, [0, 0.25, 0], [0.034, 0.05, 0.034]);
  part(f, G.torus(0.034, 0.01, 8, 24), gold, [0, 0.275, 0], 1, [Math.PI / 2, 0, 0]);
  part(f, G.torus(0.036, 0.011, 8, 24), gold, [0, 0.228, 0], 1, [Math.PI / 2, 0, 0]);
  const gemM = matU('#ff3a5a', { emissive: '#ff2040', emissiveIntensity: 0.4, flat: true });
  for (const zs of [1, -1]) part(f, cached('art-gem', () => new THREE.OctahedronGeometry(1, 0)), gemM, [0, 0.25, zs * 0.036], [0.02, 0.026, 0.012], undefined, fo);
  // shaft
  part(f, G.cyl(), silver, [0, -0.02, 0], [0.019, 0.5, 0.019]);
  part(f, G.torus(0.021, 0.008, 8, 20), gold, [0, 0.06, 0], 1, [Math.PI / 2, 0, 0], fo);
  part(f, G.cyl(), silverD, [0, -0.02, 0], [0.0195, 0.006, 0.0195], undefined, fo);
  // grip: red leather with a gold spiral wrap
  part(f, G.cyl(), mat('#8a2232'), [0, -0.43, 0], [0.03, 0.34, 0.03]);
  part(f, cached('art-fork-wrap', () => taperedTube(new Helix(0.031, -0.59, -0.27, 5.5), 160, 6, () => 0.0075, false)), gold, undefined, undefined, undefined, fo);
  for (const y of [-0.26, -0.6]) {
    part(f, G.cyl(), gold, [0, y, 0], [0.037, 0.03, 0.037]);
    part(f, G.torus(0.037, 0.008, 8, 24), goldD, [0, y + (y > -0.4 ? -0.016 : 0.016), 0], 1, [Math.PI / 2, 0, 0], fo);
  }
  // pommel: gold sphere + spike + gem
  part(f, G.sphere(), gold, [0, -0.655, 0], 0.045);
  part(f, G.cone(), goldD, [0, -0.72, 0], [0.022, 0.06, 0.022], [Math.PI, 0, 0]);
  for (const zs of [1, -1]) part(f, cached('art-gem', () => new THREE.OctahedronGeometry(1, 0)), gemM, [0, -0.655, zs * 0.042], [0.016, 0.02, 0.01], undefined, fo);
  part(f, G.ball(), shine, [-0.016, -0.638, 0.03], 0.008, undefined, nob);

  // pennant (fluttering swallow-tail flag under the head)
  const PU = 14, PV = 5;
  const ppos = new Float32Array(PU * PV * 3);
  const puv = new Float32Array(PU * PV * 2);
  const pidx: number[] = [];
  for (let j = 0; j < PV; j++) for (let i = 0; i < PU; i++) {
    const k = j * PU + i;
    puv[k * 2] = i / (PU - 1); puv[k * 2 + 1] = j / (PV - 1);
    if (i < PU - 1 && j < PV - 1) { const a = k, b = a + 1, c = a + PU, d = c + 1; pidx.push(a, b, c, b, d, c); }
  }
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3).setUsage(THREE.DynamicDrawUsage));
  pgeo.setAttribute('uv', new THREE.BufferAttribute(puv, 2));
  pgeo.setIndex(pidx);
  const pennantTex = pennantTexture();
  const pennant = part(f, pgeo, matU('#ffffff', { map: pennantTex, side: THREE.DoubleSide }), [0.015, 0.16, 0], undefined, undefined, fo);
  pennant.frustumCulled = false;
  const PL = 0.36, PH = 0.13;
  function flutter(t: number) {
    for (let j = 0; j < PV; j++) for (let i = 0; i < PU; i++) {
      const u = i / (PU - 1), v = j / (PV - 1);
      const notch = 0.26 * Math.pow(1 - Math.abs(2 * v - 1), 1.3) * smooth(clamp((u - 0.55) / 0.45));
      const x = PL * u * (1 - notch);
      const h = PH * (1 - 0.45 * u);
      const k = (j * PU + i) * 3;
      ppos[k] = x + 0.01 * Math.sin(t * 5 + u * 3) * u;
      ppos[k + 1] = (v - 0.5) * h - 0.05 * u * u + 0.012 * Math.sin(t * 6.5 - u * 6) * u;
      ppos[k + 2] = Math.sin(u * 5.5 - t * 7.5) * 0.045 * u + Math.sin(u * 3 - t * 4.1 + v) * 0.015 * u;
    }
    (pgeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    pgeo.computeVertexNormals();
  }

  // magic glints
  const fx = grp(root);
  const glint = fxSprite(fx, sparkTex(), '#ffffff', 0.25, 1, [0, 0, 0]);
  fxSprite(root, glowTex(), '#ffe9a0', 1.4, 0.18, [0, 0, -0.1]);
  const tw = twinkles(fx, 6, ['#ffffff', '#fff2b0', '#d8e8ff'], [0.3, 0.55], [-0.5, 0.55], [0.08, 0.14], 5);
  const tipLocal = new THREE.Vector3(0.0285, 0.27 + 0.49, 0.06);
  const baseLocal = new THREE.Vector3(0, 0.25, 0);

  let t = Math.random() * 10;
  flutter(t);
  return {
    root,
    update(dt: number) {
      dt = Math.min(dt, 0.1);
      t += dt;
      tilt.rotation.z = -0.32 + Math.sin(t * 1.2) * 0.05;
      tilt.rotation.x = Math.sin(t * 0.9) * 0.05;
      flutter(t);
      // a glint that sweeps up the head every couple of seconds
      const k = (t * 0.5) % 1;
      const g = clamp(k / 0.35);
      glint.position.lerpVectors(baseLocal, tipLocal, g).applyMatrix4(f.matrix);
      glint.position.applyEuler(tilt.rotation);
      glint.material.opacity = Math.sin(Math.PI * g) * (k < 0.35 ? 1 : 0);
      glint.material.rotation = t * 3;
      glint.scale.setScalar(0.18 + 0.12 * Math.sin(Math.PI * g));
      gemM.emissiveIntensity = 0.35 + 0.25 * Math.sin(t * 3);
      tw(t);
    },
  };
}

// ════════════════════════════════════════════════════════════════════
//  SLING — «Рогатка»: wooden Y slingshot with red bands and a pea
// ════════════════════════════════════════════════════════════════════
let woodTexC: THREE.Texture | null = null;
function slingWoodTex() {
  if (woodTexC) return woodTexC;
  woodTexC = canvasTex(256, 128, (g, W, H) => {
    g.fillStyle = '#8e5630'; g.fillRect(0, 0, W, H);
    const R = prng(21);
    for (let i = 0; i < 26; i++) {
      const y = R() * H, a = 0.25 + R() * 0.3;
      g.strokeStyle = R() < 0.6 ? `rgba(90,45,18,${a})` : `rgba(235,180,110,${a})`;
      g.lineWidth = 1 + R() * 2.5;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= W; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 2);
      g.stroke();
    }
    // a couple of knots
    for (const [x, y] of [[70, 40], [190, 95]]) {
      g.fillStyle = 'rgba(100,52,20,0.6)'; g.beginPath(); g.ellipse(x, y, 9, 5, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(100,52,20,0.35)'; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y, 15, 8, 0, 0, TAU); g.stroke();
    }
  }, { wrap: true });
  return woodTexC;
}

function createSling(): Artifact {
  const root = new THREE.Group();
  root.name = 'artifact-sling';
  const s = grp(root, [0, 0.05, 0.12]);
  const wood = matU('#ffffff', { map: slingWoodTex() });
  const woodEnd = mat('#d8a060');
  // handle + arms (organic tapered tubes)
  const handle = cached('art-sling-handle', () => taperedTube(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0, -0.52, 0), new THREE.Vector3(0.012, -0.3, 0), new THREE.Vector3(-0.005, -0.1, 0), new THREE.Vector3(0, 0.02, 0),
  ]), 24, 12, (t) => 0.056 + 0.006 * Math.sin(t * Math.PI) - 0.004 * t));
  part(s, handle, wood);
  const tips: THREE.Vector3[] = [];
  for (const sd of [1, -1]) {
    const tip = new THREE.Vector3(sd * 0.25, 0.44, 0);
    tips.push(tip);
    const arm = cached(`art-sling-arm-${sd}`, () => taperedTube(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.0, 0), new THREE.Vector3(sd * 0.09, 0.1, 0), new THREE.Vector3(sd * 0.2, 0.2, 0), new THREE.Vector3(sd * 0.25, 0.32, 0), tip.clone(),
    ]), 28, 12, (t) => 0.052 - 0.012 * t));
    part(s, arm, wood);
    // knob + band grooves at the tip
    part(s, G.sphere(), woodEnd, [tip.x, tip.y + 0.012, 0], [0.042, 0.03, 0.042]);
    part(s, G.torus(0.042, 0.013, 8, 22), mat('#d23a3a'), [tip.x, tip.y - 0.04, 0], 1, [Math.PI / 2, 0, 0]);
    part(s, G.torus(0.043, 0.011, 8, 22), mat('#d23a3a'), [tip.x, tip.y - 0.07, 0], 1, [Math.PI / 2, 0, 0]);
  }
  part(s, G.sphere(), wood, [0, 0.0, 0], [0.066, 0.075, 0.062]);
  // carved grip: leather wrap with brass bands
  const leather = mat('#6a3a22');
  part(s, cached('art-sling-wrap', () => taperedTube(new Helix(0.06, -0.44, -0.12, 4.5), 120, 6, () => 0.016, false)), leather);
  part(s, G.cyl(), mat('#7a4428'), [0, -0.28, 0], [0.058, 0.32, 0.058]);
  for (const y of [-0.45, -0.11]) part(s, G.torus(0.062, 0.014, 8, 24), mat('#e0a93a'), [0, y, 0], 1, [Math.PI / 2, 0, 0]);
  part(s, G.sphere(), woodEnd, [0, -0.53, 0], [0.058, 0.035, 0.058]);
  // little sprout on the fork
  part(s, G.capsule(0.012, 0.05), wood, [0.135, 0.14, 0], 1, [0, 0, -1.0], fo);
  leaf(s, [0.16, 0.155, 0.0], [0.2, -0.2, 0.55], 0.2);

  // bands + pouch + pea
  const band = mat('#e0303a');
  const bandsL = [part(s, G.cyl(), band, undefined, undefined, undefined, fo), part(s, G.cyl(), band, undefined, undefined, undefined, fo)];
  const bandsR = [part(s, G.cyl(), band, undefined, undefined, undefined, fo), part(s, G.cyl(), band, undefined, undefined, undefined, fo)];
  const pouch = grp(s);
  part(pouch, G.sphere(), mat('#7a3a2a'), [0, 0, -0.01], [0.085, 0.07, 0.035]);
  part(pouch, G.torus(0.06, 0.006, 6, 20), mat('#e8c890'), [0, 0, 0.016], [1, 0.8, 1], undefined, fo);
  const pea = grp(pouch, [0, 0, 0.04]);
  part(pea, G.sphere(), mat('#7ad04a'), undefined, 0.058);
  part(pea, G.ball(), basic('#ffffff', { transparent: true }), [-0.02, 0.022, 0.044], [0.016, 0.012, 0.006], [0, 0, 0.6], nob);
  part(pea, G.ball(), basic('#ffffff', { transparent: true, opacity: 0.6 }), [0.026, -0.012, 0.048], 0.006, undefined, nob);
  const peaGlow = fxSprite(pea, glowTex(), '#a8ff7a', 0.32, 0.4);

  const fx = grp(root);
  fxSprite(root, glowTex(), '#ffd08a', 1.3, 0.16, [0, 0, -0.1]);
  const tw = twinkles(fx, 6, ['#ffffff', '#fff2b0', '#c8ffa0'], [0.35, 0.55], [-0.4, 0.55], [0.08, 0.14], 8);

  const pv = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  let t = Math.random() * 10;
  function bands(pull: number) {
    pv.set(0, 0.36 - 0.03 * pull, -0.12 - 0.2 * pull);
    pouch.position.copy(pv);
    pouch.rotation.x = -0.25 * pull;
    for (let i = 0; i < 2; i++) {
      const tip = tips[i];
      const list = i === 0 ? bandsL : bandsR;
      for (let k = 0; k < 2; k++) {
        const dy = k === 0 ? -0.035 : -0.068;
        a.set(tip.x - Math.sign(tip.x) * 0.0, tip.y + dy, 0);
        b.set(pv.x + Math.sign(tip.x) * 0.075, pv.y + (k === 0 ? 0.012 : -0.012), pv.z);
        between(list[k], a, b, 0.012 - 0.003 * pull);
      }
    }
  }
  bands(0.4);
  return {
    root,
    update(dt: number) {
      dt = Math.min(dt, 0.1);
      t += dt;
      // slow draw … hold … twang
      const c = t % 3.2;
      let pull: number;
      if (c < 1.6) pull = 0.25 + 0.75 * smooth(c / 1.6);
      else if (c < 2.1) pull = 1 + 0.02 * Math.sin(c * 40);
      else { const k = c - 2.1; pull = 0.25 + 0.75 * Math.exp(-k * 7) * Math.cos(k * 26); }
      bands(pull);
      s.rotation.z = Math.sin(t * 1.1) * 0.06;
      s.rotation.x = Math.sin(t * 0.8) * 0.04;
      peaGlow.material.opacity = 0.3 + 0.15 * Math.sin(t * 4);
      tw(t);
    },
  };
}

// ════════════════════════════════════════════════════════════════════
//  CONTAINER — «Сердце-Вишня»: glossy cherry heart with stems and a leaf
// ════════════════════════════════════════════════════════════════════
const H_SCALE = 0.0295, H_CY = -2.2, H_LOBE = 0.25, H_FLAT = 0.92;
/** heart outline in final units, centred on the inflation centre; polar lookup r(θ) with θ from +Y */
const heartData = (() => {
  let data: { pts: Float32Array; rTab: Float32Array } | null = null;
  return () => {
    if (data) return data;
    const n = 420;
    const pts = new Float32Array(n * 2 * 2);
    const pol: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) {
      const phi = (i / (n - 1)) * Math.PI;
      const s = Math.sin(phi);
      const x = 16 * s * s * s * H_SCALE;
      const y = (13 * Math.cos(phi) - 5 * Math.cos(2 * phi) - 2 * Math.cos(3 * phi) - Math.cos(4 * phi) - H_CY) * H_SCALE;
      pts[i * 4] = x; pts[i * 4 + 1] = y; pts[i * 4 + 2] = -x; pts[i * 4 + 3] = y;
      pol.push([Math.atan2(x, y), Math.hypot(x, y)]);
    }
    const B = 512;
    const rTab = new Float32Array(B + 1);
    let k = 0;
    for (let b = 0; b <= B; b++) {
      const th = (b / B) * Math.PI;
      while (k < pol.length - 2 && pol[k + 1][0] < th) k++;
      const [t0, r0] = pol[k], [t1, r1] = pol[k + 1];
      rTab[b] = lerp(r0, r1, clamp((th - t0) / Math.max(1e-6, t1 - t0)));
    }
    data = { pts, rTab };
    return data;
  };
})();
function heartR(theta: number) {
  const { rTab } = heartData();
  const f = (Math.abs(theta) / Math.PI) * (rTab.length - 1);
  const i = Math.min(rTab.length - 2, Math.floor(f));
  return lerp(rTab[i], rTab[i + 1], f - i);
}
/** inflated thickness at a point of the 2D heart: round like a cherry near the rims, plateau inside */
function heartZ(x: number, y: number) {
  const { pts } = heartData();
  let d2 = Infinity;
  for (let i = 0; i < pts.length; i += 2) { const dx = pts[i] - x, dy = pts[i + 1] - y; const q = dx * dx + dy * dy; if (q < d2) d2 = q; }
  const u = Math.min(1, Math.sqrt(d2) / H_LOBE);
  return H_LOBE * H_FLAT * Math.sqrt(1 - (1 - u) * (1 - u));
}
const heartGeo = () => cached('art-heart', () => {
  let g: THREE.BufferGeometry = new THREE.SphereGeometry(1, 72, 48);
  g.rotateX(Math.PI / 2);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const rho = Math.min(1, Math.hypot(x, y));
    const th = Math.atan2(x, y);
    const r = heartR(th) * rho;
    const X = Math.sin(th) * r, Y = Math.cos(th) * r;
    p.setXYZ(i, X, Y, Math.sign(z) * heartZ(X, Y) * (rho > 0.999 ? 0 : 1));
  }
  g.computeVertexNormals();
  // darker crimson toward the bottom point and the rims → reads round and juicy even with toon bands
  const col = new Float32Array(p.count * 3);
  const cTop = new THREE.Color('#ff3c52'), cLow = new THREE.Color('#b0102c'), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = Math.abs(p.getZ(i));
    const rim = 1 - clamp(z / (H_LOBE * H_FLAT));
    c.copy(cTop).lerp(cLow, clamp(smooth(clamp((0.15 - y) / 0.6)) * 0.75 + rim * rim * 0.45));
    void x;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
});

function createHeart(): Artifact {
  const root = new THREE.Group();
  root.name = 'artifact-heart';
  const beat = grp(root, [0, -0.17, 0]);
  beat.scale.setScalar(0.95);
  const heart = grp(beat);
  const cherry = matU('#ffffff', { emissive: '#ff2050', emissiveIntensity: 0.1 });
  cherry.vertexColors = true;
  part(heart, heartGeo(), cherry);
  // glossy highlights (front and back), laid flat on the surface
  const hl = basic('#ffffff', { transparent: true, opacity: 0.95 });
  const hl2 = basic('#ffd6de', { transparent: true, opacity: 0.8 });
  const zAxis = new THREE.Vector3(0, 0, 1), nrm = new THREE.Vector3(), qz = new THREE.Quaternion();
  const decal = (x: number, y: number, side: number, sx: number, sy: number, rot: number, m: THREE.Material) => {
    const e = 0.004;
    const hx = (heartZ(x + e, y) - heartZ(x - e, y)) / (2 * e), hy = (heartZ(x, y + e) - heartZ(x, y - e)) / (2 * e);
    nrm.set(-hx * side, -hy * side, side).normalize();
    const d = part(heart, G.sphere(), m, [x, y, side * heartZ(x, y)], [sx, sy, 0.006], undefined, nob);
    d.position.addScaledVector(nrm, 0.004);
    d.quaternion.setFromUnitVectors(zAxis, nrm).multiply(qz.setFromAxisAngle(zAxis, rot));
  };
  for (const side of [1, -1]) {
    decal(-0.28 * side, 0.25, side, 0.075, 0.04, 0.75 * side, hl);
    decal(-0.18 * side, 0.15, side, 0.02, 0.02, 0, hl);
    decal(0.27 * side, 0.29, side, 0.04, 0.018, -0.7 * side, hl2);
    decal(0.05 * side, -0.24, side, 0.03, 0.013, 0.95 * side, hl2);
  }
  // dimples where the stems enter (top of each lobe)
  const dimple = mat('#9a1028');
  const knot = new THREE.Vector3(0.03, 0.66, -0.01);
  const stemM = mat('#5e8a2c');
  for (const sd of [1, -1]) {
    const bx = sd * 0.24;
    const by = heartR(Math.atan2(bx, 0.4)) * Math.cos(Math.atan2(bx, 0.4)) - 0.02;
    part(heart, G.sphere(), dimple, [bx, by + 0.012, 0], [0.032, 0.014, 0.032], undefined, fo);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(bx, by, 0),
      new THREE.Vector3(bx * 0.92, by + 0.08, 0.005),
      new THREE.Vector3(bx * 0.45 + 0.01, by + 0.19, 0),
      knot,
    ]);
    part(heart, taperedTube(curve, 24, 8, (t) => lerp(0.017, 0.012, t)), stemM);
  }
  part(heart, G.sphere(), mat('#6e5a2a'), [knot.x, knot.y, knot.z], [0.024, 0.028, 0.024]);
  leaf(heart, [knot.x + 0.01, knot.y + 0.01, knot.z], [0.15, -0.5, 0.42], 0.36);
  leaf(heart, [knot.x - 0.01, knot.y + 0.005, knot.z], [-0.25, 0.7, 2.65], 0.24);

  // glow + sparkles
  const glow = fxSprite(root, glowTex(), '#ff5a8a', 1.5, 0.28, [0, 0, -0.12]);
  const fx = grp(root);
  const tw = twinkles(fx, 8, ['#ffffff', '#ffd0e0', '#fff2b0'], [0.45, 0.65], [-0.45, 0.55], [0.08, 0.16], 2);

  let t = Math.random() * 10;
  return {
    root,
    update(dt: number) {
      dt = Math.min(dt, 0.1);
      t += dt;
      // lub-dub heartbeat
      const ph = t % 1.25;
      const b = Math.exp(-(((ph - 0.08) / 0.055) ** 2)) * 0.075 + Math.exp(-(((ph - 0.3) / 0.06) ** 2)) * 0.05;
      beat.scale.set(0.95 * (1 + b), 0.95 * (1 + b * 0.8), 0.95 * (1 + b));
      cherry.emissiveIntensity = 0.1 + b * 3;
      glow.material.opacity = 0.22 + b * 2.2;
      glow.scale.setScalar(1.4 + b * 3);
      heart.rotation.z = Math.sin(t * 1.2) * 0.06;
      heart.rotation.x = Math.sin(t * 0.9) * 0.04;
      tw(t);
    },
  };
}

// ════════════════════════════════════════════════════════════════════
export function createArtifact(kind: ArtifactKind): Artifact {
  let a: Artifact;
  switch (kind) {
    case 'dash': a = createDash(); break;
    case 'doubleJump': a = createFeather(); break;
    case 'fork': a = createFork(); break;
    case 'sling': a = createSling(); break;
    case 'container': a = createHeart(); break;
  }
  a.update(0);
  return a;
}
