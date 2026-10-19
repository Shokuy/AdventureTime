import * as THREE from 'three';
import { matU, basic, canvasTex, noOutline } from '../gfx';
import { G, TAU, clamp, lerp, part, grp, cached, taperedTube } from './kit';

/*
 * Small pickup / projectile models, centred at the origin.
 *  - createGoldenNut(): «Золотой орешек» — rare collectible (the game spins / bobs the root itself).
 *  - createCherryBomb(): the bomber's thrown cherry bomb; update(dt, fuse) with fuse 0 → 1 (1 = about to pop).
 */

type V3 = [number, number, number];
const nob = { cast: false, receive: false };

// ───────────────────────── fx textures / sprites ─────────────────────────
let glowTexC: THREE.Texture | null = null;
function glowTex() {
  if (!glowTexC) {
    glowTexC = canvasTex(128, 128, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.2, 'rgba(255,255,255,0.62)');
      r.addColorStop(0.5, 'rgba(255,255,255,0.18)');
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
      const r = g.createRadialGradient(c, c, 0, c, c, c * 0.45);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.35, 'rgba(255,255,255,0.5)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, w);
      g.fillStyle = '#ffffff';
      for (const rot of [0, Math.PI / 2]) {
        g.save(); g.translate(c, c); g.rotate(rot);
        g.beginPath();
        g.moveTo(-c * 0.98, 0); g.quadraticCurveTo(0, -c * 0.08, c * 0.98, 0); g.quadraticCurveTo(0, c * 0.08, -c * 0.98, 0);
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

// ───────────────────────── golden walnut ─────────────────────────
/** wrinkled two-half walnut shell (vertex-coloured: dark creases, bright ridges and seam). ~0.55 tall. */
const walnutGeo = () => cached('golden-walnut', () => {
  const g = new THREE.SphereGeometry(1, 80, 60);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const cDeep = new THREE.Color('#c05400');
  const cBase = new THREE.Color('#ffba0a');
  const cHi = new THREE.Color('#fff4a0');
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const { x, y, z } = v;
    const ax = Math.abs(x);
    // the two halves meet in the x = 0 plane: raised seam ridge with a groove on each side
    const ridge = Math.exp(-((ax / 0.06) ** 2));
    const groove = Math.exp(-(((ax - 0.15) / 0.065) ** 2));
    // meandering wrinkles: valleys where a warped sum of sines crosses zero
    const n = Math.sin(x * 6.3 + Math.sin(y * 4.6 + z * 1.7) * 1.9 + z * 2.1)
      + 0.85 * Math.sin(y * 7.4 + z * 5.1 + Math.sin(x * 3.7) * 1.5)
      + 0.5 * Math.sin(z * 9.1 - y * 3.3 + x * 1.3);
    const valley = Math.exp(-((n / 0.38) ** 2));
    const crest = Math.exp(-(((Math.abs(n) - 1.25) / 0.35) ** 2));
    const wr = (1 - ridge) * (1 - 0.55 * groove) * (0.55 + 0.45 * Math.sqrt(1 - y * y));
    const r = 1 + 0.06 * ridge - 0.05 * groove - 0.075 * valley * wr + 0.015 * crest * wr;
    // egg-ish walnut with a small point on top and a flatter, dimpled bottom
    const top = Math.max(0, y);
    const tipY = 0.06 * top ** 7;
    const bot = Math.max(0, -y);
    const yy = y * r * 0.25 + tipY - 0.012 * bot ** 4;
    const side = 1 - 0.06 * top ** 3;
    pos.setXYZ(i, x * r * 0.214 * side, yy, z * r * 0.226 * side);
    c.copy(cBase).lerp(cDeep, clamp(valley * wr * 1.15 + groove * 0.55 * (1 - ridge)));
    c.lerp(cHi, clamp(ridge * 0.85 + crest * wr * 0.5));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
});

export interface GoldenNut { root: THREE.Group; update(dt: number): void }

export function createGoldenNut(): GoldenNut {
  const root = new THREE.Group();
  root.name = 'goldenNut';
  const goldM = matU('#ffffff', { emissive: '#c87400', emissiveIntensity: 0.7 });
  goldM.vertexColors = true;
  const shell = part(root, walnutGeo(), goldM, [0, -0.005, 0], 1, [0, 0, 0], { cast: true, receive: false });
  void shell;
  // tiny stem scar at the bottom + point on top (keep the silhouette walnut-like from every side)
  part(root, G.ball(), matU('#c87414', { emissive: '#5a2a00' }), [0, -0.252, 0], [0.03, 0.012, 0.03], undefined, nob);

  // glow & sparkles (additive, skipped by the outline pass)
  const halo = fxSprite(root, glowTex(), '#ffc23a', 1.45, 0.42, [0, 0, 0]);
  const inner = fxSprite(root, glowTex(), '#fff0a0', 0.75, 0.3, [0, 0, 0]);
  const glint = fxSprite(root, sparkTex(), '#ffffff', 0.3, 1, [-0.1, 0.12, 0.17]);
  let a = 7;
  const rnd = () => { a = (a * 9301 + 49297) % 233280; return a / 233280; };
  const tw = Array.from({ length: 6 }, (_, i) => ({
    s: fxSprite(root, sparkTex(), i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? '#fff2a0' : '#ffd25a', 0.1),
    ang: rnd() * TAU, r: lerp(0.27, 0.42, rnd()), y: lerp(-0.22, 0.3, rnd()), sp: (0.35 + rnd() * 0.4) * (rnd() < 0.5 ? -1 : 1),
    size: lerp(0.12, 0.22, rnd()), ph: rnd() * TAU, f: 2.4 + rnd() * 2.4,
  }));
  let t = rnd() * 10;

  function update(dt: number) {
    t += Math.min(dt, 0.1);
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.6);
    (halo.material as THREE.SpriteMaterial).opacity = 0.42 + 0.16 * pulse;
    halo.scale.setScalar(1.4 + 0.18 * pulse);
    (inner.material as THREE.SpriteMaterial).opacity = 0.22 + 0.12 * pulse;
    // a sharp "ting!" glint every ~1.7 s
    const g = (t % 1.7) / 1.7;
    const k = Math.max(0, Math.sin(Math.min(1, g / 0.22) * Math.PI));
    glint.scale.setScalar(0.04 + 0.36 * k);
    (glint.material as THREE.SpriteMaterial).rotation = g * 2.2;
    for (const it of tw) {
      const an = it.ang + t * it.sp;
      it.s.position.set(Math.cos(an) * it.r, it.y + Math.sin(t * 0.9 + it.ph) * 0.05, Math.sin(an) * it.r);
      const v = Math.max(0, Math.sin(t * it.f + it.ph));
      it.s.scale.setScalar(it.size * v * v + 0.001);
    }
  }
  update(0);
  return { root, update };
}

// ───────────────────────── cherry bomb ─────────────────────────
const CB_R = 0.32;
/** glossy cherry: slightly squat sphere with a dimple where the stem goes in, plus the faint suture line */
const cherryGeo = () => cached('cherry-bomb', () => {
  const g = new THREE.SphereGeometry(1, 40, 30);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ang = Math.acos(clamp(v.y, -1, 1)); // 0 at the top pole
    const dimple = 1 - 0.2 * Math.exp(-((ang / 0.42) ** 2));
    const bottom = 1 - 0.05 * Math.exp(-(((Math.PI - ang) / 0.5) ** 2));
    const az = Math.atan2(v.x, v.z);
    const suture = 1 - 0.018 * Math.exp(-((az / 0.07) ** 2)) * Math.sin(ang);
    const r = dimple * bottom * suture;
    pos.setXYZ(i, v.x * r * 1.03, v.y * r * 0.93, v.z * r);
  }
  g.computeVertexNormals();
  return g;
});
const FUSE_CURVE = new THREE.CubicBezierCurve3(
  new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.0, 0.1, 0.0), new THREE.Vector3(0.04, 0.17, 0.0), new THREE.Vector3(0.1, 0.22, 0.02),
);
const fuseGeo = () => cached('cherry-fuse', () => taperedTube(FUSE_CURVE, 16, 8, (t) => lerp(0.026, 0.017, t)));

export interface CherryBomb { root: THREE.Group; update(dt: number, fuse: number): void }

export function createCherryBomb(): CherryBomb {
  const root = new THREE.Group();
  root.name = 'cherryBomb';
  const redM = matU('#e5122f');
  const body = part(root, cherryGeo(), redM, undefined, CB_R);
  // glossy highlights (unlit, no outline so they read as shine, not stickers)
  const hl = basic('#ffffff', { transparent: true, opacity: 0.92 });
  const h1 = part(body, G.sphere(), hl, [-0.45, 0.45, 0.77], [0.2, 0.12, 0.06], [0.45, -0.5, 0.75], nob);
  const h2 = part(body, G.ball(), hl, [-0.18, 0.66, 0.73], 0.055, undefined, nob);
  const h3 = part(body, G.sphere(), basic('#ff8a9a', { transparent: true, opacity: 0.55 }), [0.6, -0.46, 0.655], [0.16, 0.08, 0.05], [-0.4, 0.6, 0.9], nob);
  for (const h of [h1, h2, h3]) noOutline(h);

  // fuse stem (burns down as fuse → 1) + a little leaf
  const top = CB_R * 0.93 * 0.8;
  const stem = grp(root, [0, top, 0]);
  part(stem, fuseGeo(), matU('#4a2c18'));
  const tipLocal = FUSE_CURVE.getPoint(1);
  const char = part(stem, G.ball(), matU('#1e1412'), [tipLocal.x, tipLocal.y, tipLocal.z], 0.021);
  part(root, G.sphere(), matU('#4fb23a'), [-0.07, top + 0.03, 0.02], [0.1, 0.014, 0.045], [0.1, 0.5, 0.35]);

  // spark at the fuse tip
  const fx = grp(root);
  const sparkGlow = fxSprite(fx, glowTex(), '#ff9a2a', 0.42, 0.85);
  const spark = fxSprite(fx, sparkTex(), '#fff2b0', 0.3, 1);
  const embers = Array.from({ length: 5 }, (_, i) => ({ s: fxSprite(fx, glowTex(), i % 2 ? '#ffd040' : '#ff7a1a', 0.05, 1), ph: i / 5, dir: new THREE.Vector3(Math.cos(i * 2.4), 0.8 + 0.3 * Math.sin(i * 1.7), Math.sin(i * 2.4)).normalize() }));
  // red/white pulse glow around the cherry while it blinks
  const pulseGlow = fxSprite(root, glowTex(), '#ff4060', 1.1, 0);

  let t = Math.random() * 5;
  let ph = 0.45; // start between blinks
  const tip = new THREE.Vector3();
  function update(dt: number, fuse: number) {
    dt = Math.min(dt, 0.1);
    t += dt;
    const f = clamp(fuse);
    // blink white / red, faster and faster
    ph += dt * lerp(1.6, 12, f ** 1.4);
    const q = ph % 1;
    const on = q < 0.4 ? Math.sin((q / 0.4) * Math.PI) : 0;
    const k = on * lerp(0.45, 0.95, f);
    redM.emissive.setRGB(k, k * 0.92, k * 0.92);
    body.scale.setScalar(CB_R * (1 + 0.05 * on * f));
    (pulseGlow.material as THREE.SpriteMaterial).opacity = on * (0.25 + 0.4 * f);
    (pulseGlow.material as THREE.SpriteMaterial).color.setRGB(1, lerp(0.25, 0.85, on), lerp(0.35, 0.85, on));
    // fuse burns down
    const len = lerp(1, 0.4, f);
    stem.scale.set(1, len, 1);
    char.scale.set(0.021, 0.021 / len, 0.021);
    tip.copy(tipLocal).multiply(stem.scale).add(stem.position);
    fx.position.copy(tip);
    // flicker
    const fl = 0.75 + 0.3 * Math.abs(Math.sin(t * 31)) + 0.15 * Math.sin(t * 53);
    spark.scale.setScalar(0.3 * fl * (1 + 0.4 * f));
    (spark.material as THREE.SpriteMaterial).rotation = t * 9;
    sparkGlow.scale.setScalar(0.42 * (0.85 + 0.3 * Math.sin(t * 27)) * (1 + 0.5 * f));
    for (const e of embers) {
      const u = (t * 2.2 + e.ph) % 1;
      e.s.position.copy(e.dir).multiplyScalar(u * 0.22);
      e.s.position.y -= u * u * 0.08;
      e.s.scale.setScalar(0.07 * (1 - u));
    }
  }
  update(0, 0);
  return { root, update };
}
