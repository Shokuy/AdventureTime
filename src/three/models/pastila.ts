import * as THREE from 'three';
import { canvasTex, basic, noOutline } from '../gfx';
import {
  G, Mats, TAU, clamp, lerp, damp, smooth, seg, easeOut, easeIn,
  grp, part, surf, vis, cached, merge, openLathe,
} from './kit';
import { bones, animator, stateExpr, Dangle, type HumanoidSpec, type Pose, type AtkOut } from './humanoid';
import { buildFace } from './face';
import type { HeroAnim, HeroAtk, HeroRig } from './hero';
import { cleanLook, DEFAULT_LOOKS, type HeroLook } from '../../net/profile';

/*
 * Пастила — the princess-scientist made of pastila: pastila-pink skin, layered cream-and-pink hair with a big bun,
 * a little gold crown with lab goggles pushed up on it, a white lab coat over a pink dress with a bow, stockings and
 * Mary Janes, and the syrup-syringe pistol in her right hand (a flask appears in her left for the smash).
 * Look slots: hat = crown gems, scarf = bow & sash, shirt = dress, shorts = stockings, boot = shoes, back = the syrup.
 */

const SPEC: HumanoidSpec = { CY: 0.46, hipY: 0.34, hipX: 0.062, thigh: 0.16, shin: 0.15, shoulderY: 0.64, shoulderX: 0.125, arm: 0.19, headY: 0.9 };
const R = 0.25;
const SKIN = '#ffc9da', SKIN_D = '#f2a6c0';
const HAIR = '#ffc4da', HAIR_P = '#ff96bf', COAT = '#f7f5f2', COAT_D = '#dcd8e4', GOLD = '#f2c23a', BRASS = '#d8a040';

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
    const r = 1 + 0.045 * k * k * Math.sin(a * 9) + 0.08 * Math.sin(k * Math.PI) ;
    p.setXYZ(i, x * r, y, z * r);
  }
  g.computeVertexNormals();
  return g;
});

/** the lab coat: open in front (wider gap toward the hem), from the shoulders to the knees */
const COAT_PROF: Array<[number, number]> = [[0.255, 0.16], [0.24, 0.24], [0.205, 0.34], [0.165, 0.44], [0.14, 0.52], [0.136, 0.6], [0.118, 0.655], [0.075, 0.69]];
const coatGap = (i: number) => lerp(0.95, 0.36, Math.pow(i / (COAT_PROF.length - 1), 0.7));
const coatGeo = () => cached('pastila-coat', () => openLathe(COAT_PROF, coatGap, 30, { zScale: 0.86 }));

/** the syrup-syringe pistol: grip at the origin (pointing down), barrel above it along +Z */
function syringe(M: Mats, syrupM: THREE.Material) {
  const g = new THREE.Group();
  g.name = 'syringe';
  const brass = M.get(BRASS), steel = M.get('#d4dbe6'), wood = M.get('#8a4a3a');
  // grip (a little curved wooden handle) + trigger guard
  part(g, G.capsule(0.022, 0.06), wood, [0, -0.02, -0.01], 1, [0.35, 0, 0]);
  part(g, G.torus(0.022, 0.005, 6, 14, ), brass, [0, 0.0, 0.035], 1, [0, Math.PI / 2, 0]);
  // barrel: glass tube with syrup, brass end caps and bands
  const glass = M.get('#e8f4ff', { transparent: true, opacity: 0.45 });
  part(g, G.cyl(), glass, [0, 0.06, 0.07], [0.034, 0.2, 0.034], [Math.PI / 2, 0, 0], { cast: false });
  const syrup = part(g, G.cyl(), syrupM, [0, 0.06, 0.08], [0.026, 0.15, 0.026], [Math.PI / 2, 0, 0]);
  part(g, cached('pastila-bands', () => merge([
    { g: G.cyl(), p: [0, 0.06, -0.03], s: [0.04, 0.025, 0.04], r: [Math.PI / 2, 0, 0] },
    { g: G.cyl(), p: [0, 0.06, 0.17], s: [0.04, 0.025, 0.04], r: [Math.PI / 2, 0, 0] },
    { g: G.cyl(), p: [0, 0.06, 0.07], s: [0.037, 0.012, 0.037], r: [Math.PI / 2, 0, 0] },
    { g: G.cone(), p: [0, 0.06, 0.2], s: [0.03, 0.04, 0.03], r: [Math.PI / 2, 0, 0] },
  ])), brass);
  // plunger + thumb ring at the back, needle in front
  const plunger = grp(g, [0, 0.06, -0.04]);
  part(plunger, G.cyl(), steel, [0, 0, -0.04], [0.008, 0.08, 0.008], [Math.PI / 2, 0, 0]);
  part(plunger, G.torus(0.022, 0.007, 6, 16), brass, [0, 0, -0.085], 1, [0, 0, 0]);
  part(g, G.cyl(), steel, [0, 0.06, 0.27], [0.005, 0.1, 0.005], [Math.PI / 2, 0, 0]);
  // a heart sight on top
  part(g, G.ball(), M.get('#ff4a8a'), [0, 0.1, 0.15], [0.012, 0.012, 0.008]);
  return { g, syrup, plunger };
}

function flask(M: Mats, liquidM: THREE.Material) {
  const g = new THREE.Group();
  const glass = M.get('#e8f4ff', { transparent: true, opacity: 0.5 });
  part(g, G.sphere(), glass, [0, 0.0, 0], [0.06, 0.06, 0.06], undefined, { cast: false });
  part(g, G.sphere(), liquidM, [0, -0.012, 0], [0.05, 0.042, 0.05]);
  part(g, G.cyl(), glass, [0, 0.07, 0], [0.018, 0.06, 0.018], undefined, { cast: false });
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
  const hairM = M.get(HAIR), hairP = M.get(HAIR_P);
  const layersM = M.own('#ffffff', { map: layerTex() });
  const gold = M.get(GOLD), brass = M.get(BRASS);

  const b = bones(SPEC, 'pastila');
  const { body, head } = b;

  // ── legs: stockings + Mary Janes ──
  for (const i of [0, 1]) {
    const { hip, knee } = b.legs[i];
    part(hip, G.capsule(0.043, 0.1), stockM, [0, -0.075, 0]);
    part(knee, G.capsule(0.039, 0.09), stockM, [0, -0.06, 0]);
    part(knee, G.sphere(), shoeM, [0, -0.135, 0.028], [0.055, 0.042, 0.085]);
    part(knee, G.sphere(), M.get('#5a1a3a'), [0, -0.16, -0.035], [0.03, 0.028, 0.03]);
    part(knee, G.torus(0.046, 0.009, 6, 16), shoeM, [0, -0.118, 0.035], [1, 1, 1], [0.35, 0, 0]);
    part(knee, G.ball(), gold, [i ? -0.045 : 0.045, -0.12, 0.04], 0.011);
  }

  // ── dress: bodice, bell skirt with a frill ──
  part(body, skirtGeo(), dressM, [0, 0.39, 0]);
  part(body, G.torus(0.2, 0.016, 8, 40), M.get('#fff3f6'), [0, 0.272, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
  part(body, G.sphere(), dressM, [0, 0.555, 0], [0.112, 0.125, 0.092]);
  part(body, G.torus(0.108, 0.018, 8, 28), bowM, [0, 0.49, 0], [1, 1, 0.84], [Math.PI / 2, 0, 0]); // sash

  // ── lab coat (open front), lapels, pocket with pens ──
  part(body, coatGeo(), coatM);
  for (const s of [1, -1]) {
    part(body, G.capsule(0.016, 0.13), coatD, [s * 0.062, 0.6, 0.095], 1, [0.12, 0, s * 0.42]);
    part(body, G.sphere(), coatM, [s * 0.1, 0.645, 0.0], [0.065, 0.045, 0.07]); // shoulder
  }
  const pocket = grp(body, [0.085, 0.53, 0.105], [0, 0.45, 0]);
  part(pocket, G.sphere(), coatD, undefined, [0.035, 0.03, 0.008]);
  part(pocket, G.capsule(0.006, 0.05), M.get('#3a6ad8'), [-0.012, 0.03, -0.003]);
  part(pocket, G.capsule(0.006, 0.04), M.get('#e8383d'), [0.012, 0.025, -0.003], 1, [0, 0, 0.15]);
  // the half-belt at the back of the coat
  part(body, G.capsule(0.016, 0.16), coatD, [0, 0.42, -0.16], 1, [0, 0, Math.PI / 2]);
  for (const s of [1, -1]) part(body, G.ball(), coatD, [s * 0.075, 0.42, -0.165], 0.013);
  // buttons
  for (const y of [0.36, 0.44]) for (const s of [1, -1]) part(body, G.ball(), coatD, [s * 0.13, y, 0.115 + (0.44 - y) * 0.5], 0.012);

  // ── the bow at the collar ──
  const bow = grp(body, [0, 0.665, 0.085], [-0.2, 0, 0]);
  for (const s of [1, -1]) {
    part(bow, G.sphere(), bowM, [s * 0.045, 0.004, 0], [0.042, 0.03, 0.02], [0, 0, s * 0.35]);
    part(bow, G.capsule(0.01, 0.05), bowM, [s * 0.02, -0.04, -0.004], 1, [0, 0, s * 0.3]);
  }
  part(bow, G.sphere(), bowM, undefined, [0.018, 0.018, 0.018]);

  // ── arms: coat sleeves with rolled cuffs ──
  for (const i of [0, 1]) {
    const { sh } = b.arms[i];
    part(sh, G.capsule(0.042, 0.1), coatM, [0, -0.07, 0]);
    part(sh, G.torus(0.04, 0.014, 8, 18), coatD, [0, -0.13, 0], 1, [Math.PI / 2, 0, 0]);
    part(sh, G.capsule(0.03, 0.04), skin, [0, -0.155, 0]);
    part(sh, G.sphere(), skin, [0, -0.192, 0.008], [0.036, 0.034, 0.036]);
  }

  // ── neck, head ──
  part(body, G.cyl(), skin, [0, 0.69, 0], [0.04, 0.06, 0.04]);
  part(head, G.sphere(), skin, undefined, [R, R * 0.98, R * 0.97]);
  const face = buildFace(head, M, {
    R, eyeYaw: 0.38, eyePitch: -0.16, eyeW: 0.042, eyeH: 0.056, skin: SKIN,
    lashes: true, brow: '#c8507a', mouthPitch: -0.6, mouthW: 0.026, nose: SKIN_D, cheek: '#ff7aa8', glint2: true,
  });

  // hair: a puffy layered bob, side curls, a big striped bun
  const hair = grp(head, undefined, undefined, 'hair');
  part(hair, G.dome(), hairM, [0, 0.015, -0.015], [R * 1.1, R * 1.12, R * 1.1], [-0.3, 0, 0]);
  part(hair, G.sphere(), layersM, [0, -0.04, -0.07], [R * 1.12, R * 0.86, R * 0.95]);
  for (const s of [1, -1]) {
    part(hair, G.sphere(), hairM, [s * 0.2, -0.08, -0.01], [0.085, 0.14, 0.13], [0, 0, s * 0.18]);
    part(hair, G.sphere(), hairP, [s * 0.21, -0.2, 0.02], [0.06, 0.065, 0.065]);
    part(hair, G.sphere(), hairM, [s * 0.215, -0.25, 0.03], [0.05, 0.05, 0.05]);
  }
  // bangs: a soft rounded fringe (overlapping puffs along the hairline)
  for (let i = 0; i < 7; i++) {
    const a = -0.75 + i * 0.25;
    const f = surf(hair, a, 0.36 - Math.abs(a) * 0.12, R * 1.0);
    part(f, G.sphere(), hairM, [0, 0, 0.012], [0.072, 0.06, 0.045]);
  }
  // the bun: pastila layers
  const bun = grp(hair, [0, 0.27, -0.08], [-0.35, 0, 0]);
  part(bun, G.sphere(), layersM, undefined, [0.13, 0.11, 0.13]);
  part(bun, G.torus(0.105, 0.025, 8, 24), hairP, [0, -0.06, 0], 1, [Math.PI / 2, 0, 0]);

  // crown (gems = look) with lab goggles pushed up on it
  const crown = grp(head, [0, 0.262, 0.07], [-0.3, 0, 0]);
  crown.scale.setScalar(1.25);
  part(crown, cached('pastila-crown', () => merge([
    { g: new THREE.CylinderGeometry(0.075, 0.085, 0.035, 24, 1, true) },
    ...[0, 1, 2, 3, 4].map((i) => {
      const a = -0.9 + i * 0.45;
      return { g: G.cone(), p: [Math.sin(a) * 0.08, 0.04 + (i === 2 ? 0.015 : 0), Math.cos(a) * 0.08] as [number, number, number], s: [0.02, i === 2 ? 0.07 : 0.05, 0.015] as [number, number, number] };
    }),
  ])), gold);
  for (let i = 0; i < 3; i++) {
    const a = -0.45 + i * 0.45;
    part(crown, G.ball(), gemM, [Math.sin(a) * 0.087, 0.0, Math.cos(a) * 0.087], i === 1 ? 0.017 : 0.012);
  }
  const goggles = surf(head, 0, 0.62, R * 1.1);
  goggles.rotation.x = -0.25;
  const lensM = basic('#9ff0ff', { transparent: true, opacity: 0.85 });
  for (const s of [1, -1]) {
    part(goggles, G.cyl(), brass, [s * 0.066, 0, 0.015], [0.05, 0.035, 0.05], [Math.PI / 2, 0, 0]);
    part(goggles, G.torus(0.048, 0.011, 8, 20), brass, [s * 0.066, 0, 0.033]);
    part(goggles, G.sphere(), lensM, [s * 0.066, 0, 0.032], [0.04, 0.04, 0.012], undefined, { cast: false });
    part(goggles, G.ball(), basic('#ffffff'), [s * 0.066 + 0.013, 0.015, 0.042], 0.009, undefined, { cast: false });
  }
  part(goggles, G.capsule(0.011, 0.03), brass, [0, 0, 0.015], 1, [0, 0, Math.PI / 2]);

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
  // a puff of syrup at the needle when she shoots
  const puffM = basic('#ffffff', { transparent: true, opacity: 0.8, depthWrite: false });
  const puff = noOutline(part(gun.g, G.ball(), puffM, [0, 0.06, 0.34], 0.03, undefined, { cast: false }));
  vis(puff, false);

  const hairSwing = new Dangle();
  const anim = animator(SPEC, b);

  function attack(A: Pose, kind: HeroAtk, p: number): AtkOut {
    if (kind === 'syringe') {
      const aim = smooth(seg(p, 0, 0.18)), kick = seg(p, 0.2, 0.35);
      const rec = Math.sin(kick * Math.PI) * 0.35;
      A.aRp = lerp(-0.6, -1.55, aim) - rec * 0.3; A.aRy = 0.12; A.aRr = 0;
      A.blade = -rec * 0.6;
      A.aLp = lerp(0.04, -1.2, aim); A.aLy = -0.5; A.aLr = 0.25; // steadying hand
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
  function update(dt: number, a: HeroAnim) {
    dt = Math.min(dt, 0.1);
    const ak = a.attack?.kind, ap = a.attack ? clamp(a.attack.p) : 0;
    anim.update(dt, a, attack, (T, st) => {
      // the pistol rests pointing down-forward; she's a little prim when idle
      T.blade = st === 'run' || st === 'walk' ? -0.35 : st === 'jump' || st === 'fall' || st === 'tumble' ? -0.6 : -0.95;
      if (st === 'idle') { T.aLp -= 0.15; T.aLy = -0.4; T.aLr = 0.3; T.headZ += 0.04; }
    });
    const C = anim.C;
    b.arms[1].mount.rotation.x = C.blade - C.aRp;
    // the flask only during the smash
    const flasking = ak === 'flask' || ak === 'flaskAlt';
    vis(flaskG, flasking && ap < 0.62);
    if (flasking) b.arms[0].mount.rotation.x = -C.aLp - 0.4;
    else b.arms[0].mount.rotation.x = 0;
    // shot: plunger pushes in, a syrup puff at the needle
    const shooting = ak === 'syringe';
    const kick = shooting ? seg(ap, 0.2, 0.4) : 0;
    gun.plunger.position.z = -0.04 + (shooting ? 0.05 * Math.sin(kick * Math.PI) : 0);
    vis(puff, shooting && kick > 0 && kick < 1);
    if (puff.visible) { puff.scale.setScalar(0.02 + kick * 0.06); puffM.opacity = 0.8 * (1 - kick); puffM.color.copy(syrupM.color).lerp(new THREE.Color('#ffffff'), 0.4); }
    face.update(dt, stateExpr(a), clamp(a.talk), anim.t);
    const off = hairSwing.update(head, restHair, dt, 140, 8, 2.5, 0.08);
    hair.rotation.x = clamp((off.z - restHair.z) * 2.0, -0.12, 0.12);
    hair.rotation.z = clamp(-(off.x - restHair.x) * 2.0, -0.1, 0.1);
    void damp; void easeOut; void TAU; void surf;
    M.flash(a.flash);
  }

  setLook(L0);
  return {
    root: b.root, update, weaponTip, setLook,
    get look() { return { ...cur }; },
    dispose() { for (const m of M.all) m.dispose(); face.dispose(); lensM.dispose(); puffM.dispose(); },
  };
}
