import * as THREE from 'three';
import { basic, noOutline } from '../gfx';
import {
  G, Mats, TAU, clamp, lerp, damp, smooth, seg, easeOut, easeInOut, wrapAngle,
  grp, part, surf, vis, cached, merge, Blinker, arcRibbon,
} from './kit';
import type { HeroAnim, HeroExpr, HeroRig, HeroState } from './hero';
import { Dangle } from './humanoid';
import { buildToonFace } from './toonFace';
import { flatten, disposeBaked } from './toonKit';
import { cleanLook, DEFAULT_LOOKS, type HeroLook } from '../../net/profile';

/*
 * Бублик — Tosha's stretchy dog as a playable hero (same anim interface as Tosha: HeroAnim states, emotes,
 * attacks). He stretches: a front paw shoots out for a punch (fx.reach, punch / punchAlt) or a grapple
 * (grab: fx.reach along fx.aim), both paws spin out for the «мельница» (mill), the whole body stretches across a
 * gap as a bridge (fx.bridge = length from the rump, m), he puffs up into a trampoline ball (fx.puff), and
 * curls into a ball to roll (state 'dash').
 * Look slots: hat = the bagel tag, scarf = collar, shirt = fur, shorts = ears & spots, boot = paws, belly & muzzle.
 * Bridge geometry for kits: the rump stays at the root, the walkable back runs along +Z at BRIDGE_TOP above the feet.
 */

/** body centre height (standing), rump→chest distance, body radius */
const BODY_Y = 0.43;
const SPAN = 0.5;
const GIRTH = 0.2;
const LEG = 0.27;
/** height of the bridge's back above his feet */
export const BRIDGE_TOP = 0.3;
/** a bridge starts this far in front of his feet (where the rump is) */
export const BRIDGE_FROM = 0.12;

interface Leg { hip: THREE.Group; up: THREE.Mesh; paw: THREE.Group; front: boolean; side: number; len: number }

const P = () => ({
  bodyY: BODY_Y, pitch: 0, roll: 0, yaw: 0, span: SPAN, girth: 1, rumpZ: -SPAN / 2,
  fl: 0, fr: 0, bl: 0, br: 0, flz: 0, frz: 0, blz: 0, brz: 0, fll: LEG, frl: LEG, bll: LEG, brl: LEG,
  neck: 0, headX: 0, headY: 0, headZ: 0, jaw: 0, tail: 0.6, tailZ: 0, ears: 0, tongue: 0,
});
type DP = ReturnType<typeof P>;
const DKEYS = Object.keys(P()) as (keyof DP)[];

export function createBublik(look: Partial<HeroLook> = DEFAULT_LOOKS.bublik): HeroRig {
  const M = new Mats();
  const base = DEFAULT_LOOKS.bublik;
  const L0 = cleanLook(look, base);
  const tagM = M.own(L0.hatColor);
  const collarM = M.own(L0.scarfColor);
  const fur = M.own(L0.shirtColor);
  const dark = M.own(L0.shortsColor);
  const light = M.own(L0.bootColor);
  const black = basic('#1b1214');
  const white = basic('#ffffff');
  const mouthDark = basic('#6a1622');
  const tongueM = M.get('#ff7f9a');
  const fo = { cast: false };

  const root = new THREE.Group();
  root.name = 'bublik';
  const squashG = grp(root, undefined, undefined, 'squash');
  const spinG = grp(squashG, undefined, undefined, 'spin');
  /** body centre; pitch / roll / ball-roll happen here */
  const bodyG = grp(spinG, [0, BODY_Y, 0], undefined, 'body');
  bodyG.rotation.order = 'YXZ';
  const rollG = grp(bodyG, undefined, undefined, 'roll');

  // ── rump, stretchy middle, chest ──
  const rump = grp(rollG, [0, 0, -SPAN / 2], undefined, 'rump');
  const rumpBall = part(rump, G.sphere(), fur, undefined, [GIRTH * 0.98, GIRTH * 0.95, GIRTH * 1.05]);
  part(rump, G.sphere(), dark, [0.1, 0.1, -0.02], [0.09, 0.07, 0.1], [0, 0, -0.5]); // a spot
  const midG = grp(rump, undefined, [Math.PI / 2, 0, 0]); // +Y → +Z
  const mid = part(midG, G.cyl(), fur, [0, SPAN / 2, 0], [GIRTH, SPAN, GIRTH * 0.97]);
  const midBelly = part(midG, G.cyl(), light, [0, SPAN / 2, 0.075], [GIRTH * 0.78, SPAN, GIRTH * 0.72]);
  // a darker saddle along his back (reads as the long sausage from above)
  const midSaddle = part(midG, G.sphere(), dark, [0, SPAN / 2, -0.07], [GIRTH * 0.72, SPAN * 0.6, GIRTH * 0.66], undefined, fo);
  const chest = grp(rump, [0, 0, SPAN], undefined, 'chest');
  const chestBall = part(chest, G.sphere(), fur, undefined, [GIRTH * 1.03, GIRTH * 1.03, GIRTH * 1.06]);
  part(chest, G.sphere(), light, [0, -0.045, 0.1], [0.135, 0.15, 0.12]);
  // collar + bagel tag
  const collar = grp(chest, [0, 0.11, 0.1], [-0.95, 0, 0]);
  part(collar, G.torus(0.15, 0.03, 10, 30), collarM);
  part(collar, cached('bublik-studs', () => merge(Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * TAU + 0.5;
    return { g: G.ball(), p: [Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.025] as [number, number, number], s: 0.014 };
  }))), M.get('#f2c23a'));
  const tag = grp(collar, [0, -0.16, 0.02]);
  part(tag, G.torus(0.05, 0.027, 12, 24), tagM, [0, -0.05, 0.03], 1, [0.95, 0, 0]);
  part(tag, cached('bublik-seeds', () => merge([[-0.02, 0.02], [0.022, 0.012], [0.0, 0.035], [-0.03, -0.012], [0.03, -0.018]].map(([x, y]) => ({
    g: G.ball(), p: [x, y, 0.0] as [number, number, number], s: [0.006, 0.004, 0.004] as [number, number, number],
  })))), M.get('#fff6e0'), [0, -0.05, 0.064], 1.2, [0.95, 0, 0]);

  // ── legs (one stretchy segment each + a big paw) ──
  const legs: Leg[] = [];
  const mkLeg = (parent: THREE.Object3D, x: number, z: number, front: boolean, side: number) => {
    const hip = grp(parent, [x, -0.07, z]);
    part(hip, G.sphere(), fur, undefined, [0.065, 0.07, 0.07]);
    const up = part(hip, G.cyl(), fur, [0, -LEG / 2, 0], [0.052, LEG, 0.052]);
    const paw = grp(hip, [0, -LEG, 0]);
    part(paw, G.sphere(), light, [0, -0.005, 0.03], [0.066, 0.05, 0.085]);
    part(paw, cached('bublik-toes', () => merge([-0.03, 0, 0.03].map((tx) => ({ g: G.ball(), p: [tx, -0.02, 0.1] as [number, number, number], s: [0.02, 0.018, 0.02] as [number, number, number] })))), light);
    const l: Leg = { hip, up, paw, front, side, len: LEG };
    legs.push(l);
    return l;
  };
  const legFL = mkLeg(chest, 0.105, 0.03, true, 1);
  const legFR = mkLeg(chest, -0.105, 0.03, true, -1);
  const legBL = mkLeg(rump, 0.11, -0.01, false, 1);
  const legBR = mkLeg(rump, -0.11, -0.01, false, -1);

  // tail: two segments, curled up
  const tail = grp(rump, [0, 0.09, -0.17]);
  tail.rotation.order = 'YXZ';
  part(tail, G.capsule(0.04, 0.1), fur, [0, 0.065, 0]);
  const tail2 = grp(tail, [0, 0.13, 0]);
  part(tail2, G.capsule(0.032, 0.1), fur, [0, 0.06, 0]);
  part(tail2, G.sphere(), light, [0, 0.135, 0], [0.038, 0.048, 0.038]);

  // ── neck + head: a big round head, a long snout with a big wet nose, cheek puffs, floppy ears on springs ──
  const neck = grp(chest, [0, 0.12, 0.12], undefined, 'neck');
  const neckMesh = part(neck, G.cyl(), fur, [0, 0.05, 0], [0.095, 0.12, 0.095]);
  const head = grp(neck, [0, 0.14, 0.04], undefined, 'head');
  head.rotation.order = 'YXZ';
  const HR = 0.2;
  const headSt = grp(head);
  part(headSt, G.sphere(), fur, undefined, [HR, HR * 0.94, HR * 0.98]);
  part(headSt, G.sphere(), fur, [0, -0.045, 0.17], [0.105, 0.09, 0.17]); // snout
  part(headSt, G.sphere(), light, [0, -0.075, 0.2], [0.085, 0.055, 0.14], undefined, fo);
  for (const sx of [1, -1]) part(headSt, G.sphere(), light, [sx * 0.05, -0.07, 0.27], [0.045, 0.04, 0.045], undefined, fo); // cheek puffs
  part(headSt, G.sphere(), dark, [0, 0.13, 0.02], [0.08, 0.05, 0.1], [0.3, 0, 0], fo); // a spot on the crown
  // the dog mouth line "ω" under the nose
  part(headSt, cached('bublik-omega', () => merge([1, -1].map((sx) => ({ g: G.arc(0.022, 0.0045, Math.PI), p: [sx * 0.021, 0.0, 0] as [number, number, number], r: [0, 0, Math.PI] as [number, number, number] })))), black, [0, -0.048, 0.338], 1, [-0.35, 0, 0], fo);
  part(headSt, G.capsule(0.004, 0.016), black, [0, -0.032, 0.343], 1, [-0.3, 0, 0], fo);
  flatten(headSt, { cast: true });
  // the big wet nose + its shine
  const noseM = M.get('#2a1a1c');
  const noseG = grp(head, [0, 0, 0.335]);
  part(noseG, G.sphere(), noseM, undefined, [0.052, 0.04, 0.034], undefined, fo);
  noOutline(part(noseG, G.ball(), white, [0.018, 0.016, 0.027], [0.014, 0.009, 0.006], [0, 0, -0.4], fo));
  noOutline(part(noseG, G.ball(), white, [-0.016, 0.006, 0.03], 0.0045, undefined, fo));
  const teeth = part(head, G.capsule(0.01, 0.07), white, [0, -0.1, 0.23], 1, [0, 0, Math.PI / 2], fo);
  const jaw = grp(head, [0, -0.095, 0.08]);
  part(jaw, G.sphere(), light, [0, -0.005, 0.1], [0.072, 0.032, 0.125]);
  const mouthIn = part(jaw, G.sphere(), mouthDark, [0, 0.014, 0.1], [0.062, 0.022, 0.105], undefined, fo);
  const tongue = part(jaw, G.capsule(0.03, 0.065), tongueM, [0, 0.0, 0.2], [1, 1, 0.42], [Math.PI / 2 + 0.35, 0, 0], fo);
  // floppy ears (long, swinging on springs)
  const ears: THREE.Group[] = [];
  const earSwing: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const ep = grp(head, [s * 0.15, 0.1, -0.02]);
    ep.rotation.order = 'YXZ';
    const sw = grp(ep);
    part(sw, G.sphere(), dark, [s * 0.03, -0.14, 0], [0.045, 0.17, 0.11]);
    part(sw, G.sphere(), dark, [s * 0.034, -0.27, 0.0], [0.04, 0.05, 0.095]);
    ears.push(ep); earSwing.push(sw);
  }
  const earDangle = [new Dangle(), new Dangle()];
  // eyes, lids, brows (the shared toon face; the right eye sits in a dark patch)
  const face = buildToonFace(head, M, {
    R: HR, eyeYaw: 0.42, eyePitch: 0.22, eyeW: 0.046, eyeH: 0.054, eyeD: 0.5,
    iris: '#8a4a1e', irisDark: '#3a1a08', irisSize: 0.86, lidMat: fur, lidRest: 0,
    lash: '#2a1410', brow: '#5a2a12', browThick: 0.012, browW: 0.034, browLift: 1.7, browOut: 1.02,
    mouthPitch: -0.5, mouthW: 0.03, noMouth: true,
  });

  // ── the trampoline balloon (puff) and the roll ball ──
  const balloon = part(bodyG, G.sphere(), fur, [0, 0, 0], 0.01);
  const balloonBelly = part(balloon, G.sphere(), light, [0, -0.12, 0.62], [0.62, 0.55, 0.42], undefined, fo);
  vis(balloon, false);
  // the roll: curled up into a furry ball (collar stripe, ears and tail sticking out), spun about X
  const ball = grp(bodyG, undefined, undefined, 'ball');
  part(ball, G.sphere(), fur, undefined, 0.3);
  part(ball, G.sphere(), light, [0, -0.06, 0.15], [0.22, 0.2, 0.18]);
  part(ball, G.torus(0.3, 0.035, 8, 32), collarM, undefined, 1, [0, Math.PI / 2, 0]);
  for (const s of [1, -1]) part(ball, G.sphere(), dark, [s * 0.22, 0.17, 0.06], [0.05, 0.14, 0.09], [0.4, 0, s * 0.6]);
  part(ball, G.capsule(0.03, 0.08), fur, [0, 0.12, -0.3], 1, [-0.9, 0, 0]);
  part(ball, G.sphere(), black, [0, 0.05, 0.3], [0.04, 0.03, 0.03], undefined, fo);
  ball.scale.setScalar(0.001);
  vis(ball, false);
  // swing trail for the mill
  const trailMat = basic('#ffffff', { transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
  const trail = new THREE.Mesh(cached('bublik-trail', () => arcRibbon(0.3, 1.5, 0, TAU, 72)), trailMat);
  trail.position.y = BODY_Y + 0.05; trail.renderOrder = 5; trail.layers.set(1);
  vis(trail, false);
  squashG.add(trail);

  const weaponTip = new THREE.Object3D();
  legFR.paw.add(weaponTip);

  // ───────────────────────── look ─────────────────────────
  let cur: HeroLook = { ...L0 };
  function setLook(patch: Partial<HeroLook>) {
    const l = cleanLook({ ...cur, ...patch }, base);
    cur = l;
    tagM.color.set(l.hatColor); collarM.color.set(l.scarfColor); fur.color.set(l.shirtColor); dark.color.set(l.shortsColor); light.color.set(l.bootColor);
  }

  // ───────────────────────── animation ─────────────────────────
  const C = P(), T = P();
  const earRest = new THREE.Vector3(0, -0.2, 0);
  let t = Math.random() * 5, phase = 0, stT = 0, lastSt: HeroState = 'idle', first = true;
  let spinCur = 0, rollAng = 0, rollK = 0, puffK = 0, tumble = 0;

  function legSet(l: Leg, swing: number, side: number, len: number) {
    l.hip.rotation.set(swing, 0, side);
    const r = len > 0.5 ? Math.max(0.03, 0.052 * Math.sqrt(0.5 / len)) : 0.052;
    l.up.scale.set(r, len, r);
    l.up.position.y = -len / 2;
    l.paw.position.y = -len;
  }

  function update(dt: number, a: HeroAnim) {
    dt = Math.min(dt, 0.1);
    t += dt;
    const st = a.state;
    const sp = clamp(a.speed, 0, 1.4);
    const fx = a.fx ?? {};
    const atk = a.attack, ak = atk?.kind, ap = atk ? clamp(atk.p) : 0;
    if (st !== lastSt) { lastSt = st; stT = 0; } else stT += dt;
    if (st === 'run') phase += dt * (9 + 8 * Math.min(1, sp));
    else if (st === 'walk' || st === 'sneak') phase += dt * (6 + 6 * Math.min(1, sp));
    else if (st === 'downed') phase += dt * (1 + 30 * sp);
    else phase += dt * 6;
    const s = Math.sin(phase), c = Math.cos(phase);
    const breathe = Math.sin(t * 2.6);
    const sniff = st === 'idle' && a.talk < 0.05 ? Math.max(0, Math.sin(t * 0.55)) : 0;

    // ── target pose ──
    Object.assign(T, P());
    T.tail = 0.55; T.ears = 0.1;
    switch (st) {
      case 'idle':
        // sniffing around (nose down, quick twitches), looking about, panting happily; licks his chops
        T.bodyY = BODY_Y + 0.006 * breathe; T.headZ = 0.12 * Math.sin(t * 0.7); T.headX = 0.03 * breathe + 0.22 * Math.max(0, sniff - 0.4);
        T.headY = 0.3 * Math.sin(t * 0.37);
        T.tongue = 0.6 + 0.2 * Math.max(0, Math.sin(t * 5)); T.jaw = sniff > 0.55 ? 0.05 : 0.25;
        if (a.talk > 0.05) { T.headZ = 0.15 * Math.sin(t * 2.2); T.headX = -0.1; T.ears = 0.35; T.fr = -0.25 * Math.max(0, Math.sin(t * 3)); }
        break;
      case 'walk': case 'sneak': {
        const sneak = st === 'sneak';
        const amp = 0.45;
        T.fl = s * amp; T.br = s * amp; T.fr = -s * amp; T.bl = -s * amp; // trot (diagonal pairs)
        T.bodyY = BODY_Y + Math.abs(c) * 0.015 - (sneak ? 0.14 : 0);
        T.roll = s * 0.04; T.headX = sneak ? 0.25 : Math.cos(phase * 2) * 0.04; T.neck = sneak ? -0.3 : 0;
        T.tail = sneak ? -0.2 : 0.6; T.ears = sneak ? -0.2 : 0.15;
        if (sneak) { T.fll = T.frl = T.bll = T.brl = LEG * 0.5; }
        break;
      }
      case 'run': {
        // gallop: front pair and back pair alternate, the spine flexes (he IS stretchy)
        const amp = 0.95;
        T.fl = s * amp; T.fr = Math.sin(phase - 0.35) * amp;
        T.bl = -s * amp; T.br = -Math.sin(phase - 0.35) * amp;
        T.span = SPAN * (1 + 0.16 * s);
        T.pitch = -c * 0.1; T.bodyY = BODY_Y + 0.04 * (0.5 + 0.5 * c);
        T.headX = c * 0.08 + 0.05; T.ears = 0.6 + 0.3 * s; T.tail = 0.15; T.tongue = 1; T.jaw = 0.45;
        break;
      }
      case 'jump':
        T.fl = -1.1; T.fr = -0.95; T.bl = 1.0; T.br = 0.9; T.span = SPAN * 1.18; T.pitch = 0.25;
        T.ears = 1.2; T.tail = 0.1; T.headX = -0.15; T.jaw = 0.3;
        break;
      case 'fall':
        T.fl = -0.5; T.fr = -0.6; T.bl = 0.5; T.br = 0.6; T.flz = 0.45; T.frz = -0.45; T.blz = 0.35; T.brz = -0.35;
        T.pitch = -0.15; T.ears = 2.2 + Math.sin(t * 16) * 0.3; T.tail = 1.2; T.jaw = 0.5; T.headX = 0.15;
        break;
      case 'dash':
        // curl into a ball (the roll itself spins below)
        T.span = 0.14; T.fl = -2.2; T.fr = -2.2; T.bl = 2.2; T.br = 2.2; T.fll = T.frl = T.bll = T.brl = 0.12;
        T.headX = 1.0; T.neck = -0.6; T.bodyY = 0.32; T.ears = -0.4; T.tail = 1.8;
        break;
      case 'hurt':
        T.pitch = 0.35; T.fl = -0.8; T.fr = -0.5; T.bl = 0.2; T.br = 0.3; T.ears = 1.6; T.tail = -0.4; T.headX = -0.3; T.jaw = 0.4;
        break;
      case 'grabbed': {
        const k = Math.sin(t * 22), k2 = Math.sin(t * 18);
        T.fl = -0.6 + k * 0.7; T.fr = -0.6 - k * 0.7; T.bl = 0.5 + k2 * 0.6; T.br = 0.5 - k2 * 0.6;
        T.roll = Math.sin(t * 13) * 0.15; T.ears = 1.5; T.tail = -0.6; T.jaw = 0.5;
        break;
      }
      case 'dead':
        T.roll = Math.PI * 0.9; T.bodyY = 0.24; T.fl = -0.3; T.fr = 0.3; T.bl = 0.3; T.br = -0.3; T.flz = 0.4; T.frz = -0.4; T.blz = 0.3; T.brz = -0.3;
        T.headZ = 0.4; T.tail = -1; T.ears = 0.8; T.tongue = 1; T.jaw = 0.5;
        break;
      case 'sit':
        T.pitch = 0.75; T.bodyY = BODY_Y - 0.05; T.bl = -1.35; T.br = -1.35; T.bll = T.brl = LEG * 0.8; T.fl = -0.7; T.fr = -0.7;
        T.headX = 0.6; T.neck = 0.1; T.tail = -1.2; T.tongue = 0.7; T.jaw = 0.3;
        break;
      case 'cheer': {
        const h = Math.abs(Math.sin(t * 7));
        T.bodyY = BODY_Y + h * 0.16; T.pitch = 0.3; T.fl = -1.2 + Math.sin(t * 14) * 0.4; T.fr = -1.2 - Math.sin(t * 14) * 0.4;
        T.bl = 0.4 * (1 - h); T.br = 0.4 * (1 - h); T.ears = 1 + h; T.headX = -0.35; T.tongue = 1; T.jaw = 0.55; T.tail = 0.8;
        break;
      }
      case 'lookUp':
        T.headX = -0.7; T.neck = 0.2; T.ears = 0.3;
        break;
      case 'tumble':
        T.fl = -1.2; T.fr = 1.0; T.bl = 1.2; T.br = -0.8; T.flz = 0.6; T.brz = -0.6; T.ears = 2; T.jaw = 0.5;
        break;
      case 'wave': case 'facepalm': {
        // sit up on the haunches; wave a paw / a paw over the eyes
        const k = smooth(seg(stT, 0, 0.3));
        T.pitch = 1.15 * k; T.bodyY = BODY_Y + 0.02 * k; T.bl = -1.5 * k; T.br = -1.5 * k; T.bll = T.brl = LEG * (1 - 0.25 * k);
        T.headX = 0.95 * k + (st === 'facepalm' ? 0.45 * k : 0); T.neck = 0.1;
        if (st === 'wave') { T.fl = -0.4; T.fr = -2.7 * k; T.frz = -0.4 + Math.sin(t * 11) * 0.5; T.tongue = 1; T.jaw = 0.4; T.tail = 0.9; }
        else { T.fl = -0.5; T.fr = -2.35 * k; T.frz = 0.75 * k; T.headY = Math.sin(t * 3.2) * 0.15 * k; T.tail = -0.8; T.ears = -0.3; }
        break;
      }
      case 'dance': {
        const bt = t * 7.5, half = Math.sin(bt / 2), bounce = Math.abs(Math.sin(bt));
        T.pitch = 1.3; T.bodyY = BODY_Y + 0.08 + bounce * 0.06; T.bl = -1.3 + Math.max(0, half) * 0.4; T.br = -1.3 + Math.max(0, -half) * 0.4;
        T.roll = half * 0.25; T.yaw = half * 0.4;
        T.fl = -2.2 + Math.sin(bt) * 0.5; T.fr = -2.2 - Math.sin(bt) * 0.5; T.flz = 0.6; T.frz = -0.6;
        T.headX = 1.1; T.headZ = -half * 0.3; T.tongue = 1; T.jaw = 0.5; T.tail = 1 + half; T.ears = 1 + bounce;
        break;
      }
      case 'bow': {
        // the play bow: front down, rump up, tail wagging like mad
        const k = smooth(seg(stT % 2.1, 0.05, 0.45)) * (1 - smooth(seg(stT % 2.1, 1.3, 1.7)));
        T.pitch = -0.45 * k; T.bodyY = BODY_Y - 0.06 * k; T.fl = -1.1 * k; T.fr = -1.1 * k; T.fll = T.frl = LEG * (1 - 0.3 * k);
        T.headX = -0.35 * k; T.tail = 1.0; T.tongue = 1; T.jaw = 0.4; T.ears = 0.4;
        break;
      }
      case 'downed': {
        const m = clamp(sp * 6);
        T.roll = Math.PI / 2 - 0.15; T.bodyY = 0.24; T.fl = s * 0.6 * m - 0.2; T.fr = -s * 0.6 * m - 0.2; T.bl = -s * 0.5 * m + 0.2; T.br = s * 0.5 * m + 0.2;
        T.headZ = -0.3; T.headX = 0.2; T.tail = -1.2; T.ears = 0.6; T.tongue = 1; T.jaw = 0.35;
        break;
      }
    }

    // ── attacks / kit poses ──
    const reach = Math.max(0, fx.reach ?? 0);
    let trailOn = false, spinTarget = 0;
    if (ak === 'punch' || ak === 'punchAlt') {
      const l = ak === 'punch' ? 'fr' : 'fl';
      T[l] = -Math.PI / 2 + 0.05; T[(l + 'z') as 'frz'] = 0; T[(l + 'l') as 'frl'] = LEG + (reach || Math.sin(seg(ap, 0.1, 0.7) * Math.PI) * 2.6);
      T.pitch = 0.12; T.headX = -0.15; T.jaw = 0.35; T.ears = 0.8; T.span = SPAN * 1.1;
      T.yaw = ak === 'punch' ? 0.18 : -0.18;
    } else if (ak === 'mill') {
      const sp2 = easeInOut(seg(ap, 0.02, 0.86));
      spinTarget = TAU * 1.5 * sp2;
      const out = Math.sin(clamp(ap / 0.9) * Math.PI);
      T.fl = -Math.PI / 2; T.fr = -Math.PI / 2; T.flz = Math.PI / 2 - 0.1; T.frz = -Math.PI / 2 + 0.1; T.fll = T.frl = LEG + (reach || out * 1.25);
      T.ears = 1.6; T.jaw = 0.4; T.tongue = 1;
      trailOn = out > 0.2;
    } else if (ak === 'grab') {
      const aim = fx.aim ?? 0.3;
      T.fr = -Math.PI / 2 - aim; T.frz = 0; T.frl = LEG + reach; T.fl = -Math.PI / 2 - aim; T.flz = 0; T.fll = LEG + Math.max(0, reach - 0.15);
      T.pitch = clamp(aim * 0.4, -0.2, 0.5); T.headX = -aim * 0.6; T.ears = 0.9; T.jaw = 0.3;
    }
    T.rumpZ = -T.span / 2;
    // bridge: flat on the belly, stretched from the rump (at the feet) to the far end
    const bridge = Math.max(0, fx.bridge ?? 0);
    if (bridge > 0) {
      const span = Math.max(SPAN, bridge - BRIDGE_FROM - 0.12);
      T.span = span; T.rumpZ = BRIDGE_FROM; T.bodyY = BRIDGE_TOP - 0.11; T.girth = 0.62; T.pitch = 0; T.roll = 0; T.yaw = 0;
      T.bl = 0.35; T.br = 0.35; T.blz = 0.25; T.brz = -0.25; T.bll = T.brl = 0.19;
      T.fl = -0.3; T.fr = -0.3; T.flz = 0.3; T.frz = -0.3; T.fll = T.frl = 0.19;
      T.headX = 0.2; T.ears = 0.3; T.jaw = 0.25; T.tongue = 0.6; T.tail = 0.9;
    }

    // ── smooth ──
    const fast = !!ak || bridge > 0;
    for (const k of DKEYS) {
      if (first) C[k] = T[k];
      else if (k === 'span' && (bridge > 0 || reach > 0)) C[k] = T[k];
      else if ((k === 'fll' || k === 'frl') && (ak === 'punch' || ak === 'punchAlt' || ak === 'grab' || ak === 'mill')) C[k] = T[k];
      else C[k] = damp(C[k], T[k], fast ? 30 : 13, dt);
    }

    // ── roll ball, puff, spin ──
    rollK = damp(rollK, st === 'dash' ? 1 : 0, 22, dt);
    if (st === 'dash') rollAng += dt * 22; else rollAng = damp(wrapAngle(rollAng), 0, 10, dt);
    puffK = damp(puffK, clamp(fx.puff ?? 0), 10, dt);
    if (spinTarget) spinCur = spinTarget; else spinCur = damp(wrapAngle(spinCur), 0, 12, dt);
    if (st === 'tumble') tumble += dt * 10; else tumble = damp(wrapAngle(tumble), 0, 10, dt);

    // ── apply ──
    const sq = Math.max(0.2, a.squash || 1), sx = 1 / Math.sqrt(sq);
    squashG.scale.set(sx, sq, sx);
    spinG.rotation.y = spinCur;
    const pk = easeOut(puffK);
    // the balloon: a big round dog, standing on its own bottom
    const BR = 0.56;
    bodyG.position.set(0, lerp(C.bodyY, BR + 0.02, pk), 0);
    bodyG.rotation.set(-C.pitch * (1 - pk) + tumble, C.yaw, C.roll * (1 - pk)); // pitch: + = nose up
    rollG.rotation.x = rollAng;
    rollG.position.z = 0;
    // the rump / chest / middle (span), girth (thin when stretched far)
    const span = lerp(C.span, 0.3, pk);
    const g = C.girth * (span > 1.2 ? Math.max(0.55, Math.sqrt(1.2 / span)) : 1);
    const rz = lerp(C.rumpZ, -0.15, pk);
    rump.position.set(0, 0, rz);
    rumpBall.scale.set(GIRTH * 0.98 * g, GIRTH * 0.95 * g, GIRTH * 1.05 * g);
    chestBall.scale.set(GIRTH * 1.03 * g, GIRTH * 1.03 * g, GIRTH * 1.06 * g);
    mid.scale.set(GIRTH * g, span, GIRTH * 0.97 * g); mid.position.y = span / 2;
    midBelly.scale.set(GIRTH * 0.78 * g, span, GIRTH * 0.72 * g); midBelly.position.y = span / 2; midBelly.position.z = 0.075 * g;
    midSaddle.scale.set(GIRTH * 0.8 * g, span * 0.62 + 0.06, GIRTH * 0.75 * g); midSaddle.position.y = span / 2; midSaddle.position.z = -0.05 * g;
    chest.position.set(0, 0, span);
    // balloon over everything while puffed (the body parts sink inside it)
    vis(balloon, pk > 0.02);
    if (balloon.visible) { balloon.scale.setScalar(Math.max(0.01, BR * pk)); balloon.position.set(0, 0, rz + span / 2); }
    void balloonBelly;
    // legs (puffed: little stubs sticking out of the balloon)
    const L4: Array<[Leg, number, number, number]> = [[legFL, C.fl, C.flz, C.fll], [legFR, C.fr, C.frz, C.frl], [legBL, C.bl, C.blz, C.bll], [legBR, C.br, C.brz, C.brl]];
    for (const [l, sw, sd, len] of L4) {
      const stub = 0.26;
      legSet(l, lerp(sw, l.front ? -0.45 : 0.45, pk), lerp(sd, l.side * 0.5, pk), lerp(len, stub, pk));
      l.hip.position.y = lerp(-0.07, -0.3, pk);
      l.hip.position.x = lerp(l.side * (l.front ? 0.105 : 0.11), l.side * 0.3, pk);
    }
    // the roll: the dog curls up into a ball (the parts shrink inside it)
    const rk = smooth(clamp((rollK - 0.15) / 0.6));
    vis(ball, rk > 0.02);
    vis(rollG, rk < 0.98);
    if (ball.visible) { ball.scale.setScalar(Math.max(0.001, rk)); ball.rotation.set(rollAng, 0, 0); }
    rollG.scale.setScalar(Math.max(0.001, 1 - 0.7 * rk));
    // tail
    const happy = a.expr === 'happy' || st === 'cheer' || st === 'dance' || st === 'wave' || st === 'bow';
    const wagRate = happy ? 24 : st === 'run' ? 14 : 8;
    const wagAmp = happy ? 0.8 : 0.35;
    tail.rotation.set(-C.tail - 0.4, Math.sin(t * wagRate) * wagAmp, C.tailZ);
    tail2.rotation.x = -0.35 + Math.sin(t * wagRate - 1) * 0.2;
    // neck / head (the head sits on top of the balloon when puffed)
    neck.rotation.x = C.neck;
    neck.position.set(0, lerp(0.12, 0.3, pk), lerp(0.12, 0.26, pk));
    neckMesh.scale.y = 0.12;
    head.rotation.set(C.headX, C.headY, C.headZ);
    // ears: the pose angle + a spring swing (they flop when he moves / shakes his head)
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? 1 : -1;
      const flap = Math.sin(t * 16 + i * 0.4) * clamp(C.ears - 1, 0, 1) * 0.4;
      ears[i].rotation.set(clamp(C.ears, -0.5, 1) * 0.3, 0, sgn * (0.12 + clamp(C.ears, -0.3, 2.4) * 0.9 + flap));
      const o = earDangle[i].update(ears[i], earRest, dt, 70, 4, 3, 0.1);
      earSwing[i].rotation.set(clamp(-(o.z - earRest.z) * 5, -0.7, 0.7), 0, clamp((o.x - earRest.x) * 5, -0.6, 0.6));
    }
    // trail
    vis(trail, trailOn);
    if (trailOn) { trail.rotation.y = spinCur; trailMat.opacity = 0.35; }
    weaponTip.position.set(0, -0.02, 0.1);

    // ── face ──
    let ex: HeroExpr = a.expr;
    if (st === 'hurt' || st === 'dead' || st === 'downed') ex = ex === 'normal' ? 'hurt' : ex;
    else if ((st === 'grabbed' || st === 'tumble' || st === 'fall') && ex === 'normal') ex = st === 'fall' ? 'surprised' : 'scared';
    else if ((st === 'cheer' || st === 'wave' || st === 'dance' || st === 'bow') && ex === 'normal') ex = 'happy';
    else if (st === 'facepalm' && ex === 'normal') ex = 'sleepy';
    else if (st === 'dash' && ex === 'normal') ex = 'sleepy';
    if (ak && ex === 'normal') ex = 'angry';
    if (bridge > 0 && ex === 'normal') ex = 'angry';
    if (pk > 0.5 && ex === 'normal') ex = 'surprised';
    const wide = ex === 'scared' || ex === 'surprised';
    face.update(dt, ex, 0, { browBias: st === 'idle' ? 0.25 * Math.max(0, Math.sin(t * 0.9)) : 0 });
    const talkO = clamp(a.talk) * (0.65 + 0.35 * Math.sin(t * 11.3 + Math.sin(t * 4.1) * 2));
    const open = Math.max(C.jaw * (ex === 'angry' ? 0.5 : 1), talkO * 0.95, wide ? 0.5 : 0);
    // the sniff: the nose twitches
    const sn = sniff > 0.55 ? Math.sin(t * 28) * 0.12 : 0;
    noseG.scale.set(1 + sn * 0.6, 1 - sn, 1);
    jaw.rotation.x = open * 0.6;
    vis(mouthIn, open > 0.05);
    vis(tongue, (C.tongue > 0.3 || ex === 'happy') && ex !== 'angry' && open > 0.15);
    tongue.position.z = 0.17 + 0.05 * clamp(C.tongue);
    vis(teeth, ex === 'angry');
    void s; void lerp;
    M.flash(a.flash);
    first = false;
  }

  setLook(L0);
  return {
    root, update, weaponTip, setLook,
    get look() { return { ...cur }; },
    dispose() { for (const m of M.all) m.dispose(); face.dispose(); disposeBaked(root); for (const m of [black, white, mouthDark, trailMat]) m.dispose(); },
  };
}
