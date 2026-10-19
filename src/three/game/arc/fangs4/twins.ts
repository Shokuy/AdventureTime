import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { save } from '../../../../engine/save';
import { W, choose, clamp, damp, rand } from '../../../../engine/util';
import { rrect, text } from '../../../../art/draw';
import { net } from '../../../../net/session';
import { basic, noOutline } from '../../../gfx';
import { toUI } from '../../../runtime';
import { coop } from '../../coop';
import { Wave3 } from '../../objects';
import type { Shot3 } from '../../objects';
import { NetTrack, type NetPose } from '../../netInterp';
import type { Level3D, Boss3Like, HeroLike, Actor3 } from '../../level';
import type { Netted } from '../../netLevel';
import type { RemoteHero3 } from '../../remoteHero';
import { ambient, markCharacter, GroundMark } from '../vampires';
import { createSister, SISTER_COLOR, type SisterKind, type SisterRig, type SisterAnim } from './models';
import { LINES4 } from './lines';
import { talkers } from './speech';
import { cast, mark, faceTo, hideCast, type CastKind } from './cast';

/**
 * Мини-боссы «Сёстры Близняшки» (script 8.3–8.5). Two vampire sisters on the summit, each with a GAZE: a cone on the
 * ground in her colour.
 *  • THE RULE (toast of 8.3): «Пока сестра смотрит на вас, её близняшку не ранить». A sister can be hurt only by a hero
 *    her twin is NOT watching. Each sister watches the hero nearest to HER (≤ 5 m — she defends herself) or else the
 *    one nearest to her twin (she guards her sister). So: one hero keeps a sister busy, another one hits the other one
 *    — or split and hit both at once.
 *  • SHARED LIFE: a wound «heals» back (the twin gives her strength) unless the OTHER sister is hurt too within a few
 *    seconds — then both wounds stay («ОБЕ РАНЕНЫ!»). One sister down → the other can't heal any more.
 *  • THE RHYTHM: watch (gaze marks: stand in a gaze too long and shadow spikes erupt under you, ring first) → sometimes
 *    a combined attack (both dash at the heroes they watch along lit lanes; phase 2: two shadow rings to jump) → SWAP
 *    («Меняемся!»: they vanish and reappear in each other's place) → BLIND for a moment (hands over the eyes, no gaze —
 *    both open to everyone) → watch again. Phase 2 (half health): the quarrel, faster gazes, more combos.
 *  • SOLO: the story cast helps (GDD §8): Бублик (Тоша when you play Бублик) distracts the guarding sister every
 *    watch («Эй, тётя! Смотри, какой я длинный!»), Тоша calls the opening, Ноки warns about the wrong one, Пастила
 *    slows a gaze with syrup. The swap then puts the other sister right next to you, blind: hit her — both wounds stay.
 * Hero kits: Ноки's chord dazzles a sister (no gaze for a moment); Пастила's syrup slows a gaze.
 *
 * Co-op: the host runs the fight (gazes, rules, HP × party, attacks); clients play both sisters back from its
 * snapshots (NetTrack per sister, teleport counter for swaps) and draw cones, lanes, rings, HUD from them. Hits are
 * resolved on the host with the attacker's position as the host sees it. Spikes run on the shared clock and are
 * victim-side like the dash (each machine tests its own hero against what it shows).
 */

const NET_ID = 94140;
const ACTS = ['idle', 'walk', 'mark', 'dashPrep', 'dash', 'swapOut', 'swapIn', 'blind', 'hurt', 'down', 'talk'] as const;
type Act = (typeof ACTS)[number];
const MODES = ['intro', 'watch', 'combo', 'swap', 'blind', 'alone', 'dead'] as const;
type Mode = (typeof MODES)[number];

const HALF = 0.46;        // gaze cone half angle
const GAZE_LEN = 30;
const SELF_R = 5;
const RING = 6;           // the sisters' circle around the stone
const SCALE = 1.3;
const pose: NetPose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clk = (L: Level3D) => (L.nl ? net.time() : L.t);

interface Sis {
  i: number; kind: SisterKind; rig: SisterRig; root: THREE.Group; anim: SisterAnim;
  pos: THREE.Vector3; yaw: number; gaze: number; gazeOn: number;
  hp: number; maxHp: number; fresh: number; freshT: number;
  act: Act; actT: number; actMax: number;
  target: HeroLike | null; watchT: number; markCD: number;
  distractT: number; distractAt: THREE.Vector3; slowT: number; stunT: number;
  talk: number; flash: number; vanish: number; down: boolean; spiked: boolean; hidden: boolean;
  dashTo: THREE.Vector3; dashFrom: THREE.Vector3;
  hitIds: Set<number>;
  cone: THREE.Mesh; coneM: THREE.MeshBasicMaterial; lane: THREE.Mesh; laneM: THREE.MeshBasicMaterial;
  tp: number;
  track: NetTrack<number[]> | null;
}

export class Twins implements Boss3Like, Netted, Actor3 {
  netId = 0;
  dead = false;
  name = 'СЁСТРЫ БЛИЗНЯШКИ';
  /** both sisters' health together (the generic boss API: co-op hit credit in score.ts, dev tools) */
  get hp() { return this.sis[0].hp + this.sis[1].hp; }
  get maxHp() { return this.sis[0].maxHp + this.sis[1].maxHp; }
  mode: Mode = 'intro';
  modeT = 0;
  phase = 1;
  cycle = 0;
  sis: [Sis, Sis];
  /** fight on (between the intro's start() and the knockout) */
  get fighting() { return this.mode !== 'intro' && this.mode !== 'dead'; }
  /** host: the knockout (solo / host runs the defeat scene) */
  onDefeat: (() => void) | null = null;
  /** solo helpers' spots (set by the level) */
  helpers: { kind: CastKind; at: THREE.Vector3 }[] = [];
  private theta = 0;
  private linkT: number;
  private helpT = 0; private helpN = 0; private nokiCD = 0; private pastilaT = 8;
  private hinted = new Set<string>();
  private quarrelT = -1;
  private quarrelI = 0;
  private swapped = false;
  private comboKind = 0;
  private hudK = 0;
  private won = false;
  private spikes: Spike[] = [];
  constructor(private L: Level3D, readonly C: THREE.Vector3, readonly R: number) {
    const party = L.nl ? coop.hpScale() : 1;
    const base = (L.nl ? coop.easy : save.data.settings.easy) ? 16 : 22;
    const hp = Math.round(base * party);
    this.linkT = L.nl ? 4.2 : 7;
    this.sis = [this.makeSis(0, 'nochka', hp), this.makeSis(1, 'tenka', hp)];
    this.place();
    talkers.set(L, (who) => { this.sis[who === 'nochka' ? 0 : 1].talk = 0.35; });
    L.actors.push(this);
    L.overlayDraw.push((ctx) => this.drawHud(ctx));
    L.nl?.add(this, NET_ID);
  }
  get netRoot() { return this.sis[0].root; }

  private makeSis(i: number, kind: SisterKind, hp: number): Sis {
    const L = this.L;
    const rig = createSister(kind);
    // (mini-bosses: a head taller than the heroes)
    rig.root.scale.setScalar(SCALE);
    const root = new THREE.Group();
    root.add(rig.root);
    markCharacter(rig.root);
    L.scene.add(root);
    const coneM = basic(SISTER_COLOR[kind], { additive: true, opacity: 0, depthWrite: false });
    coneM.polygonOffset = true; coneM.polygonOffsetFactor = -4;
    const cone = new THREE.Mesh(new THREE.CircleGeometry(GAZE_LEN, 24, Math.PI / 2 - HALF, HALF * 2).rotateX(-Math.PI / 2), coneM);
    cone.renderOrder = 3; noOutline(cone); cone.visible = false;
    L.scene.add(cone);
    const laneM = basic('#ff3a4a', { additive: true, opacity: 0, depthWrite: false });
    laneM.polygonOffset = true; laneM.polygonOffsetFactor = -4;
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5), laneM);
    lane.renderOrder = 3; noOutline(lane); lane.visible = false;
    L.scene.add(lane);
    return {
      i, kind, rig, root, anim: { st: 'idle', p: 0, head: 0, flash: 0, talk: 0, eyes: 0 },
      pos: new THREE.Vector3(), yaw: 0, gaze: 0, gazeOn: 0,
      hp, maxHp: hp, fresh: 0, freshT: 0,
      act: 'idle', actT: 0, actMax: 1, target: null, watchT: 0, markCD: 2,
      distractT: 0, distractAt: new THREE.Vector3(), slowT: 0, stunT: 0,
      talk: 0, flash: 0, vanish: 0, down: false, spiked: false, hidden: false,
      dashTo: new THREE.Vector3(), dashFrom: new THREE.Vector3(), hitIds: new Set(),
      cone, coneM, lane, laneM, tp: 0, track: null,
    };
  }

  /** stand back to back at the stone (the intro pose): Ночка looks left (−X), Тенька right (+X) */
  place() {
    const [a, b] = this.sis;
    a.pos.set(this.C.x - 0.9, this.C.y, this.C.z + 2.2); a.yaw = -Math.PI / 2; a.gaze = a.yaw;
    b.pos.set(this.C.x + 0.9, this.C.y, this.C.z + 2.2); b.yaw = Math.PI / 2; b.gaze = b.yaw;
    this.theta = Math.PI;
    for (const s of this.sis) this.sync(s, 0);
  }

  /** host / solo: the fight begins (after the intro scene) */
  start() {
    if (this.fighting || this.won) return;
    this.mode = 'watch'; this.modeT = 0; this.cycle = 0;
    this.helpT = 0; this.helpN = 0;
    for (const s of this.sis) { s.act = 'idle'; s.markCD = 2.5; s.vanish = 0; s.gazeOn = 0; }
  }

  private twin(s: Sis) { return this.sis[1 - s.i]; }
  private home(s: Sis) { const a = this.theta + s.i * Math.PI; return v1.set(this.C.x + Math.cos(a) * RING, this.C.y, this.C.z + Math.sin(a) * RING).clone(); }
  private go(s: Sis, act: Act, secs = 0) { s.act = act; s.actT = 0; s.actMax = Math.max(0.001, secs); s.spiked = false; }
  private center(s: Sis, out = new THREE.Vector3()) { return out.copy(s.pos).setY(s.pos.y + 1.05 * SCALE); }
  private heroesIn(L: Level3D) { return L.alivePlayers().filter((h) => !(h as { stale?: boolean }).stale && Math.hypot(h.pos.x - this.C.x, h.pos.z - this.C.z) < this.R + 6 && Math.abs(h.pos.y - this.C.y) < 6); }
  /** a point is inside sister s's gaze (and her gaze is on) */
  inCone(s: Sis, p: THREE.Vector3) {
    if (s.gazeOn < 0.5 || s.down || s.vanish > 0.5) return false;
    const dx = p.x - s.pos.x, dz = p.z - s.pos.z, d = Math.hypot(dx, dz);
    if (d > GAZE_LEN) return false;
    if (d < 0.9) return true;
    return Math.abs(wrapA(Math.atan2(dx, dz) - s.gaze)) < HALF + Math.atan(0.45 / d);
  }
  /** THE RULE: sister s can be hurt by a hero at p */
  canHurt(s: Sis, p: THREE.Vector3) {
    if (!this.fighting || s.down || s.vanish > 0.5) return false;
    const t = this.twin(s);
    return t.down || !this.inCone(t, p);
  }

  // ───────────────────────── per frame ─────────────────────────
  update(L: Level3D, dt: number) {
    if (L.authority) {
      // co-op: I just became the host mid-fight — carry on from what I was showing
      if (this.wasPuppet) { this.wasPuppet = false; this.takeOver(); }
      this.host(L, dt);
    } else { this.puppet(L, dt); this.wasPuppet = true; }
    for (const s of this.sis) this.sync(s, dt);
    this.spikes = this.spikes.filter((k) => !k.update(L));
    if (this.fighting) this.dashHitMine(L);
    this.hudK = damp(this.hudK, this.fighting && L.letterbox < 0.3 ? 1 : 0, 6, dt);
  }

  private host(L: Level3D, dt: number) {
    this.modeT += dt;
    for (const s of this.sis) {
      s.actT += dt; s.flash = Math.max(0, s.flash - dt * 5); s.talk = Math.max(0, s.talk - dt * 3);
      s.distractT -= dt; s.slowT -= dt; s.stunT -= dt; s.markCD -= dt;
      if (s.freshT > 0) { s.freshT -= dt; if (s.freshT <= 0 && s.fresh > 0) this.healBack(L, s); }
    }
    this.nokiCD -= dt;
    if (!this.fighting || L.worldCut) { for (const s of this.sis) { if (this.mode === 'intro') s.gazeOn = damp(s.gazeOn, 0, 6, dt); } return; }
    const hs = this.heroesIn(L);
    for (const s of this.sis) {
      // short reactions end by themselves; alone, the swap / blind of the pair is over too
      if (s.act === 'hurt' && s.actT >= s.actMax) this.go(s, 'idle');
      if (this.mode === 'alone' && !s.down && (s.act === 'blind' || s.act === 'swapOut' || s.act === 'swapIn')) this.go(s, 'idle');
    }
    // the quarrel (phase 2): four lines, one every 1.4 s
    if (this.quarrelT >= 0) {
      this.quarrelT += dt;
      const q = LINES4.quarrel;
      if (this.quarrelI < q.length && this.quarrelT >= this.quarrelI * 1.4) { const [w, s] = q[this.quarrelI++]; this.say(L, this.sis[w === 'nochka' ? 0 : 1], s, 1.3); }
      if (this.quarrelI >= q.length) this.quarrelT = -1;
    }
    const spd = this.phase === 2 ? 1.25 : 1;
    switch (this.mode) {
      case 'watch': {
        const dur = (this.phase === 2 ? 5.2 : 6.5) / (L.nl ? 1 + 0.06 * (L.heroes().length - 1) : 1);
        for (const s of this.sis) { if (s.act === 'idle' || s.act === 'walk' || s.act === 'talk') this.drift(s, dt); this.watch(L, s, hs, dt); }
        if (!L.nl) this.soloHelp(L, hs, dt);
        if (this.modeT > dur && this.sis.every((s) => s.act !== 'mark')) {
          const combo = this.phase === 2 || this.cycle % 2 === 1;
          if (combo) this.startCombo(L, hs); else this.startSwap(L);
        }
        break;
      }
      case 'combo': this.combo(L, hs, dt); break;
      case 'swap': this.swap(L, dt); break;
      case 'blind':
        for (const s of this.sis) { s.gazeOn = damp(s.gazeOn, 0, 10, dt); this.drift(s, dt); }
        if (this.modeT > (L.nl ? 2.3 : 3.0) / spd) { this.mode = 'watch'; this.modeT = 0; this.cycle++; for (const s of this.sis) if (!s.down) this.go(s, 'idle'); }
        break;
      case 'alone': {
        const s = this.sis.find((x) => !x.down)!;
        if (s.act === 'idle' || s.act === 'walk') this.drift(s, dt);
        this.watch(L, s, hs, dt, true);
        if (s.act === 'dash' || s.act === 'dashPrep') this.dashStep(L, s, dt);
        else if (this.modeT > 4.5 && s.act !== 'mark') { this.modeT = 0; this.prepDash(L, s, hs); }
        break;
      }
    }
  }

  private wasPuppet = false;
  private takeOver() {
    const a = this.sis.find((s) => !s.down) ?? this.sis[0];
    this.theta = Math.atan2(a.pos.z - this.C.z, a.pos.x - this.C.x) - a.i * Math.PI;
    this.modeT = 0; this.swapped = this.mode === 'swap';
    for (const s of this.sis) { s.actMax = 1; s.actT = 0; if (!s.down && s.act !== 'down') s.act = this.mode === 'blind' ? 'blind' : 'idle'; s.target = null; }
  }

  /** float slowly round the stone toward her place on the circle */
  private drift(s: Sis, dt: number) {
    if (s.down) return;
    this.theta += dt * 0.08;
    const h = this.home(s);
    const d = h.distanceTo(s.pos);
    if (d > 0.05) s.pos.lerp(h, Math.min(1, dt * (d > 4 ? 0.9 : 1.6)));
    if (s.act === 'idle' && d > 1.5) s.act = 'walk'; else if (s.act === 'walk' && d < 0.6) s.act = 'idle';
  }

  /** the gaze: self-defence, else guard the twin; marks a hero kept in the gaze too long */
  private watch(L: Level3D, s: Sis, hs: HeroLike[], dt: number, alone = false) {
    if (s.down) { s.gazeOn = damp(s.gazeOn, 0, 8, dt); return; }
    const t = this.twin(s);
    let target: HeroLike | null = null, look: THREE.Vector3 | null = null;
    if (s.distractT > 0) look = s.distractAt;
    else {
      let best = SELF_R, near: HeroLike | null = null;
      for (const h of hs) { const d = Math.hypot(h.pos.x - s.pos.x, h.pos.z - s.pos.z); if (d < best) { best = d; near = h; } }
      if (near) target = near;
      else if (!alone && !t.down && hs.length) {
        let bd = Infinity;
        for (const h of hs) { const d = Math.hypot(h.pos.x - t.pos.x, h.pos.z - t.pos.z); if (d < bd) { bd = d; target = h; } }
      } else if (hs.length) target = hs[0];
      if (target) look = target.pos;
    }
    if (target !== s.target) { s.target = target; s.watchT = 0; }
    const stunned = s.stunT > 0;
    s.gazeOn = damp(s.gazeOn, stunned ? 0 : 1, stunned ? 12 : 4, dt);
    if (look) {
      const want = Math.atan2(look.x - s.pos.x, look.z - s.pos.z);
      const rate = (this.phase === 2 || alone ? 2.4 : 1.7) * (s.slowT > 0 ? 0.4 : 1);
      s.gaze += clamp(wrapA(want - s.gaze), -rate * dt, rate * dt);
    } else s.gaze += dt * 0.5;
    // the body turns after the gaze (the head does the rest)
    s.yaw += clamp(wrapA(s.gaze - s.yaw), -2 * dt, 2 * dt);
    // a hero kept in her gaze gets a shadow spike under his feet (ring first)
    if (s.target && this.inCone(s, s.target.pos) && s.distractT <= 0) s.watchT += dt; else s.watchT = Math.max(0, s.watchT - dt * 2);
    const after = alone ? 1.3 : this.phase === 2 ? 1.6 : 2.1;
    if (s.act === 'mark') {
      if (s.actT > 0.25 && !s.spiked && s.target) { this.spike(L, s.target.pos); s.spiked = true; }
      if (s.actT > 0.55) this.go(s, 'idle');
    } else if (s.target && s.watchT > after && s.markCD <= 0 && (s.act === 'idle' || s.act === 'walk')) {
      this.go(s, 'mark', 1);
      s.markCD = (alone ? 2 : this.phase === 2 ? 2.6 : 3.4) / (L.nl ? 1 + 0.12 * (L.heroes().length - 1) : 1);
      s.watchT = 0;
      if (Math.random() < 0.6) this.say(L, s, s.kind === 'nochka' ? LINES4.nochka[0] : choose([LINES4.tenka[2], LINES4.nochka[2]]), 1.2);
    }
  }

  // ───────── attacks ─────────
  /** host: a shadow spike at p (every machine runs it on the shared clock) */
  private spike(L: Level3D, p: THREE.Vector3) {
    const at = clk(L) + 0.95;
    const gy = L.phys.groundAt(p.x, p.z, p.y + 1, 0.2);
    const pos = new THREE.Vector3(p.x, gy > -1e8 ? gy : p.y, p.z);
    this.spikes.push(new Spike(L, pos, at));
    L.nl?.entEvent(this, 'spike', { p: [pos.x, pos.y, pos.z], at });
  }

  private startCombo(L: Level3D, hs: HeroLike[]) {
    this.mode = 'combo'; this.modeT = 0;
    this.comboKind = this.phase === 2 && this.cycle % 2 === 0 ? 1 : 0;
    if (this.comboKind === 0) {
      for (const s of this.sis) if (!s.down) this.prepDash(L, s, hs);
      this.say(L, this.sis[0], LINES4.nochka[1], 1.2);
      this.say(L, this.sis[1], LINES4.tenka[1], 1.2);
    } else {
      for (const s of this.sis) if (!s.down) this.go(s, 'mark', 1.1);
      this.say(L, this.sis[0], LINES4.nochka[3], 1.4);
    }
  }
  private prepDash(L: Level3D, s: Sis, hs: HeroLike[]) {
    const tgt = s.target && hs.includes(s.target) ? s.target : hs[0];
    const aim = tgt ? tgt.pos.clone() : this.C.clone().add(v2.set(rand(-4, 4), 0, rand(-4, 4)));
    const dir = aim.sub(s.pos).setY(0);
    if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
    dir.normalize();
    // along the lane to the rim of the arena (never off the edge)
    let len = 0;
    for (let k = 1; k <= 26; k++) { v2.copy(s.pos).addScaledVector(dir, k); if (Math.hypot(v2.x - this.C.x, v2.z - this.C.z) > this.R - 1.2) break; len = k; }
    len = Math.max(4, len);
    s.dashFrom.copy(s.pos);
    s.dashTo.copy(s.pos).addScaledVector(dir, len);
    s.yaw = s.gaze = Math.atan2(dir.x, dir.z);
    this.go(s, 'dashPrep', this.phase === 2 ? 0.9 : 1.1);
  }
  /** a dash step (host): prep → dash → idle */
  private dashStep(L: Level3D, s: Sis, dt: number) {
    if (s.act === 'dashPrep' && s.actT >= s.actMax) { this.go(s, 'dash', s.dashFrom.distanceTo(s.dashTo) / 24); audio.sfx('whoosh', { pitch: 0.8 }); }
    else if (s.act === 'dash') {
      const u = clamp(s.actT / s.actMax, 0, 1);
      s.pos.lerpVectors(s.dashFrom, s.dashTo, u);
      if (u >= 1) { this.go(s, 'idle'); L.fx.dust(s.pos.clone(), 10, '#c8b0e0'); }
    }
    void dt;
  }
  private combo(L: Level3D, hs: HeroLike[], dt: number) {
    if (this.comboKind === 0) {
      for (const s of this.sis) if (!s.down) { this.dashStep(L, s, dt); s.gazeOn = damp(s.gazeOn, 0.6, 4, dt); }
      if (this.sis.every((s) => s.down || s.act === 'idle') && this.modeT > 0.5) {
        // they ended up wherever their lanes took them: the circle turns to match
        const a = this.sis.find((s) => !s.down)!;
        this.theta = Math.atan2(a.pos.z - this.C.z, a.pos.x - this.C.x) - a.i * Math.PI;
        this.startSwap(L);
      }
    } else {
      for (const s of this.sis) if (!s.down) this.watch(L, s, hs, dt);
      if (this.modeT > 0.6 && this.modeT - dt <= 0.6) {
        for (const s of this.sis) if (!s.down) {
          const w = new Wave3(s.pos.clone(), 8.5, this.R + 3, 1);
          L.addWave(w);
          L.fx.ring(s.pos.clone().setY(s.pos.y + 0.2), 3, SISTER_COLOR[s.kind], 0.4);
        }
        audio.sfx('bigSlam', { volume: 0.6 }); L.tcam.shake(0.4);
      }
      if (this.modeT > 2.4) this.startSwap(L);
    }
  }

  private startSwap(L: Level3D) {
    if (this.sis.some((s) => s.down)) { this.mode = 'alone'; this.modeT = 0; return; }
    this.mode = 'swap'; this.modeT = 0; this.swapped = false;
    for (const s of this.sis) this.go(s, 'swapOut', 0.38);
    this.say(L, this.sis[this.cycle % 2], choose(LINES4.swap as unknown as string[]), 1.1);
    audio.sfx('whoosh', { pitch: 1.4 });
  }
  private swap(L: Level3D, dt: number) {
    for (const s of this.sis) s.gazeOn = damp(s.gazeOn, 0, 10, dt);
    // (by the mode's clock: a hit in the middle of it must never stall the swap)
    if (!this.swapped && this.modeT >= 0.38) {
      this.swapped = true;
      // in each other's place
      const a = this.sis[0].pos.clone();
      this.sis[0].pos.copy(this.sis[1].pos); this.sis[1].pos.copy(a);
      this.theta += Math.PI;
      for (const s of this.sis) {
        s.tp++;
        this.go(s, 'swapIn', 0.35);
        s.yaw = s.gaze = Math.atan2(this.C.x - s.pos.x, this.C.z - s.pos.z) + Math.PI;
        L.fx.emit(this.center(s), { count: 22, speed: [2, 5], life: [0.3, 0.6], size: [0.2, 0.4], colors: [SISTER_COLOR[s.kind], '#ffffff', '#2a1a3a'], drag: 3 });
      }
      audio.sfx('reflect', { pitch: 0.7 });
    }
    if (this.swapped && this.modeT >= 0.73) {
      this.mode = 'blind'; this.modeT = 0;
      for (const s of this.sis) this.go(s, 'blind', 3);
      this.hintOnce(L, 'blind', LINES4.twinsBlind);
    }
  }

  // ───────── solo: the story cast helps (GDD §8) ─────────
  private soloHelp(L: Level3D, hs: HeroLike[], dt: number) {
    const me = L.player;
    if (!hs.includes(me) || !this.helpers.length) return;
    this.helpT += dt;
    // the sister I'm next to and her twin (the one guarding her)
    const [a, b] = this.sis;
    const near = a.pos.distanceTo(me.pos) <= b.pos.distanceTo(me.pos) ? a : b;
    const guard = this.twin(near);
    const distractor = this.helpers.find((h) => h.kind === 'bublik') ?? this.helpers.find((h) => h.kind === 'tosha');
    if (distractor && this.helpN === this.cycle && this.helpT > 1.2 && near.pos.distanceTo(me.pos) < 7) {
      this.helpN = this.cycle + 1; this.helpT = 0;
      guard.distractT = 4.3; guard.distractAt.copy(distractor.at);
      const n = cast(L)[distractor.kind];
      n.anim.state = 'wave'; faceTo(n, guard.pos.x, guard.pos.z);
      if (distractor.kind === 'bublik') n.anim.fx = { reach: 2.6 };
      this.castSay(L, distractor.kind, distractor.kind === 'bublik' ? LINES4.help.bublik : LINES4.help.toshaDistract);
      const caller = this.helpers.find((h) => h.kind === 'tosha' && h !== distractor) ?? this.helpers.find((h) => h.kind === 'pastila');
      if (caller) this.later(1.0, () => this.castSay(L, caller.kind, LINES4.help.tosha));
    }
    if (this.helpT > 4.5) for (const h of this.helpers) { const n = cast(L)[h.kind]; if (n.anim.state === 'wave') { n.anim.state = 'idle'; n.anim.fx = {}; } }
    // Пастила's syrup now and then
    const pas = this.helpers.find((h) => h.kind === 'pastila');
    if (pas && (this.pastilaT -= dt) <= 0) {
      this.pastilaT = rand(14, 18);
      const s = guard.down ? near : guard;
      s.slowT = 3.5;
      this.castSay(L, 'pastila', LINES4.help.pastila);
      const n = cast(L).pastila; faceTo(n, s.pos.x, s.pos.z); n.anim.attack = { kind: 'syringe', p: 0 };
      this.later(0.4, () => { n.anim.attack = null; L.fx.emit(this.center(s), { count: 16, speed: [1, 3], life: [0.4, 0.8], size: [0.1, 0.2], colors: ['#ff3a7a', '#ffb0cc'], g: 4 }); });
    }
  }
  private laterQ: { t: number; f: () => void }[] = [];
  private later(t: number, f: () => void) { this.laterQ.push({ t, f }); }
  private castSay(L: Level3D, k: CastKind, s: string) { const n = cast(L)[k]; if (n.root.visible) { L.bark(n.root, s, 2.2, 1.95); n.talk = 0.6; } }

  // ───────── damage ─────────
  private atkKey(L: Level3D, atkId: number) {
    if (!L.nl || !L.attacker) return atkId;
    let h = 0;
    for (let i = 0; i < L.attacker.length; i++) h = (h * 31 + L.attacker.charCodeAt(i)) % 997;
    return (h + 1) * 1e6 + atkId;
  }
  private heroBy(L: Level3D, id: string | null | undefined): HeroLike { return (id && id !== net.myId && L.remote(id)) || L.player; }

  meleeHit(L: Level3D, c: THREE.Vector3, dir: THREE.Vector3, range: number, half: number, dmg: number, atkId: number, kind: string): boolean {
    if (!this.fighting || !L.authority) return false;
    const key = this.atkKey(L, atkId);
    const who = this.heroBy(L, L.attacker);
    let hit = false;
    for (const s of this.sis) {
      if (s.down || s.vanish > 0.5 || s.hitIds.has(key)) continue;
      const sc = this.center(s, v2);
      const dx = sc.x - c.x, dz = sc.z - c.z, d = Math.hypot(dx, dz);
      if (d > range + 0.75 || Math.abs(sc.y - c.y) > 2) continue;
      if (half < Math.PI && d > 0.5 && (dx * dir.x + dz * dir.z) / d < Math.cos(half) - 0.2) continue;
      s.hitIds.add(key);
      if (s.hitIds.size > 40) s.hitIds.delete(s.hitIds.values().next().value as number);
      hit = true;
      if (kind === 'chord') { s.stunT = 1.8; s.flash = 1; this.say(L, s, LINES4.backHit[1], 1.2); continue; }
      if (kind === 'syrup') s.slowT = 3;
      if (this.canHurt(s, who.pos)) this.wound(L, s, Math.max(1, Math.round(dmg)), sc);
      else this.blocked(L, s, sc);
    }
    return hit;
  }
  shotHit(L: Level3D, sh: Shot3): boolean {
    if (!this.fighting || !L.authority) return false;
    for (const s of this.sis) {
      if (s.down || s.vanish > 0.5) continue;
      const sc = this.center(s, v2);
      if (Math.hypot(sc.x - sh.pos.x, sc.z - sh.pos.z) > 0.7 + sh.r || Math.abs(sc.y - sh.pos.y) > 1.1) continue;
      const who = this.heroBy(L, sh.shooter);
      if (this.canHurt(s, who.pos)) this.wound(L, s, Math.max(1, sh.dmg), sh.pos.clone());
      else this.blocked(L, s, sh.pos.clone());
      return true;
    }
    return false;
  }
  faceTarget() { return this.center(this.sis[0]); }
  aimTargets() { return this.fighting ? this.sis.filter((s) => !s.down && s.vanish < 0.5).map((s) => this.center(s)) : []; }

  /** host: a hit the twin's gaze stopped */
  private blocked(L: Level3D, s: Sis, at: THREE.Vector3) {
    audio.sfx('clang', { pitch: 1.3 });
    L.fx.sparks(at, 10, [SISTER_COLOR[this.twin(s).kind], '#ffffff']);
    L.fx.text(at.clone().setY(at.y + 1.1), LINES4.twinsBlocked, SISTER_COLOR[this.twin(s).kind], 22);
    if (Math.random() < 0.5) this.say(L, this.twin(s), this.twin(s).kind === 'nochka' ? LINES4.nochka[0] : LINES4.tenka[0], 1.1);
    if (!L.nl && this.nokiCD <= 0 && this.helpers.some((h) => h.kind === 'noki')) { this.nokiCD = 7; this.castSay(L, 'noki', LINES4.help.noki); }
  }

  /**
   * The generic boss API the dev tools use (testkit's __chainTest, smoke scripts: boss.damage(L, n, at)): n to both
   * sisters at once — a paired wound, it stays. Real hits go through meleeHit / shotHit and THE RULE.
   */
  damage(L: Level3D, n: number, at: THREE.Vector3 = this.C) {
    if (!this.fighting || !L.authority) return;
    for (const s of this.sis) if (!s.down) this.wound(L, s, Math.max(1, n), at.clone());
  }

  private wound(L: Level3D, s: Sis, n: number, at: THREE.Vector3) {
    if (s.down) return;
    // (a wound counts only what she really lost)
    const real = Math.min(n, s.hp);
    s.hp -= real;
    s.flash = 1;
    audio.sfx('bossHit');
    L.fx.text(at.clone().setY(at.y + 1.3), String(n), '#ffe14a', 28);
    L.fx.sparks(at.clone(), 12);
    const t = this.twin(s);
    if (t.down) { s.fresh = 0; s.freshT = 0; }
    else {
      s.fresh += real; s.freshT = this.linkT;
      if (t.fresh > 0 && t.freshT > 0) this.lock(L);
    }
    if (s.act === 'idle' || s.act === 'walk' || s.act === 'mark') this.go(s, 'hurt', 0.35);
    if (Math.random() < 0.35) this.say(L, s, choose(LINES4.backHit as unknown as string[]), 1.3);
    this.checkDown(L);
  }
  /** both hurt in time: the wounds stay */
  private lock(L: Level3D) {
    const [a, b] = this.sis;
    a.fresh = b.fresh = 0; a.freshT = b.freshT = 0;
    L.hud.showBanner(LINES4.twinsBoth, '#ffd34a');
    audio.sfx('bigSlam', { volume: 0.5 }); audio.sfx('victory', { volume: 0.3, pitch: 1.5 });
    L.fx.ring(this.center(a), 2.2, '#ffd34a', 0.4, false); L.fx.ring(this.center(b), 2.2, '#ffd34a', 0.4, false);
    this.beam(L, a, b, '#ffd34a');
    for (const s of this.sis) if (!s.down && (s.act === 'idle' || s.act === 'walk' || s.act === 'mark')) this.go(s, 'hurt', 0.5);
    this.say(L, choose(this.sis), choose(LINES4.backHit as unknown as string[]), 1.4);
    this.checkDown(L);
  }
  /** her wound wasn't paired: the twin gives her strength back */
  private healBack(L: Level3D, s: Sis) {
    const t = this.twin(s);
    if (t.down || s.down) { s.fresh = 0; return; }
    s.hp = Math.min(s.maxHp, s.hp + s.fresh);
    s.fresh = 0;
    this.beam(L, t, s, SISTER_COLOR[t.kind]);
    audio.sfx('heal', { pitch: 0.7 });
    this.say(L, s, s.kind === 'nochka' ? LINES4.nochka[3] : LINES4.tenka[3], 1.4);
    this.hintOnce(L, 'heal', LINES4.twinsHeal);
  }
  private beam(L: Level3D, a: Sis, b: Sis, color: string) {
    const p = this.center(a), q = this.center(b);
    for (let k = 0; k <= 10; k++) L.fx.glow.emit(p.clone().lerp(q, k / 10), { count: 2, speed: [0.2, 0.8], life: [0.3, 0.6], size: [0.12, 0.22], colors: [color, '#ffffff'] });
  }
  private checkDown(L: Level3D) {
    for (const s of this.sis) {
      // the last blow always counts (a fresh wound at 0 doesn't heal back)
      if (s.down || s.hp > 0) continue;
      s.down = true; s.fresh = 0; s.freshT = 0; this.go(s, 'down', 99);
      s.gazeOn = 0;
      L.fx.stars(this.center(s), 30);
      audio.sfx('enemyDie');
      const t = this.twin(s);
      if (t.fresh > 0) { t.fresh = 0; t.freshT = 0; }
      if (!t.down) { this.mode = 'alone'; this.modeT = 0; this.say(L, t, t.kind === 'nochka' ? LINES4.nochka[2] : LINES4.tenka[2], 1.4); }
    }
    if (this.sis.every((s) => s.down)) this.die(L);
    else if (this.phase === 1 && this.sis[0].hp + this.sis[1].hp <= (this.sis[0].maxHp + this.sis[1].maxHp) * 0.5) {
      this.phase = 2; this.quarrelT = 0; this.quarrelI = 0;
      L.hud.showBanner('СЁСТРЫ ПОССОРИЛИСЬ!', '#ff6ad8');
    }
  }
  private die(L: Level3D) {
    if (this.mode === 'dead') return;
    this.mode = 'dead'; this.won = true;
    for (const s of this.sis) { s.gazeOn = 0; this.go(s, 'down', 99); }
    for (const k of this.spikes) k.cancel();
    for (const w of L.waves) L.scene.remove(w.obj);
    L.waves.length = 0;
    L.hitstop(0.3); L.whiteFlash = 0.6; L.tcam.shake(0.8);
    L.nl?.entEvent(this, 'dead', {});
    this.onDefeat?.();
  }
  /** dev / tests: knock both out */
  debugKill(L: Level3D) { if (!this.fighting) return; for (const s of this.sis) { s.hp = 0; s.fresh = 0; } this.checkDown(L); }

  // ───────── a sister's bark on every machine ─────────
  private say(L: Level3D, s: Sis, str: string, dur = 1.4) {
    s.talk = 0.6;
    ambient(L, () => L.bark(s.root, str, dur, 2.45));
    if (L.nl?.isHost) L.nl.entEvent(this, 'bark', { i: s.i, s: str, d: dur });
  }
  private hintOnce(L: Level3D, key: string, str: string) {
    if (this.hinted.has(key)) return;
    this.hinted.add(key);
    ambient(L, () => L.toast(str));
    if (L.nl?.isHost) L.nl.entEvent(this, 'toast', { s: str });
  }

  // ───────── every machine: what my hero touches ─────────
  private dashHitMine(L: Level3D) {
    const p = L.player;
    if (p.dead || p.downed || p.invuln > 0 || !p.control) return;
    for (const s of this.sis) {
      if (s.act !== 'dash' || s.down) continue;
      const d = Math.hypot(p.pos.x - s.pos.x, p.pos.z - s.pos.z);
      if (d > 1.15 || Math.abs(p.pos.y - s.pos.y) > 1.6) continue;
      const side = v2.set(p.pos.x - s.pos.x, 0, p.pos.z - s.pos.z).normalize();
      p.hurt(L, 1, this.center(s), new THREE.Vector3(side.x * 9, 7, side.z * 9), 0.35);
    }
  }

  // ───────── per-sister visuals ─────────
  private sync(s: Sis, dt: number) {
    const L = this.L;
    // later things (solo helpers' timing)
    if (s.i === 0 && this.laterQ.length) { for (const q of this.laterQ) q.t -= dt; const due = this.laterQ.filter((q) => q.t <= 0); this.laterQ = this.laterQ.filter((q) => q.t > 0); for (const q of due) q.f(); }
    const pr = clamp(s.actT / s.actMax, 0, 1);
    s.vanish = s.act === 'swapOut' ? pr : s.act === 'swapIn' ? 1 - pr : damp(s.vanish, 0, 12, dt);
    s.root.position.copy(s.pos);
    s.root.rotation.y = s.yaw;
    const sc = 1 - s.vanish * 0.95;
    s.root.scale.set(sc, 1 + s.vanish * 0.6, sc);
    s.root.visible = !s.hidden && s.vanish < 0.98;
    const a = s.anim;
    a.st = s.act === 'swapOut' || s.act === 'swapIn' ? 'swap' : s.act === 'idle' && L.dialog.active && s.talk > 0 ? 'talk' : s.act;
    a.p = pr;
    a.head = clamp(wrapA(s.gaze - s.yaw), -1.3, 1.3);
    a.flash = s.flash;
    a.talk = s.talk > 0 ? Math.abs(Math.sin(L.t * 16)) : 0;
    a.eyes = s.gazeOn;
    s.rig.update(dt, a);
    // the gaze cone on the ground (the arena floor) and the dash lane
    const showCone = this.fighting && s.gazeOn > 0.03 && !s.down && L.letterbox < 0.5;
    s.cone.visible = showCone;
    if (showCone) {
      s.cone.position.set(s.pos.x, this.C.y + 0.07, s.pos.z);
      s.cone.rotation.y = s.gaze - Math.PI / 2;
      s.coneM.opacity = 0.16 * s.gazeOn * (s.distractT > 0 ? 0.5 : 1) + (s.act === 'mark' ? 0.08 : 0);
    }
    const lane = (s.act === 'dashPrep' || s.act === 'dash') && this.fighting;
    s.lane.visible = lane;
    if (lane) {
      const dx = s.dashTo.x - s.dashFrom.x, dz = s.dashTo.z - s.dashFrom.z, len = Math.hypot(dx, dz);
      s.lane.position.set(s.dashFrom.x, this.C.y + 0.08, s.dashFrom.z);
      s.lane.rotation.y = Math.atan2(dx, dz);
      s.lane.scale.set(1, 1, Math.max(0.1, len));
      s.laneM.opacity = s.act === 'dash' ? 0.5 : 0.25 + 0.25 * Math.abs(Math.sin(L.t * 12));
    }
  }

  // ───────── HUD: two bars, «who watches you», over-head marks ─────────
  private drawHud(ctx: CanvasRenderingContext2D) {
    const L = this.L;
    if (this.hudK < 0.02) return;
    ctx.save();
    ctx.globalAlpha = this.hudK;
    const bw = 300, y = 66;
    this.sis.forEach((s, i) => {
      const x = i === 0 ? W / 2 - bw - 20 : W / 2 + 20;
      text(ctx, LINES4.bossName[s.kind], x + bw / 2, y - 8, { size: 20, color: SISTER_COLOR[s.kind], align: 'center', stroke: 5 });
      rrect(ctx, x, y, bw, 22, 10, 'rgba(30,10,30,0.75)', 3);
      const k = clamp(s.hp / s.maxHp, 0, 1), kf = clamp(s.fresh / s.maxHp, 0, 1);
      if (k > 0) rrect(ctx, x + 4, y + 4, (bw - 8) * k, 14, 7, s.kind === 'nochka' ? '#7a4cff' : '#ff6ad8', 0);
      if (kf > 0) {
        // the fresh wound: blinks, shrinks back as it heals unless the twin is hit too
        ctx.globalAlpha = this.hudK * (0.5 + 0.5 * Math.abs(Math.sin(L.t * 9)));
        rrect(ctx, x + 4 + (bw - 8) * k, y + 4, (bw - 8) * kf, 14, 7, '#ffffff', 0);
        ctx.globalAlpha = this.hudK;
        const tw = clamp(s.freshT / this.linkT, 0, 1);
        rrect(ctx, x + 4, y + 25, (bw - 8) * tw, 4, 2, '#ffd34a', 0);
      }
      if (s.down) text(ctx, '✖', x + bw / 2, y + 17, { size: 18, color: '#ffffff', align: 'center', stroke: 4 });
    });
    // who watches MY hero → which sister I can't hurt
    const p = L.player;
    if (!p.dead && this.fighting) {
      const w = this.sis.find((s) => this.inCone(s, p.pos));
      if (w) text(ctx, '👁 ' + LINES4.twinsWatched[w.kind], W / 2, y + 58, { size: 19, font: 'body', color: SISTER_COLOR[w.kind], align: 'center', stroke: 4 });
    }
    ctx.restore();
    // over each sister: a sword when MY hero can hurt her now, a shield in the twin's colour when not
    if (!this.fighting || L.letterbox > 0.3) return;
    const cam = L.tcam.cam;
    for (const s of this.sis) {
      if (s.down || s.vanish > 0.5) continue;
      const sp = toUI(v1.copy(s.pos).setY(s.pos.y + 2.75), cam);
      if (!sp.vis) continue;
      const ok = this.canHurt(s, p.pos);
      ctx.save();
      ctx.globalAlpha = this.hudK;
      if (ok) text(ctx, '⚔', sp.x, sp.y + Math.sin(L.t * 6) * 3, { size: 30, color: '#ffe14a', align: 'center', stroke: 5 });
      else text(ctx, '🛡', sp.x, sp.y, { size: 26, color: SISTER_COLOR[this.twin(s).kind], align: 'center', stroke: 5 });
      ctx.restore();
    }
  }

  // ───────────────────────── co-op ─────────────────────────
  /** [mode, phase, then per sister: x y z yaw gaze gazeOn hp maxHp fresh freshT act actP flags dashFrom(x z) dashTo(x z) tp] */
  netSnap(): number[] {
    const out: number[] = [MODES.indexOf(this.mode), this.phase];
    for (const s of this.sis) {
      out.push(s.pos.x, s.pos.y, s.pos.z, s.yaw, s.gaze, s.gazeOn, s.hp, s.maxHp, s.fresh, s.freshT, ACTS.indexOf(s.act), clamp(s.actT / s.actMax, 0, 1),
        (s.distractT > 0 ? 1 : 0) + (s.slowT > 0 ? 2 : 0) + (s.down ? 4 : 0) + (s.flash > 0.5 ? 8 : 0), s.dashFrom.x, s.dashFrom.z, s.dashTo.x, s.dashTo.z, s.tp);
    }
    return out;
  }
  netApply(a: number[], t?: number) {
    if (t === undefined) return;
    const per = 18;
    this.sis.forEach((s, i) => {
      const o = 2 + i * per;
      const rec = [a[0], a[1], ...a.slice(o, o + per)];
      (s.track ??= new NetTrack<number[]>(40, 6)).push(t, a[o], a[o + 1], a[o + 2], a[o + 3], rec, a[o + 17] ?? 0);
    });
  }
  private puppet(L: Level3D, dt: number) {
    const play = L.nl?.playT ?? -Infinity;
    for (const s of this.sis) {
      s.flash = Math.max(0, s.flash - dt * 5); s.talk = Math.max(0, s.talk - dt * 3);
      const tr = s.track;
      if (!tr || !tr.eval(play, dt, pose)) continue;
      s.pos.copy(pose.pos); s.yaw = pose.yaw;
      tr.passed(play, (r) => {
        const mode = MODES[r[0]] ?? 'watch';
        if (this.mode !== 'dead') this.mode = mode;
        this.phase = r[1];
        const act = ACTS[r[12]] ?? 'idle';
        if (act !== s.act) { s.act = act; s.actT = 0; }
        s.hp = r[8]; s.maxHp = r[9]; s.fresh = r[10]; s.freshT = r[11];
        const f = r[14];
        s.distractT = f & 1 ? 1 : 0; s.slowT = f & 2 ? 1 : 0; s.down = !!(f & 4); if (f & 8) s.flash = 1;
        s.dashFrom.set(r[15], s.pos.y, r[16]); s.dashTo.set(r[17], s.pos.y, r[18]);
      });
      s.gaze = s.gaze + wrapA(tr.lerp(6, true) - s.gaze);
      s.gazeOn = tr.lerp(7);
      // the host's progress through the action (cur → next of the same action), as actT / actMax = p
      const cur = tr.cur, nxt = tr.next;
      const p = cur ? (nxt && nxt[12] === cur[12] ? cur[13] + (nxt[13] - cur[13]) * tr.u : cur[13]) : 0;
      s.actMax = 1; s.actT = clamp(p, 0, 1);
    }
  }
  netEvent(L: Level3D, ev: string, data: unknown) {
    const d = (data ?? {}) as { p?: number[]; at?: number; i?: number; s?: string; d?: number };
    if (L.authority) return;
    if (ev === 'spike' && d.p && typeof d.at === 'number') this.spikes.push(new Spike(L, new THREE.Vector3(d.p[0], d.p[1], d.p[2]), d.at));
    else if (ev === 'bark' && typeof d.i === 'number' && d.s) { const s = this.sis[d.i]; if (s) { s.talk = 0.6; L.bark(s.root, d.s, d.d ?? 1.4, 2.45); } }
    else if (ev === 'toast' && d.s) L.toast(d.s);
    else if (ev === 'dead') { this.mode = 'dead'; this.won = true; for (const s of this.sis) { s.down = true; s.gazeOn = 0; s.act = 'down'; } for (const k of this.spikes) k.cancel(); }
  }

  /** the fight's defeat scene: hide the sisters (they became little bats) */
  vanishAll() { this.won = true; this.mode = 'dead'; for (const s of this.sis) { s.hidden = true; s.root.visible = false; s.cone.visible = false; s.lane.visible = false; } }
  /** solo helpers at the rim (the cast, minus the hero I play) */
  setHelpers(L: Level3D, spots: { kind: CastKind; at: THREE.Vector3 }[]) {
    this.helpers = spots;
    for (const h of spots) { const n = mark(L, h.kind, h.at.x, h.at.y, h.at.z, 0); faceTo(n, this.C.x, this.C.z); }
  }
  clearHelpers(L: Level3D) { hideCast(L); this.helpers = []; }
  sister(k: SisterKind) { return this.sis[k === 'nochka' ? 0 : 1]; }
  get won_() { return this.won; }
}

/** a shadow spike under a hero: a ring for ~0.95 s, then black thorns (victim-side, on the shared clock) */
class Spike {
  private ring = new GroundMark('#a050ff', true);
  private thorns = new THREE.Group();
  private done = false;
  private hit = false;
  constructor(private L: Level3D, readonly pos: THREE.Vector3, readonly at: number) {
    const m = basic('#2a1438');
    for (let i = 0; i < 7; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.4, 5), m);
      const a = (i / 7) * Math.PI * 2;
      c.position.set(i ? Math.cos(a) * 0.55 : 0, 0.7, i ? Math.sin(a) * 0.55 : 0);
      c.rotation.set(i ? Math.sin(a) * 0.3 : 0, 0, i ? -Math.cos(a) * 0.3 : 0);
      this.thorns.add(c);
    }
    this.thorns.position.copy(pos);
    this.thorns.visible = false;
    noOutline(this.thorns);
    L.scene.add(this.thorns);
  }
  cancel() { this.done = true; this.ring.dispose(); this.thorns.removeFromParent(); }
  /** true when finished */
  update(L: Level3D): boolean {
    if (this.done) return true;
    const t = clk(L) - this.at;
    if (t < 0) { const k = 1 + t / 0.95; this.ring.show(L, this.pos.x, this.pos.y + 0.3, this.pos.z, 1.35, 0.25 + 0.55 * clamp(k, 0, 1)); return false; }
    this.ring.hide();
    const up = clamp(t / 0.08, 0, 1) * clamp((0.55 - t) / 0.15, 0, 1);
    this.thorns.visible = up > 0.01;
    this.thorns.scale.set(1, Math.max(0.01, up), 1);
    if (!this.hit && t < 0.3) {
      this.hit = true;
      ambient(L, () => { audio.sfx('slam', { pitch: 1.3, volume: 0.5 }); L.fx.dust(this.pos.clone(), 8, '#6a4a8a'); });
      const p = L.player;
      if (!p.dead && Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < 1.25 && p.pos.y - this.pos.y < 1.2) p.hurt(L, 1, this.pos.clone().setY(this.pos.y - 1), new THREE.Vector3(0, 11, 0), 0.3);
    }
    if (t > 0.6) { this.cancel(); return true; }
    return false;
  }
}
