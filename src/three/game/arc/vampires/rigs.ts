import * as THREE from 'three';
import { basic, noOutline } from '../../../gfx';
import { G, Mats, TAU, clamp, damp, grp, part, cached, lerp, smooth, seg, easeOut, easeIn, taperedTube, surf } from '../../../models/kit';
import { buildToonFace, type ToonFace } from '../../../models/toonFace';
import type { HeroExpr } from '../../../models/hero';
import { glowTex } from '../../../world/textures';
import { glintSprite, MistBody } from './vfx';
import type { VAnim, VRig } from './models';

/**
 * The vampires of «Ночь клыков» as A Hat in Time / Spyro-style cartoon rigs (feet at y = 0, facing +Z, 1 ≈ the hero):
 *   Клыкарь (fanger)     — a hunched little count: huge bat ears, slicked widow's peak, a scalloped cape that really
 *                          flares (deformed every frame), high collar, claws; sneaks, crouches with the cape spread, lunges.
 *   Нетопырь (bat)       — a fuzzball with big ears, fur tufts and two-part membrane wings (arm + hand, wrist fold) on an
 *                          eased flap cycle (fast downstroke, folding upstroke); banks and pitches with its flight.
 *   Летучий клыкарь      — a winged imp: mohawk, talons, spade tail, big wings; rears back to aim, tucks to dive.
 *   Туманник (mist)      — a top-hatted mist magician with a cane: his legs are a swirling mist column; as mist only
 *                          the hat and two cold eyes drift inside the cloud.
 *   Невидимка-слуга      — a lanky, droopy-eyed butler in a tailcoat balancing a candle tray.
 *   Упырь-громила        — a massive brute: tiny head, Popeye forearms, studded collar, torn vest, tusks.
 * Faces are the shared toon face (real eyelids, slit pupils, an open mouth with teeth and fangs); eyes carry additive
 * red-moon glints that flare on every wind-up. Every attack is anticipation → strike → recovery from (st, p); a hit
 * (the flash's rising edge) plays a recoil on every machine; `die` is the pose of the death poof.
 */

const fo = { cast: false };
const nf = { cast: false, receive: false };
const SKIN = '#c4b2e6';
const SKIN_D = '#a893cf';
const CAPE = '#2b2140';
const CAPE_IN = '#b8213a';
const HAIR = '#1d1630';
const RED_EYE = '#ff3040';

// ───────────────────────── shared bits ─────────────────────────
/** flash rising edge → a 1..0 recoil envelope (works from replicated flash on clients too) */
class HitReact {
  k = 0; private last = 0;
  update(dt: number, flash: number) {
    if (flash > 0.85 && this.last <= 0.85) this.k = 1;
    this.last = flash;
    this.k = Math.max(0, this.k - dt * 3.4);
    return this.k;
  }
}

interface VFaceOpts {
  R: number; center?: [number, number, number];
  eyeYaw: number; eyePitch: number; eyeW: number; eyeH: number;
  iris?: string; lidMat: THREE.Material; lidRest?: number; brow: string; browThick?: number;
  mouthPitch: number; mouthW: number; rest?: 'smile' | 'smirk'; glint?: string; glintSize?: number; nose?: { mat: THREE.Material; w: number; h?: number; pitch?: number };
  eyeTilt?: number; fangPeek?: boolean;
}
/** the toon face with vampire defaults: slit red eyes, sly lids, fangs (a pair peeks under the closed mouth), eye glints */
function vface(head: THREE.Object3D, M: Mats, o: VFaceOpts) {
  const face: ToonFace = buildToonFace(head, M, {
    R: o.R, center: o.center, eyeYaw: o.eyeYaw, eyePitch: o.eyePitch, eyeW: o.eyeW, eyeH: o.eyeH, eyeD: 0.5, eyeTilt: o.eyeTilt ?? 0.12,
    iris: o.iris ?? RED_EYE, irisDark: '#5a0010', pupil: '#120608', irisSize: 0.68, slit: true,
    lidMat: o.lidMat, lidRest: o.lidRest ?? 0.3, lash: '#160c18', brow: o.brow, browThick: o.browThick, browLift: 1.5,
    mouthPitch: o.mouthPitch, mouthW: o.mouthW, rest: o.rest ?? 'smirk', fangs: 2, mouthColor: '#4a0a1c', tongueColor: '#e8607e', nose: o.nose,
  });
  // two little fangs peeking under the closed mouth (the face shows its own fangs only when it opens)
  const peek = grp(surf(head, 0, o.mouthPitch, o.R * 0.975, o.center ?? [0, 0, 0]));
  const tooth = basic('#fffaf4');
  tooth.polygonOffset = true; tooth.polygonOffsetFactor = -4; tooth.polygonOffsetUnits = -16;
  const mw = o.mouthW;
  for (const s of [1, -1]) noOutline(part(peek, G.cone(), tooth, [s * mw * 0.4, -mw * 0.17, mw * 0.14], [mw * 0.12, mw * 0.3, mw * 0.08], [Math.PI, 0, 0], fo));
  peek.visible = o.fangPeek !== false;
  // red-moon glints over the eyes (flare on wind-ups)
  const glints: THREE.Sprite[] = [];
  for (const s of [1, -1]) {
    const a = surf(head, s * o.eyeYaw, o.eyePitch, o.R * 1.0 + o.eyeW * 0.6, o.center ?? [0, 0, 0]);
    const g = glintSprite(o.glint ?? '#ff4a5a', o.glintSize ?? o.eyeW * 6, 0);
    g.position.set(s * o.eyeW * 0.2, o.eyeH * 0.15, 0);
    a.add(g); glints.push(g);
  }
  let gl = 0, t = Math.random() * 9, ping = 0;
  return {
    face, glints,
    update(dt: number, ex: HeroExpr, glow: number, talk = 0, look: { x: number; y: number } | null = null) {
      t += dt;
      if (glow > 0.62 && gl <= 0.62) ping = 1;
      ping = Math.max(0, ping - dt * 3);
      gl = damp(gl, glow, 14, dt);
      const open = ex === 'angry' || ex === 'surprised' || ex === 'scared' || ex === 'hurt' || ex === 'happy' || talk > 0.05;
      peek.visible = o.fangPeek !== false && !open;
      face.update(dt, ex, talk, { look });
      const tw = 0.85 + 0.15 * Math.sin(t * 23);
      for (const g of glints) {
        const a = clamp(gl * tw + ping * 0.8);
        g.material.opacity = a;
        g.visible = a > 0.02;
        g.scale.setScalar((o.glintSize ?? o.eyeW * 6) * (0.5 + 0.6 * gl + ping * 0.9));
        g.material.rotation = ping * 1.2 + t * 0.4;
      }
    },
  };
}

/** a big pointed bat ear (outer skin + inner pink) on a pivot */
function batEar(parent: THREE.Object3D, M: Mats, at: [number, number, number], s: number, size: number, outer: string, inner: string, tilt = 0.5) {
  const pv = grp(parent, at, [0, s * -0.25, s * -tilt]);
  const geo = cached('vamp-ear', () => {
    const sh = new THREE.Shape();
    sh.moveTo(-0.5, 0); sh.quadraticCurveTo(-0.55, 0.55, -0.05, 1.0); sh.quadraticCurveTo(0.1, 0.62, 0.5, 0.42);
    sh.quadraticCurveTo(0.42, 0.2, 0.5, 0); sh.lineTo(-0.5, 0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2, curveSegments: 10 });
    g.translate(0, 0, -0.06);
    return g;
  });
  part(pv, geo, M.get(outer), [0, 0, 0], [size * 0.62, size, size * 0.35]);
  part(pv, geo, M.get(inner), [0, size * 0.1, size * 0.045], [size * 0.42, size * 0.72, size * 0.12], undefined, fo);
  return pv;
}

/** a tapered, curved claw (cone-ish tube) */
function clawGeo() {
  return cached('vamp-claw', () => taperedTube(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.6, 0.15), new THREE.Vector3(0, -1, 0.55)), 8, 6, (t) => 0.22 * (1 - t) + 0.01, false));
}
/** a clawed hand: a palm ball + n claws (pointing down/forward) */
function claws(parent: THREE.Object3D, M: Mats, skin: string, nail: string, r: number, n = 3, len = 1) {
  part(parent, G.sphere(), M.get(skin), [0, 0, 0], [r, r * 0.9, r]);
  const nm = M.get(nail);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * r * 0.62;
    part(parent, clawGeo(), nm, [x, -r * 0.55, r * 0.45], [r * 0.6 * len, r * 1.6 * len, r * 0.6 * len], [0.2, 0, x * -2], fo);
  }
}

/** fur tufts (little cones) around a sphere band */
function tufts(parent: THREE.Object3D, M: Mats, color: string, n: number, R: number, y: number, len: number, tilt: number, a0 = 0, a1 = TAU) {
  const m = M.get(color);
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * ((i + 0.5) / n);
    const p = part(parent, G.cone(), m, [Math.sin(a) * R, y + ((i * 7) % 3) * 0.01, Math.cos(a) * R], [len * 0.35, len, len * 0.35], undefined, fo);
    p.rotation.set(Math.cos(a) * tilt, 0, -Math.sin(a) * tilt);
  }
}

// ───────────────────────── a deforming cape ─────────────────────────
/**
 * A cape hanging from the shoulders around the back (opening in front, scalloped bat-wing hem), dark outside and red
 * inside; deformed each frame: flare (spreads up and out like wings), stream (blown back by speed), ripples.
 */
class Cape {
  geo: THREE.BufferGeometry;
  private base: Float32Array; private vv: Float32Array; private ph: Float32Array; private rr: Float32Array;
  private pos: THREE.BufferAttribute;
  private t = Math.random() * 10;
  constructor(parent: THREE.Object3D, M: Mats, private o: { r0: number; r1: number; h: number; gap0: number; gap1: number; cols?: number; rows?: number; scallops?: number; out: string; inn: string; zs?: number }) {
    const cols = o.cols ?? 22, rows = o.rows ?? 9, sc = o.scallops ?? 5;
    const n = (cols + 1) * rows;
    const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    this.base = new Float32Array(n * 3); this.vv = new Float32Array(n); this.ph = new Float32Array(n); this.rr = new Float32Array(n);
    for (let i = 0; i < rows; i++) {
      const v = i / (rows - 1);
      const r = o.r0 + (o.r1 - o.r0) * Math.pow(v, 0.75);
      const gap = o.gap0 + (o.gap1 - o.gap0) * v;
      for (let j = 0; j <= cols; j++) {
        const phi = gap + (TAU - 2 * gap) * (j / cols);
        const k = i * (cols + 1) + j;
        // scalloped hem: points hanging between the "fingers"
        const hem = -0.13 * o.h * Math.pow(Math.abs(Math.sin(((phi - gap) / (TAU - 2 * gap)) * Math.PI * sc)), 0.7) * Math.pow(v, 5);
        const y = -v * o.h + hem;
        this.base[k * 3] = r * Math.sin(phi); this.base[k * 3 + 1] = y; this.base[k * 3 + 2] = r * Math.cos(phi) * (o.zs ?? 0.85);
        this.vv[k] = v; this.ph[k] = phi; this.rr[k] = r;
        uv[k * 2] = j / cols; uv[k * 2 + 1] = 1 - v;
      }
    }
    pos.set(this.base);
    const idx: number[] = [];
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols; j++) { const a = i * (cols + 1) + j, b = a + 1, d = a + cols + 1, e = d + 1; idx.push(a, d, b, b, d, e); }
    const g = this.geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeVertexNormals();
    part(parent, g, M.get(o.out, { side: THREE.FrontSide }));
    part(parent, g, M.get(o.inn, { side: THREE.BackSide }), undefined, undefined, undefined, fo);
  }
  update(dt: number, flare: number, stream: number, sway = 0, lift = 0) {
    this.t += dt;
    const o = this.o, p = this.pos.array as Float32Array, zs = o.zs ?? 0.85;
    for (let k = 0; k < this.vv.length; k++) {
      const v = this.vv[k], phi0 = this.ph[k];
      const side = Math.abs(Math.sin(phi0));
      const fl = flare * Math.pow(v, 1.15);
      // the front opening widens as it flares (shows the lining)
      const phi = Math.PI + (phi0 - Math.PI) * (1 - 0.18 * fl);
      let r = this.rr[k] * (1 + fl * (0.5 + 1.6 * side)) + Math.sin(phi0 * 3 + this.t * 5 - v * 3) * 0.035 * v * (0.35 + stream + flare);
      r += Math.sin(phi0 * 2 - this.t * 3.1 + v * 2) * 0.012 * v;
      const y = this.base[k * 3 + 1] + fl * 0.55 * o.h * v * side + stream * 0.3 * o.h * v * v + lift * v * v * o.h * 0.4;
      const back = -stream * 0.75 * o.h * v * v;
      p[k * 3] = r * Math.sin(phi) + sway * v * v * 0.25;
      p[k * 3 + 1] = y;
      p[k * 3 + 2] = r * Math.cos(phi) * zs + back;
    }
    this.pos.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }
}

// ───────────────────────── a two-part bat wing ─────────────────────────
function wingShapes() {
  return cached('vamp-wing2-in', () => {
    // inner membrane: shoulder (0,0) → wrist (1,0.05); trailing edge back to the flank (shape y = +Z = leading edge)
    const s = new THREE.Shape();
    s.moveTo(0, 0.06); s.quadraticCurveTo(0.5, 0.16, 1.0, 0.06);
    s.lineTo(1.0, -0.05); s.quadraticCurveTo(0.95, -0.45, 0.82, -0.78);
    s.quadraticCurveTo(0.55, -0.5, 0.3, -0.62);
    s.quadraticCurveTo(0.15, -0.35, 0, -0.42); s.lineTo(0, 0.06);
    const g = new THREE.ShapeGeometry(s, 12); g.rotateX(Math.PI / 2); g.scale(1, 1, -1);
    return g;
  });
}
function wingOuter() {
  return cached('vamp-wing2-out', () => {
    // outer (hand) membrane from the wrist (0,0): three finger tips, scallops between, inner edge meets the inner wing
    const s = new THREE.Shape();
    s.moveTo(0, 0.06);
    s.quadraticCurveTo(0.5, 0.2, 1.15, 0.05);          // leading finger
    s.quadraticCurveTo(0.85, -0.12, 0.98, -0.42);      // → finger 2 tip
    s.quadraticCurveTo(0.68, -0.38, 0.62, -0.78);      // → finger 3 tip
    s.quadraticCurveTo(0.35, -0.55, -0.18, -0.78);     // → back to the inner trailing tip
    s.quadraticCurveTo(-0.06, -0.35, 0, -0.05); s.lineTo(0, 0.06);
    const g = new THREE.ShapeGeometry(s, 12); g.rotateX(Math.PI / 2); g.scale(1, 1, -1);
    return g;
  });
}
/**
 * Two bat wings (right = +X, left mirrored): shoulder pivot (flap about the body's forward axis, sweep back) → arm
 * membrane → wrist pivot (flex, fold) → hand membrane with finger bones. set(flap, wrist, fold, sweep).
 */
function batWings(parent: THREE.Object3D, M: Mats, span: number, mem: string, bone: string, at: [number, number, number]) {
  const memM = M.get(mem, { side: THREE.DoubleSide }), boneM = M.get(bone);
  const arm = span * 0.42, hand = span * 0.5;
  const sides: { sh: THREE.Group; wr: THREE.Group; s: number }[] = [];
  for (const s of [1, -1]) {
    const root = grp(parent, [s * at[0], at[1], at[2]]);
    root.scale.x = s;
    const sh = grp(root); sh.rotation.order = 'ZYX';
    const inner = part(sh, wingShapes(), memM, [0, 0, 0], [arm, 1, arm]);
    inner.castShadow = true;
    part(sh, G.capsule(0.018, 1), boneM, [arm * 0.5, 0.004, arm * 0.06], [span * 0.9, arm, span * 0.9], [0, 0, Math.PI / 2], fo);
    const wr = grp(sh, [arm, 0, 0]); wr.rotation.order = 'ZYX';
    const outer = part(wr, wingOuter(), memM, [0, 0, 0], [hand, 1, hand]);
    outer.castShadow = true;
    // finger bones: wrist → each tip
    for (const [tx, tz] of [[1.15, 0.05], [0.98, -0.42], [0.62, -0.78]] as const) {
      const len = Math.hypot(tx, tz) * hand;
      const b = part(wr, G.capsule(0.012, 1), boneM, [tx * hand * 0.5, 0.005, -tz * hand * 0.5], [span * 0.7, len, span * 0.7], [0, 0, 0], fo);
      b.rotation.set(0, Math.atan2(-tz, tx), Math.PI / 2, 'YXZ');
    }
    // a little thumb claw at the wrist
    part(wr, G.cone(), boneM, [0.01, 0.02, span * 0.05], [0.015 * span * 3, 0.05 * span, 0.015 * span * 3], [-1.2, 0, 0], fo);
    sides.push({ sh, wr, s });
  }
  return {
    /** flap: + = tips up; wrist: + = hand bends up; fold 0..1: hand folds back onto the arm; sweep: + = swept back */
    set(flap: number, wrist: number, fold: number, sweep = 0, asym = 0) {
      for (const w of sides) {
        w.sh.rotation.set(0, sweep + fold * 0.45, flap + asym * w.s);
        w.wr.rotation.set(0, fold * 2.3, wrist - fold * 0.25);
        w.wr.scale.set(1 - fold * 0.25, 1, 1 - fold * 0.1);
      }
    },
  };
}
/** an eased flap cycle: phase 0..1 → shoulder angle (fast downstroke, slower upstroke) and a lagging wrist */
function flapCurve(ph: number, up: number, down: number) {
  const d = 0.42; // downstroke share
  const a = ph < d ? lerp(up, down, smooth(ph / d)) : lerp(down, up, smooth((ph - d) / (1 - d)));
  const lag = (ph + 0.88) % 1;
  const w = lag < d ? lerp(0.5, -0.45, smooth(lag / d)) : lerp(-0.45, 0.5, smooth((lag - d) / (1 - d)));
  const fold = ph > d ? Math.sin(((ph - d) / (1 - d)) * Math.PI) * 0.32 : 0;
  return { a, w, fold, down: ph < d ? Math.sin((ph / d) * Math.PI) : 0 };
}

// ═════════════════════════════ КЛЫКАРЬ (fanger) ═════════════════════════════
/** poses: idle walk crouch lunge recover hiss stun burn die */
export function createFanger(): VRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'fanger';
  const base = grp(root);
  const skin = M.get(SKIN), skinD = M.get(SKIN_D), coat = M.get('#3a2d58'), pants = M.get('#33284a'), shoe = M.get('#17111f');
  // legs: thigh → shin → pointy curled shoe
  const legs: { th: THREE.Group; sh: THREE.Group }[] = [];
  for (const s of [1, -1]) {
    const th = grp(base, [s * 0.09, 0.3, 0]);
    part(th, G.capsule(0.05, 0.1), pants, [0, -0.08, 0]);
    const sh = grp(th, [0, -0.15, 0]);
    part(sh, G.capsule(0.042, 0.08), pants, [0, -0.06, 0]);
    part(sh, G.sphere(), shoe, [0, -0.13, 0.04], [0.06, 0.045, 0.11]);
    part(sh, G.cone(), shoe, [0, -0.11, 0.16], [0.028, 0.09, 0.028], [Math.PI / 2 - 0.6, 0, 0], fo);
    legs.push({ th, sh });
  }
  const body = grp(base, [0, 0.3, 0]);
  const torso = grp(body);
  part(torso, G.sphere(), coat, [0, 0.16, -0.01], [0.2, 0.22, 0.18]);
  part(torso, G.sphere(), M.get('#efe6f4'), [0, 0.19, 0.1], [0.09, 0.15, 0.09]);
  part(torso, G.sphere(), M.get(CAPE_IN), [0, 0.13, 0.115], [0.085, 0.08, 0.07], undefined, fo); // waistcoat
  for (let i = 0; i < 2; i++) part(torso, G.ball(), M.get('#ffd34a'), [0, 0.17 - i * 0.06, 0.185 - i * 0.004], 0.014, undefined, fo);
  for (const s of [1, -1]) part(torso, G.cone(), M.get(CAPE_IN), [s * 0.035, 0.32, 0.165], [0.035, 0.055, 0.025], [0, 0, s * Math.PI / 2], fo);
  part(torso, G.ball(), M.get(CAPE_IN), [0, 0.32, 0.17], 0.02, undefined, fo);
  // a medallion
  part(torso, G.torus(0.035, 0.008, 6, 16), M.get('#ffd34a'), [0, 0.24, 0.17], 1, [0.2, 0, 0], fo);
  part(torso, G.ball(), M.get('#ff3040'), [0, 0.24, 0.175], 0.022, undefined, fo);
  // cape from the shoulders
  const capeG = grp(torso, [0, 0.36, -0.02]);
  const cape = new Cape(capeG, M, { r0: 0.15, r1: 0.36, h: 0.6, gap0: 0.85, gap1: 0.55, out: CAPE, inn: CAPE_IN, zs: 0.9, scallops: 5 });
  // high pointed collar
  const collarGeo = cached('vamp-collar', () => {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.quadraticCurveTo(0.6, 0.15, 1, 1); sh.quadraticCurveTo(0.45, 0.62, 0, 0.62); sh.lineTo(0, 0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 8 });
    return g;
  });
  for (const s of [1, -1]) {
    const c = part(torso, collarGeo, M.get(CAPE_IN, { side: THREE.DoubleSide }), [s * 0.04, 0.33, -0.08], [s * 0.2, 0.26, 0.5], [-0.35, s * -0.5, 0]);
    c.castShadow = false;
  }
  // arms: shoulder → elbow → clawed hand
  const arms: { sh: THREE.Group; el: THREE.Group; hand: THREE.Group }[] = [];
  for (const s of [1, -1]) {
    const sh = grp(torso, [s * 0.19, 0.28, 0]);
    part(sh, G.capsule(0.04, 0.08), coat, [0, -0.06, 0]);
    const el = grp(sh, [0, -0.13, 0]);
    part(el, G.capsule(0.036, 0.07), coat, [0, -0.05, 0]);
    part(el, G.torus(0.04, 0.012, 6, 12), M.get('#efe6f4'), [0, -0.1, 0], 1, [Math.PI / 2, 0, 0], fo); // cuff
    const hand = grp(el, [0, -0.14, 0.01]);
    claws(hand, M, SKIN, '#efe8f8', 0.045, 3, 1.2);
    arms.push({ sh, el, hand });
  }
  // head
  const head = grp(torso, [0, 0.55, 0.03]);
  const R = 0.23;
  part(head, G.sphere(), skin, [0, 0, 0], [R, R * 0.96, R * 0.95]);
  part(head, G.sphere(), skin, [0, -0.1, 0.04], [0.14, 0.11, 0.15]); // pointed chin
  const ears = [batEar(head, M, [0.19, 0.05, -0.02], 1, 0.24, SKIN_D, '#e88aa8', 1.0), batEar(head, M, [-0.19, 0.05, -0.02], -1, 0.24, SKIN_D, '#e88aa8', 1.0)];
  for (const [i, e] of ears.entries()) e.scale.x = i === 0 ? 1 : -1;
  // slicked hair + widow's peak + a back curl
  part(head, G.dome(), M.get(HAIR), [0, 0.02, -0.02], [R * 1.04, R * 0.95, R * 1.0], [-0.3, 0, 0]);
  part(head, G.cone(), M.get(HAIR), [0, 0.13, 0.17], [0.07, 0.13, 0.03], [Math.PI + 0.45, 0, 0], fo);
  for (const s of [1, -1]) part(head, G.sphere(), M.get(HAIR), [s * 0.12, 0.12, 0.12], [0.08, 0.04, 0.06], [0, 0, s * 0.4], fo);
  part(head, G.torus(0.05, 0.016, 6, 12, ), M.get(HAIR), [0, 0.06, -0.22], 1, [0.4, 0, 0], fo);
  const F = vface(head, M, { R, eyeYaw: 0.37, eyePitch: 0.1, eyeW: 0.072, eyeH: 0.08, lidMat: skin, lidRest: 0.32, brow: HAIR, browThick: 0.02, mouthPitch: -0.36, mouthW: 0.075, nose: { mat: skinD, w: 0.03, h: 0.028, pitch: -0.08 }, glintSize: 0.32 });
  const hit = new HitReact();
  let t = Math.random() * 5, walk = 0, lean = 0, crouch = 0, flare = 0, stream = 0, armF = 0, armUp = 0, look = 0, rub = 0, glow = 0, bodyRoll = 0;
  return {
    root, M, top: 1.08,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      const sp = clamp(a.speed, 0, 12);
      walk += dt * clamp(a.speed, 0, 6) * 2.6;
      const moving = a.speed > 0.3 && a.st !== 'lunge';
      const sw = moving ? Math.sin(walk) : 0;
      const hk = hit.update(dt, a.flash);
      let wCrouch = 0.08, wLean = 0.22, wFlare = 0, wStream = clamp(sp / 8), wArmF = 0.3, wArmUp = 0, ex: HeroExpr = 'normal', wGlow = 0.12, elbow = 0.9, wRub = 1, wLook = Math.sin(t * 0.6) * 0.35 * (Math.sin(t * 0.23) > 0.3 ? 1 : 0), spread = 0;
      switch (a.st) {
        case 'walk': wCrouch = 0.18; wLean = 0.38; wArmF = 0.9; elbow = 0.6; wRub = 0; wLook = 0; break;
        case 'crouch': {
          const k = easeOut(seg(a.p, 0, 0.6));
          wCrouch = 0.25 + 0.4 * k; wLean = 0.2 + 0.3 * k; wFlare = 0.95 * k + Math.sin(t * 40) * 0.04 * seg(a.p, 0.7, 1); wArmF = -0.4; wArmUp = 1.4 * k; elbow = 1.3; ex = 'angry'; wGlow = 0.35 + 0.65 * a.p; wRub = 0; wLook = 0; spread = k;
          break;
        }
        case 'lunge': wCrouch = 0.05; wLean = 1.1; wFlare = 0.25; wStream = 1.2; wArmF = 1.7; wArmUp = 0.2; elbow = 0.1; ex = 'angry'; wGlow = 1; wRub = 0; wLook = 0; spread = 0.4; break;
        case 'recover': wCrouch = 0.12 + 0.1 * (1 - a.p); wLean = lerp(-0.25, 0.3, a.p); wArmF = -0.2; elbow = 0.3; ex = a.p < 0.45 ? 'hurt' : 'sleepy'; wRub = 0; wLook = Math.sin(t * 8) * 0.25 * (1 - a.p); break;
        case 'hiss': wLean = -0.25; wArmUp = 2.0; wArmF = 0.4; wFlare = 0.8 + Math.sin(t * 9) * 0.08; ex = 'angry'; wGlow = 0.6; wRub = 0; elbow = 0.5; spread = 1; break;
        case 'stun': wLean = 0.1 + Math.sin(t * 7) * 0.15; wArmF = Math.sin(t * 5) * 0.5; elbow = 0.4; ex = 'hurt'; wRub = 0; wLook = Math.sin(t * 6) * 0.5; break;
        case 'burn': wLean = -0.2; wArmUp = 2.2 + Math.sin(t * 28) * 0.3; wFlare = 0.6; ex = 'scared'; wRub = 0; elbow = 0.3; wLook = Math.sin(t * 17) * 0.4; break;
        case 'die': wLean = -0.3; wArmUp = 1.6; wFlare = 1; ex = 'hurt'; wRub = 0; break;
      }
      // hit recoil: snapped back, cape whipped, eyes shut
      if (hk > 0) { wLean -= 0.7 * hk; wArmUp += 0.8 * hk; wFlare = Math.max(wFlare, 0.6 * hk); if (hk > 0.25) ex = 'hurt'; }
      lean = damp(lean, wLean, a.st === 'lunge' ? 22 : 13, dt); crouch = damp(crouch, wCrouch, 16, dt);
      flare = damp(flare, wFlare, wFlare > flare ? 14 : 5, dt); stream = damp(stream, wStream, 6, dt);
      armF = damp(armF, wArmF, 14, dt); armUp = damp(armUp, wArmUp, 14, dt); look = damp(look, wLook, 4, dt); rub = damp(rub, wRub, 6, dt);
      glow = damp(glow, wGlow, 12, dt);
      bodyRoll = damp(bodyRoll, sw * 0.1, 10, dt);
      // body
      const breath = Math.sin(t * 2.4);
      body.position.y = 0.3 - crouch * 0.16 + Math.abs(sw) * 0.035 + breath * 0.006;
      body.rotation.set(lean, 0, bodyRoll);
      torso.scale.set(1 + breath * 0.012, 1 - breath * 0.01, 1 + breath * 0.012);
      base.scale.set(1 + crouch * 0.12, 1 - crouch * 0.08, 1 + crouch * 0.12);
      // legs (bent knees, tiptoe sneaking)
      const lunging = a.st === 'lunge';
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        const ph = sw * s;
        const thigh = lunging ? (i === 0 ? -0.9 : 0.9) : -crouch * 1.5 + ph * 0.75 - lean * 0.6;
        const knee = lunging ? (i === 0 ? 1.0 : 0.2) : crouch * 2.4 + Math.max(0, -Math.cos(walk + (i ? Math.PI : 0))) * 0.9 * (moving ? 1 : 0);
        legs[i].th.rotation.set(thigh, 0, 0);
        legs[i].sh.rotation.set(knee, 0, 0);
      }
      // arms: rubbing hands while idle (scheming), claws forward while sneaking, raised behind the spread cape
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        const ar = arms[i];
        const swing = moving && !lunging && a.st === 'walk' ? -sw * s * 0.25 : 0;
        const rubK = rub * Math.sin(t * 9 + i * Math.PI) * 0.12;
        ar.sh.rotation.set(-armF - swing - rub * 0.5 + rubK, 0, s * (0.15 + armUp * 0.55 + spread * 0.3) - rub * s * 0.45);
        ar.el.rotation.set(-elbow - rub * 0.9, 0, 0);
        ar.hand.rotation.set(armUp > 0.8 ? -0.6 : 0.2, 0, 0);
      }
      head.rotation.set(-lean * 0.55 + (a.st === 'crouch' ? -0.15 : 0) + hk * 0.3, look, Math.sin(t * 1.3) * 0.04 + (a.st === 'stun' ? Math.sin(t * 6) * 0.2 : 0));
      ears[0].rotation.z = -1.0 + Math.sin(t * 3.1) * 0.04 - flare * 0.25 + hk * 0.4; ears[1].rotation.z = 1.0 - Math.sin(t * 3.1 + 1) * 0.04 + flare * 0.25 - hk * 0.4;
      cape.update(dt, flare, stream, bodyRoll * 2, crouch * 0.5);
      F.update(dt, ex, glow);
      M.flash(a.flash);
    },
  };
}

// ═════════════════════════════ НЕТОПЫРЬ (bat) ═════════════════════════════
/** poses: fly screech prep dive swoop orbit stun perch hang burn die; anim.bank / pitch tilt it with its flight */
export function createBat(): VRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'bat';
  const tilt = grp(root, [0, 0.2, 0]); tilt.rotation.order = 'YXZ';
  const bob = grp(tilt);
  const fur = M.get('#3b2b52'), furL = M.get('#6a5490'), furD = M.get('#2a1d3c');
  const R = 0.135;
  part(bob, G.sphere(), fur, [0, 0, 0], [R, R * 0.95, R * 0.92]);
  part(bob, G.sphere(), furL, [0, -0.035, 0.05], [0.09, 0.08, 0.08]);
  // fur: a fluffy collar, a tuft on top, a fuzzy rump
  tufts(bob, M, '#4a3866', 9, 0.1, 0.055, 0.06, 1.1, -2.2, 2.2);
  for (let i = -1; i <= 1; i++) part(bob, G.cone(), fur, [i * 0.025, 0.13, 0.02 - Math.abs(i) * 0.01], [0.022, 0.07, 0.022], [0.3, 0, i * 0.5], fo);
  tufts(bob, M, '#2f2244', 6, 0.1, -0.08, 0.05, 2.2, Math.PI - 1, Math.PI + 1);
  const ears = [batEar(bob, M, [0.07, 0.09, -0.01], 1, 0.15, '#3b2b52', '#e88aa8', 0.45), batEar(bob, M, [-0.07, 0.09, -0.01], -1, 0.15, '#3b2b52', '#e88aa8', 0.45)];
  ears[1].scale.x = -1;
  const F = vface(bob, M, { R: R * 0.95, center: [0, 0.0, 0], eyeYaw: 0.4, eyePitch: 0.18, eyeW: 0.042, eyeH: 0.048, lidMat: fur, lidRest: 0.18, brow: '#1a1028', browThick: 0.012, mouthPitch: -0.25, mouthW: 0.045, rest: 'smile', nose: { mat: M.get('#e88aa8'), w: 0.02, h: 0.016, pitch: -0.05 }, glintSize: 0.2 });
  const W = batWings(bob, M, 0.46, '#4b3566', '#241830', [0.1, 0.02, -0.01]);
  // little feet + a tail membrane
  const feet: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const f = grp(bob, [s * 0.04, -0.1, -0.04]);
    part(f, G.capsule(0.012, 0.04), furD, [0, -0.025, 0]);
    for (let i = -1; i <= 1; i++) part(f, G.cone(), M.get('#d8cbe8'), [i * 0.008, -0.058, 0.008], [0.006, 0.02, 0.006], [Math.PI - 0.4, 0, 0], fo);
    feet.push(f);
  }
  const tail = part(bob, cached('vamp-battail', () => { const s = new THREE.Shape(); s.moveTo(-0.5, 0); s.quadraticCurveTo(0, -0.2, 0.5, 0); s.lineTo(0, -1); s.lineTo(-0.5, 0); const g = new THREE.ShapeGeometry(s, 6); g.rotateX(Math.PI / 2); return g; }), M.get('#4b3566', { side: THREE.DoubleSide }), [0, -0.08, -0.08], [0.1, 1, 0.09], [0.6, 0, 0], fo);
  const hit = new HitReact();
  let t = Math.random() * 5, ph = Math.random(), rate = 3.4, bank = 0, pitch = 0, glow = 0, tuck = 0, glide = 0, spread = 0, hang = 0;
  return {
    root, M, top: 0.45,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      const hk = hit.update(dt, a.flash);
      let wRate = 3.3 + clamp(a.speed / 6, 0, 1) * 0.6, up = 0.95, down = -0.75, wTuck = 0, wGlide = 0, wSpread = 0, ex: HeroExpr = 'normal', wGlow = 0.15, wPitch = clamp(a.pitch ?? 0, -1.1, 1.1), wHang = 0;
      switch (a.st) {
        case 'screech': wRate = 6.2; up = 1.15; down = -0.5; ex = 'angry'; wGlow = 0.9; wPitch = -0.35; wSpread = 1; break;
        case 'prep': wRate = 2.2 + a.p * 1.5; up = 1.2; down = -0.2; ex = 'angry'; wGlow = 0.5 + 0.5 * a.p; wPitch = -0.45 * easeOut(a.p); wSpread = 1; break;
        case 'dive': wTuck = 0.92; ex = 'angry'; wGlow = 1; break;
        case 'swoop': wGlide = 1 - seg(a.p, 0.45, 0.8); wRate = 4.6; up = 1.1; down = -0.85; ex = 'normal'; wGlow = 0.4; break;
        case 'stun': wRate = 1.6; up = 0.5; down = -0.3; ex = 'hurt'; break;
        case 'burn': wRate = 7; up = 1.2; down = -0.9; ex = 'scared'; break;
        case 'perch': wTuck = 0.6; wRate = 0; ex = 'sleepy'; break;
        case 'hang': wHang = 1; wRate = 0; ex = 'sleepy'; break;
        case 'die': wRate = 9; ex = 'hurt'; break;
      }
      rate = damp(rate, wRate, 6, dt);
      tuck = damp(tuck, wTuck, wTuck > tuck ? 16 : 7, dt);
      glide = damp(glide, wGlide, 8, dt);
      spread = damp(spread, wSpread, 10, dt);
      hang = damp(hang, wHang, 8, dt);
      glow = damp(glow, wGlow, 10, dt);
      ph = (ph + dt * rate) % 1;
      const fc = flapCurve(ph, up, down);
      const flapK = (1 - tuck) * (1 - glide) * (rate > 0.05 ? 1 : 0);
      // gliding: wings held out, a slight tremble; tucked: swept back along the body
      let fl = fc.a * flapK + glide * (0.12 + Math.sin(t * 23) * 0.025) - tuck * 0.15 + hang * -1.2;
      let wr = fc.w * flapK + glide * 0.12 + (a.st === 'perch' ? -1.2 : 0);
      const fold = Math.max(fc.fold * flapK, tuck, hang);
      if (spread > 0.01) { fl = lerp(fl, fl * 0.8 + 0.2, spread * 0.4); wr = lerp(wr, 0.25, spread * 0.5); }
      if (hk > 0) { fl += hk * 0.9; wr += hk * 0.4; }
      W.set(fl, wr, fold, tuck * 0.9 + glide * 0.05, 0);
      // body: lift on the downstroke, squash with the stroke
      bob.position.y = (fc.down * 0.035 - 0.012) * flapK;
      bob.scale.set(1 + fc.down * 0.05 * flapK, 1 - fc.down * 0.06 * flapK, 1);
      // flight attitude: bank into turns, pitch with the climb / dive
      bank = damp(bank, clamp(a.bank ?? 0, -1, 1) * 0.9, 8, dt);
      pitch = damp(pitch, wPitch + tuck * 0.35, 9, dt);
      tilt.rotation.set(pitch + hk * -0.6, 0, -bank + (a.st === 'stun' ? Math.sin(t * 9) * 0.45 : 0) + hang * Math.PI);
      tilt.position.y = 0.2 + hang * 0.12;
      for (const [i, f] of feet.entries()) f.rotation.x = 0.6 + tuck * 0.7 + Math.sin(t * 4 + i) * 0.1 - hang * 0.6;
      tail.rotation.x = 0.6 + tuck * 0.5 - fc.down * 0.2;
      ears[0].rotation.z = -0.45 - tuck * 0.5 + Math.sin(t * 5) * 0.05; ears[1].rotation.z = 0.45 + tuck * 0.5 - Math.sin(t * 5 + 1) * 0.05;
      F.update(dt, hk > 0.25 ? 'hurt' : ex, glow);
      M.flash(a.flash);
    },
  };
}

// ═════════════════════════════ ЛЕТУЧИЙ КЛЫКАРЬ (flyer) ═════════════════════════════
/** poses: fly aim dive ground rise stun burn die; anim.bank / pitch tilt it */
export function createFlyer(): VRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'flyer';
  const tilt = grp(root, [0, 0.5, 0]); tilt.rotation.order = 'YXZ';
  const body = grp(tilt);
  const skin = M.get('#b7a2dc'), dark = M.get('#2f2347'), skinD = M.get('#9b86c4');
  part(body, G.sphere(), dark, [0, -0.02, 0], [0.2, 0.25, 0.18]);
  part(body, G.sphere(), M.get('#d8cbe8'), [0, 0.0, 0.09], [0.11, 0.17, 0.1]);
  tufts(body, M, '#d8cbe8', 7, 0.13, 0.16, 0.06, 1.0, -1.1, 1.1);
  // spade tail
  const tail = grp(body, [0, -0.16, -0.14]);
  part(tail, taperedTube(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.25, -0.15), new THREE.Vector3(0, -0.2, -0.38)), 10, 6, (u) => 0.03 * (1 - u * 0.6), false), dark);
  part(tail, G.cone(), M.get(CAPE_IN), [0, -0.2, -0.42], [0.06, 0.1, 0.02], [-Math.PI / 2 - 0.3, 0, 0]);
  const head = grp(body, [0, 0.33, 0.03]);
  const R = 0.19;
  part(head, G.sphere(), skin, [0, 0, 0], [R, R * 0.95, R * 0.95]);
  const ears = [batEar(head, M, [0.15, 0.08, -0.02], 1, 0.22, '#9b86c4', '#e88aa8', 0.7), batEar(head, M, [-0.15, 0.08, -0.02], -1, 0.22, '#9b86c4', '#e88aa8', 0.7)];
  ears[1].scale.x = -1;
  // mohawk
  for (let i = 0; i < 4; i++) part(head, G.cone(), M.get(HAIR), [0, 0.17 - i * 0.01, 0.08 - i * 0.07], [0.035, 0.11 - i * 0.012, 0.05], [-0.4 - i * 0.25, 0, 0], fo);
  const F = vface(head, M, { R, eyeYaw: 0.38, eyePitch: 0.08, eyeW: 0.058, eyeH: 0.065, lidMat: skin, lidRest: 0.28, brow: HAIR, browThick: 0.018, mouthPitch: -0.36, mouthW: 0.065, nose: { mat: skinD, w: 0.024 }, glintSize: 0.3 });
  const W = batWings(body, M, 1.0, '#3d2b5c', '#1e1630', [0.13, 0.14, -0.06]);
  // legs with talons
  const legs: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const l = grp(body, [s * 0.08, -0.2, 0]);
    part(l, G.capsule(0.032, 0.1), dark, [0, -0.07, 0]);
    const foot = grp(l, [0, -0.15, 0.02]);
    claws(foot, M, '#2f2347', '#e6dcf4', 0.04, 3, 1.3);
    legs.push(l);
  }
  const hit = new HitReact();
  let t = Math.random() * 5, ph = Math.random(), rate = 2.3, pitch = 0, bank = 0, tuck = 0, glow = 0, rear = 0, sprawl = 0, legK = 0;
  return {
    root, M, top: 1.12,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      const hk = hit.update(dt, a.flash);
      let wRate = 2.2 + clamp(a.speed / 8, 0, 1) * 0.6, up = 0.85, down = -0.6, wTuck = 0, ex: HeroExpr = 'normal', wGlow = 0.15, wPitch = clamp(a.pitch ?? 0, -1, 1) * 0.8, wRear = 0, wSprawl = 0, wLeg = 0.3;
      switch (a.st) {
        case 'aim': wRate = 1.5; up = 1.15; down = -0.2; wRear = easeOut(a.p); ex = 'angry'; wGlow = 0.4 + 0.6 * a.p; wPitch = -0.55 * wRear; wLeg = 1; break;
        case 'dive': wTuck = 0.95; wPitch = 1.15; ex = 'angry'; wGlow = 1; wLeg = 1.4; break;
        case 'ground': wRate = 0; wSprawl = 1; ex = 'hurt'; wPitch = 0; break;
        case 'rise': wRate = 3.8; up = 1.2; down = -0.9; ex = 'normal'; break;
        case 'stun': wRate = 1.2; up = 0.4; down = -0.25; ex = 'hurt'; break;
        case 'burn': wRate = 5; up = 1.2; down = -0.9; ex = 'scared'; break;
        case 'die': wSprawl = 0.5; ex = 'hurt'; break;
      }
      rate = damp(rate, wRate, 5, dt);
      tuck = damp(tuck, wTuck, wTuck > tuck ? 14 : 6, dt);
      rear = damp(rear, wRear, 9, dt); sprawl = damp(sprawl, wSprawl, 12, dt); legK = damp(legK, wLeg, 8, dt);
      glow = damp(glow, wGlow, 10, dt);
      ph = (ph + dt * rate) % 1;
      const fc = flapCurve(ph, up, down);
      const flapK = (1 - tuck) * (1 - sprawl) * clamp(rate * 2);
      let fl = fc.a * flapK - tuck * 0.2 + sprawl * -0.25 + rear * 0.35 * (1 - flapK);
      let wr = fc.w * flapK + sprawl * -0.2;
      if (a.st === 'aim') { fl = lerp(fl, 0.9 + Math.sin(t * 30) * 0.03 * a.p, rear * 0.6); wr = lerp(wr, 0.4, rear * 0.6); }
      if (hk > 0) fl += hk * 0.7;
      W.set(fl, wr, Math.max(fc.fold * flapK, tuck), tuck * 0.9, 0);
      bank = damp(bank, clamp(a.bank ?? 0, -1, 1) * 0.75, 6, dt);
      pitch = damp(pitch, wPitch, 8, dt);
      const lie = sprawl * 1.35;
      tilt.rotation.set(pitch + lie + hk * -0.5, 0, -bank + (a.st === 'stun' || a.st === 'ground' ? Math.sin(t * 5) * 0.12 : 0));
      tilt.position.y = 0.5 - sprawl * 0.3 + fc.down * 0.04 * flapK + Math.sin(t * 1.7) * 0.02;
      body.scale.set(1 + fc.down * 0.04 * flapK, 1 - fc.down * 0.05 * flapK, 1);
      for (const [i, l] of legs.entries()) l.rotation.x = legK * 0.7 - lie * 0.3 + Math.sin(t * 3 + i) * 0.12 * (1 - legK);
      tail.rotation.x = Math.sin(t * 2.4) * 0.25 - tuck * 0.4;
      tail.rotation.y = Math.sin(t * 1.7) * 0.3;
      head.rotation.set(-pitch * 0.5 - rear * 0.2 + hk * 0.3, 0, a.st === 'ground' ? Math.sin(t * 3) * 0.2 : 0);
      ears[0].rotation.z = -0.7 - tuck * 0.5; ears[1].rotation.z = 0.7 + tuck * 0.5;
      F.update(dt, hk > 0.25 ? 'hurt' : ex, glow);
      M.flash(a.flash);
    },
  };
}

// ═════════════════════════════ ТУМАННИК (mist) ═════════════════════════════
/** poses: idle walk mist form claw recover stun burn die; `cloud` = his mist; `claw` = the swiping hand (for trails) */
export function createMistling(): VRig & { body: THREE.Group; cloud: THREE.Group; eyesGlow: THREE.Group; claw: THREE.Object3D; hat: THREE.Group } {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'mistling';
  const coatC = '#4f5b80', face = M.get('#dde2f2'), coat = M.get(coatC), dark = M.get('#1d2236');
  const hover = grp(root);
  const body = grp(hover);
  // coat: chest + a ragged skirt that frays into the mist
  part(body, G.sphere(), coat, [0, 0.88, -0.01], [0.21, 0.25, 0.17]);
  part(body, G.sphere(), M.get('#2c3350'), [0, 0.84, 0.08], [0.11, 0.2, 0.1], undefined, fo); // waistcoat
  for (let i = 0; i < 3; i++) part(body, G.ball(), M.get('#c9b25a'), [0, 0.92 - i * 0.08, 0.175 - i * 0.008], 0.018, undefined, fo);
  const skirtG = grp(body, [0, 0.72, 0]);
  const skirt = new Cape(skirtG, M, { r0: 0.19, r1: 0.3, h: 0.36, gap0: 0.22, gap1: 0.5, out: coatC, inn: '#262c44', zs: 0.9, scallops: 7, cols: 24, rows: 7 });
  // cravat with a glowing gem
  for (let i = 0; i < 3; i++) part(body, G.sphere(), M.get('#f2f4ff'), [0, 1.07 - i * 0.045, 0.15 - i * 0.004], [0.06 - i * 0.008, 0.035, 0.03], undefined, fo);
  part(body, G.ball(), basic('#7ae0ff'), [0, 1.08, 0.19], 0.025, undefined, fo);
  const gemGlow = glintSprite('#7ae0ff', 0.22, 0.7); gemGlow.position.set(0, 1.08, 0.21); body.add(gemGlow);
  // high collar behind the head
  part(body, cached('mist-collar', () => new THREE.CylinderGeometry(0.16, 0.12, 0.2, 18, 1, true, Math.PI * 0.55, Math.PI * 0.9)), M.get('#3a4466', { side: THREE.DoubleSide }), [0, 1.13, -0.02]);
  // arms
  const arms: { sh: THREE.Group; el: THREE.Group; hand: THREE.Group }[] = [];
  for (const s of [1, -1]) {
    const sh = grp(body, [s * 0.21, 1.02, 0]);
    part(sh, G.capsule(0.048, 0.12), coat, [0, -0.08, 0]);
    const el = grp(sh, [0, -0.18, 0]);
    part(el, G.capsule(0.044, 0.1), coat, [0, -0.06, 0]);
    part(el, G.cone(), coat, [0, -0.15, 0], [0.07, 0.08, 0.07], [Math.PI, 0, 0], fo); // flared cuff
    const hand = grp(el, [0, -0.2, 0.01]);
    claws(hand, M, '#f2f4ff', '#9aa6d0', 0.048, 4, s > 0 ? 0.8 : 1.6);
    arms.push({ sh, el, hand });
  }
  // a magician's cane in the right hand
  const cane = grp(arms[0].hand, [0, -0.02, 0.04]);
  part(cane, G.cyl(), dark, [0, -0.2, 0], [0.014, 0.5, 0.014]);
  part(cane, G.cyl(), M.get('#c9b25a'), [0, -0.46, 0], [0.018, 0.03, 0.018], undefined, fo);
  part(cane, G.ball(), basic('#9ae8ff', { transparent: true, opacity: 0.85 }), [0, 0.07, 0], 0.045, undefined, fo);
  const caneGlow = glintSprite('#7ae0ff', 0.3, 0.6); caneGlow.position.y = 0.07; cane.add(caneGlow);
  // head + hat
  const head = grp(body, [0, 1.25, 0.02]);
  const R = 0.17;
  part(head, G.sphere(), face, [0, 0, 0], [R, R * 1.08, R * 0.98]);
  for (const s of [1, -1]) part(head, G.cone(), M.get('#c3cae4'), [s * 0.16, 0.02, -0.02], [0.035, 0.1, 0.02], [0, 0, s * -1.2]);
  // curly moustache
  const mous = cached('mist-moustache', () => taperedTube(new THREE.CubicBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.06, -0.01, 0.01), new THREE.Vector3(0.12, -0.03, 0), new THREE.Vector3(0.11, 0.03, -0.01)), 14, 6, (u) => 0.016 * (1 - u * 0.75), false));
  for (const s of [1, -1]) part(head, mous, dark, [s * 0.005, -0.06, 0.16], [s, 1, 1], undefined, fo);
  const F = vface(head, M, { R, eyeYaw: 0.36, eyePitch: 0.12, eyeW: 0.052, eyeH: 0.06, iris: '#5ad0ff', lidMat: face, lidRest: 0.4, brow: '#1d2236', browThick: 0.016, mouthPitch: -0.5, mouthW: 0.06, nose: { mat: M.get('#c3cae4'), w: 0.026, h: 0.03, pitch: -0.12 }, glint: '#7ae0ff', glintSize: 0.26 });
  const hat = grp(head, [0, 0.15, -0.01]);
  const hatIn = grp(hat, undefined, [0.06, 0, 0.1]);
  part(hatIn, G.cyl(), dark, [0, 0.02, 0], [0.24, 0.022, 0.22]);
  part(hatIn, cached('mist-hat', () => new THREE.CylinderGeometry(0.15, 0.13, 0.36, 22)), dark, [0, 0.2, 0]);
  part(hatIn, G.cyl(), M.get('#6d2b4a'), [0, 0.07, 0], [0.135, 0.05, 0.135], undefined, fo);
  part(hatIn, G.cyl(), dark, [0, 0.385, 0], [0.152, 0.01, 0.152], undefined, fo);
  // a tiny bat badge on the band
  const badge = grp(hatIn, [0, 0.075, 0.135]);
  part(badge, G.ball(), M.get('#c9b25a'), [0, 0, 0], [0.02, 0.016, 0.01], undefined, fo);
  for (const s of [1, -1]) part(badge, G.cone(), M.get('#c9b25a'), [s * 0.03, 0.004, 0], [0.012, 0.035, 0.006], [0, 0, s * -1.3], fo);
  // mist: the legs (always) + the cloud in mist form
  const legsMist = new MistBody(hover, 26, ['#d4dcf8', '#7f89bc']);
  const cloud = grp(root);
  const cloudMist = new MistBody(cloud, 44, ['#dfe6ff', '#8a94c6']);
  const eyesGlow = grp(root, [0, 0.95, 0.22]);
  for (const s of [1, -1]) {
    part(eyesGlow, G.ball(), basic('#7ae0ff', { additive: true, depthWrite: false }), [s * 0.08, 0, 0], [0.05, 0.03, 0.02], [0, 0, s * -0.25], nf);
    const gg = glintSprite('#7ae0ff', 0.3, 0.8); gg.position.set(s * 0.08, 0, 0.02); eyesGlow.add(gg);
  }
  noOutline(eyesGlow);
  eyesGlow.visible = false;
  // the claw's tip (trail emitter)
  const claw = grp(arms[1].hand, [0, -0.1, 0.06]);
  const hit = new HitReact();
  let t = Math.random() * 5, lean = 0, armF = 0, armUp = 0, mistK = 0, formK = 1, twirl = 0, tip = 0, glow = 0, sway = 0, swipe = 0;
  const hatHome = hat.position.clone();
  return {
    root, M, top: 1.62, body, cloud, eyesGlow, claw, hat,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      const hk = hit.update(dt, a.flash);
      const sp = clamp(a.speed, 0, 10);
      const isMist = a.st === 'mist', isForm = a.st === 'form';
      // 0 = solid … 1 = all mist
      const wMist = isMist ? 1 : isForm ? 1 - easeIn(seg(a.p, 0.15, 0.85)) : a.st === 'die' ? a.p : 0;
      mistK = damp(mistK, wMist, isMist ? 9 : 14, dt);
      formK = 1 - mistK;
      body.visible = formK > 0.04;
      // solid body grows out of the mist with a twist (squash & stretch)
      const fs = smooth(formK);
      body.scale.set(lerp(0.4, 1, fs) * (1 + (1 - fs) * 0.2), lerp(0.15, 1, fs), lerp(0.4, 1, fs));
      body.rotation.y = (1 - fs) * 4.5;
      let wLean = 0.05, wArmF = 0.2, wArmUp = 0, ex: HeroExpr = 'normal', wGlow = 0.15, wTwirl = 1, wTip = 0, wSwipe = 0, elbowL = 0.5, elbowR = 1.3;
      if (Math.sin(t * 0.37) > 0.92) wTip = 1; // tips his hat now and then
      switch (a.st) {
        case 'walk': wLean = 0.25 + sp * 0.03; wArmF = 0.1; wTwirl = 0; break;
        case 'form': wArmUp = 1.3; wArmF = -0.3; ex = 'angry'; wGlow = 0.4 + 0.6 * a.p; wTwirl = 0; elbowL = 1.1; break;
        case 'claw': {
          const k = a.p < 0.3 ? -easeOut(a.p / 0.3) : easeOut(seg(a.p, 0.3, 0.7));
          wSwipe = k; wLean = 0.3 + 0.25 * Math.max(0, k); ex = 'angry'; wGlow = 1; wTwirl = 0; elbowL = 0.25;
          break;
        }
        case 'recover': wLean = -0.1 + 0.2 * a.p; wArmF = -0.2; ex = a.p < 0.5 ? 'surprised' : 'normal'; wTwirl = 0; elbowL = 0.2; break;
        case 'burn': wLean = -0.25; wArmUp = 1.8 + Math.sin(t * 25) * 0.2; ex = 'scared'; wTwirl = 0; break;
        case 'stun': wLean = Math.sin(t * 6) * 0.2; ex = 'hurt'; wTwirl = 0; break;
        case 'mist': wTwirl = 0; break;
      }
      if (hk > 0) { wLean -= 0.6 * hk; wArmUp += 0.6 * hk; if (hk > 0.25) ex = 'hurt'; }
      lean = damp(lean, wLean, 10, dt); armF = damp(armF, wArmF, 12, dt); armUp = damp(armUp, wArmUp, 12, dt);
      twirl = damp(twirl, wTwirl, 4, dt); tip = damp(tip, wTip, 6, dt); glow = damp(glow, wGlow, 10, dt);
      swipe = damp(swipe, wSwipe, a.st === 'claw' ? 30 : 10, dt);
      sway = damp(sway, Math.sin(t * 1.1) * 0.06, 3, dt);
      // floating: no legs, a slow bob
      hover.position.y = Math.sin(t * 2.1) * 0.035 + 0.02;
      body.rotation.x = lean;
      body.rotation.z = sway;
      // arms: right twirls the cane, left (claw) swipes across
      const R0 = arms[0], L0 = arms[1];
      R0.sh.rotation.set(-0.4 - armF - armUp * 0.4 + Math.sin(t * 3) * 0.05 * twirl, 0, 0.2 + armUp * 0.6);
      R0.el.rotation.set(-elbowR + Math.sin(t * 2.5) * 0.1 * twirl, 0, 0);
      R0.hand.rotation.set(0, t * 7 * twirl, 0);
      const sw = swipe;
      L0.sh.rotation.set(-armF - armUp * 0.4 - 1.3 * Math.abs(sw) - (sw > 0 ? 0.3 : 0), sw * -1.1, -0.2 - armUp * 0.6 - (sw < 0 ? -sw * 0.9 : 0));
      L0.el.rotation.set(-elbowL - (sw < 0 ? 0.6 * -sw : 0), 0, 0);
      L0.hand.rotation.set(-0.3, 0, sw * 0.5);
      head.rotation.set(-lean * 0.5 + hk * 0.3, Math.sin(t * 0.7) * 0.25 * twirl, -sway * 0.6);
      hat.position.set(hatHome.x, hatHome.y + tip * 0.08, hatHome.z);
      hat.rotation.set(-tip * 0.5, 0, 0);
      gemGlow.material.opacity = 0.5 + 0.3 * Math.sin(t * 4);
      caneGlow.material.opacity = 0.4 + 0.3 * Math.sin(t * 5 + 1) + glow * 0.3;
      skirt.update(dt, 0.15 + Math.sin(t * 2) * 0.05, clamp(sp / 4) * 0.8, sway * 2, 0);
      // mist legs: stream down from under the coat, bending behind when he glides
      legsMist.density = formK;
      legsMist.update(dt, { top: 0.62, bottom: -0.02, r0: 0.17, r1: 0.42, size0: 0.32, size1: 0.6, speed: 0.55 + sp * 0.06, swirl: 0.9, alpha: 0.78, trailZ: sp * 1.2, wobble: 0.05 });
      // the cloud: a big swirl (converging while he forms)
      cloud.visible = mistK > 0.02;
      if (cloud.visible) {
        const conv = isForm ? seg(a.p, 0, 1) : 0;
        cloudMist.density = mistK;
        cloudMist.update(dt, { top: 1.3 - conv * 0.4, bottom: 0.05, r0: 0.45 * (1 - conv * 0.6), r1: 0.55 * (1 - conv * 0.5), size0: 0.55, size1: 0.75, speed: -0.45 - conv * 0.6, swirl: 1.4 + conv * 2, alpha: 0.82, trailZ: sp * 1.4, inward: conv, wobble: 0.1 });
      }
      // as mist: the hat and two cold eyes drift inside the cloud
      eyesGlow.visible = mistK > 0.3;
      eyesGlow.position.y = 0.95 + Math.sin(t * 2.3) * 0.06;
      eyesGlow.scale.setScalar(isForm ? 0.8 + a.p * 0.6 : 1);
      if (mistK > 0.5 && hat.parent !== root) { root.add(hat); }
      else if (mistK <= 0.5 && hat.parent !== head) { head.add(hat); }
      if (hat.parent === root) {
        hat.position.set(Math.sin(t * 1.3) * 0.05, 1.28 + Math.sin(t * 2.3) * 0.06, 0);
        hat.rotation.set(Math.sin(t * 1.7) * 0.15, t * 0.8, Math.sin(t * 1.1) * 0.12);
      }
      F.update(dt, ex, glow);
      M.flash(a.flash);
    },
  };
}

// ═════════════════════════════ НЕВИДИМКА-СЛУГА (servant) ═════════════════════════════
/** poses: idle walk windup slap retreat stun burn die */
export function createServant(): VRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'servant';
  const base = grp(root);
  const coat = M.get('#262033'), shirt = M.get('#f2eee6'), skinC = '#a9bba8', skin = M.get(skinC), skinD = M.get('#8aa08a'), glove = M.get('#ffffff'), shoe = M.get('#121018');
  const legs: { th: THREE.Group; sh: THREE.Group }[] = [];
  for (const s of [1, -1]) {
    const th = grp(base, [s * 0.075, 0.58, 0]);
    part(th, G.capsule(0.038, 0.22), coat, [0, -0.13, 0]);
    const sh = grp(th, [0, -0.28, 0]);
    part(sh, G.ball(), coat, [0, 0, 0], 0.045, undefined, fo); // knobby knee
    part(sh, G.capsule(0.032, 0.2), coat, [0, -0.13, 0]);
    part(sh, G.sphere(), shoe, [0, -0.27, 0.06], [0.05, 0.04, 0.13]);
    part(sh, G.cone(), shoe, [0, -0.26, 0.2], [0.022, 0.08, 0.022], [Math.PI / 2 - 0.5, 0, 0], fo);
    legs.push({ th, sh });
  }
  const body = grp(base, [0, 0.58, 0]);
  part(body, G.sphere(), coat, [0, 0.24, -0.01], [0.16, 0.26, 0.13]);
  part(body, G.sphere(), shirt, [0, 0.28, 0.07], [0.08, 0.2, 0.07]);
  part(body, G.sphere(), M.get('#5a2a3e'), [0, 0.18, 0.08], [0.085, 0.1, 0.06], undefined, fo); // waistcoat
  for (const s of [1, -1]) part(body, G.cone(), M.get('#121018'), [s * 0.03, 0.47, 0.13], [0.03, 0.045, 0.02], [0, 0, s * Math.PI / 2], fo);
  part(body, G.ball(), M.get('#121018'), [0, 0.47, 0.135], 0.016, undefined, fo);
  // tailcoat tails (swing)
  const tails: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const tl = grp(body, [s * 0.06, 0.12, -0.1]);
    part(tl, cached('srv-tail', () => new THREE.ConeGeometry(1, 1, 4, 1).rotateY(Math.PI / 4).translate(0, -0.5, 0)), coat, [0, 0, 0], [0.07, 0.42, 0.02], [Math.PI, 0, 0]);
    tails.push(tl);
  }
  // long arms
  const arms: { sh: THREE.Group; el: THREE.Group; hand: THREE.Group }[] = [];
  for (const s of [1, -1]) {
    const sh = grp(body, [s * 0.15, 0.42, 0]);
    part(sh, G.capsule(0.032, 0.17), coat, [0, -0.1, 0]);
    const el = grp(sh, [0, -0.22, 0]);
    part(el, G.capsule(0.03, 0.15), coat, [0, -0.09, 0]);
    part(el, G.cyl(), shirt, [0, -0.19, 0], [0.034, 0.03, 0.034], undefined, fo);
    const hand = grp(el, [0, -0.24, 0]);
    part(hand, G.sphere(), glove, [0, 0, 0], [0.042, 0.055, 0.03]);
    part(hand, G.capsule(0.012, 0.03), glove, [0.035, 0.01, 0.01], 1, [0, 0, -0.6], fo);
    arms.push({ sh, el, hand });
  }
  // the tray (balanced on the left hand, kept level)
  const tray = grp(body, [-0.3, 0.5, 0.14]);
  part(tray, G.cyl(), M.get('#d8dce6'), [0, 0, 0], [0.17, 0.012, 0.17]);
  part(tray, G.torus(0.17, 0.012, 6, 28), M.get('#b8bcc8'), [0, 0.008, 0], 1, [Math.PI / 2, 0, 0], fo);
  part(tray, G.cyl(), M.get('#c9a24a'), [0.03, 0.03, 0], [0.04, 0.02, 0.04], undefined, fo);
  part(tray, G.cyl(), M.get('#c9a24a'), [0.03, 0.07, 0], [0.012, 0.06, 0.012], undefined, fo);
  part(tray, G.cyl(), M.get('#f4ecd0'), [0.03, 0.15, 0], [0.018, 0.1, 0.018]);
  const flame = grp(tray, [0.03, 0.22, 0]);
  part(flame, G.sphere(), basic('#ffd36a', { additive: true, depthWrite: false }), [0, 0.02, 0], [0.016, 0.035, 0.016], undefined, nf);
  part(flame, G.sphere(), basic('#ffffff'), [0, 0.012, 0], [0.007, 0.016, 0.007], undefined, nf);
  const halo = part(flame, new THREE.PlaneGeometry(0.22, 0.22), basic('#ffb040', { additive: true, depthWrite: false, map: glowTex(), opacity: 0.6 }), [0, 0.02, 0.01], 1, undefined, nf);
  noOutline(flame);
  // a teacup
  part(tray, G.cyl(), M.get('#ffffff'), [-0.07, 0.035, 0.03], [0.035, 0.03, 0.035], undefined, fo);
  part(tray, G.torus(0.015, 0.005, 4, 10), M.get('#ffffff'), [-0.105, 0.035, 0.03], 1, undefined, fo);
  // long neck + egg head
  part(body, G.capsule(0.035, 0.08), skin, [0, 0.53, 0.02]);
  const head = grp(body, [0, 0.7, 0.04]);
  const R = 0.15;
  part(head, G.sphere(), skin, [0, 0.02, 0], [R, R * 1.25, R * 1.02]);
  // hooked nose
  part(head, cached('srv-nose', () => taperedTube(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.03, 0), new THREE.Vector3(0, 0.0, 0.1), new THREE.Vector3(0, -0.06, 0.08)), 10, 8, (u) => 0.035 * (1 - u * 0.6), true)), skinD, [0, -0.01, 0.13]);
  for (const s of [1, -1]) part(head, G.sphere(), skinD, [s * 0.15, 0.0, -0.01], [0.03, 0.065, 0.025], [0, 0, s * 0.3]); // droopy ears
  for (let i = -1; i <= 1; i++) part(head, cached('srv-hair', () => taperedTube(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.02, 0.09, 0), new THREE.Vector3(0.08, 0.07, 0)), 8, 4, () => 0.006, false)), M.get('#3a3428'), [i * 0.03, 0.2, -0.01], 1, [0, i * 0.5, 0], fo);
  const F = vface(head, M, { R, center: [0, 0.03, 0], eyeYaw: 0.34, eyePitch: 0.18, eyeW: 0.045, eyeH: 0.05, iris: '#c0283a', lidMat: skin, lidRest: 0.55, brow: '#3a3428', browThick: 0.014, mouthPitch: -0.55, mouthW: 0.052, rest: 'smirk', glintSize: 0.24 });
  const hit = new HitReact();
  let t = Math.random() * 5, walk = 0, hunch = 0, armA = 0, armX = 0, armZ = 0, tw = 0, bow = 0, glow = 0, lean = 0;
  return {
    root, M, top: 1.48,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      const hk = hit.update(dt, a.flash);
      walk += dt * clamp(a.speed, 0, 6) * 2.6;
      const moving = a.speed > 0.3;
      const sw = moving ? Math.sin(walk) : 0;
      let wHunch = 0.18, wArmA = 0.15, wArmX = 0, wArmZ = 0.1, ex: HeroExpr = 'normal', wGlow = 0.1, wBow = Math.max(0, Math.sin(t * 0.45) - 0.85) * 4, wLean = 0;
      switch (a.st) {
        case 'walk': wHunch = 0.3; wArmA = 0; wBow = 0; break;
        case 'windup': { const k = easeOut(a.p); wHunch = 0.05; wLean = -0.2 * k; wArmA = -2.6 * k; wArmZ = 0.5 * k; wArmX = 0.3 * k; ex = 'angry'; wGlow = 0.3 + 0.7 * a.p; wBow = 0; break; }
        case 'slap': { const k = easeOut(seg(a.p, 0, 0.45)); wHunch = 0.45; wLean = 0.3 * k; wArmA = lerp(-2.6, 1.4, k); wArmZ = lerp(0.5, -0.9, k); wArmX = 0; ex = 'angry'; wGlow = 1 - seg(a.p, 0.5, 1); wBow = 0; break; }
        case 'retreat': wHunch = 0.55; wArmA = 0.3; ex = 'normal'; wBow = 0; break;
        case 'stun': wHunch = 0.25 + Math.sin(t * 7) * 0.12; wArmA = Math.sin(t * 5) * 0.8; ex = 'hurt'; wBow = 0; break;
        case 'burn': wHunch = -0.1; wArmA = -2.5 + Math.sin(t * 25) * 0.3; ex = 'scared'; wBow = 0; break;
        case 'die': wHunch = 0.4; ex = 'hurt'; break;
      }
      if (hk > 0) { wLean -= 0.6 * hk; if (hk > 0.25) ex = 'hurt'; }
      hunch = damp(hunch, wHunch, 12, dt); lean = damp(lean, wLean, 14, dt);
      armA = damp(armA, wArmA, a.st === 'slap' ? 32 : 12, dt); armX = damp(armX, wArmX, 12, dt); armZ = damp(armZ, wArmZ, a.st === 'slap' ? 32 : 12, dt);
      bow = damp(bow, clamp(wBow), 4, dt); glow = damp(glow, wGlow, 10, dt);
      // stiff, long-legged march
      body.position.y = 0.58 + Math.abs(sw) * 0.04 + Math.sin(t * 2) * 0.004;
      body.rotation.set(hunch * 0.6 + bow * 0.55 + lean, 0, sw * 0.04);
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        legs[i].th.rotation.set(sw * s * 0.65 - (a.st === 'retreat' ? 0.3 : 0), 0, 0);
        legs[i].sh.rotation.set(moving ? Math.max(0, -Math.cos(walk + (i ? Math.PI : 0))) * 0.7 : 0.05, 0, 0);
      }
      for (const [i, tl] of tails.entries()) tl.rotation.set(-0.15 - Math.abs(sw) * 0.25 - lean * 0.5 + Math.sin(t * 2 + i) * 0.04, 0, (i ? -1 : 1) * 0.08);
      // right: the slapping hand (or behind the back, like a proper butler)
      arms[0].sh.rotation.set(-armA + (moving ? -sw * 0.4 : 0) + 0.15, armX, armZ + (a.st === 'idle' || a.st === 'walk' ? 0.05 : 0));
      arms[0].el.rotation.set(-(a.st === 'idle' ? 1.3 : 0.25), 0, 0);
      arms[0].hand.rotation.set(0, 0, a.st === 'slap' ? -0.6 : 0);
      // left: holds the tray up
      arms[1].sh.rotation.set(-0.35, 0, -0.75);
      arms[1].el.rotation.set(-1.7, 0, 0);
      arms[1].hand.rotation.set(0, 0, 0);
      // the tray: steady, wobbling a bit when he slaps / is hit / is dizzy
      tw = damp(tw, (a.st === 'slap' ? 0.25 : 0) + (a.st === 'stun' ? Math.sin(t * 8) * 0.35 : 0) + hk * 0.5, 8, dt);
      tray.rotation.set(-(hunch * 0.6 + bow * 0.55 + lean) + Math.sin(t * 13) * tw * 0.2, 0, tw * 0.5);
      flame.scale.set(1 + Math.sin(t * 31) * 0.1, 1 + Math.sin(t * 23) * 0.18, 1);
      flame.rotation.z = Math.sin(t * 7) * 0.15;
      (halo.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(t * 17) * 0.1;
      head.rotation.set(-hunch * 0.6 - bow * 0.3 + hk * 0.3 - lean * 0.5, Math.sin(t * 0.5) * 0.2 * (a.st === 'idle' ? 1 : 0), a.st === 'stun' ? Math.sin(t * 6) * 0.2 : 0);
      F.update(dt, ex, glow);
      M.flash(a.flash);
    },
  };
}

// ═════════════════════════════ УПЫРЬ-ГРОМИЛА (brute) ═════════════════════════════
/** poses: idle walk raise slam recover punchPrep punch stun burn die */
export function createBrute(): VRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'brute';
  const base = grp(root);
  const skinC = '#a090c4';
  const skin = M.get(skinC), skinD = M.get('#7a6c9c'), vest = M.get('#5a2a3e'), pants = M.get('#2f2a3f'), leather = M.get('#2a2030'), metal = M.get('#d8dce6');
  const legs: { th: THREE.Group; sh: THREE.Group }[] = [];
  for (const s of [1, -1]) {
    const th = grp(base, [s * 0.25, 0.46, 0]);
    part(th, G.capsule(0.14, 0.1), pants, [0, -0.08, 0]);
    const sh = grp(th, [0, -0.2, 0]);
    part(sh, G.capsule(0.12, 0.08), pants, [0, -0.06, 0]);
    part(sh, G.cyl(), leather, [0, -0.1, 0], [0.135, 0.05, 0.135], undefined, fo);
    part(sh, G.sphere(), skinD, [0, -0.22, 0.08], [0.16, 0.08, 0.22]);
    for (let i = -1; i <= 1; i++) part(sh, G.cone(), M.get('#e6dcf4'), [i * 0.07, -0.24, 0.29], [0.025, 0.06, 0.025], [Math.PI / 2, 0, 0], fo);
    legs.push({ th, sh });
  }
  const body = grp(base, [0, 0.46, 0]);
  const chest = grp(body);
  part(chest, G.sphere(), skin, [0, 0.55, -0.04], [0.6, 0.55, 0.48]);
  part(chest, G.sphere(), M.get('#b2a5d2'), [0, 0.38, 0.22], [0.36, 0.32, 0.25]); // belly
  // stitches across the belly
  for (let i = 0; i < 4; i++) part(chest, G.capsule(0.008, 0.05), M.get('#3a2a4a'), [-0.12 + i * 0.07, 0.36, 0.46], 1, [Math.PI / 2, 0, 0.5], fo);
  part(chest, G.capsule(0.008, 0.25), M.get('#3a2a4a'), [-0.02, 0.36, 0.455], 1, [0, 0, Math.PI / 2], fo);
  // torn vest: two side panels, ragged hem
  for (const s of [1, -1]) {
    part(chest, G.sphere(), vest, [s * 0.3, 0.6, -0.06], [0.36, 0.48, 0.45], [0, s * 0.2, 0]);
    for (let i = 0; i < 4; i++) part(chest, G.cone(), vest, [s * (0.2 + i * 0.1), 0.18, 0.12 - i * 0.1], [0.06, 0.1, 0.04], [Math.PI, s * 0.3, 0], fo);
  }
  part(chest, G.sphere(), M.get('#7a4060'), [0.36, 0.72, 0.28], [0.1, 0.09, 0.03], [0, 0.6, 0.2], fo); // a patch
  // studded collar
  part(chest, G.torus(0.27, 0.075, 10, 28), leather, [0, 1.0, 0.0], 1, [Math.PI / 2 - 0.15, 0, 0]);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    part(chest, G.cone(), metal, [Math.sin(a) * 0.34, 1.0 + Math.cos(a) * 0.05, Math.cos(a) * 0.34], [0.04, 0.09, 0.04], [Math.cos(a) * Math.PI / 2 - 0.15, 0, -Math.sin(a) * Math.PI / 2], fo);
  }
  // arms: big shoulder → small upper arm → HUGE forearm → fist
  const arms: { sh: THREE.Group; el: THREE.Group; fist: THREE.Group }[] = [];
  for (const s of [1, -1]) {
    const sh = grp(chest, [s * 0.6, 0.82, 0]);
    part(sh, G.sphere(), skin, [0, 0, 0], 0.22);
    part(sh, G.capsule(0.09, 0.12), skin, [0, -0.15, 0]);
    const el = grp(sh, [0, -0.28, 0]);
    part(el, G.sphere(), skin, [0, -0.2, 0.02], [0.2, 0.3, 0.2]);
    part(el, G.cyl(), leather, [0, -0.42, 0.02], [0.17, 0.07, 0.17], undefined, fo);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; part(el, G.cone(), metal, [Math.sin(a) * 0.18, -0.42, 0.02 + Math.cos(a) * 0.18], [0.025, 0.05, 0.025], [Math.cos(a) * Math.PI / 2, 0, -Math.sin(a) * Math.PI / 2], fo); }
    const fist = grp(el, [0, -0.56, 0.04]);
    part(fist, G.sphere(), skinD, [0, 0, 0], [0.2, 0.17, 0.2]);
    for (let i = -1; i <= 2; i++) part(fist, G.sphere(), skin, [(i - 0.5) * 0.085, -0.06, 0.15], [0.055, 0.05, 0.05], undefined, fo);
    part(fist, G.sphere(), skin, [s * -0.15, 0.02, 0.08], [0.06, 0.08, 0.06], undefined, fo); // thumb
    arms.push({ sh, el, fist });
  }
  // tiny head sunk between the shoulders
  const head = grp(chest, [0, 1.12, 0.2]);
  const R = 0.16;
  part(head, G.sphere(), skin, [0, 0, 0], [R, R * 0.95, R * 0.95]);
  part(head, G.sphere(), skinD, [0, 0.07, 0.1], [0.15, 0.045, 0.08], undefined, fo); // brow ridge
  for (const s of [1, -1]) part(head, G.cone(), skinD, [s * 0.16, 0.04, -0.02], [0.035, 0.08, 0.02], [0, 0, s * -1.2]);
  const jaw = grp(head, [0, -0.08, 0.05]);
  part(jaw, G.sphere(), skinD, [0, -0.03, 0.04], [0.14, 0.075, 0.12]);
  const tusk = M.get('#fff6e0');
  for (const s of [1, -1]) part(jaw, G.cone(), tusk, [s * 0.075, 0.035, 0.12], [0.025, 0.07, 0.025], [0.2, 0, s * -0.2], fo);
  const F = vface(head, M, { R, eyeYaw: 0.3, eyePitch: 0.08, eyeW: 0.036, eyeH: 0.036, lidMat: skin, lidRest: 0.25, brow: '#3a2a4a', browThick: 0.02, mouthPitch: -0.32, mouthW: 0.04, fangPeek: false, glintSize: 0.24 });
  const hit = new HitReact();
  let t = Math.random() * 5, walk = 0, raise = 0, squash = 0, lean = 0, twist = 0, punch = 0, glow = 0, toes = 0, slumpK = 0, breathK = 0;
  return {
    root, M, top: 2.02,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      const hk = hit.update(dt, a.flash);
      walk += dt * clamp(a.speed, 0, 5) * 2.0;
      const moving = a.speed > 0.2;
      const sw = moving ? Math.sin(walk) : 0;
      let wRaise = 0, wSquash = 0, wLean = 0.12, wTwist = 0, wPunch = 0, ex: HeroExpr = 'normal', wGlow = 0.12, wToes = 0, wSlump = 0, wBreath = 0.4;
      switch (a.st) {
        case 'walk': wLean = 0.2; break;
        case 'raise': { const k = easeOut(seg(a.p, 0, 0.7)); wRaise = 0.3 + 0.75 * k; wLean = -0.3 * k; wToes = k; ex = 'angry'; wGlow = 0.3 + 0.7 * a.p; wBreath = 0; break; }
        case 'slam': wRaise = -0.55; wSquash = 0.3; wLean = 0.55; ex = 'angry'; wGlow = 1; wBreath = 0; break;
        case 'recover': wRaise = -0.5 + 0.5 * easeIn(a.p); wSquash = 0.12 * (1 - a.p); wLean = lerp(0.55, 0.2, easeIn(a.p)); wSlump = 1 - a.p; ex = a.p < 0.6 ? 'sleepy' : 'normal'; wBreath = 1.5; break;
        case 'punchPrep': wTwist = -0.6 * easeOut(a.p); wPunch = -1; wLean = -0.1; ex = 'angry'; wGlow = 0.3 + 0.7 * a.p; break;
        case 'punch': wTwist = 0.5; wPunch = 1; wLean = 0.35; ex = 'angry'; wGlow = 0.8; break;
        case 'burn': wRaise = 0.5 + Math.sin(t * 25) * 0.1; wLean = -0.2; ex = 'scared'; break;
        case 'stun': wLean = Math.sin(t * 4) * 0.2; ex = 'hurt'; break;
        case 'die': wLean = -0.2; ex = 'hurt'; break;
      }
      if (hk > 0) { wLean -= 0.35 * hk; wSquash += 0.08 * hk; if (hk > 0.25) ex = 'hurt'; }
      raise = damp(raise, wRaise, a.st === 'slam' ? 34 : 9, dt);
      squash = damp(squash, wSquash, a.st === 'slam' ? 30 : 10, dt);
      lean = damp(lean, wLean, a.st === 'slam' ? 26 : 9, dt);
      twist = damp(twist, wTwist, a.st === 'punch' ? 30 : 10, dt);
      punch = damp(punch, wPunch, a.st === 'punch' ? 30 : 10, dt);
      toes = damp(toes, wToes, 8, dt); slumpK = damp(slumpK, wSlump, 6, dt); breathK = damp(breathK, wBreath, 3, dt);
      glow = damp(glow, wGlow, 10, dt);
      const tremble = a.st === 'raise' ? seg(a.p, 0.6, 1) * Math.sin(t * 60) * 0.02 : 0;
      // heavy breathing, lumbering sway
      const breath = Math.sin(t * (2 + breathK * 2.5)) * (0.5 + breathK);
      chest.scale.set(1 + breath * 0.012, 1 + breath * 0.016, 1 + breath * 0.012);
      body.position.y = 0.46 - squash * 0.18 + Math.abs(sw) * 0.05 + toes * 0.08 - slumpK * 0.04;
      body.position.x = tremble;
      body.rotation.set(lean, twist, sw * 0.06);
      base.scale.set(1 + squash * 0.25, 1 - squash * 0.2, 1 + squash * 0.25);
      base.rotation.z = sw * 0.04;
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        legs[i].th.rotation.set(sw * s * 0.45 - squash * 0.6 - lean * 0.4, 0, s * 0.05);
        legs[i].sh.rotation.set(squash * 1.0 + (moving ? Math.max(0, -Math.cos(walk + (i ? Math.PI : 0))) * 0.5 : 0) - toes * 0.2, 0, 0);
      }
      // arms: overhead for the slam, hanging gorilla-like otherwise; the right one punches
      const up = Math.max(0, raise) * 2.9, down = Math.min(0, raise);
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        const ar = arms[i];
        const swing = -sw * s * 0.35;
        const p = i === 0 ? punch : 0;
        ar.sh.rotation.set(-up - swing + down * -1.6 + (p > 0 ? -1.5 * p : p * -0.5) + slumpK * -0.5, 0, s * (0.28 + Math.max(0, raise) * 0.12 - (raise > 0.5 ? 0.1 : 0)));
        ar.el.rotation.set(-0.35 - (p < 0 ? 1.3 * -p : 0) + up * 0.12 + slumpK * 0.2, 0, 0);
        ar.fist.rotation.set(0, 0, 0);
      }
      head.rotation.set(-lean * 0.6 + (a.st === 'raise' ? -0.2 : 0) + hk * 0.25, -twist * 0.5 + Math.sin(t * 0.5) * 0.15 * (a.st === 'idle' ? 1 : 0), a.st === 'stun' ? Math.sin(t * 4) * 0.25 : 0);
      jaw.rotation.x = a.st === 'raise' || a.st === 'burn' || a.st === 'slam' ? 0.3 : 0.05 + breathK * 0.05 * (0.5 + 0.5 * Math.sin(t * 4.5));
      F.update(dt, ex, glow);
      M.flash(a.flash);
    },
  };
}
