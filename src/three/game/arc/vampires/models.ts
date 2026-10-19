import * as THREE from 'three';
import { basic, noOutline, canvasTex } from '../../../gfx';
import { G, Mats, TAU, clamp, damp, grp, part, cached, merge as mergeK } from '../../../models/kit';
import { buildToonFace } from '../../../models/toonFace';
import { flatten, puffGeo } from '../../../models/toonKit';
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
/**
 * Poses: shuffle stun happy wave; `sleepy` (0..1) droops the eyelids and the head. Each kind has its own silhouette —
 * zefir: a three-tier marshmallow swirl with a curl on top; pryanik: a gingerbread disc with piped icing;
 * marmelad: a sugared gummy drop — and the shared cartoon face (models/toonFace) that drowses, startles and beams.
 */
export function createFolk(kind: FolkKind, seed = 0): VRig & { sleepy: number } {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'folk-' + kind;
  const base = grp(root);
  const legs: THREE.Group[] = [];
  const arms: THREE.Group[] = [];
  let head: THREE.Group;
  let top = 1;
  let fR = 0.2, fC: [number, number, number] = [0, 0, 0], lidM: THREE.Material, iris = '#6a4ad8', ew = 0.045;
  const pick = <T,>(a: T[]) => a[Math.abs(seed) % a.length];
  const shoe = M.get('#6a3a2a');
  if (kind === 'zefir') {
    const pinks = ['#ffb3c8', '#ffd0a8', '#e9c2ff', '#c2f0d8'];
    const c = pick(pinks);
    const m = M.get(c), mD = M.get(new THREE.Color(c).multiplyScalar(0.88));
    for (const s of [1, -1]) { const l = grp(base, [s * 0.1, 0.12, 0]); part(l, G.capsule(0.05, 0.08), mD, [0, -0.05, 0]); part(l, G.sphere(), shoe, [0, -0.1, 0.03], [0.065, 0.05, 0.085]); legs.push(l); }
    const body = grp(base, [0, 0.12, 0]);
    // marshmallow swirl: three soft tiers with grooves, a curl on top
    const st = grp(body);
    part(st, folkPuff(1), m, [0, 0.2, 0], [0.28, 0.2, 0.26]);
    part(st, folkPuff(2), m, [0, 0.42, 0], [0.23, 0.17, 0.22]);
    part(st, folkPuff(3), m, [0, 0.6, 0], [0.155, 0.13, 0.155]);
    part(st, G.torus(0.055, 0.03, 8, 16, ), m, [0.03, 0.74, 0], 1, [0.2, 0, 1.2]);
    flattenFolk(st);
    for (const s of [1, -1]) { const a = grp(body, [s * 0.26, 0.3, 0]); part(a, G.capsule(0.04, 0.1), mD, [s * 0.03, -0.06, 0], 1, [0, 0, s * 0.4]); part(a, G.sphere(), m, [s * 0.06, -0.13, 0], 0.05); arms.push(a); }
    head = grp(body, [0, 0.42, 0]);
    fR = 0.215; lidM = m; iris = pick(['#7a4ad8', '#3a8ad8', '#d84a8a', '#3aa87a']); ew = 0.048;
    top = 0.95;
  } else if (kind === 'pryanik') {
    const m = M.get('#ffffff', { map: folkGingerTex() }), icing = M.get('#ffffff');
    const box = cached('folk-ginger', () => new THREE.CylinderGeometry(1, 1, 1, 28));
    for (const s of [1, -1]) { const l = grp(base, [s * 0.11, 0.2, 0]); part(l, G.capsule(0.07, 0.12), m, [0, -0.1, 0]); part(l, G.torus(0.07, 0.012, 6, 14), icing, [0, -0.08, 0], 1, [Math.PI / 2, 0, 0], fo); legs.push(l); }
    const body = grp(base, [0, 0.2, 0]);
    const st = grp(body);
    part(st, box, m, [0, 0.25, 0], [0.22, 0.12, 0.28], [Math.PI / 2, 0, 0]);
    const buttons = ['#ff5a6a', '#6ad0ff', '#ffe14a'];
    for (let i = 0; i < 3; i++) part(st, G.sphere(), M.get(buttons[(i + seed) % 3]), [0, 0.34 - i * 0.1, 0.13], [0.035, 0.035, 0.022], undefined, fo);
    part(st, folkZigzag(), icing, [0, 0.0, 0], 1, undefined, fo);
    flattenFolk(st);
    for (const s of [1, -1]) { const a = grp(body, [s * 0.2, 0.36, 0]); part(a, G.capsule(0.065, 0.12), m, [s * 0.06, -0.04, 0], 1, [0, 0, s * 1.1]); part(a, G.torus(0.065, 0.012, 6, 14), icing, [s * 0.11, -0.07, 0], 1, [Math.PI / 2, 0, s * 1.1], fo); arms.push(a); }
    head = grp(body, [0, 0.66, 0]);
    part(head, box, m, [0, 0, 0], [0.2, 0.1, 0.2], [Math.PI / 2, 0, 0]);
    part(head, G.torus(0.185, 0.012, 6, 32), icing, [0, 0, 0.05], 1, undefined, fo);
    fR = 0.5; fC = [0, 0, 0.068 - 0.5]; lidM = m; iris = '#4a2a14'; ew = 0.044;
    top = 1.05;
  } else {
    const cols = ['#7fd35a', '#ffb02a', '#ff5a3a', '#c070ff'];
    const c = pick(cols);
    const m = M.get(c), mD = M.get(new THREE.Color(c).multiplyScalar(0.8));
    for (const s of [1, -1]) { const l = grp(base, [s * 0.09, 0.1, 0]); part(l, G.capsule(0.045, 0.06), mD, [0, -0.04, 0]); part(l, G.sphere(), shoe, [0, -0.08, 0.03], [0.06, 0.045, 0.08]); legs.push(l); }
    const body = grp(base, [0, 0.1, 0]);
    const st = grp(body);
    part(st, G.sphere(), m, [0, 0.25, 0], [0.25, 0.25, 0.23]);
    part(st, G.cone(), m, [0, 0.58, 0], [0.17, 0.28, 0.16]);
    part(st, cached('folk-gummy-sugar', () => {
      const parts: Array<{ g: THREE.BufferGeometry; p: [number, number, number]; s: number; r: [number, number, number] }> = [];
      for (let i = 0; i < 22; i++) { const a = i * 2.39996, y = 0.06 + ((i * 0.618) % 1) * 0.5; if (Math.cos(a) > 0.5 && y > 0.14 && y < 0.42) continue; const r = y < 0.45 ? Math.sqrt(Math.max(0, 1 - ((y - 0.25) / 0.25) ** 2)) : 0.5; parts.push({ g: new THREE.BoxGeometry(1, 1, 1), p: [Math.sin(a) * 0.245 * r, y, Math.cos(a) * 0.225 * r], s: 0.022, r: [a, a * 1.3, 0] }); }
      return mergeFolk(parts);
    }), M.get('#ffffff'), undefined, 1, undefined, fo);
    noOutline(part(st, G.sphere(), basic('#ffffff', { transparent: true, opacity: 0.5 }), [-0.1, 0.42, 0.14], [0.04, 0.06, 0.02], [0.3, -0.6, 0.5], fo));
    flattenFolk(st);
    for (const s of [1, -1]) { const a = grp(body, [s * 0.23, 0.28, 0]); part(a, G.capsule(0.04, 0.09), mD, [s * 0.03, -0.05, 0], 1, [0, 0, s * 0.5]); part(a, G.sphere(), m, [s * 0.055, -0.11, 0], 0.045); arms.push(a); }
    head = grp(body, [0, 0.27, 0]);
    fR = 0.235; lidM = m; iris = '#2a2a3a'; ew = 0.05;
    top = 0.95;
  }
  // the shared cartoon face
  const [eyeYaw, eyePitch] = [Math.asin(Math.min(0.9, ew * 1.45 / fR)), Math.asin(Math.min(0.9, 0.035 / fR))];
  const face = buildToonFace(head, M, {
    R: fR, center: fC, eyeYaw, eyePitch, eyeW: ew, eyeH: ew * 1.2, eyeD: 0.5, iris, irisSize: 0.8, lidMat: lidM, lidRest: 0.05,
    brow: kind === 'pryanik' ? '#6a3412' : '#' + new THREE.Color((lidM as THREE.MeshToonMaterial).color).multiplyScalar(0.5).getHexString(), browThick: ew * 0.2, browW: ew * 0.8, browLift: 1.7,
    mouthPitch: -Math.asin(Math.min(0.9, 0.06 / fR)), mouthW: ew * 0.85, cheek: '#ff8aa8',
  });
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
      head.rotation.x = rig.sleepy * (0.12 + Math.sin(t * 0.7) * 0.06);
      legs[0].rotation.x = sw * 0.7; legs[1].rotation.x = -sw * 0.7;
      arms[0].rotation.z = 0.2 + armU * (a.st === 'wave' ? 1 : 0.8) + (a.st === 'wave' ? Math.sin(t * 12) * 0.35 : 0);
      arms[1].rotation.z = -0.2 - armU * (a.st === 'wave' ? 0.1 : 0.8);
      arms[0].rotation.x = -sw * 0.4; arms[1].rotation.x = sw * 0.4;
      const ex = a.st === 'stun' ? 'surprised' : a.st === 'happy' || a.st === 'wave' ? 'happy' : rig.sleepy > 0.5 ? 'sleepy' : 'normal';
      face.update(dt, ex, 0, { lid: rig.sleepy * (0.75 + Math.sin(t * 0.7) * 0.2), browBias: -rig.sleepy * 0.2 });
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

// ───────────────────────── пресняки helpers ─────────────────────────
/** a soft lumpy puff (marshmallow tiers) */
function folkPuff(seed: number) { return puffGeo(seed + 60, 0.05); }
/** bake a static group into one mesh per material */
function flattenFolk(g: THREE.Object3D) { flatten(g); }
function mergeFolk(parts: Array<{ g: THREE.BufferGeometry; p: [number, number, number]; s: number; r: [number, number, number] }>) { return mergeK(parts); }
/** piped icing: a zig-zag across the gingerbread belly + a scalloped hem */
function folkZigzag() {
  return cached('folk-zigzag', () => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) pts.push(new THREE.Vector3(-0.15 + i * 0.025, 0.06 + (i % 2) * 0.03, 0.12 - Math.abs(-0.15 + i * 0.025) * 0.25));
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.011, 6, false);
  });
}
let gingerT: THREE.Texture | null = null;
/** baked gingerbread with crumbs */
function folkGingerTex() {
  return (gingerT ??= canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#c47a3a'; g.fillRect(0, 0, w, h);
    let r = 7;
    const R = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 160; i++) { g.fillStyle = R() < 0.6 ? 'rgba(90,40,10,0.2)' : 'rgba(255,220,170,0.18)'; g.beginPath(); g.ellipse(R() * w, R() * h, 1 + R() * 3, 1 + R() * 2, R() * 3, 0, TAU); g.fill(); }
  }, { wrap: true }));
}
