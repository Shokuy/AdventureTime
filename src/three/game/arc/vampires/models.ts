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
  /** flyers: bank into a turn (−1..1, + = turning right) and nose pitch (+ = nose down), from their flight */
  bank?: number;
  pitch?: number;
}
export interface VRig extends Rig<VAnim> {
  M: Mats;
  /** height of the head top (barks, stars) */
  top: number;
}

const fo = { cast: false };

// The vampire rigs live in rigs.ts (Клыкарь, Нетопырь, Летучий клыкарь, Туманник, Невидимка-слуга, Упырь-громила).
export { createFanger, createBat, createFlyer, createMistling, createServant, createBrute } from './rigs';

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
