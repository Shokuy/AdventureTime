import * as THREE from 'three';
import { basic, noOutline } from '../../../gfx';
import { G, Mats, TAU, clamp, damp, grp, part, cached, Blinker } from '../../../models/kit';
import type { Rig } from '../../../models/rig';

/**
 * Rigs of «Чёрный перевал» (fangs4): the twin sisters Ночка / Тенька, the mountain goats (пресняки), one bat of the
 * swarm (an instanced shape), the Солнечный камень (an old-world traffic light) and the castle on the horizon.
 * Feet at y = 0, facing +Z. Every rig has its own materials (Mats): flash / greyness touch only it.
 */

const fo = { cast: false };

// ═════════════════════════════ СЁСТРЫ БЛИЗНЯШКИ ═════════════════════════════
export type SisterKind = 'nochka' | 'tenka';
export interface SisterAnim {
  /** pose: idle walk look mark dashPrep dash swap blind hurt down talk */
  st: string;
  /** 0..1 inside the pose */
  p: number;
  /** head turn relative to the body (rad) — where her gaze goes */
  head: number;
  flash: number;
  talk: number;
  /** 0..1 glow of the eyes (the gaze is on) */
  eyes: number;
}
export interface SisterRig extends Rig<SisterAnim> {
  M: Mats;
  top: number;
  head: THREE.Object3D;
  /** eye level (world, for the gaze beam) */
  eyeY: number;
}

const SIS = {
  nochka: { dress: '#221a30', dressIn: '#4a2a6a', hair: '#141019', bow: '#7a4cff', eye: '#9a7aff', skin: '#d9cdea' },
  tenka: { dress: '#a678d8', dressIn: '#e6c8ff', hair: '#efe6ff', bow: '#ff6ad8', eye: '#ff8ae6', skin: '#e2d6f0' },
} as const;
export const SISTER_COLOR: Record<SisterKind, string> = { nochka: '#8a5cff', tenka: '#ff6ad8' };

/** a vampire girl in a long dress, a high collar and a big bow; Ночка in black (bun), Тенька in lilac (pigtails) */
export function createSister(kind: SisterKind): SisterRig {
  const c = SIS[kind];
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'sister-' + kind;
  const base = grp(root);
  const body = grp(base, [0, 0, 0]);
  // the long bell skirt (floats a little above the ground: they hover)
  const skirt = part(body, cached('sis-skirt', () => new THREE.CylinderGeometry(0.16, 0.42, 0.78, 20, 1, true).translate(0, 0.39, 0)), M.get(c.dress, { side: THREE.DoubleSide }), [0, 0.06, 0]);
  part(body, cached('sis-skirtIn', () => new THREE.CylinderGeometry(0.155, 0.41, 0.76, 20, 1, true).translate(0, 0.39, 0)), M.get(c.dressIn, { side: THREE.BackSide }), [0, 0.07, 0], undefined, undefined, fo);
  // hem scallops
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    part(body, G.ball(), M.get(c.dressIn), [Math.sin(a) * 0.41, 0.08, Math.cos(a) * 0.41], [0.07, 0.04, 0.07], undefined, fo);
  }
  const torso = grp(body, [0, 0.84, 0]);
  part(torso, G.sphere(), M.get(c.dress), [0, 0.06, 0], [0.17, 0.2, 0.14]);
  // high collar
  for (const s of [1, -1]) part(torso, G.cone(), M.get(c.dressIn, { side: THREE.DoubleSide }), [s * 0.11, 0.24, -0.04], [0.1, 0.18, 0.02], [0.2, s * 0.5, s * -0.4], fo);
  // the bow on the chest
  for (const s of [1, -1]) part(torso, G.cone(), M.get(c.bow), [s * 0.05, 0.16, 0.13], [0.05, 0.07, 0.03], [0, 0, s * Math.PI / 2], fo);
  part(torso, G.ball(), M.get(c.bow), [0, 0.16, 0.14], 0.03, undefined, fo);
  const skin = M.get(c.skin);
  const arms: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const a = grp(torso, [s * 0.17, 0.14, 0]);
    part(a, G.capsule(0.04, 0.18), M.get(c.dress), [0, -0.12, 0]);
    part(a, G.sphere(), skin, [0, -0.26, 0.01], 0.045);
    arms.push(a);
  }
  const head = grp(torso, [0, 0.42, 0.01]);
  part(head, G.sphere(), skin, [0, 0, 0], [0.2, 0.2, 0.19]);
  // ears (pointy)
  for (const s of [1, -1]) part(head, G.cone(), skin, [s * 0.2, 0.02, -0.02], [0.035, 0.11, 0.025], [0, 0, s * -1.2]);
  // hair: a cap with heavy bangs; Ночка — a tall bun, Тенька — two pigtails
  const hairM = M.get(c.hair);
  part(head, G.dome(), hairM, [0, 0.02, -0.01], [0.215, 0.22, 0.21], [-0.2, 0, 0]);
  for (let i = -2; i <= 2; i++) part(head, G.ball(), hairM, [i * 0.07, 0.12, 0.15 - Math.abs(i) * 0.02], [0.06, 0.05, 0.04], undefined, fo);
  if (kind === 'nochka') {
    part(head, G.sphere(), hairM, [0, 0.27, -0.08], [0.12, 0.12, 0.12]);
    part(head, G.capsule(0.015, 0.22), M.get(c.bow), [0, 0.3, -0.08], 1, [0, 0, Math.PI / 2], fo);
  } else {
    for (const s of [1, -1]) {
      part(head, G.sphere(), hairM, [s * 0.22, -0.02, -0.06], [0.07, 0.08, 0.07]);
      part(head, G.capsule(0.05, 0.22), hairM, [s * 0.27, -0.18, -0.07], 1, [0, 0, s * 0.2]);
      part(head, G.cone(), M.get(c.bow), [s * 0.24, 0.04, -0.06], [0.04, 0.06, 0.03], [0, 0, s * Math.PI / 2], fo);
    }
  }
  // eyes: big, slanted, glowing when she watches
  const white = basic('#fff6f0'), pupM = basic(c.eye);
  const whites: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    whites.push(part(head, G.ball(), white, [s * 0.075, 0.0, 0.165], [0.055, 0.06, 0.025], [0, 0, s * 0.25], fo));
    part(head, G.ball(), pupM, [s * 0.072, -0.005, 0.185], [0.028, 0.038, 0.012], undefined, fo);
    part(head, G.capsule(0.01, 0.07), basic('#1b1214'), [s * 0.08, 0.075, 0.17], 1, [0, 0, Math.PI / 2 + s * 0.35], fo);
  }
  const glow = part(head, G.ball(), basic(c.eye, { additive: true, opacity: 0, depthWrite: false }), [0, 0, 0.19], [0.17, 0.055, 0.03], undefined, { cast: false, receive: false });
  noOutline(glow);
  // mouth + fangs
  const mouth = grp(head, [0, -0.1, 0.17]);
  const mIn = part(mouth, G.ball(), basic('#4a0f1c'), [0, 0, 0], [0.045, 0.02, 0.015], undefined, fo);
  for (const k of [1, -1]) part(mouth, G.cone(), basic('#ffffff'), [k * 0.025, -0.012, 0.008], [0.012, 0.03, 0.012], [Math.PI, 0, 0], fo);
  // stars for the dazed poses
  const stars = grp(head, [0, 0.38, 0]);
  for (let i = 0; i < 4; i++) part(stars, G.ball(), basic('#ffe14a'), [Math.cos(i * TAU / 4) * 0.22, 0, Math.sin(i * TAU / 4) * 0.22], 0.045, undefined, fo);
  stars.visible = false;
  const blinker = new Blinker();
  const eyeY = whites.map((w) => w.scale.y);
  let t = Math.random() * 5, lean = 0, armL = 0, armR = 0, spin = 0, crouch = 0, headK = 0, glowK = 0, sit = 0;
  const rig: SisterRig = {
    root, M, top: 1.62, head, eyeY: 1.26,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      let wLean = 0, wL = 0.15, wR = 0.15, wCrouch = 0, wSit = 0, spinV = 0;
      const hover = 0.08 + Math.sin(t * 2.2) * 0.04;
      switch (a.st) {
        case 'walk': wLean = 0.12; break;
        case 'mark': wR = 1.6 + Math.sin(t * 20) * 0.05; wLean = -0.05; break; // points at you
        case 'dashPrep': wCrouch = 0.6 * a.p; wLean = 0.35; wL = -0.9; wR = -0.9; break;
        case 'dash': wLean = 0.9; wL = -1.4; wR = -1.4; break;
        case 'swap': spinV = 22; wL = 1.2; wR = 1.2; break;
        case 'blind': wL = 2.4; wR = 2.4; wLean = Math.sin(t * 6) * 0.12; break; // hands over the eyes
        case 'hurt': wLean = -0.35; wL = 0.6; wR = 0.6; break;
        case 'down': wSit = 1; wL = 0.4; wR = 0.4; break;
        case 'talk': wL = 0.3 + Math.sin(t * 3) * 0.1; break;
      }
      lean = damp(lean, wLean, 12, dt); crouch = damp(crouch, wCrouch, 12, dt); sit = damp(sit, wSit, 6, dt);
      armL = damp(armL, wL, 12, dt); armR = damp(armR, wR, 12, dt);
      if (spinV) spin += spinV * dt; else spin = damp(spin, Math.round(spin / TAU) * TAU, 8, dt);
      base.position.y = hover * (1 - sit) - crouch * 0.15 - sit * 0.3;
      base.rotation.y = spin;
      body.rotation.x = lean;
      skirt.scale.set(1 + sit * 0.25, 1 - sit * 0.35, 1 + sit * 0.25);
      torso.position.y = 0.84 - sit * 0.28;
      arms[0].rotation.set(-armR, 0, 0.12); arms[1].rotation.set(-armL, 0, -0.12);
      headK = damp(headK, clamp(a.head, -1.3, 1.3), 10, dt);
      head.rotation.set(-lean * 0.5 + (a.st === 'down' ? 0.25 : 0), headK, a.st === 'blind' || a.st === 'down' ? Math.sin(t * 4) * 0.15 : 0);
      glowK = damp(glowK, a.eyes, 8, dt);
      (glow.material as THREE.MeshBasicMaterial).opacity = glowK * 0.55;
      glow.visible = glowK > 0.02;
      const open = a.talk > 0 ? 0.3 + a.talk * 0.7 : a.st === 'hurt' || a.st === 'swap' ? 0.8 : 0;
      mouth.scale.set(1, 1 + open * 2, 1);
      mIn.visible = open > 0.1;
      stars.visible = a.st === 'blind' || a.st === 'down';
      if (stars.visible) stars.rotation.y = t * 4;
      const bl = blinker.update(dt);
      whites.forEach((e, i) => { e.scale.y = eyeY[i] * (a.st === 'blind' ? 0.25 : 1 - 0.9 * bl); });
      M.flash(a.flash);
    },
  };
  return rig;
}

// ═════════════════════════════ ГОРНЫЙ КОЗЛИК (пресняк) ═════════════════════════════
export interface GoatAnim { st: string; speed: number; flash: number }
export interface GoatRig extends Rig<GoatAnim> { M: Mats; top: number; sleepy: number }

/** a small round mountain goat: ginger with a cream belly, little horns, a beard (grey while drained) */
export function createGoat(seed = 0): GoatRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'goat';
  const base = grp(root);
  const fur = M.get(['#e8893a', '#d8742a', '#f09a4a'][seed % 3]), cream = M.get('#fff0d8'), hoof = M.get('#3a2418'), horn = M.get('#e8d8b8');
  const body = grp(base, [0, 0.42, 0]);
  part(body, G.sphere(), fur, [0, 0, 0], [0.3, 0.24, 0.38]);
  part(body, G.sphere(), cream, [0, -0.08, 0.04], [0.22, 0.15, 0.3]);
  part(body, G.cone(), fur, [0, 0.12, -0.38], [0.05, 0.12, 0.05], [-0.9, 0, 0], fo); // tail
  const legs: THREE.Group[] = [];
  for (const [x, z] of [[0.16, 0.22], [-0.16, 0.22], [0.16, -0.22], [-0.16, -0.22]] as const) {
    const l = grp(base, [x, 0.34, z]);
    part(l, G.capsule(0.05, 0.18), fur, [0, -0.13, 0]);
    part(l, G.sphere(), hoof, [0, -0.3, 0.01], [0.055, 0.04, 0.06]);
    legs.push(l);
  }
  const head = grp(body, [0, 0.16, 0.38]);
  part(head, G.sphere(), fur, [0, 0.06, 0.05], [0.17, 0.16, 0.19]);
  part(head, G.sphere(), cream, [0, 0.0, 0.2], [0.1, 0.08, 0.08]);
  part(head, G.cone(), cream, [0, -0.12, 0.17], [0.05, 0.12, 0.04], [Math.PI, 0, 0], fo); // beard
  for (const s of [1, -1]) {
    part(head, G.cone(), horn, [s * 0.08, 0.24, 0.0], [0.035, 0.14, 0.035], [-0.5, 0, s * 0.3], fo);
    part(head, G.sphere(), fur, [s * 0.18, 0.08, 0.0], [0.09, 0.035, 0.05], [0, 0, s * -0.4], fo); // ears
  }
  const white = basic('#ffffff'), pupil = basic('#1b1214');
  const whites: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    whites.push(part(head, G.ball(), white, [s * 0.075, 0.1, 0.19], [0.045, 0.05, 0.02], undefined, fo));
    part(head, G.ball(), pupil, [s * 0.075, 0.095, 0.205], [0.025, 0.012, 0.01], undefined, fo);
  }
  const blinker = new Blinker();
  const eyeY = whites.map((w) => w.scale.y);
  let t = Math.random() * 5, walk = 0, hop = 0;
  const rig: GoatRig = {
    root, M, top: 0.9, sleepy: 1,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      walk += dt * clamp(a.speed, 0, 4) * 5;
      const sw = a.speed > 0.15 ? Math.sin(walk) : 0;
      legs[0].rotation.x = sw * 0.6; legs[3].rotation.x = sw * 0.6; legs[1].rotation.x = -sw * 0.6; legs[2].rotation.x = -sw * 0.6;
      const happy = a.st === 'happy' || a.st === 'wave';
      hop = happy ? Math.abs(Math.sin(t * 7)) * 0.18 : damp(hop, 0, 10, dt);
      base.position.y = hop;
      head.rotation.x = a.st === 'stun' ? Math.sin(t * 8) * 0.2 : happy ? -0.2 + Math.sin(t * 7) * 0.15 : 0.35 * this.sleepy + Math.sin(t * 1.3) * 0.05;
      head.rotation.z = a.st === 'stun' ? Math.sin(t * 5) * 0.3 : 0;
      body.rotation.z = a.st === 'stun' ? Math.sin(t * 6) * 0.1 : 0;
      const bl = blinker.update(dt);
      whites.forEach((e, i) => { e.scale.y = eyeY[i] * (this.sleepy > 0.5 ? 0.35 : 1 - 0.9 * bl); });
      M.flash(a.flash);
    },
  };
  return rig;
}

// ═════════════════════════════ BAT OF THE SWARM (instanced) ═════════════════════════════
/** one bat: body + ears + two wings (flaps by scaling the instance on X) */
export function swarmBatGeo(): THREE.BufferGeometry {
  return cached('f4-swarmbat', () => {
    const parts: THREE.BufferGeometry[] = [];
    const b = new THREE.SphereGeometry(0.16, 8, 6); b.scale(1, 0.9, 1.2); parts.push(b);
    for (const s of [1, -1]) {
      const e = new THREE.ConeGeometry(0.05, 0.12, 4); e.translate(s * 0.07, 0.17, 0.04); parts.push(e);
      const w = new THREE.BufferGeometry();
      const v = new Float32Array([
        s * 0.1, 0.02, 0.06, s * 0.62, 0.12, 0.02, s * 0.5, -0.06, -0.12,
        s * 0.1, 0.02, 0.06, s * 0.5, -0.06, -0.12, s * 0.12, -0.02, -0.14,
      ]);
      w.setAttribute('position', new THREE.BufferAttribute(v, 3));
      w.computeVertexNormals();
      parts.push(w);
    }
    // merge (non-indexed)
    const all = parts.map((g) => (g.index ? g.toNonIndexed() : g));
    let n = 0; for (const g of all) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    let o = 0;
    for (const g of all) {
      if (!g.attributes.normal) g.computeVertexNormals();
      pos.set(g.attributes.position.array as Float32Array, o * 3);
      nor.set(g.attributes.normal.array as Float32Array, o * 3);
      o += g.attributes.position.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return out;
  });
}

// ═════════════════════════════ СОЛНЕЧНЫЙ КАМЕНЬ ═════════════════════════════
export interface SunStone { root: THREE.Group; lens: THREE.MeshToonMaterial; glow: THREE.Sprite; set(k: number, blink: number): void }
/**
 * The «Солнечный камень»: a huge dull amber lens in a black housing with a visor, on a rusty pole — an old-world
 * traffic light (the joke of 8.6: «мигал жёлтым, чтобы все были осторожны»). set(k): 0 dull … 1 glowing.
 */
export function createSunStone(glowTexture: THREE.Texture): SunStone {
  const root = new THREE.Group();
  const rust = new THREE.MeshToonMaterial({ color: '#7a3e22' });
  const rust2 = new THREE.MeshToonMaterial({ color: '#a8582c' });
  const black = new THREE.MeshToonMaterial({ color: '#1e1a22' });
  // a short rusty stump (the rest of the post sank into the rock), the huge housing right on top of it
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.45, 1.1, 12), rust);
  pole.position.y = 0.55; pole.castShadow = true; root.add(pole);
  for (const y of [0.15, 0.85]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 6, 16), rust2); r.rotation.x = Math.PI / 2; r.position.y = y; root.add(r); }
  const HY = 2.0;
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.0, 1.1), black);
  box.position.set(0, HY, 0); box.castShadow = true; root.add(box);
  const lensM = new THREE.MeshToonMaterial({ color: '#6a5020', emissive: new THREE.Color('#000000') });
  for (const s of [1, -1]) {
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.72, 24, 14, 0, TAU, 0, Math.PI / 2), lensM);
    lens.rotation.x = s * Math.PI / 2; lens.position.set(0, HY, s * 0.55); lens.scale.set(1, 0.55, 1);
    root.add(lens);
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.86, 0.6, 20, 1, true, -Math.PI / 2, Math.PI), new THREE.MeshToonMaterial({ color: '#1e1a22', side: THREE.DoubleSide }));
    visor.rotation.x = Math.PI / 2; visor.position.set(0, HY + 0.04, s * 0.8); if (s < 0) visor.rotation.z = Math.PI;
    root.add(visor);
  }
  // little dark lenses above and below (the red and the green: long dead)
  for (const [dy, c] of [[1.05, '#3a1414'], [-1.05, '#143a1a']] as const) {
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.18, 14), new THREE.MeshToonMaterial({ color: c }));
    l.position.set(0.62, HY + dy * 0.62, 0.56); root.add(l);
  }
  // rivets and a little sign plate on the pole
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.06), new THREE.MeshToonMaterial({ color: '#d8c890' }));
  plate.position.set(0, 0.7, 0.5); root.add(plate);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: '#ffc040', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  glow.scale.setScalar(5); glow.position.set(0, HY, 0);
  noOutline(glow); root.add(glow);
  const dull = new THREE.Color('#6a5020'), lit = new THREE.Color('#ffd040'), em = new THREE.Color('#ffa818'), off = new THREE.Color('#000000');
  return {
    root, lens: lensM, glow,
    set(k: number, blink: number) {
      const b = k * (0.55 + 0.45 * blink);
      lensM.color.copy(dull).lerp(lit, k);
      lensM.emissive.copy(off).lerp(em, b);
      (glow.material as THREE.SpriteMaterial).opacity = b * 0.85;
    },
  };
}

// ═════════════════════════════ ЗАМОК ПОЛНОЧЬ (far away) ═════════════════════════════
/** the castle on its crag on the horizon: unlit silhouettes, red windows (never fogged) */
export function createFarCastle(): THREE.Group {
  const g = new THREE.Group();
  const dark = basic('#1a0d20', { fog: false }), dark2 = basic('#24122c', { fog: false }), win = basic('#ff4a5a', { fog: false });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); noOutline(o); o.castShadow = false; o.receiveShadow = false; g.add(o); return o; };
  // the crag
  add(new THREE.ConeGeometry(70, 120, 7), dark2, 0, 20, 0);
  add(new THREE.ConeGeometry(40, 90, 6), dark2, 40, 0, 20);
  add(new THREE.ConeGeometry(45, 80, 6), dark2, -45, -5, 15);
  // keep + towers with pointed roofs
  add(new THREE.BoxGeometry(34, 40, 26), dark, 0, 98, 0);
  const towers: [number, number, number, number][] = [[-20, 0, 6, 70], [20, 0, 6, 64], [0, -14, 7, 92], [-10, 12, 4.5, 58], [12, 12, 4.5, 54]];
  for (const [x, z, r, h] of towers) {
    add(new THREE.CylinderGeometry(r, r * 1.1, h, 10), dark, x, 78 + h / 2, z);
    add(new THREE.ConeGeometry(r * 1.4, r * 3.2, 10), dark, x, 78 + h + r * 1.6, z);
    for (let i = 0; i < 3; i++) add(new THREE.PlaneGeometry(r * 0.35, r * 0.6), win, x, 86 + i * (h / 4), z + r * 1.05 + 0.2);
  }
  for (let i = 0; i < 5; i++) add(new THREE.PlaneGeometry(2.2, 3.6), win, -12 + i * 6, 102, 13.2);
  return g;
}
