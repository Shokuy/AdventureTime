import * as THREE from 'three';
import { canvasTex } from '../gfx';
import {
  G, Mats, TAU, clamp, lerp, damp, smooth, seg, easeOut, easeIn, easeInOut,
  grp, part, surf, vis, cached, merge, taperedTube,
} from './kit';
import { bones, animator, stateExpr, Dangle, type HumanoidSpec, type Pose, type AtkOut } from './humanoid';
import { buildFace } from './face';
import type { HeroAnim, HeroAtk, HeroRig } from './hero';
import { cleanLook, DEFAULT_LOOKS, type HeroLook } from '../../net/profile';

/*
 * Ноки — the half-vampire rocker girl: pale-lilac skin, a dark asymmetric bob with a coloured streak, pointy ears,
 * crimson eyes with eyeliner and one fang, a short jacket over a band tee, a pleated skirt, striped tights, big
 * buckled boots, and the axe-guitar (a labrys-shaped body on a guitar neck) on her back — in her hand when she
 * fights, across her chest when she plays. Dash = bat form (fx.bat), glide = little bat wings (fx.glide).
 * Look slots: hat = hair streak, scarf = choker & laces, shirt = jacket, shorts = skirt, boot = boots, back = the guitar.
 */

const SPEC: HumanoidSpec = { CY: 0.5, hipY: 0.42, hipX: 0.068, thigh: 0.19, shin: 0.17, shoulderY: 0.705, shoulderX: 0.135, arm: 0.2, headY: 0.975 };
const R = 0.235;
const SKIN = '#dccbf2', SKIN_D = '#c3addf', HAIR = '#2a2236', HAIR_L = '#3d3150';
const SILVER = '#d4dbe6';

const stripeTex = () => canvasTex(8, 64, (g, w, h) => {
  g.fillStyle = '#2a2232'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#7a5aa0';
  for (let i = 0; i < 8; i++) g.fillRect(0, i * 8, w, 3.2);
}, { wrap: true });
let stripes: THREE.Texture | null = null;

const skirtGeo = () => cached('noki-skirt', () => {
  const g = new THREE.CylinderGeometry(0.118, 0.205, 0.17, 36, 2, true);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(x, z);
    const k = (0.085 - y) / 0.17; // 0 top → 1 hem
    const r = 1 + 0.07 * k * Math.cos(a * 14);
    p.setXYZ(i, x * r, y, z * r);
  }
  g.computeVertexNormals();
  return g;
});

/** the axe-guitar: grip at the origin, neck along +Z, the labrys body at the far end (blades along ±Y, faces ±X) */
function axeGuitar(M: Mats, bodyM: THREE.Material) {
  const g = new THREE.Group();
  g.name = 'axeGuitar';
  const wood = M.get('#3a2418'), ebony = M.get('#18121c'), steel = M.get(SILVER), chrome = M.get('#f2f4f8');
  // neck + fretboard + frets
  part(g, G.cyl(), wood, [0, 0, 0.24], [0.026, 0.66, 0.02], [Math.PI / 2, 0, 0]);
  part(g, cached('noki-fretboard', () => merge([
    { g: G.cyl(), p: [0, 0.018, 0.28], s: [0.022, 0.5, 0.008], r: [Math.PI / 2, 0, 0] },
  ])), ebony);
  part(g, cached('noki-frets', () => merge(Array.from({ length: 9 }, (_, i) => ({
    g: G.cyl(), p: [0, 0.023, 0.07 + i * 0.05] as [number, number, number], s: [0.0045, 0.05, 0.0045] as [number, number, number], r: [0, 0, Math.PI / 2] as [number, number, number],
  })))), chrome);
  // headstock (the pommel): a pointy bat-wing shape with tuning pegs
  part(g, cached('noki-head', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.03, 0); s.lineTo(0.03, 0); s.lineTo(0.06, -0.09); s.lineTo(0.02, -0.07); s.lineTo(0, -0.12); s.lineTo(-0.02, -0.07); s.lineTo(-0.06, -0.09); s.closePath();
    const e = new THREE.ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 });
    e.translate(0, 0, -0.011); e.rotateX(Math.PI / 2); e.rotateZ(Math.PI / 2); e.translate(0, 0, -0.08);
    return e;
  }), bodyM);
  part(g, cached('noki-pegs', () => merge([-1, 1].flatMap((s) => [0, 1].map((i) => ({
    g: G.ball(), p: [s * 0.035, 0.0, -0.1 - i * 0.03] as [number, number, number], s: [0.016, 0.012, 0.012] as [number, number, number],
  }))))), chrome);
  // the body: a double axe-head (labrys), faces toward ±X
  const bladeGeo = cached('noki-labrys', () => {
    const s = new THREE.Shape();
    // y = along the blades, x = along the neck (later → Z)
    s.moveTo(-0.07, 0.04);
    s.quadraticCurveTo(-0.02, 0.12, -0.11, 0.22);
    s.quadraticCurveTo(0.05, 0.28, 0.21, 0.22);
    s.quadraticCurveTo(0.12, 0.12, 0.17, 0.04);
    s.lineTo(0.17, -0.04);
    s.quadraticCurveTo(0.12, -0.12, 0.21, -0.22);
    s.quadraticCurveTo(0.05, -0.28, -0.11, -0.22);
    s.quadraticCurveTo(-0.02, -0.12, -0.07, -0.04);
    s.closePath();
    const e = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.014, bevelSegments: 3, curveSegments: 14 });
    e.translate(0, 0, -0.025);
    // shape x → +Z (along the neck), shape y → +Y, depth → X
    e.rotateY(-Math.PI / 2);
    e.translate(0, 0, 0.6);
    return e;
  });
  part(g, bladeGeo, bodyM);
  // steel edges on both blades
  const edge = cached('noki-edge', () => {
    const arc = (sy: number) => {
      const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, sy * 0.22, 0.49), new THREE.Vector3(0, sy * 0.3, 0.65), new THREE.Vector3(0, sy * 0.22, 0.81));
      return taperedTube(c, 20, 8, (t) => 0.014 + 0.012 * Math.sin(t * Math.PI));
    };
    return merge([{ g: arc(1) }, { g: arc(-1) }]);
  });
  part(g, edge, steel);
  // pickups, bridge, a little bat inlay, strings
  part(g, cached('noki-pickups', () => merge([
    { g: G.capsule(0.012, 0.06), p: [0.04, 0, 0.56], r: [0, 0, 0] },
    { g: G.capsule(0.012, 0.06), p: [-0.04, 0, 0.56] },
    { g: G.capsule(0.012, 0.06), p: [0.04, 0, 0.66] },
    { g: G.capsule(0.012, 0.06), p: [-0.04, 0, 0.66] },
  ])), ebony);
  part(g, G.capsule(0.01, 0.05), chrome, [0.042, 0, 0.73], 1, [Math.PI / 2, 0, 0]);
  part(g, G.capsule(0.01, 0.05), chrome, [-0.042, 0, 0.73], 1, [Math.PI / 2, 0, 0]);
  part(g, cached('noki-strings', () => merge([-0.008, 0.008].map((y) => ({
    g: G.cyl(), p: [0, 0.03 + y * 0.3, 0.36] as [number, number, number], s: [0.0022, 0.74, 0.0022] as [number, number, number], r: [Math.PI / 2, 0, 0] as [number, number, number],
  })))), chrome, undefined, undefined, undefined, { cast: false });
  return g;
}

/** rotation whose local +Z is `z` and local +X is `x` (orthonormalised) */
export function basisQ(z: THREE.Vector3, x: THREE.Vector3): THREE.Quaternion {
  const Z = z.clone().normalize();
  const Y = Z.clone().cross(x).normalize();
  const X = Y.clone().cross(Z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
}

export function createNoki(look: Partial<HeroLook> = DEFAULT_LOOKS.noki): HeroRig {
  const M = new Mats();
  const base = DEFAULT_LOOKS.noki;
  const L0 = cleanLook(look, base);
  const streakM = M.own(L0.hatColor);
  const chokerM = M.own(L0.scarfColor);
  const jacketM = M.own(L0.shirtColor);
  const jacketD = M.own('#000000');
  const skirtM = M.own(L0.shortsColor, { side: THREE.DoubleSide });
  const bootM = M.own(L0.bootColor);
  const guitarM = M.own(L0.backColor);
  const skin = M.get(SKIN), skinD = M.get(SKIN_D);
  const hairM = M.get(HAIR), hairL = M.get(HAIR_L);
  const steel = M.get(SILVER);
  const black = M.get('#1c1622');
  const teeM = M.get('#1c1622');
  stripes ??= stripeTex();
  const tightsM = M.own('#ffffff', { map: stripes });

  const b = bones(SPEC, 'noki');
  const { body, head } = b;

  // ── legs: striped tights + big buckled boots ──
  for (const [i, s] of [[0, 1], [1, -1]] as const) {
    const { hip, knee } = b.legs[i];
    part(hip, G.capsule(0.046, 0.12), tightsM, [0, -0.085, 0]);
    part(knee, G.capsule(0.041, 0.08), tightsM, [0, -0.04, 0]);
    // boot shaft + cuff + foot + chunky sole
    part(knee, G.cyl(), bootM, [0, -0.1, 0.004], [0.058, 0.14, 0.06]);
    part(knee, G.torus(0.06, 0.016, 8, 20), bootM, [0, -0.03, 0.004], 1, [Math.PI / 2, 0, 0]);
    part(knee, G.sphere(), bootM, [0, -0.168, 0.034], [0.07, 0.055, 0.105]);
    part(knee, G.sphere(), black, [0, -0.196, 0.03], [0.074, 0.03, 0.11]);
    // buckles + laces
    for (const y of [-0.075, -0.125]) {
      part(knee, G.cyl(), black, [0, y, 0.004], [0.061, 0.012, 0.063]);
      part(knee, G.sphere(), steel, [s * 0.05, y, 0.03], [0.012, 0.016, 0.008], [0, s * 0.6, 0]);
    }
    part(knee, G.capsule(0.006, 0.03), chokerM, [0, -0.15, 0.1], 1, [0, 0, Math.PI / 2]);
  }

  // ── skirt, belt, tee, jacket ──
  part(body, skirtGeo(), skirtM, [0, 0.4, 0]);
  part(body, G.sphere(), skirtM, [0, 0.47, 0], [0.12, 0.05, 0.1]);
  part(body, G.torus(0.118, 0.016, 8, 30), black, [0, 0.49, 0], [1, 1, 0.86], [Math.PI / 2, 0, 0]);
  part(body, cached('noki-studs', () => merge(Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * TAU;
    return { g: G.cone(), p: [Math.sin(a) * 0.132, 0.49, Math.cos(a) * 0.114] as [number, number, number], s: [0.012, 0.022, 0.012] as [number, number, number], r: [Math.PI / 2 * Math.cos(a), 0, -Math.PI / 2 * Math.sin(a)] as [number, number, number] };
  }))), steel);
  // tee (band shirt) under the jacket, with a little white bat
  part(body, G.sphere(), teeM, [0, 0.6, 0], [0.12, 0.15, 0.1]);
  const logo = surf(body, 0, 0.0, 0.1, [0, 0.6, 0]);
  part(logo, cached('noki-batlogo', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.012); s.lineTo(0.012, 0.024); s.lineTo(0.02, 0.014); s.quadraticCurveTo(0.04, 0.03, 0.06, 0.012); s.quadraticCurveTo(0.045, 0.0, 0.05, -0.016);
    s.quadraticCurveTo(0.03, -0.006, 0.0, -0.022); s.quadraticCurveTo(-0.03, -0.006, -0.05, -0.016); s.quadraticCurveTo(-0.045, 0.0, -0.06, 0.012);
    s.quadraticCurveTo(-0.04, 0.03, -0.02, 0.014); s.lineTo(-0.012, 0.024); s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false });
  }), M.get('#f4eef8'), [0, 0, 0.0], 1, undefined, { cast: false });
  // jacket: open in front (an open lathe), cropped above the belt
  part(body, cached('noki-jacket', () => {
    const prof: Array<[number, number]> = [[0.13, 0.5], [0.138, 0.56], [0.14, 0.63], [0.13, 0.69], [0.098, 0.74], [0.06, 0.765]];
    const L = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 28, 0.62, TAU - 1.24);
    // lathe phi=0 is +Z… rotate so the gap faces front: LatheGeometry starts at +X? (three: x = r·sin φ, z = r·cos φ)
    L.scale(1, 1, 0.9);
    L.computeVertexNormals();
    return L;
  }), jacketM, undefined, undefined, undefined);
  // jacket lining edge + popped collar
  part(body, cached('noki-lapels', () => merge([-1, 1].map((s) => ({
    g: G.capsule(0.018, 0.2), p: [s * 0.075, 0.62, 0.105] as [number, number, number], r: [0.18, 0, s * 0.32] as [number, number, number],
  })))), jacketD);
  jacketD.color.copy(jacketM.color).multiplyScalar(0.6);
  const collar = cached('noki-collar', () => merge([-1, 1].map((s) => ({
    g: G.sphere(), p: [s * 0.075, 0.76, -0.02] as [number, number, number], s: [0.065, 0.06, 0.018] as [number, number, number], r: [0.25, s * 0.9, s * 0.35] as [number, number, number],
  }))));
  part(body, collar, jacketM);
  // shoulder studs
  for (const s of [1, -1]) part(body, G.sphere(), jacketM, [s * 0.12, 0.7, 0], [0.06, 0.05, 0.06]);

  // ── arms: jacket sleeves, studded cuffs, fingerless gloves ──
  for (const [i, s] of [[0, 1], [1, -1]] as const) {
    const { sh } = b.arms[i];
    part(sh, G.capsule(0.043, 0.1), jacketM, [0, -0.07, 0]);
    part(sh, G.torus(0.04, 0.012, 8, 18), black, [0, -0.135, 0], 1, [Math.PI / 2, 0, 0]);
    part(sh, G.capsule(0.034, 0.05), skin, [0, -0.16, 0]);
    part(sh, G.sphere(), black, [0, -0.2, 0], [0.046, 0.042, 0.046]);
    part(sh, G.sphere(), skin, [0, -0.225, 0.01], [0.034, 0.026, 0.034]);
    void s;
  }

  // ── neck, choker ──
  part(body, G.cyl(), skin, [0, 0.79, 0], [0.042, 0.07, 0.042]);
  part(body, G.torus(0.046, 0.013, 8, 24), chokerM, [0, 0.79, 0], 1, [Math.PI / 2, 0, 0]);
  part(body, G.torus(0.014, 0.004, 6, 12), steel, [0, 0.775, 0.058], 1, [0.2, 0, 0]);

  // ── head ──
  part(head, G.sphere(), skin, undefined, [R, R * 1.02, R * 0.98]);
  // pointy elf ears with piercings
  for (const s of [1, -1]) {
    const ear = grp(head, [s * R * 0.95, -0.02, -0.01], [0, 0, -s * 1.15]);
    part(ear, G.cone(), skin, [0, 0.055, 0], [0.034, 0.12, 0.018]);
    part(ear, G.cone(), skinD, [0, 0.05, 0.008], [0.02, 0.08, 0.008], undefined, { cast: false });
    part(ear, G.torus(0.012, 0.0035, 6, 12), steel, [0, -0.002, 0.012], 1, [0, Math.PI / 2, 0]);
  }
  const face = buildFace(head, M, {
    R, eyeYaw: 0.37, eyePitch: -0.13, eyeW: 0.036, eyeH: 0.05, iris: '#e3263f', lid: 0.24, skin: SKIN,
    liner: true, brow: HAIR, browsAlways: true, mouthPitch: -0.6, mouthW: 0.028, fang: true, nose: SKIN_D, cheek: '#d79ad8',
  });

  // hair: a sleek dark bob, pointy side-swept bangs, a coloured streak on her left
  const hair = grp(head, undefined, undefined, 'hair');
  part(hair, G.dome(), hairM, [0, 0.0, -0.008], [R * 1.09, R * 1.12, R * 1.1], [-0.18, 0, 0]);
  part(hair, G.sphere(), hairM, [0, -0.05, -0.075], [R * 1.08, R * 0.84, R * 0.9]);
  // bob sides down to the jaw, ending in points
  const lock = (parent: THREE.Object3D, yaw: number, pitch: number, len: number, w: number, tiltZ: number, m: THREE.Material, r = R * 1.07) => {
    const a = surf(parent, yaw, pitch, r);
    const piv = grp(a, undefined, [0, 0, tiltZ]);
    part(piv, G.cone(), m, [0, -len / 2, 0], [w, len, w * 0.45], [Math.PI, 0, 0]);
    return piv;
  };
  for (const s2 of [1, -1]) {
    part(hair, G.sphere(), hairM, [s2 * 0.2, -0.06, -0.03], [0.065, 0.13, 0.13], [0, 0, s2 * 0.1]);
    lock(hair, s2 * 1.2, -0.25, 0.17, 0.06, s2 * 0.15, hairM);
    lock(hair, s2 * 1.55, -0.2, 0.2, 0.065, s2 * 0.1, hairL);
    lock(hair, s2 * 2.1, -0.25, 0.16, 0.07, s2 * 0.2, hairM);
  }
  // nape: three points at the back, a soft sheen band
  for (const y of [-0.45, 0, 0.45]) lock(hair, Math.PI + y, -0.42, 0.13, 0.08, -y * 0.4, hairM, R * 1.02);
  // fringe: points sweeping from her left (+X) to her right, the last one dipping by her right eye
  lock(hair, 0.6, 0.5, 0.13, 0.07, 0.5, hairM);
  lock(hair, 0.3, 0.55, 0.13, 0.075, 0.55, hairM);
  lock(hair, 0.0, 0.55, 0.14, 0.075, 0.6, hairM);
  lock(hair, -0.3, 0.5, 0.15, 0.075, 0.55, hairL);
  lock(hair, -0.6, 0.38, 0.17, 0.07, 0.35, hairM);
  // the streak (look colour)
  const streak = grp(hair);
  lock(streak, 0.85, 0.3, 0.2, 0.055, 0.3, streakM, R * 1.09);
  lock(streak, 1.05, 0.1, 0.22, 0.05, 0.12, streakM, R * 1.1);
  // a spiky tuft at the crown
  part(hair, cached('noki-tuft', () => merge([
    { g: G.cone(), p: [0.03, 0.26, -0.05], s: [0.04, 0.1, 0.04], r: [-0.5, 0, -0.3] },
    { g: G.cone(), p: [-0.04, 0.25, -0.08], s: [0.035, 0.09, 0.035], r: [-0.8, 0, 0.35] },
    { g: G.cone(), p: [0.0, 0.22, -0.14], s: [0.035, 0.09, 0.035], r: [-1.2, 0, 0] },
  ])), hairM);

  // ── the axe-guitar: on the back, in the hand, or across the chest ──
  const axe = axeGuitar(M, guitarM);
  // on the back: the pommel by her left hip, the labrys over her right shoulder, flat against her back
  const backPose = grp(body, [0.1, 0.42, -0.21]);
  backPose.quaternion.copy(basisQ(new THREE.Vector3(-0.57, 0.82, -0.05), new THREE.Vector3(0, 0, 1)));
  backPose.scale.setScalar(0.82);
  const hand = grp(b.arms[1].mount, [0, -0.02, 0]);
  // across the chest (a chord): the neck to her left, the body at her right hip, faces front
  const chest = grp(body, [0.42, 0.66, 0.16]);
  chest.quaternion.copy(basisQ(new THREE.Vector3(-0.93, -0.36, 0), new THREE.Vector3(0, 0, 1)));
  chest.scale.setScalar(0.85);
  const weaponTip = new THREE.Object3D();
  weaponTip.position.set(0, 0.26, 0.65);
  axe.add(weaponTip);
  backPose.add(axe);
  let axeAt: 'back' | 'hand' | 'chest' = 'back';
  const placeAxe = (at: typeof axeAt) => {
    if (at === axeAt) return;
    axeAt = at;
    (at === 'back' ? backPose : at === 'hand' ? hand : chest).add(axe);
  };

  // ── little bat wings (glide) on her back ──
  const wingM = M.get('#3a2a4e'), wingIn = M.get('#6a3a6a');
  const wings = grp(body, [0, 0.66, -0.1], undefined, 'wings');
  const wingPiv: THREE.Group[] = [];
  const wingShape = cached('noki-wing', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(0.06, 0.12); s.quadraticCurveTo(0.2, 0.2, 0.34, 0.12);
    s.quadraticCurveTo(0.3, 0.06, 0.32, -0.02); s.quadraticCurveTo(0.26, 0.0, 0.22, -0.06); s.quadraticCurveTo(0.17, -0.02, 0.12, -0.08);
    s.quadraticCurveTo(0.08, -0.03, 0, 0);
    const e = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 10 });
    e.translate(0, 0, -0.004);
    return e;
  });
  for (const s of [1, -1]) {
    const p = grp(wings, [s * 0.04, 0, 0]);
    const w = part(p, wingShape, wingM, undefined, [s, 1, 1]);
    void w;
    part(p, G.capsule(0.008, 0.3), wingIn, [s * 0.17, 0.12, -0.006], 1, [0, 0, s * 1.2]);
    wingPiv.push(p);
  }
  wings.scale.setScalar(0.001);
  vis(wings, false);

  // ── bat form (dash) ──
  const bat = grp(b.root, [0, 0.55, 0], undefined, 'bat');
  const batBody = M.get('#2e2440');
  part(bat, G.sphere(), batBody, undefined, [0.13, 0.12, 0.15]);
  part(bat, G.sphere(), M.get('#4a3a62'), [0, -0.02, 0.06], [0.09, 0.08, 0.08]);
  for (const s of [1, -1]) {
    part(bat, G.cone(), batBody, [s * 0.07, 0.13, 0.03], [0.04, 0.09, 0.03], [0, 0, -s * 0.3]);
    part(surf(bat, s * 0.38, 0.12, 0.13), G.ball(), M.get('#ff3a4a'), undefined, [0.022, 0.026, 0.01], undefined, { cast: false });
  }
  part(bat, G.cone(), M.get('#ffffff'), [0.02, -0.05, 0.14], [0.012, 0.03, 0.012], [Math.PI, 0, 0], { cast: false });
  const batWings: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const p = grp(bat, [s * 0.1, 0.02, 0]);
    part(p, wingShape, batBody, [0, 0, 0], [s * 1.5, 1.4, 1.5]);
    batWings.push(p);
  }
  bat.scale.setScalar(0.001);
  vis(bat, false);

  // dangly: the jacket's back hem and the hair sides follow motion a little (cheap: a spring on the head)
  const hairSwing = new Dangle();
  const anim = animator(SPEC, b);
  let drawnT = 0, batK = 0, glideK = 0;

  function attack(A: Pose, kind: HeroAtk, p: number): AtkOut {
    if (kind === 'axe') {
      // overhead chop: lift high behind, slam down in front
      const wind = smooth(seg(p, 0, 0.3)), chop = easeIn(seg(p, 0.3, 0.5));
      A.aRp = lerp(lerp(-0.4, -3.0, wind), -0.9, chop); A.aRy = 0.15; A.aRr = -0.1;
      A.aLp = lerp(-0.6, -1.0, chop); A.aLr = 0.4; A.aLy = 0.3;
      A.blade = lerp(lerp(-1.2, -2.4, wind), -0.15, chop);
      A.leanX = lerp(-0.18 * wind, 0.4, chop); A.twist = -0.2 * wind + 0.1 * chop; A.bodyY = -0.03 * chop;
      A.hipL = -0.55; A.kneeL = 0.6; A.hipR = 0.35; A.kneeR = 0.25;
      A.headX = -0.15 * wind + 0.15 * chop; A.scarf = 0.8;
      return { w: 1 - smooth(seg(p, 0.75, 1)) };
    }
    if (kind === 'axeAlt') {
      // a heavy horizontal sweep, right to left
      const wind = smooth(seg(p, 0, 0.25)), sweep = easeOut(seg(p, 0.25, 0.55));
      A.aRp = -1.45; A.aRr = 0; A.aRy = lerp(lerp(-0.4, -2.1, wind), 1.4, sweep);
      A.blade = 0.1; A.twist = lerp(lerp(0, -0.6, wind), 0.55, sweep);
      A.aLp = 0.4; A.aLr = 0.6; A.leanX = 0.15;
      A.hipL = -0.4; A.kneeL = 0.45; A.hipR = 0.35; A.kneeR = 0.2; A.headY = -A.twist * 0.5;
      return { w: 1 - smooth(seg(p, 0.7, 1)) };
    }
    if (kind === 'axeSpin') {
      const sp = easeInOut(seg(p, 0.04, 0.84));
      A.aRp = -1.5; A.aRy = -1.3; A.aRr = 0; A.blade = 0.05;
      A.aLp = -1.4; A.aLy = 1.3; A.aLr = 0;
      A.hipL = -0.35; A.kneeL = 0.55; A.hipR = -0.35; A.kneeR = 0.55; A.splay = 0.18; A.scarf = 1.4;
      return { w: 1 - smooth(seg(p, 0.84, 1)), spin: TAU * sp };
    }
    if (kind === 'chord') {
      // strum: left hand along the neck, right hand thrashing at the body; head-bang
      const strum = Math.sin(p * TAU * 6);
      A.aLp = -1.15; A.aLy = 0.75; A.aLr = 0.35;
      A.aRp = -0.75 + strum * 0.25; A.aRy = -0.45; A.aRr = -0.1;
      A.leanX = 0.12 + Math.abs(strum) * 0.05; A.headX = 0.15 + Math.max(0, strum) * 0.25; A.bodyY = -0.02;
      A.hipL = -0.3; A.kneeL = 0.4; A.hipR = 0.25; A.kneeR = 0.2; A.splay = 0.15; A.scarf = 0.6;
      return { w: 1 - smooth(seg(p, 0.85, 1)) };
    }
    return { w: 0 };
  }

  // ── look ──
  let cur: HeroLook = { ...L0 };
  function setLook(patch: Partial<HeroLook>) {
    const l = cleanLook({ ...cur, ...patch }, base);
    cur = l;
    streakM.color.set(l.hatColor);
    chokerM.color.set(l.scarfColor);
    jacketM.color.set(l.shirtColor);
    jacketD.color.copy(jacketM.color).multiplyScalar(0.6);
    skirtM.color.set(l.shortsColor);
    bootM.color.set(l.bootColor);
    guitarM.color.set(l.backColor);
  }

  const restHair = new THREE.Vector3(0, -0.2, -0.05);
  function update(dt: number, a: HeroAnim) {
    dt = Math.min(dt, 0.1);
    const fx = a.fx ?? {};
    const ak = a.attack?.kind;
    const fighting = ak === 'axe' || ak === 'axeAlt' || ak === 'axeSpin';
    if (fighting) drawnT = 0.9; else drawnT = Math.max(0, drawnT - dt);
    // weapon: in the hand while fighting (and a moment after), across the chest for a chord, else on the back
    placeAxe(ak === 'chord' ? 'chest' : drawnT > 0 && !(a.state === 'dead' || a.state === 'downed') ? 'hand' : 'back');
    anim.update(dt, a, attack, (T, st) => {
      // Noki stands with a hip cocked, arms looser; runs a bit lower
      if (st === 'idle') { T.leanZ += 0.04; T.hipL -= 0.06; T.kneeR += 0.12; T.aRr -= 0.06; T.headZ -= 0.05; }
      if (drawnT > 0 && (st === 'idle' || st === 'run' || st === 'walk')) { T.aRp = -0.75; T.blade = -1.75; }
      if (fx.glide) { const g = clamp(fx.glide); T.aLr = lerp(T.aLr, 1.3, g); T.aRr = lerp(T.aRr, -1.3, g); T.aLp = lerp(T.aLp, -0.3, g); T.aRp = lerp(T.aRp, -0.3, g); T.leanX = lerp(T.leanX, 0.35, g); T.kneeL = lerp(T.kneeL, 0.9, g); T.kneeR = lerp(T.kneeR, 0.5, g); }
    });
    const C = anim.C;
    b.arms[1].mount.rotation.x = C.blade - C.aRp;
    // face
    face.update(dt, stateExpr(a), clamp(a.talk), anim.t);
    // hair sway (a spring at the back of the head)
    const off = hairSwing.update(head, restHair, dt, 140, 8, 2.5, 0.08);
    hair.rotation.x = clamp((off.z - restHair.z) * 2.2, -0.15, 0.15);
    hair.rotation.z = clamp(-(off.x - restHair.x) * 2.2, -0.12, 0.12);
    // glide wings
    glideK = damp(glideK, clamp(fx.glide ?? 0), 14, dt);
    vis(wings, glideK > 0.02);
    if (wings.visible) {
      wings.scale.setScalar(Math.max(0.001, easeOut(glideK)) * 1.1);
      const f = Math.sin(anim.t * 14) * 0.35;
      wingPiv[0].rotation.set(0, 0.5 + f, 0.15); wingPiv[1].rotation.set(0, -0.5 - f, -0.15);
    }
    // bat form: the girl shrinks away, the bat pops out
    batK = damp(batK, clamp(fx.bat ?? 0), 30, dt);
    const human = clamp(1 - batK * 2), batS = clamp(batK * 2 - 1);
    b.squashG.scale.multiplyScalar(Math.max(0.001, human));
    vis(b.squashG, human > 0.01);
    vis(bat, batS > 0.01);
    if (bat.visible) {
      bat.scale.setScalar(Math.max(0.001, easeOut(batS)) * 1.25);
      const f = Math.sin(anim.t * 30);
      batWings[0].rotation.set(0, 0, f * 0.7); batWings[1].rotation.set(0, 0, -f * 0.7);
      bat.position.y = 0.55 + Math.sin(anim.t * 30) * 0.02;
    }
    M.flash(a.flash);
  }

  setLook(L0);
  return {
    root: b.root, update, weaponTip, setLook,
    get look() { return { ...cur }; },
    dispose() { for (const m of M.all) m.dispose(); face.dispose(); },
  };
}
