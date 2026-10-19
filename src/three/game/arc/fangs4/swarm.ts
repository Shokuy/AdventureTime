import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { choose, clamp, rand } from '../../../../engine/util';
import { save } from '../../../../engine/save';
import { net } from '../../../../net/session';
import { tmat } from '../../../world/kit';
import { noOutline } from '../../../gfx';
import { coop } from '../../coop';
import { NetTrack, type NetPose } from '../../netInterp';
import type { Level3D, Actor3, HeroLike } from '../../level';
import type { Netted } from '../../netLevel';
import type { RemoteHero3 } from '../../remoteHero';
import { ambient } from '../vampires';
import { swarmBatGeo } from './models';
import { LINES4 } from './lines';

/**
 * The bat swarm (8.2.2): a squeaking cloud that chases the team down the ravine toward the cave (like the prologue's
 * chase King, but a swarm). It wakes when the first hero runs into the ravine, flies a little slower than any hero
 * runs (faster when you are far ahead — it never gives up), and bites whoever it catches up with: −1 ♥ and a shove
 * forward (it falls back a few metres after a bite, so it never chain-bites). At the cave it stops: «в укрытии мыши
 * отстанут». A hero thrown back by a crack makes it stumble back too (one punishment, not two).
 *
 * Co-op: the host flies it after the LAST runner; a straggler far behind the group (or behind the swarm — a respawn at
 * an older candle) is picked up by the bats and dropped by his friends (−1 ♥, never the last one). Clients play the
 * swarm's front back (NetTrack, a teleport counter for the fall-backs); bites are victim-side (each machine tests its
 * own hero against the cloud it shows), the host only hears about them to fall back.
 */

const NET_ID = 94130;
const N = 72;
/** a runner this far behind the next one is a straggler (co-op) */
const STRAGGLE = 24;
const pose: NetPose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };
const isFresh = (h: HeroLike) => h.isLocal || !(h as { stale?: boolean }).stale;
const v1 = new THREE.Vector3();

interface Bat { u: number; v: number; h: number; ph: number; sp: number; r: number }

export class BatSwarm implements Netted, Actor3 {
  netId = 0;
  dead = false;
  /** barks are anchored to the cloud (same object on every machine) */
  root = new THREE.Group();
  get netRoot() { return this.root; }
  /** 0 asleep, 1 chasing, 2 stopped at the cave (swirling away), 3 gone */
  state = 0;
  /** the front of the cloud: metres down the ravine from its mouth */
  front = -20;
  speed = 0;
  stT = 0;
  /** every machine: called when it wakes (barks, toast) */
  onStart: ((L: Level3D) => void) | null = null;
  private mesh: THREE.InstancedMesh;
  private eyes: THREE.InstancedMesh;
  private bats: Bat[] = [];
  private t = 0;
  private tpN = 0;
  private snapFront = NaN;
  private track: NetTrack<number[]> | null = null;
  private lastS = new Map<HeroLike, number>();
  private tossCD = new Map<HeroLike, number>();
  private barkT = 2;
  private biteCD = 0;
  private floorY: number;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s3 = new THREE.Vector3();
  constructor(private L: Level3D, readonly z0: number, readonly zCave: number, readonly cx: number, readonly half: number, readonly topY: number) {
    this.floorY = topY;
    this.mesh = new THREE.InstancedMesh(swarmBatGeo(), tmat(null, '#5a3a78', { emissive: '#6a1a3a', emissiveIntensity: 0.55, side: THREE.DoubleSide }), N);
    this.mesh.frustumCulled = false; this.mesh.castShadow = false;
    // glowing red eyes: the cloud reads in the dark ravine
    const eg = new THREE.SphereGeometry(0.045, 6, 4);
    const e2 = eg.clone().translate(-0.06, 0.08, 0.17); eg.translate(0.06, 0.08, 0.17);
    const eyes = new THREE.BufferGeometry();
    const a = (eg.index ? eg.toNonIndexed() : eg).attributes.position.array as Float32Array, b = (e2.index ? e2.toNonIndexed() : e2).attributes.position.array as Float32Array;
    const pos = new Float32Array(a.length + b.length); pos.set(a); pos.set(b, a.length);
    eyes.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.eyes = new THREE.InstancedMesh(eyes, new THREE.MeshBasicMaterial({ color: '#ff3a4a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), N);
    this.eyes.frustumCulled = false; this.eyes.castShadow = false;
    noOutline(this.eyes);
    L.scene.add(this.eyes);
    this.eyes.visible = false;
    for (let i = 0; i < N; i++) this.bats.push({ u: Math.pow(Math.random(), 0.7), v: rand(-1, 1), h: rand(0, 1), ph: rand(0, 6.28), sp: rand(0.8, 1.4), r: rand(0.7, 1.25) });
    L.scene.add(this.mesh, this.root);
    this.mesh.visible = false;
    if (L.seen.has('f4swarm')) this.state = 3;
    L.actors.push(this);
    L.nl?.add(this, NET_ID);
  }

  /** metres down the ravine */
  sOf(p: THREE.Vector3) { return this.z0 - p.z; }
  get sCave() { return this.z0 - this.zCave; }
  /** in the ravine — or on the plateau before its mouth (where the candle is: a respawn there is a straggler) */
  private inRavine(p: THREE.Vector3) {
    const s = this.sOf(p);
    if (s < -14 || s > this.sCave + 3 || p.y < this.topY - 12 || p.y > this.topY + 6) return false;
    return Math.abs(p.x - this.cx) < (s < 2 ? 13 : this.half + 2);
  }

  update(L: Level3D, dt: number) {
    this.t += dt;
    this.biteCD -= dt;
    if (L.authority) this.host(L, dt); else this.puppet(L, dt);
    if (this.state === 1) this.biteMine(L);
    this.draw(L, dt);
  }

  // ───────── host / solo ─────────
  private host(L: Level3D, dt: number) {
    this.stT += dt;
    const run = L.alivePlayers().filter(isFresh);
    if (this.state === 0) {
      if (L.worldCut) return;
      const s0 = run.filter((h) => this.inRavine(h.pos)).map((h) => this.sOf(h.pos)).filter((s) => s > 2 && s < this.sCave);
      if (!s0.length) return;
      this.state = 1; this.stT = 0;
      this.front = Math.min(...s0) - 16; this.speed = 4;
      this.tpN++;
      if (L.nl) L.nl.entEvent(this, 'start', {});
      this.started(L);
      return;
    }
    if (this.state === 1) {
      const inR = run.filter((h) => this.inRavine(h.pos) || this.sOf(h.pos) > this.sCave);
      // everyone alive is in the cave → the swarm stays out
      if (inR.length && inR.every((h) => this.sOf(h.pos) > this.sCave + 1.5)) { this.finish(L); return; }
      const order = inR.filter((h) => this.sOf(h.pos) <= this.sCave + 1.5).sort((a, b) => this.sOf(a.pos) - this.sOf(b.pos));
      this.backOffThrown(L, order);
      const p = order.find((h) => this.sOf(h.pos) >= this.front - 3) ?? order[0];
      let want = 0;
      if (p && !L.worldCut) {
        const gap = this.sOf(p.pos) - this.front;
        const easy = L.nl ? coop.easy : save.data.settings.easy;
        want = clamp((easy ? 5.6 : 6.3) + (gap - 10) * 0.5, 4.5, 14);
      }
      this.speed += clamp(want - this.speed, -10 * dt, 8 * dt);
      this.front = Math.min(this.front + this.speed * dt, this.sCave - 2.5);
      if (L.nl) this.stragglers(L, order, dt);
      if ((this.barkT -= dt) <= 0) { this.barkT = rand(2.5, 4.5); L.bark(this.root, choose(LINES4.bats as unknown as string[]), 1.3, 1.2); audio.sfx('batScreech', { volume: 0.5, pitch: rand(0.9, 1.2) }); }
      return;
    }
    if (this.state === 2 && this.stT > 3.2) this.state = 3;
  }

  /** every machine: it woke up */
  private started(L: Level3D) {
    ambient(L, () => {
      audio.sfx('batScreech'); audio.sfx('batFlap', { volume: 0.8 });
      try { this.onStart?.(L); } catch (e) { console.error('[fangs4] swarm onStart', e); }
    });
  }
  private finish(L: Level3D) {
    this.state = 2; this.stT = 0; this.speed = 0;
    L.seen.add('f4swarm');
    if (L.nl) L.nl.entEvent(this, 'gone', {});
    ambient(L, () => { L.toast(LINES4.swarmGone); audio.sfx('batScreech', { pitch: 0.8 }); });
  }

  /** a runner thrown back by a crack (not a long respawn): if he's the last one, the swarm falls back too */
  private backOffThrown(L: Level3D, order: HeroLike[]) {
    const last = order.length ? this.sOf(order[0].pos) : Infinity;
    const next = new Map<HeroLike, number>();
    for (const h of L.heroes()) {
      const s = this.sOf(h.pos), was = this.lastS.get(h);
      if (was !== undefined && s < was - 2.5 && s > was - 30 && s <= last + 0.01) this.fallBack(s - 13);
      next.set(h, s);
    }
    this.lastS = next;
  }
  private fallBack(to: number) { if (this.front > to) { this.front = to; this.speed = Math.min(this.speed, 4); } }

  /** co-op: the bats carry a straggler to the group */
  private stragglers(L: Level3D, order: HeroLike[], dt: number) {
    for (const [h, t] of this.tossCD) { if (t <= dt) this.tossCD.delete(h); else this.tossCD.set(h, t - dt); }
    if (!order.length || L.worldCut) return;
    let g = 0, g1 = 0;
    for (let s0 = 0, i = 1; i <= order.length; i++) {
      if (i < order.length && this.sOf(order[i].pos) - this.sOf(order[i - 1].pos) <= STRAGGLE) continue;
      if (i - s0 >= g1 - g) { g = s0; g1 = i; }
      s0 = i;
    }
    let k = 0;
    for (let i = 0; i < order.length; i++) {
      const h = order[i];
      const behind = this.sOf(h.pos) < this.front - 6;
      if (i >= g && !behind) continue;
      if (this.tossCD.has(h) || !h.control) continue;
      const grp = order.slice(g, g1).find((o) => o !== h && this.sOf(o.pos) >= this.front);
      const s = Math.min(this.sCave - 1, grp ? Math.max(this.sOf(grp.pos) - 4 - k * 1.5, this.front + 9) : this.front + 14);
      k++;
      this.tossCD.set(h, 3);
      const id = h.isLocal ? net.myId : (h as unknown as RemoteHero3).id;
      if (h.isLocal) ambient(L, () => this.carried(L, s));
      L.nl?.entEvent(this, 'toss', { to: id, s });
      L.feed(LINES4.swarmFeed(h.isLocal ? (net.members.get(net.myId)?.name ?? 'вас') : (h as unknown as RemoteHero3).name), '#d8b0ff');
    }
  }

  /** owner side: the bats carried me forward to s (−1 ♥, never the last one) */
  private carried(L: Level3D, s: number) {
    const p = L.player;
    if (p.dead || p.downed) return;
    const at = this.landing(L, s);
    L.fx.emit(p.center(), { count: 20, speed: [2, 5], life: [0.4, 0.8], size: [0.15, 0.3], colors: ['#3a2a4e', '#6a4a8a'], drag: 2 });
    L.teleportMe(at.setY(at.y + 2.5));
    p.body.vel.set(0, 2, -4);
    p.forgetSafe(at);
    if (p.hp > 1) { p.hp -= 1; L.stats.hits++; }
    p.flash = 1; p.invuln = Math.max(p.invuln, 1.5);
    audio.sfx('batFlap'); audio.sfx('hurt');
    L.fx.text(p.center().setY(p.pos.y + 1.6), '−1 ♥', '#ff8080', 24);
    L.toast(LINES4.swarmToss);
  }
  private landing(L: Level3D, s: number) {
    for (let k = 0; k < 30; k++) {
      const z = this.z0 - (s + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 1.2);
      const gy = L.phys.groundAt(this.cx, z, this.topY + 3, 0.4);
      if (gy < this.topY - 9) continue;
      if (L.phys.pointInSolid(v1.set(this.cx, gy + 0.6, z)) || L.phys.pointInSolid(v1.set(this.cx, gy + 1.5, z))) continue;
      return new THREE.Vector3(this.cx, gy + 0.05, z);
    }
    return new THREE.Vector3(this.cx, this.topY, this.z0 - s);
  }

  // ───────── every machine: my hero in the cloud ─────────
  private biteMine(L: Level3D) {
    const p = L.player;
    if (p.dead || p.downed || p.hidden || !p.control || p.invuln > 0 || this.biteCD > 0 || L.worldCut) return;
    const s = this.sOf(p.pos);
    if (!this.inRavine(p.pos) || s < 0) return;
    if (s > this.front + 0.4 || s < this.front - 12) return;
    this.biteCD = 1.2;
    if (p.hurt(L, 1, v1.set(p.pos.x, p.pos.y + 0.5, p.pos.z + 2), new THREE.Vector3(0, 8.5, -10), 0.35)) {
      ambient(L, () => { L.bark(this.root, LINES4.bats[2], 1.2, 1.2); audio.sfx('bite'); L.fx.emit(p.center(), { count: 14, speed: [2, 5], life: [0.3, 0.6], size: [0.12, 0.24], colors: ['#3a2a4e', '#6a4a8a', '#ff4a6a'], drag: 2 }); });
    }
    if (L.authority) this.fallBack(this.front - 6); else L.nl?.entEvent(this, 'caught', {});
  }

  // ───────── co-op ─────────
  /** [state, front, speed, stT, tp] */
  netSnap(): number[] {
    if (this.front < this.snapFront - 0.3) this.tpN++;
    this.snapFront = this.front;
    return [this.state, this.front, this.speed, this.stT, this.tpN];
  }
  netApply(a: number[], t?: number) {
    if (t === undefined) return;
    (this.track ??= new NetTrack<number[]>(60, 6)).push(t, 0, 0, a[1], 0, a, a[4] ?? 0);
  }
  netEvent(L: Level3D, ev: string, data: unknown) {
    const d = (data ?? {}) as { to?: string; s?: number };
    if (ev === 'caught' && L.authority) { this.fallBack(this.front - 6); return; }
    if (L.authority) return;
    if (ev === 'start' && this.state === 0) { this.state = 1; this.started(L); }
    else if (ev === 'gone' && this.state < 2) { this.state = 2; this.stT = 0; L.seen.add('f4swarm'); ambient(L, () => L.toast(LINES4.swarmGone)); }
    else if (ev === 'toss') {
      if (d.to === net.myId && typeof d.s === 'number') this.carried(L, d.s);
      else { const r = d.to ? L.remote(d.to) : undefined; if (r) L.feed(LINES4.swarmFeed(r.name), '#d8b0ff'); }
    }
  }
  private puppet(L: Level3D, dt: number) {
    this.stT += dt;
    const tr = this.track, play = L.nl?.playT ?? -Infinity;
    if (tr && tr.eval(play, dt, pose)) {
      this.front = pose.pos.z;
      tr.passed(play, (a) => {
        const st = a[0];
        if (st === 1 && this.state === 0) { this.state = 1; this.started(L); }
        else if (st >= 2 && this.state < 2) { this.state = 2; this.stT = a[3] ?? 0; L.seen.add('f4swarm'); }
        else if (st === 3) this.state = 3;
        this.speed = a[2];
      });
    }
    if (this.state === 2 && this.stT > 3.2) this.state = 3;
  }

  // ───────── the cloud ─────────
  private draw(L: Level3D, dt: number) {
    const on = this.state === 1 || this.state === 2;
    this.mesh.visible = on; this.eyes.visible = on;
    if (!on) return;
    const sF = this.front;
    const zc = this.z0 - (sF - 6);
    const gy = L.phys.groundAt(this.cx, zc, this.topY + 4, 0.3);
    if (gy > this.topY - 14) this.floorY += (gy - this.floorY) * Math.min(1, dt * 4);
    this.root.position.set(this.cx, this.floorY + 2.5, this.z0 - sF + 1);
    const away = this.state === 2 ? clamp(this.stT / 3, 0, 1) : 0;
    for (let i = 0; i < N; i++) {
      const b = this.bats[i];
      const tt = this.t * b.sp + b.ph;
      // the front is dense, the tail thins out; at the cave they swirl up and away
      let s = sF - b.u * 13 + Math.sin(tt * 1.3) * 0.8;
      let x = this.cx + b.v * (this.half - 0.6) + Math.sin(tt * 1.7) * 0.7;
      let y = this.floorY + 0.5 + b.h * 4 + Math.sin(tt * 2.3) * 0.5;
      if (away > 0) {
        const a = tt * 2 + i;
        s = this.sCave - 4 + Math.cos(a) * 3 * (1 - away) - b.u * 3;
        x = this.cx + Math.sin(a) * 3;
        y = this.floorY + 2 + b.h * 4 + away * away * 30;
      }
      const flap = 0.35 + 0.65 * Math.abs(Math.sin(tt * 18));
      this.e.set(Math.sin(tt * 3) * 0.3, Math.PI + Math.sin(tt) * 0.4, Math.sin(tt * 2.1) * 0.3);
      this.q.setFromEuler(this.e);
      const sc = b.r * 1.25 * (1 - away * 0.6);
      this.s3.set(sc * flap * 1.4, sc, sc);
      this.m.compose(v1.set(x, y, this.z0 - s), this.q, this.s3);
      this.mesh.setMatrixAt(i, this.m);
      this.s3.set(sc, sc, sc);
      this.m.compose(v1, this.q, this.s3);
      this.eyes.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.eyes.instanceMatrix.needsUpdate = true;
  }
}
