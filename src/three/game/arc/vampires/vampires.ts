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
import { GroundMark, ambient } from './fxUtil';
import { LINES } from './lines';
import { vampBane } from '../../heroes/bane';

/**
 * The vampires of «Ночь клыков» (Enemy3 subclasses; host simulates, clients play the host's snapshots back):
 *   fanger  — Клыкарь: crouches (red spot ahead), lunges and bites: −1 ♥ and «пресный» (slow, grey) for a bit
 *   bat     — Нетопырь-разведчик: weak, flies in flocks; the first one to spot you screeches and calls everyone
 *   flyer   — Летучий клыкарь: circles high, marks a spot on the ground, dives at it, lies dazed after (hit it!)
 *   mist    — Туманник: turns to mist (can't be hit), drifts behind you, forms again (ring) and claws
 *   servant — Невидимка-слуга: invisible; shows in light, dust, when hit or by Ноки's chord; shimmers before a slap
 *   brute   — Упырь-громила: big and slow; raises his fists (red ring), slams: shockwave to jump over, lanterns go out
 * Every vampire: keeps out of the light of «солнышки» (waits at the edge), burns and flees when caught in it, takes ×2
 * damage there; 'chord' hits stun + reveal; HP grows with the party (L.enemy).
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
const TAU = Math.PI * 2;

export abstract class Vamp3 extends Enemy3 implements VampLike {
  readonly vampire = true as const;
  rig: VRig;
  anim: VAnim = { st: 'idle', p: 0, speed: 0, flash: 0 };
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
  protected marks: GroundMark[] = [];
  protected abstract readonly ACTS: readonly string[];
  protected senseT = rand(0, 0.2);
  protected wanderT = rand(1, 3);
  protected wanderTo: THREE.Vector3 | null = null;
  protected barkCD = rand(1, 3);
  /** client: replicated invisibility */
  protected netVis = 1;
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
  }
  protected visuals(_L: Level3D, _dt: number) { /* subclasses: telegraph marks, mist… */ }
  protected pose(): string { return this.act === 'idle' || this.act === 'home' || this.act === 'walk' ? (Math.hypot(this.body.vel.x, this.body.vel.z) > 0.3 ? 'walk' : 'idle') : this.act; }
  syncRig(dt: number) {
    const a = this.anim;
    a.st = this.pose(); a.p = this.pr; a.speed = Math.hypot(this.body.vel.x, this.body.vel.z); a.flash = this.flash;
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
  /** a defeated vampire shrinks into a little bat and flies off to the castle (no blood: smoke, stars, a squeak) */
  deathFx(L: Level3D, c: THREE.Vector3) {
    ambient(L, () => {
      L.fx.emit(c, { count: 26, speed: [1, 4], dir: new THREE.Vector3(0, 1, 0), spread: 0.9, life: [0.5, 1.1], size: [0.2, 0.42], size2: 1.8, colors: ['#4a3a66', '#2b2140', '#8a7ab0'], g: -1, drag: 2 });
      L.fx.stars(c, 10, ['#ffe14a', '#ffffff']);
      audio.sfx('batScreech', { pitch: 1.8, volume: 0.35 });
    });
    L.actors.push(new MouseAway(L, c));
  }
  onHurt(L: Level3D) { L.fx.emit(this.center(), { count: 8, speed: [1.5, 3.5], life: [0.3, 0.6], size: [0.1, 0.18], colors: ['#8a7ab0', '#c4b2e6'], g: 6 }); }
}

/** «Побеждённые вампиры сжимаются в мышат и улетают в замок» — a local effect on every machine */
class MouseAway implements Actor3 {
  dead = false;
  private t = 0;
  private rig = createBat();
  private root = new THREE.Group();
  private vel: THREE.Vector3;
  private anim: VAnim = { st: 'fly', p: 0, speed: 0, flash: 0 };
  constructor(L: Level3D, at: THREE.Vector3) {
    this.root.add(this.rig.root);
    this.root.position.copy(at);
    this.root.scale.setScalar(0.01);
    const a = rand(0, TAU);
    this.vel = new THREE.Vector3(Math.cos(a) * 2.5, 2.2, Math.sin(a) * 2.5);
    L.scene.add(this.root);
  }
  update(_L: Level3D, dt: number) {
    this.t += dt;
    this.vel.y += dt * 1.5;
    this.root.position.addScaledVector(this.vel, dt);
    this.root.rotation.y = Math.atan2(this.vel.x, this.vel.z);
    const s = Math.min(1, this.t * 4) * (this.t > 2 ? Math.max(0.01, 1 - (this.t - 2) * 2) : 1) * 0.6;
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
  private mark = new GroundMark('#ff3040', false);
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
  protected visuals(L: Level3D) {
    if (this.act === 'crouch') {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const b = this.body;
      this.mark.show(L, b.pos.x + fx * 2.1, b.pos.y, b.pos.z + fz * 2.1, 0.9, 0.25 + 0.5 * this.pr);
    } else this.mark.hide();
  }
}

// ═════════════════════════════ НЕТОПЫРЬ ═════════════════════════════
export class Bat3 extends Vamp3 {
  protected readonly ACTS = ['fly', 'screech', 'orbit', 'prep', 'dive', 'stun', 'burn', 'home', 'idle'] as const;
  private dir = new THREE.Vector3();
  private orbitA = rand(0, TAU);
  private orbitDir = Math.random() < 0.5 ? 1 : -1;
  private hit = false;
  private flapT = rand(0, 1);
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
    const b = this.body, t = this.target;
    if ((this.flapT -= dt) <= 0) { this.flapT = rand(0.9, 1.6); if (t) audio.sfx('batFlap', { volume: 0.25, pitch: rand(0.9, 1.3) }); }
    if (this.act === 'dive') {
      b.vel.copy(this.dir).multiplyScalar(10.5);
      if (!this.hit) for (const h of L.alivePlayers()) {
        if (h.center(v2).distanceTo(this.center(v)) < 0.62) { this.hit = true; h.hurt(L, 1, b.pos.clone()); break; }
      }
      if (this.at <= 0 || b.hitWall || b.onGround || this.hit) { this.go('orbit', rand(1.2, 2.2)); b.vel.multiplyScalar(0.3); }
      return;
    }
    if (!t) {
      if (this.act !== 'fly' && this.act !== 'home') this.go('fly');
      const gx = this.home.x + Math.sin(this.t * 0.9) * 1.6, gz = this.home.z + Math.cos(this.t * 0.7) * 1.6, gy = this.home.y + Math.sin(this.t * 2.3) * 0.4;
      b.vel.set((gx - b.pos.x) * 2, (gy - b.pos.y) * 2, (gz - b.pos.z) * 2);
      this.faceToward(gx + Math.cos(this.t), gz - Math.sin(this.t), dt, 4);
      return;
    }
    const tc = t.center(v2);
    if (this.act === 'screech') {
      this.halt(dt, 10); this.faceToward(tc.x, tc.z, dt, 10);
      if (this.at <= 0) { K.alarm(b.pos, 18, t); this.go('orbit', rand(0.8, 1.6)); }
      return;
    }
    if (this.act === 'prep') {
      this.halt(dt, 16); this.faceToward(tc.x, tc.z, dt, 12);
      if (this.at <= 0) {
        this.dir.copy(tc).addScaledVector(t.vel, 0.15).sub(this.center(v)).normalize();
        this.go('dive', 0.7); this.hit = false;
        audio.sfx('whoosh', { volume: 0.35, pitch: 1.6 });
      }
      return;
    }
    // orbit above him; dive when it's my turn (one bat per hero at a time) and he's out of the light
    if (this.act !== 'orbit') this.go('orbit', rand(0.8, 1.6));
    const lit = K.sunAt(t.pos) > 0.3;
    this.orbitA += dt * 1.7 * this.orbitDir;
    const R = lit ? 6.5 : 3.4;
    const gx = tc.x + Math.cos(this.orbitA) * R, gz = tc.z + Math.sin(this.orbitA) * R, gy = tc.y + 2.1 + Math.sin(this.t * 3) * 0.35;
    b.vel.set(clamp((gx - b.pos.x) * 3, -8, 8), clamp((gy - b.pos.y) * 3, -6, 6), clamp((gz - b.pos.z) * 3, -8, 8));
    this.faceToward(tc.x, tc.z, dt, 8);
    const key = 'batDive:' + heroId(t);
    const last = (L.refs[key] as number | undefined) ?? -99;
    if (!lit && this.at <= 0 && L.t - last > 0.65 && this.los(L, t)) {
      L.refs[key] = L.t;
      this.go('prep', 0.38);
    }
  }
  protected burn(L: Level3D, K: VampKit, dt: number) {
    if (this.act !== 'burn') { this.go('burn', 0); audio.sfx('batScreech', { pitch: 1.4, volume: 0.5 }); }
    const away = K.sunAway(this.body.pos, v2);
    const b = this.body;
    if (away) b.vel.set(away.x * 5, 2, away.z * 5); else this.halt(dt);
  }
  protected pose() { return this.act === 'home' || this.act === 'idle' ? 'fly' : this.act; }
  protected dmgMul() { return 1; }
}

// ═════════════════════════════ ЛЕТУЧИЙ КЛЫКАРЬ ═════════════════════════════
export class Flyer3 extends Vamp3 {
  protected readonly ACTS = ['fly', 'stalk', 'aim', 'dive', 'ground', 'rise', 'stun', 'burn', 'home', 'idle'] as const;
  private spot = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private orbitA = rand(0, TAU);
  private hit = false;
  private mark = new GroundMark('#ff3040', true);
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
    const b = this.body, t = this.target;
    switch (this.act) {
      case 'aim':
        this.halt(dt, 12); this.faceToward(this.spot.x, this.spot.z, dt, 10);
        if (this.at <= 0) {
          this.dir.copy(this.spot).setY(this.spot.y + 0.4).sub(this.center(v)).normalize();
          this.go('dive', 1.1); this.hit = false;
          audio.sfx('whoosh', { pitch: 0.9, volume: 0.6 });
        }
        return;
      case 'dive': {
        b.vel.copy(this.dir).multiplyScalar(15);
        if (!this.hit) for (const h of L.alivePlayers()) {
          if (h.center(v2).distanceTo(this.center(v)) < 1.0) { this.hit = true; if (h.hurt(L, 1, b.pos.clone(), new THREE.Vector3(this.dir.x * 8, 6, this.dir.z * 8))) { K.bland(h, 2); audio.sfx('bite'); } break; }
        }
        const reached = Math.hypot(this.spot.x - b.pos.x, this.spot.z - b.pos.z) < 0.6 && b.pos.y < this.spot.y + 1;
        if (this.at <= 0 || b.hitWall || b.onGround || reached) {
          this.go('ground', 1.4); b.gravity = 32; b.vel.set(0, 0, 0);
          L.tcam.shake(0.15); audio.sfx('thud', { volume: 0.6 });
          L.fx.dust(b.pos.clone(), 10, '#b8a8d0');
        }
        return;
      }
      case 'ground':
        this.halt(dt, 20);
        if (this.at <= 0) { this.go('rise', 0.7); b.gravity = 0; b.vel.y = 4.5; }
        return;
      case 'rise':
        b.vel.y = approach(b.vel.y, 3, 10 * dt);
        if (this.at <= 0) { this.go(t ? 'stalk' : 'fly'); this.cd = rand(1.5, 2.6) * this.cdMul(L); }
        return;
    }
    if (!t) {
      if (this.act !== 'fly' && this.act !== 'home') this.go('fly');
      const gx = this.home.x + Math.sin(this.t * 0.5) * 3, gz = this.home.z + Math.cos(this.t * 0.4) * 3;
      const gy = this.home.y + Math.sin(this.t * 1.7) * 0.4;
      b.vel.set((gx - b.pos.x) * 1.5, (gy - b.pos.y) * 2, (gz - b.pos.z) * 1.5);
      this.faceToward(gx + Math.cos(this.t * 0.5), gz - Math.sin(this.t * 0.5), dt, 3);
      return;
    }
    if (this.act !== 'stalk') this.go('stalk');
    const lit = K.sunAt(t.pos) > 0.3;
    this.orbitA += dt * 0.9;
    const R = lit ? 8 : 5.5;
    const gx = t.pos.x + Math.cos(this.orbitA) * R, gz = t.pos.z + Math.sin(this.orbitA) * R;
    const gy = this.hoverY(L, gx, gz, t.pos.y);
    b.vel.set(clamp((gx - b.pos.x) * 2, -7, 7), clamp((gy - b.pos.y) * 2.5, -5, 5), clamp((gz - b.pos.z) * 2, -7, 7));
    this.faceToward(t.pos.x, t.pos.z, dt, 6);
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
    if (away) this.body.vel.set(away.x * 5, 3, away.z * 5); else this.halt(dt);
    if (this.body.pos.y > this.home.y + 6) this.body.vel.y = 0;
  }
  protected dmgMul() { return this.act === 'ground' ? 1.5 : 1; }
  protected pose() { return this.act === 'home' || this.act === 'idle' || this.act === 'stalk' ? 'fly' : this.act; }
  protected netMore() { return [this.spot.x, this.spot.y, this.spot.z]; }
  protected netMoreApply(a: number[], i: number) { this.spot.set(a[i], a[i + 1], a[i + 2]); }
  protected visuals(L: Level3D) {
    if (this.act === 'aim' || this.act === 'dive') this.mark.show(L, this.spot.x, this.spot.y, this.spot.z, 1.3, this.act === 'aim' ? 0.3 + 0.5 * this.pr : 0.8);
    else this.mark.hide();
  }
}

// ═════════════════════════════ ТУМАННИК ═════════════════════════════
export class Mist3 extends Vamp3 {
  protected readonly ACTS = ['idle', 'walk', 'mist', 'form', 'claw', 'recover', 'stun', 'burn', 'home'] as const;
  declare rig: ReturnType<typeof createMistling>;
  private dest = new THREE.Vector3();
  private lantern: Lantern | null = null;
  private clawed = false;
  private mark = new GroundMark('#7ae0ff', true);
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('mist', pos, 0.36, 1.15, createMistling(), o);
    this.hp = this.maxHp = 4; this.loot = 3;
    this.marks.push(this.mark);
  }
  protected untouchable() { return this.act === 'mist' || (this.act === 'form' && this.pr < 0.6); }
  protected burnsNow() { return this.act !== 'mist'; }
  private toMist(L: Level3D, K: VampKit, dest: THREE.Vector3) {
    if (K.sunAt(this.body.pos) > 0.3) return false;
    this.dest.copy(dest);
    this.go('mist', 1.3);
    audio.sfx('mist');
    L.fx.emit(this.center(), { count: 22, speed: [0.5, 2], life: [0.6, 1.1], size: [0.3, 0.6], size2: 1.6, colors: ['#c3cdee', '#9aa6d0', '#ffffff'], g: -0.5, drag: 2, jitter: 0.3 });
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
  protected visuals(L: Level3D) {
    const b = this.body;
    if (this.act === 'form') this.mark.show(L, b.pos.x, b.pos.y, b.pos.z, 1.6, 0.25 + 0.5 * this.pr); else this.mark.hide();
    if ((this.act === 'mist' || this.act === 'form') && Math.random() < 0.6) {
      const c = this.center(v);
      ambient(L, () => L.fx.soft.emit(c.clone(), { count: 1, speed: [0.2, 0.8], life: [0.6, 1.2], size: [0.3, 0.55], size2: 1.8, colors: ['#c3cdee', '#aab4dc'], g: -0.4, drag: 2, jitter: 0.4 }));
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
        if (t) { v.set(b.pos.x - t.pos.x, 0, b.pos.z - t.pos.z).normalize(); this.steer(L, K, b.pos.x + v.x * 2, b.pos.z + v.z * 2, 3.6, dt, true); }
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
}

// ═════════════════════════════ УПЫРЬ-ГРОМИЛА ═════════════════════════════
export class Brute3 extends Vamp3 {
  protected readonly ACTS = ['idle', 'walk', 'raise', 'slam', 'recover', 'punchPrep', 'punch', 'stun', 'burn', 'home'] as const;
  private punchCd = 0;
  private punched = false;
  private ring = new GroundMark('#ff3040', true);
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
  private slam(L: Level3D, K: VampKit) {
    const b = this.body;
    this.go('slam', 0.35);
    L.tcam.shake(0.45);
    audio.sfx('bigSlam');
    const c = b.pos.clone();
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    c.x += fx * 0.6; c.z += fz * 0.6;
    for (const h of L.alivePlayers()) {
      const d = Math.hypot(h.pos.x - c.x, h.pos.z - c.z);
      if (d < 1.9 && h.pos.y - c.y < 1.2) h.hurt(L, 1, c, new THREE.Vector3((h.pos.x - c.x) / Math.max(0.3, d) * 9, 9, (h.pos.z - c.z) / Math.max(0.3, d) * 9), 0.35);
    }
    const gy = L.phys.groundAt(c.x, c.z, c.y + 0.5, 0.2);
    L.addWave(new Wave3(new THREE.Vector3(c.x, gy > -1e8 ? gy : c.y, c.z), 9, Brute3.SLAM_R + 2.4, 0.8));
    K.snuffAround(c, Brute3.SLAM_R + 1);
    L.fx.dust(c.clone(), 24, '#b8a8d0');
    L.fx.ring(c.clone().setY(c.y + 0.1), Brute3.SLAM_R, '#ff6a7a', 0.4);
  }
  protected dmgMul() { return this.act === 'recover' ? 1.5 : 1; }
  protected visuals(L: Level3D) {
    const b = this.body;
    if (this.act === 'raise') {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      this.ring.show(L, b.pos.x + fx * 0.6, b.pos.y, b.pos.z + fz * 0.6, Brute3.SLAM_R * (0.55 + 0.45 * this.pr), 0.3 + 0.5 * this.pr);
    } else this.ring.hide();
  }
}

// ═════════════════════════════ registration ═════════════════════════════
ENEMY_KINDS.fanger = (p, o) => new Fanger3(p, o);
ENEMY_KINDS.bat = (p, o) => new Bat3(p, o);
ENEMY_KINDS.flyer = (p, o) => new Flyer3(p, o);
ENEMY_KINDS.mist = (p, o) => new Mist3(p, o);
ENEMY_KINDS.servant = (p, o) => new Servant3(p, o);
ENEMY_KINDS.brute = (p, o) => new Brute3(p, o);
