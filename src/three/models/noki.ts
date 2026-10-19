import * as THREE from 'three';
import { basic, canvasTex, noOutline } from '../gfx';
import {
  G, Mats, TAU, clamp, lerp, damp, smooth, seg, easeOut, easeIn, easeInOut,
  grp, part, surf, vis, cached, merge, taperedTube,
} from './kit';
import { bones, animator, stateExpr, Dangle, type HumanoidSpec, type Pose, type AtkOut } from './humanoid';
import { buildToonFace } from './toonFace';
import { flatten, lockGeo } from './toonKit';
import type { HeroAnim, HeroAtk, HeroRig } from './hero';
import { cleanLook, DEFAULT_LOOKS, type HeroLook } from '../../net/profile';

/*
 * Ноки — the half-vampire rocker girl. Silhouette: a spiky asymmetric bob (longer on her left, a coloured streak,
 * spikes at the crown), long pointy ears with silver hoops, a cropped studded leather jacket with a popped collar,
 * a pleated tartan skirt with a studded belt and a wallet chain, striped stockings and big platform boots, and the
 * axe-guitar (a labrys body on a guitar neck, glowing strings) on her back — in her hand when she fights, across
 * her chest when she plays. Face: crimson slit eyes with eyeliner, a half-lidded "whatever" look, a one-sided smirk
 * with one fang peeking out. Idle: taps her boot and nods to a beat only she hears; talks with her right hand.
 * Dash = bat form (fx.bat), glide = little bat wings (fx.glide), fx.charge makes the strings blaze.
 * Look slots: hat = hair streak, scarf = choker & laces, shirt = jacket, shorts = skirt, boot = boots, back = the guitar.
 */

const SPEC: HumanoidSpec = { CY: 0.5, hipY: 0.42, hipX: 0.068, thigh: 0.19, shin: 0.17, shoulderY: 0.705, shoulderX: 0.135, arm: 0.2, headY: 0.975 };
const R = 0.235;
const SKIN = '#efd4ff', SKIN_D = '#d2a8f0', HAIR = '#2c2240', HAIR_L = '#54437a';
const SILVER = '#d8dee8';

const stripeTex = () => canvasTex(8, 64, (g, w, h) => {
  g.fillStyle = '#231c2c'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#8a64b4';
  for (let i = 0; i < 8; i++) g.fillRect(0, i * 8, w, 3.4);
}, { wrap: true });
let stripes: THREE.Texture | null = null;
/** grey tartan (multiplied by the skirt colour) */
const tartanTex = () => canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(20,10,30,0.42)';
  for (const x of [6, 38]) { g.fillRect(x, 0, 10, h); g.fillRect(0, x, w, 10); }
  g.fillStyle = 'rgba(20,10,30,0.25)';
  for (const x of [24, 56]) { g.fillRect(x, 0, 3, h); g.fillRect(0, x, w, 3); }
  g.fillStyle = 'rgba(255,255,255,0.5)';
  for (const x of [30]) { g.fillRect(x, 0, 1.5, h); g.fillRect(0, x, w, 1.5); }
}, { wrap: true, repeat: [3, 1] });
let tartan: THREE.Texture | null = null;

const skirtGeo = () => cached('noki-skirt2', () => {
  const g = new THREE.CylinderGeometry(0.12, 0.215, 0.17, 48, 3, true);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(x, z);
    const k = (0.085 - y) / 0.17; // 0 top → 1 hem
    // knife pleats: a saw-tooth fold that deepens toward the hem
    const saw = ((a / TAU) * 16 + 16) % 1;
    const r = 1 + 0.085 * k * (saw < 0.5 ? saw * 2 : 2 - saw * 2) - 0.03 * k;
    p.setXYZ(i, x * r, y - (k > 0.99 ? 0.004 * Math.sin(a * 16) : 0), z * r);
  }
  g.computeVertexNormals();
  return g;
});

/** the axe-guitar: grip at the origin, neck along +Z, the labrys body at the far end (blades along ±Y, faces ±X) */
function axeGuitar(M: Mats, bodyM: THREE.Material, glowM: THREE.Material) {
  const g = new THREE.Group();
  g.name = 'axeGuitar';
  const wood = M.get('#3a2418'), ebony = M.get('#18121c'), steel = M.get(SILVER), chrome = M.get('#f2f4f8');
  const st = new THREE.Group();
  g.add(st);
  part(st, G.cyl(), wood, [0, 0, 0.24], [0.026, 0.66, 0.02], [Math.PI / 2, 0, 0]);
  part(st, G.cyl(), ebony, [0, 0.018, 0.28], [0.022, 0.5, 0.008], [Math.PI / 2, 0, 0]);
  part(st, cached('noki-frets', () => merge(Array.from({ length: 9 }, (_, i) => ({
    g: G.cyl(), p: [0, 0.023, 0.07 + i * 0.05] as [number, number, number], s: [0.0045, 0.05, 0.0045] as [number, number, number], r: [0, 0, Math.PI / 2] as [number, number, number],
  })))), chrome);
  // fret dots (little bats → simple dots)
  part(st, cached('noki-dots', () => merge([0.145, 0.245, 0.345].map((z) => ({ g: G.ball(), p: [0, 0.027, z] as [number, number, number], s: [0.006, 0.003, 0.006] as [number, number, number] })))), chrome);
  // headstock (the pommel): a pointy bat-wing shape with tuning pegs
  part(st, cached('noki-head', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.03, 0); s.lineTo(0.03, 0); s.lineTo(0.065, -0.095); s.lineTo(0.022, -0.072); s.lineTo(0, -0.13); s.lineTo(-0.022, -0.072); s.lineTo(-0.065, -0.095); s.closePath();
    const e = new THREE.ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 });
    e.translate(0, 0, -0.011); e.rotateX(Math.PI / 2); e.rotateZ(Math.PI / 2); e.translate(0, 0, -0.08);
    return e;
  }), bodyM);
  part(st, cached('noki-pegs', () => merge([-1, 1].flatMap((s) => [0, 1].map((i) => ({
    g: G.ball(), p: [s * 0.035, 0.0, -0.1 - i * 0.03] as [number, number, number], s: [0.016, 0.012, 0.012] as [number, number, number],
  }))))), chrome);
  const bladeGeo = cached('noki-labrys', () => {
    const s = new THREE.Shape();
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
    e.rotateY(-Math.PI / 2);
    e.translate(0, 0, 0.6);
    return e;
  });
  part(st, bladeGeo, bodyM);
  const edge = cached('noki-edge', () => {
    const arc = (sy: number) => {
      const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, sy * 0.22, 0.49), new THREE.Vector3(0, sy * 0.3, 0.65), new THREE.Vector3(0, sy * 0.22, 0.81));
      return taperedTube(c, 20, 8, (t) => 0.014 + 0.012 * Math.sin(t * Math.PI));
    };
    return merge([{ g: arc(1) }, { g: arc(-1) }]);
  });
  part(st, edge, steel);
  // pickguard: a bat silhouette in black, pickups, bridge
  part(st, cached('noki-pickups', () => merge([
    { g: G.capsule(0.012, 0.06), p: [0.04, 0, 0.56] },
    { g: G.capsule(0.012, 0.06), p: [-0.04, 0, 0.56] },
    { g: G.capsule(0.012, 0.06), p: [0.04, 0, 0.66] },
    { g: G.capsule(0.012, 0.06), p: [-0.04, 0, 0.66] },
  ])), ebony);
  part(st, cached('noki-bridge', () => merge([1, -1].map((s) => ({ g: G.capsule(0.01, 0.05), p: [s * 0.042, 0, 0.73] as [number, number, number], r: [Math.PI / 2, 0, 0] as [number, number, number] })))), chrome);
  // a bat sticker on both faces of the blade
  part(st, cached('noki-batsticker', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.012); s.lineTo(0.012, 0.026); s.lineTo(0.02, 0.014); s.quadraticCurveTo(0.04, 0.03, 0.062, 0.012); s.quadraticCurveTo(0.046, 0.0, 0.05, -0.018);
    s.quadraticCurveTo(0.03, -0.006, 0.0, -0.024); s.quadraticCurveTo(-0.03, -0.006, -0.05, -0.018); s.quadraticCurveTo(-0.046, 0.0, -0.062, 0.012);
    s.quadraticCurveTo(-0.04, 0.03, -0.02, 0.014); s.lineTo(-0.012, 0.026); s.closePath();
    const e = new THREE.ShapeGeometry(s);
    const a = e.clone().rotateY(Math.PI / 2).scale(1, 1.4, 1.4).translate(0.042, 0.13, 0.62);
    const b = e.clone().rotateY(-Math.PI / 2).scale(1, 1.4, 1.4).translate(-0.042, 0.13, 0.62);
    return merge([{ g: a }, { g: b }]);
  }), ebony, undefined, undefined, undefined, { cast: false });
  flatten(st);
  // glowing strings (unlit, no outline)
  const strings = noOutline(part(g, cached('noki-strings2', () => merge([-0.012, -0.004, 0.004, 0.012].map((x) => ({
    g: G.cyl(), p: [x, 0.03, 0.36] as [number, number, number], s: [0.0022, 0.74, 0.0022] as [number, number, number], r: [Math.PI / 2, 0, 0] as [number, number, number],
  })))), glowM, undefined, undefined, undefined, { cast: false }));
  return { g, strings };
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
  tartan ??= tartanTex();
  const skirtM = M.own(L0.shortsColor, { side: THREE.DoubleSide, map: tartan });
  const bootM = M.own(L0.bootColor);
  const guitarM = M.own(L0.backColor);
  const skin = M.get(SKIN), skinD = M.get(SKIN_D);
  const hairM = M.get(HAIR), hairL = M.get(HAIR_L);
  const steel = M.get(SILVER);
  const black = M.get('#1c1622');
  const sole = M.get('#3a3046');
  const teeM = M.get('#1c1622');
  stripes ??= stripeTex();
  const tightsM = M.own('#ffffff', { map: stripes });
  const glowM = basic('#9af4ff');

  const b = bones(SPEC, 'noki');
  const { body, head } = b;

  // ── legs: striped tights + big platform boots ──
  for (const [i, s] of [[0, 1], [1, -1]] as const) {
    const { hip, knee } = b.legs[i];
    part(hip, G.capsule(0.047, 0.12), tightsM, [0, -0.085, 0]);
    part(knee, G.capsule(0.042, 0.08), tightsM, [0, -0.04, 0]);
    const boot = grp(knee);
    part(boot, G.cyl(), bootM, [0, -0.1, 0.004], [0.062, 0.15, 0.064]);
    part(boot, G.torus(0.064, 0.017, 8, 22), bootM, [0, -0.026, 0.004], 1, [Math.PI / 2, 0, 0]);
    part(boot, G.sphere(), bootM, [0, -0.168, 0.04], [0.074, 0.06, 0.112]);
    part(boot, G.sphere(), M.get('#4a4058'), [0, -0.165, 0.11], [0.05, 0.04, 0.04]); // toe cap
    // the platform sole: thick, with a lighter stripe
    part(boot, G.cyl(), black, [0, -0.214, 0.035], [0.08, 0.04, 0.122]);
    part(boot, G.cyl(), sole, [0, -0.2, 0.035], [0.082, 0.01, 0.124]);
    // straps with silver buckles + laces
    for (const y of [-0.07, -0.125]) {
      part(boot, G.cyl(), black, [0, y, 0.004], [0.066, 0.014, 0.068]);
      part(boot, G.cyl(), steel, [s * 0.058, y, 0.03], [0.012, 0.018, 0.006], [Math.PI / 2, 0, s * 0.6 - Math.PI / 2 * 0]);
    }
    part(boot, cached('noki-laces', () => merge([0, 1, 2].map((k) => ({ g: G.capsule(0.005, 0.03), p: [0, -0.11 - k * 0.022, 0.066 + k * 0.004] as [number, number, number], r: [0, 0, Math.PI / 2] as [number, number, number] })))), chokerM);
    flatten(boot);
  }

  // ── skirt, studded belt + wallet chain, tee, jacket ──
  const outfit = grp(body);
  part(outfit, skirtGeo(), skirtM, [0, 0.4, 0]);
  part(outfit, G.sphere(), skirtM, [0, 0.47, 0], [0.122, 0.05, 0.1]);
  part(outfit, G.torus(0.12, 0.018, 8, 30), black, [0, 0.49, 0], [1, 1, 0.86], [Math.PI / 2, 0, 0]);
  part(outfit, cached('noki-studs', () => merge(Array.from({ length: 11 }, (_, i) => {
    const a = (i / 11) * TAU;
    return { g: G.cone(), p: [Math.sin(a) * 0.136, 0.49, Math.cos(a) * 0.117] as [number, number, number], s: [0.011, 0.02, 0.011] as [number, number, number], r: [Math.PI / 2 * Math.cos(a), 0, -Math.PI / 2 * Math.sin(a)] as [number, number, number] };
  }))), steel);
  part(outfit, G.cyl(), steel, [0, 0.49, 0.118], [0.022, 0.012, 0.03], [Math.PI / 2, 0, 0]); // buckle
  // wallet chain looping from the belt on her left hip
  part(outfit, cached('noki-chain', () => {
    const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0.11, 0.48, 0.07), new THREE.Vector3(0.17, 0.36, 0.02), new THREE.Vector3(0.13, 0.47, -0.08));
    return merge(Array.from({ length: 9 }, (_, i) => {
      const p = c.getPointAt(i / 8);
      return { g: G.torus(0.009, 0.0025, 5, 10), p: [p.x, p.y, p.z] as [number, number, number], r: [i % 2 ? Math.PI / 2 : 0, 0.4, 0] as [number, number, number] };
    }));
  }), steel);
  part(outfit, G.sphere(), teeM, [0, 0.6, 0], [0.122, 0.152, 0.102]);
  const logo = surf(outfit, 0, -0.05, 0.1, [0, 0.6, 0]);
  part(logo, cached('noki-batlogo', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.012); s.lineTo(0.012, 0.024); s.lineTo(0.02, 0.014); s.quadraticCurveTo(0.04, 0.03, 0.06, 0.012); s.quadraticCurveTo(0.045, 0.0, 0.05, -0.016);
    s.quadraticCurveTo(0.03, -0.006, 0.0, -0.022); s.quadraticCurveTo(-0.03, -0.006, -0.05, -0.016); s.quadraticCurveTo(-0.045, 0.0, -0.06, 0.012);
    s.quadraticCurveTo(-0.04, 0.03, -0.02, 0.014); s.lineTo(-0.012, 0.024); s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false });
  }), M.get('#f4eef8'), [0, 0, 0.0], 1, undefined, { cast: false });
  // jacket: open in front, cropped above the belt
  part(outfit, cached('noki-jacket2', () => {
    const prof: Array<[number, number]> = [[0.134, 0.51], [0.142, 0.56], [0.145, 0.63], [0.136, 0.69], [0.104, 0.74], [0.064, 0.768]];
    const L = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 30, 0.6, TAU - 1.2);
    L.scale(1, 1, 0.9);
    L.computeVertexNormals();
    return L;
  }), jacketM);
  // lapels (darker), zipper teeth, the popped collar, shoulder studs, a pin
  part(outfit, cached('noki-lapels', () => merge([-1, 1].map((s) => ({
    g: G.capsule(0.018, 0.2), p: [s * 0.075, 0.62, 0.108] as [number, number, number], r: [0.18, 0, s * 0.32] as [number, number, number],
  })))), jacketD);
  part(outfit, cached('noki-zip', () => merge(Array.from({ length: 7 }, (_, i) => ({ g: G.ball(), p: [0.072 - i * 0.004, 0.52 + i * 0.026, 0.118] as [number, number, number], s: 0.006 })))), steel);
  part(outfit, cached('noki-collar', () => merge([-1, 1].map((s) => ({
    g: G.sphere(), p: [s * 0.078, 0.765, -0.025] as [number, number, number], s: [0.072, 0.068, 0.018] as [number, number, number], r: [0.3, s * 0.95, s * 0.4] as [number, number, number],
  })))), jacketM);
  for (const s of [1, -1]) part(outfit, G.sphere(), jacketM, [s * 0.122, 0.7, 0], [0.064, 0.054, 0.064]);
  part(outfit, cached('noki-shstuds', () => merge([1, -1].flatMap((s) => [0, 1, 2].map((k) => {
    const a = -0.7 + k * 0.7;
    return { g: G.cone(), p: [s * (0.13 + Math.sin(a) * 0.0), 0.752, Math.sin(a) * 0.045] as [number, number, number], s: [0.011, 0.024, 0.011] as [number, number, number], r: [0, 0, -s * 0.35] as [number, number, number] };
  })))), steel);
  part(outfit, G.cyl(), M.get('#e8304a'), [-0.098, 0.665, 0.112], [0.017, 0.006, 0.017], [Math.PI / 2 - 0.25, 0, 0]); // a red pin
  part(outfit, G.ball(), M.get('#ffffff'), [-0.098, 0.667, 0.118], [0.006, 0.006, 0.003]);
  // neck, choker with a little spike ring
  part(outfit, G.cyl(), skin, [0, 0.79, 0], [0.042, 0.07, 0.042]);
  part(outfit, G.torus(0.046, 0.013, 8, 24), chokerM, [0, 0.79, 0], 1, [Math.PI / 2, 0, 0]);
  part(outfit, G.torus(0.014, 0.004, 6, 12), steel, [0, 0.775, 0.058], 1, [0.2, 0, 0]);
  flatten(outfit);
  jacketD.color.copy(jacketM.color).multiplyScalar(0.6);

  // ── arms: jacket sleeves, studded cuffs, fingerless gloves; rock horns for the cheer ──
  const horns: THREE.Group[] = [];
  for (const [i, s] of [[0, 1], [1, -1]] as const) {
    const { sh, mount } = b.arms[i];
    const a = grp(sh);
    part(a, G.capsule(0.045, 0.1), jacketM, [0, -0.07, 0]);
    part(a, G.torus(0.042, 0.013, 8, 18), black, [0, -0.135, 0], 1, [Math.PI / 2, 0, 0]);
    if (i === 1) part(a, cached('noki-cuffstuds', () => merge(Array.from({ length: 6 }, (_, k) => { const an = (k / 6) * TAU; return { g: G.cone(), p: [Math.sin(an) * 0.054, -0.135, Math.cos(an) * 0.054] as [number, number, number], s: [0.008, 0.016, 0.008] as [number, number, number], r: [Math.PI / 2 * Math.cos(an), 0, -Math.PI / 2 * Math.sin(an)] as [number, number, number] }; }))), steel);
    part(a, G.capsule(0.034, 0.05), skin, [0, -0.16, 0]);
    part(a, G.sphere(), black, [0, -0.2, 0], [0.047, 0.043, 0.047]);
    part(a, G.sphere(), skin, [0, -0.225, 0.01], [0.035, 0.027, 0.035]);
    flatten(a);
    // horns: index + pinky up (shown for cheer / dance)
    const h = grp(mount, [0, -0.02, 0.0]);
    part(h, G.capsule(0.011, 0.045), skin, [s * 0.016, -0.06, 0.018], 1, [0.3, 0, 0]);
    part(h, G.capsule(0.011, 0.04), skin, [-s * 0.016, -0.058, 0.018], 1, [0.3, 0, 0]);
    h.rotation.x = Math.PI;
    vis(h, false);
    horns.push(h);
  }

  // ── head ──
  part(head, G.sphere(), skin, undefined, [R, R * 1.0, R * 0.98]);
  // pointy elf ears with silver hoops (they twitch)
  const ears: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const ear = grp(head, [s * R * 0.93, -0.015, -0.01], [0, s * 0.25, -s * 1.2]);
    const e = grp(ear);
    part(e, G.cone(), skin, [0, 0.085, 0], [0.05, 0.2, 0.026]);
    part(e, G.cone(), skinD, [0, 0.072, 0.012], [0.03, 0.14, 0.01], undefined, { cast: false });
    part(e, G.torus(0.014, 0.0035, 6, 12), steel, [0, -0.005, 0.014], 1, [0, Math.PI / 2, 0]);
    part(e, G.torus(0.01, 0.003, 6, 12), steel, [0, 0.03, 0.016], 1, [0, Math.PI / 2, 0]);
    ears.push(ear);
  }
  const face = buildToonFace(head, M, {
    R, eyeYaw: 0.36, eyePitch: -0.1, eyeW: 0.05, eyeH: 0.058, eyeTilt: 0.1,
    iris: '#e8203c', irisDark: '#5a0616', slit: true, irisSize: 0.74, lidMat: skin, lidRest: 0.32,
    lash: '#1c1024', liner: true, lashes: 2, brow: HAIR, browThick: 0.011, browW: 0.046, browLift: 1.9, browOut: 1.085,
    mouthPitch: -0.5, mouthW: 0.04, rest: 'smirk', fangs: 1, cheek: '#c27ad8', mouthColor: '#4a0e22',
    nose: { mat: skinD, w: 0.012, h: 0.009 },
  });

  // ── hair: skull cap + bangs (static), side / back locks (swing), crown spikes, the streak ──
  const hair = grp(head, undefined, undefined, 'hair');
  const hairS = grp(hair, [0, 0.12, -0.03]); // swing pivot (crown)
  const hs = grp(hairS, [0, -0.12, 0.03]);
  part(hair, G.dome(), hairM, [0, 0.0, -0.01], [R * 1.1, R * 1.14, R * 1.11], [-0.55, 0, 0]);
  part(hair, G.sphere(), hairM, [0, -0.02, -0.07], [R * 1.08, R * 0.97, R * 0.94]);
  const lock = (parent: THREE.Object3D, yaw: number, pitch: number, len: number, w: number, rz: number, m: THREE.Material, o: { r?: number; curl?: number; sweep?: number; th?: number; tilt?: number } = {}) => {
    const a = surf(parent, yaw, pitch, R * (o.r ?? 1.04));
    const piv = grp(a, undefined, [o.tilt ?? 0, 0, rz]);
    part(piv, lockGeo(o.curl ?? 0.3, o.sweep ?? 0), m, undefined, [w / 0.3, len, (o.th ?? w * 0.55) / 0.3]);
    return piv;
  };
  // bangs: sweeping from her right to her left, one long lock dipping past her left eye
  lock(hair, -0.62, 0.5, 0.13, 0.065, -0.45, hairM, { curl: 0.35 });
  lock(hair, -0.34, 0.6, 0.14, 0.07, -0.3, hairM, { curl: 0.4 });
  lock(hair, -0.08, 0.62, 0.15, 0.075, 0.15, hairL, { curl: 0.45 });
  lock(hair, 0.18, 0.62, 0.17, 0.075, 0.35, hairM, { curl: 0.45 });
  lock(hair, 0.44, 0.55, 0.21, 0.07, 0.42, hairM, { curl: 0.35, sweep: 0.1 });
  // the streak (look colour) among the bangs on her left
  const streakG = grp(hair);
  lock(streakG, 0.3, 0.64, 0.19, 0.05, 0.4, streakM, { curl: 0.45, r: 1.06 });
  lock(streakG, 0.66, 0.42, 0.22, 0.05, 0.25, streakM, { curl: 0.3, r: 1.06 });
  // crown spikes (point up and back)
  for (const [yaw, pitch, len, rz, m] of [[0.1, 1.05, 0.17, Math.PI + 0.25, hairM], [-0.3, 0.92, 0.14, Math.PI - 0.35, hairL], [0.5, 0.85, 0.13, Math.PI + 0.65, hairM], [2.6, 0.75, 0.15, Math.PI - 0.5, hairM], [-2.7, 0.8, 0.14, Math.PI + 0.4, hairM]] as const) lock(hair, yaw, pitch, len + 0.03, 0.07, rz, m, { curl: -0.25, tilt: -0.5, r: 1.1 });
  // sides: the bob down to the jaw, flipping out — longer on her left (+X)
  for (const [yaw, len, m] of [[1.12, 0.26, hairM], [1.48, 0.3, hairL], [1.88, 0.27, hairM], [2.35, 0.22, hairM]] as const) lock(hs, yaw, 0.15, len, 0.1, 0.18, m, { curl: 0.85, r: 1.06 });
  for (const [yaw, len, m] of [[-1.12, 0.18, hairM], [-1.48, 0.2, hairM], [-1.88, 0.2, hairL], [-2.35, 0.18, hairM]] as const) lock(hs, yaw, 0.12, len, 0.1, -0.2, m, { curl: 0.9, r: 1.06 });
  // nape: flipped points
  for (const y of [-0.5, 0, 0.5]) lock(hs, Math.PI + y, -0.2, 0.19, 0.1, -y * 0.6, y === 0 ? hairL : hairM, { curl: 0.9, r: 1.02 });
  hairS.userData.keep = true;
  flatten(hair);
  flatten(hs);

  // ── the axe-guitar: on the back, in the hand, or across the chest ──
  const axe = axeGuitar(M, guitarM, glowM);
  const backPose = grp(body, [0.1, 0.42, -0.21]);
  backPose.quaternion.copy(basisQ(new THREE.Vector3(-0.57, 0.82, -0.05), new THREE.Vector3(0, 0, 1)));
  backPose.scale.setScalar(0.82);
  const hand = grp(b.arms[1].mount, [0, -0.02, 0]);
  const chest = grp(body, [0.42, 0.66, 0.16]);
  chest.quaternion.copy(basisQ(new THREE.Vector3(-0.93, -0.36, 0), new THREE.Vector3(0, 0, 1)));
  chest.scale.setScalar(0.85);
  const weaponTip = new THREE.Object3D();
  weaponTip.position.set(0, 0.26, 0.65);
  axe.g.add(weaponTip);
  backPose.add(axe.g);
  let axeAt: 'back' | 'hand' | 'chest' = 'back';
  const placeAxe = (at: typeof axeAt) => {
    if (at === axeAt) return;
    axeAt = at;
    (at === 'back' ? backPose : at === 'hand' ? hand : chest).add(axe.g);
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
    part(p, wingShape, wingM, undefined, [s, 1, 1]);
    part(p, G.capsule(0.008, 0.3), wingIn, [s * 0.17, 0.12, -0.006], 1, [0, 0, s * 1.2]);
    wingPiv.push(p);
  }
  wings.scale.setScalar(0.001);
  vis(wings, false);

  // ── bat form (dash): a round little bat with her hair tuft and red eyes ──
  const bat = grp(b.root, [0, 0.55, 0], undefined, 'bat');
  const batBody = M.get('#2e2440');
  part(bat, G.sphere(), batBody, undefined, [0.13, 0.12, 0.15]);
  part(bat, G.sphere(), M.get('#4a3a62'), [0, -0.02, 0.06], [0.09, 0.08, 0.08]);
  for (const s of [1, -1]) {
    part(bat, G.cone(), batBody, [s * 0.07, 0.13, 0.03], [0.04, 0.09, 0.03], [0, 0, -s * 0.3]);
    part(surf(bat, s * 0.38, 0.12, 0.13), G.ball(), M.get('#ff3a4a'), undefined, [0.024, 0.028, 0.01], undefined, { cast: false });
    part(surf(bat, s * 0.38, 0.12, 0.135), G.ball(), M.get('#ffffff'), [s * 0.006, 0.01, 0.004], 0.007, undefined, { cast: false });
  }
  part(bat, lockGeo(0.3, 0), streakM, [0.02, 0.15, 0.06], [0.12, 0.08, 0.06], [0, 0, Math.PI + 0.4]);
  part(bat, G.cone(), M.get('#ffffff'), [0.02, -0.05, 0.14], [0.012, 0.03, 0.012], [Math.PI, 0, 0], { cast: false });
  const batWings: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const p = grp(bat, [s * 0.1, 0.02, 0]);
    part(p, wingShape, batBody, [0, 0, 0], [s * 1.5, 1.4, 1.5]);
    batWings.push(p);
  }
  bat.scale.setScalar(0.001);
  vis(bat, false);

  const hairSwing = new Dangle();
  const anim = animator(SPEC, b);
  let drawnT = 0, batK = 0, glideK = 0, earT = 2, earK = 0, chargeK = 0;

  function attack(A: Pose, kind: HeroAtk, p: number): AtkOut {
    if (kind === 'axe') {
      const wind = smooth(seg(p, 0, 0.3)), chop = easeIn(seg(p, 0.3, 0.5));
      A.aRp = lerp(lerp(-0.4, -3.0, wind), -0.9, chop); A.aRy = 0.15; A.aRr = -0.1;
      A.aLp = lerp(-0.6, -1.0, chop); A.aLr = 0.4; A.aLy = 0.3;
      A.blade = lerp(lerp(-1.2, -2.4, wind), -0.15, chop);
      A.leanX = lerp(-0.22 * wind, 0.45, chop); A.twist = -0.25 * wind + 0.12 * chop; A.bodyY = -0.035 * chop;
      A.hipL = -0.6; A.kneeL = 0.65; A.hipR = 0.38; A.kneeR = 0.28;
      A.headX = -0.18 * wind + 0.18 * chop; A.scarf = 0.8;
      return { w: 1 - smooth(seg(p, 0.75, 1)) };
    }
    if (kind === 'axeAlt') {
      const wind = smooth(seg(p, 0, 0.25)), sweep = easeOut(seg(p, 0.25, 0.55));
      A.aRp = -1.45; A.aRr = 0; A.aRy = lerp(lerp(-0.4, -2.1, wind), 1.4, sweep);
      A.blade = 0.1; A.twist = lerp(lerp(0, -0.65, wind), 0.6, sweep);
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
      // power stance, strumming hard, head-banging
      const strum = Math.sin(p * TAU * 6);
      A.aLp = -1.15; A.aLy = 0.75; A.aLr = 0.35;
      A.aRp = -0.75 + strum * 0.28; A.aRy = -0.45; A.aRr = -0.1;
      A.leanX = 0.1 + Math.abs(strum) * 0.06; A.headX = 0.12 + Math.max(0, strum) * 0.32; A.bodyY = -0.035;
      A.hipL = -0.35; A.kneeL = 0.5; A.hipR = 0.3; A.kneeR = 0.3; A.splay = 0.22; A.scarf = 0.6;
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
  const glowBase = new THREE.Color('#9af4ff'), glowHot = new THREE.Color('#ffffff');
  function update(dt: number, a: HeroAnim) {
    dt = Math.min(dt, 0.1);
    const fx = a.fx ?? {};
    const ak = a.attack?.kind;
    const fighting = ak === 'axe' || ak === 'axeAlt' || ak === 'axeSpin';
    if (fighting) drawnT = 0.9; else drawnT = Math.max(0, drawnT - dt);
    placeAxe(ak === 'chord' ? 'chest' : drawnT > 0 && !(a.state === 'dead' || a.state === 'downed') ? 'hand' : 'back');
    const talk = clamp(a.talk);
    const tt = anim.t;
    anim.update(dt, a, attack, (T, st) => {
      if (st === 'idle') {
        // hip cocked, tapping her right boot and nodding to a beat only she hears
        const beat = tt * 2.1 * TAU / 2;
        const tap = Math.max(0, Math.sin(beat));
        T.leanZ += 0.045; T.hipL -= 0.06; T.kneeR += 0.14 + tap * 0.22; T.hipR -= tap * 0.12;
        T.aRr -= 0.08; T.aLr += 0.12; T.aLp += 0.12;
        T.headZ -= 0.07; T.headX += 0.05 * Math.max(0, Math.sin(beat - 0.4));
        if (talk > 0.05) { T.aRp = -0.55 + Math.sin(tt * 4.2) * 0.22; T.aRy = 0.35; T.aRr = -0.35; T.headZ += Math.sin(tt * 2.3) * 0.06; T.kneeR -= tap * 0.2; }
      }
      if (st === 'run') { T.leanX += 0.06; T.headX -= 0.04; }
      if (st === 'wave') { T.aLr -= 0.6; T.aLp = -0.4; T.headZ = 0.2; } // a lazy, cool wave
      if (st === 'lookUp') { T.aLp = -0.15; T.aLr = 0.5; T.aRr = -0.5; }
      if (drawnT > 0 && (st === 'idle' || st === 'run' || st === 'walk')) { T.aRp = -0.75; T.blade = -1.75; }
      if (fx.glide) { const g = clamp(fx.glide); T.aLr = lerp(T.aLr, 1.3, g); T.aRr = lerp(T.aRr, -1.3, g); T.aLp = lerp(T.aLp, -0.3, g); T.aRp = lerp(T.aRp, -0.3, g); T.leanX = lerp(T.leanX, 0.35, g); T.kneeL = lerp(T.kneeL, 0.9, g); T.kneeR = lerp(T.kneeR, 0.5, g); }
    });
    const C = anim.C;
    b.arms[1].mount.rotation.x = C.blade - C.aRp;
    // rock horns for the cheer / dance
    const rock = (a.state === 'cheer' || a.state === 'dance') && !ak;
    for (const h of horns) vis(h, rock);
    // face: sass — a cocked brow while talking, a calmer half-lid at rest
    const ex = stateExpr(a);
    face.update(dt, ex, talk, { cock: talk > 0.1 ? 0.35 : a.state === 'idle' ? 0.15 * Math.max(0, Math.sin(tt * 0.4)) : 0 });
    // ears twitch now and then (and droop when hurt / sleepy)
    earT -= dt;
    if (earT < 0) { earT = 1.5 + Math.random() * 4; earK = 1; }
    earK = Math.max(0, earK - dt * 5);
    const droop = ex === 'hurt' || ex === 'sleepy' || ex === 'scared' ? 0.35 : ex === 'angry' ? -0.15 : 0;
    for (let i = 0; i < 2; i++) { const s = i === 0 ? 1 : -1; ears[i].rotation.set(0, s * 0.25, -s * (1.2 - droop - Math.sin(earK * Math.PI) * 0.25 * (i === 0 ? 1 : 0.6))); }
    // hair sway (a spring at the back of the head) — the side / back locks swing more than the cap
    const off = hairSwing.update(head, restHair, dt, 140, 8, 2.5, 0.08);
    const hx = clamp((off.z - restHair.z) * 2.2, -0.15, 0.15), hz = clamp(-(off.x - restHair.x) * 2.2, -0.12, 0.12);
    hair.rotation.set(hx * 0.4, 0, hz * 0.4);
    hairS.rotation.set(hx * 1.4, 0, hz * 1.4);
    // glowing strings: brighter while charging / playing
    chargeK = damp(chargeK, Math.max(clamp(fx.charge ?? 0), ak === 'chord' ? 1 : 0), 12, dt);
    glowM.color.copy(glowBase).lerp(glowHot, chargeK * (0.6 + 0.4 * Math.sin(tt * 30)));
    // glide wings
    glideK = damp(glideK, clamp(fx.glide ?? 0), 14, dt);
    vis(wings, glideK > 0.02);
    if (wings.visible) {
      wings.scale.setScalar(Math.max(0.001, easeOut(glideK)) * 1.1);
      const f = Math.sin(tt * 14) * 0.35;
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
      const f = Math.sin(tt * 30);
      batWings[0].rotation.set(0, 0, f * 0.7); batWings[1].rotation.set(0, 0, -f * 0.7);
      bat.position.y = 0.55 + Math.sin(tt * 30) * 0.02;
    }
    M.flash(a.flash);
  }

  setLook(L0);
  return {
    root: b.root, update, weaponTip, setLook,
    get look() { return { ...cur }; },
    dispose() { for (const m of M.all) m.dispose(); face.dispose(); glowM.dispose(); },
  };
}
