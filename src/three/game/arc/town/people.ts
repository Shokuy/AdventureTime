import * as THREE from 'three';
import { basic, noOutline } from '../../../gfx';
import type { Rig } from '../../../models/rig';
import { G, Mats, TAU, clamp, damp, grp, part, cached, merge, surf } from '../../../models/kit';
import { buildToonFace, type ToonFace } from '../../../models/toonFace';
import { flatten, puffGeo } from '../../../models/toonKit';
import type { HeroExpr } from '../../../models/hero';
import { latheC } from '../../../world/kit';
import { marshTex, gingerTex, caneTex, stripeTex, layersTex } from './tex';

/**
 * Townsfolk of Пастильное королевство — little candy people with one shared skeleton (body bob, two stubby legs, two
 * mitten arms, a head) and the shared cartoon face (models/toonFace: big eyes with lids & brows that act, a mouth
 * that really talks, blush), and a body per kind — each readable by silhouette:
 *  gumdrop (a sugared jelly drop with sugar crystals and a gloss), marsh (a soft marshmallow block, puffy cheeks),
 *  ginger (a gingerbread man with piped icing), lolly (a striped candy stick with a swirl lollipop head),
 *  cupcake (a paper wrapper + a frosting swirl head with a cherry), toffee (a round caramel in a twisted wrapper —
 *  Ириска), princess (Пастила: a cloud of pastila hair, crown, goggles, lab coat over a pink dress).
 * Characters get details from their look: a top hat or helmet gives an old-timer moustache (Зефирыч's marshmallow
 * beard, Пряник's icing moustache), bows / kerchiefs / aprons give lashes.
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
type V3 = [number, number, number];

/** sphere-surface angles (yaw, pitch) of a point at (x, y) on the front of a sphere of radius R */
const ang = (x: number, y: number, R: number): [number, number] => [Math.asin(clamp(x / R, -0.95, 0.95)), Math.asin(clamp(y / R, -0.95, 0.95))];

export function createFolk(kind: FolkKind, look: FolkLook = {}): FolkRig {
  const M = new Mats();
  const root = new THREE.Group();
  root.name = 'folk-' + kind;
  const s = look.scale ?? 1;
  const body = grp(root, [0, 0, 0]);
  body.scale.setScalar(s);
  const color = look.color ?? DEF_COLOR[kind];
  const accent = look.accent ?? DEF_ACCENT[kind];
  const skin = M.get(color);
  const acc = M.get(accent);
  const white = M.get('#ffffff');
  const hat = look.hat ?? (kind === 'princess' ? 'crown' : 'none');
  const stache = hat === 'top' || hat === 'helmet';
  const lashes = hat === 'bow' || hat === 'kerchief' || !!look.apron || kind === 'princess';

  // ── body shapes ──
  let hipY = 0.32, headY = 1.0, headR = 0.3, armY = 0.7, armX = 0.3, legLen = 0.3, armLen = 0.32;
  let headOnBody = false;
  /** the face sphere (in head space) and the material the eyelids use */
  let fR = 0.3, fC: V3 = [0, 0, 0];
  let lidM: THREE.Material = skin;
  const torso = grp(body, [0, 0, 0]);
  if (kind === 'gumdrop') {
    // the body is the head: a sugared drop with a face, sugar crystals and a glossy highlight
    hipY = 0.2; legLen = 0.2;
    const dropM = M.get('#ffffff', { map: marshTex(color) });
    part(torso, latheC('folk-drop', [[0, 0, 0], [0.9, 0, 0.02], [1, 0.12, 0.1], [0.95, 0.4, 0.4], [0.78, 0.7, 0.7], [0.48, 0.92, 0.9], [0, 1, 1]], 28), dropM, [0, hipY, 0], [0.42, 0.78, 0.42]);
    part(torso, cached('folk-sugar', () => merge(Array.from({ length: 26 }, (_, i) => {
      const a = i * 2.39996, yk = 0.08 + ((i * 0.618) % 1) * 0.8;
      const r = yk < 0.45 ? 0.97 : yk < 0.75 ? 0.82 : 0.55;
      if (Math.cos(a) > 0.55 && yk > 0.3 && yk < 0.75) return { g: G.ball(), p: [0, -9, 0] as V3, s: 0.001 }; // keep the face clear
      return { g: G.ball(), p: [Math.sin(a) * r * 0.42, yk * 0.78, Math.cos(a) * r * 0.42] as V3, s: [0.016, 0.012, 0.016] as V3, r: [a, a * 2, 0] as V3 };
    }))), white, [0, hipY, 0], 1, undefined, fo);
    noOutline(part(torso, G.sphere(), basic('#ffffff', { transparent: true, opacity: 0.55 }), [-0.17, hipY + 0.6, 0.22], [0.05, 0.08, 0.02], [0.3, -0.6, 0.5], fo));
    headOnBody = true; headY = hipY + 0.42; headR = 0.36; armY = hipY + 0.3; armX = 0.38;
    fR = 0.37; lidM = dropM;
  } else if (kind === 'marsh') {
    part(torso, latheC('folk-puff', [[0, 0, 0], [0.88, 0, 0.02], [1, 0.12, 0.1], [1.02, 0.5, 0.5], [1, 0.88, 0.9], [0.88, 1, 0.98], [0, 1, 1]], 24), M.get('#ffffff', { map: marshTex(color) }), [0, hipY, 0], [0.3, 0.52, 0.27]);
    headY = hipY + 0.52 + 0.28; headR = 0.29;
    armY = hipY + 0.4; armX = 0.3;
    fR = headR * 0.93;
  } else if (kind === 'ginger') {
    part(torso, G.sphere(), M.get('#ffffff', { map: gingerTex(color) }), [0, hipY + 0.28, 0], [0.27, 0.34, 0.16]);
    for (let i = 0; i < 3; i++) part(torso, G.sphere(), M.get(['#ff4f6a', '#4fd88a', '#4fa8ff'][i]), [0, hipY + 0.42 - i * 0.13, 0.15], [0.045, 0.045, 0.03]);
    // piped icing: a collar zig-zag and a hem
    part(torso, cached('folk-icing', () => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) { const a = -1.2 + (i / 24) * 2.4; pts.push(new THREE.Vector3(Math.sin(a) * 0.2, 0.6 + (i % 2 ? -0.025 : 0.0), Math.cos(a) * 0.115)); }
      const top = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.011, 6, false);
      const pts2: THREE.Vector3[] = [];
      for (let i = 0; i <= 30; i++) { const a = -1.4 + (i / 30) * 2.8; pts2.push(new THREE.Vector3(Math.sin(a) * 0.255, 0.07 + Math.sin(i * 1.6) * 0.012, Math.cos(a) * 0.15)); }
      const hem = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts2), 60, 0.011, 6, false);
      return merge([{ g: top }, { g: hem }]);
    }), white, [0, hipY, 0], 1, undefined, fo);
    headY = hipY + 0.6 + 0.25; headR = 0.27;
    armY = hipY + 0.46; armX = 0.25;
    // the head is a flattened disc: approximate its front by a bigger sphere behind it
    fR = headR * 1.43; fC = [0, 0, headR * 0.7 - fR];
  } else if (kind === 'lolly') {
    part(torso, G.capsule(0.2, 0.36, 14), M.get('#ffffff', { map: caneTex('#fff8f0', color, 4) }), [0, hipY + 0.38, 0]);
    headY = hipY + 0.62 + 0.36; headR = 0.33;
    armY = hipY + 0.5; armX = 0.22;
    fR = 0.62; fC = [0, 0, 0.1 - 0.62];
  } else if (kind === 'cupcake') {
    part(torso, cached('folk-wrap2', () => {
      // a pleated paper cup
      const g = new THREE.CylinderGeometry(0.34, 0.25, 0.42, 36, 1);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); const a = Math.atan2(x, z); const k = 1 + 0.035 * Math.abs(Math.sin(a * 9)); p.setX(i, x * k); p.setZ(i, z * k); }
      g.computeVertexNormals();
      return g.translate(0, 0.21, 0);
    }), M.get('#ffffff', { map: stripeTex(accent, '#fff8ee', 9) }), [0, hipY - 0.02, 0]);
    part(torso, G.torus(0.33, 0.03, 8, 36), M.get('#fff8ee'), [0, hipY + 0.39, 0], 1, [Math.PI / 2, 0, 0]);
    headY = hipY + 0.4 + 0.24; headR = 0.33;
    armY = hipY + 0.3; armX = 0.34;
    fR = headR * 0.98; fC = [0, -0.02, 0];
  } else if (kind === 'toffee') {
    part(torso, G.sphere(), skin, [0, hipY + 0.36, 0], [0.4, 0.42, 0.34]);
    // the wrapper: twisted ends sticking out of both sides (a wrapped toffee!)
    const wrapM = M.get(accent);
    for (const sx of [1, -1]) {
      part(torso, G.cone(), wrapM, [sx * 0.45, hipY + 0.36, 0], [0.09, 0.14, 0.07], [0, 0, sx * Math.PI / 2]);
      part(torso, G.cone(), wrapM, [sx * 0.55, hipY + 0.36, 0], [0.12, 0.12, 0.09], [0, 0, -sx * Math.PI / 2]);
      part(torso, G.torus(0.035, 0.012, 6, 14), wrapM, [sx * 0.39, hipY + 0.36, 0], 1, [0, Math.PI / 2, 0]);
    }
    part(torso, G.sphere(), M.get(shadeHex(color, 0.25)), [-0.18, hipY + 0.55, 0.22], [0.07, 0.05, 0.03], [0, -0.6, 0.4], fo); // caramel shine
    if (look.apron !== false) {
      part(torso, cached('folk-apron', () => new THREE.SphereGeometry(1, 18, 12, -0.9, 1.8, 0.9, 1.4)), M.get('#fff6ee'), [0, hipY + 0.36, 0.005], [0.41, 0.43, 0.35]);
      part(torso, G.ball(), acc, [0, hipY + 0.28, 0.33], [0.1, 0.07, 0.04]);
    } else {
      // Ириска: a lab apron strap + a pocket with a pencil
      part(torso, G.sphere(), M.get('#f4f2f8'), [0, hipY + 0.3, 0.16], [0.26, 0.24, 0.2]);
      part(torso, G.capsule(0.008, 0.06), M.get('#3a6ad8'), [0.1, hipY + 0.42, 0.33], 1, [0, 0, 0.2]);
    }
    headY = hipY + 0.74 + 0.22; headR = 0.3;
    armY = hipY + 0.52; armX = 0.38;
    fR = headR * 0.93;
  } else {
    // princess Pastila: pink dress (cone), white lab coat panels, slim torso
    part(torso, cached('folk-dress', () => new THREE.CylinderGeometry(0.13, 0.36, 0.55, 24, 1).translate(0, 0.275, 0)), M.get(color), [0, hipY - 0.04, 0]);
    part(torso, cached('folk-coat', () => new THREE.CylinderGeometry(0.16, 0.39, 0.62, 24, 1, true, Math.PI * 0.18, Math.PI * 1.64).translate(0, 0.31, 0)), M.get('#fffdf8', { side: THREE.DoubleSide }), [0, hipY - 0.06, 0]);
    part(torso, G.capsule(0.14, 0.2, 12), M.get(color), [0, hipY + 0.6, 0]);
    part(torso, cached('folk-collar', () => new THREE.CylinderGeometry(0.2, 0.17, 0.1, 16, 1, true)), M.get('#fffdf8', { side: THREE.DoubleSide }), [0, hipY + 0.73, 0]);
    part(torso, cached('folk-tube', () => new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8)), M.get('#7ad8ff'), [0.2, hipY + 0.42, 0.25], 1, [0.2, 0, -0.2]);
    for (const sx of [1, -1]) part(torso, G.sphere(), M.get('#ff4a8a'), [sx * 0.07, hipY + 0.72, 0.12], [0.07, 0.045, 0.03], [0, 0, sx * 0.35]); // bow
    headY = hipY + 0.78 + 0.24; headR = 0.27;
    armY = hipY + 0.68; armX = 0.18; armLen = 0.36;
    fR = headR;
  }

  // ── legs: stubby, with round shoes ──
  const legs: THREE.Group[] = [];
  const legM = kind === 'princess' ? M.get('#ffffff') : kind === 'ginger' || kind === 'toffee' ? skin : M.get(shadeHex(color, -0.15));
  const shoeM = M.get(kind === 'princess' ? '#ff5a8a' : kind === 'lolly' ? '#3a2a4a' : '#6a3a2a');
  const soleM = M.get('#3a2420');
  for (const sx of [-1, 1]) {
    const hip = grp(body, [sx * (kind === 'gumdrop' ? 0.16 : 0.11), hipY, 0]);
    const lg = grp(hip);
    part(lg, G.capsule(0.065, Math.max(0.02, legLen - 0.13), 8), legM, [0, -legLen / 2, 0]);
    part(lg, G.sphere(), shoeM, [0, -legLen + 0.03, 0.045], [0.095, 0.075, 0.135]);
    part(lg, G.cyl(), soleM, [0, -legLen - 0.03, 0.045], [0.092, 0.018, 0.13]);
    flatten(lg);
    legs.push(hip);
  }

  // ── arms: mitten hands with a thumb ──
  const arms: THREE.Group[] = [];
  const armM = kind === 'princess' ? M.get('#fffdf8') : kind === 'marsh' || kind === 'cupcake' ? M.get(shadeHex(color, -0.05)) : skin;
  const handM = kind === 'princess' || kind === 'marsh' ? M.get('#ffe8ef') : kind === 'lolly' ? M.get('#fff8f0') : kind === 'cupcake' ? M.get('#fff0e0') : skin;
  for (const sx of [-1, 1]) {
    const sh = grp(body, [sx * armX, armY, 0]);
    const arm = grp(sh, [0, 0, 0]);
    const st = grp(arm);
    part(st, G.capsule(0.055, armLen - 0.1, 8), armM, [sx * 0.03, -armLen / 2, 0], 1, [0, 0, sx * 0.25]);
    part(st, G.sphere(), handM, [sx * 0.07, -armLen + 0.02, 0], [0.078, 0.07, 0.07]);
    part(st, G.sphere(), handM, [sx * 0.04, -armLen + 0.05, 0.05], [0.03, 0.026, 0.026], [0, 0, sx * 0.6]); // thumb
    if (kind === 'ginger') part(st, G.torus(0.06, 0.016, 5, 12), white, [sx * 0.06, -armLen + 0.1, 0], 1, [Math.PI / 2, 0, sx * 0.25]);
    if (kind === 'princess') part(st, G.torus(0.055, 0.016, 6, 14), M.get('#e8e4ee'), [sx * 0.06, -armLen + 0.1, 0], 1, [Math.PI / 2, 0, sx * 0.25]);
    flatten(st);
    sh.rotation.z = sx * 0.12;
    arms.push(sh);
  }
  flatten(torso);

  // ── head ──
  const head = grp(body, [0, headY, 0]);
  const hs = grp(head); // static head parts (baked)
  if (!headOnBody) {
    if (kind === 'lolly') {
      part(hs, cached('folk-lolly', () => new THREE.CylinderGeometry(1, 1, 0.3, 32).rotateX(Math.PI / 2)), M.get('#ffffff', { map: swirl(color) }), [0, 0, 0], [headR, headR, 0.6]);
      part(hs, G.torus(1, 0.06, 8, 36), M.get(shadeHex(color, -0.15)), [0, 0, 0], headR);
      // a cellophane bow at the neck
      for (const sx of [1, -1]) part(hs, G.cone(), M.get(accent), [sx * 0.08, -headR - 0.02, 0], [0.06, 0.12, 0.03], [0, 0, sx * 1.9]);
      lidM = M.get('#fff8f0');
    } else if (kind === 'cupcake') {
      const frost = M.get('#ffffff', { map: marshTex(color) });
      part(hs, puffGeo(3, 0.05), frost, [0, -0.02, 0], [headR, headR * 0.82, headR]);
      part(hs, puffGeo(4, 0.07), frost, [0, headR * 0.62, -0.02], [headR * 0.7, headR * 0.5, headR * 0.7]);
      part(hs, puffGeo(5, 0.08), frost, [0, headR * 1.02, -0.02], [headR * 0.42, headR * 0.38, headR * 0.42]);
      part(hs, G.sphere(), M.get('#e8203a'), [0, headR * 1.38, 0], 0.07);
      noOutline(part(hs, G.ball(), basic('#ffffff'), [0.025, headR * 1.38 + 0.03, 0.05], 0.014, undefined, fo));
      part(hs, cached('folk-stem', () => new THREE.CylinderGeometry(0.01, 0.015, 0.12, 5)), M.get('#4a8a2a'), [0.02, headR * 1.38 + 0.1, 0], 1, [0, 0, -0.4]);
      // sprinkles
      part(hs, cached('folk-sprinkles', () => merge(Array.from({ length: 22 }, (_, i) => {
        const a = i * 2.39996, yk = 0.25 + ((i * 0.618) % 1) * 0.6;
        if (Math.cos(a) > 0.45 && yk < 0.65) return { g: G.capsule(0.01, 0.03), p: [0, -9, 0] as V3, s: 0.001 };
        const r = Math.sqrt(1 - yk * yk);
        return { g: G.capsule(0.009, 0.025), p: [Math.sin(a) * r, yk * 0.82, Math.cos(a) * r] as V3, r: [a, a * 1.7, a * 0.3] as V3 };
      }))), acc, [0, -0.02, 0], headR, undefined, fo);
      lidM = frost;
    } else if (kind === 'ginger') {
      const gm = M.get('#ffffff', { map: gingerTex(color) });
      part(hs, G.sphere(), gm, [0, 0, 0], [headR, headR, headR * 0.7]);
      part(hs, G.torus(headR * 0.94, 0.011, 6, 40), white, [0, 0, headR * 0.3], [1, 1, 1], undefined, fo); // icing rim
      lidM = gm;
    } else if (kind === 'princess') {
      part(hs, G.sphere(), skin, [0, 0, 0], [headR, headR * 1.02, headR * 0.95]);
      const lay = M.get('#ffffff', { map: layersTex(['#ff8ab0', '#fff2f6', '#ff6a9a', '#fff2f6', '#ff8ab0'], 21) });
      const hp = M.get('#ffb0cc');
      part(hs, G.dome(), hp, [0, 0.0, -0.01], [headR * 1.1, headR * 1.12, headR * 1.1], [-0.5, 0, 0]);
      part(hs, puffGeo(2, 0.06), lay, [0, 0.02, -0.06], [headR * 1.15, headR * 1.05, headR * 1.0]);
      for (const [x, y, z, r] of [[0.14, 0.2, -0.02, 0.13], [-0.14, 0.2, -0.02, 0.13], [0, 0.27, -0.08, 0.15], [0.2, -0.05, -0.05, 0.1], [-0.2, -0.05, -0.05, 0.1]] as const) part(hs, puffGeo(7 + x * 10, 0.07), hp, [x, y, z], r);
      for (let i = 0; i < 5; i++) { const a = -0.6 + i * 0.3; part(surf(hs, a, 0.45 - Math.abs(a) * 0.15, headR), puffGeo(12 + i, 0.06), hp, [0, 0, 0.01], [0.06, 0.05, 0.04]); }
      // goggles on the fringe
      const gg = surf(hs, 0, 0.75, headR * 1.12);
      for (const sx of [1, -1]) {
        part(gg, G.torus(0.04, 0.011, 6, 16), M.get('#d8a040'), [sx * 0.052, 0, 0]);
        part(gg, G.sphere(), M.get('#8fe8f4'), [sx * 0.052, 0, -0.004], [0.034, 0.034, 0.01]);
      }
      fC = [0, -0.01, 0];
    } else {
      part(hs, G.sphere(), kind === 'marsh' ? M.get('#ffffff', { map: marshTex(color) }) : skin, [0, 0, 0], [headR, headR * 0.95, headR * 0.93]);
      if (kind === 'marsh') {
        lidM = M.get('#ffffff', { map: marshTex(color) });
        // puffy cheeks
        for (const sx of [1, -1]) part(hs, G.sphere(), lidM, [sx * headR * 0.55, -headR * 0.32, headR * 0.6], [headR * 0.3, headR * 0.24, headR * 0.25]);
      }
    }
  }

  // ── the face ──
  const iris = DEF_IRIS[kind];
  const brow = shadeHex(kind === 'marsh' || kind === 'cupcake' || kind === 'princess' ? (kind === 'princess' ? '#c8507a' : '#a07080') : color, -0.45);
  const eyeX = headR * (kind === 'gumdrop' ? 0.33 : 0.36), eyeYp = kind === 'gumdrop' ? 0.05 : 0.04;
  const [eyeYaw, eyePitch] = ang(eyeX, eyeYp - fC[1], fR);
  const [, mouthPitch] = ang(0, -headR * 0.36 - fC[1], fR);
  const ew = headR * (kind === 'gumdrop' ? 0.2 : 0.21);
  const face: ToonFace = buildToonFace(head, M, {
    R: fR, center: fC, eyeYaw, eyePitch, eyeW: ew, eyeH: ew * 1.22, eyeD: kind === 'lolly' ? 0.6 : 0.45,
    iris, irisSize: 0.8, lidMat: lidM, lidRest: 0.05,
    lashes: lashes ? 2 : 0, lash: '#2a1418', brow, browThick: ew * 0.2, browW: ew * 0.85, browLift: 1.7,
    mouthPitch, mouthW: headR * 0.17, cheek: '#ff7a9e',
    nose: kind === 'ginger' || kind === 'lolly' ? undefined : { mat: M.get(shadeHex(color, -0.12)), w: headR * 0.06, h: headR * 0.05, pitch: ang(0, -headR * 0.15 - fC[1], fR)[1] },
  });

  // moustache / beard
  if (stache) {
    const mA = surf(hs, 0, ang(0, -headR * 0.25 - fC[1], fR)[1], fR * 1.0, fC);
    if (kind === 'marsh') {
      const bm = M.get('#ffffff', { map: marshTex('#fffafc') });
      for (const sx of [1, -1]) part(mA, puffGeo(30 + sx, 0.08), bm, [sx * headR * 0.17, 0, 0.01], [headR * 0.2, headR * 0.1, headR * 0.1], [0, 0, sx * -0.25]);
      part(hs, puffGeo(33, 0.1), bm, [0, -headR * 0.72, headR * 0.45], [headR * 0.5, headR * 0.4, headR * 0.35]); // the beard
      face.root.position.z += 0.0;
    } else {
      for (const sx of [1, -1]) part(mA, G.capsule(headR * 0.045, headR * 0.22), kind === 'ginger' ? white : M.get(shadeHex(color, -0.4)), [sx * headR * 0.14, 0, 0.01], 1, [0, 0, sx * (Math.PI / 2 - 0.35)]);
    }
  }
  // glasses (round rims over the eyes)
  if (look.glasses || kind === 'princess') {
    const gm = M.get(kind === 'princess' ? '#c88aff' : '#5a3a2a');
    for (const sx of [1, -1]) {
      const g = surf(hs, sx * eyeYaw, eyePitch, fR + ew * 0.62, fC);
      part(g, G.torus(ew * 1.32, ew * 0.16, 6, 20), gm, undefined, [1, 0.95, 1], undefined, fo);
    }
    part(surf(hs, 0, eyePitch + 0.02, fR + ew * 0.6, fC), G.capsule(ew * 0.12, ew * 0.5, 4), gm, undefined, 1, [0, 0, Math.PI / 2], fo);
  }

  // ── hats ──
  const top = headOnBody ? headR * 0.75 : kind === 'cupcake' ? headR * 1.2 : headR * 0.92;
  if (hat === 'crown') {
    const cg = grp(hs, [0.04, top + (kind === 'princess' ? 0.16 : 0.06), 0]);
    const gold = M.get('#ffd34a');
    part(cg, cached('folk-crown', () => new THREE.CylinderGeometry(0.12, 0.11, 0.08, 18, 1, false)), gold, [0, 0, 0]);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; part(cg, G.cone(), gold, [Math.sin(a) * 0.115, 0.07, Math.cos(a) * 0.115], [0.035, 0.08, 0.035]); part(cg, G.ball(), gold, [Math.sin(a) * 0.115, 0.12, Math.cos(a) * 0.115], 0.016); }
    part(cg, G.ball(), M.get('#ff4f7a'), [0, 0.02, 0.12], 0.03);
    cg.rotation.z = -0.2;
  } else if (hat === 'bow') {
    const bg = grp(hs, [headR * 0.5, top - 0.02, 0.02]);
    for (const sx of [1, -1]) part(bg, G.sphere(), acc, [sx * 0.085, 0, 0], [0.095, 0.065, 0.045], [0, 0, sx * 0.3]);
    part(bg, G.ball(), acc, [0, 0, 0], 0.038);
    bg.rotation.z = -0.3;
  } else if (hat === 'top') {
    const dk = M.get('#3a2a4a');
    part(hs, G.cyl(), dk, [0, top + 0.13, 0], [0.16, 0.24, 0.16]);
    part(hs, G.cyl(), dk, [0, top + 0.01, 0], [0.27, 0.025, 0.27]);
    part(hs, G.cyl(), acc, [0, top + 0.05, 0], [0.165, 0.055, 0.165]);
    part(hs, G.sphere(), M.get('#ffd34a'), [0.1, top + 0.05, 0.12], [0.025, 0.025, 0.01], [0, 0.7, 0]);
  } else if (hat === 'beret') {
    part(hs, G.sphere(), acc, [0.05, top - 0.02, 0], [0.28, 0.085, 0.26], [0, 0, -0.22]);
    part(hs, G.capsule(0.012, 0.03), acc, [0.08, top + 0.07, 0], 1, [0, 0, -0.3]);
  } else if (hat === 'chef') {
    part(hs, G.cyl(), white, [0, top + 0.06, 0], [0.19, 0.14, 0.19]);
    for (let i = 0; i < 5; i++) part(hs, puffGeo(40 + i, 0.08), white, [Math.sin(i * 1.26) * 0.1, top + 0.2 + (i % 2) * 0.03, Math.cos(i * 1.26) * 0.1], 0.12);
  } else if (hat === 'helmet') {
    const gold = M.get('#ffd34a');
    part(hs, G.dome(), gold, [0, top - 0.12, 0], [headR * 1.08, headR * 0.95, headR * 1.08]);
    part(hs, G.torus(headR * 1.06, 0.022, 8, 32), M.get(shadeHex('#ffd34a', -0.2)), [0, top - 0.115, 0], 1, [Math.PI / 2, 0, 0]);
    // a candy-striped crest
    part(hs, G.capsule(0.04, 0.16), M.get('#ffffff', { map: caneTex('#ffffff', '#e8383d', 3) }), [0, top + 0.12, -0.02], 1, [Math.PI / 2 - 0.2, 0, 0]);
    part(hs, G.cone(), M.get(accent), [0, top + 0.2, 0.02], [0.04, 0.12, 0.04]);
  } else if (hat === 'kerchief') {
    part(hs, G.dome(), acc, [0, top - 0.18, -0.02], [headR * 1.08, headR * 1.02, headR * 1.08], [-0.15, 0, 0]);
    for (const sx of [1, -1]) part(hs, G.sphere(), acc, [sx * 0.05, -headR * 0.75, headR * 0.25], [0.05, 0.035, 0.03], [0, 0, sx * 0.5]); // the knot under the chin
    part(hs, cached('folk-dots', () => merge(Array.from({ length: 9 }, (_, i) => { const a = -1.4 + (i % 5) * 0.7, p = 0.3 + Math.floor(i / 5) * 0.45; return { g: G.ball(), p: [Math.sin(a) * Math.cos(p), Math.sin(p), Math.cos(a) * Math.cos(p)] as V3, s: 0.06 }; }))), white, [0, top - 0.18, -0.02], [headR * 1.1, headR * 1.04, headR * 1.1], [-0.15, 0, 0], fo);
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
    part(g, G.sphere(), M.get('#e8383d'), [0, 1.52, 0], [0.06, 0.03, 0.06]);
  } else if (look.hold === 'pole') {
    const g = grp(hand, [hx, hy, 0.02], [0.1, 0, 0]);
    part(g, G.cyl(), M.get('#8a5a3a'), [0, 0.6, 0], [0.022, 1.7, 0.022]);
    part(g, G.torus(0.06, 0.012, 5, 12), M.get('#ffd34a'), [0.05, 1.45, 0], 1, [0, 0, 0]);
    noOutline(part(g, G.ball(), basic('#ffcf5a'), [0.1, 1.42, 0], 0.035));
  } else if (look.hold === 'lantern') {
    const g = grp(hand, [hx, hy - 0.04, 0.02]);
    part(g, G.cyl(), M.get('#3a2a2a'), [0, -0.02, 0], [0.012, 0.08, 0.012]);
    part(g, latheC('folk-lantern', [[0, 0, 0], [0.6, 0.05, 0.1], [1, 0.4, 0.4], [0.7, 0.9, 0.9], [0, 1, 1]], 12), basic('#ffe08a'), [0, -0.22, 0], [0.09, 0.18, 0.09]);
    part(g, G.cyl(), M.get('#ffd34a'), [0, -0.04, 0], [0.06, 0.03, 0.06]);
  } else if (look.hold === 'bag') {
    part(body, G.sphere(), M.get('#7a4a2a'), [-armX * 1.1, armY - 0.32, 0.06], [0.14, 0.13, 0.07]);
    part(body, G.torus(0.3, 0.018, 5, 20), M.get('#5a3a20'), [-0.04, armY - 0.06, 0.0], [1, 1.2, 0.6], [0, 0.2, 0.7]);
    part(body, G.ball(), M.get('#ffd34a'), [-armX * 1.1, armY - 0.26, 0.13], 0.025);
    part(body, G.capsule(0.03, 0.08), M.get('#fff6ee'), [-armX * 1.1 + 0.03, armY - 0.2, 0.04], 1, [0, 0, 0.4]); // a letter sticking out
  } else if (look.hold === 'extinguisher') {
    const g = grp(hand, [hx, hy - 0.08, 0.06]);
    part(g, G.capsule(0.07, 0.2, 10), M.get('#e8383d'), [0, -0.05, 0]);
    part(g, G.cyl(), M.get('#3a3a44'), [0, 0.13, 0], [0.025, 0.06, 0.025]);
    part(g, G.cyl(), M.get('#3a3a44'), [0.05, 0.15, 0.03], [0.012, 0.12, 0.012], [0, 0, 1.2]);
    part(g, G.cyl(), M.get('#ffffff'), [0, -0.03, 0.0], [0.072, 0.04, 0.072]);
  }
  const sootM = look.soot ? basic('#3a2e2e', { transparent: true, opacity: 0.5, depthWrite: false }) : null;
  if (sootM) {
    for (const [x, y, sc] of [[-0.12, 0.1, 0.05], [0.15, -0.06, 0.04], [0.05, 0.17, 0.03]] as const) {
      const [yw, pt] = ang(x, y - fC[1], fR);
      noOutline(part(surf(hs, yw, pt, fR * 1.0, fC), G.sphere(), sootM, undefined, [sc, sc * 0.7, 0.006], undefined, fo));
    }
    noOutline(part(torso, G.sphere(), sootM, [0.12, hipY + 0.5, 0.31], [0.06, 0.04, 0.01], undefined, fo));
  }
  flatten(hs);

  // ── animation ──
  let t = Math.random() * 10, walkPh = 0, bob = 0, waveK = 0, cheerK = 0, sitK = 0, scaredK = 0, lookCur = 0;
  const greyMats = M.all;
  const baseColors = greyMats.map((m) => m.color.clone());
  let greyCur = 0;
  const height = (headY + (kind === 'cupcake' ? headR * 1.5 : headR) + (hat === 'none' ? 0 : hat === 'top' || hat === 'chef' ? 0.3 : 0.15)) * s;
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
      const talking = a.state === 'talk' || a.talk > 0.05;
      // body: breathe / bob / hop when cheering; a squashy bounce on each step
      const breathe = Math.sin(t * 2.2) * 0.015;
      const hop = cheerK * Math.max(0, Math.sin(t * 9)) * 0.12;
      const step = bob * Math.abs(Math.cos(walkPh));
      body.position.y = step * 0.05 + hop - sitK * (hipY - 0.06) * s;
      torso.scale.set(1 - breathe * 0.5 + (1 - step) * bob * 0.03, 1 + breathe - (1 - step) * bob * 0.04, 1 - breathe * 0.5);
      body.rotation.z = bob * Math.sin(walkPh) * 0.06 + scaredK * Math.sin(t * 30) * 0.02;
      body.rotation.x = bob * 0.06 - scaredK * 0.08;
      // legs
      legs[0].rotation.x = walking ? sw * 0.7 : -sitK * 1.45;
      legs[1].rotation.x = walking ? -sw * 0.7 : -sitK * 1.45;
      // arms: swing, wave (right), cheer (both up), talk gestures (both hands, offset), scared (hands up to the face)
      for (let i = 0; i < 2; i++) {
        const sx = i === 0 ? -1 : 1;
        let rx = walking ? (i === 0 ? -sw : sw) * 0.6 : Math.sin(t * 1.8 + i) * 0.05;
        let rz = sx * (0.12 + Math.sin(t * 1.4 + i * 2) * 0.03);
        if (talking && !walking) { rx = -0.45 - Math.max(0, Math.sin(t * (i ? 3.3 : 4.1) + i * 2)) * 0.45; rz = sx * (0.25 + 0.15 * Math.sin(t * 2.7 + i)); }
        if (i === 1 && waveK > 0.01) { rz = sx * (0.12 + waveK * 2.4) + Math.sin(t * 12) * 0.35 * waveK; rx *= 1 - waveK; }
        if (cheerK > 0.01) { rz = sx * (0.12 + cheerK * 2.6) + Math.sin(t * 10 + i) * 0.15 * cheerK; }
        if (scaredK > 0.01) { rx = rx * (1 - scaredK) - 2.2 * scaredK; rz = sx * (0.2 + 0.3 * scaredK); }
        arms[i].rotation.set(rx, 0, rz);
      }
      // head: look toward something, little tilt; nods while talking
      lookCur = damp(lookCur, clamp(a.look, -1.1, 1.1), 6, dt);
      head.rotation.y = lookCur;
      head.rotation.z = Math.sin(t * 0.9) * 0.05 + (talking ? Math.sin(t * 3.1) * 0.07 : 0) + waveK * 0.12;
      head.rotation.x = talking ? Math.sin(t * 4.3) * 0.05 : -cheerK * 0.12;
      // face
      const g = clamp(a.grey ?? 0, 0, 1);
      const ex: HeroExpr = a.state === 'wave' || a.state === 'cheer' ? 'happy' : a.state === 'scared' ? 'scared' : g > 0.5 ? 'sleepy' : 'normal';
      face.update(dt, ex, clamp(a.talk, 0, 1), { look: { x: clamp(-lookCur * 0.3, -1, 1), y: 0 }, browBias: talking ? 0.15 : 0 });
      // greyness (night: drained of colour)
      if (Math.abs(g - greyCur) > 0.004) {
        greyCur = g;
        greyMats.forEach((m, k) => m.color.copy(baseColors[k]).lerp(toonGrey, g * 0.85));
      }
    },
    dispose() { for (const m of M.all) m.dispose(); face.dispose(); sootM?.dispose(); },
  };
}

const DEF_COLOR: Record<FolkKind, string> = {
  gumdrop: '#ff6a9a', marsh: '#fff6f8', ginger: '#c8803e', lolly: '#ff5a8a', cupcake: '#ffc8e0', toffee: '#d89040', princess: '#ff8ab4',
};
const DEF_ACCENT: Record<FolkKind, string> = {
  gumdrop: '#ffd34a', marsh: '#ff9fc0', ginger: '#ffffff', lolly: '#7ad8ff', cupcake: '#7ad8ff', toffee: '#ff5a7a', princess: '#c88aff',
};
const DEF_IRIS: Record<FolkKind, string> = {
  gumdrop: '#5a3a9a', marsh: '#6a8ae0', ginger: '#4a2a14', lolly: '#2a7ad8', cupcake: '#b0408a', toffee: '#7a4a1a', princess: '#1fb5c4',
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
