import * as THREE from 'three';
import { audio } from '../../engine/audio';
import { approach, choose, clamp, damp, lerp, rand } from '../../engine/util';
import { all } from '../../game/coroutine';
import type { Script } from '../../game/coroutine';
import { createKing } from '../models';
import type { KingRig, KingAnim } from '../models';
import { noOutline } from '../gfx';
import { makeBlob } from '../fx';
import type { Collider } from '../physics/types';
import type { Level3D, HeroLike } from './level';
import { Faller3 } from './objects';
import { net } from '../../net/session';
import { coop } from './coop';
import type { Netted } from './netLevel';
import { NetTrack, type NetPose } from './netInterp';
import type { RemoteHero3 } from './remoteHero';
import { ChaseGate, CHASE_GATE } from './chase';

type HandSt = 'rest' | 'rise' | 'track' | 'slam' | 'stuck' | 'lift' | 'sweepPrep' | 'sweep' | 'clap' | 'hold';

class Hand3 {
  pos: THREE.Vector3;
  rest: THREE.Vector3;
  state: HandSt = 'rest';
  t = 0; vy = 0; glow = 0; flash = 0;
  pose: KingAnim['hands'][number]['pose'] = 'rest';
  hit = new Set<number>();
  target = new THREE.Vector3();
  sweepDir = new THREE.Vector3();
  trackT = 0.9;
  marker: THREE.Mesh;
  constructor(public side: -1 | 1, rest: THREE.Vector3) {
    this.rest = rest.clone(); this.pos = rest.clone();
    this.marker = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: '#300010', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    this.marker.rotation.x = -Math.PI / 2;
    noOutline(this.marker);
  }
  set(st: HandSt) { this.state = st; this.t = 0; this.hit.clear(); }
}

const HAND_R = 2.7;
const tmp = new THREE.Vector3();
const netPose: NetPose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };

// ═══════════════════════════════ CHASER (chapter 4) ═══════════════════════════════
export interface Smashable { x: number; objs: THREE.Object3D[]; cols: Collider[]; colors: string[]; done: boolean }

/** hand states on the wire (index) */
const HAND_ST: HandSt[] = ['rest', 'rise', 'track', 'slam', 'stuck', 'lift', 'sweepPrep', 'sweep', 'clap', 'hold'];
/** co-op: reserved net id of the chase King (built by the chase special hook, after the level build) */
export const CHASER_NET_ID = 911;
/** co-op: a runner this far behind the next one gets tossed forward to the group */
const STRAGGLE = 22;
/** his front line stops this far before the finish gate's bars (his head and fingers reach ~7.5 m past `front`) */
const GATE_STOP = 9.6;
/** near the gate he keeps at least this far behind the rearmost runner (so he never ends up inside a hero) */
const GATE_HOLD = 8.6;
/** a runner this far past the bars is through */
const GATE_PAST = 2.2;

const isGrabbed = (h: HeroLike) => !!((h as { grabbedBy?: unknown }).grabbedBy || (h as { grabbed?: boolean }).grabbed);
/** a friend whose state stream is alive (a silent one stands where he was last seen — never hunt or toss a ghost) */
const isFresh = (h: HeroLike) => {
  if (h.isLocal) return true;
  const r = h as unknown as { t?: number; lastSeen?: number };
  return typeof r.t !== 'number' || typeof r.lastSeen !== 'number' || (r.lastSeen > 0 && r.t - r.lastSeen < 1.5);
};

/**
 * The King lumbers along +X after the hero down the gallery lane (centred on laneZ).
 * `front` = x of his reaching hand line; touching it hurts and flings the hero forward.
 * Adapts to the hero: speeds up when the hero is stuck (noodles), backs off when the hero is thrown back
 * by a hazard, throws walnuts ahead when the hero gets away, and smashes props he walks through.
 *
 * Co-op: the host runs him against the whole team (he hunts the LAST runner, slams someone at the back, rains
 * walnuts ahead of the leaders and tosses a straggler forward to the group); clients play his snapshots back at
 * NetLevel.playT (netInterp.ts): the front line, the slam palm, his clock (steps, rake), the smashed props, the
 * gate and the crash all show where and when they happened on the host; a jump back (caught, backing off) steps.
 * Touching the front line and the slam palm are tested victim-side (each machine, its own hero, against what it shows).
 *
 * The finish: a portcullis (ChaseGate) hangs over the end of the gallery. He never reaches it while it is up, and
 * near it he keeps GATE_HOLD behind the rearmost runner. Once every runner is through (the host decides), it slams
 * down; he charges, crashes into the bars (dazed), then rattles them and yells — never inside a hero, on any machine.
 */
export class KingChaser3 implements Netted {
  netId = 0;
  /** the gate comes down on clients when the playback reaches it (the King charges at it right behind) */
  netTimed = ['gate'];
  rig: KingRig;
  root = new THREE.Group();
  anim: KingAnim;
  front: number;
  speed = 0;
  active = false;
  t = 0; talk = 0;
  grabT = 0;
  slamCD = 4.5; nutCD = 8; tauntT = 7;
  slam: Hand3;
  reach: Hand3;
  floorY: number;
  smash: Smashable[] = [];
  shadow: THREE.Mesh;
  private lastPX: number | null = null;
  private step = 0;
  /** reach hand's sideways lean toward the hunted hero (z offset) */
  private rz = 0;
  // ── co-op host ──
  private heroX = new Map<HeroLike, number>();
  private tossCD = new Map<HeroLike, number>();
  private slamPrey: HeroLike | null = null;
  private caughtCD = 0;
  private wasActive = false;
  /** host: teleport counter for the snapshots (his front line jumped back) and the front line last sent */
  private tpN = 0;
  private snapFront = NaN;
  // ── co-op client ──
  /** the host's snapshots played back: the front line (x) carries the whole record */
  private track: NetTrack<number[]> | null = null;
  /** the host's slam state last handed out by the playback */
  private netSt: HandSt = 'rest';
  /** the running bob, eased (the host's pops in when he wakes up) */
  private bobK = 0;
  // ── the finish ──
  /** the portcullis at the end of the gallery */
  gate: ChaseGate;
  /** 0 chasing, 1 crashed into the shut gate (dazed), 2 rattling its bars; finT = seconds in that state */
  fin = 0; finT = 0;
  private finBark = 0;
  constructor(L: Level3D, front: number, floorY: number, public laneZ = 0) {
    this.floorY = floorY;
    this.front = front;
    this.rig = createKing();
    this.root.add(this.rig.root);
    this.root.rotation.y = Math.PI / 2;
    L.scene.add(this.root);
    this.reach = new Hand3(1, new THREE.Vector3(front, floorY, laneZ));
    this.slam = new Hand3(-1, new THREE.Vector3(front - 20, floorY, laneZ));
    L.scene.add(this.slam.marker);
    this.shadow = makeBlob(1);
    this.shadow.scale.set(13, 1, 9);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.55;
    L.scene.add(this.shadow);
    this.gate = new ChaseGate(L, CHASE_GATE.x, floorY);
    this.anim = {
      eye: 1, mouth: 0.3, anger: 0.9, look: { x: 0, y: -0.3 }, dizzy: 0, chew: 0, slump: 0, stand: 1, flash: 0, talk: 0,
      hands: [
        { pos: new THREE.Vector3(), pose: 'rest', glow: 0, flash: 0 },
        { pos: new THREE.Vector3(), pose: 'rest', glow: 0, flash: 0 },
      ],
    };
    this.placeBody();
    this.restHands();
    this.sync(0);
    L.nl?.add(this, CHASER_NET_ID);
  }

  get netRoot() { return this.root; }

  /** bobK: how much of the running bob (host / solo: on while he chases; a client eases it in and out) */
  private placeBody(bobK = this.active && this.fin === 0 ? 1 : 0) {
    const bob = bobK * Math.abs(Math.sin(this.t * 3.2)) * 0.8;
    this.root.position.set(this.front - 11, this.floorY + bob, this.laneZ);
    this.shadow.position.set(this.front - 6, this.floorY + 0.06, this.laneZ);
  }

  restHands() {
    this.root.updateMatrixWorld();
    this.reach.pos.copy(this.root.localToWorld(new THREE.Vector3(-6.5, 16, 10)));
    this.slam.pos.copy(this.root.localToWorld(new THREE.Vector3(6.5, 16, 10)));
    this.reach.pose = 'fist'; this.slam.pose = 'fist';
  }

  /** hero got thrown back (hazard) or respawned: the King stumbles back so it stays fair */
  backOff(px: number, gap = 16) {
    if (this.front > px - gap) { this.front = px - gap; this.speed = Math.min(this.speed, 5); }
  }

  /** co-op host: effects that only make sense on this machine (my hero's hurt, my camera) are not sent to friends */
  private local<T>(L: Level3D, f: () => T): T {
    const nl = L.nl;
    if (!nl || !nl.capturing) return f();
    nl.capturing = false;
    try { return f(); } finally { nl.capturing = true; }
  }

  /** how close the King is to this hero (0 far … 1 on his heels) */
  private dangerFor(h: HeroLike) { return clamp(1 - (h.pos.x - this.front - 3) / 16, 0, 1); }

  update(L: Level3D, dt: number) {
    this.gate.update(L, dt);
    if (!L.authority) { this.puppet(L, dt); return; }
    this.t += dt;
    this.talk = Math.max(0, this.talk - dt * 3);
    const a = this.anim;
    const mp = !!L.nl;
    // co-op: the runners from the last to the first; the King hunts the last one still in front of him
    const run = mp ? L.alivePlayers().filter(isFresh).sort((x, y) => x.pos.x - y.pos.x) : [];
    const p: HeroLike = mp ? (run.find((h) => h.pos.x >= this.front - 4) ?? run[0] ?? L.player) : L.player;
    const out = mp ? p.dead || p.downed || p.hidden : p.dead;
    a.eye = damp(a.eye, 1, 4, dt);
    a.anger = damp(a.anger, 0.9, 1, dt);
    a.stand = damp(a.stand, 1, 2, dt);
    if (!this.fin) a.slump = damp(a.slump, this.active ? 0.62 : 0.1, 2, dt);
    a.mouth = damp(a.mouth, this.talk > 0 ? Math.abs(Math.sin(this.t * 14)) * 0.6 : 0.3 + Math.sin(this.t * 3) * 0.15, 8, dt);
    tmp.copy(p.pos).sub(this.root.position);
    a.look.x = damp(a.look.x, clamp(tmp.z / 10, -1, 1), 4, dt);
    if (!this.active) { this.lastPX = null; this.heroX.clear(); this.wasActive = false; this.placeBody(); this.restHands(); this.sync(dt); return; }
    // co-op: he wakes up with a head start for the last runner (solo: the intro script did it for the hero)
    if (mp && !this.wasActive && run.length) this.front = Math.min(this.front, p.pos.x - 16);
    this.wasActive = true;

    // the finish: everyone is through → the gate comes down; from then on he only charges, crashes and rattles it
    if (this.gateCheck(L, mp ? run : L.player.dead ? [] : [L.player])) {
      this.finale(L, dt, mp ? run : []);
      if (mp) this.tossStragglers(L, run, dt);
      this.placeBody();
      this.slamMarker(false);
      this.sync(dt);
      return;
    }

    // the hero was thrown back by a hazard → back off instead of punishing twice
    if (!mp) {
      if (this.lastPX !== null && p.pos.x < this.lastPX - 2.5) this.backOff(p.pos.x, 15);
      this.lastPX = p.pos.x;
    } else this.teamBackOff(L, run);

    const gap = p.pos.x - this.front;
    // a touch faster than the runner's cruise speed: you have to sprint (W) and never stumble
    let target = out ? 1 : clamp((coop.easy ? 7.6 : 8.9) + (gap - 10) * 0.5, 7.0, 18);
    if (mp ? isGrabbed(p) : L.player.grabbedBy) target += 5; // stuck in noodles: here he comes!
    this.speed = approach(this.speed, target, 12 * dt);
    const was = this.front;
    this.front += this.speed * dt;
    // the gate is still up: he never reaches its arch, and near it he never runs into the rearmost runner
    const lim = this.gateLimit(p);
    if (this.front > lim) { this.front = Math.max(was, lim); this.speed = dt > 0 ? (this.front - was) / dt : 0; }
    this.placeBody();
    const danger = clamp(1 - (gap - 3) / 16, 0, 1);
    // footsteps and the rake's thump are felt by each hero by how close the King is to *him*
    const myDanger = mp ? this.dangerFor(L.player) : danger;

    // thundering footsteps
    this.footsteps(L, myDanger);

    // props he walks through get smashed
    for (const s of this.smash) {
      if (s.done || this.front < s.x - 1) continue;
      s.done = true;
      for (const o of s.objs) o.visible = false;
      for (const c of s.cols) c.active = false;
      const at = new THREE.Vector3(s.x, this.floorY + 1, this.laneZ);
      for (const o of s.objs) { o.getWorldPosition(at); break; }
      L.fx.chunks(at.clone().setY(this.floorY + 1), 16, s.colors, this.floorY, [0.15, 0.4]);
      L.fx.dust(at.clone(), 10, '#c8b8d8');
      audio.sfx('break', { volume: 0.7, pitch: 0.7 });
    }

    // reaching hand rakes the floor at the front line
    const lean = clamp(p.pos.z - this.laneZ, -4, 4) * 0.5;
    this.rz = mp ? damp(this.rz, lean, 6, dt) : lean;
    this.rake(L, dt, myDanger);

    // targeted slams ahead of the hero
    const s = this.slam;
    s.t += dt;
    let markerOn = false;
    switch (s.state) {
      case 'rest': case 'lift':
        this.slamRest(dt);
        if (gap < 18) this.slamCD -= dt;
        if (this.slamCD <= 0 && !out && !isGrabbed(p) && s.t > 0.8) {
          if (mp) this.slamPrey = this.pickSlamPrey(run, p);
          s.set('track'); audio.sfx('warn', { volume: 0.6 });
        }
        break;
      case 'track': {
        const q = mp ? this.slamPrey ?? p : p;
        // co-op: the target dropped out (down, escaped) → think again
        if (mp && (q.dead || q.downed || q.hidden || !run.includes(q))) { s.set('rest'); this.slamCD = 0.6; break; }
        const lead = q.vel.x * 0.55;
        const gy = L.phys.groundAt(q.pos.x + lead, q.pos.z, q.pos.y + 1, 0.2);
        // never swat the hero out of a jump over a pit: wait until there is floor where he'll land
        if (gy < -1e8 || gy < this.floorY - 0.5) { s.set('rest'); this.slamCD = 0.6; break; }
        // nor at the finish gate (his palm would come down through it)
        if (q.pos.x + lead > this.gate.face - 3) { s.set('rest'); this.slamCD = 0.6; break; }
        s.target.set(q.pos.x + lead, gy, q.pos.z + q.vel.z * 0.25);
        this.slamTrack(dt); markerOn = true;
        if (s.t > 0.9) { s.set('slam'); s.vy = -12; }
        break;
      }
      case 'slam': {
        s.vy -= 150 * dt; s.pos.y += s.vy * dt; s.pose = 'flat'; markerOn = true;
        this.slamHit(L);
        if (s.pos.y <= s.target.y) {
          s.pos.y = s.target.y; s.set('stuck');
          L.tcam.shake(0.45); audio.sfx('bigSlam');
          L.fx.dust(s.pos.clone(), 16, '#c8b0e0');
          L.fx.ring(s.pos.clone().setY(s.target.y + 0.1), 5, '#ffffff', 0.35);
        }
        break;
      }
      case 'stuck':
        s.pose = 'flat';
        if (s.t > 0.55) { s.set('lift'); this.slamCD = rand(2.1, 3.2); }
        break;
    }
    this.slamMarker(markerOn);

    // the hero is getting away → walnuts rain ahead of him (co-op: ahead of the leaders)
    this.nutCD -= dt;
    if (gap > 13 && this.nutCD <= 0 && !out && !L.inCutscene) {
      this.nutCD = rand(4.5, 6.5);
      this.shoutLine(L, ['А ну стой! ОРЕХОВЫЙ ДОЖДЬ!', 'Лови орешки!', 'Не убежишь!']);
      const lead = mp ? run.slice(-2).reverse() : [p];
      for (let i = 0; i < 3; i++) {
        const q = lead[i % lead.length] ?? p;
        const x = q.pos.x + 10 + i * 6 + rand(-1, 1), z = clamp(q.pos.z + (i === 2 ? rand(-1, 1) : (i ? -1 : 1) * rand(1.5, 4)), this.laneZ - 6, this.laneZ + 6);
        if (x > this.gate.face - 2) continue; // (none behind the finish gate)
        const gy = L.phys.groundAt(x, z, 20, 0.2);
        if (gy > -1e8) L.addFaller(new Faller3(x, gy + 24, z, gy, 'walnut', 1.0 + i * 0.25));
      }
    }

    // caught! (each machine tests its own hero; the host also moves the King back)
    this.grabT -= dt;
    if (this.caughtCD > 0) this.caughtCD -= dt;
    const caught = this.catchMine(L);
    if (caught !== null) {
      if (caught) this.shoutLine(L, ['ПОПАЛСЯ!', 'Куда собрался?!', 'НЕ УЙДЁШЬ!']);
      if (!mp) this.front -= 5;
      else if (this.caughtCD <= 0) { this.front -= 5; this.caughtCD = 0.3; }
    }
    // co-op: a straggler far behind the team is grabbed and tossed forward to the group (losing a heart)
    if (mp) this.tossStragglers(L, run, dt);
    // taunts
    this.tauntT -= dt;
    if (this.tauntT <= 0 && !L.inCutscene) {
      this.tauntT = rand(7, 11);
      if (mp ? isGrabbed(p) : L.player.grabbedBy) this.shoutLine(L, ['Ха! Макарошки тебя держат!', 'Иду-иду, крошка!']);
      else if (danger > 0.6) this.shoutLine(L, [mp ? 'Я ВАС СЪЕМ!' : 'Я ТЕБЯ СЪЕМ!', 'Сейчас... сейчас догоню!', 'Ням-ням-ням!']);
      else this.shoutLine(L, mp ? ['Стойте, крошки!', 'Из моего королевства не уходят!', 'Вы будете жить у меня! Насовсем!'] : ['Стой, крошка!', 'Из моего королевства не уходят!', 'Ты будешь жить у меня! Насовсем!']);
    }
    // trample enemies left behind
    for (const e of L.enemies) if (!e.dead && e.body.pos.x < this.front) { e.loot = 0; e.key = null; e.die(L); }
    this.sync(dt);
  }

  // ───────────────── shared pieces (host / solo and client puppet) ─────────────────
  private footsteps(L: Level3D, danger: number) {
    const st = Math.floor(this.t * 1.6);
    if (st === this.step) return;
    this.step = st;
    this.local(L, () => {
      L.tcam.shake(0.05 + danger * 0.22);
      audio.sfx('thud', { volume: 0.25 + danger * 0.55, pitch: 0.55 });
    });
  }

  /** the reaching hand rakes the floor at the front line (a function of t, front and the lean) */
  private rake(L: Level3D, dt: number, danger: number) {
    const r = this.reach;
    const cyc = (this.t * 1.4) % 1;
    r.pos.set(this.front + 1, this.floorY + Math.max(0, Math.sin(cyc * Math.PI)) * 6, this.laneZ + Math.sin(this.t * 0.7) * 3 + this.rz);
    r.pose = cyc < 0.5 ? 'open' : 'flat';
    if (Math.floor(this.t * 1.4) !== Math.floor((this.t - dt) * 1.4)) {
      this.local(L, () => {
        L.tcam.shake(0.12 + danger * 0.2); audio.sfx('slam', { volume: 0.35 + danger * 0.5 });
        L.fx.dust(r.pos.clone().setY(this.floorY), 10, '#c8b0e0');
      });
    }
  }

  private slamRest(dt: number) {
    const s = this.slam;
    s.pos.lerp(tmp.set(this.root.position.x + 10, this.floorY + 12, this.laneZ - 7), Math.min(1, dt * 3));
    s.pose = 'fist';
  }

  private slamTrack(dt: number) {
    const s = this.slam;
    s.pos.x = damp(s.pos.x, s.target.x, 7, dt); s.pos.z = damp(s.pos.z, s.target.z, 7, dt);
    s.pos.y = damp(s.pos.y, s.target.y + 10, 7, dt);
    s.pose = 'open';
  }

  /** victim-side: the falling palm squashes MY hero (every machine tests only its own) */
  private slamHit(L: Level3D) {
    const s = this.slam, p = L.player;
    if (!p.dead && Math.hypot(p.pos.x - s.pos.x, p.pos.z - s.pos.z) < HAND_R && p.pos.y < s.pos.y + 2 && p.pos.y + 1 > s.pos.y) this.local(L, () => p.hurt(L, 1, s.pos));
  }

  /** the dark spot under the palm while it aims and falls */
  private slamMarker(on: boolean) {
    const s = this.slam;
    const sm = s.marker.material as THREE.MeshBasicMaterial;
    if (on) {
      const k = clamp(1 - (s.pos.y - s.target.y) / 11, 0.15, 1);
      s.marker.visible = true;
      s.marker.position.set(s.pos.x, s.target.y + 0.05, s.pos.z);
      s.marker.scale.setScalar(HAND_R * (0.7 + k * 0.5));
      sm.opacity = 0.25 + k * 0.45 + Math.sin(this.t * 24) * 0.06;
    } else { s.marker.visible = false; sm.opacity = 0; }
  }

  /**
   * victim-side catch: my hero touched the front line → 2 damage and a fling forward.
   * Returns null (not caught), false (caught but the hit didn't land) or true.
   */
  private catchMine(L: Level3D): boolean | null {
    const p = L.player;
    if (p.dead || p.pos.x >= this.front + 1.5 || this.grabT > 0) return null;
    // co-op: a downed/escaped friend isn't grabbed, and one far behind the King is tossed instead
    if (L.nl && (p.downed || p.hidden || p.pos.x < this.front - 6)) return null;
    this.grabT = 1.3;
    const hit = this.local(L, () => p.hurt(L, 2, new THREE.Vector3(this.front - 4, p.pos.y, p.pos.z)));
    // my own hero: flung forward over the line (as in solo — the corpse flies too)
    if (hit) { p.body.vel.set(16, 9, 0); p.knockT = 0.35; }
    return hit;
  }

  // ───────────────── the finish gate (host / solo decides; every machine animates) ─────────────────
  /** host/solo: shut the gate once every runner is through it (or the exit began) — true once it is coming down */
  private gateCheck(L: Level3D, team: HeroLike[]) {
    const g = this.gate;
    if (g.state === 'up' && (L.complete || (team.length > 0 && team.every((h) => h.pos.x > g.x + GATE_PAST)))) {
      g.drop(L);
      L.nl?.entEvent(this, 'gate');
      this.shoutLine(L, ['НЕТ-НЕТ-НЕТ! Не опускай!', 'Стой! Решётка!', 'А ну подними!']);
      this.fin = 0; this.finT = 0;
    }
    return g.state !== 'up';
  }

  /** while the gate is up: never into its arch, and near it never closer than GATE_HOLD to the rearmost runner */
  private gateLimit(p: HeroLike) {
    const stop = this.gate.x - GATE_STOP;
    const x = p.pos.x;
    if (p.dead || x < this.front - 4) return stop;
    // (eases in over the last stretch, so he slows down there instead of jumping back)
    const k = clamp((x - (this.gate.x - 20)) / 12, 0, 1);
    return k > 0 ? Math.min(stop, x - lerp(1.5, GATE_HOLD, k)) : stop;
  }

  /** host/solo: charge at the shut gate, crash into it (dazed), then rattle its bars and yell */
  private finale(L: Level3D, dt: number, run: HeroLike[]) {
    const stop = this.gate.x - GATE_STOP;
    this.finT += dt;
    if (this.fin === 0) {
      // (co-op: the door's timeout may have shut it with somebody still on his side — never over him)
      let lim = stop;
      for (const h of run) if (h.pos.x < this.gate.x && h.pos.x >= this.front - 4) lim = Math.min(lim, h.pos.x - GATE_HOLD);
      this.speed = approach(Math.max(this.speed, 4), 16, 24 * dt);
      this.front = Math.max(this.front, Math.min(lim, this.front + this.speed * dt));
      this.footsteps(L, this.dangerFor(L.player));
      if (this.front >= stop - 0.05 && this.gate.state === 'down') this.crash(L);
    } else {
      this.speed = 0;
      this.front = stop - this.finOff();
      if (this.fin === 1 && this.finT > 1.6) { this.fin = 2; this.finT = 0; this.finBark = 0.4; }
      if (this.fin === 2) {
        this.finBark -= dt;
        if (this.finBark <= 0 && !L.results) {
          this.finBark = rand(2.6, 3.4);
          this.shoutLine(L, L.nl ? ['ОТКРЫВАЙТЕ! Именем короля!', 'Я ВАС ВСЁ РАВНО ДОСТАНУ!', 'Это МОЯ решётка! МОЯ!', 'Ну погодите, малявки!', 'Кто опустил решётку?!'] : ['ОТКРЫВАЙТЕ! Именем короля!', 'Я ТЕБЯ ВСЁ РАВНО ДОСТАНУ!', 'Это МОЯ решётка! МОЯ!', 'Ну погоди, малявка!', 'Кто опустил решётку?!']);
          audio.sfx('roar', { volume: 0.55, pitch: rand(0.9, 1.1) });
        }
      }
    }
    this.finalePose(L, dt);
  }

  /** how far his front line sits back from the stop after the crash (a bounce off the bars, then leaning on them) */
  private finOff() {
    const k = this.finT;
    if (this.fin === 1) return k < 0.18 ? 2.6 * (k / 0.18) : Math.max(0.7, 2.6 - (k - 0.18) * 1.5);
    return 0.45 + 0.3 * Math.sin(this.t * 9);
  }

  /** host/solo: the crash (captured on the host — friends see and hear it too) */
  private crash(L: Level3D) {
    this.fin = 1; this.finT = 0; this.speed = 0;
    this.gate.shake(1);
    this.anim.flash = 0.8;
    const at = new THREE.Vector3(this.gate.face, this.floorY + 10, this.laneZ);
    audio.sfx('clang', { pitch: 0.5 }); audio.sfx('bigSlam'); audio.sfx('thud', { pitch: 0.45 });
    L.tcam.shake(0.7);
    L.fx.sparks(at, 26, ['#ffffff', '#ffe14a', '#c8d0e0']);
    L.fx.stars(at.clone().setY(this.floorY + 24), 22);
    for (const z of [-8, -3, 3, 8]) L.fx.dust(new THREE.Vector3(this.gate.face - 1, this.floorY + 0.5, this.laneZ + z), 10, '#c8b8d8');
    this.shoutLine(L, ['ОЙ-ОЙ-ОЙ! Мой нос!', 'Бздынь!.. Ох, звёздочки...', 'Ай! Откуда тут решётка?!']);
  }

  /** the finish pose (host and puppet alike, from fin / finT / t): arms out, dazed, then both fists on the bars */
  private finalePose(L: Level3D, dt: number) {
    const a = this.anim, r = this.reach, s = this.slam, y0 = this.floorY;
    a.flash = Math.max(0, a.flash - dt * 4);
    if (this.fin === 0) {
      a.anger = damp(a.anger, 1, 6, dt); a.eye = damp(a.eye, 1, 6, dt);
      r.pos.lerp(tmp.set(this.front + 1, y0 + 7, this.laneZ + 5), Math.min(1, dt * 6));
      s.pos.lerp(tmp.set(this.front + 1, y0 + 7, this.laneZ - 5), Math.min(1, dt * 6));
      r.pose = 'open'; s.pose = 'open';
    } else if (this.fin === 1) {
      a.dizzy = damp(a.dizzy, 1, 8, dt); a.eye = damp(a.eye, 0.8, 6, dt); a.anger = damp(a.anger, 0.5, 4, dt);
      a.slump = damp(a.slump, 0.3, 5, dt);
      const wob = Math.sin(this.t * 5) * 0.8;
      r.pos.lerp(tmp.set(this.front - 4, y0 + 4 + wob, this.laneZ + 8.5), Math.min(1, dt * 5));
      s.pos.lerp(tmp.set(this.front - 4, y0 + 4 - wob, this.laneZ - 8.5), Math.min(1, dt * 5));
      r.pose = 'open'; s.pose = 'open';
    } else {
      a.dizzy = damp(a.dizzy, 0, 3, dt); a.anger = damp(a.anger, 1, 4, dt); a.eye = damp(a.eye, 1, 4, dt);
      a.slump = damp(a.slump, 0.5, 3, dt);
      // fingertips on the bars, shaking them
      const hx = this.gate.face - 5.6, sh = Math.sin(this.t * 9);
      r.pos.lerp(tmp.set(hx + sh * 0.25, y0 + 9 + sh * 0.7, this.laneZ + 6.25), Math.min(1, dt * 8));
      s.pos.lerp(tmp.set(hx - sh * 0.25, y0 + 9 - sh * 0.7, this.laneZ - 6.25), Math.min(1, dt * 8));
      r.pose = 'grab'; s.pose = 'grab';
      // every machine rattles its own bars (never captured: friends do theirs)
      if (Math.floor(this.t * 2.2) !== Math.floor((this.t - dt) * 2.2)) {
        this.gate.shake(0.5);
        this.local(L, () => {
          const d = Math.abs(L.player.pos.x - this.gate.x);
          audio.sfx('clang', { pitch: rand(0.45, 0.6), volume: 0.35 });
          L.tcam.shake(clamp(0.25 - d / 120, 0.05, 0.2));
        });
      }
    }
    s.state = 'rest';
  }

  /**
   * Chapter-4 exit (every machine, with its own hero and camera — the exit script yields to it): the gate is shut
   * behind the team; one look back at the King behind the bars while my hero slips out through the door.
   */
  *exitBeat(L: Level3D): Script {
    const p = L.player, g = this.gate, y0 = this.floorY;
    // (the door's 20-s timeout may have left somebody behind: the gate comes down anyway — he can't follow)
    if (L.authority && g.state === 'up') this.gateCheck(L, []);
    if (p.grabbedBy) { p.grabbedBy.release(); p.grabbedBy = null; }
    p.autoRun = null;
    p.auto = { x: CHASE_GATE.x + 13.5, z: clamp(p.pos.z, this.laneZ - 2, this.laneZ + 2), speed: 1 };
    // from the door, up through the bars at his face (dazed, then rattling them), pushing in slowly
    const look = new THREE.Vector3(g.x - 7, y0 + 16, this.laneZ - 1);
    yield L.shot(new THREE.Vector3(g.x + 14, y0 + 4.5, this.laneZ + 7), look, 0);
    let t = 0, gone = false;
    yield all(L.shot(new THREE.Vector3(g.x + 10.5, y0 + 5.5, this.laneZ + 5), look, 1.7), {
      update: (dt: number) => {
        t += dt;
        // my hero slips out through the door behind the camera
        if (!gone && (t > 0.8 || p.auto === null || p.pos.x > CHASE_GATE.x + 12.5)) {
          gone = true; p.auto = null; p.hidden = true; audio.sfx('door');
          L.shout('СТОЙ!!!', 1.2);
        }
        return t > 1.7;
      },
    });
  }

  // ───────────────── co-op: host ─────────────────
  /** a runner thrown back by a hazard (not respawned far away) — if he is now the last one, the King stumbles back */
  private teamBackOff(L: Level3D, run: HeroLike[]) {
    const last = run.length ? run[0].pos.x : Infinity;
    const next = new Map<HeroLike, number>();
    for (const h of L.heroes()) {
      const was = this.heroX.get(h);
      const x = h.pos.x;
      if (was !== undefined && x < was - 2.5 && x > was - 30 && x <= last + 0.01 && run.includes(h)) this.backOff(x, 15);
      next.set(h, x);
    }
    this.heroX = next;
  }

  /** the last runner most of the time, sometimes another one near the back */
  private pickSlamPrey(run: HeroLike[], p: HeroLike): HeroLike {
    const back = run.filter((h) => h.pos.x < p.pos.x + 8 && h.pos.x >= this.front - 4 && !isGrabbed(h));
    if (back.length < 2 || Math.random() < 0.55) return p;
    return choose(back);
  }

  /**
   * Feature 19 «chase together»: a runner who fell more than STRAGGLE m behind the next one (or ended up behind the
   * King, e.g. respawned at a candle he passed long ago) gets tossed forward to the group. The host decides; the
   * hero's owner moves him and takes the heart.
   */
  private tossStragglers(L: Level3D, run: HeroLike[], dt: number) {
    for (const [h, t] of this.tossCD) { if (t <= dt) this.tossCD.delete(h); else this.tossCD.set(h, t - dt); }
    if (!run.length || L.worldCut) return;
    // the group = the biggest bunch (no hole > STRAGGLE inside it; a tie goes to the bunch further ahead).
    // Runners behind it are stragglers; a runaway ahead of it is never tossed and never drags the team.
    let g = 0, g1 = 0;
    for (let s0 = 0, i = 1; i <= run.length; i++) {
      if (i < run.length && run[i].pos.x - run[i - 1].pos.x <= STRAGGLE) continue;
      if (i - s0 >= g1 - g) { g = s0; g1 = i; }
      s0 = i;
    }
    let k = 0;
    for (let i = 0; i < run.length; i++) {
      const h = run[i];
      const behindKing = h.pos.x < this.front - 4;
      if (i >= g && !behindKing) continue;
      if (isGrabbed(h) || this.tossCD.has(h) || !h.control) continue;
      // land a few metres behind the rearmost of the group (never right in the King's hand)
      const grp = run.slice(g, g1).find((o) => o !== h && o.pos.x >= this.front - 4) ?? run.slice(g1).find((o) => o.pos.x >= this.front - 4);
      let x = grp ? Math.max(grp.pos.x - 4 - k * 1.5, this.front + 10) : this.front + 16;
      // (once the gate is down, over it to the others)
      if (this.gate.state !== 'up') x = Math.max(x, this.gate.x + 4);
      k++;
      this.tossCD.set(h, 3);
      this.shoutLine(L, ['Не отставай, крошка!', 'А ну, к своим!', 'Лети к друзьям, малявка!', 'Догоняй, догоняй!']);
      audio.sfx('swing', { pitch: 0.6 });
      L.fx.dust(h.pos.clone(), 14, '#c8b8d8');
      if (h.isLocal) this.local(L, () => this.applyToss(L, x));
      L.nl?.entEvent(this, 'toss', { to: h.isLocal ? net.myId : (h as RemoteHero3).id, x });
      L.feed(`Король швырнул ${h.isLocal ? 'тебя' : (h as RemoteHero3).name} к друзьям`, '#ffb0a0');
    }
  }

  /** owner side: I was tossed forward — land near x and lose a heart (never the last one) */
  private applyToss(L: Level3D, x: number) {
    const p = L.player;
    if (p.dead || p.downed || p.grabbedBy) return;
    const at = this.landing(L, x, p.pos.z);
    p.body.pos.set(at.x, at.y + 3.2, at.z);
    p.body.vel.set(6, 3, 0);
    p.teleported(); // friends see me land there, not slide over the King's table
    p.lastSafe.copy(at);
    // runner mode throws back to an older safe spot: forget the ones before the toss
    (p as unknown as { safeHist?: unknown[] }).safeHist?.splice(0);
    if (p.hp > 1) { p.hp -= 1; L.stats.hits++; }
    p.flash = 1; p.invuln = Math.max(p.invuln, 1.2); p.knockT = 0.4;
    p.jumping = false; p.atk = null; p.dashT = 0;
    L.tcam.snap(p.pos);
    L.tcam.shake(0.5);
    audio.sfx('hurt');
    L.fx.sparks(p.center(), 12, ['#ffffff', '#ff5a5a', '#ffd34a']);
    L.fx.text(p.center().setY(p.pos.y + 1.6), '−1 ♥', '#ff8080', 24);
    L.toast('Король швырнул тебя к друзьям — не отставай!');
  }

  /** a safe floor spot near x in the lane (no pit, no prop, no spikes; on the far side of a shut gate) */
  private landing(L: Level3D, x: number, z: number): THREE.Vector3 {
    const zs = [clamp(z, this.laneZ - 5, this.laneZ + 5), this.laneZ, this.laneZ - 3, this.laneZ + 3];
    const pt = new THREE.Vector3();
    const g = this.gate, shut = g.state !== 'up';
    for (let k = 0; k < 40; k++) {
      const xx = x + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 1.5;
      if (shut ? xx < g.x + 2.5 : Math.abs(xx - g.x) < CHASE_GATE.thick / 2 + 1) continue;
      for (const zz of zs) {
        const gy = L.phys.groundAt(xx, zz, this.floorY + 6, 0.35);
        if (gy < this.floorY - 0.3 || gy > this.floorY + 0.3) continue;
        if (L.phys.pointInSolid(pt.set(xx, gy + 0.6, zz)) || L.phys.pointInSolid(pt.set(xx, gy + 1.6, zz))) continue;
        if (L.phys.hazards.some((h) => xx > h.min.x - 1.2 && xx < h.max.x + 1.2 && zz > h.min.z - 1.2 && zz < h.max.z + 1.2 && gy < h.max.y + 1)) continue;
        return new THREE.Vector3(xx, gy, zz);
      }
    }
    return new THREE.Vector3(x, this.floorY, this.laneZ);
  }

  // ───────────────── co-op: replication ─────────────────
  /** host → clients: [front, speed, active, t, lookX, rz, slamState, sx, sy, sz, tx, ty, tz, smashed, talk, gate, fin, finT, tp] */
  netSnap(): number[] {
    const s = this.slam;
    let smashed = 0;
    while (smashed < this.smash.length && this.smash[smashed].done) smashed++;
    // he only ever walks forward while chasing: a step back (caught, backing off, the wake-up head start) is a jump —
    // clients step there instead of sliding back (after the crash the bounce off the bars is real movement)
    if (this.fin === 0 && this.front < this.snapFront - 0.3) this.tpN++;
    this.snapFront = this.front;
    return [this.front, this.speed, this.active ? 1 : 0, this.t, this.anim.look.x, this.rz, HAND_ST.indexOf(s.state),
      s.pos.x, s.pos.y, s.pos.z, s.target.x, s.target.y, s.target.z, smashed, this.talk,
      this.gate.state !== 'up' ? 1 : 0, this.fin, this.finT, this.tpN];
  }

  /** client: a snapshot taken at host time t, played back at NetLevel.playT (his intro dash reaches ~75 m/s) */
  netApply(a: number[], t?: number) {
    if (t === undefined) return;
    (this.track ??= new NetTrack<number[]>(120, 8)).push(t, a[0], this.floorY, this.laneZ, 0, a, a[18] ?? 0);
  }

  /** client: a snapshot's discrete fields, as the playback passes it */
  private netFields(L: Level3D, a: number[]) {
    this.speed = a[1];
    this.active = !!a[2];
    this.talk = Math.max(this.talk, a[14] ?? 0);
    // props the host's King has smashed by now (his fx and sounds arrive on their own)
    for (let i = 0; i < a[13] && i < this.smash.length; i++) {
      const sm = this.smash[i];
      if (sm.done) continue;
      sm.done = true;
      for (const o of sm.objs) o.visible = false;
      for (const c of sm.cols) c.active = false;
    }
    // the finish: the host shut the gate (in case its event is late), the crash, the rattling
    if (a[15] && this.gate.state === 'up') this.gate.drop(L);
    const fin = a[16] ?? 0;
    if (fin !== this.fin) { if (fin === 1) this.gate.shake(1); this.fin = fin; this.finT = a[17] ?? 0; }
    // the slam palm follows the host's state machine (its moves are simulated here, from the played-back target)
    const s = this.slam, nst = HAND_ST[a[6]] ?? 'rest';
    if (nst === this.netSt) return;
    this.netSt = nst;
    if (nst === 'slam' || (nst === 'stuck' && s.state === 'track')) { s.set('slam'); s.vy = -12; }
    else if (nst === 'stuck') { if (s.state !== 'slam' && s.state !== 'stuck') s.set('stuck'); }
    else s.set(nst);
  }

  netEvent(L: Level3D, ev: string, data: unknown) {
    const d = (data ?? {}) as { to?: string; x?: number; hit?: boolean; from?: string };
    if (ev === 'gate') { if (!L.authority) this.gate.drop(L); return; }
    if (ev === 'toss') {
      if (d.to === net.myId) { if (typeof d.x === 'number') this.applyToss(L, d.x); }
      else { const r = d.to ? L.remote(d.to) : undefined; if (r) L.feed(`Король швырнул ${r.name} к друзьям`, '#ffb0a0'); }
    } else if (ev === 'caught' && L.nl?.isHost) {
      // a friend touched the front line on his machine: the King steps back (once for a bunch) and gloats
      if (this.caughtCD <= 0) { this.front -= 5; this.caughtCD = 0.3; }
      if (d.hit) L.nl.capture(() => this.shoutLine(L, ['ПОПАЛСЯ!', 'Куда собрался?!', 'НЕ УЙДЁШЬ!']));
    }
  }

  // ───────────────── co-op: client puppet ─────────────────
  private puppet(L: Level3D, dt: number) {
    this.t += dt;
    this.finT += dt;
    this.talk = Math.max(0, this.talk - dt * 3);
    const tr = this.track, play = L.nl?.playT ?? -Infinity;
    const got = !!tr && tr.eval(play, dt, netPose);
    if (tr && got) {
      tr.passed(play, (a) => this.netFields(L, a));
      // the host's clock drives the rake, the steps and the bob: follow its played-back value softly
      const ht = tr.lerp(3);
      if (Math.abs(ht - this.t) > 0.5) this.t = ht; else this.t += (ht - this.t) * Math.min(1, dt * 3);
      this.rz = tr.lerp(5);
      // (never into the arch; after the crash the bounce off the bars and the leaning come from the same clock)
      this.front = this.fin === 0 ? Math.min(netPose.pos.x, this.gate.x - GATE_STOP) : this.gate.x - GATE_STOP - this.finOff();
      this.slam.target.set(tr.lerp(10), tr.cur![11], tr.lerp(12));
    }
    const a = this.anim;
    a.eye = damp(a.eye, 1, 4, dt);
    a.anger = damp(a.anger, 0.9, 1, dt);
    a.stand = damp(a.stand, 1, 2, dt);
    if (!this.fin) a.slump = damp(a.slump, this.active ? 0.62 : 0.1, 2, dt);
    a.mouth = damp(a.mouth, this.talk > 0 ? Math.abs(Math.sin(this.t * 14)) * 0.6 : 0.3 + Math.sin(this.t * 3) * 0.15, 8, dt);
    if (tr && got) a.look.x = damp(a.look.x, tr.lerp(4), 6, dt);
    this.bobK = damp(this.bobK, this.active && this.fin === 0 ? 1 : 0, 10, dt);
    if (!this.active) {
      this.placeBody(this.bobK); this.restHands();
      if (this.slam.state !== 'rest') this.slam.set('rest');
      this.slamMarker(false); this.sync(dt);
      return;
    }
    this.placeBody(this.bobK);
    if (this.gate.state !== 'up') {
      // the finish: charging at the shut gate, dazed, rattling it (no catching, no slams)
      if (this.fin === 0) this.footsteps(L, this.dangerFor(L.player));
      this.finalePose(L, dt);
      this.slamMarker(false);
      this.sync(dt);
      return;
    }
    const myDanger = this.dangerFor(L.player);
    this.footsteps(L, myDanger);
    this.rake(L, dt, myDanger);
    this.puppetSlam(L, dt);
    // caught: my hero touched the line → hurt here, tell the host (he steps the King back and gloats)
    this.grabT -= dt;
    const caught = this.catchMine(L);
    if (caught !== null) L.nl?.entEvent(this, 'caught', { hit: caught });
    this.sync(dt);
  }

  /**
   * client: the slam palm moves as the host's does — after the played-back target while it aims, back up beside his
   * played-back body when it rests — on the playback's clock, with the state changes where the host made them
   */
  private puppetSlam(L: Level3D, dt: number) {
    const s = this.slam, pdt = L.nl?.playDt ?? dt;
    s.t += dt;
    let markerOn = false;
    switch (s.state) {
      case 'track': this.slamTrack(pdt); markerOn = true; break;
      case 'slam':
        s.vy -= 150 * pdt; s.pos.y += s.vy * pdt; s.pose = 'flat'; markerOn = true;
        this.slamHit(L);
        if (s.pos.y <= s.target.y) { s.pos.y = s.target.y; s.set('stuck'); }
        break;
      case 'stuck': s.pose = 'flat'; break;
      default: this.slamRest(pdt);
    }
    this.slamMarker(markerOn);
  }

  private shoutLine(L: Level3D, lines: string[]) { L.shout(choose(lines)); this.talk = 0.6; }

  sync(dt: number) {
    const a = this.anim;
    a.talk = this.talk > 0 ? Math.abs(Math.sin(this.t * 14)) : 0;
    this.root.updateMatrixWorld();
    // hands[0] = king's left = world +Z side (reach), hands[1] = world −Z side (slam)
    const hs = [this.reach, this.slam];
    hs.forEach((h, i) => {
      const ha = a.hands[i];
      ha.pos.copy(this.root.worldToLocal(h.pos.clone()));
      ha.pose = h.pose; ha.glow = 0; ha.flash = 0;
    });
    this.rig.update(dt, a);
  }
}
