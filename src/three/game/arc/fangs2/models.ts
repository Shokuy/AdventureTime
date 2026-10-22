import * as THREE from 'three';
import { basic, noOutline } from '../../../gfx';
import { G, Mats, TAU, clamp, damp, grp, part, Blinker, lerp } from '../../../models/kit';
import { glowTex } from '../../../world/textures';
import type { VRig, VAnim } from '../vampires';

/**
 * Cartoon rigs of «Туманные топи»: the swamp's creatures (болотный упырь = a recoloured Клыкарь, лягушка-кровосос,
 * огонёк-обманка, frog villagers), Камыш the ferryman, Матушка Светлячиха and the forms of Мадам Морок (the veiled
 * lady, the wolf, the giant toad, a crow). Feet at y = 0, facing +Z. Every rig has its own materials (Mats) so hit
 * flashes and the grey zones (markCharacter) only touch it.
 */

const fo = { cast: false };
const EYE_W = '#fff6e0';

function eyes(parent: THREE.Object3D, M: Mats, o: { x: number; y: number; z: number; r: number; pupil?: string; lid?: string }) {
  const white = basic(EYE_W), pup = basic(o.pupil ?? '#1b1214');
  const whites: THREE.Mesh[] = [], lids: THREE.Mesh[] = [], pupils: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    whites.push(part(parent, G.ball(), white, [s * o.x, o.y, o.z], [o.r, o.r * 1.1, o.r * 0.7], undefined, fo));
    pupils.push(part(parent, G.ball(), pup, [s * o.x, o.y - o.r * 0.05, o.z + o.r * 0.55], [o.r * 0.45, o.r * 0.55, o.r * 0.25], undefined, fo));
    if (o.lid) lids.push(part(parent, G.dome(), M.get(o.lid), [s * o.x, o.y, o.z + o.r * 0.05], [o.r * 1.12, o.r * 1.2, o.r * 0.85], [0, 0, 0], fo));
  }
  return { whites, lids, pupils };
}

function glowSprite(color: string, size: number, opacity = 0.8) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  s.scale.setScalar(size);
  noOutline(s);
  return s;
}

// ═════════════════════════════ БОЛОТНЫЙ УПЫРЬ (a Клыкарь gone green) ═════════════════════════════
const GHOUL_SWAP: Record<string, string> = {
  c4b2e6: '#9cb88e', a893cf: '#7f9a72', // skin
  '33284a': '#2e3a26', '17111f': '#1a2016', // trousers, shoes
  '3a2d58': '#34452c', efe6f4: '#c8d4a8', // coat, shirt
  '2b2140': '#1f2e22', b8213a: '#5c7a2a', // cape, lining
  '1d1630': '#23361e', // hair
};
/** recolour a Клыкарь rig into a swamp ghoul (moss and duckweed instead of velvet) and hang some weed on him */
export function ghoulize(rig: VRig) {
  for (const m of rig.M.all) {
    const k = m.color.getHexString();
    const to = GHOUL_SWAP[k];
    if (to) m.color.set(to);
  }
  // weed strands over the head and shoulders
  const weed = rig.M.get('#4f7a2e');
  const head = rig.root.getObjectByName('fanger');
  if (head) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      const w = part(rig.root, G.capsule(0.018, 0.22 + (i % 3) * 0.06, 6), weed, [Math.sin(a) * 0.2, 0.95 + (i % 2) * 0.06, Math.cos(a) * 0.17], 1, [Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5], fo);
      w.userData.weed = i;
    }
  }
}

// ═════════════════════════════ ЛЯГУШКА-КРОВОСОС ═════════════════════════════
/** poses: idle walk hop crouch leap recover hiss stun burn */
export function createBloodFrog(): VRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'bloodfrog';
  const base = grp(root);
  const skin = M.get('#5f7d3e'), skinD = M.get('#45602c'), back = M.get('#4b2f5a'), belly = M.get('#dfe3b4');
  const body = grp(base, [0, 0.26, 0]);
  part(body, G.sphere(), skin, [0, 0, 0], [0.36, 0.25, 0.38]);
  part(body, G.sphere(), back, [0, 0.07, -0.06], [0.3, 0.17, 0.3]);
  part(body, G.sphere(), belly, [0, -0.06, 0.13], [0.26, 0.17, 0.24]);
  // warts
  for (let i = 0; i < 8; i++) { const a = i * 2.3; part(body, G.ball(), skinD, [Math.sin(a) * 0.22, 0.15 + (i % 3) * 0.02, Math.cos(a) * 0.2 - 0.06], 0.035, undefined, fo); }
  // a red collar (the vampire's cape)
  const cape = part(body, G.cone(), M.get('#a01c34', { side: THREE.DoubleSide }), [0, 0.12, -0.12], [0.3, 0.18, 0.2], [-0.6, 0, 0]);
  cape.castShadow = false;
  // head (part of the body, like a frog)
  const head = grp(body, [0, 0.12, 0.2]);
  const E = eyes(head, M, { x: 0.15, y: 0.14, z: 0.02, r: 0.085, pupil: '#d0202e', lid: '#5f7d3e' });
  for (const s of [1, -1]) part(head, G.sphere(), skin, [s * 0.15, 0.12, -0.02], [0.1, 0.1, 0.1]);
  const jaw = grp(head, [0, -0.05, 0.08]);
  const mouth = part(jaw, G.ball(), basic('#4a0f1c'), [0, 0, 0.02], [0.2, 0.03, 0.08], undefined, fo);
  for (const s of [1, -1]) part(jaw, G.cone(), basic('#ffffff'), [s * 0.06, -0.04, 0.09], [0.022, 0.06, 0.02], [Math.PI, 0, 0], fo);
  // little bat wings on the back
  const wingM = M.get('#3a2448', { side: THREE.DoubleSide });
  const wingPv: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const pv = grp(body, [s * 0.12, 0.18, -0.18]);
    const g = new THREE.Shape(); g.moveTo(0, 0); g.quadraticCurveTo(0.2, 0.18, 0.34, 0.06); g.lineTo(0.26, -0.04); g.lineTo(0.18, 0.02); g.lineTo(0.1, -0.06); g.closePath();
    const w = part(pv, new THREE.ShapeGeometry(g, 6), wingM, [0, 0, 0], [s, 1, 1], [0, -s * 0.5, 0]);
    w.castShadow = false;
    wingPv.push(pv);
  }
  // legs: big back legs, small front legs
  const backL: THREE.Group[] = [], frontL: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const b = grp(base, [s * 0.26, 0.14, -0.12]);
    part(b, G.sphere(), skin, [0, 0.02, 0], [0.12, 0.1, 0.18]);
    part(b, G.sphere(), skinD, [0, -0.1, 0.12], [0.1, 0.04, 0.14], undefined, fo);
    backL.push(b);
    const f = grp(base, [s * 0.18, 0.16, 0.22]);
    part(f, G.capsule(0.04, 0.12), skin, [0, -0.06, 0], 1, [0.2, 0, 0]);
    part(f, G.sphere(), skinD, [0, -0.14, 0.03], [0.06, 0.025, 0.07], undefined, fo);
    frontL.push(f);
  }
  const glow = part(head, G.ball(), basic('#ff3040', { additive: true, opacity: 0, depthWrite: false }), [0, 0.14, 0.06], [0.28, 0.08, 0.04], undefined, { cast: false, receive: false });
  noOutline(glow);
  const blinker = new Blinker();
  let t = Math.random() * 5, sq = 0, open = 0, glowK = 0, stretch = 0;
  return {
    root, M, top: 0.62,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      let wantSq = 0, wantOpen = 0, wantGlow = 0, wantStretch = 0, flap = Math.sin(t * 3) * 0.15, tilt = 0;
      switch (a.st) {
        case 'hop': wantStretch = 0.6; flap = Math.sin(t * 30) * 0.6; break;
        case 'crouch': wantSq = 0.35 + 0.15 * a.p; wantGlow = 0.4 + 0.6 * a.p; wantOpen = 0.4; flap = Math.sin(t * 24) * 0.4; break;
        case 'leap': wantStretch = 1; wantOpen = 1; wantGlow = 1; flap = Math.sin(t * 34) * 0.8; break;
        case 'recover': wantSq = 0.15; tilt = Math.sin(t * 6) * 0.12; break;
        case 'hiss': wantOpen = 1; flap = Math.sin(t * 20) * 0.5; wantGlow = 0.3; break;
        case 'stun': tilt = Math.sin(t * 7) * 0.25; break;
        case 'burn': wantOpen = 0.8; flap = Math.sin(t * 40) * 0.7; tilt = Math.sin(t * 30) * 0.08; break;
        default: wantSq = 0.04 + Math.sin(t * 4) * 0.03; // breathing throat
      }
      sq = damp(sq, wantSq, 16, dt); open = damp(open, wantOpen, 18, dt); glowK = damp(glowK, wantGlow, 10, dt); stretch = damp(stretch, wantStretch, 14, dt);
      base.scale.set(1 + sq * 0.3 - stretch * 0.1, 1 - sq * 0.35 + stretch * 0.25, 1 + sq * 0.2 + stretch * 0.15);
      base.rotation.z = tilt;
      body.rotation.x = -stretch * 0.35;
      for (const b of backL) b.rotation.x = stretch * 1.1;
      for (const f of frontL) f.rotation.x = -stretch * 0.8;
      wingPv[0].rotation.z = flap; wingPv[1].rotation.z = -flap;
      jaw.rotation.x = open * 0.5;
      mouth.scale.y = 0.03 * (1 + open * 2);
      (glow.material as THREE.MeshBasicMaterial).opacity = glowK * 0.4;
      glow.visible = glowK > 0.02;
      const bl = blinker.update(dt);
      for (const l of E.lids) l.rotation.x = lerp(-1.4, 1.4, bl);
      M.flash(a.flash);
    },
  };
}

// ═════════════════════════════ ОГОНЁК-ОБМАНКА ═════════════════════════════
/** poses: idle lure stun — a cold blue-green flame with a sly face (it never blinks: real fireflies do) */
export function createWisp(): VRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'wisp';
  const bob = grp(root, [0, 0, 0]);
  const halo = glowSprite('#58ffd0', 2.4, 0.7);
  bob.add(halo);
  const core = part(bob, G.sphere(), basic('#d8fff4'), [0, 0, 0], 0.17, undefined, { cast: false, receive: false });
  const flameM = basic('#62ffcc', { additive: true, transparent: true, opacity: 0.55, depthWrite: false });
  const flame = part(bob, G.cone(), flameM, [0, 0.22, 0], [0.16, 0.42, 0.16], undefined, { cast: false, receive: false });
  const flame2 = part(bob, G.cone(), flameM, [0.05, 0.16, -0.03], [0.1, 0.3, 0.1], [0, 0, -0.4], { cast: false, receive: false });
  const ink = basic('#0a2a2a');
  const face = grp(bob, [0, 0, 0.15]);
  for (const s of [1, -1]) part(face, G.ball(), ink, [s * 0.055, 0.03, 0], [0.028, 0.04, 0.01], undefined, fo);
  const smile = part(face, G.arc(0.05, 0.012, Math.PI), ink, [0.01, -0.03, 0], 1, [0, 0, Math.PI + 0.25], fo);
  noOutline(root);
  let t = Math.random() * 5, k = 0;
  void M;
  return {
    root, M, top: 0.5,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      const lure = a.st === 'lure' ? 1 : 0;
      k = damp(k, lure, 6, dt);
      const s = 1 + k * 0.35 + Math.sin(t * (6 + k * 6)) * 0.06;
      bob.scale.setScalar(s);
      bob.position.y = Math.sin(t * 2.1) * 0.12;
      flame.scale.set(0.16, 0.42 + Math.sin(t * 13) * 0.08, 0.16); flame.rotation.z = Math.sin(t * 5) * 0.2;
      flame2.rotation.z = -0.4 + Math.sin(t * 7) * 0.2;
      halo.material.opacity = 0.55 + k * 0.35;
      smile.scale.set(1 + k * 0.4, 1 + k * 0.6, 1);
      core.scale.setScalar(0.17 + (a.st === 'stun' ? Math.sin(t * 20) * 0.03 : 0));
      if (a.flash > 0.3) halo.material.color.set('#ffffff'); else halo.material.color.set('#58ffd0');
    },
  };
}

// ═════════════════════════════ ЛЯГУШКИ-ЖИТЕЛИ (пресняки болота) ═════════════════════════════
const FROG_GREENS = ['#7cc45a', '#5fb88a', '#a8c84a', '#6ab0a0'];
/** poses: shuffle stun happy wave idle; `sleepy` (0..1) closes the eyelids */
export function createFrogFolk(seed = 0): VRig & { sleepy: number } {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'frogfolk';
  const base = grp(root);
  const c = FROG_GREENS[Math.abs(seed) % FROG_GREENS.length];
  const skin = M.get(c), skinD = M.get(new THREE.Color(c).multiplyScalar(0.8)), belly = M.get('#f2f0c8');
  const legs: THREE.Group[] = [], arms: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const l = grp(base, [s * 0.12, 0.14, 0]);
    part(l, G.capsule(0.06, 0.08), skin, [0, -0.04, 0]);
    part(l, G.sphere(), skinD, [s * 0.02, -0.13, 0.07], [0.09, 0.03, 0.12], undefined, fo);
    legs.push(l);
  }
  const body = grp(base, [0, 0.14, 0]);
  part(body, G.sphere(), skin, [0, 0.22, 0], [0.26, 0.28, 0.23]);
  part(body, G.sphere(), belly, [0, 0.18, 0.1], [0.19, 0.2, 0.15]);
  // clothes by seed: a straw hat, a scarf, an apron or a bow
  const style = Math.abs(seed * 7 + 3) % 4;
  const cloth = M.get(['#d85a3a', '#3a7ad8', '#e8b84a', '#c050a0'][Math.abs(seed) % 4]);
  if (style === 1) part(body, G.torus(0.2, 0.05, 8, 20), cloth, [0, 0.38, 0], 1, [Math.PI / 2, 0, 0]);
  if (style === 2) part(body, G.sphere(), cloth, [0, 0.12, 0.14], [0.2, 0.17, 0.08]);
  for (const s of [1, -1]) {
    const a = grp(body, [s * 0.24, 0.3, 0.02]);
    part(a, G.capsule(0.045, 0.14), skin, [s * 0.03, -0.08, 0], 1, [0, 0, s * 0.4]);
    part(a, G.sphere(), skinD, [s * 0.07, -0.18, 0.02], [0.05, 0.04, 0.05], undefined, fo);
    arms.push(a);
  }
  const head = grp(body, [0, 0.5, 0.02]);
  part(head, G.sphere(), skin, [0, 0, 0], [0.27, 0.17, 0.24]);
  part(head, G.sphere(), belly, [0, -0.06, 0.08], [0.21, 0.08, 0.15], undefined, fo);
  for (const s of [1, -1]) part(head, G.sphere(), skin, [s * 0.13, 0.1, 0.02], [0.1, 0.1, 0.1]);
  const E = eyes(head, M, { x: 0.13, y: 0.12, z: 0.07, r: 0.065, lid: c });
  const smile = part(head, G.arc(0.13, 0.012, Math.PI), basic('#1b1214'), [0, -0.01, 0.2], [1, 0.5, 1], [0, 0, Math.PI], fo);
  const flat = part(head, G.capsule(0.01, 0.16), basic('#1b1214'), [0, -0.02, 0.21], 1, [0, 0, Math.PI / 2], fo);
  for (const s of [1, -1]) part(head, G.ball(), M.get('#ff8aa8', { transparent: true, opacity: 0.6 }), [s * 0.16, -0.04, 0.16], [0.04, 0.02, 0.01], undefined, fo);
  if (style === 0) {
    part(head, G.cyl(), M.get('#e8cc7a'), [0, 0.2, -0.02], [0.3, 0.02, 0.3]);
    part(head, G.dome(), M.get('#e8cc7a'), [0, 0.2, -0.02], [0.15, 0.12, 0.15]);
    part(head, G.cyl(), cloth, [0, 0.24, -0.02], [0.152, 0.03, 0.152], undefined, fo);
  } else if (style === 3) {
    for (const s of [1, -1]) part(head, G.cone(), cloth, [s * 0.06, 0.2, -0.04], [0.05, 0.1, 0.03], [0, 0, s * Math.PI / 2], fo);
  }
  const blinker = new Blinker();
  let t = Math.random() * 5, walk = 0, hop = 0;
  const rig = {
    root, M, top: 0.98, sleepy: 1,
    update(dt: number, a: VAnim) {
      dt = Math.min(dt, 0.05); t += dt;
      walk += dt * clamp(a.speed, 0, 4) * 4;
      const sw = a.speed > 0.15 ? Math.sin(walk) : 0;
      let sway = Math.sin(t * 1.3) * 0.08 * rig.sleepy, armU = 0, wantHop = 0;
      switch (a.st) {
        case 'stun': sway = Math.sin(t * 9) * 0.25; armU = 0.8; break;
        case 'happy': wantHop = Math.abs(Math.sin(t * 7)) * 0.2; armU = 2.2 + Math.sin(t * 14) * 0.3; sway = Math.sin(t * 7) * 0.1; break;
        case 'wave': armU = 2.4; sway = 0.05; break;
      }
      hop = damp(hop, wantHop, 20, dt);
      base.position.y = hop;
      base.rotation.z = sway;
      base.rotation.x = rig.sleepy * 0.14;
      legs[0].rotation.x = sw * 0.7; legs[1].rotation.x = -sw * 0.7;
      arms[0].rotation.z = 0.1 + armU * (a.st === 'wave' ? 1 : 0.8) + (a.st === 'wave' ? Math.sin(t * 12) * 0.35 : 0);
      arms[1].rotation.z = -0.1 - armU * (a.st === 'wave' ? 0.1 : 0.8);
      const bl = blinker.update(dt);
      const close = clamp(lerp(bl, 0.8 + Math.sin(t * 0.7) * 0.12, rig.sleepy), 0, 1);
      for (const l of E.lids) l.rotation.x = lerp(-1.45, 0.25, close);
      smile.visible = rig.sleepy < 0.5; flat.visible = !smile.visible;
      M.flash(a.flash);
    },
  };
  return rig;
}

// ═════════════════════════════ КАМЫШ (the frog ferryman) ═════════════════════════════
export interface SimpleRig { root: THREE.Group; M: Mats; update(dt: number, talk: number, st?: string): void }
export interface KamyshRig extends SimpleRig {
  /** the lantern on his pole (hide it: «без фонаря») */
  lantern: THREE.Group;
  /** 0 = empty lantern, 1 = the last firefly glowing inside */
  lit: number;
}
/** an old frog sitting with a punting pole and a straw hat. `double`: Морок's copy of him (6.0) — the same frog with a
 *  grin far too wide and red pupils */
export function createKamysh(o: { double?: boolean } = {}): KamyshRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'kamysh';
  const skin = M.get('#7fb35a'), skinD = M.get('#5f8c3e'), belly = M.get('#e8eac0');
  const body = grp(root, [0, 0.05, 0]);
  part(body, G.sphere(), skin, [0, 0.38, 0], [0.36, 0.38, 0.32]);
  part(body, G.sphere(), belly, [0, 0.32, 0.14], [0.26, 0.28, 0.2]);
  part(body, G.sphere(), M.get('#6a5a3a'), [0, 0.42, 0], [0.37, 0.24, 0.33]); // vest
  for (const s of [1, -1]) {
    part(body, G.sphere(), skin, [s * 0.26, 0.1, 0.1], [0.14, 0.1, 0.22]);
    part(body, G.sphere(), skinD, [s * 0.28, 0.02, 0.3], [0.1, 0.03, 0.12], undefined, fo);
  }
  const head = grp(body, [0, 0.78, 0.04]);
  part(head, G.sphere(), skin, [0, 0, 0], [0.32, 0.2, 0.28]);
  part(head, G.sphere(), belly, [0, -0.07, 0.1], [0.25, 0.1, 0.18], undefined, fo);
  for (const s of [1, -1]) part(head, G.sphere(), skin, [s * 0.15, 0.12, 0.03], [0.12, 0.12, 0.12]);
  const E = eyes(head, M, { x: 0.15, y: 0.14, z: 0.09, r: 0.075, lid: '#6a9a4a' });
  const mouth = part(head, G.ball(), basic('#5a1a20'), [0, -0.04, 0.25], [o.double ? 0.2 : 0.12, 0.02, 0.02], undefined, fo);
  part(head, G.arc(o.double ? 0.24 : 0.15, 0.012, Math.PI), basic('#1b1214'), [0, 0, 0.24], [1, o.double ? 0.7 : 0.45, 1], [0, 0, Math.PI], fo);
  if (o.double) for (const p of E.pupils) p.material = basic('#c0103a');
  // a reed in the corner of his mouth
  part(head, G.capsule(0.008, 0.26), M.get('#c8a050'), [0.12, -0.02, 0.28], 1, [0.3, 0, -1.1], fo);
  // straw hat, pushed back so his face shows
  const hat = grp(head, [0, 0.2, -0.08], [-0.45, 0, 0]);
  part(hat, G.cyl(), M.get('#e0c070'), [0, 0.02, 0], [0.32, 0.025, 0.32]);
  part(hat, G.dome(), M.get('#e8cc7a'), [0, 0.02, 0], [0.18, 0.15, 0.18]);
  part(hat, G.cyl(), M.get('#8a3a2a'), [0, 0.06, 0], [0.183, 0.035, 0.183], undefined, fo);
  // the pole
  const arm = grp(body, [0.3, 0.5, 0.15]);
  part(arm, G.capsule(0.05, 0.16), skin, [0, -0.06, 0], 1, [0, 0, 0.5]);
  const pole = part(arm, G.cyl(), M.get('#8a6a3a'), [0.08, 0.2, 0.05], [0.025, 2.6, 0.025], [0.1, 0, -0.15]);
  void pole;
  const lantern = grp(arm, [0.12, 1.45, 0.2]);
  part(lantern, G.cyl(), M.get('#3a3a30'), [0, 0, 0], [0.08, 0.14, 0.08]);
  const glassM = basic('#8a8a70', { transparent: true, opacity: 0.6 });
  part(lantern, G.ball(), glassM, [0, 0, 0], 0.07, undefined, fo);
  // the last firefly: a warm blinking dot inside + its glow
  const fly = part(lantern, G.ball(), basic('#ffe86a'), [0, 0, 0], 0.03, undefined, fo);
  const flyGlow = glowSprite('#ffd84a', 0.9, 0.0);
  lantern.add(flyGlow);
  const blinker = new Blinker();
  let t = Math.random() * 3;
  const rig: KamyshRig = {
    root, M, lantern, lit: 0,
    update(dt: number, talk: number, st = 'idle') {
      t += dt;
      body.position.y = 0.05 + Math.sin(t * 1.4) * 0.015;
      head.rotation.z = Math.sin(t * 0.7) * 0.05;
      mouth.scale.y = 0.02 * (1 + talk * 4);
      arm.rotation.x = st === 'pole' ? Math.sin(t * 1.6) * 0.35 : 0.1;
      const bl = blinker.update(dt);
      for (const l of E.lids) l.rotation.x = lerp(-0.9, 1.3, Math.max(bl, o.double ? 0.05 : 0.35));
      const blink = rig.lit * (0.55 + 0.45 * Math.max(0, Math.sin(t * 5.2)));
      fly.visible = rig.lit > 0.05;
      flyGlow.material.opacity = blink * 0.9;
      flyGlow.scale.setScalar(0.5 + blink * 0.9);
      glassM.color.set(rig.lit > 0.05 ? '#e8d890' : '#8a8a70');
      M.flash(0);
    },
  };
  return rig;
}

// ═════════════════════════════ КАР-КАРЫЧ (Морок's raven) ═════════════════════════════
export interface VoronAnim { st: 'perch' | 'fly' | 'flap' | 'carry' | 'hop'; talk: number }
export interface VoronRig { root: THREE.Group; M: Mats; update(dt: number, a: VoronAnim): void }
/** Кар-Карыч: a big scruffy raven, her only honest friend (§2.2). A crest of ruffled feathers, a grey «beard» at the
 *  throat, heavy brows over yellow eyes, a big chipped beak. Poses: perch (shifts from foot to foot, sighs), fly,
 *  flap (wings up, scolding), carry (legs down, something in the claws), hop. `talk` opens the beak (a caw). */
export function createVoron(): VoronRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'voron';
  const ink = M.get('#1a1824'), inkL = M.get('#2c2a40'), grey = M.get('#7a7890'), beakM = M.get('#e0a830'), beakD = M.get('#a8781a');
  const body = grp(root, [0, 0.34, 0]);
  part(body, G.sphere(), ink, [0, 0, 0], [0.2, 0.19, 0.3]);
  part(body, G.sphere(), inkL, [0, 0.04, 0.05], [0.17, 0.16, 0.22], undefined, fo);
  // the tail: three long feathers
  for (const s of [-1, 0, 1]) part(body, G.cone(), ink, [s * 0.05, 0.02, -0.36], [0.06, 0.24, 0.02], [-Math.PI / 2 + 0.25, s * 0.25, 0]);
  const head = grp(body, [0, 0.15, 0.22]);
  part(head, G.sphere(), ink, [0, 0, 0], [0.15, 0.14, 0.15]);
  // ruffled crest
  for (let i = 0; i < 5; i++) part(head, G.cone(), ink, [(i - 2) * 0.03, 0.13, -0.02 - Math.abs(i - 2) * 0.02], [0.03, 0.11, 0.02], [-0.5, 0, (i - 2) * 0.35], fo);
  // grey throat «beard»
  for (let i = 0; i < 4; i++) part(head, G.cone(), grey, [(i - 1.5) * 0.04, -0.12, 0.08], [0.03, 0.08, 0.02], [Math.PI + 0.3, 0, (i - 1.5) * 0.2], fo);
  // eyes: yellow, under heavy brows
  const eyesL: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    part(head, G.ball(), basic('#ffe070'), [s * 0.085, 0.03, 0.1], [0.04, 0.042, 0.03], undefined, fo);
    eyesL.push(part(head, G.ball(), basic('#141018'), [s * 0.088, 0.03, 0.125], [0.018, 0.024, 0.01], undefined, fo));
    part(head, G.capsule(0.015, 0.08), grey, [s * 0.085, 0.085, 0.11], 1, [0, 0, s * -1.25], fo);
  }
  // the beak: upper + lower (the lower one opens on a caw)
  part(head, G.cone(), beakM, [0, 0.0, 0.2], [0.05, 0.17, 0.045], [Math.PI / 2, 0, 0]);
  const jaw = grp(head, [0, -0.03, 0.12]);
  part(jaw, G.cone(), beakD, [0, 0, 0.06], [0.04, 0.12, 0.03], [Math.PI / 2, 0, 0], fo);
  // wings
  const wings: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const pv = grp(body, [s * 0.16, 0.06, 0.02]);
    const w = part(pv, G.sphere(), inkL, [s * 0.3, 0, -0.06], [0.34, 0.03, 0.16]);
    w.castShadow = false;
    for (let i = 0; i < 3; i++) part(pv, G.cone(), ink, [s * (0.5 + i * 0.07), 0, -0.12 - i * 0.02], [0.04, 0.16, 0.015], [-Math.PI / 2, 0, 0], fo);
    wings.push(pv);
  }
  // legs + claws
  const legs: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const lg = grp(body, [s * 0.07, -0.16, 0.03]);
    part(lg, G.capsule(0.018, 0.14), M.get('#3a3020'), [0, -0.08, 0]);
    for (const a of [-0.5, 0, 0.5]) part(lg, G.capsule(0.01, 0.06), M.get('#3a3020'), [Math.sin(a) * 0.04, -0.17, Math.cos(a) * 0.04], 1, [Math.PI / 2, a, 0], fo);
    legs.push(lg);
  }
  let t = Math.random() * 4, shift = 0;
  return {
    root, M,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      let f = 0, fold = 0, legDown = 0;
      switch (a.st) {
        case 'fly': f = Math.sin(t * 11) * 0.9; break;
        case 'carry': f = Math.sin(t * 13) * 1.0; legDown = 1; break;
        case 'flap': f = 0.9 + Math.sin(t * 18) * 0.5; break;
        case 'hop': f = Math.sin(t * 9) * 0.3; fold = 0.4; break;
        default: f = -0.15 + Math.sin(t * 1.3) * 0.04; fold = 0.8;
      }
      wings[0].rotation.z = f; wings[1].rotation.z = -f;
      wings[0].scale.x = wings[1].scale.x = 1 - fold * 0.55;
      // perched: shifts from foot to foot, cocks his head
      shift = a.st === 'perch' ? Math.sin(t * 0.9) : damp(shift, 0, 4, dt);
      body.rotation.z = shift * 0.06;
      body.rotation.x = a.st === 'fly' || a.st === 'carry' ? 0.25 : a.st === 'hop' ? -0.1 + Math.abs(Math.sin(t * 9)) * 0.2 : 0;
      head.rotation.z = a.st === 'perch' ? Math.sin(t * 0.6) * 0.25 : 0;
      head.rotation.x = -a.talk * 0.25;
      jaw.rotation.x = a.talk * 0.55;
      for (const l of legs) l.rotation.x = legDown ? 0.2 : a.st === 'fly' ? 1.1 : 0;
      for (const e of eyesL) e.scale.y = ((t % 4.1) < 0.12 ? 0.004 : 0.024);
      M.flash(0);
    },
  };
}

// ═════════════════════════════ МАТУШКА СВЕТЛЯЧИХА ═════════════════════════════
export interface GlowRig extends SimpleRig { glow: number; light: THREE.Sprite }
/** a huge, kind firefly: velvet wings, feathery antennae, a belly full of light (glow 0..1) */
export function createSvetlyachikha(): GlowRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'svetlyachikha';
  const hover = grp(root, [0, 1.2, 0]);
  const dark = M.get('#4a3a5a'), darkD = M.get('#2e2238');
  part(hover, G.sphere(), dark, [0, 0.1, 0.1], [0.42, 0.4, 0.5]); // thorax
  const bellyM = M.own('#ffe86a', { emissive: '#ffc020', emissiveIntensity: 0.9 });
  const belly = grp(hover, [0, -0.05, -0.55]);
  for (let i = 0; i < 4; i++) part(belly, G.sphere(), i < 1 ? dark : bellyM, [0, -i * 0.06, -i * 0.22], [0.42 - i * 0.04, 0.38 - i * 0.04, 0.24]);
  const light = glowSprite('#ffe470', 4.2, 0.85);
  light.position.set(0, -0.15, -0.9);
  hover.add(light);
  const head = grp(hover, [0, 0.25, 0.55]);
  part(head, G.sphere(), dark, [0, 0, 0], [0.38, 0.34, 0.32]);
  const E = eyes(head, M, { x: 0.15, y: 0.06, z: 0.22, r: 0.11, lid: '#4a3a5a' });
  for (const s of [1, -1]) part(head, G.ball(), M.get('#ff8aa8', { transparent: true, opacity: 0.6 }), [s * 0.22, -0.08, 0.22], [0.06, 0.035, 0.01], undefined, fo);
  const mouth = part(head, G.ball(), basic('#2a1018'), [0, -0.13, 0.29], [0.07, 0.02, 0.02], undefined, fo);
  // feathery antennae
  for (const s of [1, -1]) {
    const an = grp(head, [s * 0.12, 0.28, 0.08], [-0.5, 0, s * -0.4]);
    part(an, G.capsule(0.015, 0.5), darkD, [0, 0.28, 0]);
    for (let i = 0; i < 6; i++) part(an, G.capsule(0.01, 0.12), darkD, [s * 0.04, 0.12 + i * 0.07, 0], 1, [0, 0, s * 1.1], fo);
    part(an, G.ball(), bellyM, [0, 0.56, 0], 0.05, undefined, fo);
  }
  // velvet wings (two pairs)
  const wingM = M.get('#8a5aa8', { transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  const wings: THREE.Group[] = [];
  for (const s of [1, -1]) for (const k of [0, 1]) {
    const pv = grp(hover, [s * 0.25, 0.32, 0.15 - k * 0.35]);
    const w = part(pv, G.sphere(), wingM, [s * 0.75, 0, -0.1], [0.8, 0.03, 0.42 - k * 0.08], [0, s * (0.3 + k * 0.35), 0]);
    w.castShadow = false;
    wings.push(pv);
  }
  // little legs
  for (const s of [1, -1]) for (let i = 0; i < 3; i++) part(hover, G.capsule(0.025, 0.3), darkD, [s * 0.3, -0.3, 0.3 - i * 0.22], 1, [0, 0, s * 0.6], fo);
  const blinker = new Blinker();
  let t = 0;
  const rig: GlowRig = {
    root, M, glow: 1, light,
    update(dt: number, talk: number) {
      t += dt;
      hover.position.y = 1.2 + Math.sin(t * 1.6) * 0.12;
      wings.forEach((w, i) => { w.rotation.z = (i < 2 ? 1 : -1) * (Math.sin(t * 9 + (i % 2) * 0.6) * 0.35 + 0.1); });
      const g = rig.glow * (0.85 + 0.15 * Math.sin(t * 2.6));
      bellyM.emissiveIntensity = 0.2 + g * 1.0;
      light.material.opacity = 0.15 + g * 0.75;
      light.scale.setScalar(2.5 + g * 2.2);
      mouth.scale.y = 0.02 * (1 + talk * 3);
      const bl = blinker.update(dt);
      for (const l of E.lids) l.rotation.x = lerp(-1.5, 1.4, bl);
      M.flash(0);
    },
  };
  return rig;
}

// ═════════════════════════════ МАДАМ МОРОК ═════════════════════════════
export interface MorokAnim { st: string; p: number; flash: number; talk: number; speed: number }
export interface MorokRig { root: THREE.Group; M: Mats; top: number; update(dt: number, a: MorokAnim): void }

export interface LadyRig extends MorokRig {
  /** the little crow on her shoulder (Кар-Карыч sits there instead when he is a character: hide it) */
  crow: MorokRig;
  /** her upper body (a parent for Кар-Карыч on the shoulder: local spot `SHOULDER`) */
  body: THREE.Group;
  /** the veil is gone: a freckled frog face under it (6.5, Морося) */
  setFrog(on: boolean): void;
  /** her hat with the veil (to fling it off as a separate prop, the rig's copy is hidden by setFrog) */
  hat: THREE.Group;
}
/** where Кар-Карыч perches in `LadyRig.body` space */
export const SHOULDER = new THREE.Vector3(-0.28, 0.42, -0.02);

/** the veiled lady: tall, a violet gown, a hat with a black veil, red eyes, a crow on her shoulder.
 *  poses: idle taunt cast dazed sit fall walk. Under the veil — Морося, a frog in freckles (setFrog). */
export function createLady(): LadyRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'morok-lady';
  const base = grp(root);
  const gown = M.get('#4a2862'), gownL = M.get('#8a3aae'), skin = M.get('#efe2f8'), black = M.get('#1a1420');
  const skirt = part(base, G.cone(), gown, [0, 0.55, 0], [0.55, 1.1, 0.5]);
  part(base, G.cyl(), gownL, [0, 0.05, 0], [0.56, 0.08, 0.51]);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; part(base, G.cone(), gownL, [Math.sin(a) * 0.48, 0.12, Math.cos(a) * 0.44], [0.08, 0.2, 0.05], [0, -a, Math.PI], fo); }
  void skirt;
  const body = grp(base, [0, 1.05, 0]);
  part(body, G.sphere(), gown, [0, 0.12, 0], [0.22, 0.3, 0.18]);
  part(body, G.cone(), gownL, [0, 0.08, 0.1], [0.08, 0.3, 0.04], [Math.PI, 0, 0], fo);
  // lace collar
  part(body, G.cyl(), M.get('#2a1438'), [0, 0.38, 0], [0.17, 0.08, 0.15]);
  const arms: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const a = grp(body, [s * 0.21, 0.32, 0]);
    part(a, G.capsule(0.05, 0.38), gown, [0, -0.22, 0]);
    part(a, G.sphere(), black, [0, -0.46, 0.02], [0.06, 0.07, 0.06]); // lace gloves
    arms.push(a);
  }
  const head = grp(body, [0, 0.58, 0.02]);
  // her borrowed face (pale, red eyes) …
  const lady = grp(head);
  part(lady, G.sphere(), skin, [0, 0, 0], [0.19, 0.22, 0.18]);
  const E = eyes(lady, M, { x: 0.075, y: 0.02, z: 0.14, r: 0.04, pupil: '#e0102a' });
  for (const p of E.pupils) p.material = basic('#ff2040');
  const lips = part(lady, G.ball(), M.get('#5a1a4a'), [0, -0.1, 0.16], [0.05, 0.018, 0.02], undefined, fo);
  // the hat + the veil
  const hat = grp(head);
  part(hat, G.cyl(), black, [0, 0.17, -0.01], [0.3, 0.02, 0.3]);
  part(hat, G.cyl(), black, [0, 0.27, -0.01], [0.15, 0.2, 0.15]);
  part(hat, G.cyl(), gownL, [0, 0.2, -0.01], [0.155, 0.04, 0.155], undefined, fo);
  const veil = part(hat, G.cyl(), M.get('#140a1c', { transparent: true, opacity: 0.55, side: THREE.DoubleSide }), [0, 0.03, 0.02], [0.27, 0.32, 0.25]);
  veil.castShadow = false;
  const feather = part(hat, G.capsule(0.03, 0.4), M.get('#8a3ab0'), [0.12, 0.42, -0.06], 1, [0.4, 0, -0.6]);
  void feather;
  // … and her own: Морося, a frog in freckles (wide, flat, big eyes on top, a shy little mouth)
  const frog = grp(head);
  const fsk = M.get('#8cc46a'), fskD = M.get('#6aa04e'), fbel = M.get('#eef0c8');
  part(frog, G.sphere(), fsk, [0, -0.02, 0.01], [0.24, 0.17, 0.2]);
  part(frog, G.sphere(), fbel, [0, -0.08, 0.08], [0.18, 0.08, 0.13], undefined, fo);
  for (const s of [1, -1]) part(frog, G.sphere(), fsk, [s * 0.11, 0.1, 0.05], [0.09, 0.09, 0.09]);
  const FE = eyes(frog, M, { x: 0.11, y: 0.12, z: 0.09, r: 0.062, lid: '#7ab05a' });
  // freckles over the snout and cheeks
  const frk = basic('#a86a3a');
  for (const [x, y] of [[-0.12, 0.0], [-0.08, -0.02], [-0.15, -0.03], [0.12, 0.0], [0.08, -0.02], [0.15, -0.03], [-0.03, 0.04], [0.03, 0.045], [0.0, 0.02]] as const) {
    part(frog, G.ball(), frk, [x, y, 0.17 - Math.abs(x) * 0.35], [0.012, 0.012, 0.006], undefined, fo);
  }
  for (const s of [1, -1]) part(frog, G.ball(), M.get('#ff9ab0', { transparent: true, opacity: 0.55 }), [s * 0.15, -0.05, 0.13], [0.035, 0.02, 0.01], undefined, fo);
  const fmouth = part(frog, G.arc(0.09, 0.01, Math.PI), basic('#3a1a20'), [0, -0.06, 0.19], [1, 0.5, 1], [0, 0, Math.PI], fo);
  part(frog, G.sphere(), fskD, [0, 0.13, -0.06], [0.06, 0.03, 0.06], undefined, fo);
  frog.visible = false;
  void fmouth;
  // the crow on her left shoulder
  const crow = createCrow(false);
  crow.root.scale.setScalar(0.75);
  crow.root.position.copy(SHOULDER);
  body.add(crow.root);
  // a faint violet haze around her (she is a creature of the fog)
  const aura = glowSprite('#a050ff', 2.6, 0.22);
  aura.position.y = 1.1;
  root.add(aura);
  const blinker = new Blinker();
  let t = Math.random() * 3, slump = 0, sit = 0, armUp = 0, frogOn = false;
  return {
    root, M, top: 1.95, crow, body, hat,
    setFrog(on: boolean) { frogOn = on; frog.visible = on; lady.visible = !on; hat.visible = !on; aura.visible = !on; },
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      let wantSlump = 0, wantSit = 0, wantArm = 0, sway = Math.sin(t * 1.4) * 0.05;
      switch (a.st) {
        case 'taunt': wantArm = 1.2 + Math.sin(t * 8) * 0.2; break;
        case 'cast': wantArm = 2.6; sway = Math.sin(t * 12) * 0.08; break;
        case 'dazed': wantSlump = 1; sway = Math.sin(t * 5) * 0.25; break;
        case 'sit': wantSit = 1; sway = Math.sin(t * 1.6) * 0.12; break;
        case 'fall': wantSlump = 1; break;
        // (Морося: hiding her face behind her gloves)
        case 'shy': wantArm = 0; wantSlump = 0.4; break;
      }
      slump = damp(slump, wantSlump, 6, dt); sit = damp(sit, wantSit, 8, dt); armUp = damp(armUp, wantArm, 8, dt);
      base.rotation.z = sway;
      body.rotation.x = slump * 0.5 - sit * 0.25;
      base.position.y = -slump * 0.35 - sit * 0.45;
      base.scale.y = 1 - sit * 0.2;
      head.rotation.x = slump * 0.3;
      arms[0].rotation.z = 0.15 + armUp * 0.9; arms[1].rotation.z = -0.15 - armUp * (a.st === 'cast' ? 0.9 : 0.25);
      arms[0].rotation.x = -slump * 0.6; arms[1].rotation.x = -slump * 0.6;
      if (a.st === 'shy') { arms[0].rotation.x = arms[1].rotation.x = -2.3; arms[0].rotation.z = 0.5; arms[1].rotation.z = -0.5; }
      lips.scale.y = 0.018 * (1 + a.talk * 2.5);
      fmouth.scale.y = 0.5 * (1 + a.talk * 1.6);
      const bl = blinker.update(dt);
      E.whites.forEach((w) => { w.scale.y = 0.044 * (1 - 0.9 * bl); });
      if (frogOn) for (const l of FE.lids) l.rotation.x = lerp(-0.9, 1.3, Math.max(bl, 0.2));
      crow.update(dt, { st: slump > 0.5 ? 'flap' : 'perch', p: 0, flash: 0, talk: 0, speed: 0 });
      M.flash(a.flash);
    },
  };
}

/** a crow (one of the flock; `veiled` = Морок herself: a violet veil scrap and red eyes). poses: fly perch dive flap */
export function createCrow(veiled: boolean): MorokRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = veiled ? 'crow-morok' : 'crow';
  const body = grp(root, [0, 0.2, 0]);
  const black = M.get(veiled ? '#2a1a34' : '#16121c'), blackL = M.get('#2e2638');
  part(body, G.sphere(), black, [0, 0, 0], [0.13, 0.12, 0.22]);
  part(body, G.cone(), black, [0, 0.01, -0.26], [0.09, 0.16, 0.03], [-Math.PI / 2, 0, 0]);
  const head = grp(body, [0, 0.08, 0.17]);
  part(head, G.sphere(), black, [0, 0, 0], [0.1, 0.1, 0.1]);
  part(head, G.cone(), M.get('#e0a020'), [0, -0.01, 0.12], [0.035, 0.11, 0.035], [Math.PI / 2, 0, 0]);
  for (const s of [1, -1]) part(head, G.ball(), basic(veiled ? '#ff2040' : '#fff4c8'), [s * 0.06, 0.03, 0.06], 0.022, undefined, fo);
  if (veiled) {
    part(head, G.cyl(), M.get('#140a1c'), [0, 0.09, 0], [0.09, 0.05, 0.09]);
    const v = part(head, G.cone(), M.get('#7a2aa8', { transparent: true, opacity: 0.75, side: THREE.DoubleSide }), [0, 0.0, 0.02], [0.13, 0.16, 0.12], [Math.PI, 0, 0]);
    v.castShadow = false;
    const shine = glowSprite('#c060ff', 0.7, 0.45);
    shine.position.set(0, 0.05, 0);
    body.add(shine);
  }
  const wings: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const pv = grp(body, [s * 0.1, 0.04, 0.02]);
    const w = part(pv, G.sphere(), blackL, [s * 0.2, 0, -0.04], [0.22, 0.02, 0.1]);
    w.castShadow = false;
    wings.push(pv);
  }
  for (const s of [1, -1]) part(body, G.capsule(0.012, 0.08), M.get('#3a3020'), [s * 0.05, -0.14, 0.02], 1, undefined, fo);
  let t = Math.random() * 3;
  return {
    root, M, top: 0.4,
    update(dt, a) {
      t += dt;
      let f = 0, fold = 0;
      switch (a.st) {
        case 'fly': f = Math.sin(t * 16) * 0.8; break;
        case 'dive': f = 0.1; fold = 1; break;
        case 'flap': f = Math.sin(t * 20) * 0.9; break;
        default: f = -0.1 + Math.sin(t * 2) * 0.05; fold = 0.7;
      }
      wings[0].rotation.z = f; wings[1].rotation.z = -f;
      wings[0].scale.x = 1 - fold * 0.5; wings[1].scale.x = 1 - fold * 0.5;
      body.rotation.x = a.st === 'dive' ? 0.6 : 0;
      M.flash(a.flash);
    },
  };
}

/** the wolf: big, dark violet-grey, red eyes, a scrap of violet veil on one ear. poses: idle prowl crouch run skid dazed */
export function createWolf(): MorokRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'morok-wolf';
  const base = grp(root);
  const fur = M.get('#3e3450'), furD = M.get('#2a2236'), furL = M.get('#6a5c80');
  const body = grp(base, [0, 1.05, 0]);
  part(body, G.sphere(), fur, [0, 0, -0.1], [0.5, 0.5, 0.95]);
  part(body, G.sphere(), furL, [0, -0.22, 0.05], [0.36, 0.3, 0.7]);
  // shaggy mane
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI - Math.PI / 2; part(body, G.cone(), furD, [Math.sin(a) * 0.45, 0.25 + Math.cos(a) * 0.15, 0.45], [0.16, 0.45, 0.14], [-1.0, 0, -a * 0.8]); }
  const tail = grp(body, [0, 0.15, -0.95]);
  part(tail, G.capsule(0.12, 0.6), fur, [0, 0, -0.35], 1, [-1.1, 0, 0]);
  const head = grp(body, [0, 0.35, 0.95]);
  part(head, G.sphere(), fur, [0, 0, 0], [0.36, 0.32, 0.36]);
  const snout = grp(head, [0, -0.08, 0.3]);
  part(snout, G.sphere(), furL, [0, 0, 0.12], [0.18, 0.15, 0.3]);
  part(snout, G.ball(), basic('#120a14'), [0, 0.07, 0.42], [0.07, 0.05, 0.05], undefined, fo);
  const jaw = grp(snout, [0, -0.08, 0]);
  part(jaw, G.sphere(), furD, [0, -0.04, 0.12], [0.14, 0.06, 0.26]);
  const teeth = basic('#ffffff');
  for (const s of [1, -1]) { part(snout, G.cone(), teeth, [s * 0.08, -0.1, 0.32], [0.025, 0.07, 0.025], [Math.PI, 0, 0], fo); part(jaw, G.cone(), teeth, [s * 0.07, 0.02, 0.28], [0.02, 0.05, 0.02], undefined, fo); }
  for (const s of [1, -1]) {
    part(head, G.cone(), fur, [s * 0.2, 0.32, -0.05], [0.12, 0.3, 0.08], [0, 0, s * -0.25]);
    part(head, G.ball(), basic('#ff2040'), [s * 0.14, 0.08, 0.3], [0.05, 0.035, 0.02], undefined, fo);
  }
  // the veil scrap
  const veil = part(head, G.cone(), M.get('#7a2aa8', { transparent: true, opacity: 0.8, side: THREE.DoubleSide }), [0.2, 0.42, -0.06], [0.12, 0.25, 0.04], [0.3, 0, -0.5]);
  veil.castShadow = false;
  const eyeGlow = glowSprite('#ff2040', 0.9, 0.0);
  eyeGlow.position.set(0, 0.08, 0.34);
  head.add(eyeGlow);
  const legs: THREE.Group[] = [];
  for (const [x, z] of [[0.3, 0.55], [-0.3, 0.55], [0.3, -0.65], [-0.3, -0.65]]) {
    const l = grp(base, [x, 0.95, z]);
    part(l, G.capsule(0.11, 0.55), fur, [0, -0.38, 0]);
    part(l, G.sphere(), furD, [0, -0.88, 0.06], [0.13, 0.08, 0.17]);
    legs.push(l);
  }
  let t = Math.random() * 3, gal = 0, crouch = 0, open = 0, glow = 0, dz = 0;
  return {
    root, M, top: 2.0,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      let wantCrouch = 0, wantOpen = 0, wantGlow = 0, rate = 0, wantDz = 0;
      switch (a.st) {
        case 'prowl': rate = 6; break;
        case 'crouch': wantCrouch = 0.5 + 0.3 * a.p; wantOpen = 0.5; wantGlow = 0.5 + 0.5 * a.p; break;
        case 'run': rate = 18; wantOpen = 0.7; wantGlow = 1; break;
        case 'skid': wantCrouch = 0.3; wantOpen = 0.3; break;
        case 'dazed': wantDz = 1; break;
        default: wantOpen = 0.08 + Math.sin(t * 2) * 0.05;
      }
      gal += dt * rate;
      crouch = damp(crouch, wantCrouch, 12, dt); open = damp(open, wantOpen, 14, dt); glow = damp(glow, wantGlow, 8, dt); dz = damp(dz, wantDz, 5, dt);
      const g = rate > 0 ? Math.sin(gal) : 0;
      body.position.y = 1.05 - crouch * 0.3 + Math.abs(g) * (rate > 10 ? 0.15 : 0.04) - dz * 0.45;
      body.rotation.x = (rate > 10 ? g * 0.12 : 0) + crouch * 0.12;
      body.rotation.z = dz * 0.5 + (dz > 0.1 ? Math.sin(t * 4) * 0.08 : 0);
      legs[0].rotation.x = g * 0.9; legs[1].rotation.x = g * 0.9 * (rate > 10 ? 0.8 : -1);
      legs[2].rotation.x = -g * 0.9; legs[3].rotation.x = -g * 0.9 * (rate > 10 ? 0.8 : -1);
      for (const l of legs) l.position.y = 0.95 - crouch * 0.25 - dz * 0.45;
      tail.rotation.y = Math.sin(t * (rate > 0 ? 10 : 3)) * 0.4;
      jaw.rotation.x = open * 0.6;
      head.rotation.x = crouch * 0.25 + dz * 0.3;
      eyeGlow.material.opacity = glow * 0.8;
      M.flash(a.flash);
    },
  };
}

/** the giant toad: warty olive with violet spots, a tiny hat with a veil (the tell), a long pink tongue.
 *  poses: idle puff tongue jump flop dazed. `tongue` (m) = how far the tongue is out */
export function createToad(): MorokRig & { tongue: number } {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'morok-toad';
  const base = grp(root);
  const skin = M.get('#5c6c34'), skinD = M.get('#46542a'), spot = M.get('#5a3a6a'), belly = M.get('#d4d0a0');
  const body = grp(base, [0, 0.9, 0]);
  part(body, G.sphere(), skin, [0, 0, 0], [1.25, 0.85, 1.15]);
  const throat = part(body, G.sphere(), belly, [0, -0.3, 0.55], [0.85, 0.5, 0.65]);
  for (let i = 0; i < 14; i++) {
    const a = i * 2.17, b = (i % 4) * 0.3;
    part(body, G.ball(), i % 3 ? skinD : spot, [Math.sin(a) * (0.9 - b * 0.4), 0.45 + b * 0.25, Math.cos(a) * (0.8 - b * 0.4) - 0.1], 0.1 + (i % 3) * 0.04, undefined, fo);
  }
  const head = grp(body, [0, 0.35, 0.55]);
  const E = eyes(head, M, { x: 0.52, y: 0.42, z: 0.2, r: 0.26, pupil: '#ffb020', lid: '#5c6c34' });
  for (const p of E.pupils) p.scale.set(0.22, 0.1, 0.06);
  for (const s of [1, -1]) part(head, G.sphere(), skin, [s * 0.52, 0.38, 0.05], [0.32, 0.32, 0.3]);
  // the wide mouth: an upper lip line and a lower jaw that opens
  const jaw = grp(head, [0, -0.15, 0.35]);
  part(jaw, G.sphere(), belly, [0, -0.12, 0.05], [0.95, 0.18, 0.55]);
  const mouthIn = part(head, G.sphere(), basic('#5a1028'), [0, -0.2, 0.5], [0.85, 0.12, 0.3], undefined, fo);
  part(head, G.torus(0.9, 0.04, 6, 30), M.get('#2a3018'), [0, -0.12, 0.38], [1, 0.55, 1], [Math.PI / 2, 0, 0], fo);
  // the tongue (along +Z from the mouth; its length is set every frame)
  const tongue = grp(head, [0, -0.2, 0.55]);
  const tongueM = M.get('#ff6a8a');
  const tShaft = part(tongue, G.cyl(), tongueM, [0, 0, 0.5], [0.13, 1, 0.13], [Math.PI / 2, 0, 0]);
  const tTip = part(tongue, G.sphere(), tongueM, [0, 0, 1], [0.3, 0.2, 0.3]);
  // the hat with the veil
  const hat = grp(head, [0.1, 0.62, 0.0]);
  part(hat, G.cyl(), M.get('#1a1420'), [0, 0, 0], [0.32, 0.03, 0.32]);
  part(hat, G.cyl(), M.get('#1a1420'), [0, 0.12, 0], [0.18, 0.22, 0.18]);
  const veil = part(hat, G.cyl(), M.get('#7a2aa8', { transparent: true, opacity: 0.65, side: THREE.DoubleSide }), [0, -0.12, 0.05], [0.3, 0.25, 0.28]);
  veil.castShadow = false;
  const legs: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const b = grp(base, [s * 1.0, 0.45, -0.4]);
    part(b, G.sphere(), skin, [0, 0, 0], [0.42, 0.38, 0.6]);
    part(b, G.sphere(), skinD, [s * 0.1, -0.38, 0.45], [0.3, 0.08, 0.38], undefined, fo);
    legs.push(b);
    const f = grp(base, [s * 0.75, 0.55, 0.85]);
    part(f, G.capsule(0.14, 0.4), skin, [0, -0.2, 0], 1, [0.3, 0, 0]);
    part(f, G.sphere(), skinD, [0, -0.5, 0.1], [0.22, 0.07, 0.26], undefined, fo);
    legs.push(f);
  }
  const blinker = new Blinker();
  let t = 0, puff = 0, open = 0, sq = 0, stretch = 0, dz = 0;
  const rig = {
    root, M, top: 2.4, tongue: 0,
    update(dt: number, a: MorokAnim) {
      dt = Math.min(dt, 0.05); t += dt;
      let wantPuff = 0.05 + Math.sin(t * 3) * 0.05, wantOpen = 0, wantSq = 0, wantStretch = 0, wantDz = 0;
      switch (a.st) {
        case 'puff': wantPuff = 0.4 + 0.5 * a.p; break;
        case 'tongue': wantOpen = 1; break;
        case 'crouch': wantSq = 0.45; break;
        case 'jump': wantStretch = 1; wantOpen = 0.3; break;
        case 'flop': wantSq = 0.6; break;
        case 'dazed': wantDz = 1; wantOpen = 0.6; break;
      }
      puff = damp(puff, wantPuff, 10, dt); open = damp(open, wantOpen, 16, dt); sq = damp(sq, wantSq, 14, dt); stretch = damp(stretch, wantStretch, 10, dt); dz = damp(dz, wantDz, 5, dt);
      throat.scale.set(0.85 + puff * 0.45, 0.5 + puff * 0.45, 0.65 + puff * 0.35);
      base.scale.set(1 + sq * 0.3 - stretch * 0.12, 1 - sq * 0.4 + stretch * 0.3, 1 + sq * 0.25);
      body.rotation.x = -stretch * 0.4;
      body.rotation.z = dz * Math.sin(t * 3) * 0.12;
      jaw.rotation.x = open * 0.55;
      mouthIn.visible = open > 0.1;
      legs[0].rotation.x = stretch * 1.2; legs[2].rotation.x = stretch * 1.2;
      legs[1].rotation.x = -stretch * 0.9; legs[3].rotation.x = -stretch * 0.9;
      const L = Math.max(0.01, rig.tongue);
      tongue.visible = rig.tongue > 0.05;
      tShaft.scale.set(0.13, L, 0.13); tShaft.position.z = L / 2; tTip.position.z = L;
      const bl = blinker.update(dt);
      for (const l of E.lids) l.rotation.x = lerp(-1.4, 1.4, Math.max(bl, dz * 0.6));
      M.flash(a.flash);
    },
  };
  return rig;
}

/** the lily-pad boat of Камыш (a big pad with an upturned rim and a white flower) */
export function createLilyBoat(r = 1.6): THREE.Group {
  const g = new THREE.Group();
  const M = new Mats();
  const pad = new THREE.CylinderGeometry(r, r * 0.92, 0.22, 28, 1, false, 0.25, TAU - 0.5);
  part(g, pad, M.get('#4f9a3e'), [0, 0.11, 0]);
  part(g, G.torus(r * 0.98, 0.09, 6, 30), M.get('#3e7e30'), [0, 0.24, 0], 1, [Math.PI / 2, 0, 0.25]);
  for (let i = 0; i < 8; i++) { const a = 0.4 + (i / 8) * (TAU - 0.8); part(g, G.capsule(0.015, r * 0.75), M.get('#6ab84e'), [Math.cos(a) * r * 0.45, 0.23, Math.sin(a) * r * 0.45], 1, [Math.PI / 2, 0, a - Math.PI / 2], fo); }
  const fl = grp(g, [r * 0.55, 0.25, -r * 0.4]);
  for (let i = 0; i < 6; i++) part(fl, G.sphere(), M.get('#fff0f6'), [Math.cos(i) * 0.12, 0.08, Math.sin(i) * 0.12], [0.1, 0.05, 0.16], [0, -i, 0.5], fo);
  part(fl, G.ball(), M.get('#ffe14a'), [0, 0.12, 0], 0.07, undefined, fo);
  return g;
}

export { glowSprite };
