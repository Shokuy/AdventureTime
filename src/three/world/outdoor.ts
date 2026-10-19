import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { matU, basic, noOutline, canvasTex } from '../gfx';
import { srand } from '../../engine/util';

/**
 * Reusable procedural outdoor scenery (no assets): gradient sky dome with sun/moon, layered distant hills,
 * polar terrain, instanced trees / grass / flowers, stone ring walls (wells, shafts), fallen log, clouds, birds, mist.
 * Everything is built for the toon look of gfx.ts; sky/hills/clouds/mist/particles live on the no-outline layer.
 */

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export type HeightFn = (x: number, z: number) => number;
/** Direction from azimuth (0 = −Z, +π/2 = +X) and elevation (radians). */
export function dirAzEl(az: number, el: number, out = new THREE.Vector3()) {
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

// ───────────────────────────── textures ─────────────────────────────
let glowT: THREE.Texture | null = null;
/** Soft white radial glow (alpha falloff) for halos / light discs. */
export function glowTex() {
  if (glowT) return glowT;
  glowT = canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.14)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  return glowT;
}

let stoneT: THREE.Texture | null = null;
/** Neutral speckled stone face with darker bevel edges (tinted per instance). */
export function stoneTex() {
  if (stoneT) return stoneT;
  stoneT = canvasTex(128, 128, (g, w, h) => {
    const R = srand(77);
    g.fillStyle = '#dcdbd6'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const v = (165 + R() * 80) | 0;
      g.fillStyle = `rgba(${v},${v},${v - 8},0.55)`;
      g.beginPath(); g.ellipse(R() * w, R() * h, 4 + R() * 12, 3 + R() * 8, R() * 3, 0, TAU); g.fill();
    }
    for (let i = 0; i < 220; i++) { g.fillStyle = `rgba(55,55,50,${0.12 + R() * 0.2})`; g.fillRect(R() * w, R() * h, 2, 2); }
    g.strokeStyle = 'rgba(70,66,60,0.5)'; g.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) {
      let x = R() * w, y = R() * h;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (R() - 0.5) * 34; y += (R() - 0.3) * 22; g.lineTo(x, y); }
      g.stroke();
    }
    const v1 = g.createLinearGradient(0, 0, 0, h);
    v1.addColorStop(0, 'rgba(255,255,255,0.28)'); v1.addColorStop(0.14, 'rgba(255,255,255,0)');
    v1.addColorStop(0.8, 'rgba(0,0,0,0)'); v1.addColorStop(1, 'rgba(0,0,0,0.38)');
    g.fillStyle = v1; g.fillRect(0, 0, w, h);
    const v2 = g.createLinearGradient(0, 0, w, 0);
    v2.addColorStop(0, 'rgba(0,0,0,0.28)'); v2.addColorStop(0.1, 'rgba(0,0,0,0)');
    v2.addColorStop(0.9, 'rgba(0,0,0,0)'); v2.addColorStop(1, 'rgba(0,0,0,0.28)');
    g.fillStyle = v2; g.fillRect(0, 0, w, h);
  });
  return stoneT;
}

function barkTex() {
  return canvasTex(256, 128, (g, w, h) => {
    const R = srand(31);
    g.fillStyle = '#6f4c33'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) {
      const x = R() * w, ww = 2 + R() * 6;
      g.fillStyle = R() < 0.5 ? 'rgba(40,24,14,0.55)' : 'rgba(150,108,72,0.35)';
      g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y <= h; y += 16) g.lineTo(x + Math.sin(y * 0.08 + i) * 3, y);
      g.lineTo(x + ww, h); g.lineTo(x + ww, 0); g.closePath(); g.fill();
    }
    for (let i = 0; i < 12; i++) { g.fillStyle = 'rgba(110,140,60,0.35)'; g.beginPath(); g.ellipse(R() * w, R() * h * 0.4, 6 + R() * 12, 3 + R() * 5, 0, 0, TAU); g.fill(); }
  }, { wrap: true });
}

function ringsTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#d9b07a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(150,100,55,0.55)'; g.lineWidth = 2;
    for (let r = 6; r < 60; r += 5 + (r % 3)) { g.beginPath(); g.ellipse(w / 2 + 2, h / 2 - 1, r, r * 0.96, 0, 0, TAU); g.stroke(); }
    g.strokeStyle = 'rgba(120,80,40,0.6)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 + 26, h / 2 + 30); g.stroke();
    g.strokeStyle = '#4a3020'; g.lineWidth = 8; g.beginPath(); g.arc(w / 2, h / 2, 60, 0, TAU); g.stroke();
  });
}

// ───────────────────────────── sky dome ─────────────────────────────
export interface SkyColors { zenith: string; upper: string; lower: string; horizon: string; anti: string; glow: string; sun: string; moon: string }
export interface SkyDome {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  setSun(dir: THREE.Vector3): void;
}

/**
 * Infinite gradient sky (vertex shader pins it to the far plane, follows the camera).
 * Deep zenith → peach → gold horizon, warmer toward the sun azimuth, lavender opposite; soft sun disc + halo; optional pale moon.
 */
export function skyDome(c: SkyColors, sunDir: THREE.Vector3, o: { sunSize?: number; moonDir?: THREE.Vector3; moonSize?: number } = {}): SkyDome {
  const uniforms: Record<string, THREE.IUniform> = {
    zenith: { value: new THREE.Color(c.zenith) }, upper: { value: new THREE.Color(c.upper) },
    lower: { value: new THREE.Color(c.lower) }, horizon: { value: new THREE.Color(c.horizon) },
    anti: { value: new THREE.Color(c.anti) }, glowCol: { value: new THREE.Color(c.glow) },
    sunCol: { value: new THREE.Color(c.sun) }, moonCol: { value: new THREE.Color(c.moon) },
    sunDir: { value: sunDir.clone().normalize() }, sunSize: { value: o.sunSize ?? 0.042 },
    moonDir: { value: (o.moonDir ?? new THREE.Vector3(0, -1, 0)).clone().normalize() }, moonSize: { value: o.moonSize ?? 0.03 },
  };
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 zenith, upper, lower, horizon, anti, glowCol, sunCol, moonCol, sunDir, moonDir;
      uniform float sunSize, moonSize;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec2 hd = normalize(d.xz + vec2(1e-5, 0.0));
        vec2 hs = normalize(sunDir.xz + vec2(1e-5, 0.0));
        float az = dot(hd, hs) * 0.5 + 0.5;            // 1 toward the sun, 0 opposite
        float warm = smoothstep(0.2, 0.95, az);
        vec3 hor = mix(anti, horizon, warm);
        vec3 low = mix(mix(anti, upper, 0.35), lower, smoothstep(0.0, 0.85, az));
        vec3 c = mix(hor, low, smoothstep(0.0, 0.13, h));
        c = mix(c, upper, smoothstep(0.09, 0.42, h));
        c = mix(c, zenith, smoothstep(0.38, 1.0, h));
        float cs = dot(d, sunDir);
        float sd = max(cs, 0.0);
        c += glowCol * (pow(sd, 5.0) * 0.32 * (1.0 - smoothstep(0.0, 0.55, h)) + pow(sd, 48.0) * 0.5 + pow(sd, 420.0) * 0.7);
        float disc = smoothstep(cos(sunSize), cos(sunSize * 0.78), cs);
        c = mix(c, sunCol, disc);
        float md = dot(d, moonDir);
        float moon = smoothstep(cos(moonSize), cos(moonSize * 0.86), md);
        float mspot = smoothstep(cos(moonSize * 0.5), cos(moonSize * 0.3), dot(d, normalize(moonDir + vec3(0.012, 0.0, 0.008))));
        c += moonCol * pow(max(md, 0.0), 900.0) * 0.25;
        c = mix(c, moonCol * (1.0 - 0.12 * mspot), moon * 0.92);
        if (d.y < 0.0) c = mix(hor, hor * 0.92, smoothstep(0.0, -0.25, d.y));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), m);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  noOutline(mesh);
  return { mesh, uniforms, setSun: (dir) => { (uniforms.sunDir.value as THREE.Vector3).copy(dir).normalize(); } };
}

/** Additive sun glare billboard (drawn over far hills, occluded by near geometry). */
export function sunGlare(color: string, size: number, opacity = 0.55) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(color), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  s.scale.setScalar(size);
  noOutline(s);
  return s;
}

/**
 * Soft volumetric-looking light shaft: an open cone whose brightness follows how squarely each point faces the
 * camera (≈ path length through the beam), so edges melt away and it vanishes when seen along its own axis.
 * Top of the cone is at y = +len/2. `map` (optional) modulates alpha (streaks / falloff along the length).
 */
export function lightBeam(rTop: number, rBot: number, len: number, color: string, opacity: number, map?: THREE.Texture) {
  const uniforms = {
    color: { value: new THREE.Color(color) },
    opacity: { value: opacity },
    map: { value: map ?? glowTex() },
    useMap: { value: map ? 1 : 0 },
  };
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 color; uniform float opacity; uniform sampler2D map; uniform float useMap;
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main() {
        float f = abs(dot(normalize(vN), normalize(vV)));
        float tex = useMap > 0.5 ? texture2D(map, vUv).a : vUv.y;
        float a = pow(f, 1.6) * tex * opacity;
        gl_FragColor = vec4(color, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 28, 1, true), m);
  mesh.frustumCulled = false;
  noOutline(mesh);
  return { mesh, setOpacity: (k: number) => { uniforms.opacity.value = opacity * k; mesh.visible = k > 0.01; } };
}

// ───────────────────────────── distant hills ─────────────────────────────
export interface HillLayer {
  r: number; base: number; amp: number; seed: number;
  color: string; rim: string; haze: string;
  /** spiky forest silhouette height */
  bumps?: number;
  seg?: number;
  /** lowers the ridge around the sun azimuth (0..1) */
  notch?: number;
}

/**
 * Full 360° ridge rings at increasing distance. Unlit vertex colours: rim-lit tops, bodies fading into haze
 * (atmospheric perspective), warmer/lighter toward the sun, cooler away. No depth writes (no outlines), painter-ordered.
 */
export function hillRings(layers: HillLayer[], sunAz: number, cool: string): THREE.Group {
  const grp = new THREE.Group();
  const coolC = new THREE.Color(cool);
  const sorted = [...layers].sort((a, b) => b.r - a.r);
  sorted.forEach((L, li) => {
    const R = srand(L.seed);
    const seg = L.seg ?? 512;
    const ks = [2, 3, 5, 7, 11, 17, 29];
    const ph = ks.map(() => R() * TAU);
    const wts = [0.34, 0.26, 0.18, 0.11, 0.07, 0.04, 0.025];
    const tops: number[] = [];
    // rounded tree-crown bumps: random heights every 3 vertices, smoothly interpolated (no aliasing spikes)
    const crowns: number[] = [];
    for (let i = 0; i <= Math.ceil(seg / 3) + 1; i++) crowns.push(R());
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      let n = 0;
      for (let k = 0; k < ks.length; k++) n += Math.sin(ks[k] * a + ph[k]) * wts[k];
      let y = L.base + L.amp * (0.5 + n);
      const dA = Math.atan2(Math.sin(a - sunAz), Math.cos(a - sunAz));
      if (L.notch) y -= L.notch * L.amp * Math.exp(-((dA / 0.22) ** 2));
      if (L.bumps) {
        const ci = Math.floor(i / 3), f = (i % 3) / 3;
        const c0 = crowns[ci], c1 = crowns[ci + 1];
        y += L.bumps * (0.3 + 0.7 * (c0 + (c1 - c0) * (f * f * (3 - 2 * f)))) * (0.75 + 0.25 * Math.sin(f * Math.PI));
      }
      tops.push(y);
    }
    const rows = 4;
    const pos = new Float32Array((seg + 1) * rows * 3);
    const col = new Float32Array((seg + 1) * rows * 3);
    const cBody = new THREE.Color(L.color), cRim = new THREE.Color(L.rim), cHaze = new THREE.Color(L.haze);
    const tmp = new THREE.Color();
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      const x = Math.sin(a), z = -Math.cos(a);
      const toward = Math.cos(a - sunAz) * 0.5 + 0.5;
      const ys = [tops[i], tops[i] - 1.5 - L.amp * 0.08, L.base - L.amp * 0.4 - 6, L.base - 140];
      const cs = [cRim, cBody, cBody.clone().lerp(cHaze, 0.55), cHaze];
      for (let rI = 0; rI < rows; rI++) {
        const k = (i * rows + rI) * 3;
        pos[k] = x * L.r; pos[k + 1] = ys[rI]; pos[k + 2] = z * L.r;
        tmp.copy(cs[rI]).lerp(cHaze, 0.22 * smoothstep(0.55, 1, toward)).lerp(coolC, 0.35 * (1 - smoothstep(0.1, 0.7, toward)));
        col[k] = tmp.r; col[k + 1] = tmp.g; col[k + 2] = tmp.b;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < seg; i++) for (let rI = 0; rI < rows - 1; rI++) {
      const a = i * rows + rI, b = (i + 1) * rows + rI;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false, side: THREE.DoubleSide }));
    m.renderOrder = -900 + li;
    m.frustumCulled = false;
    grp.add(m);
  });
  noOutline(grp);
  return grp;
}

// ───────────────────────────── terrain ─────────────────────────────
/** Polar terrain ring (hole in the middle, e.g. for a well), denser near the centre, vertex-coloured toon. */
export function terrainRing(o: { r0: number; r1: number; seg: number; rings: number; height: HeightFn; color: (x: number, z: number, y: number, R: () => number) => THREE.Color; seed?: number; power?: number }): THREE.Mesh {
  const R = srand(o.seed ?? 5);
  const nv = (o.seg + 1) * (o.rings + 1);
  const pos = new Float32Array(nv * 3), colA = new Float32Array(nv * 3);
  let k = 0;
  for (let j = 0; j <= o.rings; j++) {
    const t = j / o.rings;
    const r = o.r0 + (o.r1 - o.r0) * Math.pow(t, o.power ?? 2);
    for (let i = 0; i <= o.seg; i++) {
      const a = (i / o.seg) * TAU;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = o.height(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      const c = o.color(x, z, y, R);
      colA[k * 3] = c.r; colA[k * 3 + 1] = c.g; colA[k * 3 + 2] = c.b;
      k++;
    }
  }
  const idx: number[] = [];
  const W = o.seg + 1;
  for (let j = 0; j < o.rings; j++) for (let i = 0; i < o.seg; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colA, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = matU('#ffffff');
  m.vertexColors = true;
  const mesh = new THREE.Mesh(geo, m);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

// ───────────────────────────── trees ─────────────────────────────
export interface TreeSpot { x: number; y: number; z: number; s: number; kind: 'pine' | 'round' }

function setInst(m: THREE.InstancedMesh, i: number, p: THREE.Vector3, q: THREE.Quaternion, s: THREE.Vector3, c?: THREE.Color) {
  m.setMatrixAt(i, new THREE.Matrix4().compose(p, q, s));
  if (c) m.setColorAt(i, c);
}

/** Instanced stylised trees: layered-cone pines and blobby round trees, colour-varied, shadow casting. 4 draw calls. */
export function treeInstances(spots: TreeSpot[], seed: number, o: { pine?: string[]; round?: string[]; trunk?: string } = {}): THREE.Group {
  const R = srand(seed);
  const g = new THREE.Group();
  const pines = spots.filter((s) => s.kind === 'pine');
  const rounds = spots.filter((s) => s.kind === 'round');
  const pineGeo = mergeGeometries([
    new THREE.ConeGeometry(1.15, 1.6, 9).translate(0, 1.45, 0),
    new THREE.ConeGeometry(0.92, 1.45, 9).translate(0, 2.2, 0),
    new THREE.ConeGeometry(0.62, 1.3, 9).translate(0, 2.95, 0),
  ])!;
  const roundGeo = mergeGeometries([
    new THREE.IcosahedronGeometry(1.0, 1).translate(0, 2.25, 0),
    new THREE.IcosahedronGeometry(0.72, 1).translate(0.72, 1.95, 0.22),
    new THREE.IcosahedronGeometry(0.76, 1).translate(-0.68, 2.0, -0.18),
    new THREE.IcosahedronGeometry(0.7, 1).translate(0.12, 2.95, -0.08),
    new THREE.IcosahedronGeometry(0.6, 1).translate(-0.2, 2.5, 0.65),
    new THREE.IcosahedronGeometry(0.58, 1).translate(0.3, 2.45, -0.7),
  ])!;
  const pineTrunkGeo = new THREE.CylinderGeometry(0.11, 0.18, 1.0, 7).translate(0, 0.5, 0);
  const roundTrunkGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.13, 0.22, 1.9, 7).translate(0, 0.95, 0),
    new THREE.CylinderGeometry(0.05, 0.09, 0.8, 5).rotateZ(-0.8).translate(0.35, 1.6, 0),
  ])!;
  const pc = (o.pine ?? ['#2d5a3d', '#356644', '#28503a', '#3d6e45']).map((c) => new THREE.Color(c));
  const rc = (o.round ?? ['#4d8a3c', '#5a9640', '#679c3e', '#7aa442', '#4a7f3a']).map((c) => new THREE.Color(c));
  const mk = (geo: THREE.BufferGeometry, color: string, n: number) => {
    const m = new THREE.InstancedMesh(geo, matU(color), Math.max(1, n));
    m.count = n; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    g.add(m); return m;
  };
  const pC = mk(pineGeo, '#ffffff', pines.length);
  const pT = mk(pineTrunkGeo, o.trunk ?? '#5a3c28', pines.length);
  const rC = mk(roundGeo, '#ffffff', rounds.length);
  const rT = mk(roundTrunkGeo, o.trunk ?? '#5a3c28', rounds.length);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const tmp = new THREE.Color();
  pines.forEach((t, i) => {
    e.set((R() - 0.5) * 0.06, R() * TAU, (R() - 0.5) * 0.06); q.setFromEuler(e);
    const sy = t.s * (0.9 + R() * 0.35), sx = t.s * (0.85 + R() * 0.25);
    p.set(t.x, t.y - 0.1, t.z); s.set(sx, sy, sx);
    tmp.copy(pc[Math.floor(R() * pc.length)]).multiplyScalar(0.9 + R() * 0.2);
    setInst(pC, i, p, q, s, tmp);
    setInst(pT, i, p, q, s);
  });
  rounds.forEach((t, i) => {
    e.set((R() - 0.5) * 0.08, R() * TAU, (R() - 0.5) * 0.08); q.setFromEuler(e);
    const sy = t.s * (0.88 + R() * 0.3), sx = t.s * (0.9 + R() * 0.25);
    p.set(t.x, t.y - 0.1, t.z); s.set(sx, sy, sx);
    tmp.copy(rc[Math.floor(R() * rc.length)]).multiplyScalar(0.9 + R() * 0.2);
    setInst(rC, i, p, q, s, tmp);
    setInst(rT, i, p, q, s);
  });
  for (const m of [pC, pT, rC, rT]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  g.name = 'trees';
  return g;
}

// ───────────────────────────── grass & flowers ─────────────────────────────
export interface GroundSpot { x: number; y: number; z: number; s: number }

/** Instanced grass tufts (no outline: soft painterly carpet). */
export function grassTufts(spots: GroundSpot[], colors: string[], seed: number): THREE.InstancedMesh {
  const R = srand(seed);
  const blades: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + R() * 0.5;
    const h = 0.28 + R() * 0.26;
    const b = new THREE.ConeGeometry(0.035, h, 3, 1, true).translate(0, h / 2, 0);
    b.rotateZ((0.25 + R() * 0.3)).rotateY(a).translate(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04);
    blades.push(b);
  }
  const geo = mergeGeometries(blades)!;
  const m = new THREE.InstancedMesh(geo, matU('#ffffff'), spots.length);
  const cs = colors.map((c) => new THREE.Color(c));
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const tmp = new THREE.Color();
  spots.forEach((t, i) => {
    e.set((R() - 0.5) * 0.2, R() * TAU, (R() - 0.5) * 0.2); q.setFromEuler(e);
    p.set(t.x, t.y - 0.02, t.z); s.set(t.s, t.s * (0.8 + R() * 0.5), t.s);
    tmp.copy(cs[Math.floor(R() * cs.length)]).multiplyScalar(0.88 + R() * 0.24);
    setInst(m, i, p, q, s, tmp);
  });
  m.receiveShadow = true; m.castShadow = false; m.frustumCulled = false;
  noOutline(m);
  return m;
}

/** Instanced little flowers: stems + coloured 5-petal heads + yellow centres (3 draw calls). */
export function flowerPatch(spots: GroundSpot[], colors: string[], seed: number): THREE.Group {
  const R = srand(seed);
  const g = new THREE.Group();
  const stemGeo = new THREE.CylinderGeometry(0.012, 0.014, 1, 4).translate(0, 0.5, 0);
  const petals: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    petals.push(new THREE.SphereGeometry(0.05, 5, 3).scale(1, 0.4, 0.7).rotateY(-a).translate(Math.cos(a) * 0.055, 0, Math.sin(a) * 0.055));
  }
  const headGeo = mergeGeometries(petals)!;
  const ctrGeo = new THREE.SphereGeometry(0.032, 5, 3).scale(1, 0.6, 1);
  const n = spots.length;
  const stems = new THREE.InstancedMesh(stemGeo, matU('#4f8a34'), n);
  const heads = new THREE.InstancedMesh(headGeo, matU('#ffffff'), n);
  const ctrs = new THREE.InstancedMesh(ctrGeo, matU('#ffc83a'), n);
  const cs = colors.map((c) => new THREE.Color(c));
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  spots.forEach((t, i) => {
    const h = (0.22 + R() * 0.2) * t.s;
    const lean = (R() - 0.5) * 0.25;
    e.set(lean, R() * TAU, (R() - 0.5) * 0.25); q.setFromEuler(e);
    p.set(t.x, t.y - 0.02, t.z); s.set(t.s, h, t.s);
    setInst(stems, i, p, q, s);
    const top = new THREE.Vector3(0, h, 0).applyQuaternion(q).add(p);
    e.set(lean - 0.2, R() * TAU, 0); q.setFromEuler(e);
    s.setScalar(t.s * (0.8 + R() * 0.5));
    setInst(heads, i, top, q, s, cs[Math.floor(R() * cs.length)]);
    setInst(ctrs, i, top.add(new THREE.Vector3(0, 0.012 * t.s, 0)), q, s);
  });
  for (const m of [stems, heads, ctrs]) { m.receiveShadow = true; m.castShadow = false; m.frustumCulled = false; g.add(m); }
  noOutline(g);
  return g;
}

/** Instanced boulders (flat-shaded dodecahedrons). */
export function rocks(spots: GroundSpot[], colors: string[], seed: number): THREE.InstancedMesh {
  const R = srand(seed);
  const m = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), matU('#ffffff', { flat: true }), spots.length);
  const cs = colors.map((c) => new THREE.Color(c));
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  spots.forEach((t, i) => {
    e.set(R() * TAU, R() * TAU, R() * TAU); q.setFromEuler(e);
    p.set(t.x, t.y + t.s * 0.25, t.z); s.set(t.s * (0.9 + R() * 0.5), t.s * (0.55 + R() * 0.3), t.s * (0.9 + R() * 0.4));
    setInst(m, i, p, q, s, cs[Math.floor(R() * cs.length)].clone().multiplyScalar(0.85 + R() * 0.3));
  });
  m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
  return m;
}

/** Instanced soft moss cushions / leaves (flattened icosahedra). */
export function blobs(items: { p: THREE.Vector3; s: THREE.Vector3; rot?: THREE.Euler; c: THREE.Color }[], o: { outline?: boolean; shadow?: boolean } = {}): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), matU('#ffffff'), Math.max(1, items.length));
  m.count = items.length;
  const q = new THREE.Quaternion();
  items.forEach((it, i) => { q.setFromEuler(it.rot ?? new THREE.Euler()); setInst(m, i, it.p, q, it.s, it.c); });
  m.castShadow = o.shadow ?? false; m.receiveShadow = true; m.frustumCulled = false;
  if (!o.outline) noOutline(m);
  return m;
}

// ───────────────────────────── stone ring wall ─────────────────────────────
export interface RingWallOpts {
  rIn: number; thick: number; y0: number; y1: number; seed: number;
  course?: [number, number]; blockLen?: number; protrude?: number;
  tint: (y: number, a: number, R: () => number) => THREE.Color;
}
export interface RingWall { mesh: THREE.InstancedMesh; tops: { p: THREE.Vector3; a: number }[] }

/** Courses of irregular stone blocks around a circle (well wall / shaft lining), one instanced draw call. */
export function stoneRingWall(o: RingWallOpts): RingWall {
  const R = srand(o.seed);
  const cmin = o.course?.[0] ?? 0.45, cmax = o.course?.[1] ?? 0.65;
  const blockLen = o.blockLen ?? 0.95;
  const mats: THREE.Matrix4[] = [];
  const cols: THREE.Color[] = [];
  const tops: { p: THREE.Vector3; a: number }[] = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  let y = o.y0;
  while (y < o.y1 - 0.06) {
    let hgt = cmin + R() * (cmax - cmin);
    if (y + hgt > o.y1 - 0.12) hgt = o.y1 - y;
    const n = Math.max(6, Math.round((TAU * o.rIn) / blockLen + (R() - 0.5) * 2));
    const ws: number[] = []; let acc = 0;
    for (let i = 0; i < n; i++) { const w = 0.7 + R() * 0.6; ws.push(w); acc += w; }
    let a = R() * TAU;
    for (let i = 0; i < n; i++) {
      const da = (ws[i] / acc) * TAU;
      const ac = a + da / 2; a += da;
      const depth = o.thick * (0.86 + R() * 0.14);
      const pr = (o.protrude ?? 0.08) * R();
      const rc = o.rIn - pr + depth / 2;
      const w = o.rIn * da * 0.93;
      p.set(Math.cos(ac) * rc, y + hgt / 2, Math.sin(ac) * rc);
      e.set((R() - 0.5) * 0.05, Math.PI / 2 - ac + (R() - 0.5) * 0.06, (R() - 0.5) * 0.05);
      q.setFromEuler(e);
      s.set(w, hgt * (0.9 + R() * 0.06), depth);
      mats.push(new THREE.Matrix4().compose(p, q, s));
      cols.push(o.tint(y + hgt / 2, ac, R));
      tops.push({ p: new THREE.Vector3(Math.cos(ac) * (o.rIn - pr + 0.05), y + hgt * 0.95, Math.sin(ac) * (o.rIn - pr + 0.05)), a: ac });
    }
    y += hgt;
  }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), matU('#ffffff', { map: stoneTex() }), mats.length);
  mats.forEach((mm, i) => { mesh.setMatrixAt(i, mm); mesh.setColorAt(i, cols[i]); });
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  mesh.name = 'stoneRing';
  return { mesh, tops };
}

/** Flat capstones on top of a ring wall. */
export function ringCap(o: { rIn: number; rOut: number; y: number; h: number; n: number; seed: number; color: string }): THREE.InstancedMesh {
  const R = srand(o.seed);
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), matU('#ffffff', { map: stoneTex() }), o.n);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const base = new THREE.Color(o.color);
  const rc = (o.rIn + o.rOut) / 2;
  for (let i = 0; i < o.n; i++) {
    const a = (i / o.n) * TAU + R() * 0.03;
    const da = TAU / o.n;
    p.set(Math.cos(a) * rc, o.y + o.h / 2 + (R() - 0.5) * 0.04, Math.sin(a) * rc);
    e.set((R() - 0.5) * 0.06, Math.PI / 2 - a + (R() - 0.5) * 0.04, (R() - 0.5) * 0.06); q.setFromEuler(e);
    s.set(rc * da * 0.95, o.h * (0.9 + R() * 0.2), (o.rOut - o.rIn) * (0.95 + R() * 0.1));
    setInst(m, i, p, q, s, base.clone().multiplyScalar(0.85 + R() * 0.3));
  }
  m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
  return m;
}

/** Tapered tube along a curve (roots, vines, branches). */
export function taperTube(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, seg = 24, radial = 6): THREE.BufferGeometry {
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i);
    curve.getPointAt(Math.min(1, u), c);
    v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(r0 + (r1 - r0) * u).add(c);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// ───────────────────────────── props ─────────────────────────────
/** Fallen mossy log lying along X, resting on y=0, centred at the origin. `top` = seat height. */
export function fallenLog(o: { len: number; r: number; seed: number }): { obj: THREE.Group; top: number } {
  const R = srand(o.seed);
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(o.r, o.r * 1.06, o.len, 20, 10, true);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.05 * Math.sin(a * 5 + y * 2.1) + 0.03 * Math.sin(y * 5.3 + a * 2) + 0.04 * Math.sin(y * 1.3);
    pos.setXYZ(i, x * k, y, z * k);
  }
  geo.computeVertexNormals();
  const bt = barkTex(); bt.repeat.set(3, 2);
  const body = new THREE.Mesh(geo, matU('#ffffff', { map: bt }));
  body.rotation.z = Math.PI / 2;
  body.position.y = o.r * 0.94;
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  const rt = ringsTex();
  for (const sx of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CircleGeometry(o.r * (sx > 0 ? 1.04 : 0.99), 20), matU('#ffffff', { map: rt }));
    cap.position.set(sx * o.len / 2 * 0.995, o.r * 0.94, 0);
    cap.rotation.y = sx * Math.PI / 2;
    cap.castShadow = cap.receiveShadow = true;
    g.add(cap);
  }
  // broken branch stubs
  for (const [x, a, l] of [[-o.len * 0.28, 0.5, 0.55], [o.len * 0.31, -0.9, 0.38]] as const) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.11, l, 8).translate(0, l / 2, 0), matU('#6a4830'));
    b.position.set(x, o.r * 1.4, -o.r * 0.55);
    b.rotation.set(-0.9, 0, a);
    b.castShadow = true;
    g.add(b);
  }
  // moss cushions (kept off the seat line on top) and tiny mushrooms
  const moss: { p: THREE.Vector3; s: THREE.Vector3; rot: THREE.Euler; c: THREE.Color }[] = [];
  const cy = o.r * 0.94;
  for (let tries = 0; moss.length < 16 && tries < 200; tries++) {
    const x = (R() - 0.5) * o.len * 0.94;
    const phi = 0.2 + R() * 1.8; // 0 = top, + = toward +Z (the back; the front stays clean for dangling legs)
    if (phi < 0.6 && Math.abs(x) < o.len * 0.4) continue;
    const rr = o.r * 1.0;
    moss.push({
      p: new THREE.Vector3(x, cy + Math.cos(phi) * rr, Math.sin(phi) * rr),
      s: new THREE.Vector3(0.16 + R() * 0.22, 0.05 + R() * 0.04, 0.12 + R() * 0.16),
      rot: new THREE.Euler(phi, R() * 0.4, 0),
      c: new THREE.Color(R() < 0.5 ? '#6e9a3a' : '#88ad44'),
    });
  }
  g.add(blobs(moss));
  for (let i = 0; i < 3; i++) {
    const mx = o.len * (0.12 + i * 0.07) * (i % 2 ? -1 : 1) + 0.6;
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.14, 6).translate(0, 0.07, 0), matU('#f2e6cc'));
    const cp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 6, 0, TAU, 0, Math.PI / 2), matU(i === 1 ? '#d8743a' : '#c25a32'));
    cp.position.y = 0.13; cp.scale.set(1, 0.7, 1);
    const mg = new THREE.Group(); mg.add(st, cp);
    mg.position.set(mx, 0.12 + i * 0.05, o.r * 0.95);
    mg.rotation.x = 0.5;
    mg.scale.setScalar(0.9 + i * 0.25);
    g.add(mg);
  }
  return { obj: g, top: cy + o.r };
}

/** Old wooden bucket with iron hoops and handle (stands on y=0, opening up). */
export function bucket(): THREE.Group {
  const g = new THREE.Group();
  const wood = matU('#8a6a4a', { side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.23, 0.48, 14, 1, true).translate(0, 0.24, 0), wood);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.23, 14).rotateX(-Math.PI / 2).translate(0, 0.02, 0), matU('#6a4e36'));
  g.add(body, bottom);
  for (const [y, r] of [[0.08, 0.245], [0.4, 0.29]] as const) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(r, 0.022, 6, 20).rotateX(Math.PI / 2), matU('#4e4f55'));
    hoop.position.y = y; g.add(hoop);
  }
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.016, 6, 16, Math.PI), matU('#4e4f55'));
  handle.position.y = 0.46; handle.rotation.y = 0.3; g.add(handle);
  g.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return g;
}

/** Coiled rope. */
export function ropeCoil(r = 0.32): THREE.Group {
  const g = new THREE.Group();
  const m = matU('#b8955e');
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(r - i * 0.02, 0.038, 6, 22).rotateX(Math.PI / 2), m);
    t.position.y = 0.04 + i * 0.065; t.rotation.y = i; t.castShadow = true; t.receiveShadow = true;
    g.add(t);
  }
  return g;
}

// ───────────────────────────── sky dressing ─────────────────────────────
export interface CloudSpec { az: number; el: number; dist: number; w: number; h: number; seed: number }

/**
 * Soft puffy clouds lit from below by a low sun (gold/peach undersides, lavender tops, glowing edges near the sun).
 * One merged unlit mesh, puffs sorted far→near so no depth writes are needed.
 */
export function cloudBank(specs: CloudSpec[], sunAz: number, c: { top: string; bottom: string; glow: string }): THREE.Mesh {
  const puffs: { g: THREE.BufferGeometry; d: number }[] = [];
  const cTop = new THREE.Color(c.top), cBot = new THREE.Color(c.bottom), cGlow = new THREE.Color(c.glow);
  const tmp = new THREE.Color(), nrm = new THREE.Vector3(), center = new THREE.Vector3();
  for (const sp of specs) {
    const R = srand(sp.seed);
    dirAzEl(sp.az, sp.el, center).multiplyScalar(sp.dist);
    const n = 7 + Math.floor(sp.w / 9);
    const toward = Math.cos(sp.az - sunAz) * 0.5 + 0.5;
    for (let i = 0; i < n; i++) {
      const u = (i / (n - 1)) * 2 - 1;
      const rad = sp.h * (0.45 + R() * 0.45) * (1 - 0.55 * Math.abs(u));
      const g = new THREE.IcosahedronGeometry(1, 2);
      g.scale(rad * (1.2 + R() * 0.5), rad * 0.62, rad * 0.8);
      g.translate(u * sp.w * 0.5 + (R() - 0.5) * sp.w * 0.08, rad * 0.25 * R() + (1 - Math.abs(u)) * sp.h * 0.18, (R() - 0.5) * sp.h * 0.4);
      g.rotateY(-sp.az);
      g.translate(center.x, center.y, center.z);
      const pos = g.attributes.position as THREE.BufferAttribute;
      const nor = g.attributes.normal as THREE.BufferAttribute;
      const colA = new Float32Array(pos.count * 3);
      for (let k = 0; k < pos.count; k++) {
        nrm.fromBufferAttribute(nor, k);
        const under = smoothstep(0.3, -0.65, nrm.y);
        tmp.copy(cTop).lerp(cBot, under);
        const rim = Math.pow(1 - Math.abs(nrm.dot(center.clone().normalize())), 2.2);
        tmp.lerp(cGlow, clamp01(rim * 0.55 + under * 0.25) * smoothstep(0.35, 1, toward));
        colA[k * 3] = tmp.r; colA[k * 3 + 1] = tmp.g; colA[k * 3 + 2] = tmp.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colA, 3));
      puffs.push({ g, d: center.length() + (R() - 0.5) * sp.h * 0.4 - (rad * 0.25) });
    }
  }
  puffs.sort((a, b) => b.d - a.d);
  const geo = mergeGeometries(puffs.map((p) => p.g))!;
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false }));
  m.renderOrder = -950;
  m.frustumCulled = false;
  noOutline(m);
  return m;
}

/** Small flock of silhouette birds (instanced wings). Call update(t) every frame. */
export function birdFlock(n: number, seed: number, color = '#2e2434') {
  const R = srand(seed);
  const wing = new THREE.BufferGeometry();
  const A = [0, 0, 0.08], B = [0, 0, -0.07], C = [0.3, 0.02, -0.02], D = [0.6, -0.02, -0.14], E = [0.3, 0.02, 0.06];
  wing.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...A, ...B, ...C, ...A, ...C, ...E, ...E, ...C, ...D]), 3));
  wing.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(wing, basic(color, { side: THREE.DoubleSide }), n * 2);
  mesh.frustumCulled = false;
  noOutline(mesh);
  const birds = Array.from({ length: n }, (_, i) => ({
    off: new THREE.Vector3((R() - 0.5) * 6 + (i % 2 ? 1 : -1) * i * 0.8, (R() - 0.5) * 1.6, -i * 1.1 + R()),
    ph: R() * TAU, rate: 7 + R() * 3, s: 0.75 + R() * 0.4,
  }));
  const q = new THREE.Quaternion(), qh = new THREE.Quaternion(), qf = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const X = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(0, 1, 0);
  /** base = flock centre, heading = yaw (bird +Z = forward), scale = world size multiplier */
  function update(t: number, base: THREE.Vector3, heading: number, scale = 1) {
    qh.setFromAxisAngle(Y, heading);
    birds.forEach((b, i) => {
      const glide = Math.sin(t * 0.7 + b.ph) > 0.55;
      const flap = glide ? 0.12 : Math.sin(t * b.rate + b.ph) * 0.65 + 0.1;
      p.copy(b.off).multiplyScalar(scale).applyQuaternion(qh).add(base);
      p.y += Math.sin(t * 1.3 + b.ph) * 0.3 * scale;
      for (const side of [1, -1]) {
        qf.setFromAxisAngle(X, side * flap);
        q.copy(qh).multiply(qf);
        s.set(side * b.s * scale, b.s * scale, b.s * scale);
        mesh.setMatrixAt(i * 2 + (side > 0 ? 0 : 1), new THREE.Matrix4().compose(p, q, s));
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
  return { mesh, update };
}

/** Horizontal soft mist sheet (ring) for valleys. */
export function mistSheet(o: { y: number; r0: number; r1: number; color: string; opacity: number; seed: number }): THREE.Mesh {
  const tex = canvasTex(256, 256, (g, w, h) => {
    const R = srand(o.seed);
    for (let i = 0; i < 70; i++) {
      const x = R() * w, y = R() * h, r = 18 + R() * 50;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  const m = new THREE.Mesh(
    new THREE.RingGeometry(o.r0, o.r1, 64, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(o.color), map: tex, transparent: true, opacity: o.opacity, depthWrite: false, fog: false, side: THREE.DoubleSide }),
  );
  m.position.y = o.y;
  m.frustumCulled = false;
  noOutline(m);
  return m;
}
