import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { save } from '../../../../engine/save';
import { choose, clamp, damp, lerp, rand, W, H } from '../../../../engine/util';
import { rrect, text } from '../../../../art/draw';
import { net } from '../../../../net/session';
import { basic, noOutline } from '../../../gfx';
import { makeBlob } from '../../../fx';
import { createHeroModel, type HeroKind } from '../../../models/heroes';
import type { HeroRig, HeroAnim, HeroAtk } from '../../../models/hero';
import type { Level3D, Boss3Like, HeroLike, Hittable3, Npc3 } from '../../level';
import { Wave3, type Shot3 } from '../../objects';
import type { Netted } from '../../netLevel';
import { NetTrack, type NetPose } from '../../netInterp';
import { Tele, Stripe, uncaptured } from '../../bossParts';
import { coop } from '../../coop';
import { vampBane } from '../../heroes/bane';
import { vamp, isVamp, heroId, Invisibility, ambient, markCharacter } from '../vampires';
import { createKingMidnight, createGiantShadow, createShadowHand, kAnim, girlTex, type KingRig, type GiantRig, type HandRig, type CannonRig } from './kingRig';
import type { CannonHooks } from './enemies';
import { F5 } from './lines';

/**
 * Король Полночь — the final boss of «Ночь клыков» (docs/script-fangs.md §9.3–9.5), on the castle roof under the moon.
 *  Phase 1 — the duel (HP 100 → 60 %): a shadow sword. Slashes with a red sector on the floor (the blade glints just
 *     before the cut: a hit on him in that moment PARRIES — «ДЗЫНЬ!», he staggers), lunges along a red band, three-cut
 *     combos, a fan of thrown shadow swords along red lines (a swing knocks a sword back at him: he staggers), summons.
 *  Phase 2 — the servants' powers (HP 60 → 25 %), one at a time, each with its answer:
 *     «Крылья Нетопыря!» — flies, marks a ring under a hero, dives (a shockwave), lies dazed after; peas / syrup shots
 *        bring him down early;  «Облик Морок!» — four heroes walk at you, one of them is him: the one WITHOUT a shadow;
 *     «Тишина Шёпота…» — invisible, frost footprints give him away, the roof lanterns and Пастила's beacons show him
 *        (and burn him), a shimmer + ring before his cut;  «Нас двое — как Сёстры!» — two Kings swap places: the one
 *        looking at you blocks, hit the one turned away.
 *  Phase 3 — «Довольно. Я — ночь!»: a giant shadow against the moon. Пастила charges the Солнечная пушка (60–90 s);
 *     his shadow hands crawl to the cannon (hit them back), slam at heroes, shadow imps run at her, «Луна, пей!» rings
 *     drain colour; every hit on Пастила costs charge. The clock strikes («БОМ!») as it fills; the twelfth = the shot.
 *     (v2) Once, at half charge, Ноки's own shadow (the girl with the guitar) catches a hand at the cannon and holds it
 *     back: «ТЕНЬ НОКИ!» — «Опять ты?! Ты же моя!».
 *  The fight ends on the shot (no last blow, v2 §9.4): the solar shot burns his cloak (Пастила aims at the cloak, not
 *  at him) and the scene `fangs5_boss_defeat` (the spoon of syrup) plays.
 *
 * Co-op: the host runs everything (choices, HP, charge, summons, who is targeted); clients play the King, his twin,
 * the false heroes and the hands back from snapshots (id 950) at NetLevel.playT. Every act carries its timeline
 * (name, elapsed, length, windup, sequence, target), so each machine draws the same telegraphs and tests only ITS OWN
 * hero against what it sees (cuts, dives, rings, beams, hands, thrown swords); the host decides hits ON the King.
 * Scales with the party: HP × coop.hpScale(), faster turns, more swords / dives / imps / beams, longer charge.
 */

const NET_ID = 950;
export const ROOF = { x: 0, y: 38, z: -118, r: 18 };
export const CANNON_AT = new THREE.Vector3(-6, 38, -101.6);
export const PASTILA_AT = new THREE.Vector3(-3.9, 38, -102.2);
const GIANT_AT = new THREE.Vector3(0, ROOF.y - 9, ROOF.z - 31);
const CENTER = new THREE.Vector3(ROOF.x, ROOF.y, ROOF.z);

const STATES = ['intro', 'fight', 'transform', 'shadow', 'shot', 'dead'] as const;
type St = typeof STATES[number];
const ACTS = ['idle', 'walk', 'slash', 'lunge', 'blades', 'summon', 'stagger', 'cast', 'rise', 'hover', 'mark', 'dive', 'dazed', 'fall',
  'decoy', 'swipe', 'gone', 'stalk', 'ambush', 'guard', 'sneak', 'throw', 'swap', 'rest', 'reach', 'slam', 'lift', 'recoil', 'snatch', 'kneel',
  /** (v2) a hand at the cannon held back by Ноки's shadow */
  'held'] as const;
type Act = typeof ACTS[number];
const POWERS = ['none', 'wings', 'shape', 'silence', 'twins'] as const;
type Power = typeof POWERS[number];
const KINDS: HeroKind[] = ['tosha', 'bublik', 'noki', 'pastila'];
const ATK_OF: Record<HeroKind, HeroAtk> = { tosha: 'sword', bublik: 'punch', noki: 'axe', pastila: 'flask' };

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const tmp3 = new THREE.Vector3();
const pose: NetPose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (k: number) => k * k * (3 - 2 * k);

/** keep a point on the roof (radius m from the edge) */
function onRoof(p: THREE.Vector3, m = 0.8) {
  const dx = p.x - ROOF.x, dz = p.z - ROOF.z, d = Math.hypot(dx, dz), R = ROOF.r - m;
  if (d > R) { p.x = ROOF.x + (dx / d) * R; p.z = ROOF.z + (dz / d) * R; }
  return p;
}

// ───────────────────────── an actor's timeline (the King, his twin, a false hero, a hand) ─────────────────────────
class Slot {
  pos = new THREE.Vector3();
  yaw = 0;
  act: Act = 'idle';
  /** elapsed / length / windup (the moment it strikes) */
  at = 0; dur = 0; w = 0;
  seq = 0;
  tx = 0; tz = 0;
  on = true;
  /** client: the host's positions */
  track: NetTrack<null> | null = null;
  /** strike detection: the elapsed time at the last check and its act instance */
  lastAt = 0; lastSeq = -1;
  /** victim side: this act instance already hit my hero */
  hitSeq = -1;
  /** host: a cooldown of its own (false heroes, twins) */
  cdT = 0;
  go(act: Act, dur = 0, w = 0, tx = this.tx, tz = this.tz) { this.act = act; this.at = 0; this.dur = dur; this.w = w; this.tx = tx; this.tz = tz; this.seq = (this.seq + 1) % 1000; }
  get k() { return this.dur > 0 ? clamp(this.at / this.dur, 0, 1) : 0; }
  /** the strike moment `t` (s into the act) was passed since the last check */
  crossed(t: number) { return this.seq === this.lastSeq && this.lastAt < t && this.at >= t; }
  snap(out: number[]) { out.push(this.pos.x, this.pos.y, this.pos.z, this.yaw, ACTS.indexOf(this.act), this.at, this.dur, this.w, this.seq, this.tx, this.tz, this.on ? 1 : 0); }
  static N = 12;
  /** client: positions to the track, the rest at once (called when the playback passes the sample) */
  fields(a: number[], i: number) {
    const seq = a[i + 8];
    if (seq !== this.seq) { this.lastSeq = seq; this.lastAt = 0; }
    this.act = ACTS[a[i + 4]] ?? 'idle'; this.at = a[i + 5]; this.dur = a[i + 6]; this.w = a[i + 7]; this.seq = seq; this.tx = a[i + 9]; this.tz = a[i + 10]; this.on = !!a[i + 11];
  }
  push(t: number, a: number[], i: number, maxSpeed = 60) { (this.track ??= new NetTrack<null>(maxSpeed, 6)).push(t, a[i], a[i + 1], a[i + 2], a[i + 3], null, 0); }
  play(play: number, dt: number) { if (this.track && this.track.eval(play, dt, pose)) { this.pos.copy(pose.pos); this.yaw = pose.yaw; } }
}

// ───────────────────────── a thrown shadow sword ─────────────────────────
class Blade {
  pos = new THREE.Vector3();
  dir = new THREE.Vector3();
  t = 0; dead = false; back = false; hitMe = false;
  mesh: THREE.Group;
  constructor(public id: number, from: THREE.Vector3, dir: THREE.Vector3, public speed: number, L: Level3D) {
    this.pos.copy(from); this.dir.copy(dir).normalize();
    this.mesh = new THREE.Group();
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.08, 1.3, 4), basic('#1a1028'));
    b.rotation.x = Math.PI / 2; this.mesh.add(b);
    const e = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.13, 1.35, 4), basic('#b080ff', { additive: true, transparent: true, opacity: 0.6, depthWrite: false }));
    e.rotation.x = Math.PI / 2; this.mesh.add(e);
    noOutline(this.mesh);
    L.scene.add(this.mesh);
    this.sync();
  }
  sync() { this.mesh.position.copy(this.pos); this.mesh.lookAt(tmp.copy(this.pos).add(this.dir)); this.mesh.rotateZ(this.t * 12); }
  pop(L: Level3D) { if (this.dead) return; this.dead = true; this.mesh.removeFromParent(); ambient(L, () => L.fx.emit(this.pos.clone(), { count: 10, speed: [1, 3], life: [0.3, 0.6], size: [0.15, 0.3], colors: ['#3a2a5a', '#8a6ac8'], drag: 3 })); }
}

export interface BossHooks {
  /** Пастила at the cannon (the story NPC) */
  pastila: () => Npc3 | null;
  cannon: CannonRig;
  /** the bell on the tower (the clock's «БОМ!») */
  bell: THREE.Object3D;
  /** the roof's lanterns («солнышки»), snuffed by «Тишина Шёпота» */
  lanterns: () => { lit: boolean; snuff(): void }[];
}

export class Midnight3 implements Boss3Like, Netted {
  netId = 0;
  get netRoot() { return this.rig.head; }
  netTimed = ['blade', 'dead'];
  name = 'КОРОЛЬ ПОЛНОЧЬ';
  hp = 90; maxHp = 90;
  state: St = 'intro';
  phase = 1;
  power: Power = 'none';
  /** 0..1 the Солнечная пушка (phase 3) */
  charge = 0;
  onDefeat: (() => void) | null = null;
  /** scenes pose him themselves */
  manual = false;
  rig: KingRig;
  anim = kAnim();
  root = new THREE.Group();
  giant: GiantRig;
  /** the camera's boss point (updated every frame) */
  focusPt = new THREE.Vector3(0, ROOF.y + 2, ROOF.z - 8);
  main = new Slot();
  twin = new Slot();
  decoys = [new Slot(), new Slot(), new Slot()];
  hands = [new Slot(), new Slot()];
  /** which hero model the King wears in «Облик Морок» (index into KINDS), decoys' kinds */
  realKind = 0;
  decoyKind = [1, 2, 3];
  private twinRig: KingRig;
  private twinAnim = kAnim();
  private heroRigs: Record<HeroKind, HeroRig>;
  private heroAnims: Record<HeroKind, HeroAnim>;
  private blobs: THREE.Mesh[] = [];
  private handRigs: HandRig[];
  private handHp = [0, 0];
  private beams: { x: number; z: number; at: number; seq: number; hit: boolean; tele: Tele }[] = [];
  private beamSeq = 0;
  private blades: Blade[] = [];
  private bladeSeq = 0;
  private invis: Invisibility;
  private visGoal = 1;
  private grow = 0;
  private t = 0;
  // host
  private L: Level3D;
  private focus: HeroLike | null = null;
  private cd = 1.2;
  private queue: (() => void)[] = [];
  private powerT = 0; private powerHits = 0; private powerStep = 0; private dives = 0; private skyHits = 0;
  private powerOrder: Power[] = [];
  private interlude = 0;
  private lastHitT = -99; private hitLog: number[] = []; private hpSeen = new Map<HeroLike, number>(); private breatherUntil = 0; private lastHeart = -99;
  private beaconT = 0; private swapT = 0; private stagT = 0;
  private waveT = 6; private beamT = 5; private barkT = 6; private chargeT = 60; private pauseT = 0; private bomN = 0; private chargeSaid = 0;
  private shotT = 0;
  private squirtT = 2;
  /** quick hits on him (a flurry → he blocks and ripostes) */
  private flurry: number[] = [];
  private hurtFlash = 0;
  private lastTaunt = 0;
  private hints = new Set<string>();
  private chordCD = 0;
  // client
  private got = false;
  private rec: number[] | null = null;
  private netDied = false;
  private wasPuppet = false;
  // visuals
  private sector: THREE.Mesh; private sectorFill: THREE.Mesh; private sectorM: THREE.MeshBasicMaterial; private sectorFM: THREE.MeshBasicMaterial;
  private band = new Stripe();
  private tele = new Tele();
  private tele2 = new Tele();
  private handTele = [new Tele(), new Tele()];
  private handBand = [new Stripe(), new Stripe()];
  private prints: { m: THREE.Mesh; t: number }[] = [];
  private printAt = new THREE.Vector3();
  private printSide = 1;
  private beamMeshes: THREE.Mesh[] = [];
  private shotBeam: THREE.Mesh;
  private pastilaHurt = 0;
  private myBarkT = 0;
  /** (v2) Ноки's shadow holding a hand back at the cannon (shown on every machine from the hand's act) */
  private girlHold: THREE.Mesh;
  private girlUsed = false;
  private clockSeen = 0;

  constructor(L: Level3D, private hooks: BossHooks) {
    this.L = L;
    this.rig = createKingMidnight();
    markCharacter(this.rig.root);
    this.root.add(this.rig.root);
    L.scene.add(this.root);
    this.twinRig = createKingMidnight();
    markCharacter(this.twinRig.root);
    this.twinRig.root.visible = false;
    L.scene.add(this.twinRig.root);
    this.invis = new Invisibility(this.rig.root);
    this.invis.vis = 1; this.invis.apply(1, 1);
    this.heroRigs = {} as Record<HeroKind, HeroRig>;
    this.heroAnims = {} as Record<HeroKind, HeroAnim>;
    for (const k of KINDS) {
      const r = createHeroModel(k);
      r.root.visible = false;
      L.scene.add(r.root);
      this.heroRigs[k] = r;
      this.heroAnims[k] = { state: 'idle', speed: 0, attack: null, weapon: 'sword', flash: 0, talk: 0, expr: 'angry', squash: 1 };
      const b = makeBlob(0.5); b.visible = false; L.scene.add(b); this.blobs.push(b);
    }
    this.giant = createGiantShadow();
    this.giant.root.position.copy(GIANT_AT);
    this.giant.root.visible = false;
    L.scene.add(this.giant.root);
    this.handRigs = [createShadowHand(), createShadowHand()];
    for (const h of this.handRigs) { h.root.visible = false; h.arm.visible = false; L.scene.add(h.root, h.arm); }
    // telegraphs
    this.sectorM = basic('#ff3040', { additive: true, transparent: true, opacity: 0.5, depthWrite: false });
    this.sectorFM = basic('#ff6020', { additive: true, transparent: true, opacity: 0.3, depthWrite: false });
    for (const m of [this.sectorM, this.sectorFM]) { m.polygonOffset = true; m.polygonOffsetFactor = -6; }
    this.sector = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 40, 1, -1.22, 2.44).rotateX(-Math.PI / 2), this.sectorM);
    this.sectorFill = new THREE.Mesh(new THREE.CircleGeometry(1, 40, -1.22, 2.44).rotateX(-Math.PI / 2), this.sectorFM);
    for (const m of [this.sector, this.sectorFill]) { m.renderOrder = 4; m.visible = false; noOutline(m); L.scene.add(m); }
    L.scene.add(this.band.mesh, this.tele.g, this.tele2.g, ...this.handTele.map((x) => x.g), ...this.handBand.map((x) => x.mesh));
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 30, 20, 1, true), basic('#ff3a5a', { additive: true, transparent: true, opacity: 0, depthWrite: false, side: THREE.FrontSide }));
      m.visible = false; noOutline(m); L.scene.add(m); this.beamMeshes.push(m);
    }
    this.shotBeam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 1, 20, 1, true), basic('#ffd040', { additive: true, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.shotBeam.visible = false; noOutline(this.shotBeam); L.scene.add(this.shotBeam);
    this.girlHold = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.9).translate(0, 0.95, 0), new THREE.MeshBasicMaterial({ map: girlTex(), transparent: true, opacity: 0, depthWrite: false, color: '#7a5ac8', side: THREE.DoubleSide }));
    this.girlHold.visible = false; noOutline(this.girlHold); L.scene.add(this.girlHold);
    // health: the room's difficulty, the party
    const base = coop.easy ? 135 : 180;
    this.hp = this.maxHp = Math.round(base * (L.nl ? coop.hpScale() : 1));
    this.main.pos.set(ROOF.x, ROOF.y, ROOF.z - 14);
    this.twin.on = false;
    for (const s of [...this.decoys, ...this.hands]) s.on = false;
    L.overlayDraw.push((ctx) => this.drawCharge(ctx));
    this.main.yaw = 0;
    // the thrown swords can be hit (a swing knocks one back at him)
    const self = this;
    this.bladeHit = {
      dead: false,
      meleeHit: (L2: Level3D, c: THREE.Vector3, _d: THREE.Vector3, range: number) => self.meleeHitBlades(L2, c, range),
      shotHit: () => false,
      predictHit: (L2: Level3D, c: THREE.Vector3, range: number) => self.predictBlades(L2, c, range),
    } as Hittable3 & { predictHit(L: Level3D, c: THREE.Vector3, range: number): boolean };
    L.hittables.push(this.bladeHit);
    L.refs.f5cannon = { at: PASTILA_AT.clone(), hit: (L2: Level3D, from: THREE.Vector3) => this.hitPastila(L2, from) } satisfies CannonHooks;
    if (L.nl) L.nl.add(this, NET_ID);
    // a phase already reached (respawn / team restart): start from there
    if (L.seen.has('f5_ph3')) { this.phase = 3; this.hp = Math.round(this.maxHp * 0.25); }
    else if (L.seen.has('f5_ph2')) { this.phase = 2; this.hp = Math.round(this.maxHp * 0.6); }
    this.sync(0);
  }

  // ───────────────────────── Boss3Like ─────────────────────────
  faceTarget() { return this.main.pos.clone().setY(this.main.pos.y + 2.4); }
  aimTargets(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    if (this.state !== 'fight') return out;
    if (this.power !== 'silence' || this.invis.vis > 0.5) out.push(this.main.pos.clone().setY(this.main.pos.y + 1.5));
    if (this.twin.on && this.power === 'twins') out.push(this.twin.pos.clone().setY(this.twin.pos.y + 1.5));
    if (this.power === 'shape') for (const d of this.decoys) if (d.on && d.act !== 'gone') out.push(d.pos.clone().setY(d.pos.y + 0.8));
    return out;
  }
  start() {
    if (!this.L.authority) return;
    if (this.phase === 3) { this.beginTransform(); return; }
    this.state = 'fight'; this.cd = 1.0;
    this.main.go('idle');
    if (this.phase === 2) { this.power = 'none'; this.interlude = 0; }
  }

  private party() { return this.L.nl ? Math.max(1, this.L.heroes().length) : 1; }
  private tempo() { return (this.phase === 1 ? 1 : 1.12) * (1 + 0.04 * (this.party() - 1)) * (coop.easy ? 0.85 : 1); }
  private idOf(h: HeroLike) { return heroId(h); }
  private hint(key: string, s: string) { if (this.hints.has(key)) return; this.hints.add(key); this.L.toast(s); }
  private bark(s: string, dur = 1.8) { this.L.bark(this.rig.head, s, dur, 0.7); this.talkT = Math.min(1.6, dur); }
  /** the mouth moves while he speaks (barks, scene lines) */
  talkT = 0;
  private cap(f: () => void) { const nl = this.L.nl; if (!nl || !nl.isHost || nl.capturing) { f(); return; } nl.capture(f); }

  /** the hero this act goes after (solo: the player) */
  private fh(): HeroLike {
    const L = this.L;
    if (!L.nl) return L.player;
    const f = this.focus;
    if (f && !f.dead && !f.downed && L.heroes().includes(f)) return f;
    return (this.focus = L.targetFor(this.main.pos));
  }
  private pickFocus() {
    const L = this.L;
    if (!L.nl) { this.focus = L.player; return; }
    const hs = L.alivePlayers();
    if (!hs.length) { this.focus = L.player; return; }
    const lid = L.refs.leaderId as string | undefined;
    const leader = lid ? hs.find((h) => this.idOf(h) === lid) : undefined;
    const r = Math.random();
    this.focus = leader && r < 0.35 ? leader : r < 0.75 ? L.targetFor(this.main.pos) : choose(hs);
  }

  // ───────────────────────── per frame ─────────────────────────
  update(L: Level3D, dt: number) {
    this.t += dt;
    if (L.nl && !L.authority) { this.puppet(L, dt); this.wasPuppet = true; }
    else {
      if (this.wasPuppet) this.takeOver();
      if (!this.manual) this.host(L, dt);
    }
    this.common(L, dt);
  }

  // ═════════════════════════════ host ═════════════════════════════
  private host(L: Level3D, dt: number) {
    for (const s of [this.main, this.twin, ...this.decoys, ...this.hands]) s.at += dt;
    this.director(L, dt);
    this.chordCD -= dt;
    if (this.state === 'fight') this.fight(L, dt);
    else if (this.state === 'transform') this.transform(L, dt);
    else if (this.state === 'shadow') this.shadow(L, dt);
    else if (this.state === 'shot') this.shot(L, dt);
    // the HUD
    L.hud.bossName = this.name;
    L.hud.bossHp = this.hp;
    L.hud.bossMax = this.state === 'fight' ? this.maxHp : 0;
  }

  private director(L: Level3D, dt: number) {
    if (this.state !== 'fight' && this.state !== 'shadow') return;
    void dt;
    const hs = L.heroes();
    for (const h of hs) {
      const seen = this.hpSeen.get(h);
      if (seen !== undefined && !h.dead && h.hp < seen) { this.hitLog.push(this.t); this.lastHitT = this.t; }
      this.hpSeen.set(h, h.hp);
    }
    while (this.hitLog.length && this.t - this.hitLog[0] > 10) this.hitLog.shift();
    if (this.hitLog.length >= 2 + hs.length && this.t > this.breatherUntil) {
      this.breatherUntil = this.t + 7;
      this.hitLog.length = 0;
      this.cd = Math.max(this.cd, 2.2);
      let worst: HeroLike | null = null;
      for (const h of L.alivePlayers()) if (h.hp < h.maxHp && (!worst || h.hp / h.maxHp < worst.hp / worst.maxHp)) worst = h;
      if (worst && this.t - this.lastHeart > 22) {
        this.lastHeart = this.t;
        const at = onRoof(worst.pos.clone().add(tmp.set(rand(-2, 2), 0, rand(-2, 2))), 2);
        L.dropPickup('heart', at.setY(ROOF.y + 6));
        L.fx.stars(at.clone(), 12);
      }
    }
  }

  // ───────────────────────── phases 1–2: the fight ─────────────────────────
  private fight(L: Level3D, dt: number) {
    const m = this.main;
    const tp = this.tempo();
    // phase changes by health
    if (this.phase === 1 && this.hp <= this.maxHp * 0.6) { this.toPhase2(L); return; }
    if (this.phase === 2 && this.hp <= this.maxHp * 0.25) { this.endPower(L, true); this.beginTransform(); return; }
    if (this.power !== 'none') { this.runPower(L, dt); this.updateBlades(L, dt); return; }
    switch (m.act) {
      case 'idle': case 'walk': {
        const f = this.fh();
        this.cd -= dt * tp;
        // keep a sword's length from the focus, circling a little
        const d = Math.hypot(f.pos.x - m.pos.x, f.pos.z - m.pos.z);
        const want = 3.2;
        tmp.set(f.pos.x - m.pos.x, 0, f.pos.z - m.pos.z).normalize();
        const side = Math.sin(this.t * 0.7) > 0 ? 1 : -1;
        const sp = d > want + 0.6 ? 4.6 : d < want - 1 ? -2.5 : 0;
        m.pos.x += (tmp.x * sp + -tmp.z * side * 1.2) * dt;
        m.pos.z += (tmp.z * sp + tmp.x * side * 1.2) * dt;
        onRoof(m.pos);
        m.yaw = this.turn(m.yaw, Math.atan2(f.pos.x - m.pos.x, f.pos.z - m.pos.z), 6, dt);
        if (m.act !== (sp !== 0 ? 'walk' : 'idle')) m.act = sp !== 0 ? 'walk' : 'idle';
        if (this.cd <= 0) this.pickAttack(L);
        break;
      }
      case 'slash': this.slashTick(L, m, dt); break;
      case 'guard': {
        const f = this.fh();
        m.yaw = this.turn(m.yaw, Math.atan2(f.pos.x - m.pos.x, f.pos.z - m.pos.z), 8, dt);
        if (m.at >= m.dur) { this.queue.length = 0; this.startSlash(f, 0.55); }
        break;
      }
      case 'lunge': this.lungeTick(L, m, dt); break;
      case 'blades': this.bladesTick(L, m); break;
      case 'summon': if (m.crossed(0.8)) this.summon(L); if (m.at >= m.dur) this.after(); break;
      case 'stagger': if (m.at >= m.dur) this.after(0.6); break;
      default: if (m.at >= m.dur) this.after();
    }
    this.updateBlades(L, dt);
  }
  private turn(yaw: number, want: number, rate: number, dt: number) { return yaw + clamp(wrapA(want - yaw), -rate * dt, rate * dt); }
  private after(extra = 0) {
    const m = this.main;
    const next = this.queue.shift();
    if (next) { next(); return; }
    m.go('idle');
    this.cd = (this.phase === 1 ? 1.25 : 1.0) * (this.t < this.breatherUntil ? 1.6 : 1) + extra;
    this.cd /= 1 + 0.08 * (this.party() - 1);
    if (this.phase === 2 && this.power === 'none') this.interlude--;
  }

  private pickAttack(L: Level3D) {
    this.pickFocus();
    const f = this.fh();
    const m = this.main;
    const d = Math.hypot(f.pos.x - m.pos.x, f.pos.z - m.pos.z);
    // phase 2: between powers a couple of sword moves, then the next power
    if (this.phase === 2 && this.interlude <= 0) { this.startPower(L); return; }
    const alive = L.enemies.filter((e) => !e.dead).length;
    const w: [string, number][] = [
      ['slash', d < 5 ? 3 : 1],
      ['combo', d < 5 ? 1.6 : 0.6],
      ['lunge', d > 4 ? 2.4 : 0.8],
      ['blades', d > 6 ? 2.2 : 1.1],
      ['summon', alive < 1 + this.party() && this.t - this.lastTaunt > 14 ? 1.2 : 0],
    ];
    let sum = 0; for (const x of w) sum += x[1];
    let r = Math.random() * sum, k = 'slash';
    for (const x of w) { r -= x[1]; if (r <= 0) { k = x[0]; break; } }
    if (Math.random() < 0.18) this.bark(choose(F5.duel), 1.4);
    switch (k) {
      case 'slash': this.startSlash(f); break;
      case 'combo': this.startSlash(f, 0.55); this.queue.push(() => this.startSlash(this.fh(), 0.5), () => this.startSlash(this.fh(), 0.75)); break;
      case 'lunge': this.startLunge(f); break;
      case 'blades': this.startBlades(L); break;
      case 'summon': this.lastTaunt = this.t; m.go('summon', 1.3); audio.sfx('roar', { pitch: 1.4, volume: 0.5 }); break;
    }
  }

  // slash: windup (a red sector fills; the blade glints for the last 0.4 s = the parry window), the cut, a recovery
  private startSlash(f: HeroLike, w = 0.85) {
    const m = this.main;
    const W = Math.max(0.45, w / this.tempo());
    m.yaw = Math.atan2(f.pos.x - m.pos.x, f.pos.z - m.pos.z);
    m.go('slash', W + 0.55, W, f.pos.x, f.pos.z);
    audio.sfx('warn', { volume: 0.35, pitch: 1.3 });
    this.hint('parry', F5.tips.parry);
  }
  private slashTick(L: Level3D, m: Slot, dt: number) {
    if (m.at < m.w * 0.7) {
      // track the hero while winding up, then commit
      const f = this.fh();
      m.yaw = this.turn(m.yaw, Math.atan2(f.pos.x - m.pos.x, f.pos.z - m.pos.z), 5, dt);
      const d = Math.hypot(f.pos.x - m.pos.x, f.pos.z - m.pos.z);
      if (d > 3) { tmp.set(Math.sin(m.yaw), 0, Math.cos(m.yaw)); m.pos.addScaledVector(tmp, Math.min(d - 3, 5 * dt)); onRoof(m.pos); }
    }
    if (m.crossed(m.w)) { audio.sfx('swingHeavy', { pitch: 0.7 }); L.tcam.shake(0.1); }
    if (m.at >= m.dur) this.after();
  }

  // lunge: a red band from him toward the hero, then he dashes along it
  private startLunge(f: HeroLike) {
    const m = this.main;
    tmp.set(f.pos.x - m.pos.x, 0, f.pos.z - m.pos.z);
    const d = Math.min(12, tmp.length() + 2.5);
    tmp.normalize();
    const end = onRoof(m.pos.clone().addScaledVector(tmp, d), 1.2);
    const W = Math.max(0.6, 0.85 / this.tempo());
    m.yaw = Math.atan2(tmp.x, tmp.z);
    this.lungeFrom.copy(m.pos);
    m.go('lunge', W + 0.45 + 0.6, W, end.x, end.z);
    audio.sfx('warn', { volume: 0.4 });
  }
  private lungeFrom = new THREE.Vector3();
  private lungeTick(L: Level3D, m: Slot, dt: number) {
    void dt;
    if (m.at >= m.w && m.at < m.w + 0.45) {
      const k = clamp((m.at - m.w) / 0.45, 0, 1);
      m.pos.lerpVectors(this.lungeFrom, tmp.set(m.tx, ROOF.y, m.tz), ease(k));
    }
    if (m.crossed(m.w)) { audio.sfx('whoosh', { pitch: 0.6 }); }
    if (m.at >= m.dur) this.after();
    void L;
  }

  // blades: swords appear over him, a red line to each target, then they fly
  private bladeAims: THREE.Vector3[] = [];
  private startBlades(L: Level3D) {
    const m = this.main;
    const n = Math.min(6, 3 + (this.party() - 1)) + (this.phase === 2 ? 1 : 0);
    this.bladeAims = [];
    const hs = L.alivePlayers();
    for (let i = 0; i < n; i++) {
      const h = i === 0 ? this.fh() : hs.length ? hs[i % hs.length] : this.fh();
      const spread = (i - (n - 1) / 2) * 0.9;
      tmp.set(h.pos.x - m.pos.x, 0, h.pos.z - m.pos.z).normalize();
      this.bladeAims.push(new THREE.Vector3(h.pos.x + -tmp.z * spread, ROOF.y + 1, h.pos.z + tmp.x * spread));
    }
    m.go('blades', 1.6, Math.max(0.75, 1.0 / this.tempo()), this.fh().pos.x, this.fh().pos.z);
    this.hint('blades', F5.tips.blades);
    audio.sfx('warn', { pitch: 0.8, volume: 0.4 });
  }
  private bladesTick(L: Level3D, m: Slot) {
    if (m.crossed(m.w)) {
      const from = m.pos.clone().setY(m.pos.y + 2.0);
      // (each flies down its line to a hero's chest height, then on into the floor)
      for (const a of this.bladeAims) this.launchBlade(L, from, tmp2.set(a.x, ROOF.y + 0.7, a.z).sub(from).normalize(), 17 * Math.sqrt(this.tempo()));
      audio.sfx('throw', { pitch: 0.7 });
    }
    if (m.at >= m.dur) this.after();
  }
  private launchBlade(L: Level3D, from: THREE.Vector3, dir: THREE.Vector3, speed: number) {
    const id = ++this.bladeSeq;
    this.blades.push(new Blade(id, from, dir, speed, L));
    L.nl?.entEvent(this, 'blade', { id, p: [from.x, from.y, from.z], d: [dir.x, dir.y, dir.z], s: speed });
  }

  private summon(L: Level3D) {
    const n = 1 + Math.floor((this.party() + 1) / 2);
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const p = onRoof(new THREE.Vector3(ROOF.x + Math.cos(a) * 12, ROOF.y, ROOF.z + Math.sin(a) * 12), 2);
      const e = L.spawnEnemy(i % 2 ? 'bat' : 'fanger', p.x, ROOF.y + (i % 2 ? 2.5 : 0), p.z);
      e.spawnT = 0.7; e.provoke(L);
      L.fx.emit(p.clone().setY(ROOF.y + 0.5), { count: 20, speed: [1, 3], life: [0.5, 0.9], size: [0.3, 0.6], colors: ['#2a1a3a', '#5a3a7a'], g: -1, drag: 2 });
    }
    this.bark('Стража, ко мне!', 1.4); // (доп.)
  }

  /** a hit on him while his blade glints: parried */
  private parry(L: Level3D, at: THREE.Vector3) {
    const m = this.main;
    this.queue.length = 0;
    m.go('stagger', 2.4);
    L.hud.showBanner(F5.parried, '#c8e0ff');
    L.fx.sparks(at.clone(), 24, ['#ffffff', '#c8b0ff', '#ffe14a']);
    L.fx.ring(at.clone(), 1.6, '#ffffff', 0.3, false);
    audio.sfx('clang', { pitch: 1.2 }); audio.sfx('reflect');
    L.tcam.shake(0.3);
  }

  // ───────────────────────── phase 2: the powers ─────────────────────────
  private toPhase2(L: Level3D) {
    this.phase = 2;
    L.seen.add('f5_ph2');
    this.queue.length = 0;
    this.main.go('cast', 2.2);
    this.interlude = 0;
    this.power = 'none';
    this.bark(F5.phase2, 2.6);
    L.hud.showBanner('ФАЗА 2', '#c070ff');
    L.toast(F5.phase2Toast);
    audio.sfx('roar', { volume: 0.8, pitch: 0.8 });
    L.tcam.shake(0.6);
    for (const b of this.blades) b.pop(L);
  }

  private startPower(L: Level3D) {
    if (!this.powerOrder.length) {
      this.powerOrder = ['wings', 'shape', 'silence', 'twins'];
      // the first round in the arc's order (Нетопырь, Морок, Шёпот, Сёстры), later ones shuffled
      if ((L.refs.f5round as number | undefined) ?? 0) this.powerOrder.sort(() => Math.random() - 0.5);
      L.refs.f5round = ((L.refs.f5round as number | undefined) ?? 0) + 1;
    }
    const p = this.powerOrder.shift()!;
    this.power = p;
    this.powerT = 0; this.powerHits = 0; this.powerStep = 0; this.skyHits = 0;
    this.bark(F5.powers[p as Exclude<Power, 'none'>], 2.2);
    L.hud.showBanner(F5.powers[p as Exclude<Power, 'none'>].toUpperCase(), '#c070ff');
    const m = this.main;
    this.queue.length = 0;
    this.pickFocus();
    if (p === 'wings') {
      this.dives = 3 + (this.party() >= 3 ? 1 : 0);
      m.go('rise', 1.0);
      this.hint('wings', F5.tips.wings);
      for (let i = 0; i < Math.min(3, this.party()); i++) { const e = L.spawnEnemy('bat', ROOF.x + rand(-6, 6), ROOF.y + 4, ROOF.z + rand(-6, 6)); e.spawnT = 0.6; e.provoke(L); }
    } else if (p === 'shape') {
      m.go('cast', 0.8);
      this.hint('shape', F5.tips.shape);
    } else if (p === 'silence') {
      m.go('cast', 0.6);
      this.hint('silence', F5.tips.silence);
    } else {
      m.go('cast', 0.8);
      this.hint('twins', F5.tips.twins);
    }
    audio.sfx('roar', { pitch: 1.2, volume: 0.6 });
  }

  /** a power is over: back to the sword for a moment */
  private endPower(L: Level3D, quiet = false) {
    const m = this.main;
    const was = this.power;
    this.power = 'none';
    this.interlude = 2;
    this.twin.on = false;
    for (const d of this.decoys) d.on = false;
    this.visGoal = 1;
    if (was === 'shape' || was === 'twins') ambient(L, () => L.fx.emit(m.pos.clone().setY(m.pos.y + 1.2), { count: 26, speed: [1, 3], life: [0.5, 0.9], size: [0.3, 0.6], colors: ['#2a1a3a', '#5a3a7a', '#9a7ac8'], g: -1, drag: 2 }));
    if (!quiet && m.act !== 'stagger') { m.go('idle'); this.cd = 1.2; }
    m.pos.y = ROOF.y;
  }

  private runPower(L: Level3D, dt: number) {
    this.powerT += dt;
    const m = this.main;
    switch (this.power) {
      case 'wings': this.wings(L, m, dt); break;
      case 'shape': this.shape(L, m, dt); break;
      case 'silence': this.silence(L, m, dt); break;
      case 'twins': this.twins(L, m, dt); break;
    }
  }

  // «Крылья Нетопыря»
  private wings(L: Level3D, m: Slot, dt: number) {
    const air = ROOF.y + 6.5;
    switch (m.act) {
      case 'rise': m.pos.y = lerp(ROOF.y, air, ease(m.k)); if (m.at >= m.dur) m.go('hover', rand(0.9, 1.5)); break;
      case 'hover': {
        const a = this.t * 0.6;
        tmp.set(ROOF.x + Math.cos(a) * 7, air + Math.sin(this.t * 2) * 0.4, ROOF.z + Math.sin(a) * 7);
        m.pos.lerp(tmp, Math.min(1, dt * 1.5));
        const f = this.fh();
        m.yaw = this.turn(m.yaw, Math.atan2(f.pos.x - m.pos.x, f.pos.z - m.pos.z), 4, dt);
        if (m.at >= m.dur) { this.pickFocus(); const f2 = this.fh(); m.go('mark', Math.max(1.0, 1.3 / this.tempo()) + 0.35, 0, f2.pos.x, f2.pos.z); audio.sfx('warn', { volume: 0.4, pitch: 1.4 }); }
        break;
      }
      case 'mark': {
        const f = this.fh();
        if (m.at < m.dur - 0.35) { m.tx += (f.pos.x - m.tx) * Math.min(1, dt * 4); m.tz += (f.pos.z - m.tz) * Math.min(1, dt * 4); }
        m.yaw = this.turn(m.yaw, Math.atan2(m.tx - m.pos.x, m.tz - m.pos.z), 6, dt);
        m.pos.y = air + Math.sin(this.t * 3) * 0.2;
        if (m.at >= m.dur) { this.diveFrom.copy(m.pos); m.go('dive', 0.38, 0.38); audio.sfx('whoosh', { pitch: 0.7 }); }
        break;
      }
      case 'dive': {
        m.pos.lerpVectors(this.diveFrom, tmp.set(m.tx, ROOF.y, m.tz), ease(m.k));
        if (m.at >= m.dur) {
          L.tcam.shake(0.5); audio.sfx('bigSlam', { volume: 0.7 });
          L.fx.dust(m.pos.clone(), 20, '#b8a8d0');
          L.addWave(new Wave3(m.pos.clone(), 10, 7, 1));
          this.dives--;
          m.go('dazed', this.dives <= 0 ? 2.6 : 1.5);
        }
        break;
      }
      case 'dazed': if (m.at >= m.dur) { if (this.dives > 0) m.go('rise', 0.8); else this.endPower(L); } break;
      case 'fall': m.pos.y = Math.max(ROOF.y, m.pos.y - 14 * dt); if (m.at >= m.dur) { m.pos.y = ROOF.y; m.go('stagger', 3); } break;
      case 'stagger': if (m.at >= m.dur) this.endPower(L); break;
      default: m.go('rise', 1.0);
    }
  }
  private diveFrom = new THREE.Vector3();

  // «Облик Морок»: four heroes; he is the one without a shadow
  private shape(L: Level3D, m: Slot, dt: number) {
    if (m.act === 'cast') {
      if (m.at >= m.dur) {
        // the puff: four places round the roof, one of them is his
        const kinds = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
        this.realKind = kinds[0];
        this.decoyKind = kinds.slice(1);
        const a0 = rand(0, Math.PI * 2);
        const spots = [0, 1, 2, 3].map((i) => onRoof(new THREE.Vector3(ROOF.x + Math.cos(a0 + i * 1.57) * 8, ROOF.y, ROOF.z + Math.sin(a0 + i * 1.57) * 8), 2));
        const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
        m.pos.copy(spots[order[0]]);
        m.go('decoy', 15);
        this.decoys.forEach((d, i) => { d.on = true; d.pos.copy(spots[order[i + 1]]); d.go('walk', 0); d.cdT = rand(0.5, 1.5); });
        m.cdT = rand(0.5, 1.5);
        L.tcam.shake(0.3);
        audio.sfx('mist');
        for (const s of spots) L.fx.emit(s.clone().setY(ROOF.y + 1), { count: 22, speed: [1, 3], life: [0.5, 1], size: [0.3, 0.6], colors: ['#2a1a3a', '#5a3a7a', '#c8b8e0'], g: -1, drag: 2 });
      }
      return;
    }
    if (m.act === 'stagger') { if (m.at >= m.dur) this.endPower(L); return; }
    // the disguised King and the false heroes all walk at heroes and swipe
    const walker = (s: Slot, sp: number, walk: Act) => {
      if (!s.on || s.act === 'gone') return;
      if (s.act === 'swipe') { if (s.at >= s.dur) { s.go(walk, 0); } return; }
      s.cdT -= dt;
      const h = L.targetFor(s.pos);
      const d = Math.hypot(h.pos.x - s.pos.x, h.pos.z - s.pos.z);
      s.yaw = this.turn(s.yaw, Math.atan2(h.pos.x - s.pos.x, h.pos.z - s.pos.z), 6, dt);
      if (d > 1.6) { tmp.set(Math.sin(s.yaw), 0, Math.cos(s.yaw)); s.pos.addScaledVector(tmp, sp * dt); onRoof(s.pos); if (s.act !== walk) s.act = walk; }
      else if (s.cdT <= 0) { s.go('swipe', 1.0, Math.max(0.5, 0.65 / this.tempo()), h.pos.x, h.pos.z); s.cdT = 1.3; }
    };
    walker(m, 2.7, 'decoy');
    for (const d of this.decoys) walker(d, 2.7, 'walk');
    if (this.powerT > 16) this.endPower(L);
  }

  // «Тишина Шёпота»
  private silence(L: Level3D, m: Slot, dt: number) {
    const V = vamp(L);
    if (m.act === 'cast') {
      if (m.at >= m.dur) {
        for (const l of this.hooks.lanterns()) l.snuff();
        this.visGoal = 0.04;
        m.go('stalk', 0);
        this.beaconT = 1.2;
        audio.sfx('mist'); audio.sfx('snuff');
      }
      return;
    }
    // Пастила throws her beacon near the hero he is after (the NPC does the team move, GDD §5)
    this.beaconT -= dt;
    if (this.beaconT <= 0) {
      this.beaconT = 6;
      const f = this.fh();
      const at = onRoof(f.pos.clone().add(tmp.set(rand(-1.5, 1.5), 0, rand(-1.5, 1.5))), 1.5);
      V.light([at.x, ROOF.y, at.z], { r: 4.6, secs: 5 });
      this.barkPastila(F5.pastilaBeacon);
    }
    const sun = V.sunAt(tmp.copy(m.pos).setY(m.pos.y + 1));
    const lit = sun > 0.3;
    if (lit && m.act !== 'stagger' && this.stagT <= 0) {
      // caught in the light: shown, burnt, stunned for a moment
      this.stagT = 3.5;
      m.go('stagger', 1.6);
      L.fx.text(m.pos.clone().setY(m.pos.y + 3), 'Солнце жжёт!', '#ffd34a', 24);
      audio.sfx('hiss', { pitch: 0.8 });
    }
    this.stagT -= dt;
    this.visGoal = lit || m.act === 'stagger' ? 1 : m.act === 'ambush' ? 0.45 : 0.04;
    const f = this.fh();
    switch (m.act) {
      case 'stalk': {
        const d = Math.hypot(f.pos.x - m.pos.x, f.pos.z - m.pos.z);
        m.yaw = this.turn(m.yaw, Math.atan2(f.pos.x - m.pos.x, f.pos.z - m.pos.z), 5, dt);
        // he keeps out of the light
        tmp.set(Math.sin(m.yaw), 0, Math.cos(m.yaw));
        const next = tmp2.copy(m.pos).addScaledVector(tmp, 1.2).setY(m.pos.y + 1);
        if (d > 1.7 && V.sunAt(next) < 0.3) { m.pos.addScaledVector(tmp, 3.8 * dt); onRoof(m.pos); }
        this.cd -= dt * this.tempo();
        if (d < 2.4 && this.cd <= 0) { m.go('ambush', 1.4, Math.max(0.7, 0.9 / this.tempo()), f.pos.x, f.pos.z); this.cd = 1.6; }
        break;
      }
      case 'ambush': case 'stagger': if (m.at >= m.dur) m.go('stalk', 0); break;
      default: m.go('stalk', 0);
    }
    if (this.powerT > 16 || this.powerHits >= 4) { this.visGoal = 1; this.endPower(L); }
  }

  // «Нас двое — как Сёстры»
  private twins(L: Level3D, m: Slot, dt: number) {
    const tw = this.twin;
    if (m.act === 'cast') {
      if (m.at >= m.dur) {
        tw.on = true;
        tw.pos.copy(onRoof(m.pos.clone().add(tmp.set(rand(-1, 1), 0, rand(-1, 1)).normalize().multiplyScalar(7)), 2));
        tw.yaw = m.yaw;
        m.go('guard', 0); tw.go('sneak', 0);
        m.cdT = 2; tw.cdT = 1.6;
        this.swapT = 6.5;
        audio.sfx('mist');
        L.fx.emit(tw.pos.clone().setY(ROOF.y + 1), { count: 26, speed: [1, 3], life: [0.5, 1], size: [0.3, 0.6], colors: ['#2a1a3a', '#9a7ac8'], g: -1, drag: 2 });
      }
      return;
    }
    const f = this.fh();
    this.swapT -= dt;
    if (this.swapT <= 0) {
      // they swap places in a puff (and roles)
      this.swapT = 6.5;
      const a = m.pos.clone(); m.pos.copy(tw.pos); tw.pos.copy(a);
      const ay = m.yaw; m.yaw = tw.yaw; tw.yaw = ay;
      const ma = m.act === 'guard' || m.act === 'throw' ? 'sneak' : 'guard';
      m.go(ma === 'guard' ? 'guard' : 'sneak', 0); tw.go(ma === 'guard' ? 'sneak' : 'guard', 0);
      L.nl?.entEvent(this, 'swap', {});
      this.swapFx(L);
    }
    for (const s of [m, tw]) {
      switch (s.act) {
        case 'guard': {
          // watches the focus from 4.5 m (turns slowly), throws a sword now and then
          const d = Math.hypot(f.pos.x - s.pos.x, f.pos.z - s.pos.z);
          s.yaw = this.turn(s.yaw, Math.atan2(f.pos.x - s.pos.x, f.pos.z - s.pos.z), 2.0, dt);
          tmp.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
          if (d > 5.5) s.pos.addScaledVector(tmp, 2.5 * dt); else if (d < 3.5) s.pos.addScaledVector(tmp, -2 * dt);
          onRoof(s.pos);
          s.cdT -= dt * this.tempo();
          if (s.cdT <= 0) { s.cdT = 3; s.go('throw', 1.1, 0.6, f.pos.x, f.pos.z); }
          break;
        }
        case 'throw':
          // (the red line follows the hero until just before the throw, then the sword flies along it)
          if (s.at < s.w * 0.7) { s.tx += (f.pos.x - s.tx) * Math.min(1, dt * 5); s.tz += (f.pos.z - s.tz) * Math.min(1, dt * 5); }
          s.yaw = this.turn(s.yaw, Math.atan2(s.tx - s.pos.x, s.tz - s.pos.z), 3, dt);
          if (s.crossed(s.w)) { const from = s.pos.clone().setY(s.pos.y + 2.0); this.launchBlade(L, from, tmp2.set(s.tx, ROOF.y + 0.7, s.tz).sub(from).normalize(), 15); }
          if (s.at >= s.dur) s.go('guard', 0);
          break;
        case 'sneak': {
          // circles round behind the focus, then cuts
          tmp.set(-Math.sin(f.yaw), 0, -Math.cos(f.yaw));
          const goal = onRoof(tmp2.copy(f.pos).addScaledVector(tmp, 2.4), 1);
          const d = Math.hypot(goal.x - s.pos.x, goal.z - s.pos.z);
          if (d > 0.4) { tmp.set(goal.x - s.pos.x, 0, goal.z - s.pos.z).normalize(); s.pos.addScaledVector(tmp, Math.min(d, 3.6 * dt)); onRoof(s.pos); }
          s.yaw = this.turn(s.yaw, Math.atan2(f.pos.x - s.pos.x, f.pos.z - s.pos.z), 4, dt);
          s.cdT -= dt * this.tempo();
          if (s.cdT <= 0 && Math.hypot(f.pos.x - s.pos.x, f.pos.z - s.pos.z) < 3.4) { s.cdT = 2.4; s.go('slash', 1.3, 0.8, f.pos.x, f.pos.z); }
          break;
        }
        case 'slash': if (s.at >= s.dur) s.go('sneak', 0); break;
        case 'stagger': if (s.at >= s.dur) s.go(s === m ? 'guard' : 'sneak', 0); break;
        default: s.go('guard', 0);
      }
    }
    if (this.powerT > 19 || this.powerHits >= 4) this.endPower(L);
  }
  private swapFx(L: Level3D) {
    ambient(L, () => {
      for (const s of [this.main, this.twin]) L.fx.emit(s.pos.clone().setY(ROOF.y + 1.2), { count: 18, speed: [1, 3], life: [0.4, 0.8], size: [0.3, 0.5], colors: ['#2a1a3a', '#9a7ac8'], g: -1, drag: 2 });
      audio.sfx('whoosh', { pitch: 1.4, volume: 0.5 });
    });
  }

  // ───────────────────────── phase 3: the shadow against the moon ─────────────────────────
  private beginTransform() {
    const L = this.L;
    this.phase = 3;
    L.seen.add('f5_ph3');
    this.state = 'transform';
    this.power = 'none';
    this.twin.on = false; for (const d of this.decoys) d.on = false;
    this.queue.length = 0;
    this.main.go('cast', 4.5);
    this.visGoal = 1;
    this.bark(F5.phase3, 3);
    L.hud.showBanner('ФАЗА 3', '#ff3a5a');
    audio.sfx('roar', { volume: 1, pitch: 0.6 });
    L.tcam.shake(1);
    for (const b of this.blades) b.pop(L);
    for (const e of L.enemies) if (!e.dead && isVamp(e)) e.hurt(L, 99, e.center(), 'sun');
    const party = this.party();
    this.chargeT = clamp(60 + 6 * (party - 1) - (coop.easy ? 8 : 0), 52, 90);
    this.charge = 0; this.bomN = 0; this.chargeSaid = 0;
    this.waveT = 7; this.beamT = 10; this.barkT = 8;
    this.hands.forEach((h, i) => { h.on = true; h.go('rest', 2 + i * 1.8); h.pos.set(i ? 7 : -7, ROOF.y + 9, ROOF.z - 19); });
  }
  private transform(L: Level3D, dt: number) {
    const m = this.main;
    m.pos.lerp(tmp.set(0, ROOF.y + 3, ROOF.z - 20), Math.min(1, dt * 1.2));
    this.grow = m.k;
    if (m.at >= m.dur) {
      this.state = 'shadow';
      this.grow = 1;
      L.toast(F5.phase3Toast);
      this.hint('hands', F5.tips.hands);
    }
    void dt;
  }

  private hitPastila(L: Level3D, from: THREE.Vector3, hand = false) {
    if (!L.authority || this.state !== 'shadow') return;
    this.charge = Math.max(0, this.charge - (hand ? 0.1 : 0.04));
    this.pauseT = hand ? 1.6 : 0.9;
    this.pastilaHurt = 1;
    L.nl?.entEvent(this, 'pastila', {});
    this.barkPastila(F5.pastilaHit);
    L.fx.sparks(PASTILA_AT.clone().setY(ROOF.y + 1), 14, ['#ffffff', '#ff8ab8', '#ffd34a']);
    audio.sfx('hurt', { pitch: 1.4 });
    void from;
  }
  /** a bark over Пастила / the bell on every machine (they aren't Netted: the host sends it) */
  private sayAt(w: 'p' | 'b', s: string) {
    this.localSay(w, s);
    this.L.nl?.entEvent(this, 'bk', { w, s });
  }
  private localSay(w: string, s: string) {
    const L = this.L;
    ambient(L, () => {
      if (w === 'b') { L.bark(this.hooks.bell, s, 1.4, 1.5); audio.sfx('clang', { pitch: 0.45, volume: 0.8 }); return; }
      const p = this.hooks.pastila();
      if (p) L.bark(p.root, s, 1.9, 1.9);
    });
  }
  private barkPastila(s: string) { this.sayAt('p', s); }

  private shadow(L: Level3D, dt: number) {
    // solo: the night waits while my hero is down — the cannon must not win the fight under the «ОЙ-ОЙ-ОЙ!» card (the
    // victory scenes would play over it, and «Ещё разок!» would rebuild the level into phase 3 again)
    if (!L.nl && L.player.dead) return;
    const party = this.party();
    // the charge (paused for a moment after a hit on Пастила)
    this.pauseT -= dt;
    if (this.pauseT <= 0) this.charge = Math.min(1, this.charge + dt / this.chargeT);
    const q = Math.floor(this.charge * 4);
    if (q > this.chargeSaid && q >= 1) { this.chargeSaid = q; this.barkPastila(F5.charge[Math.min(3, q - 1)]); if (q < 4) L.toast(F5.charge[q - 1]); }
    const bom = Math.floor(this.charge * 12 + 1e-6);
    if (bom > this.bomN && bom < 12) { this.bomN = bom; this.sayAt('b', F5.bom); }
    if (this.charge >= 1) { this.fire(L); return; }
    // barks
    this.barkT -= dt;
    if (this.barkT <= 0) { this.barkT = rand(7, 10); this.bark(this.charge > 0.8 ? F5.phase3Barks[3] : choose(F5.phase3Barks.slice(0, 3)), 2); }
    // the hands
    this.hands.forEach((h, i) => this.handTick(L, h, i, dt));
    // Пастила squirts syrup at an imp right beside her now and then (it stings and stops it for a moment)
    this.squirtT -= dt;
    if (this.squirtT <= 0) {
      const sh = L.enemies.find((e) => !e.dead && e.kind === 'shade' && e.body.pos.distanceTo(PASTILA_AT) < 3);
      if (sh) {
        this.squirtT = 2.6;
        sh.hurt(L, 1, PASTILA_AT.clone().setY(ROOF.y + 1), 'syrup');
        L.fx.emit(PASTILA_AT.clone().setY(ROOF.y + 1.1), { count: 14, speed: [3, 6], dir: sh.body.pos.clone().sub(PASTILA_AT).setY(0.3).normalize(), spread: 0.25, life: [0.3, 0.6], size: [0.1, 0.2], colors: ['#ff3a7a', '#ffb0cc'], g: 8 });
      }
    }
    // shadow imps
    this.waveT -= dt;
    const shades = L.enemies.filter((e) => !e.dead && e.kind === 'shade').length;
    if (this.waveT <= 0) {
      this.waveT = Math.max(8, 14 - party * 1.2);
      const n = Math.min(2 + (party - 1) * 2, 2 + 2 * party - shades);
      for (let k = 0; k < n; k++) {
        const a = -Math.PI / 2 + rand(-0.9, 0.9);
        const p = onRoof(new THREE.Vector3(ROOF.x + Math.cos(a) * 16, ROOF.y, ROOF.z + Math.sin(a) * 16), 1.5);
        const e = L.spawnEnemy('shade', p.x, ROOF.y, p.z);
        e.spawnT = 0.5;
      }
      if (n > 0) audio.sfx('mist', { pitch: 0.7 });
    }
    // «Луна, пей!»
    this.beamT -= dt;
    if (this.beamT <= 0) {
      this.beamT = rand(10, 12) / (1 + 0.06 * (party - 1));
      const hs = L.alivePlayers();
      const n = Math.min(6, 2 + Math.floor(party / 2));
      for (let k = 0; k < n; k++) {
        const h = hs.length ? hs[k % hs.length] : L.player;
        const p = onRoof(h.pos.clone().add(tmp.set(k < hs.length ? 0 : rand(-4, 4), 0, k < hs.length ? 0 : rand(-4, 4))), 1.5);
        this.beams.push({ x: p.x, z: p.z, at: 0, seq: ++this.beamSeq, hit: false, tele: new Tele() });
      }
      this.bark(F5.phase3Barks[0], 1.6);
    }
    // a beam drains colour: «пресный» (the host decides who stood in it)
    for (const b of this.beams) {
      b.at += dt;
      if (b.at > BEAM_W && b.at < BEAM_W + BEAM_ON) for (const h of L.alivePlayers()) if (Math.hypot(h.pos.x - b.x, h.pos.z - b.z) < BEAM_R && h.pos.y < ROOF.y + 2.5) vamp(L).bland(h, 2.5);
    }
    this.beams = this.beams.filter((b) => { if (b.at > BEAM_W + BEAM_ON) { b.tele.hide(); b.tele.g.removeFromParent(); return false; } return true; });
    for (const b of this.beams) if (!b.tele.g.parent) L.scene.add(b.tele.g);
  }

  /** a hand: rests over the north edge, reaches for the cannon along a band (hit it back!) or slams down on a hero */
  private handTick(L: Level3D, h: Slot, i: number, dt: number) {
    const rest = tmp.set(i ? 7 : -7, ROOF.y + 9, ROOF.z - 19);
    const party = this.party();
    switch (h.act) {
      case 'rest': {
        h.pos.lerp(rest, Math.min(1, dt * 2));
        if (h.at >= h.dur) {
          const other = this.hands[1 - i];
          const reachBusy = other.act === 'reach';
          if (!reachBusy && Math.random() < 0.55) {
            const x0 = (i ? 1 : -1) * rand(2, 8);
            h.pos.set(x0, ROOF.y + 0.5, ROOF.z - 16.5);
            this.reachFrom.copy(h.pos);
            h.go('reach', 99, Math.max(1.0, 1.4 / this.tempo()), PASTILA_AT.x + rand(-1, 1), PASTILA_AT.z - 1.8);
            this.handHp[i] = 4 + 2 * (party - 1);
            audio.sfx('warn', { pitch: 0.7, volume: 0.5 });
          } else {
            this.pickFocus();
            const f = this.fh();
            h.go('slam', 2.6, Math.max(1.0, 1.25 / this.tempo()), f.pos.x, f.pos.z);
            audio.sfx('warn', { volume: 0.5 });
          }
        }
        break;
      }
      case 'reach': {
        if (h.at < h.w) break; // the band shows; the hand waits at the edge
        tmp2.set(h.tx - h.pos.x, 0, h.tz - h.pos.z);
        const d = tmp2.length();
        const sp = 3.0 + 0.3 * (party - 1);
        if (d > 0.1) h.pos.addScaledVector(tmp2.normalize(), Math.min(d, sp * dt));
        h.pos.y = ROOF.y + 0.5;
        h.yaw = Math.atan2(h.tx - this.reachFrom.x, h.tz - this.reachFrom.z);
        // (v2) once, at half charge: Ноки's shadow catches the hand a few steps from the cannon and holds it back
        if (!this.girlUsed && this.charge >= 0.5 && d < 4.2) { this.girlUsed = true; this.girlCatch(L, h); break; }
        if (d < 1.9) { h.go('snatch', 1.0); this.hitPastila(L, h.pos, true); }
        break;
      }
      case 'held': h.pos.y = ROOF.y + 0.5 + Math.sin(h.at * 18) * 0.05; if (h.at >= h.dur) { h.go('recoil', 3); this.bark(F5.phase3Barks[1], 1.6); } break;
      case 'slam': {
        const lock = h.w * 0.72;
        if (h.at < lock) { const f = this.fh(); h.tx += (f.pos.x - h.tx) * Math.min(1, dt * 4); h.tz += (f.pos.z - h.tz) * Math.min(1, dt * 4); }
        if (h.at < h.w) h.pos.lerp(tmp.set(h.tx, ROOF.y + 7, h.tz), Math.min(1, dt * 5));
        else if (h.at < h.w + 0.18) h.pos.lerp(tmp.set(h.tx, ROOF.y + 0.3, h.tz), clamp((h.at - h.w) / 0.18, 0, 1));
        if (h.crossed(h.w + 0.18)) { L.tcam.shake(0.6); audio.sfx('bigSlam', { volume: 0.7 }); L.fx.dust(h.pos.clone(), 22, '#8a7ab0'); L.addWave(new Wave3(new THREE.Vector3(h.tx, ROOF.y, h.tz), 9, 6, 1.5)); }
        if (h.at >= h.dur) h.go('lift', 0.9);
        break;
      }
      case 'snatch': if (h.at >= h.dur) h.go('lift', 1.2); break;
      case 'recoil': h.pos.lerp(rest, Math.min(1, dt * 3)); if (h.at >= h.dur) h.go('rest', rand(2.5, 4)); break;
      case 'lift': h.pos.lerp(rest, Math.min(1, dt * 2.5)); if (h.at >= h.dur) h.go('rest', rand(1.4, 3) / this.tempo()); break;
      default: h.go('rest', 2);
    }
  }
  private reachFrom = new THREE.Vector3();
  /** (v2 §9.4) «ТЕНЬ НОКИ!» — the host decides; the hand's act ('held') shows the shadow on every machine */
  private girlCatch(L: Level3D, h: Slot) {
    h.go('held', 3.4);
    L.hud.showBanner(F5.girlBanner, '#b890ff');
    this.bark(F5.girlBark, 2.4);
    audio.sfx('clang', { pitch: 2.2, volume: 0.45 }); audio.sfx('colorRestore', { pitch: 0.8, volume: 0.5 });
    L.tcam.shake(0.3);
    L.fx.stars(h.pos.clone().setY(ROOF.y + 1.2), 18, ['#b890ff', '#ffffff', '#ff7ad0']);
    // the hand let go of the cannon: a moment's peace for the charge
    this.pauseT = 0;
  }

  private fire(L: Level3D) {
    this.state = 'shot';
    this.charge = 1;
    this.shotT = 0;
    L.hud.showBanner(F5.shotBanner, '#ffd34a');
    this.barkPastila(F5.charge[3]);
    audio.sfx('boom'); audio.sfx('victory', { volume: 0.5 });
    L.tcam.shake(1.2);
    for (const e of L.enemies) if (!e.dead && isVamp(e)) e.die(L);
    for (const h of this.hands) h.go('recoil', 3);
    for (const b of this.beams) { b.tele.hide(); b.tele.g.removeFromParent(); }
    this.beams = [];
    L.nl?.entEvent(this, 'shot', {});
    L.toast(F5.shotToast);
  }
  private shot(L: Level3D, dt: number) {
    this.shotT += dt;
    for (const [i, h] of this.hands.entries()) { const rest = tmp.set(i ? 7 : -7, ROOF.y + 12, ROOF.z - 22); h.pos.lerp(rest, Math.min(1, dt * 2)); }
    if (this.shotT > 3 && this.state === 'shot') this.die(L);
  }
  private die(L: Level3D) {
    this.state = 'dead';
    L.hud.bossMax = 0;
    L.nl?.entEvent(this, 'dead', {});
    this.onDefeat?.();
  }

  // ───────────────────────── hits on him (host) ─────────────────────────
  meleeHit(L: Level3D, c: THREE.Vector3, dir: THREE.Vector3, range: number, half: number, dmg: number, atkId: number, kind: string): boolean {
    void half;
    if (!L.authority) return false;
    let hit = false;
    this.cap(() => { hit = this.resolveHit(L, c, dir, range, dmg, atkId, kind, null); });
    return hit;
  }
  private hitIds = new Set<string>();
  private shotSeq = 0;
  private resolveHit(L: Level3D, c: THREE.Vector3, dir: THREE.Vector3 | null, range: number, dmg: number, atkId: number, kind: string, shot: Shot3 | null): boolean {
    const who = shot?.shooter ?? L.attacker ?? net.myId;
    const key = who + ':' + atkId;
    // phase 3: the hands (hit a reaching hand back)
    if (this.state === 'shadow') {
      let hit = false;
      this.hands.forEach((h, i) => {
        if (h.act !== 'reach' && h.act !== 'slam') return;
        if (Math.hypot(c.x - h.pos.x, c.z - h.pos.z) > range + 1.9 || Math.abs(c.y - h.pos.y) > 3) return;
        if (this.hitIds.has(key + 'h' + i)) return;
        this.hitIds.add(key + 'h' + i);
        hit = true;
        L.fx.sparks(c.clone(), 12, ['#ffffff', '#c8a0ff']);
        L.fx.text(h.pos.clone().setY(h.pos.y + 2), String(Math.round(dmg)), '#e0c8ff', 22);
        audio.sfx('bossHit', { pitch: 1.3, volume: 0.6 });
        if (h.act === 'reach') {
          this.handHp[i] -= Math.max(1, dmg);
          if (this.handHp[i] <= 0) { h.go('recoil', 3); L.fx.text(h.pos.clone().setY(h.pos.y + 3), 'Ай!', '#ffe14a', 30); audio.sfx('roar', { pitch: 1.6, volume: 0.5 }); }
        }
      });
      if (this.hitIds.size > 300) this.hitIds.clear();
      return hit;
    }
    if (this.state !== 'fight') return false;
    // the parts that can be hit: him (main), his twin, the false heroes
    const parts: { s: Slot; real: boolean; twin: boolean }[] = [{ s: this.main, real: true, twin: false }];
    if (this.power === 'twins' && this.twin.on) parts.push({ s: this.twin, real: false, twin: true });
    if (this.power === 'shape') for (const d of this.decoys) if (d.on && d.act !== 'gone') parts.push({ s: d, real: false, twin: false });
    let any = false;
    for (const p of parts) {
      const s = p.s;
      const air = s.pos.y - ROOF.y;
      const cy = s.pos.y + (this.power === 'shape' ? 0.6 : 1.4);
      const reach = shot ? 1.3 : range + (this.power === 'shape' ? 0.5 : 0.9);
      if (Math.hypot(c.x - s.pos.x, c.z - s.pos.z) > reach || Math.abs(c.y - cy) > (shot ? 1.6 : 2.2)) continue;
      if (this.hitIds.has(key + ':' + this.parts(s))) continue;
      this.hitIds.add(key + ':' + this.parts(s));
      if (this.hitIds.size > 300) this.hitIds.clear();
      any = true;
      // false heroes: a puff
      if (this.power === 'shape' && s !== this.main) {
        s.go('gone', 0);
        L.fx.emit(s.pos.clone().setY(ROOF.y + 0.8), { count: 22, speed: [1, 3], life: [0.4, 0.8], size: [0.3, 0.6], colors: ['#2a1a3a', '#5a3a7a'], g: -1, drag: 2 });
        L.fx.text(s.pos.clone().setY(ROOF.y + 2), F5.fake, '#c8b0ff', 24);
        audio.sfx('mist', { pitch: 1.3 });
        continue;
      }
      if (this.power === 'shape' && s === this.main && this.main.act !== 'stagger') {
        // found him: the disguise falls off
        for (const d of this.decoys) if (d.on && d.act !== 'gone') { d.go('gone', 0); L.fx.emit(d.pos.clone().setY(ROOF.y + 0.8), { count: 16, speed: [1, 3], life: [0.4, 0.8], size: [0.3, 0.5], colors: ['#2a1a3a', '#5a3a7a'], g: -1, drag: 2 }); }
        this.main.go('stagger', 2.6);
        L.hud.showBanner('НАШЛИ!', '#ffd34a');
        audio.sfx('reflect');
      }
      // the twins: the one looking at you blocks
      if (this.power === 'twins') {
        tmp.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
        const toA = tmp2.set(c.x - s.pos.x, 0, c.z - s.pos.z).normalize();
        if (tmp.dot(toA) > 0.25 && s.act !== 'stagger' && kind !== 'chord') {
          L.fx.sparks(c.clone(), 14, ['#ffffff', '#c8d0ff']);
          L.fx.text(s.pos.clone().setY(s.pos.y + 3), F5.blocked, '#c8d0ff', 22);
          audio.sfx('clang', { pitch: 1.4, volume: 0.6 });
          continue;
        }
        this.powerHits++;
        if (s.act !== 'stagger') s.go('stagger', 1.2);
      }
      const m = this.main;
      // his guard (after a flurry): blocks what comes from the front
      if (this.power === 'none' && m.act === 'guard' && !shot && kind !== 'chord') {
        tmp.set(Math.sin(m.yaw), 0, Math.cos(m.yaw));
        if (tmp.dot(tmp2.set(c.x - m.pos.x, 0, c.z - m.pos.z).normalize()) > 0) {
          L.fx.sparks(c.clone(), 14, ['#ffffff', '#c8d0ff']);
          L.fx.text(m.pos.clone().setY(m.pos.y + 3), F5.blocked, '#c8d0ff', 22);
          audio.sfx('clang', { pitch: 1.4, volume: 0.6 });
          continue;
        }
      }
      // a flurry while he is open: next time he raises his guard
      if (this.power === 'none' && (m.act === 'idle' || m.act === 'walk' || m.act === 'slash' && m.at > m.w)) {
        this.flurry.push(this.t);
        while (this.flurry.length && this.t - this.flurry[0] > 1.8) this.flurry.shift();
        if (this.flurry.length >= 3) { this.flurry.length = 0; this.queue.length = 0; m.go('guard', 0.7); this.bark(choose(F5.duel), 1.2); }
      }
      // a glinting blade: parried
      const late = L.attacker ? 0.4 : 0.05;
      if (p.real && !shot && m.act === 'slash' && m.at > m.w - 0.42 && m.at < m.w + late && dir) {
        tmp.set(Math.sin(m.yaw), 0, Math.cos(m.yaw));
        if (tmp.dot(tmp2.set(c.x - m.pos.x, 0, c.z - m.pos.z).normalize()) > -0.2) { this.parry(L, c); this.damage(L, dmg, c); continue; }
      }
      if (p.twin && s.act === 'slash' && s.at > s.w - 0.42 && s.at < s.w + (L.attacker ? 0.4 : 0.05) && !shot) { s.go('stagger', 2); L.hud.showBanner(F5.parried, '#c8e0ff'); audio.sfx('clang', { pitch: 1.2 }); }
      // wings: shot down
      if (this.power === 'wings' && air > 2 && shot) {
        this.skyHits++;
        L.fx.text(m.pos.clone().setY(m.pos.y + 2.5), `${this.skyHits}/${3 + Math.floor(this.party() / 2)}`, '#ffe14a', 22);
        if (this.skyHits >= 3 + Math.floor(this.party() / 2) && m.act !== 'fall') { m.go('fall', 0.7); L.hud.showBanner('СБИТ!', '#ffd34a'); audio.sfx('bigSlam', { volume: 0.5 }); }
        this.damage(L, 1, c);
        continue;
      }
      if (this.power === 'wings' && air > 2.2) continue; // out of reach in the air
      if (kind === 'chord' && this.chordCD <= 0) {
        this.chordCD = 6;
        this.invis.reveal(3);
        if (m.act !== 'stagger' && m.act !== 'dive') m.go('stagger', 1.3);
      }
      if (this.power === 'silence') { this.powerHits++; this.invis.reveal(2); }
      let k = 1;
      const st = s.act === 'stagger' || s.act === 'dazed';
      if (st) k = 2;
      if (vamp(L).sunAt(tmp.copy(s.pos).setY(s.pos.y + 1)) > 0.3 || kind === 'sun') k = Math.max(k, 2);
      if (this.power === 'twins') k = Math.max(k, 1.5);
      // Ноки hunts vampires: ×1.5 from her axe and chord
      k *= vampBane(L, kind);
      this.damage(L, Math.max(1, Math.round(dmg * k)), c);
    }
    return any;
  }
  private parts(s: Slot) { return s === this.main ? 'm' : s === this.twin ? 't' : 'd' + this.decoys.indexOf(s); }

  shotHit(L: Level3D, s: Shot3): boolean {
    if (!L.authority || (this.state !== 'fight' && this.state !== 'shadow')) return false;
    let hit = false;
    this.cap(() => { hit = this.resolveHit(L, s.pos, null, 0.6, s.dmg, 1e6 + ++this.shotSeq, 'pea', s); });
    if (hit) s.dead = true;
    return hit;
  }

  private damage(L: Level3D, amount: number, at: THREE.Vector3) {
    if (this.state !== 'fight') return;
    this.hp = Math.max(1, this.hp - amount);
    this.anim.flash = 1;
    this.hurtFlash = 1;
    audio.sfx('bossHit');
    L.fx.text(at.clone().setY(at.y + 1.2), String(amount), '#ffe14a', 28);
    L.fx.sparks(at.clone(), 12, ['#ffffff', '#c8a0ff', '#ffe14a']);
    if (Math.random() < 0.12) { const s2 = choose(F5.hurt); this.bark(s2, Math.max(1.2, s2.length * 0.07)); }
  }

  /** host: a swing knocks a thrown sword back at him */
  private meleeHitBlades(L: Level3D, c: THREE.Vector3, range: number): boolean {
    let any = false;
    for (const b of this.blades) {
      if (b.dead || b.back) continue;
      // (rewind: what the swinger saw was up to ~0.6 s behind the host's copy)
      let near = false;
      for (let k = 0; k <= 6; k++) { tmp.copy(b.pos).addScaledVector(b.dir, -b.speed * 0.1 * k); if (tmp.distanceTo(c) < range + 1.0) { near = true; break; } if (b.t - 0.1 * k < 0) break; }
      if (!near) continue;
      any = true;
      this.reflect(L, b);
      L.nl?.entEvent(this, 'reflect', { id: b.id });
    }
    return any;
  }
  private reflect(L: Level3D, b: Blade) {
    if (b.back) return;
    b.back = true;
    b.speed = 22;
    ambient(L, () => { L.fx.sparks(b.pos.clone(), 14, ['#ffffff', '#c8b0ff']); audio.sfx('reflect'); L.fx.text(b.pos.clone().setY(b.pos.y + 0.6), 'Отбито!', '#c8e0ff', 20); });
  }

  // ═════════════════════════════ updates for every machine ═════════════════════════════
  private updateBlades(L: Level3D, dt: number) {
    const p = L.player;
    for (const b of this.blades) {
      if (b.dead) continue;
      b.t += dt;
      if (b.back) {
        // homing back at him
        const to = tmp.copy(this.main.pos).setY(this.main.pos.y + 1.5);
        b.dir.lerp(to.clone().sub(b.pos).normalize(), Math.min(1, dt * 8)).normalize();
        if (b.pos.distanceTo(to) < 1.0) {
          b.pop(L);
          if (L.authority && this.state === 'fight') {
            this.cap(() => {
              const m = this.main;
              if (m.act !== 'stagger' && this.power !== 'wings') { this.queue.length = 0; m.go('stagger', 2.0); }
              this.damage(L, 3, to);
              L.hud.showBanner(F5.parried, '#c8e0ff');
            });
          }
          continue;
        }
      }
      b.pos.addScaledVector(b.dir, b.speed * dt);
      b.sync();
      // victim side: my hero only
      if (!b.back && !b.hitMe && !p.dead && b.pos.distanceTo(p.center(tmp2)) < 0.75) {
        b.hitMe = true;
        uncaptured(L, () => { if (p.hurt(L, 1, b.pos.clone())) audio.sfx('hit'); });
        b.pop(L);
      }
      if (b.t > 3 || Math.hypot(b.pos.x - ROOF.x, b.pos.z - ROOF.z) > ROOF.r + 6 || b.pos.y < ROOF.y + 0.05) b.pop(L);
    }
    this.blades = this.blades.filter((b) => !b.dead);
  }

  /** what every machine does: strike tests on MY hero, telegraphs, the rigs */
  private common(L: Level3D, dt: number) {
    const p = L.player;
    if (!L.authority) this.updateBlades(L, dt);
    // victim side: my hero against the acts I see
    const me = !p.dead && !p.downed && !L.worldCut;
    for (const s of [this.main, this.twin]) {
      if ((s === this.twin && !s.on) || s.act !== 'slash' || s.at < s.w - 0.42 || s.at > s.w || !p.atk || p.atkT > 0.15) continue;
      tmp.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
      tmp2.set(p.pos.x - s.pos.x, 0, p.pos.z - s.pos.z);
      if (tmp2.length() < 3.6 && tmp.dot(tmp2.normalize()) > -0.2 && s.hitSeq !== s.seq) {
        s.hitSeq = s.seq;
        if (!L.authority) ambient(L, () => { L.fx.sparks(s.pos.clone().setY(s.pos.y + 1.6), 18, ['#ffffff', '#c8b0ff']); audio.sfx('clang', { pitch: 1.2 }); });
      }
    }
    const test = (s: Slot, f: () => void) => { if (me && s.hitSeq !== s.seq) f(); };
    const hurt = (s: Slot, dmg: number, from: THREE.Vector3, knock?: THREE.Vector3) => { uncaptured(L, () => { if (p.hurt(L, dmg, from, knock)) s.hitSeq = s.seq; }); };
    for (const s of [this.main, this.twin]) {
      if (s === this.twin && !s.on) continue;
      if (s.act === 'slash' && s.crossed(s.w)) test(s, () => { if (inSector(p.pos, s.pos, s.yaw, 4.2, 1.22) && Math.abs(p.pos.y - s.pos.y) < 2) hurt(s, 1, s.pos.clone()); });
      if (s.act === 'lunge' && s.at > s.w && s.at < s.w + 0.5) test(s, () => { if (Math.hypot(p.pos.x - s.pos.x, p.pos.z - s.pos.z) < 1.3 && Math.abs(p.pos.y - s.pos.y) < 2) hurt(s, 1, s.pos.clone(), tmp.set(Math.sin(s.yaw) * 10, 7, Math.cos(s.yaw) * 10).clone()); });
      if (s.act === 'dive' && s.crossed(s.w - 0.02)) test(s, () => { if (Math.hypot(p.pos.x - s.tx, p.pos.z - s.tz) < 2.3 && p.pos.y < ROOF.y + 1.6) hurt(s, 1, new THREE.Vector3(s.tx, ROOF.y, s.tz)); });
      if (s.act === 'ambush' && s.crossed(s.w)) test(s, () => { if (Math.hypot(p.pos.x - s.tx, p.pos.z - s.tz) < 2.0 && p.pos.y < ROOF.y + 2) hurt(s, 1, s.pos.clone()); });
    }
    for (const d of [this.main, ...this.decoys]) {
      if (d.act === 'swipe' && d.crossed(d.w)) test(d, () => { tmp.set(Math.sin(d.yaw), 0, Math.cos(d.yaw)); const c = d.pos.clone().addScaledVector(tmp, 0.9); if (Math.hypot(p.pos.x - c.x, p.pos.z - c.z) < 1.5 && Math.abs(p.pos.y - d.pos.y) < 1.6) hurt(d, 1, d.pos.clone()); });
    }
    for (const h of this.hands) {
      if (!h.on) continue;
      if (h.act === 'slam' && h.crossed(h.w + 0.18)) test(h, () => { if (Math.hypot(p.pos.x - h.tx, p.pos.z - h.tz) < 2.6 && p.pos.y < ROOF.y + 2) hurt(h, 1, new THREE.Vector3(h.tx, ROOF.y, h.tz), tmp.set(p.pos.x - h.tx, 0, p.pos.z - h.tz).normalize().multiplyScalar(9).setY(8).clone()); });
      if (h.act === 'reach' && h.at > h.w && me && this.t - this.myContactT > 1.2 && Math.hypot(p.pos.x - h.pos.x, p.pos.z - h.pos.z) < 1.5 && p.pos.y < ROOF.y + 1.5) {
        this.myContactT = this.t;
        uncaptured(L, () => p.hurt(L, 1, h.pos.clone()));
      }
    }
    for (const b of this.beamList()) {
      if (me && b.at > BEAM_W && b.at < BEAM_W + BEAM_ON && this.myBeamSeq !== b.seq && Math.hypot(p.pos.x - b.x, p.pos.z - b.z) < BEAM_R && p.pos.y < ROOF.y + 2.5) {
        this.myBeamSeq = b.seq;
        uncaptured(L, () => p.hurt(L, 1, new THREE.Vector3(b.x, ROOF.y, b.z)));
      }
    }
    for (const s of [this.main, this.twin, ...this.decoys, ...this.hands]) { s.lastAt = s.at; s.lastSeq = s.seq; }
    // my hero's battle cries when a hand goes for Пастила (each machine its own hero, §9.4 «защита Пастилы»)
    this.myBarkT -= dt;
    if (this.hands.some((h) => h.act === 'reach' && h.at > h.w && h.at < h.w + 0.3) && this.myBarkT <= 0 && !p.dead) {
      this.myBarkT = 14;
      const line = F5.defend.find(([k]) => k === p.kind);
      if (line) ambient(L, () => L.bark(p.root, line[1], 1.8, 1.9));
    }
    this.visuals(L, dt);
  }
  private myContactT = -9;
  private myBeamSeq = -1;
  private netBeams: { x: number; z: number; at: number; seq: number }[] = [];
  private beamList(): { x: number; z: number; at: number; seq: number }[] { return this.L.authority ? this.beams : this.netBeams; }

  private visuals(L: Level3D, dt: number) {
    const m = this.main, a = this.anim;
    const fly = this.power === 'wings' && (m.act === 'rise' || m.act === 'hover' || m.act === 'mark' || m.act === 'dive' || m.act === 'fall');
    // the King's pose from his act
    const st: Record<string, string> = { idle: 'idle', walk: 'walk', slash: m.at < m.w ? 'windup' : 'slash', lunge: m.at < m.w ? 'windup' : 'thrust', blades: 'cast', summon: 'cast', stagger: 'stagger', cast: 'cast', rise: 'fly', hover: 'hover', mark: 'hover', dive: 'dive', dazed: 'stagger', fall: 'dive', stalk: 'walk', ambush: m.at < m.w ? 'windup' : 'slash', guard: 'block', sneak: 'walk', throw: 'cast', kneel: 'kneel', decoy: 'walk', swipe: 'walk' };
    if (!this.manual) {
      a.st = st[m.act] ?? 'idle';
      a.p = m.act === 'slash' || m.act === 'ambush' || m.act === 'lunge' ? (m.at < m.w ? m.at / Math.max(0.01, m.w) : (m.at - m.w) / 0.35) : m.k;
      a.speed = m.act === 'walk' || m.act === 'stalk' || m.act === 'sneak' ? 3 : 0;
      a.wings = damp(a.wings, fly || (m.act === 'dazed' && this.power === 'wings') ? 1 : 0, 6, dt);
      a.glint = m.act === 'slash' && m.at > m.w - 0.42 && m.at < m.w ? 1 : Math.max(0, a.glint - dt * 5);
      a.sword = damp(a.sword, this.state === 'fight' || this.state === 'intro' ? 1 : 0, 6, dt);
      a.stir = this.state === 'fight' ? 0.4 + 0.3 * Math.sin(this.t * 3) : 0.2;
      a.burn = this.state === 'shot' ? 1 : 0;
      this.root.position.copy(m.pos);
      this.root.rotation.y = m.yaw;
    }
    a.flash = Math.max(0, a.flash - dt * 6);
    this.talkT = Math.max(0, this.talkT - dt);
    a.talk = this.talkT > 0 ? Math.abs(Math.sin(this.t * 14)) * 0.8 : 0;
    // invisibility and the disguise
    const disguised = this.power === 'shape' && (m.act === 'decoy' || m.act === 'swipe');
    const giantK = this.state === 'transform' ? this.grow : this.state === 'shadow' || this.state === 'shot' ? 1 : this.state === 'dead' ? Math.max(0, 1 - this.fadeK) : 0;
    this.invis.apply(dt, this.visGoalNow());
    const showKing = !disguised && (this.state === 'fight' || this.state === 'intro' || (this.state === 'transform' && this.grow < 0.6) || this.manual);
    this.rig.root.visible = showKing;
    if (this.state === 'transform') this.root.scale.setScalar(1 + this.grow * 2.5); else if (!this.manual) this.root.scale.setScalar(1);
    this.rig.update(dt, a);
    // the twin
    const tw = this.twin;
    this.twinRig.root.visible = tw.on && this.power === 'twins';
    if (this.twinRig.root.visible) {
      const ta = this.twinAnim;
      ta.st = st[tw.act] ?? 'idle';
      ta.p = tw.act === 'slash' ? (tw.at < tw.w ? tw.at / Math.max(0.01, tw.w) : (tw.at - tw.w) / 0.35) : tw.k;
      ta.speed = tw.act === 'sneak' ? 3 : 0;
      ta.glint = tw.act === 'slash' && tw.at > tw.w - 0.42 && tw.at < tw.w ? 1 : 0;
      ta.stir = 0.6;
      this.twinRig.root.position.copy(tw.pos);
      this.twinRig.root.rotation.y = tw.yaw;
      this.twinRig.update(dt, ta);
    }
    // the false heroes (and him in disguise — no shadow!)
    KINDS.forEach((k, i) => {
      const rig = this.heroRigs[k], an = this.heroAnims[k], blob = this.blobs[i];
      let s: Slot | null = null, real = false;
      if (this.power === 'shape' && this.state === 'fight') {
        if (i === this.realKind && disguised) { s = m; real = true; }
        else { const di = this.decoyKind.indexOf(i); if (di >= 0 && this.decoys[di].on && this.decoys[di].act !== 'gone') s = this.decoys[di]; }
      }
      rig.root.visible = !!s;
      blob.visible = !!s && !real;
      if (!s) return;
      rig.root.position.copy(s.pos); rig.root.rotation.y = s.yaw;
      an.state = s.act === 'walk' || s.act === 'decoy' ? 'run' : 'idle';
      an.speed = s.act === 'walk' || s.act === 'decoy' ? 0.5 : 0;
      an.attack = s.act === 'swipe' ? { kind: ATK_OF[k], p: clamp((s.at - s.w + 0.3) / 0.5, 0, 1) } : null;
      an.expr = 'angry';
      rig.update(dt, an);
      // (no real shadow either)
      rig.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = !real; });
      blob.position.set(s.pos.x, ROOF.y + 0.03, s.pos.z);
    });
    // the giant
    this.giant.root.visible = giantK > 0.01;
    if (this.giant.root.visible) {
      this.giant.setOpacity(giantK);
      this.giant.root.scale.setScalar(0.4 + 0.6 * ease(Math.min(1, giantK)));
      this.giant.update(dt, { breath: 1, reach: [0, 0], burn: this.state === 'shot' || this.state === 'dead' ? 1 : 0, fade: this.state === 'dead' ? this.fadeK : 0, roar: this.state === 'transform' ? this.grow : 0, bow: this.state === 'dead' ? this.fadeK : 0 });
    }
    // the hands
    this.hands.forEach((h, i) => {
      const r = this.handRigs[i];
      const show = h.on && (this.state === 'shadow' || this.state === 'shot');
      r.root.visible = r.arm.visible = show;
      if (!show) { this.handTele[i].hide(); this.handBand[i].hide(); return; }
      r.root.position.copy(h.pos);
      r.root.rotation.y = h.act === 'reach' ? h.yaw : Math.atan2(PASTILA_AT.x - h.pos.x, PASTILA_AT.z - h.pos.z);
      r.update(dt, h.act === 'slam' ? 1 : h.act === 'snatch' || h.act === 'held' ? 2 : 0, h.act === 'recoil' ? 0.3 : 0);
      this.giant.shoulders[i].getWorldPosition(tmp);
      r.setArm(tmp, tmp2.copy(h.pos).setY(h.pos.y + 0.4));
      // telegraphs: the band to the cannon, the ring under a slam
      if (h.act === 'reach' && h.at < h.w + 0.4) this.handBand[i].band(h.pos.x, h.pos.z, h.tx, h.tz, 3.2, ROOF.y, this.t, h.at > h.w ? 1 : 0);
      else this.handBand[i].hide();
      if (h.act === 'slam' && h.at < h.w + 0.2) this.handTele[i].show(h.tx, ROOF.y, h.tz, 2.6, clamp(h.at / h.w, 0, 1), h.at > h.w * 0.72, this.t);
      else this.handTele[i].hide();
    });
    // (v2) Ноки's shadow pulling a hand back from the cannon
    const held = this.hands.find((h) => h.on && h.act === 'held' && (this.state === 'shadow' || this.state === 'shot'));
    const gm = this.girlHold.material as THREE.MeshBasicMaterial;
    gm.opacity = Math.max(0, Math.min(0.92, gm.opacity + (held ? dt * 3 : -dt * 2)));
    this.girlHold.visible = gm.opacity > 0.01;
    if (held) {
      tmp.set(PASTILA_AT.x - held.pos.x, 0, PASTILA_AT.z - held.pos.z).normalize();
      this.girlHold.position.set(held.pos.x + tmp.x * 0.85, ROOF.y + 0.02, held.pos.z + tmp.z * 0.85);
      const cam = L.tcam.cam.position;
      this.girlHold.rotation.set(0, Math.atan2(cam.x - this.girlHold.position.x, cam.z - this.girlHold.position.z), Math.sin(this.t * 9) * 0.06 - 0.12);
      if (Math.random() < 0.3) ambient(L, () => L.fx.emit(this.girlHold.position.clone().setY(ROOF.y + 1), { count: 1, speed: [0.3, 1], life: [0.5, 0.9], size: [0.15, 0.3], colors: ['#b890ff', '#ffffff'], g: -1, drag: 1 }));
    }
    // the beams
    const bl = this.beamList();
    this.beamMeshes.forEach((mesh, i) => {
      const b = bl[i];
      if (!b) { mesh.visible = false; return; }
      const on = b.at > BEAM_W;
      mesh.visible = on;
      mesh.position.set(b.x, ROOF.y + 15, b.z);
      mesh.scale.set(BEAM_R, 1, BEAM_R);
      (mesh.material as THREE.MeshBasicMaterial).opacity = on ? 0.45 * Math.min(1, (BEAM_W + BEAM_ON - b.at) * 3) : 0;
    });
    if (L.authority) for (const b of this.beams) b.tele.show(b.x, ROOF.y, b.z, BEAM_R, clamp(b.at / BEAM_W, 0, 1), b.at > BEAM_W * 0.8, this.t);
    else this.netBeamTeles(bl);
    // the act's telegraphs on the floor
    this.drawTele(m, this.twin);
    // frost footprints in «Тишина Шёпота»
    if (this.power === 'silence' && this.state === 'fight' && Math.hypot(m.pos.x - this.printAt.x, m.pos.z - this.printAt.z) > 0.75) {
      this.printAt.copy(m.pos);
      this.printSide = -this.printSide;
      const pm = new THREE.Mesh(footGeo(), basic('#b8d8ff', { transparent: true, opacity: 0.8, depthWrite: false }));
      (pm.material as THREE.MeshBasicMaterial).polygonOffset = true; (pm.material as THREE.MeshBasicMaterial).polygonOffsetFactor = -3;
      pm.position.set(m.pos.x + Math.cos(m.yaw) * 0.18 * this.printSide, ROOF.y + 0.04, m.pos.z - Math.sin(m.yaw) * 0.18 * this.printSide);
      pm.rotation.y = m.yaw; noOutline(pm);
      L.scene.add(pm); this.prints.push({ m: pm, t: 0 });
    }
    for (const fp of this.prints) { fp.t += dt; (fp.m.material as THREE.MeshBasicMaterial).opacity = 0.8 * Math.max(0, 1 - fp.t / 3.5); }
    this.prints = this.prints.filter((fp) => { if (fp.t > 3.5) { fp.m.removeFromParent(); return false; } return true; });
    // the cannon and Пастила
    this.hooks.cannon.update(dt, this.charge, this.state === 'shot' ? Math.max(0, 1 - this.shotK()) : 0);
    const pn = this.hooks.pastila();
    this.pastilaHurt = Math.max(0, this.pastilaHurt - dt);
    if (pn && (this.state === 'shadow' || this.state === 'shot' || this.state === 'fight' || this.state === 'transform') && L.letterboxTarget < 0.5) {
      pn.root.visible = true;
      pn.anim.state = this.pastilaHurt > 0.4 ? 'hurt' : this.state === 'shot' ? 'cheer' : 'idle';
      pn.anim.expr = this.pastilaHurt > 0.4 ? 'hurt' : this.state === 'shadow' ? 'angry' : 'normal';
      pn.anim.attack = this.state === 'shadow' && this.pastilaHurt <= 0 ? { kind: 'flask', p: (this.t * 0.8) % 1 } : null;
    }
    // the solar shot
    const sk = this.shotK();
    this.shotBeam.visible = this.state === 'shot' && sk < 1;
    if (this.shotBeam.visible) {
      this.hooks.cannon.muzzle.getWorldPosition(tmp);
      this.giant.chest.getWorldPosition(tmp2);
      tmp2.y += 6;
      const d = tmp2.clone().sub(tmp);
      this.shotBeam.position.copy(tmp).addScaledVector(d, 0.5);
      this.shotBeam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
      this.shotBeam.scale.set(1 + Math.sin(this.t * 30) * 0.15, d.length(), 1 + Math.sin(this.t * 30) * 0.15);
      (this.shotBeam.material as THREE.MeshBasicMaterial).opacity = 0.85 * Math.min(1, sk * 6) * (1 - Math.max(0, sk - 0.7) / 0.3);
      if (Math.random() < 0.6) ambient(L, () => L.fx.emit(tmp2.clone().add(tmp.set(rand(-6, 6), rand(-4, 6), rand(-2, 2))), { count: 2, speed: [2, 6], life: [0.4, 0.9], size: [0.4, 0.9], colors: ['#ffd040', '#ff8a20', '#ffffff'], g: -3, drag: 1 }));
    }
    if (this.state === 'shot') this.shotLocalT += dt;
    // the camera's boss point
    if (this.state === 'shadow' || this.state === 'shot' || this.state === 'transform') { this.giant.chest.getWorldPosition(this.focusPt); this.focusPt.y = Math.min(this.focusPt.y, ROOF.y + 10); }
    else this.focusPt.copy(m.pos).setY(m.pos.y + 2);
    // the clock on clients
    if (!L.authority && this.state === 'shadow') {
      const bom = Math.floor(this.charge * 12 + 1e-6);
      if (bom > this.clockSeen && bom < 12) { this.clockSeen = bom; }
    }
  }
  private shotLocalT = 0;
  /** phase 3: the Солнечная пушка's charge where the boss bar was, with the clock's strikes */
  private drawCharge(ctx: CanvasRenderingContext2D) {
    const L = this.L;
    if ((this.state !== 'shadow' && this.state !== 'shot') || L.letterbox > 0.3) return;
    const bw = 640, bx = (W - bw) / 2, by = H - 56;
    const k = clamp(this.charge, 0, 1);
    text(ctx, 'СОЛНЕЧНАЯ ПУШКА', W / 2, by - 10, { size: 22, color: '#fff0b0', align: 'center', stroke: 6 });
    rrect(ctx, bx, by, bw, 26, 13, '#2a1a08', 4);
    if (k > 0) rrect(ctx, bx + 4, by + 4, (bw - 8) * k, 18, 9, this.pauseT > 0 ? '#ff8a5a' : '#ffc830', 0);
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(bx + 10, by + 6, (bw - 20) * k, 4);
    for (let i = 1; i < 12; i++) { ctx.fillStyle = i <= Math.floor(k * 12 + 1e-6) ? '#fff6c0' : 'rgba(0,0,0,0.5)'; ctx.fillRect(bx + 4 + (bw - 8) * (i / 12) - 1.5, by + 2, 3, 22); }
    text(ctx, `${Math.round(k * 100)}%`, bx + bw + 14, by + 20, { size: 18, color: '#fff0b0', stroke: 4 });
  }
  private shotK() { return clamp((this.L.authority ? this.shotT : this.shotLocalT) / 2.6, 0, 1); }
  /** 0..1 how faded the giant is (the defeat scene sets it) */
  fadeK = 0;
  private visGoalNow() { return this.L.authority ? Math.max(this.visGoal, this.invis.revealT > 0 ? 1 : 0) : this.netVis; }
  private netVis = 1;

  private drawTele(m: Slot, tw: Slot) {
    let shown = false;
    for (const s of [m, tw]) {
      if (s === tw && !tw.on) continue;
      if (s.act === 'slash' && s.at < s.w + 0.05) {
        shown = true;
        const k = clamp(s.at / s.w, 0, 1);
        this.sector.position.set(s.pos.x, s.pos.y + 0.06, s.pos.z); this.sector.rotation.y = s.yaw - Math.PI / 2 + Math.PI / 2;
        this.sector.scale.setScalar(4.2); this.sectorFill.position.copy(this.sector.position); this.sectorFill.rotation.y = this.sector.rotation.y;
        this.sectorFill.scale.setScalar(Math.max(0.01, 4.2 * k));
        this.sector.visible = this.sectorFill.visible = true;
        this.sectorM.opacity = k > 0.6 ? 0.6 + 0.35 * Math.sin(this.t * 40) : 0.55;
        break;
      }
    }
    if (!shown) this.sector.visible = this.sectorFill.visible = false;
    if (m.act === 'lunge' && m.at < m.w + 0.45) this.band.band(this.lungeA().x, this.lungeA().z, m.tx, m.tz, 1.8, ROOF.y, this.t, m.at > m.w * 0.7 ? 1 : 0); else this.band.hide();
    if (m.act === 'mark' || m.act === 'dive') this.tele.show(m.tx, ROOF.y, m.tz, 2.3, m.act === 'dive' ? 1 : clamp(m.at / Math.max(0.01, m.dur - 0.35), 0, 1), m.act === 'dive' || m.at > m.dur - 0.35, this.t);
    else if (m.act === 'ambush' && m.at < m.w + 0.05) this.tele.show(m.tx, ROOF.y, m.tz, 2.0, clamp(m.at / m.w, 0, 1), m.at > m.w * 0.7, this.t);
    else this.tele.hide();
    // the thrown swords' red lines (the fan over him, a twin's single throw)
    this.tele2.hide();
    const lines: { from: THREE.Vector3; to: THREE.Vector3; hot: boolean }[] = [];
    if (m.act === 'blades' && m.at < m.w) for (const a of this.L.authority ? this.bladeAims : this.netAims) lines.push({ from: m.pos, to: a, hot: m.at > m.w * 0.7 });
    for (const s of [m, tw]) if ((s === m || tw.on) && s.act === 'throw' && s.at < s.w) lines.push({ from: s.pos, to: tmp3.set(s.tx, ROOF.y, s.tz).clone(), hot: s.at > s.w * 0.7 });
    while (this.aimStripes.length < lines.length) { const st = new Stripe(); this.L.scene.add(st.mesh); this.aimStripes.push(st); }
    this.aimStripes.forEach((st, i) => {
      const l = lines[i];
      if (!l) { st.hide(); return; }
      const dx = l.to.x - l.from.x, dz = l.to.z - l.from.z, d = Math.hypot(dx, dz) || 1;
      st.band(l.from.x + dx / d * 0.8, l.from.z + dz / d * 0.8, l.from.x + dx / d * 16, l.from.z + dz / d * 16, 0.75, ROOF.y, this.t, l.hot ? 1 : 0);
    });
  }
  private lungeStart = new THREE.Vector3();
  private netAims: THREE.Vector3[] = [];
  private aimStripes: Stripe[] = [];
  private lungeA() { return this.L.authority ? this.lungeFrom : this.lungeStart; }

  private netTele: Tele[] = [];
  private netBeamTeles(bl: { x: number; z: number; at: number }[]) {
    while (this.netTele.length < bl.length) { const t = new Tele(); this.L.scene.add(t.g); this.netTele.push(t); }
    this.netTele.forEach((t, i) => { const b = bl[i]; if (!b) { t.hide(); return; } t.show(b.x, ROOF.y, b.z, BEAM_R, clamp(b.at / BEAM_W, 0, 1), b.at > BEAM_W * 0.8, this.t); });
  }

  // ═════════════════════════════ co-op replication ═════════════════════════════
  netSnap(): number[] {
    const o: number[] = [STATES.indexOf(this.state), this.phase, this.hp, this.maxHp, this.charge, POWERS.indexOf(this.power),
      this.realKind, ...this.decoyKind, this.visGoalNow(), this.grow, this.lungeFrom.x, this.lungeFrom.z, this.pauseT > 0 ? 1 : 0, this.fadeK];
    this.main.snap(o); this.twin.snap(o);
    for (const d of this.decoys) d.snap(o);
    for (const h of this.hands) h.snap(o);
    o.push(this.beams.length);
    for (const b of this.beams) o.push(b.x, b.z, b.at, b.seq);
    const aims = this.main.act === 'blades' && this.main.at < this.main.w ? this.bladeAims : [];
    o.push(aims.length);
    for (const a of aims) o.push(a.x, a.z);
    return o;
  }
  netApply(a: number[], t?: number) {
    if (t === undefined) return;
    const base = 16;
    let i = base;
    const slots = [this.main, this.twin, ...this.decoys, ...this.hands];
    for (const s of slots) { s.push(t, a, i, s === this.main ? 40 : 80); i += Slot.N; }
    // the main slot's track carries the whole record (handed out as the playback passes it)
    (this.recTrack ??= new NetTrack<number[]>(200)).push(t, a[base], a[base + 1], a[base + 2], a[base + 3], a);
  }
  private recTrack: NetTrack<number[]> | null = null;
  private fields(a: number[]) {
    this.state = STATES[a[0]] ?? this.state;
    if (a[1] > this.phase && this.got && a[1] === 2) { /* the phase banner comes with the host's captured fx */ }
    this.phase = a[1]; this.hp = a[2]; this.maxHp = a[3]; this.charge = a[4]; this.power = POWERS[a[5]] ?? 'none';
    this.realKind = a[6]; this.decoyKind = [a[7], a[8], a[9]];
    this.netVis = a[10]; this.grow = a[11];
    this.lungeStart.set(a[12], ROOF.y, a[13]);
    this.fadeK = a[15];
    let i = 16;
    const slots = [this.main, this.twin, ...this.decoys, ...this.hands];
    for (const s of slots) { s.fields(a, i); i += Slot.N; }
    const nb = a[i++] || 0;
    const beams: { x: number; z: number; at: number; seq: number }[] = [];
    for (let k = 0; k < nb; k++, i += 4) beams.push({ x: a[i], z: a[i + 1], at: a[i + 2], seq: a[i + 3] });
    this.netBeams = beams;
    const na = a[i++] || 0;
    this.netAims = [];
    for (let k = 0; k < na; k++, i += 2) this.netAims.push(new THREE.Vector3(a[i], ROOF.y, a[i + 1]));
    this.got = true;
  }
  private puppet(L: Level3D, dt: number) {
    const play = L.nl?.playT ?? -Infinity, pdt = L.nl?.playDt ?? dt;
    const slots = [this.main, this.twin, ...this.decoys, ...this.hands];
    // between snapshots the acts run on by the playback's clock
    for (const s of slots) s.at += pdt;
    for (const b of this.netBeams) b.at += pdt;
    if (this.recTrack && this.recTrack.eval(play, dt, pose)) this.recTrack.passed(play, (r) => this.fields(r));
    for (const s of slots) s.play(play, dt);
    if (this.state === 'shadow' || this.state === 'shot') { /* charge comes with the record */ }
    L.hud.bossName = this.name; L.hud.bossHp = this.hp; L.hud.bossMax = this.state === 'fight' ? this.maxHp : 0;
    if (this.netDied && this.state !== 'dead') this.state = 'dead';
  }
  netEvent(L: Level3D, ev: string, d: { id?: number; p?: number[]; d?: number[]; s?: number | string; w?: string }) {
    if (L.authority) return;
    if (ev === 'bk') { this.localSay(d.w ?? 'p', String(d.s ?? '')); return; }
    if (ev === 'blade' && d.p && d.d) this.blades.push(new Blade(d.id ?? 0, new THREE.Vector3(d.p[0], d.p[1], d.p[2]), new THREE.Vector3(d.d[0], d.d[1], d.d[2]), Number(d.s ?? 17), L));
    else if (ev === 'reflect') { const b = this.blades.find((x) => x.id === d.id); if (b) this.reflect(L, b); }
    else if (ev === 'swap') this.swapFx(L);
    else if (ev === 'pastila') this.pastilaHurt = 1;
    else if (ev === 'shot') { this.shotLocalT = 0; }
    else if (ev === 'dead') this.netDied = true;
  }
  /** the host left: this machine runs the fight now from where the puppet was */
  private takeOver() {
    this.wasPuppet = false;
    for (const s of [this.main, this.twin, ...this.decoys, ...this.hands]) s.track = null;
    this.recTrack = null;
    if (this.state === 'fight') { this.power = 'none'; this.twin.on = false; for (const d of this.decoys) d.on = false; this.main.go('idle'); this.main.pos.y = ROOF.y; this.cd = 1; this.visGoal = 1; }
    if (this.state === 'shadow') for (const h of this.hands) h.go('rest', 2);
  }

  private bladeHit: Hittable3;
  /** my swing on my screen: a sword I hit flies back at once (the host decides for real) */
  private predictBlades(L: Level3D, c: THREE.Vector3, range: number): boolean {
    // my swing on my screen: a sword I hit flies back at once (the host decides for real)
    let any = false;
    for (const b of this.blades) if (!b.dead && !b.back && b.pos.distanceTo(c) < range + 1.0) { any = true; this.reflect(L, b); }
    return any;
  }

  sync(dt: number) { this.root.position.copy(this.main.pos); this.root.rotation.y = this.main.yaw; this.rig.update(dt, this.anim); }

  /** test hooks (dev): jump to a phase / power, fill the charge */
  dev(cmd: string) {
    const L = this.L;
    if (!L.authority) return;
    if (cmd === 'p2') { this.hp = Math.round(this.maxHp * 0.59); }
    else if (cmd === 'p3') { this.hp = Math.round(this.maxHp * 0.24); if (this.phase === 1) this.toPhase2(L); }
    else if (cmd === 'charge') { this.charge = 1; this.pauseT = 0; }
    else if (POWERS.includes(cmd as Power)) { this.powerOrder = [cmd as Power]; this.interlude = 0; this.power = 'none'; this.main.go('idle'); this.cd = 0; }
  }
}

const BEAM_W = 1.3, BEAM_ON = 1.2, BEAM_R = 2.6;

function inSector(p: THREE.Vector3, o: THREE.Vector3, yaw: number, r: number, half: number) {
  const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz);
  if (d > r) return false;
  if (d < 0.6) return true;
  const a = Math.atan2(dx, dz);
  return Math.abs(wrapA(a - yaw)) < half;
}

let footG: THREE.BufferGeometry | null = null;
function footGeo() {
  if (footG) return footG;
  const s = new THREE.Shape();
  s.absellipse(0, 0, 0.11, 0.2, 0, Math.PI * 2, false, 0);
  footG = new THREE.ShapeGeometry(s, 8).rotateX(-Math.PI / 2);
  return footG;
}

