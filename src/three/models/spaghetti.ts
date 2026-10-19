import * as THREE from 'three';
import { PAL, mat, basic, canvasTex, noOutline } from '../gfx';
import type { Rig } from './rig';
import { G, Mats, TAU, clamp, lerp, damp, smooth, seg, easeOut, easeInOut, wrapAngle, grp, part, cached, merge, arcRibbon, Blinker, vis } from './kit';

/**
 * SPAGHETTI MONSTER — a grumpy living plate of spaghetti: a big meatball (r ≈ 1.4) with googly eyes,
 * angry brows and a toothy mouth, sitting in a noodle nest in a tomato-sauce puddle, with 7 noodle tentacles.
 *
 * root = floor point under the body center; face looks along +Z. Body top ≈ 3.3; nest/puddle radius ≈ 2.6.
 * Angles (lashDir) are yaws in root-local XZ: direction = (sin a, 0, cos a) — 0 = +Z (front), +π/2 = +X.
 * Tentacles grow from the nest rim (r ≈ 1.6) and reach ≈ 6.9 from the center when fully stretched.
 *
 * States (drive `p` 0→1 yourself for lash/grab):
 *  idle — tentacles rise & wriggle (anger 0..1 speeds it up, deepens the scowl)
 *  lash — p 0..0.35 wind-up (coil back & up on the lashDir−2 side), 0.35..0.62 STRIKE: a low horizontal sweep
 *         from lashDir−1.9 to lashDir+1.9 rad (passes lashDir at p≈0.49), 0.62..1 tentacles lie spread out on the floor
 *  grab — 3 tentacles reach for `target` (root-local) by p≈0.45 and coil around it by p≈0.75; the others menace
 *  hurt — recoil, squeezed eyes, flailing (use `flash` for the white hit-flash)
 *  dead — collapses limply, X eyes, tongue out
 * tips()/segments() return WORLD positions (arrays & vectors are reused every call — copy what you keep).
 */

export interface SpagAnim {
  state: 'idle' | 'lash' | 'grab' | 'hurt' | 'dead';
  /** radians, direction in root-local XZ the tentacles sweep toward */
  lashDir: number;
  /** 0..1 progress of the current lash/grab */
  p: number;
  /** root-local point for 'grab' */
  target?: THREE.Vector3;
  flash: number;
  anger: number;
}
export interface SpaghettiRig extends Rig<SpagAnim> {
  tips(): THREE.Vector3[];
  segments(): THREE.Vector3[][];
}

const RBODY = 1.4;
const BODY_Y = 1.85;
const NT = 7; // tentacles
const NS = 18; // segments per tentacle
const RS = 8; // radial verts
const LEN = 5.3;
const RB = 1.62; // base ring radius
const BASE_Y = 0.55;
const fo = { cast: false };

// ───────────────────────── textures / geometry ─────────────────────────
let meatTexC: THREE.Texture | null = null;
function meatTex() {
  if (meatTexC) return meatTexC;
  meatTexC = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = PAL.meatball; g.fillRect(0, 0, w, h);
    const blob = (x: number, y: number, rx: number, ry: number, c: string) => {
      g.fillStyle = c;
      for (const dx of [-w, 0, w]) { g.beginPath(); g.ellipse(x + dx, y, rx, ry, (x * 0.37) % 3, 0, TAU); g.fill(); }
    };
    for (let i = 0; i < 60; i++) blob((i * 71.3) % w, (i * 37.9) % h, 9 + (i % 4) * 5, 5 + (i % 3) * 3, '#6a3220');
    for (let i = 0; i < 80; i++) blob((i * 53.1 + 17) % w, (i * 29.3 + 9) % h, 4, 2.5, '#b8703e');
    for (let i = 0; i < 26; i++) blob((i * 97.7 + 31) % w, (i * 41.3 + 23) % h, 3.5, 2.2, '#5d9a3a');
    for (let i = 0; i < 30; i++) blob((i * 61.7 + 5) % w, (i * 23.1 + 50) % h, 2.5, 2.5, '#f2e2b0');
  }, { wrap: true });
  return meatTexC;
}
let noodleTexC: THREE.Texture | null = null;
let trailTexC: THREE.Texture | null = null;
function nestTex() {
  if (noodleTexC) return noodleTexC;
  noodleTexC = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#e2a83a'; g.fillRect(0, 0, w, h);
    let seed = 7;
    const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 120; i++) {
      const x = R() * w, y = R() * h, r = 16 + R() * 44, a0 = R() * TAU, a1 = a0 + 1.4 + R() * 3;
      for (const dx of [-w, 0, w]) {
        g.beginPath(); g.arc(x + dx, y, r, a0, a1);
        g.strokeStyle = 'rgba(120,60,20,0.55)'; g.lineWidth = 11; g.stroke();
        g.strokeStyle = PAL.noodle; g.lineWidth = 7; g.stroke();
        g.strokeStyle = 'rgba(255,250,210,0.6)'; g.lineWidth = 2; g.stroke();
      }
    }
    // sauce stains
    for (let i = 0; i < 18; i++) {
      const x = R() * w, y = R() * h * 0.6;
      g.fillStyle = 'rgba(200,64,42,0.55)';
      for (const dx of [-w, 0, w]) { g.beginPath(); g.ellipse(x + dx, y, 14 + R() * 26, 8 + R() * 12, R(), 0, TAU); g.fill(); }
    }
  }, { wrap: true });
  return noodleTexC;
}

const lumpyGeo = () => cached('spag-lumpy', () => {
  const g = new THREE.SphereGeometry(1, 44, 30);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + 0.05 * Math.sin(v.x * 6.1 + v.y * 2.3) * Math.sin(v.z * 5.3 - v.y * 4.1) + 0.03 * Math.sin(v.x * 12 + v.z * 10 + v.y * 9);
    v.multiplyScalar(n);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
});

/** sauce cap on top of the meatball: dome with a dripping lower edge (fewer drips in front, over the face) */
const sauceCapGeo = () => cached('spag-saucecap', () => {
  const NA = 64, NV = 10;
  const pos: number[] = [], idx: number[] = [];
  const drip = (phi: number) => {
    const front = 0.35 + 0.65 * smooth(Math.abs(wrapAngle(phi)) / 1.3); // phi = 0 → front (+Z)
    return front * (0.16 + 0.28 * Math.max(0, Math.sin(phi * 5 + 0.7)) ** 3 + 0.16 * Math.max(0, Math.sin(phi * 9 + 2.1)) ** 6);
  };
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NA; i++) {
    const phi = (i / NA) * TAU;
    const th = (j / NV) * (0.62 + drip(phi));
    const r = 1.035;
    pos.push(Math.sin(th) * Math.sin(phi) * r, Math.cos(th) * r, Math.sin(th) * Math.cos(phi) * r);
    if (i < NA && j < NV) { const a = j * (NA + 1) + i; idx.push(a, a + NA + 1, a + 1, a + 1, a + NA + 1, a + NA + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
});
/** low-poly droplet (point at +Y), height 2 (y −1..1) */
const dropGeo = () => cached('spag-drop', () => {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const th = (i / 10) * Math.PI;
    pts.push(new THREE.Vector2(Math.max(i === 0 || i === 10 ? 0 : 1e-3, Math.sin(th) * Math.pow((1 + Math.cos(th)) / 2, 0.55)), -Math.cos(th)));
  }
  return new THREE.LatheGeometry(pts, 10);
});
type V3 = [number, number, number];
const SPLATS: [number, number, number][] = [[3.1, 1.2, 0.35], [-2.9, 1.8, 0.28], [2.2, -2.6, 0.3], [-3.3, -1.2, 0.22], [0.6, 3.2, 0.24]];

/** puddle: wavy blob in XZ (y = 0) */
const puddleGeo = () => cached('spag-puddle', () => {
  const s = new THREE.Shape();
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const a = i / n * TAU;
    const r = 2.55 + 0.25 * Math.sin(a * 5 + 1) + 0.15 * Math.sin(a * 9 + 2) + 0.1 * Math.sin(a * 3);
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  const g = new THREE.ShapeGeometry(s, 4);
  g.rotateX(-Math.PI / 2);
  return g;
});

/** loose noodle loops lying on the nest (merged) */
const nestNoodlesGeo = () => cached('spag-nestnoodles', () => {
  let seed = 11;
  const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const parts: THREE.BufferGeometry[] = [];
  const nestH = (r: number) => 0.82 * Math.max(0, 1 - ((r - 1.2) / 1.1) ** 2) + 0.02;
  for (let k = 0; k < 14; k++) {
    const a0 = R() * TAU, span = 0.8 + R() * 1.4, r0 = 1.25 + R() * 0.9;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const a = a0 + span * i / 6, r = clamp(r0 + Math.sin(i * 1.7 + k) * 0.35, 1.2, 2.25);
      pts.push(new THREE.Vector3(Math.sin(a) * r, nestH(r) + 0.06 + (i % 2) * 0.1, Math.cos(a) * r));
    }
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.075, 6, false));
  }
  const out = mergeSimple(parts);
  return out;
});
function mergeSimple(list: THREE.BufferGeometry[]) {
  let n = 0, m = 0;
  for (const g of list) { n += g.attributes.position.count; m += g.index ? g.index.count : 0; }
  const pa = new Float32Array(n * 3), na = new Float32Array(n * 3);
  const ia = new Uint32Array(m);
  let o = 0, oi = 0;
  for (const g of list) {
    pa.set(g.attributes.position.array as ArrayLike<number>, o * 3);
    na.set(g.attributes.normal.array as ArrayLike<number>, o * 3);
    const gi = g.index!.array;
    for (let i = 0; i < gi.length; i++) ia[oi + i] = gi[i] + o;
    o += g.attributes.position.count; oi += gi.length;
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pa, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(na, 3));
  g.setIndex(new THREE.BufferAttribute(ia, 1));
  return g;
}

// ───────────────────────── tentacle params ─────────────────────────
interface Params { yaw: number; pitch: number; curlV: number; curlH: number; curlE: number; reach: number; wav: number; wavS: number }
const PKEYS = ['pitch', 'curlV', 'curlH', 'curlE', 'reach', 'wav', 'wavS'] as const;
interface Tent { home: number; fan: number; ph: number; rnd: number; C: Params; T: Params; J: THREE.Vector3[]; W: THREE.Vector3[] }
const radAt = (s: number) => lerp(0.21, 0.085, Math.pow(s, 0.85));

export function createSpaghettiMonster(): SpaghettiRig {
  const M = new Mats();
  const black = basic('#1b1214');
  const white = basic('#ffffff');
  const root = new THREE.Group();
  root.name = 'spaghettiMonster';

  const sauceM = M.get(PAL.sauce);
  const sauceD = M.get('#a82e20');
  const noodleM = M.get(PAL.noodle);

  // puddle & splats
  const puddleAll = cached('spag-puddle-all', () => merge([{ g: puddleGeo(), p: [0, 0.02, 0] }, ...SPLATS.map(([x, z, r]) => ({ g: G.cyl(), p: [x, 0.02, z] as V3, s: [r, 0.02, r * 0.8] as V3 }))]));
  part(root, puddleAll, mat(PAL.sauce), undefined, undefined, undefined, { cast: false, receive: true }); // floor decal: not hit-flashed
  // nest
  const nest = grp(root, undefined, undefined, 'nest');
  const nestProfile: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) { const r = 2.3 - i / 14 * 1.3; nestProfile.push(new THREE.Vector2(r, 0.82 * Math.max(0, 1 - ((r - 1.2) / 1.1) ** 2))); }
  nestProfile.push(new THREE.Vector2(0.9, 0.7));
  const nestGeo = cached('spag-nest', () => {
    const g = new THREE.LatheGeometry(nestProfile, 40);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 1.2);
    return g;
  });
  const nestTx = nestTex();
  part(nest, nestGeo, M.get('#ffffff', { map: nestTx }), [0, 0.02, 0]);
  part(nest, nestNoodlesGeo(), noodleM);

  // body
  const bodyPivot = grp(root, [0, 0.5, 0], undefined, 'bodyPivot'); // lean/squash pivot near the bottom
  const body = grp(bodyPivot, [0, BODY_Y - 0.5, 0], undefined, 'body');
  const meatM = M.own('#ffffff', { map: meatTex() });
  part(body, lumpyGeo(), meatM, undefined, RBODY);
  // sauce cap + drip tips (one mesh)
  const sauceTop = cached('spag-sauce-top', () => {
    const parts: { g: THREE.BufferGeometry; p?: V3; s?: number | V3; r?: V3 }[] = [{ g: sauceCapGeo(), s: RBODY }];
    for (let i = 0; i < 9; i++) {
      const phi = (i / 9) * TAU + 0.35;
      if (Math.abs(wrapAngle(phi)) < 0.7) continue;
      const th = 0.95 + 0.25 * Math.max(0, Math.sin(phi * 5 + 0.7)) ** 3;
      const d = new THREE.Vector3(Math.sin(th) * Math.sin(phi), Math.cos(th), Math.sin(th) * Math.cos(phi)).multiplyScalar(RBODY * 1.03);
      parts.push({ g: dropGeo(), p: [d.x, d.y - 0.05, d.z], s: [0.09, 0.13, 0.09] });
    }
    return merge(parts);
  });
  part(body, sauceTop, sauceM);
  // basil (leaves + stem) and parmesan crumbs (one mesh each)
  const basilGeo = cached('spag-basil', () => merge([
    ...([[0.3, 0.55, 1], [2.4, 0.45, 0.85], [4.3, 0.6, 0.75]] as const).map(([ry, rz, sc]) => ({ g: G.ball(), p: [0.22 * sc * Math.cos(ry), RBODY * 1.02 + 0.06, -0.22 * sc * Math.sin(ry)] as V3, s: [0.32 * sc, 0.06, 0.15 * sc] as V3, r: [0, ry, rz] as V3 })),
    { g: G.capsule(0.03, 0.18, 6), p: [0, RBODY * 1.05 + 0.1, 0], r: [0.3, 0, 0.2] },
  ]));
  part(body, basilGeo, M.get('#3f9a34'));
  const parmGeo = cached('spag-parm', () => merge(Array.from({ length: 12 }, (_, i) => {
    const a = i * 2.4, th = 0.22 + (i % 4) * 0.12;
    return { g: cached('spag-box', () => new THREE.BoxGeometry(1, 1, 1)), p: [Math.sin(th) * Math.sin(a) * RBODY * 1.04, Math.cos(th) * RBODY * 1.04, Math.sin(th) * Math.cos(a) * RBODY * 1.04] as V3, s: [0.08, 0.05, 0.08] as V3, r: [i, i * 2, 0] as V3 };
  })));
  part(body, parmGeo, M.get('#fff8e0'), undefined, undefined, undefined, fo);

  // ── face (on the body's front)
  const face = grp(body, undefined, undefined, 'face');
  const surfPt = (yaw: number, pitch: number, r: number) => new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch) * r, Math.sin(pitch) * r, Math.cos(yaw) * Math.cos(pitch) * r);
  interface Eye { g: THREE.Group; white: THREE.Mesh; pupil: THREE.Mesh; lid: THREE.Group; browG: THREE.Group; brow: THREE.Mesh; xA: THREE.Mesh; xB: THREE.Mesh; off: THREE.Vector2; vel: THREE.Vector2; side: number }
  const ZAX = new THREE.Vector3(0, 0, 1);
  const orient = <T extends THREE.Object3D>(o: T, n: THREE.Vector3): T => { o.quaternion.setFromUnitVectors(ZAX, n.clone().normalize()); return o; };
  const eyes: Eye[] = [];
  const EYE_R = 0.43;
  const lidM = M.get('#7a3a22');
  const browM = M.get('#22100a');
  for (const side of [1, -1]) {
    const c = surfPt(side * 0.37, 0.3, RBODY + 0.1);
    const g = orient(grp(face, [c.x, c.y, c.z]), c); // +Z of the eye group points outward
    const eyeW = part(g, G.sphere(), white, undefined, EYE_R, undefined, fo);
    const pupil = part(g, G.sphere(), black, [0, 0, EYE_R * 0.9], [0.2, 0.2, 0.09], undefined, fo);
    const lid = grp(g);
    part(lid, cached('spag-lid', () => merge([{ g: G.dome() }, { g: G.torus(1, 0.06, 6, 24), r: [Math.PI / 2, 0, 0] }])), lidM, undefined, EYE_R * 1.07);
    const bp = surfPt(side * 0.37, 0.62, RBODY + 0.16);
    const browG = orient(grp(face, [bp.x, bp.y, bp.z]), bp);
    const brow = part(browG, G.capsule(0.12, 0.6), browM, undefined, [1, 1, 0.75]);
    const xA = part(g, G.capsule(0.05, 0.3), black, [0, 0, EYE_R * 0.98], 1, undefined, fo);
    const xB = part(g, G.capsule(0.05, 0.3), black, [0, 0, EYE_R * 0.98], 1, undefined, fo);
    xA.visible = xB.visible = false;
    eyes.push({ g, white: eyeW, pupil, lid, browG, brow, xA, xB, off: new THREE.Vector2(), vel: new THREE.Vector2(), side });
  }
  // mouth: a dark grimace lens wrapped onto the ball, upper fangs fixed, lower jaw drops with `open`
  const mouthPos = surfPt(0, -0.2, RBODY);
  const mouth = orient(grp(face, [mouthPos.x, mouthPos.y, mouthPos.z]), mouthPos);
  const MW = 0.8, NXM = 18, RC = 1.38;
  const mz = (x: number) => Math.sqrt(RC * RC - x * x) - RC + 0.09;
  const yTop = (u: number) => 0.12 - 0.16 * u * u;
  const yBot = (u: number, open: number) => yTop(u) - (0.07 + 0.46 * open) * Math.pow(Math.max(0, 1 - u * u), 0.6) - 0.02;
  const mPos = new Float32Array((NXM + 1) * 2 * 3);
  const mIdx: number[] = [];
  for (let i = 0; i < NXM; i++) { const a = i * 2; mIdx.push(a, a + 3, a + 1, a, a + 2, a + 3); }
  const mouthGeo = new THREE.BufferGeometry();
  mouthGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
  mouthGeo.setIndex(mIdx);
  const mouthIn = part(mouth, mouthGeo, basic('#3a0810', { side: THREE.DoubleSide }), undefined, undefined, undefined, fo);
  mouthIn.frustumCulled = false;
  let lastOpen = -1;
  const shapeMouth = (open: number) => {
    if (Math.abs(open - lastOpen) < 0.003) return;
    lastOpen = open;
    for (let i = 0; i <= NXM; i++) {
      const u = i / NXM * 2 - 1, x = u * MW, z = mz(x);
      mPos.set([x, yBot(u, open), z, x, yTop(u), z], i * 6);
    }
    (mouthGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    mouthGeo.computeVertexNormals();
  };
  const tongue = part(mouth, G.sphere(), M.get('#e0506a'), [0, 0, 0], [0.3, 0.1, 0.1], undefined, fo);
  const toothM = M.get('#fffaf0');
  const toothGeo = cached('spag-tooth', () => new THREE.ConeGeometry(1, 1, 6).translate(0, -0.5, 0));
  const upperGeo = cached('spag-upper-teeth', () => merge(Array.from({ length: 7 }, (_, i) => {
    const u = (i - 3) / 3.6, x = u * MW, fang = i === 1 || i === 5;
    return { g: toothGeo, p: [x, yTop(u) + 0.01, mz(x) + 0.01] as V3, s: [fang ? 0.075 : 0.06, fang ? 0.27 : 0.15, 0.05] as V3, r: [0.12, 0, -u * 0.25] as V3 };
  })));
  part(mouth, upperGeo, toothM, undefined, undefined, undefined, fo);
  // lower jaw: teeth laid out along the jaw curve at a mid opening, moved as one piece
  const lowerGeo = cached('spag-lower-teeth', () => merge(Array.from({ length: 6 }, (_, i) => {
    const u = (i - 2.5) / 3.2, x = u * MW, fang = i === 0 || i === 5;
    return { g: toothGeo, p: [x, yBot(u, 0.55) - yBot(0, 0.55), mz(x) + 0.035] as V3, s: [fang ? 0.065 : 0.055, fang ? -0.22 : -0.12, 0.05] as V3, r: [-0.12, 0, u * 0.25] as V3 };
  })));
  const lowerJaw = part(mouth, lowerGeo, toothM, undefined, undefined, undefined, fo);
  shapeMouth(0.2);

  // falling sauce drops
  interface Drop { m: THREE.Mesh; ph: number; a: number; sp: number }
  const drops: Drop[] = [];
  for (let i = 0; i < 4; i++) {
    const m = part(root, dropGeo(), sauceD, undefined, 0.1, undefined, fo);
    drops.push({ m, ph: i / 4, a: 1.2 + i * 1.7, sp: 0.35 + i * 0.07 });
  }

  // swoosh trail on the floor behind the sweeping noodles (strike only)
  const trailTex = trailTexC ?? (trailTexC = canvasTex(256, 32, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0.95)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 7; i++) { g.fillStyle = `rgba(0,0,0,${0.35 + (i % 3) * 0.2})`; g.fillRect(0, 2 + i * 4.3, w * (0.5 + (i % 2) * 0.3), 1.6); }
    const vg = g.createLinearGradient(0, 0, 0, h);
    vg.addColorStop(0, 'rgba(0,0,0,1)'); vg.addColorStop(0.25, 'rgba(0,0,0,0)'); vg.addColorStop(0.8, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
  }));
  const TRAIL_SPAN = 1.7;
  const trailM = basic('#fff0c0', { additive: true, map: trailTex, side: THREE.DoubleSide, depthWrite: false });
  const trail = new THREE.Mesh(arcRibbon(1.9, 6.9, -TRAIL_SPAN, 0, 28), trailM);
  trail.position.y = 0.32;
  trail.visible = false;
  trail.renderOrder = 2;
  noOutline(trail);
  root.add(trail);

  // ── tentacles (one dynamic mesh)
  const ringsPer = NS + 3;
  const vPer = ringsPer * RS;
  const NV = vPer * NT;
  const tPos = new Float32Array(NV * 3), tNrm = new Float32Array(NV * 3), tCol = new Float32Array(NV * 3);
  const tIdx: number[] = [];
  const cNoodle = new THREE.Color(PAL.noodle), cSauce = new THREE.Color(PAL.sauce), cTmp = new THREE.Color();
  let cs = 99;
  const CR = () => { cs = (cs * 16807) % 2147483647; return cs / 2147483647; };
  for (let ti = 0; ti < NT; ti++) {
    const blot: number[] = [];
    for (let b = 0; b < 4; b++) blot.push(0.3 + CR() * 0.65, CR() * RS);
    for (let r = 0; r < ringsPer; r++) {
      const s = Math.min(1, r / NS);
      for (let k = 0; k < RS; k++) {
        const v = ti * vPer + r * RS + k;
        let sa = 1 - smooth(s / 0.3);
        for (let b = 0; b < 4; b++) {
          const ds = (s - blot[b * 2]) / 0.045, dk = Math.min(Math.abs(k - blot[b * 2 + 1]), RS - Math.abs(k - blot[b * 2 + 1])) / 1.6;
          sa = Math.max(sa, Math.exp(-ds * ds - dk * dk) * 0.9);
        }
        cTmp.copy(cNoodle).lerp(cSauce, clamp(sa, 0, 1) * 0.85);
        if (k === 1 || k === 2) cTmp.multiplyScalar(1.06);
        tCol.set([cTmp.r, cTmp.g, cTmp.b], v * 3);
        if (r < ringsPer - 1) {
          const a = ti * vPer + r * RS + k, b2 = ti * vPer + r * RS + ((k + 1) % RS);
          const c = a + RS, d = b2 + RS;
          tIdx.push(a, b2, c, b2, d, c);
        }
      }
    }
  }
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
  tGeo.setAttribute('normal', new THREE.BufferAttribute(tNrm, 3).setUsage(THREE.DynamicDrawUsage));
  tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  tGeo.setIndex(tIdx);
  tGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.5, 0), 9);
  const tentM = M.own('#ffffff');
  tentM.vertexColors = true;
  const tentMesh = new THREE.Mesh(tGeo, tentM);
  tentMesh.castShadow = true; tentMesh.receiveShadow = true;
  tentMesh.name = 'tentacles';
  root.add(tentMesh);

  const tents: Tent[] = [];
  for (let i = 0; i < NT; i++) {
    const home = Math.PI + (i - (NT - 1) / 2) * 0.78;
    const P0: Params = { yaw: home, pitch: 1, curlV: -2, curlH: 0, curlE: 1.4, reach: 0.55, wav: 0.3, wavS: 3 };
    tents.push({
      home, fan: (i - (NT - 1) / 2) / ((NT - 1) / 2), ph: i * 1.7, rnd: Math.sin(i * 12.9898) * 0.5 + 0.5,
      C: { ...P0 }, T: { ...P0 },
      J: Array.from({ length: NS + 1 }, () => new THREE.Vector3()),
      W: Array.from({ length: NS + 1 }, () => new THREE.Vector3()),
    });
  }
  const tipsW = tents.map((tn) => tn.W[NS]);
  const segsW = tents.map((tn) => tn.W);

  // scratch
  const _v = new THREE.Vector3(), _T = new THREE.Vector3(), _N = new THREE.Vector3(), _B = new THREE.Vector3(), _n = new THREE.Vector3();
  const cosK = Array.from({ length: RS }, (_, k) => Math.cos(k / RS * TAU));
  const sinK = Array.from({ length: RS }, (_, k) => Math.sin(k / RS * TAU));
  const bodyC = new THREE.Vector3();

  const fk = (tn: Tent) => {
    const c = tn.C, J = tn.J;
    const sl = c.reach * LEN / NS;
    let x = Math.sin(c.yaw) * RB, y = BASE_Y, z = Math.cos(c.yaw) * RB;
    J[0].set(x, y, z);
    for (let j = 0; j < NS; j++) {
      const s = (j + 0.5) / NS;
      const ce = Math.pow(s, c.curlE);
      const w = c.wav * (0.25 + s);
      const pitch = c.pitch + c.curlV * ce + w * Math.sin(TAU * 1.4 * s - tn.ph);
      const yaw = c.yaw + c.curlH * ce + w * 0.8 * Math.sin(TAU * 1.1 * s - tn.ph * 0.9 + 1.3);
      const cp = Math.cos(pitch);
      x += Math.sin(yaw) * cp * sl; y += Math.sin(pitch) * sl; z += Math.cos(yaw) * cp * sl;
      J[j + 1].set(x, y, z);
    }
  };
  const fabrik = (J: THREE.Vector3[], last: number, goal: THREE.Vector3, sl: number) => {
    const base = _n.copy(J[0]);
    if (base.distanceTo(goal) >= sl * last) {
      _v.subVectors(goal, base).normalize();
      for (let j = 1; j <= last; j++) J[j].copy(base).addScaledVector(_v, sl * j);
      return;
    }
    for (let it = 0; it < 4; it++) {
      J[last].copy(goal);
      for (let j = last - 1; j >= 0; j--) { _v.subVectors(J[j], J[j + 1]).normalize(); J[j].copy(J[j + 1]).addScaledVector(_v, sl); }
      J[0].copy(base);
      for (let j = 1; j <= last; j++) { _v.subVectors(J[j], J[j - 1]).normalize(); J[j].copy(J[j - 1]).addScaledVector(_v, sl); }
    }
  };
  const constrain = (J: THREE.Vector3[], bodyScale: number) => {
    for (let j = 1; j <= NS; j++) {
      const p = J[j], r = radAt(j / NS);
      _v.subVectors(p, bodyC);
      const d = _v.length(), min = RBODY * bodyScale + r * 0.9;
      if (d < min && d > 1e-4) p.addScaledVector(_v, (min - d) / d);
      if (p.y < r + 0.02) p.y = r + 0.02;
    }
  };
  const buildTube = (ti: number) => {
    const J = tents[ti].J;
    const base = ti * vPer;
    for (let r = 0; r <= NS + 2; r++) {
      const j = Math.min(r, NS);
      const a = J[Math.max(0, j - 1)], b = J[Math.min(NS, j + 1)];
      _T.subVectors(b, a);
      if (_T.lengthSq() < 1e-8) _T.set(0, 1, 0);
      _T.normalize();
      if (r === 0) {
        _N.set(0, 1, 0);
        if (Math.abs(_T.dot(_N)) > 0.9) _N.set(1, 0, 0);
      }
      if (r <= NS) { _N.addScaledVector(_T, -_T.dot(_N)).normalize(); _B.crossVectors(_T, _N); }
      let rad = radAt(j / NS), cx = J[j].x, cy = J[j].y, cz = J[j].z, nt = 0;
      if (r === NS + 1) { cx += _T.x * rad * 0.55; cy += _T.y * rad * 0.55; cz += _T.z * rad * 0.55; rad *= 0.8; nt = 0.6; }
      else if (r === NS + 2) { cx += _T.x * rad * 1.05; cy += _T.y * rad * 1.05; cz += _T.z * rad * 1.05; rad *= 0.08; nt = 1; }
      for (let k = 0; k < RS; k++) {
        const nx = cosK[k] * _N.x + sinK[k] * _B.x, ny = cosK[k] * _N.y + sinK[k] * _B.y, nz = cosK[k] * _N.z + sinK[k] * _B.z;
        const v = (base + r * RS + k) * 3;
        tPos[v] = cx + nx * rad; tPos[v + 1] = cy + ny * rad; tPos[v + 2] = cz + nz * rad;
        let mx = nx * (1 - nt) + _T.x * nt, my = ny * (1 - nt) + _T.y * nt, mz = nz * (1 - nt) + _T.z * nt;
        const ml = Math.hypot(mx, my, mz) || 1; mx /= ml; my /= ml; mz /= ml;
        tNrm[v] = mx; tNrm[v + 1] = my; tNrm[v + 2] = mz;
      }
    }
  };

  // ── state
  let t = Math.random() * 10, st = 0, last: SpagAnim['state'] | '' = '';
  const blinker = new Blinker();
  const B0 = { lean: 0, leanZ: 0, twist: 0, sq: 1, sink: 0, open: 0.2, lid: -0.55, slant: 0.3, brow: 0.35 };
  const Cb = { ...B0 }, Tb = { ...B0 };
  type BK = keyof typeof B0;
  const BKEYS = Object.keys(B0) as BK[];
  let first = true;
  const look = new THREE.Vector2();
  const prevFace = new THREE.Vector3(), faceVel = new THREE.Vector3(), faceW = new THREE.Vector3();
  let chomp = 0;
  const goal = new THREE.Vector3();
  const defTarget = new THREE.Vector3(0, 0.6, 4);

  function update(dt: number, a: SpagAnim) {
    dt = Math.min(dt, 0.1);
    t += dt;
    if (a.state !== last) { st = 0; last = a.state; } else st += dt;
    const ang = clamp(a.anger, 0, 1);
    const p = clamp(a.p, 0, 1);
    const S = a.state;

    // ---- body targets
    Object.assign(Tb, B0);
    Tb.open = 0.18 + 0.2 * ang + 0.04 * Math.sin(t * 2.1);
    Tb.slant = 0.25 + 0.35 * ang; Tb.brow = 0.3 + 0.35 * ang; Tb.lid = -0.6 + 0.25 * ang;
    Tb.sq = 1 + 0.035 * Math.sin(t * (2.2 + ang * 2));
    Tb.lean = 0.04 * Math.sin(t * 0.9); Tb.leanZ = 0.05 * Math.sin(t * 0.7);
    let lookYaw = 0.5 * Math.sin(t * 0.37) + 0.2 * Math.sin(t * 1.1), lookPitch = 0.1 * Math.sin(t * 0.53);
    let lam = 5, bodyLam = 8;
    let tremble = 0.004 * ang;
    let eyesMode: 'open' | 'squint' | 'x' = 'open';
    let tongueOut = 0;
    chomp = 0;

    // ---- tentacle targets
    for (const tn of tents) {
      const T = tn.T, i = tn.fan;
      T.wavS = 3 + 3.5 * ang; T.wav = 0.3 + 0.12 * ang; T.curlE = 1.4; T.curlH = 0.7 * Math.sin(t * 0.4 + tn.rnd * 9);
      T.yaw = tn.home + 0.22 * Math.sin(t * 0.5 + tn.rnd * 7);
      T.pitch = 1.2 + 0.15 * Math.sin(t * 0.7 + tn.rnd * 5);
      T.curlV = -1.75 - 0.55 * Math.sin(t * 0.6 + tn.rnd * 3);
      T.reach = 0.6 + 0.06 * Math.sin(t * 0.8 + tn.rnd * 4);
      void i;
    }

    if (S === 'lash') {
      const L = a.lashDir;
      if (p < 0.35) {
        const w = smooth(p / 0.35);
        for (const tn of tents) {
          const T = tn.T;
          T.yaw = L - 1.8 + tn.fan * 0.75;
          T.pitch = lerp(1.2, 1.0 + 0.15 * tn.rnd, w); T.curlV = lerp(-1.4, -5.6 - tn.rnd * 1.5, w); T.curlE = 2.6; T.curlH = tn.fan * 0.4;
          T.reach = lerp(0.65, 0.9, w); T.wav = 0.05; T.wavS = 18;
        }
        lam = 7;
        Tb.lean = -0.16 * w; Tb.twist = -0.5 * w; Tb.sq = 1 + 0.07 * w; Tb.open = 0.35 + 0.55 * w; Tb.brow = 0.75; Tb.slant = 0.75; Tb.lid = -0.3;
        tremble = 0.02 * w;
        lookYaw = 0; lookPitch = 0.05;
      } else if (p < 0.62) {
        const sp = (p - 0.35) / 0.27, e = easeInOut(sp);
        for (const tn of tents) {
          const T = tn.T;
          const si = clamp((sp - 0.1 * (1 - tn.fan) / 2) / 0.9, 0, 1);
          T.yaw = L + lerp(-1.9, 1.9, easeInOut(si)) + tn.fan * 0.42 + (tn.rnd - 0.5) * 0.12; T.pitch = -0.05 - 0.05 * tn.rnd; T.curlV = 0.12; T.curlE = 1.3;
          T.curlH = (-2.1 * Math.sin(Math.PI * si) + 0.5 * smooth((si - 0.75) / 0.25)) * (0.7 + 0.6 * tn.rnd);
          T.reach = 0.88 + 0.12 * tn.rnd; T.wav = 0.1; T.wavS = 9;
        }
        lam = 30;
        Tb.lean = 0.14; Tb.twist = lerp(-0.45, 0.45, e); Tb.sq = 0.94; Tb.open = 1; Tb.brow = 0.8; Tb.slant = 0.8; Tb.lid = -0.25;
        lookYaw = lerp(-0.6, 0.6, e) * 0.6; bodyLam = 18;
      } else {
        const rp = (p - 0.62) / 0.38;
        for (const tn of tents) {
          const T = tn.T;
          T.yaw = L + 1.2 + tn.fan * lerp(0.5, 1.45, smooth(rp * 2.5)) - 0.4 * rp;
          T.pitch = -0.1; T.curlV = 0.25; T.curlE = 1.3; T.curlH = (0.9 - 0.6 * rp) * (0.6 + tn.rnd * 0.5);
          T.reach = lerp(1, 0.86, rp); T.wav = 0.1 + 0.1 * rp; T.wavS = 4;
        }
        lam = 9;
        Tb.lean = 0.06; Tb.twist = 0.3 * (1 - rp); Tb.open = 0.5 - 0.3 * rp; Tb.brow = 0.6;
        lookYaw = 0.3;
      }
    } else if (S === 'grab') {
      const tg = a.target ?? _v.set(0, 0.6, 4);
      const ty = Math.atan2(tg.x, tg.z);
      const e = easeOut(seg(p, 0, 0.45));
      for (const tn of tents) {
        const T = tn.T;
        const grabber = Math.abs(tn.fan) < 0.4;
        if (grabber) {
          T.yaw = ty + tn.fan * 0.35; T.pitch = lerp(1.0, 0.35, e); T.curlV = lerp(-1.6, -0.6, e); T.curlH = 0;
          T.reach = lerp(0.6, 1, e); T.wav = 0.15 * (1 - e) + 0.04; T.wavS = 8;
        } else {
          T.yaw = ty + Math.sign(tn.fan) * (0.9 + Math.abs(tn.fan) * 0.7); T.pitch = 1.15; T.curlV = -2.6; T.reach = 0.7; T.wav = 0.4; T.wavS = 9;
        }
      }
      lam = 10;
      chomp = smooth(seg(p, 0.45, 0.6));
      Tb.lean = 0.12 * e; Tb.twist = clamp(wrapAngle(ty), -0.5, 0.5) * 0.5; Tb.brow = 0.8; Tb.slant = 0.7; Tb.lid = -0.3;
      Tb.open = 0.35 + 0.55 * Math.abs(Math.sin(t * 9)) * chomp + 0.3 * (1 - chomp) * e;
      lookYaw = clamp(wrapAngle(ty), -1, 1) * 0.6; lookPitch = -0.1;
    } else if (S === 'hurt') {
      const k = Math.exp(-st * 3);
      for (const tn of tents) {
        const T = tn.T;
        T.pitch = 1.35; T.curlV = -0.6 + Math.sin(t * 13 + tn.rnd * 9) * 0.8; T.reach = 0.55; T.wav = 0.55; T.wavS = 14;
      }
      lam = 12;
      Tb.lean = -0.3 * (0.5 + 0.5 * k); Tb.sq = 0.82 + 0.1 * (1 - k); Tb.open = 0.85; Tb.brow = 0.1; Tb.slant = -0.3; Tb.lid = -0.1;
      eyesMode = 'squint';
      bodyLam = 20;
    } else if (S === 'dead') {
      const k = smooth(st / 1.2);
      tents.forEach((tn, ti) => {
        const T = tn.T;
        T.yaw = (ti / NT) * TAU + 0.45; T.pitch = lerp(0.6, -0.5, k); T.curlV = 0.7; T.curlE = 1;
        T.curlH = 0.8 * Math.sin(ti * 2.3); T.reach = 0.82; T.wav = 0.12 * (1 - k); T.wavS = 2;
      });
      lam = 2.6;
      Tb.sink = 0.42 * k; Tb.sq = 0.78; Tb.leanZ = 0.28; Tb.lean = 0.1; Tb.open = 0.55; Tb.brow = -0.2; Tb.slant = -0.2; Tb.lid = 0.25;
      eyesMode = 'x'; tongueOut = 1; tremble = 0; bodyLam = 4;
    }

    // ---- damp params
    for (const tn of tents) {
      const C = tn.C, T = tn.T;
      if (first) Object.assign(C, T);
      else {
        C.yaw += wrapAngle(T.yaw - C.yaw) * (1 - Math.exp(-lam * dt));
        for (const k of PKEYS) C[k] = damp(C[k], T[k], lam, dt);
      }
      tn.ph += dt * C.wavS;
    }
    for (const k of BKEYS) Cb[k] = first ? Tb[k] : damp(Cb[k], Tb[k], bodyLam, dt);
    first = false;

    // ---- strike trail
    if (S === 'lash' && p > 0.35 && p < 0.7) {
      const sp = clamp((p - 0.35) / 0.27, 0, 1);
      let lead = -Infinity;
      for (const tn of tents) if (tn.fan > 0.99) lead = tn.C.yaw;
      trail.visible = true;
      trail.rotation.y = lead + 0.05;
      trailM.opacity = 0.38 * Math.sin(Math.PI * sp) * (1 - smooth((p - 0.62) / 0.08));
    } else trail.visible = false;

    // ---- body transform
    bodyPivot.position.set(Math.sin(t * 37) * tremble, 0.5 - Cb.sink, Math.cos(t * 31) * tremble);
    bodyPivot.rotation.set(Cb.lean, Cb.twist, Cb.leanZ);
    bodyPivot.scale.set(1 / Math.sqrt(Cb.sq), Cb.sq, 1 / Math.sqrt(Cb.sq));
    nest.scale.set(1 + 0.02 * Math.sin(t * 2.4), 1 + 0.04 * Math.sin(t * 2.4 + 1), 1 + 0.02 * Math.sin(t * 2.4));
    meatM.color.setRGB(1, 1 - 0.18 * ang, 1 - 0.22 * ang);
    root.updateMatrixWorld();
    body.getWorldPosition(bodyC); root.worldToLocal(bodyC);

    // ---- tentacles
    for (let ti = 0; ti < NT; ti++) {
      const tn = tents[ti];
      fk(tn);
      if (S === 'grab' && Math.abs(tn.fan) < 0.4) {
        const tg = a.target ?? defTarget;
        const e = easeOut(seg(p, 0, 0.45)), w = smooth(seg(p, 0.4, 0.75));
        const J = tn.J, sl = tn.C.reach * LEN / NS;
        const ncoil = 6, m = NS - ncoil;
        // approach side: from the base toward the target
        const ax = tg.x - J[0].x, az = tg.z - J[0].z, al = Math.hypot(ax, az) || 1;
        const a0 = Math.atan2(-ax / al, -az / al) + tn.fan * 1.2;
        const rho = 0.55;
        const cs0 = goal.set(tg.x + Math.sin(a0) * rho, tg.y - 0.25 + tn.fan * 0.3, tg.z + Math.cos(a0) * rho);
        const tipGoal = _B.copy(J[NS]).lerp(tg, e);
        const subGoal = _N.copy(J[m]).lerp(cs0, e);
        if (w < 0.01) fabrik(J, NS, tipGoal, sl);
        else {
          fabrik(J, m, subGoal.lerp(cs0, w), sl);
          for (let j = 1; j <= ncoil; j++) {
            const f = j / ncoil, aa = a0 + Math.sign(tn.fan || 1) * f * 1.7 * Math.PI;
            const cx = tg.x + Math.sin(aa) * rho, cy = tg.y - 0.25 + tn.fan * 0.3 + f * 0.45, cz = tg.z + Math.cos(aa) * rho;
            _v.subVectors(J[m], J[m - 1]).normalize();
            const sx = J[m].x + _v.x * sl * j, sy = J[m].y + _v.y * sl * j, sz = J[m].z + _v.z * sl * j;
            J[m + j].set(lerp(sx, cx, w), lerp(sy, cy, w), lerp(sz, cz, w));
          }
        }
      }
      constrain(tn.J, Cb.sq);
      buildTube(ti);
    }
    (tGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (tGeo.attributes.normal as THREE.BufferAttribute).needsUpdate = true;

    // ---- face
    const blink = eyesMode === 'open' ? blinker.update(dt) : 0;
    look.set(clamp(Math.sin(lookYaw) * 0.55, -0.5, 0.5), clamp(lookPitch * 1.5, -0.4, 0.4));
    face.getWorldPosition(faceW);
    if (prevFace.lengthSq() === 0) prevFace.copy(faceW);
    const fv = _v.subVectors(faceW, prevFace).divideScalar(Math.max(dt, 1e-3));
    const acc = _n.subVectors(fv, faceVel);
    faceVel.copy(fv); prevFace.copy(faceW);
    for (const e of eyes) {
      // googly spring: pulled toward the look target, kicked by body motion
      e.vel.x += ((look.x - e.off.x) * 90 - e.vel.x * 7) * dt - acc.x * 0.04;
      e.vel.y += ((look.y - 0.08 - e.off.y) * 90 - e.vel.y * 7) * dt - (acc.y * 0.04 + 0.6 * dt);
      e.off.addScaledVector(e.vel, dt);
      if (e.off.length() > 0.55) { e.off.setLength(0.55); e.vel.multiplyScalar(-0.4); }
      _v.set(e.off.x, e.off.y, 1).normalize();
      e.pupil.position.copy(_v).multiplyScalar(EYE_R * 0.93);
      e.pupil.quaternion.setFromUnitVectors(_T.set(0, 0, 1), _v);
      const psz = 0.2 * (1 - 0.25 * ang);
      e.pupil.scale.set(psz, psz, 0.09);
      vis(e.pupil, eyesMode === 'open');
      vis(e.xA, eyesMode !== 'open'); vis(e.xB, eyesMode !== 'open');
      if (eyesMode === 'x') {
        e.xA.position.set(0, 0, EYE_R * 0.98); e.xA.rotation.set(0, 0, Math.PI / 4);
        e.xB.position.set(0, 0, EYE_R * 0.98); e.xB.rotation.set(0, 0, -Math.PI / 4);
      } else if (eyesMode === 'squint') { // > <
        e.xA.position.set(-e.side * 0.02, 0.07, EYE_R * 0.98); e.xA.rotation.set(0, 0, Math.PI / 2 - e.side * 0.5);
        e.xB.position.set(-e.side * 0.02, -0.07, EYE_R * 0.98); e.xB.rotation.set(0, 0, Math.PI / 2 + e.side * 0.5);
      }
      const lidA = eyesMode === 'squint' ? 1.2 : eyesMode === 'x' ? Cb.lid : lerp(Cb.lid, 1.5, blink);
      e.lid.rotation.set(lidA, 0, e.side * Cb.slant * 0.6, 'ZXY');
      e.browG.position.copy(surfPt(e.side * 0.36, 0.6 - Cb.brow * 0.07, RBODY + 0.36));
      e.brow.rotation.set(0, 0, Math.PI / 2 + e.side * Cb.slant);
    }
    const open = clamp(Cb.open, 0, 1);
    shapeMouth(open);
    lowerJaw.position.y = yBot(0, open) - 0.01;
    const tb = yBot(0, open);
    tongue.visible = open > 0.25 || tongueOut > 0;
    tongue.position.set(0.05 * tongueOut, lerp(tb + 0.06, tb - 0.05, tongueOut), mz(0) + 0.015 + 0.06 * tongueOut);
    tongue.scale.set(0.28 + 0.02 * tongueOut, 0.05 + 0.05 * open + 0.1 * tongueOut, 0.06 + 0.06 * tongueOut);
    tongue.rotation.set(0.3 * tongueOut, 0, 0.15 * tongueOut);

    // ---- sauce drops
    for (const d of drops) {
      const k = ((t * d.sp + d.ph) % 1);
      const th = 1.05, phi = d.a;
      const sx = Math.sin(th) * Math.sin(phi) * RBODY * 1.02, sz = Math.sin(th) * Math.cos(phi) * RBODY * 1.02;
      const sy = bodyC.y + Math.cos(th) * RBODY;
      if (S === 'dead' && st > 2) { d.m.visible = false; continue; }
      d.m.visible = true;
      if (k < 0.45) { const g = k / 0.45; d.m.position.set(sx, sy - 0.05 - g * 0.12, sz); d.m.scale.set(0.06 + 0.05 * g, 0.08 + 0.08 * g, 0.06 + 0.05 * g); }
      else if (k < 0.75) { const f = (k - 0.45) / 0.3; const y = sy - 0.17 - f * f * (sy - 0.15); d.m.position.set(sx * (1 + f * 0.25), Math.max(0.06, y), sz * (1 + f * 0.25)); d.m.scale.set(0.1, 0.17, 0.1); }
      else { const f = (k - 0.75) / 0.25; d.m.position.set(sx * 1.25, 0.04, sz * 1.25); d.m.scale.set(0.12 + 0.15 * f, 0.03 * (1 - f) + 0.005, 0.12 + 0.15 * f); }
    }

    M.flash(a.flash);
  }

  const syncWorld = () => {
    root.updateWorldMatrix(true, false);
    const m = root.matrixWorld;
    for (const tn of tents) for (let j = 0; j <= NS; j++) tn.W[j].copy(tn.J[j]).applyMatrix4(m);
  };
  return {
    root,
    update,
    tips() { syncWorld(); return tipsW; },
    segments() { syncWorld(); return segsW; },
  };
}
