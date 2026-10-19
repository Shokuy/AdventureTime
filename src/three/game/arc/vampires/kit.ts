import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { rand } from '../../../../engine/util';
import { net } from '../../../../net/session';
import { text } from '../../../../art/draw';
import { W } from '../../../../engine/util';
import { mat, matU, basic, noOutline } from '../../../gfx';
import { glowTex } from '../../../world/textures';
import { G, TAU, clamp, damp, cached } from '../../../models/kit';
import type { Level3D, HeroLike, LevelPlugin } from '../../level';
import type { Netted } from '../../netLevel';
import type { Shot3 } from '../../objects';
import type { Enemy3 } from '../../enemies';
import { gzZ, gzP, gzI, GZ_MAX, markCharacter, greyHandle, hasNewMats } from './greyShader';
import { ambient, discTex } from './fxUtil';
import { NightCtl, MoonCtl, type NightOpts, type MoonOpts } from './night';

/**
 * «Вампирский набор» — one VampKit per level (`vamp(L)`), the shared machinery of «Ночь клыков»:
 *  • colour of the world: grey zones (greyZone / restoreZone), fog washed out inside them;
 *  • light vs vampires: «солнышко» lanterns (lantern), temporary lights (light — Пастила's beacon), sunAt();
 *  • night look + moon (night / moon);
 *  • the «пресный» bite debuff (bland), Ноки's chord (chord), reveals of the invisible, the bats' alarm;
 *  • townsfolk / zone events (onRestore / onZone) and a «Расколдовано N из M» counter.
 * Co-op: the host decides (zones, lanterns, lights, bites…); zones and lanterns are build-time Netted things (state in
 * the host's snapshots), the kit itself has a fixed net id (KIT_NET_ID) so its events reach every machine even when the
 * kit is created later on one of them. Calls made on a client that change the world are sent to the host.
 */

export const KIT_NET_ID = 99001;
/** real PointLights for lanterns (the rest glow without one); +2 pooled for temporary lights */
const MAX_REAL_LIGHTS = 6;
const TEMP_LIGHTS = 2;

const v1 = new THREE.Vector3();

/** what the kit needs from a vampire (vampires.ts) */
export interface VampLike extends Enemy3 {
  readonly vampire: true;
  alert(L: Level3D, target: HeroLike): void;
  stunFor(L: Level3D, secs: number): void;
  reveal?(secs: number): void;
}
/** what the kit needs from a townsperson (townsfolk.ts) */
export interface FolkLike extends Enemy3 {
  readonly folk: true;
  restore(L: Level3D, by?: string | null): void;
}
export const isVamp = (e: Enemy3): e is VampLike => (e as Partial<VampLike>).vampire === true;
export const isFolk = (e: Enemy3): e is FolkLike => (e as Partial<FolkLike>).folk === true;

type V3 = THREE.Vector3 | [number, number, number];
const vec = (a: V3) => (a instanceof THREE.Vector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]));
const heroRoot = (h: HeroLike) => (h as unknown as { root?: THREE.Object3D }).root ?? null;
/** a hero's member id (mine: net.myId) */
export const heroId = (h: HeroLike) => (h.isLocal ? net.myId : (h as unknown as { id: string }).id);

// ═════════════════════════════ GREY ZONES ═════════════════════════════
export type ZoneState = 'grey' | 'restoring' | 'done';
export interface ZoneOpts {
  /** soft edge width (m, default 5) */
  edge?: number;
  /** 'clear' (default): restores itself when the vampires that live in it are beaten and its townsfolk restored */
  auto?: 'clear' | 'none';
  /** how grey (0..1, default 1) */
  amount?: number;
}

export class GreyZone implements Netted {
  netId = 0;
  netKind = 'vgz';
  state: ZoneState = 'grey';
  amount: number;
  front = -100;
  glow = 0;
  private t = 0;
  /** host, auto 'clear': how many members it had (0 = never auto-restores) */
  members = -1;
  constructor(private kit: VampKit, readonly id: string, readonly center: THREE.Vector3, readonly radius: number, readonly o: ZoneOpts) {
    this.amount = o.amount ?? 1;
  }
  get edge() { return this.o.edge ?? 5; }
  get done() { return this.state === 'done'; }
  netSnap() { return [this.state === 'grey' ? 0 : 1]; }
  netApply(a: number[]) { if (a[0] && this.state === 'grey') this.kit.restoreZone(this.id, true); }
  /** greyness at a point (0..1) */
  at(p: THREE.Vector3) {
    if (this.amount <= 0) return 0;
    const d = Math.hypot(p.x - this.center.x, p.z - this.center.z);
    let k = 1 - smooth(this.radius - this.edge, this.radius, d);
    if (this.front >= 0) k *= smooth(this.front - 1.2, this.front + 1.2, d);
    return k * this.amount;
  }
  start() { if (this.state !== 'grey') return; this.state = 'restoring'; this.t = 0; this.front = 0; }
  update(dt: number) {
    if (this.state !== 'restoring') return;
    this.t += dt;
    const R = this.radius + this.edge;
    const dur = clamp(R / 7, 1.6, 4.5);
    this.front = (this.t / dur) * R;
    this.glow = Math.min(1, this.t * 3) * (1 - smooth(dur * 0.85, dur + 0.5, this.t));
    if (this.t > dur) this.amount = Math.max(0, this.amount - dt * 2.5);
    if (this.t > dur + 0.5 && this.amount <= 0) { this.state = 'done'; this.front = -100; this.glow = 0; this.amount = 0; }
  }
  finish() { this.state = 'done'; this.amount = 0; this.front = -100; this.glow = 0; }
}
function smooth(a: number, b: number, x: number) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

// ═════════════════════════════ LANTERNS («солнышки») ═════════════════════════════
export interface LanternOpts {
  /** starts lit (default true) */
  lit?: boolean;
  /** light radius on the ground: vampires keep out, are weakened and seen inside (m, default 5.5) */
  r?: number;
  /** a hero's hit / pea lights it again when it's out (default true) */
  relight?: boolean;
  /** a real PointLight (default true; at most 6 per level, the rest only glow) */
  light?: boolean;
  /** post height (default 2.4) */
  h?: number;
}

const POST_M = () => mat('#ff7aa8');
const POST_W = () => mat('#fff1f6');

export class Lantern implements Netted {
  netId = 0;
  netKind = 'vlant';
  dead = false;
  lit: boolean;
  readonly pos: THREE.Vector3;
  readonly r: number;
  readonly relight: boolean;
  readonly head: THREE.Vector3;
  obj = new THREE.Group();
  private globe: THREE.Mesh;
  private globeM: THREE.MeshToonMaterial;
  private rayM: THREE.MeshToonMaterial;
  private sun = new THREE.Group();
  private faceOn: THREE.Object3D[] = [];
  private faceOff: THREE.Object3D[] = [];
  private glow: THREE.Sprite;
  private pool: THREE.Mesh;
  light: THREE.PointLight | null = null;
  private k = 1;
  private t = rand(0, 5);
  constructor(private kit: VampKit, x: number, y: number, z: number, o: LanternOpts, realLight: boolean) {
    this.lit = o.lit ?? true;
    this.r = o.r ?? 5.5;
    this.relight = o.relight ?? true;
    this.pos = new THREE.Vector3(x, y, z);
    const H = o.h ?? 2.4;
    this.head = new THREE.Vector3(x, y + H + 0.3, z);
    const L = kit.L;
    // candy-cane post on a little plinth
    const post = new THREE.Group();
    const segs = 8, seg = H / segs;
    for (let i = 0; i < segs; i++) {
      const m = new THREE.Mesh(G.cyl(), i % 2 ? POST_W() : POST_M());
      m.position.set(0, seg * (i + 0.5), 0); m.scale.set(0.085, seg, 0.085); m.castShadow = true; m.receiveShadow = true;
      post.add(m);
    }
    const plinth = new THREE.Mesh(G.cyl(), mat('#6a4a7a'));
    plinth.position.y = 0.12; plinth.scale.set(0.2, 0.24, 0.2); plinth.castShadow = true;
    post.add(plinth);
    const cup = new THREE.Mesh(G.cone(), mat('#6a4a7a'));
    cup.position.y = H + 0.02; cup.scale.set(0.2, 0.18, 0.2); cup.rotation.x = Math.PI;
    post.add(cup);
    this.obj.add(post);
    // the sun globe with a face and rays
    this.globeM = matU('#ffd34a', { emissive: '#ffa818', emissiveIntensity: 0.9 });
    this.rayM = matU('#ffb02a', { emissive: '#ff8a10', emissiveIntensity: 0.7 });
    this.sun.position.set(0, H + 0.3, 0);
    this.globe = new THREE.Mesh(G.sphere(), this.globeM);
    this.globe.scale.setScalar(0.3); this.globe.castShadow = false;
    this.sun.add(this.globe);
    const rayGeo = cached('vlant-ray', () => new THREE.ConeGeometry(0.07, 0.2, 8).translate(0, 0.42, 0));
    for (let i = 0; i < 10; i++) {
      const r = new THREE.Mesh(rayGeo, this.rayM);
      r.rotation.z = (i / 10) * TAU; r.castShadow = false;
      this.sun.add(r);
    }
    const black = basic('#2a1408');
    for (const side of [1, -1]) {
      const f = new THREE.Group(); f.rotation.y = side > 0 ? 0 : Math.PI;
      for (const s of [1, -1]) {
        const e = new THREE.Mesh(G.ball(), black); e.position.set(s * 0.1, 0.06, 0.27); e.scale.set(0.035, 0.05, 0.02); f.add(e); this.faceOn.push(e);
        const c = new THREE.Mesh(G.arc(0.045, 0.012, Math.PI), black); c.position.set(s * 0.1, 0.04, 0.275); c.rotation.z = Math.PI; f.add(c); this.faceOff.push(c);
      }
      const sm = new THREE.Mesh(G.arc(0.08, 0.016, Math.PI), black); sm.position.set(0, -0.06, 0.28); sm.rotation.z = Math.PI; f.add(sm);
      noOutline(f);
      this.sun.add(f);
    }
    this.obj.add(this.sun);
    const sm = new THREE.SpriteMaterial({ map: glowTex(), color: '#ffc860', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 });
    this.glow = new THREE.Sprite(sm);
    this.glow.scale.setScalar(2.4); this.glow.position.copy(this.sun.position);
    noOutline(this.glow);
    this.obj.add(this.glow);
    // the light pool on the ground = the safe circle
    const pm = basic('#ffcf70', { additive: true, transparent: true, opacity: 0.22, depthWrite: false, map: discTex() });
    pm.polygonOffset = true; pm.polygonOffsetFactor = -3;
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), pm);
    this.pool.scale.set(this.r, 1, this.r);
    this.pool.renderOrder = 2;
    noOutline(this.pool);
    if (realLight) {
      this.light = new THREE.PointLight('#ffc870', 22, this.r * 2.6, 1.6);
      this.light.position.copy(this.sun.position);
      this.obj.add(this.light);
    }
    this.obj.position.copy(this.pos);
    L.scene.add(this.obj);
    const gy = L.phys.groundAt(x, z, y + 0.5, 0.1);
    this.pool.position.set(x, (gy > -1e8 ? gy : y) + 0.04, z);
    L.scene.add(this.pool);
    L.col({ kind: 'cyl', x, z, r: 0.14, y0: y, y1: y + H + 0.1 });
    this.k = this.lit ? 1 : 0;
    this.look();
  }
  netSnap() { return [this.lit ? 1 : 0]; }
  netApply(a: number[]) { if (!!a[0] !== this.lit) this.set(!!a[0], true); }
  /** strength of this light at a point (0..1) */
  at(p: THREE.Vector3) {
    if (!this.lit || this.k < 0.5) return 0;
    const dy = p.y - this.pos.y;
    if (dy < -2 || dy > 6) return 0;
    return 1 - smooth(this.r * 0.75, this.r, Math.hypot(p.x - this.pos.x, p.z - this.pos.z));
  }
  /** light / put out (host decides; clients follow the snapshots) */
  set(lit: boolean, fx = true) {
    if (lit === this.lit) return;
    this.lit = lit;
    const L = this.kit.L;
    if (!fx) return;
    // (every machine plays it when it sees the change — never captured / re-sent)
    ambient(L, () => {
      if (lit) {
        L.fx.stars(this.head.clone(), 24, ['#ffe14a', '#fff3c0', '#ffffff']);
        L.fx.ring(this.pos.clone().setY(this.pool.position.y + 0.05), this.r, '#ffd060', 0.5);
        audio.sfx('lanternOn');
      } else {
        L.fx.emit(this.head.clone(), { count: 16, speed: [0.5, 1.6], dir: new THREE.Vector3(0, 1, 0), spread: 0.5, life: [0.6, 1.2], size: [0.2, 0.4], size2: 2, colors: ['#5a5868', '#8a8698'], g: -1.5, drag: 2 });
        audio.sfx('snuff');
      }
    });
  }
  /** host: vampires / bosses put it out */
  snuff() { if (this.kit.L.authority) this.set(false); }
  /** Hittable3: a hero's swing relights it (host resolves swings) */
  meleeHit(L: Level3D, c: THREE.Vector3, _dir: THREE.Vector3, range: number): boolean {
    if (this.lit || !this.relight) return false;
    if (Math.hypot(c.x - this.pos.x, c.z - this.pos.z) > range + 0.35 || c.y < this.pos.y - 1 || c.y > this.head.y + 1.2) return false;
    if (L.authority) { this.set(true); L.hint('lantern', 'Солнышко зажглось! В его свете вампиры слабеют и не суются в круг'); }
    return true;
  }
  predictHit(_L: Level3D, c: THREE.Vector3, range: number): boolean {
    return !this.lit && this.relight && Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < range + 0.35 && c.y > this.pos.y - 1 && c.y < this.head.y + 1.2;
  }
  shotHit(L: Level3D, s: Shot3): boolean {
    if (this.lit || !this.relight || s.pos.distanceTo(this.head) > 0.6) return false;
    if (L.authority) this.set(true);
    return true;
  }
  update(dt: number) {
    this.t += dt;
    this.k = damp(this.k, this.lit ? 1 : 0, 8, dt);
    this.sun.rotation.y += dt * 0.5;
    this.sun.scale.setScalar(1 + Math.sin(this.t * 2.2) * 0.03 * this.k);
    this.look();
  }
  private look() {
    const k = this.k;
    this.globeM.color.set('#8c90aa').lerp(v3c.set('#ffd34a'), k);
    this.globeM.emissive.set('#ffa818').multiplyScalar(0.9 * k);
    this.rayM.color.set('#7a7f96').lerp(v3c.set('#ffb02a'), k);
    this.rayM.emissive.set('#ff8a10').multiplyScalar(0.7 * k);
    (this.glow.material as THREE.SpriteMaterial).opacity = 0.8 * k * (0.9 + 0.1 * Math.sin(this.t * 5));
    this.glow.visible = k > 0.02;
    (this.pool.material as THREE.MeshBasicMaterial).opacity = 0.22 * k * (0.9 + 0.1 * Math.sin(this.t * 2.5));
    this.pool.visible = k > 0.02;
    if (this.light) this.light.intensity = 22 * k * (0.92 + 0.08 * Math.sin(this.t * 7.3));
    const on = k > 0.5;
    for (const o of this.faceOn) o.visible = on;
    for (const o of this.faceOff) o.visible = !on;
  }
}
const v3c = new THREE.Color();

/** a temporary light (Пастила's beacon, a burst of sunshine from a script) */
export class TempLight {
  obj = new THREE.Group();
  t = 0;
  dead = false;
  private pool: THREE.Mesh;
  private glow: THREE.Sprite;
  private orbM: THREE.MeshToonMaterial;
  constructor(private kit: VampKit, readonly pos: THREE.Vector3, readonly r: number, readonly life: number, public light: THREE.PointLight | null) {
    const L = kit.L;
    this.orbM = matU('#fff0a0', { emissive: '#ffc020', emissiveIntensity: 1 });
    const orb = new THREE.Mesh(G.sphere(), this.orbM); orb.scale.setScalar(0.32); orb.castShadow = false;
    this.obj.add(orb);
    const rm = matU('#ffd04a', { emissive: '#ffa010', emissiveIntensity: 0.9 });
    const rayGeo = cached('vlant-ray', () => new THREE.ConeGeometry(0.07, 0.2, 8).translate(0, 0.42, 0));
    for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(rayGeo, rm); m.rotation.z = (i / 12) * TAU; m.castShadow = false; this.obj.add(m); }
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ffe080', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.glow.scale.setScalar(3.4);
    this.obj.add(this.glow);
    noOutline(this.obj);
    this.obj.position.copy(pos).setY(pos.y + 1.6);
    L.scene.add(this.obj);
    const pm = basic('#ffe08a', { additive: true, transparent: true, opacity: 0.3, depthWrite: false, map: discTex() });
    pm.polygonOffset = true; pm.polygonOffsetFactor = -3;
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), pm);
    const gy = L.phys.groundAt(pos.x, pos.z, pos.y + 0.6, 0.1);
    this.pool.position.set(pos.x, (gy > -1e8 ? gy : pos.y) + 0.05, pos.z);
    this.pool.renderOrder = 2;
    noOutline(this.pool);
    L.scene.add(this.pool);
    if (this.light) this.light.position.copy(this.obj.position);
    ambient(L, () => { L.fx.stars(this.obj.position.clone(), 30, ['#fff3a0', '#ffffff', '#ffd040']); L.fx.ring(this.pool.position.clone(), r, '#ffe080', 0.5); audio.sfx('lanternOn', { pitch: 1.25 }); });
  }
  /** 0..1 strength now (fades in / out) */
  get k() { return Math.min(1, this.t * 4) * Math.min(1, (this.life - this.t) / 0.8); }
  at(p: THREE.Vector3) {
    const k = this.k;
    if (k < 0.3) return 0;
    const dy = p.y - this.pos.y;
    if (dy < -2 || dy > 6) return 0;
    return 1 - smooth(this.r * 0.75, this.r, Math.hypot(p.x - this.pos.x, p.z - this.pos.z));
  }
  update(dt: number) {
    this.t += dt;
    const k = Math.max(0, this.k);
    this.obj.scale.setScalar(0.3 + 0.7 * k);
    this.obj.lookAt(this.kit.L.tcam.cam.position);
    this.obj.rotateZ(this.t * 0.8);
    (this.pool.material as THREE.MeshBasicMaterial).opacity = 0.3 * k;
    this.pool.scale.set(this.r * (0.6 + 0.4 * Math.min(1, this.t * 3)), 1, this.r * (0.6 + 0.4 * Math.min(1, this.t * 3)));
    (this.glow.material as THREE.SpriteMaterial).opacity = 0.85 * k;
    if (this.light) this.light.intensity = 30 * k;
    if (this.t >= this.life) this.dispose();
  }
  dispose() {
    if (this.dead) return;
    this.dead = true;
    this.obj.removeFromParent(); this.pool.removeFromParent();
    if (this.light) this.light.intensity = 0; // pooled: stays in the scene (no light-count change → no recompiles)
  }
}

// ═════════════════════════════ THE KIT ═════════════════════════════
export interface LightOpts { r?: number; secs?: number }

export class VampKit implements Netted {
  netId = 0;
  netKind = 'vkit';
  zones: GreyZone[] = [];
  lanterns: Lantern[] = [];
  temps: TempLight[] = [];
  dust: { c: THREE.Vector3; r: number }[] = [];
  /** something of the kit is used in this level */
  active = false;
  night: NightCtl | null = null;
  moonCtl: MoonCtl | null = null;
  /** my hero is «пресный» for this many seconds */
  blandT = 0;
  /** townsfolk restored here / placed at build (the HUD counter) */
  restoredN = 0;
  folkTotal = 0;
  private pool: THREE.PointLight[] = [];
  private realLights = 0;
  private markT = 0;
  private grey = new Map<HeroLike, { t: number; k: number; set: (k: number) => void; dripT: number }>();
  private restoreCbs: ((folk: FolkLike, by: string | null) => void)[] = [];
  private zoneCbs: ((id: string) => void)[] = [];
  private fogBase = new THREE.Color();
  private fogSet = new THREE.Color(-1, -1, -1);
  private fogK = 0;
  private autoT = 0;
  private moveHooked = false;
  private hudK = 0; private hudT = 9;

  constructor(readonly L: Level3D) {
    L.nl?.add(this, KIT_NET_ID);
  }

  /** first use in this level: shader / fog / light pool / hero marking (idempotent) */
  activate() {
    if (this.active) return;
    this.active = true;
    const L = this.L, scene = L.scene;
    const prevB = scene.onBeforeRender, prevA = scene.onAfterRender;
    scene.onBeforeRender = (...a) => { prevB.apply(scene, a); this.writeZones(); };
    scene.onAfterRender = (...a) => { prevA.apply(scene, a); gzI[0] = 0; };
    // pooled lights for temporary lights (only while the level is built: the light count must never change later)
    if (L.building) for (let i = 0; i < TEMP_LIGHTS; i++) { const p = new THREE.PointLight('#ffe08a', 0, 14, 1.5); scene.add(p); this.pool.push(p); }
    // «пресный»: my hero's steps get shorter (the move is scaled, the controls aren't touched)
    if (!this.moveHooked) {
      this.moveHooked = true;
      const phys = L.phys, orig = phys.move.bind(phys);
      phys.move = (b, dt) => {
        if (this.blandT > 0 && b === L.player.body) {
          const k = 0.55;
          b.vel.x *= k; b.vel.z *= k;
          try { orig(b, dt); } finally { b.vel.x /= k; b.vel.z /= k; }
          return;
        }
        orig(b, dt);
      };
    }
  }

  // ───────────────────────── colour of the world ─────────────────────────
  /** a grey region (build time): its colour comes back with restoreZone(id) — or by itself (auto 'clear') */
  greyZone(id: string, at: V3, radius: number, o: ZoneOpts = {}): GreyZone {
    this.activate();
    const z = new GreyZone(this, id, vec(at), radius, o);
    if (this.L.seen.has('gz:' + id)) z.finish();
    this.zones.push(z);
    if (this.L.building) this.L.nl?.add(z);
    else console.warn('[vamp] greyZone outside the level build: not replicated', id);
    return z;
  }
  zone(id: string) { return this.zones.find((z) => z.id === id) ?? null; }
  /** host / solo: bring the colour back (everyone sees the wave); a client's call is ignored (the host decides) */
  restoreZone(id: string, fromNet = false) {
    const z = this.zone(id);
    if (!z || z.state !== 'grey') return;
    if (!fromNet && !this.L.authority) return;
    z.start();
    this.L.seen.add('gz:' + id);
    ambient(this.L, () => { audio.sfx('colorRestore', { pitch: 0.8 }); this.L.fx.ring(z.center.clone().setY(z.center.y + 0.2), Math.min(z.radius, 12), '#ffe08a', 0.8); });
    for (const cb of this.zoneCbs) { try { cb(id); } catch (e) { console.error('[vamp] onZone', e); } }
  }
  /** how grey the world is at a point (0..1) */
  greyAt(p: THREE.Vector3) { let g = 0; for (const z of this.zones) g = Math.max(g, z.at(p)); return g; }
  onZone(cb: (id: string) => void) { this.zoneCbs.push(cb); }

  private writeZones() {
    const cam = this.L.tcam.cam.position;
    let list = this.zones.filter((z) => z.amount > 0.001);
    if (list.length > GZ_MAX) list = list.sort((a, b) => a.center.distanceTo(cam) - a.radius - (b.center.distanceTo(cam) - b.radius)).slice(0, GZ_MAX);
    list.forEach((z, i) => {
      gzZ[i * 4] = z.center.x; gzZ[i * 4 + 1] = z.center.y; gzZ[i * 4 + 2] = z.center.z; gzZ[i * 4 + 3] = z.radius;
      gzP[i * 4] = z.amount; gzP[i * 4 + 1] = z.edge; gzP[i * 4 + 2] = z.front; gzP[i * 4 + 3] = z.glow;
    });
    gzI[0] = list.length;
  }

  // ───────────────────────── light ─────────────────────────
  /** a «солнышко» lantern (build time) */
  lantern(x: number, y: number, z: number, o: LanternOpts = {}): Lantern {
    this.activate();
    const real = (o.light ?? true) && this.L.building && this.realLights < MAX_REAL_LIGHTS;
    if (real) this.realLights++;
    const l = new Lantern(this, x, y, z, o, real);
    this.lanterns.push(l);
    this.L.hittables.push(l);
    if (this.L.building) this.L.nl?.add(l);
    else console.warn('[vamp] lantern outside the level build: not replicated');
    return l;
  }
  /** a temporary light for everyone (Пастила's beacon): any machine may call it; the host spreads it */
  light(at: V3, o: LightOpts = {}) {
    this.activate();
    const p = vec(at), r = o.r ?? 6, secs = o.secs ?? 8;
    if (!this.L.authority) { this.L.nl?.entEvent(this, 'lightReq', { p: [p.x, p.y, p.z], r, s: secs }); return; }
    this.spawnTemp(p, r, secs);
    this.L.nl?.entEvent(this, 'light', { p: [p.x, p.y, p.z], r, s: secs });
  }
  private spawnTemp(p: THREE.Vector3, r: number, secs: number) {
    const free = this.pool.find((l) => !this.temps.some((t) => !t.dead && t.light === l)) ?? null;
    this.temps.push(new TempLight(this, p, r, Math.min(secs, 60), free));
  }
  /** how lit a point is by lanterns and temporary lights (0..1; > 0.3 = vampires burn there) */
  sunAt(p: THREE.Vector3) {
    let s = 0;
    for (const l of this.lanterns) if (l.lit) s = Math.max(s, l.at(p));
    for (const t of this.temps) if (!t.dead) s = Math.max(s, t.at(p));
    return s;
  }
  /** the way out of the light that covers p most (unit xz vector), or null in the dark */
  sunAway(p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 | null {
    let best = 0, c: THREE.Vector3 | null = null;
    for (const l of this.lanterns) { const k = l.at(p); if (k > best) { best = k; c = l.pos; } }
    for (const t of this.temps) { if (t.dead) continue; const k = t.at(p); if (k > best) { best = k; c = t.pos; } }
    if (!c) return null;
    out.set(p.x - c.x, 0, p.z - c.z);
    if (out.lengthSq() < 1e-4) out.set(rand(-1, 1), 0, rand(-1, 1));
    return out.normalize();
  }
  /** the nearest lit lantern around (vampires go put it out) */
  litLanternNear(p: THREE.Vector3, r: number): Lantern | null {
    let best: Lantern | null = null, bd = r;
    for (const l of this.lanterns) { if (!l.lit) continue; const d = Math.hypot(l.pos.x - p.x, l.pos.z - p.z); if (d < bd) { bd = d; best = l; } }
    return best;
  }
  /** host: put out every lantern within r (a ground slam, a boss) */
  snuffAround(at: THREE.Vector3, r: number) { for (const l of this.lanterns) if (l.lit && Math.hypot(l.pos.x - at.x, l.pos.z - at.z) < r) l.snuff(); }

  // ───────────────────────── placing enemies ─────────────────────────
  /** a flock of bats around (x, y, z) — y is the flying height. Build time: a fixed count; on the host at runtime:
   *  +1 bat per two extra heroes */
  flock(x: number, y: number, z: number, n = 5, spread = 2.2) {
    const L = this.L;
    if (!L.building && L.authority) n += Math.floor((L.heroes().length - 1) / 2);
    const out: Enemy3[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.4, r = spread * (0.5 + 0.5 * ((i * 37) % 10) / 10);
      const px = x + Math.cos(a) * r, py = y + ((i * 13) % 5) * 0.15, pz = z + Math.sin(a) * r;
      out.push(L.building ? L.enemy('bat', px, py, pz) : L.spawnEnemy('bat', px, py, pz));
    }
    return out;
  }
  /** a пресняк (grey townsperson): 'zefir' | 'pryanik' | 'marmelad' (default: by position) */
  folk(x: number, y: number, z: number, kind?: 'zefir' | 'pryanik' | 'marmelad', yaw?: number) {
    return this.L.building ? this.L.enemy('presnyak', x, y, z, { folk: kind, yaw }) : this.L.spawnEnemy('presnyak', x, y, z, { folk: kind, yaw });
  }

  // ───────────────────────── reveal / dust ─────────────────────────
  /** pollen / flour / dust (build time): the invisible show up in it */
  dustZone(at: V3, r: number) { this.activate(); this.dust.push({ c: vec(at), r }); }
  dustAt(p: THREE.Vector3) { return this.dust.some((d) => Math.hypot(p.x - d.c.x, p.z - d.c.z) < d.r); }
  /** the invisible within r show for `secs` (Ноки's chord, a flash); any machine */
  revealAround(at: V3, r: number, secs = 4) {
    const p = vec(at);
    if (!this.L.authority) { this.L.nl?.entEvent(this, 'revealReq', { p: [p.x, p.y, p.z], r, s: secs }); return; }
    for (const e of this.L.enemies) if (!e.dead && isVamp(e) && e.center(v1).distanceTo(p) < r) e.reveal?.(secs);
  }

  // ───────────────────────── abilities ─────────────────────────
  /**
   * Ноки's chord (or any «magic noise»): vampires within r are stunned and revealed, townsfolk restored. Any machine;
   * `by` = member id (credit). Abilities that go through L.meleeHit(..., 'chord') get the same per enemy with score credit.
   */
  chord(at: V3, r = 5, by: string | null = null) {
    const p = vec(at);
    if (!this.L.authority) { this.L.nl?.entEvent(this, 'chordReq', { p: [p.x, p.y, p.z], r }); return; }
    this.L.nl?.entEvent(this, 'chordFx', { p: [p.x, p.y, p.z], r });
    this.chordFx(p, r);
    const prev = this.L.attacker;
    if (by && by !== net.myId) this.L.attacker = by;
    try {
      for (const e of [...this.L.enemies]) {
        if (e.dead || e.center(v1).distanceTo(p) > r + e.body.r) continue;
        if (isFolk(e)) e.restore(this.L, by);
        else if (isVamp(e)) { e.stunFor(this.L, 2.2); e.reveal?.(4); }
      }
    } finally { this.L.attacker = prev; }
  }
  private chordFx(p: THREE.Vector3, r: number) {
    const L = this.L;
    ambient(L, () => {
      L.fx.ring(p.clone(), r, '#c070ff', 0.5);
      L.fx.ring(p.clone().setY(p.y + 0.8), r * 0.7, '#ff7ad0', 0.4, false);
      L.fx.stars(p.clone().setY(p.y + 1), 20, ['#c070ff', '#ff7ad0', '#ffffff']);
    });
  }
  /**
   * The «пробный сироп» squirter ([E], script §1.9): townsfolk within r that are STUNNED get their colour back,
   * vampires within r get a 'syrup' hit (stung, slowed). Any machine; `by` = member id.
   */
  syrupSpray(at: V3, r = 1.6, by: string | null = null) {
    const p = vec(at);
    if (!this.L.authority) { this.L.nl?.entEvent(this, 'sprayReq', { p: [p.x, p.y, p.z], r }); return; }
    const prev = this.L.attacker;
    if (by && by !== net.myId) this.L.attacker = by;
    try {
      for (const e of [...this.L.enemies]) {
        if (e.dead || e.center(v1).distanceTo(p) > r + e.body.r) continue;
        if (isFolk(e)) { if (e.stun > 0) e.restore(this.L, by); }
        else if (isVamp(e)) e.hurt(this.L, 1, p, 'syrup');
      }
    } finally { this.L.attacker = prev; }
  }
  /** restore every townsperson within r, stunned or not (Пастила's syringe splash, a script); any machine */
  restoreAround(at: V3, r = 3, by: string | null = null) {
    const p = vec(at);
    if (!this.L.authority) { this.L.nl?.entEvent(this, 'restoreReq', { p: [p.x, p.y, p.z], r }); return; }
    for (const e of [...this.L.enemies]) if (!e.dead && isFolk(e) && e.center(v1).distanceTo(p) < r + e.body.r) e.restore(this.L, by);
  }
  /** host: the bats' screech — every vampire within r goes after `target` (melon soldiers hear it too) */
  alarm(at: THREE.Vector3, r: number, target: HeroLike) {
    if (!this.L.authority) return;
    for (const e of this.L.enemies) if (!e.dead && isVamp(e) && e.body.pos.distanceTo(at) < r) e.alert(this.L, target);
    this.L.noise(at, r, { alarm: true, target: target.pos });
  }

  // ───────────────────────── «пресный» ─────────────────────────
  /** host: a bite drained `hero`'s colour — slower and grey for `secs` (everyone sees it; its owner is slowed) */
  bland(hero: HeroLike, secs = 2.5) {
    if (!this.L.authority) return;
    this.activate();
    const id = heroId(hero);
    this.applyBland(id, secs);
    this.L.nl?.entEvent(this, 'bland', { h: id, s: secs });
  }
  private applyBland(id: string, secs: number) {
    const L = this.L;
    const hero = !L.nl || id === net.myId ? L.player : L.remote(id);
    if (!hero) return;
    if (hero === L.player) {
      if (this.blandT <= 0) {
        ambient(L, () => L.fx.text(hero.center().setY(hero.pos.y + 1.9), 'Пресно…', '#c8c8d4', 22));
        L.hint('bland', 'Укус вампира пьёт цвет: пару секунд вы «пресный» — серый и медленный. Держитесь в свете солнышек!');
      }
      this.blandT = Math.max(this.blandT, secs);
    }
    const root = heroRoot(hero);
    if (!root) return;
    if (hasNewMats(root)) markCharacter(root, L.scene);
    let g = this.grey.get(hero);
    if (!g) { g = { t: 0, k: 0, set: greyHandle(root), dripT: 0 }; this.grey.set(hero, g); }
    else g.set = greyHandle(root); // (the hero may have swapped his model since)
    g.t = Math.max(g.t, secs);
    ambient(L, () => audio.sfx('drain'));
  }

  onRestore(cb: (folk: FolkLike, by: string | null) => void) { this.restoreCbs.push(cb); }
  /** townsfolk.ts tells the kit (every machine) */
  restoredOne(folk: FolkLike, by: string | null, quiet = false) {
    this.restoredN++;
    if (quiet) return;
    this.hudT = 0;
    for (const cb of this.restoreCbs) { try { cb(folk, by); } catch (e) { console.error('[vamp] onRestore', e); } }
  }

  // ───────────────────────── night ─────────────────────────
  /** the night lighting preset (once, build time) */
  nightLook(o: NightOpts = {}): NightCtl {
    this.activate();
    this.night?.dispose();
    this.night = new NightCtl(this.L, o);
    return this.night;
  }
  /** the big moon in the sky */
  moon(o: MoonOpts = {}): MoonCtl {
    this.activate();
    this.moonCtl?.dispose();
    this.moonCtl = new MoonCtl(this.L, { red: this.night?.red, ...o });
    return this.moonCtl;
  }

  // ───────────────────────── net ─────────────────────────
  netEvent(L: Level3D, ev: string, d: { p?: number[]; r?: number; s?: number; h?: string; from?: string }) {
    const p = d.p ? new THREE.Vector3(d.p[0], d.p[1], d.p[2]) : null;
    switch (ev) {
      case 'bland': if (d.h && !L.authority) this.applyBland(d.h, d.s ?? 2.5); break;
      case 'light': if (p && !L.authority) { this.activate(); this.spawnTemp(p, d.r ?? 6, d.s ?? 8); } break;
      case 'chordFx': if (p && !L.authority) this.chordFx(p, d.r ?? 5); break;
      // requests from clients (host)
      case 'lightReq': if (p && L.authority) this.light(p, { r: Math.min(12, d.r ?? 6), secs: Math.min(30, d.s ?? 8) }); break;
      case 'chordReq': if (p && L.authority) this.chord(p, Math.min(10, d.r ?? 5), d.from ?? null); break;
      case 'restoreReq': if (p && L.authority) this.restoreAround(p, Math.min(8, d.r ?? 3), d.from ?? null); break;
      case 'sprayReq': if (p && L.authority) this.syrupSpray(p, Math.min(3, d.r ?? 1.6), d.from ?? null); break;
      case 'revealReq': if (p && L.authority) this.revealAround(p, Math.min(14, d.r ?? 6), Math.min(10, d.s ?? 4)); break;
    }
  }

  // ───────────────────────── per tick ─────────────────────────
  update(dt: number) {
    if (!this.active) return;
    const L = this.L;
    this.night?.update(dt);
    this.moonCtl?.update(dt);
    for (const z of this.zones) { const was = z.state; z.update(dt); if (was !== 'done' && z.done) L.seen.add('gz:' + z.id); }
    for (const l of this.lanterns) l.update(dt);
    for (const t of this.temps) t.update(dt);
    if (this.temps.some((t) => t.dead)) this.temps = this.temps.filter((t) => !t.dead);
    // host: zones that clear themselves
    if (L.authority && (this.autoT -= dt) <= 0) { this.autoT = 0.5; this.autoZones(); }
    // fog: washed out while I'm in a grey zone
    this.fogTint(dt);
    // «пресный»
    this.blandT = Math.max(0, this.blandT - dt);
    for (const [h, g] of this.grey) {
      g.t -= dt;
      g.k = damp(g.k, g.t > 0 ? 1 : 0, g.t > 0 ? 10 : 3, dt);
      g.set(g.k * 0.9);
      if (g.t > 0 && (g.dripT -= dt) <= 0) {
        g.dripT = 0.09;
        const c = h.center(v1);
        ambient(L, () => L.fx.soft.emit(c.clone().setY(c.y + 0.3), { count: 1, speed: [0.2, 0.6], life: [0.4, 0.8], size: [0.08, 0.14], colors: ['#9a98a8', '#c8c6d0', '#6e6c7c'], g: 6, jitter: 0.3 }));
      }
      if (g.t <= 0 && g.k < 0.01) { g.set(0); this.grey.delete(h); }
    }
    // heroes (late joiners, swapped models too) keep their colours in grey zones
    if ((this.markT -= dt) <= 0) {
      this.markT = 1;
      for (const h of L.heroes()) { const r = heroRoot(h); if (r && hasNewMats(r)) markCharacter(r, L.scene); }
    }
    this.hudT += dt;
  }

  private autoZones() {
    for (const z of this.zones) {
      if (z.state !== 'grey' || (z.o.auto ?? 'clear') !== 'clear') continue;
      let n = 0;
      for (const e of this.L.enemies) {
        if (e.dead || !(isVamp(e) || isFolk(e))) continue;
        if (Math.hypot(e.home.x - z.center.x, e.home.z - z.center.z) < z.radius) n++;
      }
      if (z.members < 0) z.members = n;
      else z.members = Math.max(z.members, n);
      if (z.members > 0 && n === 0) this.restoreZone(z.id);
    }
  }

  private fogTint(dt: number) {
    const L = this.L;
    const fog = L.scene.fog as THREE.Fog | null;
    if (!fog || !this.zones.length) return;
    // someone else (a night preset, a script) changed the fog: that's the new base
    if (!fog.color.equals(this.fogSet)) this.fogBase.copy(this.night ? this.night.fogColor : fog.color);
    else if (this.night) this.fogBase.copy(this.night.fogColor);
    this.fogK = damp(this.fogK, this.greyAt(L.player.pos), 3, dt);
    const lum = this.fogBase.r * 0.3 + this.fogBase.g * 0.59 + this.fogBase.b * 0.11;
    fog.color.copy(this.fogBase).lerp(v3c.setRGB(lum * 0.95, lum * 0.97, lum * 1.05), this.fogK * 0.85);
    this.fogSet.copy(fog.color);
  }

  /** «Расколдовано N из M» (only in levels with townsfolk) */
  draw(ctx: CanvasRenderingContext2D) {
    if (!this.folkTotal || this.L.letterbox > 0.3) return;
    // faint between restores; gone once everyone is back or while a boss bar is up (a fresh restore still pops it)
    const quiet = this.restoredN >= this.folkTotal || this.L.hud.bossMax > 0 || this.L.camModeDefault === 'boss';
    this.hudK = damp(this.hudK, this.hudT < 4 ? 1 : quiet ? 0 : 0.55, 6, 1 / 60);
    if (this.hudK < 0.02) return;
    const pop = this.hudT < 0.4 ? 1 + (0.4 - this.hudT) * 0.8 : 1;
    text(ctx, `Расколдовано: ${this.restoredN} из ${this.folkTotal}`, W / 2, 30, { size: 20 * pop, color: '#ffe8f0', align: 'center', alpha: this.hudK, stroke: 4 });
  }

  dispose() {
    gzI[0] = 0;
    this.night?.dispose(); this.moonCtl?.dispose();
    for (const t of this.temps) t.dispose();
  }

  plugin(): LevelPlugin { return { update: (dt) => this.update(dt), draw: (ctx) => this.draw(ctx), dispose: () => this.dispose() }; }
}

/** the level's vampire kit (created on first use) */
export function vamp(L: Level3D): VampKit {
  let k = L.refs.vamp as VampKit | undefined;
  if (!k) { k = new VampKit(L); L.refs.vamp = k; }
  return k;
}
