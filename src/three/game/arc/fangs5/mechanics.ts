import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { rand } from '../../../../engine/util';
import { basic, noOutline } from '../../../gfx';
import { Mats } from '../../../models/kit';
import type { BoxCol, CylCol } from '../../../physics/types';
import type { Level3D, Actor3, Hittable3 } from '../../level';
import type { Netted } from '../../netLevel';
import type { Shot3 } from '../../objects';
import type { Enemy3 } from '../../enemies';
import { vamp, isVamp, ambient, type Lantern } from '../vampires';
import { framedPainting, eyePair, type PaintKind } from './rigs';
import { F5 } from './lines';
import { M as CM } from './castle';

/**
 * Shared puzzles and props of «Замок Полночь» (build-time Netted things — the host decides, everyone sees its state):
 *  • Siege       — the courtyard: four «солнышки» to light while vampires pour over the walls; all four lit at once →
 *                  the portcullis into the keep rises (and the sun burst burns the attackers).
 *  • Candles     — the portrait hall: light the candles under the four lieutenants' portraits in the order of the
 *                  nights (I Нетопырь, II Морок, III Шёпот, IV Близняшки); a wrong one snuffs them all and a portrait
 *                  climbs out of its frame. Solved → the King's portrait at the end of the hall swings open.
 *  • Crumble     — tower steps that crumble under a hero (0.8 s), are gone for a while and grow back.
 *  • PortraitDeco — grey paintings whose eyes follow MY hero (each machine its own: just for looks).
 */

const v = new THREE.Vector3();

// ═════════════════════════════ the siege of the courtyard ═════════════════════════════
export interface SiegeOpts {
  lanterns: Lantern[];
  /** the courtyard (x0, z0, x1, z1): a hero inside starts the siege */
  box: [number, number, number, number];
  /** the portcullis group (raised by gateK) and its collider */
  gate: THREE.Object3D; col: BoxCol;
  /** where the attackers appear (on the walls / by the walls) */
  spawns: [number, number, number][];
  /** grey zone of the courtyard (restored when the siege is won) */
  zone?: string;
}

export class Siege implements Netted, Actor3 {
  netId = 0;
  dead = false;
  state = 0; // 0 waiting, 1 on, 2 won
  private gateK = 0;
  private waveT = 4;
  private litSeen = -1;
  private spawned: Enemy3[] = [];
  private gateY0: number;
  constructor(private L: Level3D, private o: SiegeOpts) {
    this.gateY0 = o.gate.position.y;
    if (L.seen.has('f5_siege')) { this.state = 2; this.gateK = 1; }
    L.nl?.add(this);
    L.actors.push(this);
    this.applyGate();
  }
  get won() { return this.state === 2; }
  netSnap() { return [this.state]; }
  netApply(a: number[]) { if (a[0] > this.state) this.state = a[0]; }
  private inside(p: THREE.Vector3) { const [x0, z0, x1, z1] = this.o.box; return p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1 && p.y < 4; }
  update(L: Level3D, dt: number) {
    if (L.authority && !L.worldCut) this.host(L, dt);
    this.gateK = Math.max(0, Math.min(1, this.gateK + (this.state === 2 ? dt / 2.2 : -dt)));
    this.applyGate();
  }
  private applyGate() {
    const k = this.gateK;
    this.o.gate.position.y = this.gateY0 + k * k * 5.6;
    this.o.col.active = k < 0.6;
  }
  private host(L: Level3D, dt: number) {
    const lan = this.o.lanterns;
    const lit = lan.filter((l) => l.lit).length;
    if (this.state === 0) {
      if (L.alivePlayers().some((h) => this.inside(h.pos))) {
        this.state = 1;
        L.hud.showBanner('ОСАДА!', '#ff5a4a');
        L.toast(F5.toasts.siege);
        L.shout(F5.siegeShout, 2.6); // (v2 §9.2.0: the voice from the moon)
        audio.sfx('warn'); audio.sfx('roar', { pitch: 1.6, volume: 0.4 });
        this.waveT = 6;
      }
      return;
    }
    if (this.state !== 1) return;
    if (lit !== this.litSeen) {
      if (this.litSeen >= 0 && lit > this.litSeen && lit < lan.length) L.toast(F5.toasts.siegeLit(lit));
      this.litSeen = lit;
    }
    if (lit === lan.length) { this.win(L); return; }
    // waves over the walls (fewer while most lanterns burn: the light keeps them off)
    this.spawned = this.spawned.filter((e) => !e.dead);
    const party = L.heroes().length;
    this.waveT -= dt;
    if (this.waveT <= 0 && this.spawned.length < 2 + party) {
      this.waveT = Math.max(8, 14 - party);
      const sp = this.o.spawns;
      const a = sp[Math.floor(rand(0, sp.length))], b = sp[Math.floor(rand(0, sp.length))];
      const add = (kind: 'bat' | 'fanger', p: [number, number, number], dy = 0) => {
        const e = L.spawnEnemy(kind, p[0] + rand(-1, 1), p[1] + dy, p[2] + rand(-1, 1));
        e.spawnT = 0.6; e.provoke(L);
        this.spawned.push(e);
        return e;
      };
      const f = add('fanger', a);
      add('bat', b, 3.5); if (party > 2) add('bat', b, 3.8);
      L.bark(f.root, F5.guardBarks[Math.floor(rand(0, F5.guardBarks.length))], 1.6, 1.6);
      audio.sfx('batScreech', { volume: 0.35 });
    }
  }
  private win(L: Level3D) {
    this.state = 2;
    L.seen.add('f5_siege');
    L.hud.showBanner('ВСЕ СОЛНЫШКИ ГОРЯТ!', '#ffd34a');
    L.toast(F5.toasts.siegeDone);
    L.shout(F5.siegeWonShout, 2.4);
    audio.sfx('victory', { volume: 0.6 }); audio.sfx('door', { pitch: 0.6 });
    L.tcam.shake(0.4);
    // the sunburst: every vampire in the courtyard burns away
    for (const e of [...L.enemies]) if (!e.dead && isVamp(e) && this.inside(e.body.pos)) e.hurt(L, 99, e.center(v).clone(), 'sun');
    if (this.o.zone) vamp(L).restoreZone(this.o.zone);
  }
}

// ═════════════════════════════ the candles of the portrait hall ═════════════════════════════
class Candelabrum implements Hittable3 {
  dead = false;
  lit = false;
  group = new THREE.Group();
  private flames: THREE.Mesh[] = [];
  private glow: THREE.Sprite;
  private k = 0;
  constructor(L: Level3D, readonly pos: THREE.Vector3, readonly i: number, private onHit: (i: number) => void) {
    const iron = CM.iron(), wax = new THREE.MeshToonMaterial({ color: '#f4ecd8' });
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.5, 8), iron); stand.position.y = 0.75; this.group.add(stand);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.12, 12), iron); foot.position.y = 0.06; this.group.add(foot);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.07, 0.07), iron); bar.position.y = 1.5; this.group.add(bar);
    for (const x of [-0.42, 0, 0.42]) {
      const h = x === 0 ? 0.42 : 0.32;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, h, 8), wax); c.position.set(x, 1.54 + h / 2, 0); this.group.add(c);
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 8), basic('#ffb040')); f.position.set(x, 1.54 + h + 0.1, 0); noOutline(f);
      this.group.add(f); this.flames.push(f);
    }
    for (const m of [stand, foot, bar]) { m.castShadow = true; }
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#ffb050', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.scale.setScalar(1.8); this.glow.position.y = 2.1; noOutline(this.glow);
    this.group.add(this.glow);
    this.group.position.copy(pos);
    L.scene.add(this.group);
    L.col({ kind: 'cyl', x: pos.x, z: pos.z, r: 0.18, y0: pos.y, y1: pos.y + 1.6 });
    L.hittables.push(this);
    this.set(false);
  }
  set(lit: boolean) { this.lit = lit; }
  update(dt: number, t: number) {
    this.k += ((this.lit ? 1 : 0) - this.k) * Math.min(1, dt * 8);
    this.flames.forEach((f, i) => { f.visible = this.k > 0.05; f.scale.set(this.k, this.k * (1 + Math.sin(t * 14 + i * 2) * 0.15), this.k); });
    (this.glow.material as THREE.SpriteMaterial).opacity = this.k * 0.6;
  }
  private near(c: THREE.Vector3, range: number) { return Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < range + 0.4 && c.y > this.pos.y - 0.5 && c.y < this.pos.y + 2.6; }
  meleeHit(L: Level3D, c: THREE.Vector3, _dir: THREE.Vector3, range: number): boolean {
    if (!this.near(c, range)) return false;
    if (L.authority) this.onHit(this.i);
    return true;
  }
  predictHit(_L: Level3D, c: THREE.Vector3, range: number) { return this.near(c, range); }
  shotHit(L: Level3D, s: Shot3): boolean {
    if (Math.hypot(s.pos.x - this.pos.x, s.pos.z - this.pos.z) > 0.6 || s.pos.y < this.pos.y + 1.2 || s.pos.y > this.pos.y + 2.3) return false;
    if (L.authority) this.onHit(this.i);
    return true;
  }
}

export interface CandlesOpts {
  /** candelabra in the order they must be lit (I … IV) */
  at: THREE.Vector3[];
  /** the King's portrait (a door): its hinge group (swings round y) and collider */
  door: THREE.Object3D; col: BoxCol;
  /** where a punishing portrait comes out of the wall: [x, y, z, yaw] */
  wallSpots: [number, number, number, number][];
}

export class Candles implements Netted, Actor3 {
  netId = 0;
  dead = false;
  /** how many are lit in order (4 = solved) */
  n = 0;
  private cands: Candelabrum[];
  private cool = 0;
  private openK = 0;
  private wrongSeq = 0;
  private punished: Enemy3[] = [];
  constructor(private L: Level3D, private o: CandlesOpts) {
    this.cands = o.at.map((p, i) => new Candelabrum(L, p, i, (k) => this.hit(k)));
    if (L.seen.has('f5_candles')) { this.n = 4; this.openK = 1; }
    this.show();
    L.nl?.add(this);
    L.actors.push(this);
  }
  get solved() { return this.n >= 4; }
  netSnap() { return [this.n, this.wrongSeq]; }
  netApply(a: number[]) {
    if (a[1] !== this.wrongSeq) { this.wrongSeq = a[1]; this.wrongFx(); }
    this.n = a[0]; this.show();
  }
  private show() { this.cands.forEach((c, i) => c.set(i < this.n)); }
  private hit(i: number) {
    const L = this.L;
    if (this.solved || this.cool > 0 || this.cands[i].lit) return;
    if (i === this.n) {
      this.n++;
      this.show();
      ambient(L, () => { audio.sfx('lanternOn'); L.fx.stars(this.cands[i].pos.clone().setY(this.cands[i].pos.y + 2), 16); });
      L.nl?.entEvent(this, 'lit', { i });
      if (this.solved) {
        L.seen.add('f5_candles');
        L.hud.showBanner('ПОРТРЕТ ОТВОРИЛСЯ!', '#ffd34a');
        L.toast(F5.toasts.puzzleDone);
        audio.sfx('door', { pitch: 0.7 }); audio.sfx('victory', { volume: 0.5 });
      } else L.toast(F5.toasts.puzzleGood(this.n));
      return;
    }
    // wrong: all out, a portrait climbs out of its frame
    this.n = 0; this.cool = 1.2; this.wrongSeq++;
    this.show();
    this.wrongFx();
    L.nl?.entEvent(this, 'wrong', {});
    L.toast(F5.toasts.puzzleWrong);
    this.punished = this.punished.filter((e) => !e.dead);
    if (this.punished.length < 1 + Math.floor(L.heroes().length / 2)) {
      const s = this.o.wallSpots[Math.floor(rand(0, this.o.wallSpots.length))];
      const e = L.spawnEnemy('portrait', s[0], s[1], s[2], { yaw: s[3], wake: 0 });
      e.provoke(L);
      this.punished.push(e);
    }
  }
  private wrongFx() {
    const L = this.L;
    ambient(L, () => {
      audio.sfx('snuff'); audio.sfx('hiss', { pitch: 0.6, volume: 0.6 });
      for (const c of this.cands) L.fx.emit(c.pos.clone().setY(c.pos.y + 2), { count: 10, speed: [0.4, 1.4], dir: new THREE.Vector3(0, 1, 0), spread: 0.5, life: [0.6, 1.1], size: [0.15, 0.3], size2: 2, colors: ['#5a5868', '#8a8698'], g: -1.5, drag: 2 });
    });
  }
  netEvent(L: Level3D, ev: string) {
    if (L.authority) return;
    if (ev === 'lit') ambient(L, () => audio.sfx('lanternOn'));
  }
  update(L: Level3D, dt: number) {
    this.cool -= dt;
    for (const c of this.cands) c.update(dt, L.t);
    this.openK = Math.max(0, Math.min(1, this.openK + (this.solved ? dt / 1.8 : -dt)));
    const k = this.openK;
    this.o.door.rotation.y = -k * k * (3 - 2 * k) * 1.75;
    this.o.col.active = k < 0.5;
  }
}

// ═════════════════════════════ crumbling steps ═════════════════════════════
interface Step { col: CylCol; obj: THREE.Object3D; base: THREE.Vector3; st: number; t: number; fallV: number }
const SHAKE = 0.8, GONE = 4.5, REFORM = 0.5;

export class Crumble implements Netted, Actor3 {
  netId = 0;
  dead = false;
  steps: Step[] = [];
  private warned = false;
  constructor(private L: Level3D) {
    L.nl?.add(this);
    L.actors.push(this);
  }
  /** a step: its collider (tagged 'moving' — never a safe spot) and its mesh group */
  add(col: CylCol, obj: THREE.Object3D) {
    col.tag = 'moving';
    this.steps.push({ col, obj, base: obj.position.clone(), st: 0, t: 0, fallV: 0 });
  }
  netSnap() { const o: number[] = []; for (const s of this.steps) o.push(s.st, Math.round(s.t * 10) / 10); return o; }
  netApply(a: number[]) {
    this.steps.forEach((s, i) => {
      const st = a[i * 2], t = a[i * 2 + 1];
      if (st === undefined) return;
      if (st !== s.st) { this.enter(s, st); }
      s.t = t;
    });
  }
  private enter(s: Step, st: number) {
    const L = this.L;
    s.st = st;
    if (st === 1) { s.t = SHAKE; ambient(L, () => audio.sfx('crumble', { volume: 0.5 })); }
    else if (st === 2) { s.t = GONE; s.fallV = 0; ambient(L, () => { audio.sfx('break', { volume: 0.5, pitch: 0.8 }); L.fx.chunks(s.base.clone(), 14, ['#6e6484', '#4a4058', '#8a809c'], s.base.y - 30, [0.1, 0.22]); }); }
    else if (st === 3) { s.t = REFORM; ambient(L, () => L.fx.dust(s.base.clone().setY(s.col.y1), 8, '#c8b8e0')); }
    else s.t = 0;
  }
  private standing(s: Step) {
    for (const h of this.L.heroes()) {
      if (h.dead) continue;
      const p = h.pos;
      if (Math.hypot(p.x - s.col.x, p.z - s.col.z) < s.col.r + 0.2 && p.y > s.col.y1 - 0.2 && p.y < s.col.y1 + 0.35) return true;
    }
    return false;
  }
  update(L: Level3D, dt: number) {
    for (const s of this.steps) {
      if (L.authority) {
        if (s.st === 0 && this.standing(s)) {
          this.enter(s, 1);
          if (!this.warned) { this.warned = true; L.hint('f5steps', F5.toasts.steps); }
        } else if (s.st !== 0) {
          s.t -= dt;
          if (s.t <= 0) {
            if (s.st === 1) this.enter(s, 2);
            else if (s.st === 2) { if (!this.standingIn(s)) this.enter(s, 3); else s.t = 0.5; }
            else if (s.st === 3) this.enter(s, 0);
          }
        }
      } else if (s.st !== 0) s.t = Math.max(0, s.t - dt);
      // every machine: the look and the collider
      s.col.active = s.st === 0 || s.st === 1 || (s.st === 3 && s.t < REFORM * 0.5);
      const o = s.obj;
      if (s.st === 1) { o.visible = true; o.position.set(s.base.x + Math.sin(L.t * 60) * 0.05 * (1 - s.t / SHAKE + 0.3), s.base.y, s.base.z); o.scale.setScalar(1); }
      else if (s.st === 2) {
        s.fallV += 30 * dt;
        const y = o.position.y - s.fallV * dt;
        o.position.set(s.base.x, Math.max(s.base.y - 40, y), s.base.z);
        o.visible = s.base.y - o.position.y < 25;
      } else if (s.st === 3) { o.visible = true; o.position.copy(s.base); o.scale.setScalar(Math.max(0.05, 1 - s.t / REFORM)); }
      else { o.visible = true; o.position.copy(s.base); o.scale.setScalar(1); }
    }
  }
  private standingIn(s: Step) {
    for (const h of this.L.heroes()) if (!h.dead && Math.hypot(h.pos.x - s.col.x, h.pos.z - s.col.z) < s.col.r + 0.4 && Math.abs(h.pos.y - s.col.y1) < 1.6) return true;
    return false;
  }
}

// ═════════════════════════════ portraits whose eyes follow you ═════════════════════════════
export function portraitDeco(L: Level3D, kind: PaintKind, x: number, y: number, z: number, ry: number, o: { w?: number; h?: number; plaque?: string } = {}) {
  const M = new Mats();
  const w = o.w ?? 1.6, h = o.h ?? 2.1;
  const root = new THREE.Group();
  const fr = framedPainting(root, M, kind, w, h, '#a8843a');
  // (the eyes sit where the painted ones are: the frog's on top of her head, the sisters' far apart)
  const ey = kind === 'sisters' ? 0.49 : kind === 'frog' ? 0.31 : 0.42;
  const edx = kind === 'twins' ? 0.42 : kind === 'sisters' ? 0.39 * (w / 2.1) : kind === 'frog' ? 0.19 * (w / 1.6) : Math.min(0.24, 0.16 * (w / 1.6));
  const eyes = eyePair(fr.g, 0, h * (1 - ey), 0.04, edx, Math.min(0.11, 0.085 * (w / 1.6)));
  root.position.set(x, y, z);
  root.rotation.y = ry;
  L.scene.add(root);
  if (o.plaque) L.signAt(x + Math.sin(ry) * 1.2, y - 2.2, z + Math.cos(ry) * 1.2, o.plaque);
  const head = new THREE.Vector3();
  L.updaters.push(() => {
    const p = L.player;
    if (p.pos.distanceTo(root.position) > 30) return;
    head.copy(p.pos).setY(p.pos.y + 1);
    eyes.look(head);
  });
  return { root, canvas: fr.canvas, M };
}
