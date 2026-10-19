import * as THREE from 'three';
import { audio } from '../../engine/audio';
import { save } from '../../engine/save';
import { approach, choose, clamp, damp, lerp, rand } from '../../engine/util';
import { makeBody, Body } from '../physics/world';
import { createGuard, createMeatball, createJelly, createBookBat } from '../models';
import type { GuardAnim, GuardKind, GuardRig } from '../models';
import type { Rig } from '../models/rig';
import { basic, noOutline } from '../gfx';
import { makeBlob } from '../fx';
import type { Level3D, HeroLike } from './level';
import { Bomb3 } from './bombs';
import { NET_SPAWN } from './netLevel';
import type { Netted } from './netLevel';
import { NetTrack, type NetPose } from './netInterp';

/**
 * Enemy kinds added by other modules (e.g. arc/vampires): declare them by merging into this interface —
 * `declare module '<path>/enemies' { interface ExtraEnemyKinds { fanger: true } }` — and register the class in
 * ENEMY_KINDS; then `L.enemy('fanger', …)` / `L.spawnEnemy` / waves / co-op spawns work like for the built-in ones.
 */
export interface ExtraEnemyKinds {}
export type EnemyKind = 'guard' | 'spitter' | 'meatball' | 'jelly' | 'book' | 'shield' | 'bomber' | 'charger' | keyof ExtraEnemyKinds;
/** factories for ExtraEnemyKinds (kind → new enemy at pos) */
export const ENEMY_KINDS: Record<string, (pos: THREE.Vector3, o: EnemyOpts) => Enemy3> = {};
export interface EnemyOpts {
  range?: number; yaw?: number; hue?: 0 | 1 | 2; to?: THREE.Vector3;
  /** patrol route (x, z) — the guard walks it and looks around at every point */
  path?: [number, number][];
  /** jelly: a small one (big ones split in two) */
  small?: boolean;
  /** stays on its post (turrets on ledges): turns and attacks but never walks off */
  post?: boolean;
}

const v = new THREE.Vector3();
const v2 = new THREE.Vector3();
const netPose: NetPose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };

export abstract class Enemy3 implements Netted {
  /** co-op: replicated id (see NetLevel) */
  netId = 0;
  netKind = 'enemy';
  netFar = 80;
  get netRoot() { return this.root; }
  /** client puppet: the host's snapshots of me, played back smoothly at NetLevel.playT (see netInterp.ts) */
  protected netTrack: NetTrack<number[]> | null = null;
  body: Body;
  root = new THREE.Group();
  blob: THREE.Mesh;
  hp = 2; maxHp = 2;
  flash = 0; stun = 0; lastHit = -1; contact = 1; t = rand(0, 10);
  loot = 2; yaw = 0; spawnT = 0; dead = false; arena = false; heavy = 0; flying = false;
  home: THREE.Vector3;
  /** session key (anti-farming: an enemy killed before a respawn drops nothing the second time) */
  key: string | null = null;
  constructor(public kind: EnemyKind, pos: THREE.Vector3, r: number, h: number) {
    this.body = makeBody(r, h);
    this.body.pos.copy(pos);
    this.home = pos.clone();
    this.blob = makeBlob(r * 1.4);
  }
  abstract tick(L: Level3D, dt: number): void;
  abstract syncRig(dt: number): void;
  /** hunt the hero for good (boss summons, ambushes): never gives up the chase */
  provoke(_L: Level3D) { /* overridden by enemies that hunt */ }

  center(out = new THREE.Vector3()) { return out.copy(this.body.pos).setY(this.body.pos.y + this.body.h * 0.5); }

  // ───── co-op replication ─────
  /** host: [x, y, z, yaw, flash, hp, ...extra] */
  netSnap(): number[] {
    const b = this.body;
    return [b.pos.x, b.pos.y, b.pos.z, this.yaw, this.flash > 0.5 ? 1 : 0, this.hp, ...this.netExtra()];
  }
  netApply(a: number[], t?: number) {
    if (t === undefined) { this.body.pos.set(a[0], a[1], a[2]); this.yaw = a[3]; this.netFields(a); return; }
    // pose + flash / hp / extra are applied when the playback reaches this snapshot (a swing shows where it happened)
    (this.netTrack ??= new NetTrack<number[]>(30)).push(t, a[0], a[1], a[2], a[3], a);
  }
  private netFields(a: number[]) {
    if (a[4]) this.flash = 1;
    this.hp = a[5];
    this.netExtraApply(a, 6);
  }
  protected netExtra(): number[] { return []; }
  protected netExtraApply(_a: number[], _i: number) { /* subclasses */ }
  netEvent(L: Level3D, ev: string) {
    if (ev === 'gone') { this.dead = true; L.countKill(this); }
  }
  /** client: play the host's copy back smoothly and animate */
  protected puppet(L: Level3D, dt: number) {
    if (this.spawnT > 0) { this.spawnT -= dt; this.root.scale.setScalar(Math.max(0.01, 1 - Math.max(0, this.spawnT) / 0.6)); }
    else this.root.scale.setScalar(1);
    const tr = this.netTrack, p = L.nl?.playT ?? -Infinity;
    if (tr && tr.eval(p, dt, netPose)) {
      this.body.pos.copy(netPose.pos);
      this.body.vel.copy(netPose.vel);
      this.yaw = netPose.yaw;
    }
    tr?.passed(p, (a) => this.netFields(a));
    this.sync(L, dt);
  }
  /** the hero who just hit me (host resolving a friend's swing) */
  protected attackerHero(L: Level3D): HeroLike { return (L.attacker && L.remote(L.attacker)) || L.player; }

  update(L: Level3D, dt: number) {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 6);
    if (!L.authority) { this.puppet(L, dt); return; }
    if (this.spawnT > 0) {
      this.spawnT -= dt;
      const k = 1 - Math.max(0, this.spawnT) / 0.6;
      this.root.scale.setScalar(Math.max(0.01, k));
      this.sync(L, dt);
      return;
    }
    this.root.scale.setScalar(1);
    this.tick(L, dt);
    if (this.contact > 0) for (const p of L.alivePlayers()) {
      const pb = p.body, b = this.body;
      const dxz = Math.hypot(pb.pos.x - b.pos.x, pb.pos.z - b.pos.z);
      if (dxz < pb.r + b.r * 0.9 && pb.pos.y < b.pos.y + b.h && pb.pos.y + pb.h > b.pos.y) p.hurt(L, this.contact, this.center());
    }
    if (!this.flying && L.phys.hazardAt(this.body)) { this.loot = Math.min(this.loot, 1); this.die(L); return; }
    if (this.body.pos.y < L.killY - 5) { this.dead = true; L.countKill(this); L.nl?.gone(this, 'fall'); }
    this.sync(L, dt);
  }

  sync(L: Level3D, dt: number) {
    this.root.position.copy(this.body.pos);
    this.root.rotation.y = this.yaw;
    this.syncRig(dt);
    const b = this.body;
    const gy = L.phys.groundAt(b.pos.x, b.pos.z, b.pos.y + 0.1, 0.05);
    if (gy > -1e8) {
      this.blob.visible = true;
      this.blob.position.set(b.pos.x, gy + 0.03, b.pos.z);
      const s = clamp(1 - (b.pos.y - gy) * 0.08, 0.3, 1);
      this.blob.scale.set(s, s, s);
    } else this.blob.visible = false;
  }

  hurt(L: Level3D, dmg: number, from: THREE.Vector3, kind: string) {
    if (!L.authority || this.dead) return;
    dmg = Math.round(dmg);
    this.hp -= dmg;
    this.flash = 1;
    this.stun = Math.max(this.stun, 0.3 * (1 - this.heavy * 0.6));
    v.copy(this.body.pos).sub(from).setY(0);
    if (v.lengthSq() < 1e-4) v.set(0, 0, 1);
    v.normalize().multiplyScalar(7 * (1 - this.heavy));
    this.body.vel.x = v.x; this.body.vel.z = v.z;
    if (!this.flying) this.body.vel.y = Math.max(this.body.vel.y, 5 * (1 - this.heavy));
    audio.sfx('hit', { pitch: rand(0.9, 1.15) });
    const c = this.center();
    L.fx.sparks(c, 10);
    L.fx.text(c.clone().setY(c.y + 0.8), String(dmg), kind === 'fork' || dmg >= 3 ? '#ffe14a' : '#ffffff', dmg >= 3 ? 28 : 22);
    L.noise(this.body.pos, 9, { target: this.attackerHero(L).pos });
    this.onHurt(L);
    if (this.hp <= 0) this.die(L);
  }

  onHurt(L: Level3D) { L.fx.juice(this.center(), 10, undefined, this.body.pos.y); }

  die(L: Level3D) {
    if (this.dead) return;
    this.dead = true;
    audio.sfx('enemyDie');
    L.tcam.shake(0.15);
    const c = this.center();
    L.fx.ring(c, 1.6, '#ffffff', 0.3, false);
    this.deathFx(L, c);
    const loot = this.loot > 0 ? this.loot + (save.data.upgrades.magnet ? 1 : 0) : 0;
    L.nl?.gone(this, 'die', c);
    for (let i = 0; i < loot; i++) L.dropPickup(Math.random() < 0.08 ? 'bigcrumb' : 'crumb', c);
    if (this.loot > 0 && Math.random() < 0.09) L.dropPickup('heart', c);
    if (save.data.abilities.slingshot && Math.random() < 0.3) L.dropPickup('peas', c);
    L.countKill(this);
  }

  deathFx(L: Level3D, c: THREE.Vector3) {
    L.fx.juice(c, 22, undefined, this.body.pos.y);
    L.fx.chunks(c, 9, ['#3e9a3a', '#ff5468', '#20662a'], this.body.pos.y, [0.1, 0.2]);
    L.fx.chunks(c, 8, ['#2a1b1a'], this.body.pos.y, [0.04, 0.07]);
  }

  /** is there walkable, hazard-free ground a bit ahead? */
  groundAhead(L: Level3D, dx: number, dz: number, dist = 0.7) {
    const b = this.body;
    const x = b.pos.x + dx * dist, z = b.pos.z + dz * dist;
    const gy = L.phys.groundAt(x, z, b.pos.y + 0.5, 0.05);
    if (gy <= b.pos.y - 0.9) return false;
    return !hazardNear(L, x, gy, z, 0.35);
  }

  faceToward(x: number, z: number, dt: number, rate = 10) {
    const want = Math.atan2(x - this.body.pos.x, z - this.body.pos.z);
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * rate);
  }
}

function hazardNear(L: Level3D, x: number, y: number, z: number, pad: number) {
  for (const h of L.phys.hazards) {
    if (x > h.min.x - pad && x < h.max.x + pad && z > h.min.z - pad && z < h.max.z + pad && y < h.max.y + 0.5 && y > h.min.y - 1.5) return true;
  }
  return false;
}

// ═════════════════════════════ MELON SOLDIERS (shared brain) ═════════════════════════════
/**
 * calm → (sees / hears something) → suspect "?" → (suspicion fills) → hunt "!" (+ alarm to nearby melons)
 * hunt → (lost sight) → goes to the last seen spot → search (looks around, checks nearby spots) → return to post.
 * Up to two melons attack at once; the rest circle the hero and wait for an opening.
 */
export type Aware = 'calm' | 'suspect' | 'hunt' | 'search' | 'return';

const SPOT = ['Вот он!', 'Нарушитель!', 'Тревога!', 'Держи его!', 'Ага, попался!', 'Стоять!'];
const SUSPECT = ['Хм?', 'Кто здесь?', 'Что за шорох?', 'Мне показалось...', 'Эй?'];
const ALARMED = ['Иду!', 'Где он?!', 'Окружай!', 'Бегу-бегу!'];
const SEARCH = ['Выходи, малыш!', 'Я тебя всё равно найду!', 'Куда он делся?', 'Ну и где ты?', 'Я тебя чую!'];
const GIVEUP = ['Хм... ушёл.', 'Показалось...', 'Ладно, вернусь на пост.', 'Ничего, в другой раз!'];

const GSTATES: GuardAnim['state'][] = ['idle', 'walk', 'windup', 'attack', 'hurt', 'spit', 'cheer', 'alert', 'carry', 'look', 'block', 'bash', 'throw', 'charge', 'dizzy'];
const AWARE: Aware[] = ['calm', 'suspect', 'hunt', 'search', 'return'];

export abstract class Soldier3 extends Enemy3 {
  rig: GuardRig;
  anim: GuardAnim = { state: 'idle', speed: 0, flash: 0, look: 0, p: 0 };
  aware: Aware = 'calm';
  /** the hero this melon is after (co-op: whoever it saw / heard last) */
  target: HeroLike | null = null;
  /** suspicion 0..1 */
  sus = 0;
  sees = false;
  provoked = false;
  /** seconds since the "!" (for the indicator) */
  alertT = 9;
  protected senseT = rand(0, 0.12);
  protected lastSeen = new THREE.Vector3();
  protected lastVel = new THREE.Vector3();
  protected unseenT = 0;
  protected goal: THREE.Vector3 | null = null;
  protected searchCenter = new THREE.Vector3();
  protected searchT = 0;
  protected lookT = 0;
  protected lookBase = 0;
  protected waitT = 0;
  protected jumpCD = 0;
  protected barkCD = rand(0, 2);
  protected dodgeAtk = -1;
  protected strafe = Math.random() < 0.5 ? 1 : -1;
  protected strafeT = rand(1, 3);
  /** current combat action and its timer */
  act = 'move'; at = 0;
  path: THREE.Vector3[] | null = null; pathI = 0;
  range: number;
  post: boolean;
  viewDist = 15; fovCos = Math.cos(1.1); hearMul = 1;
  walkSpeed = 1.7; runSpeed = 4.6; turnRate = 9;
  constructor(kind: EnemyKind, gk: GuardKind, pos: THREE.Vector3, r: number, h: number, o: EnemyOpts) {
    super(kind, pos, r, h);
    this.rig = createGuard(gk);
    this.root.add(this.rig.root);
    this.range = o.range ?? 4;
    this.post = !!o.post;
    if (this.post) this.range = 0.01;
    this.yaw = o.yaw ?? rand(0, Math.PI * 2);
    this.lookBase = this.yaw;
    if (o.path?.length) { this.path = o.path.map(([x, z]) => new THREE.Vector3(x, pos.y, z)); }
    this.goal = null;
  }

  provoke(L: Level3D) {
    this.provoked = true;
    this.aware = 'hunt'; this.sus = 1; this.alertT = 0;
    this.lastSeen.copy(this.tgt(L).pos);
  }

  /** is this melon in the middle of an attack (counts toward the "two at once" limit) */
  attacking() { return this.act !== 'move'; }

  eye(out = new THREE.Vector3()) { return out.copy(this.body.pos).setY(this.body.pos.y + this.body.h * 0.85); }

  protected bark(L: Level3D, lines: string[], chance = 1, force = false) {
    if ((!force && this.barkCD > 0) || Math.random() > chance) return;
    this.barkCD = rand(2.5, 4);
    L.bark(this.root, choose(lines), 1.4, this.body.h + 1.5);
  }

  /** current target (falls back to the nearest hero) */
  protected tgt(L: Level3D): HeroLike {
    const t = this.target;
    if (t && !t.dead && !t.downed && !t.hidden && L.heroes().includes(t)) return t;
    return (this.target = L.targetFor(this.body.pos));
  }

  // ───── senses ─────
  /** look for any hero; the nearest visible one becomes the target */
  protected sense(L: Level3D) {
    this.sees = false;
    if (L.worldCut) return;
    let best: HeroLike | null = null, bd = Infinity;
    for (const h of L.alivePlayers()) {
      if (!this.canSee(L, h)) continue;
      const d = h.pos.distanceTo(this.body.pos);
      if (d < bd) { bd = d; best = h; }
    }
    if (best) { this.sees = true; this.target = best; }
  }

  protected canSee(L: Level3D, p: HeroLike): boolean {
    const pc = p.center();
    const eye = this.eye(v);
    const dx = pc.x - eye.x, dz = pc.z - eye.z, dy = pc.y - eye.y;
    const dxz = Math.hypot(dx, dz);
    const hunting = this.aware === 'hunt';
    const near = dxz < (hunting ? 9 : 3) && Math.abs(dy) < 3;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const cone = dxz > 0.01 && (dx * fx + dz * fz) / dxz > this.fovCos && dxz < this.viewDist * (hunting ? 1.6 : 1) && Math.abs(dy) < 6;
    if (!near && !cone) return false;
    const d = Math.hypot(dx, dy, dz);
    v2.set(dx / d, dy / d, dz / d);
    const hit = L.phys.raycast(eye, v2, d);
    return hit >= d - 0.45;
  }

  protected hear(L: Level3D) {
    if (this.aware === 'hunt') return;
    const b = this.body;
    for (const n of L.noises) {
      const d = Math.hypot(n.p.x - b.pos.x, n.p.z - b.pos.z);
      if (d > n.r * this.hearMul || Math.abs(n.p.y - b.pos.y) > 7) continue;
      if (n.alarm) {
        if (this.aware !== 'search' || this.sus < 0.7) {
          this.startSearch(n.target, true);
          this.sus = Math.max(this.sus, 0.75);
          this.bark(L, ALARMED, 0.7, true);
          L.fx.text(this.center().setY(b.pos.y + b.h + 0.9), '!', '#ff9a3a', 28);
        }
      } else if (this.aware !== 'search') {
        if (this.aware !== 'suspect') { this.bark(L, SUSPECT, 0.6); audio.sfx('menuMove', { pitch: 0.6, volume: 0.35 }); }
        this.aware = 'suspect';
        this.goal = n.target.clone();
        this.waitT = 0.45;
        this.sus = Math.max(this.sus, 0.4);
      } else {
        this.goal = n.target.clone();
        this.searchCenter.copy(n.target);
      }
    }
  }

  protected spot(L: Level3D) {
    const first = this.aware !== 'hunt';
    this.aware = 'hunt'; this.sus = 1; this.alertT = 0;
    const p = this.tgt(L);
    this.lastSeen.copy(p.pos);
    if (!first) return;
    L.fx.text(this.center().setY(this.body.pos.y + this.body.h + 0.9), '!', '#ff3a4a', 40);
    audio.sfx('alert');
    this.bark(L, SPOT, 0.85, true);
    this.act = 'move'; this.at = 0;
    L.noise(this.body.pos, 15, { alarm: true, target: p.pos });
  }

  protected startSearch(at: THREE.Vector3, running = false) {
    this.aware = 'search';
    this.searchCenter.copy(at);
    this.goal = at.clone();
    this.searchT = running ? 9 : 7;
    this.lookT = 0;
    this.act = 'move';
  }

  // ───── movement ─────
  /** steer toward (x,z): separation from allies, ledge & hazard checks, hops up/over/down when hunting */
  protected steer(L: Level3D, x: number, z: number, speed: number, dt: number, face = true) {
    const b = this.body;
    if (this.post) { speed = 0; if (face) this.faceToward(x, z, dt, this.turnRate); }
    let dx = x - b.pos.x, dz = z - b.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.08) { dx = 0; dz = 0; speed = 0; } else { dx /= d; dz /= d; }
    // separation from other ground enemies
    for (const e of L.enemies) {
      if (e === this || e.dead || e.flying) continue;
      const ox = b.pos.x - e.body.pos.x, oz = b.pos.z - e.body.pos.z;
      const od = Math.hypot(ox, oz), min = b.r + e.body.r + 0.35;
      if (od < min && od > 0.01 && Math.abs(e.body.pos.y - b.pos.y) < 1) { const k = (min - od) / min * 1.6; dx += (ox / od) * k; dz += (oz / od) * k; }
    }
    const l = Math.hypot(dx, dz);
    if (l > 0.01) { dx /= l; dz /= l; }
    const hunting = this.aware === 'hunt';
    const p = this.tgt(L);
    if (speed > 0 && b.onGround) {
      if (!this.groundAhead(L, dx, dz)) {
        const far = this.groundAhead(L, dx, dz, 2.8);
        const lx = b.pos.x + dx * 1.3, lz = b.pos.z + dz * 1.3;
        const gy = L.phys.groundAt(lx, lz, b.pos.y + 0.5, 0.05);
        const drop = b.pos.y - gy;
        if (hunting && far && this.jumpCD <= 0) this.hop(dx, dz, 9.5, 5);
        else if (hunting && gy > -1e8 && drop < 6.5 && gy > L.killY + 2 && p.pos.y < b.pos.y - 0.8 && !hazardNear(L, lx, gy, lz, 0.4)) { /* drop down after him */ }
        else { speed = 0; if (this.aware === 'calm') this.waitT = 0.4; }
      } else if (hunting && this.jumpCD <= 0) {
        const dy = p.pos.y - b.pos.y;
        const pd = Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z);
        if (dy > 0.6 && dy < 2.4 && pd < 3.6 && (b.hitWall || pd < 1.8)) this.hop(dx, dz, 12, 3.5);
      }
    }
    const acc = (b.onGround ? 30 : 6) * dt;
    b.vel.x = approach(b.vel.x, dx * speed, acc);
    b.vel.z = approach(b.vel.z, dz * speed, acc);
    if (face && speed > 0.1) this.faceToward(b.pos.x + dx, b.pos.z + dz, dt, this.turnRate);
    return d;
  }

  protected hop(dx: number, dz: number, vy: number, fwd: number) {
    const b = this.body;
    b.vel.y = vy; b.vel.x = dx * fwd; b.vel.z = dz * fwd;
    b.onGround = false;
    this.jumpCD = 1.1;
  }

  protected brake(dt: number, k = 20) { const b = this.body; b.vel.x = approach(b.vel.x, 0, k * dt); b.vel.z = approach(b.vel.z, 0, k * dt); }

  /** number of melons currently swinging at the hero */
  protected attackersNow(L: Level3D) {
    let n = 0;
    for (const e of L.enemies) if (e !== this && !e.dead && e instanceof Soldier3 && e.attacking() && e.aware === 'hunt') n++;
    return n;
  }

  /** circle the hero at a distance (waiting for a turn to attack) */
  protected circle(L: Level3D, radius: number, speed: number, dt: number) {
    const b = this.body, p = this.tgt(L);
    const ox = b.pos.x - p.pos.x, oz = b.pos.z - p.pos.z;
    const d = Math.max(0.01, Math.hypot(ox, oz));
    this.strafeT -= dt;
    if (this.strafeT <= 0 || b.hitWall) { this.strafe *= -1; this.strafeT = rand(1.2, 2.6); }
    const tx = -oz / d * this.strafe, tz = ox / d * this.strafe;
    const radial = clamp((radius - d) * 1.2, -1, 1);
    const gx = b.pos.x + tx * 1.5 + (ox / d) * radial * 1.5, gz = b.pos.z + tz * 1.5 + (oz / d) * radial * 1.5;
    this.steer(L, gx, gz, speed, dt, false);
    this.faceToward(p.pos.x, p.pos.z, dt, this.turnRate);
  }

  // ───── main loop ─────
  tick(L: Level3D, dt: number) {
    const b = this.body, p = this.tgt(L);
    this.jumpCD -= dt; this.barkCD -= dt; this.alertT += dt;
    if (this.stun > 0) {
      this.stun -= dt;
      this.brake(dt);
      L.phys.move(b, dt);
      if (this.stun <= 0 && this.aware !== 'hunt' && !p.dead) this.spot(L);
      return;
    }
    // senses (a few times a second)
    this.senseT -= dt;
    if (this.senseT <= 0) { this.senseT = 0.1; this.sense(L); }
    this.hear(L);
    if (this.provoked && !p.dead) { this.sees = true; this.aware = 'hunt'; }
    if (this.sees) { this.lastSeen.copy(p.pos); this.lastVel.copy(p.vel); this.unseenT = 0; } else this.unseenT += dt;
    const dist = Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z);

    // awareness
    if (this.aware !== 'hunt') {
      if (this.sees) {
        const rate = dist < 3.5 ? 12 : lerp(2.8, 0.7, clamp((dist - 3.5) / (this.viewDist - 3.5), 0, 1));
        this.sus += rate * dt * (this.aware === 'search' ? 1.8 : 1);
        if (this.sus >= 1) this.spot(L);
        else if (this.aware === 'calm' || this.aware === 'return') {
          if (this.sus > 0.22) { this.aware = 'suspect'; this.goal = p.pos.clone(); this.waitT = 0.5; this.bark(L, SUSPECT, 0.5); }
        } else if (this.aware === 'suspect') this.goal = p.pos.clone();
      } else this.sus = Math.max(0, this.sus - dt * (this.aware === 'search' ? 0.05 : 0.16));
    } else if (!this.provoked) {
      if (p.dead) { this.aware = 'return'; this.sus = 0; this.act = 'move'; }
      else if (this.unseenT > 5 || dist > 34) { this.startSearch(this.lastSeen); this.bark(L, SEARCH, 0.8, true); }
    }

    switch (this.aware) {
      case 'calm': this.patrol(L, dt); break;
      case 'suspect': this.investigate(L, dt); break;
      case 'search': this.search(L, dt); break;
      case 'return': {
        const d = this.steer(L, this.home.x, this.home.z, this.walkSpeed * 1.2, dt);
        if (d < 0.6) { this.aware = 'calm'; this.waitT = 0.5; }
        break;
      }
      case 'hunt':
        if (this.sees || this.unseenT < 0.35) this.combat(L, dt, dist);
        else {
          // run to where he was last seen (plus where he was heading)
          if (this.act !== 'move') { this.act = 'move'; }
          const k = Math.min(this.unseenT, 1.2);
          const tx = this.lastSeen.x + this.lastVel.x * k * 0.6, tz = this.lastSeen.z + this.lastVel.z * k * 0.6;
          const d = this.steer(L, tx, tz, this.runSpeed, dt);
          if (d < 0.9 && this.unseenT > 0.8) { this.startSearch(this.lastSeen); this.bark(L, SEARCH, 0.8); }
        }
        break;
    }
    L.phys.move(b, dt);
  }

  protected patrol(L: Level3D, dt: number) {
    const b = this.body;
    if (this.waitT > 0) {
      this.waitT -= dt; this.brake(dt);
      this.lookT += dt;
      this.yaw = this.lookBase + Math.sin(this.lookT * 1.4) * 0.9;
      return;
    }
    let goal: THREE.Vector3;
    if (this.path) goal = this.path[this.pathI];
    else {
      if (!this.goal) { const a = rand(0, Math.PI * 2), r = rand(0.5, this.range); this.goal = new THREE.Vector3(this.home.x + Math.cos(a) * r, b.pos.y, this.home.z + Math.sin(a) * r); }
      goal = this.goal;
    }
    const d = this.steer(L, goal.x, goal.z, this.walkSpeed, dt);
    if (d < 0.45 || (b.hitWall && Math.random() < 0.05) || Math.hypot(b.vel.x, b.vel.z) < 0.05 && this.t % 2 < dt) {
      if (this.path) this.pathI = (this.pathI + 1) % this.path.length; else this.goal = null;
      this.waitT = this.path ? rand(1.2, 2) : rand(0.8, 1.8);
      this.lookT = 0; this.lookBase = this.yaw;
    }
  }

  protected investigate(L: Level3D, dt: number) {
    const b = this.body;
    if (!this.goal) { this.aware = 'return'; return; }
    this.faceToward(this.goal.x, this.goal.z, dt, 5);
    if (this.waitT > 0) { this.waitT -= dt; this.brake(dt); this.lookT = 0; return; }
    const d = Math.hypot(this.goal.x - b.pos.x, this.goal.z - b.pos.z);
    if (d > 1 && this.lookT === 0) { this.steer(L, this.goal.x, this.goal.z, this.walkSpeed * 1.35, dt); if (Math.hypot(b.vel.x, b.vel.z) > 0.2) return; }
    // arrived (or can't get closer): look around
    this.brake(dt);
    if (this.lookT === 0) this.lookBase = this.yaw;
    this.lookT += dt;
    this.yaw = this.lookBase + Math.sin(this.lookT * 1.6) * 1.1;
    if (this.lookT > 3 && this.sus < 0.15) { this.aware = 'return'; this.goal = null; this.lookT = 0; this.bark(L, GIVEUP, 0.5); }
  }

  protected search(L: Level3D, dt: number) {
    const b = this.body;
    this.searchT -= dt;
    if (this.searchT <= 0) { this.aware = 'return'; this.goal = null; this.sus = 0; this.bark(L, GIVEUP, 0.7); return; }
    if (this.goal && this.lookT === 0) {
      const d = this.steer(L, this.goal.x, this.goal.z, this.runSpeed * 0.75, dt);
      if (d > 0.8 && Math.hypot(b.vel.x, b.vel.z) > 0.15) return;
      this.goal = null; this.lookBase = this.yaw;
    }
    this.brake(dt);
    this.lookT += dt;
    this.yaw = this.lookBase + Math.sin(this.lookT * 1.9) * 1.25;
    if (this.lookT > 1.7) {
      this.lookT = 0;
      if (Math.random() < 0.35) this.bark(L, SEARCH, 0.6);
      // next spot to check: somewhere walkable near where he vanished
      for (let i = 0; i < 6; i++) {
        const a = rand(0, Math.PI * 2), r = rand(2, 6.5);
        const x = this.searchCenter.x + Math.cos(a) * r, z = this.searchCenter.z + Math.sin(a) * r;
        const gy = L.phys.groundAt(x, z, b.pos.y + 1.5, 0.1);
        if (gy > b.pos.y - 1.5 && !hazardNear(L, x, gy, z, 0.5)) { this.goal = new THREE.Vector3(x, gy, z); break; }
      }
    }
  }

  /** what this melon does while it can see the hero */
  protected abstract combat(L: Level3D, dt: number, dist: number): void;

  /** sneak attack: double damage on a melon that hasn't noticed you */
  hurt(L: Level3D, dmg: number, from: THREE.Vector3, kind: string) {
    if (!L.authority) return;
    const by = this.attackerHero(L);
    if (this.aware !== 'hunt' && kind !== 'bomb') {
      dmg *= 2;
      L.fx.text(this.center().setY(this.body.pos.y + this.body.h + 1.2), 'Подкрался! ×2', '#9ae0ff', 22);
    }
    super.hurt(L, dmg, from, kind);
    if (!this.dead && this.aware !== 'hunt') { this.target = by; this.spot(L); }
    else if (!this.dead) { this.target = by; this.lastSeen.copy(by.pos); this.unseenT = 0; }
  }

  /** the "?" / "!" over the head (drawn by the level) */
  indicator(): { kind: 'sus' | 'alert' | 'search'; v: number } | null {
    if (this.dead || this.spawnT > 0) return null;
    if (this.aware === 'hunt') return this.alertT < 1.4 ? { kind: 'alert', v: 1 } : null;
    if (this.aware === 'search') return { kind: 'search', v: 1 };
    if (this.sus > 0.04) return { kind: 'sus', v: this.sus };
    return null;
  }

  private animSet = false;
  /** combat code picks the pose; otherwise it follows movement/awareness */
  protected setAnim(s: GuardAnim['state'], p?: number) { this.anim.state = s; if (p !== undefined) this.anim.p = p; this.animSet = true; }

  protected baseAnim(): GuardAnim['state'] {
    const hs = Math.hypot(this.body.vel.x, this.body.vel.z);
    if (this.stun > 0) return 'hurt';
    if (hs > 0.3) return 'walk';
    if ((this.aware === 'search' || this.aware === 'suspect' || (this.aware === 'calm' && this.waitT > 0)) && this.lookT > 0) return 'look';
    if (this.aware === 'hunt') return 'alert';
    return 'idle';
  }

  // co-op: pose and awareness travel with the snapshot
  private netAnim = false;
  protected netExtra(): number[] {
    const a = this.anim;
    return [GSTATES.indexOf(a.state), a.p ?? 0, Math.sin(this.lookT * 1.6), AWARE.indexOf(this.aware), this.sus, Math.min(this.alertT, 9)];
  }
  protected netExtraApply(a: number[], i: number) {
    this.anim.state = GSTATES[a[i]] ?? 'idle';
    this.anim.p = a[i + 1];
    this.anim.look = a[i + 2];
    this.aware = AWARE[a[i + 3]] ?? 'calm';
    this.sus = a[i + 4];
    this.alertT = a[i + 5];
    this.netAnim = true;
  }

  syncRig(dt: number) {
    const a = this.anim;
    const hs = Math.hypot(this.body.vel.x, this.body.vel.z);
    if (this.netAnim) {
      a.speed = clamp(hs / 4, 0, 1.2); a.flash = this.flash;
      this.rig.update(dt, a);
      return;
    }
    if (this.stun > 0 && a.state !== 'dizzy') a.state = 'hurt';
    else if (!this.animSet) a.state = this.baseAnim();
    this.animSet = false;
    a.speed = clamp(hs / 4, 0, 1.2);
    a.flash = this.flash;
    a.look = Math.sin(this.lookT * 1.6);
    this.rig.update(dt, a);
  }
}

// ─────────────────────────── GUARD (spear) ───────────────────────────
export class Guard3 extends Soldier3 {
  private combo = false;
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('guard', 'guard', pos, 0.36, 0.9, o);
    this.hp = this.maxHp = 4; this.loot = 2;
  }
  protected combat(L: Level3D, dt: number, dist: number) {
    const b = this.body, p = this.tgt(L);
    const dy = p.pos.y - b.pos.y;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.at -= dt;
    switch (this.act) {
      case 'move': {
        // reactive hop back when the hero swings at it
        if (p.atk && p.atkId !== this.dodgeAtk && dist < 2.6 && b.onGround) {
          this.dodgeAtk = p.atkId;
          if (Math.random() < 0.28) { v.set(b.pos.x - p.pos.x, 0, b.pos.z - p.pos.z).normalize(); this.hop(v.x, v.z, 6, 7); this.jumpCD = 0.3; break; }
        }
        const busy = this.attackersNow(L) >= 2;
        if (busy) this.circle(L, 3.1, this.runSpeed * 0.6, dt);
        else {
          if (dist > 1.4) this.steer(L, p.pos.x, p.pos.z, this.runSpeed, dt);
          else { this.brake(dt); this.faceToward(p.pos.x, p.pos.z, dt, 12); }
          if (dist < 1.95 && Math.abs(dy) < 1.2 && b.onGround) {
            this.act = 'windup'; this.at = 0.42; this.combo = Math.random() < 0.35;
            audio.sfx('warn', { volume: 0.22, pitch: 1.8 });
          }
        }
        break;
      }
      case 'windup':
        this.brake(dt);
        this.faceToward(p.pos.x, p.pos.z, dt, 12);
        this.setAnim('windup');
        if (this.at <= 0) { this.act = 'attack'; this.at = 0.22; b.vel.x = fx * 9; b.vel.z = fz * 9; audio.sfx('swing', { pitch: 1.5 }); }
        break;
      case 'attack': {
        this.setAnim('attack');
        b.vel.x = approach(b.vel.x, 0, 30 * dt); b.vel.z = approach(b.vel.z, 0, 30 * dt);
        const tip = this.center().add(v.set(fx, 0, fz).multiplyScalar(1.05));
        const pc = p.center();
        if (!p.dead && Math.hypot(pc.x - tip.x, pc.z - tip.z) < 0.78 && Math.abs(pc.y - tip.y) < 0.9) p.hurt(L, 1, this.center());
        if (this.at <= 0) {
          if (this.combo) { this.combo = false; this.act = 'windup'; this.at = 0.2; }
          else { this.act = 'recover'; this.at = 0.55; }
        }
        break;
      }
      case 'recover':
        this.setAnim('idle');
        this.brake(dt);
        if (this.at <= 0) this.act = 'move';
        break;
      default: this.act = 'move';
    }
  }
}

// ─────────────────────────── SHIELD GUARD ───────────────────────────
/** blocks hits from the front; hit it from the side/back, from above (spin), or break the guard with the fork */
export class Shield3 extends Soldier3 {
  brokenT = 0;
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('shield', 'shield', pos, 0.4, 0.95, o);
    this.hp = this.maxHp = 5; this.loot = 3; this.heavy = 0.35;
    this.runSpeed = 3.7; this.turnRate = 6;
  }
  get guarding() { return this.aware === 'hunt' && this.act === 'move' && this.brokenT <= 0 && this.stun <= 0; }
  protected combat(L: Level3D, dt: number, dist: number) {
    const b = this.body, p = this.tgt(L);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.at -= dt;
    this.brokenT -= dt;
    switch (this.act) {
      case 'move': {
        this.turnRate = 3.2; // turns slowly behind the lid — run around it!
        const busy = this.attackersNow(L) >= 2;
        if (busy) this.circle(L, 3.2, 2.4, dt);
        else if (dist > 1.6) this.steer(L, p.pos.x, p.pos.z, this.runSpeed, dt, false);
        else this.brake(dt);
        this.faceToward(p.pos.x, p.pos.z, dt, this.turnRate);
        this.setAnim(this.brokenT > 0 ? 'hurt' : 'block');
        if (!busy && dist < 1.9 && b.onGround && this.brokenT <= 0 && !p.atk && Math.random() < dt * 1.6) { this.act = 'windup'; this.at = 0.5; audio.sfx('warn', { volume: 0.22, pitch: 1.6 }); }
        break;
      }
      case 'windup':
        this.turnRate = 10;
        this.brake(dt); this.faceToward(p.pos.x, p.pos.z, dt, 10);
        this.setAnim('windup');
        if (this.at <= 0) { this.act = 'attack'; this.at = 0.2; b.vel.x = fx * 7; b.vel.z = fz * 7; audio.sfx('swing', { pitch: 1.6 }); }
        break;
      case 'attack': {
        this.setAnim('attack');
        b.vel.x = approach(b.vel.x, 0, 30 * dt); b.vel.z = approach(b.vel.z, 0, 30 * dt);
        const tip = this.center().add(v.set(fx, 0, fz).multiplyScalar(0.95));
        const pc = p.center();
        if (!p.dead && Math.hypot(pc.x - tip.x, pc.z - tip.z) < 0.75 && Math.abs(pc.y - tip.y) < 0.9) p.hurt(L, 1, this.center());
        if (this.at <= 0) { this.act = 'recover'; this.at = 0.6; }
        break;
      }
      case 'bashPrep':
        this.brake(dt); this.faceToward(p.pos.x, p.pos.z, dt, 12);
        this.setAnim('bash', 0.25 * (1 - this.at / 0.32));
        if (this.at <= 0) { this.act = 'bash'; this.at = 0.3; b.vel.x = fx * 10; b.vel.z = fz * 10; audio.sfx('swingHeavy', { pitch: 1.3 }); }
        break;
      case 'bash': {
        this.setAnim('bash', 0.35 + 0.65 * (1 - this.at / 0.3));
        b.vel.x = approach(b.vel.x, 0, 28 * dt); b.vel.z = approach(b.vel.z, 0, 28 * dt);
        const pc = p.center();
        const front = this.center().add(v.set(fx, 0, fz).multiplyScalar(0.7));
        if (!p.dead && Math.hypot(pc.x - front.x, pc.z - front.z) < 0.9 && Math.abs(pc.y - front.y) < 1) {
          p.hurt(L, 1, this.center(), new THREE.Vector3(fx * 13, 7, fz * 13));
        }
        if (this.at <= 0) { this.act = 'recover'; this.at = 0.7; }
        break;
      }
      case 'recover':
        this.setAnim('idle'); this.brake(dt);
        if (this.at <= 0) this.act = 'move';
        break;
      default: this.act = 'move';
    }
  }
  hurt(L: Level3D, dmg: number, from: THREE.Vector3, kind: string) {
    if (!L.authority) return;
    if (this.guarding && kind !== 'bomb' && kind !== 'charge') {
      v.set(from.x - this.body.pos.x, 0, from.z - this.body.pos.z);
      const front = v.lengthSq() > 1e-4 && (v.normalize().x * Math.sin(this.yaw) + v.z * Math.cos(this.yaw)) > 0.25;
      const fromAbove = kind === 'spin' && from.y > this.body.pos.y + this.body.h * 0.9;
      if (front && !fromAbove) {
        if (kind === 'fork') {
          // the fork pries the lid aside: guard broken
          this.brokenT = 1.4; this.stun = 0.5; this.flash = 0.6;
          audio.sfx('clang', { pitch: 0.8 }); audio.sfx('break', { pitch: 1.4, volume: 0.6 });
          L.fx.sparks(this.center().addScaledVector(v, 0.5), 16, ['#ffffff', '#ffe14a', '#c8d0e0']);
          L.fx.text(this.center().setY(this.body.pos.y + this.body.h + 1), 'Щит пробит!', '#ffe14a', 24);
          return;
        }
        audio.sfx('clang', { pitch: rand(0.95, 1.1) });
        L.fx.sparks(this.center().addScaledVector(v, 0.5), 12, ['#ffffff', '#ffe14a', '#c8d0e0']);
        L.fx.text(this.center().setY(this.body.pos.y + this.body.h + 0.8), 'Бдзынь!', '#d8e0f0', 20);
        const p = this.attackerHero(L);
        if (kind !== 'pea' && p.isLocal) { v.set(p.pos.x - this.body.pos.x, 0, p.pos.z - this.body.pos.z).normalize(); p.body.vel.x += v.x * 6; p.body.vel.z += v.z * 6; }
        L.hint('shield', 'Щитоносец! Обойди его сбоку или со спины, ударь в прыжке сверху — или пробей щит вилкой');
        if (kind !== 'pea' && this.act === 'move' && Math.random() < 0.5) { this.act = 'bashPrep'; this.at = 0.32; }
        return;
      }
    }
    super.hurt(L, this.brokenT > 0 ? dmg + 1 : dmg, from, kind);
  }
}

// ─────────────────────────── BOMBER ───────────────────────────
/** keeps its distance and lobs cherry bombs (bat them back with the sword!) */
export class Bomber3 extends Soldier3 {
  cd = rand(0.8, 1.6);
  private released = false;
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('bomber', 'bomber', pos, 0.36, 0.9, o);
    this.hp = this.maxHp = 3; this.loot = 3;
    this.runSpeed = 3.8;
  }
  protected combat(L: Level3D, dt: number, dist: number) {
    const b = this.body, p = this.tgt(L);
    this.cd -= dt; this.at -= dt;
    if (this.act === 'throw') {
      this.brake(dt);
      this.faceToward(p.pos.x, p.pos.z, dt, 10);
      this.setAnim('throw', 1 - this.at / 0.65);
      if (!this.released && (this.anim.p ?? 0) >= 0.45) { this.released = true; this.throwBomb(L); }
      if (this.at <= 0) { this.act = 'move'; this.cd = rand(1.9, 2.6); }
      return;
    }
    // keep 7–11 m away; strafe in between
    if (dist < 6) {
      v.set(b.pos.x - p.pos.x, 0, b.pos.z - p.pos.z).normalize();
      if (this.groundAhead(L, v.x, v.z, 1.2)) this.steer(L, b.pos.x + v.x * 2, b.pos.z + v.z * 2, this.runSpeed, dt, false);
      else this.circle(L, 8, 3, dt);
      this.faceToward(p.pos.x, p.pos.z, dt, 8);
    } else if (dist > 12) this.steer(L, p.pos.x, p.pos.z, this.runSpeed, dt);
    else this.circle(L, 9, 2.2, dt);
    if (this.cd <= 0 && dist < 15 && b.onGround) {
      this.act = 'throw'; this.at = 0.65; this.released = false;
      if (Math.random() < 0.4) this.bark(L, ['Лови вишенку!', 'Бабах!', 'Подарочек!'], 1);
    }
  }
  private throwBomb(L: Level3D) {
    const b = this.body, p = this.tgt(L);
    this.root.updateMatrixWorld(true);
    const from = this.rig.hand.getWorldPosition(new THREE.Vector3());
    const d = Math.hypot(p.pos.x - from.x, p.pos.z - from.z);
    const T = clamp(d / 10, 0.75, 1.25);
    const tx = p.pos.x + p.vel.x * T * 0.55, tz = p.pos.z + p.vel.z * T * 0.55;
    let gy = L.phys.groundAt(tx, tz, p.pos.y + 1.5, 0.1);
    if (gy < -1e8) gy = p.pos.y;
    new Bomb3(L, from, new THREE.Vector3(tx, gy + 0.3, tz), T, 0.85);
    L.hint('bomb', 'Вишнёвая бомба! Отбей её мечом — она полетит обратно — или лопни горохом');
  }
}

// ─────────────────────────── CHARGER ───────────────────────────
/** paws the ground, then charges in a straight line; slams into walls and gets dizzy (hit it then!) */
export class Charger3 extends Soldier3 {
  cd = rand(0.5, 1.2);
  dir = new THREE.Vector3();
  run = 0;
  private trampled = new Set<Enemy3>();
  stripe: THREE.Mesh;
  private stripeM = basic('#ff6a20', { additive: true, opacity: 0.35, depthWrite: false });
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('charger', 'charger', pos, 0.5, 1.2, o);
    this.hp = this.maxHp = 8; this.loot = 5; this.heavy = 0.65;
    this.runSpeed = 3.4; this.walkSpeed = 1.4; this.turnRate = 6;
    this.stripeM.polygonOffset = true; this.stripeM.polygonOffsetFactor = -6;
    this.stripe = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5), this.stripeM);
    this.stripe.renderOrder = 3; this.stripe.visible = false;
    noOutline(this.stripe);
  }
  attacking() { return this.act === 'swingPrep' || this.act === 'swing'; }
  protected netExtra(): number[] { return [...super.netExtra(), this.stripe.visible ? 1 : 0, this.act === 'charge' ? 1 : 0, this.at, this.run]; }
  protected netExtraApply(a: number[], i: number) {
    super.netExtraApply(a, i);
    const on = a[i + 6], charging = a[i + 7];
    this.at = a[i + 8]; this.run = a[i + 9];
    this.act = charging ? 'charge' : on ? 'prep' : 'move';
    this.netStripe = !!on;
  }
  private netStripe = false;
  protected puppet(L: Level3D, dt: number) {
    super.puppet(L, dt);
    if (!this.stripe.parent) L.scene.add(this.stripe);
    this.stripe.visible = false;
    if (this.netStripe) { this.dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); this.showStripe(L, this.act === 'charge' || this.at <= 0.32); }
  }
  protected combat(L: Level3D, dt: number, dist: number) {
    const b = this.body, p = this.tgt(L);
    this.cd -= dt; this.at -= dt;
    if (!this.stripe.parent) L.scene.add(this.stripe);
    this.stripe.visible = false;
    switch (this.act) {
      case 'move':
        this.setAnim(Math.hypot(b.vel.x, b.vel.z) > 0.3 ? 'walk' : 'alert');
        if (dist > 2) this.steer(L, p.pos.x, p.pos.z, this.runSpeed, dt); else { this.brake(dt); this.faceToward(p.pos.x, p.pos.z, dt, 8); }
        if (this.cd <= 0 && dist > 3.5 && dist < 17 && Math.abs(p.pos.y - b.pos.y) < 1.5 && b.onGround) {
          this.act = 'prep'; this.at = 0.95;
          audio.sfx('roar', { pitch: 1.9, volume: 0.35 });
          this.bark(L, ['Р-р-разойдись!', 'Тара-а-ан!', 'Забодаю!'], 0.6, true);
        } else if (dist < 2.3 && this.attackersNow(L) < 2) { this.act = 'swingPrep'; this.at = 0.55; audio.sfx('warn', { volume: 0.25, pitch: 1.4 }); }
        break;
      case 'prep': {
        this.brake(dt, 30);
        this.setAnim('windup');
        if (this.at > 0.32) this.faceToward(p.pos.x + p.vel.x * 0.3, p.pos.z + p.vel.z * 0.3, dt, 9);
        this.dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        this.showStripe(L, this.at <= 0.32);
        if (Math.random() < 0.4) L.fx.dust(b.pos.clone().addScaledVector(this.dir, -0.5), 1, '#c8b0a0');
        if (this.at <= 0) { this.act = 'charge'; this.at = 1.15; this.run = 0; this.trampled.clear(); audio.sfx('dash', { pitch: 0.6 }); L.tcam.shake(0.1); }
        break;
      }
      case 'charge': {
        this.setAnim('charge');
        this.showStripe(L, true);
        const sp = 15;
        b.vel.x = this.dir.x * sp; b.vel.z = this.dir.z * sp;
        this.run += sp * dt;
        if (Math.random() < 0.6) L.fx.dust(b.pos.clone(), 2, '#c8b0a0');
        const pc = p.center();
        if (!p.dead && Math.hypot(pc.x - b.pos.x, pc.z - b.pos.z) < b.r + 0.55 && Math.abs(pc.y - (b.pos.y + 0.6)) < 1.1) {
          p.hurt(L, 2, b.pos.clone().addScaledVector(this.dir, -1), new THREE.Vector3(this.dir.x * 15, 9, this.dir.z * 15), 0.35);
        }
        for (const e of L.enemies) {
          if (e === this || e.dead || e.spawnT > 0 || this.trampled.has(e)) continue;
          if (e.center().distanceTo(this.center()) < b.r + e.body.r + 0.3) { this.trampled.add(e); e.hurt(L, 2, b.pos, 'charge'); e.body.vel.addScaledVector(this.dir, 8); }
        }
        if (b.hitWall) {
          this.act = 'dizzy'; this.at = 2.4;
          b.vel.x = -this.dir.x * 4; b.vel.z = -this.dir.z * 4; b.vel.y = 5;
          L.tcam.shake(0.35); audio.sfx('bigSlam', { volume: 0.5, pitch: 1.4 });
          L.fx.stars(this.center().setY(b.pos.y + b.h + 0.4), 14);
          L.hint('charger', 'Таран врезался и оглушён — бей его, пока звёздочки кружатся!');
        } else if (this.at <= 0 || this.run > 16 || !this.groundAhead(L, this.dir.x, this.dir.z, 1.1)) {
          this.act = 'skid'; this.at = 0.7;
        }
        break;
      }
      case 'skid':
        this.setAnim('alert');
        this.brake(dt, 16);
        if (Math.random() < 0.5) L.fx.dust(b.pos.clone(), 1, '#c8b0a0');
        if (this.at <= 0) { this.act = 'move'; this.cd = rand(2, 3.2); }
        break;
      case 'dizzy':
        this.setAnim('dizzy');
        this.brake(dt, 10);
        if (this.at <= 0) { this.act = 'move'; this.cd = rand(1.5, 2.5); }
        break;
      case 'swingPrep':
        this.setAnim('windup'); this.brake(dt); this.faceToward(p.pos.x, p.pos.z, dt, 10);
        if (this.at <= 0) { this.act = 'swing'; this.at = 0.3; audio.sfx('swingHeavy'); }
        break;
      case 'swing': {
        this.setAnim('attack'); this.brake(dt);
        const pc = p.center();
        v.set(pc.x - b.pos.x, 0, pc.z - b.pos.z);
        const d = v.length();
        if (!p.dead && d < 2.5 && d > 0.01 && (v.x * Math.sin(this.yaw) + v.z * Math.cos(this.yaw)) / d > 0.1 && Math.abs(pc.y - (b.pos.y + 0.6)) < 1.2) p.hurt(L, 1, b.pos);
        if (this.at <= 0) { this.act = 'recover'; this.at = 0.6; }
        break;
      }
      case 'recover':
        this.setAnim('idle'); this.brake(dt);
        if (this.at <= 0) this.act = 'move';
        break;
      default: this.act = 'move';
    }
  }
  private showStripe(L: Level3D, locked: boolean) {
    const b = this.body;
    const len = this.act === 'charge' ? Math.max(1, 16 - this.run) : 16;
    const gy = L.phys.groundAt(b.pos.x, b.pos.z, b.pos.y + 0.2, 0.1);
    this.stripe.visible = true;
    this.stripe.position.set(b.pos.x, (gy > -1e8 ? gy : b.pos.y) + 0.06, b.pos.z);
    this.stripe.rotation.y = Math.atan2(this.dir.x, this.dir.z);
    this.stripe.scale.set(b.r * 2.4, 1, len);
    this.stripeM.opacity = locked ? 0.45 + 0.25 * Math.sin(this.t * 30) : 0.25;
  }
  hurt(L: Level3D, dmg: number, from: THREE.Vector3, kind: string) {
    if (!L.authority) return;
    if (this.act === 'dizzy') { dmg *= 2; }
    super.hurt(L, dmg, from, kind);
    if (this.act === 'charge') this.stun = 0; // too heavy to stop mid-charge
  }
  die(L: Level3D) { this.stripe.visible = false; L.scene.remove(this.stripe); super.die(L); }
}

// ─────────────────────────── SPITTER ───────────────────────────
export class Spitter3 extends Enemy3 {
  rig: Rig<GuardAnim>;
  cd = 1.5; spitT = 0; burst = 0; hopCD = 0;
  constructor(pos: THREE.Vector3, yaw = 0) {
    super('spitter', pos, 0.36, 0.9);
    this.hp = this.maxHp = 2; this.loot = 2; this.yaw = yaw;
    this.rig = createGuard('spitter');
    this.root.add(this.rig.root);
  }
  provoke() { this.cd = Math.min(this.cd, 0.8); }
  tick(L: Level3D, dt: number) {
    const b = this.body, p = L.targetFor(this.body.pos);
    const dx = p.pos.x - b.pos.x, dz = p.pos.z - b.pos.z;
    const dist = Math.hypot(dx, dz);
    if (this.stun > 0) this.stun -= dt;
    this.hopCD -= dt;
    b.vel.x = approach(b.vel.x, 0, 15 * dt); b.vel.z = approach(b.vel.z, 0, 15 * dt);
    let inRange = !p.dead && p.control && dist < 15 && Math.abs(p.pos.y - b.pos.y) < 8;
    if (inRange) {
      // only spit at what it can actually see
      const eye = this.center().setY(b.pos.y + 0.8);
      const pc = p.center();
      const d = pc.distanceTo(eye);
      inRange = L.phys.raycast(eye, v.copy(pc).sub(eye).normalize(), d) >= d - 0.4;
    }
    if (inRange) this.faceToward(p.pos.x, p.pos.z, dt, 6);
    // too close: hop back
    if (inRange && dist < 2.4 && this.hopCD <= 0 && b.onGround) {
      v.set(-dx, 0, -dz).normalize();
      if (this.groundAhead(L, v.x, v.z, 1.6)) { b.vel.set(v.x * 6, 7, v.z * 6); this.hopCD = 2; audio.sfx('jump', { pitch: 1.5, volume: 0.4 }); }
    }
    this.cd -= dt;
    if (this.spitT > 0) {
      this.spitT -= dt;
      if (this.spitT <= 0) {
        const from = this.center().add(v.set(Math.sin(this.yaw), 0.1, Math.cos(this.yaw)).multiplyScalar(0.45));
        const T0 = clamp(from.distanceTo(p.center()) / 12, 0.4, 1.2);
        const tgt = p.center().add(v2.set(p.vel.x * T0 * 0.7, 0, p.vel.z * T0 * 0.7));
        const d = tgt.clone().sub(from);
        const T = clamp(d.length() / 12, 0.4, 1.2);
        const g = 12;
        const vel = new THREE.Vector3(d.x / T, (d.y + 0.5 * g * T * T) / T, d.z / T);
        L.spawnEnemyShot('seed', from, vel, g);
        audio.sfx('throw', { pitch: 1.5, volume: 0.6 });
        if (this.burst > 0) { this.burst--; this.spitT = 0.28; }
      }
    } else if (inRange && this.cd <= 0) { this.spitT = 0.45; this.burst = 1; this.cd = 2.1; }
    L.phys.move(b, dt);
  }
  protected netExtra(): number[] { return [this.spitT > 0 ? 1 : 0]; }
  protected netExtraApply(a: number[], i: number) { this.spitT = a[i] ? 0.3 : 0; }
  syncRig(dt: number) {
    this.rig.update(dt, { state: this.stun > 0 ? 'hurt' : this.spitT > 0 ? 'spit' : 'idle', speed: 0, flash: this.flash });
  }
}

// ─────────────────────────── MEATBALL ───────────────────────────
export class Meatball3 extends Enemy3 {
  rig: Rig<{ roll: number; flash: number }>;
  roll = 0; a: THREE.Vector3; bpt: THREE.Vector3; toB = true; rushT = 0; restT = 0;
  constructor(a: THREE.Vector3, b: THREE.Vector3) {
    super('meatball', a, 0.45, 0.9);
    this.hp = this.maxHp = 4; this.heavy = 0.5; this.loot = 3;
    this.a = a.clone(); this.bpt = b.clone();
    this.rig = createMeatball();
    this.root.add(this.rig.root);
  }
  provoke() { this.rushT = 99; }
  tick(L: Level3D, dt: number) {
    const b = this.body, p = L.targetFor(this.body.pos);
    this.restT -= dt;
    const pd = Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z);
    // sees the hero close by → rolls at him for a while
    if (this.rushT <= 0 && this.restT <= 0 && !p.dead && pd < 7 && Math.abs(p.pos.y - b.pos.y) < 1.5) { this.rushT = 2.4; audio.sfx('warn', { volume: 0.2, pitch: 0.9 }); }
    let tgt: THREE.Vector3, sp = 4.5;
    if (this.rushT > 0) {
      this.rushT -= dt; tgt = p.pos; sp = 6.2;
      if (this.rushT <= 0) this.restT = 2;
    } else tgt = this.toB ? this.bpt : this.a;
    const dx = tgt.x - b.pos.x, dz = tgt.z - b.pos.z;
    const d = Math.hypot(dx, dz);
    if (this.rushT <= 0 && d < 0.5) this.toB = !this.toB;
    if (this.stun > 0) { this.stun -= dt; b.vel.x = approach(b.vel.x, 0, 10 * dt); b.vel.z = approach(b.vel.z, 0, 10 * dt); }
    else if (d > 0.01) {
      const nx = dx / d, nz = dz / d;
      const ok = this.groundAhead(L, nx, nz, 0.8);
      b.vel.x = approach(b.vel.x, ok ? nx * sp : 0, 12 * dt); b.vel.z = approach(b.vel.z, ok ? nz * sp : 0, 12 * dt);
      if (!ok && this.rushT > 0) { this.rushT = 0; this.restT = 1.5; }
      this.faceToward(tgt.x, tgt.z, dt, 6);
    }
    L.phys.move(b, dt);
    if (b.hitWall && this.rushT <= 0) this.toB = !this.toB;
    this.roll += Math.hypot(b.vel.x, b.vel.z) * dt / 0.45;
  }
  onHurt(L: Level3D) { L.fx.emit(this.center(), { count: 8, speed: [1.5, 4], life: [0.3, 0.6], size: [0.08, 0.14], colors: ['#8c4a2c', '#c8402a'], g: 14 }); }
  deathFx(L: Level3D, c: THREE.Vector3) { L.fx.chunks(c, 14, ['#8c4a2c', '#6a3218', '#c8402a'], this.body.pos.y, [0.1, 0.22]); }
  protected puppet(L: Level3D, dt: number) { super.puppet(L, dt); this.roll += Math.hypot(this.body.vel.x, this.body.vel.z) * dt / 0.45; }
  syncRig(dt: number) { this.rig.update(dt, { roll: this.roll, flash: this.flash }); }
}

// ─────────────────────────── JELLY ───────────────────────────
export class Jelly3 extends Enemy3 {
  rig: Rig<{ squash: number; flash: number }>;
  hop = 1; sq = 0; hunt = false;
  constructor(pos: THREE.Vector3, public hue: 0 | 1 | 2 = 0, public small = false) {
    super('jelly', pos, small ? 0.26 : 0.4, small ? 0.5 : 0.75);
    this.hp = this.maxHp = small ? 1 : 3;
    this.loot = small ? 1 : 2;
    this.rig = createJelly(hue);
    this.rig.root.scale.setScalar(small ? 0.65 : 1.05);
    this.root.add(this.rig.root);
  }
  provoke() { this.hunt = true; }
  tick(L: Level3D, dt: number) {
    const b = this.body, p = L.targetFor(this.body.pos);
    const dx = p.pos.x - b.pos.x, dz = p.pos.z - b.pos.z;
    const dist = Math.hypot(dx, dz);
    const was = b.onGround;
    if (this.stun > 0) this.stun -= dt;
    if (b.onGround) {
      b.vel.x = approach(b.vel.x, 0, 25 * dt); b.vel.z = approach(b.vel.z, 0, 25 * dt);
      this.hop -= dt;
      if (this.hop <= 0 && (dist < 11 || this.hunt) && !p.dead && p.control) {
        b.vel.y = this.small ? 8.5 : 9.5;
        const nx = dist > 0.01 ? dx / dist : 0, nz = dist > 0.01 ? dz / dist : 0;
        const sp = this.small ? 4.6 : 3.8;
        if (this.groundAhead(L, nx, nz, 1.6)) { b.vel.x = nx * sp; b.vel.z = nz * sp; }
        this.yaw = Math.atan2(nx, nz);
        this.hop = (this.small ? 0.55 : 0.9) + Math.random() * 0.5; this.sq = -0.7;
        audio.sfx('bounce', { volume: 0.35, pitch: this.small ? 1.7 : 1.3 });
      }
    }
    L.phys.move(b, dt);
    if (!was && b.onGround) { this.sq = 0.9; L.fx.dust(b.pos.clone(), 3, '#ff9ac0'); }
    this.sq = damp(this.sq, 0, 9, dt);
  }
  onHurt(L: Level3D) { L.fx.juice(this.center(), 10, ['#ff5f9e', '#ff9ac0'], this.body.pos.y); }
  die(L: Level3D) {
    const wasDead = this.dead;
    super.die(L);
    if (wasDead || this.small) return;
    // a big jelly splits in two wobbly halves
    for (const s of [-1, 1]) {
      const at = this.body.pos.clone().add(new THREE.Vector3(s * 0.4, 0.2, 0));
      const e = L.spawnEnemy('jelly', at.x, at.y, at.z, { hue: this.hue, small: true }) as Jelly3;
      e.body.vel.set(s * 3, 7, rand(-1, 1));
      e.hunt = true; e.hop = 0.5;
      if (this.loot === 0) e.loot = 0;
    }
  }
  deathFx(L: Level3D, c: THREE.Vector3) { L.fx.juice(c, this.small ? 14 : 26, ['#ff5f9e', '#ff9ac0', '#ffffff'], this.body.pos.y); }
  protected netExtra(): number[] { return [this.sq]; }
  protected netExtraApply(a: number[], i: number) { this.sq = a[i]; }
  syncRig(dt: number) { this.rig.update(dt, { squash: this.sq, flash: this.flash }); }
}

// ─────────────────────────── FLYING BOOK ───────────────────────────
/** circles the hero, then swoops; collides with shelves and walls (bounces off instead of passing through) */
export class BookBat3 extends Enemy3 {
  rig: Rig<{ flap: number; flash: number }>;
  state: 'hover' | 'orbit' | 'swoop' | 'back' = 'hover'; st = rand(0.5, 1.5); dir = new THREE.Vector3();
  orbitA = rand(0, Math.PI * 2); orbitDir = Math.random() < 0.5 ? 1 : -1; hunt = false;
  constructor(pos: THREE.Vector3) {
    super('book', pos, 0.36, 0.5);
    this.hp = this.maxHp = 2; this.flying = true; this.body.gravity = 0; this.loot = 2;
    this.rig = createBookBat(choose(['#c0392b', '#2e86c1', '#8e44ad', '#27ae60', '#d35400']));
    this.root.add(this.rig.root);
    this.blob.visible = false;
  }
  provoke() { this.hunt = true; this.state = 'orbit'; }
  tick(L: Level3D, dt: number) {
    const b = this.body, p = L.targetFor(this.body.pos);
    if (this.stun > 0) { this.stun -= dt; b.vel.multiplyScalar(0.9); L.phys.move(b, dt); return; }
    const pc = p.center();
    const pd = pc.distanceTo(this.center());
    const leash = this.hunt ? 999 : 16;
    this.st -= dt;
    switch (this.state) {
      case 'hover': {
        const gx = this.home.x + Math.sin(this.t * 1.1) * 2.2, gz = this.home.z + Math.cos(this.t * 0.9) * 2.2, gy = this.home.y + Math.sin(this.t * 2.1) * 0.5;
        b.vel.set((gx - b.pos.x) * 2.5, (gy - b.pos.y) * 2.5, (gz - b.pos.z) * 2.5);
        this.faceToward(pc.x, pc.z, dt, 5);
        if (!p.dead && p.control && pd < 11 && this.canSee(L, pc)) { this.state = 'orbit'; this.st = rand(0.8, 1.6); audio.sfx('whoosh', { volume: 0.25, pitch: 1.8 }); }
        break;
      }
      case 'orbit': {
        // circle above the hero, waiting for a gap in the flock
        this.orbitA += dt * 1.6 * this.orbitDir;
        const r = 3.6;
        const gx = pc.x + Math.cos(this.orbitA) * r, gz = pc.z + Math.sin(this.orbitA) * r, gy = pc.y + 2.2 + Math.sin(this.t * 3) * 0.4;
        b.vel.set(clamp((gx - b.pos.x) * 3, -8, 8), clamp((gy - b.pos.y) * 3, -6, 6), clamp((gz - b.pos.z) * 3, -8, 8));
        this.faceToward(pc.x, pc.z, dt, 8);
        if (p.dead || (!this.hunt && Math.hypot(b.pos.x - this.home.x, b.pos.z - this.home.z) > leash)) { this.state = 'back'; break; }
        const last = (L.refs.bookSwoopT as number | undefined) ?? -9;
        if (this.st <= 0 && L.t - last > 0.7 && this.canSee(L, pc)) {
          L.refs.bookSwoopT = L.t;
          this.state = 'swoop'; this.st = 0.9;
          this.dir.copy(pc).addScaledVector(p.vel, 0.15).sub(this.center()).normalize();
          b.vel.copy(this.dir).multiplyScalar(11);
          audio.sfx('whoosh', { volume: 0.45, pitch: 1.4 });
        }
        break;
      }
      case 'swoop':
        if (this.st <= 0 || b.hitWall || b.onGround) { this.state = 'orbit'; this.st = rand(1.4, 2.4); if (b.hitWall) { b.vel.multiplyScalar(-0.4); this.stun = 0.4; L.fx.emit(this.center(), { count: 6, speed: [1, 3], life: [0.3, 0.6], size: [0.1, 0.18], colors: ['#f6ecd2'], g: 6 }); } }
        break;
      case 'back': {
        v.copy(this.home).sub(b.pos);
        const d = v.length();
        b.vel.copy(v.normalize().multiplyScalar(4.5));
        if (d < 0.6) { this.state = 'hover'; this.st = 1.5; }
        break;
      }
    }
    L.phys.move(b, dt);
  }
  private canSee(L: Level3D, pc: THREE.Vector3) {
    const c = this.center();
    const d = pc.distanceTo(c);
    return L.phys.raycast(c, v2.copy(pc).sub(c).normalize(), d) >= d - 0.4;
  }
  onHurt(L: Level3D) { L.fx.emit(this.center(), { count: 8, speed: [1.5, 4], life: [0.5, 1], size: [0.12, 0.2], colors: ['#f6ecd2', '#ffffff'], g: 6 }); if (this.state === 'swoop') this.state = 'orbit'; }
  deathFx(L: Level3D, c: THREE.Vector3) {
    L.fx.chunks(c, 16, ['#f6ecd2', '#ffffff', '#e8dcc0'], L.phys.groundAt(c.x, c.z, c.y, 0.1), [0.12, 0.22]);
  }
  syncRig(dt: number) { this.rig.update(dt, { flap: this.t, flash: this.flash }); }
}

export function makeEnemy3(kind: EnemyKind, pos: THREE.Vector3, o: EnemyOpts = {}): Enemy3 {
  switch (kind) {
    case 'guard': return new Guard3(pos, o);
    case 'shield': return new Shield3(pos, o);
    case 'bomber': return new Bomber3(pos, o);
    case 'charger': return new Charger3(pos, o);
    case 'spitter': return new Spitter3(pos, o.yaw ?? 0);
    case 'meatball': return new Meatball3(pos, o.to ?? pos.clone().add(new THREE.Vector3(6, 0, 0)));
    case 'jelly': return new Jelly3(pos, o.hue ?? 0, o.small);
    case 'book': return new BookBat3(pos);
  }
  const make = ENEMY_KINDS[kind];
  if (!make) throw new Error(`unknown enemy kind '${kind}'`);
  return make(pos, o);
}

// co-op: enemies that appear during play are created on clients from the host's spawn message
NET_SPAWN.enemy = (L, a: { kind: EnemyKind; x: number; y: number; z: number; o?: EnemyOpts; key?: string }) => {
  const e = L.enemy(a.kind, a.x, a.y, a.z, a.o ?? {}, a.key);
  e.spawnT = 0.6;
  return e;
};
