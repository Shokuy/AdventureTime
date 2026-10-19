import * as THREE from 'three';
import { basic } from '../../../gfx';
import type { Rig } from '../../../models/rig';
import { G, Mats, TAU, clamp, damp, grp, part, cached, Blinker } from '../../../models/kit';
import { latheC } from '../../../world/kit';
import { marshTex, gingerTex, caneTex, stripeTex, layersTex } from './tex';

/**
 * Townsfolk of Пастильное королевство — little candy people with one shared skeleton (body bob, two stubby legs, two
 * arms, a face with blinking eyes, blush and a talking mouth) and different bodies:
 *  gumdrop (sugared jelly drop), marsh (marshmallow), ginger (gingerbread man), lolly (striped candy + lollipop head),
 *  cupcake (wrapper + frosting), toffee (round caramel shopkeeper with an apron), princess (Пастила: layered pastila
 *  hair, glasses, crown, a lab coat over a pink dress).
 * Anim states: idle, walk, wave, talk, cheer, sit, scared (the night episode's grey villagers can use `grey`).
 */

export type FolkKind = 'gumdrop' | 'marsh' | 'ginger' | 'lolly' | 'cupcake' | 'toffee' | 'princess';
export interface FolkAnim {
  state: 'idle' | 'walk' | 'wave' | 'talk' | 'cheer' | 'sit' | 'scared';
  /** walk speed 0..1 */
  speed: number;
  /** 0..1 mouth open (talking) */
  talk: number;
  /** head turn toward something (radians, relative to the body) */
  look: number;
  /** 0..1 drained of colour (night episode: bitten townsfolk) */
  grey?: number;
}
export interface FolkLook {
  color?: string; accent?: string;
  hat?: 'none' | 'bow' | 'top' | 'beret' | 'chef' | 'crown' | 'helmet' | 'kerchief';
  glasses?: boolean; apron?: boolean; scale?: number; seed?: number;
  /** something in the right hand (or on the body): Пряник's rolling-pin spear, Зефирыч's lamplighter pole, a lantern, a mail bag, an extinguisher */
  hold?: 'pin' | 'pole' | 'lantern' | 'bag' | 'extinguisher';
  /** smudges of soot (Ириска) */
  soot?: boolean;
}
export interface FolkRig extends Rig<FolkAnim> {
  kind: FolkKind;
  /** height of the head top (for barks / name tags) */
  height: number;
  head: THREE.Object3D;
  dispose(): void;
}

const fo = { cast: false };
const toonGrey = new THREE.Color('#9a96a2');

export function createFolk(kind: FolkKind, look: FolkLook = {}): FolkRig {
  const M = new Mats();
  const black = basic('#1b1214');
  const white = basic('#ffffff');
  const cheekM = basic('#ff9db4', { transparent: true, opacity: 0.75 });
  const mouthM = basic('#7a1a2e');
  const root = new THREE.Group();
  root.name = 'folk-' + kind;
  const s = look.scale ?? 1;
  const body = grp(root, [0, 0, 0]);
  body.scale.setScalar(s);
  const color = look.color ?? DEF_COLOR[kind];
  const accent = look.accent ?? DEF_ACCENT[kind];
  const skin = M.get(color);
  const acc = M.get(accent);

  // ── body shapes ──
  let hipY = 0.32, torsoTop = 0.9, headY = 1.0, headR = 0.3, faceZ = 0.3, armY = 0.7, armX = 0.3, legLen = 0.3, armLen = 0.32;
  let headOnBody = false;
  const torso = grp(body, [0, 0, 0]);
  if (kind === 'gumdrop') {
    // the body is the head: a sugared drop with a face
    hipY = 0.2; legLen = 0.2;
    part(torso, latheC('folk-drop', [[0, 0, 0], [0.9, 0, 0.02], [1, 0.12, 0.1], [0.95, 0.4, 0.4], [0.78, 0.7, 0.7], [0.48, 0.92, 0.9], [0, 1, 1]], 24), M.get('#ffffff', { map: marshTex(color) }), [0, hipY, 0], [0.42, 0.78, 0.42]);
    headOnBody = true; headY = hipY + 0.42; headR = 0.36; faceZ = 0.37; armY = hipY + 0.3; armX = 0.38; torsoTop = hipY + 0.78;
  } else if (kind === 'marsh') {
    part(torso, latheC('folk-puff', [[0, 0, 0], [0.88, 0, 0.02], [1, 0.12, 0.1], [1.02, 0.5, 0.5], [1, 0.88, 0.9], [0.88, 1, 0.98], [0, 1, 1]], 22), M.get('#ffffff', { map: marshTex(color) }), [0, hipY, 0], [0.3, 0.52, 0.27]);
    torsoTop = hipY + 0.52; headY = torsoTop + 0.28; headR = 0.29;
    armY = hipY + 0.4; armX = 0.3;
  } else if (kind === 'ginger') {
    const g = part(torso, G.sphere(), M.get('#ffffff', { map: gingerTex(color) }), [0, hipY + 0.28, 0], [0.27, 0.34, 0.16]);
    void g;
    for (let i = 0; i < 3; i++) part(torso, G.ball(), M.get(['#ff4f6a', '#4fd88a', '#4fa8ff'][i]), [0, hipY + 0.42 - i * 0.14, 0.15], 0.045);
    part(torso, G.torus(0.19, 0.022, 6, 20), M.get('#ffffff'), [0, hipY + 0.6, 0.02], 1, [Math.PI / 2 - 0.3, 0, 0]);
    torsoTop = hipY + 0.6; headY = torsoTop + 0.25; headR = 0.27;
    armY = hipY + 0.46; armX = 0.25;
  } else if (kind === 'lolly') {
    part(torso, G.capsule(0.2, 0.36, 12), M.get('#ffffff', { map: caneTex('#fff8f0', color, 4) }), [0, hipY + 0.38, 0]);
    torsoTop = hipY + 0.62; headY = torsoTop + 0.36; headR = 0.33;
    armY = hipY + 0.5; armX = 0.22;
  } else if (kind === 'cupcake') {
    part(torso, cached('folk-wrap', () => new THREE.CylinderGeometry(0.34, 0.25, 0.42, 18, 1).translate(0, 0.21, 0)), M.get('#ffffff', { map: stripeTex(accent, '#fff8ee', 9) }), [0, hipY - 0.02, 0]);
    torsoTop = hipY + 0.4; headY = torsoTop + 0.24; headR = 0.33;
    armY = hipY + 0.3; armX = 0.34;
  } else if (kind === 'toffee') {
    part(torso, G.sphere(), skin, [0, hipY + 0.36, 0], [0.4, 0.42, 0.34]);
    if (look.apron !== false) {
      part(torso, cached('folk-apron', () => new THREE.SphereGeometry(1, 18, 12, -0.9, 1.8, 0.9, 1.4)), M.get('#fff6ee'), [0, hipY + 0.36, 0.005], [0.41, 0.43, 0.35]);
      part(torso, G.ball(), M.get(accent), [0, hipY + 0.28, 0.33], [0.1, 0.07, 0.04]);
    }
    torsoTop = hipY + 0.74; headY = torsoTop + 0.22; headR = 0.3;
    armY = hipY + 0.52; armX = 0.38;
  } else {
    // princess Pastila: pink dress (cone), white lab coat panels, slim torso
    part(torso, cached('folk-dress', () => new THREE.CylinderGeometry(0.13, 0.36, 0.55, 20, 1).translate(0, 0.275, 0)), M.get(color), [0, hipY - 0.04, 0]);
    part(torso, cached('folk-coat', () => new THREE.CylinderGeometry(0.16, 0.39, 0.62, 20, 1, true, Math.PI * 0.18, Math.PI * 1.64).translate(0, 0.31, 0)), M.get('#fffdf8', { side: THREE.DoubleSide }), [0, hipY - 0.06, 0]);
    part(torso, G.capsule(0.14, 0.2, 12), M.get(color), [0, hipY + 0.6, 0]);
    part(torso, cached('folk-collar', () => new THREE.CylinderGeometry(0.2, 0.17, 0.1, 16, 1, true)), M.get('#fffdf8', { side: THREE.DoubleSide }), [0, hipY + 0.73, 0]);
    // a test tube in the coat pocket
    part(torso, cached('folk-tube', () => new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8)), M.get('#7ad8ff'), [0.2, hipY + 0.42, 0.25], 1, [0.2, 0, -0.2]);
    torsoTop = hipY + 0.78; headY = torsoTop + 0.24; headR = 0.27;
    armY = hipY + 0.68; armX = 0.18; armLen = 0.36;
  }

  // ── legs ──
  const legs: THREE.Group[] = [];
  const legM = kind === 'princess' ? M.get('#ffffff') : kind === 'ginger' || kind === 'toffee' ? skin : M.get(shadeHex(color, -0.15));
  const shoeM = M.get(kind === 'princess' ? '#ff5a8a' : kind === 'lolly' ? '#3a2a4a' : '#6a3a2a');
  for (const sx of [-1, 1]) {
    const hip = grp(body, [sx * (kind === 'gumdrop' ? 0.16 : 0.11), hipY, 0]);
    part(hip, G.capsule(0.065, Math.max(0.02, legLen - 0.13), 8), legM, [0, -legLen / 2, 0]);
    part(hip, G.sphere(), shoeM, [0, -legLen + 0.02, 0.04], [0.09, 0.07, 0.13]);
    legs.push(hip);
  }

  // ── arms ──
  const arms: THREE.Group[] = [];
  const armM = kind === 'princess' ? M.get('#fffdf8') : kind === 'marsh' || kind === 'cupcake' ? M.get(shadeHex(color, -0.05)) : skin;
  const handM = kind === 'princess' || kind === 'marsh' ? M.get('#ffe8ef') : kind === 'lolly' ? M.get('#fff8f0') : skin;
  for (const sx of [-1, 1]) {
    const sh = grp(body, [sx * armX, armY, 0]);
    const arm = grp(sh, [0, 0, 0]);
    part(arm, G.capsule(0.055, armLen - 0.1, 8), armM, [sx * 0.03, -armLen / 2, 0], 1, [0, 0, sx * 0.25]);
    part(arm, G.ball(), handM, [sx * 0.07, -armLen + 0.02, 0], 0.075);
    if (kind === 'ginger') part(arm, G.torus(0.06, 0.016, 5, 12), M.get('#ffffff'), [sx * 0.06, -armLen + 0.1, 0], 1, [Math.PI / 2, 0, sx * 0.25]);
    sh.rotation.z = sx * 0.12;
    arms.push(sh);
  }

  // ── head ──
  const head = grp(body, [0, headY, 0]);
  const face = grp(head, [0, 0, 0]);
  if (!headOnBody) {
    if (kind === 'lolly') {
      part(head, cached('folk-lolly', () => new THREE.CylinderGeometry(1, 1, 0.3, 28).rotateX(Math.PI / 2)), M.get('#ffffff', { map: swirl(color) }), [0, 0, 0], [headR, headR, 0.6]);
      part(head, G.torus(1, 0.06, 8, 32), M.get(shadeHex(color, -0.15)), [0, 0, 0], headR);
      faceZ = 0.1;
    } else if (kind === 'cupcake') {
      for (let i = 0; i < 3; i++) part(head, G.sphere(), M.get('#ffffff', { map: marshTex(color) }), [0, -0.12 + i * 0.13, 0], [headR * (1 - i * 0.28), 0.14, headR * (1 - i * 0.28)]);
      part(head, G.ball(), M.get('#ff2a4a'), [0, 0.26, 0], 0.07);
      part(head, cached('folk-stem', () => new THREE.CylinderGeometry(0.01, 0.015, 0.12, 5)), M.get('#4a8a2a'), [0.02, 0.36, 0], 1, [0, 0, -0.4]);
      faceZ = headR * 0.98;
    } else if (kind === 'ginger') {
      part(head, G.sphere(), M.get('#ffffff', { map: gingerTex(color) }), [0, 0, 0], [headR, headR, headR * 0.7]);
      faceZ = headR * 0.66;
    } else if (kind === 'princess') {
      part(head, G.sphere(), skin, [0, 0, 0], [headR, headR * 1.02, headR * 0.95]);
      // layered pastila hair: a big bun of stripes + bangs
      part(head, G.sphere(), M.get('#ffffff', { map: layersTex(['#ff8ab0', '#fff2f6', '#ff6a9a', '#fff2f6', '#ff8ab0'], 21) }), [0, 0.06, -0.04], [headR * 1.08, headR * 1.04, headR * 1.04]);
      part(head, G.sphere(), M.get('#ffffff', { map: layersTex(['#ff8ab0', '#fff2f6', '#ff6a9a', '#fff2f6'], 22) }), [0, headR * 0.95, -0.08], [0.17, 0.2, 0.17]);
      part(head, G.sphere(), M.get('#ff7aa2'), [0, headR * 0.35, headR * 0.62], [headR * 0.9, headR * 0.35, headR * 0.45]);
      faceZ = headR * 0.92;
    } else {
      part(head, G.sphere(), kind === 'marsh' ? M.get('#ffffff', { map: marshTex(color) }) : skin, [0, 0, 0], [headR, headR * 0.95, headR * 0.92]);
      faceZ = headR * 0.9;
    }
  } else faceZ = headR;
  // eyes, blush, mouth
  const eyes: THREE.Group[] = [];
  const eyeY = kind === 'lolly' ? 0.02 : 0.03, eyeX = headR * 0.36;
  for (const sx of [-1, 1]) {
    const e = grp(face, [sx * eyeX, eyeY, faceZ]);
    part(e, G.sphere(), white, [0, 0, 0], [0.075, 0.09, 0.04], undefined, fo);
    part(e, G.ball(), black, [sx * -0.005, -0.01, 0.03], [0.042, 0.052, 0.02], undefined, fo);
    part(e, G.ball(), white, [sx * 0.012, 0.012, 0.045], 0.014, undefined, fo);
    eyes.push(e);
    part(face, G.ball(), cheekM, [sx * headR * 0.62, -0.06, faceZ - 0.03], [0.06, 0.035, 0.02], undefined, fo);
  }
  const mouth = grp(face, [0, -0.1, faceZ + 0.005]);
  const mouthIn = part(mouth, G.sphere(), mouthM, [0, 0, 0], [0.06, 0.02, 0.02], undefined, fo);
  const smile = part(mouth, G.arc(0.055, 0.012, Math.PI), black, [0, 0.025, 0.012], 1, [0, 0, Math.PI], fo);
  if (look.glasses || kind === 'princess') {
    const gm = M.get(kind === 'princess' ? '#c88aff' : '#5a3a2a');
    for (const sx of [-1, 1]) part(face, G.torus(0.075, 0.013, 6, 18), gm, [sx * eyeX, eyeY, faceZ + 0.03], 1, undefined, fo);
    part(face, G.capsule(0.01, 0.06, 4), gm, [0, eyeY + 0.01, faceZ + 0.04], 1, [0, 0, Math.PI / 2], fo);
  }

  // ── hats ──
  const hat = look.hat ?? (kind === 'princess' ? 'crown' : 'none');
  const top = headOnBody ? headR * 0.75 : headR * 0.92;
  if (hat === 'crown') {
    const cg = grp(head, [0, top + 0.06, 0]);
    const gold = M.get('#ffd34a');
    part(cg, cached('folk-crown', () => new THREE.CylinderGeometry(0.12, 0.11, 0.08, 14, 1, true)), gold, [0, 0, 0], 1, undefined);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; part(cg, G.cone(), gold, [Math.sin(a) * 0.115, 0.07, Math.cos(a) * 0.115], [0.035, 0.08, 0.035]); }
    part(cg, G.ball(), M.get('#ff4f7a'), [0, 0.02, 0.12], 0.03);
    cg.rotation.z = 0.18;
  } else if (hat === 'bow') {
    const bg = grp(head, [headR * 0.5, top - 0.02, 0]);
    for (const sx of [-1, 1]) part(bg, G.sphere(), acc, [sx * 0.08, 0, 0], [0.09, 0.06, 0.04], [0, 0, sx * 0.3]);
    part(bg, G.ball(), acc, [0, 0, 0], 0.035);
  } else if (hat === 'top') {
    part(head, G.cyl(), M.get('#3a2a4a'), [0, top + 0.12, 0], [0.16, 0.22, 0.16]);
    part(head, G.cyl(), M.get('#3a2a4a'), [0, top + 0.01, 0], [0.26, 0.02, 0.26]);
    part(head, G.cyl(), acc, [0, top + 0.05, 0], [0.165, 0.05, 0.165]);
  } else if (hat === 'beret') {
    part(head, G.sphere(), acc, [0.04, top - 0.02, 0], [0.27, 0.08, 0.25], [0, 0, -0.2]);
    part(head, G.ball(), acc, [0.06, top + 0.06, 0], 0.03);
  } else if (hat === 'chef') {
    part(head, G.cyl(), M.get('#ffffff'), [0, top + 0.06, 0], [0.18, 0.14, 0.18]);
    for (let i = 0; i < 4; i++) part(head, G.sphere(), M.get('#ffffff'), [Math.sin(i * 1.6) * 0.1, top + 0.2, Math.cos(i * 1.6) * 0.1], 0.12);
  } else if (hat === 'helmet') {
    part(head, G.dome(), M.get('#ffd34a'), [0, top - 0.12, 0], [headR * 1.05, headR * 0.9, headR * 1.05]);
    part(head, G.cone(), M.get(accent), [0, top + 0.18, 0], [0.05, 0.2, 0.05]);
  } else if (hat === 'kerchief') {
    part(head, G.dome(), acc, [0, top - 0.18, -0.02], [headR * 1.06, headR * 1.0, headR * 1.06]);
    part(head, G.ball(), acc, [0, top - 0.05, -headR * 0.95], 0.06);
  }

  // ── held things ──
  const hand = arms[1];
  const hy = -armLen + 0.02, hx = 0.07;
  if (look.hold === 'pin') {
    const g = grp(hand, [hx, hy, 0.02], [0.15, 0, 0]);
    part(g, G.cyl(), M.get('#d8b088'), [0, 0.55, 0], [0.025, 1.5, 0.025]);
    part(g, G.cyl(), M.get('#e8c49a'), [0, 1.3, 0], [0.07, 0.36, 0.07]);
    for (const sy of [-1, 1]) part(g, G.cyl(), M.get('#c8945a'), [0, 1.3 + sy * 0.24, 0], [0.03, 0.1, 0.03]);
    part(g, G.cone(), M.get('#d8dce8'), [0, 1.62, 0], [0.05, 0.14, 0.05]);
  } else if (look.hold === 'pole') {
    const g = grp(hand, [hx, hy, 0.02], [0.1, 0, 0]);
    part(g, G.cyl(), M.get('#8a5a3a'), [0, 0.6, 0], [0.022, 1.7, 0.022]);
    part(g, G.torus(0.06, 0.012, 5, 12), M.get('#ffd34a'), [0.05, 1.45, 0], 1, [0, 0, 0]);
    part(g, G.ball(), basic('#ffcf5a'), [0.1, 1.42, 0], 0.035);
  } else if (look.hold === 'lantern') {
    const g = grp(hand, [hx, hy - 0.04, 0.02]);
    part(g, G.cyl(), M.get('#3a2a2a'), [0, -0.02, 0], [0.012, 0.08, 0.012]);
    part(g, latheC('folk-lantern', [[0, 0, 0], [0.6, 0.05, 0.1], [1, 0.4, 0.4], [0.7, 0.9, 0.9], [0, 1, 1]], 12), basic('#ffe08a'), [0, -0.22, 0], [0.09, 0.18, 0.09]);
    part(g, G.cyl(), M.get('#ffd34a'), [0, -0.04, 0], [0.06, 0.03, 0.06]);
  } else if (look.hold === 'bag') {
    part(torso, G.sphere(), M.get('#7a4a2a'), [-armX * 1.1, armY - 0.32, 0.06], [0.14, 0.13, 0.07]);
    part(torso, G.torus(0.3, 0.018, 5, 20), M.get('#5a3a20'), [-0.04, armY - 0.06, 0.0], [1, 1.2, 0.6], [0, 0.2, 0.7]);
    part(torso, G.ball(), M.get('#ffd34a'), [-armX * 1.1, armY - 0.26, 0.13], 0.025);
  } else if (look.hold === 'extinguisher') {
    const g = grp(hand, [hx, hy - 0.08, 0.06]);
    part(g, G.capsule(0.07, 0.2, 10), M.get('#e8383d'), [0, -0.05, 0]);
    part(g, G.cyl(), M.get('#3a3a44'), [0, 0.13, 0], [0.025, 0.06, 0.025]);
    part(g, G.cyl(), M.get('#3a3a44'), [0.05, 0.15, 0.03], [0.012, 0.12, 0.012], [0, 0, 1.2]);
  }
  if (look.soot) {
    const sm = basic('#3a2e2e', { transparent: true, opacity: 0.55 });
    for (const [x, y, sc] of [[-0.12, 0.1, 0.05], [0.14, -0.04, 0.04], [0.04, 0.16, 0.03]] as const) part(face, G.ball(), sm, [x, y, faceZ + 0.01], [sc, sc * 0.7, 0.01], undefined, fo);
    part(torso, G.ball(), sm, [0.12, hipY + 0.5, 0.3], [0.06, 0.04, 0.02], undefined, fo);
  }

  // ── animation ──
  const blinker = new Blinker();
  let t = Math.random() * 10, walkPh = 0, bob = 0, waveK = 0, cheerK = 0, sitK = 0, scaredK = 0, lookCur = 0;
  const greyMats = M.all;
  const baseColors = greyMats.map((m) => m.color.clone());
  let greyCur = 0;
  const height = (headY + headR + (hat === 'none' ? 0 : 0.15)) * s;
  return {
    root, kind, head, height,
    update(dt, a) {
      dt = Math.min(dt, 0.1);
      t += dt;
      const walking = a.state === 'walk';
      if (walking) walkPh += dt * (6 + a.speed * 8);
      bob = damp(bob, walking ? 1 : 0, 8, dt);
      waveK = damp(waveK, a.state === 'wave' ? 1 : 0, 8, dt);
      cheerK = damp(cheerK, a.state === 'cheer' ? 1 : 0, 8, dt);
      sitK = damp(sitK, a.state === 'sit' ? 1 : 0, 6, dt);
      scaredK = damp(scaredK, a.state === 'scared' ? 1 : 0, 6, dt);
      const sw = Math.sin(walkPh);
      // body: breathe / bob / hop when cheering
      const breathe = Math.sin(t * 2.2) * 0.015;
      const hop = cheerK * Math.max(0, Math.sin(t * 9)) * 0.12;
      body.position.y = bob * Math.abs(Math.cos(walkPh)) * 0.05 + hop - sitK * (hipY - 0.06) * s;
      torso.scale.set(1 - breathe * 0.5, 1 + breathe, 1 - breathe * 0.5);
      body.rotation.z = bob * Math.sin(walkPh) * 0.05 + scaredK * Math.sin(t * 30) * 0.02;
      body.rotation.x = bob * 0.06;
      // legs
      legs[0].rotation.x = walking ? sw * 0.7 : -sitK * 1.45;
      legs[1].rotation.x = walking ? -sw * 0.7 : -sitK * 1.45;
      // arms: swing, wave (right), cheer (both up), talk gestures, scared (hands up to the face)
      const talkG = a.state === 'talk' ? Math.sin(t * 5) * 0.25 : 0;
      for (let i = 0; i < 2; i++) {
        const sx = i === 0 ? -1 : 1;
        let rx = walking ? (i === 0 ? -sw : sw) * 0.6 : Math.sin(t * 1.8 + i) * 0.05;
        let rz = sx * (0.12 + Math.sin(t * 1.4 + i * 2) * 0.03);
        if (i === 1 && waveK > 0.01) { rz = sx * (0.12 + waveK * 2.4) + Math.sin(t * 12) * 0.35 * waveK; rx *= 1 - waveK; }
        if (cheerK > 0.01) { rz = sx * (0.12 + cheerK * 2.6) + Math.sin(t * 10 + i) * 0.15 * cheerK; }
        if (i === 0 && a.state === 'talk') rx = -0.5 + talkG;
        if (scaredK > 0.01) { rx = rx * (1 - scaredK) - 2.2 * scaredK; rz = sx * (0.2 + 0.3 * scaredK); }
        arms[i].rotation.set(rx, 0, rz);
      }
      // head: look toward something, little tilt
      lookCur = damp(lookCur, clamp(a.look, -1.1, 1.1), 6, dt);
      head.rotation.y = lookCur;
      head.rotation.z = Math.sin(t * 0.9) * 0.05 + (a.state === 'talk' ? Math.sin(t * 3.1) * 0.06 : 0);
      head.rotation.x = a.state === 'talk' ? Math.sin(t * 4.3) * 0.05 : 0;
      // face: blink, mouth
      const bl = blinker.update(dt);
      for (const e of eyes) e.scale.y = Math.max(0.08, 1 - bl);
      const open = clamp(a.talk, 0, 1);
      mouthIn.scale.set(0.06 + open * 0.01, 0.02 + open * 0.06, 0.02);
      smile.visible = open < 0.15;
      // greyness (night: drained of colour)
      const g = clamp(a.grey ?? 0, 0, 1);
      if (Math.abs(g - greyCur) > 0.004) {
        greyCur = g;
        greyMats.forEach((m, k) => m.color.copy(baseColors[k]).lerp(toonGrey, g * 0.85));
      }
    },
    dispose() { for (const m of M.all) m.dispose(); },
  };
}

const DEF_COLOR: Record<FolkKind, string> = {
  gumdrop: '#ff6a9a', marsh: '#fff6f8', ginger: '#c8803e', lolly: '#ff5a8a', cupcake: '#ffc8e0', toffee: '#d89040', princess: '#ff8ab4',
};
const DEF_ACCENT: Record<FolkKind, string> = {
  gumdrop: '#ffd34a', marsh: '#ff9fc0', ginger: '#ffffff', lolly: '#7ad8ff', cupcake: '#7ad8ff', toffee: '#ff5a7a', princess: '#c88aff',
};

function shadeHex(hex: string, amt: number) {
  const c = new THREE.Color(hex);
  if (amt < 0) c.multiplyScalar(1 + amt); else c.lerp(new THREE.Color('#ffffff'), amt);
  return '#' + c.getHexString();
}

const swirlTexs = new Map<string, THREE.Texture>();
function swirl(col: string) {
  let t = swirlTexs.get(col);
  if (!t) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#fff8f0'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = col; g.lineWidth = 10; g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < 200; i++) { const th = i * 0.13, r = 2 + i * 0.3; const x = 64 + Math.cos(th) * r, y = 64 + Math.sin(th) * r; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke();
    t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    swirlTexs.set(col, t);
  }
  return t;
}
