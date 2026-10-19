import * as THREE from 'three';
import { basic, noOutline } from '../../../gfx';
import { G, Mats, TAU, clamp, damp, grp, part, cached, Blinker, lerp } from '../../../models/kit';
import type { Rig } from '../../../models/rig';

/**
 * Cartoon rigs of «Ночь клыков»: vampires (Клыкарь, Нетопырь, Летучий клыкарь, Туманник, Невидимка-слуга,
 * Упырь-громила) and the candy townsfolk (пресняки). Feet at y = 0, facing +Z, 1 unit ≈ the hero's height.
 * Every rig uses its own materials (Mats) — flash, greyness (greyShader.markCharacter) and invisibility touch only it.
 * The anim state is a plain object (VAnim) so co-op puppets drive the rig from replicated numbers.
 */

export interface VAnim {
  /** pose name (each rig knows its own set; unknown = idle) */
  st: string;
  /** 0..1 progress inside the pose (wind-ups, swings) */
  p: number;
  /** horizontal speed (m/s) */
  speed: number;
  flash: number;
}
export interface VRig extends Rig<VAnim> {
  M: Mats;
  /** height of the head top (barks, stars) */
  top: number;
}

const fo = { cast: false };
const SKIN = '#c4b2e6';
const SKIN_D = '#a893cf';
const CAPE = '#2b2140';
const CAPE_IN = '#b8213a';
const HAIR = '#1d1630';
const EYE_W = '#fff6e0';
const PUPIL = '#d0202e';

// ───────────────────────── shared bits ─────────────────────────

/** big cartoon eyes with red pupils and (optional) angry brows; returns the eye whites (for blinking) */
function vampEyes(head: THREE.Object3D, M: Mats, o: { y: number; z: number; x: number; r: number; brow?: boolean; pupil?: string }) {
  const white = basic(EYE_W), pup = basic(o.pupil ?? PUPIL), black = basic('#1b1214');
  const whites: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    whites.push(part(head, G.ball(), white, [s * o.x, o.y, o.z], [o.r, o.r * 1.15, o.r * 0.5], undefined, fo));
    part(head, G.ball(), pup, [s * o.x * 0.92, o.y - o.r * 0.1, o.z + o.r * 0.38], [o.r * 0.42, o.r * 0.52, o.r * 0.2], undefined, fo);
    if (o.brow !== false) part(head, G.capsule(o.r * 0.18, o.r * 1.2), black, [s * o.x, o.y + o.r * 1.25, o.z + o.r * 0.2], 1, [0, 0, Math.PI / 2 + s * 0.42], fo);
  }
  void M;
  return whites;
}

/** two little fangs under a mouth line */
function fangs(head: THREE.Object3D, y: number, z: number, s = 1, up = false) {
  const white = basic('#ffffff');
  const g = grp(head);
  for (const k of [1, -1]) part(g, G.cone(), white, [k * 0.045 * s, y + (up ? 0.02 : -0.02) * s, z], [0.02 * s, 0.05 * s, 0.02 * s], [up ? 0 : Math.PI, 0, 0], fo);
  return g;
}

/** a scalloped bat-wing membrane (right wing: extends to +X, leading edge toward +Z) */
function wingGeo() {
  return cached('vamp-wing', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.06);
    s.quadraticCurveTo(0.45, 0.22, 1, 0.12);
    s.quadraticCurveTo(0.92, -0.12, 0.8, -0.3);
    s.quadraticCurveTo(0.7, -0.14, 0.56, -0.24);
    s.quadraticCurveTo(0.45, -0.08, 0.3, -0.26);
    s.quadraticCurveTo(0.18, -0.08, 0, -0.18);
    s.lineTo(0, 0.06);
    const g = new THREE.ShapeGeometry(s, 10);
    g.rotateX(Math.PI / 2);
    return g;
  });
}
/** a pair of wings on pivots; flap(angle) — positive = tips up */
function wings(parent: THREE.Object3D, M: Mats, span: number, color: string, bone: string, at: [number, number, number]) {
  const mem = M.get(color, { side: THREE.DoubleSide });
  const boneM = M.get(bone);
  const pivots: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const pv = grp(parent, [s * at[0], at[1], at[2]]);
    const w = part(pv, wingGeo(), mem, [0, 0, 0], [span * s, 1, span]);
    w.castShadow = true;
    // finger bones along the leading edge
    part(pv, G.capsule(0.012, 0.5), boneM, [s * span * 0.42, 0.005, span * 0.1], [1, span * 1.6, 1], [0, 0, Math.PI / 2], fo);
    pivots.push(pv);
  }
  return {
    pivots,
    set(a: number, fold = 0) {
      pivots[0].rotation.set(0, -fold * 0.9, a);
      pivots[1].rotation.set(0, fold * 0.9, -a);
      const k = 1 - fold * 0.55;
      pivots[0].scale.set(k, 1, 1); pivots[1].scale.set(k, 1, 1);
    },
  };
}

/** a half-open cape (dark outside, red lining) hanging from the shoulders */
function cape(parent: THREE.Object3D, M: Mats, o: { y: number; top: number; bot: number; h: number; z: number; arc?: number }) {
  const arc = o.arc ?? Math.PI * 1.15;
  // (CylinderGeometry: theta 0 = +Z) the arc is centred on the back, the opening faces +Z
  const geo = cached(`vamp-cape|${o.top}|${o.bot}|${o.h}|${arc}`, () => new THREE.CylinderGeometry(o.top, o.bot, o.h, 18, 1, true, Math.PI - arc / 2, arc));
  const g = grp(parent, [0, o.y, o.z]);
  const outM = M.get(CAPE, { side: THREE.FrontSide }), inM = M.get(CAPE_IN, { side: THREE.BackSide });
  part(g, geo, outM, [0, -o.h / 2, 0]);
  part(g, geo, inM, [0, -o.h / 2, 0], 0.985, undefined, fo);
  return g;
}

function stdUpdate(blinker: Blinker, whites: THREE.Mesh[], baseY: number[], dt: number) {
  const bl = blinker.update(dt);
  whites.forEach((e, i) => { e.scale.y = baseY[i] * (1 - 0.9 * bl); });
}

// ═════════════════════════════ КЛЫКАРЬ (fanger) ═════════════════════════════
/** poses: idle walk crouch lunge recover hiss stun burn */
export function createFanger(): VRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'fanger';
  const base = grp(root);
  const legs: THREE.Group[] = [];
  const pants = M.get('#33284a'), shoe = M.get('#17111f');
  for (const s of [1, -1]) {
    const l = grp(base, [s * 0.11, 0.36, 0]);
    part(l, G.capsule(0.055, 0.2), pants, [0, -0.15, 0]);
    part(l, G.sphere(), shoe, [0, -0.31, 0.05], [0.07, 0.05, 0.12]);
    part(l, G.cone(), shoe, [0, -0.3, 0.17], [0.03, 0.08, 0.03], [Math.PI / 2 - 0.3, 0, 0], fo);
    legs.push(l);
  }
  const body = grp(base, [0, 0.36, 0]);
  const torso = grp(body);
  part(torso, G.sphere(), M.get('#3a2d58'), [0, 0.2, 0], [0.24, 0.27, 0.21]);
  part(torso, G.sphere(), M.get('#efe6f4'), [0, 0.22, 0.12], [0.11, 0.2, 0.1]);
  // bow tie
  for (const s of [1, -1]) part(torso, G.cone(), M.get(CAPE_IN), [s * 0.04, 0.38, 0.2], [0.04, 0.06, 0.03], [0, 0, s * Math.PI / 2], fo);
  part(torso, G.ball(), M.get(CAPE_IN), [0, 0.38, 0.21], 0.022, undefined, fo);
  cape(torso, M, { y: 0.44, top: 0.2, bot: 0.4, h: 0.62, z: -0.02 });
  // high collar
  for (const s of [1, -1]) {
    const c = part(torso, G.cone(), M.get(CAPE_IN, { side: THREE.DoubleSide }), [s * 0.14, 0.52, -0.06], [0.11, 0.2, 0.02], [0.25, s * 0.5, s * -0.35]);
    c.castShadow = false;
  }
  const arms: THREE.Group[] = [];
  const skin = M.get(SKIN), skinD = M.get(SKIN_D);
  for (const s of [1, -1]) {
    const a = grp(torso, [s * 0.24, 0.32, 0]);
    part(a, G.capsule(0.045, 0.16), M.get('#3a2d58'), [0, -0.1, 0]);
    part(a, G.sphere(), skin, [0, -0.22, 0.01], 0.055);
    for (let i = -1; i <= 1; i++) part(a, G.cone(), basic('#efe8f8'), [i * 0.025, -0.27, 0.03], [0.012, 0.04, 0.012], [Math.PI, 0, 0], fo);
    arms.push(a);
  }
  const head = grp(torso, [0, 0.6, 0.02]);
  part(head, G.sphere(), skin, [0, 0.02, 0], [0.24, 0.23, 0.22]);
  // pointy ears
  for (const s of [1, -1]) part(head, G.cone(), skinD, [s * 0.24, 0.06, -0.02], [0.05, 0.16, 0.03], [0, 0, s * -1.1]);
  // slicked hair with a widow's peak
  part(head, G.dome(), M.get(HAIR), [0, 0.04, -0.02], [0.245, 0.22, 0.23], [-0.25, 0, 0]);
  part(head, G.cone(), M.get(HAIR), [0, 0.12, 0.19], [0.06, 0.12, 0.03], [Math.PI + 0.3, 0, 0], fo);
  const whites = vampEyes(head, M, { y: 0.02, z: 0.18, x: 0.085, r: 0.06 });
  const mouth = grp(head, [0, -0.11, 0.2]);
  const mouthIn = part(mouth, G.ball(), basic('#4a0f1c'), [0, 0, 0], [0.07, 0.025, 0.02], undefined, fo);
  fangs(mouth, -0.005, 0.012, 1);
  const glow = part(head, G.ball(), basic('#ff3040', { additive: true, opacity: 0, depthWrite: false }), [0, 0.02, 0.21], [0.16, 0.06, 0.03], undefined, { cast: false, receive: false });
  noOutline(glow);
  const blinker = new Blinker();
  const eyeY = whites.map((w) => w.scale.y);
  let t = Math.random() * 5, walk = 0, lean = 0, crouch = 0, open = 0, glowK = 0;
  return {
    root, M, top: 1.05,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      walk += dt * clamp(a.speed, 0, 6) * 2.4;
      const sw = a.speed > 0.3 ? Math.sin(walk) : 0;
      let wantLean = 0, wantCrouch = 0, wantOpen = 0, armF = sw * 0.6, armUp = 0, wantGlow = 0;
      switch (a.st) {
        case 'crouch': wantCrouch = 0.25 + 0.1 * a.p; wantLean = 0.25; armF = -0.9; wantGlow = 0.5 + 0.5 * a.p; wantOpen = 0.6; break;
        case 'lunge': wantLean = 0.75; armF = 1.5; armUp = 0.4; wantOpen = 1; wantGlow = 1; break;
        case 'recover': wantLean = -0.1; armF = -0.2; break;
        case 'hiss': wantLean = -0.25; armUp = 1.9; armF = 0.6; wantOpen = 1; wantGlow = 0.4; break;
        case 'stun': wantLean = Math.sin(t * 7) * 0.2; armF = Math.sin(t * 5) * 0.8; break;
        case 'burn': wantLean = -0.15 + Math.sin(t * 30) * 0.05; armUp = 1.4; wantOpen = 0.8; break;
      }
      lean = damp(lean, wantLean, 14, dt); crouch = damp(crouch, wantCrouch, 16, dt);
      open = damp(open, wantOpen, 18, dt); glowK = damp(glowK, wantGlow, 10, dt);
      body.rotation.x = lean;
      body.position.y = 0.36 - crouch * 0.3 + Math.abs(sw) * 0.03 + Math.sin(t * 2.2) * 0.01;
      base.scale.set(1 + crouch * 0.25, 1 - crouch * 0.2, 1 + crouch * 0.25);
      legs[0].rotation.x = sw * 0.7; legs[1].rotation.x = -sw * 0.7;
      arms[0].rotation.set(-armF, 0, 0.15 + armUp * 0.6); arms[1].rotation.set(-(a.st === 'walk' || a.speed > 0.3 ? -armF : armF), 0, -0.15 - armUp * 0.6);
      head.rotation.x = -lean * 0.4;
      mouth.scale.set(1, 1 + open * 2.4, 1);
      mouthIn.visible = open > 0.15;
      (glow.material as THREE.MeshBasicMaterial).opacity = glowK * 0.38;
      glow.visible = glowK > 0.02;
      stdUpdate(blinker, whites, eyeY, dt);
      M.flash(a.flash);
    },
  };
}

// ═════════════════════════════ НЕТОПЫРЬ (bat) ═════════════════════════════
/** poses: fly screech dive prep stun */
export function createBat(): VRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'bat';
  const bob = grp(root, [0, 0.2, 0]);
  const fur = M.get('#3b2b52'), furL = M.get('#5d4880');
  part(bob, G.sphere(), fur, [0, 0, 0], [0.14, 0.13, 0.13]);
  part(bob, G.sphere(), furL, [0, -0.03, 0.06], [0.09, 0.08, 0.07]);
  for (const s of [1, -1]) {
    part(bob, G.cone(), fur, [s * 0.075, 0.15, -0.01], [0.05, 0.12, 0.03], [0, 0, s * -0.35]);
    part(bob, G.cone(), M.get('#e88aa8'), [s * 0.075, 0.145, 0.006], [0.03, 0.08, 0.01], [0, 0, s * -0.35], fo);
  }
  const whites = vampEyes(bob, M, { y: 0.03, z: 0.11, x: 0.045, r: 0.035, brow: false });
  const mouth = grp(bob, [0, -0.05, 0.12]);
  const mouthIn = part(mouth, G.ball(), basic('#4a0f1c'), [0, 0, 0], [0.035, 0.012, 0.01], undefined, fo);
  fangs(mouth, -0.003, 0.006, 0.6);
  const W = wings(bob, M, 0.36, '#4b3566', '#2a1d3a', [0.1, 0.02, 0]);
  // little feet
  for (const s of [1, -1]) part(bob, G.capsule(0.012, 0.04), fur, [s * 0.04, -0.13, -0.02], 1, undefined, fo);
  const blinker = new Blinker();
  const eyeY = whites.map((w) => w.scale.y);
  let t = Math.random() * 5, open = 0;
  return {
    root, M, top: 0.45,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      let rate = 14, amp = 0.75, fold = 0, wantOpen = 0, pitch = 0;
      switch (a.st) {
        case 'screech': rate = 22; amp = 0.5; wantOpen = 1; pitch = -0.3; break;
        case 'prep': rate = 26; amp = 0.55; wantOpen = 0.5; pitch = 0.2; break;
        case 'dive': rate = 0; fold = 0.85; pitch = 0.6; wantOpen = 1; break;
        case 'stun': rate = 6; amp = 0.3; break;
        case 'perch': rate = 3; amp = 0.15; fold = 0.6; break;
      }
      const f = rate > 0 ? Math.sin(t * rate) * amp + 0.15 : 0.1;
      W.set(f, fold);
      bob.position.y = 0.2 - Math.sin(t * rate) * 0.025;
      bob.rotation.x = pitch;
      bob.rotation.z = a.st === 'stun' ? Math.sin(t * 9) * 0.5 : 0;
      open = damp(open, wantOpen, 20, dt);
      mouth.scale.set(1, 1 + open * 2.5, 1);
      mouthIn.visible = open > 0.15;
      stdUpdate(blinker, whites, eyeY, dt);
      M.flash(a.flash);
    },
  };
}

// ═════════════════════════════ ЛЕТУЧИЙ КЛЫКАРЬ (flyer) ═════════════════════════════
/** poses: fly aim dive ground rise stun */
export function createFlyer(): VRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'flyer';
  const body = grp(root, [0, 0.45, 0]);
  const skin = M.get('#b7a2dc'), dark = M.get('#2f2347');
  part(body, G.sphere(), dark, [0, 0, 0], [0.2, 0.26, 0.18]);
  part(body, G.sphere(), M.get('#d8cbe8'), [0, 0.02, 0.1], [0.09, 0.17, 0.08]);
  const head = grp(body, [0, 0.34, 0.03]);
  part(head, G.sphere(), skin, [0, 0, 0], [0.19, 0.18, 0.18]);
  for (const s of [1, -1]) part(head, G.cone(), M.get('#9b86c4'), [s * 0.16, 0.13, -0.02], [0.05, 0.2, 0.03], [0, 0, s * -0.45]);
  part(head, G.dome(), M.get(HAIR), [0, 0.03, -0.02], [0.195, 0.17, 0.185], [-0.3, 0, 0]);
  const whites = vampEyes(head, M, { y: 0.0, z: 0.14, x: 0.07, r: 0.05 });
  const mouth = grp(head, [0, -0.09, 0.16]);
  const mouthIn = part(mouth, G.ball(), basic('#4a0f1c'), [0, 0, 0], [0.055, 0.02, 0.015], undefined, fo);
  fangs(mouth, -0.004, 0.01, 0.85);
  const W = wings(body, M, 0.95, '#3d2b5c', '#1e1630', [0.14, 0.12, -0.02]);
  const legs: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const l = grp(body, [s * 0.08, -0.22, 0]);
    part(l, G.capsule(0.035, 0.14), dark, [0, -0.1, 0]);
    part(l, G.sphere(), M.get('#17111f'), [0, -0.22, 0.03], [0.045, 0.035, 0.07]);
    legs.push(l);
  }
  const blinker = new Blinker();
  const eyeY = whites.map((w) => w.scale.y);
  let t = Math.random() * 5, pitch = 0, open = 0;
  return {
    root, M, top: 1.05,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      let rate = 9, amp = 0.6, fold = 0, wantPitch = 0, wantOpen = 0, legK = 0.3;
      switch (a.st) {
        case 'aim': rate = 0; fold = 0; wantPitch = 0.5; wantOpen = 0.6; break;
        case 'dive': rate = 0; fold = 0.9; wantPitch = 1.2; wantOpen = 1; legK = 1; break;
        case 'ground': rate = 2; amp = 0.15; fold = 0.5; wantPitch = -0.2; legK = 0; break;
        case 'rise': rate = 16; amp = 0.8; break;
        case 'stun': rate = 4; amp = 0.25; fold = 0.4; wantPitch = Math.sin(t * 6) * 0.3; break;
      }
      const f = rate > 0 ? Math.sin(t * rate) * amp + 0.1 : (a.st === 'aim' ? 0.55 + Math.sin(t * 30) * 0.04 : -0.3);
      W.set(f, fold);
      pitch = damp(pitch, wantPitch, 10, dt);
      body.rotation.x = pitch;
      body.position.y = 0.45 + (rate > 0 ? -Math.sin(t * rate) * 0.04 : 0);
      legs[0].rotation.x = legK * 0.9 + Math.sin(t * 3) * 0.1; legs[1].rotation.x = legK * 0.9 - Math.sin(t * 3) * 0.1;
      open = damp(open, wantOpen, 16, dt);
      mouth.scale.set(1, 1 + open * 2.4, 1);
      mouthIn.visible = open > 0.15;
      stdUpdate(blinker, whites, eyeY, dt);
      M.flash(a.flash);
    },
  };
}

// ═════════════════════════════ ТУМАННИК (mist) ═════════════════════════════
/** poses: idle walk mist form claw recover burn; `cloud` shows during mist / form */
export function createMistling(): VRig & { body: THREE.Group; cloud: THREE.Group; eyesGlow: THREE.Group } {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'mistling';
  const body = grp(root);
  const coat = M.get('#4f5b80'), face = M.get('#dde2f2');
  // long coat (a cone) with a few tatters
  const coatGeo = cached('mist-coat', () => new THREE.CylinderGeometry(0.17, 0.32, 0.86, 16));
  part(body, coatGeo, coat, [0, 0.43, 0]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    part(body, G.cone(), coat, [Math.sin(a) * 0.28, 0.03, Math.cos(a) * 0.28], [0.06, 0.12, 0.04], [Math.PI, a, 0], fo);
  }
  // buttons + scarf
  for (let i = 0; i < 3; i++) part(body, G.ball(), M.get('#c9b25a'), [0, 0.55 - i * 0.14, 0.2 + i * 0.012], 0.022, undefined, fo);
  part(body, G.torus(0.16, 0.05, 8, 18), M.get('#6d2b4a'), [0, 0.86, 0], 1, [Math.PI / 2, 0, 0]);
  const arms: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const a = grp(body, [s * 0.22, 0.8, 0]);
    part(a, G.capsule(0.05, 0.36), coat, [0, -0.2, 0]);
    const hand = grp(a, [0, -0.43, 0.02]);
    part(hand, G.sphere(), face, [0, 0, 0], 0.05);
    for (let i = -1; i <= 1; i++) part(hand, G.cone(), basic('#f2f4ff'), [i * 0.025, -0.06, 0.02], [0.012, 0.07, 0.012], [Math.PI + 0.2, 0, 0], fo);
    arms.push(a);
  }
  const head = grp(body, [0, 1.0, 0.02]);
  part(head, G.sphere(), face, [0, 0, 0], [0.17, 0.2, 0.17]);
  // a battered top hat
  part(head, G.cyl(), M.get('#1d2236'), [0, 0.2, -0.01], [0.21, 0.025, 0.21]);
  part(head, G.cyl(), M.get('#1d2236'), [0, 0.32, -0.01], [0.13, 0.22, 0.13], [0.08, 0, 0.06]);
  part(head, G.cyl(), M.get('#6d2b4a'), [0, 0.245, -0.01], [0.135, 0.04, 0.135], [0.08, 0, 0.06], fo);
  const whites = vampEyes(head, M, { y: 0.03, z: 0.13, x: 0.06, r: 0.045, pupil: '#5ad0ff' });
  const mouth = grp(head, [0, -0.1, 0.15]);
  part(mouth, G.arc(0.04, 0.008, Math.PI), basic('#1b1214'), [0, 0, 0], 1, [0, 0, Math.PI], fo);
  fangs(mouth, -0.01, 0.005, 0.7);
  // mist cloud + glowing eyes (mist form)
  const cloud = grp(root);
  const puffM = basic('#aeb8e6', { transparent: true, opacity: 0.38, depthWrite: false });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU;
    const p = part(cloud, G.sphere(), puffM, [Math.sin(a) * 0.3, 0.35 + (i % 3) * 0.18, Math.cos(a) * 0.3], 0.28 + (i % 2) * 0.08, undefined, { cast: false, receive: false });
    p.userData.ph = a;
  }
  noOutline(cloud);
  cloud.visible = false;
  const eyesGlow = grp(root, [0, 0.9, 0.25]);
  for (const s of [1, -1]) part(eyesGlow, G.ball(), basic('#7ae0ff', { additive: true, depthWrite: false }), [s * 0.08, 0, 0], [0.05, 0.035, 0.02], undefined, { cast: false, receive: false });
  noOutline(eyesGlow);
  eyesGlow.visible = false;
  const blinker = new Blinker();
  const eyeY = whites.map((w) => w.scale.y);
  let t = Math.random() * 5, walk = 0, lean = 0;
  return {
    root, M, top: 1.45, body, cloud, eyesGlow,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      walk += dt * clamp(a.speed, 0, 6) * 2.2;
      const sw = a.speed > 0.3 ? Math.sin(walk) : 0;
      const mist = a.st === 'mist' || a.st === 'form';
      body.visible = !mist || (a.st === 'form' && a.p > 0.75);
      cloud.visible = mist;
      eyesGlow.visible = a.st === 'form';
      if (mist) {
        const k = a.st === 'form' ? 1 - a.p * 0.6 : 1;
        cloud.children.forEach((c, i) => {
          const ph = c.userData.ph as number;
          c.position.set(Math.sin(ph + t * 2) * 0.32 * k, 0.3 + (i % 3) * 0.2 + Math.sin(t * 3 + ph) * 0.06, Math.cos(ph + t * 2) * 0.32 * k);
          c.scale.setScalar((0.24 + (i % 2) * 0.08) * (a.st === 'form' ? 1 - a.p * 0.4 : 1));
        });
        eyesGlow.scale.setScalar(a.st === 'form' ? 0.6 + a.p : 1);
      }
      let wantLean = 0, armF = sw * 0.5, armUp = 0;
      switch (a.st) {
        case 'form': armUp = 1.2; armF = -0.4; break;
        case 'claw': wantLean = 0.45; armF = 1.6 - a.p * 2.4; armUp = 0.3; break;
        case 'recover': wantLean = -0.1; armF = -0.3; break;
        case 'burn': wantLean = -0.2 + Math.sin(t * 30) * 0.05; armUp = 1.5; break;
        case 'stun': wantLean = Math.sin(t * 6) * 0.2; break;
      }
      lean = damp(lean, wantLean, 14, dt);
      body.rotation.x = lean;
      body.rotation.z = Math.sin(t * 1.3) * 0.04;
      body.position.y = Math.sin(t * 2.0) * 0.02;
      arms[0].rotation.set(-armF, 0, 0.12 + armUp * 0.5); arms[1].rotation.set(-armF * (a.st === 'claw' ? 0.6 : -1), 0, -0.12 - armUp * 0.5);
      stdUpdate(blinker, whites, eyeY, dt);
      M.flash(a.flash);
    },
  };
}

// ═════════════════════════════ НЕВИДИМКА-СЛУГА (servant) ═════════════════════════════
/** poses: idle walk windup slap retreat stun */
export function createServant(): VRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'servant';
  const base = grp(root);
  const coat = M.get('#262033'), shirt = M.get('#f2eee6'), skin = M.get('#a9bba8'), skinD = M.get('#8aa08a');
  const legs: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const l = grp(base, [s * 0.1, 0.3, 0]);
    part(l, G.capsule(0.05, 0.16), coat, [0, -0.13, 0]);
    part(l, G.sphere(), M.get('#121018'), [0, -0.26, 0.04], [0.065, 0.045, 0.1]);
    legs.push(l);
  }
  const body = grp(base, [0, 0.3, 0]);
  part(body, G.sphere(), coat, [0, 0.2, -0.02], [0.23, 0.25, 0.21]);
  part(body, G.sphere(), shirt, [0, 0.22, 0.1], [0.12, 0.18, 0.1]);
  part(body, G.ball(), basic('#1b1214'), [0, 0.36, 0.19], 0.025, undefined, fo);
  // tailcoat tails
  for (const s of [1, -1]) part(body, G.cone(), coat, [s * 0.07, 0.0, -0.17], [0.07, 0.24, 0.03], [Math.PI + 0.35, 0, 0]);
  const arms: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const a = grp(body, [s * 0.22, 0.3, 0]);
    part(a, G.capsule(0.04, 0.16), coat, [0, -0.1, 0]);
    part(a, G.sphere(), M.get('#ffffff'), [0, -0.22, 0.01], 0.05); // white gloves
    arms.push(a);
  }
  // a tray in the left hand
  const tray = grp(arms[1], [0, -0.25, 0.06]);
  part(tray, G.cyl(), M.get('#d8dce6'), [0, 0, 0.05], [0.16, 0.012, 0.16]);
  part(tray, G.dome(), M.get('#c9ced8'), [0, 0.01, 0.05], [0.11, 0.09, 0.11]);
  const head = grp(body, [0, 0.5, 0.05]);
  part(head, G.sphere(), skin, [0, 0.02, 0], [0.17, 0.19, 0.17]);
  part(head, G.sphere(), skinD, [0, -0.01, 0.17], [0.05, 0.07, 0.06]); // big nose
  for (const s of [1, -1]) part(head, G.cone(), skinD, [s * 0.17, 0.04, -0.01], [0.04, 0.1, 0.02], [0, 0, s * -1.15]);
  // comb-over: three hairs
  for (let i = -1; i <= 1; i++) part(head, G.capsule(0.008, 0.2), M.get('#3a3428'), [i * 0.03, 0.2, 0], 1, [0, 0, Math.PI / 2 + 0.15], fo);
  const whites = vampEyes(head, M, { y: 0.06, z: 0.13, x: 0.06, r: 0.04, pupil: '#a01828' });
  const mouth = grp(head, [0, -0.08, 0.15]);
  part(mouth, G.arc(0.035, 0.008, Math.PI), basic('#1b1214'), [0, 0, 0], 1, [0, 0, Math.PI], fo);
  fangs(mouth, -0.008, 0.004, 0.6);
  const blinker = new Blinker();
  const eyeY = whites.map((w) => w.scale.y);
  let t = Math.random() * 5, walk = 0, hunch = 0;
  return {
    root, M, top: 0.95,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      walk += dt * clamp(a.speed, 0, 6) * 3;
      const sw = a.speed > 0.3 ? Math.sin(walk) : 0;
      let wantHunch = 0.35, armA = sw * 0.5, armB = -sw * 0.5;
      switch (a.st) {
        case 'windup': wantHunch = 0.15; armA = -1.6; break;
        case 'slap': wantHunch = 0.5; armA = 1.8 - Math.sin(a.p * Math.PI * 2) * 0.8; armB = 1.2; break;
        case 'retreat': wantHunch = 0.6; break;
        case 'stun': wantHunch = 0.2 + Math.sin(t * 7) * 0.15; armA = Math.sin(t * 5); break;
      }
      hunch = damp(hunch, wantHunch, 12, dt);
      body.rotation.x = hunch;
      body.position.y = 0.3 + Math.abs(sw) * 0.03;
      legs[0].rotation.x = sw * 0.8; legs[1].rotation.x = -sw * 0.8;
      arms[0].rotation.set(-armA, 0, 0.1); arms[1].rotation.set(-armB - 0.6, 0, -0.1);
      head.rotation.x = -hunch * 0.7;
      stdUpdate(blinker, whites, eyeY, dt);
      M.flash(a.flash);
    },
  };
}

// ═════════════════════════════ УПЫРЬ-ГРОМИЛА (brute) ═════════════════════════════
/** poses: idle walk raise slam recover punchPrep punch burn stun */
export function createBrute(): VRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'brute';
  const base = grp(root);
  const skin = M.get('#a090c4'), skinD = M.get('#7a6c9c'), vest = M.get('#5a2a3e'), pants = M.get('#2f2a3f');
  const legs: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const l = grp(base, [s * 0.22, 0.42, 0]);
    part(l, G.capsule(0.12, 0.2), pants, [0, -0.18, 0]);
    part(l, G.sphere(), skinD, [0, -0.38, 0.08], [0.15, 0.08, 0.2]);
    legs.push(l);
  }
  const body = grp(base, [0, 0.42, 0]);
  part(body, G.sphere(), skin, [0, 0.52, -0.04], [0.6, 0.55, 0.48]);
  part(body, G.sphere(), M.get('#a598c2'), [0, 0.42, 0.24], [0.34, 0.32, 0.22]); // belly
  // torn vest
  part(body, G.sphere(), vest, [0, 0.6, -0.1], [0.62, 0.48, 0.45]).scale.set(0.63, 0.5, 0.42);
  for (let i = 0; i < 4; i++) part(body, G.ball(), M.get('#c9b25a'), [(i - 1.5) * 0.12, 0.92, 0.12], 0.03, undefined, fo);
  const arms: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const a = grp(body, [s * 0.58, 0.75, 0]);
    part(a, G.capsule(0.12, 0.34), skin, [0, -0.24, 0]);
    part(a, G.sphere(), skinD, [0, -0.52, 0.04], [0.22, 0.2, 0.22]);
    for (let i = -1; i <= 1; i++) part(a, G.sphere(), skin, [i * 0.09, -0.58, 0.17], [0.07, 0.06, 0.06], undefined, fo);
    arms.push(a);
  }
  const head = grp(body, [0, 1.2, 0.16]);
  part(head, G.sphere(), skin, [0, 0, 0], [0.26, 0.24, 0.24]);
  part(head, G.sphere(), skinD, [0, 0.13, 0.12], [0.23, 0.07, 0.13]); // brow ridge
  for (const s of [1, -1]) part(head, G.cone(), skinD, [s * 0.25, 0.06, -0.02], [0.05, 0.11, 0.025], [0, 0, s * -1.2]);
  const whites = vampEyes(head, M, { y: 0.05, z: 0.2, x: 0.09, r: 0.045 });
  const jaw = grp(head, [0, -0.12, 0.13]);
  part(jaw, G.sphere(), skinD, [0, -0.02, 0], [0.2, 0.09, 0.13]);
  fangs(jaw, 0.06, 0.1, 1.3, true); // underbite tusks
  const blinker = new Blinker();
  const eyeY = whites.map((w) => w.scale.y);
  let t = Math.random() * 5, walk = 0, raise = 0, squash = 0, lean = 0;
  return {
    root, M, top: 1.95,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      walk += dt * clamp(a.speed, 0, 5) * 1.9;
      const sw = a.speed > 0.2 ? Math.sin(walk) : 0;
      let wantRaise = 0, wantSquash = 0, wantLean = 0.1, armF0 = sw * 0.4, armF1 = -sw * 0.4;
      switch (a.st) {
        case 'raise': wantRaise = 0.4 + 0.6 * a.p; wantLean = -0.25; break;
        case 'slam': wantRaise = -0.4; wantSquash = 0.25; wantLean = 0.45; break;
        case 'recover': wantLean = 0.25 + Math.sin(t * 5) * 0.05; armF0 = -0.2; armF1 = -0.2; break;
        case 'punchPrep': armF0 = -1.2; wantLean = -0.15; break;
        case 'punch': armF0 = 1.8; wantLean = 0.35; break;
        case 'burn': wantRaise = 0.5 + Math.sin(t * 25) * 0.1; wantLean = -0.2; break;
        case 'stun': wantLean = Math.sin(t * 4) * 0.2; break;
      }
      raise = damp(raise, wantRaise, a.st === 'slam' ? 30 : 10, dt);
      squash = damp(squash, wantSquash, 20, dt);
      lean = damp(lean, wantLean, 12, dt);
      body.rotation.x = lean;
      body.position.y = 0.42 - squash * 0.2 + Math.abs(sw) * 0.04;
      base.scale.set(1 + squash * 0.3, 1 - squash * 0.25, 1 + squash * 0.3);
      legs[0].rotation.x = sw * 0.5; legs[1].rotation.x = -sw * 0.5;
      const up = raise * 2.6;
      arms[0].rotation.set(-armF0 - up, 0, 0.25 + Math.max(0, raise) * 0.2);
      arms[1].rotation.set(-armF1 - up, 0, -0.25 - Math.max(0, raise) * 0.2);
      jaw.rotation.x = a.st === 'raise' || a.st === 'burn' ? 0.35 : 0.05;
      stdUpdate(blinker, whites, eyeY, dt);
      M.flash(a.flash);
    },
  };
}

// ═════════════════════════════ ПРЕСНЯКИ (candy townsfolk) ═════════════════════════════
export type FolkKind = 'zefir' | 'pryanik' | 'marmelad';
export const FOLK_KINDS: FolkKind[] = ['zefir', 'pryanik', 'marmelad'];
/** the colour a restored townsperson bursts into (confetti) */
export const FOLK_COLORS: Record<FolkKind, string[]> = {
  zefir: ['#ffb3c8', '#ffe0ea', '#ff7aa2'],
  pryanik: ['#c47a3a', '#ffffff', '#ff5a6a', '#6ad0ff'],
  marmelad: ['#7fd35a', '#ffb02a', '#ff5a3a', '#ffe14a'],
};
/** poses: shuffle stun happy wave; `sleepy` (0..1) closes the eyelids */
export function createFolk(kind: FolkKind, seed = 0): VRig & { sleepy: number } {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'folk-' + kind;
  const base = grp(root);
  const legs: THREE.Group[] = [];
  const arms: THREE.Group[] = [];
  let head: THREE.Group;
  let face: THREE.Group;
  let top = 1;
  const pick = <T,>(a: T[]) => a[Math.abs(seed) % a.length];
  if (kind === 'zefir') {
    const pinks = ['#ffb3c8', '#ffd0a8', '#e9c2ff', '#c2f0d8'];
    const c = pick(pinks);
    const m = M.get(c), mD = M.get(new THREE.Color(c).multiplyScalar(0.88));
    for (const s of [1, -1]) { const l = grp(base, [s * 0.1, 0.12, 0]); part(l, G.capsule(0.05, 0.08), mD, [0, -0.05, 0]); legs.push(l); }
    const body = grp(base, [0, 0.12, 0]);
    // marshmallow swirl: three soft tiers
    part(body, G.sphere(), m, [0, 0.2, 0], [0.27, 0.2, 0.25]);
    part(body, G.sphere(), m, [0, 0.42, 0], [0.22, 0.16, 0.21]);
    part(body, G.sphere(), m, [0, 0.58, 0], [0.15, 0.13, 0.15]);
    part(body, G.cone(), m, [0, 0.72, 0], [0.06, 0.1, 0.06], [0, 0, 0.3]);
    for (const s of [1, -1]) { const a = grp(body, [s * 0.25, 0.3, 0]); part(a, G.capsule(0.04, 0.1), mD, [s * 0.03, -0.06, 0], 1, [0, 0, s * 0.4]); arms.push(a); }
    head = grp(body, [0, 0.42, 0.19]);
    face = head;
    top = 0.95;
  } else if (kind === 'pryanik') {
    const m = M.get('#c47a3a'), icing = M.get('#ffffff');
    const box = cached('folk-ginger', () => new THREE.CylinderGeometry(1, 1, 1, 24));
    for (const s of [1, -1]) { const l = grp(base, [s * 0.11, 0.2, 0]); part(l, G.capsule(0.07, 0.12), m, [0, -0.1, 0]); part(l, G.torus(0.07, 0.012, 6, 14), icing, [0, -0.08, 0], 1, [Math.PI / 2, 0, 0], fo); legs.push(l); }
    const body = grp(base, [0, 0.2, 0]);
    part(body, box, m, [0, 0.25, 0], [0.22, 0.12, 0.28], [Math.PI / 2, 0, 0]);
    const buttons = ['#ff5a6a', '#6ad0ff', '#ffe14a'];
    for (let i = 0; i < 3; i++) part(body, G.ball(), M.get(buttons[(i + seed) % 3]), [0, 0.32 - i * 0.1, 0.13], 0.035, undefined, fo);
    part(body, G.arc(0.14, 0.012, Math.PI), icing, [0, 0.08, 0.125], [1, 0.4, 1], [0, 0, Math.PI], fo);
    for (const s of [1, -1]) { const a = grp(body, [s * 0.2, 0.36, 0]); part(a, G.capsule(0.065, 0.12), m, [s * 0.06, -0.04, 0], 1, [0, 0, s * 1.1]); arms.push(a); }
    head = grp(body, [0, 0.66, 0]);
    part(head, box, m, [0, 0, 0], [0.2, 0.1, 0.2], [Math.PI / 2, 0, 0]);
    part(head, G.torus(0.19, 0.012, 6, 28), icing, [0, 0, 0.045], 1, undefined, fo);
    face = grp(head, [0, 0, 0.035]);
    top = 1.05;
  } else {
    const cols = ['#7fd35a', '#ffb02a', '#ff5a3a', '#c070ff'];
    const c = pick(cols);
    const m = M.get(c), mD = M.get(new THREE.Color(c).multiplyScalar(0.8));
    for (const s of [1, -1]) { const l = grp(base, [s * 0.09, 0.1, 0]); part(l, G.capsule(0.045, 0.06), mD, [0, -0.04, 0]); legs.push(l); }
    const body = grp(base, [0, 0.1, 0]);
    part(body, G.sphere(), m, [0, 0.25, 0], [0.25, 0.25, 0.23]);
    part(body, G.cone(), m, [0, 0.58, 0], [0.17, 0.28, 0.16]);
    // sugar sprinkles
    for (let i = 0; i < 9; i++) { const a = i * 2.39; part(body, G.ball(), M.get('#ffffff'), [Math.sin(a) * 0.22, 0.12 + (i % 4) * 0.1, Math.cos(a) * 0.2], 0.018, undefined, fo); }
    for (const s of [1, -1]) { const a = grp(body, [s * 0.23, 0.28, 0]); part(a, G.capsule(0.04, 0.09), mD, [s * 0.03, -0.05, 0], 1, [0, 0, s * 0.5]); arms.push(a); }
    head = grp(body, [0, 0.3, 0.2]);
    face = head;
    top = 0.95;
  }
  // face (shared): eyes with lids, cheeks, mouth (sleepy line ↔ smile)
  const white = basic('#ffffff'), black = basic('#1b1214');
  const lidM = M.get(kind === 'pryanik' ? '#b06a30' : '#e8d8e0');
  const lids: THREE.Mesh[] = [];
  const eyeY = 0.04, eyeX = 0.07;
  for (const s of [1, -1]) {
    part(face, G.ball(), white, [s * eyeX, eyeY, 0.02], [0.045, 0.05, 0.02], undefined, fo);
    part(face, G.ball(), black, [s * eyeX, eyeY - 0.008, 0.035], [0.022, 0.028, 0.01], undefined, fo);
    lids.push(part(face, G.dome(), lidM, [s * eyeX, eyeY, 0.022], [0.05, 0.055, 0.03], [0, 0, 0], fo));
    part(face, G.ball(), M.get('#ff8aa8', { transparent: true, opacity: 0.7 }), [s * 0.12, -0.03, 0.01], [0.03, 0.018, 0.008], undefined, fo);
  }
  const sleepyMouth = part(face, G.capsule(0.008, 0.04), black, [0, -0.05, 0.03], 1, [0, 0, Math.PI / 2], fo);
  const smile = part(face, G.arc(0.04, 0.009, Math.PI), black, [0, -0.04, 0.03], 1, [0, 0, Math.PI], fo);
  const blinker = new Blinker();
  let t = Math.random() * 5, walk = 0, hop = 0;
  const rig = {
    root, M, top, sleepy: 1,
    update(dt: number, a: VAnim) {
      dt = Math.min(dt, 0.05); t += dt;
      walk += dt * clamp(a.speed, 0, 4) * 4;
      const sw = a.speed > 0.15 ? Math.sin(walk) : 0;
      let sway = Math.sin(t * 1.3) * 0.08 * rig.sleepy, armU = 0, wantHop = 0;
      switch (a.st) {
        case 'stun': sway = Math.sin(t * 9) * 0.25; armU = 0.8; break;
        case 'happy': wantHop = Math.abs(Math.sin(t * 7)) * 0.18; armU = 2.2 + Math.sin(t * 14) * 0.3; sway = Math.sin(t * 7) * 0.1; break;
        case 'wave': armU = 2.4; sway = 0.05; break;
      }
      hop = damp(hop, wantHop, 20, dt);
      base.position.y = hop;
      base.rotation.z = sway;
      base.rotation.x = rig.sleepy * 0.12;
      legs[0].rotation.x = sw * 0.7; legs[1].rotation.x = -sw * 0.7;
      arms[0].rotation.z = 0.2 + armU * (a.st === 'wave' ? 1 : 0.8) + (a.st === 'wave' ? Math.sin(t * 12) * 0.35 : 0);
      arms[1].rotation.z = -0.2 - armU * (a.st === 'wave' ? 0.1 : 0.8);
      arms[0].rotation.x = -sw * 0.4; arms[1].rotation.x = sw * 0.4;
      const bl = blinker.update(dt);
      const close = clamp(lerp(bl, 0.82 + Math.sin(t * 0.7) * 0.12, rig.sleepy), 0, 1);
      for (const l of lids) { l.rotation.x = lerp(-1.3, 1.45, close); l.visible = close > 0.05; }
      smile.visible = rig.sleepy < 0.5; sleepyMouth.visible = !smile.visible;
      M.flash(a.flash);
    },
  };
  return rig;
}

/** dizzy stars circling over a head (shared by stunned vampires and townsfolk) */
export function createStars(): THREE.Group {
  const g = new THREE.Group();
  const m = basic('#ffe14a');
  const geo = cached('vamp-star', () => {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.035 : 0.08; const a = (i / 10) * TAU; if (i === 0) s.moveTo(Math.sin(a) * r, Math.cos(a) * r); else s.lineTo(Math.sin(a) * r, Math.cos(a) * r); }
    return new THREE.ShapeGeometry(s);
  });
  for (let i = 0; i < 3; i++) { const st = new THREE.Mesh(geo, m); st.userData.a = (i / 3) * TAU; g.add(st); }
  noOutline(g);
  g.visible = false;
  return g;
}
export function spinStars(g: THREE.Group, t: number, r = 0.3) {
  for (const c of g.children) { const a = (c.userData.a as number) + t * 4; c.position.set(Math.cos(a) * r, Math.sin(t * 6 + a) * 0.04, Math.sin(a) * r); c.rotation.y = -a; }
}
