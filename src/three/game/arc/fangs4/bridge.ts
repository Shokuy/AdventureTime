import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { rand } from '../../../../engine/util';
import { net } from '../../../../net/session';
import { tmat } from '../../../world/kit';
import { woodPlanksTex } from '../../../world/textures';
import type { Level3D, Actor3, HeroLike } from '../../level';
import type { Netted } from '../../netLevel';
import type { BoxCol } from '../../../physics/types';
import { ambient } from '../vampires';

/**
 * A rope bridge over a chasm whose planks give way (fangs4, script 8.2.1 «Мост рушится! Бегом!»):
 *  • 'wave' — the first hero who steps on it starts a collapse that runs after him from the near end at WAVE m/s
 *    (slower than any hero runs): keep running and you make it. When it has all gone, the planks hang back on their
 *    ropes after a few seconds (stragglers try again);
 *  • 'step' — every plank shakes and drops 0.6 s after a hero lands on it, and hangs back 4 s later.
 * The handrail ropes stay: you fall between them, never off the side. Planks are tagged 'moving' (never a safe spot:
 * a fall puts you back on the rock before the bridge).
 *
 * Co-op: one clock for everyone (net.time(), the host's): the host decides when a collapse / a plank starts (its own
 * hero, or a client's 'step' request — the client that stands on it asks at once), sends the start time, and every
 * machine plays the same collapse from it at the same moment. Its snapshot repeats the state for late loaders.
 */

const WAVE = 5.6;
const SHAKE = 0.5;
const HANG_BACK = 4.5;
const STEP_FALL = 0.6;
const STEP_BACK = 4;
const RISE = 0.7;

interface Plank {
  col: BoxCol; obj: THREE.Group; top: number; z0: number; z1: number;
  /** 0 ok, 1 shaking, 2 fallen, 3 hanging back */
  st: number;
  /** step mode: host clock time it falls (NaN: none) */
  at: number;
  y: number; vy: number; spin: THREE.Vector3; fallT: number;
}

const clk = (L: Level3D) => (L.nl ? net.time() : L.t);

export class CrumbleBridge implements Netted, Actor3 {
  netId = 0;
  dead = false;
  planks: Plank[] = [];
  /** wave mode: start time of the running collapse (NaN = idle) */
  t0 = NaN;
  /** called on every machine when a collapse starts (wave) / the first plank of the bridge goes (step) */
  onCollapse: ((L: Level3D) => void) | null = null;
  /** wave mode, every machine: the planks hang on their ropes again */
  onWhole: ((L: Level3D) => void) | null = null;
  private asked = new Set<number>();
  private askT = 0;
  private len: number;
  readonly zA: number; readonly zB: number;
  constructor(private L: Level3D, readonly mode: 'wave' | 'step', readonly cx: number, zA: number, zB: number, readonly top: number, readonly w = 2.6, o: { sag?: number; id?: number; planks?: number } = {}) {
    this.zA = zA; this.zB = zB;
    const span = Math.abs(zB - zA), dir = Math.sign(zB - zA);
    const n = o.planks ?? Math.max(4, Math.round(span / 1.35));
    this.len = span / n;
    const sag = o.sag ?? Math.min(0.6, span * 0.025);
    const wood = tmat(woodPlanksTex('warm', 1), '#d8b890'), rope = tmat(null, '#a07a4a');
    for (let i = 0; i < n; i++) {
      const za = zA + dir * i * this.len, zb = zA + dir * (i + 1) * this.len;
      const t = top - sag * Math.sin(Math.PI * (i + 0.5) / n);
      const obj = new THREE.Group();
      const board = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, this.len * 0.88), wood);
      board.position.y = -0.08; board.castShadow = true; board.receiveShadow = true;
      obj.add(board);
      for (const s of [1, -1]) {
        const tie = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 4, 8), rope);
        tie.position.set(s * (w / 2 - 0.08), -0.02, 0); tie.rotation.y = Math.PI / 2;
        obj.add(tie);
      }
      obj.position.set(cx, t, (za + zb) / 2);
      obj.rotation.z = (i % 3 - 1) * 0.02;
      L.deco(obj);
      const col: BoxCol = { kind: 'box', min: new THREE.Vector3(cx - w / 2, t - 0.16, Math.min(za, zb)), max: new THREE.Vector3(cx + w / 2, t, Math.max(za, zb)), tag: 'moving' };
      L.col(col);
      this.planks.push({ col, obj, top: t, z0: Math.min(za, zb), z1: Math.max(za, zb), st: 0, at: NaN, y: t, vy: 0, spin: new THREE.Vector3(), fallT: 0 });
    }
    // ropes: handrails (solid) and the lower ropes the planks hang on; posts at both ends
    const zs = this.planks.map((p) => (p.z0 + p.z1) / 2);
    const tops = this.planks.map((p) => p.top);
    for (const s of [1, -1]) {
      const x = cx + s * (w / 2 + 0.05);
      for (const [dy, r] of [[1.05, 0.05], [0.0, 0.04]] as const) {
        const pts = [new THREE.Vector3(x, top + dy + 0.2, zA), ...zs.map((z, i) => new THREE.Vector3(x, tops[i] + dy, z)), new THREE.Vector3(x, top + dy + 0.2, zB)];
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 3, r, 5), rope);
        tube.castShadow = true;
        L.deco(tube);
      }
      L.col({ kind: 'box', min: new THREE.Vector3(x - 0.12, Math.min(...tops) - 0.4, Math.min(zA, zB)), max: new THREE.Vector3(x + 0.12, top + 1.3, Math.max(zA, zB)) });
      for (const z of [zA, zB]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.2, 8), tmat(null, '#7a4a2c'));
        post.position.set(x, top + 0.6, z); post.castShadow = true;
        L.deco(post);
      }
    }
    L.actors.push(this);
    L.nl?.add(this, o.id);
  }

  get span() { return this.len * this.planks.length; }

  /** a hero stands on plank i (or -1) */
  private plankOf(h: HeroLike): number {
    const p = h.pos;
    if (Math.abs(p.x - this.cx) > this.w / 2 + 0.3) return -1;
    for (let i = 0; i < this.planks.length; i++) {
      const k = this.planks[i];
      if (p.z >= k.z0 - 0.2 && p.z <= k.z1 + 0.2 && Math.abs(p.y - k.top) < 0.45) return i;
    }
    return -1;
  }

  update(L: Level3D, dt: number) {
    const now = clk(L);
    if (L.authority) this.decide(L, now);
    else this.ask(L, dt);
    this.animate(L, now, dt);
  }

  /** host / solo: who stands where — start the collapse / drop the planks */
  private decide(L: Level3D, now: number) {
    if (L.worldCut) return;
    for (const h of L.alivePlayers()) {
      const i = this.plankOf(h);
      if (i < 0) continue;
      this.stepped(L, i, now);
    }
  }
  private stepped(L: Level3D, i: number, now: number) {
    if (this.mode === 'wave') {
      if (!Number.isNaN(this.t0) || this.planks.some((p) => p.st !== 0)) return;
      this.start(L, now + 0.3, true);
    } else {
      const k = this.planks[i];
      if (k.st !== 0 || !Number.isNaN(k.at)) return;
      this.dropAt(L, i, now + STEP_FALL, true);
    }
  }

  /** client: my own hero stands on a plank — ask the host (a few times a second at most) */
  private ask(L: Level3D, dt: number) {
    this.askT -= dt;
    const p = L.player;
    if (p.dead || p.downed || !p.body.onGround) return;
    const i = this.plankOf(p);
    if (i < 0) return;
    const k = this.planks[i];
    const idle = this.mode === 'wave' ? Number.isNaN(this.t0) : k.st === 0 && Number.isNaN(k.at);
    if (!idle) return;
    if (this.asked.has(i) && this.askT > 0) return;
    this.asked.add(i); this.askT = 0.3;
    L.nl?.entEvent(this, 'step', { i });
  }

  private start(L: Level3D, t0: number, announce: boolean) {
    this.t0 = t0;
    if (announce && L.nl?.isHost) L.nl.entEvent(this, 'wave', { t0 });
    this.collapseFx(L);
  }
  private dropAt(L: Level3D, i: number, at: number, announce: boolean) {
    const k = this.planks[i];
    if (!k) return;
    const first = this.planks.every((p) => p.st === 0 && Number.isNaN(p.at));
    k.at = at;
    if (announce && L.nl?.isHost) L.nl.entEvent(this, 'pl', { i, at });
    ambient(L, () => audio.sfx('crumble', { volume: 0.5, pitch: rand(0.9, 1.2) }));
    if (first) this.collapseFx(L);
  }
  private collapseFx(L: Level3D) {
    ambient(L, () => {
      audio.sfx('crumble', { volume: 0.8 }); audio.sfx('warn', { pitch: 0.7, volume: 0.5 });
      if (this.near(L, 30)) L.tcam.shake(0.35);
    });
    // (every machine runs it itself: never captured and re-sent by the host)
    ambient(L, () => { try { this.onCollapse?.(L); } catch (e) { console.error('[fangs4] bridge onCollapse', e); } });
  }
  private near(L: Level3D, r: number) { const p = L.player.pos; return Math.abs(p.x - this.cx) < r && p.z < Math.max(this.zA, this.zB) + r && p.z > Math.min(this.zA, this.zB) - r; }

  /** every machine: the planks from the shared clock */
  private animate(L: Level3D, now: number, dt: number) {
    const n = this.planks.length;
    if (this.mode === 'wave' && !Number.isNaN(this.t0)) {
      const s = (now - this.t0) * WAVE;
      const end = this.t0 + this.span / WAVE + HANG_BACK;
      for (let i = 0; i < n; i++) {
        const k = this.planks[i];
        const d = i * this.len;
        if (now >= end) { if (k.st === 2 || k.st === 1) this.hangBack(k); }
        else if (s >= d) { if (k.st < 2) this.fall(L, k); }
        else if (s >= d - SHAKE * WAVE && k.st === 0) k.st = 1;
      }
      if (now >= end) {
        this.t0 = NaN;
        ambient(L, () => { try { this.onWhole?.(L); } catch (e) { console.error('[fangs4] bridge onWhole', e); } });
      }
    }
    if (this.mode === 'step') {
      for (const k of this.planks) {
        if (Number.isNaN(k.at)) continue;
        if (now >= k.at + STEP_BACK) { k.at = NaN; this.hangBack(k); }
        else if (now >= k.at) { if (k.st < 2) this.fall(L, k); }
        else if (k.st === 0) k.st = 1;
      }
    }
    for (const k of this.planks) {
      const o = k.obj;
      switch (k.st) {
        case 0: o.position.y = k.top; o.position.x = this.cx; break;
        case 1: o.position.x = this.cx + Math.sin(L.t * 55 + k.z0) * 0.05; o.position.y = k.top + Math.sin(L.t * 41) * 0.03; break;
        case 2:
          k.fallT += dt;
          k.vy -= 28 * dt; k.y += k.vy * dt;
          o.position.y = k.y;
          o.rotation.x += k.spin.x * dt; o.rotation.z += k.spin.z * dt;
          o.visible = k.fallT < 2.5;
          break;
        case 3: {
          k.fallT += dt;
          const u = Math.min(1, k.fallT / RISE);
          o.visible = true;
          o.rotation.set(0, 0, 0);
          o.position.x = this.cx;
          o.position.y = k.top - 3 * (1 - u) + Math.sin(u * Math.PI) * 0.25;
          if (u >= 1) { k.st = 0; k.col.active = true; }
          break;
        }
      }
    }
  }

  private fall(L: Level3D, k: Plank) {
    k.st = 2; k.col.active = false;
    k.y = k.top; k.vy = rand(-1, 1); k.fallT = 0;
    k.spin.set(rand(-3, 3), 0, rand(-4, 4));
    if (this.near(L, 24) && Math.random() < 0.5) ambient(L, () => { audio.sfx('break', { volume: 0.35, pitch: rand(0.9, 1.3) }); L.fx.chunks(new THREE.Vector3(this.cx, k.top, (k.z0 + k.z1) / 2), 6, ['#c8945a', '#7a4a2c'], k.top - 20, [0.06, 0.14]); });
  }
  private hangBack(k: Plank) { k.st = 3; k.fallT = 0; }

  /** the planks are all in place (nobody has to wait) */
  get whole() { return this.planks.every((p) => p.st === 0) && Number.isNaN(this.t0); }

  // ── co-op ──
  netEvent(L: Level3D, ev: string, data: unknown) {
    const d = (data ?? {}) as { i?: number; t0?: number; at?: number };
    if (ev === 'step' && L.authority) { if (typeof d.i === 'number' && d.i >= 0 && d.i < this.planks.length) this.stepped(L, d.i, clk(L)); return; }
    if (L.authority) return;
    if (ev === 'wave' && typeof d.t0 === 'number' && Number.isNaN(this.t0)) this.start(L, d.t0, false);
    if (ev === 'pl' && typeof d.i === 'number' && typeof d.at === 'number' && this.planks[d.i] && Number.isNaN(this.planks[d.i].at)) this.dropAt(L, d.i, d.at, false);
  }
  /** wave: [t0 or -1]; step: [n, (i, at)…] (host clock) */
  netSnap(): number[] {
    if (this.mode === 'wave') return [Number.isNaN(this.t0) ? -1 : this.t0];
    const out: number[] = [0];
    this.planks.forEach((k, i) => { if (!Number.isNaN(k.at)) { out.push(i, k.at); out[0]++; } });
    return out;
  }
  netApply(a: number[]) {
    const L = this.L;
    if (this.mode === 'wave') { if (a[0] > 0 && Number.isNaN(this.t0) && net.time() < a[0] + this.span / WAVE + HANG_BACK - 0.5) this.start(L, a[0], false); return; }
    for (let j = 0; j < a[0]; j++) {
      const i = a[1 + j * 2], at = a[2 + j * 2];
      const k = this.planks[i];
      if (k && Number.isNaN(k.at) && net.time() < at + STEP_BACK - 0.3) this.dropAt(L, i, at, false);
    }
  }
}
