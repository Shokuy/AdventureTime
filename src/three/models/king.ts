import * as THREE from 'three';
import { PAL, basic, canvasTex, matU } from '../gfx';
import type { Rig } from './rig';
import {
  G, Mats, TAU, clamp, lerp, damp, smooth, grp, part, aim, merge, cached, taperedTube,
  openLathe, openLatheEdge, between, starGeo, Blinker, vis,
} from './kit';

export interface KingHandAnim {
  /** in the King root's LOCAL space; the hand's origin is the bottom-centre of the palm */
  pos: THREE.Vector3;
  pose: 'rest' | 'open' | 'flat' | 'fist' | 'grab';
  /** 0..1 pulsing yellow (vulnerable) */
  glow: number;
  /** 0..1 white hit flash */
  flash: number;
  /** rotation about Y (0 = fingers point +Z) */
  yaw?: number;
}
export interface KingAnim {
  eye: number; mouth: number; anger: number;
  look: { x: number; y: number };
  dizzy: number; chew: number; slump: number; stand: number; flash: number; talk: number;
  hands: [KingHandAnim, KingHandAnim];
  /** extra head turn about the neck (radians) — cartoon head-spin after a knockout punch */
  spin?: number;
}
export interface KingRig extends Rig<KingAnim> {
  leftHand: THREE.Group;
  rightHand: THREE.Group;
  head: THREE.Object3D;
  faceAnchor: THREE.Object3D;
  mouthAnchor: THREE.Object3D;
}

/** Suggested hand rest positions (root-local): resting on top of the belly. */
export const KING_HAND_REST: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(-4.6, 11.4, 8.4), new THREE.Vector3(4.6, 11.4, 8.4)];

// ───────────────────────── static geometry (built once) ─────────────────────────
const UPPER_PIVOT: [number, number, number] = [0, 6, -0.5];
/** full slump: torso and extra head pitch (radians) — puts the nose tip ≈1 unit above the floor */
const SLUMP_TORSO = 1.2;
const SLUMP_NECK = 0.36;

const LOWER_PROFILE: Array<[number, number]> = [
  [8.7, 0], [9.5, 0.45], [9.7, 1.4], [9.5, 3.2], [9.1, 5.2], [8.5, 7.2], [7.7, 9.2], [6.7, 10.7], [5.4, 11.8], [3.2, 12.5], [0.4, 12.8],
];
const lowerGap = (i: number) => lerp(0.5, 0.27, i / (LOWER_PROFILE.length - 1));
const LOWER_Z = 1.12;

const UPPER_PROFILE: Array<[number, number]> = [
  [3.6, 0.6], [6.0, 2.1], [7.4, 4.0], [7.75, 5.9], [7.3, 7.8], [6.2, 9.3], [4.9, 10.2], [2.8, 10.8], [0.4, 11.0],
];
const upperGap = (i: number) => lerp(0.3, 0.1, i / (UPPER_PROFILE.length - 1));

function robeColor(phi: number, i: number, rows: number, out: THREE.Color, strength: number) {
  const f = (1 - Math.sin(phi * 9 + 0.6)) / 2;
  const k = Math.pow(f, 1.5) * strength * (1 - (i / (rows - 1)) * 0.6);
  out.set(PAL.robe).lerp(new THREE.Color(PAL.robeD), clamp(k));
}

const lowerRobeGeo = () => cached('king-lower-robe', () => openLathe(LOWER_PROFILE, lowerGap, 72, {
  ripple: (phi, i) => 1 + 0.028 * (1 - i / (LOWER_PROFILE.length - 1)) * Math.sin(phi * 9 + 0.6),
  color: (phi, i, out) => robeColor(phi, i, LOWER_PROFILE.length, out, 1.0),
  zScale: LOWER_Z,
}));
const upperRobeGeo = () => cached('king-upper-robe', () => openLathe(UPPER_PROFILE, upperGap, 64, {
  ripple: (phi, i) => 1 + 0.012 * Math.sin(phi * 9 + 0.6) * (1 - i / UPPER_PROFILE.length),
  color: (phi, i, out) => robeColor(phi, i, UPPER_PROFILE.length, out, 0.55),
}));
function innerLathe(profile: Array<[number, number]>, k: number, zScale: number) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r * k, y)), 48);
  g.scale(1, 1, zScale);
  return g;
}
function trimGeo(profile: Array<[number, number]>, gap: (i: number) => number, zScale: number, hem: boolean) {
  const parts: Array<{ g: THREE.BufferGeometry }> = [];
  for (const side of [1, -1] as const) {
    const pts = openLatheEdge(profile, gap, side, 1.02, zScale);
    parts.push({ g: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.42, 8, false) });
  }
  if (hem) {
    const g0 = gap(0);
    const pts: THREE.Vector3[] = [];
    const n = 48;
    const [r, y] = profile[0];
    const r1 = profile[1][0];
    for (let j = 0; j <= n; j++) {
      const phi = g0 + (TAU - 2 * g0) * (j / n);
      const rr = lerp(r, r1, 0.35) * 1.03;
      pts.push(new THREE.Vector3(rr * Math.sin(phi), y + 0.2, rr * Math.cos(phi) * zScale));
    }
    parts.push({ g: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 0.5, 8, false) });
  }
  return merge(parts);
}

const collarGeo = () => cached('king-collar', () => {
  const parts: Array<{ g: THREE.BufferGeometry; p: [number, number, number]; s: [number, number, number] }> = [];
  const n = 15;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const r = 5.7 + (i % 2) * 0.25;
    parts.push({ g: G.sphere(), p: [Math.sin(a) * r, (i % 2) * 0.35, Math.cos(a) * r], s: [1.7, 1.4, 1.7] });
  }
  return merge(parts);
});
const collarMarksGeo = () => cached('king-collar-marks', () => {
  const parts: Array<{ g: THREE.BufferGeometry; p: [number, number, number]; s: [number, number, number]; r: [number, number, number] }> = [];
  const n = 15;
  for (let i = 0; i < n; i += 2) {
    const a = (i / n) * TAU + 0.12;
    const r = 5.7 + 1.62;
    parts.push({ g: G.capsule(0.22, 0.45), p: [Math.sin(a) * r, 0.1, Math.cos(a) * r], s: [1, 1, 0.6], r: [0, a, 0] });
  }
  return merge(parts);
});
const cuffGeo = () => cached('king-cuff', () => {
  const parts: Array<{ g: THREE.BufferGeometry; p: [number, number, number]; s: number }> = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    parts.push({ g: G.sphere(), p: [Math.cos(a) * 2.35, 0, Math.sin(a) * 2.35], s: 1.0 });
  }
  return merge(parts);
});
const crownGeo = () => cached('king-crown', () => {
  const parts: Array<{ g: THREE.BufferGeometry; p?: [number, number, number]; s?: [number, number, number] | number; r?: [number, number, number] }> = [];
  parts.push({ g: G.cyl(), p: [0, 0.35, 0], s: [1.3, 0.7, 1.3] });
  parts.push({ g: G.torus(1.3, 0.16, 8, 32), p: [0, 0.02, 0], r: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    parts.push({ g: G.cone(), p: [Math.sin(a) * 1.12, 1.1, Math.cos(a) * 1.12], s: [0.36, 0.95, 0.36] });
    parts.push({ g: G.ball(), p: [Math.sin(a) * 1.12, 1.65, Math.cos(a) * 1.12], s: 0.2 });
  }
  return merge(parts);
});
const stacheGeo = (side: 1 | -1) => cached(`king-stache-${side}`, () => {
  const P = (x: number, y: number, z: number) => new THREE.Vector3(x * side, y, z);
  const curve = new THREE.CatmullRomCurve3([
    P(0.25, -1.85, 6.4), P(1.7, -2.3, 6.1), P(3.3, -2.4, 5.35), P(4.75, -1.8, 4.4),
    P(5.75, -0.65, 3.7), P(6.05, 0.55, 3.4), P(5.55, 1.25, 3.5), P(4.95, 0.95, 3.85),
  ], false, 'centripetal');
  return taperedTube(curve, 64, 12, (t) => 0.2 + 1.05 * Math.pow(1 - t, 1.15) * (t < 0.06 ? 0.85 + t * 2.5 : 1));
});

function spiralTex() {
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1b1214';
    // stripes slanted in (u, v) become a spiral on a spherical cap
    for (let k = -3; k < 6; k++) {
      g.beginPath();
      g.moveTo(k * w / 2, h); g.lineTo(k * w / 2 + w / 4, h); g.lineTo(k * w / 2 + w / 4 + w, 0); g.lineTo(k * w / 2 + w, 0);
      g.closePath(); g.fill();
    }
  }, { wrap: true });
}
function veinTex() {
  return canvasTex(256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#d0203a'; g.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      let x = (i / 14) * w + 6, y = 0;
      g.lineWidth = 3.2;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += Math.sin(i * 7 + k * 3) * 9; y += h * 0.13; g.lineTo(x, y); g.lineWidth = 2; }
      g.stroke();
    }
  }, { wrap: true });
}

// ───────────────────────── hand ─────────────────────────
interface Hand {
  g: THREE.Group; lift: THREE.Group; palm: THREE.Mesh; mat: THREE.MeshToonMaterial;
  fingers: { k: THREE.Group; m: THREE.Group; x: number }[];
  thumb: { k: THREE.Group; m: THREE.Group };
  cur: { k1: number; k2: number; spread: number; th: number; flat: number; lift: number };
  wrist: THREE.Vector3;
}
const POSES: Record<KingHandAnim['pose'], Hand['cur']> = {
  rest: { k1: 0.35, k2: 0.4, spread: 0.06, th: 0.25, flat: 1, lift: 0 },
  open: { k1: -0.18, k2: -0.05, spread: 0.24, th: -0.25, flat: 1, lift: 0.3 },
  flat: { k1: 0.02, k2: 0.0, spread: 0.13, th: 0.0, flat: 0.82, lift: 0 },
  fist: { k1: 1.5, k2: 1.75, spread: 0.0, th: 1.1, flat: 1, lift: 1.38 },
  grab: { k1: 0.8, k2: 1.0, spread: 0.16, th: 0.85, flat: 1, lift: 0.6 },
};

function makeHand(side: 1 | -1): Hand {
  const g = new THREE.Group();
  g.name = side < 0 ? 'kingLeftHand' : 'kingRightHand';
  const m = matU(PAL.kingSkin); // own material: glow + flash are driven per hand
  const lift = grp(g);
  const palm = part(lift, G.sphere(), m, [0, 1.25, -0.25], [2.75, 1.25, 2.6]);
  const fingers: Hand['fingers'] = [];
  const xs = [-1.9, -0.64, 0.64, 1.9];
  const lens = [1.05, 1.2, 1.15, 0.95];
  xs.forEach((x, i) => {
    const k = grp(lift, [x, 1.0, 1.75]);
    k.rotation.order = 'YXZ';
    const L = lens[i];
    part(k, G.capsule(0.72, 1.25 * L), m, [0, 0, 0.85 * L], 1, [Math.PI / 2, 0, 0]);
    const mm = grp(k, [0, 0, 1.65 * L]);
    part(mm, G.capsule(0.68, 1.0 * L), m, [0, 0, 0.7 * L], 1, [Math.PI / 2, 0, 0]);
    fingers.push({ k, m: mm, x });
  });
  const ts = -side; // thumb toward the body centre
  const tk = grp(lift, [ts * 2.3, 1.05, -0.3]);
  tk.rotation.order = 'YXZ';
  part(tk, G.capsule(0.78, 1.2), m, [0, 0, 0.8], 1, [Math.PI / 2, 0, 0]);
  const tm = grp(tk, [0, 0, 1.55]);
  part(tm, G.capsule(0.72, 0.85), m, [0, 0, 0.6], 1, [Math.PI / 2, 0, 0]);
  return { g, lift, palm, mat: m, fingers, thumb: { k: tk, m: tm }, cur: { ...POSES.rest }, wrist: new THREE.Vector3() };
}

export function createKing(): KingRig {
  const M = new Mats();
  const black = basic('#1b1214');
  const white = basic('#ffffff');
  const robeM = M.own('#ffffff');
  robeM.vertexColors = true;
  robeM.side = THREE.DoubleSide;
  const skinBody = M.get(PAL.kingSkin);
  const skinHead = M.own(PAL.kingSkin);
  const noseM = M.own('#d49be2');
  const gold = M.get(PAL.gold);
  const robeSolid = M.get(PAL.robe);
  const ermine = M.get(PAL.ermine);
  const fo = { cast: false };

  const root = new THREE.Group();
  root.name = 'king';
  const bodyG = grp(root, undefined, undefined, 'kingBody');

  // ── lower body (fixed): robe skirt, belly, inner skin ──
  const lower = grp(bodyG);
  part(lower, lowerRobeGeo(), robeM);
  const skinInner = M.get('#9f7cc4');
  part(lower, cached('king-lower-inner', () => innerLathe(LOWER_PROFILE, 0.95, LOWER_Z)), skinInner);
  part(lower, cached('king-lower-trim', () => trimGeo(LOWER_PROFILE, lowerGap, LOWER_Z, true)), gold);
  const belly = part(lower, G.sphere(), skinBody, [0, 7.6, 4.3], 5.4);
  part(lower, G.sphere(), M.get(PAL.kingSkinD), [0, 7.0, 9.62], [0.55, 0.38, 0.2], undefined, fo);
  part(lower, G.arc(0.5, 0.13, Math.PI), M.get(PAL.kingSkinD), [0, 7.12, 9.62], [1, 0.7, 0.5], [0, 0, Math.PI], fo);

  // feet (slippers) live in root space so they stay on the floor when he stands
  const feet: THREE.Group[] = [];
  const legs: THREE.Mesh[] = [];
  const slipper = M.get(PAL.robeD);
  for (const s of [1, -1]) {
    const f = grp(root, [s * 3.9, 0, 10.4]);
    part(f, G.sphere(), slipper, [0, 1.15, 0.2], [1.85, 1.2, 2.8]);
    part(f, G.sphere(), gold, [0, 1.75, 2.85], 0.48);
    part(f, G.torus(1.55, 0.3, 8, 24), gold, [0, 1.25, -1.2], [1, 1, 1], [Math.PI / 2 - 0.25, 0, 0]);
    feet.push(f);
    legs.push(part(root, G.cyl(), skinBody));
  }

  // ── upper body (slumps forward about UPPER_PIVOT) ──
  const upper = grp(bodyG, UPPER_PIVOT, undefined, 'kingUpper');
  part(upper, upperRobeGeo(), robeM);
  part(upper, cached('king-upper-inner', () => innerLathe(UPPER_PROFILE, 0.95, 1)), skinInner);
  part(upper, cached('king-upper-trim', () => trimGeo(UPPER_PROFILE, upperGap, 1, false)), gold);
  const collarG = grp(upper, [0, 8.15, 0.3]);
  part(collarG, collarGeo(), ermine);
  part(collarG, collarMarksGeo(), black, undefined, undefined, undefined, fo);
  const shoulders: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    part(upper, G.sphere(), robeSolid, [s * 7.0, 7.5, -0.3], [2.7, 2.5, 2.6]);
    const anchor = new THREE.Object3D();
    anchor.position.set(s * 7.4, 7.2, -0.3);
    upper.add(anchor);
    shoulders.push(anchor);
  }

  // ── head ──
  const neck = grp(upper, [0, 9.9, 0.6], undefined, 'kingNeck');
  const head = grp(neck, [0, 5.3, 0.1], undefined, 'kingHead');
  const HR = 6;
  part(head, G.sphere(), skinHead, undefined, [HR * 1.07, HR * 0.97, HR]);
  for (const s of [1, -1]) part(head, G.sphere(), skinHead, [s * 6.25, -0.4, -0.6], [0.95, 1.6, 1.2]);
  // eyes
  const sTex = spiralTex();
  const vTex = veinTex();
  const capGeo = cached('king-eye-cap', () => new THREE.SphereGeometry(1, 32, 12, 0, TAU, 0, 1.25));
  interface KEye { lid: THREE.Group; pupil: THREE.Group; spiral: THREE.Mesh; veins: THREE.Mesh; veinM: THREE.MeshBasicMaterial; pupilMesh: THREE.Mesh; glint: THREE.Mesh }
  const eyes: KEye[] = [];
  const ER = 1.75;
  const lidM = M.own(PAL.kingSkin, { side: THREE.DoubleSide });
  for (const s of [1, -1]) {
    const pivot = grp(head);
    aim(pivot, s * 0.39, 0.27);
    const eg = grp(pivot, [0, 0, 4.95]);
    part(eg, G.sphere(), M.get('#fbf7f0'), undefined, ER);
    const veinM = basic('#ffffff', { transparent: true, map: vTex, opacity: 0, depthWrite: false });
    const veins = part(eg, capGeo, veinM, undefined, ER * 1.005, [Math.PI / 2, 0, 0], { cast: false, receive: false });
    const pupil = grp(eg);
    pupil.rotation.order = 'YXZ';
    const pupilMesh = part(pupil, G.ball(), black, [0, 0, ER * 0.93], [0.68, 0.68, 0.3], undefined, fo);
    const glint = part(pupil, G.ball(), white, [0.26, 0.3, ER * 1.03], 0.2, undefined, fo);
    const spiral = part(eg, capGeo, basic('#ffffff', { map: sTex }), undefined, ER * 1.012, [Math.PI / 2, 0, 0], fo);
    spiral.visible = false;
    const lid = grp(eg);
    part(lid, G.dome(), lidM, undefined, ER * 1.1);
    part(lid, G.torus(ER * 1.1, 0.16, 8, 32), M.get(PAL.kingSkinD), undefined, 1, [Math.PI / 2, 0, 0], fo);
    const lowLid = grp(eg, undefined, [Math.PI + 0.95, 0, 0]);
    part(lowLid, G.dome(), lidM, undefined, ER * 1.06);
    eyes.push({ lid, pupil, spiral, veins, veinM, pupilMesh, glint });
  }
  // brows
  const brows: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const pivot = grp(head);
    aim(pivot, s * 0.38, 0.68);
    const bg = grp(pivot, [0, 0, HR * 0.98]);
    part(bg, G.capsule(0.62, 2.7), M.get(PAL.stacheD), undefined, 1, [0, 0, Math.PI / 2]);
    brows.push(bg);
  }
  // nose, nostrils, cheeks
  part(head, G.sphere(), noseM, [0, -0.45, 5.85], [2.15, 1.9, 1.95]);
  for (const s of [1, -1]) part(head, G.ball(), M.get('#6a3570'), [s * 0.72, -1.75, 6.75], [0.42, 0.2, 0.32], undefined, fo);
  const faceAnchor = new THREE.Object3D();
  faceAnchor.name = 'kingFaceAnchor';
  faceAnchor.position.set(0, -0.45, 7.8);
  head.add(faceAnchor);
  const cheekM = M.own('#f28fc0');
  const cheeks: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    const pv = grp(head);
    aim(pv, s * 0.74, -0.12);
    cheeks.push(part(pv, G.sphere(), cheekM, [0, 0, HR * 1.0], [1.5, 0.95, 0.32], undefined, fo));
  }
  // mustache
  const stacheM = M.get(PAL.stache);
  part(head, stacheGeo(1), stacheM);
  part(head, stacheGeo(-1), stacheM);
  part(head, G.sphere(), stacheM, [0, -1.95, 6.25], [1.4, 0.95, 0.95]);
  // mouth
  const mouthG = grp(head, [0, -3.35, 5.15]);
  const mouthIn = part(mouthG, G.sphere(), basic('#4a0f22'), undefined, [2.6, 0.2, 0.95], undefined, fo);
  const teeth = part(mouthG, G.capsule(0.45, 3.0), white, [0, -0.2, 0.62], [1, 1, 0.7], [0, 0, Math.PI / 2], fo);
  const tongue = part(mouthG, G.sphere(), M.get('#ff7aa0'), [0, -0.4, 0.3], [1.55, 0.55, 0.9], undefined, fo);
  const chin = part(head, G.sphere(), skinHead, [0, -4.3, 4.45], [2.7, 1.05, 1.2]);
  const mouthAnchor = new THREE.Object3D();
  mouthAnchor.name = 'kingMouthAnchor';
  mouthAnchor.position.set(0, -3.6, 7.5);
  head.add(mouthAnchor);
  // crown
  const crown = grp(head, [0.5, 5.55, -0.4], [-0.12, 0, -0.16]);
  part(crown, crownGeo(), gold);
  part(crown, G.sphere(), M.get('#e0203a'), [0, 0.4, 1.3], [0.42, 0.42, 0.25]);
  // dizzy stars
  const stars = grp(head, [0, 7.4, 0]);
  const starList: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const m = part(stars, starGeo(), M.get('#ffd84a'), undefined, 1.25, undefined, fo);
    starList.push(m);
  }
  stars.visible = false;

  // ── arms (root space; rebuilt from transforms each frame, no geometry changes) ──
  const sleeveM = robeSolid;
  const bellGeo = cached('king-bell', () => new THREE.CylinderGeometry(1, 0.72, 1, 20, 1, true));
  interface Arm { up: THREE.Mesh; elbow: THREE.Mesh; fore: THREE.Mesh; cuff: THREE.Group }
  const arms: Arm[] = [];
  for (let i = 0; i < 2; i++) {
    const up = part(root, G.cyl(), sleeveM);
    const elbow = part(root, G.sphere(), sleeveM, undefined, 2.15);
    const fore = part(root, bellGeo, M.get(PAL.robe, { side: THREE.DoubleSide }));
    const cuff = grp(root);
    part(cuff, cuffGeo(), ermine);
    arms.push({ up, elbow, fore, cuff });
  }
  const hands = [makeHand(-1), makeHand(1)];
  root.add(hands[0].g, hands[1].g);
  const L1 = 8.6, L2 = 8.6;

  // ── anim state ──
  const blinker = new Blinker();
  const C = { eye: 0.5, mouth: 0, anger: 0, lx: 0, ly: 0, dizzy: 0, slump: 0, stand: 0, talk: 0, chew: 0 };
  let t = 0;
  const vS = new THREE.Vector3(), vW = new THREE.Vector3(), vD = new THREE.Vector3(), vE = new THREE.Vector3(), vH = new THREE.Vector3(), vP = new THREE.Vector3();
  const qTmp = new THREE.Quaternion();
  const inv = new THREE.Matrix4();
  const baseHead = new THREE.Color(PAL.kingSkin);
  const angryHead = new THREE.Color('#f2869e');
  const baseNose = new THREE.Color('#d49be2');
  const angryNose = new THREE.Color('#f0587a');
  const glowCol = new THREE.Color('#ffd000');
  const baseCheek = new THREE.Color('#f28fc0');
  const angryCheek = new THREE.Color('#ff4a6a');
  const handBase = new THREE.Color(PAL.kingSkin);
  const up = new THREE.Vector3(0, 1, 0);
  const hipL = new THREE.Vector3(), ankle = new THREE.Vector3();

  function update(dt: number, a: KingAnim) {
    dt = Math.min(dt, 0.1);
    t += dt;
    C.eye = damp(C.eye, clamp(a.eye), 10, dt);
    C.mouth = damp(C.mouth, clamp(a.mouth), 14, dt);
    C.anger = damp(C.anger, clamp(a.anger), 6, dt);
    C.lx = damp(C.lx, clamp(a.look.x, -1, 1), 8, dt);
    C.ly = damp(C.ly, clamp(a.look.y, -1, 1), 8, dt);
    C.dizzy = damp(C.dizzy, clamp(a.dizzy), 6, dt);
    C.slump = damp(C.slump, clamp(a.slump), 4, dt);
    C.stand = damp(C.stand, clamp(a.stand), 3, dt);
    C.talk = damp(C.talk, clamp(a.talk), 12, dt);
    C.chew = damp(C.chew, clamp(a.chew), 6, dt);

    const breathe = Math.sin(t * 1.3);
    const sk = smooth(C.stand);
    bodyG.position.y = 8 * sk;
    upper.rotation.x = SLUMP_TORSO * C.slump + 0.012 * breathe - 0.04 * sk;
    upper.scale.set(1 + 0.006 * breathe, 1 + 0.008 * breathe, 1 + 0.006 * breathe);
    belly.scale.set(5.4, 5.4 * (1 + 0.008 * breathe), 5.4 * (1 + 0.012 * breathe));
    const wob = C.dizzy * Math.sin(t * 3.2) * 0.09;
    neck.rotation.set(SLUMP_NECK * C.slump - 0.06 * C.anger + Math.sin(t * 7.5) * 0.02 * C.talk, wob * 0.5 + (a.spin ?? 0), wob);

    // feet & legs (only visible when standing up)
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const f = feet[i];
      f.position.set(s * lerp(3.9, 3.6, sk), 0, lerp(10.4, 3.4, sk));
      hipL.set(s * 3.6, 4.5 + 8 * sk, 2.6);
      ankle.set(f.position.x, 1.6, f.position.z - 0.6);
      between(legs[i], hipL, ankle, 1.45);
      legs[i].visible = sk > 0.02;
    }

    // ── face ──
    const k = 1 - Math.min(1, C.dizzy * 2);
    const bl = C.dizzy > 0.3 ? 0 : blinker.update(dt);
    const e = clamp(C.eye * (1 - bl));
    const lidA = e < 0.5 ? lerp(1.6, 0.05, e / 0.5) : lerp(0.05, -1.0, (e - 0.5) / 0.5);
    const dz = C.dizzy > 0.3;
    for (let i = 0; i < 2; i++) {
      const ey = eyes[i];
      ey.lid.rotation.x = dz ? lerp(lidA, -0.6, 0.8) : lidA;
      ey.pupil.rotation.set(-C.ly * 0.38 * k, C.lx * 0.45 * k, 0);
      vis(ey.pupilMesh, !dz); vis(ey.glint, !dz); vis(ey.spiral, dz);
      if (dz) ey.spiral.rotation.y = (i ? 1 : -1) * t * 5;
      ey.veinM.opacity = clamp(C.anger * 1.2 - 0.2);
      vis(ey.veins, C.anger > 0.18);
    }
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const br = brows[i];
      // inner end down with anger, raised when eyes are wide, droopy outer ends when sleepy
      br.rotation.z = s * (0.55 * C.anger - 0.18 * (1 - C.anger));
      br.position.y = -0.55 * C.anger + 0.9 * Math.max(0, C.eye - 0.55) - 0.25 * (1 - C.eye);
    }
    skinHead.color.copy(baseHead).lerp(angryHead, C.anger * 0.75);
    lidM.color.copy(skinHead.color);
    noseM.color.copy(baseNose).lerp(angryNose, C.anger * 0.8);
    cheekM.color.copy(baseCheek).lerp(angryCheek, C.anger * 0.6);
    const chewOpen = C.chew * (0.1 + 0.12 * Math.sin(t * 6.5));
    const talkOpen = C.talk * (0.35 + 0.35 * Math.sin(t * 14));
    const op = clamp(C.mouth + talkOpen + chewOpen);
    mouthIn.scale.set(2.6 + 0.4 * op, 0.18 + 1.75 * op, 0.95);
    mouthIn.position.y = -0.85 * op;
    vis(teeth, op > 0.08);
    vis(tongue, op > 0.2);
    tongue.position.y = -0.3 - 1.4 * op;
    chin.position.set(Math.sin(t * 6.5) * 0.25 * C.chew, -4.3 - 1.55 * op, 4.45);
    for (const c of cheeks) c.scale.set(1.5 * (1 + 0.12 * C.chew * (0.5 + 0.5 * Math.sin(t * 6.5))), 0.95, 0.32 + 0.25 * C.chew);
    vis(stars, C.dizzy > 0.3);
    if (stars.visible) {
      stars.rotation.y = t * 2.6;
      for (let i = 0; i < starList.length; i++) {
        const a = (i / starList.length) * TAU;
        starList[i].position.set(Math.sin(a) * 5.8, Math.sin(t * 4 + i * 2) * 0.6, Math.cos(a) * 5.8);
        starList[i].rotation.set(0, -a + t * 2, Math.sin(t * 5 + i) * 0.5);
        starList[i].scale.setScalar(2.3 * smooth((C.dizzy - 0.3) / 0.3));
      }
    }

    // ── hands & arms ──
    root.updateMatrixWorld(true);
    inv.copy(root.matrixWorld).invert();
    for (let i = 0; i < 2; i++) {
      const h = hands[i];
      const ha = a.hands[i];
      const tgt = POSES[ha.pose] ?? POSES.rest;
      const lam = 18;
      const c = h.cur;
      c.k1 = damp(c.k1, tgt.k1, lam, dt); c.k2 = damp(c.k2, tgt.k2, lam, dt);
      c.spread = damp(c.spread, tgt.spread, lam, dt); c.th = damp(c.th, tgt.th, lam, dt);
      c.flat = damp(c.flat, tgt.flat, 30, dt); c.lift = damp(c.lift, tgt.lift, lam, dt);
      h.g.position.copy(ha.pos);
      h.g.rotation.set(0, ha.yaw ?? 0, 0);
      h.lift.position.y = c.lift;
      h.palm.scale.set(2.75, 1.25 * c.flat, 2.6);
      h.palm.position.y = 1.25 * c.flat;
      for (const f of h.fingers) {
        f.k.rotation.set(c.k1, (f.x / 1.9) * c.spread, 0);
        f.k.position.y = 1.0 * c.flat;
        f.m.rotation.x = c.k2;
      }
      const ts = i === 0 ? 1 : -1;
      h.thumb.k.rotation.set(0.2 + c.th * 0.6, ts * (0.95 - c.th * 0.5), ts * c.th * 0.4);
      h.thumb.m.rotation.x = c.th * 0.9;
      // glow / flash
      const g = clamp(ha.glow) * (0.55 + 0.45 * Math.sin(t * 9));
      const fl = Math.max(clamp(ha.flash), clamp(a.flash));
      h.mat.color.copy(handBase).lerp(glowCol, g * 0.7);
      h.mat.emissive.copy(glowCol).multiplyScalar(g * 0.3).addScalar(fl * 0.85);

      // wrist (back of the palm) in root space
      h.g.updateMatrix();
      h.wrist.set(0, 1.35 + c.lift, -2.55).applyMatrix4(h.g.matrix);
      shoulders[i].getWorldPosition(vS).applyMatrix4(inv);
      vW.copy(h.wrist);
      // 2-bone IK with outward/down/back elbow hint
      vD.subVectors(vW, vS);
      let d = vD.length();
      const reach = L1 + L2;
      const side = i === 0 ? -1 : 1;
      let s1 = L1, s2 = L2;
      if (d < 1e-3) { vD.set(0, -1, 0); d = 1e-3; }
      vD.divideScalar(d);
      if (d >= reach * 0.995) {
        const st = d / reach;
        s1 = L1 * st; s2 = L2 * st;
        vE.copy(vS).addScaledVector(vD, s1);
      } else {
        const dd = Math.max(d, Math.abs(L1 - L2) + 0.5);
        const along = (L1 * L1 - L2 * L2 + dd * dd) / (2 * dd);
        const hgt = Math.sqrt(Math.max(0, L1 * L1 - along * along));
        vH.set(side * 1.0, -0.7, -0.6);
        vH.addScaledVector(vD, -vH.dot(vD));
        if (vH.lengthSq() < 1e-6) vH.set(0, -1, 0).addScaledVector(vD, -vD.y);
        vH.normalize();
        vE.copy(vS).addScaledVector(vD, along).addScaledVector(vH, hgt);
      }
      const arm = arms[i];
      between(arm.up, vS, vE, 2.15);
      arm.elbow.position.copy(vE);
      between(arm.fore, vE, vW, 2.6);
      // cuff ring perpendicular to the forearm, at the wrist
      vP.subVectors(vW, vE).normalize();
      qTmp.setFromUnitVectors(up, vP);
      arm.cuff.position.copy(vW).addScaledVector(vP, -0.2);
      arm.cuff.quaternion.copy(qTmp);
      void s2;
    }

    M.flash(a.flash);
    // keep anger tint visible over flash: flash only adds emissive, colours above are untouched
  }

  return { root, update, leftHand: hands[0].g, rightHand: hands[1].g, head, faceAnchor, mouthAnchor };
}
