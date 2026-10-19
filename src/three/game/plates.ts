import * as THREE from 'three';
import { audio } from '../../engine/audio';
import { clamp, damp, rand, W, H } from '../../engine/util';
import { rrect, text, OUT } from '../../art/draw';
import { mat, matU, basic, mesh, noOutline, PAL } from '../gfx';
import { toUI } from '../runtime';
import { coop } from './coop';
import type { Level3D, HeroLike } from './level';
import type { Netted } from './netLevel';
import { NetTrack, type NetPose } from './netInterp';
import type { PickKind } from './objects';
import type { CylCol } from '../physics/types';

/**
 * Feature 15 — two-player plates: a pair of glowing pressure plates and a caged co-op stash.
 * The cage opens (for good) only while BOTH plates are pressed by heroes at the same time; solo (or a room of one)
 * needs a single plate. The host / solo game decides; clients press the plates under the heroes they draw (their
 * own and the friends' played back) and open when the host says so, at the playback time (NetLevel.playT). The prize is per player, like all loot: every machine spills its own copy.
 */

const PLATE_R = 1.05;
const CAGE_R = 1.3;
const CAGE_H = 2.5;
const BARS = 14;
/** the prize: 5 big crumbs and a honey jar for every hero */
const PRIZE: PickKind[] = ['bigcrumb', 'bigcrumb', 'bigcrumb', 'bigcrumb', 'bigcrumb', 'honey'];

const geo = {
  base: new THREE.CylinderGeometry(PLATE_R + 0.12, PLATE_R + 0.2, 0.14, 28),
  top: new THREE.CylinderGeometry(PLATE_R - 0.12, PLATE_R - 0.08, 0.1, 28),
  ring: new THREE.TorusGeometry(PLATE_R + 0.02, 0.05, 6, 40),
  foot: new THREE.SphereGeometry(1, 12, 8),
  bead: new THREE.SphereGeometry(0.075, 8, 6),
  bar: new THREE.CylinderGeometry(0.07, 0.07, CAGE_H, 8),
  hoop: new THREE.TorusGeometry(CAGE_R, 0.09, 8, 40),
  dome: new THREE.SphereGeometry(CAGE_R + 0.05, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  knob: new THREE.SphereGeometry(0.2, 12, 8),
  stand: new THREE.CylinderGeometry(0.5, 0.62, 0.4, 20),
  jar: new THREE.CylinderGeometry(0.2, 0.22, 0.36, 16),
  lid: new THREE.CylinderGeometry(0.25, 0.25, 0.08, 16),
  rusk: new THREE.BoxGeometry(0.26, 0.12, 0.17),
  halo: new THREE.SphereGeometry(1, 16, 10),
};

interface Plate {
  at: THREE.Vector3;
  grp: THREE.Group;
  top: THREE.Mesh;
  topMat: THREE.MeshToonMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  beads: THREE.Mesh[];
  beadMat: THREE.MeshBasicMaterial;
  col: CylCol;
  /** host / solo: a hero stands on it; client: the host says so */
  on: boolean;
  /** my own hero stands on it (instant feedback on clients) */
  mine: boolean;
  press: number;
  shown: boolean;
}

const STASHES = new WeakMap<Level3D, CoopStash[]>();
/** the co-op stashes built into this level */
export const stashesOf = (L: Level3D): CoopStash[] => STASHES.get(L) ?? [];

const netPose: NetPose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };

export class CoopStash implements Netted {
  netId = 0;
  netFar = 45;
  /** the cage opens on clients when the playback gets there */
  netTimed = ['open'];
  /** client: the host's plate states / opening in snapshot order, handed out as the playback passes them */
  private track: NetTrack<number[]> | null = null;
  netRoot = new THREE.Group();
  dead = false;
  readonly pos: THREE.Vector3;
  readonly plates: Plate[] = [];
  open = false;
  private openT = 0;
  private cage = new THREE.Group();
  private barsG = new THREE.Group();
  private lidG = new THREE.Group();
  private treasure = new THREE.Group();
  private halo: THREE.Mesh;
  private cageCol: CylCol;
  private t = rand(0, 5);
  private sparkT = 0;

  /** (x, y, z) = cage centre on the floor; plates [x, y, z] (two of them) */
  constructor(private L: Level3D, x: number, y: number, z: number, plates: [number, number, number][], readonly key: string) {
    this.pos = new THREE.Vector3(x, y, z);
    const root = this.netRoot;
    root.position.copy(this.pos);
    L.scene.add(root);
    // ── the cage: bars, a hoop on top, a golden dome with a knob ──
    const steel = mat('#cdd6e2'), gold = mat(PAL.gold);
    for (let i = 0; i < BARS; i++) {
      const a = (i / BARS) * Math.PI * 2;
      const b = mesh(geo.bar, steel);
      b.position.set(Math.cos(a) * CAGE_R, CAGE_H / 2, Math.sin(a) * CAGE_R);
      this.barsG.add(b);
    }
    for (const hy of [0.12, CAGE_H - 0.05]) { const h = mesh(geo.hoop, hy < 1 ? steel : gold); h.rotation.x = Math.PI / 2; h.position.y = hy; this.barsG.add(h); }
    const dome = mesh(geo.dome, gold); dome.scale.set(1, 0.42, 1); dome.position.y = CAGE_H - 0.05;
    const knob = mesh(geo.knob, gold); knob.position.y = CAGE_H + 0.5;
    this.lidG.add(dome, knob);
    this.cage.add(this.barsG, this.lidG);
    root.add(this.cage);
    // ── the treasure inside: a stand, a honey jar, a heap of rusks, a soft golden glow ──
    const stand = mesh(geo.stand, mat('#b8864a')); stand.position.y = 0.2;
    const jar = mesh(geo.jar, mat('#ffb020', { emissive: '#ff9000', emissiveIntensity: 0.25 })); jar.position.y = 0.58;
    const lid = mesh(geo.lid, mat(PAL.clothRed)); lid.position.y = 0.8;
    this.treasure.add(stand, jar, lid);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const r = mesh(geo.rusk, mat('#e8a850'));
      r.position.set(Math.cos(a) * 0.36, 0.46 + (i % 2) * 0.05, Math.sin(a) * 0.36);
      r.rotation.set(rand(-0.3, 0.3), a, rand(-0.2, 0.2));
      this.treasure.add(r);
    }
    this.halo = mesh(geo.halo, basic('#ffe9a0', { additive: true, opacity: 0.16 }), { cast: false, receive: false });
    this.halo.scale.setScalar(0.85); this.halo.position.y = 0.7;
    noOutline(this.halo);
    this.treasure.add(this.halo);
    root.add(this.treasure);
    this.cageCol = { kind: 'cyl', x, z, r: CAGE_R + 0.12, y0: y, y1: y + CAGE_H + 0.3, tag: 'cage', active: true };
    // the stand stays after opening (step up onto it for the honey)
    L.col([this.cageCol, { kind: 'cyl', x, z, r: 0.55, y0: y, y1: y + 0.4 }]);
    // ── the plates, each wired to the cage by a line of beads ──
    for (const [px, py, pz] of plates) this.plates.push(this.makePlate(px, py, pz));
    if (L.seen.has(key)) this.setOpen(true);
    L.actors.push(this);
    if (L.building) L.nl?.add(this);
    const list = STASHES.get(L) ?? [];
    list.push(this);
    STASHES.set(L, list);
  }

  private makePlate(x: number, y: number, z: number): Plate {
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    const base = mesh(geo.base, mat('#6a4a2e')); base.position.y = 0.07;
    const topMat = matU('#ffd34a', { emissive: '#ff9a20', emissiveIntensity: 0.25 });
    const top = mesh(geo.top, topMat); top.position.y = 0.19;
    // two little footprints: "stand here"
    for (const s of [-1, 1]) {
      const f = mesh(geo.foot, mat('#a8662a'), { cast: false });
      f.scale.set(0.16, 0.03, 0.27); f.position.set(s * 0.22, 0.245, s * 0.06);
      grp.add(f);
    }
    const ringMat = basic('#ffe14a', { additive: true, opacity: 0.5 });
    const ring = mesh(geo.ring, ringMat, { cast: false, receive: false });
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.16;
    noOutline(ring);
    grp.add(base, top, ring);
    this.L.scene.add(grp);
    // beads along the floor to the cage (only when plate and cage share a floor)
    const beads: THREE.Mesh[] = [];
    const beadMat = basic('#ffd34a', { additive: true, opacity: 0.35 });
    const to = this.pos;
    if (Math.abs(y - to.y) < 0.3) {
      const d = Math.hypot(to.x - x, to.z - z) - PLATE_R - CAGE_R - 0.4;
      const n = Math.max(0, Math.floor(d / 0.7));
      for (let i = 1; i <= n; i++) {
        const k = (PLATE_R + 0.2 + i * (d / (n + 1))) / Math.hypot(to.x - x, to.z - z);
        const b = mesh(geo.bead, beadMat, { cast: false, receive: false });
        b.position.set(x + (to.x - x) * k, y + 0.06, z + (to.z - z) * k);
        noOutline(b);
        this.L.scene.add(b);
        beads.push(b);
      }
    }
    const col: CylCol = { kind: 'cyl', x, z, r: PLATE_R + 0.15, y0: y, y1: y + 0.2, tag: 'plate' };
    this.L.col(col);
    return { at: new THREE.Vector3(x, y, z), grp, top, topMat, ring, ringMat, beads, beadMat, col, on: false, mine: false, press: 0, shown: false };
  }

  /** heroes needed at once: two with friends in the room, one alone */
  get need() { return this.L.nl && coop.players > 1 ? 2 : 1; }

  private standsOn(h: HeroLike, p: Plate) {
    if (h.dead || h.downed || h.hidden) return false;
    const dy = h.pos.y - p.at.y;
    return Math.hypot(h.pos.x - p.at.x, h.pos.z - p.at.z) < PLATE_R + 0.15 && dy > -0.15 && dy < 0.75;
  }

  /** (an Actor3: on the host it runs inside the captured world tick — its effects stay on this machine) */
  update(L: Level3D, dt: number) { this.local(L, () => this.tick(L, dt)); }

  private tick(L: Level3D, dt: number) {
    this.t += dt;
    const tr = this.track, play = L.nl?.playT ?? -Infinity;
    if (tr && !L.authority && tr.eval(play, dt, netPose)) tr.passed(play, (a) => this.netFields(a));
    // pressed state: the host (or solo game) checks every hero and alone decides the opening; a client shows the
    // plates under the heroes it draws — its own and the friends' played back (their stream runs on its own clock,
    // so the host's word would press a plate a little before or after a friend's drawn foot gets there)
    for (const p of this.plates) {
      p.mine = this.standsOn(L.player, p);
      if (L.authority) p.on = L.heroes().some((h) => this.standsOn(h, p));
      const shown = !this.open && (L.authority ? p.on || p.mine : p.mine || L.heroes().some((h) => !h.isLocal && this.standsOn(h, p)));
      if (shown !== p.shown) {
        p.shown = shown;
        if (shown) audio.sfx('clang', { pitch: 1.7, volume: p.mine ? 0.4 : 0.15 });
        else if (!this.open) audio.sfx('menuMove', { pitch: 0.7, volume: p.mine ? 0.35 : 0.1 });
      }
      p.press = damp(p.press, shown ? 1 : 0, 14, dt);
      p.top.position.y = 0.19 - p.press * 0.07;
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 3.2 + p.at.x);
      p.topMat.emissiveIntensity = this.open ? 0.08 : 0.25 + pulse * 0.2 + p.press * 0.9;
      p.ringMat.opacity = this.open ? 0 : 0.25 + pulse * 0.25 + p.press * 0.5;
      p.beadMat.opacity = this.open ? 0.12 : 0.2 + p.press * 0.75;
      p.ring.scale.setScalar(1 + p.press * 0.06 + (shown ? Math.sin(this.t * 10) * 0.02 : 0));
    }
    if (!this.open && L.authority) {
      const n = this.plates.filter((p) => p.on).length;
      if (n >= Math.min(this.need, this.plates.length)) {
        this.doOpen(L);
        L.nl?.entEvent(this, 'open');
      }
    }
    // opening: bars sink into the floor, the dome pops up and shrinks away
    if (this.open && this.openT < 1.2) {
      this.openT += dt;
      const k = clamp(this.openT / 0.9, 0, 1);
      this.barsG.position.y = -CAGE_H * k * k;
      this.lidG.position.y = Math.sin(Math.min(1, this.openT / 0.6) * Math.PI) * 1.2;
      this.lidG.scale.setScalar(Math.max(0.01, 1 - clamp((this.openT - 0.3) / 0.6, 0, 1)));
      if (this.openT >= 1.2) this.cage.visible = false;
    }
    // a little glitter around a closed stash (only when someone is near)
    if (!this.open) {
      this.halo.scale.setScalar(0.85 + Math.sin(this.t * 2.4) * 0.06);
      this.sparkT -= dt;
      if (this.sparkT <= 0 && L.player.pos.distanceTo(this.pos) < 25) {
        this.sparkT = 0.12;
        L.fx.glow.emit(this.pos.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(0.4, 1.3), rand(-0.6, 0.6))), { count: 1, speed: [0.1, 0.4], life: [0.6, 1.1], size: [0.05, 0.1], colors: ['#fff6c0', '#ffe14a'], g: -0.4 });
      }
    }
  }

  /** host: run effects for this machine only (the clients get the 'open' event and play their own) */
  private local(L: Level3D, f: () => void) {
    const nl = L.nl;
    if (!nl || !nl.capturing) { f(); return; }
    nl.capturing = false;
    try { f(); } finally { nl.capturing = true; }
  }

  private setOpen(instant: boolean) {
    this.open = true;
    this.cageCol.active = false;
    this.treasure.visible = false;
    if (instant) { this.cage.visible = false; this.openT = 9; }
    for (const p of this.plates) { p.on = false; p.shown = false; }
  }

  /** the cage opens: everyone gets their own prize */
  private doOpen(L: Level3D) {
    if (this.open) return;
    this.setOpen(false);
    this.openT = 0;
    L.seen.add(this.key);
    const c = this.pos.clone().setY(this.pos.y + 0.9);
    audio.sfx('door'); audio.sfx('artifact', { volume: 0.7 });
    L.tcam.shake(0.2);
    L.fx.stars(c, 34, ['#ffe14a', '#fff6c0', '#ffffff', '#ffb02a']);
    L.fx.ring(this.pos.clone().setY(this.pos.y + 0.1), 2.4, '#ffe14a', 0.5);
    L.fx.text(c.clone().setY(c.y + 1.6), L.nl && coop.players > 1 ? 'Командная работа!' : 'Тайник открыт!', '#ffe14a', 26);
    if (L.nl) L.feed('Тайник открыт — заберите награду!', '#ffe680');
    // prize: rusks in a ring at the stand, the honey jar on top of it
    let i = 0;
    for (const k of PRIZE) {
      if (k === 'honey') { L.pick(k, this.pos.x, this.pos.y + 0.85, this.pos.z); continue; }
      const a = (i++ / 5) * Math.PI * 2;
      L.pick(k, this.pos.x + Math.cos(a) * 1.0, this.pos.y + 0.45, this.pos.z + Math.sin(a) * 1.0);
    }
  }

  // ───────────────── co-op replication ─────────────────
  netSnap(): number[] { return [...this.plates.map((p) => (p.on ? 1 : 0)), this.open ? 1 : 0]; }
  /** client: a snapshot taken at host time t (played back in tick) */
  netApply(a: number[], t?: number) {
    if (t === undefined) { this.netFields(a); return; }
    (this.track ??= new NetTrack<number[]>()).push(t, this.pos.x, this.pos.y, this.pos.z, 0, a);
  }
  private netFields(a: number[]) {
    this.plates.forEach((p, i) => { p.on = !!a[i]; });
    if (a[this.plates.length] && !this.open) this.doOpen(this.L);
  }
  netEvent(L: Level3D, ev: string) { if (ev === 'open') this.doOpen(L); }

  /** co-op hints over the plates and the cage (drawn by the co-op plugin) */
  drawHints(L: Level3D, ctx: CanvasRenderingContext2D) {
    if (this.open) return;
    const me = L.player.pos;
    const near = Math.min(me.distanceTo(this.pos), ...this.plates.map((p) => me.distanceTo(p.at)));
    if (near > 11 || L.inCutscene) return;
    const a = clamp((11 - near) / 3, 0, 1);
    const cam = L.tcam.cam;
    const need = Math.min(this.need, this.plates.length);
    const n = this.plates.filter((p) => p.shown).length;
    ctx.save();
    ctx.globalAlpha = a;
    // over each plate: a ring that fills when it is pressed
    for (const p of this.plates) {
      const s = toUI(p.at.clone().setY(p.at.y + 2.5), cam);
      if (!s.vis || s.x < -40 || s.x > W + 40 || s.y < -40 || s.y > H + 40) continue;
      ctx.beginPath(); ctx.arc(s.x, s.y, 15, 0, Math.PI * 2);
      ctx.fillStyle = p.shown ? '#ffd34a' : 'rgba(30,16,22,0.6)'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
      text(ctx, p.shown ? '✔' : '?', s.x, s.y + 7, { size: 18, color: p.shown ? OUT : '#ffe680', align: 'center' });
    }
    // over the cage: what it needs
    const s = toUI(this.pos.clone().setY(this.pos.y + CAGE_H + 1.3), cam);
    if (s.vis) {
      const line = need > 1 ? (n >= 1 ? 'Нужен друг на второй плите!' : 'Тайник на двоих: встаньте на обе плиты') : 'Встань на светящуюся плиту';
      ctx.font = '400 18px Pangolin, sans-serif';
      const w = ctx.measureText(line).width + 28;
      rrect(ctx, s.x - w / 2, s.y - 26, w, 34, 12, 'rgba(30,14,20,0.72)', 3);
      text(ctx, line, s.x, s.y - 3, { size: 18, font: 'body', color: '#ffe680', align: 'center' });
      if (need > 1) text(ctx, `${n} / ${need}`, s.x, s.y + 26, { size: 20, color: n >= need ? '#9ff0a0' : '#fff3d8', align: 'center', stroke: 4 });
    }
    ctx.restore();
    // standing on a plate alone: say so where it can't be missed
    if (need > 1 && n < need && this.plates.some((p) => p.mine)) {
      const line = 'Стой тут — нужен друг на второй плите!';
      ctx.font = '400 20px Pangolin, sans-serif';
      const w = ctx.measureText(line).width + 32;
      rrect(ctx, W / 2 - w / 2, H - 132, w, 38, 14, 'rgba(30,14,20,0.75)', 3);
      text(ctx, line, W / 2, H - 106, { size: 20, font: 'body', color: '#ffe680', align: 'center' });
    }
  }
}

/** level builder helper: a co-op stash at (x, y, z) with its two plates */
export function coopStash(L: Level3D, x: number, y: number, z: number, plates: [number, number, number][], key = `stash${Math.round(x)}_${Math.round(z)}`) {
  return new CoopStash(L, x, y, z, plates, key);
}

// the co-op hero mechanics plugin (revives, gifts, rescue, boost…) registers itself in LEVEL_PLUGINS. It imports
// level.ts, which imports this file through levels.ts — so it is loaded lazily, after the module graph is ready.
void import('./coopMechanics');
