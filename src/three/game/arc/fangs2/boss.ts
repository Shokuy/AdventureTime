import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { choose, clamp, rand } from '../../../../engine/util';
import { save } from '../../../../engine/save';
import { net } from '../../../../net/session';
import { DEFAULT_LOOKS, type HeroKind, type HeroLook } from '../../../../net/profile';
import { toUI } from '../../../runtime';
import { rrect, text } from '../../../../art/draw';
import { basic, noOutline, canvasTex } from '../../../gfx';
import { damp } from '../../../models/kit';
import { createHeroModel } from '../../../models/heroes';
import type { HeroAnim, HeroRig, HeroAtk } from '../../../models/hero';
import type { Level3D, Boss3Like, HeroLike, Npc3 } from '../../level';
import type { Netted } from '../../netLevel';
import { NetTrack, type NetPose } from '../../netInterp';
import { Wave3, type Shot3 } from '../../objects';
import { coop } from '../../coop';
import { vamp, heroId, markCharacter, GroundMark, ambient, createStars, spinStars } from '../vampires';
import { createLady, createWolf, createToad, createCrow, type MorokRig, type MorokAnim } from './models';
import { MOROK, HELP, TOASTS } from './lines';

/**
 * Мадам Морок (docs/script-fangs.md §6.3–6.5) — a shape-shifter on the veranda of her stilt house.
 * The fight cycles through her forms; after each one she falls back into her own shape, dazed: the damage window.
 *   ВОЛК  — crouches on a red lane (telegraph), charges across the veranda (dodge sideways); 3–4 charges, then dazed.
 *   ЖАБА  — tongue: the throat puffs, a red line shows where it lashes (pulls you in); belly-flop: a red ring where she
 *           lands, then a shockwave to jump over (and nearby «солнышки» go out). 4–6 moves, then dazed.
 *   ВОРОНЫ — a flock circles the veranda; one crow at a time marks a hero (red ring) and dives; a crow that landed can
 *           be swatted. One crow wears a violet veil: that's her — swat it and she drops out of the flock, dazed.
 *   КОПИЯ — she becomes one of the heroes (co-op: a real player's hero with his name tag!) and mingles, striking from
 *           behind. Tell: no shadow. A hit on her, Ноки's chord, or light (Пастила's beacon, a «солнышко») unmasks her
 *           → dazed. Not found in time → she bursts off in crows and the window is lost.
 * Solo: the story four stand on the veranda; in the copy phase they walk in (she hides among them — and copies them),
 * Пастила puts down beacons («Маяк! В его свете тени чётче!»), Ноки strums when Пастила is the player.
 * HP grows with the party; telegraphs shorten as she weakens (phases at 66 % / 33 %).
 *
 * Co-op: the host runs her (Netted, fixed id); clients play her snapshots back (NetTrack at NetLevel.playT): form,
 * action and its clock, position, aim spots, the tongue; crows fly by formula from the played-back form clock, their
 * dives / deaths and the copied hero come as timed events. Hits on heroes are judged victim-side (each machine checks
 * its own hero against what it shows); hits on her are resolved by the host.
 */

export const ARENA = { cx: -8, cz: -161, hx: 11, hz: 8, y: 1.4 };
const NET_ID = 93100;
const FORMS = ['intro', 'lady', 'wolf', 'toad', 'crows', 'copy', 'dead'] as const;
type Form = (typeof FORMS)[number];
const ACTS = ['sit', 'idle', 'taunt', 'cast', 'dazed', 'aim', 'run', 'skid', 'puff', 'tongue', 'crouch', 'jump', 'flop', 'circle', 'mingle', 'stalk', 'strike', 'flee', 'fall'] as const;
type Act = (typeof ACTS)[number];
const CYCLE: Form[] = ['wolf', 'toad', 'crows', 'copy'];
const ATK_OF: Record<HeroKind, HeroAtk> = { tosha: 'sword', bublik: 'punch', noki: 'axe', pastila: 'flask' };

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const pose: NetPose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };

interface Crow { rig: MorokRig; i: number; veiled: boolean; alive: boolean; pos: THREE.Vector3; dive: Dive | null; anim: MorokAnim }
interface Dive { x: number; y: number; z: number; t0: number; hit: boolean; mark: GroundMark }
const D_TELE = 0.8, D_FLY = 0.42, D_LAND = 1.0, D_RISE = 0.6;

/** a red lane on the floor (wolf charge, tongue): a stretched arrow strip */
let laneTexC: THREE.Texture | null = null;
function laneTex() {
  if (laneTexC) return laneTexC;
  laneTexC = canvasTex(64, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.5)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let y = 0; y < h; y += 64) { g.beginPath(); g.moveTo(w * 0.2, y + 44); g.lineTo(w * 0.5, y + 14); g.lineTo(w * 0.8, y + 44); g.lineTo(w * 0.65, y + 44); g.lineTo(w * 0.5, y + 30); g.lineTo(w * 0.35, y + 44); g.fill(); }
  }, { wrap: true });
  return laneTexC;
}
class Lane {
  mesh: THREE.Mesh;
  private m: THREE.MeshBasicMaterial;
  constructor(L: Level3D, color: string) {
    const t = laneTex().clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    this.m = basic(color, { additive: true, transparent: true, opacity: 0.6, depthWrite: false, map: t });
    this.m.polygonOffset = true; this.m.polygonOffsetFactor = -4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.m);
    this.mesh.renderOrder = 3; this.mesh.visible = false;
    noOutline(this.mesh);
    L.scene.add(this.mesh);
  }
  show(ax: number, az: number, bx: number, bz: number, y: number, w: number, alpha: number, t: number) {
    const len = Math.hypot(bx - ax, bz - az);
    this.mesh.position.set((ax + bx) / 2, y + 0.06, (az + bz) / 2);
    this.mesh.rotation.y = Math.atan2(bx - ax, bz - az);
    this.mesh.scale.set(w, 1, Math.max(0.1, len));
    const map = this.m.map!;
    map.repeat.set(1, len / 2.5); map.offset.y = -t * 1.5;
    this.m.opacity = alpha;
    this.mesh.visible = alpha > 0.01;
  }
  hide() { this.mesh.visible = false; }
}

export class Morok3 implements Boss3Like, Netted {
  netId = 0;
  name = 'МАДАМ МОРОК';
  hp = 44; maxHp = 44;
  /** the anchor that moves with her (barks hang from it — the same object on every machine) */
  root = new THREE.Group();
  get netRoot() { return this.root; }
  netTimed = ['dive', 'crow', 'fake', 'unmask'];
  form: Form = 'intro';
  act: Act = 'sit';
  /** time in the form / in the action (s) */
  st = 0; at = 0; atMax = 1;
  seq = 0;
  pos = new THREE.Vector3(ARENA.cx, ARENA.y, ARENA.cz - 6);
  yaw = 0;
  /** aim: lane start (a) / end or spot (b) */
  a = new THREE.Vector3(); b = new THREE.Vector3();
  tongue = 0;
  talk = 0;
  onDefeat: (() => void) | null = null;
  /** after the defeat she is a mouse far away: nothing of her is drawn */
  gone = false;
  // rigs
  lady = createLady(); wolf = createWolf(); toad = createToad();
  crows: Crow[] = [];
  private ladyG = new THREE.Group(); private wolfG = new THREE.Group(); private toadG = new THREE.Group();
  private chair = new THREE.Group();
  private anim: MorokAnim = { st: 'sit', p: 0, flash: 0, talk: 0, speed: 0 };
  private stars = createStars();
  private lane: Lane; private tongueLane: Lane;
  private ring = new GroundMark('#ff3040', true);
  private flash = 0;
  // fight bookkeeping (host)
  private cycleI = 0;
  private moves = 0;
  private hitIds = new Set<string | number>();
  private hurtBarkT = 0;
  private winHint = false;
  private target: HeroLike | null = null;
  private diveT = 0;
  private lightT = 0;
  private swapT = 0;
  private struck = false;
  private copyStrikes = 0;
  // the fake hero
  fake: { rig: HeroRig; g: THREE.Group; kind: HeroKind; who: string; name: string; color: string; anim: HeroAnim; hopT: number } | null = null;
  private fakeGoal = new THREE.Vector3();
  // client puppet
  private track: NetTrack<number[]> | null = null;
  private got = false;
  private lastForm: Form = 'intro';
  private lastAct: Act = 'sit';
  private lastSeq = -1;
  private wasPuppet = false;
  // solo helpers
  private cast: Npc3[] = [];
  private castGoal = new Map<Npc3, THREE.Vector3>();
  private helpT = 0;
  private castHits = new Map<Npc3, number>();
  /** this machine's one-time tips for each form (a beat after it appears, so they don't pile up on the intro's) */
  private hintForm: Form = 'intro';
  private hintT = 0;

  constructor(readonly L: Level3D, chairAt: THREE.Vector3) {
    const S = L.scene;
    this.pos.copy(chairAt);
    for (const [g, r] of [[this.ladyG, this.lady], [this.wolfG, this.wolf], [this.toadG, this.toad]] as const) { g.add(r.root); S.add(g); markCharacter(r.root); }
    this.wolfG.visible = false; this.toadG.visible = false;
    S.add(this.root);
    this.stars.position.y = 1.5;
    this.ladyG.add(this.stars);
    this.lane = new Lane(L, '#ff3040');
    this.tongueLane = new Lane(L, '#ff5a8a');
    // the rocking chair
    const wood = basic('#3a2418');
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.8), wood); seat.position.y = 0.55; this.chair.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.1), wood); back.position.set(0, 1.1, -0.38); back.rotation.x = -0.15; this.chair.add(back);
    for (const s of [-1, 1]) { const rk = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.04, 6, 20, Math.PI * 0.6), wood); rk.rotation.set(0, Math.PI / 2, Math.PI * 1.2); rk.position.set(s * 0.4, 0.75, 0); this.chair.add(rk); }
    this.chair.position.copy(chairAt);
    S.add(this.chair);
    // HP: party + difficulty
    const base = coop.easy ? 34 : 44;
    this.hp = this.maxHp = Math.round(base * (L.nl ? coop.hpScale() : 1));
    if (L.nl) { let id = NET_ID; while (L.nl.get(id)) id++; L.nl.add(this, id); }
    this.place(0);
    L.overlayDraw.push((ctx) => this.drawFakeTag(ctx));
  }

  // ───────────────────────── public ─────────────────────────
  get phase() { const f = this.hp / this.maxHp; return f > 0.66 ? 1 : f > 0.33 ? 2 : 3; }
  private get spd() { return [1, 0.86, 0.74][this.phase - 1]; }
  private party() { return this.L.nl ? Math.max(1, this.L.heroes().length) : 1; }
  /** the fight starts (host / solo) */
  start() {
    if (!this.L.authority || this.form !== 'intro') return;
    this.cycleI = 0;
    this.setForm('lady'); this.go('taunt', 1.2);
  }
  get dead() { return this.form === 'dead'; }
  center(out = new THREE.Vector3()) {
    const y = this.form === 'toad' ? 1.6 : this.form === 'wolf' ? 1.1 : this.form === 'copy' && this.fake ? 0.6 : 1.0;
    return out.copy(this.pos).setY(this.pos.y + y);
  }
  faceTarget() { return this.center(); }
  aimTargets(): THREE.Vector3[] {
    if (this.form === 'intro' || this.form === 'dead' || this.form === 'copy') return [];
    if (this.form === 'crows') return this.crows.filter((c) => c.alive && c.dive && this.st - c.dive.t0 > D_TELE).map((c) => c.pos.clone());
    return [this.center()];
  }
  /** test tooling (chainTest): take damage regardless of the window */
  damage(L: Level3D, n: number, at: THREE.Vector3) { if (L.authority) this.hurt(L, n, at, null, true); }

  // ───────────────────────── host: state ─────────────────────────
  private go(act: Act, secs = 0) { this.act = act; this.at = secs; this.atMax = Math.max(0.001, secs); this.seq++; this.struck = false; }
  private setForm(f: Form) {
    const L = this.L;
    if (f === this.form) return;
    this.form = f; this.st = 0; this.moves = 0;
    if (f !== 'copy') this.dropFake();
    if (f === 'crows') this.spawnCrows();
    else if (this.crows.length) this.killCrows();
    if (f === 'wolf') this.bark(choose(MOROK.wolf));
    if (f === 'toad') this.bark(choose(MOROK.toad));
    if (f === 'crows') this.bark(choose(MOROK.crows));
  }
  private bark(s: string, dur = 1.8) {
    const h = this.form === 'toad' ? 2.8 : this.form === 'crows' ? 3.5 : this.form === 'wolf' ? 2.3 : 2.2;
    this.L.bark(this.root, s, dur, h);
    this.talk = 0.8;
  }
  /** a target hero (solo: me; co-op: someone alive, sticky a little) */
  private pick(): HeroLike {
    const L = this.L;
    const hs = L.alivePlayers();
    if (!hs.length) return L.player;
    if (this.target && hs.includes(this.target) && Math.random() < 0.4) return this.target;
    return (this.target = choose(hs));
  }
  private clampArena(p: THREE.Vector3, m = 0.8) {
    p.x = clamp(p.x, ARENA.cx - ARENA.hx + m, ARENA.cx + ARENA.hx - m);
    p.z = clamp(p.z, ARENA.cz - ARENA.hz + m, ARENA.cz + ARENA.hz - m);
    return p;
  }
  /** where a ray from p along (dx, dz) leaves the arena */
  private edge(px: number, pz: number, dx: number, dz: number, m = 1.2) {
    let t = 99;
    const x0 = ARENA.cx - ARENA.hx + m, x1 = ARENA.cx + ARENA.hx - m, z0 = ARENA.cz - ARENA.hz + m, z1 = ARENA.cz + ARENA.hz - m;
    if (dx > 1e-4) t = Math.min(t, (x1 - px) / dx); else if (dx < -1e-4) t = Math.min(t, (x0 - px) / dx);
    if (dz > 1e-4) t = Math.min(t, (z1 - pz) / dz); else if (dz < -1e-4) t = Math.min(t, (z0 - pz) / dz);
    return Math.max(0, t);
  }

  update(L: Level3D, dt: number) {
    if (L.nl && !L.authority) { this.puppet(L, dt); this.wasPuppet = true; this.visuals(L, dt); return; }
    if (this.wasPuppet) { this.wasPuppet = false; this.killCrows(); this.dropFake(); if (this.form !== 'intro' && this.form !== 'dead') { this.setFormRaw('lady'); this.go('taunt', 1); } }
    this.st += dt; this.at -= dt;
    this.hurtBarkT -= dt;
    if (this.form !== 'intro' && this.form !== 'dead' && !L.worldCut) this.think(L, dt);
    this.visuals(L, dt);
  }
  private setFormRaw(f: Form) { this.form = f; this.st = 0; }

  private think(L: Level3D, dt: number) {
    const sp = this.spd;
    switch (this.form) {
      case 'lady': {
        if (this.act === 'dazed') { if (this.at <= 0) this.go('taunt', 1.1); break; }
        if (this.act === 'taunt') {
          const t = this.pick();
          this.faceTo(t.pos.x, t.pos.z, dt, 4);
          if (this.at <= 0) { this.go('cast', 0.7); this.morphFx(); }
          break;
        }
        if (this.act === 'cast') { if (this.at <= 0) { const f = CYCLE[this.cycleI++ % CYCLE.length]; this.setForm(f); this.enter(L, f); } break; }
        this.go('taunt', 1.1);
        break;
      }
      case 'wolf': this.wolfAI(L, dt, sp); break;
      case 'toad': this.toadAI(L, dt, sp); break;
      case 'crows': this.crowAI(L, dt, sp); break;
      case 'copy': this.copyAI(L, dt, sp); break;
    }
  }

  private enter(L: Level3D, f: Form) {
    if (f === 'wolf') { this.go('aim', 0.95 * this.spd); this.aimWolf(); }
    else if (f === 'toad') { this.toadI = 1; this.go('puff', 0.85 * this.spd); this.aimTongue(); }
    else if (f === 'crows') { this.go('circle', 0); this.diveT = 1.2; }
    else if (f === 'copy') { this.go('mingle', 2.5); this.startCopy(L); }
  }

  /** dazed in her own shape: the damage window */
  private window(L: Level3D, secs = this.L.nl ? 4.6 : 5.2) {
    const keep = this.pos.clone();
    this.setForm('lady');
    this.pos.copy(keep).setY(ARENA.y);
    this.clampArena(this.pos, 1.2);
    this.go('dazed', secs);
    this.morphFx();
    audio.sfx('thud'); L.tcam.shake(0.3);
    L.fx.text(this.center().setY(this.pos.y + 2.6), 'Бейте!', '#ffe14a', 30);
    // a heart falls out of her veil now and then when somebody is nearly out of them
    if (L.alivePlayers().some((h) => h.hp <= 2) && Math.random() < 0.6) L.dropPickup('heart', this.center());
    if (!this.winHint) { this.winHint = true; L.toast(TOASTS.window); }
  }

  // ── wolf ──
  private aimWolf() {
    const t = this.pick();
    let dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    // aim a bit past the hero, to the far edge
    const e = this.edge(this.pos.x, this.pos.z, dx, dz);
    this.a.set(this.pos.x, ARENA.y, this.pos.z);
    this.b.set(this.pos.x + dx * e, ARENA.y, this.pos.z + dz * e);
    this.yaw = Math.atan2(dx, dz);
  }
  private wolfAI(L: Level3D, dt: number, sp: number) {
    const n = (this.phase === 1 ? 3 : 4) + (this.party() > 2 ? 1 : 0);
    if (this.act === 'aim') {
      // keep turning toward the target during the first half of the wind-up
      if (this.at > this.atMax * 0.45 && this.target) {
        const t = this.target;
        let dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const e = this.edge(this.pos.x, this.pos.z, dx, dz);
        this.b.set(this.pos.x + dx * e, ARENA.y, this.pos.z + dz * e); this.yaw = Math.atan2(dx, dz);
      }
      if (this.at <= 0) { this.go('run', 3); audio.sfx('roar', { pitch: 1.5, volume: 0.6 }); if (Math.random() < 0.4) this.bark(choose(MOROK.wolf), 1.2); }
      return;
    }
    if (this.act === 'run') {
      const dx = this.b.x - this.pos.x, dz = this.b.z - this.pos.z, d = Math.hypot(dx, dz);
      const step = 19 * dt;
      if (d <= step || this.at <= 0) {
        this.pos.set(this.b.x, ARENA.y, this.b.z);
        this.moves++;
        L.tcam.shake(0.25); audio.sfx('thud', { pitch: 0.8 });
        L.fx.dust(this.pos.clone(), 14, '#8a7a6a');
        if (this.moves >= n) { this.go('skid', 0.6); return; }
        this.go('skid', 0.45);
      } else this.pos.x += (dx / d) * step, this.pos.z += (dz / d) * step;
      return;
    }
    if (this.act === 'skid') {
      if (this.at > 0) return;
      if (this.moves >= n) { this.window(L); return; }
      this.go('aim', 0.95 * sp); this.aimWolf();
    }
  }

  // ── toad ──
  private aimTongue() {
    const t = this.pick();
    let dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    this.yaw = Math.atan2(dx, dz);
    this.a.set(this.pos.x + dx * 1.6, ARENA.y, this.pos.z + dz * 1.6);
    this.b.set(this.pos.x + dx * 12, ARENA.y, this.pos.z + dz * 12);
  }
  private toadAI(L: Level3D, dt: number, sp: number) {
    const plan = this.phase === 1 ? ['tongue', 'flop', 'tongue', 'flop'] : this.phase === 2 ? ['tongue', 'flop', 'flop', 'tongue', 'flop'] : ['flop', 'tongue', 'flop', 'flop', 'tongue', 'flop'];
    switch (this.act) {
      case 'puff':
        if (this.at > this.atMax * 0.5 && this.target) { const t = this.target; let dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; this.yaw = Math.atan2(dx, dz); this.a.set(this.pos.x + dx * 1.6, ARENA.y, this.pos.z + dz * 1.6); this.b.set(this.pos.x + dx * 12, ARENA.y, this.pos.z + dz * 12); }
        if (this.at <= 0) { this.go('tongue', 0.62); audio.sfx('whoosh', { pitch: 0.6 }); }
        return;
      case 'tongue': {
        const k = 1 - this.at / this.atMax;
        this.tongue = k < 0.3 ? (k / 0.3) * 11 : k < 0.5 ? 11 : Math.max(0, 11 * (1 - (k - 0.5) / 0.5));
        if (this.at <= 0) { this.tongue = 0; this.next(L, plan, sp); }
        return;
      }
      case 'crouch':
        if (this.at <= 0) { this.go('jump', 1.0); audio.sfx('jump', { pitch: 0.4 }); }
        return;
      case 'jump': {
        const k = 1 - this.at / this.atMax;
        this.pos.lerpVectors(this.a, this.b, k);
        this.pos.y = ARENA.y + Math.sin(k * Math.PI) * 6;
        if (this.at <= 0) {
          this.pos.copy(this.b);
          this.go('flop', 0.7);
          audio.sfx('bigSlam'); L.tcam.shake(0.6);
          L.fx.dust(this.pos.clone(), 26, '#7a8a6a');
          L.fx.ring(this.pos.clone().setY(ARENA.y + 0.1), 3, '#c8e0b0', 0.4);
          L.addWave(new Wave3(new THREE.Vector3(this.pos.x, ARENA.y, this.pos.z), 8.5, 14, 2.6));
          vamp(L).snuffAround(this.pos, 6.5);
          this.moves++;
        }
        return;
      }
      case 'flop':
        if (this.at <= 0) this.next(L, plan, sp);
        return;
    }
    void dt;
  }
  private next(L: Level3D, plan: string[], sp: number) {
    const i = this.toadI++;
    if (i >= plan.length) { this.toadI = 0; this.window(L); return; }
    if (plan[i] === 'tongue') { this.go('puff', 0.85 * sp); this.aimTongue(); }
    else {
      const t = this.pick();
      this.a.copy(this.pos).setY(ARENA.y);
      this.b.set(t.pos.x + t.vel.x * 0.3, ARENA.y, t.pos.z + t.vel.z * 0.3);
      this.clampArena(this.b, 2);
      this.yaw = Math.atan2(this.b.x - this.pos.x, this.b.z - this.pos.z);
      this.go('crouch', 0.5 * sp);
      if (Math.random() < 0.3) this.bark(choose(MOROK.toad), 1.3);
    }
  }
  private toadI = 0;

  // ── crows ──
  private spawnCrows(count?: number) {
    const n = count ?? Math.min(20, 12 + 2 * (this.party() - 1));
    this.killCrows();
    for (let i = 0; i < n; i++) {
      const rig = createCrow(i === 0);
      rig.root.scale.setScalar(i === 0 ? 2.1 : 1.7);
      markCharacter(rig.root);
      this.L.scene.add(rig.root);
      const c: Crow = { rig, i, veiled: i === 0, alive: true, pos: this.pos.clone().setY(this.pos.y + 1), dive: null, anim: { st: 'fly', p: 0, flash: 0, talk: 0, speed: 0 } };
      this.crows.push(c);
    }
    ambient(this.L, () => { this.L.fx.emit(this.center(), { count: 40, speed: [2, 6], life: [0.5, 1.2], size: [0.15, 0.3], colors: ['#1a1420', '#3a2a48', '#6a2a8a'], drag: 2, g: -1 }); audio.sfx('batFlap', { pitch: 0.7 }); });
  }
  private killCrows() {
    for (const c of this.crows) { c.rig.root.removeFromParent(); c.dive?.mark.dispose(); }
    this.crows = [];
  }
  /** a crow's spot on its circle at form time t */
  private orbit(c: Crow, t: number, out: THREE.Vector3) {
    const n = Math.max(1, this.crows.length);
    const dir = c.i % 2 ? 1 : -1;
    const a = (c.i / n) * Math.PI * 2 + t * (0.55 + (c.i % 3) * 0.08) * dir;
    const r = 5.5 + (c.i % 3) * 1.6;
    const grow = Math.min(1, t / 1.2);
    return out.set(ARENA.cx + Math.cos(a) * r * grow, ARENA.y + 3.6 + (c.i % 4) * 0.55 + Math.sin(t * 2 + c.i) * 0.3, ARENA.cz + Math.sin(a) * r * 0.75 * grow);
  }
  /** a crow's spot now (its dive overrides the circle) */
  private crowPos(c: Crow, t: number, out: THREE.Vector3) {
    const d = c.dive;
    if (!d) return this.orbit(c, t, out);
    const u = t - d.t0;
    if (u < D_TELE) return this.orbit(c, t, out);
    if (u < D_TELE + D_FLY) { this.orbit(c, d.t0 + D_TELE, v3); const k = (u - D_TELE) / D_FLY; return out.copy(v3).lerp(v2.set(d.x, d.y + 0.3, d.z), k * k); }
    if (u < D_TELE + D_FLY + D_LAND) return out.set(d.x, d.y + 0.3, d.z);
    const k = Math.min(1, (u - D_TELE - D_FLY - D_LAND) / D_RISE);
    this.orbit(c, t, v3);
    return out.set(d.x, d.y + 0.3, d.z).lerp(v3, k);
  }
  private crowAI(L: Level3D, dt: number, sp: number) {
    this.pos.set(ARENA.cx, ARENA.y, ARENA.cz);
    // dives
    this.diveT -= dt;
    const busy = this.crows.filter((c) => c.alive && c.dive).length;
    const maxBusy = Math.min(4, 1 + Math.floor(this.party() / 2) + (this.phase - 1));
    if (this.diveT <= 0 && busy < maxBusy) {
      this.diveT = (1.15 * sp) / (1 + 0.15 * (this.party() - 1));
      const free = this.crows.filter((c) => c.alive && !c.dive);
      if (free.length) {
        this.moves++;
        const me = free.find((c) => c.veiled);
        const c = me && this.moves % 3 === 0 ? me : choose(free.filter((x) => !x.veiled).length ? free.filter((x) => !x.veiled) : free);
        const t = this.pick();
        const x = clamp(t.pos.x + t.vel.x * 0.35, ARENA.cx - ARENA.hx + 0.5, ARENA.cx + ARENA.hx - 0.5), z = clamp(t.pos.z + t.vel.z * 0.35, ARENA.cz - ARENA.hz + 0.5, ARENA.cz + ARENA.hz - 0.5);
        this.startDive(c, x, ARENA.y, z, this.st);
        L.nl?.entEvent(this, 'dive', { i: c.i, x, y: ARENA.y, z, t: this.st });
      }
    }
    for (const c of this.crows) if (c.dive && this.st - c.dive.t0 > D_TELE + D_FLY + D_LAND + D_RISE) { c.dive.mark.dispose(); c.dive = null; }
    const alive = this.crows.filter((c) => c.alive && !c.veiled).length, total = this.crows.length - 1;
    if (this.st > 26 || (total > 0 && alive <= Math.floor(total * 0.3))) { this.window(L); }
  }
  private startDive(c: Crow, x: number, y: number, z: number, t0: number) {
    c.dive?.mark.dispose();
    c.dive = { x, y, z, t0, hit: false, mark: new GroundMark(c.veiled ? '#c060ff' : '#ff3040', true) };
    ambient(this.L, () => audio.sfx('batScreech', { pitch: 0.6, volume: 0.3 }));
  }
  private crowDie(c: Crow, by: string | null) {
    if (!c.alive) return;
    c.alive = false;
    const L = this.L;
    ambient(L, () => {
      L.fx.emit(c.pos.clone(), { count: 16, speed: [1, 4], life: [0.4, 0.9], size: [0.12, 0.24], colors: ['#16121c', '#3a2a48'], g: 2, drag: 2 });
      audio.sfx('hit', { pitch: 1.5 });
    });
    c.rig.root.visible = false;
    c.dive?.mark.dispose(); c.dive = null;
    if (L.authority) {
      L.nl?.entEvent(this, 'crow', { i: c.i });
      if (c.veiled) {
        this.pos.copy(c.pos).setY(ARENA.y); this.clampArena(this.pos, 1.2);
        this.bark(choose(MOROK.caught));
        this.hurt(L, 3, c.pos.clone(), by, true);
        if (this.form !== 'dead') this.window(L, this.L.nl ? 5.4 : 6);
      }
    }
  }

  // ── copy ──
  private startCopy(L: Level3D) {
    this.copyStrikes = 0;
    // (solo: the four give the player a few seconds to find her first)
    this.helpT = 4.5;
    this.swapT = L.nl ? 9 : 7;
    this.lightT = 0;
    this.pos.copy(this.mingleSpot(v1));
    this.chooseFake(L, true);
    if (!L.nl) this.castJoin();
  }
  /** host: who she copies now (solo: me first, later one of the four on the veranda; co-op: a real player) */
  private chooseFake(L: Level3D, first: boolean) {
    let who = '', kind: HeroKind = L.player.kind;
    if (L.nl) {
      const ids = L.alivePlayers().map((h) => heroId(h));
      const cur = this.fake?.who;
      const pool = ids.filter((i) => i !== cur);
      who = choose(pool.length ? pool : ids.length ? ids : [net.myId]);
      kind = who === net.myId ? L.player.kind : (L.remote(who)?.kind ?? 'tosha');
    } else if (first || !this.cast.length) { who = 'me'; kind = L.player.kind; }
    else {
      // (never Ноки: she has no shadow of her own — she stays by the rail and strums instead)
      const kinds = this.cast.map((n) => n.kind as HeroKind).filter((k) => k !== this.fake?.kind && k !== 'noki');
      kind = choose(kinds.length ? kinds : [L.player.kind]);
      who = '';
    }
    this.makeFake(L, who, kind);
    L.nl?.entEvent(this, 'fake', { w: who, k: kind });
    const line = Math.random() < 0.6 ? MOROK.copy[kind] : choose(MOROK.copyAny);
    // the copy talks with the copied hero's voice… and no shadow
    this.L.bark(this.root, line, 2, 1.6);
  }
  private mingleSpot(out: THREE.Vector3) {
    const L = this.L;
    const hs = L.alivePlayers();
    const c = v2.set(0, 0, 0);
    let n = 0;
    for (const h of hs) { c.add(h.pos); n++; }
    for (const npc of this.cast) { c.add(npc.root.position); n++; }
    if (n) c.divideScalar(n); else c.set(ARENA.cx, ARENA.y, ARENA.cz);
    const a = rand(0, Math.PI * 2), r = rand(1.8, 3.6);
    return this.clampArena(out.set(c.x + Math.cos(a) * r, ARENA.y, c.z + Math.sin(a) * r), 1.2);
  }
  private copyAI(L: Level3D, dt: number, sp: number) {
    const f = this.fake;
    if (!f) { this.window(L); return; }
    // unmasked by light (a beacon, a «солнышко»)
    if (vamp(L).sunAt(v1.copy(this.pos).setY(this.pos.y + 0.5)) > 0.3) { this.lightT += dt; if (this.lightT > 0.35) { this.unmask(L, null, 'light'); return; } }
    else this.lightT = Math.max(0, this.lightT - dt);
    // swap to someone else now and then
    this.swapT -= dt;
    if (this.swapT <= 0 && this.act !== 'strike') {
      this.swapT = (L.nl ? 8.5 : 6.5) * sp;
      this.morphFx();
      this.pos.copy(this.mingleSpot(v1));
      this.chooseFake(L, false);
      this.go('mingle', rand(1.5, 2.5));
    }
    // she gets bored: off in a burst of crows, no window
    if (this.st > 28) {
      this.bark(choose(MOROK.copyAny));
      this.burstAway(L);
      return;
    }
    const speed = 6.6;
    switch (this.act) {
      case 'mingle': {
        if (this.at <= 0 || this.pos.distanceTo(this.fakeGoal) < 0.3) {
          if (this.at <= 0) {
            if (Math.random() < 0.55 && this.st > 2) { this.target = this.pick(); this.go('stalk', 4); }
            else { this.mingleSpot(this.fakeGoal); this.go('mingle', rand(1.6, 3)); }
          }
        }
        if (this.pos.distanceTo(this.fakeGoal) > 0.3) this.moveTo(this.fakeGoal.x, this.fakeGoal.z, speed * 0.75, dt);
        break;
      }
      case 'stalk': {
        const t = this.target;
        if (!t || t.dead || t.downed || this.at <= 0) { this.mingleSpot(this.fakeGoal); this.go('mingle', 2); break; }
        // come at him from behind
        const bx = t.pos.x - Math.sin(t.yaw) * 1.2, bz = t.pos.z - Math.cos(t.yaw) * 1.2;
        this.moveTo(bx, bz, speed, dt);
        if (Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) < 1.6) { this.faceTo(t.pos.x, t.pos.z, dt, 30); this.go('strike', 0.55); }
        break;
      }
      case 'strike': {
        const t = this.target;
        if (t) this.faceTo(t.pos.x, t.pos.z, dt, 6);
        if (this.at <= 0) { this.copyStrikes++; this.mingleSpot(this.fakeGoal); this.go('flee', 1.4); }
        break;
      }
      case 'flee':
        this.moveTo(this.fakeGoal.x, this.fakeGoal.z, speed, dt);
        if (this.at <= 0) this.go('mingle', rand(1.2, 2.4));
        break;
      default: this.go('mingle', 1);
    }
  }
  private moveTo(x: number, z: number, speed: number, dt: number) {
    const dx = x - this.pos.x, dz = z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const s = Math.min(d, speed * dt);
    this.pos.x += (dx / d) * s; this.pos.z += (dz / d) * s;
    this.clampArena(this.pos, 0.8);
    this.faceTo(x, z, dt, 10);
  }
  private faceTo(x: number, z: number, dt: number, rate: number) {
    const want = Math.atan2(x - this.pos.x, z - this.pos.z);
    let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * rate);
  }
  /** host: she is found out */
  unmask(L: Level3D, by: string | null, how: 'hit' | 'chord' | 'light') {
    if (!L.authority || this.form !== 'copy') return;
    this.bark(choose(MOROK.caught));
    L.nl?.entEvent(this, 'unmask', { h: how });
    this.unmaskFx(L, how);
    if (how === 'hit') this.hurt(L, 2, this.center(), by, true);
    if ((this.form as Form) !== 'dead') this.window(L);
  }
  private unmaskFx(L: Level3D, how: string) {
    const c = this.center();
    ambient(L, () => {
      L.fx.stars(c.clone().setY(c.y + 0.8), 24, ['#c060ff', '#ffffff', '#ffe14a']);
      L.fx.ring(this.pos.clone().setY(ARENA.y + 0.1), 2.2, '#c060ff', 0.45);
      audio.sfx('reflect', { pitch: 0.8 });
    });
    if (!L.nl || L.authority) this.helper(how === 'light' ? 'tosha' : 'tosha', HELP.tosha);
  }
  private burstAway(L: Level3D) {
    L.toast(TOASTS.missed);
    const c = this.center();
    L.fx.emit(c, { count: 40, speed: [2, 6], life: [0.5, 1.1], size: [0.15, 0.3], colors: ['#1a1420', '#3a2a48'], drag: 2, g: -1 });
    audio.sfx('batScreech', { pitch: 0.7 });
    // whoever stands close gets clawed (victim-side: here only my hero; clients check on 'unmask' how 'burst')
    L.nl?.entEvent(this, 'unmask', { h: 'burst' });
    ambient(L, () => this.burstHit(L));
    this.dropFake();
    this.setForm('lady');
    this.go('taunt', 1.2);
  }
  private burstHit(L: Level3D) {
    const p = L.player;
    if (p.pos.distanceTo(this.pos) < 2.6) p.hurt(L, 1, this.pos.clone());
  }

  // ───────────────────────── the fake hero (every machine) ─────────────────────────
  private makeFake(L: Level3D, who: string, kind: HeroKind) {
    this.dropFake();
    let look: HeroLook | undefined, name = '', color = '#ffd34a';
    if (who === 'me' || who === net.myId) { look = L.player.rig.look; name = net.members.get(net.myId)?.name ?? ''; }
    else if (who) { const r = L.remote(who); if (r) { look = r.rig.look; name = r.name; kind = r.kind; } }
    if (!look) look = DEFAULT_LOOKS[kind];
    color = look.tagColor || color;
    const rig = createHeroModel(kind, look);
    const g = new THREE.Group();
    g.add(rig.root);
    // the tell: no shadow at all
    rig.root.traverse((o) => { o.castShadow = false; });
    markCharacter(rig.root);
    L.scene.add(g);
    this.fake = { rig, g, kind, who, name, color, anim: { state: 'idle', speed: 0, attack: null, weapon: kind === 'tosha' ? 'sword' : 'none', flash: 0, talk: 0, expr: 'normal', squash: 1 }, hopT: rand(1, 3) };
    g.position.copy(this.pos); g.rotation.y = this.yaw;
    ambient(L, () => L.fx.emit(this.pos.clone().setY(this.pos.y + 0.8), { count: 26, speed: [1.5, 4.5], life: [0.4, 0.9], size: [0.12, 0.26], colors: ['#16121c', '#3a2a48', '#6a2a8a'], drag: 2.5, g: -1 }));
  }
  private dropFake() {
    if (!this.fake) return;
    this.fake.g.removeFromParent();
    this.fake.rig.dispose();
    this.fake = null;
  }

  // ───────────────────────── solo: the story four help ─────────────────────────
  /** solo: the cast figures on the veranda (built by the level, hidden in co-op) */
  setCast(list: Npc3[]) { this.cast = list; this.castHome.clear(); this.castGoal.clear(); }
  private castJoin() { for (const n of this.cast) if (n.kind !== 'noki') this.castGoal.set(n, this.mingleSpot(new THREE.Vector3())); }
  private helper(kind: string, line: string) {
    const n = this.cast.find((c) => c.kind === kind) ?? (kind === 'tosha' ? this.cast.find((c) => c.kind === 'noki') : null);
    if (n && !this.L.nl) this.L.bark(n.root, line, 1.8, 2.0);
  }
  private castHome = new Map<Npc3, THREE.Vector3>();
  private updateCast(L: Level3D, dt: number) {
    if (L.nl || !this.cast.length) return;
    const fight = this.form !== 'intro' && this.form !== 'dead' && !L.worldCut;
    for (const n of this.cast) {
      if (!this.castHome.has(n)) this.castHome.set(n, n.root.position.clone());
      const home = this.castHome.get(n)!;
      const goal = this.form === 'copy' && fight ? (this.castGoal.get(n) ?? home) : home;
      const dx = goal.x - n.root.position.x, dz = goal.z - n.root.position.z, d = Math.hypot(dx, dz);
      const an = n.anim as HeroAnim;
      if (d > 0.25 && fight) {
        const s = Math.min(d, (this.form === 'copy' ? 4.2 : 5.5) * dt);
        n.root.position.x += (dx / d) * s; n.root.position.z += (dz / d) * s;
        n.root.rotation.y = Math.atan2(dx, dz);
        an.state = 'run'; an.speed = 0.6;
      } else {
        an.state = this.form === 'lady' && this.act === 'dazed' ? 'cheer' : 'idle'; an.speed = 0;
        if (this.form === 'copy' && fight && n.kind !== 'noki' && Math.random() < dt * 0.4) this.castGoal.set(n, this.mingleSpot(new THREE.Vector3()));
        const p = this.form === 'copy' ? L.player.pos : this.pos;
        n.root.rotation.y = damp(n.root.rotation.y, Math.atan2(p.x - n.root.position.x, p.z - n.root.position.z), 4, dt);
      }
      const hit = this.castHits.get(n) ?? 0;
      if (hit > 0) { this.castHits.set(n, hit - dt); an.flash = Math.max(0, hit - 0.2); }
    }
    // Пастила's beacon / Ноки's chord in the copy phase
    if (this.form === 'copy' && fight && this.fake) {
      this.helpT -= dt;
      if (this.helpT <= 0) {
        this.helpT = 5.5;
        const pas = this.cast.find((c) => c.kind === 'pastila');
        const nok = this.cast.find((c) => c.kind === 'noki');
        if (pas) {
          this.L.bark(pas.root, HELP.pastila, 1.8, 2.0);
          const near = Math.random() < 0.6;
          const at = near ? v1.copy(this.pos).add(v2.set(rand(-2.2, 2.2), 0, rand(-2.2, 2.2))) : v1.copy(L.player.pos);
          this.clampArena(at, 1);
          vamp(L).light(at.clone().setY(ARENA.y), { r: 4.2, secs: 4.5 });
        } else if (nok) {
          const d = nok.root.position.distanceTo(this.pos);
          (nok.anim as HeroAnim).attack = { kind: 'chord', p: 0 };
          ambient(L, () => { L.fx.ring(nok.root.position.clone().setY(ARENA.y + 0.1), 4.2, '#c070ff', 0.5); audio.sfx('clang', { pitch: 1.6, volume: 0.5 }); });
          if (d < 4.5) this.unmask(L, null, 'chord');
          else { this.castGoal.set(nok, this.pos.clone()); this.helpT = 2.5; }
        }
      }
    }
    for (const n of this.cast) { const an = n.anim as HeroAnim; if (an.attack) { an.attack.p += dt * 1.4; if (an.attack.p >= 1) an.attack = null; } }
  }
  /** solo: the player hit one of the four by mistake */
  private castHitTest(L: Level3D, c: THREE.Vector3, range: number) {
    if (L.nl || this.form !== 'copy') return false;
    for (const n of this.cast) {
      if (Math.hypot(n.root.position.x - c.x, n.root.position.z - c.z) > range + 0.5 || (this.castHits.get(n) ?? 0) > 0) continue;
      this.castHits.set(n, 0.8);
      L.fx.text(n.root.position.clone().setY(n.root.position.y + 2.2), 'Ой!', '#ffffff', 22);
      if (n.kind === 'bublik') L.bark(n.root, HELP.bublik, 1.6, 1.6);
      else this.helper('noki', HELP.noki);
      return true;
    }
    return false;
  }

  // ───────────────────────── hits on her (host) ─────────────────────────
  meleeHit(L: Level3D, c: THREE.Vector3, dir: THREE.Vector3, range: number, _half: number, dmg: number, atkId: number, kind: string): boolean {
    if (!L.authority || this.form === 'intro' || this.form === 'dead') return false;
    const by = L.attacker;
    const key = by ? `${by}:${atkId}` : atkId;
    if (this.hitIds.has(key)) return false;
    const hitAt = v1.copy(c).addScaledVector(dir, range * 0.6);
    if (this.form === 'crows') {
      let hit = false;
      for (const cr of this.crows) if (cr.alive && (cr.pos.distanceTo(c) < range + 0.55 || cr.pos.distanceTo(hitAt) < range * 0.5 + 0.5)) { this.crowDie(cr, by); hit = true; }
      if (hit) { this.hitIds.add(key); this.trimIds(); }
      return hit;
    }
    if (this.form === 'copy') {
      const fc = this.center(v2);
      const reach = kind === 'chord' ? range + 1.0 : range + 0.7;
      if (Math.hypot(fc.x - c.x, fc.z - c.z) < reach && Math.abs(fc.y - c.y) < 1.8) { this.hitIds.add(key); this.trimIds(); this.unmask(L, by, kind === 'chord' ? 'chord' : 'hit'); return true; }
      if (kind !== 'chord' && this.castHitTest(L, c, range)) { this.hitIds.add(key); return true; }
      return false;
    }
    const r = this.form === 'toad' ? 1.9 : this.form === 'wolf' ? 1.2 : 0.7;
    const bc = this.center(v2);
    const near = Math.hypot(bc.x - c.x, bc.z - c.z) < range + r && Math.abs(bc.y - c.y) < 2.4;
    // the wolf is long: its head counts too
    const head = this.form === 'wolf' && Math.hypot(this.pos.x + Math.sin(this.yaw) * 1.3 - c.x, this.pos.z + Math.cos(this.yaw) * 1.3 - c.z) < range + 0.8;
    if (!near && !head) return false;
    this.hitIds.add(key); this.trimIds();
    if (kind === 'chord' && dmg <= 0) return true;
    this.hurt(L, dmg, hitAt.clone(), by);
    return true;
  }
  private trimIds() { if (this.hitIds.size > 200) this.hitIds.clear(); }
  shotHit(L: Level3D, s: Shot3): boolean {
    if (!L.authority || this.form === 'intro' || this.form === 'dead') return false;
    const by = s.shooter ?? null;
    if (this.form === 'crows') {
      for (const cr of this.crows) if (cr.alive && cr.pos.distanceTo(s.pos) < 0.6 + s.r) { this.crowDie(cr, by); return true; }
      return false;
    }
    if (this.form === 'copy') {
      if (s.pos.distanceTo(this.center(v2)) < 0.7 + s.r) { this.unmask(L, by, 'hit'); return true; }
      return false;
    }
    const r = this.form === 'toad' ? 1.8 : this.form === 'wolf' ? 1.0 : 0.7;
    if (s.pos.distanceTo(this.center(v2)) > r + s.r) return false;
    this.hurt(L, s.dmg, s.pos.clone(), by);
    return true;
  }
  /** chord from the vampire kit (Ноки's «Аккорд» as vamp(L).chord): unmasks the copy */
  chordAt(L: Level3D, at: THREE.Vector3, r: number) {
    if (!L.authority || this.form !== 'copy') return;
    if (at.distanceTo(this.pos) < r + 0.8) this.unmask(L, null, 'chord');
  }

  private hurt(L: Level3D, dmg: number, at: THREE.Vector3, by: string | null, force = false) {
    if (this.form === 'dead') return;
    const open = force || (this.form === 'lady' && this.act === 'dazed');
    const prev = L.attacker;
    if (by && by !== net.myId) L.attacker = by;
    try {
      if (!open) {
        if (this.form === 'lady') { L.fx.text(at.clone().setY(at.y + 1), 'мимо!', '#c8d0ff', 20); L.fx.emit(at.clone(), { count: 8, speed: [0.5, 1.5], life: [0.4, 0.8], size: [0.2, 0.4], colors: ['#4a3a5a', '#8a7a9a'], drag: 2, g: -1 }); return; }
        // the beast forms shrug off most of it
        dmg = 1;
      }
      dmg = Math.max(1, Math.round(dmg));
      this.hp = Math.max(0, this.hp - dmg);
      this.flash = 1;
      audio.sfx(open ? 'bossHit' : 'hit', { pitch: open ? 1.2 : 1.4 });
      L.fx.sparks(at.clone(), open ? 14 : 6, ['#ffffff', '#c060ff', '#ffe14a']);
      L.fx.text(at.clone().setY(at.y + 1.1), String(dmg), open ? '#ffe14a' : '#c8c0d8', open ? 28 : 20);
      if (this.hurtBarkT <= 0 && open) { this.hurtBarkT = 3; this.bark(choose(MOROK.hurt), 1.2); }
      if (this.hp <= 0) this.die(L);
    } finally { L.attacker = prev; }
  }
  private die(L: Level3D) {
    if (this.form === 'dead') return;
    const at = this.pos.clone();
    this.dropFake(); this.killCrows();
    this.form = 'dead'; this.st = 0;
    this.go('fall', 2);
    this.pos.copy(at).setY(ARENA.y);
    audio.sfx('victory', { volume: 0.5 });
    L.hud.showBanner('МОРОК ПОВЕРЖЕНА!', '#ffd34a');
    L.tcam.shake(0.5);
    for (let i = 0; i < 10; i++) L.dropPickup(Math.random() < 0.25 ? 'bigcrumb' : 'crumb', this.center());
    L.dropPickup('heart', this.center());
    this.onDefeat?.();
  }

  // ───────────────────────── co-op ─────────────────────────
  /** [form, act, st, at, atMax, seq, x, y, z, yaw, hp, maxHp, ax, az, bx, bz, tongue, flash, crows] */
  netSnap(): number[] {
    return [FORMS.indexOf(this.form), ACTS.indexOf(this.act), this.st, this.at, this.atMax, this.seq % 10000, this.pos.x, this.pos.y, this.pos.z, this.yaw,
      this.hp, this.maxHp, this.a.x, this.a.z, this.b.x, this.b.z, this.tongue, this.flash > 0.5 ? 1 : 0, this.crows.length];
  }
  netApply(a: number[], t?: number) {
    if (t === undefined) return;
    (this.track ??= new NetTrack<number[]>(60, 6)).push(t, a[6], a[7], a[8], a[9], a);
  }
  private netFields(a: number[]) {
    const f = FORMS[a[0]] ?? 'lady', act = ACTS[a[1]] ?? 'idle';
    const newAct = act !== this.act || a[5] !== this.lastSeq;
    if (f !== this.form) {
      const was = this.form;
      this.form = f;
      if (f === 'crows') this.spawnCrows(a[18] || undefined); else if (was === 'crows') this.killCrows();
      if (f !== 'copy') this.dropFake();
      if (f === 'dead') { this.dropFake(); this.killCrows(); }
    }
    if (f === 'crows' && a[18] && this.crows.length !== a[18]) this.spawnCrows(a[18]);
    if (newAct) { this.act = act; this.at = a[3]; this.atMax = a[4] || 1; this.struck = false; }
    this.lastSeq = a[5];
    this.hp = a[10]; this.maxHp = a[11];
    this.a.set(a[12], ARENA.y, a[13]); this.b.set(a[14], ARENA.y, a[15]);
    if (a[17]) this.flash = 1;
    this.got = true;
  }
  netEvent(L: Level3D, ev: string, d: { i?: number; x?: number; y?: number; z?: number; t?: number; w?: string; k?: HeroKind; h?: string; from?: string }) {
    if (L.authority) {
      // a client's hero got clawed by the copy: drain his colour too
      if (ev === 'bit' && d.from) { const r = L.remote(d.from); if (r) vamp(L).bland(r, 2); }
      return;
    }
    switch (ev) {
      case 'dive': { const c = this.crows.find((x) => x.i === d.i); if (c && c.alive) this.startDive(c, d.x ?? 0, d.y ?? ARENA.y, d.z ?? 0, d.t ?? this.st); break; }
      case 'crow': { const c = this.crows.find((x) => x.i === d.i); if (c) this.crowDie(c, null); break; }
      case 'fake': this.form = 'copy'; this.makeFake(L, d.w ?? '', d.k ?? 'tosha'); break;
      case 'unmask':
        if (d.h === 'burst') { this.burstHit(L); this.dropFake(); }
        else this.unmaskFx(L, d.h ?? 'hit');
        break;
    }
  }

  /** client: show the host's Морок as she was at the playback time */
  private puppet(L: Level3D, dt: number) {
    const play = L.nl?.playT ?? -Infinity;
    const pdt = L.nl?.playDt ?? dt;
    this.st += pdt; this.at -= pdt;
    const tr = this.track;
    if (tr && tr.eval(play, dt, pose)) {
      tr.passed(play, (a) => this.netFields(a));
      this.pos.copy(pose.pos);
      this.yaw = pose.yaw;
      const c = tr.cur!, n = tr.next;
      // inside one action its clocks come from the two snapshots around the playback — never backwards
      if (n && n[0] === c[0] && FORMS[c[0]] === this.form) this.st = Math.max(this.st - pdt, tr.lerp(2));
      if (n && n[5] === c[5] && ACTS[c[1]] === this.act) this.at = Math.min(this.at + pdt, tr.lerp(3));
      this.tongue = tr.lerp(16);
    }
    // victim side: my hero against what I see
    this.hitMine(L);
  }

  /** victim side (every machine for its own hero): wolf charge, tongue, belly-flop, crow dives, the copy's claw */
  private hitMine(L: Level3D) {
    const p = L.player;
    if (p.dead || p.downed || p.invuln > 0 || L.worldCut || this.form === 'dead' || this.form === 'intro') return;
    const pc = p.center(v1);
    if (this.form === 'wolf' && this.act === 'run') {
      const hx = this.pos.x + Math.sin(this.yaw) * 0.8, hz = this.pos.z + Math.cos(this.yaw) * 0.8;
      if (Math.hypot(pc.x - hx, pc.z - hz) < 1.35 && Math.abs(pc.y - (this.pos.y + 1)) < 1.4) {
        // knocked aside, away from the lane
        const sx = Math.cos(this.yaw), sz = -Math.sin(this.yaw);
        const side = (pc.x - this.pos.x) * sx + (pc.z - this.pos.z) * sz >= 0 ? 1 : -1;
        p.hurt(L, 1, this.pos.clone(), new THREE.Vector3(sx * side * 9 + Math.sin(this.yaw) * 4, 7, sz * side * 9 + Math.cos(this.yaw) * 4));
      }
    }
    if (this.form === 'toad' && this.act === 'tongue' && this.tongue > 1) {
      const dx = Math.sin(this.yaw), dz = Math.cos(this.yaw);
      const ox = this.pos.x + dx * 1.6, oz = this.pos.z + dz * 1.6;
      const along = (pc.x - ox) * dx + (pc.z - oz) * dz;
      const side = Math.abs((pc.x - ox) * dz - (pc.z - oz) * dx);
      if (along > 0 && along < this.tongue && side < 0.75 && Math.abs(pc.y - (ARENA.y + 1)) < 1.3) {
        p.hurt(L, 1, new THREE.Vector3(ox, ARENA.y, oz), new THREE.Vector3(-dx * 11, 6, -dz * 11), 0.4);
        L.fx.text(pc.clone().setY(pc.y + 1.4), 'Шлёп!', '#ff8ab0', 24);
      }
    }
    if (this.form === 'toad' && this.act === 'flop' && !this.struck) {
      this.struck = true;
      const d = Math.hypot(pc.x - this.pos.x, pc.z - this.pos.z);
      if (d < 2.7 && p.pos.y < ARENA.y + 1.5) { const k = v2.set(pc.x - this.pos.x, 0, pc.z - this.pos.z).normalize(); p.hurt(L, 1, this.pos.clone(), new THREE.Vector3(k.x * 10, 8, k.z * 10)); }
    }
    if (this.form === 'crows') {
      for (const c of this.crows) {
        const dv = c.dive;
        if (!c.alive || !dv || dv.hit) continue;
        const u = this.st - dv.t0;
        if (u > D_TELE + D_FLY * 0.7 && u < D_TELE + D_FLY + 0.15) {
          if (Math.hypot(pc.x - dv.x, pc.z - dv.z) < 1.05 && p.pos.y < dv.y + 1.6) { dv.hit = true; p.hurt(L, 1, new THREE.Vector3(dv.x, dv.y + 2, dv.z)); }
        } else if (u >= D_TELE + D_FLY + 0.15) dv.hit = true;
      }
    }
    if (this.form === 'copy' && this.act === 'strike' && !this.struck && this.at < this.atMax * 0.4) {
      this.struck = true;
      const fx = this.pos.x + Math.sin(this.yaw) * 1.0, fz = this.pos.z + Math.cos(this.yaw) * 1.0;
      if (Math.hypot(pc.x - fx, pc.z - fz) < 1.25 && Math.abs(p.pos.y - this.pos.y) < 1.2) {
        if (p.hurt(L, 1, this.pos.clone())) {
          if (L.authority) vamp(L).bland(p, 2); else L.nl?.entEvent(this, 'bit', {});
          ambient(L, () => audio.sfx('bite'));
        }
      }
    }
  }

  // ───────────────────────── every machine: looks ─────────────────────────
  private place(dt: number) {
    const f = this.form;
    const lady = !this.gone && (f === 'lady' || f === 'intro' || f === 'dead');
    this.ladyG.visible = lady; this.wolfG.visible = f === 'wolf'; this.toadG.visible = f === 'toad';
    const g = lady ? this.ladyG : f === 'wolf' ? this.wolfG : this.toadG;
    g.position.copy(this.pos);
    g.rotation.y = this.yaw;
    this.root.position.copy(this.pos);
    if (this.fake) {
      const fg = this.fake.g;
      fg.position.copy(this.pos);
      fg.rotation.y = this.yaw;
    }
    void dt;
  }

  private visuals(L: Level3D, dt: number) {
    // on the host her own hero is checked here (clients do it in puppet); what happens to MY hero stays on my machine
    if (L.authority) ambient(L, () => this.hitMine(L));
    this.flash = Math.max(0, this.flash - dt * 5);
    this.talk = Math.max(0, this.talk - dt * 2);
    this.place(dt);
    const a = this.anim;
    a.flash = this.flash; a.talk = this.talk > 0 ? Math.abs(Math.sin(L.t * 14)) : 0;
    const k = clamp(1 - this.at / this.atMax, 0, 1);
    a.p = k;
    // the chair rocks while she sits in it
    if (this.form === 'intro') { this.chair.rotation.x = Math.sin(L.t * 1.6) * 0.08; this.ladyG.rotation.x = this.chair.rotation.x; this.ladyG.position.y = this.pos.y + 0.12; }
    else { this.chair.rotation.x = damp(this.chair.rotation.x, 0, 4, dt); this.ladyG.rotation.x = 0; }
    // rigs
    if (this.ladyG.visible) {
      a.st = this.form === 'intro' ? 'sit' : this.form === 'dead' ? 'fall' : this.act === 'dazed' ? 'dazed' : this.act === 'cast' ? 'cast' : this.act === 'taunt' ? 'taunt' : 'idle';
      this.lady.update(dt, a);
      this.stars.visible = this.act === 'dazed' && this.form === 'lady';
      if (this.stars.visible) spinStars(this.stars, L.t, 0.4);
      this.stars.position.y = 1.2;
    }
    if (this.wolfG.visible) {
      a.st = this.act === 'aim' ? 'crouch' : this.act === 'run' ? 'run' : this.act === 'skid' ? 'skid' : 'idle';
      this.wolf.update(dt, a);
      if (this.act === 'run' && Math.random() < 0.5) ambient(L, () => L.fx.dust(this.pos.clone(), 1, '#8a7a6a'));
    }
    if (this.toadG.visible) {
      a.st = this.act === 'puff' ? 'puff' : this.act === 'tongue' ? 'tongue' : this.act === 'crouch' ? 'crouch' : this.act === 'jump' ? 'jump' : this.act === 'flop' ? 'flop' : 'idle';
      this.toad.tongue = this.tongue;
      this.toad.update(dt, a);
    }
    // telegraphs
    if (this.form === 'wolf' && this.act === 'aim') this.lane.show(this.pos.x, this.pos.z, this.b.x, this.b.z, ARENA.y, 1.9, 0.25 + 0.5 * k, L.t);
    else if (this.form === 'wolf' && this.act === 'run') this.lane.show(this.pos.x, this.pos.z, this.b.x, this.b.z, ARENA.y, 1.9, 0.5, L.t);
    else this.lane.hide();
    if (this.form === 'toad' && this.act === 'puff') this.tongueLane.show(this.a.x, this.a.z, this.b.x, this.b.z, ARENA.y, 1.1, 0.2 + 0.5 * k, L.t);
    else this.tongueLane.hide();
    if (this.form === 'toad' && (this.act === 'crouch' || this.act === 'jump')) this.ring.show(L, this.b.x, ARENA.y + 0.5, this.b.z, 2.7, this.act === 'jump' ? 0.3 + 0.5 * k : 0.25);
    else this.ring.hide();
    // crows
    if (this.crows.length) {
      for (const c of this.crows) {
        if (!c.alive) continue;
        this.crowPos(c, this.st, v2);
        const prev = c.rig.root.position.clone();
        c.pos.copy(v2);
        c.rig.root.position.copy(v2);
        const mv = v2.clone().sub(prev);
        if (mv.lengthSq() > 1e-6) c.rig.root.rotation.y = Math.atan2(mv.x, mv.z);
        const dv = c.dive;
        const u = dv ? this.st - dv.t0 : 0;
        c.anim.st = !dv ? 'fly' : u < D_TELE ? 'fly' : u < D_TELE + D_FLY ? 'dive' : u < D_TELE + D_FLY + D_LAND ? 'perch' : 'fly';
        c.rig.update(dt, c.anim);
        if (dv) {
          if (u < D_TELE + D_FLY) dv.mark.show(L, dv.x, dv.y + 0.5, dv.z, 1.0, 0.3 + 0.5 * clamp(u / D_TELE, 0, 1));
          else dv.mark.hide();
        }
      }
    }
    // the fake hero
    if (this.fake) {
      const f = this.fake, an = f.anim;
      const moving = this.act === 'mingle' || this.act === 'stalk' || this.act === 'flee';
      an.state = moving ? 'run' : 'idle';
      an.speed = moving ? 0.8 : 0;
      an.attack = this.act === 'strike' ? { kind: ATK_OF[f.kind], p: clamp(1 - this.at / this.atMax, 0, 1) } : null;
      // a little hop now and then, like a player
      f.hopT -= dt;
      const hop = f.hopT < 0 ? Math.sin(Math.min(1, -f.hopT / 0.55) * Math.PI) * 1.1 : 0;
      if (f.hopT < -0.55) f.hopT = rand(2.5, 5);
      if (hop > 0.05) an.state = 'jump';
      f.g.position.y = this.pos.y + hop;
      an.flash = this.flash;
      f.rig.update(dt, an);
    }
    // the camera: her (beasts) — or the middle of the veranda (the flock, the copy: never point at the fake!)
    if (L.boss === this) {
      L.hud.bossHp = this.hp; L.hud.bossMax = this.form === 'intro' || this.form === 'dead' ? 0 : this.maxHp; L.hud.bossName = this.name;
      const bp = L.tcam.bossPoint ?? (L.tcam.bossPoint = new THREE.Vector3());
      if (this.form === 'crows' || this.form === 'copy') bp.set(ARENA.cx, ARENA.y + 2, ARENA.cz);
      else bp.copy(this.pos).setY(this.pos.y + 1.5);
    }
    this.updateCast(L, dt);
    // tips: every machine for itself
    if (this.form !== this.hintForm) { this.hintForm = this.form; this.hintT = 2.6; }
    if (this.hintT > 0 && (this.hintT -= dt) <= 0 && !L.worldCut) {
      const tip: Partial<Record<Form, [string, string]>> = { wolf: ['fangs2wolf', TOASTS.wolf], toad: ['fangs2toad', TOASTS.toad], crows: ['fangs2crows', TOASTS.crows], copy: L.nl ? ['fangs2copyCoop', TOASTS.bossCoop] : ['fangs2copy', TOASTS.copySolo] };
      const h = tip[this.form];
      if (h) ambient(L, () => L.hint(h[0], h[1]));
    }
  }

  /** a puff of black feathers (she changes shape) */
  private morphFx() {
    const L = this.L;
    const c = this.center();
    L.fx.emit(c, { count: 34, speed: [1.5, 5], life: [0.4, 1.0], size: [0.15, 0.32], colors: ['#16121c', '#3a2a48', '#6a2a8a', '#c060ff'], drag: 2.5, g: -1 });
    audio.sfx('batFlap', { pitch: 0.8, volume: 0.7 });
    audio.sfx('mist', { volume: 0.5 });
  }

  /** the fake's name tag: drawn like a friend's (co-op only — solo has no tags) */
  private drawFakeTag(ctx: CanvasRenderingContext2D) {
    const L = this.L, f = this.fake;
    if (!f || !L.nl || !f.name || L.castHidden || L.letterbox > 0.3) return;
    const head = toUI(v3.copy(f.g.position).setY(f.g.position.y + 1.55), L.tcam.cam);
    if (!head.vis) return;
    const d = f.g.position.distanceTo(L.player.pos);
    const a = clamp(1.4 - d / 45, 0.35, 1);
    let hp = 5, maxHp = 5;
    if (f.who === net.myId) { hp = L.player.hp; maxHp = L.player.maxHp; } else { const r = L.remote(f.who); if (r) { hp = r.hp; maxHp = r.maxHp; } }
    ctx.save(); ctx.globalAlpha = a;
    ctx.font = '700 17px Rubik, sans-serif';
    const w = ctx.measureText(f.name).width + 20;
    rrect(ctx, head.x - w / 2, head.y - 24, w, 24, 10, 'rgba(20,10,16,0.65)', 0);
    text(ctx, f.name, head.x, head.y - 6, { size: 17, weight: 700, color: f.color, align: 'center' });
    const n = Math.min(12, maxHp);
    for (let i = 0; i < n; i++) { ctx.fillStyle = i < hp ? '#ff3a5a' : 'rgba(60,30,40,0.7)'; ctx.fillRect(head.x - n * 4 + i * 8, head.y + 2, 6, 4); }
    ctx.restore();
  }

  dispose() {
    this.killCrows(); this.dropFake();
    this.lane.mesh.removeFromParent(); this.tongueLane.mesh.removeFromParent(); this.ring.dispose();
  }
}

void save;
