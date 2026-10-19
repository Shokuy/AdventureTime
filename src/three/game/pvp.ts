import * as THREE from 'three';
import { W, H, clamp, ease, rand } from '../../engine/util';
import { input } from '../../engine/input';
import { audio } from '../../engine/audio';
import { save } from '../../engine/save';
import { rrect, text } from '../../art/draw';
import { drawCrumb } from '../../art/props';
import { game } from '../../game/game';
import { net } from '../../net/session';
import { MSG } from '../../net/protocol';
import * as P from '../world/props';
import { room } from '../world/rooms';
import { LEVELS3, type Level3Def } from './levels';
import { Level3D, LEVEL_PLUGINS, type LevelPlugin, type HeroLike, type Hittable3 } from './level';
import { coop } from './coop';
import { coopFlow, COOP_SCENES } from './coopFlow';
import { Pickup3, type Shot3 } from './objects';
import type { RemoteHero3 } from './remoteHero';
import { PVP_ID } from './score';
import { drawScoreboard, drawMiniBoard, drawCrown, type BoardCol, type BoardRow, type MiniRow } from '../../ui/scoreboard';
import { toUI } from '../runtime';
import { drawHint } from '../../ui/glyphs';

/**
 * «Крошечная лихорадка» (feature 28): a 2-minute PvP crumb grab on a small feast table.
 *  • the host starts it from the lobby: startPvp() → everyone loads the arena (message MSG.pvp {t:'go'});
 *  • crumbs keep raining onto the table; they are SHARED (the host decides who got one first);
 *  • a sword / fork swing or a pea that hits a rival knocks him back and makes him drop crumbs (no damage, no deaths);
 *    falling off the table costs 3 crumbs (a fall soon after a rival's shove is his: «Вася столкнул…»);
 *  • live leaderboard, Tab / Share scoreboard, 3-2-1 countdown, a winners' podium with confetti, then back to the lobby;
 *  • everyone gets the same kit for the round (KIT), whatever he unlocked solo; his own is what gets saved.
 * Hits favor the shooter (every player sees his friends a little in the past):
 *  • the ATTACKER's machine checks each swing / pea against the rival puppets IT shows and sends a claim to the host
 *    (the host judges its own at once); the attacker sees the hit right away (puppet flash + nudge, crumbs, marker);
 *  • the HOST judges: round on, both heroes in play (not stale / hidden / downed), victim not shielded, never judged
 *    before, the geometry adds up in the attacker's frame, the attacker stood there, and the victim really was near
 *    that spot when the attacker's screen showed him there — rewound by the attacker's view lag (his trip + playback
 *    delay), at most REWIND s. Every machine keeps everyone's recent positions in their OWN time (what it shows minus
 *    its own view lag of them), so the host compares like with like — and a new host can judge too;
 *  • a confirmed hit goes to all: the VICTIM's own machine applies the shove (its physics stay its own) and shows who
 *    hit him; he is shielded for SHIELD s (FALL_SHIELD after a fall) so shoves never chain into a fall (a rival's
 *    swing from the same moment still counts as his hit — one shove, one spill).
 * Messages (all MSG.pvp), host → all: go, start{t0}, c+{l}, c-{id,by}, sc{s}, bonk{v,a,k,n,d,pw,tm,id},
 * fell{v,n,by}, shower, end{rank,s}; host → attacker: miss{v,a,why}, ok{v}; client → host: grab{id}, hit{claim}, fall{tm}.
 * A host change mid-round keeps the round (the new host has the scores, crumbs, clock and position history).
 */

const ROUND = 120;
const COUNT = 4;
/** the PvP rows: crumbs, hits landed, crumbs knocked out of others, falls, rivals shoved off the table */
interface PvpRow { c: number; h: number; k: number; f: number; s: number }
const blank = (): PvpRow => ({ c: 0, h: 0, k: 0, f: 0, s: 0 });
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const v3 = (v: THREE.Vector3) => [r2(v.x), r2(v.y), r2(v.z)];
const vec = (a: unknown, out = new THREE.Vector3()) =>
  (Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every((x) => typeof x === 'number' && isFinite(x)) ? out.set(a[0], a[1], a[2]) : null);
/** «1 крошку / 2 крошки / 5 крошек» */
const crumbsWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'крошку' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'крошки' : 'крошек');

// ── hit judging (see the top comment) ──
/** favor the shooter at most this far back (s): an older view (a relay link) is judged as if it were this old */
const REWIND = 0.25;
/** the view-lag estimates are this good (s): the victim's record is searched T ± TOL */
const TOL = 0.1;
/** a friend's playback delay when his stream can't tell (s) */
const VIEW_LAG = 0.12;
/** how far the victim may be from where the attacker saw him (m, horizontal / vertical) */
const SLACK = 1.0;
const SLACK_Y = 1.5;
/** how far the attacker may be from where the host last saw him (the host's view of him lags too) */
const ATK_SLACK = 2.4;
/** claims older than this are dropped (s) */
const MAX_AGE = 1;
/** after a shove / a fall nobody can shove that hero again for this long (s) */
const SHIELD = 0.9;
const FALL_SHIELD = 1.6;
/** a fall this soon after a rival's shove counts as his (s) */
const PUSH_T = 3;
/** seconds of position history every machine keeps for every hero */
const HIST_T = 1.6;
/** at most this many confirmed hits per attacker per second (one spin can hit a crowd) */
const RATE = 6;
const RANGE: Record<string, number> = { sword: 1.85, fork: 2.9, spin: 1.7 };
const HALF: Record<string, number> = { sword: 1.35, fork: 0.42, spin: Math.PI };
const POWER: Record<string, number> = { sword: 1, fork: 1.3, spin: 0.9, pea: 0.55 };
/** pea gravity (Level3D.spawnPea) */
const PEA_G = 6;
interface Sample { t: number; x: number; y: number; z: number }
/** attacker → host: victim, kind, swing / pea id, swing centre (pea: hit point), swing dir, victim's feet as the attacker
 *  saw them, net time, how far behind his real self the attacker saw the victim (s); a pea also: launch point, launch
 *  velocity, flight time */
interface Claim { v: string; k: string; a: number; c: number[]; d?: number[]; p: number[]; tm: number; vl: number; f?: number[]; vv?: number[]; ft?: number }
interface MyPea { id: number; f: THREE.Vector3; v: THREE.Vector3; t: number; prev: THREE.Vector3 }
/** the friend whose shove (or pea) just hit me: shown with his name and an arrow toward him */
interface HurtBy { a: string; t: number; n: number; fell: boolean }

// table top: y = 0, x −22..22, z −15..15; the podium stands on the floor (y = −18) in front of the table
const SLOTS: [number, number][] = [[-19, -6], [19, 6], [-19, 6], [19, -6], [-5, -13], [5, 13]];
const PODIUM: [number, number, number][] = [[0, 24, 3], [-3.6, 24, 2], [3.6, 24, 1.3]];
const CONFETTI = ['#ff5a6a', '#ffd34a', '#5ad8ff', '#8ae05a', '#c08aff', '#ffffff', '#ff9a3a'];

function arena(): Level3Def {
  return {
    id: PVP_ID, chapter: 0, title: 'Крошечная лихорадка', subtitle: 'Две минуты · кто больше соберёт крошек', music: 'feast',
    spawn: [0, 0.3, 12], yaw: Math.PI, killY: -7,
    bg: '#2a0c12', fog: ['#3a141c', 70, 170],
    hemi: ['#ffd8c0', '#5a1a20', 1.15], sun: { color: '#ffe0b0', intensity: 2.3, dir: [-0.3, 1, 0.5] },
    build(L) {
      L.add(room({ theme: 'feast', x0: -46, x1: 46, z0: -36, z1: 38, floorY: -18, wallH: 50 }));
      L.add(P.table({ x: 0, y: -18, z: 0, w: 44, d: 30, h: 18, cloth: true }));
      L.add(P.chandelier({ x: 0, y: 34, z: 0, r: 6 }));
      for (const x of [-28, 28]) L.add(P.window({ x, y: 2, z: -36, w: 14, h: 34 }));
      // the middle: a cake hill everyone fights over
      L.add(P.cake({ x: 0, y: 0, z: 0, r: 3.6, h: 2.4 }));
      L.add(P.cake({ x: 0, y: 2.4, z: 0, r: 2.2, h: 2 }));
      // plates (low steps), goblets (pillars to hide behind), cheese steps, jelly bounce pads, two bread walls
      for (const [x, z] of [[-13, -8], [13, 8], [-13, 8], [13, -8]]) L.add(P.plate({ x, y: 0, z, r: 2.8 }));
      for (const [x, z] of [[-8, -11.5], [8, 11.5]]) L.add(P.goblet({ x, y: 0, z, r: 1.3, h: 5.5 }));
      L.add(P.cheese({ x: 8, y: 0, z: -10.5, w: 3.6, h: 2.6, d: 3 }));
      L.add(P.cheese({ x: -8, y: 0, z: 10.5, w: 3.6, h: 2.6, d: 3 }));
      L.add(P.jellyBlock({ x: -18.5, y: 0, z: 0, w: 3, h: 1.2, d: 4.5, color: '#ff4f7f' }));
      L.add(P.jellyBlock({ x: 18.5, y: 0, z: 0, w: 3, h: 1.2, d: 4.5, color: '#7ad04a' }));
      L.add(P.bread({ x: 0, y: 0, z: -8, w: 8, h: 2, d: 2.4 }));
      L.add(P.bread({ x: 0, y: 0, z: 8, w: 8, h: 2, d: 2.4 }));
      L.add(P.candle({ x: -20, y: 0, z: -12.5, r: 0.9, h: 4, light: true }));
      L.add(P.candle({ x: 20, y: 0, z: 12.5, r: 0.9, h: 4, light: true }));
      L.add(P.bottle({ x: 20.2, y: 0, z: -12.6, r: 1.2, h: 6, color: '#2f5a8a', label: 'КВАС' }));
      L.add(P.bottle({ x: -20.2, y: 0, z: 12.6, r: 1.2, h: 6, color: '#7a2a3a', label: 'СОУС' }));
      // the winners' podium on the floor
      PODIUM.forEach(([x, z, h], i) => L.add(P.crate({ x, y: -18, z, w: 3.3, h, d: 3, label: String(i + 1) })));
      L.add(P.rug({ x: 0, y: -18, z: 26, w: 16, d: 9, color: '#8a1a2a' }));
    },
  };
}

interface Crumb { id: number; big: boolean; vel: THREE.Vector3; p: Pickup3; landed: boolean; t: number; delay: number; asked: number }

type Phase = 'wait' | 'count' | 'play' | 'end';
/** the real save.write while a round lends the kit */
const SaveWrite: { orig: (() => void) | null } = { orig: null };
/** the round's kit — the same for everyone, whatever each one unlocked solo: double jump, slingshot and dash (to chase
 *  and to dodge), no fork; and no wind cloak (it gives a second air dash and a shorter dash cooldown) */
const KIT: typeof save.data.abilities = { doubleJump: true, slingshot: true, dash: true, fork: false };

const COLS: BoardCol[] = [{ label: 'Крошки', w: 90 }, { label: 'Удары', w: 80 }, { label: 'Выбито', w: 86 }, { label: 'Столкнул', w: 96 }, { label: 'Падения', w: 90 }];
const FAR = new THREE.Vector3(0, -999, 0);
const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const tmp3 = new THREE.Vector3();

class PvpPlugin implements LevelPlugin {
  phase: Phase = 'wait';
  t0 = 0;
  rows = new Map<string, PvpRow>();
  crumbs = new Map<number, Crumb>();
  rank: string[] = [];
  private seq = 1;
  private t = 0;
  private inbox: { type: string; d: any; from: string }[] = [];
  private unsubs: (() => void)[] = [];
  private spawnQ: number[][] = [];
  private spawnT = 0;
  private sendT = 0;
  private dirty = false;
  private lastHp = 0;
  // hits (see the top comment)
  /** every hero's recent positions as this machine shows them (net time) */
  private hist = new Map<string, Sample[]>();
  /** net time until which a hero can't be shoved (the host decides; everyone learns it from bonk / fell) */
  private shield = new Map<string, number>();
  /** attacker: rivals I just hit (my claim is on its way) — not claimed again until then */
  private guard = new Map<string, number>();
  /** net time of the last confirmed hit on each hero (a rival's swing at the same moment still counts as a hit) */
  private hitAt = new Map<string, number>();
  /** host: the last shove each hero took {by, net time} (fall credit) */
  private lastBy = new Map<string, { a: string; t: number }>();
  /** host: claims already judged; attacker: (swing, rival) pairs already claimed */
  private judged = new Set<string>();
  private claimed = new Set<string>();
  /** host: claims waiting for my record of the victim to catch up */
  private pending: { att: string; d: Claim; at: number }[] = [];
  /** host: confirmed hits per attacker (net times, last second) */
  private rate = new Map<string, number[]>();
  /** victim: bonks already applied (host id : bonk id) */
  private applied = new Set<string>();
  private bonkSeq = 1;
  private peaSeq = 1;
  private myPeas = new WeakMap<Shot3, MyPea>();
  /** my last fall (net time): claims about where I stood before it don't shove me again */
  private fellAt = -1e9;
  private hurtBy: HurtBy | null = null;
  /** attacker: hit markers on rivals (white = sent, gold = confirmed) */
  private marks: { id: string; t: number; ok: boolean; atk: string }[] = [];
  /** attacker: a rival's puppet flinches from my hit before his own stream shows it */
  private nudges = new Map<string, { x: number; z: number; t: number }>();
  /** dev counters (testkit / QA): claims sent, judged ok, rejected by reason */
  stats = { sent: 0, ok: 0, assist: 0, no: {} as Record<string, number>, shoved: 0, ignored: 0 };
  private endT = 0;
  private left = false;
  private prize = 0;
  private showers = new Set<number>();
  private boardK = 0;
  private lastBeep = -1;
  private myPulse = 0;
  private lastMine = 0;
  /** my own abilities / wind cloak, set aside for the round */
  private abil: typeof save.data.abilities;
  private cloak: boolean;
  private kitLent = false;
  private confT = 0;

  constructor(private L: Level3D) {
    // everyone plays with the same kit for the round (given back on the way out; never saved)
    this.abil = { ...save.data.abilities };
    this.cloak = save.data.upgrades.windCloak;
    Object.assign(save.data.abilities, KIT);
    save.data.upgrades.windCloak = false;
    this.kitLent = true;
    const write = SaveWrite.orig ??= save.write;
    save.write = () => {
      const lent = { ...save.data.abilities }, cloak = save.data.upgrades.windCloak;
      if (this.kitLent) { Object.assign(save.data.abilities, this.abil); save.data.upgrades.windCloak = this.cloak; }
      try { write.call(save); } finally { if (this.kitLent) { Object.assign(save.data.abilities, lent); save.data.upgrades.windCloak = cloak; } }
    };
    // no hearts or bank crumbs in this mode: the HUD shows only toasts / banners, we draw the rest
    const hud = L.hud;
    const hudDraw = hud.draw.bind(hud);
    hud.draw = (ctx, p, t) => hudDraw(ctx, p, t, 0);
    // rivals are hittable — by MY swings only (host: Level3D.resolveMelee; client: predictMelee → predictHit); a
    // friend's swing that the host resolves (L.attacker set) is his to claim. Peas: trackPeas(). The slingshot locks on.
    const hit: Hittable3 & { predictHit(L: Level3D, c: THREE.Vector3, range: number, dir?: THREE.Vector3, half?: number, atkId?: number, kind?: string): boolean } = {
      meleeHit: (_L, c, dir, range, _dmg, atkId, kind) => !L.attacker && this.claimMelee(c, dir, range, HALF[kind] ?? HALF.sword, atkId, kind),
      predictHit: (_L, c, range, dir, half, atkId, kind) => !!dir && this.claimMelee(c, dir, range, half ?? HALF[kind ?? 'sword'] ?? HALF.sword, atkId ?? 0, kind ?? 'sword'),
      shotHit: () => false,
    };
    L.hittables.push(hit);
    for (let i = 0; i < 5; i++) L.extraTargets.push(() => this.rivalPoint(i));
    this.unsubs.push(net.on(MSG.pvp, (d, from) => this.inbox.push({ type: MSG.pvp, d, from })));
    // the host left mid-round: the new host (me) carries the round on instead of the co-op restart from the candle
    const flow = coopFlow as unknown as { takeOver?: () => void };
    const orig = (Object.getPrototypeOf(coopFlow) as { takeOver?: () => void }).takeOver;
    if (typeof orig === 'function') {
      const mine = () => { if (this.phase !== 'wait' && net.isHost) this.takeOver(); else orig.call(coopFlow); };
      flow.takeOver = mine;
      this.unsubs.push(() => { if (flow.takeOver === mine) delete flow.takeOver; });
    }
    this.placeMe();
  }

  private row(id: string) { let r = this.rows.get(id); if (!r) { r = blank(); this.rows.set(id, r); } return r; }

  /** my starting spot (by sorted member id, the same on every machine) */
  private placeMe() {
    const L = this.L;
    const ids = [...net.members.keys()].sort();
    const [x, z] = SLOTS[Math.max(0, ids.indexOf(net.myId)) % SLOTS.length];
    const gy = L.phys.groundAt(x, z, 10, 0.3);
    const yaw = Math.atan2(-x, -z);
    L.player.reset(new THREE.Vector3(x, (gy > -1e8 ? gy : 0) + 0.2, z), yaw);
    L.player.lid = false;
    L.tcam.yaw = yaw + Math.PI;
    L.tcam.snap(L.player.pos);
    this.lastHp = L.player.hp;
  }

  private rivalPoint(i: number) {
    if (this.phase !== 'play' || !this.L.nl) return FAR;
    let k = 0;
    for (const r of this.L.nl.remotes.values()) {
      if (r.hidden || r.dead || r.downed || r.stale) continue;
      if (k++ === i) return r.center();
    }
    return FAR;
  }

  /** a hero by id (me or a friend's puppet) */
  private hero(id: string): HeroLike | null { return id === net.myId ? this.L.player : this.L.remote(id) ?? null; }
  /** out of the game for hits: dead, downed, hidden, or his stream went quiet */
  private out(h: HeroLike) { return h.dead || h.downed || h.hidden || !!(h as { stale?: boolean }).stale; }
  private remember(set: Set<string>, key: string, max = 256) {
    set.add(key);
    if (set.size > max) set.delete(set.values().next().value as string);
  }

  // ───────────────────────── position history (every machine, every hero) ─────────────────────────
  /** how far behind his real self hero `id` is drawn here (s): the one-way trip + his stream's playback delay */
  private viewLag(id: string): number {
    if (id === net.myId) return 0;
    const ping = net.members.get(id)?.ping ?? -1;
    const delay = (this.L.remote(id) as unknown as { clock?: { delay?: number } } | undefined)?.clock?.delay;
    return (ping > 0 ? Math.min(0.5, ping / 2000) : 0.05) + (typeof delay === 'number' && isFinite(delay) ? clamp(delay, 0, 1) : VIEW_LAG);
  }

  /** what this machine shows of every hero, stamped with the hero's OWN time (net time − my view lag of him) */
  private record(now: number) {
    const add = (id: string, p: THREE.Vector3) => {
      let h = this.hist.get(id);
      if (!h) { h = []; this.hist.set(id, h); }
      const last = h[h.length - 1];
      h.push({ t: Math.max(now - this.viewLag(id), last ? last.t + 1e-4 : -Infinity), x: p.x, y: p.y, z: p.z });
      while (h.length > 2 && h[0].t < now - HIST_T) h.shift();
    };
    add(net.myId, this.L.player.pos);
    for (const r of this.L.nl!.remotes.values()) add(r.id, r.pos);
    for (const id of this.hist.keys()) if (id !== net.myId && !this.L.remote(id)) this.hist.delete(id);
  }

  /** smallest horizontal distance from p to where hero `id` was (on this machine's record) between t0 and t1;
   *  Infinity when the height is off by more than SLACK_Y or nothing is known */
  private histDist(id: string, p: THREE.Vector3, t0: number, t1: number) {
    const h = this.hist.get(id);
    if (!h || !h.length) return Infinity;
    const seg = (a: Sample, b: Sample) => {
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
      const u = l2 > 1e-8 ? clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2, 0, 1) : 0;
      if (Math.abs(p.y - (a.y + (b.y - a.y) * u)) > SLACK_Y) return Infinity;
      return Math.hypot(p.x - a.x - dx * u, p.z - a.z - dz * u);
    };
    // from the last sample before the window (the segment into it) to the last one inside it
    let i = 0;
    while (i < h.length - 1 && h[i + 1].t < t0) i++;
    let best = Infinity;
    for (; i < h.length && h[i].t <= t1; i++) best = Math.min(best, seg(h[i], h[i + 1] && h[i + 1].t <= t1 + 0.05 ? h[i + 1] : h[i]));
    return best;
  }

  // ───────────────────────── hits: the attacker's side ─────────────────────────
  /** a rival I may hit on my screen right now */
  private canHit(r: RemoteHero3, now: number) {
    return !this.out(r) && r.invuln <= 0 && (this.shield.get(r.id) ?? 0) <= now && (this.guard.get(r.id) ?? 0) <= now;
  }
  /** I can land hits: the round is on and I'm in it */
  private canAttack() {
    const p = this.L.player;
    return this.phase === 'play' && !!this.L.nl && !p.dead && !p.downed && !p.hidden;
  }

  /** my swing (called every frame of its window): does it connect with a rival puppet on MY screen? */
  private claimMelee(c: THREE.Vector3, dir: THREE.Vector3, range: number, half: number, atkId: number, kind: string): boolean {
    if (!this.canAttack()) return false;
    const now = net.time();
    const cosH = Math.cos(half);
    let hit = false;
    for (const r of this.L.nl!.remotes.values()) {
      if (!this.canHit(r, now)) continue;
      const key = atkId + ':' + r.id;
      if (this.claimed.has(key)) continue;
      tmp.copy(r.center()).sub(c);
      const dy = tmp.y; tmp.y = 0;
      const d = tmp.length();
      if (d > range + r.body.r + 0.2 || Math.abs(dy) > 1.6) continue;
      if (half < Math.PI && d > 0.3 && tmp2.copy(tmp).normalize().dot(dir) < cosH) continue;
      this.remember(this.claimed, key, 128);
      const push = d > 0.3 ? tmp.normalize() : tmp.set(dir.x, 0, dir.z).normalize();
      this.claim({ v: r.id, k: kind, a: atkId, c: v3(c), d: [r3(dir.x), r3(dir.z)], p: v3(r.pos), tm: r3(now), vl: r3(this.viewLag(r.id)) }, r, push);
      hit = true;
    }
    return hit;
  }

  /** my peas in flight (host: the real ones I fired; client: my look-alike copies) against the rival puppets I show */
  private trackPeas(dt: number) {
    const L = this.L;
    const now = net.time();
    const can = this.canAttack();
    for (const s of L.shots) {
      if (s.dead || s.kind !== 'pea' || s.owner !== 'player') continue;
      const mine = net.isHost ? !s.visual && s.shooter === null : s.visual && s.shooter === net.myId;
      if (!mine) continue;
      let m = this.myPeas.get(s);
      if (!m) { m = { id: this.peaSeq++, f: s.pos.clone(), v: s.vel.clone(), t: 0, prev: s.pos.clone() }; this.myPeas.set(s, m); continue; }
      m.t += dt;
      if (can) for (const r of L.nl!.remotes.values()) {
        if (!this.canHit(r, now)) continue;
        // closest point of this frame's flight segment to his centre
        const c = r.center(tmp3);
        tmp.copy(s.pos).sub(m.prev);
        const l2 = tmp.lengthSq();
        const u = l2 > 1e-8 ? clamp(tmp2.copy(c).sub(m.prev).dot(tmp) / l2, 0, 1) : 1;
        const q = tmp2.copy(m.prev).addScaledVector(tmp, u);
        if (Math.hypot(q.x - c.x, q.z - c.z) > r.body.r + s.r + 0.15 || Math.abs(q.y - c.y) > 0.75) continue;
        const ft = Math.max(0, m.t - (1 - u) * dt);
        const push = tmp.set(m.v.x, 0, m.v.z).normalize();
        this.claim({ v: r.id, k: 'pea', a: m.id, c: v3(q), p: v3(r.pos), tm: r3(now), vl: r3(this.viewLag(r.id)), f: v3(m.f), vv: v3(m.v), ft: r3(ft) }, r, push);
        s.pop(L);
        L.scene.remove(s.obj);
        break;
      }
      m.prev.copy(s.pos);
    }
  }

  /** I hit rival r (on my screen): show it now, send the claim (the host judges its own at once) */
  private claim(d: Claim, r: RemoteHero3, push: THREE.Vector3) {
    const L = this.L;
    const now = net.time();
    this.guard.set(r.id, now + SHIELD);
    this.stats.sent++;
    // the rival flinches on my screen right away (his own stream shows the real shove a moment later)
    const anim = (r as unknown as { anim?: { flash: number } }).anim;
    if (anim) anim.flash = 1;
    r.kick(0.72);
    const pw = POWER[d.k] ?? 1;
    this.nudges.set(r.id, { x: push.x * 0.5 * pw, z: push.z * 0.5 * pw, t: 0.25 });
    const at = r.center(tmp3);
    L.fx.sparks(at.clone(), 8, ['#ffffff', '#ffd34a', '#ffb070']);
    if (this.row(r.id).c > 0) L.fx.chunks(at.clone(), 4, ['#f0b850', '#e8a850', '#fff3d8'], r.pos.y, [0.06, 0.1]);
    this.marks.push({ id: r.id, t: 0, ok: false, atk: d.k + d.a });
    if (this.marks.length > 6) this.marks.shift();
    if (d.k === 'pea' || net.isHost) audio.sfx('hit', { pitch: rand(1.05, 1.25), volume: 0.6 });
    input.rumble(0.2, 0.15, 80);
    if (net.isHost) this.pending.push({ att: net.myId, d, at: now });
    else net.send('host', MSG.pvp, { t: 'hit', ...d });
  }

  // ───────────────────────── hits: the host judges ─────────────────────────
  /** host: claims wait until my record of the victim reaches the moment the attacker saw (≤ 0.5 s) */
  private judgeDue(now: number) {
    if (!this.pending.length) return;
    const wait: typeof this.pending = [];
    for (const c of this.pending) {
      const T = num(c.d.tm) - Math.min(clamp(num(c.d.vl), 0, 1), REWIND);
      const h = this.hist.get(String(c.d.v));
      const last = h && h.length ? h[h.length - 1].t : -Infinity;
      if (last >= T - 0.02 || now - c.at > 0.5 || !h) this.judge(c.att, c.d);
      else wait.push(c);
    }
    this.pending = wait;
  }

  private judge(att: string, d: Claim) {
    const why = this.check(att, d, net.time());
    if (!why) { this.stats.ok++; this.bonk(att, d); return; }
    if (why === 'assist') {
      // he swung at the same moment as the one whose hit shoved the victim: a hit for him too (one shove, one spill)
      this.stats.assist++;
      this.row(att).h++;
      this.dirty = true;
      if (att === net.myId) this.confirmed(String(d.v));
      else net.send(att, MSG.pvp, { t: 'ok', v: String(d.v) });
      return;
    }
    this.stats.no[why] = (this.stats.no[why] ?? 0) + 1;
    if (att === net.myId) this.missed(String(d.v), d.k + num(d.a));
    else net.send(att, MSG.pvp, { t: 'miss', v: String(d.v), a: d.k + num(d.a), why });
  }

  /** why a claim doesn't stand ('' = it does) */
  private check(att: string, d: Claim, now: number): string {
    if (this.phase !== 'play') return 'phase';
    const vid = String(d.v ?? ''), kind = String(d.k ?? '');
    if (!vid || vid === att) return 'self';
    const A = this.hero(att), V = this.hero(vid);
    if (!A || !V) return 'gone';
    if (this.out(A) || this.out(V)) return 'out';
    const tm = num(d.tm);
    if (now - tm > MAX_AGE || tm - now > 0.3) return 'old';
    const key = att + ':' + (kind === 'pea' ? 'p' + num(d.a) : 'm' + num(d.a) + ':' + vid);
    if (this.judged.has(key)) return 'dup';
    this.remember(this.judged, key);
    const rate = (this.rate.get(att) ?? []).filter((t) => t > now - 1);
    this.rate.set(att, rate);
    if (rate.length >= RATE) return 'rate';
    const P = vec(d.p), C = vec(d.c);
    if (!P || !C) return 'bad';
    const pc = tmp3.copy(P).setY(P.y + 0.5);
    let atkAt: THREE.Vector3, atkT: number;
    if (kind === 'pea') {
      // the pea's own flight must pass the hit point at the claimed time, and the hit point must touch him
      const F = vec(d.f), VV = vec(d.vv, tmp2), ft = num(d.ft);
      if (!F || !VV || ft < 0 || ft > 1.6 || VV.length() > 40) return 'bad';
      const ex = F.clone().addScaledVector(VV, ft).setY(F.y + VV.y * ft - 0.5 * PEA_G * ft * ft);
      if (ex.distanceTo(C) > 0.8) return 'path';
      if (Math.hypot(C.x - pc.x, C.z - pc.z) > V.body.r + 0.12 + 0.15 + 0.3 || Math.abs(C.y - pc.y) > 1) return 'reach';
      atkAt = F.setY(F.y - 0.65); atkT = tm - ft;
    } else {
      const range = RANGE[kind], half = HALF[kind];
      if (range === undefined || !Array.isArray(d.d)) return 'bad';
      tmp.copy(pc).sub(C);
      const dy = tmp.y; tmp.y = 0;
      const dist = tmp.length();
      if (dist > range + V.body.r + 0.2 + 0.3 || Math.abs(dy) > 1.8) return 'reach';
      const dir = tmp2.set(num(d.d[0]), 0, num(d.d[1]));
      if (half < Math.PI && dist > 0.5 && dir.lengthSq() > 0.01 && tmp.normalize().dot(dir.normalize()) < Math.cos(Math.min(Math.PI, half + 0.2))) return 'reach';
      atkAt = C.setY(C.y - 0.5); atkT = tm;
    }
    // the attacker stood there (my record of him may end before that moment: he could have run there since)
    const ha = this.hist.get(att);
    const since = clamp(atkT - (ha && ha.length ? ha[ha.length - 1].t : atkT), 0, 0.6);
    if (this.histDist(att, atkAt, atkT - REWIND - 0.1, now) > ATK_SLACK + since * 8) return 'attacker';
    // the victim really was near that spot when the attacker's screen showed him there (rewound ≤ REWIND)
    const T = tm - Math.min(clamp(num(d.vl), 0, 1), REWIND);
    if (this.histDist(vid, P, T - TOL, T + TOL) > SLACK) return 'victim';
    // shielded (just shoved / just fell): no second shove — but a swing from the same moment as that shove is a hit too
    if ((this.shield.get(vid) ?? 0) > now) return tm <= (this.hitAt.get(vid) ?? -1e9) + 0.05 && this.lastBy.get(vid)?.a !== att ? 'assist' : 'shield';
    return '';
  }

  /** host: a confirmed hit — his crumbs fly out, everyone hears of it, his own machine shoves him */
  private bonk(att: string, d: Claim) {
    const L = this.L;
    const now = net.time();
    const vid = String(d.v), kind = String(d.k);
    const V = this.hero(vid)!;
    (this.rate.get(att) ?? this.rate.set(att, []).get(att)!).push(now);
    // pushed away from the swing (as the attacker saw it) / along the pea's flight
    const P = vec(d.p)!, C = vec(d.c)!;
    const push = kind === 'pea' ? (vec(d.vv) ?? tmp.set(0, 0, 1)).setY(0) : P.clone().sub(C).setY(0);
    if (push.lengthSq() < 0.01 && Array.isArray(d.d)) push.set(num(d.d[0]), 0, num(d.d[1]));
    if (push.lengthSq() < 0.01) push.set(0, 0, 1);
    push.normalize();
    const pw = POWER[kind] ?? 1;
    const v = this.row(vid), a = this.row(att);
    const n = Math.min(v.c, 8, Math.max(1, Math.round((1 + v.c * 0.12) * pw)));
    v.c -= n; a.h++; a.k += n;
    this.dirty = true;
    const at = V.pos.clone().setY(V.pos.y + 1);
    for (let i = 0; i < n; i++) {
      const ang = rand(0, Math.PI * 2), sp = rand(3, 6);
      this.addCrumb(this.seq++, false, at.clone(), new THREE.Vector3(Math.cos(ang) * sp, rand(6, 9), Math.sin(ang) * sp), 0.55, true);
    }
    const msg = { t: 'bonk', id: this.bonkSeq++, v: vid, a: att, k: kind, n, d: [r3(push.x), r3(push.z)], pw, tm: r3(num(d.tm)) };
    net.send('all', MSG.pvp, msg);
    this.onBonk(msg, net.myId);
  }

  // ───────────────────────── hits: everyone hears the verdict ─────────────────────────
  private onBonk(d: { id?: unknown; v?: unknown; a?: unknown; k?: unknown; n?: unknown; d?: unknown; pw?: unknown; tm?: unknown }, from: string) {
    const L = this.L;
    const now = net.time();
    const vid = String(d.v), att = String(d.a), n = num(d.n), kind = String(d.k);
    this.shield.set(vid, Math.max(this.shield.get(vid) ?? 0, now + SHIELD));
    this.lastBy.set(vid, { a: att, t: now });
    this.hitAt.set(vid, now);
    const dd = Array.isArray(d.d) ? d.d : [0, 1];
    const push = new THREE.Vector3(num(dd[0]), 0, num(dd[1]));
    if (push.lengthSq() < 0.01) push.set(0, 0, 1);
    push.normalize();
    let at: THREE.Vector3;
    if (vid === net.myId) { at = L.player.pos.clone(); this.shoveMe(att, push, num(d.pw) || 1, num(d.tm), n, from + ':' + num(d.id)); }
    else {
      const r = L.remote(vid);
      at = r ? r.pos.clone() : new THREE.Vector3();
      // somebody else's hit: the puppet flinches here too (mine already did when I swung)
      if (r && att !== net.myId) { r.kick(0.75); const anim = (r as unknown as { anim?: { flash: number } }).anim; if (anim) anim.flash = 1; }
    }
    // a pea: its copy here flew a little behind him (he has moved on since the shooter saw him) — it splats on him
    if (kind === 'pea' && att !== net.myId) this.peaSplat(at.clone().setY(at.y + 0.5));
    if (att === net.myId) this.confirmed(vid);
    this.bonkFx(vid, att, n, at.setY(at.y + 1), kind);
  }

  /** the host confirmed that `att` hit ME: my own machine shoves me (my physics stay mine) */
  private shoveMe(att: string, push: THREE.Vector3, pw: number, tm: number, n: number, key: string) {
    const L = this.L, p = L.player;
    if (this.applied.has(key)) return;
    this.remember(this.applied, key, 64);
    this.hurtBy = { a: att, t: 0, n, fell: false };
    if (this.phase !== 'play' || p.dead || p.downed || p.hidden) return;
    // he saw where I stood before I fell off and came back: that's not where I am now
    if (tm < this.fellAt + FALL_SHIELD) { this.stats.ignored++; return; }
    // the host confirmed it: a dash or my own blinking doesn't dodge it (his screen showed neither yet)
    if (p.dashT > 0) { p.dashT = 0; p.body.gravity = 32; }
    p.invuln = 0;
    const knock = new THREE.Vector3(push.x * 10 * pw, 6 + 2 * pw, push.z * 10 * pw);
    if (p.hurt(L, 0, tmp.copy(p.pos).sub(push), knock, 0.45)) this.stats.shoved++;
    p.invuln = SHIELD;
  }

  /** a confirmed pea hit: the nearest look-alike pea pops and splats on the victim */
  private peaSplat(c: THREE.Vector3) {
    const L = this.L;
    let best: Shot3 | null = null, bd = 5;
    for (const s of L.shots) {
      if (s.dead || s.kind !== 'pea' || this.myPeas.has(s)) continue;
      const d = s.pos.distanceTo(c);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) { best.pop(L); L.scene.remove(best.obj); }
    L.fx.emit(c, { count: 10, speed: [1, 3.5], life: [0.2, 0.45], size: [0.06, 0.11], colors: ['#7ad04a', '#c8f0a0', '#ffffff'], g: 10 });
  }

  /** host confirmed my hit on vid: the marker turns gold */
  private confirmed(vid: string) {
    for (const m of this.marks) if (m.id === vid && !m.ok) { m.ok = true; m.t = Math.min(m.t, 0.05); }
  }

  /** host said my claim didn't stand: the marker fades out */
  private missed(vid: string, atk: string) {
    this.guard.delete(vid);
    for (const m of this.marks) if (m.id === vid && m.atk === atk && !m.ok) m.t = Math.max(m.t, 0.4);
  }

  private bonkFx(vid: string, att: string, n: number, at: THREE.Vector3, kind: string) {
    const L = this.L;
    audio.sfx('bounce', { pitch: 0.8, volume: 0.6 });
    if (n > 0) L.fx.text(at.clone().setY(at.y + 0.8), `−${n}`, '#ffb070', 24);
    if (vid === net.myId) input.rumble(0.5, 0.4, 160);
    else if (att === net.myId) input.rumble(0.2, 0.15, 80);
    if (n >= 3) {
      const w = `${n} ${crumbsWord(n)}`;
      if (vid === net.myId) L.feed(`${this.name(att)} выбил у тебя ${w}!`, '#ff9a8a');
      else if (att === net.myId) L.feed(`Ты выбил ${w}! (${this.name(vid)})`, '#ffe14a');
      else L.feed(`${this.name(vid)} теряет ${w} — ${kind === 'pea' ? 'горошина' : 'удар'} от: ${this.name(att)}`, '#ffc870');
    }
  }

  private name(id: string) { return id === net.myId ? 'Ты' : net.members.get(id)?.name ?? this.L.remote(id)?.name ?? '?'; }

  /** the host left mid-round and I'm the new host: carry on with the same round */
  private takeOver() {
    const left = this.t0 + ROUND - net.time();
    // crumb showers that already fell don't fall again
    for (const at of [60, 20]) if (left < at) this.showers.add(at);
    this.dirty = true;
    this.L.hud.toast('Хозяин вышел — теперь хозяин ты. Раунд продолжается!', 3);
  }

  // ───────────────────────── crumbs ─────────────────────────
  private addCrumb(id: number, big: boolean, pos: THREE.Vector3, vel: THREE.Vector3, delay: number, share: boolean) {
    const L = this.L;
    if (this.crumbs.has(id)) return this.crumbs.get(id)!;
    const p = new Pickup3(big ? 'bigcrumb' : 'crumb', pos);
    p.obj.scale.setScalar(1.4);
    L.scene.add(p.obj);
    if (p.blob) L.scene.add(p.blob);
    const c: Crumb = { id, big, vel, p, landed: false, t: 0, delay, asked: 0 };
    this.crumbs.set(id, c);
    this.seq = Math.max(this.seq, id + 1);
    if (share && net.isHost) this.spawnQ.push([id, big ? 1 : 0, r2(pos.x), r2(pos.y), r2(pos.z), r2(vel.x), r2(vel.y), r2(vel.z), delay]);
    return c;
  }

  private removeCrumb(id: number) {
    const c = this.crumbs.get(id);
    if (!c) return null;
    this.crumbs.delete(id);
    this.L.scene.remove(c.p.obj);
    if (c.p.blob) this.L.scene.remove(c.p.blob);
    return c;
  }

  /** host: a new crumb falls somewhere on the table */
  private spawnCrumb(shower = false) {
    const L = this.L;
    for (let tries = 0; tries < 10; tries++) {
      const x = rand(-20.5, 20.5), z = rand(-13.8, 13.8);
      const gy = L.phys.groundAt(x, z, 14, 0.15);
      if (gy < -1 || gy > 4.6) continue;
      const big = Math.random() < (shower ? 0.15 : 0.07);
      this.addCrumb(this.seq++, big, new THREE.Vector3(x, gy + (shower ? rand(10, 16) : rand(6, 9)), z), new THREE.Vector3(), 0, true);
      return;
    }
  }

  /** every machine flies every crumb the same way */
  private simCrumbs(dt: number) {
    const L = this.L;
    const pc = L.player.center();
    for (const c of this.crumbs.values()) {
      c.t += dt;
      const p = c.p;
      if (c.asked > 0) { c.asked -= dt; if (c.asked <= 0) { p.obj.visible = true; if (p.blob) p.blob.visible = true; } }
      if (!c.landed) {
        c.vel.y -= 24 * dt;
        p.pos.addScaledVector(c.vel, dt);
        const gy = L.phys.groundAt(p.pos.x, p.pos.z, p.pos.y + 0.6, 0.12);
        if (gy > -1e8 && p.pos.y <= gy + 0.22 && c.vel.y <= 0) {
          p.pos.y = gy + 0.22; c.landed = true; c.vel.set(0, 0, 0);
          if (c.t > 0.2) L.fx.dust(p.pos.clone(), 2, '#fff3d8');
        }
        if (p.pos.y < -9) {
          if (net.isHost) { this.removeCrumb(c.id); net.send('all', MSG.pvp, { t: 'c-', id: c.id, by: '' }); }
          else { p.obj.visible = false; if (p.blob) p.blob.visible = false; }
          continue;
        }
      } else if (this.phase === 'play' && c.t > c.delay && c.asked <= 0) {
        // a little magnet toward me (looks only; the host still decides)
        const d = pc.distanceTo(p.pos);
        if (d < 2.2 && d > 0.05) p.pos.addScaledVector(tmp.copy(pc).sub(p.pos).setY(0).normalize(), Math.min(d, (8 + (2.2 - d) * 8) * dt));
      }
      p.obj.position.copy(p.pos);
      if (c.landed) p.obj.position.y += Math.sin(c.t * 3 + c.id) * 0.06 + 0.06;
      p.inner.rotation.y += dt * 2.5;
      if (p.blob) {
        const gy = L.phys.groundAt(p.pos.x, p.pos.z, p.pos.y + 0.2, 0.05);
        p.blob.visible = p.obj.visible && gy > -1e8;
        if (p.blob.visible) p.blob.position.set(p.pos.x, gy + 0.03, p.pos.z);
      }
      if (c.landed && c.big && Math.random() < dt * 3) L.fx.glow.emit(p.pos.clone().setY(p.pos.y + 0.3), { count: 1, speed: [0.2, 0.6], life: [0.4, 0.8], size: [0.05, 0.1], colors: ['#ffe0a0', '#ffffff'], g: -1 });
    }
  }

  /** my hero touches crumbs: the host takes them, a client asks */
  private pickup() {
    const L = this.L, p = L.player;
    if (p.dead || p.hidden) return;
    const pc = p.center();
    for (const c of [...this.crumbs.values()]) {
      if (c.t < c.delay || c.asked > 0) continue;
      if (pc.distanceTo(c.p.pos) > (c.big ? 1.5 : 1.25)) continue;
      if (net.isHost) this.award(net.myId, c);
      else {
        c.asked = 1.5;
        c.p.obj.visible = false;
        if (c.p.blob) c.p.blob.visible = false;
        audio.sfx('coin', { pitch: c.big ? 0.8 : 1 });
        net.send('host', MSG.pvp, { t: 'grab', id: c.id, at: [r2(pc.x), r2(pc.y), r2(pc.z)] });
      }
    }
  }

  /** host: crumb c goes to `by` */
  private award(by: string, c: Crumb) {
    this.removeCrumb(c.id);
    this.row(by).c += c.big ? 5 : 1;
    this.dirty = true;
    net.send('all', MSG.pvp, { t: 'c-', id: c.id, by });
    this.gotFx(c, by, false);
  }

  private gotFx(c: Crumb, by: string, heard: boolean) {
    const L = this.L;
    const at = c.p.pos.clone();
    L.fx.glow.emit(at, { count: c.big ? 10 : 5, speed: [0.5, 2], life: [0.2, 0.4], size: [0.05, 0.09], colors: ['#ffe0a0', '#ffffff'] });
    if (by === net.myId) {
      if (!heard) audio.sfx('coin', { pitch: c.big ? 0.8 : 1 });
      L.fx.text(at.setY(at.y + 0.6), c.big ? '+5' : '+1', '#ffe0a0', c.big ? 24 : 18);
    }
  }

  // ───────────────────────── falls / health ─────────────────────────
  private keepAlive() {
    const p = this.L.player;
    // PvP hits do no damage, so a lost heart means I fell off the table (back on it, minus some crumbs);
    // only my own physics can do that (a shove is applied here by me, never a position fix from the network)
    if (p.hp < this.lastHp && this.phase === 'play') {
      const now = net.time();
      this.fellAt = now;
      this.shield.set(net.myId, now + FALL_SHIELD);
      p.invuln = Math.max(p.invuln, FALL_SHIELD);
      if (net.isHost) this.applyFall(net.myId, now);
      else net.send('host', MSG.pvp, { t: 'fall', tm: r3(now) });
    }
    if (this.phase !== 'end') p.hp = p.maxHp;
    this.lastHp = p.hp;
    p.lid = false;
  }

  /** host: `id` fell off the table at net time tm — minus 3 crumbs; a rival's shove just before makes it his */
  private applyFall(id: string, tm: number) {
    const now = net.time();
    tm = clamp(tm || now, now - MAX_AGE, now);
    this.shield.set(id, Math.max(this.shield.get(id) ?? 0, tm + FALL_SHIELD));
    const lb = this.lastBy.get(id);
    const by = lb && lb.a !== id && tm - lb.t < PUSH_T && this.rows.has(lb.a) ? lb.a : '';
    this.lastBy.delete(id);
    const r = this.row(id);
    const n = Math.min(r.c, 3);
    r.c -= n; r.f++;
    if (by) this.row(by).s++;
    this.dirty = true;
    net.send('all', MSG.pvp, { t: 'fell', v: id, n, by });
    this.fellFx(id, n, by);
  }
  private fellFx(id: string, n: number, by: string) {
    const L = this.L;
    const now = net.time();
    this.shield.set(id, Math.max(this.shield.get(id) ?? 0, now + FALL_SHIELD));
    this.lastBy.delete(id);
    const minus = n ? ` (−${n})` : '';
    if (!by) { L.feed(id === net.myId ? `Ты свалился со стола${minus}` : `${this.name(id)} свалился со стола${minus}`, '#ff9a8a'); return; }
    if (id === net.myId) {
      L.feed(`${this.name(by)} столкнул тебя со стола!${minus}`, '#ff9a8a');
      this.hurtBy = { a: by, t: 0, n, fell: true };
    } else if (by === net.myId) {
      L.feed(`${this.name(id)} слетел со стола — твой толчок!`, '#ffe14a');
      L.hud.toast(`Ты столкнул со стола: ${this.name(id)}!`, 2);
    } else L.feed(`${this.name(id)} слетел со стола — толкнул ${this.name(by)}`, '#ffc870');
  }

  // ───────────────────────── messages ─────────────────────────
  private handle() {
    const msgs = this.inbox;
    this.inbox = [];
    const host = net.isHost;
    for (const m of msgs) {
      const d = m.d ?? {};
      const fromHost = m.from === net.hostId;
      switch (d.t) {
        case 'start': if (!host && fromHost) { this.t0 = num(d.t0); this.phase = 'count'; this.onStart(); } break;
        case 'c+':
          if (!host && fromHost && Array.isArray(d.l)) for (const a of d.l as number[][]) {
            this.addCrumb(a[0], !!a[1], new THREE.Vector3(a[2], a[3], a[4]), new THREE.Vector3(a[5], a[6], a[7]), a[8] ?? 0, false);
          }
          break;
        case 'c-': {
          if (host || !fromHost) break;
          const c = this.removeCrumb(num(d.id));
          if (c && d.by) this.gotFx(c, String(d.by), c.asked > 0);
          break;
        }
        case 'grab': {
          // first come, first served; the grabber says where he stood (it must agree with his streamed position)
          if (!host || this.phase !== 'play') break;
          const c = this.crumbs.get(num(d.id));
          const r = this.L.remote(m.from);
          if (!c || !r || c.t < c.delay - 0.15) break;
          const at = Array.isArray(d.at) ? tmp.set(num(d.at[0]), num(d.at[1]), num(d.at[2])) : tmp.copy(r.pos);
          if (at.distanceTo(c.p.pos) < 3.6 && at.distanceTo(r.pos) < 7) this.award(m.from, c);
          break;
        }
        case 'fall': if (host && this.phase === 'play' && this.L.remote(m.from)) this.applyFall(m.from, num(d.tm)); break;
        case 'fell': if (!host && fromHost) this.fellFx(String(d.v), num(d.n), d.by ? String(d.by) : ''); break;
        // hits: a claim to judge (host), the verdict (everyone), my claim didn't stand (attacker)
        case 'hit': if (host && this.L.remote(m.from)) this.pending.push({ att: m.from, d: d as Claim, at: net.time() }); break;
        case 'bonk': if (!host && fromHost) this.onBonk(d, m.from); break;
        case 'miss': if (fromHost) this.missed(String(d.v), String(d.a)); break;
        case 'ok': if (fromHost) this.confirmed(String(d.v)); break;
        case 'sc': if (!host && fromHost) this.applyRows(d.s); break;
        case 'shower': if (!host && fromHost) this.showerFx(); break;
        case 'end':
          if (!host && fromHost && this.phase !== 'end') {
            this.applyRows(d.s);
            this.rank = Array.isArray(d.rank) ? d.rank.map(String) : [];
            this.onEnd();
          }
          break;
      }
    }
  }

  private applyRows(s: unknown) {
    if (!Array.isArray(s)) return;
    for (const rec of s) {
      if (!Array.isArray(rec) || typeof rec[0] !== 'string') continue;
      const r = this.row(rec[0]);
      r.c = num(rec[1]); r.h = num(rec[2]); r.k = num(rec[3]); r.f = num(rec[4]); r.s = num(rec[5]);
    }
  }
  private pack() {
    return [...net.members.keys()].map((id) => { const r = this.row(id); return [id, r.c, r.h, r.k, r.f, r.s]; });
  }

  // ───────────────────────── round flow ─────────────────────────
  private onStart() {
    this.placeMe();
    this.L.player.control = false;
  }
  private onGo() {
    this.L.player.control = true;
    this.L.hud.showBanner('ВПЕРЁД!', '#ffd34a');
    audio.sfx('whoosh');
    audio.sfx('coin', { pitch: 1.5 });
  }
  private showerFx() {
    this.L.hud.toast('Крошкопад! Крошки сыплются с люстры!', 2.6);
    audio.sfx('crumble', { volume: 0.7 });
    this.L.tcam.shake(0.2);
  }

  private hostEnd() {
    const ids = [...net.members.keys()];
    ids.sort((a, b) => this.row(b).c - this.row(a).c || this.row(b).h - this.row(a).h || (a < b ? -1 : 1));
    this.rank = ids;
    net.send('all', MSG.pvp, { t: 'end', rank: ids, s: this.pack() });
    this.onEnd();
  }

  /** the round is over: winners onto the podium, confetti, a small prize */
  private onEnd() {
    const L = this.L;
    this.phase = 'end';
    this.endT = 0;
    for (const id of [...this.crumbs.keys()]) this.removeCrumb(id);
    this.restoreKit();
    const place = this.rank.indexOf(net.myId);
    this.prize = place === 0 ? 20 : place > 0 ? 5 : 0;
    if (this.prize) { save.data.crumbs += this.prize; save.write(); }
    // stand on my podium step (or in front of it)
    L.killY = -100;
    const p = L.player;
    let pos: THREE.Vector3;
    if (place >= 0 && place < 3) { const [x, z, h] = PODIUM[place]; pos = new THREE.Vector3(x, -18 + h + 0.05, z); }
    else { const i = Math.max(0, place - 3); pos = new THREE.Vector3(-3 + i * 3, -17.95, 28); }
    p.reset(pos, 0);
    p.control = false;
    p.forceState = place >= 0 && place < 3 ? 'cheer' : 'idle';
    p.expr = place === 0 ? 'happy' : undefined;
    L.tcam.beginCine();
    L.tcam.cineSmooth = 2.2;
    L.tcam.cinePos.set(0, -12.1, 32.6);
    L.tcam.cineLook.set(0, -15.1, 24);
    audio.sfx('victory');
    L.fx.chunks(new THREE.Vector3(0, -12.5, 24), 60, CONFETTI, -18, [0.12, 0.22]);
  }

  private updateEnd(dt: number) {
    const L = this.L;
    this.endT += dt;
    this.confT -= dt;
    if (this.confT <= 0 && this.endT < 9) {
      this.confT = 0.08;
      L.fx.chunks(new THREE.Vector3(rand(-6, 6), rand(-11, -9), rand(21.5, 26.5)), 5, CONFETTI, -18, [0.1, 0.2]);
      if (Math.random() < 0.3) L.fx.stars(new THREE.Vector3(rand(-4, 4), rand(-14, -12), rand(22, 26)), 6, CONFETTI);
    }
    // back to the room's lobby (the host decides; a client falls back if the host is gone)
    if (!this.left && ((net.isHost && this.endT > 10) || this.endT > 18)) {
      this.left = true;
      if (net.isHost && net.active) coopFlow.backToLobby();
      else (coopFlow as unknown as { toLobbyLocal?: () => void }).toLobbyLocal?.();
      if (!COOP_SCENES.lobby) game.toMenu();
    }
  }

  private restoreKit() {
    if (!this.kitLent) return;
    this.kitLent = false;
    Object.assign(save.data.abilities, this.abil);
    save.data.upgrades.windCloak = this.cloak;
    if (SaveWrite.orig) { save.write = SaveWrite.orig; SaveWrite.orig = null; }
  }

  // ───────────────────────── tick ─────────────────────────
  update(dt: number) {
    const L = this.L, nl = L.nl;
    if (!nl) return;
    this.t += dt;
    const now = net.time();
    this.record(now);
    this.handle();
    if (net.isHost && this.phase === 'wait' && !nl.waiting) {
      this.t0 = now + COUNT;
      this.phase = 'count';
      net.send('all', MSG.pvp, { t: 'start', t0: Math.round(this.t0 * 1000) / 1000 });
      this.onStart();
    }
    if (this.phase === 'count') {
      L.player.control = false;
      const sec = Math.ceil(this.t0 - now);
      if (sec !== this.lastBeep && sec >= 1 && sec <= 3) { this.lastBeep = sec; audio.sfx('menuMove', { pitch: 1 + (3 - sec) * 0.15 }); }
      if (now >= this.t0) { this.phase = 'play'; this.onGo(); }
    }
    if (this.phase === 'play') {
      const left = this.t0 + ROUND - now;
      const sec = Math.ceil(left);
      if (sec <= 10 && sec >= 1 && sec !== this.lastBeep) { this.lastBeep = sec; audio.sfx('menuMove', { pitch: 1.4, volume: 0.6 }); }
      if (sec === 30 && !this.showers.has(-30)) { this.showers.add(-30); L.hud.toast('Последние 30 секунд!', 2.4); }
      if (net.isHost) {
        const n = net.members.size;
        this.spawnT -= dt;
        if (this.crumbs.size < 10 + 3 * n && this.spawnT <= 0) { this.spawnT = rand(0.25, 0.55); this.spawnCrumb(); }
        for (const at of [60, 20]) if (left < at && !this.showers.has(at)) {
          this.showers.add(at);
          for (let i = 0; i < 10 + 2 * n; i++) this.spawnCrumb(true);
          net.send('all', MSG.pvp, { t: 'shower' });
          this.showerFx();
        }
        if (left <= 0) this.hostEnd();
      }
    }
    if (this.phase !== 'end') this.keepAlive();
    this.trackPeas(dt);
    if (net.isHost) this.judgeDue(now); else this.pending.length = 0;
    this.simCrumbs(dt);
    if (this.phase === 'play') this.pickup();
    if (net.isHost) {
      if (this.spawnQ.length) { net.send('all', MSG.pvp, { t: 'c+', l: this.spawnQ }); this.spawnQ = []; }
      this.sendT -= dt;
      if (this.dirty && this.sendT <= 0 && this.phase !== 'end') { this.dirty = false; this.sendT = 0.1; net.send('all', MSG.pvp, { t: 'sc', s: this.pack() }); }
    }
    if (this.phase === 'end') this.updateEnd(dt);
    this.hitFx(dt, now);
    // UI
    const mine = this.row(net.myId).c;
    if (mine > this.lastMine) this.myPulse = 1;
    this.lastMine = mine;
    this.myPulse = Math.max(0, this.myPulse - dt * 4);
    const held = input.down('score') && !L.paused && !input.suspended;
    this.boardK = clamp(this.boardK + (held ? dt * 6 : -dt * 8), 0, 1);
  }

  /** my hits' markers, the rival puppets' flinches, the "who hit me" arrow */
  private hitFx(dt: number, now: number) {
    for (const m of this.marks) m.t += dt;
    this.marks = this.marks.filter((m) => m.t < (m.ok ? 0.7 : 0.45));
    if (this.hurtBy) { this.hurtBy.t += dt; if (this.hurtBy.t > 2.2) this.hurtBy = null; }
    for (const [id, t] of this.guard) if (t <= now) this.guard.delete(id);
    // a rival who can't be shoved right now blinks at once (his own stream shows it a moment later)
    for (const r of this.L.nl!.remotes.values()) {
      if (Math.max(this.shield.get(r.id) ?? 0, this.guard.get(r.id) ?? 0) > now && !r.dead && !r.hidden) r.rig.root.visible = Math.floor(this.t * 14) % 2 === 0;
    }
    for (const [id, n] of this.nudges) {
      const r = this.L.remote(id);
      n.t -= dt;
      if (!r || n.t <= 0) { r?.rig.root.position.set(0, 0, 0); this.nudges.delete(id); continue; }
      // a quick shove of the model inside its root (the root follows his stream)
      const k = Math.sin((n.t / 0.25) * Math.PI) * 0.9 + n.t / 0.25 * 0.1;
      tmp.set(n.x * k, 0, n.z * k).applyAxisAngle(UP, -r.root.rotation.y);
      r.rig.root.position.set(tmp.x, 0.12 * k, tmp.z);
    }
  }

  dispose() {
    for (const [id] of this.nudges) this.L.remote(id)?.rig.root.position.set(0, 0, 0);
    this.nudges.clear();
    for (const u of this.unsubs) u();
    this.unsubs = [];
    for (const id of [...this.crumbs.keys()]) this.removeCrumb(id);
    this.restoreKit();
  }

  wantsInput() { return false; }

  // ───────────────────────── drawing ─────────────────────────
  private sorted() {
    const ids = [...net.members.keys()];
    return ids.sort((a, b) => this.row(b).c - this.row(a).c || this.row(b).h - this.row(a).h || (a < b ? -1 : 1));
  }

  draw(ctx: CanvasRenderingContext2D) {
    const L = this.L;
    if (!L.nl) return;
    const now = net.time();
    if (this.phase === 'end') this.drawEnd(ctx);
    else {
      const ids = this.sorted();
      const rows: MiniRow[] = ids.map((id, i) => {
        const m = net.members.get(id);
        return { name: m?.name ?? '?', color: m?.look?.tagColor || '#ffd34a', value: this.row(id).c, me: id === net.myId, crown: i === 0 && this.row(id).c > 0 };
      });
      drawMiniBoard(ctx, 20, 20, 'КРОШКИ', rows, L.t, 240);
      // timer + my crumbs
      const left = this.phase === 'play' ? Math.max(0, this.t0 + ROUND - now) : ROUND;
      const mm = Math.floor(Math.ceil(left) / 60), ss = Math.ceil(left) % 60;
      const hot = this.phase === 'play' && left <= 10;
      rrect(ctx, W / 2 - 86, 14, 172, 56, 18, 'rgba(26,14,22,0.8)', 3);
      ctx.save();
      ctx.translate(W / 2, 56);
      if (hot) { const s = 1 + (1 - (left % 1)) * 0.15; ctx.scale(s, s); }
      text(ctx, `${mm}:${String(ss).padStart(2, '0')}`, 0, 0, { size: 38, color: hot ? '#ff5a6a' : '#fff3d8', align: 'center', stroke: 6 });
      ctx.restore();
      const mine = this.row(net.myId).c;
      ctx.save();
      ctx.translate(W / 2, 104);
      const s = 1 + this.myPulse * 0.3;
      ctx.scale(s, s);
      drawCrumb(ctx, -34, -8, 1.7, L.t);
      text(ctx, String(mine), -12, 4, { size: 30, color: '#ffe0a0', stroke: 6 });
      ctx.restore();
      if (this.phase === 'count' || this.phase === 'wait') this.drawCount(ctx, now);
      else this.drawHits(ctx);
    }
    if (this.boardK > 0.01) {
      const rows: BoardRow[] = this.sorted().map((id, i) => {
        const m = net.members.get(id), r = this.row(id);
        return { id, name: m?.name ?? '?', color: m?.look?.tagColor || '#ffd34a', me: id === net.myId, crown: i === 0 && r.c > 0, host: !!m?.isHost, ping: m?.ping, cells: [r.c, r.h, r.k, r.s, r.f] };
      });
      drawScoreboard(ctx, { title: 'КРОШЕЧНАЯ ЛИХОРАДКА', sub: 'больше всех крошек к концу раунда — победа', cols: COLS, rows, k: this.boardK, t: L.t, ping: true, hold: 'score' });
    }
  }

  /** my hits (a cross on each rival I hit: white = sent, gold = the host confirmed) and who just hit me */
  private drawHits(ctx: CanvasRenderingContext2D) {
    const L = this.L, cam = L.tcam.cam;
    for (const m of this.marks) {
      const r = L.remote(m.id);
      if (!r) continue;
      const s = toUI(r.center(tmp), cam);
      if (!s.vis) continue;
      const a = clamp(1 - m.t / (m.ok ? 0.7 : 0.45), 0, 1);
      const sz = 13 + (1 - a) * 8 + (m.ok ? 5 : 0);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.lineCap = 'round';
      for (const [w, col] of [[8, 'rgba(26,14,22,0.85)'], [4, m.ok ? '#ffd34a' : '#ffffff']] as const) {
        ctx.lineWidth = w; ctx.strokeStyle = col;
        ctx.beginPath();
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.moveTo(s.x + dx * sz * 0.4, s.y + dy * sz * 0.4); ctx.lineTo(s.x + dx * sz, s.y + dy * sz); }
        ctx.stroke();
      }
      ctx.restore();
    }
    const hb = this.hurtBy;
    if (!hb) return;
    const m = net.members.get(hb.a);
    const col = m?.look?.tagColor || '#ff9a8a';
    const a = clamp(Math.min(hb.t / 0.12, (2.2 - hb.t) / 0.5), 0, 1);
    const who = this.name(hb.a);
    ctx.save();
    ctx.globalAlpha = a;
    const msg = hb.fell ? `${who} столкнул тебя со стола!` : `Тебя толкнул ${who}!${hb.n ? ` −${hb.n}` : ''}`;
    text(ctx, msg, W / 2, 158, { size: 26, color: col, align: 'center', stroke: 6 });
    // where he is: a marker over his head, or an arrow toward him from the middle of the screen
    const r = L.remote(hb.a);
    if (r && !r.hidden) {
      // (his nameplate sits at head height 1.55: the marker goes right above it)
      const s = toUI(tmp.copy(r.pos).setY(r.pos.y + 1.55), cam);
      if (s.vis && s.x > 40 && s.x < W - 40 && s.y > 80 && s.y < H - 40) {
        const bob = Math.sin(hb.t * 12) * 4, y = s.y - 30 + bob;
        ctx.fillStyle = col; ctx.strokeStyle = 'rgba(26,14,22,0.9)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(s.x - 13, y - 18); ctx.lineTo(s.x + 13, y - 18); ctx.lineTo(s.x, y); ctx.closePath();
        ctx.stroke(); ctx.fill();
      } else {
        cam.getWorldDirection(tmp2);
        const fl = Math.hypot(tmp2.x, tmp2.z) || 1, fx = tmp2.x / fl, fz = tmp2.z / fl;
        const vx = r.pos.x - cam.position.x, vz = r.pos.z - cam.position.z;
        const ang = Math.atan2(-vx * fz + vz * fx, vx * fx + vz * fz);
        const R = 170, x = W / 2 + Math.sin(ang) * R, y = H / 2 - Math.cos(ang) * R;
        ctx.translate(x, y); ctx.rotate(ang);
        ctx.fillStyle = col; ctx.strokeStyle = 'rgba(26,14,22,0.9)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(18, 6); ctx.lineTo(0, -2); ctx.lineTo(-18, 6); ctx.closePath();
        ctx.stroke(); ctx.fill();
        ctx.rotate(-ang);
        text(ctx, who, 0, 34, { size: 18, color: col, align: 'center', stroke: 5 });
      }
    }
    ctx.restore();
  }

  /** 3-2-1 and how to play */
  private drawCount(ctx: CanvasRenderingContext2D, now: number) {
    const L = this.L;
    if (this.phase === 'count') {
      const left = this.t0 - now;
      const sec = Math.ceil(left);
      if (sec >= 1 && sec <= 3) {
        const f = 1 - (left - Math.floor(left));
        const s = 1.6 - ease.outBack(clamp(f * 2.5, 0, 1)) * 0.6;
        ctx.save();
        ctx.globalAlpha = clamp((1 - f) * 3, 0, 1);
        ctx.translate(W / 2, H / 2 - 40); ctx.scale(s, s);
        text(ctx, String(sec), 0, 0, { size: 120, color: '#ffd34a', align: 'center', base: 'middle', stroke: 14 });
        ctx.restore();
      }
    } else text(ctx, 'Ждём остальных…', W / 2, H / 2 - 40, { size: 30, color: '#fff3d8', align: 'center', stroke: 6 });
    // rules card
    const y = H - 150;
    rrect(ctx, W / 2 - 330, y, 660, 120, 20, 'rgba(26,14,22,0.82)', 3);
    text(ctx, 'Собери больше всех крошек за 2 минуты!', W / 2, y + 32, { size: 21, color: '#ffd34a', align: 'center', stroke: 4 });
    drawHint(ctx, 'attack', 'удар — соперник роняет крошки', W / 2 - 300, y + 66, { size: 26 });
    drawHint(ctx, 'shoot', 'горохом издалека', W / 2 + 70, y + 66, { size: 26 });
    text(ctx, 'Упал со стола — минус 3 крошки. Большая корка — сразу 5!', W / 2, y + 104, { size: 17, font: 'body', color: '#d8c8c0', align: 'center' });
    void L;
  }

  /** podium overlay */
  private drawEnd(ctx: CanvasRenderingContext2D) {
    const L = this.L;
    const k = ease.outCubic(clamp(this.endT / 0.6, 0, 1));
    const win = this.rank[0];
    const wm = win ? net.members.get(win) : undefined;
    const g = ctx.createLinearGradient(0, 0, 0, 220);
    g.addColorStop(0, `rgba(20,8,14,${0.75 * k})`); g.addColorStop(1, 'rgba(20,8,14,0)');
    ctx.fillStyle = g; ctx.fillRect(-2000, -2000, W + 4000, 2220);
    ctx.save();
    ctx.globalAlpha = k;
    const s = 1 + (1 - ease.outBack(clamp(this.endT / 0.5, 0, 1))) * 0.8;
    ctx.translate(W / 2, 74); ctx.scale(s, s);
    text(ctx, win === net.myId ? 'ТЫ ПОБЕДИЛ!' : 'ПОБЕДИТЕЛЬ:', 0, 0, { size: 46, color: '#ffd34a', align: 'center', stroke: 9 });
    if (win !== net.myId) text(ctx, wm?.name ?? '?', 0, 50, { size: 40, weight: 700, color: wm?.look?.tagColor || '#ffd34a', align: 'center', stroke: 8 });
    ctx.restore();
    // the final table (bottom right)
    const ids = this.rank.length ? this.rank : this.sorted();
    const rows: MiniRow[] = ids.map((id, i) => {
      const m = net.members.get(id);
      return { name: m?.name ?? '?', color: m?.look?.tagColor || '#ffd34a', value: this.row(id).c, me: id === net.myId, crown: i === 0 };
    });
    ctx.save();
    ctx.globalAlpha = clamp((this.endT - 0.8) * 3, 0, 1);
    drawMiniBoard(ctx, W - 290, H - 80 - rows.length * 30 - 48, 'ИТОГ', rows, L.t, 270);
    if (this.prize) text(ctx, `+${this.prize} крошек в копилку`, W - 155, H - 40, { size: 20, color: '#ffe0a0', align: 'center', stroke: 5 });
    ctx.restore();
    if (this.endT > 3) text(ctx, 'Возвращаемся в комнату…', 30, H - 30, { size: 19, font: 'body', color: '#fff3d8', stroke: 4 });
    // the champion's crown
    const hero = win === net.myId ? L.player.pos : win ? L.remote(win)?.pos : undefined;
    if (hero && this.endT > 0.6) {
      const s2 = toUI(tmp.copy(hero).setY(hero.y + 1.9), L.tcam.cam);
      const a = ease.outBack(clamp((this.endT - 0.6) / 0.4, 0, 1));
      if (s2.vis) drawCrown(ctx, s2.x, s2.y - 6 + Math.sin(L.t * 3) * 3, 1.1 * a, L.t);
    }
  }
}

// the arena joins LEVELS3 and the plugin list at import time (after the module graph if there is a cycle)
const register = () => {
  LEVELS3[PVP_ID] = arena;
  LEVEL_PLUGINS.push((L) => (L.nl && L.def.id === PVP_ID ? new PvpPlugin(L) : null));
};
try { register(); } catch { queueMicrotask(register); }

// ───────────────────────── entering the mode ─────────────────────────
function enterPvp() {
  coop.started = true;
  net.setMeta({ ready: false, scene: 'lvl:' + PVP_ID });
  game.goNow(() => new Level3D(PVP_ID, coopFlow.step));
}

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  net.on(MSG.pvp, (d: { t?: string }, from: string) => { if (d?.t === 'go' && !net.isHost && from === net.hostId) enterPvp(); });
}
listen();

/**
 * Host (lobby button «Крошечная лихорадка»): everyone in the room goes to the PvP table for one round,
 * then back to the lobby. Returns false when not the host of a room.
 */
export function startPvp(): boolean {
  if (!net.active || !net.isHost) return false;
  net.setRoomState('playing');
  net.send('all', MSG.pvp, { t: 'go' });
  enterPvp();
  return true;
}
