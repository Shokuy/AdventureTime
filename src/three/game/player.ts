import * as THREE from 'three';
import { input } from '../../engine/input';
import { audio } from '../../engine/audio';
import { save } from '../../engine/save';
import { approach, clamp, damp, W, H } from '../../engine/util';
import { makeBody, Body } from '../physics/world';
import { createHeroModel } from '../models/heroes';
import type { HeroAnim, HeroState, HeroExpr } from '../models';
import type { HeroAtk, HeroRig } from '../models/hero';
import type { HeroKind } from '../../net/profile';
import type { HeroKit } from './heroes/kit';
import { createKit, kitNet } from './heroes';
import { makeBlob } from '../fx';
import type { Level3D } from './level';
import type { Noodle3 } from './objects';
import { toUI } from '../runtime';
import { profile } from '../../net/profile';
import { HERO_STATES, ATK_KINDS, EXPRS, HS, HF, EMOTES, KIND_IDS } from './remoteHero';
import type { RemoteHero3 } from './remoteHero';
import { coop } from './coop';

/** every hero's attack / action poses (Tosha: sword, swordAlt, fork, spin, sling; the others: see HeroAtk) */
export type AtkKind = HeroAtk;

const RUN = 7.6;
const JUMP = 11.6;
const DJUMP = 10.2;
/** team buff «Геройский клич»: run speed factor */
const HASTE = 1.3;
/** co-op: jumping off a friend's head goes ≈1.6× as high */
const BOOST = JUMP * Math.sqrt(1.6);
/** co-op downed: crawl speed, and how long until I bleed out (back at the candle) */
const CRAWL = 1.25;
export const BLEED_T = 25;
/** how long each emote (wave, dance, bow, facepalm) plays */
const EMOTE_DUR = [2.4, 3.8, 2.2, 2.4];
/** what Tosha says after crashing down to the library floor (now and then) */
const CRASH_LINES = ['Бум! Всё сначала…', 'Ай-ай… опять с самого низа!', 'Ну вот, снова карабкаться…', 'Пол — мой лучший друг…', 'Зато быстро спустился!'];

const v3 = new THREE.Vector3();

export class Player3 {
  body: Body = makeBody(0.3, 0.95);
  rig: HeroRig;
  /** «Хрумляндия»: which hero I play here (the level decides: the prologue is always Tosha) and his abilities */
  kind: HeroKind = 'tosha';
  kit: HeroKit;
  root = new THREE.Group();
  blob = makeBlob(0.45);
  yaw = 0;
  hp = 5; maxHp = 5;
  ammo = 10;
  weapon: 'sword' | 'fork' = 'sword';
  invuln = 0; flash = 0;
  coyote = 0; jumpBuf = 0; jumping = false;
  canDouble = false; airDash = true; airDashes = 0;
  /** pot-lid shield upgrade: soaks one hit, recharged at candles */
  lid = false;
  /** team buffs (Тоша's «Геройский клич», heroes/team.ts): seconds left of extra speed and of a one-hit shield */
  haste = 0; ward = 0;
  dashT = 0; dashCD = 0;
  // attack ids start at a random base so two heroes' swings never share an id (enemies dedupe hits by it)
  atk: AtkKind | null = null; atkT = 0; atkDur = 0; atkId = Math.floor(Math.random() * 1e9); atkCD = 0; atkAlt = false; atkHit = false;
  readonly isLocal = true;
  /** co-op: knocked down, waiting for a friend (see the co-op features) */
  downed = false;
  /** co-op downed: seconds left before I bleed out; a friend's revive progress on me (0..1, fades without news) */
  bleedT = 0; reviveP = 0; reviveBy = ''; reviveSeen = 0;
  /** co-op emote being played (0 none, 1..4 = EMOTES) */
  emote = 0; emoteT = 0;
  private emoteNext = 1;
  /** co-op: holding interact on a friend (revive / gift): stand still, face this point (set by the co-op plugin) */
  busyAt: THREE.Vector3 | null = null;
  /** boost jump: the friend whose head I just jumped off (the co-op plugin tells everyone, then clears it) */
  boostOff: RemoteHero3 | null = null;
  /** the friend whose head I stand on (kept a moment after stepping off, like coyote time) */
  private headOf: RemoteHero3 | null = null;
  private headT = 0;
  /** voice: currently talking (shown to friends) */
  talking = false;
  shootCD = 0;
  /** slingshot: tap = quick auto-aimed shot; hold = aim mode (over-the-shoulder camera + crosshair); release = fire */
  aimHold = 0; aiming = false; aimK = 0; firedInAim = false;
  aim = { point: new THREE.Vector3(), lock: null as THREE.Vector3 | null };
  /** what a quick shot would hit right now (drawn as a lock-on marker) */
  quickLock: THREE.Vector3 | null = null;
  grabbedBy: Noodle3 | null = null; grip = 0; grabDmgT = 0;
  control = true;
  auto: { x: number; z: number; speed: number } | null = null;
  forceState: HeroState | null = null;
  expr: HeroExpr | undefined;
  talk = 0;
  dead = false; deadT = 0;
  knockT = 0;
  squash = 1;
  lastSafe = new THREE.Vector3(); safeT = 0;
  /** highest point of the current fall (for levels with a fall limit) */
  private fallTop = -Infinity;
  /** where the fall check last saw me: moving further than a few metres between frames is a teleport, not a fall */
  private fallPos = new THREE.Vector3(NaN, NaN, NaN);
  /** fallToFloor levels: spinning through the air (forceState 'tumble' is mine), dizzy after a crash, crash count */
  private tumbling = false;
  private dizzyT = 0;
  /** the camera pitch before a long fall tilted it down (eased back for camBackT s after landing) */
  private camPitch0: number | null = null;
  private camBackT = 0;
  private jokeT = 0;
  crashes = 0;
  /** co-op hardcore: knocked out by a big fall — no bleed-out, friends have to come down for me */
  fallKO = false;
  /** recent safe spots (runner mode respawns a bit further back so there is time to react) */
  private safeHist: { p: THREE.Vector3; t: number }[] = [];
  /** runner mode: brief hold after being thrown back */
  holdT = 0;
  stepT = 0;
  t = 0;
  hidden = false;
  faceYaw: number | null = null;
  /** chase mode: auto-run along +X at this base speed (A/D dodge sideways, W/S speed up / slow down) */
  autoRun: number | null = null;

  constructor() {
    this.rig = createHeroModel('tosha', profile.look);
    this.root.add(this.rig.root);
    this.kit = createKit('tosha', this);
  }

  /** play another hero (a new rig + kit); the level calls it right after it is built */
  setKind(kind: HeroKind, look: Parameters<typeof createHeroModel>[1] = profile.lookOf(kind)) {
    if (kind === this.kind && this.kit) { this.rig.setLook(look ?? {}); return; }
    this.root.remove(this.rig.root);
    this.rig.dispose();
    this.kind = kind;
    this.rig = createHeroModel(kind, look);
    this.root.add(this.rig.root);
    this.kit = createKit(kind, this);
    this.atk = null; this.dashT = 0;
  }

  get pos() { return this.body.pos; }
  get vel() { return this.body.vel; }
  get dashing() { return this.dashT > 0; }
  center(out = new THREE.Vector3()) { return out.copy(this.body.pos).setY(this.body.pos.y + 0.5); }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  /**
   * co-op: bumped whenever my position is set without moving there (respawn, candle, script placement, toss…):
   * friends then show me at the new spot at once instead of sliding there. Call teleported() after such a move.
   */
  tpN = 0;
  teleported() { this.tpN = (this.tpN + 1) % 256; }

  reset(p: THREE.Vector3, yaw: number) {
    this.body.pos.copy(p); this.body.vel.set(0, 0, 0);
    this.teleported();
    this.yaw = yaw;
    this.maxHp = save.data.maxHp + (coop.easy ? 3 : 0); this.hp = this.maxHp;
    this.ammo = save.data.ammoMax;
    this.dead = false; this.deadT = 0; this.invuln = 0; this.grabbedBy = null;
    this.downed = false; this.bleedT = 0; this.reviveP = 0; this.reviveBy = ''; this.emote = 0; this.busyAt = null; this.boostOff = null; this.headOf = null;
    this.lastSafe.copy(p);
    this.lid = save.data.upgrades.lid;
    this.haste = 0; this.ward = 0;
    if (this.weapon === 'fork' && !save.data.abilities.fork) this.weapon = 'sword';
    this.kit.reset?.();
  }

  update(L: Level3D, dt: number) {
    this.t += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.flash = Math.max(0, this.flash - dt * 6);
    this.atkCD -= dt; this.shootCD -= dt; this.dashCD -= dt; this.jumpBuf -= dt; this.knockT -= dt;
    this.haste = Math.max(0, this.haste - dt); this.ward = Math.max(0, this.ward - dt);
    this.talk = Math.max(0, this.talk - dt * 3);
    this.squash = damp(this.squash, 1, 12, dt);
    const ctl = this.control && !L.paused;
    const b = this.body;
    // a fall only counts while I drop freely: dead / down / held, or moved by a respawn / script / toss → no fall
    if (this.dead || this.downed || this.grabbedBy || this.fallPos.distanceToSquared(b.pos) > 16) {
      this.fallTop = -Infinity;
      if (this.tumbling) { this.tumbling = false; if (this.forceState === 'tumble') this.forceState = null; }
    }

    // out of action: the kit lets go of whatever it held (bridge, balloon, grapple)
    if (this.dead || this.downed || this.grabbedBy) this.kit.interrupt?.(L);
    if (this.dead) {
      this.deadT += dt;
      b.vel.x = approach(b.vel.x, 0, 10 * dt); b.vel.z = approach(b.vel.z, 0, 10 * dt);
      L.phys.move(b, dt);
      this.sync(L, dt);
      return;
    }
    if (this.downed) { this.updateDowned(L, dt, ctl); this.sync(L, dt); return; }
    if (this.grabbedBy) { this.updateGrabbed(L, dt, ctl); this.sync(L, dt); return; }

    // desired move direction (camera relative)
    let mx = 0, mz = 0, speedMul = 1;
    if (ctl) {
      const m = input.move3();
      const { f, r } = L.tcam.basis();
      mx = r.x * m.x + f.x * m.y;
      mz = r.y * m.x + f.y * m.y;
    }
    // co-op emotes: B / hold R3 plays the next one (wave → dance → bow → facepalm); moving on ends it
    if (this.emote) {
      this.emoteT += dt;
      const moving = Math.hypot(mx, mz) > 0.3 && this.emoteT > 0.35;
      if (!ctl || moving || !b.onGround || this.atk || this.dashT > 0 || this.knockT > 0 || this.aiming || this.emoteT > EMOTE_DUR[this.emote - 1]) this.emote = 0;
      else { mx = 0; mz = 0; }
    }
    if (ctl && L.nl && input.pressed('emote') && b.onGround && !this.atk && this.dashT <= 0 && !this.aiming && !this.busyAt) {
      this.emote = this.emoteNext; this.emoteT = 0;
      this.emoteNext = (this.emoteNext % EMOTES.length) + 1;
      mx = 0; mz = 0;
    }
    // reviving / giving: hold still facing the friend
    if (this.busyAt) {
      mx = 0; mz = 0;
      let diff = Math.atan2(this.busyAt.x - b.pos.x, this.busyAt.z - b.pos.z) - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * Math.min(1, dt * 10);
    }
    this.holdT = Math.max(0, this.holdT - dt);
    if (this.autoRun !== null && ctl && !this.auto && this.holdT <= 0) {
      const m = input.move3();
      // runner controls: A/D dodge left/right, W sprints, S brakes
      const fwd = this.autoRun + (m.y > 0 ? m.y * 2.4 : m.y * 3.5);
      const side = m.x * 6.5;
      const l = Math.hypot(fwd, side);
      mx = fwd / l; mz = side / l; speedMul = l / RUN;
    } else if (this.autoRun !== null && this.holdT > 0) { mx = 0; mz = 0; }
    if (this.auto) {
      const dx = this.auto.x - b.pos.x, dz = this.auto.z - b.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) { this.auto = null; mx = 0; mz = 0; }
      else { mx = dx / d; mz = dz / d; speedMul = this.auto.speed; }
    }
    // the hero's kit: its per-tick logic; a rooted hero (bridging, pulling) neither steers nor walks
    const kit = this.kit;
    kit.pre?.(L, dt, ctl);
    const rooted = !!kit.locked?.();
    if (rooted) { mx = 0; mz = 0; }
    const mlen = Math.hypot(mx, mz);
    if (this.aiming) { const cy = L.tcam.yaw; this.yaw = Math.atan2(-Math.sin(cy), -Math.cos(cy)); speedMul *= 0.5; }
    else if (mlen > 0.05 && this.knockT <= 0 && (!this.atk || this.atk === 'sling' || this.atk === 'syringe')) {
      const want = Math.atan2(mx, mz);
      let diff = want - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * Math.min(1, dt * 16);
    }
    if (this.faceYaw !== null) { this.yaw = this.faceYaw; }

    // dash (a hero without a special move dashes on the special button too)
    const dashKey = ctl && !rooted && (input.pressed('dash') || (!kit.special && input.pressed('special')));
    if (kit.dash) {
      if (dashKey && this.dashCD <= 0 && (b.onGround || this.airDash) && this.dashT <= 0 && kit.dash(L, mx, mz)) {
        if (!b.onGround) { this.airDashes++; this.airDash = false; }
        this.atk = null;
      }
    } else if (dashKey && (save.data.abilities.dash || kit.innate?.dash) && this.dashCD <= 0 && (b.onGround || this.airDash) && this.dashT <= 0) {
      const wind = save.data.upgrades.windCloak;
      this.dashT = 0.2; this.dashCD = wind ? 0.33 : 0.55;
      if (!b.onGround) { this.airDashes++; if (this.airDashes >= (wind ? 2 : 1)) this.airDash = false; }
      L.noise(b.pos, 5);
      if (mlen > 0.05) this.yaw = Math.atan2(mx, mz);
      this.squash = 0.75;
      audio.sfx('dash');
      L.tcam.fovKick = 10;
      L.fx.ring(this.center(), 1.2, '#bfe8ff', 0.3, false);
      this.atk = null;
    }

    if (rooted) {
      b.vel.x = approach(b.vel.x, 0, 60 * dt); b.vel.z = approach(b.vel.z, 0, 60 * dt);
    } else if (this.dashT > 0 && kit.dashTick) {
      kit.dashTick(L, dt);
    } else if (this.dashT > 0) {
      this.dashT -= dt;
      const sp = 21;
      b.vel.x = Math.sin(this.yaw) * sp; b.vel.z = Math.cos(this.yaw) * sp; b.vel.y = 0;
      b.gravity = 0;
      L.fx.emit(this.center(), { count: 2, speed: [0.2, 0.8], life: [0.2, 0.35], size: [0.25, 0.4], colors: ['#bfe8ff', '#ffffff', '#ff8a2a'], drag: 3 });
      if (this.dashT <= 0) { b.vel.x *= 0.4; b.vel.z *= 0.4; b.gravity = 32; }
    } else if (this.knockT > 0) {
      b.vel.x = approach(b.vel.x, 0, 12 * dt); b.vel.z = approach(b.vel.z, 0, 12 * dt);
    } else {
      const atkSlow = this.atk && this.atk !== 'sling' && this.atk !== 'syringe' && b.onGround ? 0.35 : 1;
      const run = kit.run * (kit.moveMul?.() ?? 1) * (this.haste > 0 ? HASTE : 1);
      const tx = mx * run * speedMul * atkSlow, tz = mz * run * speedMul * atkSlow;
      const acc = (b.onGround ? 70 : 34) * dt;
      const dec = (b.onGround ? 60 : 14) * dt;
      if (mlen > 0.05) { b.vel.x = approach(b.vel.x, tx, acc); b.vel.z = approach(b.vel.z, tz, acc); }
      else { b.vel.x = approach(b.vel.x, 0, dec); b.vel.z = approach(b.vel.z, 0, dec); }
    }

    // jump
    if (ctl && !rooted && input.pressed('jump')) this.jumpBuf = 0.13;
    if (b.onGround) { this.coyote = 0.11; this.canDouble = true; this.airDash = true; this.airDashes = 0; } else this.coyote -= dt;
    // co-op: standing on a friend's head (his one-way head collider) → the next jump is a boost
    this.headT -= dt;
    if (b.onGround && b.ground?.tag === 'hero' && L.nl) {
      for (const r of L.nl.remotes.values()) if (r.col === b.ground) { this.headOf = r; this.headT = 0.12; }
    }
    if (this.jumpBuf > 0 && this.dashT <= 0) {
      if (this.coyote > 0) {
        const boost = this.headT > 0 && this.headOf && !this.headOf.dead && !this.headOf.downed ? this.headOf : null;
        b.vel.y = boost ? BOOST * (kit.jump / JUMP) : kit.jump; this.jumping = true; this.jumpBuf = 0; this.coyote = 0; b.onGround = false;
        this.squash = 1.35;
        audio.sfx('jump');
        L.fx.dust(b.pos.clone(), 6);
        if (boost) {
          this.headT = 0; this.boostOff = boost; this.squash = 1.5;
          audio.sfx('bounce', { pitch: 1.25 });
          L.fx.ring(b.pos.clone(), 1.4, '#ffe14a', 0.4);
          L.fx.stars(b.pos.clone(), 18, ['#ffe14a', '#fff6c0', '#ffffff', '#ffb02a']);
          L.fx.text(b.pos.clone().setY(b.pos.y + 0.4), 'Суперпрыжок!', '#ffe14a', 22);
        }
      } else if (kit.airJump) {
        if (kit.airJump(L)) this.jumpBuf = 0;
      } else if (this.canDouble && (save.data.abilities.doubleJump || kit.innate?.doubleJump)) {
        b.vel.y = DJUMP; this.jumping = true; this.jumpBuf = 0; this.canDouble = false;
        this.squash = 1.3;
        audio.sfx('doubleJump');
        L.fx.ring(b.pos.clone(), 1.1, '#bfe8ff', 0.35);
        L.fx.stars(b.pos.clone(), 10, ['#bfe8ff', '#ffffff']);
      }
    }
    if (this.jumping && b.vel.y > 0 && !(ctl && input.down('jump'))) b.vel.y -= 32 * 1.4 * dt;
    if (b.vel.y <= 0) this.jumping = false;

    // attacks
    if (kit.shoot) kit.shoot(L, dt, ctl && !rooted); else this.updateSling(L, dt, ctl);
    if (ctl && !rooted && !this.aiming && input.pressed('attack') && this.atkCD <= 0 && this.dashT <= 0) this.startAttack(L);
    kit.special?.(L, dt, ctl);
    if (ctl && kit.swap !== false && input.pressed('swap') && save.data.abilities.fork) {
      this.weapon = this.weapon === 'sword' ? 'fork' : 'sword';
      audio.sfx('menuMove', { pitch: 1.3 });
      L.fx.text(this.center().setY(b.pos.y + 1.6), this.weapon === 'fork' ? 'Вилка-копьё' : 'Деревянный меч', '#ffffff', 18);
    }
    if (ctl && input.pressed('heal')) this.heal(L);

    // physics
    const wasGround = b.onGround;
    const preVy = b.vel.y;
    L.phys.move(b, dt);
    if (b.bounced) {
      this.jumping = false; this.canDouble = true; this.airDash = true;
      this.squash = 1.4;
      audio.sfx('bounce');
      L.fx.ring(b.pos.clone(), 1.6, '#ff9ac0', 0.35);
    }
    if (!wasGround && b.onGround && preVy < -8) {
      this.squash = 0.72;
      L.noise(b.pos, preVy < -18 ? 9 : 6);
      L.fx.dust(b.pos.clone(), preVy < -18 ? 10 : 5);
      audio.sfx('land', { volume: clamp(-preVy / 25, 0.3, 1) });
    }
    if (b.landedOn) L.onLand(b.landedOn);
    kit.post?.(L, dt);
    if (!b.onGround) this.fallTop = Math.max(this.fallTop, b.pos.y);
    else {
      const lim = L.def.fallLimit;
      const h = this.fallTop - b.pos.y;
      this.fallTop = -Infinity;
      if (lim && h > lim && !this.dead) {
        // the library: no pit — you really land down there (and climb again); elsewhere −1 heart and back up
        if (L.def.fallToFloor) this.crash(L, h);
        else { L.toast('Ой, высоко было падать!'); this.hazardHit(L, 1); }
      }
    }
    this.updateFall(L, dt);
    this.fallPos.copy(b.pos);
    if (b.onGround && Math.hypot(b.vel.x, b.vel.z) > 3) {
      this.stepT -= dt;
      if (this.stepT <= 0) { this.stepT = 0.26; L.fx.dust(b.pos.clone(), 1); L.noise(b.pos, 4.5); }
    }

    // attack processing
    if (this.atk) {
      this.atkT += dt;
      const k = this.atkT / this.atkDur;
      this.processAttack(L, k);
      if (this.atk && this.atkT >= this.atkDur) { this.atk = null; this.atkT = 0; }
    }

    // hazards & falling out
    const hz = L.phys.hazardAt(b);
    if (hz) this.hazardHit(L, hz.dmg);
    else if (b.pos.y < L.killY) { if (L.def.fallToFloor) this.belowFloor(L); else this.hazardHit(L, 1); }

    // remember safe ground
    const gt = b.ground?.tag;
    if (b.onGround && b.ground && !b.ground.bounce && !(b.ground.kind === 'box' && b.ground.crumbly) && gt !== 'gate' && gt !== 'king' && gt !== 'moving' && gt !== 'hero') {
      this.safeT -= dt;
      if (this.safeT <= 0) {
        this.safeT = 0.25;
        if (!this.nearHazard(L)) {
          this.lastSafe.copy(b.pos);
          this.safeHist.push({ p: b.pos.clone(), t: this.t });
          if (this.safeHist.length > 12) this.safeHist.shift();
        }
      }
    }
    this.sync(L, dt);
  }

  private nearHazard(L: Level3D) {
    const p = this.body.pos;
    for (const h of L.phys.hazards) {
      if (p.x > h.min.x - 1.2 && p.x < h.max.x + 1.2 && p.z > h.min.z - 1.2 && p.z < h.max.z + 1.2 && p.y < h.max.y + 2) return true;
    }
    return false;
  }

  private updateGrabbed(L: Level3D, dt: number, ctl: boolean) {
    const n = this.grabbedBy!;
    const tip = n.tip();
    const b = this.body;
    b.pos.x = damp(b.pos.x, tip.x, 10, dt);
    b.pos.y = damp(b.pos.y, tip.y - 0.6, 10, dt);
    b.pos.z = damp(b.pos.z, tip.z, 10, dt);
    b.vel.set(0, 0, 0);
    if (ctl && (input.pressed('jump') || input.pressed('attack') || input.pressed('left') || input.pressed('right') || input.pressed('fwd') || input.pressed('bwd') || input.pressed('dash'))) {
      this.grip -= 1;
      this.squash = 1.25;
      L.fx.emit(this.center(), { count: 5, speed: [1, 3], life: [0.3, 0.6], size: [0.12, 0.2], colors: ['#f6d06a', '#e8b84a'], g: 10 });
      audio.sfx('grab', { pitch: 1.4, volume: 0.5 });
      L.tcam.shake(0.08);
    }
    this.grabDmgT -= dt;
    if (this.grabDmgT <= 0) {
      this.grabDmgT = 1.4;
      this.hp -= 1; this.flash = 1;
      audio.sfx('hurt');
      L.tcam.shake(0.25);
      if (this.hp <= 0) { this.grabbedBy = null; n.release(); this.die(L); return; }
    }
    if (this.grip <= 0) {
      this.grabbedBy = null;
      n.release();
      b.vel.y = 9; this.invuln = 0.8;
      audio.sfx('break');
      L.fx.text(this.center().setY(b.pos.y + 1.4), 'Вырвался!', '#ffe14a', 20);
    }
  }

  startAttack(L: Level3D) {
    this.atkId++;
    L.noise(this.body.pos, 4);
    this.atkT = 0; this.atkHit = false;
    if (this.kit.attack?.(L)) return;
    if (!this.body.onGround && this.weapon === 'sword') {
      this.atk = 'spin'; this.atkDur = 0.34; this.atkCD = 0.36;
      audio.sfx('swing', { pitch: 1.25 });
    } else if (this.weapon === 'fork') {
      this.atk = 'fork'; this.atkDur = 0.42; this.atkCD = 0.46;
      audio.sfx('swingHeavy');
      if (this.body.onGround) { this.body.vel.x += Math.sin(this.yaw) * 5; this.body.vel.z += Math.cos(this.yaw) * 5; }
    } else {
      this.atkAlt = !this.atkAlt;
      this.atk = this.atkAlt ? 'swordAlt' : 'sword'; this.atkDur = 0.28; this.atkCD = 0.3;
      audio.sfx('swing', { pitch: this.atkAlt ? 1.1 : 0.95 });
    }
    // soft auto-aim: turn toward a nearby enemy in front
    const tgt = L.nearestTarget(this.center(), this.forward(), 3.4, 1.2);
    if (tgt) this.yaw = Math.atan2(tgt.x - this.body.pos.x, tgt.z - this.body.pos.z);
  }

  private processAttack(L: Level3D, k: number) {
    if (this.kit.processAttack?.(L, k)) return;
    const dmg = save.data.dmg + (this.atk === 'fork' ? 1 : 0);
    let hit = false;
    const c = this.center();
    const f = this.forward();
    if (this.atk === 'sword' || this.atk === 'swordAlt') {
      if (k > 0.12 && k < 0.62) hit = L.meleeHit(c, f, 1.85, 1.35, dmg, this.atkId, 'sword');
    } else if (this.atk === 'fork') {
      if (k > 0.1 && k < 0.5) hit = L.meleeHit(c, f, 2.9, 0.42, dmg, this.atkId, 'fork');
    } else if (this.atk === 'spin') {
      if (k < 0.85) hit = L.meleeHit(c, f, 1.7, Math.PI, dmg, this.atkId, 'spin');
      if (hit && !this.atkHit) {
        this.body.vel.y = 10; this.canDouble = true; this.airDash = true; this.jumping = false;
        audio.sfx('pogo');
      }
    }
    if (hit) this.atkHit = true;
  }

  private updateSling(L: Level3D, dt: number, ctl: boolean) {
    const has = save.data.abilities.slingshot || !!this.kit.innate?.sling;
    this.quickLock = null;
    if (!has || this.dead) { this.aimHold = 0; this.aiming = false; this.aimK = damp(this.aimK, 0, 10, dt); return; }
    if (this.autoRun !== null) {
      // runner camera: no aim mode, every press is an auto-aimed shot
      if (ctl && input.pressed('shoot') && this.shootCD <= 0) this.shoot(L, null);
      this.aimHold = 0; this.aiming = false; this.aimK = 0;
      return;
    }
    if (ctl && input.pressed('shoot') && this.dashT <= 0) { this.aimHold = 0.0001; this.firedInAim = false; }
    if (this.aimHold > 0) {
      if (ctl && input.down('shoot') && this.dashT <= 0 && !this.grabbedBy) {
        this.aimHold += dt;
        if (this.aimHold > 0.17 && !this.aiming) { this.aiming = true; audio.sfx('menuMove', { pitch: 0.7, volume: 0.6 }); }
      } else {
        if (!this.aiming) { if (this.shootCD <= 0) this.shoot(L, null); }
        else if (!this.firedInAim && ctl) this.shoot(L, this.aim.point);
        this.aimHold = 0; this.aiming = false;
      }
    }
    this.aimK = damp(this.aimK, this.aiming ? 1 : 0, 12, dt);
    if (this.aiming) {
      this.updateAimPoint(L);
      if (ctl && input.pressed('attack') && this.shootCD <= 0) { this.shoot(L, this.aim.point); this.firedInAim = true; input.consume('attack'); }
    } else if ((this.ammo > 0 || this.kit.fire) && ctl) {
      this.quickLock = L.nearestTarget(this.shotOrigin(), this.camAimDir(L), this.kit.fireRange ?? 24, 0.6);
    }
  }

  private shotOrigin() {
    const from = this.center().addScaledVector(this.forward(), 0.5);
    from.y += 0.15;
    return from;
  }

  /** crosshair ray from the camera; snaps to a target near the screen centre (aim assist) */
  private updateAimPoint(L: Level3D) {
    const cam = L.tcam.cam;
    const o = cam.position.clone();
    const d = new THREE.Vector3();
    cam.getWorldDirection(d);
    let best: THREE.Vector3 | null = null, bestS = 70;
    for (const t of L.aimTargetList()) {
      if (t.distanceTo(o) > 42) continue;
      const s = toUI(t, cam);
      if (!s.vis) continue;
      const sd = Math.hypot(s.x - W / 2, s.y - H / 2);
      if (sd < bestS) { bestS = sd; best = t; }
    }
    this.aim.lock = best;
    if (best) { this.aim.point.copy(best); return; }
    const hit = L.phys.raycast(o, d, 60);
    this.aim.point.copy(o).addScaledVector(d, Math.max(hit, 4));
  }

  shoot(L: Level3D, aimAt: THREE.Vector3 | null) {
    if (!save.data.abilities.slingshot && !this.kit.innate?.sling) return;
    // a hero with his own shot (Пастила's syrup, Ноки's pluck): same controls, no peas
    const own = this.kit.fire;
    if (!own && this.ammo <= 0) {
      audio.sfx('denied', { volume: 0.5 });
      L.fx.text(this.center().setY(this.body.pos.y + 1.5), 'Нет гороха!', '#ff9a9a', 18);
      this.shootCD = 0.4;
      return;
    }
    if (!own) this.ammo--;
    this.shootCD = 0.22;
    this.atk = this.kit.shotAtk ?? 'sling'; this.atkT = 0; this.atkDur = 0.25;
    const from = this.shotOrigin();
    let dir: THREE.Vector3;
    if (aimAt) dir = aimAt.clone().sub(from).normalize();
    else {
      const tgt = L.nearestTarget(from, this.camAimDir(L), this.kit.fireRange ?? 24, 0.6);
      dir = tgt ? tgt.clone().sub(from).normalize() : this.camAimDir(L);
    }
    this.yaw = Math.atan2(dir.x, dir.z);
    if (own) { this.shootCD = own.call(this.kit, L, from, dir); return; }
    L.spawnPea(from, dir.multiplyScalar(34));
    audio.sfx('shoot');
  }

  /** horizontal direction the camera looks (slightly up) */
  camAimDir(L: Level3D) {
    const { f } = L.tcam.basis();
    return new THREE.Vector3(f.x, 0.05, f.y).normalize();
  }

  heal(L: Level3D) {
    if (save.data.potions <= 0 || this.hp >= this.maxHp) { audio.sfx('denied', { volume: 0.4 }); return; }
    save.data.potions--;
    const amt = save.data.upgrades.comb ? 5 : 3;
    this.hp = Math.min(this.maxHp, this.hp + amt);
    audio.sfx('heal');
    L.fx.stars(this.center(), 18, ['#ffb020', '#ffe080', '#ffffff']);
    L.fx.text(this.center().setY(this.body.pos.y + 1.5), `+${amt} ♥`, '#ffd060', 22);
  }

  /** after being moved somewhere new (a toss forward), forget old safe spots so a hazard never sends me back */
  forgetSafe(at: THREE.Vector3) { this.lastSafe.copy(at); this.safeHist.length = 0; }

  /** a team buff from a friend's ability (heroes/team.ts): 'haste' = run faster, 'ward' = the next hit does no damage */
  buff(kind: 'haste' | 'ward', secs: number) {
    if (kind === 'haste') this.haste = Math.max(this.haste, secs);
    else this.ward = Math.max(this.ward, secs);
  }

  /** knock (optional) replaces the default shove away from `from`; knockT how long control is lost */
  hurt(L: Level3D, dmg: number, from: THREE.Vector3, knock?: THREE.Vector3, knockT = 0.25): boolean {
    if (this.dead || this.downed || this.invuln > 0 || this.dashT > 0 || (!this.control && !L.allowHurtInCutscene)) return false;
    if (this.ward > 0) {
      // a friend's «Геройский клич»: the golden shield takes this blow
      this.ward = 0;
      audio.sfx('clang', { pitch: 1.4 }); audio.sfx('break', { pitch: 1.8, volume: 0.5 });
      L.fx.sparks(this.center(), 16, ['#ffffff', '#ffe14a', '#ffb02a']);
      L.fx.ring(this.center(), 1.3, '#ffe14a', 0.35, false);
      L.fx.text(this.center().setY(this.body.pos.y + 1.6), 'Щит!', '#ffe14a', 22);
      dmg = 0;
    } else if (this.lid) {
      // the pot lid takes the blow and clatters away
      this.lid = false;
      audio.sfx('clang'); audio.sfx('break', { pitch: 1.5, volume: 0.6 });
      L.fx.sparks(this.center(), 16, ['#ffffff', '#c8d0e0', '#ffe14a']);
      L.fx.text(this.center().setY(this.body.pos.y + 1.6), 'Крышка спасла!', '#c8e0ff', 22);
      dmg = 0;
    }
    this.hp -= dmg;
    if (dmg > 0) L.stats.hits++;
    this.invuln = dmg > 0 ? 1.0 : 0.8; this.flash = 1;
    v3.copy(this.body.pos).sub(from).setY(0);
    if (v3.lengthSq() < 0.001) v3.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    v3.normalize();
    if (knock) this.body.vel.copy(knock); else this.body.vel.set(v3.x * 8, 7.5, v3.z * 8);
    this.knockT = knockT;
    this.jumping = false; this.atk = null; this.emote = 0;
    this.kit.interrupt?.(L);
    if (this.grabbedBy) { this.grabbedBy.release(); this.grabbedBy = null; }
    L.hitstop(0.09);
    L.tcam.shake(0.45);
    audio.sfx('hurt');
    L.fx.sparks(this.center(), 12, ['#ffffff', '#ff5a5a', '#ffd34a']);
    if (this.hp <= 0) this.die(L);
    return true;
  }

  hazardHit(L: Level3D, dmg: number) {
    if (this.dead) return;
    if (this.downed) { this.body.pos.copy(this.lastSafe).add(new THREE.Vector3(0, 0.05, 0)); this.body.vel.set(0, 0, 0); this.teleported(); return; }
    this.dashT = 0; this.body.gravity = 32;
    this.hp -= dmg; this.flash = 1;
    L.stats.hits++;
    audio.sfx('hurt');
    L.tcam.shake(0.4);
    L.fx.sparks(this.center(), 10, ['#ffffff', '#ff5a5a']);
    if (this.hp <= 0) {
      // co-op: go down on safe ground, not in the pit / the soup
      if (this.canGoDown(L)) { L.fadeFlash(); this.body.pos.copy(this.lastSafe).add(new THREE.Vector3(0, 0.05, 0)); this.body.vel.set(0, 0, 0); this.teleported(); }
      this.die(L);
      return;
    }
    L.fadeFlash();
    let back = this.lastSafe;
    if (this.autoRun !== null) {
      // runner: go back ~1.2 s so the obstacle is visible again, and wait a moment before running
      for (let i = this.safeHist.length - 1; i >= 0; i--) if (this.t - this.safeHist[i].t >= 1.2) { back = this.safeHist[i].p; break; }
      this.holdT = 0.7;
    }
    this.body.pos.copy(back).add(new THREE.Vector3(0, 0.05, 0));
    this.body.vel.set(0, 0, 0);
    this.teleported();
    this.invuln = 1.2;
  }

  // ───────────────── fallToFloor levels (the library): long falls ─────────────────
  /** a crash landing after a long fall: no heart lost and no trip back up — a tumble, and the climb starts over */
  private crash(L: Level3D, h: number) {
    const b = this.body;
    // nothing may carry me back up there (hazards and the safety net below the floor use the last safe spot)
    this.forgetSafe(b.pos);
    this.crashes++;
    this.squash = 0.45; this.knockT = 0.55; this.dizzyT = 1.5;
    this.atk = null; this.jumping = false; this.dashT = 0; b.gravity = 32;
    b.vel.x *= 0.2; b.vel.z *= 0.2;
    L.tcam.shake(clamp(h / 60, 0.35, 0.7));
    if (L.tcam.mode === 'follow') L.tcam.focus.y = Math.min(L.tcam.focus.y, b.pos.y + 1.5);
    input.rumble(0.6, 0.9, 260);
    audio.sfx('land', { volume: 1, pitch: 0.75 }); audio.sfx('bounce', { pitch: 0.55, volume: 0.45 });
    L.noise(b.pos, 9);
    L.fx.dust(b.pos.clone(), 18);
    L.fx.ring(b.pos.clone().setY(b.pos.y + 0.05), 2.6, '#e8dcc8', 0.45);
    L.fx.stars(this.center().setY(b.pos.y + 1.2), 16, ['#fff6c0', '#ffe14a', '#ffffff']);
    L.fx.text(this.center().setY(b.pos.y + 1.8), 'БУМ!', '#ffb35a', 34);
    // a line now and then (the floor becomes a regular: not every time)
    if (this.crashes === 1 || this.t > this.jokeT) {
      this.jokeT = this.t + 25;
      L.bark(this.root, CRASH_LINES[(this.crashes - 1) % CRASH_LINES.length], 2.4, 1.6);
    }
    // co-op hardcore: knocked out right where I landed — the friends have to come down for me
    if (coop.hard && this.canGoDown(L)) {
      this.goDown(L);
      this.fallKO = true;
      b.vel.set(0, 2, 0); this.squash = 0.6;
      L.bark(this.root, 'Ой… я тут полежу… Спуститесь за мной!', 2.6, 1.1);
    }
  }

  /** tumbling through the air on a long fall (the camera tilts to show the floor coming), dizzy stars after a crash */
  private updateFall(L: Level3D, dt: number) {
    const b = this.body;
    const lim = L.def.fallToFloor ? L.def.fallLimit ?? 0 : 0;
    const tumble = lim > 0 && !b.onGround && !this.downed && b.vel.y < -12 && this.fallTop - b.pos.y > lim * 0.5;
    if (tumble && !this.tumbling && !this.forceState) { this.tumbling = true; this.forceState = 'tumble'; }
    else if (!tumble && this.tumbling) { this.tumbling = false; if (this.forceState === 'tumble') this.forceState = null; }
    if (tumble && L.tcam.mode === 'follow') {
      if (L.tcam.pitch < 0.75) { this.camPitch0 ??= L.tcam.pitch; L.tcam.pitch = damp(L.tcam.pitch, 0.75, 2.5, dt); }
      this.camBackT = 1.6;
      // the follow camera trails a fast fall by ~3 m: keep it close enough that the crash happens on screen
      L.tcam.focus.y = Math.min(L.tcam.focus.y, b.pos.y + 2);
    }
    // down: the camera eases back to where it was before the fall
    if (this.camPitch0 !== null && b.onGround) {
      this.camBackT -= dt;
      if (L.tcam.mode === 'follow') L.tcam.pitch = damp(L.tcam.pitch, this.camPitch0, 2.2, dt);
      if (this.camBackT <= 0) this.camPitch0 = null;
    }
    if (this.dizzyT > 0) {
      const was = this.dizzyT;
      this.dizzyT -= dt;
      if (Math.floor(was * 9) !== Math.floor(this.dizzyT * 9)) {
        const a = this.t * 7;
        v3.set(b.pos.x + Math.cos(a) * 0.45, b.pos.y + 1.45, b.pos.z + Math.sin(a) * 0.45);
        L.fx.stars(v3.clone(), 1, ['#ffe14a', '#ffffff']);
      }
    }
  }

  /** the safety net of a fallToFloor level: never stuck under the floor — back on it at the start, no damage */
  private belowFloor(L: Level3D) {
    const b = this.body;
    b.pos.set(L.def.spawn[0], L.def.spawn[1] + 0.3, L.def.spawn[2]);
    b.vel.set(0, 0, 0);
    this.forgetSafe(b.pos);
    this.teleported();
    L.tcam.snap(b.pos);
    L.fadeFlash();
  }

  die(L: Level3D) {
    if (this.dead) return;
    if (this.canGoDown(L)) { this.goDown(L); return; }
    this.downed = false; this.emote = 0; this.busyAt = null;
    this.hp = 0; this.dead = true; this.deadT = 0;
    this.body.vel.set(-Math.sin(this.yaw) * 2, 8, -Math.cos(this.yaw) * 2);
    this.grabbedBy = null;
    audio.sfx('fall');
    L.onPlayerDeath();
  }

  // ───────────────── co-op: downed / revive ─────────────────
  /** co-op with friends: 0 hp knocks me down instead (not in the chase — nobody could come back for me there) */
  canGoDown(L: Level3D) { return !!L.nl && !this.downed && this.autoRun === null && coop.players > 1; }

  private goDown(L: Level3D) {
    const g = this.grabbedBy;
    this.grabbedBy = null;
    g?.release();
    this.hp = 0; this.downed = true; this.bleedT = BLEED_T; this.reviveP = 0; this.reviveBy = ''; this.reviveSeen = 0; this.fallKO = false;
    this.emote = 0; this.busyAt = null; this.atk = null; this.dashT = 0; this.knockT = 0; this.jumping = false; this.invuln = 0;
    this.aimHold = 0; this.aiming = false; this.body.gravity = 32;
    this.kit.interrupt?.(L);
    this.body.vel.set(-Math.sin(this.yaw) * 2.5, 6, -Math.cos(this.yaw) * 2.5);
    audio.sfx('fall');
    L.tcam.shake(0.5);
    L.slowT = Math.max(L.slowT, 0.5);
    L.fx.stars(this.center().setY(this.body.pos.y + 1.1), 14, ['#fff6c0', '#ffe14a', '#ffffff']);
  }

  private updateDowned(L: Level3D, dt: number, ctl: boolean) {
    const b = this.body;
    this.hp = 0;
    // crawl (camera relative); hold still while a friend lifts me
    let mx = 0, mz = 0;
    if (ctl && this.reviveP <= 0) {
      const m = input.move3();
      const { f, r } = L.tcam.basis();
      mx = r.x * m.x + f.x * m.y;
      mz = r.y * m.x + f.y * m.y;
    }
    const ml = Math.hypot(mx, mz);
    if (ml > 0.05) {
      let diff = Math.atan2(mx, mz) - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * Math.min(1, dt * 5);
    }
    const acc = (b.onGround ? 12 : 4) * dt;
    b.vel.x = approach(b.vel.x, mx * CRAWL, acc); b.vel.z = approach(b.vel.z, mz * CRAWL, acc);
    L.phys.move(b, dt);
    if (b.onGround && ml > 0.05) { this.stepT -= dt; if (this.stepT <= 0) { this.stepT = 0.45; L.fx.dust(b.pos.clone(), 1); } }
    // nothing hurts me while I'm down; a pit or a hazard just puts me back on safe ground
    if (L.phys.hazardAt(b) || b.pos.y < L.killY) { b.pos.copy(this.lastSafe).add(new THREE.Vector3(0, 0.05, 0)); b.vel.set(0, 0, 0); this.teleported(); L.fadeFlash(); }
    // bleeding out — paused while a friend lifts me or a story beat plays
    this.reviveSeen -= dt;
    if (this.reviveSeen <= 0) this.reviveP = 0;
    // (knocked out by a big fall in hardcore: no bleed-out — the friends have to come down)
    if (this.reviveP <= 0 && !L.worldCut && !L.complete && !this.fallKO) {
      // the chase King ran past me: nobody can come back, so it goes quicker
      const ch = L.chaser as unknown as { active?: boolean; front?: number } | null;
      const fast = !!ch?.active && ch.front !== undefined && b.pos.x < ch.front;
      this.bleedT -= dt * (fast ? 4 : 1);
    }
    if (this.bleedT <= 0) this.bleedOut(L);
  }

  /** a friend's revive progress on me (from the co-op plugin) */
  reviving(p: number, by: string) { if (!this.downed) return; this.reviveP = clamp(p, 0, 1); this.reviveBy = by; this.reviveSeen = 0.45; }

  /** a friend got me up: back in the fight with 2 hearts */
  revive(L: Level3D): boolean {
    if (!this.downed || this.dead) return false;
    this.downed = false; this.reviveP = 0; this.bleedT = 0;
    this.hp = Math.min(this.maxHp, 2);
    this.invuln = 1.6; this.flash = 1; this.squash = 1.35;
    this.body.vel.set(0, 6.5, 0);
    audio.sfx('heal'); audio.sfx('doubleJump', { pitch: 1.2 });
    L.fx.stars(this.center(), 22, ['#9ff0a0', '#ffffff', '#ffe14a']);
    L.fx.ring(this.body.pos.clone().setY(this.body.pos.y + 0.05), 1.5, '#9ff0a0', 0.45);
    L.fx.text(this.center().setY(this.body.pos.y + 1.6), 'Снова в строю!', '#9ff0a0', 22);
    return true;
  }

  /** nobody came in time: it counts as a death (crumbs lost), and I come back at the latest candle */
  bleedOut(L: Level3D) {
    if (!this.downed) return;
    this.downed = false; this.reviveP = 0;
    this.hp = 0; this.dead = true; this.deadT = 0;
    this.body.vel.set(0, 4, 0);
    audio.sfx('fall');
    L.onPlayerDeath();
  }

  /** my state for friends (layout HS in remoteHero.ts) */
  netState(): number[] {
    const b = this.body;
    const r2 = (x: number) => Math.round(x * 100) / 100;
    let f = 0;
    if (this.dead) f |= HF.dead;
    if (this.downed) f |= HF.downed;
    if (this.grabbedBy) f |= HF.grabbed;
    if (this.hidden) f |= HF.hidden;
    if (this.invuln > 0) f |= HF.invuln;
    if (this.dashT > 0) f |= HF.dashing;
    if (b.onGround) f |= HF.ground;
    if (this.control) f |= HF.control;
    if (this.talking) f |= HF.talking;
    const a: number[] = new Array(HS.len).fill(0);
    a[HS.x] = r2(b.pos.x); a[HS.y] = r2(b.pos.y); a[HS.z] = r2(b.pos.z);
    a[HS.yaw] = r2(this.yaw);
    a[HS.vx] = r2(b.vel.x); a[HS.vy] = r2(b.vel.y); a[HS.vz] = r2(b.vel.z);
    a[HS.st] = Math.max(0, HERO_STATES.indexOf(this.heroState()));
    a[HS.atk] = this.atk ? ATK_KINDS.indexOf(this.atk) : -1;
    a[HS.atkP] = this.atk ? r2(clamp(this.atkT / Math.max(0.01, this.atkDur), 0, 1)) : 0;
    a[HS.weapon] = this.weapon === 'fork' ? 1 : 0;
    a[HS.hp] = this.hp; a[HS.maxHp] = this.maxHp;
    a[HS.flags] = f;
    a[HS.expr] = Math.max(0, EXPRS.indexOf(this.expr ?? this.kit.expr?.() ?? (this.dead ? 'hurt' : this.grabbedBy ? 'scared' : this.dashT > 0 ? 'angry' : 'normal')));
    a[HS.squash] = r2(this.squash);
    a[HS.emote] = this.emote;
    a[HS.tp] = this.tpN;
    // my clock (ms) when this was sent: friends play my stream back on it (see netInterp.ts)
    a[HS.ts] = Math.round(performance.now());
    // «Хрумляндия»: which hero, and his kit's visible state (4 numbers, each kit's own meaning: heroes/index.ts)
    a[HS.kind] = KIND_IDS.indexOf(this.kind);
    const kf = kitNet(this.kind).encode(this.kit.fx());
    for (let i = 0; i < 4; i++) a[HS.k0 + i] = r2(kf[i] ?? 0);
    // team buffs on me (friends draw the aura): 1 = haste, 2 = one-hit shield
    a[HS.buff] = (this.haste > 0 ? 1 : 0) | (this.ward > 0 ? 2 : 0);
    return a;
  }

  heroState(): HeroState {
    if (this.forceState) return this.forceState;
    if (this.dead) return 'dead';
    if (this.downed) return 'downed';
    if (this.grabbedBy) return 'grabbed';
    if (this.dashT > 0) return 'dash';
    if (this.knockT > 0) return 'hurt';
    const b = this.body;
    if (!b.onGround) return b.vel.y > 0 ? 'jump' : 'fall';
    const hs = Math.hypot(b.vel.x, b.vel.z);
    if (hs > 0.5) return this.auto && this.auto.speed < 0.6 ? 'walk' : 'run';
    if (this.emote) return EMOTES[this.emote - 1] ?? 'idle';
    if (this.busyAt) return 'sneak';
    return 'idle';
  }

  /** push transforms to the rig and the blob shadow */
  sync(L: Level3D, dt: number) {
    const b = this.body;
    this.root.position.copy(b.pos);
    this.root.rotation.y = this.yaw;
    this.root.visible = !this.hidden;
    const blink = this.invuln > 0 && !this.dead && Math.floor(this.invuln * 14) % 2 === 0;
    this.rig.root.visible = !blink;
    const hs = Math.hypot(b.vel.x, b.vel.z);
    this.rig.update(dt, {
      state: this.heroState(),
      speed: clamp(hs / this.kit.run, 0, 1.4),
      attack: this.atk ? { kind: this.atk, p: clamp(this.atkT / this.atkDur, 0, 1) } : null,
      weapon: this.weapon,
      flash: this.flash,
      talk: this.talk > 0 ? Math.abs(Math.sin(this.t * 16)) : 0,
      expr: this.expr ?? this.kit.expr?.() ?? (this.dead ? 'hurt' : this.grabbedBy ? 'scared' : this.dashT > 0 ? 'angry' : 'normal'),
      squash: this.squash,
      fx: this.kit.fx(),
    });
    // blob shadow on the ground below
    const gy = L.phys.groundAt(b.pos.x, b.pos.z, b.pos.y + 0.1, 0.1);
    if (gy > -1e8 && !this.hidden) {
      this.blob.visible = true;
      this.blob.position.set(b.pos.x, gy + 0.03, b.pos.z);
      const h = b.pos.y - gy;
      const s = clamp(1 - h * 0.08, 0.35, 1);
      this.blob.scale.set(s, s, s);
      (this.blob.material as THREE.MeshBasicMaterial).opacity = clamp(1 - h * 0.06, 0.25, 1);
    } else this.blob.visible = false;
  }
}
