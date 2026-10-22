import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { choose, rand } from '../../../../engine/util';
import { net } from '../../../../net/session';
import { makeBlob } from '../../../fx';
import { clamp, damp } from '../../../models/kit';
import type { Level3D, Boss3Like, HeroLike } from '../../level';
import type { Netted } from '../../netLevel';
import type { Shot3 } from '../../objects';
import { NetTrack, type NetPose } from '../../netInterp';
import { coop } from '../../coop';
import { vamp, Invisibility, markCharacter, GroundMark, ambient, type Lantern } from '../vampires';
import { createShepot, shardLook, type ShepotRig, type ShepotAnim } from './bossRig';
import type { BeamMirror } from './mirrors';
import type { PollenFlower, Footprints } from './pollen';
import type { Whispers } from './whisper';
import { posSfx } from './whisper';
import { BOSS, TOAST, DECOY_ECHO } from './lines';
import type { WateringCan, Puddles } from './can';

/**
 * Шёпот — the invisible vampire of the dome (docs/script-fangs.md §7.3–7.5). You mostly don't see him:
 *  • footprints in the pollen on the floor (every machine stamps them from the position it draws);
 *  • the tall mirrors around the dome show him (the level's Reflections) — and never his decoys;
 *  • he is heard: whispers float where he is (italic, off-screen at the edge they come from), a panned sound;
 *  • he shimmers before he strikes (a red ring on the floor where his claws land) and glints before a volley of
 *    glass shards;
 *  • he shows for a few seconds: hit him, Ноки's chord (stunned too), Пастила's beacon / a lit «солнышко» near him,
 *    a pollen flower bursting, the noon pulse of the bed while two of its three mirrors shine on it.
 * Phases (by HP): 1 stalking + shards; 2 he splits into whispering decoys (no reflection, harmless, pop when shown or
 * hit); 3 he darkens the dome — every «солнышко» out, the three mirrors turned away — relight them (a swing), turn
 * the mirrors back ([E]); he keeps snuffing lights and turning mirrors (telegraphed). HP and pace scale with the team.
 * Co-op: the host simulates; clients play the snapshots back (NetTrack) — position, state, visibility, the decoys
 * and the dark all the same on every machine; whispers and shards are host events.
 */

export const ARENA = { c: new THREE.Vector3(0, 0, -131), R: 14.2, bed: 3.1 };
const BASE_HP = 34;

type St = 'wait' | 'stalk' | 'tele' | 'claw' | 'recover' | 'aim' | 'throw' | 'goSnuff' | 'blow' | 'goMirror' | 'shake' | 'stun' | 'hurt' | 'split' | 'darken' | 'dying' | 'dead';
const STATES: St[] = ['wait', 'stalk', 'tele', 'claw', 'recover', 'aim', 'throw', 'goSnuff', 'blow', 'goMirror', 'shake', 'stun', 'hurt', 'split', 'darken', 'dying', 'dead'];
const ANIM: Partial<Record<St, string>> = { tele: 'tele', claw: 'claw', aim: 'aim', throw: 'throw', blow: 'blow', shake: 'blow', stun: 'stun', hurt: 'hurt', split: 'hurt', darken: 'blow', dying: 'stun', dead: 'stun' };
const MAX_DECOYS = 4;

interface Decoy {
  pos: THREE.Vector3; vel: THREE.Vector3;
  /** 0 off, 1 wandering, 2 fake telegraph */
  mode: number;
  t: number; back: number; ang: number; whT: number;
  root: THREE.Group; rig: ShepotRig; inv: Invisibility; anim: ShepotAnim; vis: number; mark: GroundMark;
  shown: number;
}

export interface ShepotEnv {
  lanterns: Lantern[];
  mirrors: BeamMirror[];
  flowers: PollenFlower[];
  feet: Footprints;
  whispers: Whispers;
  /** phase 3: Карамель's old watering can and its grey puddles (v2 §7.4) */
  can: WateringCan;
  puddles: Puddles;
  /** phase 2: what the heroes said lately (the decoys echo it) */
  heard: () => string[];
}

/** the can's states: off / floating after a hero / tilting (the telegraph, 0.9 s) / pouring / knocked to the floor */
const CAN_OFF = 0, CAN_FLOAT = 1, CAN_TILT = 2, CAN_POUR = 3, CAN_DOWN = 4;
const CAN_Y = 2.3, CAN_TILT_T = 0.9, CAN_POUR_T = 0.6;

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const pose: NetPose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };

export class Shepot3 implements Boss3Like, Netted {
  name = 'Шёпот';
  hp: number; maxHp: number;
  netId = 0;
  netKind = 'f3boss';
  get netRoot() { return this.root; }
  root = new THREE.Group();
  rig: ShepotRig;
  anim: ShepotAnim = { st: 'idle', p: 0, speed: 0, flash: 0, small: 0, hide: 0, talk: 0, vis: 0 };
  inv: Invisibility;
  blob: THREE.Mesh;
  pos = ARENA.c.clone().add(new THREE.Vector3(0, 0, -9));
  vel = new THREE.Vector3();
  yaw = 0;
  state: St = 'wait';
  st = 0; dur = 1;
  phase = 1;
  /** the fight is on (host decides; clients from the snapshots) */
  active = false;
  visGoal = 0; vis = 0;
  revealT = 0; stunT = 0;
  /** 0..1 the dome darkened (phase 3) */
  dark = 0; darkK = 0;
  /** seconds since he was last properly seen (solo help) */
  unseenT = 0;
  /** off stage for good (the defeat scene's «пуф») */
  gone = false;
  /** what the scripts / level do when he is beaten (host) */
  onDefeat: (() => void) | null = null;
  decoys: Decoy[] = [];
  private target: HeroLike | null = null;
  private tgtT = 0;
  private cd = 2.5; private shardCd = 4; private snuffCd = 12; private mirrorCd = 18; private whT = 3; private hurtWh = 0; private seenWh = 0;
  private noonT = 8;
  private goal: THREE.Vector3 | null = null;
  private goalObj: Lantern | BeamMirror | null = null;
  private retreat = 0;
  private hitIds = new Set<string | number>();
  private seq = 0;
  private flash = 0;
  private struck = false;
  private shots = 0;
  private ring = new GroundMark('#ff3a4a', true);
  private glint: THREE.Sprite;
  private t = 0;
  private toasted = new Set<string>();
  /** hits in the current window of being seen: the third one (unless stunned) and he blinks away */
  private windowHits = 0;
  private defeatT = -1;
  /** the watering can (phase 3; host simulates, snapshots carry it) */
  canMode = CAN_OFF;
  canPos = new THREE.Vector3();
  private canT = 0; private canCd = 3; private canRest = 0; private canTgt: HeroLike | null = null; private pudT = 0;
  private canFall = 0;
  // client playback
  private track: NetTrack<number[]> | null = null;
  private got = false;
  private base: { hemi: number; sun: number; fog: THREE.Color; bg: THREE.Color } | null = null;

  constructor(private L: Level3D, private env: ShepotEnv) {
    this.rig = createShepot();
    this.root.add(this.rig.root);
    markCharacter(this.rig.root);
    this.blob = makeBlob(0.9);
    this.inv = new Invisibility(this.rig.root, this.blob);
    this.inv.vis = 0;
    this.inv.apply(0.016, 0);
    this.root.visible = false;
    this.root.position.copy(this.pos);
    L.scene.add(this.root, this.blob);
    this.glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex(), color: '#e8f4ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.glint.scale.setScalar(1.6);
    this.rig.hand.add(this.glint);
    const heroes = L.nl ? Math.max(1, net.members.size) : 1;
    this.hp = this.maxHp = Math.round(BASE_HP * (L.nl ? coop.hpScale() : 1));
    for (let i = 0; i < MAX_DECOYS; i++) this.decoys.push(this.makeDecoy());
    void heroes;
    // fixed net id (made after the build, in the same order on every machine)
    if (L.nl) { let id = 930; while (L.nl.get(id)) id++; L.nl.add(this, id); }
  }

  private makeDecoy(): Decoy {
    const rig = createShepot();
    const root = new THREE.Group();
    root.add(rig.root);
    root.scale.setScalar(0.92);
    root.visible = false;
    this.L.scene.add(root);
    const inv = new Invisibility(rig.root, null);
    inv.vis = 0;
    return { pos: ARENA.c.clone(), vel: new THREE.Vector3(), mode: 0, t: 0, back: 0, ang: rand(0, Math.PI * 2), whT: rand(1, 3), root, rig, inv, anim: { st: 'idle', p: 0, speed: 0, flash: 0, small: 0, hide: 0, talk: 0, vis: 0 }, vis: 0, mark: new GroundMark('#ff3a4a', true), shown: 0 };
  }

  center(out = new THREE.Vector3()) { return out.copy(this.pos).setY(this.pos.y + 1.4); }
  get fighting() { return this.active && this.state !== 'dying' && this.state !== 'dead' && this.state !== 'wait'; }
  /** beaten (dying / dead). (Not `dead`: for a Netted that means gone — no more snapshots — and clients must see
   *  his last states too.) */
  get beaten() { return this.state === 'dead' || this.state === 'dying'; }

  /** host: the fight starts (after the intro / a retry) */
  start() {
    if (!this.L.authority) return;
    this.active = true;
    this.go('stalk');
    // (somewhere dark: west, between the unlit lanterns)
    this.pos.copy(ARENA.c).add(new THREE.Vector3(-11, 0, -3));
    this.cd = 2.5; this.shardCd = 3.5; this.snuffCd = 12; this.mirrorCd = 16; this.noonT = 6;
  }

  private go(s: St, dur = 0) { this.state = s; this.st = 0; this.dur = Math.max(0.001, dur); this.seq++; }
  private cdMul() { return 1 / (1 + 0.15 * (this.L.heroes().length - 1)); }
  private speed() { return [0, 4.3, 5.0, 5.6][this.phase] * (this.retreat > 0 ? 1.7 : 1); }

  // ═════════════════════════════ host ═════════════════════════════
  update(L: Level3D, dt: number) {
    this.t += dt;
    if (!L.authority) this.puppet(L, dt);
    else this.sim(L, dt);
    this.visuals(L, dt);
  }

  private whisper(at: THREE.Vector3, str: string) {
    const L = this.L;
    this.env.whispers.say(at, str);
    L.nl?.entEvent(this, 'wh', { p: [Math.round(at.x * 10) / 10, Math.round(at.y * 10) / 10, Math.round(at.z * 10) / 10], s: str });
  }
  private toastOnce(key: string, str: string) {
    if (this.toasted.has(key)) return;
    this.toasted.add(key);
    this.L.hud.toast(str, 6);
  }

  private sim(L: Level3D, dt: number) {
    const K = vamp(L);
    this.st += dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    if (!this.active) { this.visGoal = 0; return; }
    if (this.state === 'dead') { this.visGoal = 1; return; }
    if (this.state === 'dying') {
      this.visGoal = 1;
      this.dark = 0;
      if (this.defeatT >= 0 && (this.defeatT += dt) > 1.4) { this.defeatT = -1; this.state = 'dead'; this.onDefeat?.(); }
      return;
    }
    if (L.worldCut) { this.halt(dt); return; }
    this.cd -= dt; this.shardCd -= dt; this.snuffCd -= dt; this.mirrorCd -= dt; this.whT -= dt; this.hurtWh -= dt; this.seenWh -= dt; this.tgtT -= dt;
    this.revealT = Math.max(0, this.revealT - dt);
    this.retreat = Math.max(0, this.retreat - dt);
    // the noon pulse: two of the three mirrors on the bed
    const lit = this.env.mirrors.filter((m) => m.locked).length;
    if (lit >= 2) {
      if ((this.noonT -= dt) <= 0) { this.noonT = this.phase === 3 ? 8 : 10; this.noon(L); }
    } else this.noonT = Math.max(this.noonT, 3);

    if (this.stunT > 0) {
      this.stunT -= dt;
      if (this.state !== 'stun') this.go('stun', this.stunT);
      this.halt(dt);
      if (this.stunT <= 0) { this.go('stalk'); this.retreat = 0.8; }
    } else this.brain(L, dt);
    this.decoySim(L, dt);
    this.canSim(L, dt);

    // visibility
    const sun = K.sunAt(this.center(v1));
    let g = Math.hypot(this.vel.x, this.vel.z) > 0.4 ? 0.03 : 0.01;
    if (this.state === 'tele' || this.state === 'aim') g = 0.42;
    if (this.state === 'recover' || this.state === 'blow' || this.state === 'shake') g = Math.max(g, 0.5);
    if (this.nearLightEdge()) g = Math.max(g, 0.45);
    if (sun > 0.25) g = Math.max(g, 0.95);
    if (this.revealT > 0 || this.stunT > 0 || this.state === 'split' || this.state === 'darken' || this.state === 'hurt') g = 1;
    this.visGoal = g;
    if (g > 0.8) {
      this.unseenT = 0;
      if (this.seenWh <= 0) { this.seenWh = 9; this.whisper(this.center(), choose(BOSS.seen as unknown as string[])); }
    } else { this.unseenT += dt; if (this.unseenT > 2) this.windowHits = 0; }
    // idle whispers from where he is (and the decoys)
    if (this.whT <= 0) {
      this.whT = rand(4.5, 7.5);
      if (this.state === 'stalk') this.whisper(this.center(), choose(BOSS.idle as unknown as string[]));
    }
  }

  /** a reveal of everything within r of `at` (pollen burst, the kit's revealAround): the boss shows, decoys pop */
  revealNear(at: THREE.Vector3, r: number, secs: number) {
    if (!this.L.authority || !this.fighting) return;
    if (this.center(v1).distanceTo(at) < r + 0.8) this.revealT = Math.max(this.revealT, secs);
    for (const d of this.decoys) if (d.mode && d.pos.distanceTo(at) < r + 0.8) this.popDecoy(d);
  }
  /** Ноки's chord (the kit's chord, or a 'chord' hit): stunned and shown; decoys around pop */
  chordNear(at: THREE.Vector3, r: number) {
    if (!this.L.authority || !this.fighting) return;
    if (this.center(v1).distanceTo(at) < r + 1.2) { this.stunT = Math.max(this.stunT, 2.2); this.revealT = Math.max(this.revealT, 4); this.flash = 1; }
    for (const d of this.decoys) if (d.mode && d.pos.distanceTo(at) < r + 1.2) this.popDecoy(d);
    if (this.canPos.distanceTo(at) < r + 1.2) this.knockCan(this.L);
  }
  /** shows him wherever he is (solo help: the story NPC's chord) */
  revealAll(secs: number) {
    if (!this.L.authority || !this.fighting) return;
    this.revealT = Math.max(this.revealT, secs);
    for (const d of this.decoys) if (d.mode) this.popDecoy(d);
  }

  private noon(L: Level3D) {
    this.revealT = Math.max(this.revealT, 2.2);
    for (const d of this.decoys) if (d.mode) this.popDecoy(d);
    this.noonFx();
    L.nl?.entEvent(this, 'noon', {});
    this.toastOnce('noon', TOAST.noon);
  }
  private noonFx() {
    const L = this.L;
    ambient(L, () => {
      L.fx.ring(ARENA.c.clone().setY(0.15), ARENA.R + 2, '#ffe9a0', 0.9);
      L.fx.ring(ARENA.c.clone().setY(1.2), 6, '#fff6c0', 0.6, false);
      L.fx.stars(ARENA.c.clone().setY(1.6), 30, ['#fff3a0', '#ffffff', '#ffd34a']);
      audio.sfx('lanternOn', { pitch: 0.6, volume: 0.8 });
    });
    L.whiteFlash = Math.max(L.whiteFlash, 0.25);
  }

  private nearLightEdge() {
    for (const l of this.env.lanterns) {
      if (!l.lit) continue;
      const d = Math.hypot(this.pos.x - l.pos.x, this.pos.z - l.pos.z);
      if (d < l.r + 1.6) return true;
    }
    return false;
  }

  /** a hero to go after: not in the light, not down; sticky for a while */
  private pickTarget(L: Level3D): HeroLike | null {
    const K = vamp(L);
    const hs = L.alivePlayers().filter((h) => Math.hypot(h.pos.x - ARENA.c.x, h.pos.z - ARENA.c.z) < ARENA.R + 4 && h.pos.y < 4);
    if (!hs.length) return null;
    if (this.target && hs.includes(this.target) && this.tgtT > 0) return this.target;
    let best: HeroLike | null = null, bd = Infinity;
    for (const h of hs) {
      let d = h.pos.distanceTo(this.pos);
      if (K.sunAt(h.center(v1)) > 0.25) d += 12;
      if (h === this.target) d -= 3;
      if (d < bd) { bd = d; best = h; }
    }
    this.target = best;
    this.tgtT = rand(6, 9);
    return best;
  }

  private brain(L: Level3D, dt: number) {
    const K = vamp(L);
    const t = this.pickTarget(L);
    const k = this.st / this.dur;
    switch (this.state) {
      case 'split': case 'darken':
        this.halt(dt);
        if (this.st >= this.dur) { this.go('stalk'); this.retreat = 1; }
        return;
      case 'hurt':
        this.halt(dt);
        if (this.st >= this.dur) { this.go('stalk'); this.retreat = 1.0; }
        return;
      case 'tele': {
        this.halt(dt, 20);
        if (t && k < 0.5) this.face(t.pos, dt, 8);
        if (this.st >= this.dur) { this.go('claw', 0.28); this.struck = false; audio.sfx('swingHeavy', { pitch: 1.4, volume: 0.7 }); }
        return;
      }
      case 'claw': {
        this.halt(dt, 10);
        if (!this.struck && k > 0.3) {
          this.struck = true;
          const c = this.clawSpot(v2);
          for (const h of L.alivePlayers()) {
            if (Math.hypot(h.pos.x - c.x, h.pos.z - c.z) < 1.75 && Math.abs(h.pos.y - this.pos.y) < 1.6) {
              v3.set(h.pos.x - this.pos.x, 0, h.pos.z - this.pos.z).normalize();
              h.hurt(L, 1, this.center(), new THREE.Vector3(v3.x * 8, 6, v3.z * 8));
            }
          }
          L.fx.sparks(c.clone().setY(this.pos.y + 1), 8, ['#e8f4ff', '#b8c8ff']);
        }
        if (this.st >= this.dur) { this.go('recover', 0.7); }
        return;
      }
      case 'recover':
        this.halt(dt);
        if (this.st >= this.dur) { this.go('stalk'); this.retreat = 0.9; this.cd = rand(2.2, 3.2) * this.cdMul() * (this.phase === 3 ? 0.75 : 1); }
        return;
      case 'aim':
        this.halt(dt, 20);
        if (t) this.face(t.pos, dt, 10);
        if (this.st >= this.dur) { this.go('throw', 0.45); this.shots = 0; }
        return;
      case 'throw':
        this.halt(dt);
        if (t && this.shots === 0 && k > 0.2) { this.shots = 1; this.volley(L, t); }
        if (this.st >= this.dur) { this.go('stalk'); this.shardCd = rand(4.5, 6.5) * this.cdMul() * (this.phase === 3 ? 0.75 : 1); this.retreat = 0.5; }
        return;
      case 'goSnuff': case 'goMirror': {
        const gl = this.goal;
        if (!gl || this.st > 7) { this.go('stalk'); return; }
        const d = this.steer(L, gl.x, gl.z, this.speed() * 1.15, dt, true);
        if (d < 0.7) {
          if (this.state === 'goSnuff') { this.go('blow', 1.3); this.whisper(this.center(), choose(BOSS.snuff as unknown as string[])); }
          else {
            this.go('shake', 1.6);
            const m = this.goalObj as BeamMirror;
            m.shake = 1;
            L.nl?.entEvent(m, 'shake', {});
            this.whisper(this.center(), BOSS.snuff[0]);
          }
        }
        return;
      }
      case 'blow': {
        this.halt(dt);
        const l = this.goalObj as Lantern | null;
        if (l) {
          this.face(l.pos, dt, 8);
          if (Math.random() < dt * 14) ambient(L, () => L.fx.emit(l.head.clone(), { count: 1, speed: [0.3, 1], life: [0.5, 0.9], size: [0.15, 0.3], size2: 2, colors: ['#8a86a0', '#c8c4d8'], g: -1, drag: 2 }));
        }
        if (this.st >= this.dur) {
          if (l && l.lit) { l.snuff(); L.fx.emit(l.head.clone(), { count: 18, speed: [0.5, 2], life: [0.6, 1.1], size: [0.2, 0.4], size2: 2, colors: ['#5a5868', '#8a8698'], g: -1.5, drag: 2 }); }
          this.goalObj = null; this.go('stalk'); this.retreat = 0.8;
          this.snuffCd = ([0, 16, 13, 9][this.phase]) * this.cdMul();
        }
        return;
      }
      case 'shake': {
        this.halt(dt);
        const m = this.goalObj as BeamMirror | null;
        if (m) this.face(m.pos, dt, 8);
        if (this.st >= this.dur) {
          if (m && m.locked) m.turnAway(2 + Math.floor(Math.random() * 4));
          this.goalObj = null; this.go('stalk'); this.retreat = 0.8;
          this.mirrorCd = ([0, 18, 15, 11][this.phase]) * this.cdMul();
        }
        return;
      }
    }
    // stalking
    this.state = 'stalk';
    // caught in a light (a beacon right on him, a relit lantern): out of it — he shows while he is in it
    if (K.sunAt(this.center(v1)) > 0.25) {
      const away = K.sunAway(this.pos, v2);
      if (away) { this.steer(L, this.pos.x + away.x * 3, this.pos.z + away.z * 3, this.speed() * 1.1, dt, true, false); return; }
    }
    if (!t) { this.wander(L, dt); return; }
    // jobs: snuff a light / turn a mirror away (telegraphed by going there)
    if (this.snuffCd <= 0 && this.retreat <= 0) {
      const l = this.env.lanterns.filter((x) => x.lit).sort((a, b) => a.pos.distanceTo(this.pos) - b.pos.distanceTo(this.pos))[0];
      if (l) {
        const dir = v1.set(this.pos.x - l.pos.x, 0, this.pos.z - l.pos.z);
        if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
        dir.normalize();
        this.goal = l.pos.clone().addScaledVector(dir, l.r + 0.9).setY(0);
        this.clampArena(this.goal);
        this.goalObj = l; this.go('goSnuff');
        return;
      }
      this.snuffCd = 4;
    }
    if (this.mirrorCd <= 0 && this.retreat <= 0) {
      const ms = this.env.mirrors.filter((m) => m.locked);
      if (ms.length >= 2) {
        const m = ms.sort((a, b) => a.pos.distanceTo(this.pos) - b.pos.distanceTo(this.pos))[0];
        const dir = v1.set(ARENA.c.x - m.pos.x, 0, ARENA.c.z - m.pos.z).normalize();
        this.goal = m.pos.clone().addScaledVector(dir, 1.3).setY(0);
        this.goalObj = m; this.go('goMirror');
        return;
      }
      this.mirrorCd = 5;
    }
    const tLit = K.sunAt(t.center(v1)) > 0.25;
    const d = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
    // a volley at someone in the light / far away
    if (this.shardCd <= 0 && d > 3.5 && d < 13 && (tLit || d > 6 || Math.random() < 0.3) && this.retreat <= 0) {
      this.go('aim', 0.7);
      ambient(L, () => posSfx(L, 'reflect', this.center(), { pitch: 1.6, volume: 0.6 }));
      return;
    }
    if (this.retreat > 0) {
      v1.set(this.pos.x - t.pos.x, 0, this.pos.z - t.pos.z).normalize();
      this.steer(L, this.pos.x + v1.x * 3, this.pos.z + v1.z * 3, this.speed(), dt, true);
      return;
    }
    if (tLit) { this.circle(L, t, 6.5, dt); return; }
    // sneak up behind the target
    const fwd = t.forward(v2);
    const behind = v3.copy(t.pos).addScaledVector(fwd, -1.4);
    this.clampArena(behind);
    const db = this.steer(L, behind.x, behind.z, this.speed(), dt, true);
    if ((db < 0.9 || d < 1.6) && this.cd <= 0 && Math.abs(t.pos.y - this.pos.y) < 1.4) {
      this.face(t.pos, 1, 1);
      this.go('tele', this.phase === 3 ? 0.62 : 0.75);
      this.whisper(this.center(), BOSS.idle[0]);
      ambient(L, () => posSfx(L, 'hiss', this.center(), { pitch: 1.7, volume: 0.8 }));
    }
  }

  private wander(L: Level3D, dt: number) {
    this.goal ??= ARENA.c.clone();
    if (this.goal.distanceTo(this.pos) < 1 || Math.random() < dt * 0.2) {
      const a = rand(0, Math.PI * 2), r = rand(5, ARENA.R - 1);
      this.goal.set(ARENA.c.x + Math.cos(a) * r, 0, ARENA.c.z + Math.sin(a) * r);
    }
    this.steer(L, this.goal.x, this.goal.z, 2.4, dt, true);
  }
  private circle(L: Level3D, t: HeroLike, r: number, dt: number) {
    const a = Math.atan2(this.pos.z - t.pos.z, this.pos.x - t.pos.x) + dt * 0.8;
    const x = t.pos.x + Math.cos(a) * r, z = t.pos.z + Math.sin(a) * r;
    v1.set(x, 0, z); this.clampArena(v1);
    this.steer(L, v1.x, v1.z, this.speed() * 0.8, dt, true);
  }

  private volley(L: Level3D, t: HeroLike) {
    const from = this.center(v1).setY(this.pos.y + 1.9).clone();
    const lead = t.pos.clone().addScaledVector(t.vel, 0.45).setY(t.pos.y + 0.6);
    const n = this.phase === 3 ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const spread = (i - (n - 1) / 2) * 0.16;
      const d = lead.clone().sub(from);
      const len = d.length();
      d.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
      const T = len / 14;
      const vel = d.multiplyScalar(14);
      vel.y += 0.5 * 3 * T;
      const s = L.spawnEnemyShot('seed', from, vel, 3);
      s.dmg = 1; s.life = 2.2;
      shardLook(s.obj);
      if (L.nl && s.netId) L.nl.entEvent(this, 'shard', { s: s.netId });
    }
    audio.sfx('throw', { pitch: 1.6 }); audio.sfx('reflect', { pitch: 1.3, volume: 0.5 });
  }

  private clawSpot(out: THREE.Vector3) { return out.set(this.pos.x + Math.sin(this.yaw) * 1.05, this.pos.y, this.pos.z + Math.cos(this.yaw) * 1.05); }
  private face(p: THREE.Vector3, dt: number, rate: number) {
    const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * rate);
  }
  private halt(dt: number, k = 14) { this.vel.x = damp(this.vel.x, 0, k, dt); this.vel.z = damp(this.vel.z, 0, k, dt); }
  private clampArena(p: THREE.Vector3) {
    const dx = p.x - ARENA.c.x, dz = p.z - ARENA.c.z, d = Math.hypot(dx, dz) || 1;
    if (d > ARENA.R) { p.x = ARENA.c.x + (dx / d) * ARENA.R; p.z = ARENA.c.z + (dz / d) * ARENA.R; }
    if (d < ARENA.bed) { p.x = ARENA.c.x + (dx / d) * ARENA.bed; p.z = ARENA.c.z + (dz / d) * ARENA.bed; }
    return p;
  }
  /** kinematic steering: keeps out of the light (slides along its edge), inside the dome, off the props */
  private steer(L: Level3D, x: number, z: number, speed: number, dt: number, face: boolean, avoid = true) {
    const K = vamp(L);
    let dx = x - this.pos.x, dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { this.halt(dt); return d; }
    dx /= d; dz /= d;
    if (avoid && (this.state !== 'goSnuff' || d > 1.5)) {
      v1.set(this.pos.x + dx * 1.3, 1, this.pos.z + dz * 1.3);
      if (K.sunAt(v1) > 0.2) {
        const lx = -dz, lz = dx;
        const a = K.sunAt(v2.set(this.pos.x + (dx + lx) * 0.9, 1, this.pos.z + (dz + lz) * 0.9));
        const c = K.sunAt(v2.set(this.pos.x + (dx - lx) * 0.9, 1, this.pos.z + (dz - lz) * 0.9));
        if (Math.min(a, c) > 0.2) speed *= 0.2;
        else if (a <= c) { dx = lx; dz = lz; } else { dx = -lx; dz = -lz; }
      }
    }
    const sp = Math.min(speed, d / Math.max(dt, 1e-3));
    this.vel.x = damp(this.vel.x, dx * sp, 9, dt);
    this.vel.z = damp(this.vel.z, dz * sp, 9, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.clampArena(this.pos);
    // props: mirrors, lanterns, flowers
    for (const m of this.env.mirrors) this.push(m.pos, 1.0);
    for (const l of this.env.lanterns) this.push(l.pos, 0.6);
    for (const f of this.env.flowers) this.push(f.pos, 0.7);
    if (face && Math.hypot(this.vel.x, this.vel.z) > 0.3) this.face(v1.set(this.pos.x + this.vel.x, 0, this.pos.z + this.vel.z), dt, 8);
    return d;
  }
  private push(p: THREE.Vector3, r: number) {
    const dx = this.pos.x - p.x, dz = this.pos.z - p.z, d = Math.hypot(dx, dz);
    if (d < r && d > 1e-3) { this.pos.x = p.x + (dx / d) * r; this.pos.z = p.z + (dz / d) * r; }
  }

  // ───────────────────────── decoys (phase 2) ─────────────────────────
  private decoyCount() { return Math.min(MAX_DECOYS, 2 + Math.floor((this.L.heroes().length - 1) / 2)); }
  private decoySim(L: Level3D, dt: number) {
    const want = this.phase === 2 && this.fighting ? this.decoyCount() : 0;
    const hs = L.alivePlayers();
    this.decoys.forEach((d, i) => {
      if (i >= want) { if (d.mode) this.popDecoy(d, false); return; }
      d.t += dt;
      if (!d.mode) {
        if ((d.back -= dt) > 0 || !hs.length) return;
        // a new whisper-double somewhere around a hero
        // (somewhere dark: a decoy in the light would be gone at once)
        const h = hs[i % hs.length];
        for (let k = 0; k < 8; k++) {
          const a = rand(0, Math.PI * 2);
          d.pos.set(h.pos.x + Math.cos(a) * 6, 0, h.pos.z + Math.sin(a) * 6);
          this.clampArena(d.pos);
          if (vamp(L).sunAt(v1.copy(d.pos).setY(1)) < 0.1) break;
        }
        d.mode = 1; d.t = 0; d.whT = rand(0.5, 2);
        return;
      }
      const h = hs.length ? hs.reduce((a, b) => (a.pos.distanceTo(d.pos) < b.pos.distanceTo(d.pos) ? a : b)) : null;
      if (d.mode === 2) {
        d.vel.multiplyScalar(0.8);
        if (d.t > 0.8) { this.popDecoy(d); return; } // a fake strike: just a puff
      } else if (h) {
        d.ang += dt * (0.6 + (i % 2) * 0.3) * (i % 2 ? 1 : -1);
        const r = 2.4 + (i % 3);
        v1.set(h.pos.x + Math.cos(d.ang) * r, 0, h.pos.z + Math.sin(d.ang) * r);
        this.clampArena(v1);
        const dx = v1.x - d.pos.x, dz = v1.z - d.pos.z, dl = Math.hypot(dx, dz) || 1;
        const sp = Math.min(4.2, dl * 3);
        d.vel.set((dx / dl) * sp, 0, (dz / dl) * sp);
        // a whisper keeps to the dark: about to step into a light → stop and circle the other way
        if (vamp(L).sunAt(v2.set(d.pos.x + d.vel.x * 0.4, 1, d.pos.z + d.vel.z * 0.4)) > 0.15) { d.vel.set(0, 0, 0); d.ang += Math.PI * 0.5 * (i % 2 ? -1 : 1); }
        if (d.t > 4 + i && Math.random() < dt * 0.5) { d.mode = 2; d.t = 0; this.whisper(d.pos.clone().setY(1.4), BOSS.idle[0]); }
      }
      d.pos.addScaledVector(d.vel, dt);
      this.clampArena(d.pos);
      // in the light it's just a whisper: gone
      if (vamp(L).sunAt(v1.copy(d.pos).setY(1)) > 0.25) { this.popDecoy(d); return; }
      // (v2 §7.4 phase 2: the decoys echo what the heroes said — funny, and it confuses)
      if ((d.whT -= dt) <= 0) { d.whT = rand(3.5, 6); this.whisper(d.pos.clone().setY(1.4), this.echoLine()); }
    });
  }
  /** a decoy's whisper: a hero's line said lately (its last words), or one of the stock echoes */
  private echoLine() {
    const heard = this.env.heard();
    if (heard.length && Math.random() < 0.6) return choose(heard);
    return Math.random() < 0.8 ? choose(DECOY_ECHO as unknown as string[]) : choose(BOSS.split as unknown as string[]);
  }

  // ───────────────────────── the watering can (phase 3) ─────────────────────────
  private canSim(L: Level3D, dt: number) {
    const K = vamp(L);
    const P = this.env.puddles;
    // the puddles drain colour: a hero standing in one is «пресный» (grey and slow) for 2 s
    if ((this.pudT -= dt) <= 0) {
      this.pudT = 0.4;
      for (const h of L.alivePlayers()) if (P.inside(h.pos.x, h.pos.z, h.pos.y)) K.bland(h, 2);
    }
    const on = this.phase === 3 && this.fighting;
    if (!on) { if (this.canMode !== CAN_OFF && this.canMode !== CAN_DOWN) this.canMode = CAN_OFF; if (this.canMode === CAN_DOWN && (this.canT += dt) > 3) this.canMode = CAN_OFF; return; }
    this.canT += dt;
    switch (this.canMode) {
      case CAN_OFF:
        if ((this.canCd -= dt) > 0) return;
        // out of the dark, at his side
        this.canPos.copy(this.pos).setY(CAN_Y + 0.6);
        this.canMode = CAN_FLOAT; this.canT = 0; this.canRest = 1.2; this.canTgt = null;
        this.whisper(this.center(), BOSS.water[0]);
        this.toastOnce('can', TOAST.can);
        return;
      case CAN_FLOAT: {
        const hs = L.alivePlayers().filter((h) => Math.hypot(h.pos.x - ARENA.c.x, h.pos.z - ARENA.c.z) < ARENA.R + 4 && h.pos.y < 4);
        if (!this.canTgt || !hs.includes(this.canTgt)) this.canTgt = hs.length ? hs.reduce((a, b) => (a.pos.distanceTo(this.canPos) < b.pos.distanceTo(this.canPos) ? a : b)) : null;
        const t = this.canTgt;
        if (!t) { this.canPos.y = damp(this.canPos.y, CAN_Y + 0.6, 2, dt); return; }
        const dx = t.pos.x - this.canPos.x, dz = t.pos.z - this.canPos.z, d = Math.hypot(dx, dz);
        const sp = Math.min(3.6 + (L.heroes().length > 1 ? 0.4 : 0), d / Math.max(dt, 1e-3));
        if (d > 0.01) { this.canPos.x += (dx / d) * sp * dt; this.canPos.z += (dz / d) * sp * dt; }
        this.canPos.y = damp(this.canPos.y, t.pos.y + CAN_Y, 4, dt);
        this.canRest -= dt;
        // over the hero (or it has chased long enough): it stops and tilts — the telegraph
        if (this.canRest <= 0 && (d < 0.6 || this.canT > 3.2)) { this.canMode = CAN_TILT; this.canT = 0; ambient(L, () => posSfx(L, 'mist', this.canPos, { pitch: 1.9, volume: 0.5 })); }
        return;
      }
      case CAN_TILT:
        if (this.canT >= CAN_TILT_T) {
          this.canMode = CAN_POUR; this.canT = 0;
          const gy = Math.max(0, L.phys.groundAt(this.canPos.x, this.canPos.z, this.canPos.y, 0.2));
          const at = [Math.round(this.canPos.x * 10) / 10, Math.round((isFinite(gy) ? gy : 0) * 10) / 10, Math.round(this.canPos.z * 10) / 10];
          this.puddleFx(at);
          L.nl?.entEvent(this, 'pud', { p: at });
          if (Math.random() < 0.5) this.whisper(this.canPos.clone().setY(1.6), BOSS.water[1]);
        }
        return;
      case CAN_POUR:
        if (this.canT >= CAN_POUR_T) { this.canMode = CAN_FLOAT; this.canT = 0; this.canRest = rand(1.6, 2.4) / (1 + 0.1 * (L.heroes().length - 1)); this.canTgt = null; }
        return;
      case CAN_DOWN:
        // knocked to the floor: lies there a while, then he picks it up again (out of the dark)
        if (this.canT > 4.5) { this.canMode = CAN_OFF; this.canCd = 2.5; }
        return;
    }
  }
  private puddleFx(p: number[]) {
    const L = this.L;
    this.env.puddles.add(p[0], p[2], p[1]);
    ambient(L, () => {
      L.fx.emit(new THREE.Vector3(p[0], p[1] + 0.3, p[2]), { count: 14, speed: [0.6, 2.2], dir: new THREE.Vector3(0, 1, 0), spread: 0.9, life: [0.4, 0.8], size: [0.12, 0.26], size2: 1.4, colors: ['#9a9aa8', '#c8c8d4', '#6a6a78'], g: 6, drag: 1 });
      posSfx(L, 'drain', new THREE.Vector3(p[0], p[1], p[2]), { volume: 0.7, pitch: 0.8 });
    });
  }
  /** host: a swing / a shot / a chord knocked the can out — he shows for 3 s */
  private knockCan(L: Level3D) {
    if (this.canMode === CAN_OFF || this.canMode === CAN_DOWN) return false;
    this.canMode = CAN_DOWN; this.canT = 0;
    this.revealT = Math.max(this.revealT, 3);
    this.whisper(this.center(), BOSS.seen[0]);
    shared(L, () => {
      L.fx.sparks(this.canPos.clone(), 10, ['#d8e8e0', '#ffffff', '#c9a24a']);
      audio.sfx('clang', { pitch: 1.3, volume: 0.8 });
      L.hud.toast(TOAST.canHit, 3);
    });
    L.nl?.entEvent(this, 'canHit', {});
    return true;
  }

  private popDecoy(d: Decoy, back = true) {
    if (!d.mode) return;
    d.mode = 0;
    d.back = back ? rand(5, 7.5) : 0;
  }

  // ───────────────────────── getting hit (host) ─────────────────────────
  meleeHit(L: Level3D, c: THREE.Vector3, dir: THREE.Vector3, range: number, half: number, dmg: number, atkId: number, kind: string): boolean {
    if (!L.authority || !this.fighting) return false;
    const key = L.attacker ? `${L.attacker}:${atkId}` : atkId;
    if (this.hitIds.has(key)) return false;
    let hit = false;
    const inReach = (p: THREE.Vector3, r: number) => {
      v1.set(p.x - c.x, 0, p.z - c.z);
      const d = v1.length();
      if (d > range + r || c.y < p.y - 1 || c.y > p.y + 3.2) return false;
      if (half < Math.PI && d > 0.4 && v1.normalize().dot(dir) < Math.cos(half) - 0.15) return false;
      return true;
    };
    for (const d of this.decoys) if (d.mode && inReach(d.pos, 0.7)) {
      this.popDecoy(d); hit = true;
      this.whisper(d.pos.clone().setY(1.4), BOSS.idle[1]);
    }
    // the can (it floats at head height over a hero: a swing from under it reaches it)
    if (this.canMode >= CAN_FLOAT && this.canMode <= CAN_POUR && inReach(v2.set(this.canPos.x, this.canPos.y - CAN_Y, this.canPos.z), 0.7)) {
      if (this.knockCan(L)) hit = true;
    }
    if (inReach(this.pos, 0.75)) {
      hit = true;
      if (kind === 'chord') this.chordNear(this.center(), 1);
      if (dmg > 0) this.damage(L, dmg, c.clone().addScaledVector(dir, range * 0.5), kind);
    }
    if (hit) { this.hitIds.add(key); if (this.hitIds.size > 200) this.hitIds.delete(this.hitIds.values().next().value as string); }
    return hit;
  }
  shotHit(L: Level3D, s: Shot3): boolean {
    if (!L.authority || !this.fighting) return false;
    for (const d of this.decoys) if (d.mode && s.pos.distanceTo(v1.copy(d.pos).setY(1.3)) < 0.9) { this.popDecoy(d); return true; }
    if (this.canMode >= CAN_FLOAT && this.canMode <= CAN_POUR && s.pos.distanceTo(this.canPos) < 0.9) { this.knockCan(L); return true; }
    if (s.pos.distanceTo(this.center(v1)) > 1.0) return false;
    const by = s.shooter;
    const prev = L.attacker;
    if (by) L.attacker = by;
    try { this.damage(L, s.dmg, s.pos.clone(), 'pea'); } finally { L.attacker = prev; }
    return true;
  }
  predictHit(_L: Level3D, c: THREE.Vector3, range: number): boolean {
    return this.fighting && this.vis > 0.5 && Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < range + 0.75;
  }

  /** host: damage (also the tests' way in) */
  damage(L: Level3D, n: number, at: THREE.Vector3, kind = 'sword') {
    if (!L.authority || !this.fighting) return;
    let d = n;
    const sun = vamp(L).sunAt(this.center(v1));
    if (this.stunT > 0) d *= 1.5;
    if (sun > 0.3 || kind === 'sun') d *= 1.5;
    d = Math.max(1, Math.round(d));
    shared(L, () => {
      this.hp = Math.max(0, this.hp - d);
      this.flash = 1;
      this.revealT = Math.max(this.revealT, 1.6);
      audio.sfx('bossHit', { pitch: 1.3 });
      L.fx.sparks(at, 10, ['#e8f4ff', '#b8c8ff', '#ffffff']);
      L.fx.text(at.clone().setY(at.y + 1), String(d), d > n ? '#ffe14a' : '#ffffff', d > n ? 28 : 22);
      L.tcam.shake(0.12);
    });
    if (this.hurtWh <= 0) { this.hurtWh = 3; this.whisper(this.center(), choose(BOSS.hurt as unknown as string[])); }
    if (this.hp <= 0) { this.defeat(L); return; }
    // a whisper can't be pinned down: after a few hits he puffs away and comes back somewhere dark (not while stunned)
    this.windowHits++;
    if (this.stunT <= 0 && this.windowHits >= 3 && this.state !== 'split' && this.state !== 'darken') { this.blink(L); }
    else if (this.state === 'stalk' || this.state === 'goSnuff' || this.state === 'goMirror' || this.state === 'aim') this.go('hurt', 0.4);
    // phases
    if (this.phase === 1 && this.hp <= this.maxHp * 0.66) this.toPhase(L, 2);
    else if (this.phase === 2 && this.hp <= this.maxHp * 0.33) this.toPhase(L, 3);
  }

  /** host: puff — gone into a whisper, back somewhere dark, far from the heroes */
  private blink(L: Level3D) {
    const from = this.center();
    const K = vamp(L);
    let best: THREE.Vector3 | null = null, bs = -Infinity;
    for (let i = 0; i < 10; i++) {
      const a = rand(0, Math.PI * 2), r = rand(6, ARENA.R - 0.5);
      const c = new THREE.Vector3(ARENA.c.x + Math.sin(a) * r, 0, ARENA.c.z + Math.cos(a) * r);
      if (K.sunAt(v1.copy(c).setY(1)) > 0.1) continue;
      let near = Infinity;
      for (const h of L.alivePlayers()) near = Math.min(near, h.pos.distanceTo(c));
      const sc = Math.min(near, 10) + rand(0, 2);
      if (sc > bs) { bs = sc; best = c; }
    }
    shared(L, () => {
      L.fx.emit(from, { count: 26, speed: [0.6, 2.6], life: [0.5, 1.0], size: [0.25, 0.5], size2: 2, colors: ['#3a2a5a', '#6a5a8a', '#b8c8ff'], g: -0.8, drag: 2 });
      audio.sfx('mist', { pitch: 1.4 });
    });
    if (best) this.pos.copy(best);
    this.revealT = 0; this.windowHits = 0;
    this.go('stalk'); this.retreat = 0.6;
    this.cd = Math.max(this.cd, 1.2);
    this.whisper(this.center(), BOSS.idle[1]);
  }

  private toPhase(L: Level3D, n: number) {
    this.phase = n;
    for (let i = 0; i < 2; i++) L.dropPickup('heart', ARENA.c.clone().setY(1.2));
    if (n === 2) {
      this.go('split', 1.2);
      this.whisper(this.center(), BOSS.split[0]);
      shared(L, () => L.hud.toast(TOAST.split, 6));
      this.decoys.forEach((d, i) => { d.back = 0.3 + i * 0.25; });
    } else {
      this.go('darken', 1.6);
      this.dark = 1;
      this.whisper(this.center(), BOSS.snuff[0]);
      for (const l of this.env.lanterns) if (l.lit) l.snuff();
      this.env.mirrors.forEach((m, i) => { if (m.locked) m.turnAway(2 + i); });
      shared(L, () => L.hud.toast(TOAST.dark, 7));
      this.snuffCd = 10; this.mirrorCd = 14;
      this.canCd = 3.5; this.canMode = CAN_OFF;
    }
    L.nl?.entEvent(this, 'phase', { n });
    this.phaseFx(n);
  }
  private phaseFx(n: number) {
    const L = this.L;
    ambient(L, () => {
      audio.sfx('mist', { pitch: 0.6 }); audio.sfx('hiss', { pitch: 0.7 });
      L.fx.ring(this.pos.clone().setY(0.2), 6, n === 3 ? '#3a2a5a' : '#b8c8ff', 0.8);
      L.tcam.shake(0.35);
    });
  }

  private defeat(L: Level3D) {
    this.state = 'dying'; this.st = 0; this.seq++;
    this.defeatT = 0;
    this.dark = 0;
    for (const d of this.decoys) this.popDecoy(d, false);
    if (this.canMode !== CAN_OFF) { this.canMode = CAN_DOWN; this.canT = 0; }
    L.hud.bossMax = 0;
    for (let i = 0; i < 8; i++) L.dropPickup(Math.random() < 0.3 ? 'bigcrumb' : 'crumb', this.center());
    L.dropPickup('heart', this.center());
  }

  // ═════════════════════════════ co-op ═════════════════════════════
  /** [x y z yaw state st visGoal hp phase dark seq flash active, decoys × (mode x z)] */
  netSnap(): number[] {
    const out = [this.pos.x, this.pos.y, this.pos.z, this.yaw, STATES.indexOf(this.state), this.st, this.visGoal, this.hp, this.phase, this.dark, this.seq % 1000, this.flash > 0.5 ? 1 : 0, this.active ? 1 : 0];
    for (const d of this.decoys) out.push(d.mode, d.pos.x, d.pos.z);
    out.push(this.canMode, this.canPos.x, this.canPos.y, this.canPos.z, this.canT);
    return out;
  }
  netApply(a: number[], t?: number) {
    if (t === undefined) return;
    (this.track ??= new NetTrack<number[]>(40, 3)).push(t, a[0], a[1], a[2], a[3], a);
  }
  private fields(a: number[]) {
    const s = STATES[a[4]] ?? 'stalk';
    if (s !== this.state || a[10] !== this.seq || !this.got) this.st = a[5];
    this.state = s; this.seq = a[10];
    if (a[7] < this.hp) this.anim.flash = 1;
    this.hp = a[7]; this.phase = a[8]; this.dark = a[9];
    if (a[11]) this.anim.flash = 1;
    this.active = !!a[12];
    this.decoys.forEach((d, i) => { d.mode = a[13 + i * 3] | 0; });
    const ci = 13 + MAX_DECOYS * 3;
    if (a.length > ci) { const m = a[ci] | 0; if (m !== this.canMode) this.canT = a[ci + 4]; this.canMode = m; }
    this.got = true;
  }
  netEvent(L: Level3D, ev: string, d: { p?: number[]; s?: string | number; n?: number }) {
    if (L.authority) return;
    switch (ev) {
      case 'wh': if (d.p && typeof d.s === 'string') this.env.whispers.say(new THREE.Vector3(d.p[0], d.p[1], d.p[2]), d.s); break;
      case 'shard': { const s = typeof d.s === 'number' ? (L.nl?.get(d.s) as unknown as Shot3 | undefined) : undefined; if (s) shardLook(s.obj); break; }
      case 'noon': this.noonFx(); break;
      case 'phase': this.phaseFx(d.n ?? 2); break;
      case 'pud': if (d.p) this.puddleFx(d.p); break;
      case 'canHit': L.fx.sparks(this.canPos.clone(), 10, ['#d8e8e0', '#ffffff', '#c9a24a']); audio.sfx('clang', { pitch: 1.3, volume: 0.8 }); L.hud.toast(TOAST.canHit, 3); break;
    }
  }

  private puppet(L: Level3D, dt: number) {
    this.st += L.nl?.playDt ?? dt;
    const tr = this.track, play = L.nl?.playT ?? -Infinity;
    if (tr && tr.eval(play, dt, pose)) {
      tr.passed(play, (a) => this.fields(a));
      this.pos.copy(pose.pos);
      this.vel.copy(pose.vel);
      this.yaw = pose.yaw;
      this.visGoal = tr.lerp(6);
      this.decoys.forEach((d, i) => {
        if (!d.mode) return;
        const x = tr.lerp(14 + i * 3), z = tr.lerp(15 + i * 3);
        if (d.pos.distanceTo(v1.set(x, 0, z)) > 4) d.pos.set(x, 0, z);
        else { d.vel.set((x - d.pos.x) / Math.max(dt, 1e-3), 0, (z - d.pos.z) / Math.max(dt, 1e-3)); d.pos.set(x, 0, z); }
      });
      const ci = 14 + MAX_DECOYS * 3; // (the can's x: right after its mode, past the decoys)
      if (this.canMode !== CAN_DOWN) this.canPos.set(tr.lerp(ci), tr.lerp(ci + 1), tr.lerp(ci + 2));
    }
  }

  // ═════════════════════════════ every machine ═════════════════════════════
  private visuals(L: Level3D, dt: number) {
    const a = this.anim;
    this.anim.flash = Math.max(this.flash, a.flash - dt * 5);
    this.vis = damp(this.vis, this.visGoal, this.visGoal > this.vis ? 9 : 3, dt);
    this.inv.apply(dt, this.visGoal);
    this.root.visible = !this.gone && (this.active || this.state === 'dying' || this.state === 'dead');
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    a.st = ANIM[this.state] ?? (sp > 0.4 ? 'stalk' : 'idle');
    a.p = clamp(this.st / this.dur, 0, 1);
    a.speed = sp; a.vis = this.vis;
    this.rig.update(dt, a);
    this.blob.position.set(this.pos.x, this.pos.y + 0.03, this.pos.z);
    // the claw telegraph
    if (this.state === 'tele') this.ring.show(L, ...this.clawSpot(v1).toArray() as [number, number, number], 1.7, 0.3 + 0.5 * clamp(this.st / this.dur, 0, 1));
    else this.ring.hide();
    // the glint before a volley
    (this.glint.material as THREE.SpriteMaterial).opacity = this.state === 'aim' ? 0.6 + 0.4 * Math.sin(this.t * 30) : 0;
    // pollen prints (every machine from what it draws)
    if (this.active && !this.beaten && sp > 0.5) this.env.feet.track(this, this.pos, 1.4);
    // decoys
    for (const d of this.decoys) {
      const on = d.mode > 0 && this.active;
      if (!on) {
        if (d.root.visible) {
          d.root.visible = false; d.mark.hide();
          if (d.shown > 0.5) ambient(L, () => { L.fx.emit(d.pos.clone().setY(1.2), { count: 18, speed: [0.5, 2.2], life: [0.5, 1], size: [0.2, 0.45], size2: 2, colors: ['#3a2a5a', '#6a5a8a', '#b8c8ff'], g: -0.8, drag: 2 }); posSfx(L, 'mist', d.pos, { pitch: 2, volume: 0.6 }); });
        }
        d.shown = 0;
        this.env.feet.forget(d);
        continue;
      }
      d.shown += dt;
      d.root.visible = true;
      d.root.position.copy(d.pos);
      const dsp = Math.hypot(d.vel.x, d.vel.z);
      if (dsp > 0.3) d.root.rotation.y = Math.atan2(d.vel.x, d.vel.z);
      const goal = d.mode === 2 ? 0.4 : dsp > 0.4 ? 0.03 : 0.01;
      d.vis = damp(d.vis, goal, 6, dt);
      d.inv.apply(dt, goal);
      d.anim.st = d.mode === 2 ? 'tele' : dsp > 0.4 ? 'stalk' : 'idle'; d.anim.speed = dsp; d.anim.vis = d.vis;
      d.rig.update(dt, d.anim);
      if (d.mode === 2) d.mark.show(L, d.pos.x + Math.sin(d.root.rotation.y) * 1.05, 0, d.pos.z + Math.cos(d.root.rotation.y) * 1.05, 1.7, 0.5);
      else d.mark.hide();
      if (dsp > 0.5) this.env.feet.track(d, d.pos, 1.4);
    }
    // the watering can
    this.canVisual(L, dt);
    this.env.puddles.update(dt);
    // the dome darkens (phase 3) and lightens again
    this.darkK = damp(this.darkK, this.dark, 1.5, dt);
    this.applyDark(L);
    // the boss bar
    if (this.active && !this.beaten) { L.hud.bossName = this.name; L.hud.bossHp = this.hp; L.hud.bossMax = this.maxHp; }
    else L.hud.bossMax = 0;
    this.blob.visible = this.vis > 0.4;
  }

  private canVisual(L: Level3D, dt: number) {
    const c = this.env.can, m = this.canMode;
    if (!L.authority) this.canT += L.nl?.playDt ?? dt;
    if (m === CAN_OFF) {
      // (picked up again by the invisible one; before phase 3 the can lies where the cold open left it)
      if (this.active && this.phase === 3 && !this.beaten) c.root.visible = false;
      c.pour = 0; c.update(dt);
      return;
    }
    c.root.visible = true;
    if (m === CAN_DOWN) {
      // falls and lies on the floor
      if (!c.lying) { this.canFall = Math.max(0.2, this.canPos.y); c.lying = true; }
      this.canFall = Math.max(0, this.canFall - dt * 6);
      c.root.position.set(this.canPos.x, this.canFall, this.canPos.z);
      c.pour = 0; c.tilt = 0;
      c.update(dt);
      return;
    }
    c.lying = false;
    // it turns its spout toward the one it follows; the rose (not the tank) is over the spot it pours on
    const t = this.canTgt ?? (L.alivePlayers()[0] ?? null);
    if (t && m === CAN_FLOAT && Math.hypot(t.pos.x - this.canPos.x, t.pos.z - this.canPos.z) > 0.3) {
      const want = Math.atan2(t.pos.x - this.canPos.x, t.pos.z - this.canPos.z);
      c.root.rotation.y += Math.atan2(Math.sin(want - c.root.rotation.y), Math.cos(want - c.root.rotation.y)) * Math.min(1, dt * 4);
    }
    const yaw = c.root.rotation.y;
    c.root.position.set(this.canPos.x - Math.sin(yaw) * 0.62, this.canPos.y - 0.5, this.canPos.z - Math.cos(yaw) * 0.62);
    c.tilt = m === CAN_TILT ? clamp(this.canT / CAN_TILT_T, 0, 1) * 0.75 : m === CAN_POUR ? 1 : 0;
    c.pour = m === CAN_TILT ? 0.12 : m === CAN_POUR ? 1 : 0;
    c.update(dt, Math.max(0, this.canPos.y - CAN_Y));
  }

  private applyDark(L: Level3D) {
    const k = this.darkK;
    if (!this.base) {
      if (k < 0.001) return;
      this.base = { hemi: L.hemi.intensity, sun: L.sun.intensity, fog: (L.scene.fog as THREE.Fog).color.clone(), bg: (L.scene.background as THREE.Color).clone() };
    }
    const b = this.base;
    L.hemi.intensity = b.hemi * (1 - 0.6 * k);
    L.sun.intensity = b.sun * (1 - 0.75 * k);
    (L.scene.fog as THREE.Fog).color.copy(b.fog).multiplyScalar(1 - 0.6 * k);
    (L.scene.background as THREE.Color).copy(b.bg).multiplyScalar(1 - 0.6 * k);
    if (k < 0.001 && this.dark === 0) this.base = null;
  }

  // ═════════════════════════════ Boss3Like ═════════════════════════════
  faceTarget() { return this.center(); }
  aimTargets() { return this.fighting && this.vis > 0.5 ? [this.center()] : []; }

  /** the reflections in the mirrors: the real one only (decoys have none) */
  ghost() { return this.active && this.state !== 'dead' && this.anim.small < 0.5 ? this.pos : null; }
}

/** co-op host: effects that must reach every machine even outside the captured world tick (my own swing) */
function shared(L: Level3D, f: () => void) { const nl = L.nl; if (nl && nl.isHost && !nl.capturing) nl.capture(f); else f(); }

let glT: THREE.Texture | null = null;
function glintTex() {
  if (glT) return glT;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.translate(32, 32);
  for (const r of [0, Math.PI / 2]) {
    g.save(); g.rotate(r);
    const gr = g.createLinearGradient(-32, 0, 32, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(-32, -2, 64, 4);
    g.restore();
  }
  const rg = g.createRadialGradient(0, 0, 0, 0, 0, 14);
  rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(-14, -14, 28, 28);
  glT = new THREE.CanvasTexture(c);
  return glT;
}
