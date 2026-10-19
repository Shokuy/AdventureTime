import * as THREE from 'three';
import { audio } from '../../engine/audio';
import { clamp, rand } from '../../engine/util';
import { basic, canvasTex, noOutline } from '../gfx';
import { createMeatball } from '../models';
import type { Rig } from '../models/rig';
import type { Level3D } from './level';
import type { Enemy3, EnemyKind } from './enemies';
import { NetTrack, type NetPose } from './netInterp';

/**
 * Pieces of the throne-room fight (King Громадин) that are not the King himself:
 * floor telegraphs, the bowling meatballs, the "rage" halo and the summoned-mob delivery (carry / toss / sleeve).
 *
 * Co-op: telegraphs serialize what they show (netSnap/netApply/netUpdate — clients play them back at NetLevel.playT
 * with the King's palms); every machine rolls its own copy of a bowling ball and only its own hero can be hit by it;
 * the host's crew tells clients what it grabs / flings.
 */

const v1 = new THREE.Vector3();
const netPose: NetPose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };

/**
 * client: the host's snapshots of a floor marker that comes and goes. Hidden samples keep the last spot, and a
 * marker that shows up again counts as a teleport — it appears at its new spot instead of sliding there.
 */
class MarkTrack {
  tr = new NetTrack<number[]>(80);
  private tp = 0;
  private vis = false;
  private at = [0, 0, 0, 0];
  /** visible: [x, y, z, angle] + data (data[0] = 1) */
  push(t: number, vis: boolean, x: number, y: number, z: number, yaw: number, d: number[]) {
    if (vis) { if (!this.vis) this.tp++; this.at = [x, y, z, yaw]; }
    this.vis = vis;
    this.tr.push(t, this.at[0], this.at[1], this.at[2], this.at[3], vis ? d : [0], this.tp);
  }
  /** the pose at the playback (into netPose) and whether it is shown there */
  eval(play: number, dt: number) { return this.tr.eval(play, dt, netPose) && !!this.tr.cur?.[0]; }
}

/**
 * co-op host: run effects that every machine plays for itself (ambient dust, its own hero's hurt, its own copy of a
 * ball) without capturing them for clients. Solo / clients: just runs `f`.
 */
export function uncaptured(L: Level3D, f: () => void) {
  const nl = L.nl;
  if (!nl || !nl.capturing) { f(); return; }
  nl.capturing = false;
  try { f(); } finally { nl.capturing = true; }
}

// ───────────────────────── the hall ─────────────────────────
/**
 * Floor the hero can actually stand on: the open hall (z ≥ front) plus the two pockets beside the throne
 * (|x| ≥ pocketX, down to z0). Attacks clamp their targets to this so no corner is ever "safe".
 */
export const HALL = { x0: -34, x1: 34, z0: -46, z1: 34, front: -21.5, pocketX: 21 };
export const PILLARS: readonly [number, number][] = [[-32, -20], [32, -20], [-32, 10], [32, 10], [-20, 32], [20, 32]];
const PILLAR_R = 2;

/** nearest reachable floor point (y = 0) with a margin from walls; never inside the King, the throne or a pillar */
export function clampFloor(x: number, z: number, m = 0, out = new THREE.Vector3()) {
  x = clamp(x, HALL.x0 + m, HALL.x1 - m);
  z = clamp(z, HALL.z0 + m, HALL.z1 - m);
  if (z < HALL.front && Math.abs(x) < HALL.pocketX) {
    if (HALL.front - z <= HALL.pocketX - Math.abs(x)) z = HALL.front; else x = (x < 0 ? -1 : 1) * HALL.pocketX;
  }
  for (const [px, pz] of PILLARS) {
    const dx = x - px, dz = z - pz, d = Math.hypot(dx, dz), r = PILLAR_R + 0.6 + m * 0.4;
    if (d < r) {
      if (d < 1e-3) { x = px; z = pz + (pz > 0 ? -r : r); } else { x = px + (dx / d) * r; z = pz + (dz / d) * r; }
    }
  }
  return out.set(x, 0, z);
}

/** n landing spots on a ring around `center`, spread out, at least `minD` from `avoid` (the hero) */
export function spotsAround(center: THREE.Vector3, n: number, r0: number, r1: number, avoid: THREE.Vector3, minD: number) {
  const out: THREE.Vector3[] = [];
  const a0 = rand(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    let best = new THREE.Vector3();
    for (let tries = 0; tries < 10; tries++) {
      const a = a0 + (i / n) * Math.PI * 2 + rand(-0.45, 0.45) + tries * 0.7;
      const r = rand(r0, r1);
      const v = clampFloor(center.x + Math.cos(a) * r, center.z + Math.sin(a) * r, 1.5);
      best = v;
      if (Math.hypot(v.x - avoid.x, v.z - avoid.z) >= minD && out.every((o) => o.distanceTo(v) > 1.7)) break;
    }
    out.push(best);
  }
  return out;
}

// ───────────────────────── telegraphs ─────────────────────────
/** floor telegraph: a ring + a fill that grows until impact */
export class Tele {
  g = new THREE.Group();
  private ring: THREE.Mesh;
  private fill: THREE.Mesh;
  private ringM = basic('#fff0a0', { additive: true, opacity: 0.9, depthWrite: false });
  private fillM = basic('#ff8a10', { additive: true, opacity: 0.32, depthWrite: false });
  constructor() {
    for (const m of [this.ringM, this.fillM]) { m.polygonOffset = true; m.polygonOffsetFactor = -6; }
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 56).rotateX(-Math.PI / 2), this.ringM);
    this.fill = new THREE.Mesh(new THREE.CircleGeometry(1, 56).rotateX(-Math.PI / 2), this.fillM);
    this.ring.renderOrder = 4; this.fill.renderOrder = 3;
    this.g.add(this.fill, this.ring);
    noOutline(this.g);
    this.g.visible = false;
  }
  show(x: number, y: number, z: number, r: number, k: number, locked: boolean, t: number) {
    this.g.visible = true;
    this.g.position.set(x, y + 0.06, z);
    this.ring.scale.setScalar(r);
    this.fill.scale.setScalar(Math.max(0.01, r * clamp(k, 0, 1)));
    this.ringM.opacity = locked ? 0.7 + 0.3 * Math.sin(t * 40) : 0.85;
    this.fillM.opacity = locked ? 0.6 : 0.38;
    const l = this.last;
    l.x = x; l.y = y; l.z = z; l.r = r; l.k = k; l.locked = locked;
  }
  hide() { this.g.visible = false; }

  // ── co-op ──
  private last = { x: 0, y: 0, z: 0, r: 1, k: 0, locked: false };
  private net: MarkTrack | null = null;
  /** host: [0] hidden, or [1, x, y, z, r, k, locked] */
  netSnap(out: number[]) {
    if (!this.g.visible) { out.push(0); return; }
    const l = this.last;
    out.push(1, l.x, l.y, l.z, l.r, l.k, l.locked ? 1 : 0);
  }
  /** client: read a record (host time ht) at a[i]; returns the index after it */
  netApply(a: number[], i: number, ht: number) {
    const vis = !!a[i];
    (this.net ??= new MarkTrack()).push(ht, vis, a[i + 1], a[i + 2], a[i + 3], 0, vis ? [1, a[i + 4], a[i + 5], a[i + 6]] : [0]);
    return vis ? i + 7 : i + 1;
  }
  /** client: show what the host showed at the playback time `play` (pulses run on the local clock t) */
  netUpdate(dt: number, t: number, play: number) {
    const n = this.net;
    if (!n || !n.eval(play, dt)) { this.hide(); return; }
    const p = netPose.pos;
    this.show(p.x, p.y, p.z, n.tr.lerp(1), n.tr.lerp(2), !!n.tr.cur![3], t);
  }
}

/** a glowing band on the floor: "something big slides along here" */
export class Stripe {
  mesh: THREE.Mesh;
  private m = basic('#ff9a20', { additive: true, opacity: 0.3, depthWrite: false });
  constructor() {
    this.m.polygonOffset = true; this.m.polygonOffsetFactor = -6;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.m);
    this.mesh.renderOrder = 3;
    noOutline(this.mesh);
    this.mesh.visible = false;
  }
  /** axis-aligned band */
  show(x0: number, x1: number, z0: number, z1: number, y: number, t: number, hot = 0) {
    this.mesh.visible = true;
    this.mesh.rotation.y = 0;
    this.mesh.position.set((x0 + x1) / 2, y + 0.07, (z0 + z1) / 2);
    this.mesh.scale.set(Math.max(0.01, x1 - x0), 1, Math.max(0.01, z1 - z0));
    this.pulse(t, hot);
  }
  /** band of width w from (ax,az) to (bx,bz) */
  band(ax: number, az: number, bx: number, bz: number, w: number, y: number, t: number, hot = 0) {
    const dx = bx - ax, dz = bz - az;
    this.mesh.visible = true;
    this.mesh.position.set((ax + bx) / 2, y + 0.07, (az + bz) / 2);
    this.mesh.rotation.y = Math.atan2(dx, dz);
    this.mesh.scale.set(w, 1, Math.max(0.01, Math.hypot(dx, dz)));
    this.pulse(t, hot);
  }
  private pulse(t: number, hot: number) {
    this.hot = hot;
    this.m.opacity = 0.3 + 0.25 * (0.5 + 0.5 * Math.sin(t * (16 + hot * 14))) + hot * 0.15;
  }
  hide() { this.mesh.visible = false; }

  // ── co-op ──
  private hot = 0;
  private net: MarkTrack | null = null;
  /** host: [0] hidden, or [1, px, py, pz, rotY, sx, sz, hot] */
  netSnap(out: number[]) {
    if (!this.mesh.visible) { out.push(0); return; }
    const m = this.mesh;
    out.push(1, m.position.x, m.position.y, m.position.z, m.rotation.y, m.scale.x, m.scale.z, this.hot);
  }
  /** client: read a record (host time ht) at a[i]; returns the index after it */
  netApply(a: number[], i: number, ht: number) {
    const vis = !!a[i];
    (this.net ??= new MarkTrack()).push(ht, vis, a[i + 1], a[i + 2], a[i + 3], a[i + 4], vis ? [1, a[i + 5], a[i + 6], a[i + 7]] : [0]);
    return vis ? i + 8 : i + 1;
  }
  /** client: show what the host showed at the playback time `play` */
  netUpdate(dt: number, t: number, play: number) {
    const n = this.net;
    if (!n || !n.eval(play, dt)) { this.hide(); return; }
    const m = this.mesh;
    m.visible = true;
    m.position.copy(netPose.pos);
    m.rotation.y = netPose.yaw;
    m.scale.set(Math.max(0.01, n.tr.lerp(1)), 1, Math.max(0.01, n.tr.lerp(2)));
    this.pulse(t, n.tr.cur![3]);
  }
}

// ───────────────────────── bowling meatball ─────────────────────────
const MEAT_COLS = ['#8c4a2c', '#6a3218', '#c8402a'];

/**
 * A giant meatball the King bowls toward the entrance (+z) along a telegraphed lane.
 * Hurts (1) and knocks back; clear it with a double jump or step off the lane; 3 sword hits (or a pillar / the far wall) smash it.
 * It also bowls over any guard in its way.
 */
export class BowlBall {
  static R = 1.2;
  root = new THREE.Group();
  rig: Rig<{ roll: number; flash: number }>;
  pos: THREE.Vector3;
  v = 3; hp = 3; dead = false; t = 0; roll = 0; flash = 0;
  /** co-op: the host's number for this ball (clients roll their own copy of it) */
  id = 0;
  hitIds = new Set<number>();
  private hitEnemies = new Set<Enemy3>();
  private rumble = 0;
  constructor(L: Level3D, x: number, z: number, public speed: number, public floorY = 0) {
    this.rig = createMeatball();
    this.rig.root.scale.setScalar(BowlBall.R / 0.45);
    this.root.add(this.rig.root);
    this.pos = new THREE.Vector3(x, floorY, z);
    this.root.position.copy(this.pos);
    L.scene.add(this.root);
  }
  center(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + BowlBall.R, this.pos.z); }

  update(L: Level3D, dt: number) {
    if (this.dead) return;
    const R = BowlBall.R;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.v = Math.min(this.speed, this.v + this.speed * 2.2 * dt);
    this.pos.z += this.v * dt;
    this.roll += (this.v * dt) / R;
    this.root.position.copy(this.pos);
    this.root.position.y += Math.abs(Math.sin(this.roll * 2)) * 0.06;
    this.rig.update(dt, { roll: this.roll, flash: this.flash });
    const c = this.center();
    // (co-op: every machine rolls its own copy — the rumble and the hit on this machine's hero stay local)
    uncaptured(L, () => {
      this.rumble -= dt;
      if (this.rumble <= 0) {
        this.rumble = 0.22;
        L.fx.dust(v1.set(this.pos.x + rand(-0.8, 0.8), this.pos.y, this.pos.z - 0.6), 3, '#c8b0e0');
        if (Math.random() < 0.4) audio.sfx('thud', { volume: 0.18, pitch: rand(0.45, 0.6) });
      }
      // the hero: a sphere vs his capsule (feet must clear ~2.4 m → double jump)
      const p = L.player;
      if (!p.dead && !p.grabbedBy) {
        const cy = clamp(c.y, p.pos.y + p.body.r, p.pos.y + p.body.h - 0.2);
        const d = Math.hypot(p.pos.x - c.x, cy - c.y, p.pos.z - c.z);
        if (d < R + p.body.r - 0.05) {
          const side = p.pos.x >= c.x ? 1 : -1;
          if (p.hurt(L, 1, c.clone().setZ(c.z - 1))) {
            p.body.vel.set(side * 6, 9, this.v * 0.55 + 4);
            p.knockT = 0.4;
            audio.sfx('bounce', { pitch: 0.6 });
          }
        }
      }
    });
    // it bowls over the King's own guards too (the host decides; Enemy3.hurt ignores clients)
    for (const e of L.enemies) {
      if (e.dead || e.spawnT > 0 || this.hitEnemies.has(e)) continue;
      if (Math.hypot(e.body.pos.x - c.x, e.body.pos.z - c.z) < R + e.body.r && e.body.pos.y < c.y + R) {
        this.hitEnemies.add(e);
        e.hurt(L, 2, c.clone().setZ(c.z - 1.5), 'ball');
      }
    }
    if (this.pos.z > HALL.z1 + 1.6 - R) { this.smashApart(L); return; }
    for (const [px, pz] of PILLARS) if (Math.hypot(this.pos.x - px, this.pos.z - pz) < PILLAR_R + R) { this.smashApart(L); return; }
  }

  /** does a sword swing centred at c with this reach touch the ball? */
  touches(c: THREE.Vector3, reach: number) { return this.center(v1).distanceTo(c) < reach + BowlBall.R * 0.9; }

  /** a sword hit or a pea; 3 of them smash it (co-op clients replay the host's hits with drop = false) */
  struck(L: Level3D, at: THREE.Vector3, drop = true) {
    if (this.dead) return;
    this.hp--; this.flash = 1;
    this.v *= 0.6;
    uncaptured(L, () => {
      audio.sfx('hit', { pitch: 0.7 });
      L.fx.sparks(at.clone(), 10);
      L.fx.emit(this.center(), { count: 10, speed: [2, 5], life: [0.3, 0.6], size: [0.12, 0.22], colors: MEAT_COLS, g: 14 });
      L.fx.text(this.center().setY(this.pos.y + BowlBall.R * 2 + 0.6), this.hp > 0 ? `${3 - this.hp}/3` : 'ХРЯСЬ!', '#ffe14a', 22);
    });
    if (this.hp <= 0) { this.smashApart(L); if (drop) L.dropPickup('crumb', this.center()); }
  }

  smashApart(L: Level3D) {
    if (this.dead) return;
    this.dead = true;
    const c = this.center();
    L.scene.remove(this.root);
    uncaptured(L, () => {
      L.fx.chunks(c, 22, MEAT_COLS, this.floorY, [0.14, 0.3]);
      L.fx.juice(c, 18, ['#a8402a', '#c86040', '#e8a060'], this.floorY);
      L.fx.dust(c.clone().setY(this.floorY), 10, '#c8b0e0');
      audio.sfx('crumble', { pitch: 0.7 }); audio.sfx('splash', { volume: 0.6 });
      L.tcam.shake(0.18);
    });
  }
}

// ───────────────────────── rage halo ─────────────────────────
let auraTex: THREE.Texture | null = null;
function auraTexture() {
  if (auraTex) return auraTex;
  auraTex = canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  return auraTex;
}
/** a red glow behind the King's head (phase 2 faint, phase 3 pulsing) */
export class RageAura {
  sprite: THREE.Sprite;
  private m: THREE.SpriteMaterial;
  constructor() {
    this.m = new THREE.SpriteMaterial({ map: auraTexture(), color: '#ff3a20', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.sprite = new THREE.Sprite(this.m);
    this.sprite.renderOrder = 2;
    noOutline(this.sprite);
    this.sprite.visible = false;
  }
  set(at: THREE.Vector3, scale: number, opacity: number) {
    this.sprite.visible = opacity > 0.01;
    this.sprite.position.copy(at);
    this.sprite.scale.setScalar(scale);
    this.m.opacity = opacity;
  }
}

// ───────────────────────── summoned mobs ─────────────────────────
interface Held { e: Enemy3; anchor: () => THREE.Vector3; off: THREE.Vector3 }
interface Flight { e: Enemy3; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; h: number; spin: number; mark: Tele }

/**
 * Mobs the King brings in: they ride in his fist (inert, untouchable), then fly in an arc to a marked landing spot
 * near the hero, where they wake up already hunting him (provoke) and carry only a little loot.
 */
export class SummonCrew {
  held: Held[] = [];
  flights: Flight[] = [];
  private pool: Tele[] = [];
  private time = 0;
  /** co-op host: tell clients what the fist picked up / threw (set by the King) */
  onGrab: ((e: Enemy3, off: THREE.Vector3) => void) | null = null;
  onFling: ((e: Enemy3, to: THREE.Vector3, dur: number, h: number) => void) | null = null;
  constructor(private scene: THREE.Scene) {}

  get count() { return this.held.length + this.flights.length; }

  /** spawn an inert mob held at anchor()+off (co-op: it appears on every machine) */
  grab(L: Level3D, kind: EnemyKind, anchor: () => THREE.Vector3, off: THREE.Vector3) {
    const a = anchor();
    const e = L.spawnEnemy(kind, a.x + off.x, a.y + off.y, a.z + off.z, { range: 8 });
    e.loot = 1; e.spawnT = 99;
    this.held.push({ e, anchor, off });
    this.onGrab?.(e, off);
    return e;
  }

  /** co-op client: the host's fist picked up `e` (already spawned by the host) */
  hold(e: Enemy3, anchor: () => THREE.Vector3, off: THREE.Vector3) {
    if (this.held.some((x) => x.e === e)) return;
    e.loot = 1; e.spawnT = 99;
    this.held.push({ e, anchor, off });
  }

  /** send a held (or free) mob flying to `to` (its feet; books hover there); quiet = a client replaying the host */
  fling(e: Enemy3, to: THREE.Vector3, dur: number, h: number, quiet = false) {
    const i = this.held.findIndex((x) => x.e === e);
    if (i >= 0) this.held.splice(i, 1);
    const j = this.flights.findIndex((x) => x.e === e);
    if (j >= 0) { const f = this.flights[j]; f.mark.hide(); this.pool.push(f.mark); this.flights.splice(j, 1); }
    let mark = this.pool.pop();
    if (!mark) { mark = new Tele(); this.scene.add(mark.g); }
    this.flights.push({ e, from: e.body.pos.clone(), to: to.clone(), t: 0, dur, h, spin: rand(-9, 9), mark });
    if (!quiet) audio.sfx('throw', { pitch: rand(1.1, 1.4), volume: 0.6 });
    this.onFling?.(e, to, dur, h);
  }

  /** the delivery was interrupted: everything still in the fist tumbles out near `near` */
  scatter(L: Level3D, near: THREE.Vector3) {
    const list = this.held.map((h) => h.e);
    const spots = spotsAround(near, list.length, 3, 6, L.targetFor(near).pos, 2.5);
    list.forEach((e, i) => this.fling(e, e.flying ? spots[i].setY(2.4) : spots[i], 0.9, 3));
  }

  update(L: Level3D, dt: number) {
    this.time += dt;
    for (let i = this.held.length - 1; i >= 0; i--) {
      const h = this.held[i];
      if (h.e.dead) { this.held.splice(i, 1); continue; }
      const p = v1.copy(h.anchor()).add(h.off);
      h.e.spawnT = 99;
      h.e.body.pos.copy(p); h.e.body.vel.set(0, 0, 0);
      h.e.root.position.copy(p);
      h.e.root.scale.setScalar(0.8);
      h.e.root.rotation.set(Math.sin(this.time * 9 + i) * 0.25, h.e.yaw, Math.cos(this.time * 7 + i) * 0.25);
    }
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      if (f.e.dead) { f.mark.hide(); this.pool.push(f.mark); this.flights.splice(i, 1); continue; }
      f.t += dt;
      const k = clamp(f.t / f.dur, 0, 1);
      const p = v1.lerpVectors(f.from, f.to, k);
      p.y += 4 * f.h * k * (1 - k);
      f.e.spawnT = 99;
      f.e.body.pos.copy(p); f.e.body.vel.set(0, 0, 0);
      f.e.root.position.copy(p);
      f.e.root.scale.setScalar(0.8 + 0.2 * k);
      f.e.root.rotation.set(f.spin * k * (1 - k) * 1.5, f.e.yaw + f.spin * k * 0.3, 0);
      f.mark.show(f.to.x, 0, f.to.z, 1.3, k, k > 0.75, this.time);
      if (k >= 1) {
        this.flights.splice(i, 1);
        f.mark.hide(); this.pool.push(f.mark);
        this.land(L, f);
      }
    }
  }

  private land(L: Level3D, f: Flight) {
    const e = f.e;
    e.spawnT = 0;
    e.body.pos.copy(f.to); e.body.vel.set(0, 0, 0);
    e.root.position.copy(f.to);
    e.root.scale.setScalar(1);
    e.root.rotation.set(0, e.yaw, 0);
    if (e.flying) e.home.copy(f.to);
    const tp = L.targetFor(f.to).pos;
    e.yaw = Math.atan2(tp.x - f.to.x, tp.z - f.to.z);
    if (L.authority) e.provoke(L);
    const g = f.to.clone().setY(e.flying ? 0 : f.to.y);
    L.fx.dust(g, 10, '#e8d8c0');
    L.fx.ring(g.setY(g.y + 0.1), 1.6, '#ffffff', 0.3);
    audio.sfx('thud', { volume: 0.5, pitch: 1.2 });
  }

  /** boss defeated / level torn down */
  clear() {
    for (const f of this.flights) { f.mark.hide(); this.pool.push(f.mark); }
    this.flights.length = 0;
    this.held.length = 0;
  }
}
