import * as THREE from 'three';
import { audio } from '../../engine/audio';
import { clamp, damp, rand } from '../../engine/util';
import { matU, PAL } from '../gfx';
import { boxGeo, tmat } from '../world/kit';
import { stoneBricksTex } from '../world/textures';
import { createGuard } from '../models';
import type { GuardAnim, Rig } from '../models';
import { Enemy3 } from './enemies';
import type { BoxCol } from '../physics/types';
import type { Level3D, Actor3 } from './level';
import type { Netted } from './netLevel';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

interface Brick { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; s: THREE.Vector3; rest: boolean }

/** co-op: reserved net id of the chase wall (built by the chase special hook, after the level build) */
export const BREAKWALL_NET_ID = 910;

/**
 * A brick partition the King bursts through (chapter 4 intro). Bricks are one InstancedMesh.
 * Co-op: the host decides when it bursts (its intro script calls burst()); clients' own burst() calls are ignored and
 * the wall bursts on the host's 'burst' event (or its snapshot, whichever comes first) — same hole, and at the moment
 * the King's played-back fist reaches it (both are delivered at NetLevel.playT, like his snapshots).
 */
export class BreakWall implements Actor3, Netted {
  netId = 0;
  netTimed = ['burst'];
  /** client: a snapshot said it is broken — the burst waits for the playback */
  private queued = false;
  mesh: THREE.InstancedMesh;
  bricks: Brick[] = [];
  broken = false;
  t = 0;
  col: BoxCol;
  private burstAt: THREE.Vector3;
  private burstPow = 1;
  constructor(private L: Level3D, public x: number, z0: number, z1: number, private y0: number, h: number, thick = 1.6, broken = false) {
    const bw = 3.2, bh = 1.55;
    const rows = Math.ceil(h / bh);
    const cols = Math.ceil((z1 - z0) / bw) + 1;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const m = matU('#ffffff');
    this.mesh = new THREE.InstancedMesh(geo, m, rows * cols);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? bw / 2 : 0;
      for (let c = 0; c < cols; c++) {
        const zc = z0 + c * bw + off - bw / 2;
        const za = Math.max(z0, zc - bw / 2), zb = Math.min(z1, zc + bw / 2);
        if (zb - za < 0.4) continue;
        const p = new THREE.Vector3(x, y0 + r * bh + bh / 2, (za + zb) / 2);
        this.bricks.push({ p, v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), s: new THREE.Vector3(thick, bh - 0.08, zb - za - 0.08), rest: false });
        tmpC.set('#7a6a92').offsetHSL(rand(-0.02, 0.02), rand(-0.05, 0.05), rand(-0.07, 0.07));
        this.mesh.setColorAt(i, tmpC);
        i++;
      }
    }
    this.mesh.count = this.bricks.length;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.col = { kind: 'box', min: new THREE.Vector3(x - thick / 2, y0, z0), max: new THREE.Vector3(x + thick / 2, y0 + h, z1), tag: 'wall' };
    L.col(this.col);
    L.scene.add(this.mesh);
    if (broken) { this.broken = true; this.col.active = false; this.mesh.visible = false; }
    this.burstAt = new THREE.Vector3(x, y0 + Math.min(10, h / 2), (z0 + z1) / 2);
    this.write();
    L.nl?.add(this, BREAKWALL_NET_ID);
  }

  /** the King smashes through (co-op: only the host's call counts — `fromNet` is the host's word on a client) */
  burst(L: Level3D, at: THREE.Vector3, power = 1, fromNet = false) {
    if (this.broken) return;
    if (!L.authority && !fromNet) return;
    this.broken = true; this.t = 0;
    this.burstAt.copy(at); this.burstPow = power;
    if (L.nl?.isHost) L.nl.entEvent(this, 'burst', { at, p: power });
    this.col.active = false;
    for (const b of this.bricks) {
      const dz = b.p.z - at.z, dy = b.p.y - at.y;
      const near = clamp(1 - Math.hypot(dz, dy) / 26, 0.15, 1);
      b.v.set(rand(10, 26) * near * power, rand(2, 10) * near + 2, dz * 0.35 + rand(-3, 3));
      b.w.set(rand(-6, 6), rand(-6, 6), rand(-6, 6));
    }
    // every machine plays the crash itself (on the host never captured for replay — friends burst on the event)
    const nl = L.nl, cap = !!nl?.capturing;
    if (nl) nl.capturing = false;
    try {
      audio.sfx('bigSlam'); audio.sfx('break', { pitch: 0.6 }); audio.sfx('break', { pitch: 0.8, volume: 0.7 });
      L.tcam.shake(1.2);
      for (let i = 0; i < 6; i++) L.fx.dust(at.clone().add(new THREE.Vector3(rand(-1, 4), rand(-8, 8), rand(-10, 10))), 24, '#c8b8d8');
    } finally { if (nl) nl.capturing = cap; }
  }

  // ── co-op ──
  netEvent(L: Level3D, ev: string, data: unknown) {
    if (ev !== 'burst') return;
    const d = (data ?? {}) as { at?: THREE.Vector3; p?: number };
    this.burst(L, d.at instanceof THREE.Vector3 ? d.at : this.burstAt.clone(), d.p ?? 1, true);
  }
  /** [broken, at.y, at.z, power, seconds since the burst] — a client that missed the event (or gets it late) still
   *  bursts, at the moment the host did */
  netSnap(): number[] { return [this.broken ? 1 : 0, this.burstAt.y, this.burstAt.z, this.burstPow, this.broken ? this.t : 0]; }
  netApply(a: number[], t?: number) {
    if (!a[0] || this.broken || this.queued) return;
    this.queued = true;
    const go = () => this.burst(this.L, new THREE.Vector3(this.x, a[1], a[2]), a[3] || 1, true);
    if (this.L.nl) this.L.nl.atPlay(t !== undefined && a[4] !== undefined ? t - a[4] : t, go); else go();
  }

  update(L: Level3D, dt: number) {
    if (!this.broken || !this.mesh.visible) return;
    this.t += dt;
    let moving = 0;
    for (const b of this.bricks) {
      if (b.rest) continue;
      b.v.y -= 30 * dt;
      b.p.addScaledVector(b.v, dt);
      b.r.x += b.w.x * dt; b.r.y += b.w.y * dt; b.r.z += b.w.z * dt;
      const floor = this.y0 + b.s.y * 0.5;
      if (b.p.y < floor) {
        b.p.y = floor;
        b.v.y *= -0.3; b.v.x *= 0.6; b.v.z *= 0.6; b.w.multiplyScalar(0.6);
        if (Math.abs(b.v.y) < 1.2 && Math.hypot(b.v.x, b.v.z) < 1) { b.rest = true; b.r.x = 0; b.r.z = 0; }
      }
      moving++;
    }
    // after a while the rubble crumbles away so it never blocks the run
    if (this.t > 5) for (const b of this.bricks) b.s.multiplyScalar(Math.max(0, 1 - dt * 1.2));
    if (this.t > 9) this.mesh.visible = false;
    this.write();
    void moving;
  }

  private write() {
    this.bricks.forEach((b, i) => {
      tmpE.copy(b.r);
      tmpQ.setFromEuler(tmpE);
      tmpS.copy(b.s);
      tmpM.compose(b.p, tmpQ, tmpS);
      this.mesh.setMatrixAt(i, tmpM);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** the gallery's finish gate (chapter 4): bars at x, the opening z ±half (lane rails at ±7.5 pass between bars) */
export const CHASE_GATE = { x: 291, half: 17, h: 24, top: 46, wall: 22, thick: 3 };

/**
 * Chapter 4 finish: a giant portcullis in a stone arch across the gallery. It hangs up in the arch while the team
 * runs; once the last runner is through, it slams down between them and the King (KingChaser3 decides — the host in
 * co-op — and stops at its bars). Every machine animates its own copy; the fall's crash is played locally.
 */
export class ChaseGate {
  state: 'up' | 'fall' | 'down' = 'up';
  /** height of the bars' spiked bottom (0 = shut) */
  y: number;
  col: BoxCol;
  private vy = 0;
  private rattle = 0;
  private t = 0;
  private bars = new THREE.Group();
  private readonly upY: number;
  constructor(L: Level3D, public x: number, private floorY = 0) {
    const G = CHASE_GATE;
    const stone = tmat(stoneBricksTex('#7a6a92')), stoneD = tmat(stoneBricksTex(PAL.stoneD));
    const gold = tmat(null, PAL.gold), iron = tmat(null, '#4a4058');
    const frame = new THREE.Group();
    const box = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, tile = 6) => {
      const o = new THREE.Mesh(boxGeo(w, h, d, tile), m);
      o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true;
      frame.add(o);
    };
    // jambs (wall to the opening) and a heavy lintel up to the ceiling line, gold trim along the opening
    const jw = G.wall - G.half;
    for (const s of [-1, 1]) {
      box(stone, G.thick, G.top, jw, 0, G.top / 2, s * (G.half + jw / 2));
      box(stoneD, G.thick + 0.8, 3, jw + 0.8, 0, 1.5, s * (G.half + jw / 2));
      box(gold, G.thick + 0.3, 0.5, 0.5, 0, G.h + 0.25, s * (G.half + 0.25), 0);
    }
    box(stone, G.thick, G.top - G.h, G.half * 2, 0, (G.top + G.h) / 2, 0);
    box(gold, G.thick + 0.3, 0.6, G.half * 2 + 1, 0, G.h + 0.3, 0, 0);
    box(gold, G.thick + 0.4, 0.8, G.half * 2 + 1, 0, G.top - 2, 0, 0);
    frame.position.set(x, floorY, 0);
    L.scene.add(frame);
    // the portcullis: bars (none on the lane rails), crossbars, golden spikes at the bottom
    const BAR = 0.7, SPIKE = 1.3, len = G.h + 1;
    const barGeo = new THREE.BoxGeometry(BAR, len - SPIKE, BAR);
    const spikeGeo = new THREE.ConeGeometry(BAR * 0.62, SPIKE, 4).rotateX(Math.PI).rotateY(Math.PI / 4);
    for (let z = -G.half + 0.75; z < G.half; z += 2.5) {
      const b = new THREE.Mesh(barGeo, iron);
      b.position.set(0, SPIKE + (len - SPIKE) / 2, z); b.castShadow = true;
      const sp = new THREE.Mesh(spikeGeo, gold);
      sp.position.set(0, SPIKE / 2, z);
      this.bars.add(b, sp);
    }
    const crossGeo = new THREE.BoxGeometry(BAR * 0.8, 0.6, G.half * 2);
    for (const cy of [3.6, 9, 14.4, 19.8]) {
      const c = new THREE.Mesh(crossGeo, iron);
      c.position.set(-0.05, cy, 0); c.castShadow = true;
      this.bars.add(c);
    }
    // (up, it still hangs half-way down the arch, so the runners see what's waiting over the finish)
    this.upY = G.h / 2;
    this.y = this.upY;
    this.bars.position.set(x, floorY + this.y, 0);
    L.scene.add(this.bars);
    // the shut gate blocks the way back (nobody is under it when it falls); the arch's sides always do
    this.col = { kind: 'box', min: new THREE.Vector3(x - BAR, floorY, -G.half), max: new THREE.Vector3(x + BAR, floorY + G.top, G.half), active: false, tag: 'wall' };
    L.col(this.col);
    for (const s of [-1, 1]) L.col({ kind: 'box', min: new THREE.Vector3(x - G.thick / 2, floorY, s > 0 ? G.half : -G.wall), max: new THREE.Vector3(x + G.thick / 2, floorY + G.top, s > 0 ? G.wall : -G.half), tag: 'wall' });
  }

  /** bars' near face (the King's side) */
  get face() { return this.x - CHASE_GATE.thick / 2; }

  /** start the fall (every machine animates its own; the crash at the bottom is played locally) */
  drop(L: Level3D) {
    if (this.state !== 'up') return;
    this.state = 'fall';
    this.vy = -6;
    // my hero standing in the arch is nudged through it; anything still holding him lets go
    const p = L.player;
    if (!p.dead && Math.abs(p.pos.x - this.x) < 1.6) { p.body.pos.x = this.x + 1.8; p.body.vel.x = Math.max(p.body.vel.x, 4); }
    if (p.grabbedBy && p.pos.x > this.x) { p.grabbedBy.release(); p.grabbedBy = null; }
    this.local(L, () => { audio.sfx('whoosh', { pitch: 0.45 }); audio.sfx('warn', { pitch: 0.6, volume: 0.6 }); });
  }

  /** the King grabs / bumps into the bars */
  shake(k: number) { this.rattle = Math.max(this.rattle, k); }

  update(L: Level3D, dt: number) {
    this.t += dt;
    if (this.state === 'fall') {
      this.vy -= 140 * dt;
      this.y += this.vy * dt;
      this.col.active = this.y < 2.5;
      if (this.y <= 0) {
        this.y = 0; this.state = 'down'; this.col.active = true; this.rattle = 1;
        this.local(L, () => {
          audio.sfx('bigSlam'); audio.sfx('clang', { pitch: 0.55 }); audio.sfx('clang', { pitch: 0.75, volume: 0.6 });
          const d = Math.abs(L.player.pos.x - this.x);
          L.tcam.shake(clamp(0.9 - d / 60, 0.25, 0.8));
          for (let z = -CHASE_GATE.half + 2; z < CHASE_GATE.half; z += 4) L.fx.dust(new THREE.Vector3(this.x, this.floorY + 0.4, z), 8, '#c8b8d8');
          L.fx.sparks(new THREE.Vector3(this.x, this.floorY + 0.5, L.player.pos.z), 14, ['#ffffff', '#ffe14a', '#c8d0e0']);
        });
      }
    }
    this.rattle = Math.max(0, this.rattle - dt * 1.6);
    const r = this.rattle * this.rattle;
    this.bars.position.set(this.x + Math.sin(this.t * 37) * 0.12 * r, this.floorY + this.y + Math.abs(Math.sin(this.t * 23)) * 0.25 * r, Math.sin(this.t * 29) * 0.1 * r);
    this.bars.rotation.x = Math.sin(this.t * 31) * 0.006 * r;
  }

  /** effects every machine plays for itself (never captured for friends on the host) */
  private local(L: Level3D, f: () => void) {
    const nl = L.nl, cap = !!nl?.capturing;
    if (nl) nl.capturing = false;
    try { f(); } finally { if (nl) nl.capturing = cap; }
  }
}

/**
 * A guard standing in the runner lane: side-steps to stay in front of the hero and lunges with the spear.
 * One hit knocks him out — or jump over him.
 */
export class Blocker3 extends Enemy3 {
  rig: Rig<GuardAnim>;
  state: 'ready' | 'lunge' | 'recover' = 'ready';
  st = 0; near = false;
  /** a shield blocker can't be cut down from the front — jump over it */
  constructor(pos: THREE.Vector3, public range = 2.5, public shield = false) {
    super(shield ? 'shield' : 'guard', pos, 0.38, 0.95);
    this.hp = this.maxHp = shield ? 3 : 1; this.loot = 1;
    this.rig = createGuard(shield ? 'shield' : 'guard');
    this.root.add(this.rig.root);
    this.yaw = -Math.PI / 2;
  }
  tick(L: Level3D, dt: number) {
    const b = this.body, p = L.targetFor(this.body.pos);
    this.st += dt;
    const dx = p.pos.x - b.pos.x;
    this.near = dx > -12 && dx < 1;
    let vz = 0;
    if (this.stun > 0) this.stun -= dt;
    else if (this.state === 'ready') {
      if (dx < -0.5 && dx > -16 && !p.dead) {
        const want = clamp(p.pos.z, this.home.z - this.range, this.home.z + this.range);
        vz = clamp((want - b.pos.z) * 4, -3.4, 3.4);
      }
      if (dx > -2.8 && dx < 0.5 && Math.abs(p.pos.z - b.pos.z) < 1.6 && !p.dead) { this.state = 'lunge'; this.st = 0; audio.sfx('swing', { pitch: 0.8 }); }
    } else if (this.state === 'lunge') {
      if (this.st < 0.2) b.vel.x = -6;
      if (this.st > 0.45) { this.state = 'recover'; this.st = 0; }
    } else if (this.state === 'recover' && this.st > 0.8) this.state = 'ready';
    b.vel.z = vz;
    if (this.state !== 'lunge') b.vel.x = approach0(b.vel.x, 30 * dt);
    L.phys.move(b, dt);
    this.yaw = damp(this.yaw, -Math.PI / 2, 10, dt);
  }
  protected netExtra(): number[] { return [['ready', 'lunge', 'recover'].indexOf(this.state), this.near ? 1 : 0]; }
  protected netExtraApply(a: number[], i: number) { this.state = (['ready', 'lunge', 'recover'] as const)[a[i]] ?? 'ready'; this.near = !!a[i + 1]; }
  hurt(L: Level3D, dmg: number, from: THREE.Vector3, kind: string) {
    if (!L.authority) return;
    const fromFront = from.x < this.body.pos.x - 0.2; // the hero runs in from −X
    if (this.shield && fromFront && !(kind === 'spin' && from.y > this.body.pos.y + 0.8)) {
      audio.sfx('clang'); L.fx.sparks(this.center().add(new THREE.Vector3(-0.5, 0, 0)), 10, ['#ffffff', '#ffe14a', '#c8d0e0']);
      L.fx.text(this.center().setY(this.body.pos.y + 1.8), 'Бдзынь!', '#d8e0f0', 20);
      if (!L.attacker) L.player.body.vel.x -= 6;
      L.hint('shieldRun', 'Щитоносца мечом не пробить — перепрыгни его!');
      return;
    }
    super.hurt(L, dmg, from, kind);
  }
  syncRig(dt: number) {
    const s: GuardAnim['state'] = this.stun > 0 ? 'hurt' : this.state === 'lunge' ? (this.shield ? 'bash' : 'attack') : Math.abs(this.body.vel.z) > 0.4 ? 'walk' : this.shield && this.near ? 'block' : this.near ? 'alert' : 'idle';
    this.rig.update(dt, { state: s, speed: Math.abs(this.body.vel.z) / 3, flash: this.flash });
  }
}
function approach0(v: number, d: number) { return v > 0 ? Math.max(0, v - d) : Math.min(0, v + d); }
