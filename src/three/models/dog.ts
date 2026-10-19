import * as THREE from 'three';
import { PAL, basic, mat } from '../gfx';
import type { Rig } from './rig';
import { G, Mats, clamp, lerp, damp, grp, part, surf, Blinker, vis } from './kit';

export interface DogAnim {
  state: 'idle' | 'walk' | 'sit' | 'fly';
  speed: number;
  talk: number;
  /** 1 = normal body length; the front (head, front legs) moves forward, the rump stays put */
  stretch: number;
  expr: 'normal' | 'happy' | 'angry';
}

/** Rump centre (fixed) and the base distance from rump to chest centre. */
const RUMP_Z = -0.3;
const BODY_Y = 0.24;
const SPAN = 0.52;

export function createDog(): Rig<DogAnim> {
  const M = new Mats();
  const black = basic('#1b1214');
  const white = basic('#ffffff');
  const fur = M.get(PAL.dog);
  const belly = M.get(PAL.dogBelly);
  const dark = M.get(PAL.dogDark);
  const fo = { cast: false };

  const root = new THREE.Group();
  root.name = 'dog';
  const bodyG = grp(root, [0, BODY_Y, RUMP_Z], undefined, 'body');

  // rump + stretchable middle + chest
  part(bodyG, G.sphere(), fur, undefined, [0.152, 0.15, 0.165]);
  const midG = grp(bodyG, undefined, [Math.PI / 2, 0, 0]); // local +Y → +Z
  const mid = part(midG, G.cyl(), fur, [0, SPAN / 2, 0], [0.15, SPAN, 0.148]);
  const midBelly = part(midG, G.cyl(), belly, [0, SPAN / 2, 0.052], [0.118, SPAN, 0.11]);
  const spine = part(midG, G.cyl(), dark, [0, SPAN / 2, -0.118], [0.045, SPAN, 0.04], undefined, fo);

  const front = grp(bodyG, [0, 0, SPAN], undefined, 'front');
  part(front, G.sphere(), fur, undefined, [0.158, 0.158, 0.168]);
  part(front, G.sphere(), belly, [0, -0.03, 0.08], [0.11, 0.12, 0.1]);

  // legs
  const mkLeg = (parent: THREE.Object3D, x: number, z: number) => {
    const hip = grp(parent, [x, -0.1, z]);
    part(hip, G.capsule(0.044, 0.05), fur, [0, -0.045, 0]);
    part(hip, G.sphere(), belly, [0, -0.1, 0.022], [0.052, 0.036, 0.068]);
    return hip;
  };
  const legFL = mkLeg(front, 0.085, 0.03);
  const legFR = mkLeg(front, -0.085, 0.03);
  const legBL = mkLeg(bodyG, 0.085, 0.0);
  const legBR = mkLeg(bodyG, -0.085, 0.0);

  // tail
  const tail = grp(bodyG, [0, 0.07, -0.13]);
  tail.rotation.order = 'YXZ';
  part(tail, G.capsule(0.028, 0.09), fur, [0, 0.06, 0]);
  const tail2 = grp(tail, [0, 0.12, 0]);
  part(tail2, G.capsule(0.02, 0.07), fur, [0, 0.045, 0]);

  // collar + bagel tag
  const collar = grp(front, [0, 0.1, 0.07], [-0.9, 0, 0]);
  part(collar, G.torus(0.13, 0.026, 10, 30), M.get(PAL.collar));
  const tag = grp(collar, [0, -0.13, 0.0]);
  part(tag, G.torus(0.036, 0.018, 10, 20), M.get(PAL.bagel), [0, -0.04, 0.03], 1, [0.9, 0, 0]);

  // head
  const neck = grp(front, [0, 0.16, 0.12], undefined, 'neck');
  const head = grp(neck, undefined, undefined, 'head');
  head.rotation.order = 'YXZ';
  const HR = 0.135;
  part(head, G.sphere(), fur, undefined, HR);
  part(head, G.sphere(), fur, [0, -0.03, 0.15], [0.078, 0.07, 0.135]);
  part(head, G.sphere(), belly, [0, -0.052, 0.19], [0.06, 0.04, 0.095], undefined, fo);
  part(head, G.sphere(), black, [0, -0.005, 0.283], [0.036, 0.028, 0.026], undefined, fo);
  part(head, G.ball(), white, [0.01, 0.008, 0.302], 0.008, undefined, fo);
  const teeth = part(head, G.capsule(0.009, 0.06), white, [0, -0.075, 0.2], 1, [0, 0, Math.PI / 2], fo);
  const jaw = grp(head, [0, -0.07, 0.07]);
  part(jaw, G.sphere(), belly, [0, -0.005, 0.085], [0.058, 0.026, 0.1]);
  const mouthIn = part(jaw, G.sphere(), basic('#6a1622'), [0, 0.012, 0.08], [0.05, 0.02, 0.085], undefined, fo);
  const tongue = part(jaw, G.capsule(0.022, 0.05), M.get('#ff7f9a'), [0, 0.0, 0.17], [1, 1, 0.45], [Math.PI / 2 + 0.35, 0, 0], fo);
  // ears
  const ears: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const ep = grp(head, [s * 0.105, 0.065, -0.01]);
    ep.rotation.order = 'YXZ';
    part(ep, G.sphere(), dark, [s * 0.025, -0.11, 0], [0.032, 0.14, 0.085]);
    ears.push(ep);
  }
  // eyes
  interface DEye { oval: THREE.Mesh; glint: THREE.Mesh; happy: THREE.Mesh; brow: THREE.Mesh }
  const eyes: DEye[] = [];
  for (const s of [1, -1]) {
    const e = surf(head, s * 0.5, 0.2, HR * 0.97);
    const oval = part(e, G.ball(), black, [0, 0, 0.004], [0.026, 0.034, 0.014], undefined, fo);
    const glint = part(e, G.ball(), white, [0.008, 0.012, 0.016], 0.008, undefined, fo);
    const happy = part(e, G.arc(0.022, 0.007, Math.PI), black, [0, -0.008, 0.006], [1, 1, 0.6], undefined, fo);
    const bg = surf(head, s * 0.46, 0.5, HR * 0.99);
    const brow = part(bg, G.capsule(0.009, 0.035), dark, undefined, 1, [0, 0, Math.PI / 2 + s * 0.45], fo);
    eyes.push({ oval, glint, happy, brow });
  }

  // ── anim ──
  const blinker = new Blinker();
  let t = Math.random() * 5, phase = 0;
  let sitK = 0, flyK = 0, talkK = 0;
  let stretchCur = 1;

  function update(dt: number, a: DogAnim) {
    dt = Math.min(dt, 0.1);
    t += dt;
    const st = a.state;
    const spd = clamp(a.speed, 0, 1);
    sitK = damp(sitK, st === 'sit' ? 1 : 0, 8, dt);
    flyK = damp(flyK, st === 'fly' ? 1 : 0, 8, dt);
    talkK = damp(talkK, clamp(a.talk), 25, dt);
    stretchCur = Math.max(0.3, a.stretch || 1);
    const walking = st === 'walk';
    if (walking) phase += dt * (8 + 9 * spd);
    else if (st === 'fly') phase += dt * 10;

    // stretch: chest/head move forward, middle scales, rump fixed
    const span = SPAN * stretchCur;
    mid.scale.y = span; mid.position.y = span / 2;
    midBelly.scale.y = span; midBelly.position.y = span / 2;
    spine.scale.y = span; spine.position.y = span / 2;
    front.position.z = span;

    // body pose
    const ws = walking ? Math.sin(phase) : 0;
    const bob = walking ? Math.abs(Math.cos(phase)) * 0.014 : 0.003 * Math.sin(t * 2.2);
    bodyG.position.y = BODY_Y + bob - 0.075 * sitK + 0.08 * flyK * (1 + 0.3 * Math.sin(t * 5));
    bodyG.rotation.x = -0.16 * sitK / Math.max(1, stretchCur) + flyK * 0.04 * Math.sin(t * 5);
    bodyG.rotation.z = walking ? ws * 0.03 : 0;

    // legs
    const legSwing = walking ? 0.6 : 0;
    const flyFront = -1.35 * flyK, flyBack = 1.35 * flyK;
    legFL.rotation.x = lerp(Math.sin(phase) * legSwing, flyFront, flyK);
    legBR.rotation.x = lerp(Math.sin(phase) * legSwing - 1.3 * sitK, flyBack, flyK);
    legFR.rotation.x = lerp(-Math.sin(phase) * legSwing, flyFront, flyK);
    legBL.rotation.x = lerp(-Math.sin(phase) * legSwing - 1.3 * sitK, flyBack, flyK);
    legFL.rotation.z = 0.25 * flyK; legFR.rotation.z = -0.25 * flyK;
    legBL.rotation.z = 0.25 * flyK; legBR.rotation.z = -0.25 * flyK;

    // tail wag
    const happy = a.expr === 'happy';
    const wagRate = happy ? 24 : walking ? 12 : 7;
    const wagAmp = happy ? 0.75 : 0.35;
    tail.rotation.set(lerp(lerp(-0.75, -1.35, flyK), -1.6, sitK), Math.sin(t * wagRate) * wagAmp * (1 - flyK * 0.6), 0);
    tail2.rotation.x = -0.25 + Math.sin(t * wagRate - 1) * 0.15;

    // head
    neck.rotation.x = lerp(-0.05, 0.25, flyK) - 0.15 * sitK + (walking ? Math.cos(phase * 2) * 0.03 : 0);
    head.rotation.set(Math.sin(t * 9) * 0.05 * talkK, 0, (st === 'idle' ? Math.sin(t * 0.7) * 0.12 : 0) + (happy ? Math.sin(t * 3) * 0.05 : 0));
    // ears: floppy, flap up when flying
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const flap = Math.sin(t * 16 + i * 0.4);
      const hang = s * (0.12 + (walking ? Math.sin(phase + i) * 0.12 : 0) + Math.sin(t * 2 + i) * 0.03);
      ears[i].rotation.set(flyK * 0.3, 0, lerp(hang, s * (2.3 + flap * 0.45), flyK));
    }

    // face
    const angry = a.expr === 'angry';
    const bl = blinker.update(dt);
    for (let i = 0; i < 2; i++) {
      const e = eyes[i];
      vis(e.oval, !happy); vis(e.glint, !happy); vis(e.happy, happy); vis(e.brow, angry);
      e.oval.scale.y = 0.034 * (1 - 0.9 * bl) * (angry ? 0.8 : 1);
    }
    const open = Math.max(talkK * (0.5 + 0.5 * Math.sin(t * 14)), happy ? 0.35 : 0, angry ? 0.25 : 0);
    jaw.rotation.x = open * 0.55;
    vis(mouthIn, open > 0.05);
    vis(tongue, happy || talkK > 0.3);
    tongue.position.z = happy ? 0.17 : 0.12;
    vis(teeth, angry);
  }

  return { root, update };
}

/** Giant brown paw-fist (~1 unit across) for the finishing punch; faces +Z, origin at its centre. Scale it in the game. */
export function createDogFist(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'dogFist';
  const fur = mat(PAL.dog);
  const pad = mat('#3d2218');
  const light = mat(PAL.dogBelly);
  part(g, G.sphere(), fur, [0, 0, -0.06], [0.44, 0.38, 0.4]);
  // curled toes across the front
  const toes: Array<[number, number, number, number]> = [[-0.3, 0.06, 0.2, 0.16], [-0.1, 0.12, 0.28, 0.175], [0.1, 0.12, 0.28, 0.175], [0.3, 0.06, 0.2, 0.16]];
  for (const [x, y, z, r] of toes) {
    part(g, G.sphere(), fur, [x, y, z], [r, r * 1.05, r]);
    part(g, G.sphere(), pad, [x, y - 0.02, z + r * 0.82], [r * 0.6, r * 0.55, r * 0.32]);
  }
  // big palm pad peeking at the bottom front + thumb-toe on the side
  part(g, G.sphere(), pad, [0, -0.24, 0.13], [0.2, 0.12, 0.14]);
  part(g, G.sphere(), fur, [0.4, -0.08, 0.02], [0.13, 0.14, 0.16]);
  part(g, G.sphere(), light, [0, 0.3, -0.05], [0.25, 0.08, 0.22]);
  // wrist going back
  part(g, G.cyl(), fur, [0, -0.02, -0.5], [0.28, 0.55, 0.27], [Math.PI / 2, 0, 0]);
  part(g, G.torus(0.28, 0.06, 10, 28), mat(PAL.collar), [0, -0.02, -0.3], 1);
  return g;
}
