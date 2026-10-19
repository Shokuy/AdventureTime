import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { choose, rand } from '../../../../engine/util';
import { basic, noOutline } from '../../../gfx';
import { makeBlob } from '../../../fx';
import { clamp, damp } from '../../../models/kit';
import type { Level3D, Boss3Like, HeroLike, Actor3, Hittable3 } from '../../level';
import { NET_SPAWN, toV, type Netted } from '../../netLevel';
import type { Shot3 } from '../../objects';
import { NetTrack, type NetPose } from '../../netInterp';
import { coop } from '../../coop';
import { vampBane } from '../../heroes/bane';
import { vamp, markCharacter, GroundMark, ambient, type Lantern } from '../vampires';
import { createCount, type CountRig, type CountAnim } from './bossRig';
import type { Cast, CastKind } from './cast';
import { COUNT, HELP, TOAST, BARK } from './lines';

/**
 * Граф Нетопырь — the flying vampire of the town hall's dome (docs/script-fangs.md §5.5–5.7).
 *  • In the air he can't be hurt («В воздухе Граф неуязвим»). He circles the dome, then:
 *      swoop — a screech and a red lane on the floor (telegraph), then he skims the lane low and fast: −1 ♥ to whoever
 *              is on it (a swing that meets him in the swoop knocks him down; flying into a light burns him down);
 *      bombs — «зефирные бомбы» dropped at the heroes' spots (rings on the floor); a swing bats one back at him;
 *      phase 2 (≤ 2/3 HP) — «Мыши, ко мне!»: a flock of scouts; double swoops;
 *      phase 3 (≤ 1/3 HP) — «Да будет… ТЬМА!»: every lantern out, the dome goes dark (red-moon flashes now and then, his
 *              eyes glow), he keeps snuffing the lanterns heroes relight (a slow, low approach: a chance to hit him).
 *  • Knock him down: peas (рогатка), Пастила's syrup, Ноки's chord or pluck, Бублик's hook, a batted bomb — one hit in
 *    solo, a few with a bigger team (stagger). Down, he sits dazed for a few seconds: THEN he takes damage. Then up again.
 *  • Solo (GDD §8): the story three on the dome's rim help when he stays up too long (Пастила's syrup, Ноки's chord,
 *    Бублик's paw) and, in the dark, Пастила puts down her beacon.
 * HP and pace scale with the party. Co-op: the host simulates; clients play his snapshots back (NetTrack) — position,
 * state, the swoop lane, the phase and the darkness are the same on every machine; bombs are host spawns.
 */

export interface CountEnv {
  /** the dome's floor centre and radius (the fight stays inside) */
  c: THREE.Vector3; R: number;
  /** the «солнышки» around the rim */
  lanterns: Lantern[];
  /** where he perches before the fight (the weathervane) */
  perch: THREE.Vector3;
  /** the story four (solo help at the rim) */
  cast: Cast;
}

const BASE_HP = 40;
/** he's drawn a little bigger than a hero's 2.3 m model (readable in the air) */
const SCALE = 1.25;
/** one knock-down never takes more than this share of his HP: he jumps up (a team can't burst him down at once) */
const DOWN_CAP = 0.3;
const FLY_H = 6.2;
const ORBIT = 7.2;
type St = 'perch' | 'fly' | 'tele' | 'dive' | 'climb' | 'bombs' | 'summon' | 'goSnuff' | 'snuff' | 'fall' | 'down' | 'rise' | 'dying' | 'dead';
const STATES: St[] = ['perch', 'fly', 'tele', 'dive', 'climb', 'bombs', 'summon', 'goSnuff', 'snuff', 'fall', 'down', 'rise', 'dying', 'dead'];
const AIR: St[] = ['fly', 'tele', 'dive', 'climb', 'bombs', 'summon', 'goSnuff', 'snuff'];
const ANIM: Partial<Record<St, string>> = { perch: 'perch', fly: 'fly', tele: 'tele', dive: 'dive', climb: 'fly', bombs: 'drop', summon: 'summon', goSnuff: 'fly', snuff: 'snuff', fall: 'hurt', down: 'down', rise: 'rise', dying: 'down', dead: 'down' };
const MELEE = new Set(['sword', 'swordAlt', 'fork', 'spin', 'punch', 'axe', 'axeAlt', 'axeSpin', 'mill', 'flask', 'flaskAlt']);

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
const pose: NetPose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };

/** a red stripe on the floor: the swoop's lane */
class Lane {
  mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  constructor() {
    const c = document.createElement('canvas'); c.width = 16; c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createLinearGradient(0, 0, 16, 0);
    gr.addColorStop(0, 'rgba(255,60,80,0)'); gr.addColorStop(0.2, 'rgba(255,60,80,0.9)'); gr.addColorStop(0.5, 'rgba(255,150,160,1)'); gr.addColorStop(0.8, 'rgba(255,60,80,0.9)'); gr.addColorStop(1, 'rgba(255,60,80,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 16, 64);
    const tex = new THREE.CanvasTexture(c);
    this.mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mat.polygonOffset = true; this.mat.polygonOffsetFactor = -4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.mat);
    this.mesh.renderOrder = 3;
    noOutline(this.mesh);
    this.mesh.visible = false;
  }
  show(L: Level3D, ax: number, az: number, bx: number, bz: number, y: number, w: number, a: number) {
    if (!this.mesh.parent) L.scene.add(this.mesh);
    const len = Math.hypot(bx - ax, bz - az);
    this.mesh.position.set((ax + bx) / 2, y + 0.06, (az + bz) / 2);
    this.mesh.rotation.set(0, Math.atan2(bx - ax, bz - az), 0);
    this.mesh.scale.set(w, 1, len);
    this.mat.opacity = a;
    this.mesh.visible = a > 0.01;
  }
  hide() { this.mesh.visible = false; }
}

export class Count3 implements Boss3Like, Netted {
  name = 'Граф Нетопырь';
  hp: number; maxHp: number;
  netId = 0;
  netKind = 'f1count';
  get netRoot() { return this.root; }
  root = new THREE.Group();
  rig: CountRig;
  anim: CountAnim = { st: 'perch', p: 0, flash: 0, talk: 0, small: 0, glow: 0.4, speed: 0 };
  blob: THREE.Mesh;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  state: St = 'perch';
  st = 0; dur = 1;
  phase = 1;
  active = false;
  /** 0/1: the dome is dark (phase 3) — and how dark it looks on this machine */
  dark = 0; darkK = 0;
  /** a scripted scene moves him (every machine) */
  manual = false;
  onDefeat: (() => void) | null = null;
  laneA = new THREE.Vector2(); laneB = new THREE.Vector2();
  /** stagger toward a knock-down (host) and how much a knock-down needs */
  stagger = 0;
  private staggerT = 0;
  /** damage taken in this knock-down */
  private downDmg = 0;
  private knocks = 0;
  private diveY = 0;
  private seq = 0;
  private flash = 0;
  private orbA = 0;
  private cd = 3;
  private sumCd = 6;
  private snuffCd = 6;
  private flashCd = 6;
  private flashK = 0;
  private bombsLeft = 0;
  private bombT = 0;
  private doubles = 0;
  private hitHeroes = new Set<HeroLike>();
  private hitIds = new Set<string | number>();
  private target: HeroLike | null = null;
  private snuffL: Lantern | null = null;
  private lane = new Lane();
  private dropMark = new GroundMark('#ffb0d0', true);
  private defeatT = -1;
  private t = 0;
  private barkCd = 0;
  private toasted = new Set<string>();
  private base: { hemi: number; sun: number; bg: THREE.Color; fog: THREE.Color } | null = null;
  // solo help
  private airT = 0; private beaconT = 10; private helpI = 0;
  // client playback
  private track: NetTrack<number[]> | null = null;
  private wasManual = false;
  private blendFrom: THREE.Vector3 | null = null;
  private blend = new THREE.Vector3();
  private got = false;

  constructor(private L: Level3D, private env: CountEnv) {
    this.rig = createCount();
    this.rig.root.scale.setScalar(SCALE);
    this.root.add(this.rig.root);
    markCharacter(this.rig.root);
    this.blob = makeBlob(0.8);
    L.scene.add(this.root, this.blob);
    this.hp = this.maxHp = Math.round(BASE_HP * (L.nl ? coop.hpScale() : 1));
    this.pos.copy(env.perch);
    this.root.position.copy(this.pos);
    this.yaw = 0;
    // fixed net id (made at build in the same order on every machine)
    if (L.nl) { let id = 940; while (L.nl.get(id)) id++; L.nl.add(this, id); }
  }

  get fighting() { return this.active && !this.dead && this.state !== 'perch'; }
  get dead() { return this.state === 'dying' || this.state === 'dead'; }
  get airborne() { return AIR.includes(this.state); }
  center(out = new THREE.Vector3()) { return out.copy(this.pos).setY(this.pos.y + (this.state === 'down' || this.state === 'fall' ? 0.8 : 1.6)); }
  private heroes() { return this.L.heroes().length; }
  private need() { return Math.min(4, 2 + Math.floor((this.heroes() - 1) / 2)); }
  private cdMul() { return 1 / (1 + 0.14 * (this.heroes() - 1)); }

  /** host: the fight starts (after the intro / a retry) */
  start() {
    if (!this.L.authority) return;
    this.active = true;
    this.manual = false;
    // up into his circle from wherever the scene left him (no jump: every machine sees him fly there)
    const c = this.env.c;
    this.orbA = Math.hypot(this.pos.x - c.x, this.pos.z - c.z) > 0.5 ? Math.atan2(this.pos.x - c.x, this.pos.z - c.z) : Math.PI;
    this.go('climb', 1.4);
    this.cd = 2.5; this.sumCd = 4; this.snuffCd = 5; this.airT = 0;
  }
  private go(s: St, dur = 0) { this.state = s; this.st = 0; this.dur = Math.max(0.001, dur); this.seq++; }

  // ═════════════════════════════ every frame ═════════════════════════════
  update(L: Level3D, dt: number) {
    this.t += dt;
    if (this.manual) { this.wasManual = true; this.visuals(L, dt); return; }
    // a scene let go of him: a client eases from the scene's pose into the host's played-back one (no pop)
    if (this.wasManual) { this.wasManual = false; if (!L.authority) this.blendFrom = this.pos.clone(); }
    if (!L.authority) this.puppet(L, dt);
    else this.sim(L, dt);
    this.visuals(L, dt);
  }

  private say(lines: readonly string[] | string, shout = false) {
    const L = this.L;
    if (this.barkCd > 0 && !shout) return;
    this.barkCd = 2.6;
    const s = typeof lines === 'string' ? lines : choose(lines as string[]);
    // (a pea's hit is resolved outside the captured world tick: share it explicitly)
    shared(L, () => { L.bark(this.root, s, 2.0, 3.0); if (shout) L.shout(s, 2.2); });
  }
  private toastOnce(key: string, str: string) {
    if (this.toasted.has(key)) return;
    this.toasted.add(key);
    this.L.hud.toast(str, 6);
  }

  // ═════════════════════════════ host ═════════════════════════════
  private sim(L: Level3D, dt: number) {
    this.st += dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    this.barkCd -= dt;
    if (!this.active) { if (this.state === 'perch' && !L.worldCut) this.farShouts(L, dt); return; }
    if (this.state === 'dead') return;
    if (this.state === 'dying') {
      if (this.defeatT >= 0 && (this.defeatT += dt) > 1.2) { this.defeatT = -1; this.state = 'dead'; this.onDefeat?.(); }
      return;
    }
    if (L.worldCut) { this.vel.set(0, 0, 0); return; }
    const K = vamp(L);
    const c = this.env.c;
    this.staggerT -= dt;
    if (this.staggerT <= 0) this.stagger = Math.max(0, this.stagger - dt * 0.6);
    const k = this.st / this.dur;
    const t = this.pickTarget(L);
    switch (this.state) {
      case 'fly': {
        this.orbit(dt, 0.55 + 0.12 * this.phase);
        if (t) this.faceTo(t.pos, dt, 5);
        this.cd -= dt; this.sumCd -= dt; this.snuffCd -= dt;
        if (this.cd <= 0) this.choose(L);
        break;
      }
      case 'tele': {
        // hold over the lane's start, screeching; the lane glows on the floor
        this.moveTo(v1.set(this.laneA.x, this.pos.y, this.laneA.y), 4, dt);
        this.faceTo(v2.set(this.laneB.x, 0, this.laneB.y), dt, 10);
        if (k >= 1) { this.go('dive', Math.hypot(this.laneB.x - this.laneA.x, this.laneB.y - this.laneA.y) / (15 + this.phase)); this.hitHeroes.clear(); audio.sfx('whoosh', { pitch: 0.7 }); }
        break;
      }
      case 'dive': {
        const kk = clamp(k, 0, 1);
        const low = Math.max(0, 1 - kk * 3.2);
        if (this.st - dt <= 0) this.diveY = this.pos.y;
        this.pos.set(this.laneA.x + (this.laneB.x - this.laneA.x) * kk, c.y + 0.5 + (this.diveY - c.y - 0.5) * low * low, this.laneA.y + (this.laneB.y - this.laneA.y) * kk);
        this.vel.set(this.laneB.x - this.laneA.x, 0, this.laneB.y - this.laneA.y).multiplyScalar(1 / this.dur);
        this.faceTo(v2.set(this.laneB.x, 0, this.laneB.y), dt, 12);
        // the heroes on the lane
        const cc = this.center(v1);
        for (const h of L.alivePlayers()) {
          if (this.hitHeroes.has(h)) continue;
          const hc = h.center(v2);
          if (Math.hypot(hc.x - cc.x, hc.z - cc.z) < 1.15 && Math.abs(hc.y - cc.y) < 1.4) {
            this.hitHeroes.add(h);
            h.hurt(L, 1, cc.clone(), new THREE.Vector3(this.vel.x, 0, this.vel.z).normalize().multiplyScalar(7).setY(5));
          }
        }
        // flying into a light burns him down
        if (kk > 0.25 && K.sunAt(cc) > 0.35) { this.knock(L, 'sun'); break; }
        if (k >= 1) {
          if (this.doubles > 0 && t) { this.doubles--; this.lanePlan(L, t); this.go('tele', 0.55); }
          else this.go('climb', 0.9);
        }
        break;
      }
      case 'climb': {
        this.orbA = Math.atan2(this.pos.x - c.x, this.pos.z - c.z);
        this.moveTo(v1.set(c.x + Math.sin(this.orbA) * ORBIT, c.y + FLY_H, c.z + Math.cos(this.orbA) * ORBIT), 8, dt);
        if (k >= 1) { this.go('fly'); this.cd = rand(1.6, 2.6) * this.cdMul(); }
        break;
      }
      case 'bombs': {
        this.moveTo(v1.set(c.x + Math.sin(this.orbA) * 3, c.y + FLY_H + 1.4, c.z + Math.cos(this.orbA) * 3), 5, dt);
        if (t) this.faceTo(t.pos, dt, 6);
        this.bombT -= dt;
        if (this.bombT <= 0 && this.bombsLeft > 0) {
          this.bombsLeft--;
          this.bombT = 0.38;
          const hs = L.alivePlayers();
          const h = hs.length ? hs[(this.bombsLeft + Math.floor(this.t * 3)) % hs.length] : null;
          const at = h ? h.pos.clone().add(v2.set(rand(-1.2, 1.2), 0, rand(-1.2, 1.2))) : c.clone().add(v2.set(rand(-5, 5), 0, rand(-5, 5)));
          this.clampIn(at, 1.2); at.y = c.y;
          new MarshBomb(L, this.center(v1).clone().add(v2.set(0, -0.5, 0)), at, 0.95);
          if (this.bombsLeft === 2) this.say(COUNT.p1);
        }
        if (this.bombsLeft <= 0 && this.bombT <= -0.4) { this.go('fly'); this.cd = rand(2.2, 3.2) * this.cdMul(); }
        break;
      }
      case 'summon': {
        this.vel.set(0, 0, 0);
        if (k >= 0.5 && this.st - dt < this.dur * 0.5) {
          const n = 2 + Math.floor(this.heroes() / 2);
          K.flock(this.pos.x, c.y + 3.6, this.pos.z, n, 2.4);
          audio.sfx('batScreech', { pitch: 0.8 });
        }
        if (k >= 1) { this.go('fly'); this.cd = 1.8 * this.cdMul(); this.sumCd = 16; }
        break;
      }
      case 'goSnuff': {
        const l = this.snuffL;
        if (!l || !l.lit) { this.go('fly'); this.cd = 1; break; }
        this.moveTo(v1.copy(l.head).setY(l.head.y + 1.0).addScaledVector(v2.set(l.pos.x - c.x, 0, l.pos.z - c.z).normalize(), 0.8), 7, dt);
        this.faceTo(l.pos, dt, 6);
        if (this.pos.distanceTo(v1) < 0.5 || k >= 1) this.go('snuff', 1.0);
        break;
      }
      case 'snuff': {
        this.vel.set(0, 0, 0);
        const l = this.snuffL;
        if (k >= 1) {
          if (l?.lit) { l.snuff(); this.say(COUNT.p3); }
          this.snuffL = null;
          this.go('climb', 0.9);
          this.snuffCd = rand(7, 10) * (0.7 + 0.3 * this.cdMul());
        }
        break;
      }
      case 'fall': {
        const gy = c.y;
        this.pos.y = Math.max(gy, this.pos.y - dt * (4 + this.st * 20));
        this.vel.set(0, 0, 0);
        if (this.pos.y <= gy + 0.01) {
          this.pos.y = gy;
          this.go('down', Math.max(3.0, 4.6 - 0.4 * (this.heroes() - 1)));
          this.downDmg = 0;
          L.tcam.shake(0.35);
          L.fx.dust(this.pos.clone(), 16);
          audio.sfx('thud', { pitch: 0.8 });
        }
        break;
      }
      case 'down': {
        this.vel.set(0, 0, 0);
        if (k >= 1) this.rise(L);
        break;
      }
      case 'rise': {
        this.moveTo(v1.set(this.pos.x, c.y + FLY_H, this.pos.z), 7, dt);
        if (k >= 1) { this.orbA = Math.atan2(this.pos.x - c.x, this.pos.z - c.z); this.go('fly'); this.cd = rand(1.4, 2.2) * this.cdMul(); this.airT = 0; }
        break;
      }
      default: break;
    }
    // phase 3: red-moon flashes now and then
    if (this.phase === 3 && this.dark && (this.flashCd -= dt) <= 0) { this.flashCd = rand(5.5, 8.5); this.moonFlash(); L.nl?.entEvent(this, 'flash', {}); }
    this.soloHelp(L, dt);
  }

  /** §5.4: the Count calls from his weathervane while the heroes cross the roofs */
  private farT = 14;
  private farI = 0;
  private farShouts(L: Level3D, dt: number) {
    if ((this.farT -= dt) > 0) return;
    this.farT = rand(20, 30);
    const hs = L.alivePlayers();
    if (!hs.some((h) => h.pos.distanceTo(this.env.c) > this.env.R + 6 && Math.hypot(h.pos.x, h.pos.z) > 7)) return;
    const s = BARK.countFar[this.farI++ % BARK.countFar.length];
    L.shout(s, 2.4);
    L.bark(this.root, s, 2.4, 3.0);
  }

  /** the next move from the circle */
  private choose(L: Level3D) {
    const t = this.pickTarget(L);
    const lit = this.env.lanterns.filter((l) => l.lit);
    if (this.phase >= 2 && this.sumCd <= 0 && L.enemies.filter((e) => e.kind === 'bat' && !e.dead).length < 3) { this.go('summon', 1.3); this.say(COUNT.p2, true); return; }
    if (this.phase === 3 && this.snuffCd <= 0 && lit.length) {
      // the lit lantern nearest a hero (he wants them in the dark)
      let best: Lantern | null = null, bd = Infinity;
      for (const l of lit) for (const h of L.alivePlayers()) { const d = h.pos.distanceTo(l.pos); if (d < bd) { bd = d; best = l; } }
      this.snuffL = best ?? lit[0];
      this.go('goSnuff', 3.5);
      return;
    }
    const r = Math.random();
    if (t && r < 0.62) {
      this.lanePlan(L, t);
      this.doubles = this.phase >= 2 ? 1 : 0;
      this.go('tele', this.phase === 3 ? 0.8 : 0.95);
      audio.sfx('batScreech', { pitch: 0.6, volume: 0.8 });
      return;
    }
    this.bombsLeft = 3 + Math.floor(this.heroes() / 2) + (this.phase === 3 ? 1 : 0);
    this.bombT = 0.5;
    this.go('bombs', 6);
    this.toastOnce('bombs', TOAST.bombs);
  }

  /** a swoop lane from where he is, through the hero's spot, on to the rim (he never jumps to its start) */
  private lanePlan(L: Level3D, t: HeroLike) {
    const c = this.env.c;
    const ax = this.pos.x, az = this.pos.z;
    let dx = t.pos.x - ax, dz = t.pos.z - az;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    const R = this.env.R - 1.2;
    // where the ray from him through the hero leaves the ring
    const ox = ax - c.x, oz = az - c.z;
    const b = ox * dx + oz * dz, cc = ox * ox + oz * oz - R * R;
    const s1 = -b + Math.sqrt(Math.max(0, b * b - cc));
    this.laneA.set(ax, az);
    this.laneB.set(ax + dx * Math.max(s1, d + 3), az + dz * Math.max(s1, d + 3));
    void L;
  }

  /** a hero to go after: not in the light, not down; sticky for a while */
  private tgtT = 0;
  private pickTarget(L: Level3D): HeroLike | null {
    const K = vamp(L), c = this.env.c;
    this.tgtT -= 1 / 60;
    const hs = L.alivePlayers().filter((h) => Math.hypot(h.pos.x - c.x, h.pos.z - c.z) < this.env.R + 2 && h.pos.y > c.y - 2);
    if (!hs.length) return null;
    if (this.target && hs.includes(this.target) && this.tgtT > 0) return this.target;
    let best: HeroLike | null = null, bd = Infinity;
    for (const h of hs) {
      let d = h.pos.distanceTo(this.pos);
      if (K.sunAt(h.center(v1)) > 0.3) d += 14;
      if (h === this.target) d += 4; // (spread the attention)
      d += Math.random() * 3;
      if (d < bd) { bd = d; best = h; }
    }
    this.target = best;
    this.tgtT = rand(5, 8);
    return best;
  }

  private orbit(dt: number, w: number) {
    const c = this.env.c;
    this.orbA += w * dt / ORBIT * 6;
    const y = c.y + FLY_H + Math.sin(this.t * 1.7) * 0.4;
    this.moveTo(v1.set(c.x + Math.sin(this.orbA) * ORBIT, y, c.z + Math.cos(this.orbA) * ORBIT), 6, dt);
  }
  private moveTo(p: THREE.Vector3, speed: number, dt: number) {
    v2.copy(p).sub(this.pos);
    const d = v2.length();
    const step = Math.min(d, speed * dt);
    if (d > 1e-4) { this.vel.copy(v2).multiplyScalar(step / d / Math.max(dt, 1e-4)); this.pos.addScaledVector(v2, step / d); }
    else this.vel.set(0, 0, 0);
  }
  private faceTo(p: THREE.Vector3, dt: number, rate: number) {
    const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    this.yaw += Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw)) * Math.min(1, dt * rate);
  }
  private clampIn(p: THREE.Vector3, margin: number) {
    const c = this.env.c, R = this.env.R - margin;
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz);
    if (d > R) { p.x = c.x + dx / d * R; p.z = c.z + dz / d * R; }
    return p;
  }

  // ───────────────────────── knocked down, damaged ─────────────────────────
  /** a hit while he flies: toward a knock-down */
  private airHit(L: Level3D, kind: string, at: THREE.Vector3) {
    if (!this.airborne) return;
    const melee = MELEE.has(kind);
    // a swing that meets him low (the swoop, the snuffing) knocks him down at once; so does a batted bomb or the sun
    if ((melee && (this.state === 'dive' || this.state === 'snuff' || this.state === 'goSnuff')) || kind === 'bomb' || kind === 'sun') { this.knock(L, kind); return; }
    const w = kind === 'chord' ? 2 : 1;
    this.stagger += w;
    this.staggerT = 2.6;
    this.flash = 1;
    shared(L, () => { L.fx.sparks(at.clone(), 8, ['#ffd0e0', '#ffffff', '#ff7aa8']); audio.sfx('hit', { pitch: 1.4, volume: 0.7 }); });
    if (this.stagger >= this.need()) this.knock(L, kind);
    else shared(L, () => L.fx.text(this.center(v1).setY(this.pos.y + 2.6), `${Math.floor(this.stagger)}/${this.need()}`, '#ffd0e0', 20));
  }

  /** down he goes («Ой! Мой плащ!») */
  knock(L: Level3D, why = 'hit') {
    if (!L.authority || !this.airborne) return;
    this.stagger = 0;
    this.go('fall', 1.2);
    this.flash = 1;
    this.snuffL = null;
    const c = this.env.c;
    this.clampIn(this.pos, 1.8);
    this.say(COUNT.down);
    shared(L, () => {
      L.fx.stars(this.center(v1), 22, ['#ffe14a', '#fff3c0', '#ffffff']);
      L.fx.ring(v1.set(this.pos.x, c.y + 0.1, this.pos.z), 2.2, '#ffe14a', 0.4);
      audio.sfx(why === 'sun' ? 'hiss' : 'bossHit', { pitch: 1.2 });
      L.tcam.shake(0.25);
    });
    this.airT = 0;
    if (!L.nl) this.helperBark('tosha', HELP.tosha);
    // peas for the slingshots (every hero picks up his own)
    if ((this.knocks = (this.knocks + 1) % 2) === 0) L.dropPickup('peas', v1.set(this.pos.x, c.y + 0.6, this.pos.z).clone());
  }
  private rise(L: Level3D) {
    this.go('rise', 0.9);
    this.say(COUNT.up, true);
    shared(L, () => { L.fx.emit(this.center(v1), { count: 20, speed: [1, 3], life: [0.4, 0.8], size: [0.2, 0.4], colors: ['#3b2b52', '#5d4880', '#b31c3c'], g: -1, drag: 2 }); audio.sfx('batFlap', { pitch: 0.7 }); });
  }

  meleeHit(L: Level3D, c: THREE.Vector3, dir: THREE.Vector3, range: number, half: number, dmg: number, atkId: number, kind: string): boolean {
    if (!L.authority || !this.fighting || this.state === 'rise') return false;
    const key = L.attacker ? `${L.attacker}:${atkId}` : atkId;
    if (this.hitIds.has(key)) return false;
    const cc = this.center(v1);
    let reach: boolean;
    if (kind === 'chord') reach = c.distanceTo(cc) < range + 3.6;
    else {
      v2.set(cc.x - c.x, 0, cc.z - c.z);
      const d = v2.length();
      reach = d < range + 0.9 && c.y > cc.y - 2.3 && c.y < cc.y + 1.6;
      if (reach && half < Math.PI && d > 0.5 && v2.normalize().dot(dir) < Math.cos(half) - 0.2) reach = false;
    }
    if (!reach) return false;
    this.hitIds.add(key);
    if (this.hitIds.size > 200) this.hitIds.delete(this.hitIds.values().next().value as string);
    if (this.airborne) this.airHit(L, kind, cc.clone());
    else if (this.state === 'down' || this.state === 'fall') this.damage(L, dmg, cc.clone(), kind);
    return true;
  }
  shotHit(L: Level3D, s: Shot3): boolean {
    if (!L.authority || !this.fighting || this.state === 'rise') return false;
    if (s.pos.distanceTo(this.center(v1)) > 1.15) return false;
    const prev = L.attacker;
    if (s.shooter) L.attacker = s.shooter;
    try {
      if (this.airborne) this.airHit(L, 'pea', s.pos.clone());
      else this.damage(L, s.dmg, s.pos.clone(), 'pea');
    } finally { L.attacker = prev; }
    return true;
  }
  predictHit(_L: Level3D, c: THREE.Vector3, range: number): boolean {
    return this.fighting && this.center(v1).distanceTo(c) < range + 1.2;
  }

  /** host: damage while he's down (also the tests' way in) */
  damage(L: Level3D, n: number, at: THREE.Vector3, kind = 'sword') {
    if (!L.authority || !this.active || this.dead) return;
    if (this.airborne && n < 999) return;
    let d = n * vampBane(L, kind);
    if (vamp(L).sunAt(this.center(v1)) > 0.3 || kind === 'sun') d *= 1.5;
    d = Math.max(1, Math.round(d));
    shared(L, () => {
      this.hp = Math.max(0, this.hp - d);
      this.flash = 1;
      audio.sfx('bossHit', { pitch: 1.25 });
      L.fx.sparks(at, 10, ['#ffd0e0', '#ffffff', '#b31c3c']);
      L.fx.text(at.clone().setY(at.y + 1), String(d), d > n ? '#ffe14a' : '#ffffff', d > n ? 28 : 22);
      L.tcam.shake(0.12);
    });
    if (Math.random() < 0.45) this.say(COUNT.hurt);
    if (this.hp <= 0) { this.defeat(L); return; }
    this.downDmg += d;
    if (this.phase === 1 && this.hp <= this.maxHp * 0.66) this.toPhase(L, 2);
    else if (this.phase === 2 && this.hp <= this.maxHp * 0.33) this.toPhase(L, 3);
    else if (this.state === 'down' && this.downDmg >= this.maxHp * DOWN_CAP) this.rise(L);
  }

  private toPhase(L: Level3D, n: number) {
    this.phase = n;
    for (let i = 0; i < Math.min(3, this.heroes()); i++) L.dropPickup('heart', this.center(v1));
    this.rise(L);
    if (n === 2) { this.say(COUNT.p2[0], true); this.sumCd = 1.2; }
    else {
      this.say(COUNT.p3[0], true);
      this.dark = 1;
      for (const l of this.env.lanterns) if (l.lit) l.snuff();
      shared(L, () => L.hud.toast(TOAST.dark, 7));
      this.snuffCd = 8; this.flashCd = 3;
    }
    L.nl?.entEvent(this, 'phase', { n });
    this.phaseFx(n);
  }
  private phaseFx(n: number) {
    const L = this.L;
    ambient(L, () => {
      audio.sfx(n === 3 ? 'snuff' : 'batScreech', { pitch: 0.6 });
      L.fx.ring(this.env.c.clone().setY(this.env.c.y + 0.2), this.env.R, n === 3 ? '#3a2a5a' : '#b31c3c', 0.9);
      L.tcam.shake(0.35);
    });
  }
  private moonFlash() {
    const L = this.L;
    this.flashK = 1;
    ambient(L, () => { L.whiteFlash = Math.max(L.whiteFlash, 0.22); audio.sfx('thud', { pitch: 0.4, volume: 0.5 }); });
  }

  private defeat(L: Level3D) {
    this.state = 'dying'; this.st = 0; this.seq++;
    this.defeatT = 0;
    this.dark = 0;
    L.hud.bossMax = 0;
    for (let i = 0; i < 8; i++) L.dropPickup(Math.random() < 0.3 ? 'bigcrumb' : 'crumb', this.center(v1));
    L.dropPickup('heart', this.center(v1));
    // the scouts he called fly off with him
    for (const e of L.enemies) if (e.kind === 'bat' && !e.dead && e.body.pos.distanceTo(this.env.c) < this.env.R + 8) e.hurt(L, 99, e.body.pos.clone(), 'sun');
    // his bombs still falling / fizzing fizzle out: none may hurt (or down) a hero in the beat before the defeat scene
    for (const a of L.actors) if (a instanceof MarshBomb && !a.dead) a.fizzle(L);
  }

  // ───────────────────────── solo help (GDD §8) ─────────────────────────
  private helperBark(k: CastKind, s: string) {
    const cast = this.env.cast;
    if (this.L.nl || this.L.player.kind === k || !cast.shown(k)) return false;
    this.L.bark(cast.npc(k).root, s, 2.4, 2.1);
    cast.npc(k).talk = 0.8;
    return true;
  }
  private soloHelp(L: Level3D, dt: number) {
    if (L.nl || !this.active || this.dead) return;
    const cast = this.env.cast;
    if (this.airborne && this.state !== 'tele' && this.state !== 'dive') this.airT += dt;
    const lim = this.phase === 3 ? 12 : 15;
    if (this.airT > lim && this.airborne && this.state !== 'dive') {
      const order: CastKind[] = ['pastila', 'noki', 'bublik'];
      for (let i = 0; i < 3; i++) {
        const k = order[(this.helpI + i) % 3];
        if (k === L.player.kind || !cast.shown(k)) continue;
        this.helpI = (this.helpI + i + 1) % 3;
        this.airT = 0;
        const from = cast.pos(k).clone().setY(cast.pos(k).y + 1.2);
        this.helperBark(k, k === 'pastila' ? HELP.pastila : k === 'noki' ? HELP.noki : HELP.bublik);
        cast.look(k, this.pos);
        const a = cast.anim(k);
        a.attack = { kind: k === 'pastila' ? 'syringe' : k === 'noki' ? 'chord' : 'grab', p: 0 };
        L.actors.push(new HelpShot(L, from, this, k, () => { a.attack = null; if (this.airborne) this.knock(L, 'help'); }));
        break;
      }
    }
    // in the dark: Пастила puts her beacon down by me (or Ноки's chord shows him)
    if (this.phase === 3 && this.dark) {
      this.beaconT -= dt;
      const K = vamp(L);
      if (this.beaconT <= 0 && K.sunAt(L.player.center(v1)) < 0.2) {
        this.beaconT = 16;
        if (this.helperBark('pastila', HELP.beacon)) K.light(L.player.pos.clone().add(v2.set(rand(-1, 1), 0, rand(-1, 1))), { r: 5.5, secs: 9 });
      }
    }
  }

  // ═════════════════════════════ co-op ═════════════════════════════
  /** [x y z yaw state st hp phase dark seq flash active laneAx laneAz laneBx laneBz stagger] */
  netSnap(): number[] {
    return [this.pos.x, this.pos.y, this.pos.z, this.yaw, STATES.indexOf(this.state), this.st, this.hp, this.phase, this.dark, this.seq % 1000, this.flash > 0.5 ? 1 : 0, this.active ? 1 : 0,
      this.laneA.x, this.laneA.y, this.laneB.x, this.laneB.y, this.stagger, this.dur];
  }
  netApply(a: number[], t?: number) {
    if (t === undefined) return;
    (this.track ??= new NetTrack<number[]>(60, 4)).push(t, a[0], a[1], a[2], a[3], a);
  }
  private fields(a: number[]) {
    const s = STATES[a[4]] ?? 'fly';
    if (s !== this.state || a[9] !== this.seq || !this.got) { this.st = a[5]; this.dur = Math.max(0.001, a[17] ?? 1); }
    this.state = s; this.seq = a[9];
    if (a[6] < this.hp) this.anim.flash = 1;
    this.hp = a[6]; this.phase = a[7]; this.dark = a[8];
    if (a[10]) this.anim.flash = 1;
    this.active = !!a[11];
    this.laneA.set(a[12], a[13]); this.laneB.set(a[14], a[15]);
    this.stagger = a[16];
    this.got = true;
  }
  netEvent(L: Level3D, ev: string, d: { n?: number }) {
    if (L.authority) return;
    if (ev === 'phase') this.phaseFx(d.n ?? 2);
    else if (ev === 'flash') this.moonFlash();
  }
  private puppet(L: Level3D, dt: number) {
    if (this.manual) return;
    this.st += L.nl?.playDt ?? dt;
    const tr = this.track, play = L.nl?.playT ?? -Infinity;
    if (tr && tr.eval(play, dt, pose)) {
      tr.passed(play, (a) => this.fields(a));
      if (this.blendFrom) { this.blend.copy(this.blendFrom).sub(pose.pos); this.blendFrom = null; }
      this.blend.multiplyScalar(Math.exp(-dt / 0.2));
      if (this.blend.lengthSq() < 1e-6) this.blend.set(0, 0, 0);
      this.pos.copy(pose.pos).add(this.blend);
      this.vel.copy(pose.vel);
      this.yaw = pose.yaw;
    }
  }

  // ═════════════════════════════ every machine ═════════════════════════════
  private visuals(L: Level3D, dt: number) {
    const a = this.anim;
    a.flash = Math.max(this.flash, a.flash - dt * 5);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    if (!this.manual) {
      a.st = ANIM[this.state] ?? 'fly';
      a.p = clamp(this.st / this.dur, 0, 1);
    }
    a.speed = this.vel.length();
    a.talk = Math.max(0, a.talk - dt * 3);
    // his eyes glow in the dark (fair: you can follow him) and before a swoop
    a.glow = Math.max(this.darkK * 0.9, this.state === 'tele' ? 1 : 0, 0.25);
    this.rig.update(dt, a);
    const c = this.env.c;
    this.blob.position.set(this.pos.x, c.y + 0.04, this.pos.z);
    this.blob.visible = this.active && !this.dead && Math.hypot(this.pos.x - c.x, this.pos.z - c.z) < this.env.R + 1;
    this.blob.scale.setScalar(this.airborne ? 0.7 : 1);
    // the swoop's lane
    if (this.state === 'tele' || this.state === 'dive') {
      const k = clamp(this.st / this.dur, 0, 1);
      const alpha = this.state === 'tele' ? 0.35 + 0.5 * k + Math.sin(this.t * 30) * 0.1 : 0.55 * (1 - k);
      this.lane.show(L, this.laneA.x, this.laneA.y, this.laneB.x, this.laneB.y, c.y, 2.2, alpha);
    } else this.lane.hide();
    // where he'll come down to snuff
    if (this.state === 'snuff') this.dropMark.show(L, this.pos.x, c.y, this.pos.z, 1.4, 0.4 + 0.3 * Math.sin(this.t * 20));
    else this.dropMark.hide();
    // the dome goes dark (phase 3), flashes of the red moon
    this.darkK = damp(this.darkK, this.dark, 1.2, dt);
    this.flashK = Math.max(0, this.flashK - dt * 2.2);
    this.applyDark(L);
    // the boss bar
    // (a scene that holds him — the defeat — hides it: a client whose puppet hadn't played the fall back yet kept the
    // bar up through the ending and the results)
    if (this.active && !this.dead && !this.manual) { L.hud.bossName = this.name; L.hud.bossHp = this.hp; L.hud.bossMax = this.maxHp; }
    else if (this.dead || this.manual) L.hud.bossMax = 0;
  }

  private applyDark(L: Level3D) {
    const night = vamp(L).night;
    const k = this.darkK * (1 - 0.75 * this.flashK);
    if (!this.base) {
      if (k < 0.001) return;
      this.base = { hemi: L.hemi.intensity, sun: L.sun.intensity, bg: (L.scene.background as THREE.Color).clone(), fog: (night ? night.fogColor : (L.scene.fog as THREE.Fog).color).clone() };
    }
    const b = this.base;
    L.hemi.intensity = b.hemi * (1 - 0.72 * k);
    L.sun.intensity = b.sun * (1 - 0.85 * k);
    (L.scene.background as THREE.Color).copy(b.bg).multiplyScalar(1 - 0.6 * k);
    if (night) night.fogColor.copy(b.fog).multiplyScalar(1 - 0.65 * k);
    else (L.scene.fog as THREE.Fog).color.copy(b.fog).multiplyScalar(1 - 0.65 * k);
    if (k < 0.001 && this.dark === 0) {
      if (night) night.fogColor.copy(b.fog);
      this.base = null;
    }
  }

  /** the scene takes him over: no telegraphs on the floor */
  lanesOff() { this.lane.hide(); this.dropMark.hide(); }

  // ═════════════════════════════ Boss3Like ═════════════════════════════
  faceTarget() { return this.center(); }
  aimTargets() { return this.fighting && this.state !== 'rise' ? [this.center()] : []; }
}

/** co-op host: effects that must reach every machine even outside the captured world tick (my own swing) */
function shared(L: Level3D, f: () => void) { const nl = L.nl; if (nl && nl.isHost && !nl.capturing) nl.capture(f); else f(); }

/** solo help: a syrup glob / a chord wave / Бублик's paw from the rim to the Count */
class HelpShot implements Actor3 {
  dead = false;
  private t = 0;
  private obj = new THREE.Group();
  constructor(private L: Level3D, private from: THREE.Vector3, private boss: Count3, private k: CastKind, private done: () => void) {
    const col = k === 'pastila' ? '#ff3a7a' : k === 'noki' ? '#c070ff' : '#e8a850';
    const m = new THREE.Mesh(new THREE.SphereGeometry(k === 'bublik' ? 0.22 : 0.18, 10, 8), basic(col));
    this.obj.add(m);
    if (k === 'bublik') {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1, 8), basic('#c88a50'));
      arm.name = 'arm';
      this.obj.add(arm);
    }
    noOutline(this.obj);
    L.scene.add(this.obj);
    audio.sfx(k === 'noki' ? 'reflect' : k === 'pastila' ? 'shoot' : 'grab', { pitch: k === 'noki' ? 0.8 : 1.3 });
    if (k === 'noki') L.fx.ring(from.clone().setY(from.y - 1.1), 3, '#c070ff', 0.5);
  }
  update(L: Level3D, dt: number) {
    this.t += dt;
    const k = Math.min(1, this.t / 0.45);
    const to = this.boss.center(v1);
    const p = this.from.clone().lerp(to, k);
    p.y += Math.sin(k * Math.PI) * 1.2;
    const ball = this.obj.children[0];
    ball.position.copy(p);
    const arm = this.obj.getObjectByName('arm');
    if (arm) { const mid = this.from.clone().lerp(p, 0.5); arm.position.copy(mid); arm.scale.set(1, this.from.distanceTo(p), 1); arm.quaternion.setFromUnitVectors(v2.set(0, 1, 0), p.clone().sub(this.from).normalize()); }
    if (Math.random() < 0.6) L.fx.emit(p.clone(), { count: 1, speed: [0.1, 0.5], life: [0.2, 0.4], size: [0.06, 0.12], colors: [this.k === 'noki' ? '#c070ff' : '#ff7aa8', '#ffffff'], drag: 3 });
    if (k >= 1) {
      this.dead = true;
      this.obj.removeFromParent();
      L.fx.stars(to.clone(), 14);
      this.done();
    }
  }
}

// ═════════════════════════════ «зефирные бомбы» ═════════════════════════════
const BOMB_R = 2.2;

function bombRing() {
  const g = new THREE.Group();
  const ringM = basic('#ff7ab0', { additive: true, opacity: 0.85, depthWrite: false });
  const fillM = basic('#ff4a8a', { additive: true, opacity: 0.3, depthWrite: false });
  for (const m of [ringM, fillM]) { m.polygonOffset = true; m.polygonOffsetFactor = -6; }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 40).rotateX(-Math.PI / 2), ringM);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), fillM);
  ring.renderOrder = 4; fill.renderOrder = 3;
  g.add(fill, ring);
  noOutline(g);
  return { g, fill, ringM };
}
function marshModel() {
  const g = new THREE.Group();
  const puff = new THREE.MeshToonMaterial({ color: '#ffe8f2' });
  const pink = new THREE.MeshToonMaterial({ color: '#ff8ab8' });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.5, 18), puff); g.add(body);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.39, 0.06, 8, 20), pink); band.rotation.x = Math.PI / 2; g.add(band);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), puff); top.position.y = 0.25; top.scale.y = 0.5; g.add(top);
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6), new THREE.MeshToonMaterial({ color: '#4a2a3a' })); fuse.position.y = 0.5; g.add(fuse);
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), basic('#ffd34a', { additive: true })); spark.position.y = 0.68; spark.name = 'spark'; g.add(spark);
  return g;
}

/**
 * A marshmallow bomb the Count drops: it falls in an arc to a ring on the floor, fizzes, and goes PUFF (−1 ♥ within
 * 2.2 m). A swing bats it at the Count (a batted bomb that reaches him knocks him down); a pea pops it early.
 * Co-op: the host spawns it on every machine; each copy hurts only its own hero; the host's bat / pop is sent along.
 */
export class MarshBomb implements Actor3, Hittable3, Netted {
  netId = 0;
  netKind = 'f1bomb';
  dead = false;
  pos: THREE.Vector3;
  vel = new THREE.Vector3();
  state: 'fly' | 'fuse' = 'fly';
  batted = false;
  private t = 0; private fuseT = 0.7;
  private g = 18;
  private model = marshModel();
  private ring = bombRing();
  private target: THREE.Vector3;
  constructor(L: Level3D, from: THREE.Vector3, target: THREE.Vector3, T: number) {
    this.pos = from.clone();
    this.target = target.clone();
    this.vel.set((target.x - from.x) / T, (target.y - from.y + 0.5 * this.g * T * T) / T, (target.z - from.z) / T);
    this.model.position.copy(this.pos);
    L.scene.add(this.model, this.ring.g);
    L.actors.push(this); L.hittables.push(this);
    audio.sfx('throw', { pitch: 1.5, volume: 0.5 });
    L.nl?.spawned(this, 'f1bomb', { f: from, t: target, T });
  }
  netEvent(L: Level3D, ev: string, d: { pos?: THREE.Vector3; vel?: THREE.Vector3 }) {
    if (ev === 'bat' && d.pos && d.vel && !this.dead) { this.batted = true; this.state = 'fly'; this.pos.copy(d.pos); this.vel.copy(d.vel); }
    else if ((ev === 'boom' || ev === 'gone') && !this.dead) this.explode(L);
    else if (ev === 'fizzle') this.fizzle(L);
  }
  update(L: Level3D, dt: number) {
    if (this.dead) return;
    this.t += dt;
    if (this.state === 'fly') {
      this.vel.y -= (this.batted ? 4 : this.g) * dt;
      this.pos.addScaledVector(this.vel, dt);
      const boss = L.boss as Count3 | null;
      if (this.batted && boss) {
        if (boss.center(v1).distanceTo(this.pos) < 1.4) {
          if (L.authority) { boss.knock(L, 'bomb'); L.nl?.entEvent(this, 'boom'); }
          this.explode(L);
          return;
        }
        if (this.t > 3) { this.explode(L); return; }
      }
      if (!this.batted && this.vel.y < 0 && this.pos.y <= this.target.y + 0.25) {
        this.pos.y = this.target.y + 0.25;
        this.state = 'fuse'; this.fuseT = 0.7;
        this.vel.set(0, 0, 0);
        audio.sfx('thud', { volume: 0.35, pitch: 1.8 });
        audio.sfx('fuse', { volume: 0.5 });
      }
      if (this.pos.y < L.killY) { this.remove(L); return; }
    } else {
      this.fuseT -= dt;
      if (this.fuseT <= 0) { this.explode(L); return; }
    }
    this.model.position.copy(this.pos);
    this.model.rotation.y += dt * 3;
    this.model.scale.setScalar(this.state === 'fuse' ? 1 + Math.sin(this.t * 30) * 0.06 : 1);
    const spark = this.model.getObjectByName('spark');
    if (spark) spark.visible = Math.sin(this.t * 40) > -0.3;
    const at = this.state === 'fuse' ? this.pos : this.target;
    this.ring.g.visible = !this.batted;
    this.ring.g.position.set(at.x, this.target.y + 0.05, at.z);
    this.ring.g.scale.setScalar(BOMB_R);
    const k = this.state === 'fuse' ? 1 - this.fuseT / 0.7 : clamp(this.t * 0.6, 0, 0.5);
    this.ring.fill.scale.setScalar(Math.max(0.02, k * 0.9 + 0.1));
    this.ring.ringM.opacity = 0.6 + 0.35 * Math.sin(this.t * (this.state === 'fuse' ? 30 : 12));
  }
  explode(L: Level3D) {
    if (this.dead) return;
    const c = this.pos.clone();
    this.remove(L);
    audio.sfx('boom', { pitch: 1.3, volume: 0.8 });
    L.tcam.shake(0.3);
    L.fx.ring(c.clone(), BOMB_R * 1.05, '#ffb0d0', 0.35, false);
    L.fx.emit(c.clone(), { count: 30, speed: [3, 7], life: [0.35, 0.7], size: [0.25, 0.5], size2: 1.6, colors: ['#fff4f8', '#ffd0e4', '#ff8ab8'], g: 3, drag: 3 });
    if (!this.batted) {
      const p = L.player;
      if (!p.dead && p.center().distanceTo(c) < BOMB_R + 0.3) p.hurt(L, 1, c);
    }
  }
  /** host: gone without a blast (the Count is beaten); clients drop theirs too */
  fizzle(L: Level3D) {
    if (this.dead) return;
    L.fx.emit(this.pos.clone(), { count: 10, speed: [1, 2.5], life: [0.25, 0.5], size: [0.12, 0.24], colors: ['#fff4f8', '#ffd0e4'], g: 2, drag: 3 });
    if (L.authority) L.nl?.entEvent(this, 'fizzle');
    this.remove(L);
  }
  private remove(L: Level3D) {
    this.dead = true;
    L.scene.remove(this.model, this.ring.g);
    L.nl?.remove(this);
  }
  meleeHit(L: Level3D, c: THREE.Vector3, _dir: THREE.Vector3, range: number): boolean {
    if (this.dead || this.batted || !L.authority) return false;
    if (v1.copy(this.pos).sub(c).length() > range + 0.6) return false;
    const boss = L.boss as Count3 | null;
    this.batted = true;
    this.state = 'fly';
    this.pos.y += 0.3;
    const to = boss && boss.airborne ? boss.center(v2) : v2.copy(this.pos).add(v1.set(0, 6, 0));
    const T = clamp(this.pos.distanceTo(to) / 16, 0.3, 1.0);
    this.vel.set((to.x - this.pos.x) / T, (to.y - this.pos.y + 0.5 * 4 * T * T) / T, (to.z - this.pos.z) / T);
    audio.sfx('reflect', { pitch: 1.3 });
    L.fx.sparks(this.pos.clone(), 10);
    L.fx.text(this.pos.clone().setY(this.pos.y + 1), 'Отбил!', '#ffe14a', 20);
    L.nl?.entEvent(this, 'bat', { pos: this.pos, vel: this.vel });
    return true;
  }
  predictHit(_L: Level3D, c: THREE.Vector3, range: number) { return !this.dead && !this.batted && this.pos.distanceTo(c) < range + 0.6; }
  shotHit(L: Level3D, s: Shot3): boolean {
    if (this.dead || !L.authority) return false;
    if (s.pos.distanceTo(this.pos) < 0.5 + s.r) { L.nl?.entEvent(this, 'boom'); this.explode(L); return true; }
    return false;
  }
}

NET_SPAWN.f1bomb = (L, a: { f: number[] | THREE.Vector3; t: number[] | THREE.Vector3; T: number }) => {
  const v = (x: number[] | THREE.Vector3) => (x instanceof THREE.Vector3 ? x : toV(x));
  return new MarshBomb(L, v(a.f), v(a.t), a.T);
};

