import * as THREE from 'three';
import { basic, canvasTex, noOutline } from '../../../gfx';
import { G, Mats, TAU, clamp, damp, grp, part, cached, Blinker } from '../../../models/kit';
import type { Rig } from '../../../models/rig';
import type { VAnim, VRig } from '../vampires';

/**
 * Small rigs of «Замок Полночь»: the grey portraits (painted canvases, the living ones with bat wings), the library's
 * book-bats, the shadow imps of the last phase and the five little bats on the stairs (the defeated lieutenants).
 * Feet at y = 0, facing +Z, 1 unit ≈ the hero's height; own materials per rig (hit flash, greyness).
 */
const fo = { cast: false };

// ───────────────────────── paintings ─────────────────────────
export type PaintKind = 'lady' | 'knight' | 'candy' | 'bear' | 'girl' | 'netopyr' | 'morok' | 'shepot' | 'twins' | 'king' | 'baker' | 'owl'
  /** (v2 §9.2.1) the servants as they were before the deal */
  | 'tailor' | 'frog' | 'eared' | 'sisters';
const PAINT_CACHE = new Map<string, THREE.Texture>();
/** a grey painting (the King drank its colours): figure, background, a little plaque line; `color` = restored */
export function paintingTex(kind: PaintKind, color = false) {
  const key = kind + (color ? '+c' : '');
  let t = PAINT_CACHE.get(key);
  if (t) return t;
  t = canvasTex(256, 320, (g, w, h) => {
    const C = (c: string, grey: string) => (color ? c : grey);
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, C('#3a5a8a', '#5a5862')); bg.addColorStop(1, C('#2a2a4a', '#3a3842'));
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const cx = w / 2;
    const body = (fill: string) => { g.fillStyle = fill; g.beginPath(); g.ellipse(cx, h * 0.92, 80, 90, 0, Math.PI, TAU); g.fill(); };
    const head = (fill: string, y = 0.42, r = 46) => { g.fillStyle = fill; g.beginPath(); g.arc(cx, h * y, r, 0, TAU); g.fill(); };
    const eyesAt = (y: number, dx = 16) => { g.fillStyle = '#d8d8e0'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * dx, h * y, 9, 11, 0, 0, TAU); g.fill(); } };
    switch (kind) {
      case 'lady': body(C('#c84a8a', '#6a6672')); head(C('#ffd8c8', '#9a98a2')); g.fillStyle = C('#8a4a2a', '#4a4850'); g.beginPath(); g.ellipse(cx, h * 0.32, 56, 40, 0, Math.PI, TAU); g.fill(); eyesAt(0.42); break;
      case 'knight': body(C('#8a8aa0', '#706e78')); head(C('#c8c8d8', '#8a8892')); g.fillStyle = C('#a0a0b8', '#7a7882'); g.fillRect(cx - 48, h * 0.26, 96, 30); eyesAt(0.43); break;
      case 'candy': body(C('#5ad86a', '#686670')); head(C('#ff9ac8', '#a09ea8'), 0.42, 50); eyesAt(0.42); g.fillStyle = C('#fff', '#b0aeb8'); for (let i = 0; i < 6; i++) g.fillRect(cx - 40 + i * 14, h * 0.27, 6, 6); break;
      case 'bear': body(C('#8a5a3a', '#625e68')); head(C('#a8744a', '#7a7680'), 0.42, 52); for (const s of [-1, 1]) { g.beginPath(); g.arc(cx + s * 40, h * 0.29, 16, 0, TAU); g.fill(); } eyesAt(0.4, 18); break;
      case 'girl': {
        // Ноки a hundred years ago: pigtails, a guitar
        body(C('#4a3270', '#5e5c66')); head(C('#ece2f2', '#a4a2ac'), 0.4, 44);
        g.fillStyle = C('#2a1f30', '#3a3840'); g.beginPath(); g.ellipse(cx, h * 0.33, 48, 30, 0, Math.PI, TAU); g.fill();
        for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * 52, h * 0.47, 10, 30, s * 0.3, 0, TAU); g.fill(); }
        g.fillStyle = C('#b8283a', '#5a5860'); g.beginPath(); g.ellipse(cx + 40, h * 0.8, 30, 22, 0.5, 0, TAU); g.fill(); g.fillRect(cx + 10, h * 0.6, 8, 60);
        eyesAt(0.41, 15);
        break;
      }
      case 'netopyr': body(C('#2b2140', '#3e3c46')); head(C('#c4b2e6', '#8e8c96')); for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * 30, h * 0.34); g.lineTo(cx + s * 60, h * 0.22); g.lineTo(cx + s * 44, h * 0.42); g.fill(); } eyesAt(0.42); g.strokeStyle = '#d8d0a0'; g.lineWidth = 4; g.beginPath(); g.arc(cx + 16, h * 0.42, 14, 0, TAU); g.stroke(); break;
      case 'morok': body(C('#2a4a4a', '#4a4850')); head(C('#c8d8d0', '#92909a')); g.fillStyle = 'rgba(20,20,26,0.6)'; g.fillRect(cx - 50, h * 0.36, 100, 26); g.fillStyle = '#1a1a1e'; g.beginPath(); g.ellipse(cx + 54, h * 0.6, 18, 14, 0, 0, TAU); g.fill(); eyesAt(0.42); break;
      case 'shepot': g.fillStyle = 'rgba(200,200,220,0.25)'; g.beginPath(); g.ellipse(cx, h * 0.62, 70, 110, 0, 0, TAU); g.fill(); eyesAt(0.42); break;
      case 'twins': for (const s of [-1, 1]) { g.fillStyle = s < 0 ? C('#1c1c24', '#3a3842') : C('#8a5ac8', '#5a5862'); g.beginPath(); g.ellipse(cx + s * 50, h * 0.9, 46, 80, 0, Math.PI, TAU); g.fill(); g.fillStyle = C('#d8cce8', '#9e9ca6'); g.beginPath(); g.arc(cx + s * 50, h * 0.45, 30, 0, TAU); g.fill(); g.fillStyle = '#d8d8e0'; g.beginPath(); g.ellipse(cx + s * 50 + s * 10, h * 0.45, 7, 9, 0, 0, TAU); g.fill(); } break;
      case 'king': body('#1e1830'); head('#cfcfdb', 0.4, 46); g.fillStyle = '#e8e4f4'; g.beginPath(); g.arc(cx, h * 0.22, 26, Math.PI * 0.85, Math.PI * 2.15); g.arc(cx, h * 0.24, 19, Math.PI * 2.1, Math.PI * 0.9, true); g.fill(); eyesAt(0.4); g.fillStyle = '#c02040'; for (const s of [-1, 1]) { g.beginPath(); g.arc(cx + s * 16, h * 0.4, 4, 0, TAU); g.fill(); } break;
      case 'baker': body(C('#fffaf6', '#8e8c96')); head(C('#ffe8d8', '#a09ea8')); g.fillStyle = C('#ffffff', '#b8b6c0'); g.beginPath(); g.ellipse(cx, h * 0.24, 40, 26, 0, 0, TAU); g.fill(); eyesAt(0.43); break;
      case 'owl': body(C('#8a6a4a', '#66646e')); head(C('#a88a6a', '#7e7c86'), 0.42, 54); eyesAt(0.42, 22); break;
      case 'tailor': {
        // Финтифлюш the tailor: a striped waistcoat, a pointed nose, a tape measure round the neck, a pincushion
        body(C('#c84a6a', '#6a6872'));
        g.fillStyle = C('#ffd0e0', '#8a8892'); for (let i = -3; i <= 3; i++) g.fillRect(cx + i * 20 - 4, h * 0.66, 8, h * 0.3);
        head(C('#f0d8c8', '#a2a0aa'), 0.4, 42);
        g.fillStyle = C('#6a4a8a', '#4e4c56'); g.beginPath(); g.ellipse(cx, h * 0.3, 44, 18, 0, Math.PI, TAU); g.fill();
        g.fillStyle = C('#f0d8c8', '#a2a0aa'); g.beginPath(); g.moveTo(cx - 6, h * 0.43); g.lineTo(cx + 26, h * 0.47); g.lineTo(cx - 4, h * 0.49); g.fill();
        g.strokeStyle = C('#ffd84a', '#b8b6c0'); g.lineWidth = 10; g.beginPath(); g.moveTo(cx - 40, h * 0.56); g.quadraticCurveTo(cx, h * 0.66, cx + 40, h * 0.56); g.lineTo(cx + 34, h * 0.8); g.moveTo(cx - 40, h * 0.56); g.lineTo(cx - 30, h * 0.84); g.stroke();
        g.fillStyle = '#4a4850'; for (let i = 0; i < 6; i++) g.fillRect(cx - 36 + i * 13, h * 0.58 + Math.sin(i * 0.7) * 8, 2, 8);
        eyesAt(0.4, 15);
        break;
      }
      case 'frog': {
        // Морося, a frog in freckles (no veil yet)
        body(C('#5aa86a', '#66646e'));
        head(C('#7ad08a', '#8e8c96'), 0.46, 56);
        for (const s2 of [-1, 1]) { g.fillStyle = C('#7ad08a', '#8e8c96'); g.beginPath(); g.arc(cx + s2 * 30, h * 0.31, 22, 0, TAU); g.fill(); g.fillStyle = '#d8d8e0'; g.beginPath(); g.arc(cx + s2 * 30, h * 0.31, 12, 0, TAU); g.fill(); g.fillStyle = '#2a2830'; g.beginPath(); g.arc(cx + s2 * 30, h * 0.32, 5, 0, TAU); g.fill(); }
        g.fillStyle = C('#a86a3a', '#5e5c66'); for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(cx - 34 + (i % 3) * 8 + (i > 4 ? 52 : 0), h * 0.47 + Math.floor(i / 3) % 2 * 8, 3, 0, TAU); g.fill(); }
        g.strokeStyle = '#3a3840'; g.lineWidth = 4; g.beginPath(); g.arc(cx, h * 0.48, 28, 0.2, Math.PI - 0.2); g.stroke();
        g.fillStyle = C('#ff8ab8', '#8e8c96'); g.beginPath(); g.arc(cx + 40, h * 0.27, 10, 0, TAU); g.fill();
        break;
      }
      case 'eared': {
        // Шуршик, the gardener's pupil: huge ears, a watering can
        body(C('#5a8a4a', '#66646e'));
        for (const s2 of [-1, 1]) { g.fillStyle = C('#f0c8b0', '#9e9ca6'); g.beginPath(); g.ellipse(cx + s2 * 62, h * 0.36, 22, 40, s2 * 0.5, 0, TAU); g.fill(); g.fillStyle = C('#e8a090', '#86848e'); g.beginPath(); g.ellipse(cx + s2 * 62, h * 0.36, 11, 26, s2 * 0.5, 0, TAU); g.fill(); }
        head(C('#f0c8b0', '#9e9ca6'), 0.42, 42);
        g.fillStyle = C('#8a5a2a', '#4e4c56'); g.beginPath(); g.ellipse(cx, h * 0.32, 40, 18, 0, Math.PI, TAU); g.fill();
        eyesAt(0.42, 14);
        // the watering can
        g.fillStyle = C('#4a8ac8', '#76747e'); g.fillRect(cx + 20, h * 0.72, 56, 40); g.beginPath(); g.moveTo(cx + 74, h * 0.76); g.lineTo(cx + 108, h * 0.66); g.lineTo(cx + 108, h * 0.7); g.lineTo(cx + 76, h * 0.84); g.fill();
        g.strokeStyle = C('#4a8ac8', '#76747e'); g.lineWidth = 6; g.beginPath(); g.arc(cx + 48, h * 0.72, 18, Math.PI, TAU); g.stroke();
        break;
      }
      case 'sisters': {
        // the twin keepers of the stone, laughing face to face; the traffic-light stone between them
        for (const s2 of [-1, 1]) {
          g.fillStyle = s2 < 0 ? C('#6a4ab8', '#5a5862') : C('#c84a8a', '#66646e');
          g.beginPath(); g.ellipse(cx + s2 * 58, h * 0.94, 42, 76, 0, Math.PI, TAU); g.fill();
          g.fillStyle = C('#f0dcd0', '#9e9ca6'); g.beginPath(); g.arc(cx + s2 * 58, h * 0.5, 30, 0, TAU); g.fill();
          g.fillStyle = C('#3a2a4a', '#4a4850'); g.beginPath(); g.ellipse(cx + s2 * 58, h * 0.44, 32, 16, 0, Math.PI, TAU); g.fill();
          g.beginPath(); g.ellipse(cx + s2 * 84, h * 0.56, 7, 22, 0, 0, TAU); g.fill();
          g.fillStyle = '#d8d8e0'; g.beginPath(); g.ellipse(cx + s2 * 58 - s2 * 10, h * 0.49, 6, 8, 0, 0, TAU); g.fill();
          g.fillStyle = '#3a2830'; g.beginPath(); g.arc(cx + s2 * 58 - s2 * 8, h * 0.56, 9, 0, Math.PI); g.fill();
        }
        g.fillStyle = '#4a4850'; g.fillRect(cx - 14, h * 0.6, 28, 74);
        ['#e83a3a', '#ffd84a', '#5ad86a'].forEach((c, i) => { g.fillStyle = C(c, ['#8a8892', '#b0aeb8', '#9a98a2'][i]); g.beginPath(); g.arc(cx, h * 0.64 + i * 22, 9, 0, TAU); g.fill(); });
        break;
      }
    }
    // varnish cracks
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(Math.random() * w, Math.random() * h); g.lineTo(Math.random() * w, Math.random() * h); g.stroke(); }
  });
  PAINT_CACHE.set(key, t);
  return t;
}

/** a gilded frame with a painting (no eyes): w×h, depth 0.14, standing on its bottom edge at y = 0, facing +Z */
export function framedPainting(parent: THREE.Object3D, M: Mats, kind: PaintKind, w: number, h: number, gold = '#c8a040') {
  const g = grp(parent);
  const fm = M.get(gold);
  const t = 0.14;
  const box = cached('f5box', () => new THREE.BoxGeometry(1, 1, 1));
  part(g, box, fm, [0, h - t / 2, 0], [w, t, t * 1.6]);
  part(g, box, fm, [0, t / 2, 0], [w, t, t * 1.6]);
  part(g, box, fm, [-w / 2 + t / 2, h / 2, 0], [t, h, t * 1.6]);
  part(g, box, fm, [w / 2 - t / 2, h / 2, 0], [t, h, t * 1.6]);
  for (const [x, y] of [[-1, 1], [1, 1], [-1, 0], [1, 0]] as const) part(g, G.ball(), fm, [x * (w / 2 - t / 2), y ? h - t / 2 : t / 2, t * 0.8], 0.09, undefined, fo);
  const canvas = part(g, new THREE.PlaneGeometry(w - t * 2, h - t * 2), M.get('#ffffff', { map: paintingTex(kind) }), [0, h / 2, 0.01], 1, undefined, fo);
  return { g, canvas };
}

/** two 3D eyeballs that roll toward a point (portraits whose eyes follow you) */
export function eyePair(parent: THREE.Object3D, x: number, y: number, z: number, dx: number, r = 0.075, glowRed = false) {
  const white = basic('#e8e8f0'), pup = basic(glowRed ? '#ff2a3a' : '#1b1214');
  const balls: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const e = grp(parent, [x + s * dx, y, z]);
    const w = new THREE.Mesh(G.ball(), white); w.scale.set(r, r * 1.15, r * 0.6); e.add(w);
    const p = new THREE.Mesh(G.ball(), pup); p.scale.set(r * 0.45, r * 0.55, r * 0.3); p.position.z = r * 0.45; e.add(p);
    noOutline(e);
    balls.push(e);
  }
  const tmp = new THREE.Vector3(), inv = new THREE.Matrix4();
  return {
    balls,
    /** look at a world point (the pupils slide; the whites stay) */
    look(at: THREE.Vector3) {
      for (const b of balls) {
        const pupil = b.children[1] as THREE.Mesh;
        b.updateWorldMatrix(true, false);
        inv.copy(b.matrixWorld).invert();
        tmp.copy(at).applyMatrix4(inv).normalize();
        pupil.position.set(clamp(tmp.x, -0.75, 0.75) * r * 0.5, clamp(tmp.y, -0.75, 0.75) * r * 0.5, r * 0.45);
      }
    },
  };
}

// ───────────────────────── the living portrait ─────────────────────────
/** poses: hang wake fly aim drop stuck rise stun burn */
export function createPortrait(kind: PaintKind): VRig & { eyes: ReturnType<typeof eyePair> } {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'portrait';
  const pivot = grp(root, [0, 0.2, 0]);
  const W = 1.3, Hh = 1.7;
  const fr = framedPainting(pivot, M, kind, W, Hh, '#b8943a');
  fr.g.position.y = -Hh / 2;
  const holder = grp(pivot, [0, 0, 0]);
  holder.add(fr.g);
  const eyes = eyePair(fr.g, 0, Hh * (1 - 0.42) + 0.0, 0.05, 0.13, 0.08, true);
  // bat wings on the frame's sides
  const wingM = M.get('#3b2b52', { side: THREE.DoubleSide });
  const wings: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const pv = grp(fr.g, [s * W / 2, Hh * 0.75, -0.05]);
    const sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.quadraticCurveTo(0.4, 0.35, 0.9, 0.2); sh.quadraticCurveTo(0.75, -0.05, 0.62, -0.25); sh.quadraticCurveTo(0.45, -0.08, 0.3, -0.28); sh.quadraticCurveTo(0.15, -0.1, 0, -0.2); sh.lineTo(0, 0);
    const wm = new THREE.Mesh(new THREE.ShapeGeometry(sh, 8), wingM);
    wm.scale.set(s, 1, 1);
    pv.add(wm);
    wings.push(pv);
  }
  // grey arms reaching out of the canvas
  const armM = M.get('#9a98a2');
  const arms: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const a = grp(fr.g, [s * 0.28, Hh * 0.38, 0.05]);
    part(a, G.capsule(0.06, 0.4), armM, [0, 0, 0.25], 1, [Math.PI / 2, 0, 0]);
    part(a, G.sphere(), armM, [0, 0, 0.55], 0.09);
    arms.push(a);
  }
  const blinker = new Blinker();
  let t = Math.random() * 5, wingK = 0, armK = 0, tilt = 0;
  return {
    root, M, top: 1.2, eyes,
    update(dt, a: VAnim) {
      dt = Math.min(dt, 0.05); t += dt;
      let wantW = 1, wantA = 0, wantTilt = 0, bob = Math.sin(t * 3) * 0.08;
      switch (a.st) {
        case 'hang': wantW = 0; bob = 0; break;
        case 'wake': wantW = a.p; bob = Math.sin(t * 30) * 0.05 * (1 - a.p); break;
        case 'aim': wantA = 0.6 + 0.4 * a.p; wantTilt = -0.4 * a.p; bob = Math.sin(t * 22) * 0.04; break;
        case 'drop': wantA = 1; wantTilt = -Math.PI / 2; wantW = 0.3; break;
        case 'stuck': wantA = 0.2; wantTilt = -Math.PI / 2; wantW = 0; bob = 0; break;
        case 'rise': wantTilt = -Math.PI / 2 * (1 - a.p); wantW = a.p; break;
        case 'stun': wantW = 0.2; bob = 0; wantTilt = Math.sin(t * 8) * 0.3; break;
        case 'burn': wantW = 1; wantTilt = Math.sin(t * 30) * 0.1; break;
      }
      wingK = damp(wingK, wantW, 10, dt); armK = damp(armK, wantA, 12, dt);
      tilt = a.st === 'drop' || a.st === 'stuck' ? damp(tilt, wantTilt, a.st === 'drop' ? 18 : 30, dt) : damp(tilt, wantTilt, 8, dt);
      holder.rotation.x = -tilt; // (negative tilt = face down)
      holder.position.y = bob;
      const flap = Math.sin(t * 16) * 0.7 * wingK;
      wings[0].rotation.y = -0.2 - flap; wings[1].rotation.y = 0.2 + flap;
      for (const w of wings) w.scale.setScalar(Math.max(0.01, wingK));
      for (const [i, ar] of arms.entries()) { ar.scale.setScalar(Math.max(0.01, armK)); ar.rotation.x = -0.3 + Math.sin(t * 9 + i) * 0.25 * armK; }
      const bl = blinker.update(dt);
      for (const e of eyes.balls) e.scale.y = 1 - 0.9 * bl;
      M.flash(a.flash);
    },
  };
}

// ───────────────────────── the book-bat ─────────────────────────
/** poses: perch wake fly prep dive stun burn */
export function createBookBat(color: string): VRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'bookbat';
  const bob = grp(root, [0, 0.3, 0]);
  const cover = M.get(color), coverD = M.get(new THREE.Color(color).multiplyScalar(0.65));
  const paper = M.get('#f4e8c8'), gold = M.get('#d8b040');
  const box = cached('f5box', () => new THREE.BoxGeometry(1, 1, 1));
  const Lb = 0.46;
  part(bob, G.cyl(), coverD, [0, 0.02, 0], [0.05, Lb, 0.05], [Math.PI / 2, 0, 0]);
  part(bob, cached('f5wedge', () => new THREE.CylinderGeometry(0.15, 0.15, 0.4, 3, 1)), paper, [0, -0.075, 0], 1, [Math.PI / 2, 0, 0]);
  const wings: THREE.Group[] = [];
  const memM = M.get('#3a2240', { side: THREE.DoubleSide });
  for (const s of [1, -1]) {
    const pv = grp(bob, [s * 0.03, 0.03, 0]);
    part(pv, box, cover, [s * 0.18, 0, 0], [0.34, 0.03, Lb]);
    part(pv, box, paper, [s * 0.16, -0.025, 0], [0.3, 0.03, Lb - 0.05]);
    part(pv, box, gold, [s * 0.19, 0.017, 0], [0.14, 0.008, 0.2], undefined, fo);
    // a bat membrane past the cover's edge: the book has become a bat
    const sh = new THREE.Shape();
    sh.moveTo(0, -0.23); sh.lineTo(0, 0.23); sh.quadraticCurveTo(0.2, 0.18, 0.28, 0.06); sh.quadraticCurveTo(0.16, 0.02, 0.22, -0.08); sh.quadraticCurveTo(0.1, -0.1, 0.14, -0.22); sh.lineTo(0, -0.23);
    const mm = new THREE.Mesh(new THREE.ShapeGeometry(sh, 6), memM);
    mm.rotation.x = -Math.PI / 2; mm.position.set(s * 0.35, 0, 0); mm.scale.set(s, 1, 1);
    pv.add(mm);
    wings.push(pv);
  }
  // red eyes + fangs on the page edge
  const red = basic('#ff3040'), white = basic('#ffffff');
  const eyesW: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    eyesW.push(part(bob, G.ball(), basic('#fff6e0'), [s * 0.045, -0.05, 0.205], [0.035, 0.04, 0.012], undefined, fo));
    part(bob, G.ball(), red, [s * 0.042, -0.055, 0.215], [0.018, 0.022, 0.008], undefined, fo);
    part(bob, G.cone(), white, [s * 0.025, -0.13, 0.205], [0.012, 0.035, 0.012], [Math.PI, 0, 0], fo);
  }
  const blinker = new Blinker();
  let t = Math.random() * 5, open = 0;
  return {
    root, M, top: 0.6,
    update(dt, a: VAnim) {
      dt = Math.min(dt, 0.05); t += dt;
      let want = 0.6, rate = 15, pitch = 0;
      switch (a.st) {
        case 'perch': want = 0; rate = 0; break;
        case 'wake': want = a.p * 0.8; rate = 20; break;
        case 'prep': want = 0.5; rate = 26; pitch = 0.2; break;
        case 'dive': want = 0.25; rate = 0; pitch = 0.6; break;
        case 'stun': want = 0.2; rate = 5; break;
      }
      open = damp(open, want, 12, dt);
      const f = rate > 0 ? Math.sin(t * rate) * 0.6 * open : 0;
      const ang = 0.05 + open + f;
      wings[0].rotation.z = ang; wings[1].rotation.z = -ang;
      for (const w of wings) (w.children[w.children.length - 1] as THREE.Mesh).visible = open > 0.15;
      bob.rotation.x = pitch + (a.st === 'perch' ? Math.sin(t * 2) * 0.03 : 0);
      bob.rotation.z = a.st === 'stun' ? Math.sin(t * 9) * 0.4 : 0;
      bob.position.y = 0.3 - (rate ? Math.sin(t * rate) * 0.03 : 0);
      const bl = blinker.update(dt);
      for (const e of eyesW) e.scale.y = 0.04 * (1 - 0.9 * bl);
      M.flash(a.flash);
    },
  };
}

// ───────────────────────── the shadow imp (phase 3) ─────────────────────────
/** poses: spawn run claw stun burn */
export function createShade(): VRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'shade';
  const body = grp(root, [0, 0.5, 0]);
  const dark = M.get('#1a1228', { transparent: true, opacity: 0.88 });
  const rim = M.get('#4a2a6a', { transparent: true, opacity: 0.6 });
  part(body, G.sphere(), dark, [0, 0, 0], [0.34, 0.42, 0.32]);
  part(body, G.sphere(), rim, [0, -0.05, -0.04], [0.38, 0.4, 0.36]);
  // horns, wispy tail
  for (const s of [1, -1]) part(body, G.cone(), dark, [s * 0.16, 0.38, 0], [0.06, 0.2, 0.06], [0, 0, s * -0.4]);
  const tail = part(body, G.cone(), dark, [0, -0.45, -0.1], [0.22, 0.4, 0.22], [Math.PI, 0, 0]);
  const eyes: THREE.Mesh[] = [];
  for (const s of [1, -1]) eyes.push(part(body, G.ball(), basic('#ff3a4a'), [s * 0.11, 0.08, 0.27], [0.06, 0.04, 0.02], undefined, fo));
  const mouth = part(body, G.ball(), basic('#ff6a7a'), [0, -0.08, 0.29], [0.08, 0.02, 0.01], undefined, fo);
  const arms: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const a = grp(body, [s * 0.3, 0.02, 0.05]);
    part(a, G.capsule(0.04, 0.22), dark, [0, -0.12, 0.05]);
    for (let i = -1; i <= 1; i++) part(a, G.cone(), basic('#e8d8ff'), [i * 0.025, -0.28, 0.1], [0.012, 0.05, 0.012], [Math.PI + 0.4, 0, 0], fo);
    arms.push(a);
  }
  let t = Math.random() * 5, walk = 0;
  return {
    root, M, top: 1.0,
    update(dt, a: VAnim) {
      dt = Math.min(dt, 0.05); t += dt;
      walk += dt * clamp(a.speed, 0, 8) * 2.5;
      const sw = Math.sin(walk);
      body.position.y = 0.5 + Math.abs(sw) * 0.08 + Math.sin(t * 4) * 0.03;
      body.rotation.x = a.st === 'claw' ? 0.5 * Math.sin(a.p * Math.PI) : clamp(a.speed * 0.05, 0, 0.3);
      body.rotation.z = a.st === 'stun' ? Math.sin(t * 9) * 0.4 : sw * 0.1;
      arms[0].rotation.x = a.st === 'claw' ? -2.2 * Math.sin(a.p * Math.PI) : sw * 0.8;
      arms[1].rotation.x = a.st === 'claw' ? -2.2 * Math.sin(a.p * Math.PI) : -sw * 0.8;
      tail.rotation.z = Math.sin(t * 6) * 0.4;
      const sc = a.st === 'spawn' ? Math.max(0.05, a.p) : 1;
      body.scale.setScalar(sc);
      for (const e of eyes) e.scale.y = a.st === 'stun' ? 0.01 : 0.04;
      mouth.scale.y = a.st === 'claw' ? 0.06 : 0.02;
      M.flash(a.flash);
    },
  };
}

// ───────────────────────── the five little bats (stairs, §9.2.3) ─────────────────────────
export type MouseKind = 'netopyr' | 'morok' | 'shepot' | 'nochka' | 'tenka';
export interface MouseAnim { talk: number; hop: number; squeak: number }
export function createMouse(kind: MouseKind): Rig<MouseAnim> {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'mouse-' + kind;
  const fur = kind === 'tenka' ? '#6a4a8a' : kind === 'nochka' ? '#2a2236' : kind === 'shepot' ? '#7a7a92' : kind === 'morok' ? '#3a4a4a' : '#4a3266';
  const body = grp(root, [0, 0.22, 0]);
  const furM = M.get(fur);
  part(body, G.sphere(), furM, [0, 0, 0], [0.16, 0.15, 0.15]);
  part(body, G.sphere(), M.get(new THREE.Color(fur).lerp(new THREE.Color('#ffffff'), 0.25)), [0, -0.03, 0.07], [0.1, 0.09, 0.08]);
  const earS = kind === 'shepot' ? 1.7 : 1;
  for (const s of [1, -1]) part(body, G.cone(), furM, [s * 0.08, 0.16, -0.01], [0.05 * earS, 0.13 * earS, 0.03], [0, 0, s * -0.35]);
  const white = basic('#fff6e0'), red = basic('#d0202e');
  for (const s of [1, -1]) {
    part(body, G.ball(), white, [s * 0.05, 0.03, 0.13], [0.038, 0.045, 0.02], undefined, fo);
    const look = kind === 'nochka' ? -0.012 : kind === 'tenka' ? 0.012 : 0;
    part(body, G.ball(), red, [s * 0.05 + look, 0.025, 0.145], [0.017, 0.021, 0.01], undefined, fo);
  }
  const mouth = part(body, G.ball(), basic('#4a0f1c'), [0, -0.05, 0.14], [0.03, 0.01, 0.01], undefined, fo);
  for (const s of [1, -1]) part(body, G.cone(), basic('#ffffff'), [s * 0.015, -0.065, 0.142], [0.008, 0.02, 0.008], [Math.PI, 0, 0], fo);
  // wings spread wide («раскинули крылышки»)
  const mem = M.get(new THREE.Color(fur).multiplyScalar(1.15), { side: THREE.DoubleSide });
  const wings: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const pv = grp(body, [s * 0.12, 0.02, 0]);
    const sh = new THREE.Shape();
    sh.moveTo(0, 0.05); sh.quadraticCurveTo(0.2, 0.2, 0.4, 0.12); sh.quadraticCurveTo(0.34, -0.05, 0.3, -0.14); sh.quadraticCurveTo(0.22, -0.05, 0.15, -0.14); sh.quadraticCurveTo(0.08, -0.04, 0, -0.08); sh.lineTo(0, 0.05);
    const wm = new THREE.Mesh(new THREE.ShapeGeometry(sh, 6), mem); wm.scale.set(s, 1, 1); pv.add(wm);
    wings.push(pv);
  }
  // who is who
  if (kind === 'netopyr') {
    const ring = new THREE.Mesh(G.torus(0.035, 0.006, 6, 18), basic('#ffd34a')); ring.position.set(0.05, 0.03, 0.155); body.add(ring);
    const cape = part(body, G.cone(), M.get('#b8213a', { side: THREE.DoubleSide }), [0, -0.05, -0.1], [0.14, 0.2, 0.06], [0.3, 0, 0]); void cape;
  } else if (kind === 'morok') {
    part(body, G.dome(), M.get('#1a2a2a', { transparent: true, opacity: 0.6 }), [0, 0.04, 0.02], [0.17, 0.12, 0.16]);
    const crow = grp(body, [0.12, 0.16, -0.02]);
    part(crow, G.sphere(), M.get('#141418'), [0, 0, 0], [0.05, 0.05, 0.06]);
    part(crow, G.cone(), basic('#e8b040'), [0, 0, 0.06], [0.015, 0.04, 0.015], [Math.PI / 2, 0, 0], fo);
  } else if (kind === 'shepot') {
    part(body, G.cone(), M.get('#2a2a3a', { side: THREE.DoubleSide }), [0, -0.1, -0.02], [0.3, 0.36, 0.28]);
  } else {
    const bow = M.get(kind === 'nochka' ? '#111018' : '#c88aff');
    for (const s of [1, -1]) part(body, G.cone(), bow, [s * 0.05, 0.15, 0.04], [0.04, 0.06, 0.025], [0, 0, s * Math.PI / 2]);
    part(body, G.cone(), M.get(kind === 'nochka' ? '#1c1828' : '#8a5ac8'), [0, -0.16, 0], [0.16, 0.14, 0.14], [Math.PI, 0, 0]);
  }
  let t = Math.random() * 5;
  return {
    root,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      const f = Math.sin(t * (12 + a.squeak * 14)) * (0.35 + a.squeak * 0.3);
      wings[0].rotation.y = -0.1 - f * 0.5; wings[1].rotation.y = 0.1 + f * 0.5;
      wings[0].rotation.z = 0.2 + f * 0.3; wings[1].rotation.z = -0.2 - f * 0.3;
      body.position.y = 0.22 + Math.abs(Math.sin(t * 8)) * 0.05 * a.hop;
      mouth.scale.y = 0.01 + a.talk * 0.03;
    },
  };
}
