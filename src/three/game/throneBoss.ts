import * as THREE from 'three';
import { audio } from '../../engine/audio';
import { input } from '../../engine/input';
import { save } from '../../engine/save';
import { choose, clamp, damp, lerp, rand } from '../../engine/util';
import { createKing, KING_HAND_REST } from '../models';
import type { KingRig, KingAnim } from '../models';
import type { BoxCol } from '../physics/types';
import type { Level3D, Boss3Like, HeroLike } from './level';
import { Faller3, Wave3 } from './objects';
import type { Shot3, Noodle3 } from './objects';
import type { Enemy3, EnemyKind } from './enemies';
import { HALL, clampFloor, spotsAround, Tele, Stripe, BowlBall, RageAura, SummonCrew, uncaptured } from './bossParts';
import { net } from '../../net/session';
import { coop } from './coop';
import { GM } from './netLevel';
import type { Netted } from './netLevel';
import { NetTrack, type NetPose } from './netInterp';
import type { RemoteHero3 } from './remoteHero';

/**
 * Chapter 5: the King on his throne. Every attack is telegraphed on the floor (yellow-orange rings and bands):
 *  • slam / slam chains — a palm tracks the hero, locks, crashes down; the stuck palm is solid and can be hit;
 *  • sweep — a palm slides across the WHOLE hall along a band: jump over it or get off the band;
 *    cross sweep (phase 3) — both palms at once, on two bands, in opposite directions;
 *  • clap — both palms squash together at the hero's spot, then a shockwave;
 *  • grab — a palm lunges low along a band; caught = he squeezes you on the way to his mouth (mash to break free —
 *    attack whacks his fingers — and his stunned palm drops to the floor; too slow = chomp, 2 damage, thrown away);
 *  • meatball bowling — giant meatballs roll down telegraphed lanes toward the entrance (double-jump or change lane);
 *  • meat — thrown meat; knock it back into his face → he is dizzy and his face drops to the floor;
 *  • walnut rain (+ a walnut drizzle on top of phase-3 slam chains), stomp shockwaves (phase 3);
 *  • summons — guards / shields / bombers / spitters / jellies / chargers / flying books, carried, tossed or shaken
 *    out of his sleeve next to the hero (never while 3+ mobs are alive).
 * Everything speeds up per phase (×1 / ×1.22 / ×1.45, a bit more as HP drops inside a phase); an adaptive director
 * eases off after a burst of hits (and drops a heart), presses harder when the hero is untouchable, and punishes camping.
 *
 * Co-op (L.nl): the host runs the fight — attack choice, phases, director, summons, HP, who the palm catches — aimed at
 * a "focus" hero per attack (he prefers the score leader `L.refs.leaderId`, else whoever is nearest, now and then
 * anyone). HP × coop.hpScale(), attacks and summons come a bit faster with more heroes. Clients get the whole visual
 * state through netSnap/netApply (id 920) and play it back at NetLevel.playT (netInterp.ts): his body and face, the
 * palms (a slam's fall is played locally), telegraphs and stripes, attack states, lanes and their own copy of every
 * meatball show where and when they happened on the host; the summon crew comes from 'cgrab'/'cfling'. Fast hazards are
 * victim-side: every machine tests only its own hero against what it sees. A friend in the fist is held on his own
 * machine (GM.grab → grabTip()); his mashing, or ANOTHER hero hitting the fist, frees him (netReleased / rescue).
 * Two different heroes hitting the two stuck palms within 0.6 s = «Командный хлопок»: the King is knocked dizzy.
 */

/** co-op: the boss's replicated id (fixed, identical on every machine) */
const NET_ID = 920;
const STATES = ['intro', 'idle', 'attack', 'dizzy', 'roar', 'dead'] as const;

type HSt = 'rest' | 'rise' | 'track' | 'lock' | 'slam' | 'stuck' | 'lift' | 'sweepPrep' | 'sweep' | 'clapPrep' | 'clap'
  | 'grabPrep' | 'grabLunge' | 'hold' | 'puppet';
type Pose = KingAnim['hands'][number]['pose'];
/** wire order of hand states / poses (co-op snapshots) */
const HSTS: HSt[] = ['rest', 'rise', 'track', 'lock', 'slam', 'stuck', 'lift', 'sweepPrep', 'sweep', 'clapPrep', 'clap', 'grabPrep', 'grabLunge', 'hold', 'puppet'];
const POSES: Pose[] = ['rest', 'open', 'flat', 'fist', 'grab'];

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const tmp3 = new THREE.Vector3();
const rootPose: NetPose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };
const handPose: NetPose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };

/** per-phase speed multiplier (plus up to +0.08/+0.08/+0.10 as HP drops inside the phase) */
const PHASE_SPD = [1, 1.22, 1.45];
const PHASE_CD = [1.2, 0.85, 0.6];
const SUMMON_EVERY = [26, 19, 14];
const DIZZY_CAP = 40;
const DIZZY_LOCK = 12;
const GRAB_HOLD = 2.5;
/** the nearest z (in front of his knees) a sweep band may use */
const SWEEP_Z0 = -19.5;

class BossHand {
  pos = new THREE.Vector3();
  state: HSt = 'rest';
  t = 0; vy = 0; glow = 0; flash = 0; yaw = 0;
  pose: Pose = 'rest';
  hit = new Set<number>();
  target = new THREE.Vector3();
  /** grab: where the lunge starts / ends */
  start = new THREE.Vector3();
  end = new THREE.Vector3();
  sweepDir = 1; trackT = 0.9; stuckT = 1.6; prepT = 1; speed = 26;
  /** falling without hurting (stunned after the hero broke free) */
  harmless = false;
  /** closed fist while stuck (missed grab) */
  fist = false;
  tele = new Tele();
  stripe = new Stripe();
  col: BoxCol;
  /** co-op host: the hero this palm hunts (solo: always the player) */
  tgt: HeroLike | null = null;
  // co-op client puppet: the host's palm played back at NetLevel.playT, and my own copy of a slam's fall
  track: NetTrack<null> | null = null;
  /** where my copy was when it went back to following the host's palm (after a fall / resting on my copy of his belly): fades */
  off = new THREE.Vector3();
  following = false;
  /** the host's state at the next snapshot of the playback (a palm leaving its rest follows the host's from the start) */
  netNext: HSt = 'rest';
  /** a straight run at the host's velocity (sweep, clap, lunge), played by my copy */
  runV = new THREE.Vector3();
  netGlow = 0; netPose: Pose = 'rest';
  got = false; falling = false; squeeze = false;
  constructor(public side: -1 | 1) {
    this.col = { kind: 'box', min: new THREE.Vector3(), max: new THREE.Vector3(), active: false, tag: 'king' };
  }
  set(s: HSt) { this.state = s; this.t = 0; this.hit.clear(); if (s !== 'slam') this.harmless = false; if (s !== 'stuck') this.fist = false; }
  /** world-space hurt box of the flat palm + fingers (fingers point along yaw) */
  box(minOut: THREE.Vector3, maxOut: THREE.Vector3, h = 2.5, halfK = 1) {
    const p = this.pos;
    const along = Math.abs(Math.sin(this.yaw)) > 0.7;
    const back = 2.9, fwd = 5.3, half = 3.1 * halfK;
    if (!along) {
      const s = Math.cos(this.yaw) >= 0 ? 1 : -1;
      minOut.set(p.x - half, p.y, p.z + (s > 0 ? -back : -fwd));
      maxOut.set(p.x + half, p.y + h, p.z + (s > 0 ? fwd : back));
    } else {
      const s = Math.sin(this.yaw) >= 0 ? 1 : -1;
      minOut.set(p.x + (s > 0 ? -back : -fwd), p.y, p.z - half);
      maxOut.set(p.x + (s > 0 ? fwd : back), p.y + h, p.z + half);
    }
  }
  fwd(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
}

interface Lane { x: number; t: number; tele: number; speed: number; stripe: Stripe; hand: BossHand; ball: BowlBall | null; aim: boolean; shown: boolean }
/** co-op client: one host snapshot, parsed (the poses go to the NetTracks) */
interface HandRec { st: HSt; pose: Pose; glow: number; flash: boolean; harmless: boolean; fist: boolean; sweepDir: number; ex: number; ez: number; vx: number; vz: number }
interface ThroneRec {
  st: typeof STATES[number]; ph: number; hp: number; maxHp: number; anim: number[]; flash: boolean; talk: boolean; grabHand: number;
  hands: HandRec[]; lanes: { x: number; t: number; tele: number; ball: number }[]; balls: number[][];
}
interface Grabber { tip(): THREE.Vector3; release(): void }

function distToBox(p: THREE.Vector3, mn: THREE.Vector3, mx: THREE.Vector3) {
  const dx = Math.max(mn.x - p.x, 0, p.x - mx.x);
  const dy = Math.max(mn.y - p.y, 0, p.y - mx.y);
  const dz = Math.max(mn.z - p.z, 0, p.z - mx.z);
  return Math.hypot(dx, dy, dz);
}
const ease = (k: number) => k * k * (3 - 2 * k);

export class KingBoss3 implements Boss3Like, Netted {
  netId = 0;
  /** captured barks are anchored to his head (same object on every machine) */
  get netRoot() { return this.rig.head; }
  name = 'КОРОЛЬ ГРОМАДИН';
  /** easier setting: a bit less health to chew through */
  hp = save.data.settings.easy ? 160 : 220; maxHp = this.hp;
  rig: KingRig;
  root = new THREE.Group();
  hands: [BossHand, BossHand];
  anim: KingAnim;
  state: 'intro' | 'idle' | 'attack' | 'dizzy' | 'roar' | 'dead' = 'intro';
  phase = 1; cd = 1.4; t = 0; talk = 0;
  attackFn: ((dt: number) => boolean) | null = null;
  attackCount = 0; dizzyT = 0; recent: string[] = [];
  faceHit = new Set<number>();
  freezeHands = false;
  onDefeat: (() => void) | null = null;
  floorY: number;
  /** where he sits (root position on the throne seat) */
  seat: THREE.Vector3;
  /** 0..1: sliding off the throne face-first (dizzy) */
  slide = 0;
  sweepHinted = false;
  /** cutscenes move the root themselves */
  manualRoot = false;
  /** current speed multiplier (phase + HP inside the phase) and progress through the phase 0..1 */
  spd = 1; prog = 0;
  /** adaptive director: 0..1 "the hero is untouchable — press harder" */
  heat = 0;
  /** seconds the hero has stood within 4 m of one spot */
  campT = 0;
  summonT = 18;
  lastDizzyT = -99; dizzyDmg = 0;
  private bmin = new THREE.Vector3();
  private bmax = new THREE.Vector3();
  private crew: SummonCrew;
  private balls: BowlBall[] = [];
  private lanes: Lane[] = [];
  private stripePool: Stripe[] = [];
  private extras: ((dt: number) => boolean)[] = [];
  /** small delayed effects (e.g. a slam's shockwave a beat after impact) */
  private later: { t: number; fn: () => void }[] = [];
  private cancel: (() => void) | null = null;
  private grabber: Grabber | null = null;
  private aura = new RageAura();
  private breath = 0; private fxT = 0; private restBonus = 0;
  private hpSeen = -1; private hitLog: number[] = []; private lastHitT = 0; private breatherUntil = 0; private lastHeartT = -99;
  private campAnchor = new THREE.Vector3();
  private lastPkg = -1;
  private hints = new Set<string>();

  // ── co-op (host) ──
  /** in a co-op game */
  private mp = false;
  private L: Level3D;
  /** the hero the current attack is aimed at (solo: always the player) */
  private focus: HeroLike | null = null;
  /** who is in the fist: a member id (net.myId = the host's own hero), null = nobody */
  private grabbedWho: string | null = null;
  private hpSeenBy = new Map<HeroLike, number>();
  private camps = new Map<HeroLike, { t: number; at: THREE.Vector3 }>();
  /** last hit on each stuck palm (team clap) */
  private clapLog: ({ who: string; t: number } | null)[] = [null, null];
  private ballSeq = 0;
  private crewHand = 1;
  private lastLeader = '';
  private dizzyCap = DIZZY_CAP;
  // ── co-op (client puppet) ──
  /** the King's events that go with what the puppet shows: delivered when the playback reaches them */
  netTimed = ['dead', 'cgrab', 'cfling'];
  private got = false;
  /** the host's snapshots: his body (x y z, rotX as the angle) carries the parsed record */
  private track: NetTrack<ThroneRec> | null = null;
  /** which palm holds a hero (-1 none) */
  private grabHand = -1;
  /** a palm holds MY hero (client) */
  private heldMe = false;
  private netDied = false; private diedLocal = false;
  private pushT = 0;
  private netLanes: { x: number; t: number; tele: number; ball: number }[] = [];
  private laneStripes: Stripe[] = [];
  private netBalls: number[][] | null = null;
  private deadBalls = new Set<number>();
  /** this machine ran the puppet (it may become the host if the host leaves) */
  private wasPuppet = false;

  constructor(L: Level3D, seat: THREE.Vector3, floorY = 0) {
    this.L = L;
    this.floorY = floorY;
    this.seat = seat.clone();
    this.rig = createKing();
    this.root.add(this.rig.root);
    this.root.position.copy(seat);
    L.scene.add(this.root);
    this.hands = [new BossHand(-1), new BossHand(1)];
    for (const h of this.hands) { L.scene.add(h.tele.g, h.stripe.mesh); L.col(h.col); h.pos.copy(this.restPos(h)); }
    // the orbit camera passes through his palms: they sweep past it all the time (no zoom pumping, no lost hero)
    const [pa, pb] = this.hands;
    L.tcam.camSkip = (c) => c === pa.col || c === pb.col;
    L.scene.add(this.aura.sprite);
    this.crew = new SummonCrew(L.scene);
    this.anim = {
      eye: 0.5, mouth: 0, anger: 0.2, look: { x: 0, y: 0 }, dizzy: 0, chew: 0, slump: 0, stand: 0, flash: 0, talk: 0, spin: 0,
      hands: [
        { pos: new THREE.Vector3(), pose: 'rest', glow: 0, flash: 0 },
        { pos: new THREE.Vector3(), pose: 'rest', glow: 0, flash: 0 },
      ],
    };
    // his bulk blocks the north of the hall
    L.col({ kind: 'box', min: new THREE.Vector3(seat.x - 10.5, floorY, seat.z - 12), max: new THREE.Vector3(seat.x + 10.5, floorY + 40, seat.z + 12), tag: 'king' });
    this.syncRig(0);
    if (L.nl) {
      // co-op: the room's difficulty, more health for a bigger party; same id on every machine
      this.mp = true;
      const base = coop.easy ? 160 : 220;
      this.hp = this.maxHp = Math.round(base * coop.hpScale());
      this.dizzyCap = Math.round(DIZZY_CAP * coop.hpScale());
      L.nl.add(this, NET_ID);
      this.crew.onGrab = (e, off) => {
        if (L.authority) L.nl?.entEvent(this, 'cgrab', { id: (e as unknown as Netted).netId, i: this.crewHand, o: [off.x, off.y, off.z] });
      };
      this.crew.onFling = (e, to, dur, h) => {
        if (L.authority) L.nl?.entEvent(this, 'cfling', { id: (e as unknown as Netted).netId, to: [to.x, to.y, to.z], d: dur, h });
      };
    }
  }

  restPos(h: BossHand) {
    const r = KING_HAND_REST[h.side < 0 ? 0 : 1];
    return tmp2.set(this.root.position.x + r.x, this.root.position.y + r.y, this.root.position.z + r.z).clone();
  }

  start() {
    this.state = 'idle'; this.cd = 1.0;
    this.lastHitT = this.t; this.hitLog.length = 0; this.campT = 0; this.summonT = 18;
  }

  faceTarget() { return this.rig.faceAnchor.getWorldPosition(new THREE.Vector3()); }
  aimTargets() {
    const out: THREE.Vector3[] = [];
    for (const h of this.hands) if (h.state === 'stuck') out.push(h.pos.clone().add(new THREE.Vector3(0, 1.2, 1.2 * Math.cos(h.yaw))));
    if (this.state === 'dizzy') out.push(this.faceTarget());
    for (const b of this.balls) if (!b.dead) out.push(b.center());
    // co-op: the fist holding a friend is a target too (hit it to free him)
    if (this.mp && !this.holdingMe()) for (const h of this.hands) if (h.state === 'hold') out.push(this.fistCenter(h));
    return out;
  }

  // ───────────────────────── co-op helpers ─────────────────────────
  /** run with this machine's effects captured for clients (host, outside the world tick: hits, releases) */
  private cap(L: Level3D, f: () => void) {
    const nl = L.nl;
    if (!nl || !nl.isHost || nl.capturing) { f(); return; }
    nl.capture(f);
  }
  /** a hero's member id (net.myId for my own) */
  private idOf(h: HeroLike) { return h.isLocal ? net.myId : (h as RemoteHero3).id; }
  /** a member's display name */
  private nameOf(id: string) { return net.members.get(id)?.name || 'Тоша'; }
  /** co-op host: a line in everyone's event feed */
  private feedAll(L: Level3D, text: string, color: string) {
    if (!L.nl) return;
    L.feed(text, color);
    L.nl.entEvent(this, 'feed', { t: text, c: color });
  }
  /** who swung / shot (host resolving): a friend's id, or mine */
  private whoHit(L: Level3D, shooter?: string | null) { return shooter ?? L.attacker ?? net.myId; }
  /** dedupe key for a swing: friends' attack ids live in their own number range */
  private atkKey(L: Level3D, atkId: number) {
    if (!L.nl || !L.attacker) return atkId;
    let h = 0;
    for (let i = 0; i < L.attacker.length; i++) h = (h * 31 + L.attacker.charCodeAt(i)) % 997;
    return (h + 1) * 1e6 + atkId;
  }
  /** a palm holds the hero of THIS machine */
  private holdingMe() {
    if (!this.mp) return false;
    return this.L.authority ? this.grabbedWho === net.myId && !!this.grabber : this.heldMe;
  }
  private fistCenter(h: BossHand) { return h.pos.clone().add(tmp.set(0, 1.4, 0)); }
  private knees() { return tmp2.set(this.seat.x, this.floorY, this.seat.z + 12).clone(); }
  private party(L: Level3D) { return L.nl ? Math.max(1, L.heroes().length) : 1; }
  private isGrabbed(h: HeroLike) { return h.isLocal ? !!this.L.player.grabbedBy : (h as RemoteHero3).grabbed; }
  /** the attack's hero (solo: the player; co-op: the focus while he is still up, else the nearest) */
  private fh(L: Level3D): HeroLike {
    if (!L.nl) return L.player;
    const f = this.focus;
    if (f && !f.dead && !f.downed && L.heroes().includes(f)) return f;
    return (this.focus = L.targetFor(this.knees()));
  }
  /** a palm's hero (slam chains / sweep passes can go after somebody else) */
  private handHero(L: Level3D, h: BossHand): HeroLike {
    if (!L.nl) return L.player;
    const t = h.tgt;
    if (t && !t.dead && !t.downed && L.heroes().includes(t)) return t;
    return (h.tgt = this.fh(L));
  }
  /** co-op: now and then somebody other than the focus (solo: the player) */
  private otherHero(L: Level3D): HeroLike {
    if (!L.nl) return L.player;
    const f = this.fh(L);
    const rest = L.alivePlayers().filter((h) => h !== f);
    return rest.length && Math.random() < 0.5 ? choose(rest) : f;
  }
  /** co-op: anyone (the focus a bit more often) — meat throws, walnut drops */
  private anyHero(L: Level3D): HeroLike {
    if (!L.nl) return L.player;
    const hs = L.alivePlayers();
    return hs.length && Math.random() < 0.6 ? choose(hs) : this.fh(L);
  }
  /** feature 27: he goes after the score leader (L.refs.leaderId), else whoever is nearest, now and then anyone */
  private pickFocus(L: Level3D): HeroLike {
    if (!L.nl) return L.player;
    const hs = L.alivePlayers();
    if (hs.length <= 1) return hs[0] ?? L.player;
    const lid = L.refs.leaderId as string | undefined;
    const leader = lid ? hs.find((h) => this.idOf(h) === lid) : undefined;
    const r = Math.random();
    if (leader && r < 0.5) {
      if (lid && lid !== this.lastLeader) {
        this.lastLeader = lid;
        this.barkKing(L, choose(['Самый жирный кусочек — ТЫ!', 'Ага, богатенький! Тебя — в коллекцию первым!', 'Ты, с короной! Иди сюда!']), 1.6);
      }
      return leader;
    }
    if (r < 0.8) return L.targetFor(this.knees());
    return choose(hs);
  }

  // ───────────────────────── per-frame ─────────────────────────
  update(L: Level3D, dt: number) {
    if (this.mp && !L.authority) { this.puppet(L, dt); this.wasPuppet = true; return; }
    if (this.wasPuppet) this.takeOver(L);
    this.t += dt;
    this.talk = Math.max(0, this.talk - dt * 3);
    const a = this.anim;
    a.flash = Math.max(0, a.flash - dt * 5);
    for (const h of this.hands) h.flash = Math.max(0, h.flash - dt * 5);
    const p = L.nl ? this.fh(L) : L.player;
    tmp.copy(p.pos).sub(this.root.position);
    a.look.x = damp(a.look.x, clamp(tmp.x / 22, -1, 1), 4, dt);
    a.look.y = damp(a.look.y, clamp(-0.55 + tmp.z * 0.006, -1, 0), 4, dt);
    L.hud.bossHp = this.hp; L.hud.bossMax = this.state === 'intro' || this.state === 'dead' ? 0 : this.maxHp; L.hud.bossName = this.name;
    this.updateSpeed();
    const live = this.state !== 'dead' && this.state !== 'intro';
    if (live) this.director(L, dt);

    if (this.state === 'dizzy') {
      this.dizzyT -= dt;
      a.dizzy = damp(a.dizzy, 1, 6, dt); a.slump = damp(a.slump, 1, 4, dt);
      this.slide = damp(this.slide, 1, 5, dt);
      a.eye = 0.9; a.mouth = damp(a.mouth, 0.35, 5, dt);
      for (const h of this.hands) if (h.state !== 'rest' && h.state !== 'lift') h.set('lift');
      if (this.dizzyT <= 0) this.recover(L);
    } else if (live) {
      a.dizzy = damp(a.dizzy, 0, 4, dt); a.slump = damp(a.slump, 0, 3, dt);
      this.slide = damp(this.slide, 0, 3, dt);
      const pant = this.phase === 3 ? 0.1 + 0.12 * Math.max(0, Math.sin(this.breath)) : this.t < this.breatherUntil ? 0.18 : 0;
      a.mouth = damp(a.mouth, this.talk > 0 ? 0.45 : pant, 6, dt);
      a.eye = damp(a.eye, 0.75 + a.anger * 0.25, 3, dt);
      if (this.state !== 'roar') a.anger = damp(a.anger, this.angerTarget(), 2.5, dt);
      if (this.state === 'roar' || this.state === 'attack') {
        if (this.attackFn && this.attackFn(dt) && this.state === 'attack') {
          this.state = 'idle'; this.cd = this.nextCooldown(); this.cancel = null; this.attackFn = null;
        }
      } else if (this.state === 'idle') { this.cd -= dt; if (this.cd <= 0) this.pickAttack(L); }
      if (this.state === 'idle' || this.state === 'attack') {
        this.summonT -= dt;
        for (let i = this.extras.length - 1; i >= 0; i--) if (this.extras[i](dt)) this.extras.splice(i, 1);
      }
    }
    // slide off the seat face-first when dizzy; breathe faster as he gets angrier
    const bRate = [1.7, 2.7, 3.9][this.phase - 1] * (1 + 0.15 * this.prog);
    this.breath += dt * (this.state === 'dead' ? 1 : bRate);
    if (!this.manualRoot) {
      const amp = live ? [0.12, 0.2, 0.32][this.phase - 1] * (1 - this.slide) : 0;
      this.root.position.set(this.seat.x, lerp(this.seat.y, this.floorY, this.slide) + Math.sin(this.breath) * amp, this.seat.z + 7 * this.slide);
      this.root.rotation.x = 0.25 * this.slide; // nose down on the floor
    }
    for (let i = this.later.length - 1; i >= 0; i--) {
      const l = this.later[i];
      l.t -= dt;
      if (l.t <= 0) { this.later.splice(i, 1); if (this.state !== 'dead') l.fn(); }
    }
    // (co-op: steam, sweat and the crew's landings are played by every machine itself)
    uncaptured(L, () => this.rageFx(L, dt, live));
    if (!this.freezeHands) this.updateHands(L, dt);
    uncaptured(L, () => this.crew.update(L, dt));
    this.updateBowling(L, dt);
    this.syncRig(dt);
  }

  syncRig(dt: number) {
    const a = this.anim;
    a.talk = this.talk > 0 ? Math.abs(Math.sin(this.t * 14)) : 0;
    this.root.updateMatrixWorld();
    this.hands.forEach((h, i) => {
      const ha = a.hands[i];
      ha.pos.copy(this.root.worldToLocal(tmp.copy(h.pos)));
      ha.pose = h.pose; ha.glow = h.glow; ha.flash = h.flash; ha.yaw = h.yaw;
    });
    this.rig.update(dt, a);
  }

  private updateSpeed() {
    const f = this.hp / this.maxHp;
    const pr = this.phase === 1 ? (1 - f) / 0.4 : this.phase === 2 ? (0.6 - f) / 0.35 : (0.25 - f) / 0.25;
    this.prog = clamp(pr, 0, 1);
    this.spd = PHASE_SPD[this.phase - 1] + (this.phase === 3 ? 0.1 : 0.08) * this.prog;
  }
  private angerTarget() {
    const base = [0.3, 0.65, 1][this.phase - 1] + 0.15 * this.prog;
    return clamp(base + (this.state === 'attack' ? 0.12 : 0) - (this.t < this.breatherUntil ? 0.2 : 0), 0, 1);
  }
  private nextCooldown() {
    let cd = PHASE_CD[this.phase - 1] * (1 - 0.15 * this.prog);
    cd *= lerp(1, 0.55, this.heat);
    if (this.t < this.breatherUntil) cd *= 1.6;
    cd += this.restBonus; this.restBonus = 0;
    // co-op: a bigger party gets a busier King
    if (this.mp) cd /= 1 + 0.08 * (this.party(this.L) - 1);
    return Math.max(0.3, cd);
  }
  private roarVol() { return [0.5, 0.7, 0.95][this.phase - 1]; }

  /** steam, sweat, a red halo and quicker breathing make the phase readable at a glance */
  private rageFx(L: Level3D, dt: number, live: boolean) {
    const head = this.rig.head.getWorldPosition(tmp3);
    const ph = this.phase;
    // (the head's origin is at the back of the neck: its centre is ≈ (0, +1, +1), the face ≈ +8 forward)
    const op = !live || this.state === 'dizzy' ? 0 : ph === 3 ? 0.5 + 0.18 * Math.sin(this.breath * 2) : ph === 2 ? 0.18 + 0.1 * this.prog : 0;
    this.aura.set(tmp.copy(head).add(tmp2.set(0, 1.5, 1.5)), (ph === 3 ? 34 : 30) + (ph === 3 ? Math.sin(this.breath) * 2.5 : 0), op);
    if (!live || this.state === 'dizzy') return;
    this.fxT -= dt;
    if (this.fxT > 0) return;
    if (ph === 3) {
      this.fxT = 0.06;
      for (const s of [-1, 1]) {
        L.fx.emit(tmp.copy(head).add(tmp2.set(s * 6.6, 2.2, 3)), {
          count: 1, speed: [3, 6], dir: tmp2.set(s * 0.5, 1, 0).normalize(), spread: 0.25,
          life: [0.5, 0.9], size: [0.7, 1.1], size2: 2.4, colors: ['#ffffff', '#ffe0ea', '#ffd0dc'], g: -2, drag: 1.5,
        });
      }
    } else if (ph === 2) {
      this.fxT = rand(0.25, 0.5);
      const s = Math.random() < 0.5 ? -1 : 1;
      L.fx.emit(tmp.copy(head).add(tmp2.set(s * rand(2.5, 4.5), rand(3.5, 5), 7.8)), {
        count: 1, speed: [1, 2.5], dir: tmp2.set(s * 0.6, 0.6, 0.5).normalize(), spread: 0.2,
        life: [0.6, 0.9], size: [0.35, 0.5], colors: ['#bfe8ff', '#e8f8ff'], g: 18,
      });
    } else this.fxT = 1;
  }

  // ───────────────────────── director ─────────────────────────
  private director(L: Level3D, dt: number) {
    if (L.nl) { this.coopDirector(L, dt); return; }
    const p = L.player;
    if (this.hpSeen < 0 || p.dead) this.hpSeen = p.hp;
    if (p.hp < this.hpSeen) { this.hitLog.push(this.t); this.lastHitT = this.t; }
    this.hpSeen = p.hp;
    while (this.hitLog.length && this.t - this.hitLog[0] > 10) this.hitLog.shift();
    // untouched for 20 s → press harder (shorter rests, nastier picks)
    this.heat = damp(this.heat, this.t - this.lastHitT > 20 ? 1 : 0, 1.5, dt);
    // 3 hits in 10 s → a breather (and now and then a heart falls from the chandelier)
    if (this.hitLog.length >= 3 && this.t > this.breatherUntil) {
      this.breatherUntil = this.t + 8;
      this.hitLog.length = 0;
      this.restBonus = 1.6;
      if (this.state === 'idle') this.cd = Math.max(this.cd, 2.2);
      this.barkKing(L, choose(['Уф... запыхался...', 'Пф-ф... дай отдышаться...', 'Ох, ну и денёк...']), 1.6);
      if (p.hp < p.maxHp && this.t - this.lastHeartT > 25 && Math.random() < 0.75) { this.lastHeartT = this.t; this.dropHeart(L); }
    }
    // camping
    const fighting = this.state === 'idle' || this.state === 'attack';
    if (!fighting || p.grabbedBy || p.dead) { this.campT = 0; this.campAnchor.copy(p.pos); }
    else if (Math.hypot(p.pos.x - this.campAnchor.x, p.pos.z - this.campAnchor.z) > 4) { this.campAnchor.copy(p.pos); this.campT = 0; }
    else this.campT += dt;
  }

  /** co-op director: hits on ANY hero count (a bigger party needs a few more to earn a breather), camping per hero */
  private coopDirector(L: Level3D, dt: number) {
    const hs = L.heroes();
    for (const h of hs) {
      const seen = this.hpSeenBy.get(h);
      if (seen !== undefined && !h.dead && h.hp < seen) { this.hitLog.push(this.t); this.lastHitT = this.t; }
      this.hpSeenBy.set(h, h.hp);
    }
    for (const h of [...this.hpSeenBy.keys()]) if (!hs.includes(h)) this.hpSeenBy.delete(h);
    while (this.hitLog.length && this.t - this.hitLog[0] > 10) this.hitLog.shift();
    this.heat = damp(this.heat, this.t - this.lastHitT > 20 ? 1 : 0, 1.5, dt);
    if (this.hitLog.length >= 2 + hs.length && this.t > this.breatherUntil) {
      this.breatherUntil = this.t + 8;
      this.hitLog.length = 0;
      this.restBonus = 1.6;
      if (this.state === 'idle') this.cd = Math.max(this.cd, 2.2);
      this.barkKing(L, choose(['Уф... запыхался...', 'Пф-ф... дай отдышаться...', 'Ох, ну и денёк...']), 1.6);
      // a heart for whoever is worst off
      let worst: HeroLike | null = null;
      for (const h of L.alivePlayers()) if (h.hp < h.maxHp && (!worst || h.hp / h.maxHp < worst.hp / worst.maxHp)) worst = h;
      if (worst && this.t - this.lastHeartT > 25 && Math.random() < 0.75) { this.lastHeartT = this.t; this.dropHeart(L, worst); }
    }
    // camping, per hero
    const fighting = this.state === 'idle' || this.state === 'attack';
    for (const h of hs) {
      let c = this.camps.get(h);
      if (!c) { c = { t: 0, at: h.pos.clone() }; this.camps.set(h, c); }
      if (!fighting || h.dead || h.downed || this.isGrabbed(h)) { c.t = 0; c.at.copy(h.pos); }
      else if (Math.hypot(h.pos.x - c.at.x, h.pos.z - c.at.z) > 4) { c.at.copy(h.pos); c.t = 0; }
      else c.t += dt;
    }
    for (const h of [...this.camps.keys()]) if (!hs.includes(h)) this.camps.delete(h);
  }
  /** co-op: the hero who has stood still longest (> 5 s), if any */
  private camper(L: Level3D): HeroLike | null {
    let best: HeroLike | null = null, bt = 5;
    for (const h of L.alivePlayers()) { const c = this.camps.get(h); if (c && c.t > bt) { bt = c.t; best = h; } }
    return best;
  }

  private dropHeart(L: Level3D, near?: HeroLike) {
    const p = near ?? L.player;
    const at = clampFloor(p.pos.x + rand(-4, 4), p.pos.z + rand(2, 5), 3);
    const before = L.pickups.length;
    L.dropPickup('heart', at.clone().setY(this.floorY + 16));
    const pk = L.pickups[before];
    if (pk) pk.vel.set(0, -4, 0);
    L.fx.stars(at.clone().setY(this.floorY + 15), 14);
    audio.sfx('coin', { pitch: 0.7 });
  }

  aliveEnemies(L: Level3D) { let n = 0; for (const e of L.enemies) if (!e.dead) n++; return n; }

  // ───────────────────────── attack choice ─────────────────────────
  private pickAttack(L: Level3D) {
    this.attackCount++;
    const ph = this.phase;
    // co-op: the attack goes after one hero (a camper first, else the leader / the nearest / anyone)
    const camper = L.nl ? this.camper(L) : null;
    if (L.nl) { this.focus = camper ?? this.pickFocus(L); for (const h of this.hands) h.tgt = null; }
    const p = L.nl ? this.fh(L) : L.player;
    const d = p.pos.z - (this.seat.z + 12); // distance from his knees (≤ 0 beside the throne)
    const near = d < 12, far = d >= 28;
    const pocket = p.pos.z < HALL.front;
    const heat = this.heat > 0.5, calm = this.t < this.breatherUntil;
    let k = '';
    if (L.nl ? !!camper : this.campT > 5) {
      k = far ? 'campNuts' : 'campSlam';
      if (L.nl) { const c = this.camps.get(p); if (c) { c.t = 0; c.at.copy(p.pos); } }
      else { this.campT = 0; this.campAnchor.copy(p.pos); }
      this.barkKing(L, choose(['Не стой столбом!', 'Вижу тебя, стоячий!', 'Заснул там, что ли?!']), 1.4);
    } else {
      const alive = this.aliveEnemies(L);
      const w: [string, number][] = [
        ['slam', near ? 2.5 : far ? 1.4 : 3],
        ['slamChain', [0.7, 2.2, 2.6][ph - 1] * (far ? 0.6 : 1)],
        ['sweep', pocket ? 0.1 : ph === 3 ? 1.3 : 2],
        ['cross', pocket ? 0 : ph === 3 ? 2 : ph === 2 && heat ? 0.8 : 0],
        ['clap', (near ? 2.6 : far ? 0.2 : ph >= 2 ? 1.2 : 0.5) * (pocket ? 0.3 : 1)],
        ['meat', (far ? 3 : near ? 0.5 : 1.6) * (this.t - this.lastDizzyT < DIZZY_LOCK ? 0.5 : 1)],
        ['walnuts', far ? (ph >= 2 ? 2 : 0.8) : near ? 0.5 : 1],
        ['bowl', pocket ? 0 : far ? 2.6 : near ? 0.4 : 2],
        ['grab', (near ? 2.2 : far ? 0.7 : 1.6) * (ph === 1 ? 0.6 : 1)],
        ['stomp', ph >= 3 ? (near ? 2.2 : far ? 0 : 0.9) : 0],
      ];
      if (this.summonT <= 0 && alive < 3 + (this.party(L) - 1) && !calm) w.push(['summon', 9]);
      for (const e of w) {
        if (heat && (e[0] === 'slamChain' || e[0] === 'cross' || e[0] === 'grab' || e[0] === 'bowl')) e[1] *= 1.6;
        if (calm && (e[0] === 'slamChain' || e[0] === 'cross' || e[0] === 'stomp')) e[1] *= 0.25;
        if (this.recent[0] === e[0]) e[1] *= 0.2; else if (this.recent[1] === e[0]) e[1] *= 0.5;
      }
      let sum = 0; for (const e of w) sum += e[1];
      let r = Math.random() * sum; k = 'slam';
      for (const e of w) { r -= e[1]; if (r <= 0) { k = e[0]; break; } }
    }
    this.startAttack(L, k);
  }

  /** start an attack by name (also handy for testing: boss.startAttack(L, 'bowl')) */
  startAttack(L: Level3D, k: string) {
    const ph = this.phase;
    const heat = this.heat > 0.5;
    this.recent.unshift(k); this.recent.length = Math.min(this.recent.length, 3);
    this.state = 'attack';
    this.cancel = null;
    switch (k) {
      case 'slam': this.attackFn = this.atkSlam(L, 1); break;
      case 'slamChain':
        this.attackFn = this.atkSlam(L, ph + 1);
        if (ph === 3 || (ph === 2 && heat)) this.extras.push(this.drizzle(L, 3 + ph, 0.7 / this.spd));
        break;
      case 'campSlam': this.attackFn = this.atkSlam(L, ph >= 2 ? 3 : 2); break;
      case 'sweep': this.attackFn = this.atkSweep(L, ph >= 3 ? 2 : 1); break;
      case 'cross': this.attackFn = this.atkCross(L); break;
      case 'meat':
        this.attackFn = this.atkMeat(L);
        if (ph === 3 && Math.random() < 0.5) this.extras.push(this.drizzle(L, 3.5, 0.7 / this.spd));
        break;
      case 'walnuts': this.attackFn = this.atkWalnuts(L); break;
      case 'campNuts': this.attackFn = this.atkNutBurst(L, this.fh(L).pos.clone()); break;
      case 'clap': this.attackFn = this.atkClap(L); break;
      case 'stomp': this.attackFn = this.atkStomp(L); break;
      case 'bowl': this.attackFn = this.atkBowl(L); break;
      case 'grab': this.attackFn = this.atkGrab(L); break;
      default: this.attackFn = this.atkSummon(L);
    }
  }

  private barkKing(L: Level3D, s: string, dur = 1.5) { L.bark(this.rig.head, s, dur, 9); this.talk = 0.6; }
  private hint(L: Level3D, key: string, s: string) { if (this.hints.has(key)) return; this.hints.add(key); L.toast(s); }

  private freeHand(prefer: BossHand | null) {
    if (prefer && prefer.state === 'rest') return prefer;
    return this.hands.find((h) => h.state === 'rest') ?? null;
  }
  private nearHand(L: Level3D) { return this.fh(L).pos.x < this.seat.x ? this.hands[0] : this.hands[1]; }
  private groundAt(L: Level3D, x: number, z: number, fromY: number) {
    const g = L.phys.groundAt(x, z, fromY, 0.05);
    return g > -1e8 ? g : this.floorY;
  }
  private dropNut(L: Level3D, x: number, z: number, warn: number, near?: HeroLike) {
    const v = clampFloor(x, z, 1);
    const gy = this.groundAt(L, v.x, v.z, (near ?? L.player).pos.y + 1.5);
    L.addFaller(new Faller3(v.x, gy + 26, v.z, gy, 'walnut', warn));
  }

  // ───────────────────────── attacks ─────────────────────────
  private atkSlam(L: Level3D, count: number) {
    let started = 0;
    let last: BossHand | null = null;
    const s = this.spd;
    const trackT = Math.max(0.6, 1.0 / s);
    const stuckT = Math.max(0.95, 1.7 / s);
    let chainSweep = this.phase >= 2 && Math.random() < 0.35;
    if (count > 1) this.barkKing(L, choose(['Шлёп! Шлёп! ШЛЁП!', 'Раздавлю!', 'Хлоп-хлоп!']));
    return () => {
      const lastFalling = !last || last.state === 'slam' || last.state === 'stuck' || last.state === 'lift' || last.state === 'rest';
      if (started < count && lastFalling) {
        const h = this.freeHand(started === 0 ? this.nearHand(L) : this.hands.find((x) => x !== last) ?? null);
        if (h) {
          if (L.nl) h.tgt = started === 0 ? this.fh(L) : this.otherHero(L);
          h.trackT = trackT; h.stuckT = stuckT; h.yaw = 0;
          h.set('rise');
          audio.sfx('warn', { volume: 0.5 });
          started++; last = h;
        }
      }
      if (started >= count && this.hands.every((h) => h.state === 'rest' || h.state === 'lift')) {
        if (chainSweep && this.fh(L).pos.z > HALL.front) { chainSweep = false; this.attackFn = this.atkSweep(L, 1); return false; }
        return this.hands.every((h) => h.state === 'rest');
      }
      return false;
    };
  }

  private sweepSpeed() { return Math.min(36, 26 + 18 * (this.spd - 1)); }
  private sweepPrep(k = 1) { return Math.max(0.85, (1.15 * k) / Math.pow(this.spd, 0.8)); }

  private atkSweep(L: Level3D, passes: number) {
    let pass = 0;
    let h: BossHand | null = null;
    const begin = () => {
      const p = pass === 0 ? this.fh(L) : this.otherHero(L);
      h = this.freeHand(pass === 0 ? null : this.hands.find((x) => x !== h) ?? null);
      if (!h) return;
      const z = clamp(p.pos.z, SWEEP_Z0, HALL.z1 - 3);
      const fromLeft = pass === 0 ? p.pos.x > 0 : !(h.sweepDir > 0);
      h.sweepDir = fromLeft ? 1 : -1;
      h.yaw = 0;
      h.prepT = this.sweepPrep(); h.speed = this.sweepSpeed();
      h.target.set(fromLeft ? HALL.x0 - 4 : HALL.x1 + 4, this.floorY, z - 1.2);
      h.set('sweepPrep');
      audio.sfx('warn');
      if (pass === 0) this.barkKing(L, choose(['А ну, подметём!', 'Прыгай-прыгай!', 'Шмяк по полу!']));
      if (!this.sweepHinted) { this.sweepHinted = true; L.toast('Светящаяся полоса — сейчас проедет ладонь! Перепрыгни её или убеги с полосы'); }
      pass++;
    };
    begin();
    return () => {
      if (!h) { begin(); return false; }
      if (h.state === 'rest' || h.state === 'lift') {
        if (pass < passes) { begin(); return false; }
        return this.hands.every((x) => x.state === 'rest');
      }
      return false;
    };
  }

  /** phase 3: both palms at once, opposite directions, two bands ~10 m apart */
  private atkCross(L: Level3D) {
    const p = this.fh(L);
    const z1 = clamp(p.pos.z, SWEEP_Z0, HALL.z1 - 3);
    let z2 = z1 + (z1 > 10 ? -10 : 10);
    // co-op: the second band goes through somebody else when he stands far enough from the first one
    const o = L.nl ? L.alivePlayers().find((h) => h !== p && Math.abs(clamp(h.pos.z, SWEEP_Z0, HALL.z1 - 3) - z1) >= 7) : undefined;
    if (o) z2 = o.pos.z;
    z2 = clamp(z2, SWEEP_Z0, HALL.z1 - 3);
    const zs = Math.random() < 0.5 ? [z1, z2] : [z2, z1];
    this.hands.forEach((h, i) => {
      h.sweepDir = h.side < 0 ? 1 : -1;
      h.yaw = 0;
      h.prepT = this.sweepPrep(1.15); h.speed = this.sweepSpeed() * 0.95;
      h.target.set(h.side < 0 ? HALL.x0 - 4 : HALL.x1 + 4, this.floorY, zs[i] - 1.2);
      h.set('sweepPrep');
    });
    audio.sfx('warn'); audio.sfx('warn', { pitch: 0.8 });
    this.barkKing(L, choose(['Крест-накрест!', 'Двумя руками — ХВАТЬ!', 'Подметаю всё!']));
    this.hint(L, 'cross', 'Две полосы — две ладони! Прыгай через каждую или встань между ними');
    let t = 0;
    return (dt: number) => { t += dt; return t > 0.5 && this.hands.every((h) => h.state === 'rest'); };
  }

  private atkClap(L: Level3D) {
    const p = this.fh(L);
    const c = clampFloor(clamp(p.pos.x, HALL.x0 + 6, HALL.x1 - 6), clamp(p.pos.z, SWEEP_Z0, HALL.z1 - 4), 2);
    const x0 = c.x, z = c.z;
    const s = this.spd;
    let t = 0, clapped = false;
    for (const h of this.hands) {
      h.yaw = h.side < 0 ? Math.PI / 2 : -Math.PI / 2;
      h.target.set(x0 + h.side * 15, this.floorY, z);
      h.prepT = Math.max(0.7, 0.95 / Math.pow(s, 0.7)); h.speed = 34 * s;
      h.set('clapPrep');
    }
    audio.sfx('warn'); audio.sfx('warn', { pitch: 1.3 });
    this.barkKing(L, choose(['ХЛОП!', 'Поймаю ладошками!', 'Комарик!']));
    return (dt: number) => {
      t += dt;
      const [a, b] = this.hands;
      if (!clapped && a.state === 'clap' && b.state === 'clap' && Math.abs(a.pos.x - b.pos.x) < 10.8) {
        clapped = true;
        for (const h of this.hands) { h.set('stuck'); h.stuckT = Math.max(0.8, 1.2 / s); this.squeezeOut(L, h); }
        L.tcam.shake(0.7); audio.sfx('bigSlam'); audio.sfx('slam', { pitch: 1.4 });
        L.fx.ring(new THREE.Vector3(x0, this.floorY + 1.5, z), 4, '#ffffff', 0.35, false);
        L.addWave(new Wave3(new THREE.Vector3(x0, this.floorY, z), 10 * Math.sqrt(s), 24, 6));
      }
      return t > 0.5 && this.hands.every((h) => h.state === 'rest');
    };
  }

  private atkMeat(L: Level3D) {
    let t = 0, thrown = 0;
    const s = this.spd;
    const total = 2 + this.phase + (this.heat > 0.5 ? 1 : 0);
    const every = 0.42 / s;
    const T = 1.15 / Math.sqrt(s);
    this.barkKing(L, choose(['Отведай-ка!', 'Мясной дождик!', 'Ам-ням... НА!', 'Лови котлетку!']));
    return (dt: number) => {
      t += dt;
      this.anim.mouth = damp(this.anim.mouth, 1, 10, dt);
      if (t > 0.6 + thrown * every && thrown < total) {
        thrown++;
        const from = this.rig.mouthAnchor.getWorldPosition(new THREE.Vector3());
        from.z += 1.5;
        const p = thrown === 1 ? this.fh(L) : this.anyHero(L);
        const g = 14;
        const tgt = p.pos.clone().add(new THREE.Vector3(p.vel.x * T * 0.6 + rand(-1.5, 1.5), 0.6, p.vel.z * T * 0.6 + rand(-1.5, 1.5)));
        const vel = new THREE.Vector3((tgt.x - from.x) / T, (tgt.y - from.y + 0.5 * g * T * T) / T, (tgt.z - from.z) / T);
        const sh = L.spawnEnemyShot('meat', from, vel, g, false, 'king');
        audio.sfx('throw', { pitch: 0.7 }); audio.sfx('chomp', { volume: 0.5 });
        if (thrown === 1) this.hint(L, 'meat', 'Ударь котлету мечом — она полетит обратно Королю в лицо!');
      }
      return t > 0.8 + total * every + 0.6;
    };
  }

  private atkWalnuts(L: Level3D) {
    let t = 0, dropped = 0;
    const s = this.spd;
    let n = 8 + this.phase * 2 + (this.heat > 0.5 ? 2 : 0);
    if (L.nl) n = Math.round(n * (1 + 0.3 * (this.party(L) - 1)));
    const every = 0.17 / s, warn = Math.max(0.75, 0.9 / Math.sqrt(s));
    this.barkKing(L, 'ОРЕХОВЫЙ ДОЖДЬ!', 1.8);
    audio.sfx('roar', { volume: this.roarVol() * 0.7, pitch: 1.2 });
    L.tcam.shake(0.4);
    return (dt: number) => {
      t += dt;
      this.anim.anger = Math.max(this.anim.anger, 0.85);
      if (t > 0.4 + dropped * every && dropped < n) {
        dropped++;
        const p = this.anyHero(L);
        const a = rand(0, Math.PI * 2), r = dropped % 3 === 0 ? 0 : rand(1.5, 7);
        this.dropNut(L, p.pos.x + p.vel.x * 0.5 + Math.cos(a) * r, p.pos.z + p.vel.z * 0.5 + Math.sin(a) * r, warn, p);
      }
      return t > 0.4 + n * every + 1.4;
    };
  }

  /** camping punisher: a tight ring of walnuts around the spot he's been standing on, then one right on it */
  private atkNutBurst(L: Level3D, at: THREE.Vector3) {
    let t = 0, dropped = 0;
    const n = 10 + this.phase * 2;
    const warn = Math.max(0.8, 1.0 / Math.sqrt(this.spd));
    audio.sfx('roar', { volume: this.roarVol() * 0.8, pitch: 1.3 });
    L.tcam.shake(0.5);
    return (dt: number) => {
      t += dt;
      this.anim.anger = 1;
      if (t > 0.3 + dropped * 0.05 && dropped < n) {
        dropped++;
        const a = (dropped / n) * Math.PI * 2, r = dropped === n ? 0 : rand(1.6, 4.5);
        this.dropNut(L, at.x + Math.cos(a) * r, at.z + Math.sin(a) * r, warn + (dropped === n ? 0.25 : 0), this.fh(L));
      }
      return t > 0.3 + n * 0.05 + 1.8;
    };
  }

  /** a light walnut drizzle layered on top of another attack (phase-3 combos) */
  private drizzle(L: Level3D, dur: number, every: number) {
    let t = 0, n = 0;
    const warn = Math.max(0.8, 0.95 / Math.sqrt(this.spd));
    return (dt: number) => {
      t += dt;
      if (t > (n + 1) * every && t < dur) {
        n++;
        const p = this.anyHero(L);
        const a = rand(0, Math.PI * 2), r = n % 4 === 0 ? 0.5 : rand(2.5, 7);
        this.dropNut(L, p.pos.x + Math.cos(a) * r, p.pos.z + Math.sin(a) * r, warn, p);
      }
      return t >= dur;
    };
  }

  private atkStomp(L: Level3D) {
    let t = 0, n = 0;
    const s = this.spd;
    const k0 = 0.75 / Math.sqrt(s), k1 = 1.55 / Math.sqrt(s);
    this.barkKing(L, 'ТОП! ТОП!', 1.4);
    return (dt: number) => {
      t += dt;
      const up = t < k0 * 0.8 ? t / (k0 * 0.8) : 1;
      this.anim.stand = damp(this.anim.stand, n < 2 ? 0.55 * up : 0, 8, dt);
      for (const k of [k0, k1]) {
        if (t > k && n < (k === k1 ? 2 : 1)) {
          n++;
          const sx = n === 1 ? -1 : 1;
          const at = new THREE.Vector3(this.seat.x + sx * 4, this.floorY, this.seat.z + 14);
          L.addWave(new Wave3(at, 11 * Math.sqrt(s), 46, 3));
          L.tcam.shake(0.8); audio.sfx('bigSlam');
          L.fx.dust(at.clone(), 26, '#c8b0e0');
        }
      }
      return t > k1 + 0.85;
    };
  }

  // ── meatball bowling ──
  private atkBowl(L: Level3D) {
    const ph = this.phase, p = this.fh(L), s = this.spd;
    const n = Math.min(6, [3, 4, 5][ph - 1] + (this.heat > 0.5 ? 1 : 0) + (this.party(L) >= 3 ? 1 : 0));
    const tele = Math.max(0.85, 1.0 / Math.sqrt(s));
    const gap = Math.max(0.32, 0.6 / s);
    const speed = 11 * Math.pow(s, 0.8);
    const xs: number[] = [clamp(p.pos.x, -27, 27)];
    // co-op: a lane through a couple of the other heroes too
    if (L.nl) for (const o of L.alivePlayers()) {
      const x = clamp(o.pos.x, -27, 27);
      if (xs.length < Math.min(n, 3) && xs.every((q) => Math.abs(q - x) >= 6.5)) xs.push(x);
    }
    for (let guard = 0; xs.length < n && guard < 300; guard++) {
      const x = rand(-27, 27);
      if (xs.every((o) => Math.abs(o - x) >= 6.5)) xs.push(x);
    }
    xs.sort((a, b) => a - b);
    const half = Math.ceil(xs.length / 2);
    const left = xs.slice(0, half), right = xs.slice(half).reverse();
    const order: [number, BossHand][] = [];
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      if (i < left.length) order.push([left[i], this.hands[0]]);
      if (i < right.length) order.push([right[i], this.hands[1]]);
    }
    const mine: Lane[] = [];
    order.forEach(([x, hand], i) => {
      const st = this.stripePool.pop() ?? (() => { const st2 = new Stripe(); L.scene.add(st2.mesh); return st2; })();
      // phase 3: the last ball is aimed at wherever the hero is when its lane lights up (a beat later, so a
      // double jump over the previous ball has landed by then)
      const aim = ph === 3 && i === order.length - 1;
      const lane: Lane = { x, t: tele + i * gap + (aim ? 0.6 : 0), tele, speed, stripe: st, hand, ball: null, aim, shown: false };
      mine.push(lane); this.lanes.push(lane);
    });
    for (const h of this.hands) { h.set('puppet'); h.yaw = 0; }
    this.barkKing(L, choose(['Кегли! А кегля — ты!', 'Фрикадельки — к бою!', 'СТРАЙК!']), 1.6);
    audio.sfx('roar', { volume: this.roarVol() * 0.6, pitch: 1.1 });
    this.hint(L, 'bowl', 'Фрикадельки покатятся по светящимся дорожкам! Уйди с дорожки или перепрыгни двойным прыжком');
    this.cancel = () => {
      for (const ln of mine) if (!ln.ball) { ln.stripe.hide(); this.stripePool.push(ln.stripe); const i = this.lanes.indexOf(ln); if (i >= 0) this.lanes.splice(i, 1); }
    };
    let after = 0;
    return (dt: number) => {
      for (const h of this.hands) {
        if (h.state !== 'puppet') continue;
        const next = mine.find((ln) => !ln.ball && ln.hand === h);
        if (!next) { h.set('lift'); continue; }
        const push = next.t < 0.16;
        tmp.set(next.x, this.floorY + (push ? 0.2 : 1.2), push ? -16.4 : -21.2);
        h.pos.lerp(tmp, Math.min(1, dt * (push ? 18 : 7 * s)));
        h.pose = 'flat'; h.yaw = damp(h.yaw, 0, 10, dt);
      }
      if (mine.some((ln) => !ln.ball)) return false;
      after += dt;
      const pz = L.nl ? Math.max(-99, ...L.alivePlayers().map((o) => o.pos.z)) : L.player.pos.z;
      const passed = mine.every((ln) => !ln.ball || ln.ball.dead || ln.ball.pos.z > pz + 4);
      return this.hands.every((h) => h.state === 'rest' || h.state === 'lift') && (passed || after > 3);
    };
  }

  private updateBowling(L: Level3D, dt: number) {
    for (let i = this.lanes.length - 1; i >= 0; i--) {
      const ln = this.lanes[i];
      if (!ln.ball) {
        ln.t -= dt;
        if (ln.t > ln.tele) continue;
        if (!ln.shown) {
          ln.shown = true;
          if (ln.aim) ln.x = clamp(this.anyHero(L).pos.x, -27, 27);
          audio.sfx('warn', { volume: 0.35, pitch: 0.9 });
        }
        ln.stripe.show(ln.x - 1.7, ln.x + 1.7, -20.2, HALL.z1 + 1, this.floorY, this.t, ln.t < 0.3 ? 1 : 0);
        if (ln.t <= 0) {
          ln.ball = new BowlBall(L, ln.x, -18.6, ln.speed, this.floorY);
          ln.ball.id = ++this.ballSeq;
          this.balls.push(ln.ball);
          ln.hand.flash = 0.5;
          L.tcam.shake(0.2); audio.sfx('throw', { pitch: 0.5 }); audio.sfx('thud', { pitch: 0.5 });
          L.fx.dust(new THREE.Vector3(ln.x, this.floorY, -18), 10, '#c8b0e0');
        }
      } else if (ln.ball.dead) {
        ln.stripe.hide(); this.stripePool.push(ln.stripe); this.lanes.splice(i, 1);
      } else {
        ln.stripe.show(ln.x - 1.7, ln.x + 1.7, ln.ball.pos.z - BowlBall.R, HALL.z1 + 1, this.floorY, this.t, 1);
      }
    }
    for (const b of this.balls) b.update(L, dt);
    this.balls = this.balls.filter((b) => !b.dead);
  }

  // ── grab ──
  private atkGrab(L: Level3D) {
    const s = this.spd;
    const h = this.freeHand(this.nearHand(L)) ?? this.nearHand(L);
    if (L.nl) h.tgt = this.fh(L);
    const tp = this.trackPoint(L, h).clone();
    h.target.copy(tp);
    // start ~11 m from the hero toward the King; if that is blocked, come in from the side
    tmp.set(this.seat.x + h.side * 6 - tp.x, 0, HALL.front - tp.z).normalize();
    let st = clampFloor(tp.x + tmp.x * 11, tp.z + tmp.z * 11, 2);
    if (Math.hypot(st.x - tp.x, st.z - tp.z) < 7) {
      const sx = tp.x > 0 ? -1 : 1;
      st = clampFloor(tp.x + sx * 11, tp.z + 2, 2);
    }
    h.start.copy(st);
    h.prepT = Math.max(0.65, 0.95 / s);
    h.speed = Math.min(34, 22 * s);
    h.set('grabPrep');
    audio.sfx('warn', { pitch: 0.8 });
    this.barkKing(L, choose(['Иди-ка сюда!', 'Цап-царап!', 'Попался, который кусался!']), 1.4);
    this.hint(L, 'grab', 'Ладонь хватает по светящейся полосе! Прыгни, сделай рывок или уйди с полосы');
    let t = 0;
    return (dt: number) => {
      t += dt;
      return t > 0.3 && h.state === 'rest' && !this.grabber;
    };
  }

  private catchHero(L: Level3D, h: BossHand) {
    const p = L.player;
    const self = this;
    const g: Grabber = {
      tip: () => self.holdTip(h),
      release: () => self.onGrabRelease(L, h, L.player.grip <= 0),
    };
    this.grabber = g;
    if (L.nl) this.grabbedWho = net.myId;
    p.grabbedBy = g as unknown as Noodle3;
    p.grip = 6 + 2 * this.phase; p.grabDmgT = 99;
    p.atk = null;
    h.set('hold');
    h.start.copy(h.pos);
    h.pose = 'fist';
    audio.sfx('grab'); audio.sfx('chomp', { volume: 0.4, pitch: 0.7 });
    L.tcam.shake(0.3);
    this.barkKing(L, choose(['ПОПАЛСЯ!', 'Ага! Сейчас я тебя... ням!', 'Какой хрустящий!']), 1.6);
    // (co-op: this hint is for MY hero only — friends would read it as if they were caught)
    uncaptured(L, () => this.hint(L, 'held', 'Тебя схватили! Жми кнопки — особенно удар по пальцам, — чтобы вырваться!'));
  }

  /** co-op: the palm caught a friend — he is held on his own machine (L.netGrab → grabTip()), I only keep the fist */
  private catchRemote(L: Level3D, h: BossHand, r: RemoteHero3) {
    const self = this;
    this.grabber = { tip: () => self.holdTip(h), release: () => self.onGrabRelease(L, h, true) };
    this.grabbedWho = r.id;
    h.set('hold');
    h.start.copy(h.pos);
    h.pose = 'fist';
    audio.sfx('grab'); audio.sfx('chomp', { volume: 0.4, pitch: 0.7 });
    L.tcam.shake(0.3);
    this.barkKing(L, choose(['ПОПАЛСЯ!', 'Ага! Сейчас я тебя... ням!', 'Какой хрустящий!']), 1.6);
    net.send(r.id, GM.grab, { by: this.netId });
    L.nl?.entEvent(this, 'grab', { who: r.id, g: 6 + 2 * this.phase, i: this.hands.indexOf(h) });
  }

  /** who the lunging palm catches: solo — the player if he can be caught; co-op — the first hero within reach */
  private grabVictim(L: Level3D, c: THREE.Vector3): HeroLike | null {
    if (!L.nl) {
      const p = L.player;
      return !p.dead && !p.grabbedBy && p.invuln <= 0 && !p.dashing && p.control
        && Math.hypot(p.pos.x - c.x, p.pos.z - c.z) < 2.3 && p.pos.y < this.floorY + 1.4 ? p : null;
    }
    for (const o of L.alivePlayers()) {
      if (this.isGrabbed(o) || o.invuln > 0 || o.dashing || !o.control) continue;
      if (Math.hypot(o.pos.x - c.x, o.pos.z - c.z) < 2.3 && o.pos.y < this.floorY + 1.4) return o;
    }
    return null;
  }

  /** co-op client: the replicated fist point a held hero is squeezed onto (L.netGrab) */
  grabTip() {
    const h = this.hands.find((x) => x.state === 'hold') ?? this.hands[this.grabHand] ?? this.hands[1];
    return this.holdTip(h);
  }

  /** co-op host: a friend's machine says he got out of the fist (mashed free, hurt by something, died) */
  netReleased(L: Level3D, who: string, why: string) {
    if (!this.grabber || who !== this.grabbedWho) return;
    const h = this.hands.find((x) => x.state === 'hold');
    const r = L.remote(who);
    void why;
    this.cap(L, () => {
      if (h) this.onGrabRelease(L, h, !(r && (r.dead || r.downed)));
      else { this.grabber = null; this.grabbedWho = null; }
    });
  }

  /** feature 17: ANOTHER hero (`by`) whacked the fist that holds a friend — he drops out, the stunned palm flops down */
  private rescue(L: Level3D, h: BossHand, by: string) {
    const who = this.grabbedWho;
    if (!this.grabber || !who) return;
    this.feedAll(L, `${this.nameOf(by)} выручает ${this.nameOf(who)} из кулака!`, '#7ae8ff');
    // the same swing also asks coopMechanics to free him: it skips a rescue that just happened
    ((L.refs.rescuedAt ??= {}) as Record<string, number>)[who] = L.t;
    if (who === net.myId) {
      const p = L.player;
      if (p.grabbedBy === (this.grabber as unknown as Noodle3)) { p.grabbedBy = null; p.body.vel.y = 9; p.invuln = 0.8; }
    } else net.send(who, GM.release, { by: this.netId, why: 'rescue' });
    const tip = this.holdTip(h);
    L.fx.text(tip.clone().setY(tip.y + 1.2), 'Спасён!', '#7ae8ff', 24);
    L.fx.stars(tip, 14);
    audio.sfx('break');
    this.onGrabRelease(L, h, true);
  }

  /** where the hero is held: squeezed on top of the fist, legs inside (so the camera still sees him) */
  private holdTip(h: BossHand) { return h.fwd(tmp3).multiplyScalar(0.8).add(h.pos).add(tmp2.set(0, 3.0, 0)).clone(); }

  /** Player3 calls this when he mashes free (grip ≤ 0) or gets hurt by something else; mashed = the stunned palm drops */
  private onGrabRelease(L: Level3D, h: BossHand, mashed: boolean) {
    if (!this.grabber) return;
    this.grabber = null;
    this.grabbedWho = null;
    if (h.state !== 'hold') return;
    if (mashed) {
      // fingers whacked loose: the stunned palm flops to the floor and stays there a while
      h.target.copy(clampFloor(h.pos.x, h.pos.z + 1.2, 1));
      h.stuckT = Math.max(1.3, 1.9 / this.spd);
      h.yaw = 0; h.vy = 0;
      h.set('slam');
      h.harmless = true;
      h.flash = 1;
      audio.sfx('bossHit', { pitch: 1.3 });
      this.barkKing(L, choose(['Ай-ай-ай, пальчики!', 'Ой! Скользкий!', 'Кусается!']), 1.4);
    } else h.set('lift');
  }

  /** the hero wasn't freed in time: chomp, 2 damage, thrown back into the hall */
  private chomp(L: Level3D, h: BossHand) {
    const who = this.grabbedWho;
    if (L.nl && who && who !== net.myId) {
      // a friend: 2 damage and the toss happen on his machine, then he is let go
      this.grabber = null; this.grabbedWho = null;
      const mouth = this.rig.mouthAnchor.getWorldPosition(new THREE.Vector3());
      this.anim.mouth = 1;
      audio.sfx('chomp'); audio.sfx('chomp', { pitch: 0.7 });
      L.remote(who)?.hurt(L, 2, mouth, new THREE.Vector3(rand(-5, 5), 11, 15), 0.7);
      net.send(who, GM.release, { by: this.netId, why: 'chomp' });
      L.tcam.shake(0.6);
      this.barkKing(L, choose(['Тьфу! Невкусный!', 'Фу, жёсткий!', 'Ням... тьфу!']), 1.5);
      h.set('lift');
      return;
    }
    const p = L.player;
    this.grabber = null;
    this.grabbedWho = null;
    p.grabbedBy = null;
    const mouth = this.rig.mouthAnchor.getWorldPosition(new THREE.Vector3());
    this.anim.mouth = 1;
    audio.sfx('chomp'); audio.sfx('chomp', { pitch: 0.7 });
    p.invuln = 0;
    uncaptured(L, () => p.hurt(L, 2, mouth));
    if (!p.dead) { p.body.vel.set(rand(-5, 5), 11, 15); p.knockT = 0.7; }
    L.tcam.shake(0.6);
    this.barkKing(L, choose(['Тьфу! Невкусный!', 'Фу, жёсткий!', 'Ням... тьфу!']), 1.5);
    h.set('lift');
  }

  /** let go of the hero (attack interrupted) */
  private dropHero(L: Level3D) {
    if (!this.grabber) return;
    const who = this.grabbedWho;
    if (L.nl && who && who !== net.myId) net.send(who, GM.release, { by: this.netId, why: 'drop' });
    const p = L.player;
    if (p.grabbedBy === (this.grabber as unknown as Noodle3)) {
      p.grabbedBy = null;
      p.body.vel.set(0, 8, 6);
      p.invuln = Math.max(p.invuln, 1);
    }
    this.grabber = null;
    this.grabbedWho = null;
  }

  // ── summons ──
  private atkSummon(L: Level3D) {
    const ph = this.phase, s = this.spd;
    const extra = this.party(L) - 1;
    const room = Math.max(1, 5 + extra - this.aliveEnemies(L));
    type Mode = 'carry' | 'toss' | 'rain' | 'sleeve';
    const pk: { kinds: EnemyKind[]; mode: Mode; shout: string }[] = ph === 1 ? [
      { kinds: ['guard', 'guard'], mode: 'carry', shout: L.nl ? 'СТРАЖА! ВЗЯТЬ ИХ!' : 'СТРАЖА! ВЗЯТЬ ЕГО!' },
      { kinds: ['guard', 'shield'], mode: 'carry', shout: 'Щитоносец, за мной!' },
    ] : ph === 2 ? [
      { kinds: ['shield', 'bomber'], mode: 'toss', shout: 'Лови подарочек!' },
      { kinds: ['spitter', 'bomber'], mode: 'toss', shout: 'Бомбисты, огонь!' },
      { kinds: ['shield', 'spitter'], mode: 'carry', shout: L.nl ? 'Окружить их!' : 'Окружить его!' },
      { kinds: ['jelly', 'jelly', 'jelly'], mode: 'rain', shout: 'ЖЕЛЕЙНЫЙ ДОЖДЬ!' },
    ] : [
      { kinds: ['charger', 'bomber', 'guard'], mode: 'toss', shout: L.nl ? 'ВСЕ НА НИХ!' : 'ВСЕ НА НЕГО!' },
      { kinds: ['book', 'book', 'book', 'book'], mode: 'sleeve', shout: 'А у меня в рукаве — книжки!' },
    ];
    let idx = Math.floor(Math.random() * pk.length);
    if (idx === this.lastPkg && pk.length > 1) idx = (idx + 1 + Math.floor(Math.random() * (pk.length - 1))) % pk.length;
    this.lastPkg = idx;
    const pack = pk[idx];
    // co-op: a bigger party gets a bigger handful (feature 13)
    const kinds = (extra >= 2 ? [...pack.kinds, pack.kinds[0]] : pack.kinds).slice(0, room);
    const mode = pack.mode;
    this.summonT = SUMMON_EVERY[ph - 1];
    if (L.nl) this.summonT /= 1 + 0.15 * extra;
    this.restBonus = 0.3;
    const h = this.freeHand(this.hands[1]) ?? this.hands[1];
    this.crewHand = this.hands.indexOf(h);
    h.set('puppet'); h.yaw = 0;
    this.barkKing(L, pack.shout, 1.6);
    audio.sfx('roar', { volume: this.roarVol() * 0.6, pitch: 1.4 });
    const behind = new THREE.Vector3(this.seat.x + h.side * 14, this.floorY + 26, this.seat.z - 6);
    const anchor = () => h.pos;
    let stage = 0, t = 0, sent = 0;
    const heroSoon = () => { const p = this.fh(L); return tmp3.set(p.pos.x + p.vel.x * 0.5, 0, p.pos.z + p.vel.z * 0.5); };
    this.cancel = () => { if (this.crew.held.length) this.crew.scatter(L, this.fh(L).pos); };
    return (dt: number) => {
      t += dt;
      const p = this.fh(L);
      if (stage === 0) {
        // reach behind the throne and grab a fistful of mobs
        h.pos.lerp(behind, Math.min(1, dt * 4 * s)); h.pose = 'grab';
        if (t > 0.8 / Math.sqrt(s)) {
          kinds.forEach((k, i) => this.crew.grab(L, k, anchor, new THREE.Vector3((i - (kinds.length - 1) / 2) * 1.1, 1.7, 1.2)));
          audio.sfx('grab', { pitch: 0.8 });
          stage = 1; t = 0;
        }
      } else if (stage === 1) {
        let dst: THREE.Vector3, dur: number;
        h.pose = mode === 'sleeve' ? 'open' : 'fist';
        if (mode === 'carry') { const c = clampFloor(p.pos.x, p.pos.z - 4, 3); dst = c.setY(this.floorY + 10); dur = 1.15; }
        else if (mode === 'rain') { const c = clampFloor(p.pos.x, p.pos.z - 1, 3); dst = c.setY(this.floorY + 15); dur = 1.1; }
        else if (mode === 'toss') { dst = tmp.set(this.seat.x + h.side * 13, this.floorY + 24, this.seat.z + 2); dur = 0.7; }
        else { dst = tmp.set(this.seat.x + h.side * 11, this.floorY + 23, this.seat.z + 9); dur = 0.8; h.yaw = damp(h.yaw, Math.PI, 6, dt); }
        h.pos.lerp(dst, Math.min(1, dt * 3.5 * s));
        if (t > dur / Math.sqrt(s)) { stage = 2; t = 0; }
      } else if (stage === 2) {
        const held = this.crew.held.filter((x) => x.anchor === anchor).map((x) => x.e);
        if (mode === 'carry') {
          h.pose = 'open';
          const spots = spotsAround(heroSoon(), held.length, 2.6, 4.6, p.pos, 2.4);
          held.forEach((e, i) => this.crew.fling(e, spots[i], 0.55 + i * 0.06, 0.8));
          stage = 3; t = 0;
        } else if (mode === 'toss') {
          h.pos.lerp(tmp.set(this.seat.x + h.side * 6, this.floorY + 17, this.seat.z + 16), Math.min(1, dt * 12));
          h.pose = t > 0.15 ? 'open' : 'fist';
          if (t > 0.15) {
            const spots = spotsAround(heroSoon(), held.length, 3.5, 5.5, p.pos, 3);
            held.forEach((e, i) => this.crew.fling(e, spots[i], 1.0 + i * 0.12, 7));
            stage = 3; t = 0;
          }
        } else {
          // shake them out one by one (jellies from above; books from the sleeve)
          h.pose = 'open';
          h.pos.x += Math.sin(this.t * 38) * 0.12; h.pos.y += Math.cos(this.t * 31) * 0.1;
          const every = mode === 'rain' ? 0.28 : 0.2;
          if (t > 0.25 + sent * every && held.length) {
            const e = held[0];
            const spot = spotsAround(p.pos, 1, mode === 'rain' ? 2.5 : 3.5, mode === 'rain' ? 4.5 : 6, p.pos, 2.4)[0];
            if (mode === 'sleeve') { spot.y = this.floorY + 2.6; this.crew.fling(e, spot, 0.9, 3); }
            else this.crew.fling(e, spot, 0.75, 0.5);
            sent++;
          }
          if (!held.length) { stage = 3; t = 0; }
        }
      } else if (stage === 3) {
        if (t > 0.35 && h.state === 'puppet') h.set('lift');
        return h.state === 'rest' || t > 2.5;
      }
      return false;
    };
  }

  // ───────────────────────── hands ─────────────────────────
  private trackPoint(L: Level3D, h?: BossHand) {
    const p = h ? this.handHero(L, h) : this.fh(L);
    // a short lead: a hero who keeps running gets out from under the palm, one who stops (or camps) doesn't
    return clampFloor(p.pos.x + p.vel.x * 0.18, p.pos.z + p.vel.z * 0.18, 0, tmp).setY(this.floorY);
  }

  private updateHands(L: Level3D, dt: number) {
    const p = L.player;
    const s = this.spd;
    for (const h of this.hands) {
      h.stripe.hide();
      h.t += dt;
      h.glow = damp(h.glow, h.state === 'stuck' ? 1 : 0, 10, dt);
      let teleOn = false;
      h.col.active = false;
      switch (h.state) {
        case 'rest': {
          const r = this.restPos(h);
          h.pos.x = damp(h.pos.x, r.x, 6, dt);
          h.pos.y = damp(h.pos.y, r.y + 0.3 + Math.sin(this.t * 1.5 * s + h.side) * 0.15, 6, dt);
          h.pos.z = damp(h.pos.z, r.z, 6, dt);
          h.pose = 'rest'; h.yaw = damp(h.yaw, 0, 8, dt);
          break;
        }
        case 'rise': {
          const tp = this.trackPoint(L, h);
          h.target.copy(tp);
          h.pos.x = damp(h.pos.x, tp.x, 4 * s, dt); h.pos.z = damp(h.pos.z, tp.z - 1.2, 4 * s, dt);
          h.pos.y = damp(h.pos.y, this.floorY + 12, 7 * s, dt);
          h.pose = 'open'; teleOn = true;
          if (h.t > 0.35 / s) h.set('track');
          break;
        }
        case 'track': {
          const tp = this.trackPoint(L, h);
          const lam = 6 + 2 * (s - 1);
          h.target.x = damp(h.target.x, tp.x, lam, dt); h.target.z = damp(h.target.z, tp.z, lam, dt); h.target.y = this.floorY;
          h.pos.x = damp(h.pos.x, h.target.x, 8 * s, dt); h.pos.z = damp(h.pos.z, h.target.z - 1.2, 8 * s, dt);
          h.pos.y = this.floorY + 12;
          h.pose = 'open'; teleOn = true;
          if (h.t > h.trackT) { h.set('lock'); audio.sfx('warn', { volume: 0.4, pitch: 1.5 }); }
          break;
        }
        case 'lock':
          h.pos.x = damp(h.pos.x, h.target.x, 10, dt); h.pos.z = damp(h.pos.z, h.target.z - 1.2, 10, dt);
          h.pos.y = this.floorY + 12 + Math.sin(h.t * 50) * 0.18;
          h.pose = 'open'; teleOn = true;
          // lock + fall stays ≥ ~0.55 s even in phase 3 (≈ 4 m of running)
          if (h.t > Math.max(0.22, 0.32 / Math.sqrt(s))) { h.set('slam'); h.vy = -14 * Math.sqrt(s); }
          break;
        case 'slam':
          h.vy -= 160 * Math.sqrt(s) * dt;
          h.pos.y += h.vy * dt;
          h.pose = 'flat'; teleOn = !h.harmless;
          if (h.harmless) { h.pos.x = damp(h.pos.x, h.target.x, 10, dt); h.pos.z = damp(h.pos.z, h.target.z - 1.2, 10, dt); }
          else uncaptured(L, () => { if (this.handHits(L, h, 3)) p.hurt(L, this.phase >= 3 ? 2 : 1, h.pos.clone().setY(this.floorY)); });
          if (h.pos.y <= this.floorY) {
            h.pos.y = this.floorY;
            const soft = h.harmless;
            h.set('stuck');
            this.impact(L, h.pos.clone().setZ(h.pos.z + 1.2), soft ? 0.35 : 1);
            if (this.phase >= 2 && !soft) {
              // a beat after impact, so a hero who just ran clear has time to hop
              const at = h.pos.clone().setZ(h.pos.z + 1.2);
              this.later.push({ t: 0.14, fn: () => L.addWave(new Wave3(at, 9 * Math.sqrt(s), 15, 3.5)) });
            }
            this.squeezeOut(L, h);
          }
          break;
        case 'stuck':
          h.pose = h.fist ? 'fist' : 'flat';
          h.col.active = true;
          if (h.t > h.stuckT) { h.set('lift'); this.squeezeOut(L, h); }
          break;
        case 'lift': {
          const r = this.restPos(h);
          h.pos.lerp(tmp.copy(r).setY(r.y + 5), Math.min(1, dt * 3.5 * Math.sqrt(s)));
          h.pose = 'open';
          if (h.t > 0.6 / Math.sqrt(s)) h.set('rest');
          break;
        }
        case 'sweepPrep': {
          h.pos.lerp(h.target, Math.min(1, dt * 4.5 * s));
          h.pose = 'flat';
          h.stripe.show(HALL.x0 - 6, HALL.x1 + 6, h.target.z - 2.9, h.target.z + 5.3, this.floorY, this.t, h.t > h.prepT - 0.3 ? 1 : 0);
          if (h.t > h.prepT) { h.set('sweep'); audio.sfx('whoosh', { pitch: 0.6 }); }
          break;
        }
        case 'sweep': {
          h.pos.x += h.sweepDir * h.speed * dt;
          h.pos.y = this.floorY;
          h.pose = 'flat';
          h.stripe.show(HALL.x0 - 6, HALL.x1 + 6, h.pos.z - 2.9, h.pos.z + 5.3, this.floorY, this.t, 1);
          uncaptured(L, () => {
            if (Math.random() < 0.8) L.fx.dust(h.pos.clone().setZ(h.pos.z + rand(-2, 4)), 2, '#c8b0e0');
            if (this.handHits(L, h, 1.0, 0.75)) {
              if (p.hurt(L, 1, h.pos.clone().addScaledVector(new THREE.Vector3(h.sweepDir, 0, 0), -4))) { p.body.vel.x = h.sweepDir * 14; p.body.vel.y = 9; }
            }
          });
          if ((h.sweepDir > 0 ? h.pos.x > HALL.x1 + 6 : h.pos.x < HALL.x0 - 6)) { h.set('lift'); L.tcam.shake(0.25); audio.sfx('thud'); }
          break;
        }
        case 'clapPrep': {
          h.pos.lerp(h.target, Math.min(1, dt * 5 * s));
          h.pose = 'flat';
          if (h.side < 0) {
            const [a, b] = this.hands;
            h.stripe.show(Math.min(a.target.x, b.target.x) - 3, Math.max(a.target.x, b.target.x) + 3, h.target.z - 3.1, h.target.z + 3.1, this.floorY, this.t, h.t > h.prepT - 0.3 ? 1 : 0);
          }
          if (h.t > h.prepT) h.set('clap');
          break;
        }
        case 'clap':
          h.pos.x += -h.side * h.speed * dt;
          h.pose = 'flat';
          uncaptured(L, () => { if (this.handHits(L, h, 2.4)) p.hurt(L, 1, h.pos.clone()); });
          if (h.t > 1.2) h.set('lift');
          break;
        case 'grabPrep': {
          const k = h.t / h.prepT;
          if (k < 0.7) {
            const tp = this.trackPoint(L, h);
            h.target.x = damp(h.target.x, tp.x, 6 * s, dt); h.target.z = damp(h.target.z, tp.z, 6 * s, dt);
          }
          tmp2.set(h.target.x - h.start.x, 0, h.target.z - h.start.z);
          const len = Math.max(0.01, tmp2.length());
          tmp2.divideScalar(len);
          h.yaw = Math.atan2(tmp2.x, tmp2.z);
          h.end.copy(clampFloor(h.target.x + tmp2.x * 4, h.target.z + tmp2.z * 4, 0.5));
          h.pos.lerp(tmp.copy(h.start).setY(this.floorY + 0.3), Math.min(1, dt * 6 * s));
          h.pose = 'open';
          h.stripe.band(h.start.x, h.start.z, h.end.x, h.end.z, 4.6, this.floorY, this.t, k > 0.7 ? 1 : 0);
          h.tele.show(h.target.x, this.floorY, h.target.z, 2.4, 0.1 + 0.9 * k, k > 0.7, this.t);
          if (h.t > h.prepT) { h.set('grabLunge'); audio.sfx('whoosh', { pitch: 0.8 }); }
          break;
        }
        case 'grabLunge': {
          tmp2.set(h.end.x - h.pos.x, 0, h.end.z - h.pos.z);
          const left = tmp2.length();
          const step = h.speed * dt;
          if (left > 1e-3) h.pos.addScaledVector(tmp2.divideScalar(left), Math.min(step, left));
          h.pos.y = damp(h.pos.y, this.floorY + 0.2, 10, dt);
          h.pose = 'grab';
          h.stripe.band(h.pos.x, h.pos.z, h.end.x, h.end.z, 4.6, this.floorY, this.t, 1);
          if (Math.random() < 0.7) uncaptured(L, () => L.fx.dust(h.pos.clone(), 2, '#c8b0e0'));
          const c = h.fwd(tmp3).multiplyScalar(1.7).add(h.pos);
          const victim = this.grabVictim(L, c);
          if (victim) { if (victim.isLocal) this.catchHero(L, h); else this.catchRemote(L, h, victim as RemoteHero3); break; }
          if (left <= step + 1e-3 || h.t > 1.4) {
            // closes on thin air: the fist thumps the floor and stays there, open to a beating
            h.set('stuck'); h.fist = true; h.stuckT = Math.max(0.9, 1.3 / s);
            h.pos.y = this.floorY;
            this.impact(L, h.fwd(tmp3).multiplyScalar(1.5).add(h.pos), 0.5);
            this.squeezeOut(L, h);
          }
          break;
        }
        case 'hold': {
          const k = clamp(h.t / GRAB_HOLD, 0, 1);
          const mouth = this.rig.mouthAnchor.getWorldPosition(tmp3).add(tmp2.set(0, -3.6, 4.5));
          tmp.lerpVectors(h.start, mouth, ease(k));
          tmp.x += Math.sin(this.t * 40) * 0.12; tmp.y += Math.cos(this.t * 33) * 0.1;
          h.pos.lerp(tmp, Math.min(1, dt * 8));
          h.yaw = damp(h.yaw, 0, 3, dt);
          h.pose = 'fist';
          if (k > 0.6) this.anim.mouth = damp(this.anim.mouth, 1, 8, dt);
          if (Math.floor(h.t / 0.6) !== Math.floor((h.t - dt) / 0.6)) audio.sfx('grab', { volume: 0.4, pitch: 0.9 });
          // attack = whack his fingers: counts double toward breaking free
          if (this.grabber && p.grabbedBy === (this.grabber as unknown as Noodle3) && input.pressed('attack')) {
            p.grip -= 1;
            h.flash = 1;
            L.fx.sparks(this.holdTip(h), 8);
            audio.sfx('hit', { pitch: 1.3, volume: 0.6 });
            if (p.grip <= 0) {
              p.grabbedBy = null;
              p.body.vel.y = 9; p.invuln = 0.8;
              audio.sfx('break');
              L.fx.text(p.center().setY(p.pos.y + 1.4), 'Вырвался!', '#ffe14a', 20);
              this.onGrabRelease(L, h, L.player.grip <= 0);
              break;
            }
          }
          // co-op: the friend in the fist left, or his machine never took hold of him (dead / dashing there) — let go, no chomp
          if (this.grabber && this.mp && this.grabbedWho && this.grabbedWho !== net.myId) {
            const r = L.remote(this.grabbedWho);
            if (!r || r.dead || (h.t > 0.6 && !r.grabbed)) { this.grabber = null; this.grabbedWho = null; }
          }
          if (!this.grabber) { h.set('lift'); break; }
          if (h.t > GRAB_HOLD) this.chomp(L, h);
          break;
        }
        case 'puppet':
          break;
      }
      if (teleOn) {
        const k = h.state === 'rise' ? 0.1 : h.state === 'track' ? 0.1 + 0.6 * clamp(h.t / h.trackT, 0, 1) : 1;
        h.tele.show(h.target.x, this.floorY, h.target.z, 3.6, k, h.state === 'lock' || h.state === 'slam', this.t);
      } else if (h.state !== 'grabPrep') h.tele.hide();
      if (h.col.active) { h.box(h.col.min, h.col.max, 2.1); }
      else { h.col.min.set(0, -100, 0); h.col.max.set(0, -99, 0); }
    }
  }

  /** after a palm lands (or lifts), push the hero out of it so he never ends up inside */
  private squeezeOut(L: Level3D, h: BossHand) {
    const p = L.player;
    if (p.grabbedBy) return;
    h.box(this.bmin, this.bmax, 2.1);
    const pp = p.pos;
    if (pp.x > this.bmin.x - 0.3 && pp.x < this.bmax.x + 0.3 && pp.z > this.bmin.z - 0.3 && pp.z < this.bmax.z + 0.3 && pp.y < this.bmax.y - 0.2) {
      const exits = [pp.x - this.bmin.x + 0.4, this.bmax.x - pp.x + 0.4, pp.z - this.bmin.z + 0.4, this.bmax.z - pp.z + 0.4];
      const i = exits.indexOf(Math.min(...exits));
      if (i === 0) pp.x = this.bmin.x - 0.4; else if (i === 1) pp.x = this.bmax.x + 0.4; else if (i === 2) pp.z = this.bmin.z - 0.4; else pp.z = this.bmax.z + 0.4;
    }
  }

  private handHits(L: Level3D, h: BossHand, height: number, halfK = 1) {
    const p = L.player;
    if (p.dead) return false;
    h.box(this.bmin, this.bmax, height, halfK);
    const r = p.body.r;
    return p.pos.x + r > this.bmin.x && p.pos.x - r < this.bmax.x && p.pos.z + r > this.bmin.z && p.pos.z - r < this.bmax.z && p.pos.y < this.bmax.y && p.pos.y + p.body.h > this.bmin.y;
  }

  private impact(L: Level3D, at: THREE.Vector3, k = 1) {
    L.tcam.shake(0.55 * k);
    audio.sfx(k < 0.6 ? 'slam' : 'bigSlam');
    L.fx.dust(at.clone(), Math.round(22 * k), '#c8b0e0');
    L.fx.chunks(at.clone(), Math.round(14 * k), ['#8a7aa0', '#5a4a6e'], this.floorY, [0.15, 0.3]);
    L.fx.ring(at.clone().setY(this.floorY + 0.1), 6 * k, '#ffffff', 0.4);
  }

  // ───────────────────────── damage ─────────────────────────
  /** stop whatever he is doing (dizzy, phase change, death) without leaving anything half-done */
  private cancelAttack(L: Level3D) {
    this.dropHero(L);
    this.cancel?.(); this.cancel = null;
    this.attackFn = null;
    this.extras.length = 0;
    if (this.crew.held.length) this.crew.scatter(L, this.fh(L).pos);
    for (const h of this.hands) {
      if (h.state !== 'rest' && h.state !== 'lift') h.set('lift');
      h.harmless = false;
      h.tele.hide(); h.stripe.hide();
    }
  }

  private startDizzy(L: Level3D) {
    this.cancelAttack(L);
    this.state = 'dizzy';
    this.lastDizzyT = this.t; this.dizzyDmg = 0; this.faceHit.clear();
    const p = L.nl ? L.targetFor(new THREE.Vector3(this.seat.x, this.floorY, this.seat.z + 24)) : L.player;
    // a bit of extra time if the hero has to run across the hall to reach the face
    const dist = Math.hypot(p.pos.x - this.seat.x, p.pos.z - (this.seat.z + 24)); // his nose lands ≈ z −14
    this.dizzyT = 3.2 + clamp((dist - 8) / 10, 0, 1.5);
    L.hud.showBanner('ОГЛУШЁН!', '#ffe14a');
    this.barkKing(L, choose(['Ой-ой... звёздочки...', 'Моя котлетка...', 'Ыыых...']), 1.8);
    this.hint(L, 'dizzy', 'Король оглушён и упал носом в пол — бей его по носу!');
  }

  private recover(L: Level3D) {
    this.state = 'idle'; this.cd = 0.9 / this.spd; this.faceHit.clear();
    audio.sfx('roar', { volume: this.roarVol() * 0.75, pitch: 1.1 });
    this.barkKing(L, choose(['ЫЫЫ! Ну всё!', 'Голова... кружится... ЗЛЮСЬ!', 'Больше так не делай!']), 1.6);
  }

  /** dizzy face hits share a cap per dizzy window; reaching it wakes him up early */
  private hitFace(L: Level3D, amount: number, at: THREE.Vector3) {
    const amt = Math.min(amount, this.dizzyCap - this.dizzyDmg);
    if (amt <= 0) { L.fx.sparks(at.clone(), 6); return; }
    this.dizzyDmg += amt;
    this.damage(L, amt, at);
    if (this.dizzyDmg >= this.dizzyCap && this.state === 'dizzy') {
      this.dizzyT = Math.min(this.dizzyT, 0.45);
      this.barkKing(L, choose(['ХВАТИТ! Моя очередь!', 'Всё, проснулся!', 'Ай! Довольно!']), 1.4);
    }
  }

  private damage(L: Level3D, amount: number, at: THREE.Vector3) {
    if (this.state === 'dead' || this.state === 'intro') return;
    this.hp = Math.max(0, this.hp - amount);
    this.anim.flash = 1;
    audio.sfx('bossHit');
    L.fx.text(at.clone().setY(at.y + 1.5), String(amount), '#ffe14a', 30);
    L.fx.sparks(at.clone(), 16);
    L.fx.juice(at.clone(), 10, ['#c6a2e4', '#ffffff']);
    const before = this.phase;
    if (this.hp <= 0) { this.die(L); return; }
    if (this.hp <= this.maxHp * 0.25) this.phase = 3;
    else if (this.hp <= this.maxHp * 0.6) this.phase = 2;
    if (this.phase !== before) this.phaseChange(L);
  }

  private phaseChange(L: Level3D) {
    this.cancelAttack(L);
    this.state = 'roar';
    this.summonT = Math.min(this.summonT, 5);
    this.updateSpeed();
    let t = 0, pushed = false;
    audio.sfx('roar', { volume: 1 }); audio.sfx('roar', { volume: 0.7, pitch: 0.7 });
    if (this.phase === 2) audio.playMusic('boss2');
    L.tcam.shake(0.9);
    this.barkKing(L, this.phase === 2 ? (L.nl ? 'ВЫ МЕНЯ РАЗОЗЛИЛИ!!!' : 'ТЫ МЕНЯ РАЗОЗЛИЛ!!!') : 'ВСЁ! Я ГОЛОДЕН И ЗОЛ!!!', 2);
    L.hud.showBanner(this.phase === 2 ? 'КОРОЛЬ В ЯРОСТИ!' : 'ПОСЛЕДНИЙ РЫВОК!', '#ff5a6a');
    this.attackFn = (dt: number) => {
      t += dt;
      this.anim.anger = lerp(this.anim.anger, this.phase === 2 ? 0.75 : 1, Math.min(1, dt * 3));
      this.anim.mouth = damp(this.anim.mouth, 1, 10, dt);
      this.anim.eye = 1;
      if (t < 1.4 && Math.random() < 0.3) L.tcam.shake(0.15);
      const p = L.player; // (co-op: every machine shoves its own hero — see puppet)
      if (t > 0.3 && !pushed) {
        pushed = true;
        L.fx.ring(this.seat.clone().setY(this.floorY + 0.2).add(new THREE.Vector3(0, 0, 14)), 30, '#ffd0e0', 0.6);
        if (!p.dead) { tmp.copy(p.pos).sub(this.root.position).setY(0).normalize(); p.body.vel.set(tmp.x * 14, 8, tmp.z * 14); p.knockT = 0.35; }
      }
      if (t > 2) { this.state = 'idle'; this.cd = 0.6; this.anim.mouth = 0; return true; }
      return false;
    };
  }

  private die(L: Level3D) {
    this.cancelAttack(L);
    this.state = 'dead';
    this.anim.dizzy = 1;
    for (const h of this.hands) { h.set('lift'); h.tele.hide(); h.stripe.hide(); }
    for (const ln of this.lanes) ln.stripe.hide();
    this.lanes.length = 0;
    for (const b of this.balls) b.smashApart(L);
    this.balls.length = 0;
    this.crew.clear();
    this.later.length = 0;
    this.aura.set(this.root.position, 1, 0);
    // (co-op: every machine clears its own copies of the hazards — see clientDie)
    uncaptured(L, () => { for (const s of L.shots) if (s.owner === 'enemy') s.pop(L); });
    for (const f of L.fallers) L.scene.remove(f.obj, f.marker);
    L.fallers.length = 0;
    for (const w of L.waves) L.scene.remove(w.obj);
    L.waves.length = 0;
    for (const e of L.enemies) e.die(L);
    audio.sfx('roar', { pitch: 0.8 });
    L.tcam.shake(1);
    L.hitstop(0.4);
    L.whiteFlash = 0.8;
    save.data.bossBeaten = true;
    // co-op: clients play their side of the knockout; the host's onDefeat starts throne_victory for everyone (L.run)
    if (L.nl) L.nl.entEvent(this, 'dead');
    this.onDefeat?.();
  }

  meleeHit(L: Level3D, c: THREE.Vector3, dir: THREE.Vector3, range: number, half: number, dmg: number, atkId: number, kind: string): boolean {
    if (this.state === 'intro' || this.state === 'dead') return false;
    if (!L.authority) return false;
    // co-op host: the King's reactions to a hit (numbers, roars, banners) are played for everyone
    let hit = false;
    this.cap(L, () => { hit = this.resolveMelee(L, c, dir, range, dmg, this.atkKey(L, atkId)); });
    void half; void kind;
    return hit;
  }

  private resolveMelee(L: Level3D, c: THREE.Vector3, dir: THREE.Vector3, range: number, dmg: number, atkId: number): boolean {
    let hit = false;
    for (const h of this.hands) {
      if (h.state !== 'stuck' || h.hit.has(atkId)) continue;
      h.box(this.bmin, this.bmax, 2.6);
      if (distToBox(c, this.bmin, this.bmax) < range * 0.95) {
        h.hit.add(atkId); h.flash = 1;
        const at = c.clone().addScaledVector(dir, Math.min(range, 1.2));
        this.damage(L, dmg * 2, at);
        hit = true;
        if ((this.state as string) === 'dead') return true;
        if (L.nl) this.clapHit(L, h, this.whoHit(L));
      }
    }
    // co-op (feature 17): a friend whacks the fist that holds somebody else
    if (L.nl && this.grabber) {
      for (const h of this.hands) {
        if (h.state !== 'hold' || h.hit.has(atkId) || this.whoHit(L) === this.grabbedWho) continue;
        if (this.fistCenter(h).distanceTo(c) < range + 2.4) { h.hit.add(atkId); h.flash = 1; this.rescue(L, h, this.whoHit(L)); hit = true; }
      }
    }
    if (this.state === 'dizzy' && !this.faceHit.has(atkId)) {
      const f = this.faceTarget();
      if (f.distanceTo(c) < range + 3.4) {
        this.faceHit.add(atkId);
        this.hitFace(L, dmg * 3, f);
        hit = true;
      }
    }
    for (const b of this.balls) {
      if (b.dead || b.hitIds.has(atkId) || !b.touches(c, range)) continue;
      b.hitIds.add(atkId);
      b.struck(L, c.clone().addScaledVector(dir, Math.min(range, 1.2)));
      hit = true;
    }
    return hit;
  }

  /** feature 18 «Командный хлопок»: two DIFFERENT heroes hit the two stuck palms within 0.6 s → he is knocked dizzy */
  private clapHit(L: Level3D, h: BossHand, who: string) {
    const i = this.hands.indexOf(h), o = this.clapLog[1 - i];
    this.clapLog[i] = { who, t: this.t };
    if (!o || o.who === who || this.t - o.t > 0.6) return;
    if (this.state !== 'idle' && this.state !== 'attack') return;
    this.clapLog = [null, null];
    if (this.t - this.lastDizzyT < DIZZY_LOCK) {
      L.tcam.shake(0.3);
      this.barkKing(L, choose(['Ай-ай! Не так быстро!', 'Хлопайте сколько хотите — не упаду!']), 1.4);
      return;
    }
    const mid = this.hands[0].pos.clone().lerp(this.hands[1].pos, 0.5).setY(this.floorY + 2);
    this.startDizzy(L);
    L.hud.showBanner('КОМАНДНЫЙ ХЛОПОК!', '#7ae8ff');
    this.feedAll(L, `Командный хлопок: ${this.nameOf(o.who)} + ${this.nameOf(who)}!`, '#7ae8ff');
    L.fx.ring(mid, 8, '#7ae8ff', 0.5, false);
    L.fx.stars(mid, 30);
    audio.sfx('bigSlam'); audio.sfx('victory', { volume: 0.4, pitch: 1.4 });
  }

  shotHit(L: Level3D, s: Shot3): boolean {
    if (this.state === 'intro' || this.state === 'dead') return false;
    if (!L.authority) return false;
    let hit = false;
    this.cap(L, () => { hit = this.resolveShot(L, s); });
    return hit;
  }

  private resolveShot(L: Level3D, s: Shot3): boolean {
    const f = this.faceTarget();
    if (s.kind === 'reflected') {
      if (s.pos.distanceTo(f) < 5) {
        this.damage(L, 8, s.pos.clone());
        const st = this.state as string;
        if (st === 'dead' || st === 'roar') return true;
        if (st !== 'dizzy' && this.t - this.lastDizzyT >= DIZZY_LOCK) this.startDizzy(L);
        else if (st !== 'dizzy') {
          // too soon for another knockout: it just stings
          L.tcam.shake(0.3);
          this.barkKing(L, choose(['Ай! Второй раз не сработает!', 'Не-не, я уже учёный!', 'Ой! Ну и что?']), 1.4);
        }
        return true;
      }
      return false;
    }
    for (const b of this.balls) {
      if (b.dead || b.center(tmp).distanceTo(s.pos) > BowlBall.R + s.r + 0.1) continue;
      b.struck(L, s.pos);
      return true;
    }
    for (const h of this.hands) {
      if (h.state !== 'stuck') continue;
      h.box(this.bmin, this.bmax, 2.6);
      if (distToBox(s.pos, this.bmin, this.bmax) < s.r + 0.1) {
        h.flash = 1; this.damage(L, 1, s.pos.clone());
        if (L.nl && (this.state as string) !== 'dead') this.clapHit(L, h, this.whoHit(L, s.shooter));
        return true;
      }
    }
    // co-op: a pea into the fist that holds a friend frees him too
    if (L.nl && this.grabber && this.whoHit(L, s.shooter) !== this.grabbedWho) {
      for (const h of this.hands) if (h.state === 'hold' && this.fistCenter(h).distanceTo(s.pos) < 2.2 + s.r) { h.flash = 1; this.rescue(L, h, this.whoHit(L, s.shooter)); return true; }
    }
    if (s.pos.distanceTo(f) < 4) {
      if (this.state === 'dizzy') this.hitFace(L, 2, s.pos.clone()); else this.damage(L, 1, s.pos.clone());
      return true;
    }
    return false;
  }

  // ───────────────────────── co-op replication ─────────────────────────
  /**
   * host → clients (~12 Hz): [state, phase, hp, maxHp, root x y z rotX, anim ×10, flash, talk, grabHand,
   *   hand ×2 (pos, vel, yaw, state, pose, glow, flash, flags, sweepDir, lunge end x/z, tele…, stripe…), lanes (n, n×4), balls (m, m×6)]
   */
  netSnap(): number[] {
    const a = this.anim, r = this.root;
    const out: number[] = [
      STATES.indexOf(this.state), this.phase, this.hp, this.maxHp,
      r.position.x, r.position.y, r.position.z, r.rotation.x,
      a.eye, a.mouth, a.anger, a.look.x, a.look.y, a.dizzy, a.chew, a.slump, a.stand, a.spin ?? 0,
      a.flash > 0.5 ? 1 : 0, this.talk > 0 ? 1 : 0,
      this.grabber ? this.hands.findIndex((h) => h.state === 'hold') : -1,
    ];
    for (const h of this.hands) {
      // velocity of the fast, straight moves (clients glide the palm between snapshots)
      const v = tmp.set(0, 0, 0);
      if (h.state === 'sweep') v.x = h.sweepDir * h.speed;
      else if (h.state === 'clap') v.x = -h.side * h.speed;
      else if (h.state === 'grabLunge') { v.set(h.end.x - h.pos.x, 0, h.end.z - h.pos.z); const l = v.length(); if (l > 0.3) v.multiplyScalar(h.speed / l); else v.set(0, 0, 0); }
      out.push(h.pos.x, h.pos.y, h.pos.z, v.x, v.y, v.z, h.yaw, HSTS.indexOf(h.state), POSES.indexOf(h.pose), h.glow,
        h.flash > 0.5 ? 1 : 0, (h.harmless ? 1 : 0) | (h.fist ? 2 : 0), h.sweepDir, h.end.x, h.end.z);
      h.tele.netSnap(out);
      h.stripe.netSnap(out);
    }
    out.push(this.lanes.length);
    for (const ln of this.lanes) out.push(ln.x, ln.t, ln.tele, ln.ball && !ln.ball.dead ? ln.ball.id : -1);
    const balls = this.balls.filter((b) => !b.dead);
    out.push(balls.length);
    for (const b of balls) out.push(b.id, b.pos.x, b.pos.z, b.v, b.hp, b.speed);
    return out;
  }

  /** client: a snapshot taken at host time t — parsed, and played back at NetLevel.playT (puppet) */
  netApply(a: number[], t?: number) {
    if (t === undefined) return;
    let i = 0;
    const st = STATES[a[i++]] ?? 'idle';
    const ph = a[i++], hp = a[i++], maxHp = a[i++];
    const rx = a[i++], ry = a[i++], rz = a[i++], rotX = a[i++];
    const anim = a.slice(i, i + 10);
    i += 10;
    const flash = !!a[i++], talk = !!a[i++], grabHand = a[i++];
    const hands: HandRec[] = [];
    for (const h of this.hands) {
      // (the host sends a velocity only for the fast straight moves: sweep, clap, lunge; a lift starts at ~130 m/s)
      const mv = a[i + 3] !== 0 || a[i + 4] !== 0 || a[i + 5] !== 0;
      (h.track ??= new NetTrack<null>(250, 12)).push(t, a[i], a[i + 1], a[i + 2], a[i + 6], null, 0,
        mv ? a[i + 3] : undefined, mv ? a[i + 4] : undefined, mv ? a[i + 5] : undefined);
      const fl = a[i + 11];
      hands.push({ st: HSTS[a[i + 7]] ?? 'rest', pose: POSES[a[i + 8]] ?? 'rest', glow: a[i + 9], flash: !!a[i + 10],
        harmless: !!(fl & 1), fist: !!(fl & 2), sweepDir: a[i + 12] < 0 ? -1 : 1, ex: a[i + 13], ez: a[i + 14], vx: a[i + 3], vz: a[i + 5] });
      i += 15;
      i = h.tele.netApply(a, i, t);
      i = h.stripe.netApply(a, i, t);
    }
    const nl = a[i++] || 0;
    const lanes: ThroneRec['lanes'] = [];
    for (let k = 0; k < nl; k++, i += 4) lanes.push({ x: a[i], t: a[i + 1], tele: a[i + 2], ball: a[i + 3] });
    const nb = a[i++] || 0;
    const balls: number[][] = [];
    for (let k = 0; k < nb; k++, i += 6) balls.push(a.slice(i, i + 6));
    (this.track ??= new NetTrack<ThroneRec>(60)).push(t, rx, ry, rz, rotX, { st, ph, hp, maxHp, anim, flash, talk, grabHand, hands, lanes, balls });
  }

  /** client: a snapshot's discrete fields, as the playback passes it */
  private netFields(r: ThroneRec) {
    this.hp = r.hp; this.maxHp = r.maxHp;
    if (r.flash) this.anim.flash = 1;
    if (r.talk) this.talk = Math.max(this.talk, 0.25);
    this.grabHand = r.grabHand;
    this.hands.forEach((h, k) => this.handFields(h, r.hands[k]));
    this.netLanes = r.lanes;
    this.netBalls = r.balls;
    if (r.st === 'dead' && this.state !== 'dead') this.netDied = true;
    if (r.ph > this.phase && this.got) {
      if (r.ph === 2) audio.playMusic('boss2');
      this.pushT = 0.3;
    }
    this.phase = r.ph;
    this.state = r.st;
    this.got = true;
  }

  private handFields(h: BossHand, r: HandRec) {
    h.netPose = r.pose;
    if (r.flash) h.flash = 1;
    h.sweepDir = r.sweepDir;
    h.end.set(r.ex, this.floorY, r.ez);
    h.runV.set(r.vx, 0, r.vz);
    if (r.st !== h.state) {
      const from = h.state;
      h.state = r.st; h.t = 0;
      if (r.st === 'slam') {
        // the palm comes down: fall locally (smooth, and my hero is tested against what I see)
        if (!h.falling) { h.falling = true; h.vy = r.harmless ? 0 : -14 * Math.sqrt(this.spd); }
      } else if (r.st === 'stuck') {
        if (!h.falling && h.pos.y > this.floorY + 0.5 && (from === 'lock' || from === 'track' || from === 'rise')) { h.falling = true; h.vy = -14 * Math.sqrt(this.spd); }
        h.squeeze = true;
      } else h.falling = false;
      if (from === 'stuck') h.squeeze = true;
    }
    h.harmless = r.harmless; h.fist = r.fist;
  }

  /** one-off events from the host (clients) */
  netEvent(L: Level3D, ev: string, d: { who?: string; g?: number; i?: number; id?: number; o?: number[]; to?: number[]; d?: number; h?: number; t?: string; c?: string }) {
    if (L.authority) return;
    if (ev === 'feed') { if (d.t) L.feed(d.t, d.c); return; }
    if (ev === 'grab') {
      if (d.i !== undefined) this.grabHand = d.i;
      const p = L.player;
      // (the host's GM.grab normally lands first; if not, take hold of my hero from here)
      if (d.who === net.myId && !p.grabbedBy && !p.dead) L.netGrab({ by: this.netId });
      if (d.who === net.myId && p.grabbedBy) {
        // the King's grip: as many presses as solo, no damage ticks while he carries me to his mouth
        p.grip = d.g ?? 8; p.grabDmgT = 99;
        this.heldMe = true;
        this.hint(L, 'held', 'Тебя схватили! Жми кнопки — особенно удар по пальцам, — чтобы вырваться!');
      }
    } else if (ev === 'dead') this.netDied = true;
    else if (ev === 'cgrab') {
      const e = L.nl?.get(d.id ?? -1) as unknown as Enemy3 | undefined;
      const h = this.hands[d.i ?? 1] ?? this.hands[1];
      if (e && !e.dead && d.o) this.crew.hold(e, () => h.pos, new THREE.Vector3(d.o[0], d.o[1], d.o[2]));
    } else if (ev === 'cfling') {
      const e = L.nl?.get(d.id ?? -1) as unknown as Enemy3 | undefined;
      if (e && !e.dead && d.to) this.crew.fling(e, new THREE.Vector3(d.to[0], d.to[1], d.to[2]), d.d ?? 0.8, d.h ?? 1, true);
    }
  }

  /** co-op client: everything the host's King shows, plus this machine's own hazards and hero tests */
  private puppet(L: Level3D, dt: number) {
    this.t += dt;
    this.talk = Math.max(0, this.talk - dt * 3);
    const a = this.anim;
    a.flash = Math.max(0, a.flash - dt * 5);
    for (const h of this.hands) h.flash = Math.max(0, h.flash - dt * 5);
    const tr = this.track, play = L.nl?.playT ?? -Infinity;
    if (tr && tr.eval(play, dt, rootPose)) {
      tr.passed(play, (r) => this.netFields(r));
      const c = tr.cur!, n = tr.next, u = tr.u;
      const mix = (x: number, y: number | undefined) => (y === undefined ? x : x + (y - x) * u);
      this.hands.forEach((h, k) => { h.netGlow = mix(c.hands[k].glow, n?.hands[k].glow); h.netNext = (n ?? c).hands[k].st; });
      if (!this.manualRoot) {
        // (cutscenes pose him themselves on every machine)
        this.root.position.copy(rootPose.pos);
        this.root.rotation.x = rootPose.yaw;
        const an = this.anim, f = (k: number) => mix(c.anim[k], n?.anim[k]);
        an.eye = f(0); an.mouth = f(1); an.anger = f(2); an.look.x = f(3); an.look.y = f(4);
        an.dizzy = f(5); an.chew = f(6); an.slump = f(7); an.stand = f(8); an.spin = f(9);
      }
    }
    L.hud.bossHp = this.hp; L.hud.bossMax = this.state === 'intro' || this.state === 'dead' ? 0 : this.maxHp; L.hud.bossName = this.name;
    this.updateSpeed();
    if (this.netDied && !this.diedLocal) this.clientDie(L);
    const live = this.state !== 'dead' && this.state !== 'intro';
    const bRate = [1.7, 2.7, 3.9][this.phase - 1] * (1 + 0.15 * this.prog);
    this.breath += dt * (this.state === 'dead' ? 1 : bRate);
    // the phase-change roar shoves my hero away (the host shoves his own)
    if (this.pushT > 0) {
      this.pushT -= dt;
      const p = L.player;
      if (this.pushT <= 0 && !p.dead && !p.grabbedBy) { tmp.copy(p.pos).sub(this.root.position).setY(0).normalize(); p.body.vel.set(tmp.x * 14, 8, tmp.z * 14); p.knockT = 0.35; }
    }
    this.rageFx(L, dt, live);
    if (!this.freezeHands) this.puppetHands(L, dt);
    this.heldWhack(L);
    this.crew.update(L, dt);
    this.puppetBowling(L, dt);
    this.syncRig(dt);
  }

  private puppetHands(L: Level3D, dt: number) {
    const p = L.player;
    const s = this.spd;
    const play = L.nl?.playT ?? -Infinity, pdt = L.nl?.playDt ?? dt;
    for (const h of this.hands) {
      h.t += dt;
      h.col.active = false;
      const host = !!h.track && h.track.eval(play, dt, handPose);
      if (host) h.yaw = handPose.yaw;
      h.glow = h.netGlow;
      h.pose = h.netPose;
      let follow = false;
      if (h.falling) {
        // (on the playback's clock: the fall lands when the host's did in the played-back snapshots)
        h.vy -= 160 * Math.sqrt(s) * pdt;
        h.pos.y += h.vy * pdt;
        if (host) { h.pos.x = damp(h.pos.x, handPose.pos.x, 10, dt); h.pos.z = damp(h.pos.z, handPose.pos.z, 10, dt); }
        h.pose = 'flat';
        if (!h.harmless) uncaptured(L, () => { if (this.handHits(L, h, 3)) p.hurt(L, this.phase >= 3 ? 2 : 1, h.pos.clone().setY(this.floorY)); });
        if (h.pos.y <= this.floorY) { h.pos.y = this.floorY; h.falling = false; }
      } else if (h.state === 'rest' && h.netNext === 'rest') {
        // resting on his belly: follow MY copy of his body (cutscenes move it locally)
        const r = this.restPos(h);
        h.pos.x = damp(h.pos.x, r.x, 6, dt);
        h.pos.y = damp(h.pos.y, r.y + 0.3 + Math.sin(this.t * 1.5 * s + h.side) * 0.15, 6, dt);
        h.pos.z = damp(h.pos.z, r.z, 6, dt);
      } else if ((h.state === 'slam' || h.state === 'stuck') && !h.following) {
        // my own fall hit the floor: the palm stays there until the host lifts it
      } else if ((h.state === 'sweep' || h.state === 'clap' || h.state === 'grabLunge') && h.runV.lengthSq() > 0) {
        // a straight run at the host's speed: my copy runs it on the playback's clock (a lost snapshot can't cut a
        // sweep short), from where the palm was when the playback reached its start
        h.pos.x += h.runV.x * pdt; h.pos.z += h.runV.z * pdt;
        if (h.state === 'sweep') { h.pos.y = this.floorY; h.pos.x = clamp(h.pos.x, HALL.x0 - 6.5, HALL.x1 + 6.5); }
        else if (h.state === 'grabLunge') h.pos.y = damp(h.pos.y, this.floorY + 0.2, 10, dt);
      } else if (host) {
        // where the host's palm was at the playback time (coming back from my own copy: the difference fades)
        if (!h.following) { if (h.got) h.off.copy(h.pos).sub(handPose.pos); else h.off.set(0, 0, 0); }
        h.off.multiplyScalar(Math.exp(-dt / 0.12));
        h.pos.copy(handPose.pos).add(h.off);
        if (h.pos.y < this.floorY) h.pos.y = this.floorY;
        // (the locked palm's shiver is faster than the snapshots: my copy shivers by itself, like the host's)
        if (h.state === 'lock') h.pos.y = this.floorY + 12 + Math.sin(h.t * 50) * 0.18;
        follow = true;
      }
      h.following = follow;
      if (host) h.got = true;
      // a lunging fist stops at the end of its band (also when the playback has to guess past the newest snapshot)
      if (h.state === 'grabLunge' && h.fwd(tmp).dot(tmp2.set(h.end.x - h.pos.x, 0, h.end.z - h.pos.z)) < 0) { h.pos.x = h.end.x; h.pos.z = h.end.z; }
    }
    // the palms of a clap meet (the host stops them there): never through each other
    const [ha, hb] = this.hands;
    if (ha.state === 'clap' && hb.state === 'clap' && hb.pos.x - ha.pos.x < 10.8) { const m = (ha.pos.x + hb.pos.x) / 2; ha.pos.x = m - 5.4; hb.pos.x = m + 5.4; }
    for (const h of this.hands) {
      // victim side: only MY hero is tested, against the palm I see
      if (h.state === 'sweep') {
        if (Math.random() < 0.8) L.fx.dust(h.pos.clone().setZ(h.pos.z + rand(-2, 4)), 2, '#c8b0e0');
        if (this.handHits(L, h, 1.0, 0.75)) {
          if (p.hurt(L, 1, h.pos.clone().addScaledVector(new THREE.Vector3(h.sweepDir, 0, 0), -4))) { p.body.vel.x = h.sweepDir * 14; p.body.vel.y = 9; }
        }
      } else if (h.state === 'clap') {
        if (this.handHits(L, h, 2.4)) p.hurt(L, 1, h.pos.clone());
      } else if (h.state === 'grabLunge') {
        if (Math.random() < 0.7) L.fx.dust(h.pos.clone(), 2, '#c8b0e0');
      } else if (h.state === 'stuck' && !h.falling) h.col.active = true;
      if (h.squeeze && !h.falling) { h.squeeze = false; this.squeezeOut(L, h); }
      h.tele.netUpdate(dt, this.t, play);
      h.stripe.netUpdate(dt, this.t, play);
      if (h.col.active) { h.box(h.col.min, h.col.max, 2.1); }
      else { h.col.min.set(0, -100, 0); h.col.max.set(0, -99, 0); }
    }
  }

  /** client: I am in his fist — attack whacks his fingers (counts double, like solo) */
  private heldWhack(L: Level3D) {
    if (!this.heldMe) return;
    const p = L.player;
    if (!p.grabbedBy) { this.heldMe = false; return; }
    if (!input.pressed('attack')) return;
    const h = this.hands.find((x) => x.state === 'hold') ?? this.hands[this.grabHand];
    p.grip -= 1;
    if (h) h.flash = 1;
    L.fx.sparks(this.grabTip(), 8);
    audio.sfx('hit', { pitch: 1.3, volume: 0.6 });
    if (p.grip <= 0) {
      const g = p.grabbedBy as unknown as Grabber;
      p.grabbedBy = null;
      g.release();
      p.body.vel.y = 9; p.invuln = 0.8;
      audio.sfx('break');
      L.fx.text(p.center().setY(p.pos.y + 1.4), 'Вырвался!', '#ffe14a', 20);
      this.heldMe = false;
    }
  }

  /** client: lanes from the snapshot; each machine rolls its own copy of every meatball (on the playback's clock) */
  private puppetBowling(L: Level3D, dt: number) {
    const pdt = L.nl?.playDt ?? dt;
    const recs = this.netBalls;
    if (recs) {
      this.netBalls = null;
      const ids = new Set<number>();
      for (const r of recs) {
        const [id, x, z, v, hp, speed] = r;
        ids.add(id);
        if (this.deadBalls.has(id)) continue;
        let b = this.balls.find((q) => q.id === id);
        if (!b) {
          b = new BowlBall(L, x, z, speed, this.floorY);
          b.id = id; b.v = v; b.hp = hp;
          this.balls.push(b);
          continue;
        }
        // the host's hits (each one slows it down; the 3rd smashes it — no extra crumbs here, the host drops them)
        while (b.hp > hp && !b.dead) b.struck(L, b.center(), false);
        if (b.dead) continue;
        if (Math.abs(z - b.pos.z) > 1.5) b.pos.z = lerp(b.pos.z, z, 0.5);
        b.v = v;
      }
      for (const b of this.balls) if (!b.dead && !ids.has(b.id)) b.smashApart(L);
    }
    for (const b of this.balls) b.update(L, pdt);
    for (const b of this.balls) if (b.dead) this.deadBalls.add(b.id);
    this.balls = this.balls.filter((b) => !b.dead);
    this.netLanes.forEach((ln, i) => {
      let st = this.laneStripes[i];
      if (!st) { st = new Stripe(); L.scene.add(st.mesh); this.laneStripes.push(st); }
      if (ln.ball >= 0) {
        const b = this.balls.find((q) => q.id === ln.ball);
        if (b) st.show(ln.x - 1.7, ln.x + 1.7, b.pos.z - BowlBall.R, HALL.z1 + 1, this.floorY, this.t, 1); else st.hide();
      } else {
        ln.t -= pdt;
        if (ln.t > ln.tele) st.hide();
        else st.show(ln.x - 1.7, ln.x + 1.7, -20.2, HALL.z1 + 1, this.floorY, this.t, ln.t < 0.3 ? 1 : 0);
      }
    });
    for (let i = this.netLanes.length; i < this.laneStripes.length; i++) this.laneStripes[i].hide();
  }

  /** the host left and this machine runs the fight now: settle the puppet into a state the real fight can go on from */
  private takeOver(L: Level3D) {
    this.wasPuppet = false;
    this.track = null;
    if (this.state === 'attack' || this.state === 'roar') { this.state = 'idle'; this.cd = 1; }
    this.attackFn = null; this.cancel = null; this.extras.length = 0;
    const p = L.player;
    if (this.heldMe && p.grabbedBy) { p.grabbedBy = null; p.body.vel.y = 8; p.invuln = 1; }
    this.heldMe = false; this.grabHand = -1; this.grabber = null; this.grabbedWho = null;
    for (const h of this.hands) {
      h.falling = false; h.squeeze = false; h.track = null; h.following = false;
      if (h.state !== 'rest') h.set('lift');
      h.tele.hide(); h.stripe.hide();
    }
    for (const st of this.laneStripes) st.hide();
    this.netLanes = []; this.netBalls = null;
    for (const b of this.balls) b.id = b.id || ++this.ballSeq;
    this.ballSeq = Math.max(this.ballSeq, ...this.balls.map((b) => b.id));
    if (this.crew.held.length) this.crew.scatter(L, this.fh(L).pos);
  }

  /** client: the knockout on my machine (the host's onDefeat starts throne_victory for everyone) */
  private clientDie(L: Level3D) {
    this.diedLocal = true;
    this.anim.dizzy = 1;
    for (const h of this.hands) {
      h.tele.hide(); h.stripe.hide(); h.falling = false; h.col.active = false;
      h.col.min.set(0, -100, 0); h.col.max.set(0, -99, 0);
    }
    for (const st of this.laneStripes) st.hide();
    this.netLanes = [];
    for (const b of this.balls) { b.smashApart(L); this.deadBalls.add(b.id); }
    this.balls.length = 0;
    this.netBalls = null;
    this.crew.clear();
    this.aura.set(this.root.position, 1, 0);
    for (const s of L.shots) if (s.owner === 'enemy') s.pop(L);
    for (const f of L.fallers) L.scene.remove(f.obj, f.marker);
    L.fallers.length = 0;
    for (const w of L.waves) L.scene.remove(w.obj);
    L.waves.length = 0;
    L.hitstop(0.4);
    L.whiteFlash = 0.8;
    save.data.bossBeaten = true;
  }
}

