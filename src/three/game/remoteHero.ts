import * as THREE from 'three';
import { clamp, damp } from '../../engine/util';
import { net } from '../../net/session';
import { cleanLook, cleanPick, DEFAULT_LOOKS, type HeroLook, type HeroKind } from '../../net/profile';
import { createHeroModel } from '../models/heroes';
import type { HeroAnim, HeroState, HeroExpr } from '../models';
import type { HeroFx, HeroRig } from '../models/hero';
import type { RemoteKitView } from './heroes/kit';
import { kitNet, remoteKitView, HERO_BODY } from './heroes';
import { makeBlob } from '../fx';
import type { CylCol } from '../physics/types';
import type { Level3D } from './level';
import { NetClock, NetTrack, type NetPose } from './netInterp';

/** hero anim states / attack kinds / expressions as small ints on the wire (append only: indices are the protocol) */
export const HERO_STATES: HeroState[] = ['idle', 'run', 'walk', 'sneak', 'jump', 'fall', 'dash', 'hurt', 'grabbed', 'dead', 'sit', 'cheer', 'lookUp', 'tumble',
  'wave', 'dance', 'bow', 'facepalm', 'downed'];
/** emotes (HS.emote: 1..4) → their anim state */
export const EMOTES = ['wave', 'dance', 'bow', 'facepalm'] as const satisfies readonly HeroState[];
/** a name from the network: no control characters, at most 16 letters */
export const cleanName = (n: unknown) => String(n ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16) || 'Тоша';
export const ATK_KINDS = ['sword', 'swordAlt', 'fork', 'spin', 'sling',
  // «Хрумляндия» heroes (append only)
  'punch', 'punchAlt', 'mill', 'grab', 'axe', 'axeAlt', 'axeSpin', 'chord', 'syringe', 'flask', 'flaskAlt'] as const;
/** hero kinds on the wire (HS.kind; append only) */
export const KIND_IDS: HeroKind[] = ['tosha', 'bublik', 'noki', 'pastila'];
export const EXPRS: HeroExpr[] = ['normal', 'happy', 'angry', 'scared', 'surprised', 'hurt', 'sleepy'];

/**
 * hero state packet layout (Player3.netState → RemoteHero3.applyState). Append only: older senders' shorter packets
 * (from HS_MIN on) still work. tp = the sender's teleport counter, ts = the sender's clock in ms when it was sent.
 */
export const HS = { x: 0, y: 1, z: 2, yaw: 3, vx: 4, vy: 5, vz: 6, st: 7, atk: 8, atkP: 9, weapon: 10, hp: 11, maxHp: 12, flags: 13, expr: 14, squash: 15, emote: 16, tp: 17, ts: 18,
  /** «Хрумляндия»: the hero played (KIND_IDS index; absent = Tosha) and his kit's visible state (4 numbers, see heroes/index.ts kitNet) */
  kind: 19, k0: 20, k1: 21, k2: 22, k3: 23,
  /** team buffs on him (heroes/team.ts: 1 = haste, 2 = one-hit shield) */
  buff: 24, len: 25 } as const;
export const HS_MIN = 16;
export const HF = { dead: 1, downed: 2, grabbed: 4, hidden: 8, invuln: 16, dashing: 32, ground: 64, control: 128, talking: 256 } as const;

/**
 * A friend's Tosha as seen on this machine: driven by their state stream (≈15 Hz direct, 10 Hz samples in relay
 * batches), played back a little in the past through a NetTrack (see netInterp.ts) — smooth even when packets come
 * late, bunched or not at all for a moment; a teleport (respawn, toss, script) shows as a jump with a puff.
 * On the host it is also a target for enemies: hurt() sends the damage to its owner, who applies it.
 *
 * `pos` is where he is DRAWN (the playback position, ~0.1 s behind his owner on a direct link, ~0.5 s over the
 * Supabase relay). All game logic reads it too — enemy targeting and hits on the host, his head collider, revive
 * range, PvP hits — so what you see is what counts (a swing that visibly misses him misses). `latestPos` is the
 * newest position received (no playback delay) for logic that prefers freshness over matching the screen.
 */
export class RemoteHero3 {
  readonly isLocal = false;
  root = new THREE.Group();
  rig: HeroRig;
  /** the hero he plays here (from his state stream; before the first packet: the level's rule for his pick) */
  kind: HeroKind = 'tosha';
  /** his kit's visible state, played back with his stream */
  fx: HeroFx = {};
  private kitView: RemoteKitView | null = null;
  private fxA = [0, 0, 0, 0];
  blob = makeBlob(0.45);
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  /** newest received position (see the class note) */
  latestPos = new THREE.Vector3();
  yaw = 0;
  body: { pos: THREE.Vector3; vel: THREE.Vector3; r: number; h: number; onGround: boolean };
  hp = 5; maxHp = 5;
  dead = false; downed = false; grabbed = false; hidden = false; dashing = false; control = true; talking = false;
  invuln = 0;
  /** team buffs on him (HS.buff bits: 1 = haste, 2 = one-hit shield) — drawn as an aura by heroes/team.ts */
  buffs = 0;
  atk: string | null = null; atkT = 0; atkP = 0; atkId = 0;
  weapon: 'sword' | 'fork' = 'sword';
  /** last chat line shown over the head */
  bubble: { text: string; t: number } | null = null;
  emote = 0; emoteT = 0;
  /** co-op downed: seconds of bleed-out left (from the owner's 'down' messages) and a friend's revive progress on him */
  bleed = 0; reviveP = 0; reviveBy = ''; reviveSeen = 0;
  /** one-way collider on the head (friends can stand / boost on it) */
  col: CylCol;
  /** his stream's timing (playback delay, interval) — readable for the debug overlay */
  readonly clock = new NetClock();
  /** extra squash on this machine (someone just boost-jumped off his head) — the owner's own squash follows in his stream */
  private kickSq = 1;
  /** came back from the dead / a teleport: a puff where he appears */
  private poof = false;
  private wasOut = false;
  private track = new NetTrack<number[]>(45);
  private pose: NetPose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };
  private anim: HeroAnim = { state: 'idle', speed: 0, attack: null, weapon: 'sword', flash: 0, talk: 0, expr: 'normal', squash: 1 };
  private got = false;
  private t = 0;
  private stepT = 0;
  private lastAtk: string | null = null;
  private wasGround = true;
  /** host: brief lock after sending a hit, until the owner's invulnerability shows up in its stream */
  private hurtLock = 0;
  lastSeen = 0;

  constructor(public id: string, public name: string, public look: HeroLook, kind: HeroKind = 'tosha') {
    this.name = cleanName(name);
    this.look = cleanLook(look);
    this.kind = kind;
    this.rig = createHeroModel(kind, this.lookFor(kind));
    this.root.add(this.rig.root);
    this.body = { pos: this.pos, vel: this.vel, r: 0.3, h: 0.95, onGround: true };
    this.col = { kind: 'cyl', x: 0, z: 0, r: 0.42, y0: -100, y1: -99, tag: 'hero', oneWay: true, active: false };
  }

  attach(L: Level3D, near: THREE.Vector3) {
    this.pos.copy(near).add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2));
    this.latestPos.copy(this.pos);
    L.scene.add(this.root, this.blob);
    L.phys.add(this.col);
    this.root.visible = false;
    this.blob.visible = false;
  }

  dispose(L: Level3D) {
    L.scene.remove(this.root, this.blob);
    L.phys.remove(this.col);
    this.kitView?.dispose(L); this.kitView = null;
    this.rig.dispose();
    this.blob.geometry.dispose();
    (this.blob.material as THREE.Material).dispose();
  }

  /** the owner's state stream went quiet (lagging / leaving) */
  get stale() { return !this.got || this.t - this.lastSeen > 1.5; }

  setLook(name: string, look: HeroLook) {
    this.name = cleanName(name);
    const l = cleanLook(look);
    const want = this.lookFor(this.kind, l);
    this.look = l;
    if (JSON.stringify(want) !== JSON.stringify(this.rig.look)) this.rig.setLook(want);
  }

  /** the look his `kind` wears: Tosha → his Tosha look; his picked hero → its look from his meta; else that hero's default */
  lookFor(kind: HeroKind, tosha: HeroLook = this.look): HeroLook {
    if (kind === 'tosha') return tosha;
    const pick = cleanPick(net.members.get(this.id)?.hero, tosha);
    return pick.kind === kind ? pick.look : { ...DEFAULT_LOOKS[kind], tagColor: tosha.tagColor };
  }

  /** he plays another hero now (his stream says so): a new rig, the kit's view */
  setKind(kind: HeroKind, L?: Level3D) {
    if (kind === this.kind) return;
    this.kind = kind;
    this.root.remove(this.rig.root);
    this.rig.dispose();
    this.rig = createHeroModel(kind, this.lookFor(kind));
    this.root.add(this.rig.root);
    if (L) { this.kitView?.dispose(L); this.kitView = null; }
    this.fx = {}; this.fxA = [0, 0, 0, 0];
  }

  /** someone landed on / jumped off my head: squash me now (his stream catches up a moment later) */
  kick(sq = 0.55) { this.kickSq = Math.min(this.kickSq, sq); }

  center(out = new THREE.Vector3()) { return out.copy(this.pos).setY(this.pos.y + 0.5); }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  /** state packet from the owner; at = when it arrived here (performance.now() / 1000) */
  applyState(a: number[], at = performance.now() / 1000) {
    if (!Array.isArray(a) || a.length < HS_MIN) return;
    for (let i = 0; i < HS_MIN; i++) if (typeof a[i] !== 'number' || !Number.isFinite(a[i])) return;
    // the sender's clock (an older build doesn't stamp: arrival time, i.e. no jitter compensation)
    const ts = typeof a[HS.ts] === 'number' && Number.isFinite(a[HS.ts]) ? a[HS.ts] / 1000 : at;
    this.clock.note(ts, at);
    if (!this.track.push(ts, a[HS.x], a[HS.y], a[HS.z], a[HS.yaw], a, Number(a[HS.tp]) || 0, a[HS.vx], a[HS.vy], a[HS.vz])) return;
    this.track.newestPos(this.latestPos);
    if (!this.got) {
      // first news: be there right away (as the hero he plays)
      this.got = true;
      const k = KIND_IDS[Math.round(Number(a[HS.kind]))];
      if (k && k !== this.kind) this.setKind(k);
      this.pos.copy(this.latestPos);
      this.yaw = a[HS.yaw];
    }
    this.lastSeen = this.t;
  }

  /** the discrete part of a state packet, applied when the playback reaches it (so a swing shows where it happened) */
  private applyFields(a: number[]) {
    const k = KIND_IDS[Math.round(Number(a[HS.kind]))] ?? 'tosha';
    if (k !== this.kind) this.pendingKind = k;
    this.anim.state = HERO_STATES[a[HS.st]] ?? 'idle';
    const ak = a[HS.atk];
    const kind = ak >= 0 ? ATK_KINDS[ak] : null;
    this.atk = kind ?? null;
    this.atkP = a[HS.atkP];
    if (kind && kind !== this.lastAtk) this.atkId++;
    this.lastAtk = kind;
    this.weapon = a[HS.weapon] ? 'fork' : 'sword';
    this.anim.weapon = this.weapon;
    if (a[HS.hp] < this.hp && !this.dead) this.anim.flash = 1;
    this.hp = a[HS.hp]; this.maxHp = a[HS.maxHp];
    const f = a[HS.flags];
    this.dead = !!(f & HF.dead); this.downed = !!(f & HF.downed); this.grabbed = !!(f & HF.grabbed);
    if (this.dead || this.downed) this.wasOut = true;
    if (!this.downed) { this.bleed = 0; this.reviveP = 0; }
    if (this.downed) this.anim.state = 'downed';
    this.hidden = !!(f & HF.hidden); this.invuln = f & HF.invuln ? 0.2 : 0; this.dashing = !!(f & HF.dashing);
    this.body.onGround = !!(f & HF.ground); this.control = !!(f & HF.control); this.talking = !!(f & HF.talking);
    this.buffs = Math.round(Number(a[HS.buff]) || 0) & 3;
    this.anim.expr = EXPRS[a[HS.expr]] ?? 'normal';
    this.anim.squash = a[HS.squash] || 1;
    const em = Math.round(a[HS.emote]) || 0;
    if (em && em !== this.emote) this.emoteT = 0;
    this.emote = em >= 1 && em <= EMOTES.length ? em : 0;
    // the stream's state already is the emote; an older sender only sets the id
    if (this.emote && this.anim.state === 'idle') this.anim.state = EMOTES[this.emote - 1];
  }

  private pendingKind: HeroKind | null = null;

  update(L: Level3D, dt: number) {
    this.t += dt;
    this.emoteT += dt;
    if (this.pendingKind) { this.setKind(this.pendingKind, L); this.pendingKind = null; }
    this.hurtLock -= dt;
    if (this.bubble) { this.bubble.t += dt; if (this.bubble.t > 6) this.bubble = null; }
    if (!this.got) return;
    // play his stream back (real time: frames, not ticks, decide how far)
    const p = this.clock.play(performance.now() / 1000);
    const tr = this.track;
    if (tr.eval(p, dt, this.pose)) {
      this.pos.copy(this.pose.pos);
      this.vel.copy(this.pose.vel);
      this.yaw = this.pose.yaw;
    }
    tr.passed(p, (a) => this.applyFields(a));
    if (tr.teleported && !this.dead) this.poof = true;
    // the swing between two samples: its progress follows the playback
    const c = tr.cur, n = tr.next;
    if (c && n && this.atk && c[HS.atk] === n[HS.atk] && n[HS.atkP] >= c[HS.atkP]) this.atkP = c[HS.atkP] + (n[HS.atkP] - c[HS.atkP]) * tr.u;
    this.anim.attack = this.atk ? { kind: this.atk as NonNullable<HeroAnim['attack']>['kind'], p: this.atkP } : null;
    // his kit's visible state (bridge length, balloon, bat…): played back between samples like the swing
    if (c) {
      for (let i = 0; i < 4; i++) {
        const v0 = Number(c[HS.k0 + i]) || 0, v1 = n && n[HS.kind] === c[HS.kind] ? Number(n[HS.k0 + i]) || 0 : v0;
        this.fxA[i] = v0 + (v1 - v0) * tr.u;
      }
      this.fx = kitNet(this.kind).decode(this.fxA);
    }
    this.anim.fx = this.fx;
    this.anim.flash = Math.max(0, this.anim.flash - dt * 6);
    this.reviveSeen -= dt;
    if (this.reviveSeen <= 0) this.reviveP = 0;
    if (this.downed && this.bleed > 0 && this.reviveP <= 0) this.bleed = Math.max(0, this.bleed - dt);
    if (this.poof) {
      this.poof = false; this.wasOut = false;
      const c = this.center();
      L.fx.ring(this.pos.clone().setY(this.pos.y + 0.05), 1.6, '#ffe9a0', 0.45);
      L.fx.stars(c, 16, ['#fff6c0', '#ffe14a', '#ffffff']);
      L.fx.dust(this.pos.clone(), 10, '#fff3d8');
    } else if (!this.dead && !this.downed && this.wasOut && this.t - this.lastSeen < 0.5) this.wasOut = false;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.anim.speed = clamp(hs / 7.6, 0, 1.4);
    this.anim.talk = this.talking ? Math.abs(Math.sin(this.t * 14)) * 0.7 : damp(this.anim.talk, 0, 10, dt);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.root.visible = !this.hidden;
    const blink = this.invuln > 0 && !this.dead && Math.floor(this.t * 14) % 2 === 0;
    this.rig.root.visible = !blink;
    this.kickSq = damp(this.kickSq, 1, 9, dt);
    const sq0 = this.anim.squash;
    if (this.kickSq < 0.98) this.anim.squash = Math.min(sq0, this.kickSq);
    this.rig.update(dt, this.anim);
    this.anim.squash = sq0;
    // shadow
    const gy = L.phys.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.1, 0.1);
    this.blob.visible = gy > -1e8 && !this.hidden;
    if (this.blob.visible) {
      this.blob.position.set(this.pos.x, gy + 0.03, this.pos.z);
      const s = clamp(1 - (this.pos.y - gy) * 0.08, 0.35, 1);
      this.blob.scale.set(s, s, s);
    }
    // head collider (boost jumps): while he stands — and while my hero rides on it (he jumps / walks with me on his
    // head: carried along like on a moving platform, a one-way top that rises under me would drop me through)
    // never while downed/dead
    const me = L.player.body;
    const ridden = this.col.active && me.onGround && me.ground === this.col;
    const solid = !this.dead && !this.downed && !this.hidden && (this.body.onGround || ridden);
    const hb = HERO_BODY[this.kind];
    const puff = this.fx.puff ?? 0;
    const top = this.pos.y + (puff > 0.5 ? hb.puffTop : hb.top);
    // Бублик puffed up: a trampoline (friends who land on him fly high)
    this.col.r = puff > 0.5 ? hb.puffR : hb.r;
    this.col.bounce = puff > 0.5 ? hb.bounce : undefined;
    if (solid && ridden && !tr.teleported) {
      const dx = this.pos.x - this.col.x, dy = top - this.col.y1, dz = this.pos.z - this.col.z;
      if (dx * dx + dy * dy + dz * dz < 4) { me.pos.x += dx; me.pos.y += dy; me.pos.z += dz; }
    }
    this.col.active = solid;
    this.col.x = this.pos.x; this.col.z = this.pos.z;
    this.col.y0 = top - 0.4; this.col.y1 = top;
    // the kit's own colliders / effects here (Бублик's bridge)
    if (!this.kitView) this.kitView = remoteKitView(this.kind);
    this.kitView?.update(L, this, this.fx, dt);
    // the host's melons hear friends too
    if (net.isHost && !this.dead && !this.hidden) {
      if (this.body.onGround && hs > 3) { this.stepT -= dt; if (this.stepT <= 0) { this.stepT = 0.3; L.noise(this.pos, 4.5); } }
      if (this.body.onGround && !this.wasGround) L.noise(this.pos, 6);
      if (this.atk && this.atkP < 0.15) L.noise(this.pos, 4);
    }
    this.wasGround = this.body.onGround;
  }

  /** host: an enemy hit this friend — the owner applies it (and its knockback) on their machine */
  hurt(L: Level3D, dmg: number, from: THREE.Vector3, knock?: THREE.Vector3, knockT?: number): boolean {
    if (this.dead || this.downed || this.invuln > 0 || this.dashing || this.hidden || this.hurtLock > 0) return false;
    if (!net.isHost) return false;
    this.hurtLock = 0.6;
    const r = (v: THREE.Vector3) => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
    net.send(this.id, 'hurt', { d: dmg, f: r(from), k: knock ? r(knock) : undefined, kt: knockT });
    void L;
    return true;
  }
}
