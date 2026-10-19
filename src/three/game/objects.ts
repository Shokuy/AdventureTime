import * as THREE from 'three';
import { audio } from '../../engine/audio';
import { clamp, damp, rand } from '../../engine/util';
import { mat, matU, basic, mesh, noOutline, PAL } from '../gfx';
import { makeBlob } from '../fx';
import type { Level3D } from './level';
import { NET_SPAWN } from './netLevel';
import { net } from '../../net/session';
import type { Netted } from './netLevel';
import { save } from '../../engine/save';
import { createArtifact } from '../models/artifacts';
import { createGoldenNut } from '../models/collectibles';
import type { Artifact, ArtifactKind } from '../models/artifacts';

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();

// ───────────────────────────── shared small geometries ─────────────────────────────
const G = {
  sphere: new THREE.SphereGeometry(1, 16, 12),
  crumb: new THREE.DodecahedronGeometry(0.13, 0),
  rusk: new THREE.BoxGeometry(0.34, 0.2, 0.24),
  capsule: new THREE.CapsuleGeometry(1, 1, 4, 10),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 18),
  cone: new THREE.ConeGeometry(1, 1, 18),
  torus: new THREE.TorusGeometry(1, 0.08, 8, 40),
};

function heartGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.35);
  s.bezierCurveTo(-0.15, -0.2, -0.42, 0.0, -0.36, 0.18);
  s.bezierCurveTo(-0.3, 0.38, -0.06, 0.38, 0, 0.2);
  s.bezierCurveTo(0.06, 0.38, 0.3, 0.38, 0.36, 0.18);
  s.bezierCurveTo(0.42, 0.0, 0.15, -0.2, 0, -0.35);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 3, curveSegments: 16 });
  g.center();
  return g;
}
const HEART = heartGeo();

// ───────────────────────────── PROJECTILES ─────────────────────────────
export type ShotKind = 'pea' | 'seed' | 'meat' | 'walnut' | 'reflected';

export class Shot3 {
  netId = 0;
  obj = new THREE.Group();
  dead = false; life = 3; r = 0.12; dmg = 1; bounces = 0; reflectable = false; spin = new THREE.Vector3();
  /** enemies it can still fly through (walnut slingshot) */
  pierce = 0;
  /** co-op: just for looks (a friend's pea, or mine on a client) — never hits anything */
  visual = false;
  /** co-op host: which friend fired it (kill credit) */
  shooter: string | null = null;
  private pierced = new Set<unknown>();
  /** colliders with this tag don't stop the shot (e.g. the King's own body for his meat) */
  ignoreTag: string | null = null;
  constructor(public kind: ShotKind, public pos: THREE.Vector3, public vel: THREE.Vector3, public g: number, public owner: 'player' | 'enemy') {
    if (kind === 'pea') { this.r = 0.12; this.life = 1.4; this.obj.add(mesh(G.sphere, mat('#7ad04a')).translateY(0)); this.obj.children[0].scale.setScalar(0.12); }
    if (kind === 'seed') {
      this.r = 0.14; this.life = 3;
      const m = mesh(G.sphere, mat(PAL.seed)); m.scale.set(0.1, 0.16, 0.1); this.obj.add(m);
    }
    if (kind === 'meat') {
      this.r = 0.55; this.life = 6; this.reflectable = true; this.bounces = 1;
      const steak = mesh(G.sphere, mat(PAL.meat)); steak.scale.set(0.55, 0.28, 0.42); this.obj.add(steak);
      const fat = mesh(G.sphere, mat('#f4d0b0')); fat.scale.set(0.5, 0.06, 0.08); fat.position.set(0, 0.22, 0.1); this.obj.add(fat);
      const bone = mesh(G.capsule, mat('#f6ecd2')); bone.scale.set(0.08, 0.25, 0.08); bone.rotation.z = Math.PI / 2; bone.position.set(0.65, 0, 0); this.obj.add(bone);
      this.spin.set(rand(-4, 4), rand(-6, 6), rand(-4, 4));
    }
    if (kind === 'walnut') {
      this.r = 0.5; this.life = 5;
      const w = mesh(G.sphere, mat('#b07a3a')); w.scale.set(0.5, 0.45, 0.5); this.obj.add(w);
    }
    this.obj.position.copy(pos);
  }

  update(L: Level3D, dt: number) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.vel.y -= this.g * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.obj.position.copy(this.pos);
    this.obj.rotation.x += this.spin.x * dt; this.obj.rotation.y += this.spin.y * dt; this.obj.rotation.z += this.spin.z * dt;
    if (this.kind === 'seed' || this.kind === 'pea') this.obj.lookAt(v1.copy(this.pos).add(this.vel));
    if (this.visual) {
      if (L.phys.pointInSolid(this.pos)) this.pop(L);
      return;
    }
    if (this.owner === 'player') {
      for (const e of L.enemies) {
        if (e.dead || e.spawnT > 0 || this.pierced.has(e)) continue;
        const c = e.center();
        if (Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < e.body.r + this.r && Math.abs(c.y - this.pos.y) < e.body.h * 0.6 + this.r) {
          e.hurt(L, this.dmg, this.pos.clone().sub(this.vel), 'pea');
          if (this.pierce > 0) { this.pierce--; this.pierced.add(e); continue; }
          this.pop(L); return;
        }
      }
      if (L.boss && L.boss.shotHit(L, this)) { this.pop(L); return; }
      for (const h of L.hittables) if (h.shotHit(L, this)) { this.pop(L); return; }
      for (const n of L.noodles) if (n.hitTest(this.pos, this.r + 0.2)) { n.cut(L); this.pop(L); return; }
    } else {
      const p = L.player;
      const pc = p.center();
      if (!p.dead && Math.hypot(pc.x - this.pos.x, pc.z - this.pos.z) < p.body.r + this.r && Math.abs(pc.y - this.pos.y) < 0.55 + this.r) {
        if (p.hurt(L, this.dmg, this.pos)) { this.pop(L); return; }
      }
    }
    if (this.kind !== 'reflected' && L.phys.pointInSolid(this.pos, this.ignoreTag ?? undefined)) {
      if (this.bounces > 0 && this.vel.y < 0) {
        this.bounces--;
        this.vel.y = -this.vel.y * 0.4; this.vel.x *= 0.6; this.vel.z *= 0.6;
        this.pos.y += 0.2;
        audio.sfx('thud', { volume: 0.5 });
        L.fx.dust(this.pos.clone(), 4);
      } else this.pop(L);
    }
  }

  /** co-op: the host popped / reflected its copy */
  netEvent(L: Level3D, ev: string, d: { at?: THREE.Vector3 }) {
    if (this.dead) return;
    if (ev === 'pop') this.pop(L);
    else if (ev === 'reflect' && L.boss) { if (d.at) this.pos.copy(d.at); this.reflect(L, L.boss.faceTarget()); this.visual = true; }
  }

  pop(L: Level3D) {
    this.dead = true;
    if (L.authority) L.nl?.remove(this as unknown as Netted);
    const p = this.pos.clone();
    if (this.kind === 'pea') L.noise(p, 7);
    if (this.kind === 'pea') L.fx.emit(p, { count: 7, speed: [1, 3], life: [0.2, 0.4], size: [0.05, 0.09], colors: ['#7ad04a', '#c8f0a0'], g: 10 });
    else if (this.kind === 'seed') L.fx.emit(p, { count: 5, speed: [1, 3], life: [0.2, 0.4], size: [0.05, 0.08], colors: ['#2a1b1a'], g: 10 });
    else if (this.kind === 'meat' || this.kind === 'reflected') { L.fx.juice(p, 14, ['#a8402a', '#c86040', '#f4d0b0']); audio.sfx('splash', { volume: 0.5 }); }
    else if (this.kind === 'walnut') { L.fx.chunks(p, 10, ['#8a5a2a', '#c8904a'], p.y - 0.4); audio.sfx('crumble', { volume: 0.6 }); }
  }

  reflect(L: Level3D, target: THREE.Vector3) {
    this.kind = 'reflected'; this.owner = 'player'; this.g = 0; this.life = 2.5;
    this.vel.copy(target).sub(this.pos).normalize().multiplyScalar(34);
    audio.sfx('reflect');
    L.hitstop(0.08);
    L.fx.sparks(this.pos.clone(), 16);
    L.fx.ring(this.pos.clone(), 2, '#ffe14a', 0.3, false);
    const glow = mesh(G.sphere, basic('#ffe14a', { additive: true, opacity: 0.6 }), { cast: false, receive: false });
    glow.scale.setScalar(1.1);
    noOutline(glow);
    this.obj.add(glow);
  }
}

// ───────────────────────────── PICKUPS ─────────────────────────────
export type PickKind = 'crumb' | 'bigcrumb' | 'heart' | 'peas' | 'honey' | 'container' | 'doubleJump' | 'dash' | 'fork' | 'sling' | 'nut';
const PERMANENT: PickKind[] = ['container', 'doubleJump', 'dash', 'fork', 'sling', 'nut'];

export class Pickup3 {
  obj = new THREE.Group();
  inner = new THREE.Group();
  vel = new THREE.Vector3();
  t = rand(0, 5); age = 0; dead = false; physics: boolean; permanent: boolean;
  blob: THREE.Mesh | null = null;
  light: THREE.PointLight | null = null;
  art: Artifact | null = null;
  nut: { root: THREE.Group; update(dt: number): void } | null = null;
  constructor(public kind: PickKind, public pos: THREE.Vector3, public id?: string, physics = false) {
    this.physics = physics;
    this.permanent = PERMANENT.includes(kind);
    this.obj.add(this.inner);
    this.build();
    this.obj.position.copy(pos);
  }

  private build() {
    const add = (m: THREE.Object3D) => { this.inner.add(m); return m; };
    switch (this.kind) {
      case 'crumb': add(mesh(G.crumb, mat('#f0b850'))); break;
      case 'bigcrumb': add(mesh(G.rusk, mat('#e8a850'))); break;
      case 'heart': { const h = add(mesh(HEART, mat('#e8283a'))); h.scale.setScalar(0.7); break; }
      case 'peas': {
        const pod = add(mesh(G.capsule, mat('#4fae3a'))); pod.scale.set(0.12, 0.2, 0.12); pod.rotation.z = Math.PI / 2;
        for (let i = -1; i <= 1; i++) { const p = mesh(G.sphere, mat('#8ae05a')); p.scale.setScalar(0.09); p.position.set(i * 0.13, 0.06, 0.04); this.inner.add(p); }
        break;
      }
      case 'honey': {
        const j = add(mesh(G.cyl, mat('#ffb020'))); j.scale.set(0.16, 0.26, 0.16);
        const lid = mesh(G.cyl, mat(PAL.cloth)); lid.scale.set(0.19, 0.07, 0.19); lid.position.y = 0.15; this.inner.add(lid);
        break;
      }
      case 'nut': {
        const n = createGoldenNut();
        n.root.scale.setScalar(1.3);
        this.nut = n;
        add(n.root);
        const halo = mesh(G.sphere, basic('#ffe14a', { additive: true, opacity: 0.22 }), { cast: false, receive: false });
        halo.scale.setScalar(0.75);
        noOutline(halo);
        this.inner.add(halo);
        break;
      }
      default: {
        // artifact on a beam of light
        const beam = mesh(G.cyl, basic('#fff2b0', { additive: true, opacity: 0.18 }), { cast: false, receive: false });
        beam.scale.set(0.6, 6, 0.6); beam.position.y = 2.6;
        noOutline(beam);
        this.obj.add(beam);
        const ring = mesh(G.torus, basic('#ffe14a', { additive: true, opacity: 0.7 }), { cast: false, receive: false });
        ring.rotation.x = Math.PI / 2; ring.scale.setScalar(0.75); ring.position.y = -0.55;
        noOutline(ring);
        this.obj.add(ring);
        this.light = new THREE.PointLight('#ffe9a0', 6, 8, 1.6);
        this.light.position.y = 0.5;
        this.obj.add(this.light);
        this.art = createArtifact(this.kind as ArtifactKind);
        this.art.root.scale.setScalar(1.15);
        add(this.art.root);
      }
    }
    if (!this.permanent) { this.blob = makeBlob(0.2); }
  }

  update(L: Level3D, dt: number) {
    this.t += dt; this.age += dt;
    const p = L.player;
    const magnetic = this.kind === 'crumb' || this.kind === 'bigcrumb' || this.kind === 'peas';
    const pc = p.center();
    const d = pc.distanceTo(this.pos);
    const R = save.data.upgrades.magnet ? 7 : 3;
    if (magnetic && this.age > 0.4 && d < R && !p.dead) {
      v1.copy(pc).sub(this.pos).normalize();
      this.pos.addScaledVector(v1, (10 + (R - d) * 10) * dt);
    } else if (this.physics) {
      this.vel.y -= 25 * dt;
      this.pos.addScaledVector(this.vel, dt);
      const gy = L.phys.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.3, 0.05);
      if (this.pos.y < gy + 0.18) {
        this.pos.y = gy + 0.18;
        if (this.vel.y < -3) this.vel.y *= -0.4; else this.vel.y = 0;
        this.vel.x *= 0.85; this.vel.z *= 0.85;
      }
      if (this.pos.y < L.killY) this.dead = true;
    }
    this.obj.position.copy(this.pos);
    this.art?.update(dt);
    this.nut?.update(dt);
    this.inner.rotation.y += dt * (this.permanent ? 1.2 : 2.6);
    this.inner.position.y = Math.sin(this.t * 3) * (this.permanent ? 0.15 : 0.06) + (this.permanent ? 0.2 : 0);
    if (this.light) this.light.intensity = 5 + Math.sin(this.t * 4) * 1.5;
    if (this.blob) {
      const gy = L.phys.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.1, 0.05);
      this.blob.visible = gy > -1e8;
      this.blob.position.set(this.pos.x, gy + 0.02, this.pos.z);
    }
    if (this.permanent && Math.random() < 0.2) L.fx.glow.emit(this.pos.clone().add(new THREE.Vector3(rand(-0.4, 0.4), rand(-0.2, 0.8), rand(-0.4, 0.4))), { count: 1, speed: [0.1, 0.5], life: [0.6, 1.2], size: [0.06, 0.12], colors: ['#fff6c0', '#ffe14a'], g: -0.5 });
    const reach = this.permanent ? 1.1 : 0.75;
    if (!p.dead && this.age > 0.25 && d < reach) {
      if (this.kind === 'heart' && p.hp >= p.maxHp && this.age < 12) return;
      this.dead = true;
      L.collect(this);
    }
    if (!this.permanent && this.physics && this.age > 22) this.dead = true;
    if (!this.permanent && this.physics && this.age > 18) this.obj.visible = Math.floor(this.age * 8) % 2 === 0;
  }
}

// ───────────────────────────── SPAGHETTI NOODLE ─────────────────────────────
const SEG = 12;
export class Noodle3 {
  obj = new THREE.Group();
  segs: THREE.Mesh[] = [];
  tipBall: THREE.Group;
  pts: THREE.Vector3[] = [];
  /** time base for the sway; co-op: the shared room clock so swings line up on every machine */
  t = rand(0, 10); cool = 0; vis = 1; grabbing = false; flash = 0;
  private seedT = 0;
  /** pendulum swing across a lane (axis), amplitude in radians */
  swing: { axis: 'x' | 'z'; amp: number; speed: number; phase: number } | null = null;
  private noodleMat = matU(PAL.noodle);
  constructor(public anchor: THREE.Vector3, public len: number, o: { swing?: Noodle3['swing']; hang?: 'plate' | 'colander'; thick?: number } = {}) {
    this.swing = o.swing ?? null;
    // a per-noodle offset derived from where it hangs (identical on every machine)
    this.seedT = ((anchor.x * 12.9898 + anchor.z * 78.233) % 10 + 10) % 10;
    for (let i = 0; i <= SEG; i++) this.pts.push(anchor.clone());
    const th = o.thick ?? 0.09;
    const segGeo = new THREE.CapsuleGeometry(th, 1, 3, 8);
    for (let i = 0; i < SEG; i++) {
      const m = mesh(segGeo, this.noodleMat);
      this.segs.push(m); this.obj.add(m);
    }
    if ((o.hang ?? 'plate') === 'plate') {
      // plate rim at the anchor
      const plate = mesh(G.cyl, mat('#e8eef5')); plate.scale.set(0.9, 0.12, 0.9); plate.position.copy(anchor).add(new THREE.Vector3(0, 0.06, 0));
      this.obj.add(plate);
      const sauce = mesh(G.cyl, mat(PAL.sauce)); sauce.scale.set(0.6, 0.05, 0.6); sauce.position.copy(anchor).add(new THREE.Vector3(0, -0.02, 0));
      this.obj.add(sauce);
    } else {
      // a colander hanging from the ceiling on a chain, spaghetti dangling through it
      const col = mesh(new THREE.SphereGeometry(1.6, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat('#b8c4d4', { side: THREE.DoubleSide }));
      col.rotation.x = Math.PI; col.position.copy(anchor).add(new THREE.Vector3(0, 1.4, 0));
      this.obj.add(col);
      const rim = mesh(new THREE.TorusGeometry(1.6, 0.12, 8, 32), mat('#8a96a8')); rim.rotation.x = Math.PI / 2; rim.position.copy(anchor).add(new THREE.Vector3(0, 1.4, 0));
      this.obj.add(rim);
      const chain = mesh(G.cyl, mat('#5a5048')); chain.scale.set(0.08, 40, 0.08); chain.position.copy(anchor).add(new THREE.Vector3(0, 21.4, 0));
      this.obj.add(chain);
      const blob = mesh(G.sphere, this.noodleMat); blob.scale.set(1.2, 0.5, 1.2); blob.position.copy(anchor).add(new THREE.Vector3(0, 0.3, 0));
      this.obj.add(blob);
    }
    this.tipBall = new THREE.Group();
    const ball = mesh(G.sphere, this.noodleMat); ball.scale.setScalar(0.17); this.tipBall.add(ball);
    for (const s of [-1, 1]) {
      const e = mesh(G.sphere, basic('#2a1b1a')); e.scale.setScalar(0.045); e.position.set(s * 0.07, 0.03, 0.14); this.tipBall.add(e);
    }
    this.obj.add(this.tipBall);
    this.compute(null, 0);
  }

  tip() { return this.pts[SEG]; }

  compute(target: THREE.Vector3 | null, dt: number) {
    const L = this.len * this.vis;
    const sw = this.swing;
    const th = sw ? sw.amp * Math.sin(this.t * sw.speed + sw.phase) : 0;
    for (let i = 0; i <= SEG; i++) {
      const k = i / SEG;
      let x = this.anchor.x + Math.sin(this.t * 1.6 + k * 3) * k * 0.9 + Math.sin(this.t * 3.2 + k * 7) * k * 0.15;
      let z = this.anchor.z + Math.cos(this.t * 1.3 + k * 2.4) * k * 0.9;
      let y = this.anchor.y - k * L;
      if (sw) {
        // the lower end lags a little behind the swing
        const a = th * (1 - 0.18 * k * k);
        const along = Math.sin(a) * k * L;
        y = this.anchor.y - Math.cos(a) * k * L;
        if (sw.axis === 'z') z = this.anchor.z + along + Math.sin(this.t * 2.1 + k * 4) * k * 0.3;
        else x = this.anchor.x + along + Math.sin(this.t * 2.1 + k * 4) * k * 0.3;
      }
      if (target) {
        const w = k * k;
        x = x * (1 - w) + target.x * w; y = y * (1 - w) + target.y * w; z = z * (1 - w) + target.z * w;
      }
      this.pts[i].set(x, y, z);
    }
    for (let i = 0; i < SEG; i++) {
      const a = this.pts[i], b = this.pts[i + 1];
      const m = this.segs[i];
      v1.copy(b).sub(a);
      const l = v1.length();
      m.position.copy(a).addScaledVector(v1, 0.5);
      m.quaternion.setFromUnitVectors(UP, v1.normalize());
      m.scale.set(1, Math.max(0.01, l), 1);
    }
    this.tipBall.position.copy(this.tip());
    this.noodleMat.emissive.setRGB(this.flash, this.flash, this.flash);
    void dt;
  }

  hitTest(p: THREE.Vector3, r: number) {
    if (this.cool > 0 || this.vis < 0.6) return false;
    for (let i = Math.floor(SEG * 0.4); i <= SEG; i++) if (this.pts[i].distanceTo(p) < r + 0.15) return true;
    return false;
  }

  update(L: Level3D, dt: number) {
    if (L.nl) this.t = net.time() + this.seedT; else this.t += dt;
    this.cool -= dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    this.vis = damp(this.vis, this.cool > 0 ? 0.22 : 1, this.cool > 0 ? 12 : 2.5, dt);
    const p = L.player;
    const pc = p.center();
    this.compute(this.grabbing ? pc.clone().setY(pc.y + 0.25) : null, dt);
    if (!this.grabbing && this.cool <= 0 && this.vis > 0.85 && !p.dead && !p.grabbedBy && p.invuln <= 0 && !p.dashing && p.control) {
      for (let i = SEG - 2; i <= SEG; i++) {
        if (this.pts[i].distanceTo(pc) < 0.62) {
          this.grabbing = true;
          p.grabbedBy = this; p.grip = 5; p.grabDmgT = 1.2;
          p.atk = null; p.dashT = 0; p.body.gravity = 32;
          audio.sfx('grab');
          L.tcam.shake(0.2);
          L.fx.text(this.tip().clone().setY(this.tip().y + 0.8), 'Хвать!', '#f6d06a', 24);
          L.toast('Жми прыжок или удар, чтобы вырваться!');
          break;
        }
      }
    }
  }

  release() { this.grabbing = false; this.cool = 2.6; }

  /** a cut that happened elsewhere (co-op) */
  netCut(L: Level3D) { if (this.vis > 0.5) this.cut(L, false); }

  cut(L: Level3D, share = true) {
    if (share && L.nl?.isHost) net.send('all', 'ncut', { i: L.noodles.indexOf(this) });
    if (this.cool > 0) return;
    if (this.grabbing) { L.player.grabbedBy = null; L.player.body.vel.y = 8; L.player.invuln = 0.7; }
    this.grabbing = false;
    this.cool = 4.5; this.flash = 1;
    const tip = this.tip().clone();
    audio.sfx('break', { pitch: 1.3 });
    L.fx.chunks(tip, 10, [PAL.noodle, '#e8b84a'], L.phys.groundAt(tip.x, tip.z, tip.y, 0.1), [0.08, 0.16]);
    L.fx.juice(tip, 10, ['#d8402a', '#b8301a']);
  }
}

// ───────────────────────────── CHECKPOINT CANDLE ─────────────────────────────
export class Checkpoint3 {
  obj = new THREE.Group();
  lit = false; t = 0; flare = 0;
  flame: THREE.Group;
  light: THREE.PointLight;
  smoke = 0;
  constructor(public pos: THREE.Vector3) {
    const base = mesh(G.cyl, mat('#c8a050')); base.scale.set(0.7, 0.15, 0.7); base.position.y = 0.075; this.obj.add(base);
    const wax = mesh(G.cyl, mat('#fff3d8')); wax.scale.set(0.32, 1.6, 0.32); wax.position.y = 0.95; this.obj.add(wax);
    const band = mesh(G.cyl, mat('#e8383d')); band.scale.set(0.335, 0.18, 0.335); band.position.y = 1.15; this.obj.add(band);
    const wick = mesh(G.cyl, mat('#2a1b1a')); wick.scale.set(0.03, 0.18, 0.03); wick.position.y = 1.83; this.obj.add(wick);
    this.flame = new THREE.Group();
    const f1 = mesh(G.sphere, basic('#ffb02a', { additive: true, opacity: 0.95 }), { cast: false, receive: false }); f1.scale.set(0.16, 0.36, 0.16);
    const f2 = mesh(G.sphere, basic('#fff6c0', { additive: true, opacity: 1 }), { cast: false, receive: false }); f2.scale.set(0.08, 0.2, 0.08); f2.position.y = -0.05;
    this.flame.add(f1, f2);
    this.flame.position.y = 2.1;
    noOutline(this.flame);
    this.obj.add(this.flame);
    this.light = new THREE.PointLight('#ffb84a', 0, 14, 1.4);
    this.light.position.y = 2.3;
    this.obj.add(this.light);
    this.obj.position.copy(pos);
    this.flame.visible = false;
  }
  update(L: Level3D, dt: number) {
    this.t += dt;
    this.flare = Math.max(0, this.flare - dt);
    // any hero lights it (co-op: the host decides and tells everyone — candles are shared); a hero dropping past
    // it in a long fall doesn't (the library: a fall never ends at a candle up the climb)
    if (!this.lit && L.authority && L.heroes().some((h) => !h.dead && h.vel.y > -12 && Math.hypot(h.pos.x - this.pos.x, h.pos.z - this.pos.z) < 1.4 && Math.abs(h.pos.y - this.pos.y) < 2)) {
      L.lightCandle(L.checkpoints.indexOf(this));
    }
    if (this.lit) {
      const fl = Math.sin(this.t * 13) * 0.12 + Math.sin(this.t * 7.3) * 0.08;
      this.flame.scale.set(1 - fl * 0.5 + this.flare * 0.5, 1 + fl + this.flare, 1 - fl * 0.5 + this.flare * 0.5);
      this.light.intensity = 10 + fl * 6 + this.flare * 20;
    } else if (Math.random() < 0.05) {
      L.fx.emit(this.pos.clone().add(new THREE.Vector3(0, 2, 0)), { count: 1, speed: [0.2, 0.5], life: [0.8, 1.4], size: [0.12, 0.2], size2: 2, colors: ['#bbbbbb'], g: -0.6 });
    }
  }
  light_(L: Level3D) {
    this.lit = true; this.flare = 1; this.flame.visible = true;
    L.setCheckpoint(this);
    audio.sfx('checkpoint');
    L.fx.stars(this.pos.clone().add(new THREE.Vector3(0, 2.1, 0)), 26);
    L.fx.ring(this.pos.clone().add(new THREE.Vector3(0, 0.1, 0)), 3, '#ffe14a', 0.6);
  }
}

// ───────────────────────────── FALLING THINGS ─────────────────────────────
export class Faller3 {
  netId = 0;
  obj = new THREE.Group();
  marker: THREE.Mesh;
  dead = false; t = 0; vy = 0; spin = new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-2, 2));
  pos: THREE.Vector3;
  constructor(x: number, startY: number, z: number, public groundY: number, public kind: 'book' | 'walnut', public warn = 0.8) {
    this.pos = new THREE.Vector3(x, startY, z);
    if (kind === 'book') {
      const c = ['#c0392b', '#2e86c1', '#8e44ad', '#27ae60', '#d35400'][Math.floor(rand(0, 5))];
      const cover = mesh(new THREE.BoxGeometry(1.6, 0.4, 1.2), mat(c)); this.obj.add(cover);
      const pages = mesh(new THREE.BoxGeometry(1.5, 0.32, 1.12), mat('#f6ecd2')); pages.position.x = 0.04; this.obj.add(pages);
    } else {
      const w = mesh(G.sphere, mat('#b07a3a')); w.scale.set(0.6, 0.55, 0.6); this.obj.add(w);
    }
    this.marker = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshBasicMaterial({ color: '#300010', transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.set(x, groundY + 0.04, z);
    noOutline(this.marker);
    this.obj.visible = false;
  }
  update(L: Level3D, dt: number) {
    this.t += dt;
    const k = this.warn > 0 ? 0.5 + 0.5 * Math.sin(this.t * 18) : 1;
    (this.marker.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.3 * k;
    if (this.warn > 0) { this.warn -= dt; this.marker.scale.setScalar(0.6 + 0.2 * Math.sin(this.t * 10)); return; }
    this.obj.visible = true;
    this.vy -= 30 * dt;
    this.pos.y += this.vy * dt;
    this.obj.position.copy(this.pos);
    this.obj.rotation.x += this.spin.x * dt; this.obj.rotation.z += this.spin.z * dt;
    const h = clamp((this.pos.y - this.groundY) / 12, 0, 1);
    this.marker.scale.setScalar(1.2 - h * 0.6);
    const p = L.player;
    const pc = p.center();
    if (!p.dead && Math.hypot(pc.x - this.pos.x, pc.z - this.pos.z) < 1.0 && Math.abs(pc.y - this.pos.y) < 0.8) p.hurt(L, 1, this.pos);
    if (this.pos.y <= this.groundY + 0.2) {
      this.dead = true;
      L.tcam.shake(0.15);
      if (this.kind === 'walnut') {
        audio.sfx('crumble');
        L.fx.chunks(this.pos.clone(), 12, ['#8a5a2a', '#c8904a'], this.groundY);
      } else {
        audio.sfx('thud');
        L.fx.dust(this.pos.clone(), 12);
        L.fx.chunks(this.pos.clone(), 14, ['#f6ecd2', '#ffffff'], this.groundY, [0.12, 0.24]);
      }
    }
  }
}

// ───────────────────────────── SHOCKWAVE RING ─────────────────────────────
export class Wave3 {
  obj: THREE.Mesh;
  dead = false; r: number; t = 0; hitDone = false;
  netId = 0;
  constructor(public center: THREE.Vector3, public speed = 9, public maxR = 30, public r0 = 1) {
    this.r = r0;
    this.obj = new THREE.Mesh(new THREE.TorusGeometry(1, 0.22, 8, 64), mat('#e8d8ff'));
    this.obj.rotation.x = Math.PI / 2;
    this.obj.position.copy(center).setY(center.y + 0.15);
  }
  update(L: Level3D, dt: number) {
    this.t += dt;
    this.r += this.speed * dt;
    if (this.r > this.maxR) { this.dead = true; return; }
    this.obj.scale.set(this.r, this.r, 1 + Math.sin(this.t * 20) * 0.3);
    const p = L.player;
    const d = Math.hypot(p.pos.x - this.center.x, p.pos.z - this.center.z);
    if (!this.hitDone && !p.dead && Math.abs(d - this.r) < 0.45 && p.pos.y - this.center.y < 0.55) {
      if (p.hurt(L, 1, this.center)) this.hitDone = true;
    }
    if (Math.random() < 0.6) {
      const a = rand(0, Math.PI * 2);
      L.fx.dust(new THREE.Vector3(this.center.x + Math.cos(a) * this.r, this.center.y, this.center.z + Math.sin(a) * this.r), 1, '#c8b0e0');
    }
  }
}

// ── co-op: the host's projectiles, falling walnuts and shockwaves appear on every machine ──
const vv = (x: unknown) => (x instanceof THREE.Vector3 ? x : new THREE.Vector3(...(x as [number, number, number])));
NET_SPAWN.shot = (L, a: { k: ShotKind; f: unknown; v: unknown; g: number; it?: string | null }) => L.spawnEnemyShot(a.k, vv(a.f), vv(a.v), a.g, true, a.it ?? null) as unknown as Netted;
NET_SPAWN.faller = (L, a: { x: number; y: number; z: number; gy: number; k: 'book' | 'walnut'; w: number }) => {
  const f = new Faller3(a.x, a.y, a.z, a.gy, a.k, a.w);
  L.addFaller(f, false);
  return f as unknown as Netted;
};
NET_SPAWN.wave = (L, a: { c: unknown; s: number; m: number; r0: number }) => {
  const w = new Wave3(vv(a.c), a.s, a.m, a.r0);
  L.addWave(w, false);
  return w as unknown as Netted;
};
