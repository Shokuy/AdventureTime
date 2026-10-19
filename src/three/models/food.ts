import * as THREE from 'three';
import { mat, matU, basic, canvasTex, noOutline } from '../gfx';
import { G, TAU, clamp, lerp, smooth, grp, part, cached, taperedTube, merge } from './kit';

/*
 * Giant-feast food (carried on a platter by two watermelon guards, grabbed and eaten by the King).
 * At scale 1 every item is ≈3 units long/tall; origin = bottom-centre of the item, front = +Z.
 * The pudding wobbles: call `group.userData.update(dt)` every frame (optional) and
 * `group.userData.poke(strength)` to make it jiggle (e.g. when it is grabbed / set down).
 */

export type FoodKind = 'drumstick' | 'pie' | 'ham' | 'grapes' | 'pudding' | 'cakeSlice';
type V3 = [number, number, number];
const fo = { cast: false };
const nob = { cast: false, receive: false };

/** Height of the platter's dish floor (where food stands) at scale 1. */
export const PLATTER_TOP = 0.16;

// ───────────────────────── helpers ─────────────────────────
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** cheap smooth 3D noise-ish wobble (sum of sines), ~[-1, 1] */
const wob = (x: number, y: number, z: number) =>
  (Math.sin(x * 3.1 + y * 1.7) * Math.sin(z * 2.7 - y * 2.3) + 0.5 * Math.sin(x * 6.3 + z * 5.1 + y * 4.7)) / 1.5;

function lathe(key: string, pts: Array<[number, number]>, segs: number, bump?: (v: THREE.Vector3, t: number) => void) {
  return cached(key, () => {
    const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), segs);
    if (bump) {
      const p = g.attributes.position as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      const rows = pts.length;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        bump(v, (i % rows) / (rows - 1));
        p.setXYZ(i, v.x, v.y, v.z);
      }
    }
    g.computeVertexNormals();
    return g;
  });
}

/** glossy highlight decal (unlit, no depth write, excluded from outlines) */
function shine(parent: THREE.Object3D, p: V3, s: V3, r: V3 = [0, 0, 0], opacity = 0.8, color = '#ffffff') {
  const m = part(parent, G.sphere(), basic(color, { transparent: true, opacity }), p, s, r, nob);
  noOutline(m);
  return m;
}

/** piped whipped-cream swirl, base radius 1 at y = 0, height ≈1.35 */
const dollopGeo = () => cached('food-dollop', () => {
  const n = 28, segs = 48;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = (1 - Math.pow(t, 1.5)) * (0.75 + 0.25 * Math.cos(t * Math.PI * 3.0) ** 2) * (t < 0.08 ? 0.85 + t * 1.9 : 1);
    pts.push(new THREE.Vector2(Math.max(1e-3, r), t * 1.35));
  }
  const g = new THREE.LatheGeometry(pts, segs);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x) + y * 2.2;
    const k = 1 + 0.13 * Math.cos(a * 7);
    p.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  return g;
});

function cherry(parent: THREE.Object3D, p: V3, r: number, stemTilt = 0.35) {
  const c = grp(parent, p);
  part(c, G.sphere(), mat('#d8183a'), [0, r * 0.95, 0], [r, r * 0.92, r]);
  part(c, G.sphere(), mat('#9a0c26'), [0, r * 1.8, 0], [r * 0.22, r * 0.08, r * 0.22], undefined, fo);
  shine(c, [-r * 0.38, r * 1.3, r * 0.55], [r * 0.24, r * 0.15, r * 0.06], [0.5, -0.5, 0.6], 0.95);
  const stem = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, r * 1.75, 0), new THREE.Vector3(r * 0.2, r * 2.6, 0), new THREE.Vector3(r * 0.9 * Math.sin(stemTilt * 2), r * 3.0, 0));
  part(c, taperedTube(stem, 10, 6, (t) => r * lerp(0.1, 0.07, t)), mat('#4a7a2a'), undefined, undefined, undefined, fo);
  return c;
}

// ───────────────────────── textures ─────────────────────────
const texCache = new Map<string, THREE.Texture>();
function tex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  let t = texCache.get(key);
  if (!t) { t = canvasTex(w, h, draw, { wrap: true }); texCache.set(key, t); }
  return t;
}
function blobs(g: CanvasRenderingContext2D, W: number, H: number, R: () => number, n: number, color: string, rx: [number, number], ry: [number, number]) {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const x = R() * W, y = R() * H, a = lerp(rx[0], rx[1], R()), b = lerp(ry[0], ry[1], R()), rot = R() * TAU;
    for (const dx of [-W, 0, W]) { g.beginPath(); g.ellipse(x + dx, y, a, b, rot, 0, TAU); g.fill(); }
  }
}

const roastTex = () => tex('roast', 512, 256, (g, W, H) => {
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#d98a3a'); gr.addColorStop(0.55, '#c4702a'); gr.addColorStop(1, '#b0602a');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const R = prng(11);
  blobs(g, W, H, R, 60, 'rgba(140,62,20,0.45)', [10, 34], [6, 16]);
  blobs(g, W, H, R, 50, 'rgba(245,178,90,0.5)', [8, 26], [4, 10]);
  blobs(g, W, H, R, 120, 'rgba(110,44,14,0.6)', [1.5, 4], [1.2, 3]);
  // grill marks across the bulb
  g.strokeStyle = 'rgba(90,36,12,0.55)'; g.lineWidth = 9; g.lineCap = 'round';
  for (let i = 0; i < 4; i++) { const x = W * (0.12 + i * 0.09); g.beginPath(); g.moveTo(x, H * 0.12); g.lineTo(x + W * 0.06, H * 0.42); g.stroke(); }
  // glossy streaks
  g.strokeStyle = 'rgba(255,224,150,0.6)'; g.lineWidth = 3;
  for (let i = 0; i < 26; i++) { const x = R() * W, y = R() * H; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 12, y + 4, x + 24 + R() * 20, y + R() * 6); g.stroke(); }
  // herb flakes
  blobs(g, W, H, R, 40, '#4f8a2a', [1.5, 3.5], [1, 2]);
});
const boneTex = () => tex('bone', 128, 64, (g, W, H) => {
  g.fillStyle = '#f7efdc'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(210,190,150,0.35)';
  for (let i = 0; i < 12; i++) g.fillRect(0, (i / 12) * H, W, 2);
});
const crustTex = () => tex('crust', 256, 256, (g, W, H) => {
  g.fillStyle = '#e6a046'; g.fillRect(0, 0, W, H);
  const R = prng(5);
  blobs(g, W, H, R, 40, 'rgba(196,112,40,0.45)', [8, 22], [6, 14]);
  blobs(g, W, H, R, 40, 'rgba(255,214,130,0.55)', [6, 16], [3, 8]);
  blobs(g, W, H, R, 90, 'rgba(255,250,235,0.85)', [1, 2], [1, 2]);
});
const glazeTex = () => tex('glaze', 512, 512, (g, W, H) => {
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#e6843e'); gr.addColorStop(0.5, '#d2683a'); gr.addColorStop(1, '#c05a30');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const R = prng(9);
  blobs(g, W, H, R, 40, 'rgba(255,190,110,0.35)', [12, 40], [6, 20]);
  // diamond scoring
  const step = 64;
  g.strokeStyle = 'rgba(122,40,16,0.75)'; g.lineWidth = 5;
  for (let k = -H; k < W + H; k += step) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + H, H); g.stroke();
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k - H, H); g.stroke();
  }
  g.strokeStyle = 'rgba(255,200,140,0.5)'; g.lineWidth = 2;
  for (let k = -H; k < W + H; k += step) {
    g.beginPath(); g.moveTo(k + 3, 0); g.lineTo(k + H + 3, H); g.stroke();
  }
  // cloves at the crossings
  for (let y = 0; y <= H; y += step / 2) for (let x = ((y / (step / 2)) % 2) * (step / 2); x <= W; x += step) {
    g.fillStyle = '#3a1e10'; g.beginPath(); g.arc(x, y, 7, 0, TAU); g.fill();
    g.fillStyle = '#6a3a1e';
    for (let a = 0; a < 4; a++) { g.beginPath(); g.ellipse(x + Math.cos(a * Math.PI / 2) * 6, y + Math.sin(a * Math.PI / 2) * 6, 3.5, 2, a * Math.PI / 2, 0, TAU); g.fill(); }
    g.fillStyle = 'rgba(255,230,190,0.6)'; g.beginPath(); g.arc(x - 2, y - 2, 1.8, 0, TAU); g.fill();
  }
  // glaze sheen
  g.strokeStyle = 'rgba(255,236,190,0.55)'; g.lineWidth = 4; g.lineCap = 'round';
  for (let i = 0; i < 18; i++) { const x = R() * W, y = R() * H; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 14, y - 6, x + 34, y - 4); g.stroke(); }
});
const spongeTex = (base: string, hole: string, key: string) => tex(key, 256, 128, (g, W, H) => {
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  const R = prng(key.length * 7);
  blobs(g, W, H, R, 160, hole, [1.5, 3.5], [1, 2.5]);
});
const silverTex = () => tex('silver', 512, 64, (g, W, H) => {
  // radial (v along the lathe profile) engraved rings and a floral band
  g.fillStyle = '#c3cede'; g.fillRect(0, 0, W, H);
  const band = (y: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(0, y, W, h); };
  band(H * 0.18, 2, 'rgba(90,104,130,0.6)');
  band(H * 0.3, 2, 'rgba(90,104,130,0.6)');
  band(H * 0.56, 3, 'rgba(255,255,255,0.7)');
  band(H * 0.82, 2, 'rgba(90,104,130,0.5)');
  g.strokeStyle = 'rgba(90,104,130,0.55)'; g.lineWidth = 2;
  for (let x = 0; x < W; x += 32) { g.beginPath(); g.arc(x + 16, H * 0.24, 6, 0, TAU); g.stroke(); }
});

// ════════════════════════════════════════════════════════════════════
//  DRUMSTICK
// ════════════════════════════════════════════════════════════════════
function drumstick(root: THREE.Group) {
  const L = 2.15, MAXR = 0.8;
  const prof: Array<[number, number]> = [];
  const n = 44;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let r: number;
    if (t < 0.32) r = MAXR * Math.sqrt(Math.max(0, 1 - ((0.32 - t) / 0.32) ** 2));
    else if (t < 0.93) r = 0.21 + (MAXR - 0.21) * (1 - smooth((t - 0.32) / 0.61) ** 0.85);
    else r = lerp(0.25, 0.15, smooth((t - 0.93) / 0.07)) + (t < 0.96 ? 0.03 * Math.sin(((t - 0.93) / 0.03) * Math.PI) : 0);
    prof.push([r, t * L]);
  }
  const meatGeo = lathe('food-drum-meat', prof, 44, (v, t) => {
    const k = 1 + 0.05 * wob(v.x * 1.5, v.y * 1.2, v.z * 1.5) * Math.sin(Math.PI * Math.min(1, t * 1.1));
    v.x *= k; v.z *= k;
  });
  const alpha = 0.13;
  const axis = grp(root, [-1.45, MAXR - 0.32 * L * Math.sin(alpha) + 0.1, 0], [0, 0, -(Math.PI / 2 - alpha)]);
  part(axis, meatGeo, matU('#ffffff', { map: roastTex() }));
  // bone (along the axis, past the neck)
  const bone = mat('#f6eedb');
  const boneM = matU('#ffffff', { map: boneTex() });
  part(axis, G.cyl(), boneM, [0, L + 0.3, 0], [0.12, 0.7, 0.12]);
  part(axis, G.sphere(), bone, [0.13, L + 0.68, 0.02], 0.2);
  part(axis, G.sphere(), bone, [-0.13, L + 0.68, -0.02], 0.2);
  part(axis, G.sphere(), bone, [0, L + 0.6, 0], [0.17, 0.12, 0.17]);
  // crispy skin lip where the meat meets the bone
  part(axis, G.torus(0.2, 0.06, 8, 24), mat('#a8561e'), [0, L - 0.08, 0], 1, [Math.PI / 2, 0, 0], fo);
  // glossy highlights on top of the bulb
  shine(axis, [-0.55, 0.62, 0.38], [0.2, 0.09, 0.04], [0.4, 0.4, 1.2], 0.75, '#fff3d6');
  shine(axis, [-0.6, 0.95, 0.22], [0.08, 0.05, 0.03], [0.4, 0.4, 1.2], 0.7, '#fff3d6');
  shine(axis, [-0.36, 1.45, 0.2], [0.14, 0.05, 0.03], [0.3, 0.2, 1.4], 0.6, '#fff3d6');
  shine(axis, [-0.1, L + 0.3, 0.1], [0.025, 0.25, 0.02], [0, 0, 0], 0.8);
}

// ════════════════════════════════════════════════════════════════════
//  PIE (lattice top, cherry filling)
// ════════════════════════════════════════════════════════════════════
function pie(root: THREE.Group) {
  const RIM = 1.42, FILL_R = 1.3, FILL_Y = 0.52;
  const crust = matU('#ffffff', { map: crustTex() });
  // pastry shell
  part(root, lathe('food-pie-shell', [[0, 0], [1.1, 0], [1.26, 0.04], [1.36, 0.22], [1.44, 0.46], [1.5, 0.52], [1.46, 0.58], [1.33, 0.56], [1.3, 0.5]], 56), crust);
  // filling dome
  const domeH = (x: number, z: number) => FILL_Y + 0.12 * Math.max(0, 1 - (x * x + z * z) / (FILL_R * FILL_R));
  part(root, lathe('food-pie-fill', Array.from({ length: 12 }, (_, i) => { const r = (1 - i / 11) * FILL_R; return [r, domeH(r, 0)] as [number, number]; }), 48), mat('#b81834'));
  // cherries bulging between the strips
  const cherryGeo = cached('food-pie-cherries', () => {
    const R = prng(3);
    const parts: Array<{ g: THREE.BufferGeometry; p: V3; s: number }> = [];
    for (let i = 0; i < 26; i++) {
      const a = R() * TAU, d = Math.sqrt(R()) * (FILL_R - 0.18);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      parts.push({ g: G.ball(), p: [x, domeH(x, z) - 0.02, z], s: 0.1 + R() * 0.05 });
    }
    return merge(parts);
  });
  part(root, cherryGeo, mat('#d42a44'), undefined, undefined, undefined, fo);
  // crimped edge
  const crimp = cached('food-pie-crimp', () => {
    const parts: Array<{ g: THREE.BufferGeometry; p: V3; s: V3; r: V3 }> = [];
    const n = 30;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      parts.push({ g: G.sphere(), p: [Math.sin(a) * RIM, 0.58, Math.cos(a) * RIM], s: [0.13, 0.085, 0.16], r: [0, a, 0.5] });
    }
    return merge(parts);
  });
  part(root, crimp, crust);
  // woven lattice strips
  const strip = (along: 'x' | 'z', off: number, idx: number) => {
    const half = Math.sqrt(Math.max(0.01, (FILL_R + 0.08) ** 2 - off * off));
    const g = new THREE.CapsuleGeometry(0.11, half * 2 - 0.22, 4, 10, 24);
    g.rotateZ(Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const s = p.getX(i), y = p.getY(i) * 0.38, w = p.getZ(i) * 1.45;
      const x = along === 'x' ? s : off + w;
      const z = along === 'x' ? off + w : s;
      const weave = 0.035 * Math.cos((s / 0.46) * Math.PI + (idx % 2) * Math.PI + (along === 'x' ? 0 : Math.PI));
      const yy = domeH(along === 'x' ? s : off, along === 'x' ? off : s) + 0.07 + weave + y;
      p.setXYZ(i, x, yy, z);
    }
    g.computeVertexNormals();
    return g;
  };
  const lattice = cached('food-pie-lattice', () => {
    const parts: Array<{ g: THREE.BufferGeometry }> = [];
    for (let i = -2; i <= 2; i++) { parts.push({ g: strip('x', i * 0.46, i + 2) }); parts.push({ g: strip('z', i * 0.46, i + 2) }); }
    return merge(parts);
  });
  part(root, lattice, crust);
  // sugar sparkle + sheen
  for (const [x, z, s] of [[-0.5, 0.45, 0.13], [0.48, -0.2, 0.1], [-0.1, -0.6, 0.08]] as const) shine(root, [x, domeH(x, z) + 0.13, z], [s, 0.02, s * 0.45], [0, 0.6, 0], 0.55, '#fff4d8');
  shine(root, [-0.9, 0.62, 1.05], [0.2, 0.05, 0.05], [0, -0.7, 0], 0.6, '#fff4d8');
}

// ════════════════════════════════════════════════════════════════════
//  HAM (glazed, scored, cloves, pineapple rings, frilled bone)
// ════════════════════════════════════════════════════════════════════
function ham(root: THREE.Group) {
  const L = 2.5, MAXR = 1.0, FLAT = 0.82;
  const prof: Array<[number, number]> = [];
  const n = 40;
  const rAt = (t: number) => {
    if (t < 0.3) return MAXR * Math.sqrt(Math.max(0, 1 - ((0.3 - t) / 0.3) ** 2));
    if (t < 0.94) return 0.36 + (MAXR - 0.36) * (1 - smooth((t - 0.3) / 0.64) ** 1.15);
    return lerp(0.36, 0.0, smooth((t - 0.94) / 0.06) ** 0.6);
  };
  for (let i = 0; i <= n; i++) { const t = i / n; prof.push([rAt(t), t * L]); }
  const hamGeo = lathe('food-ham', prof, 48, (v, t) => {
    const k = 1 + 0.025 * wob(v.x * 2, v.y * 1.4, v.z * 2) * Math.sin(Math.PI * t);
    v.x *= k; v.z *= k;
  });
  // lathe axis → +X (wide end at −X); flatten the underside a little
  const axis = grp(root, [-1.35, MAXR * FLAT, 0], [0, 0, -Math.PI / 2]);
  root.position.x -= 0.2;
  axis.scale.set(FLAT, 1, 1);
  part(axis, hamGeo, matU('#ffffff', { map: glazeTex() }));
  // shank end: pale cut ring + bone + paper frill
  const shank = grp(root, [-1.35 + L, MAXR * FLAT, 0]);
  part(shank, G.cyl(), mat('#f2c6b0'), [-0.01, 0, 0], [0.3, 0.05, 0.3], [0, 0, Math.PI / 2], fo);
  part(shank, G.cyl(), mat('#f6eedb'), [0.25, 0.03, 0], [0.1, 0.5, 0.1], [0, 0, Math.PI / 2 - 0.1]);
  part(shank, G.sphere(), mat('#f6eedb'), [0.52, 0.06, 0.07], 0.14);
  part(shank, G.sphere(), mat('#f6eedb'), [0.52, 0.06, -0.07], 0.14);
  const frill = cached('food-ham-frill', () => {
    const segs = 40, rows = 2;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < rows; i++) for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * TAU;
      const zig = i === 1 ? (j % 2 === 0 ? 0.14 : 0.06) : 0;
      const r = i === 0 ? 0.13 : 0.2;
      pos.push(i === 0 ? 0 : zig + 0.04, Math.cos(a) * r, Math.sin(a) * r);
    }
    for (let j = 0; j < segs; j++) { const a = j, b = j + 1, c = j + segs + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
  part(shank, frill, mat('#ffffff', { side: THREE.DoubleSide }), [0.12, 0.02, 0], undefined, [0, 0, -0.1], fo);
  part(shank, G.torus(0.13, 0.025, 6, 20), mat('#e8383d'), [0.12, 0.02, 0], 1, [0, Math.PI / 2, 0], fo);
  // pineapple rings with cherries on top
  const surfY = (x: number) => { const t = clamp((x + 1.35) / L); return MAXR * FLAT + rAt(t) * FLAT; };
  const pine = matU('#ffffff', { map: tex('pineapple', 256, 32, (g, W, H) => {
    g.fillStyle = '#fbe27a'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(214,160,40,0.55)';
    for (let x = 0; x < W; x += 12) g.fillRect(x, 0, 3, H);
  }) });
  const pineD = mat('#d8a02a');
  for (const [x, z, ry] of [[-0.75, 0.18, 0.15], [0.12, -0.12, -0.12]] as const) {
    const y = surfY(x) - 0.04;
    const tiltZ = (surfY(x + 0.05) - surfY(x - 0.05)) / 0.1 * 0.8;
    const ring = grp(root, [x, y, z], [0, ry, -Math.atan(tiltZ)]);
    part(ring, lathe('food-pineapple', [[0.11, -0.02], [0.36, -0.02], [0.375, 0.02], [0.36, 0.065], [0.11, 0.065], [0.1, 0.022], [0.11, -0.02]], 36), pine);
    part(ring, G.torus(0.365, 0.014, 6, 36), pineD, [0, 0.045, 0], 1, [Math.PI / 2, 0, 0], fo);
    cherry(ring, [0, -0.02, 0], 0.12, 0.2);
  }
  // glaze sheen (laid on the upper-front surface)
  const surfAt = (x: number, z: number) => { const t = clamp((x + 1.35) / L); const r = rAt(t); return MAXR * FLAT + Math.sqrt(Math.max(0, r * r - z * z)) * FLAT; };
  for (const [x, z, sx, rot] of [[-0.95, 0.62, 0.22, -0.45], [-0.2, 0.45, 0.16, -0.3]] as const) {
    shine(root, [x, surfAt(x, z) - 0.01, z], [sx, 0.025, 0.05], [0.7, rot, 0.3], 0.45, '#ffe6c0');
  }
}

// ════════════════════════════════════════════════════════════════════
//  GRAPES (bunch lying on its side, stem, leaf, tendril)
// ════════════════════════════════════════════════════════════════════
const grapeLeafGeo = () => cached('food-grape-leaf', () => {
  const s = new THREE.Shape();
  const lobes = [[0, 1], [0.55, 0.78], [0.95, 0.18], [0.62, -0.25], [0, -0.05], [-0.62, -0.25], [-0.95, 0.18], [-0.55, 0.78]] as const;
  // star-ish lobed outline (points at even indices of a radial function)
  const N = 120;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * TAU;
    const lob = 0.72 + 0.28 * Math.pow(Math.abs(Math.cos(a * 2.5)), 0.6);
    const notch = 1 - 0.55 * Math.exp(-((a - Math.PI) ** 2) / 0.02);
    const r = lob * notch;
    const x = Math.sin(a) * r, y = Math.cos(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  void lobes;
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 4 });
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, p.getZ(i) - 0.25 * (x * x) + 0.08 * Math.sin(y * 3)); }
  g.computeVertexNormals();
  return g;
});
function grapes(root: THREE.Group) {
  const R = prng(17);
  const cols = ['#7a3a9e', '#6a2c8c', '#8e4cb6'];
  const groups: Array<Array<{ g: THREE.BufferGeometry; p: V3; s: V3 }>> = [[], [], []];
  const hls: Array<{ g: THREE.BufferGeometry; p: V3; s: V3; r: V3 }> = [];
  const AX_Y = 0.66;
  // cone of grapes along X (tip at −X, stem end at +X)
  const layers = 9;
  for (let l = 0; l < layers; l++) {
    const k = l / (layers - 1);
    const x = lerp(-1.25, 0.95, k);
    const cr = 0.12 + 0.52 * Math.pow(k, 0.7) * (1 - 0.25 * Math.max(0, k - 0.85) / 0.15);
    const r = lerp(0.2, 0.25, k);
    const ring = Math.max(1, Math.round((TAU * cr) / (r * 1.75)));
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * TAU + l * 0.55 + R() * 0.2;
      let y = AX_Y + Math.cos(a) * cr, z = Math.sin(a) * cr * 1.05;
      if (y < r * 0.92) y = r * 0.92;
      const rr = r * (0.9 + R() * 0.18);
      const p: V3 = [x + (R() - 0.5) * 0.08, y, z];
      groups[Math.floor(R() * 3)].push({ g: G.ball(), p, s: [rr, rr * 1.06, rr] });
      // a highlight on every upward-facing grape
      if (Math.cos(a) > -0.3) hls.push({ g: G.ball(), p: [p[0] - rr * 0.3, p[1] + rr * 0.6, p[2] + rr * 0.74], s: [rr * 0.24, rr * 0.14, rr * 0.06], r: [0.65, -0.3, 0.5] });
    }
    // fill the core so no gaps show
    if (cr > 0.25) groups[1].push({ g: G.ball(), p: [x, AX_Y, 0], s: [cr * 0.8, cr * 0.8, cr * 0.8] });
  }
  groups.forEach((list, i) => { if (list.length) part(root, merge(list), mat(cols[i])); });
  const hl = part(root, merge(hls), basic('#f4e6ff', { transparent: true, opacity: 0.85 }), undefined, undefined, undefined, nob);
  noOutline(hl);
  // bloom (dusty light tint) on a few grapes
  // stem: woody main stalk with a little crook + side twigs
  const stemM = mat('#7a5a2a');
  part(root, taperedTube(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.6, AX_Y + 0.1, 0), new THREE.Vector3(1.05, AX_Y + 0.2, 0.02), new THREE.Vector3(1.32, AX_Y + 0.48, -0.04), new THREE.Vector3(1.38, AX_Y + 0.78, 0), new THREE.Vector3(1.28, AX_Y + 0.92, 0.03),
  ]), 30, 8, (t) => lerp(0.07, 0.05, t)), stemM);
  part(root, G.cyl(), mat('#5e4420'), [1.27, AX_Y + 0.93, 0.03], [0.065, 0.04, 0.065], [0.3, 0, 0.9], fo);
  // big leaf draped over the top
  const leaf = grp(root, [0.92, AX_Y + 0.62, -0.42], [-0.55, 0.5, -0.35]);
  leaf.scale.setScalar(0.66);
  part(leaf, grapeLeafGeo(), mat('#5aae3a'));
  const veinM = mat('#3a7a28');
  for (const a of [0, 1.0, -1.0, 2.0, -2.0]) {
    const end = new THREE.Vector3(Math.sin(a) * 0.82, Math.cos(a) * 0.82, 0.03 - 0.25 * (Math.sin(a) * 0.82) ** 2 + 0.06);
    part(leaf, taperedTube(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.05, 0.07), end.clone().multiplyScalar(0.5).add(new THREE.Vector3(0, 0, 0.05)), end), 10, 5, (t) => 0.035 * (1 - t * 0.8), false), veinM, undefined, undefined, undefined, fo);
  }
  // curly tendril
  const tpts: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, a = t * TAU * 2.2, r = 0.14 * (1 - t * 0.6);
    tpts.push(new THREE.Vector3(1.3 + t * 0.45, AX_Y + 0.75 + Math.sin(a) * r + t * 0.2, Math.cos(a) * r));
  }
  part(root, taperedTube(new THREE.CatmullRomCurve3(tpts), 80, 5, (t) => 0.022 * (1 - t * 0.7)), mat('#6aa83a'), undefined, undefined, undefined, fo);
}

// ════════════════════════════════════════════════════════════════════
//  PUDDING (fluted caramel custard, caramel drips, whipped cream, cherry) — wobbles
// ════════════════════════════════════════════════════════════════════
function pudding(root: THREE.Group) {
  const H = 1.42, RB = 1.28, RT = 0.98;
  const radius = (t: number) => lerp(RB, RT, t) * (1 + 0.06 * Math.sin(Math.PI * t)) + (t > 0.94 ? -0.12 * smooth((t - 0.94) / 0.06) : 0);
  const prof: Array<[number, number]> = [[0, 0]];
  for (let i = 0; i <= 24; i++) { const t = i / 24; prof.push([radius(t), t * H]); }
  prof.push([RT * 0.6, H + 0.02], [0, H + 0.03]);
  const body = grp(root);
  const jelly = grp(body);
  const geo = lathe('food-pudding', prof, 64, (v) => {
    // moulded flutes
    const a = Math.atan2(v.z, v.x);
    const k = 1 + 0.045 * Math.cos(a * 12) * smooth(clamp(v.y / 0.2)) * (v.y < H ? 1 : 0);
    v.x *= k; v.z *= k;
  });
  part(jelly, geo, mat('#f8cf62'));
  // caramel cap + drips
  part(jelly, lathe('food-pudding-caramel', [[RT * 1.005, H - 0.16], [RT * 1.01, H - 0.05], [RT * 0.93, H + 0.02], [RT * 0.5, H + 0.05], [0, H + 0.06]], 64), mat('#b8641c'));
  const drips = cached('food-pudding-drips', () => {
    const parts: Array<{ g: THREE.BufferGeometry; p: V3 }> = [];
    const R = prng(23);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + R() * 0.2;
      const len = 0.16 + R() * 0.42;
      const top = H - 0.1;
      const yc = top - len / 2;
      const rr = radius(clamp(yc / H)) - 0.012;
      const g = G.capsule(0.075, len).clone();
      g.scale(1, 1, 0.42);
      g.rotateY(Math.PI / 2 - a);
      parts.push({ g, p: [Math.cos(a) * rr, yc, Math.sin(a) * rr] });
    }
    return merge(parts);
  });
  part(jelly, drips, mat('#b8641c'), undefined, undefined, undefined, fo);
  // whipped cream + cherry
  const top = grp(jelly, [0, H + 0.02, 0]);
  part(top, dollopGeo(), mat('#fffaf0'), undefined, [0.62, 0.55, 0.62]);
  cherry(top, [0.04, 0.66, 0.02], 0.2);
  // sheen
  shine(jelly, [-0.62, 0.9, 0.85], [0.08, 0.32, 0.04], [0, -0.6, 0.12], 0.6, '#fffbe6');
  shine(jelly, [-0.45, 1.36, 0.5], [0.22, 0.04, 0.08], [0, -0.7, 0], 0.55, '#ffe6b0');

  // wobble (spring) — base stays put, the dome squashes and sways
  let t = Math.random() * 10, amp = 0.35, vel = 0, sway = 0, swayV = 0;
  root.userData.poke = (s = 1) => { vel += 4 * s; swayV += 2.5 * s * (Math.random() < 0.5 ? -1 : 1); };
  root.userData.update = (dt: number) => {
    dt = Math.min(dt, 0.05);
    t += dt;
    vel += (-amp * 90 - vel * 4.5) * dt; amp += vel * dt;
    swayV += (-sway * 60 - swayV * 3.5) * dt; sway += swayV * dt;
    const idle = 0.012 * Math.sin(t * 3.4);
    const sy = 1 + clamp(amp * 0.06, -0.2, 0.2) + idle;
    const sxz = 1 / Math.sqrt(sy);
    jelly.scale.set(sxz, sy, sxz);
    jelly.rotation.z = clamp(sway * 0.04, -0.12, 0.12) + 0.01 * Math.sin(t * 2.3);
    jelly.rotation.x = 0.008 * Math.sin(t * 2.9);
  };
  root.userData.poke(0.3);
}

// ════════════════════════════════════════════════════════════════════
//  CAKE SLICE (layers, cream, jam, frosting, dollops, cherry)
// ════════════════════════════════════════════════════════════════════
function wedgeGeo(key: string, R: number, a: number, h: number, bevel = 0) {
  return cached(key, () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(Math.cos(-a) * R, Math.sin(-a) * R);
    s.absarc(0, 0, R, -a, a, false);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 24 });
    g.rotateX(-Math.PI / 2);
    // UVs for the sponge texture: wrap around by world position
    const p = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + p.getZ(i)) * 0.45, p.getY(i) * 0.9);
    return g;
  });
}
let sprinklesC: THREE.BufferGeometry[] | null = null;
function cakeSlice(root: THREE.Group) {
  const R = 2.75, A = 0.36; // radius & half-angle of the wedge
  const cx = -R * 0.55; // centre the slice: tip toward +X? no — tip toward −X, back (frosted arc) toward +X
  const slice = grp(root, [cx, 0, 0]);
  const layers: Array<[number, string, THREE.Material]> = [
    [0.36, 'choc', matU('#ffffff', { map: spongeTex('#8a4a28', 'rgba(60,28,12,0.6)', 'sp-choc') })],
    [0.1, 'cream', mat('#fff6ea')],
    [0.36, 'pink', matU('#ffffff', { map: spongeTex('#ffb4c8', 'rgba(220,120,150,0.55)', 'sp-pink') })],
    [0.08, 'jam', mat('#d0203a')],
    [0.36, 'vanilla', matU('#ffffff', { map: spongeTex('#ffe2a2', 'rgba(220,170,90,0.55)', 'sp-van') })],
  ];
  let y = 0;
  for (const [h, name, m] of layers) {
    part(slice, wedgeGeo(`food-cake-${name}`, R - 0.05, A, h), m, [0, y, 0]);
    y += h;
  }
  // frosting top (bevelled, slightly overhanging) + frosted back arc
  part(slice, wedgeGeo('food-cake-top', R - 0.04, A, 0.1, 0.05), mat('#fff3f6'), [0, y, 0]);
  const topY = y + 0.15;
  part(slice, cached('food-cake-back', () => {
    const g = new THREE.CylinderGeometry(R + 0.005, R + 0.005, y + 0.08, 28, 1, true, Math.PI / 2 - A, 2 * A);
    g.translate(0, (y + 0.08) / 2, 0);
    return g;
  }), mat('#fff3f6'));
  // pink icing drips down the back
  const drips = cached('food-cake-drips', () => {
    const parts: Array<{ g: THREE.BufferGeometry; p: V3 }> = [];
    const Rr = prng(31);
    for (let i = 0; i < 9; i++) {
      const a = lerp(-A + 0.04, A - 0.04, i / 8);
      const len = 0.15 + Rr() * 0.35;
      const g = G.capsule(0.06, len).clone();
      g.scale(1, 1, 0.5);
      g.rotateY(Math.PI / 2 + a);
      parts.push({ g, p: [Math.cos(a) * (R + 0.02), y + 0.1 - len / 2, -Math.sin(a) * (R + 0.02)] });
    }
    parts.push({ g: (() => { const g = new THREE.TorusGeometry(R + 0.01, 0.07, 6, 30, 2 * A); g.rotateX(Math.PI / 2); g.rotateY(A); return g; })(), p: [0, y + 0.1, 0] });
    return merge(parts);
  });
  part(slice, drips, mat('#ff86b0'), undefined, undefined, undefined, fo);
  // cream dollops along the back + cherry on the middle one
  const cream = mat('#fffaf2');
  for (const k of [-0.6, 0, 0.6]) {
    const a = k * A;
    const d = part(slice, dollopGeo(), cream, [Math.cos(a) * (R - 0.36), topY - 0.04, -Math.sin(a) * (R - 0.36)], [0.3, 0.32, 0.3]);
    d.rotation.y = k * 2;
  }
  cherry(slice, [R - 0.36, topY - 0.04 + 0.38, 0], 0.19, 0.3);
  // sprinkles on top
  const spr = sprinklesC ?? (sprinklesC = (() => {
    const Rr = prng(41);
    const lists: Array<Array<{ g: THREE.BufferGeometry; p: V3; r: V3 }>> = [[], [], []];
    for (let i = 0; i < 30; i++) {
      const d = lerp(0.4, R - 0.65, Math.sqrt(Rr()));
      const a = (Rr() * 2 - 1) * A * (d / R) * 0.9 * (R / Math.max(d, 0.5));
      const aa = clamp(a, -A * 0.85, A * 0.85);
      lists[i % 3].push({ g: G.capsule(0.022, 0.07, 4), p: [Math.cos(aa) * d, topY - 0.03, -Math.sin(aa) * d], r: [Math.PI / 2, Rr() * TAU, 0] });
    }
    return lists.map((l) => merge(l));
  })());
  ['#3ad0e0', '#ffd83a', '#7ad04a'].forEach((c, i) => part(slice, spr[i], mat(c), undefined, undefined, undefined, fo));
  shine(slice, [R * 0.45, topY - 0.02, 0.15], [0.35, 0.015, 0.06], [0, 0.15, 0], 0.7);
}

// ════════════════════════════════════════════════════════════════════
export function createFood(kind: FoodKind, scale = 1): THREE.Group {
  const root = new THREE.Group();
  root.name = 'food-' + kind;
  const inner = grp(root);
  switch (kind) {
    case 'drumstick': drumstick(inner); break;
    case 'pie': pie(inner); break;
    case 'ham': ham(inner); break;
    case 'grapes': grapes(inner); break;
    case 'pudding': pudding(inner); break;
    case 'cakeSlice': cakeSlice(inner); break;
  }
  if (inner.userData.update) root.userData.update = inner.userData.update;
  if (inner.userData.poke) root.userData.poke = inner.userData.poke;
  root.scale.setScalar(scale);
  return root;
}

/** Silver oval serving platter, ≈4.5 × 3 × 0.3 at scale 1 (origin = bottom-centre, long axis = X).
 *  Food stands on the dish floor at y = PLATTER_TOP · scale (also in userData.top). */
export function createPlatter(scale = 1): THREE.Group {
  const root = new THREE.Group();
  root.name = 'platter';
  const SX = 2.05, SZ = 1.36;
  const dish = grp(root);
  dish.scale.set(SX, 1, SZ);
  const silver = matU('#ffffff', { map: silverTex() });
  const prof: Array<[number, number]> = [[0, 0.02], [0.72, 0.02], [0.76, 0], [0.82, 0.0], [0.86, 0.05], [0.92, 0.13], [1.0, 0.24], [1.05, 0.29], [1.04, 0.31], [0.99, 0.3], [0.93, 0.22], [0.86, PLATTER_TOP + 0.01], [0.8, PLATTER_TOP], [0, PLATTER_TOP]];
  part(dish, lathe('food-platter', prof, 72), silver);
  // beaded gold rim
  part(dish, cached('food-platter-beads', () => {
    const parts: Array<{ g: THREE.BufferGeometry; p: V3; s: V3 }> = [];
    const n = 64;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      parts.push({ g: G.ball(), p: [Math.sin(a) * 1.035, 0.305, Math.cos(a) * 1.035], s: [0.028, 0.032, 0.028 * SX / SZ] });
    }
    return merge(parts);
  }), mat('#f2c23a'), undefined, undefined, undefined, fo);
  part(dish, G.torus(0.83, 0.012, 6, 64), mat('#e0b030'), [0, PLATTER_TOP + 0.004, 0], 1, [Math.PI / 2, 0, 0], fo);
  // handles at both ends
  const handleGeo = cached('food-platter-handle', () => {
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.24, -0.42), new THREE.Vector3(0.22, 0.34, -0.36), new THREE.Vector3(0.36, 0.38, 0), new THREE.Vector3(0.22, 0.34, 0.36), new THREE.Vector3(0, 0.24, 0.42),
    ]);
    return merge([
      { g: new THREE.TubeGeometry(c, 40, 0.05, 8, false) },
      { g: G.ball(), p: [0, 0.24, -0.42], s: 0.07 },
      { g: G.ball(), p: [0, 0.24, 0.42], s: 0.07 },
      { g: G.ball(), p: [0.37, 0.4, 0], s: [0.07, 0.08, 0.1] },
    ]);
  });
  const handleM = mat('#c3cede');
  for (const s of [1, -1]) {
    const h = part(root, handleGeo, handleM, [s * SX * 1.0, 0, 0], undefined, [0, s > 0 ? 0 : Math.PI, 0]);
    void h;
    part(root, G.sphere(), mat('#f2c23a'), [s * (SX + 0.37), 0.4, 0], [0.05, 0.06, 0.07], undefined, fo);
  }
  // polished sheen following the rim
  const sheen = basic('#ffffff', { transparent: true, opacity: 0.75 });
  for (const [a0, len] of [[2.2, 0.9], [-0.9, 0.5]] as const) {
    const arc = part(dish, G.arc(1.005, 0.014, len), sheen, [0, 0.252, 0], 1, [Math.PI / 2, 0, a0], nob);
    noOutline(arc);
  }
  root.userData.top = PLATTER_TOP * scale;
  root.scale.setScalar(scale);
  return root;
}
