import * as THREE from 'three';
import { net } from '../../../net/session';
import { audio } from '../../../engine/audio';
import { clamp, damp, W, H } from '../../../engine/util';
import { text, rrect, circle, OUT } from '../../../art/draw';
import { basic, mat, noOutline, canvasTex } from '../../gfx';
import { drawGlyph, glyphLabel } from '../../../ui/glyphs';
import type { CylCol } from '../../physics/types';
import type { Level3D, HeroLike } from '../level';
import type { RemoteHero3 } from '../remoteHero';
import { vamp, type VampKit } from '../arc/vampires/kit';
import { isPrologueLevel } from './where';

/*
 * The heroes' team machinery — one HeroTeam per level (`team(L)`, a LEVEL_PLUGIN registered by heroes/index.ts):
 *  • kit events between friends on the message `hk` (the owner → everyone; shot looks unreliable, the rest reliable):
 *    Ноки's «Аккорд» (+1 ♥ for the heroes the caster saw in reach), Тоша's «Геройский клич» (haste + a one-hit shield),
 *    Пастила's gadgets, the kit shots, Ноки's slam. Whoever casts decides who is in reach (`ids`): every machine then
 *    agrees on who got what; each owner applies it to his own hero.
 *  • world gadgets every machine builds for itself: «Батут-пряник» (a real bouncy collider — any friend bounces on it in
 *    his own physics), «Сиропный щит» (pops enemy shots inside), the beacon's look outside the vampire arc (inside it
 *    the beacon is `vamp(L).light`, which the vampire kit spreads and makes vampires burn).
 *  • kit shots (Пастила's syrup glob, Ноки's pluck): flown on every machine; the shooter's copy finds the hit and turns
 *    it into `L.meleeHit` at the impact point (the host resolves it like a swing: credit, co-op safe).
 *  • team-buff auras on every hero (HS.buff), a gadget icon over Пастила while she picks one, the ability chip
 *    (special button + cooldown) and the first-time hint per hero in the HUD.
 *  • hero events for other modules (vampire arc, scripts): `heroEvents(L).on('chord' | 'call' | 'syrup' | 'beacon' |
 *    'pad' | 'dome' | 'slam', cb)` — fired on EVERY machine (cb gets { e, at, r, secs, by, heal?, ids? }).
 */

const MSG = 'hk';

/** «Геройский клич»: reach, haste and shield time */
export const CALL_R = 7;
export const HASTE_T = 5;
export const WARD_T = 8;
/** «Батут-пряник»: size, launch speed (Tosha's jump 11.6 ≈ 2 m; this ≈ 5.6 m), life */
const PAD_R = 0.85;
const PAD_H = 0.24;
export const PAD_BOUNCE = 19;
export const PAD_T = 15;
/** «Сиропный щит»: radius, life */
export const DOME_R = 2.8;
export const DOME_T = 4;
/** «Маяк-солнышко»: light radius, life */
export const BEACON_R = 6;
export const BEACON_T = 8;

export interface HeroEv {
  e: 'chord' | 'call' | 'syrup' | 'beacon' | 'pad' | 'dome' | 'slam';
  at: THREE.Vector3;
  r: number;
  secs: number;
  /** member id of the hero who did it ('me' in solo) */
  by: string;
  /** chord: the +1 ♥ part was on */
  heal?: boolean;
  /** chord / call: the heroes in reach (member ids) */
  ids?: string[];
}
type HeroEvCb = (ev: HeroEv) => void;

/** the level's vampire kit when this level uses it (inactive in the prologue: don't wake it up there) */
export function vampOn(L: Level3D): VampKit | null {
  const V = vamp(L);
  return V.active ? V : null;
}

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const r2 = (x: number) => Math.round(x * 100) / 100;
const pack = (v: THREE.Vector3) => [r2(v.x), r2(v.y), r2(v.z)];
const unpack = (a: unknown, out = new THREE.Vector3()) => (Array.isArray(a) && a.length >= 3 && a.every((x) => Number.isFinite(x)) ? out.set(+a[0], +a[1], +a[2]) : null);
const fin = (x: unknown, d: number, lo: number, hi: number) => (Number.isFinite(Number(x)) ? clamp(Number(x), lo, hi) : d);

// ───────────────────────── shared looks ─────────────────────────
const GEO = {
  sphere: new THREE.SphereGeometry(1, 20, 14),
  dome: new THREE.SphereGeometry(1, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2),
  disc: new THREE.CylinderGeometry(1, 1, 1, 28),
  torus: new THREE.TorusGeometry(1, 0.09, 8, 36),
  rim: new THREE.TorusGeometry(1, 0.025, 6, 56),
  dot: new THREE.SphereGeometry(1, 8, 6),
};
let noteTex: THREE.Texture | null = null;
function noteTexture() {
  return (noteTex ??= canvasTex(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,220,255,0.95)'); gr.addColorStop(0.35, 'rgba(200,120,255,0.55)'); gr.addColorStop(1, 'rgba(120,40,200,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.font = '900 40px Rubik, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 5; g.strokeStyle = '#3a1450'; g.strokeText('♪', w / 2, h / 2 + 2);
    g.fillStyle = '#ffffff'; g.fillText('♪', w / 2, h / 2 + 2);
  }));
}
let glowT: THREE.Texture | null = null;
function glowTexture() {
  return (glowT ??= canvasTex(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }));
}

/** Пастила's gadgets: icon drawn on a 2D canvas (the wheel, the chip, the sprite over her head) */
export const GADGET_NAMES = ['Батут-пряник', 'Сиропный щит', 'Маяк-солнышко'] as const;
export function drawGadgetIcon(ctx: CanvasRenderingContext2D, i: number, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  if (i === 0) {
    // gingerbread trampoline: a brown disc with white icing, an arrow up
    ctx.beginPath(); ctx.ellipse(0, 6, 20, 9, 0, 0, Math.PI * 2); ctx.fillStyle = '#b8742e'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 4, 14, 5.5, 0, 0, Math.PI * 2); ctx.lineWidth = 2.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    for (const [dx, c] of [[-7, '#ff6aa8'], [6, '#7ad8ff'], [0, '#ffe14a']] as const) { ctx.beginPath(); ctx.arc(dx, 4 + (dx === 0 ? -1 : 1), 2.2, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(8, -9); ctx.lineTo(3, -9); ctx.lineTo(3, -3); ctx.lineTo(-3, -3); ctx.lineTo(-3, -9); ctx.lineTo(-8, -9); ctx.closePath();
    ctx.fillStyle = '#ffe14a'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = OUT; ctx.stroke();
  } else if (i === 1) {
    // syrup dome
    ctx.beginPath(); ctx.arc(0, 10, 19, Math.PI, 0); ctx.closePath(); ctx.fillStyle = 'rgba(255,120,180,0.85)'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
    ctx.beginPath(); ctx.arc(-6, 0, 6, Math.PI * 1.1, Math.PI * 1.6); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-22, 10); ctx.lineTo(22, 10); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
  } else {
    // little sun
    ctx.fillStyle = '#ffd34a'; ctx.strokeStyle = OUT; ctx.lineWidth = 2.5;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(Math.cos(a - 0.17) * 13, Math.sin(a - 0.17) * 13); ctx.lineTo(Math.cos(a) * 21, Math.sin(a) * 21); ctx.lineTo(Math.cos(a + 0.17) * 13, Math.sin(a + 0.17) * 13); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fillStyle = '#ffe680'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(-4.5, -2, 1.8, 0, Math.PI * 2); ctx.arc(4.5, -2, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 2, 5, 0.2, Math.PI - 0.2); ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.restore();
}
const iconTex: THREE.Texture[] = [];
function gadgetTexture(i: number) {
  return (iconTex[i] ??= canvasTex(96, 96, (g, w, h) => {
    g.beginPath(); g.arc(w / 2, h / 2, 40, 0, Math.PI * 2); g.fillStyle = 'rgba(255,240,248,0.92)'; g.fill(); g.lineWidth = 5; g.strokeStyle = OUT; g.stroke();
    drawGadgetIcon(g, i, w / 2, h / 2, 1.45);
  }));
}

// ───────────────────────── world gadgets ─────────────────────────
/** «Батут-пряник»: a gingerbread jump pad — a bouncy collider in this machine's physics */
class JumpPad {
  obj = new THREE.Group();
  col: CylCol;
  t = 0;
  boing = 0;
  dead = false;
  constructor(private L: Level3D, at: THREE.Vector3, readonly life: number, readonly owner: string) {
    const gy = L.phys.groundAt(at.x, at.z, at.y + 0.6, 0.3);
    const base = gy > -1e8 && gy > at.y - 3 ? gy : at.y;
    const disc = new THREE.Mesh(GEO.disc, mat('#b8742e'));
    disc.scale.set(PAD_R, PAD_H, PAD_R); disc.position.y = PAD_H / 2; disc.castShadow = disc.receiveShadow = true;
    const top = new THREE.Mesh(GEO.disc, mat('#d89a54'));
    top.scale.set(PAD_R * 0.86, 0.04, PAD_R * 0.86); top.position.y = PAD_H + 0.01;
    const icing = new THREE.Mesh(GEO.torus, mat('#ffffff'));
    icing.rotation.x = Math.PI / 2; icing.scale.setScalar(PAD_R * 0.68); icing.position.y = PAD_H + 0.04;
    const rim = new THREE.Mesh(GEO.torus, mat('#fff3e0'));
    rim.rotation.x = Math.PI / 2; rim.scale.setScalar(PAD_R * 0.98); rim.position.y = PAD_H - 0.01;
    this.obj.add(disc, top, icing, rim);
    const cols = ['#ff6aa8', '#7ad8ff', '#ffe14a', '#8aff6a', '#c88aff'];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const d = new THREE.Mesh(GEO.dot, mat(cols[i % cols.length]));
      d.scale.setScalar(0.06); d.position.set(Math.cos(a) * PAD_R * 0.45, PAD_H + 0.05, Math.sin(a) * PAD_R * 0.45);
      this.obj.add(d);
    }
    this.obj.position.set(at.x, base, at.z);
    L.scene.add(this.obj);
    this.col = { kind: 'cyl', x: at.x, z: at.z, r: PAD_R, y0: base - 0.05, y1: base + PAD_H, bounce: PAD_BOUNCE, tag: 'pad' };
    L.phys.add(this.col);
    L.fx.ring(this.obj.position.clone().setY(base + 0.05), 1.6, '#ffd08a', 0.4);
    L.fx.stars(this.obj.position.clone().setY(base + 0.4), 12, ['#ffe14a', '#ffffff', '#ff9ac0']);
  }
  /** someone bounced: squash it */
  kick() { this.boing = 1; }
  update(dt: number) {
    this.t += dt;
    this.boing = Math.max(0, this.boing - dt * 4);
    const s = 1 - Math.sin(this.boing * Math.PI) * 0.35;
    const pop = Math.min(1, this.t * 6);
    this.obj.scale.set(pop * (2 - s), pop * s, pop * (2 - s));
    // blinks before it crumbles away
    const left = this.life - this.t;
    this.obj.visible = left > 2 || Math.floor(left * 8) % 2 === 0;
    if (left <= 0) this.dispose(true);
  }
  dispose(fx = false) {
    if (this.dead) return;
    this.dead = true;
    this.L.phys.remove(this.col);
    this.obj.removeFromParent();
    if (fx) this.L.fx.chunks(this.obj.position.clone().setY(this.obj.position.y + 0.2), 10, ['#b8742e', '#d89a54', '#ffffff'], this.obj.position.y, [0.06, 0.12]);
  }
}

/** «Сиропный щит»: a syrup dome that pops enemy shots */
class Dome {
  obj = new THREE.Group();
  t = 0;
  dead = false;
  private m: THREE.MeshBasicMaterial;
  private rimM: THREE.MeshBasicMaterial;
  center: THREE.Vector3;
  constructor(private L: Level3D, at: THREE.Vector3, readonly r: number, readonly life: number, color: string) {
    const gy = L.phys.groundAt(at.x, at.z, at.y + 0.6, 0.2);
    const base = gy > -1e8 && gy > at.y - 3 ? gy : at.y;
    this.center = new THREE.Vector3(at.x, base, at.z);
    this.m = basic(color, { transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false });
    const d = new THREE.Mesh(GEO.dome, this.m);
    d.scale.setScalar(r);
    this.rimM = basic('#ffffff', { transparent: true, opacity: 0.7, depthWrite: false });
    const rim = new THREE.Mesh(GEO.rim, this.rimM);
    rim.rotation.x = Math.PI / 2; rim.scale.setScalar(r); rim.position.y = 0.04;
    const shine = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffd0e8', transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    shine.scale.setScalar(r * 0.7); shine.position.set(-r * 0.35, r * 0.75, r * 0.35);
    this.obj.add(d, rim, shine);
    noOutline(this.obj);
    this.obj.renderOrder = 3;
    this.obj.position.copy(this.center);
    L.scene.add(this.obj);
    L.fx.ring(this.center.clone().setY(base + 0.05), r, color, 0.45);
    L.fx.emit(this.center.clone().setY(base + 1), { count: 18, speed: [2, 5], life: [0.3, 0.6], size: [0.08, 0.16], colors: [color, '#ffffff'], g: 8 });
  }
  update(dt: number) {
    this.t += dt;
    const k = Math.min(1, this.t * 5) * Math.min(1, Math.max(0, (this.life - this.t) / 0.4));
    this.obj.scale.setScalar(0.2 + 0.8 * Math.min(1, this.t * 5));
    this.m.opacity = 0.26 * k + Math.sin(this.t * 9) * 0.03 * k;
    this.rimM.opacity = 0.7 * k;
    if (this.t >= this.life) { this.dispose(); return; }
    // enemy shots that reach the dome splash on it (every machine pops its own copy; damage is victim-side anyway)
    const L = this.L;
    for (const s of L.shots) {
      if (s.dead || s.owner !== 'enemy' || s.pos.y < this.center.y - 0.5) continue;
      if (s.pos.distanceTo(this.center) > this.r + s.r) continue;
      s.pop(L);
      L.fx.emit(s.pos.clone(), { count: 10, speed: [1, 3], life: [0.2, 0.45], size: [0.06, 0.12], colors: ['#ff9ac8', '#ffffff'], g: 6 });
      audio.sfx('reflect', { pitch: 1.4, volume: 0.5 });
      this.blocked++;
    }
  }
  blocked = 0;
  dispose() {
    if (this.dead) return;
    this.dead = true;
    this.obj.removeFromParent();
    this.m.dispose(); this.rimM.dispose();
    this.L.fx.emit(this.center.clone().setY(this.center.y + 1), { count: 14, speed: [1, 3], life: [0.3, 0.6], size: [0.08, 0.14], colors: ['#ff9ac8', '#ffffff'], g: 8 });
  }
}

/** the beacon's look where there is no vampire kit (in the arc the beacon is vamp(L).light — it draws itself) */
class Beacon {
  obj = new THREE.Group();
  t = 0;
  dead = false;
  private sm: THREE.SpriteMaterial;
  private pool: THREE.MeshBasicMaterial;
  constructor(private L: Level3D, at: THREE.Vector3, readonly r: number, readonly life: number) {
    const gy = L.phys.groundAt(at.x, at.z, at.y + 0.6, 0.2);
    const base = gy > -1e8 && gy > at.y - 3 ? gy : at.y;
    const orb = new THREE.Mesh(GEO.sphere, mat('#fff0a0', { emissive: '#ffc020', emissiveIntensity: 1 }));
    orb.scale.setScalar(0.3); orb.position.y = 1.6;
    this.sm = new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffe080', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    const glow = new THREE.Sprite(this.sm); glow.scale.setScalar(3.2); glow.position.y = 1.6;
    this.pool = basic('#ffe08a', { additive: true, transparent: true, opacity: 0.25, depthWrite: false });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(r, 40).rotateX(-Math.PI / 2), this.pool);
    pool.position.y = 0.05;
    this.obj.add(orb, glow, pool);
    noOutline(this.obj);
    this.obj.position.set(at.x, base, at.z);
    L.scene.add(this.obj);
    L.fx.stars(this.obj.position.clone().setY(base + 1.6), 24, ['#fff3a0', '#ffffff', '#ffd040']);
    L.fx.ring(this.obj.position.clone().setY(base + 0.06), r, '#ffe080', 0.5);
  }
  update(dt: number) {
    this.t += dt;
    const k = Math.min(1, this.t * 4) * Math.min(1, Math.max(0, (this.life - this.t) / 0.8));
    this.sm.opacity = 0.85 * k; this.pool.opacity = 0.25 * k;
    this.obj.children[0].position.y = 1.6 + Math.sin(this.t * 3) * 0.08;
    if (this.t >= this.life) this.dispose();
  }
  dispose() {
    if (this.dead) return;
    this.dead = true;
    this.obj.removeFromParent();
    this.sm.dispose(); this.pool.dispose();
    (this.obj.children[2] as THREE.Mesh).geometry.dispose();
  }
}

// ───────────────────────── kit shots ─────────────────────────
export type KitShotKind = 'syrup' | 'note';
interface ShotHit { dmg: number; kind: string }
/** a kit's projectile: flown on every machine; only the shooter's copy (hit ≠ null) hits */
class KitShot {
  obj = new THREE.Group();
  dead = false;
  life: number;
  private g: number;
  private r: number;
  private trailT = 0;
  private ms: THREE.Material[] = [];
  constructor(private T: HeroTeam, readonly kind: KitShotKind, readonly pos: THREE.Vector3, readonly vel: THREE.Vector3, readonly color: string, private hit: ShotHit | null) {
    const L = T.L;
    if (kind === 'syrup') {
      this.life = 0.9; this.g = 7; this.r = 0.16;
      const m = basic(color); const hl = basic('#ffffff', { transparent: true, opacity: 0.8 });
      this.ms.push(m, hl);
      const drop = new THREE.Mesh(GEO.sphere, m); drop.scale.set(0.12, 0.12, 0.22);
      const shine = new THREE.Mesh(GEO.sphere, hl); shine.scale.setScalar(0.04); shine.position.set(0.04, 0.05, 0.06);
      this.obj.add(drop, shine);
    } else {
      this.life = 0.42; this.g = 0; this.r = 0.22;
      const sm = new THREE.SpriteMaterial({ map: noteTexture(), color: '#ffffff', transparent: true, depthWrite: false });
      this.ms.push(sm);
      const s = new THREE.Sprite(sm); s.scale.setScalar(0.62);
      this.obj.add(s);
    }
    noOutline(this.obj);
    this.obj.position.copy(pos);
    L.scene.add(this.obj);
  }
  /** a friend's shot: it left his hand `age` s ago — start it where it is by now */
  catchUp(age: number) {
    if (age <= 0) return;
    this.pos.addScaledVector(this.vel, age).y -= 0.5 * this.g * age * age;
    this.vel.y -= this.g * age;
    this.life -= age;
  }
  update(dt: number) {
    const L = this.T.L;
    this.life -= dt;
    if (this.life <= 0) { this.pop(false); return; }
    this.vel.y -= this.g * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.obj.position.copy(this.pos);
    if (this.kind === 'syrup') this.obj.lookAt(v1.copy(this.pos).add(this.vel));
    else this.obj.children[0].rotation.z = Math.sin(this.life * 30) * 0.3;
    if ((this.trailT -= dt) <= 0) {
      this.trailT = 0.03;
      if (this.kind === 'syrup') L.fx.emit(this.pos.clone(), { count: 1, speed: [0.1, 0.4], life: [0.2, 0.35], size: [0.04, 0.08], colors: [this.color, '#ffffff'], g: 6 });
      else L.fx.emit(this.pos.clone(), { count: 1, speed: [0.1, 0.5], life: [0.15, 0.3], size: [0.05, 0.1], colors: ['#c070ff', '#ffb0ff', '#ffffff'], drag: 3 });
    }
    if (this.hit) {
      for (const e of L.enemies) {
        if (e.dead || e.spawnT > 0) continue;
        const c = e.center(v2);
        if (Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < e.body.r + this.r && Math.abs(c.y - this.pos.y) < e.body.h * 0.6 + this.r) { this.strike(c); return; }
      }
      if (L.boss) for (const t of L.boss.aimTargets()) if (t.distanceTo(this.pos) < 0.8) { this.strike(t); return; }
    }
    if (L.phys.pointInSolid(this.pos)) this.pop(true);
  }
  /** the shooter's copy hit something: the hit goes through the melee path (host resolves, credits) */
  private strike(at: THREE.Vector3) {
    const L = this.T.L, h = this.hit!;
    const dir = v1.copy(this.vel).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
    dir.normalize();
    L.meleeHit(at.clone(), dir.clone(), 0.7, Math.PI, h.dmg, this.T.nextShotId(), h.kind);
    if (this.kind === 'syrup') this.T.emit({ e: 'syrup', at: at.clone(), r: 0.7, secs: 0, by: this.T.me });
    this.pop(true);
  }
  pop(splat: boolean) {
    if (this.dead) return;
    this.dead = true;
    this.obj.removeFromParent();
    for (const m of this.ms) m.dispose();
    if (!splat) return;
    const L = this.T.L;
    if (this.kind === 'syrup') {
      L.fx.emit(this.pos.clone(), { count: 12, speed: [1, 3.5], life: [0.25, 0.5], size: [0.06, 0.13], colors: [this.color, '#ffffff', this.color], g: 10 });
      audio.sfx('splash', { pitch: 1.6, volume: 0.35 });
    } else {
      L.fx.ring(this.pos.clone(), 0.9, '#c070ff', 0.25, false);
      L.fx.emit(this.pos.clone(), { count: 8, speed: [1, 3], life: [0.2, 0.35], size: [0.05, 0.1], colors: ['#c070ff', '#ffffff'], drag: 3 });
    }
  }
}

// ───────────────────────── auras ─────────────────────────
interface Aura { ward: THREE.Mesh; wm: THREE.MeshBasicMaterial; k: number; bits: number; hasteT: number; icon: THREE.Sprite | null; iconI: number }

// ───────────────────────── the hub ─────────────────────────
export class HeroTeam {
  private inbox: { d: Record<string, unknown>; from: string }[] = [];
  private unsub: (() => void) | null = null;
  private pads = new Map<string, JumpPad>();
  private domes: Dome[] = [];
  private beacons: Beacon[] = [];
  private shots: KitShot[] = [];
  private auras = new Map<HeroLike, Aura>();
  private subs = new Map<string, Set<HeroEvCb>>();
  private later: { t: number; f: () => void }[] = [];
  private shotSeq = Math.floor(Math.random() * 1e9);
  private hintKind = '';
  private hintT = 0;
  private chipK = 0;
  /** friends whose hero showed up on this machine (they get my pad that's still standing: late joiners, slow loaders) */
  private greeted = new Set<string>();

  constructor(readonly L: Level3D) {
    if (L.nl) this.unsub = net.on(MSG, (d, from) => { if (d && typeof d === 'object') this.inbox.push({ d, from }); });
  }

  /** my member id ('me' in solo) */
  get me() { return this.L.nl ? net.myId : 'me'; }
  nextShotId() { return ++this.shotSeq; }

  /** subscribe to hero events on this machine (see HeroEv); returns unsubscribe */
  on(e: HeroEv['e'], cb: HeroEvCb): () => void {
    let s = this.subs.get(e);
    if (!s) { s = new Set(); this.subs.set(e, s); }
    s.add(cb);
    return () => { s!.delete(cb); };
  }
  emit(ev: HeroEv) {
    const s = this.subs.get(ev.e);
    if (s) for (const cb of [...s]) { try { cb(ev); } catch (err) { console.error('[heroes] event', ev.e, err); } }
  }
  private send(d: Record<string, unknown>, reliable = true) { if (this.L.nl) net.send('all', MSG, d, reliable); }

  /** heroes up and about within r of `at` (mine first): member ids */
  private inReach(at: THREE.Vector3, r: number): string[] {
    const ids: string[] = [];
    for (const h of this.L.heroes()) {
      if (h.dead || h.downed || h.hidden || (h as { stale?: boolean }).stale) continue;
      if (h.pos.distanceTo(at) > r) continue;
      ids.push(h.isLocal ? this.me : (h as RemoteHero3).id);
    }
    return ids;
  }
  private heroById(id: string): HeroLike | null {
    if (id === this.me) return this.L.player;
    return this.L.remote(id) ?? null;
  }

  // ───────── abilities (called by my hero's kit) ─────────
  /** Ноки's «Аккорд» wave from `at`: rings for everyone; heal = +1 ♥ to every hero in reach (her too) */
  chord(at: THREE.Vector3, r: number, heal: boolean) {
    const ids = heal ? this.inReach(at, r) : [];
    this.send({ e: 'chord', p: pack(at), r, h: heal ? 1 : 0, ids });
    this.onChord(at, r, heal, ids, this.me);
    return ids;
  }
  private onChord(at: THREE.Vector3, r: number, heal: boolean, ids: string[], by: string) {
    const L = this.L;
    const g = at.clone().setY(at.y + 0.08);
    // (in the vampire arc the vampire kit adds its own chord rings — vamp(L).chord)
    L.fx.ring(g, r, '#c070ff', 0.55);
    this.later.push({ t: 0.14, f: () => L.fx.ring(g.clone(), r * 0.8, '#e0b0ff', 0.4) });
    this.later.push({ t: 0.28, f: () => L.fx.ring(g.clone(), r * 0.55, '#ffffff', 0.35) });
    L.fx.emit(at.clone().setY(at.y + 1.1), { count: 26, speed: [2, 6], life: [0.3, 0.7], size: [0.06, 0.14], colors: ['#c070ff', '#ff7ad0', '#ffffff'], drag: 2 });
    if (heal) {
      for (const id of ids) {
        const h = this.heroById(id);
        if (!h) continue;
        if (h === L.player) {
          const p = L.player;
          if (p.dead || p.downed) continue;
          const was = p.hp;
          p.hp = Math.min(p.maxHp, p.hp + 1);
          if (p.hp > was) audio.sfx('heal', { pitch: 1.25, volume: 0.7 });
        }
        L.fx.text(h.center().setY(h.pos.y + 1.7), '+1 ♥', '#ff8ab0', 24);
        L.fx.stars(h.center(), 10, ['#ff8ab0', '#ffffff', '#ffd0e0']);
      }
    }
    this.emit({ e: 'chord', at: at.clone(), r, secs: 0, by, heal, ids });
  }

  /** Тоша's «Геройский клич»: every hero in reach (him too) — haste + a one-hit shield */
  call(at: THREE.Vector3, r: number) {
    const ids = this.inReach(at, r);
    this.send({ e: 'call', p: pack(at), r, ids });
    this.onCall(at, r, ids, this.me);
    return ids;
  }
  private onCall(at: THREE.Vector3, r: number, ids: string[], by: string) {
    const L = this.L;
    L.fx.ring(at.clone().setY(at.y + 0.08), r, '#ffe14a', 0.5);
    L.fx.ring(at.clone().setY(at.y + 1.2), 1.6, '#ffffff', 0.35, false);
    L.fx.stars(at.clone().setY(at.y + 1.6), 22, ['#ffe14a', '#ffffff', '#ff8a2a']);
    const caller = this.heroById(by);
    if (caller) L.fx.text(caller.center().setY(caller.pos.y + 2.1), 'Вперёд, команда!', '#ffe14a', 26);
    for (const id of ids) {
      const h = this.heroById(id);
      if (!h) continue;
      if (h === L.player && !L.player.dead && !L.player.downed) { L.player.buff('haste', HASTE_T); L.player.buff('ward', WARD_T); }
      L.fx.ring(h.pos.clone().setY(h.pos.y + 0.05), 1.1, '#ffe14a', 0.4);
    }
    this.emit({ e: 'call', at: at.clone(), r, secs: HASTE_T, by, ids });
  }

  /** Пастила's «Батут-пряник» at `at` (one per owner: a new one replaces the old) */
  pad(at: THREE.Vector3) {
    this.send({ e: 'pad', p: pack(at), s: PAD_T });
    this.onPad(at, PAD_T, this.me);
  }
  private onPad(at: THREE.Vector3, secs: number, by: string) {
    this.pads.get(by)?.dispose(true);
    this.pads.set(by, new JumpPad(this.L, at, secs, by));
    audio.sfx('bounce', { pitch: 0.8, volume: 0.6 });
    this.emit({ e: 'pad', at: at.clone(), r: PAD_R, secs, by });
  }
  /** Пастила's «Сиропный щит» over `at` */
  dome(at: THREE.Vector3, color: string) {
    this.send({ e: 'dome', p: pack(at), r: DOME_R, s: DOME_T, c: color });
    this.onDome(at, DOME_R, DOME_T, color, this.me);
  }
  private onDome(at: THREE.Vector3, r: number, secs: number, color: string, by: string) {
    this.domes.push(new Dome(this.L, at, r, secs, color));
    audio.sfx('splash', { pitch: 0.8, volume: 0.6 });
    this.emit({ e: 'dome', at: at.clone(), r, secs, by });
  }
  /** Пастила's «Маяк-солнышко»: in the vampire arc a real light (vampires inside are weakened ×2 and seen), else a lamp */
  beacon(at: THREE.Vector3) {
    const V = vampOn(this.L);
    if (V) V.light(at, { r: BEACON_R, secs: BEACON_T });
    this.send({ e: 'beacon', p: pack(at), r: BEACON_R, s: BEACON_T, v: V ? 1 : 0 });
    this.onBeacon(at, BEACON_R, BEACON_T, !!V, this.me);
  }
  private onBeacon(at: THREE.Vector3, r: number, secs: number, lit: boolean, by: string) {
    if (!lit) this.beacons.push(new Beacon(this.L, at, r, secs));
    this.emit({ e: 'beacon', at: at.clone(), r, secs, by });
  }
  /** Ноки's slam: the shockwave everyone sees */
  slam(at: THREE.Vector3, r: number) {
    this.send({ e: 'slam', p: pack(at), r });
    this.onSlam(at, r, this.me);
  }
  private onSlam(at: THREE.Vector3, r: number, by: string) {
    const L = this.L;
    L.fx.ring(at.clone().setY(at.y + 0.06), r, '#c070ff', 0.4);
    L.fx.ring(at.clone().setY(at.y + 0.06), r * 0.6, '#ffffff', 0.3);
    L.fx.dust(at.clone(), 12);
    this.emit({ e: 'slam', at: at.clone(), r, secs: 0, by });
  }
  /** my kit's shot: flies here (and hits), friends get its look */
  shot(kind: KitShotKind, from: THREE.Vector3, vel: THREE.Vector3, color: string, hit: ShotHit) {
    this.shots.push(new KitShot(this, kind, from.clone(), vel.clone(), color, hit));
    this.send({ e: 'shot', k: kind, p: pack(from), v: pack(vel), c: color, t: Math.round(net.time() * 1000) / 1000 }, false);
  }

  // ───────── friends' events ─────────
  private handle(d: Record<string, unknown>, from: string) {
    const at = unpack(d.p);
    if (!at) return;
    const ids = Array.isArray(d.ids) ? (d.ids as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
    switch (d.e) {
      case 'chord': this.onChord(at, fin(d.r, 6, 1, 10), !!d.h, ids, from); break;
      case 'call': this.onCall(at, fin(d.r, CALL_R, 1, 10), ids, from); break;
      case 'pad': this.onPad(at, fin(d.s, PAD_T, 1, 30), from); break;
      case 'dome': this.onDome(at, fin(d.r, DOME_R, 1, 5), fin(d.s, DOME_T, 0.5, 10), typeof d.c === 'string' && /^#[0-9a-f]{6}$/i.test(d.c) ? d.c : '#ff78b4', from); break;
      case 'beacon': this.onBeacon(at, fin(d.r, BEACON_R, 1, 12), fin(d.s, BEACON_T, 1, 30), !!d.v, from); break;
      case 'slam': this.onSlam(at, fin(d.r, 2.6, 0.5, 6), from); break;
      case 'shot': {
        const vel = unpack(d.v);
        if (!vel || vel.length() > 60 || (d.k !== 'syrup' && d.k !== 'note')) break;
        const s = new KitShot(this, d.k, at, vel, typeof d.c === 'string' && /^#[0-9a-f]{6}$/i.test(d.c) ? d.c : '#ff3a7a', null);
        if (typeof d.t === 'number' && Number.isFinite(d.t)) s.catchUp(Math.min(0.35, Math.max(0, net.time() - d.t)));
        this.shots.push(s);
        break;
      }
    }
  }

  // ───────── per tick ─────────
  update(dt: number) {
    const L = this.L;
    if (this.inbox.length) { const q = this.inbox; this.inbox = []; for (const m of q) { try { this.handle(m.d, m.from); } catch (err) { console.error('[heroes] hk', err); } } }
    this.greetNew();
    if (this.later.length) {
      for (const l of this.later) l.t -= dt;
      const due = this.later.filter((l) => l.t <= 0);
      this.later = this.later.filter((l) => l.t > 0);
      for (const l of due) l.f();
    }
    // gadgets
    for (const [k, p] of this.pads) { p.update(dt); if (p.dead) this.pads.delete(k); else this.padTouch(p); }
    for (const d of this.domes) d.update(dt);
    if (this.domes.some((d) => d.dead)) this.domes = this.domes.filter((d) => !d.dead);
    for (const b of this.beacons) b.update(dt);
    if (this.beacons.some((b) => b.dead)) this.beacons = this.beacons.filter((b) => !b.dead);
    for (const s of this.shots) s.update(dt);
    if (this.shots.some((s) => s.dead)) this.shots = this.shots.filter((s) => !s.dead);
    this.updateAuras(dt);
    this.updateHint(dt);
  }

  /** a friend's hero just showed up here (a late joiner, a reload): my «Батут-пряник» still standing goes to him
   *  (the cast message went out before his level was there to take it) */
  private greetNew() {
    const nl = this.L.nl;
    if (!nl) return;
    for (const id of this.greeted) if (!nl.remotes.has(id)) this.greeted.delete(id);
    for (const [id, r] of nl.remotes) {
      if (this.greeted.has(id) || r.stale) continue;
      this.greeted.add(id);
      const pad = this.pads.get(this.me);
      if (pad && !pad.dead && pad.life - pad.t > 1) net.send(id, MSG, { e: 'pad', p: pack(pad.obj.position), s: r2(pad.life - pad.t) });
    }
  }

  /** my hero on a jump pad: walking onto it launches too (landing on it bounces through the physics) */
  private padTouch(pad: JumpPad) {
    const L = this.L, p = L.player, b = p.body;
    if (pad.t < 0.3) return;
    const onIt = b.onGround && b.ground === pad.col;
    if (onIt && !p.dead && !p.downed) {
      b.vel.y = PAD_BOUNCE; b.onGround = false; b.ground = null;
      p.jumping = false; p.canDouble = true; p.airDash = true; p.squash = 1.45;
      audio.sfx('bounce', { pitch: 0.9 });
      L.fx.ring(b.pos.clone(), 1.6, '#ffd08a', 0.35);
      pad.kick();
    } else if (b.bounced && Math.hypot(b.pos.x - pad.col.x, b.pos.z - pad.col.z) < PAD_R + 0.5) pad.kick();
    // friends bouncing on their copies: squash mine too
    if (L.nl) for (const r of L.nl.remotes.values()) {
      if (r.vel.y > 12 && Math.hypot(r.pos.x - pad.col.x, r.pos.z - pad.col.z) < PAD_R + 0.4 && r.pos.y - pad.col.y1 < 1.2 && pad.boing <= 0) pad.kick();
    }
  }

  private updateAuras(dt: number) {
    const L = this.L;
    const seen = new Set<HeroLike>();
    for (const h of L.heroes()) {
      seen.add(h);
      const local = h === L.player;
      const bits = local ? (L.player.haste > 0 ? 1 : 0) | (L.player.ward > 0 ? 2 : 0) : (h as RemoteHero3).buffs ?? 0;
      const gadget = local ? (L.player.kind === 'pastila' ? L.player.kit.fx().gadget ?? 0 : 0) : (h as RemoteHero3).fx?.gadget ?? 0;
      let a = this.auras.get(h);
      if (!a && !bits && !gadget) continue;
      if (!a) {
        const wm = basic('#ffe14a', { additive: true, transparent: true, opacity: 0, depthWrite: false });
        const ward = new THREE.Mesh(GEO.sphere, wm);
        noOutline(ward); ward.visible = false;
        L.scene.add(ward);
        a = { ward, wm, k: 0, bits: 0, hasteT: 0, icon: null, iconI: -1 };
        this.auras.set(h, a);
      }
      const hidden = h.hidden || h.dead || L.castHidden;
      // the golden shield (a friend's: popped when its bit drops while he's close to danger — a small burst either way)
      a.k = damp(a.k, bits & 2 && !hidden ? 1 : 0, 10, dt);
      if (a.bits & 2 && !(bits & 2) && !hidden && !local) L.fx.sparks(h.center(), 10, ['#ffe14a', '#ffffff']);
      a.ward.visible = a.k > 0.02;
      if (a.ward.visible) {
        a.ward.position.copy(h.pos).setY(h.pos.y + 0.55);
        a.ward.scale.setScalar(0.78 + Math.sin(L.t * 5) * 0.03);
        a.wm.opacity = 0.2 * a.k;
      }
      // haste: little golden streaks at the feet while running
      if (bits & 1 && !hidden && Math.hypot(h.vel.x, h.vel.z) > 2) {
        a.hasteT -= dt;
        if (a.hasteT <= 0) { a.hasteT = 0.06; L.fx.emit(h.pos.clone().setY(h.pos.y + 0.25), { count: 1, speed: [0.2, 0.6], life: [0.2, 0.35], size: [0.06, 0.12], colors: ['#ffe14a', '#ffffff', '#ffb02a'], drag: 4 }); }
      }
      a.bits = bits;
      // Пастила picking a gadget: its icon over her head
      const gi = gadget > 0.5 ? Math.round(gadget) - 1 : -1;
      if (gi >= 0 && !hidden) {
        if (!a.icon) { a.icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: gadgetTexture(0), transparent: true, depthWrite: false })); a.icon.scale.setScalar(0.7); noOutline(a.icon); L.scene.add(a.icon); }
        if (a.iconI !== gi) { (a.icon.material as THREE.SpriteMaterial).map = gadgetTexture(clamp(gi, 0, 2)); (a.icon.material as THREE.SpriteMaterial).needsUpdate = true; a.iconI = gi; }
        a.icon.visible = true;
        a.icon.position.copy(h.pos).setY(h.pos.y + 1.95 + Math.sin(L.t * 4) * 0.04);
      } else if (a.icon) a.icon.visible = false;
    }
    for (const [h, a] of this.auras) if (!seen.has(h)) { this.dropAura(a); this.auras.delete(h); }
  }
  private dropAura(a: Aura) {
    a.ward.removeFromParent(); a.wm.dispose();
    if (a.icon) { a.icon.removeFromParent(); (a.icon.material as THREE.SpriteMaterial).dispose(); }
  }

  /** the first time I play a hero (outside the prologue): one line about his special */
  private updateHint(dt: number) {
    const L = this.L, p = L.player;
    if (p.kind !== this.hintKind) { this.hintKind = p.kind; this.hintT = 0; }
    if (this.hintT < 0 || isPrologueLevel(L.def.id)) return;
    if (!p.control || L.worldCut || L.letterbox > 0.05 || L.paused || p.dead) return;
    this.hintT += dt;
    if (this.hintT < 1.5) return;
    this.hintT = -1;
    const s = glyphLabel('special');
    const lines: Record<string, string> = {
      tosha: `Тоша: ${s} — «Геройский клич»: тебе и друзьям рядом ускорение и щит от одного удара`,
      bublik: `Бублик: держи ${s} — мост через пропасть, нажми ${s} — батут для друзей`,
      noki: `Ноки: ${s} — «Аккорд»: оглушает вампиров, проявляет невидимок, друзьям рядом +1 ♥`,
      pastila: `Пастила: ${s} — гаджет, держи ${s} — выбрать: батут, сиропный щит, маяк-солнышко`,
    };
    const line = lines[p.kind];
    if (line) L.hint('hero_' + p.kind, line);
  }

  /** the ability chip (special button + cooldown) and the kit's own HUD */
  draw(ctx: CanvasRenderingContext2D) {
    const L = this.L, p = L.player;
    const m = p.kit.meter?.() ?? null;
    // (not over the hub's shop / notice board panels: the chip sat on the shop panel's corner)
    const overlay = !!(L.refs.town as { overlay?: unknown } | undefined)?.overlay;
    const show = !!m && !p.dead && !L.results && !L.complete && L.letterbox < 0.3 && !L.castHidden && !L.dialog.active && !overlay;
    this.chipK = damp(this.chipK, show ? 1 : 0, 10, 1 / 60);
    if (m && this.chipK > 0.02) {
      ctx.save();
      ctx.globalAlpha = this.chipK;
      // bottom right (top left has the hearts and the toasts, bottom left the co-op chat)
      ctx.font = '900 16px Rubik, "Arial Black", sans-serif';
      const lw = ctx.measureText(m.label).width;
      const gw0 = 34, w = Math.max(190, 28 + gw0 + lw + 14), h = 44;
      const x = W - 20 - w, y = H - 78;
      rrect(ctx, x, y, w, h, 14, 'rgba(30,15,15,0.55)', 0);
      const gw = drawGlyph(ctx, 'special', x + 10, y + h / 2, 28, 'left');
      const tx = x + 18 + gw;
      text(ctx, m.label, tx, y + 19, { size: 16, color: '#fff3d8', stroke: 4 });
      const bw = w - (tx - x) - 12, k = clamp(m.k, 0, 1), ready = k >= 1;
      rrect(ctx, tx, y + 26, bw, 9, 4.5, 'rgba(0,0,0,0.45)', 0);
      if (k > 0.02) rrect(ctx, tx, y + 26, Math.max(9, bw * k), 9, 4.5, ready ? '#ffe14a' : '#a88ac8', 0);
      if (ready) { ctx.globalAlpha = this.chipK * (0.35 + 0.35 * Math.sin(L.t * 6)); circle(ctx, x + 10 + gw / 2, y + h / 2, 17, null, 0); ctx.lineWidth = 3; ctx.strokeStyle = '#ffe14a'; ctx.stroke(); }
      ctx.restore();
    }
    if (!p.dead && !L.results) p.kit.hud?.(ctx, L);
  }

  dispose() {
    this.unsub?.(); this.unsub = null;
    for (const p of this.pads.values()) p.dispose();
    this.pads.clear();
    for (const d of this.domes) d.dispose();
    for (const b of this.beacons) b.dispose();
    for (const s of this.shots) s.pop(false);
    for (const a of this.auras.values()) this.dropAura(a);
    this.domes = []; this.beacons = []; this.shots = []; this.auras.clear(); this.subs.clear();
  }

  /** test hooks: what this machine has out */
  get state() {
    return {
      pads: [...this.pads.values()].map((p) => ({ x: r2(p.col.x), z: r2(p.col.z), y: r2(p.col.y1), t: r2(p.t) })),
      domes: this.domes.map((d) => ({ x: r2(d.center.x), z: r2(d.center.z), blocked: d.blocked })),
      beacons: this.beacons.length, shots: this.shots.length,
    };
  }
}

/** the level's hero team hub (created on first use; heroes/index.ts registers it as a level plugin) */
export function team(L: Level3D): HeroTeam {
  let t = L.refs.heroTeam as HeroTeam | undefined;
  if (!t) { t = new HeroTeam(L); L.refs.heroTeam = t; }
  return t;
}
/** hero events of this level, for other modules: heroEvents(L).on('chord', (ev) => …) — see HeroEv */
export const heroEvents = (L: Level3D) => team(L);
