import * as THREE from 'three';
import { clamp, lerp, damp, smooth, seg, wrapAngle, grp } from './kit';
import type { HeroAnim, HeroAtk, HeroState } from './hero';

/*
 * The skeleton + pose animator shared by the two-legged playable heroes (Noki, Pastila). Same pose vector and
 * the same state poses as Tosha (hero.ts), so every hero reads alike in play: idle / run / walk / sneak / jump /
 * fall / dash / hurt / grabbed / dead / sit / cheer / lookUp / tumble / emotes / downed. A model hangs its meshes on
 * the bones and supplies its own attack poses (attack()), and may tweak the target pose per state (style()).
 */

export const POSE_KEYS = [
  'bodyY', 'bodyZ', 'leanX', 'leanZ', 'tiltX', 'tiltZ', 'tiltH', 'twist',
  'hipL', 'hipR', 'kneeL', 'kneeR', 'splay',
  'aLp', 'aLy', 'aLr', 'aRp', 'aRy', 'aRr', 'blade', 'push',
  'headX', 'headY', 'headZ', 'scarf',
] as const;
export type PoseKey = (typeof POSE_KEYS)[number];
export type Pose = Record<PoseKey, number>;
export const newPose = (): Pose => { const p = {} as Pose; for (const k of POSE_KEYS) p[k] = 0; return p; };

export interface HumanoidSpec {
  /** height of the tumble / lying pivot above the feet */
  CY: number;
  hipY: number; hipX: number;
  /** hip → knee, knee → ankle */
  thigh: number; shin: number;
  shoulderY: number; shoulderX: number;
  /** shoulder → hand */
  arm: number;
  headY: number;
}

export interface Bones {
  root: THREE.Group; squashG: THREE.Group; leanG: THREE.Group; tilt: THREE.Group; spin: THREE.Group; body: THREE.Group; head: THREE.Group;
  legs: { hip: THREE.Group; knee: THREE.Group }[];
  arms: { sh: THREE.Group; mount: THREE.Group }[];
}

export function bones(spec: HumanoidSpec, name: string): Bones {
  const root = new THREE.Group();
  root.name = name;
  const squashG = grp(root, undefined, undefined, 'squash');
  const leanG = grp(squashG, undefined, undefined, 'lean');
  const tilt = grp(leanG, [0, spec.CY, 0], undefined, 'tilt');
  const spin = grp(tilt, undefined, undefined, 'spin');
  const body = grp(spin, [0, -spec.CY, 0], undefined, 'body');
  const legs = [1, -1].map((s) => {
    const hip = grp(body, [s * spec.hipX, spec.hipY, 0]);
    const knee = grp(hip, [0, -spec.thigh, 0]);
    return { hip, knee };
  });
  const arms = [1, -1].map((s) => {
    const sh = grp(body, [s * spec.shoulderX, spec.shoulderY, 0]);
    sh.rotation.order = 'YXZ';
    const mount = grp(sh, [0, -spec.arm, 0]);
    return { sh, mount };
  });
  const head = grp(body, [0, spec.headY, 0], undefined, 'head');
  head.rotation.order = 'YXZ';
  return { root, squashG, leanG, tilt, spin, body, head, legs, arms };
}

/** what a model's attack() returns: the blend weight of its pose (0 = not this model's attack) and a spin */
export interface AtkOut { w: number; spin?: number }

export interface Animator {
  /** current (smoothed) pose */
  C: Pose;
  /** seconds in the current state */
  readonly stT: number;
  readonly t: number;
  /** cycle phase (legs) */
  readonly phase: number;
  update(dt: number, a: HeroAnim, attack: (A: Pose, kind: HeroAtk, p: number) => AtkOut, style?: (T: Pose, st: HeroState) => void): void;
}

/** the pose animator (Tosha's state poses), applied to `b` */
export function animator(spec: HumanoidSpec, b: Bones): Animator {
  const C = newPose(), T = newPose(), A = newPose();
  let t = Math.random() * 5, phase = 0, spinCur = 0, tumbleCur = 0, first = true, stT = 0;
  let lastSt: HeroState = 'idle';
  const CY = spec.CY;
  const self: Animator = {
    C,
    get stT() { return stT; },
    get t() { return t; },
    get phase() { return phase; },
    update(dt, a, attack, style) {
      dt = Math.min(dt, 0.1);
      t += dt;
      const st = a.state;
      const sp = clamp(a.speed, 0, 1);
      if (st === 'run') phase += dt * (7 + 7 * sp);
      else if (st === 'walk') phase += dt * (5 + 5 * sp);
      else if (st === 'sneak') phase += dt * (4 + 4 * sp);
      else if (st === 'downed') phase += dt * (1.2 + 40 * sp);
      else phase += dt * 6;
      if (st !== lastSt) { lastSt = st; stT = 0; } else stT += dt;
      const s = Math.sin(phase);
      for (const k of POSE_KEYS) T[k] = 0;
      T.aLr = 0.16; T.aRr = -0.16; T.aRp = -0.3; T.aLp = 0.04;
      T.blade = -0.85; T.scarf = 0.12;
      const breathe = Math.sin(t * 2.4);
      switch (st) {
        case 'idle':
          T.bodyY = 0.004 * breathe; T.aLr += 0.03 * breathe; T.aRr -= 0.03 * breathe;
          T.headX = 0.025 * breathe; T.headZ = 0.035 * Math.sin(t * 0.8);
          break;
        case 'run': case 'walk': {
          const run = st === 'run';
          const amp = run ? 0.8 + 0.35 * sp : 0.45 + 0.25 * sp;
          T.hipL = -s * amp; T.hipR = s * amp;
          const K = run ? 1.5 : 0.65;
          T.kneeL = 0.1 + K * Math.max(0, Math.cos(phase + 0.3));
          T.kneeR = 0.1 + K * Math.max(0, Math.cos(phase + Math.PI + 0.3));
          const aa = run ? 0.95 : 0.5;
          T.aLp = s * aa; T.aRp = -s * aa - 0.35;
          T.aLr = run ? 0.3 : 0.18; T.aRr = run ? -0.3 : -0.18;
          T.bodyY = (run ? 0.05 * (0.5 + sp) : 0.018) * s * s - (run ? 0.014 : 0);
          T.leanX = run ? 0.1 + 0.2 * sp : 0.05;
          T.leanZ = Math.cos(phase) * (run ? 0.035 : 0.025);
          T.headX = -T.leanX * 0.6; T.headZ = -T.leanZ * 0.6;
          T.scarf = run ? 0.6 + 0.7 * sp : 0.3;
          T.blade = -1.2;
          break;
        }
        case 'sneak':
          T.bodyY = -0.06;
          T.hipL = -0.85 - s * 0.28; T.hipR = -0.85 + s * 0.28;
          T.kneeL = 1.45 + Math.max(0, Math.cos(phase + 0.3)) * 0.45; T.kneeR = 1.45 + Math.max(0, Math.cos(phase + Math.PI + 0.3)) * 0.45;
          T.leanX = 0.3; T.leanZ = Math.sin(phase) * 0.06;
          T.aLp = -1.15; T.aLr = 0.3; T.aLy = -0.35; T.aRp = -1.0; T.aRr = -0.3; T.aRy = 0.3;
          T.headX = -0.3; T.blade = -0.25;
          break;
        case 'jump':
          T.hipL = -1.05; T.kneeL = 1.75; T.hipR = -0.4; T.kneeR = 1.05;
          T.aLp = -2.3; T.aLr = 0.35; T.aRp = -2.1; T.aRr = -0.35;
          T.blade = -1.3; T.scarf = 0.35; T.headX = -0.1;
          break;
        case 'fall': {
          const f = Math.sin(t * 13) * 0.18;
          T.aLp = -2.6 + f; T.aLr = 0.65; T.aRp = -2.6 - f; T.aRr = -0.65;
          T.hipL = -0.35; T.kneeL = 0.55; T.hipR = 0.15; T.kneeR = 0.35; T.splay = 0.12;
          T.scarf = 2.5; T.blade = -1.6;
          break;
        }
        case 'dash':
          T.leanX = 0.62; T.bodyY = -0.02;
          T.aLp = 1.3; T.aLr = 0.35; T.aRp = 1.2; T.aRr = -0.35;
          T.blade = -2.75;
          T.hipL = -0.95; T.kneeL = 0.95; T.hipR = 0.65; T.kneeR = 0.6;
          T.headX = -0.5; T.scarf = 2.1;
          break;
        case 'hurt':
          T.leanX = -0.42; T.bodyZ = -0.04;
          T.aLp = -1.55; T.aLr = 0.75; T.aRp = -1.35; T.aRr = -0.75;
          T.hipL = -0.65; T.kneeL = 0.95; T.hipR = 0.1; T.kneeR = 0.2;
          T.headX = -0.3; T.scarf = 0.9; T.blade = -1.6;
          break;
        case 'grabbed': {
          const k = Math.sin(t * 22), k2 = Math.sin(t * 18);
          T.aLp = -2.55 + k * 0.6; T.aLr = 0.55; T.aRp = -2.55 - k * 0.6; T.aRr = -0.55;
          T.hipL = -0.5 + k2 * 0.65; T.kneeL = 0.8 + k2 * 0.3; T.hipR = -0.5 - k2 * 0.65; T.kneeR = 0.8 - k2 * 0.3;
          T.tiltZ = Math.sin(t * 13) * 0.14; T.headZ = Math.sin(t * 9) * 0.16; T.scarf = 0.8;
          break;
        }
        case 'dead':
          T.tiltX = -Math.PI / 2; T.tiltH = 0.2 - CY;
          T.aLp = -0.2; T.aLr = 1.35; T.aRp = -0.3; T.aRr = -1.35; T.splay = 0.28;
          T.headY = 0.35; T.headZ = 0.12; T.scarf = 0.0; T.blade = 1.45;
          break;
        case 'sit':
          T.bodyY = -spec.thigh * 0.9; T.hipL = -1.45; T.hipR = -1.4; T.kneeL = 0.25; T.kneeR = 0.32; T.splay = 0.12;
          T.aLp = -0.5; T.aLr = 0.32; T.aRp = -0.55; T.aRr = -0.32; T.leanX = -0.08;
          T.blade = -0.95; T.scarf = 0.05; T.headX = 0.02 * breathe;
          break;
        case 'cheer': {
          const h = Math.abs(Math.sin(t * 7));
          const w = Math.sin(t * 10) * 0.18;
          T.aLp = -0.3; T.aLr = 2.6 + w; T.aRp = -0.3; T.aRr = -2.6 + w;
          T.bodyY = h * 0.075; T.kneeL = T.kneeR = (1 - h) * 0.5; T.hipL = T.hipR = -(1 - h) * 0.25;
          T.blade = -1.45; T.headX = -0.15; T.scarf = 0.4 + h * 0.4;
          break;
        }
        case 'lookUp':
          T.headX = -0.6; T.leanX = -0.08; T.aLp = 0.25; T.aRp = 0.1; T.bodyY = 0.004 * breathe;
          break;
        case 'tumble': {
          const f = Math.sin(t * 15) * 0.4;
          T.aLp = -2.4 + f; T.aLr = 1.0; T.aRp = -2.4 - f; T.aRr = -1.0;
          T.hipL = -0.6; T.kneeL = 1.0; T.hipR = 0.4; T.kneeR = 0.6; T.splay = 0.35;
          T.scarf = 2.0; T.blade = -1.5;
          break;
        }
        case 'wave': {
          const w2 = Math.sin(t * 11);
          T.aLr = 2.45 + w2 * 0.38; T.aLp = -0.2; T.aLy = 0.15;
          T.aRp = -0.15; T.aRr = -0.22; T.blade = -1.1;
          T.leanZ = -0.05 + w2 * 0.025; T.headZ = 0.14; T.headX = -0.08;
          T.bodyY = Math.max(0, Math.sin(t * 5.5)) * 0.02 + 0.004 * breathe;
          T.scarf = 0.25;
          break;
        }
        case 'dance': {
          const bt = t * 7.5, half = Math.sin(bt / 2), bounce = Math.abs(Math.sin(bt));
          T.bodyY = bounce * 0.055;
          T.kneeL = 0.12 + (1 - bounce) * 0.42 + Math.max(0, half) * 0.5; T.kneeR = 0.12 + (1 - bounce) * 0.42 + Math.max(0, -half) * 0.5;
          T.hipL = -(1 - bounce) * 0.22 - Math.max(0, half) * 0.4; T.hipR = -(1 - bounce) * 0.22 - Math.max(0, -half) * 0.4;
          T.leanZ = half * 0.13; T.twist = half * 0.45;
          T.aLr = 1.55 + half * 0.95; T.aLp = -0.35 + Math.sin(bt) * 0.25;
          T.aRr = -1.55 + half * 0.95; T.aRp = -0.35 - Math.sin(bt) * 0.25;
          T.headZ = -half * 0.18; T.headX = -0.06 + Math.sin(bt) * 0.07;
          T.blade = -1.45; T.scarf = 0.45 + bounce * 0.4;
          break;
        }
        case 'bow': {
          const c = stT % 2.1;
          const k = smooth(seg(c, 0.05, 0.45)) * (1 - smooth(seg(c, 1.15, 1.55)));
          T.leanX = 0.62 * k; T.bodyZ = -0.06 * k; T.bodyY = -0.015 * k;
          T.hipL = 0.62 * k; T.hipR = 0.62 * k; T.kneeL = 0.08 * k; T.kneeR = 0.08 * k;
          T.aRp = -0.3 - 0.75 * k; T.aRy = 0.55 * k; T.aRr = -0.16 + 0.12 * k;
          T.aLp = 0.04 + 1.0 * k; T.aLr = 0.16 + 0.25 * k;
          T.headX = 0.32 * k; T.blade = -0.6;
          T.scarf = 0.12 + 0.5 * k;
          break;
        }
        case 'facepalm': {
          const k = smooth(seg(stT, 0, 0.25));
          T.aLp = -2.05 * k + 0.04 * (1 - k); T.aLy = -0.62 * k; T.aLr = 0.16 + 0.42 * k;
          T.aRp = -0.15; T.aRr = -0.2; T.blade = -1.0;
          T.headX = 0.36 * k; T.headY = Math.sin(t * 3.2) * 0.12 * k; T.headZ = 0.06;
          T.leanX = 0.08 * k; T.bodyY = 0.004 * breathe;
          T.scarf = 0.08;
          break;
        }
        case 'downed': {
          const cs = Math.sin(phase), cc = Math.cos(phase);
          const m = clamp(sp * 6);
          T.tiltX = Math.PI / 2 - 0.12; T.tiltH = 0.2 - CY;
          T.aLp = -2.75 + cs * 0.55 * m - 0.08 * breathe; T.aLr = 0.45; T.aRp = -2.75 - cs * 0.55 * m - 0.08 * breathe; T.aRr = -0.45;
          T.hipL = 0.15 + cs * 0.35 * m; T.hipR = 0.15 - cs * 0.35 * m;
          T.kneeL = 0.5 + Math.max(0, cc) * 0.7 * m; T.kneeR = 0.5 + Math.max(0, -cc) * 0.7 * m;
          T.splay = 0.16; T.leanZ = cs * 0.05 * m;
          T.headX = -0.75; T.headZ = Math.sin(t * 1.7) * 0.08;
          T.blade = 0.9; T.scarf = 0.05;
          break;
        }
      }
      style?.(T, st);

      // attack override
      const atk = a.attack;
      let w = 0, spinTarget = 0;
      if (atk) {
        for (const k of POSE_KEYS) A[k] = T[k];
        A.leanZ = 0; A.tiltZ = 0;
        const o = attack(A, atk.kind, clamp(atk.p));
        w = o.w; spinTarget = o.spin ?? 0;
        if (w > 0) for (const k of POSE_KEYS) T[k] = lerp(T[k], A[k], w);
      }
      const lam = atk && w > 0 ? 42 : 15;
      if (first) { for (const k of POSE_KEYS) C[k] = T[k]; }
      else for (const k of POSE_KEYS) C[k] = damp(C[k], T[k], lam, dt);
      if (spinTarget) spinCur = spinTarget; else spinCur = damp(wrapAngle(spinCur), 0, 14, dt);
      if (st === 'tumble') tumbleCur += dt * 9; else tumbleCur = damp(wrapAngle(tumbleCur), 0, 10, dt);

      const sq = Math.max(0.2, a.squash || 1);
      const sx = 1 / Math.sqrt(sq);
      b.squashG.scale.set(sx, sq, sx);
      b.leanG.rotation.set(C.leanX, 0, C.leanZ);
      b.tilt.position.y = CY + C.tiltH;
      b.tilt.rotation.set(C.tiltX + tumbleCur, 0, C.tiltZ);
      b.spin.rotation.y = C.twist + spinCur;
      b.body.position.set(0, -CY + C.bodyY, C.bodyZ);
      b.legs[0].hip.rotation.set(C.hipL, 0, C.splay);
      b.legs[1].hip.rotation.set(C.hipR, 0, -C.splay);
      b.legs[0].knee.rotation.x = C.kneeL;
      b.legs[1].knee.rotation.x = C.kneeR;
      b.arms[0].sh.rotation.set(C.aLp, C.aLy, C.aLr);
      b.arms[1].sh.rotation.set(C.aRp, C.aRy, C.aRr);
      b.head.rotation.set(C.headX, C.headY, C.headZ);
      first = false;
    },
  };
  return self;
}

/** the expression a state forces (same rules as Tosha) */
export function stateExpr(a: HeroAnim): HeroAnim['expr'] {
  const st = a.state;
  let ex = a.expr;
  if (st === 'hurt' || st === 'dead') ex = 'hurt';
  else if ((st === 'grabbed' || st === 'tumble') && ex === 'normal') ex = 'scared';
  else if (st === 'dash' && ex === 'normal') ex = 'angry';
  else if (st === 'cheer' && ex === 'normal') ex = 'happy';
  else if ((st === 'wave' || st === 'dance' || st === 'bow') && ex === 'normal') ex = 'happy';
  else if (st === 'facepalm' && ex === 'normal') ex = 'sleepy';
  else if (st === 'downed' && ex === 'normal') ex = 'hurt';
  if (a.attack && ex === 'normal') ex = 'angry';
  return ex;
}

/** world-space spring helper for dangly bits (ponytails, straps): returns the local direction to hang toward */
export class Dangle {
  p = new THREE.Vector3(); v = new THREE.Vector3(); first = true;
  private rest = new THREE.Vector3(); private o = new THREE.Vector3(); private tmp = new THREE.Vector3();
  /** anchor: the pivot group; len: rest length; returns the tip's offset in the anchor's local frame */
  update(anchor: THREE.Object3D, restLocal: THREE.Vector3, dt: number, k = 120, d = 7, g = 3, maxOff = 0.2): THREE.Vector3 {
    anchor.updateMatrixWorld();
    this.rest.copy(restLocal);
    anchor.localToWorld(this.rest);
    if (this.first) { this.p.copy(this.rest); this.v.set(0, 0, 0); this.first = false; }
    const steps = dt > 0.02 ? 2 : 1, h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.o.subVectors(this.rest, this.p).multiplyScalar(k).addScaledVector(this.v, -d);
      this.o.y -= g;
      this.v.addScaledVector(this.o, h);
      if (this.v.lengthSq() > 900) this.v.setLength(30);
      this.p.addScaledVector(this.v, h);
    }
    this.o.subVectors(this.p, this.rest);
    if (this.o.length() > maxOff) { this.o.setLength(maxOff); this.p.copy(this.rest).add(this.o); }
    this.tmp.copy(this.p);
    anchor.worldToLocal(this.tmp);
    return this.tmp;
  }
}
