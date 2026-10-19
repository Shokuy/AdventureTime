import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { approach, choose, clamp, rand } from '../../../../engine/util';
import { Enemy3, ENEMY_KINDS, type EnemyOpts } from '../../enemies';
import type { Level3D, HeroLike, Actor3 } from '../../level';
import { Wave3 } from '../../objects';
import { vamp, heroId, type VampKit, type VampLike, type Lantern } from './kit';
import { markCharacter } from './greyShader';
import { createFanger, createBat, createFlyer, createMistling, createServant, createBrute, createStars, spinStars, type VRig, type VAnim, type FolkKind } from './models';
import { Invisibility } from './invis';
import { ambient } from './fxUtil';
import { TeleMark, QuakeFx, DeathPoof, puffs, type PoofStyle } from './vfx';
import { LINES } from './lines';
import { vampBane } from '../../heroes/bane';

/**
 * The vampires of «Ночь клыков» (Enemy3 subclasses; host simulates, clients play the host's snapshots back):
 *   fanger  — Клыкарь: crouches (cape spread, a red lane ahead), lunges and bites: −1 ♥ and «пресный» for a bit
 *   bat     — Нетопырь-разведчик: weak, flies in flocks; the first one to spot you screeches and calls everyone.
 *             Flies like a bat: acceleration-limited steering, banked circles over you, then wind-up (rears back,
 *             wings spread) → accelerating dive → swoop out and climb back → cooldown
 *   flyer   — Летучий клыкарь: circles high, marks a spot on the ground, rears back, dives at it, lies dazed after
 *   mist    — Туманник: turns to mist (can't be hit), drifts behind you, forms again (ring) and claws
 *   servant — Невидимка-слуга: invisible; shows in light, dust, when hit or by Ноки's chord; shimmers before a slap
 *   brute   — Упырь-громила: big and slow; raises his fists (a filling red disc), slams: a shockwave to jump over,
 *             lanterns go out
 * Every vampire: keeps out of the light of «солнышки» (waits at the edge), burns and flees when caught in it, takes ×2
 * damage there; 'chord' hits stun + reveal; HP grows with the party (L.enemy). A beaten one pops into smoke (the rig
 * squashes and poofs: vfx.DeathPoof) and little bats fly off to the castle.
 * Visual effects (telegraphs, mist, the slam's wave, trails) are drawn on every machine from the replicated act/pr.
 */

declare module '../../enemies' {
  interface ExtraEnemyKinds { fanger: true; bat: true; flyer: true; mist: true; servant: true; brute: true; presnyak: true }
  interface EnemyOpts {
    /** vampires: how far they notice a hero (m) */
    aggro?: number;
    /** vampires: how far from home they chase before giving up (m) */
    leash?: number;
    /** servant: invisible (default true) */
    invisible?: boolean;
    /** presnyak: which candy townsperson ('zefir' | 'pryanik' | 'marmelad'; default by position) */
    folk?: FolkKind;
  }
}

const v = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export abstract class Vamp3 extends Enemy3 implements VampLike {
  readonly vampire = true as const;
  rig: VRig;
  anim: VAnim = { st: 'idle', p: 0, speed: 0, flash: 0, bank: 0, pitch: 0 };
  /** current action and its timer (progress `pr` 0..1 travels to clients) */
  act = 'idle'; at = 0; atMax = 1; pr = 0;
  cd = rand(0.6, 1.6);
  target: HeroLike | null = null;
  hunting = false;
  aggro: number; leash: number;
  /** light on me (0..1) */
  sun = 0;
  /** keeps out of / burns in the light */
  burns = true;
  stars = createStars();
  invis: Invisibility | null = null;
  protected marks: { dispose(): void }[] = [];
  protected abstract readonly ACTS: readonly string[];
  protected senseT = rand(0, 0.2);
  protected wanderT = rand(1, 3);
  protected wanderTo: THREE.Vector3 | null = null;
  protected barkCD = rand(1, 3);
  /** client: replicated invisibility */
  protected netVis = 1;
  /** every machine: the act seen last frame (visual edges: a slam lands, a dive starts) */
  protected seenAct = '';
  private lastYaw = NaN;
  private bankK = 0;
  constructor(kind: Enemy3['kind'], pos: THREE.Vector3, r: number, h: number, rig: VRig, o: EnemyOpts) {
    super(kind, pos, r, h);
    this.rig = rig;
    this.root.add(rig.root);
    markCharacter(rig.root);
    this.stars.position.y = rig.top + 0.15;
    this.root.add(this.stars);
    this.contact = 0;
    this.yaw = o.yaw ?? rand(0, TAU);
    this.aggro = o.aggro ?? 13;
    this.leash = o.leash ?? 34;
  }

  // ───────── helpers ─────────
  protected go(act: string, secs = 0) { this.act = act; this.at = secs; this.atMax = Math.max(0.001, secs); this.pr = 0; }
  protected cdMul(L: Level3D) { return 1 / (1 + 0.12 * (L.heroes().length - 1)); }
  protected bark(L: Level3D, lines: readonly string[], chance = 1) {
    if (this.barkCD > 0 || Math.random() > chance) return;
    this.barkCD = rand(3, 5);
    L.bark(this.root, choose(lines as string[]), 1.5, this.rig.top + 0.5);
  }
  protected valid(L: Level3D, h: HeroLike | null): h is HeroLike {
    return !!h && !h.dead && !h.downed && !h.hidden && !(h as { stale?: boolean }).stale && L.heroes().includes(h);
  }
  protected los(L: Level3D, h: HeroLike) {
    const eye = this.center(v).setY(this.body.pos.y + this.body.h * 0.8);
    const pc = h.center(v2);
    const d = pc.distanceTo(eye);
    return L.phys.raycast(eye, pc.sub(eye).normalize(), d) >= d - 0.5;
  }
  protected halt(dt: number, k = 18) { const b = this.body; b.vel.x = approach(b.vel.x, 0, k * dt); b.vel.z = approach(b.vel.z, 0, k * dt); if (this.flying) b.vel.y = approach(b.vel.y, 0, k * dt); }
  protected tdist(t: HeroLike) { return Math.hypot(t.pos.x - this.body.pos.x, t.pos.z - this.body.pos.z); }

  /** steer toward (x, z): separation, light avoidance (slides along a light's edge), ledges */
  protected steer(L: Level3D, K: VampKit, x: number, z: number, speed: number, dt: number, face = true) {
    const b = this.body;
    let dx = x - b.pos.x, dz = z - b.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.06) { dx = 0; dz = 0; speed = 0; } else { dx /= d; dz /= d; }
    for (const e of L.enemies) {
      if (e === this || e.dead || e.flying !== this.flying) continue;
      const ox = b.pos.x - e.body.pos.x, oz = b.pos.z - e.body.pos.z;
      const od = Math.hypot(ox, oz), min = b.r + e.body.r + 0.3;
      if (od < min && od > 0.01 && Math.abs(e.body.pos.y - b.pos.y) < 1.5) { const k = ((min - od) / min) * 1.5; dx += (ox / od) * k; dz += (oz / od) * k; }
    }
    const l = Math.hypot(dx, dz);
    if (l > 0.01) { dx /= l; dz /= l; }
    if (this.burns && this.burnsNow() && speed > 0 && this.sun < 0.3) {
      v.set(b.pos.x + dx * 1.3, b.pos.y + 0.5, b.pos.z + dz * 1.3);
      if (K.sunAt(v) > 0.25) {
        const lx = -dz, lz = dx;
        const a = K.sunAt(v.set(b.pos.x + (dx + lx) * 0.9, b.pos.y + 0.5, b.pos.z + (dz + lz) * 0.9));
        const c = K.sunAt(v.set(b.pos.x + (dx - lx) * 0.9, b.pos.y + 0.5, b.pos.z + (dz - lz) * 0.9));
        if (Math.min(a, c) > 0.25) speed = 0;
        else if (a <= c) { dx = lx; dz = lz; } else { dx = -lx; dz = -lz; }
      }
    }
    if (!this.flying && speed > 0 && b.onGround && !this.groundAhead(L, dx, dz)) speed = 0;
    const acc = (this.flying || b.onGround ? 26 : 6) * dt;
    b.vel.x = approach(b.vel.x, dx * speed, acc);
    b.vel.z = approach(b.vel.z, dz * speed, acc);
    if (face && speed > 0.1) this.faceToward(b.pos.x + dx, b.pos.z + dz, dt, 9);
    return d;
  }

  // ───────── flight (bats, flyers) ─────────
  /**
   * Acceleration-limited flight toward a desired velocity (the body keeps its momentum: no snapping, no sliding):
   * separation from other flyers, a floor clearance, light avoidance; faces where it flies when `face`.
   */
  protected fly(L: Level3D, K: VampKit, want: THREE.Vector3, acc: number, dt: number, face = true, clear = 0.9) {
    const b = this.body;
    // keep apart from other flyers (a soft push, mostly sideways)
    for (const e of L.enemies) {
      if (e === this || e.dead || !e.flying) continue;
      const ox = b.pos.x - e.body.pos.x, oy = b.pos.y - e.body.pos.y, oz = b.pos.z - e.body.pos.z;
      const od = Math.hypot(ox, oy, oz), min = b.r + e.body.r + 0.6;
      if (od < min && od > 0.01) { const k = ((min - od) / min) * 4; want.x += (ox / od) * k; want.y += (oy / od) * k * 0.5; want.z += (oz / od) * k; }
    }
    // floor clearance
    const gy = L.phys.groundAt(b.pos.x, b.pos.z, b.pos.y + 0.3, 0.2);
    if (gy > -1e8 && b.pos.y - gy < clear) want.y = Math.max(want.y, (clear - (b.pos.y - gy)) * 6);
    // don't fly into a sunbeam (unless fleeing it)
    if (this.burns && this.act !== 'burn' && this.sun < 0.3) {
      const hs = Math.hypot(want.x, want.z);
      if (hs > 0.5) {
        v3.set(b.pos.x + (want.x / hs) * 1.4, b.pos.y, b.pos.z + (want.z / hs) * 1.4);
        if (K.sunAt(v3) > 0.25) { want.x *= -0.3; want.z *= -0.3; want.y = Math.max(want.y, 1.5); }
      }
    }
    const dx = want.x - b.vel.x, dy = want.y - b.vel.y, dz = want.z - b.vel.z;
    const dl = Math.hypot(dx, dy, dz), mx = acc * dt;
    const k = dl > mx ? mx / dl : 1;
    b.vel.x += dx * k; b.vel.y += dy * k; b.vel.z += dz * k;
    if (face) this.faceVel(dt, 7);
  }
  /** turn toward the direction of flight (rate-limited, so turns read as arcs) */
  protected faceVel(dt: number, rate = 7) {
    const b = this.body;
    const hs = Math.hypot(b.vel.x, b.vel.z);
    if (hs > 0.6) this.faceToward(b.pos.x + b.vel.x, b.pos.z + b.vel.z, dt, rate + 10 * Math.max(0, 1 - hs / 4));
  }
  /** which way to circle (cx, cz) to keep the current momentum (+1 / −1) */
  protected circleDirFor(cx: number, cz: number, fallback: number) {
    const b = this.body;
    const d = -(b.pos.z - cz) * b.vel.x + (b.pos.x - cx) * b.vel.z;
    return Math.abs(d) < 0.3 ? fallback : d > 0 ? 1 : -1;
  }
  /** desired velocity that circles (cx, cz) at radius R (dir ±1), correcting radius smoothly; y toward gy */
  protected circleVel(out: THREE.Vector3, cx: number, cz: number, R: number, speed: number, dir: number, gy: number) {
    const b = this.body;
    let rx = b.pos.x - cx, rz = b.pos.z - cz;
    let r = Math.hypot(rx, rz);
    if (r < 0.05) { rx = Math.sin(this.yaw); rz = Math.cos(this.yaw); r = 1; }
    rx /= r; rz /= r;
    const err = clamp((R - r) * 1.2, -1.2, 1.2);
    out.set(-rz * dir + rx * err, 0, rx * dir + rz * err).normalize().multiplyScalar(speed);
    out.y = clamp((gy - b.pos.y) * 2, -3.5, 3.5);
    return out;
  }

  // ───────── kit hooks ─────────
  alert(_L: Level3D, target: HeroLike) {
    if (this.dead) return;
    this.target = target;
    if (!this.hunting) { this.hunting = true; this.onSpot(_L, target, false); }
  }
  provoke(L: Level3D) { this.leash = 999; this.aggro = 999; this.target = L.targetFor(this.body.pos); this.hunting = true; }
  stunFor(L: Level3D, secs: number) {
    if (this.dead) return;
    this.stun = Math.max(this.stun, secs);
    this.go('stun', this.stun);
    this.flash = 1;
    L.fx.stars(this.center().setY(this.body.pos.y + this.rig.top), 10);
  }
  reveal(secs: number) { this.invis?.reveal(secs); }

  /** a hero noticed: "!" (+ a bark) */
  protected onSpot(L: Level3D, _t: HeroLike, loud = true) {
    L.fx.text(this.center().setY(this.body.pos.y + this.rig.top + 0.5), '!', '#ff3a4a', 34);
    if (loud) audio.sfx('hiss', { volume: 0.5, pitch: rand(0.9, 1.15) });
  }

  // ───────── main loop (host) ─────────
  tick(L: Level3D, dt: number) {
    const K = vamp(L);
    K.activate();
    const b = this.body;
    this.at -= dt; this.cd -= dt; this.barkCD -= dt;
    this.pr = clamp(1 - this.at / this.atMax, 0, 1);
    this.sun = this.burns ? K.sunAt(this.center(v)) : 0;
    this.invis?.think(dt, { sun: this.sun, dust: K.dustAt(b.pos), moving: Math.hypot(b.vel.x, b.vel.z) > 0.4, extra: this.shimmer() });
    if (this.stun > 0) {
      this.stun -= dt;
      if (this.act !== 'stun') this.go('stun', this.stun);
      this.halt(dt, 10);
      if (this.flying && b.gravity === 0) b.vel.y = approach(b.vel.y, -1, 4 * dt);
      L.phys.move(b, dt);
      if (this.stun <= 0) { this.go(this.flying ? 'fly' : 'idle'); if (this.flying) b.gravity = 0; }
      return;
    }
    this.sense(L, dt);
    if (this.sun > 0.3 && this.burnsNow()) { this.burn(L, K, dt); L.phys.move(b, dt); return; }
    if (this.act === 'burn') this.go(this.flying ? 'fly' : 'idle');
    this.brain(L, K, dt);
    L.phys.move(b, dt);
  }

  /** notice heroes; give up a chase that went too far from home */
  protected sense(L: Level3D, dt: number) {
    const b = this.body;
    if (this.hunting) {
      if (!this.valid(L, this.target)) {
        const t = L.targetFor(b.pos, this.aggro * 1.6);
        this.target = this.valid(L, t) && t.pos.distanceTo(b.pos) < this.aggro * 1.6 ? t : null;
        if (!this.target) { this.hunting = false; this.go('home'); }
      } else if (this.home.distanceTo(b.pos) > this.leash) { this.hunting = false; this.target = null; this.go('home'); }
      return;
    }
    if ((this.senseT -= dt) > 0) return;
    this.senseT = 0.2;
    let best: HeroLike | null = null, bd = this.aggro;
    for (const h of L.alivePlayers()) { const d = h.pos.distanceTo(b.pos); if (d < bd && this.los(L, h)) { bd = d; best = h; } }
    if (best) { this.target = best; this.hunting = true; this.onSpot(L, best); }
  }

  /** caught in the light: smoke, can't attack, out of it */
  protected burnsNow() { return true; }
  protected burn(L: Level3D, K: VampKit, dt: number) {
    if (this.act !== 'burn') { this.go('burn', 0); this.bark(L, LINES.fangerLight, 0.6); audio.sfx('hiss', { pitch: 1.4, volume: 0.6 }); }
    const away = K.sunAway(this.body.pos, v2);
    if (away) this.steer(L, K, this.body.pos.x + away.x * 3, this.body.pos.z + away.z * 3, 2.6, dt, true);
    else this.halt(dt);
  }

  /** wander near home / walk home */
  protected idle(L: Level3D, K: VampKit, dt: number, speed = 1.4) {
    const b = this.body;
    if (this.act === 'home') {
      const d = this.steer(L, K, this.home.x, this.home.z, speed * 1.6, dt);
      if (d < 1) this.go('idle');
      return;
    }
    if ((this.wanderT -= dt) <= 0) {
      this.wanderT = rand(2, 4.5);
      const a = rand(0, TAU), r = rand(0.5, 3);
      this.wanderTo = Math.random() < 0.35 ? null : new THREE.Vector3(this.home.x + Math.cos(a) * r, b.pos.y, this.home.z + Math.sin(a) * r);
    }
    if (this.wanderTo) { if (this.steer(L, K, this.wanderTo.x, this.wanderTo.z, speed, dt) < 0.4) this.wanderTo = null; }
    else this.halt(dt);
  }

  /** what this vampire does this tick (host) */
  protected abstract brain(L: Level3D, K: VampKit, dt: number): void;
  /** extra visibility for the invisible (e.g. a shimmer before a slap) */
  protected shimmer(): number | undefined { return undefined; }
  /** damage multiplier (dazed / recovering = vulnerable) */
  protected dmgMul() { return 1; }
  /** can't be hit now (mist) */
  protected untouchable() { return false; }

  hurt(L: Level3D, dmg: number, from: THREE.Vector3, kind: string) {
    if (!L.authority || this.dead) return;
    if (kind === 'chord') { this.stunFor(L, 2.2); this.reveal(4); if (dmg <= 0) return; }
    if (this.untouchable()) { L.fx.text(this.center().setY(this.body.pos.y + 1.2), 'мимо!', '#c8d0ff', 20); return; }
    // (× Ноки's bane: the vampire hunter hits vampires ×1.5 — heroes/bane.ts)
    let d = dmg * this.dmgMul() * vampBane(L, kind);
    if (this.sun > 0.3 || kind === 'sun') { d *= 2; L.fx.text(this.center().setY(this.body.pos.y + this.rig.top + 0.9), 'Солнце жжёт! ×2', '#ffd34a', 20); }
    if (kind === 'syrup') { this.stun = Math.max(this.stun, 1.2); this.barkCD = 0; this.bark(L, LINES.fangerSyrup, 0.8); }
    this.invis?.reveal(2.5);
    const by = this.attackerHero(L);
    if (!this.hunting || this.target !== by) { this.target = by; this.hunting = true; }
    super.hurt(L, d, from, kind);
  }

  // ───────── co-op ─────────
  protected netExtra(): number[] {
    return [this.ACTS.indexOf(this.act), this.pr, this.sun, this.invis ? this.invis.goal : 1, this.hunting ? 1 : 0, ...this.netMore()];
  }
  protected netExtraApply(a: number[], i: number) {
    this.act = this.ACTS[a[i]] ?? this.ACTS[0];
    this.pr = a[i + 1]; this.sun = a[i + 2]; this.netVis = a[i + 3]; this.hunting = !!a[i + 4];
    this.netMoreApply(a, i + 5);
  }
  protected netMore(): number[] { return []; }
  protected netMoreApply(_a: number[], _i: number) { /* subclasses */ }

  // ───────── visuals (every machine) ─────────
  sync(L: Level3D, dt: number) {
    super.sync(L, dt);
    if (this.dead) return;
    const stunned = this.act === 'stun' && (L.authority ? this.atMax > 0.6 : true);
    this.stars.visible = stunned;
    if (stunned) spinStars(this.stars, this.t, 0.28 + this.body.r * 0.3);
    if (this.invis) this.invis.apply(dt, L.authority ? this.invis.goal : this.netVis);
    if (this.act === 'burn' && Math.random() < 0.5) {
      const c = this.center(v);
      ambient(L, () => L.fx.soft.emit(c.clone().setY(c.y + 0.2), { count: 1, speed: [0.6, 1.4], dir: new THREE.Vector3(0, 1, 0), spread: 0.4, life: [0.5, 0.9], size: [0.18, 0.32], size2: 2.2, colors: ['#4a4458', '#7a7488', '#ffb060'], g: -2, drag: 2, jitter: 0.25 }));
    }
    this.visuals(L, dt);
    this.seenAct = this.act;
  }
  protected visuals(_L: Level3D, _dt: number) { /* subclasses: telegraph marks, mist… */ }
  protected pose(): string { return this.act === 'idle' || this.act === 'home' || this.act === 'walk' ? (Math.hypot(this.body.vel.x, this.body.vel.z) > 0.3 ? 'walk' : 'idle') : this.act; }
  syncRig(dt: number) {
    const a = this.anim;
    a.st = this.pose(); a.p = this.pr; a.speed = Math.hypot(this.body.vel.x, this.body.vel.z); a.flash = this.flash;
    if (this.flying) {
      // bank into turns (yaw rate × speed) and pitch with the climb / dive — from what every machine sees
      const yr = Number.isNaN(this.lastYaw) || dt <= 0 ? 0 : wrapA(this.yaw - this.lastYaw) / dt;
      this.bankK += (clamp(yr * 0.32 * Math.min(1, a.speed / 3), -1, 1) - this.bankK) * Math.min(1, dt * 8);
      a.bank = this.bankK;
      a.pitch = Math.atan2(-this.body.vel.y, Math.max(1.5, a.speed));
    }
    this.lastYaw = this.yaw;
    this.rig.update(dt, a);
  }
  protected cleanup() { for (const m of this.marks) m.dispose(); this.marks = []; }
  die(L: Level3D) { this.cleanup(); super.die(L); }
  netEvent(L: Level3D, ev: string, data?: unknown) {
    if (ev === 'gone') {
      this.cleanup();
      const d = (data ?? {}) as { how?: string; at?: THREE.Vector3 | null };
      if (d.how === 'die' && !this.dead) this.deathFx(L, d.at ?? this.center());
    }
    super.netEvent(L, ev);
  }
  /** how this vampire pops when beaten (null: the old generic smoke + one bat) */
  protected poof(): PoofStyle | null { return null; }
  /** a defeated vampire pops into smoke and little bats fly off to the castle (no blood: smoke, stars, a squeak) */
  deathFx(L: Level3D, c: THREE.Vector3) {
    const st = this.poof();
    if (st && this.rig.root.parent) {
      // the rig plays its last moment where it stood (the enemy itself is gone this tick)
      const holder = new THREE.Group();
      this.root.updateMatrixWorld(true);
      this.root.matrixWorld.decompose(holder.position, holder.quaternion, holder.scale);
      holder.add(this.rig.root);
      this.stars.visible = false;
      audio.sfx('batScreech', { pitch: 1.8, volume: 0.35 });
      L.actors.push(new DeathPoof(L, this.rig, holder, st, (at) => {
        for (let i = 0; i < st.bats; i++) L.actors.push(new MouseAway(L, at, i, st.bats));
      }));
      return;
    }
    ambient(L, () => {
      L.fx.emit(c, { count: 26, speed: [1, 4], dir: new THREE.Vector3(0, 1, 0), spread: 0.9, life: [0.5, 1.1], size: [0.2, 0.42], size2: 1.8, colors: ['#4a3a66', '#2b2140', '#8a7ab0'], g: -1, drag: 2 });
      L.fx.stars(c, 10, ['#ffe14a', '#ffffff']);
      audio.sfx('batScreech', { pitch: 1.8, volume: 0.35 });
    });
    L.actors.push(new MouseAway(L, c));
  }
  /** host (captured for friends): a hit — sparks, a pink flash ring, puffs of the vampire's colour */
  onHurt(L: Level3D) {
    const c = this.center();
    L.fx.emit(c, { count: 8, speed: [1.5, 3.5], life: [0.3, 0.6], size: [0.1, 0.18], colors: ['#8a7ab0', '#c4b2e6'], g: 6 });
    L.fx.glow.emit(c, { count: 7, speed: [3, 7], life: [0.12, 0.28], size: [0.12, 0.24], colors: ['#ffffff', '#ffb0d0', '#ffe14a'], drag: 6 });
    L.fx.ring(c, 0.7 + this.body.r, '#ffd0e8', 0.16, false);
  }
}

/** «Побеждённые вампиры сжимаются в мышат и улетают в замок» — a local effect on every machine */
class MouseAway implements Actor3 {
  dead = false;
  private t = 0;
  private rig = createBat();
  private root = new THREE.Group();
  private vel: THREE.Vector3;
  private anim: VAnim = { st: 'fly', p: 0, speed: 4, flash: 0, bank: 0, pitch: -0.3 };
  private wob = rand(0, TAU);
  constructor(L: Level3D, at: THREE.Vector3, i = 0, n = 1) {
    this.root.add(this.rig.root);
    this.root.position.copy(at);
    this.root.scale.setScalar(0.01);
    const a = n > 1 ? (i / n) * TAU + rand(-0.3, 0.3) : rand(0, TAU);
    this.vel = new THREE.Vector3(Math.cos(a) * 2.5, 2.2 + rand(0, 0.8), Math.sin(a) * 2.5);
    this.t = -i * 0.06;
    L.scene.add(this.root);
  }
  update(_L: Level3D, dt: number) {
    this.t += dt;
    // a fluttery climb (accelerating up and away, weaving)
    this.vel.y += dt * 1.8;
    this.vel.x += Math.cos(this.t * 7 + this.wob) * dt * 3;
    this.vel.z += Math.sin(this.t * 6 + this.wob) * dt * 3;
    this.root.position.addScaledVector(this.vel, dt);
    this.root.rotation.y = Math.atan2(this.vel.x, this.vel.z);
    this.anim.bank = Math.sin(this.t * 7 + this.wob) * 0.6;
    const s = Math.min(1, Math.max(0, this.t) * 5) * (this.t > 2 ? Math.max(0.01, 1 - (this.t - 2) * 2) : 1) * 0.6;
    this.root.scale.setScalar(Math.max(0.01, s));
    this.rig.update(dt, this.anim);
    if (this.t > 2.5) { this.dead = true; this.root.removeFromParent(); }
  }
}

// ═════════════════════════════ КЛЫКАРЬ ═════════════════════════════
export class Fanger3 extends Vamp3 {
  protected readonly ACTS = ['idle', 'walk', 'crouch', 'lunge', 'recover', 'hiss', 'stun', 'burn', 'home'] as const;
  private dir = new THREE.Vector3(0, 0, 1);
  private bitten = false;
  private mark = new TeleMark('#ff3040', 'lane');
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('fanger', pos, 0.36, 1.0, createFanger(), o);
    this.hp = this.maxHp = 3; this.loot = 2;
    this.marks.push(this.mark);
  }
  protected brain(L: Level3D, K: VampKit, dt: number) {
    const b = this.body, t = this.target;
    if (this.act === 'lunge') {
      b.vel.x = this.dir.x * 11.5; b.vel.z = this.dir.z * 11.5;
      const mouth = this.center(v).addScaledVector(this.dir, 0.45);
      if (!this.bitten) for (const h of L.alivePlayers()) {
        const c = h.center(v2);
        if (Math.hypot(c.x - mouth.x, c.z - mouth.z) < 0.8 && Math.abs(c.y - mouth.y) < 0.9) {
          this.bitten = true;
          if (h.hurt(L, 1, b.pos.clone())) { K.bland(h, 2.5); audio.sfx('bite'); this.bark(L, LINES.fangerBite, 0.5); }
          break;
        }
      }
      if (this.at <= 0 || b.hitWall) { this.go('recover', 0.75); b.vel.x *= 0.3; b.vel.z *= 0.3; }
      return;
    }
    if (this.act === 'recover') { this.halt(dt, 14); if (this.at <= 0) this.go('walk'); return; }
    if (this.act === 'crouch') {
      this.halt(dt, 30);
      if (t && this.pr < 0.7) this.faceToward(t.pos.x, t.pos.z, dt, 10);
      if (this.at <= 0) {
        this.dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        this.go('lunge', 0.36); this.bitten = false;
        audio.sfx('swing', { pitch: 1.3 });
      }
      return;
    }
    if (!t) { this.idle(L, K, dt); return; }
    const dist = this.tdist(t), dy = t.pos.y - b.pos.y;
    if (K.sunAt(t.pos) > 0.3) {
      // can't get at him in the light: prowl around its edge, hissing
      this.go('hiss');
      this.steer(L, K, t.pos.x, t.pos.z, 2.2, dt, true);
      this.faceToward(t.pos.x, t.pos.z, dt, 6);
      this.bark(L, LINES.fangerLight, 0.02);
      return;
    }
    if (dist > 2.3) { this.go('walk'); this.steer(L, K, t.pos.x, t.pos.z, 4.3, dt); return; }
    if (this.cd <= 0 && b.onGround && Math.abs(dy) < 1.2) {
      this.go('crouch', 0.55); this.cd = rand(1.7, 2.5) * this.cdMul(L);
      audio.sfx('hiss', { volume: 0.45 });
      return;
    }
    this.go('walk');
    this.halt(dt); this.faceToward(t.pos.x, t.pos.z, dt, 10);
  }
  protected onSpot(L: Level3D, t: HeroLike, loud = true) { super.onSpot(L, t, loud); if (loud) this.bark(L, LINES.fangerSpot, 0.5); }
  protected dmgMul() { return this.act === 'recover' ? 1.5 : 1; }
  protected poof(): PoofStyle { return { smoke: ['#4a3a66', '#2b2140', '#6a5490'], ash: ['#ff4a5a', '#ffb0c0', '#ffe14a'], bats: 2, size: 1, kind: 'pop' }; }
  protected visuals(L: Level3D, dt: number) {
    const b = this.body;
    if (this.act === 'crouch') this.mark.show(L, b.pos.x, b.pos.y, b.pos.z, 0.5, this.pr, 0.5 + 0.5 * this.pr, dt, 2.7, this.yaw);
    else if (this.act === 'lunge') this.mark.show(L, b.pos.x, b.pos.y, b.pos.z, 0.5, 1, Math.max(0, 1 - this.pr * 1.5), dt, 2.7, this.yaw);
    else this.mark.hide();
    // pounce: a kick of dust, then a smoky streak behind the cape
    if (this.act === 'lunge' && this.seenAct !== 'lunge') puffs(L, v.copy(b.pos).setY(b.pos.y + 0.1), { count: 8, speed: [1, 2.5], spread: 1, flat: 0.8, life: [0.4, 0.7], size: [0.25, 0.4], grow: 2, colors: ['#a898c0', '#8a7c9e'], alpha: 0.6, drag: 3, jitter: 0.2, tiles: [0, 2] });
    if (this.act === 'lunge' && Math.random() < 0.8) puffs(L, this.center(v).setY(b.pos.y + 0.55), { count: 1, speed: [0.1, 0.4], life: [0.3, 0.5], size: [0.3, 0.45], grow: 1.6, colors: ['#3a2d58', '#2b2140', '#5a4880'], alpha: 0.55, g: -0.2, tiles: [1, 3] });
    // the crouch: a shiver of red sparks in the eyes (and claws)
    if (this.act === 'crouch' && this.pr > 0.55 && Math.random() < 0.35) ambient(L, () => L.fx.glow.emit(this.center(v).setY(b.pos.y + 0.8), { count: 1, speed: [0.3, 1], life: [0.2, 0.4], size: [0.06, 0.1], colors: ['#ff3040', '#ff8090'], g: -1, jitter: 0.25 }));
  }
}

// ═════════════════════════════ НЕТОПЫРЬ ═════════════════════════════
/**
 * Flight: the bat keeps its momentum — every phase only changes the velocity it wants and how hard it may accelerate
 * (fly()), and it always faces where it flies (except while hovering to screech / aim), banking into turns.
 *   fly (patrol: wide banked circles around home, now and then reversing in an S-turn) → spots you → screech (hover,
 *   wings flared; the first one calls the flock) → orbit (banked circles above you) → prep (wind-up: brakes, rears
 *   back, wings spread, eyes flare) → dive (accelerates from its speed up to 13 m/s, homing only at the start) →
 *   swoop (pulls up, keeps its momentum, climbs back) → orbit with a cooldown.
 * (The old orbit set the velocity straight from a point that ran round the hero and faced the hero meanwhile: the bat
 * moved sideways — "sliding" — and snapped between phases with no acceleration.)
 */
export class Bat3 extends Vamp3 {
  protected readonly ACTS = ['fly', 'screech', 'orbit', 'prep', 'dive', 'stun', 'burn', 'home', 'idle', 'swoop'] as const;
  private dir = new THREE.Vector3();
  private orbitDir = Math.random() < 0.5 ? 1 : -1;
  private patrolDir = Math.random() < 0.5 ? 1 : -1;
  private patrolT = rand(4, 8);
  private hit = false;
  private flapT = rand(0, 1);
  private diveV = 0;
  private want = new THREE.Vector3();
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('bat', pos, 0.28, 0.4, createBat(), { aggro: 12, ...o });
    this.hp = this.maxHp = 1; this.loot = 1;
    this.flying = true; this.body.gravity = 0;
    this.blob.visible = false;
    this.go('fly');
  }
  protected onSpot(L: Level3D, t: HeroLike, loud = true) {
    super.onSpot(L, t, false);
    // the first bat to see you screams for the others (one scream per few seconds around here)
    const last = (L.refs.batScreechT as number | undefined) ?? -99;
    if (loud && L.t - last > 4) { L.refs.batScreechT = L.t; this.go('screech', 0.75); audio.sfx('batScreech'); this.bark(L, LINES.batScreech, 0.8); }
    else this.go('orbit', rand(0.6, 1.4));
  }
  protected brain(L: Level3D, K: VampKit, dt: number) {
    const b = this.body, t = this.target, w = this.want;
    if ((this.flapT -= dt) <= 0) { this.flapT = rand(0.9, 1.6); if (t) audio.sfx('batFlap', { volume: 0.25, pitch: rand(0.9, 1.3) }); }
    if (this.act === 'dive') {
      // accelerate along the dive line; steer a little toward him only in its first part (readable, dodgeable)
      this.diveV = Math.min(13, this.diveV + 30 * dt);
      if (t && this.pr < 0.25) {
        v.copy(t.center(v2)).sub(this.center(v3)).normalize();
        const ang = this.dir.angleTo(v);
        if (ang > 1e-3) this.dir.lerp(v, Math.min(1, (1.6 * dt) / ang)).normalize();
      }
      // (velocity eases onto the dive line: a strong but finite acceleration, no snap)
      v.copy(this.dir).multiplyScalar(this.diveV).sub(b.vel);
      const dl = v.length(), mx = 60 * dt;
      b.vel.addScaledVector(v, dl > mx ? mx / dl : 1);
      this.faceToward(b.pos.x + this.dir.x, b.pos.z + this.dir.z, dt, 14);
      if (!this.hit) for (const h of L.alivePlayers()) {
        if (h.center(v2).distanceTo(this.center(v)) < 0.62) { this.hit = true; h.hurt(L, 1, b.pos.clone()); break; }
      }
      // pull out early enough to clear the floor (≈ 0.2 s before it)
      const gy = L.phys.groundAt(b.pos.x, b.pos.z, b.pos.y + 0.3, 0.2);
      const low = gy > -1e8 && b.vel.y < 0 && (b.pos.y - gy - 0.25) / -b.vel.y < 0.2;
      const passed = t ? this.dir.dot(v.copy(t.center(v2)).sub(this.center(v3))) < -0.4 : true;
      if (this.at <= 0 || b.hitWall || b.onGround || this.hit || low || passed) {
        this.go('swoop', 0.9);
        if (b.onGround) b.vel.y = Math.max(b.vel.y, 0);
        audio.sfx('whoosh', { volume: 0.2, pitch: 2 });
      }
      return;
    }
    if (this.act === 'swoop') {
      // pull out of the dive: keep the horizontal momentum, climb back over him
      const hs = Math.hypot(b.vel.x, b.vel.z);
      const fx = hs > 0.3 ? b.vel.x / hs : Math.sin(this.yaw), fz = hs > 0.3 ? b.vel.z / hs : Math.cos(this.yaw);
      const sp = Math.max(4.5, hs * 0.92);
      const ty = t ? t.center(v2).y + 2.1 : this.home.y;
      w.set(fx * sp, clamp((ty - b.pos.y) * 3 + 1.5, 1, 5.5), fz * sp);
      this.fly(L, K, w, 28, dt, true, 0.6);
      if (this.at <= 0 || (this.pr > 0.4 && b.pos.y > ty - 0.3)) {
        if (t) this.orbitDir = this.circleDirFor(t.pos.x, t.pos.z, this.orbitDir);
        this.go(t ? 'orbit' : 'fly', rand(1.1, 2));
      }
      return;
    }
    if (!t) {
      // patrol: wide banked circles around home, now and then reversing (an S-turn)
      if (this.act !== 'fly' && this.act !== 'home') this.go('fly');
      if ((this.patrolT -= dt) <= 0) { this.patrolT = rand(5, 9); this.patrolDir *= -1; }
      const gy = this.home.y + Math.sin(this.t * 0.9) * 0.45;
      this.circleVel(w, this.home.x, this.home.z, 2.4, 3.1, this.patrolDir, gy);
      this.fly(L, K, w, 7, dt);
      return;
    }
    const tc = t.center(v2);
    if (this.act === 'screech') {
      // hover in place, flared, glaring at him
      w.set(0, (tc.y + 2 - b.pos.y) * 1.5, 0);
      this.fly(L, K, w, 9, dt, false);
      this.faceToward(tc.x, tc.z, dt, 10);
      if (this.at <= 0) { K.alarm(b.pos, 18, t); this.orbitDir = this.circleDirFor(tc.x, tc.z, this.orbitDir); this.go('orbit', rand(0.8, 1.6)); }
      return;
    }
    if (this.act === 'prep') {
      // wind-up: brake, rear back and up a little, face him
      v.set(b.pos.x - tc.x, 0, b.pos.z - tc.z).normalize();
      w.set(v.x * 0.9, 1.2, v.z * 0.9);
      this.fly(L, K, w, 16, dt, false);
      this.faceToward(tc.x, tc.z, dt, 14);
      if (this.at <= 0) {
        this.dir.copy(tc).addScaledVector(t.vel, 0.18).sub(this.center(v)).normalize();
        this.diveV = Math.max(2.5, b.vel.dot(this.dir));
        this.go('dive', 0.7); this.hit = false;
        audio.sfx('whoosh', { volume: 0.35, pitch: 1.6 });
      }
      return;
    }
    // orbit above him (banked circles); dive when it's my turn (one bat per hero at a time) and he's out of the light
    if (this.act !== 'orbit') { this.orbitDir = this.circleDirFor(tc.x, tc.z, this.orbitDir); this.go('orbit', rand(0.8, 1.6)); }
    const lit = K.sunAt(t.pos) > 0.3;
    const R = lit ? 6.5 : 3.4;
    const gy = tc.y + 2.1 + Math.sin(this.t * 2.2) * 0.35;
    this.circleVel(w, tc.x, tc.z, R, 5.2, this.orbitDir, gy);
    // match his movement so the circle travels with him
    w.x += t.vel.x * 0.8; w.z += t.vel.z * 0.8;
    this.fly(L, K, w, 12, dt);
    if (b.hitWall) this.orbitDir *= -1;
    const key = 'batDive:' + heroId(t);
    const last = (L.refs[key] as number | undefined) ?? -99;
    if (!lit && this.at <= 0 && L.t - last > 0.65 && Math.hypot(b.pos.x - tc.x, b.pos.z - tc.z) < R + 1.5 && this.los(L, t)) {
      L.refs[key] = L.t;
      this.go('prep', 0.45);
      audio.sfx('batScreech', { volume: 0.18, pitch: 2.2 });
    }
  }
  protected burn(L: Level3D, K: VampKit, dt: number) {
    if (this.act !== 'burn') { this.go('burn', 0); audio.sfx('batScreech', { pitch: 1.4, volume: 0.5 }); }
    const away = K.sunAway(this.body.pos, v2);
    if (away) { this.want.set(away.x * 6, 2, away.z * 6); this.fly(L, K, this.want, 16, dt); } else this.halt(dt, 8);
  }
  protected pose() { return this.act === 'home' || this.act === 'idle' ? 'fly' : this.act; }
  protected dmgMul() { return 1; }
  protected poof(): PoofStyle { return { smoke: ['#4a3a66', '#6a5490', '#2b2140'], ash: ['#ffe14a', '#ffb0c0'], bats: 0, size: 0.55, kind: 'pop' }; }
  protected visuals(L: Level3D) {
    // a whoosh trail while diving
    if (this.act === 'dive' && Math.random() < 0.7) puffs(L, this.center(v), { count: 1, speed: [0, 0.2], life: [0.2, 0.35], size: [0.18, 0.28], grow: 1.4, colors: ['#5a4880', '#3b2b52'], alpha: 0.45, g: 0, tiles: [1, 3] });
  }
}

// ═════════════════════════════ ЛЕТУЧИЙ КЛЫКАРЬ ═════════════════════════════
export class Flyer3 extends Vamp3 {
  protected readonly ACTS = ['fly', 'stalk', 'aim', 'dive', 'ground', 'rise', 'stun', 'burn', 'home', 'idle'] as const;
  private spot = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private hit = false;
  private diveV = 0;
  private circDir = Math.random() < 0.5 ? 1 : -1;
  private want = new THREE.Vector3();
  private mark = new TeleMark('#ff3040', 'target');
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('flyer', pos, 0.42, 0.95, createFlyer(), { aggro: 16, ...o });
    this.hp = this.maxHp = 4; this.loot = 3;
    this.flying = true; this.body.gravity = 0;
    this.marks.push(this.mark);
    this.go('fly');
  }
  private hoverY(L: Level3D, x: number, z: number, base: number) {
    const gy = L.phys.groundAt(x, z, base + 6, 0.2);
    return (gy > -1e8 ? Math.max(gy, base - 2) : base) + 3.6;
  }
  protected brain(L: Level3D, K: VampKit, dt: number) {
    const b = this.body, t = this.target, w = this.want;
    switch (this.act) {
      case 'aim':
        // wind-up: brake into a hover, rear back and up, glare at the spot
        v.set(b.pos.x - this.spot.x, 0, b.pos.z - this.spot.z).normalize();
        w.set(v.x * 1.2, 1.0, v.z * 1.2);
        this.fly(L, K, w, 12, dt, false);
        this.faceToward(this.spot.x, this.spot.z, dt, 10);
        if (this.at <= 0) {
          this.dir.copy(this.spot).setY(this.spot.y + 0.4).sub(this.center(v)).normalize();
          this.diveV = Math.max(3, b.vel.dot(this.dir));
          this.go('dive', 1.1); this.hit = false;
          audio.sfx('whoosh', { pitch: 0.9, volume: 0.6 });
        }
        return;
      case 'dive': {
        this.diveV = Math.min(16, this.diveV + 40 * dt);
        v.copy(this.dir).multiplyScalar(this.diveV).sub(b.vel);
        const dl = v.length(), mx = 70 * dt;
        b.vel.addScaledVector(v, dl > mx ? mx / dl : 1);
        this.faceToward(b.pos.x + this.dir.x, b.pos.z + this.dir.z, dt, 14);
        if (!this.hit) for (const h of L.alivePlayers()) {
          if (h.center(v2).distanceTo(this.center(v)) < 1.0) { this.hit = true; if (h.hurt(L, 1, b.pos.clone(), new THREE.Vector3(this.dir.x * 8, 6, this.dir.z * 8))) { K.bland(h, 2); audio.sfx('bite'); } break; }
        }
        const reached = Math.hypot(this.spot.x - b.pos.x, this.spot.z - b.pos.z) < 0.6 && b.pos.y < this.spot.y + 1;
        if (this.at <= 0 || b.hitWall || b.onGround || reached) {
          this.go('ground', 1.4); b.gravity = 32; b.vel.set(this.dir.x * 2, 0, this.dir.z * 2);
          L.tcam.shake(0.15); audio.sfx('thud', { volume: 0.6 });
          L.fx.dust(b.pos.clone(), 10, '#b8a8d0');
        }
        return;
      }
      case 'ground':
        this.halt(dt, 10);
        if (this.at <= 0) { this.go('rise', 0.7); b.gravity = 0; b.vel.y = 2.5; }
        return;
      case 'rise':
        // big flaps: accelerate up, bleed off the drift
        w.set(0, 3.4, 0);
        this.fly(L, K, w, 9, dt, false, 0);
        if (this.at <= 0) { this.go(t ? 'stalk' : 'fly'); this.cd = rand(1.5, 2.6) * this.cdMul(L); }
        return;
    }
    if (!t) {
      if (this.act !== 'fly' && this.act !== 'home') this.go('fly');
      const gy = this.home.y + Math.sin(this.t * 0.8) * 0.4;
      this.circleVel(w, this.home.x, this.home.z, 3, 2.6, this.circDir, gy);
      this.fly(L, K, w, 5, dt);
      return;
    }
    if (this.act !== 'stalk') { this.circDir = this.circleDirFor(t.pos.x, t.pos.z, this.circDir); this.go('stalk'); }
    const lit = K.sunAt(t.pos) > 0.3;
    const R = lit ? 8 : 5.5;
    // circle him high up (banking), the circle travels with him
    const ax = b.pos.x - t.pos.x, az = b.pos.z - t.pos.z, ar = Math.max(0.1, Math.hypot(ax, az));
    const gy = this.hoverY(L, t.pos.x + (ax / ar) * R, t.pos.z + (az / ar) * R, t.pos.y);
    this.circleVel(w, t.pos.x, t.pos.z, R, 4.6, this.circDir, gy);
    w.x += t.vel.x * 0.7; w.z += t.vel.z * 0.7;
    this.fly(L, K, w, 9, dt);
    if (b.hitWall) this.circDir *= -1;
    if (!lit && this.cd <= 0 && this.los(L, t)) {
      const gyT = L.phys.groundAt(t.pos.x, t.pos.z, t.pos.y + 0.5, 0.1);
      this.spot.set(t.pos.x + t.vel.x * 0.35, gyT > -1e8 ? gyT : t.pos.y, t.pos.z + t.vel.z * 0.35);
      this.go('aim', 0.85);
      audio.sfx('warn', { volume: 0.25, pitch: 1.5 });
    }
  }
  protected burn(L: Level3D, K: VampKit, dt: number) {
    if (this.act !== 'burn') { this.go('burn', 0); this.body.gravity = 0; audio.sfx('hiss', { pitch: 1.3 }); }
    const away = K.sunAway(this.body.pos, v2);
    if (away) { this.want.set(away.x * 5, this.body.pos.y > this.home.y + 6 ? 0 : 3, away.z * 5); this.fly(L, K, this.want, 12, dt); } else this.halt(dt, 8);
  }
  protected dmgMul() { return this.act === 'ground' ? 1.5 : 1; }
  protected pose() { return this.act === 'home' || this.act === 'idle' || this.act === 'stalk' ? 'fly' : this.act; }
  protected netMore() { return [this.spot.x, this.spot.y, this.spot.z]; }
  protected netMoreApply(a: number[], i: number) { this.spot.set(a[i], a[i + 1], a[i + 2]); }
  protected poof(): PoofStyle { return { smoke: ['#3d2b5c', '#2f2347', '#6a5490'], ash: ['#ff4a5a', '#ffe14a', '#ffb0c0'], bats: 3, size: 1.1, kind: 'topple' }; }
  protected visuals(L: Level3D, dt: number) {
    if (this.act === 'aim' || this.act === 'dive') this.mark.show(L, this.spot.x, this.spot.y, this.spot.z, 1.3, this.act === 'aim' ? this.pr : 1, this.act === 'aim' ? 0.55 + 0.45 * this.pr : 1, dt);
    else this.mark.hide();
    const b = this.body;
    if (this.act === 'dive' && Math.random() < 0.8) puffs(L, this.center(v), { count: 1, speed: [0, 0.2], life: [0.25, 0.4], size: [0.3, 0.45], grow: 1.5, colors: ['#4a3a66', '#3d2b5c'], alpha: 0.45, g: 0, tiles: [1, 3] });
    if (this.act === 'ground' && this.seenAct === 'dive') puffs(L, v.copy(b.pos).setY(b.pos.y + 0.15), { count: 12, speed: [1.5, 3.5], spread: 1, flat: 0.85, life: [0.5, 0.9], size: [0.3, 0.5], grow: 2, colors: ['#a898c0', '#8a7c9e', '#c4b8d4'], alpha: 0.6, drag: 3, jitter: 0.3, tiles: [0, 2] });
    if (this.act === 'rise' && Math.random() < 0.3) puffs(L, v.copy(b.pos).setY(b.pos.y + 0.05), { count: 1, speed: [1, 2], spread: 1, flat: 0.9, life: [0.4, 0.7], size: [0.25, 0.4], grow: 1.8, colors: ['#a898c0', '#8a7c9e'], alpha: 0.4, tiles: [0, 2] });
  }
}

// ═════════════════════════════ ТУМАННИК ═════════════════════════════
export class Mist3 extends Vamp3 {
  protected readonly ACTS = ['idle', 'walk', 'mist', 'form', 'claw', 'recover', 'stun', 'burn', 'home'] as const;
  declare rig: ReturnType<typeof createMistling>;
  private dest = new THREE.Vector3();
  private lantern: Lantern | null = null;
  private clawed = false;
  private mark = new TeleMark('#7ae0ff', 'fill');
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('mist', pos, 0.36, 1.15, createMistling(), o);
    this.hp = this.maxHp = 4; this.loot = 3;
    this.marks.push(this.mark);
    this.blob.scale.setScalar(0.6);
  }
  protected untouchable() { return this.act === 'mist' || (this.act === 'form' && this.pr < 0.6); }
  protected burnsNow() { return this.act !== 'mist'; }
  private toMist(L: Level3D, K: VampKit, dest: THREE.Vector3) {
    if (K.sunAt(this.body.pos) > 0.3) return false;
    this.dest.copy(dest);
    this.go('mist', 1.3);
    audio.sfx('mist');
    return true;
  }
  protected brain(L: Level3D, K: VampKit, dt: number) {
    const b = this.body, t = this.target;
    switch (this.act) {
      case 'mist': {
        const d = this.steer(L, K, this.dest.x, this.dest.z, 9, dt, true);
        if (d < 0.5 || this.at <= 0) {
          const lt = this.lantern;
          if (lt) {
            if (lt.lit && Math.hypot(lt.pos.x - b.pos.x, lt.pos.z - b.pos.z) < 2.5) { lt.snuff(); this.bark(L, LINES.mistSnuff, 1); }
            this.lantern = null;
          }
          this.go('form', 0.6); this.halt(dt, 40);
        }
        return;
      }
      case 'form':
        this.halt(dt, 30);
        if (t) this.faceToward(t.pos.x, t.pos.z, dt, 12);
        if (this.at <= 0) { this.go('claw', 0.28); this.clawed = false; audio.sfx('swing', { pitch: 0.9 }); }
        return;
      case 'claw': {
        this.halt(dt, 20);
        if (!this.clawed && this.pr > 0.3) {
          const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
          for (const h of L.alivePlayers()) {
            v.set(h.pos.x - b.pos.x, 0, h.pos.z - b.pos.z);
            const d = v.length();
            if (d < 1.6 && Math.abs(h.pos.y - b.pos.y) < 1.3 && (d < 0.4 || (v.x * fx + v.z * fz) / d > 0.1)) {
              this.clawed = true;
              h.hurt(L, 1, b.pos.clone(), new THREE.Vector3(fx * 9, 5, fz * 9));
            }
          }
        }
        if (this.at <= 0) { this.go('recover', 0.9); this.cd = rand(2.4, 3.4) * this.cdMul(L); }
        return;
      }
      case 'recover': this.halt(dt); if (this.at <= 0) this.go('walk'); return;
    }
    if (!t) { this.idle(L, K, dt, 1.2); return; }
    const dist = this.tdist(t);
    // he hides in the light: go put the nearest lantern out (as mist)
    if (K.sunAt(t.pos) > 0.3 && this.cd <= 0) {
      const lt = K.litLanternNear(t.pos, 9);
      if (lt && this.toMist(L, K, v.set(lt.pos.x + 0.6, lt.pos.y, lt.pos.z + 0.6))) { this.lantern = lt; this.cd = 3; return; }
    }
    if (dist < 7 && this.cd <= 0 && K.sunAt(t.pos) < 0.3) {
      // drift behind him
      const f = t.forward(v2);
      const bx = t.pos.x - f.x * 1.8, bz = t.pos.z - f.z * 1.8;
      if (K.sunAt(v.set(bx, t.pos.y, bz)) < 0.3 && this.toMist(L, K, v)) { this.bark(L, LINES.mist, 0.4); return; }
    }
    this.go('walk');
    if (dist > 1.4) this.steer(L, K, t.pos.x, t.pos.z, 2.5, dt); else { this.halt(dt); this.faceToward(t.pos.x, t.pos.z, dt, 8); }
  }
  hurt(L: Level3D, dmg: number, from: THREE.Vector3, kind: string) {
    const wasWalking = this.act === 'walk' || this.act === 'idle';
    super.hurt(L, dmg, from, kind);
    // stung while walking: slips away as mist now and then
    if (!this.dead && wasWalking && kind !== 'chord' && Math.random() < 0.4) {
      const a = rand(0, TAU);
      this.stun = 0;
      this.toMist(L, vamp(L), v.set(this.body.pos.x + Math.cos(a) * 5, this.body.pos.y, this.body.pos.z + Math.sin(a) * 5));
    }
  }
  protected dmgMul() { return this.act === 'recover' ? 1.5 : 1; }
  protected poof(): PoofStyle { return { smoke: ['#d4dcf8', '#aab4dc', '#8a94c6'], ash: ['#7ae0ff', '#ffffff', '#c8f4ff'], bats: 1, size: 1.3, kind: 'dissolve' }; }
  protected visuals(L: Level3D, dt: number) {
    const b = this.body;
    if (this.act === 'form') this.mark.show(L, b.pos.x, b.pos.y, b.pos.z, 1.6, this.pr, 0.6 + 0.4 * this.pr, dt); else this.mark.hide();
    const sp = Math.hypot(b.vel.x, b.vel.z);
    // turning to mist: a burst; drifting as mist: a long trail; forming: wisps pulled in
    if (this.act === 'mist' && this.seenAct !== 'mist') puffs(L, this.center(v), { count: 18, speed: [0.6, 2.2], spread: 1, life: [0.7, 1.3], size: [0.35, 0.6], grow: 1.9, colors: ['#dfe6ff', '#aab4dc', '#8a94c6'], alpha: 0.75, g: -0.3, drag: 2.2, jitter: 0.3, tiles: [0, 1, 2], swirl: 2.5 });
    if (this.act === 'mist' && sp > 1 && Math.random() < 0.9) puffs(L, v.copy(b.pos).setY(b.pos.y + rand(0.2, 1)), { count: 1, speed: [0.1, 0.5], life: [0.7, 1.2], size: [0.35, 0.55], grow: 1.8, colors: ['#c9d2f4', '#9aa6d0'], alpha: 0.5, g: -0.15, drag: 2, jitter: 0.3, tiles: [1, 3] });
    if (this.act === 'walk' && sp > 0.5 && Math.random() < 0.35) puffs(L, v.copy(b.pos).setY(b.pos.y + 0.15), { count: 1, speed: [0.1, 0.4], life: [0.6, 1], size: [0.3, 0.45], grow: 1.7, colors: ['#c9d2f4', '#9aa6d0'], alpha: 0.4, g: -0.1, tiles: [1, 3] });
    // the claw leaves a misty streak
    if (this.act === 'claw' && this.pr > 0.2 && this.pr < 0.85) {
      this.rig.claw.getWorldPosition(v);
      puffs(L, v, { count: 2, speed: [0, 0.3], life: [0.25, 0.45], size: [0.16, 0.26], grow: 1.5, colors: ['#e8f0ff', '#9ae8ff'], alpha: 0.7, g: 0, tiles: [1, 3] });
      puffs(L, v, { count: 1, speed: [0, 0.3], life: [0.2, 0.35], size: [0.1, 0.16], grow: 0.6, colors: ['#7ae0ff'], alpha: 0.8, additive: true, tiles: [0] });
    }
  }
}

// ═════════════════════════════ НЕВИДИМКА-СЛУГА ═════════════════════════════
export class Servant3 extends Vamp3 {
  protected readonly ACTS = ['idle', 'walk', 'windup', 'slap', 'retreat', 'stun', 'burn', 'home'] as const;
  private slapped = false;
  private wasSeen = false;
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('servant', pos, 0.34, 0.95, createServant(), o);
    this.hp = this.maxHp = 3; this.loot = 3;
    if (o.invisible !== false) { this.invis = new Invisibility(this.rig.root, this.blob); this.netVis = 0; }
  }
  protected shimmer() { return this.act === 'windup' ? 0.35 : undefined; }
  protected onSpot(L: Level3D) { audio.sfx('hiss', { pitch: 1.9, volume: 0.25 }); }
  protected brain(L: Level3D, K: VampKit, dt: number) {
    const b = this.body, t = this.target;
    const seen = !!this.invis && this.invis.goal > 0.8;
    if (seen && !this.wasSeen) this.bark(L, LINES.servantSeen, 0.5);
    this.wasSeen = seen;
    switch (this.act) {
      case 'windup':
        this.halt(dt, 24);
        if (t) this.faceToward(t.pos.x, t.pos.z, dt, 12);
        if (this.at <= 0) { this.go('slap', 0.35); this.slapped = false; audio.sfx('swing', { pitch: 1.7, volume: 0.6 }); }
        return;
      case 'slap': {
        this.halt(dt, 20);
        if (!this.slapped && this.pr > 0.25) {
          const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
          for (const h of L.alivePlayers()) {
            v.set(h.pos.x - b.pos.x, 0, h.pos.z - b.pos.z);
            const d = v.length();
            if (d < 1.4 && Math.abs(h.pos.y - b.pos.y) < 1.2 && (d < 0.4 || (v.x * fx + v.z * fz) / d > 0.2)) { this.slapped = true; h.hurt(L, 1, b.pos.clone()); }
          }
        }
        if (this.at <= 0) { this.go('retreat', 1.2); this.cd = rand(1.4, 2.4) * this.cdMul(L); }
        return;
      }
      case 'retreat':
        if (t) { v.set(b.pos.x - t.pos.x, 0, b.pos.z - t.pos.z).normalize(); this.steer(L, K, b.pos.x + v.x * 2, b.pos.z + v.z * 2, 3.6, dt, false); this.faceToward(t.pos.x, t.pos.z, dt, 8); }
        if (this.at <= 0) this.go('walk');
        return;
    }
    if (!t) { this.idle(L, K, dt, 1.3); return; }
    const dist = this.tdist(t);
    if (dist > 1.3) { this.go('walk'); this.steer(L, K, t.pos.x, t.pos.z, 3.3, dt); }
    else { this.halt(dt); this.faceToward(t.pos.x, t.pos.z, dt, 10); }
    if (dist < 1.7 && this.cd <= 0 && Math.abs(t.pos.y - b.pos.y) < 1.2) {
      this.go('windup', 0.5);
      audio.sfx('hiss', { pitch: 2, volume: 0.3 });
      this.bark(L, LINES.servant, 0.35);
    }
  }
  hurt(L: Level3D, dmg: number, from: THREE.Vector3, kind: string) {
    super.hurt(L, dmg, from, kind);
    if (!this.dead && kind !== 'chord') this.stun = Math.max(this.stun, 0.6);
  }
  protected poof(): PoofStyle { return { smoke: ['#4a4458', '#262033', '#7a7488'], ash: ['#ffd36a', '#ffffff', '#ff9ac0'], bats: 1, size: 1, kind: 'pop' }; }
  deathFx(L: Level3D, c: THREE.Vector3) {
    // seen at last: he shows fully for his poof, the tray clatters
    if (this.invis) { this.invis.vis = 0.999; this.invis.apply(0, 1); }
    ambient(L, () => L.fx.chunks(c.clone().setY(c.y + 0.4), 6, ['#d8dce6', '#b8bcc8', '#ffffff'], this.body.pos.y, [0.05, 0.1]));
    super.deathFx(L, c);
  }
  protected visuals(L: Level3D) {
    // a half-seen servant leaves a faint shimmer of dust when he moves
    const b = this.body;
    if (this.invis && this.invis.vis < 0.5 && Math.hypot(b.vel.x, b.vel.z) > 1 && Math.random() < 0.08) puffs(L, v.copy(b.pos).setY(b.pos.y + 0.05), { count: 1, speed: [0.1, 0.3], life: [0.4, 0.7], size: [0.2, 0.3], grow: 1.6, colors: ['#8a7f9c'], alpha: 0.25, tiles: [0, 2] });
  }
}

// ═════════════════════════════ УПЫРЬ-ГРОМИЛА ═════════════════════════════
export class Brute3 extends Vamp3 {
  protected readonly ACTS = ['idle', 'walk', 'raise', 'slam', 'recover', 'punchPrep', 'punch', 'stun', 'burn', 'home'] as const;
  private punchCd = 0;
  private punched = false;
  private ring = new TeleMark('#ff3040', 'fill');
  private step = 0;
  static SLAM_R = 3.4;
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('brute', pos, 0.6, 1.75, createBrute(), { aggro: 12, ...o });
    this.hp = this.maxHp = 12; this.loot = 6; this.heavy = 0.75;
    this.marks.push(this.ring);
  }
  /** in the light he doesn't run: he smashes the lantern */
  protected burnsNow() { return false; }
  protected onSpot(L: Level3D, t: HeroLike, loud = true) { super.onSpot(L, t, loud); this.bark(L, LINES.bruteSpot, 0.7); }
  protected brain(L: Level3D, K: VampKit, dt: number) {
    const b = this.body, t = this.target;
    this.punchCd -= dt;
    switch (this.act) {
      case 'raise':
        this.halt(dt, 20);
        if (t && this.pr < 0.6) this.faceToward(t.pos.x, t.pos.z, dt, 4);
        if (this.at <= 0) this.slam(L, K);
        return;
      case 'slam': if (this.at <= 0) { this.go('recover', 1.3); this.bark(L, LINES.bruteTired, 0.4); } return;
      case 'recover': this.halt(dt); if (this.at <= 0) this.go('walk'); return;
      case 'punchPrep':
        this.halt(dt, 24); if (t) this.faceToward(t.pos.x, t.pos.z, dt, 8);
        if (this.at <= 0) { this.go('punch', 0.25); this.punched = false; audio.sfx('swingHeavy', { pitch: 0.8 }); }
        return;
      case 'punch': {
        this.halt(dt, 20);
        if (!this.punched) {
          const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
          for (const h of L.alivePlayers()) {
            v.set(h.pos.x - b.pos.x, 0, h.pos.z - b.pos.z);
            const d = v.length();
            if (d < 2 && Math.abs(h.pos.y - b.pos.y) < 1.5 && (d < 0.5 || (v.x * fx + v.z * fz) / d > 0.3)) { this.punched = true; h.hurt(L, 1, b.pos.clone(), new THREE.Vector3(fx * 13, 7, fz * 13), 0.35); }
          }
        }
        if (this.at <= 0) { this.go('walk'); this.punchCd = rand(1.2, 2); }
        return;
      }
    }
    // lit up: smash the lantern
    if (this.sun > 0.3 && this.cd <= 0) {
      const lt = K.litLanternNear(b.pos, 4.2);
      if (lt) { this.raise(L); this.bark(L, LINES.bruteLight, 1); return; }
    }
    if (!t) { this.idle(L, K, dt, 1.1); return; }
    const dist = this.tdist(t);
    if (dist < 1.8 && this.punchCd <= 0) { this.go('punchPrep', 0.5); audio.sfx('warn', { volume: 0.25, pitch: 1.1 }); return; }
    if (dist < Brute3.SLAM_R - 0.4 && this.cd <= 0) { this.raise(L); return; }
    // a lit lantern between him and the hero: walk to it and smash it
    if (K.sunAt(t.pos) > 0.3) {
      const lt = K.litLanternNear(t.pos, 8);
      if (lt) { this.go('walk'); this.steer(L, K, lt.pos.x, lt.pos.z, 2.3, dt); this.bark(L, LINES.bruteLight, 0.02); return; }
    }
    this.go('walk');
    if (dist > 1.5) this.steer(L, K, t.pos.x, t.pos.z, 2.3, dt); else { this.halt(dt); this.faceToward(t.pos.x, t.pos.z, dt, 5); }
  }
  private raise(L: Level3D) {
    this.go('raise', 1.0); this.cd = rand(3, 4.2) * this.cdMul(L);
    audio.sfx('roar', { pitch: 0.7, volume: 0.6 });
  }
  /** where the fists land (every machine computes it from the replicated pose) */
  private slamAt(L: Level3D, out: THREE.Vector3) {
    const b = this.body;
    out.set(b.pos.x + Math.sin(this.yaw) * 0.6, b.pos.y, b.pos.z + Math.cos(this.yaw) * 0.6);
    const gy = L.phys.groundAt(out.x, out.z, out.y + 0.5, 0.2);
    if (gy > -1e8) out.y = gy;
    return out;
  }
  private slam(L: Level3D, K: VampKit) {
    this.go('slam', 0.35);
    L.tcam.shake(0.55);
    L.hitstop(0.06);
    audio.sfx('bigSlam');
    const c = this.slamAt(L, new THREE.Vector3());
    for (const h of L.alivePlayers()) {
      const d = Math.hypot(h.pos.x - c.x, h.pos.z - c.z);
      if (d < 1.9 && h.pos.y - c.y < 1.2) h.hurt(L, 1, c, new THREE.Vector3((h.pos.x - c.x) / Math.max(0.3, d) * 9, 9, (h.pos.z - c.z) / Math.max(0.3, d) * 9), 0.35);
    }
    // the gameplay wave (replicated; its plain torus is hidden by the QuakeFx every machine draws)
    L.addWave(new Wave3(c.clone(), 9, Brute3.SLAM_R + 2.4, 0.8));
    K.snuffAround(c, Brute3.SLAM_R + 1);
  }
  protected dmgMul() { return this.act === 'recover' ? 1.5 : 1; }
  protected poof(): PoofStyle { return { smoke: ['#5a4a70', '#3a2d58', '#7a6c9c'], ash: ['#ff4a5a', '#ffe14a', '#ffb0c0'], bats: 5, size: 2, kind: 'topple' }; }
  protected visuals(L: Level3D, dt: number) {
    const b = this.body;
    if (this.act === 'raise') {
      const c = this.slamAt(L, v);
      this.ring.show(L, c.x, c.y, c.z, Brute3.SLAM_R, this.pr, 0.55 + 0.45 * this.pr, dt);
      // pebbles and dust lifting off the ground as he gathers strength
      if (this.pr > 0.3 && Math.random() < 0.4) { const a = rand(0, TAU), r = rand(0.5, Brute3.SLAM_R); ambient(L, () => L.fx.soft.emit(v2.set(c.x + Math.cos(a) * r, c.y + 0.05, c.z + Math.sin(a) * r), { count: 1, speed: [0.5, 1.5], dir: UP, spread: 0.1, life: [0.4, 0.7], size: [0.05, 0.09], colors: ['#8a7f9c', '#6d6380'], g: 2, drag: 1 })); }
    } else this.ring.hide();
    // the slam lands: the shockwave (drawn locally, synced to the gameplay wave's radius)
    if (this.act === 'slam' && this.seenAct !== 'slam') L.actors.push(new QuakeFx(L, this.slamAt(L, new THREE.Vector3()), 0.8, 9, Brute3.SLAM_R + 2.4));
    // heavy footsteps: a puff of dust under each stomp
    const sp = Math.hypot(b.vel.x, b.vel.z);
    if (sp > 0.3 && this.act !== 'slam') {
      this.step += dt * sp * 2.0;
      if (this.step > Math.PI) {
        this.step -= Math.PI;
        const side = Math.random() < 0.5 ? 1 : -1, cx = Math.cos(this.yaw), cz = -Math.sin(this.yaw);
        puffs(L, v.set(b.pos.x + cx * side * 0.25, b.pos.y + 0.05, b.pos.z + cz * side * 0.25), { count: 3, speed: [0.5, 1.4], spread: 1, flat: 0.9, life: [0.4, 0.7], size: [0.22, 0.35], grow: 1.8, colors: ['#a898c0', '#8a7c9e'], alpha: 0.45, drag: 3, tiles: [0, 2] });
      }
    }
  }
}

// ═════════════════════════════ registration ═════════════════════════════
ENEMY_KINDS.fanger = (p, o) => new Fanger3(p, o);
ENEMY_KINDS.bat = (p, o) => new Bat3(p, o);
ENEMY_KINDS.flyer = (p, o) => new Flyer3(p, o);
ENEMY_KINDS.mist = (p, o) => new Mist3(p, o);
ENEMY_KINDS.servant = (p, o) => new Servant3(p, o);
ENEMY_KINDS.brute = (p, o) => new Brute3(p, o);
