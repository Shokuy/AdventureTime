import * as THREE from 'three';
import { canvasTex, basic, noOutline } from '../gfx';
import {
  G, Mats, TAU, clamp, lerp, damp, smooth, seg, easeIn,
  grp, part, surf, vis, cached, merge, openLathe,
} from './kit';
import { bones, animator, stateExpr, Dangle, type HumanoidSpec, type Pose, type AtkOut } from './humanoid';
import { buildToonFace } from './toonFace';
import { flatten, puffGeo, disposeBaked } from './toonKit';
import type { HeroAnim, HeroAtk, HeroRig } from './hero';
import { cleanLook, DEFAULT_LOOKS, type HeroLook } from '../../net/profile';

/*
 * Пастила — the princess-scientist made of pastila. Silhouette: a HUGE cloud of marshmallow-pink hair (soft puffs,
 * two bouncy side puffs, pastila-layer stripes in the big top puff) with a little gold crown perched on top and brass
 * lab goggles (glass with a sheen) pushed up on the fringe; a white lab coat (syrup stains, a pocket with a test
 * tube and pens) over a pink dress with a big bow; stockings and Mary Janes; the syrup-syringe pistol in her right
 * hand (a flask appears in her left for the smash). Face: big teal eyes with lashes, pink blush.
 * Idle: pushes her goggles up every few seconds, weight on one hip; lectures with a raised finger when she talks;
 * pulls the goggles down over her eyes while picking a gadget (fx.gadget).
 * Look slots: hat = crown gems, scarf = bow & sash, shirt = dress, shorts = stockings, boot = shoes, back = the syrup.
 */

const SPEC: HumanoidSpec = { CY: 0.46, hipY: 0.34, hipX: 0.062, thigh: 0.16, shin: 0.15, shoulderY: 0.64, shoulderX: 0.125, arm: 0.19, headY: 0.9 };
const R = 0.25;
const SKIN = '#ffd2e0', SKIN_D = '#f4a8c2';
const HAIR = '#ffc2d8', HAIR_P = '#ff8fbb', HAIR_L = '#fff0f5', COAT = '#fbf9f6', COAT_D = '#dcd8e6', GOLD = '#f6c43a', BRASS = '#d8a040';

let layerTexC: THREE.Texture | null = null;
/** pastila candy layers: cream and pink stripes */
const layerTex = () => (layerTexC ??= canvasTex(8, 64, (g, w, h) => {
  const cols = ['#fff1f5', '#ff9cc4', '#ffd2e2', '#ff8ab6', '#fff1f5', '#ffb0cc'];
  for (let i = 0; i < 6; i++) { g.fillStyle = cols[i]; g.fillRect(0, (i * h) / 6, w, h / 6 + 1); }
}, { wrap: true }));

const skirtGeo = () => cached('pastila-skirt', () => {
  const g = new THREE.CylinderGeometry(0.1, 0.19, 0.24, 36, 3, true);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(x, z);
    const k = (0.12 - y) / 0.24;
    const r = 1 + 0.045 * k * k * Math.sin(a * 9) + 0.08 * Math.sin(k * Math.PI);
    p.setXYZ(i, x * r, y, z * r);
  }
  g.computeVertexNormals();
  return g;
});

/** the lab coat: open in front (wider gap toward the hem), from the shoulders to the knees */
const COAT_PROF: Array<[number, number]> = [[0.26, 0.15], [0.245, 0.24], [0.208, 0.34], [0.167, 0.44], [0.142, 0.52], [0.138, 0.6], [0.12, 0.655], [0.076, 0.69]];
const coatGap = (i: number) => lerp(0.95, 0.36, Math.pow(i / (COAT_PROF.length - 1), 0.7));
const coatGeo = () => cached('pastila-coat', () => openLathe(COAT_PROF, coatGap, 30, {
  zScale: 0.86,
  ripple: (phi, i) => 1 + (i < 3 ? 0.03 * Math.sin(phi * 7) * (1 - i / 3) : 0),
}));
/** a point on the coat surface (for stains / pocket), pushed out a bit */
const coatAt = (phi: number, y: number, push = 1.03): [number, number, number] => {
  let i = 0;
  while (i < COAT_PROF.length - 2 && COAT_PROF[i + 1][1] < y) i++;
  const [r0, y0] = COAT_PROF[i], [r1, y1] = COAT_PROF[i + 1];
  const r = lerp(r0, r1, clamp((y - y0) / (y1 - y0))) * push;
  return [r * Math.sin(phi), y, r * Math.cos(phi) * 0.86];
};

/** the syrup-syringe pistol: grip at the origin (pointing down), barrel above it along +Z */
function syringe(M: Mats, syrupM: THREE.Material) {
  const g = new THREE.Group();
  g.name = 'syringe';
  const brass = M.get(BRASS), steel = M.get('#d4dbe6'), wood = M.get('#8a4a3a');
  const st = grp(g);
  part(st, G.capsule(0.022, 0.06), wood, [0, -0.02, -0.01], 1, [0.35, 0, 0]);
  part(st, G.torus(0.022, 0.005, 6, 14), brass, [0, 0.0, 0.035], 1, [0, Math.PI / 2, 0]);
  part(st, cached('pastila-bands', () => merge([
    { g: G.cyl(), p: [0, 0.06, -0.03], s: [0.04, 0.025, 0.04], r: [Math.PI / 2, 0, 0] },
    { g: G.cyl(), p: [0, 0.06, 0.17], s: [0.04, 0.025, 0.04], r: [Math.PI / 2, 0, 0] },
    { g: G.cyl(), p: [0, 0.06, 0.07], s: [0.037, 0.012, 0.037], r: [Math.PI / 2, 0, 0] },
    { g: G.cone(), p: [0, 0.06, 0.2], s: [0.03, 0.04, 0.03], r: [Math.PI / 2, 0, 0] },
  ])), brass);
  part(st, G.cyl(), steel, [0, 0.06, 0.27], [0.005, 0.1, 0.005], [Math.PI / 2, 0, 0]);
  part(st, G.ball(), M.get('#ff4a8a'), [0, 0.1, 0.15], [0.012, 0.012, 0.008]);
  flatten(st);
  const glass = M.get('#e8f4ff', { transparent: true, opacity: 0.45 });
  noOutline(part(g, G.cyl(), glass, [0, 0.06, 0.07], [0.034, 0.2, 0.034], [Math.PI / 2, 0, 0], { cast: false }));
  const syrup = part(g, G.cyl(), syrupM, [0, 0.06, 0.08], [0.026, 0.15, 0.026], [Math.PI / 2, 0, 0]);
  const plunger = grp(g, [0, 0.06, -0.04]);
  part(plunger, G.cyl(), steel, [0, 0, -0.04], [0.008, 0.08, 0.008], [Math.PI / 2, 0, 0]);
  part(plunger, G.torus(0.022, 0.007, 6, 16), brass, [0, 0, -0.085], 1, [0, 0, 0]);
  return { g, syrup, plunger };
}

function flask(M: Mats, liquidM: THREE.Material) {
  const g = new THREE.Group();
  const glass = M.get('#e8f4ff', { transparent: true, opacity: 0.5 });
  noOutline(part(g, G.sphere(), glass, [0, 0.0, 0], [0.06, 0.06, 0.06], undefined, { cast: false }));
  part(g, G.sphere(), liquidM, [0, -0.012, 0], [0.05, 0.042, 0.05]);
  noOutline(part(g, G.cyl(), glass, [0, 0.07, 0], [0.018, 0.06, 0.018], undefined, { cast: false }));
  part(g, G.cyl(), M.get('#a8724a'), [0, 0.105, 0], [0.021, 0.02, 0.021]);
  return g;
}

export function createPastila(look: Partial<HeroLook> = DEFAULT_LOOKS.pastila): HeroRig {
  const M = new Mats();
  const base = DEFAULT_LOOKS.pastila;
  const L0 = cleanLook(look, base);
  const gemM = M.own(L0.hatColor);
  const bowM = M.own(L0.scarfColor);
  const dressM = M.own(L0.shirtColor, { side: THREE.DoubleSide });
  const stockM = M.own(L0.shortsColor);
  const shoeM = M.own(L0.bootColor);
  const syrupM = M.own(L0.backColor);
  syrupM.emissive.set('#000000');
  const skin = M.get(SKIN), skinD = M.get(SKIN_D);
  const coatM = M.get(COAT, { side: THREE.DoubleSide }), coatD = M.get(COAT_D);
  const hairM = M.get(HAIR), hairP = M.get(HAIR_P), hairL = M.get(HAIR_L);
  const layersM = M.own('#ffffff', { map: layerTex() });
  const gold = M.get(GOLD), brass = M.get(BRASS);

  const b = bones(SPEC, 'pastila');
  const { body, head } = b;

  // ── legs: stockings + Mary Janes ──
  for (const i of [0, 1]) {
    const { hip, knee } = b.legs[i];
    part(hip, G.capsule(0.043, 0.1), stockM, [0, -0.075, 0]);
    const k = grp(knee);
    part(k, G.capsule(0.039, 0.09), stockM, [0, -0.06, 0]);
    part(k, G.sphere(), shoeM, [0, -0.135, 0.03], [0.058, 0.044, 0.09]);
    part(k, G.cyl(), M.get('#5a1a3a'), [0, -0.172, 0.03], [0.06, 0.012, 0.092]);
    part(k, G.sphere(), M.get('#5a1a3a'), [0, -0.16, -0.035], [0.03, 0.03, 0.03]);
    part(k, G.torus(0.046, 0.009, 6, 16), shoeM, [0, -0.118, 0.035], [1, 1, 1], [0.35, 0, 0]);
    part(k, G.ball(), gold, [i ? -0.045 : 0.045, -0.12, 0.04], 0.012);
    // a little bow on each shoe
    for (const s of [1, -1]) part(k, G.sphere(), bowM, [s * 0.016, -0.115, 0.1], [0.016, 0.011, 0.008], [0, 0, s * 0.4]);
    flatten(k);
  }

  // ── dress, coat, bow — baked into one static group ──
  const outfit = grp(body);
  part(outfit, skirtGeo(), dressM, [0, 0.39, 0]);
  part(outfit, G.torus(0.2, 0.017, 8, 40), M.get('#fff3f6'), [0, 0.272, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
  // a lace frill: little scallops on the hem
  part(outfit, cached('pastila-lace', () => merge(Array.from({ length: 22 }, (_, i) => {
    const a = (i / 22) * TAU;
    return { g: G.ball(), p: [Math.sin(a) * 0.205, 0.258, Math.cos(a) * 0.205] as [number, number, number], s: [0.022, 0.016, 0.012] as [number, number, number], r: [0, a, 0] as [number, number, number] };
  }))), M.get('#fff3f6'));
  part(outfit, G.sphere(), dressM, [0, 0.555, 0], [0.114, 0.127, 0.094]);
  part(outfit, G.torus(0.108, 0.018, 8, 28), bowM, [0, 0.49, 0], [1, 1, 0.84], [Math.PI / 2, 0, 0]); // sash
  // lab coat (open front), lapels, collar, shoulders
  part(outfit, coatGeo(), coatM);
  for (const s of [1, -1]) {
    part(outfit, G.capsule(0.017, 0.13), coatD, [s * 0.062, 0.6, 0.097], 1, [0.12, 0, s * 0.42]);
    part(outfit, G.sphere(), coatM, [s * 0.1, 0.645, 0.0], [0.068, 0.048, 0.072]);
    part(outfit, G.sphere(), coatM, [s * 0.06, 0.69, -0.03], [0.05, 0.035, 0.03], [0.4, s * 0.8, s * 0.3]); // collar wing
  }
  // the pocket with a test tube and pens, syrup stains, buttons, the back half-belt
  const pk = coatAt(0.62, 0.52, 1.0);
  const pocket = grp(outfit, pk, [0, 0.62, 0]);
  part(pocket, G.sphere(), coatD, undefined, [0.036, 0.032, 0.008]);
  part(pocket, G.capsule(0.006, 0.05), M.get('#3a6ad8'), [-0.014, 0.03, -0.003]);
  part(pocket, G.capsule(0.006, 0.04), M.get('#e8383d'), [0.0, 0.026, -0.003], 1, [0, 0, 0.15]);
  part(pocket, G.capsule(0.009, 0.05), M.get('#e8f4ff'), [0.016, 0.032, -0.004], 1, [0, 0, -0.12]);
  part(pocket, G.capsule(0.0075, 0.03), syrupM, [0.017, 0.022, -0.004], 1, [0, 0, -0.12]);
  part(pocket, G.cyl(), M.get('#a8724a'), [0.021, 0.064, -0.004], [0.01, 0.012, 0.01], [0, 0, -0.12]);
  for (const [phi, y, sc] of [[-0.75, 0.33, 0.026], [-0.9, 0.29, 0.014], [0.85, 0.24, 0.02], [2.6, 0.4, 0.024], [-0.6, 0.47, 0.012]] as const) {
    const at = coatAt(phi, y, 1.01);
    part(outfit, G.sphere(), syrupM, at, [sc, sc * 0.8, 0.006], [0, phi, 0], { cast: false });
    part(outfit, G.sphere(), syrupM, [at[0], at[1] - sc * 0.9, at[2]], [sc * 0.35, sc * 0.6, 0.005], [0, phi, 0], { cast: false }); // a drip
  }
  part(outfit, G.capsule(0.016, 0.16), coatD, [0, 0.42, -0.163], 1, [0, 0, Math.PI / 2]);
  for (const s of [1, -1]) part(outfit, G.ball(), coatD, [s * 0.075, 0.42, -0.168], 0.013);
  for (const y of [0.36, 0.44]) for (const s of [1, -1]) part(outfit, G.ball(), coatD, [s * 0.13, y, 0.115 + (0.44 - y) * 0.5], 0.012);
  // the bow at the collar
  const bow = grp(outfit, [0, 0.668, 0.088], [-0.2, 0, 0]);
  for (const s of [1, -1]) {
    part(bow, G.sphere(), bowM, [s * 0.05, 0.006, 0], [0.05, 0.034, 0.022], [0, 0, s * 0.35]);
    part(bow, G.capsule(0.011, 0.06), bowM, [s * 0.024, -0.046, -0.004], 1, [0, 0, s * 0.3]);
  }
  part(bow, G.sphere(), bowM, undefined, [0.02, 0.02, 0.02]);
  part(outfit, G.cyl(), skin, [0, 0.69, 0], [0.04, 0.06, 0.04]);
  flatten(outfit);

  // ── arms: coat sleeves with rolled cuffs; a lecturing finger ──
  const fingers: THREE.Mesh[] = [];
  for (const i of [0, 1]) {
    const { sh, mount } = b.arms[i];
    const a = grp(sh);
    part(a, G.capsule(0.043, 0.1), coatM, [0, -0.07, 0]);
    part(a, G.torus(0.041, 0.015, 8, 18), coatD, [0, -0.13, 0], 1, [Math.PI / 2, 0, 0]);
    part(a, G.capsule(0.03, 0.04), skin, [0, -0.155, 0]);
    part(a, G.sphere(), skin, [0, -0.192, 0.008], [0.037, 0.035, 0.037]);
    flatten(a);
    if (i === 0) { const f = part(mount, G.capsule(0.0095, 0.04), skin, [0, -0.03, 0.02], 1, [0.2, 0, 0]); f.rotation.x = Math.PI + 0.2; vis(f, false); fingers.push(f); }
  }

  // ── head + face ──
  part(head, G.sphere(), skin, undefined, [R, R * 0.98, R * 0.97]);
  const face = buildToonFace(head, M, {
    R, eyeYaw: 0.37, eyePitch: -0.14, eyeW: 0.055, eyeH: 0.066, eyeTilt: -0.04,
    iris: '#1fb5c4', irisDark: '#0a4a62', irisSize: 0.76, lidMat: skin, lidRest: 0,
    lash: '#3a1430', lashes: 3, brow: '#d0507e', browThick: 0.01, browW: 0.04, browLift: 1.75, browOut: 1.04,
    mouthPitch: -0.56, mouthW: 0.038, cheek: '#ff6fa2', mouthColor: '#7a1838', tongueColor: '#ff8fae',
    nose: { mat: skinD, w: 0.011, h: 0.009 },
  });

  // ── hair: a cloud of marshmallow puffs ──
  const hair = grp(head, undefined, undefined, 'hair');
  const P = (parent: THREE.Object3D, p: [number, number, number], s: number | [number, number, number], m: THREE.Material, seed = 1) => part(parent, puffGeo(seed, 0.06), m, p, s);
  part(hair, G.dome(), hairM, [0, 0.01, -0.01], [R * 1.1, R * 1.12, R * 1.1], [-0.5, 0, 0]);
  P(hair, [0, -0.02, -0.07], [R * 1.1, R * 0.98, R * 0.95], hairM, 2);
  // the big top cloud (the middle puff shows the pastila layers)
  P(hair, [0, 0.2, -0.05], [0.17, 0.13, 0.16], layersM, 3);
  P(hair, [0.14, 0.15, -0.02], [0.12, 0.11, 0.12], hairM, 4);
  P(hair, [-0.14, 0.16, -0.03], [0.12, 0.11, 0.12], hairM, 5);
  P(hair, [0.0, 0.14, -0.17], [0.15, 0.12, 0.12], hairM, 6);
  P(hair, [0.17, 0.04, -0.12], [0.11, 0.12, 0.11], hairM, 7);
  P(hair, [-0.17, 0.05, -0.12], [0.11, 0.12, 0.11], hairM, 8);
  P(hair, [0.0, -0.06, -0.21], [0.15, 0.13, 0.1], layersM, 9);
  // a few pale highlight puffs
  P(hair, [0.07, 0.29, 0.02], [0.05, 0.035, 0.045], hairL, 10);
  P(hair, [-0.12, 0.23, 0.07], [0.04, 0.03, 0.035], hairL, 11);
  // bubble fringe along the hairline
  for (let i = 0; i < 7; i++) {
    const a = -0.78 + i * 0.26;
    const f = surf(hair, a, 0.42 - Math.abs(a) * 0.16, R * 1.0);
    P(f, [0, -0.005, 0.014], [0.066, 0.058, 0.045], i % 3 === 1 ? hairP : hairM, 12 + i);
  }
  // side puffs (marshmallow pigtails) on springs
  const sides: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const piv = grp(head, [s * 0.2, 0.02, -0.03], undefined, 'pigtail');
    P(piv, [s * 0.04, -0.09, 0], [0.1, 0.12, 0.1], hairM, 20 + s);
    P(piv, [s * 0.06, -0.21, 0.01], [0.085, 0.09, 0.085], hairP, 22 + s);
    P(piv, [s * 0.065, -0.3, 0.015], [0.06, 0.06, 0.06], hairM, 24 + s);
    part(piv, G.torus(0.06, 0.016, 8, 20), bowM, [s * 0.05, -0.155, 0.0], 1, [Math.PI / 2, 0, 0]); // hair tie
    flatten(piv);
    piv.userData.keep = true;
    sides.push(piv);
  }
  flatten(hair);

  // crown (gems = look) perched on the cloud
  const crown = grp(head, [0.04, 0.33, -0.02], [-0.15, 0, -0.22], 'crown');
  crown.scale.setScalar(1.25);
  part(crown, cached('pastila-crown', () => merge([
    { g: new THREE.CylinderGeometry(0.075, 0.085, 0.035, 24, 1, false) },
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => {
      const a = (i / 7) * TAU;
      return { g: G.cone(), p: [Math.sin(a) * 0.078, 0.042, Math.cos(a) * 0.078] as [number, number, number], s: [0.02, i === 0 ? 0.07 : 0.05, 0.015] as [number, number, number] };
    }),
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => {
      const a = (i / 7) * TAU;
      return { g: G.ball(), p: [Math.sin(a) * 0.078, 0.08 + (i === 0 ? 0.02 : 0), Math.cos(a) * 0.078] as [number, number, number], s: 0.009 };
    }),
  ])), gold);
  for (let i = 0; i < 3; i++) {
    const a = -0.6 + i * 0.6;
    part(crown, G.ball(), gemM, [Math.sin(a) * 0.087, 0.0, Math.cos(a) * 0.087], i === 1 ? 0.018 : 0.012);
  }
  flatten(crown);

  // lab goggles pushed up on the fringe (pulled down over her eyes while she picks a gadget)
  const gogPiv = grp(head, undefined, undefined, 'goggles');
  const goggles = grp(gogPiv);
  const lensM = M.get('#8fe8f4', { transparent: true, opacity: 0.8 });
  const sheenM = basic('#ffffff');
  const strap = M.get('#6a3a2a');
  const gogFront = grp(goggles, [0, 0, R * 1.17]);
  for (const s of [1, -1]) {
    part(gogFront, G.cyl(), brass, [s * 0.068, 0, -0.008], [0.052, 0.036, 0.052], [Math.PI / 2, 0, 0]);
    part(gogFront, G.torus(0.05, 0.012, 8, 22), brass, [s * 0.068, 0, 0.012]);
    part(gogFront, G.sphere(), lensM, [s * 0.068, 0, 0.01], [0.042, 0.042, 0.014], undefined, { cast: false });
    noOutline(part(gogFront, G.capsule(0.006, 0.026), sheenM, [s * 0.068 + 0.012, 0.012, 0.025], 1, [0, 0, -0.7], { cast: false }));
    noOutline(part(gogFront, G.ball(), sheenM, [s * 0.068 - 0.016, -0.018, 0.024], 0.005, undefined, { cast: false }));
    for (let k = 0; k < 4; k++) { const an = (k / 4) * TAU + 0.4; part(gogFront, G.ball(), brass, [s * 0.068 + Math.cos(an) * 0.05, Math.sin(an) * 0.05, 0.02], 0.007); } // rivets
  }
  part(gogFront, G.capsule(0.012, 0.03), brass, [0, 0, 0.0], 1, [0, 0, Math.PI / 2]);
  // the strap around the hair
  part(goggles, G.torus(R * 1.13, 0.012, 8, 40), strap, [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
  flatten(goggles);
  const GOG_UP = -0.82, GOG_DOWN = 0.18;
  gogPiv.rotation.x = GOG_UP;

  // ── the syringe pistol (right hand) + a flask (left hand, for the smash) ──
  const gun = syringe(M, syrupM);
  const hand = grp(b.arms[1].mount, [0, -0.01, 0.0]);
  hand.add(gun.g);
  gun.g.scale.setScalar(1.35);
  const weaponTip = new THREE.Object3D();
  weaponTip.position.set(0, 0.06, 0.32);
  gun.g.add(weaponTip);
  const flaskG = flask(M, syrupM);
  const lhand = grp(b.arms[0].mount, [0, -0.06, 0.02]);
  lhand.add(flaskG);
  vis(flaskG, false);
  const puffM = basic('#ffffff', { transparent: true, opacity: 0.8, depthWrite: false });
  const puff = part(gun.g, G.ball(), puffM, [0, 0.06, 0.34], 0.03, undefined, { cast: false });
  noOutline(puff);
  vis(puff, false);

  const hairSwing = new Dangle();
  const sideSwing = [new Dangle(), new Dangle()];
  const anim = animator(SPEC, b);
  let gogT = 3 + Math.random() * 3, gogK = 0, gadgetK = 0;

  function attack(A: Pose, kind: HeroAtk, p: number): AtkOut {
    if (kind === 'syringe') {
      const aim = smooth(seg(p, 0, 0.18)), kick = seg(p, 0.2, 0.35);
      const rec = Math.sin(kick * Math.PI) * 0.35;
      A.aRp = lerp(-0.6, -1.55, aim) - rec * 0.3; A.aRy = 0.12; A.aRr = 0;
      A.blade = -rec * 0.6;
      A.aLp = lerp(0.04, -1.2, aim); A.aLy = -0.5; A.aLr = 0.25;
      A.leanX = 0.05 - rec * 0.25; A.twist = -0.12;
      A.hipL = -0.3; A.kneeL = 0.3; A.hipR = 0.25; A.kneeR = 0.12; A.headX = -0.05;
      return { w: 1 - smooth(seg(p, 0.7, 1)) };
    }
    if (kind === 'flask' || kind === 'flaskAlt') {
      const wind = smooth(seg(p, 0, 0.3)), hit = easeIn(seg(p, 0.3, 0.48));
      A.aLp = lerp(lerp(0.04, -2.9, wind), -0.7, hit); A.aLy = 0.15; A.aLr = 0.2;
      A.aRp = -0.3; A.aRr = -0.4; A.blade = 0.6;
      A.leanX = lerp(-0.12 * wind, 0.35, hit); A.twist = 0.25 * wind - 0.2 * hit;
      A.hipL = -0.45; A.kneeL = 0.5; A.hipR = 0.3; A.kneeR = 0.2; A.headX = -0.1 * wind + 0.15 * hit;
      return { w: 1 - smooth(seg(p, 0.72, 1)) };
    }
    return { w: 0 };
  }

  let cur: HeroLook = { ...L0 };
  function setLook(patch: Partial<HeroLook>) {
    const l = cleanLook({ ...cur, ...patch }, base);
    cur = l;
    gemM.color.set(l.hatColor);
    bowM.color.set(l.scarfColor);
    dressM.color.set(l.shirtColor);
    stockM.color.set(l.shortsColor);
    shoeM.color.set(l.bootColor);
    syrupM.color.set(l.backColor);
  }

  const restHair = new THREE.Vector3(0, -0.2, -0.05);
  const restSide = new THREE.Vector3(0, -0.25, 0);
  function update(dt: number, a: HeroAnim) {
    dt = Math.min(dt, 0.1);
    const ak = a.attack?.kind, ap = a.attack ? clamp(a.attack.p) : 0;
    const talk = clamp(a.talk);
    const fx = a.fx ?? {};
    const tt = anim.t;
    // the goggle fidget: every few seconds in idle she pushes them up with her left hand
    const idle = a.state === 'idle' && !ak && talk < 0.05;
    if (idle) { gogT -= dt; if (gogT < 0) { gogK += dt / 1.4; if (gogK >= 1) { gogK = 0; gogT = 5 + Math.random() * 4; } } } else { gogK = 0; gogT = Math.max(gogT, 2); }
    const fid = Math.sin(clamp(gogK) * Math.PI);
    anim.update(dt, a, attack, (T, st) => {
      T.blade = st === 'run' || st === 'walk' ? -0.2 : st === 'jump' || st === 'fall' || st === 'tumble' ? -0.6 : st === 'idle' || st === 'sit' || st === 'lookUp' || st === 'facepalm' || st === 'bow' ? 0.4 : -0.95;
      if (st === 'idle') {
        // weight on one hip, the free hand at her side; the goggle push; lecturing when talking
        T.leanZ -= 0.03; T.hipR -= 0.05; T.kneeL += 0.1; T.headZ += 0.05 + 0.03 * Math.sin(tt * 1.1);
        T.aLp -= 0.15; T.aLy = -0.4; T.aLr = 0.3;
        if (fid > 0) { T.aLp = lerp(T.aLp, -2.75, fid); T.aLy = lerp(T.aLy, -0.55, fid); T.aLr = lerp(T.aLr, 0.2, fid); T.headX -= 0.12 * fid; }
        if (talk > 0.05) { T.aLp = -1.35 + Math.sin(tt * 3.6) * 0.18; T.aLy = -0.25; T.aLr = 0.25; T.headZ += Math.sin(tt * 2.1) * 0.06; T.headX += Math.sin(tt * 4.4) * 0.04; }
      }
      if (st === 'cheer') { T.aRr = -1.0; T.aRp = -0.5; } // the pistol stays out of her face
      if (fx.gadget) { T.aLp = -1.0; T.aLy = -0.6; T.aLr = 0.4; T.headX = 0.1; }
    });
    const C = anim.C;
    b.arms[1].mount.rotation.x = C.blade - C.aRp;
    const flasking = ak === 'flask' || ak === 'flaskAlt';
    vis(flaskG, flasking && ap < 0.62);
    if (flasking) b.arms[0].mount.rotation.x = -C.aLp - 0.4;
    else b.arms[0].mount.rotation.x = 0;
    vis(fingers[0], talk > 0.05 && a.state === 'idle' && !ak);
    // shot: plunger pushes in, a syrup puff at the needle
    const shooting = ak === 'syringe';
    const kick = shooting ? seg(ap, 0.2, 0.4) : 0;
    gun.plunger.position.z = -0.04 + (shooting ? 0.05 * Math.sin(kick * Math.PI) : 0);
    vis(puff, shooting && kick > 0 && kick < 1);
    if (puff.visible) { puff.scale.setScalar(0.02 + kick * 0.06); puffM.opacity = 0.8 * (1 - kick); puffM.color.copy(syrupM.color).lerp(new THREE.Color('#ffffff'), 0.4); }
    // goggles: nudged by the fidget, pulled down for the gadget wheel
    gadgetK = damp(gadgetK, fx.gadget ? 1 : 0, 10, dt);
    gogPiv.rotation.x = lerp(GOG_UP + 0.08 * Math.sin(clamp(gogK * 1.6) * Math.PI), GOG_DOWN, smooth(gadgetK));
    face.update(dt, stateExpr(a), talk, { look: fid > 0.3 ? { x: 0, y: 1 } : gadgetK > 0.5 ? { x: Math.sin(tt * 3) * 0.6, y: 0 } : null, browBias: fid * 0.3 });
    // hair: the cloud sways a little, the side puffs bounce
    const off = hairSwing.update(head, restHair, dt, 140, 8, 2.5, 0.08);
    hair.rotation.x = clamp((off.z - restHair.z) * 1.6, -0.1, 0.1);
    hair.rotation.z = clamp(-(off.x - restHair.x) * 1.6, -0.08, 0.08);
    for (let i = 0; i < 2; i++) {
      const o = sideSwing[i].update(sides[i], restSide, dt, 90, 5, 3, 0.12);
      sides[i].rotation.x = clamp((o.z - restSide.z) * 3, -0.5, 0.5);
      sides[i].rotation.z = clamp(-(o.x - restSide.x) * 3, -0.4, 0.4);
    }
    M.flash(a.flash);
  }

  setLook(L0);
  return {
    root: b.root, update, weaponTip, setLook,
    get look() { return { ...cur }; },
    dispose() { for (const m of M.all) m.dispose(); face.dispose(); puffM.dispose(); sheenM.dispose(); disposeBaked(b.root); },
  };
}
