import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { approach, choose, rand } from '../../../../engine/util';
import { Enemy3, ENEMY_KINDS, type EnemyOpts } from '../../enemies';
import type { Level3D, Actor3 } from '../../level';
import { vamp, markCharacter, greyHandle, createStars, spinStars, ambient, type FolkLike } from '../vampires';
import { damp } from '../../../models/kit';
import { createGoat, type GoatRig, type GoatAnim } from './models';
import { LINES4 } from './lines';

declare module '../../enemies' {
  interface ExtraEnemyKinds { goat: true }
}

/**
 * Серые горные козлики (8.2.4) — пресняки of the pass: drained, grey, sleepy («Ме… всё равно…»). Like the candy
 * townsfolk of the vampire kit (they count for its «Расколдовано» counter, grey zones, the chord / syrup restores):
 * any hit stuns them, any hero's hit while stunned (or a chord / syrup) brings the colour back — «Ме-е! Я снова рыжий!» —
 * and a happy ginger goat stays and hops about. Never killed. Co-op: the host decides; 'gone' (how 'restore') shows it
 * everywhere.
 */
const STUN = 5;

export class Goat3 extends Enemy3 implements FolkLike {
  readonly folk = true as const;
  rig: GoatRig;
  anim: GoatAnim = { st: 'shuffle', speed: 0, flash: 0 };
  stars = createStars();
  private setGrey: (k: number) => void;
  private goal: THREE.Vector3 | null = null;
  private waitT = rand(0.5, 3);
  private yawnT = rand(4, 12);
  private netStun = false;
  private checked = false;
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('goat', pos, 0.35, 0.9);
    const seed = Math.abs(Math.round(pos.x * 7 + pos.z * 13));
    this.rig = createGoat(seed);
    this.root.add(this.rig.root);
    markCharacter(this.rig.root);
    this.setGrey = greyHandle(this.rig.root);
    this.setGrey(1);
    this.stars.position.y = this.rig.top + 0.1;
    this.root.add(this.stars);
    this.hp = this.maxHp = 1; this.loot = 0; this.contact = 0;
    this.yaw = o.yaw ?? rand(0, Math.PI * 2);
  }
  provoke() { /* goats don't fight */ }

  update(L: Level3D, dt: number) {
    if (!this.checked) {
      this.checked = true;
      vamp(L).folkTotal++;
      if (this.key && L.seen.has(this.key)) {
        this.dead = true;
        L.nl?.remove(this);
        L.actors.push(new HappyGoat(L, this, '', true));
        vamp(L).restoredOne(this, null, true);
        return;
      }
    }
    super.update(L, dt);
  }

  tick(L: Level3D, dt: number) {
    const b = this.body;
    if (this.stun > 0) {
      this.stun -= dt;
      b.vel.x = approach(b.vel.x, 0, 14 * dt); b.vel.z = approach(b.vel.z, 0, 14 * dt);
      L.phys.move(b, dt);
      return;
    }
    if (this.waitT > 0) { this.waitT -= dt; b.vel.x = approach(b.vel.x, 0, 8 * dt); b.vel.z = approach(b.vel.z, 0, 8 * dt); }
    else {
      if (!this.goal) { const a = rand(0, Math.PI * 2), r = rand(0.5, 3); this.goal = new THREE.Vector3(this.home.x + Math.cos(a) * r, b.pos.y, this.home.z + Math.sin(a) * r); }
      let dx = this.goal.x - b.pos.x, dz = this.goal.z - b.pos.z;
      const d = Math.hypot(dx, dz);
      dx /= d || 1; dz /= d || 1;
      const ok = b.onGround ? this.groundAhead(L, dx, dz) : true;
      const sp = ok ? 0.55 : 0;
      b.vel.x = approach(b.vel.x, dx * sp, 6 * dt); b.vel.z = approach(b.vel.z, dz * sp, 6 * dt);
      this.faceToward(this.goal.x, this.goal.z, dt, 2.5);
      if (d < 0.3 || !ok || b.hitWall) { this.goal = null; this.waitT = rand(1.5, 4); }
    }
    if ((this.yawnT -= dt) <= 0) {
      this.yawnT = rand(8, 15);
      if (L.heroes().some((h) => h.pos.distanceTo(b.pos) < 10)) L.bark(this.root, choose(LINES4.goatSleepy as unknown as string[]), 1.8, this.rig.top + 0.5);
    }
    L.phys.move(b, dt);
  }

  hurt(L: Level3D, _dmg: number, from: THREE.Vector3, kind: string) {
    if (!L.authority || this.dead) return;
    // (any hero's hit on a stunned goat brings the colour back: a sword, a paw, an axe, a flask…)
    if (kind === 'chord' || kind === 'syrup' || this.stun > 0) { this.restore(L, L.attacker); return; }
    const fresh = this.stun <= 0;
    this.stun = STUN;
    this.flash = 1;
    const v = this.body.pos.clone().sub(from).setY(0);
    if (v.lengthSq() > 1e-4) { v.normalize(); this.body.vel.x = v.x * 3; this.body.vel.z = v.z * 3; }
    audio.sfx('pogo', { pitch: 0.7, volume: 0.6 });
    L.fx.stars(this.center().setY(this.body.pos.y + this.rig.top), 12);
    if (fresh) {
      L.bark(this.root, LINES4.goatSleepy[0], 1.2, this.rig.top + 0.5);
      L.hint('presnyak', 'Пресняк оглушён! Ударьте его мечом ещё раз или брызните сиропом — и вернёте ему цвет');
    }
  }

  restore(L: Level3D, by: string | null = null) {
    if (!L.authority || this.dead) return;
    this.dead = true;
    this.hp = 0;
    const c = this.center();
    L.nl?.gone(this, 'restore', c, { by: by ?? undefined });
    this.burst(L);
    for (let i = 0; i < 2; i++) L.dropPickup('crumb', c);
    if (Math.random() < 0.15) L.dropPickup('heart', c);
    L.countKill(this);
    vamp(L).restoredOne(this, by);
  }

  private burst(L: Level3D) {
    const c = this.center();
    ambient(L, () => {
      audio.sfx('colorRestore');
      L.fx.stars(c.clone().setY(c.y + 0.3), 26, ['#e8893a', '#fff0d8', '#ffd34a']);
      L.fx.ring(this.body.pos.clone().setY(this.body.pos.y + 0.08), 2.2, '#e8893a', 0.5);
    });
    this.stars.visible = false;
    L.actors.push(new HappyGoat(L, this, LINES4.goatThanks[0]));
  }

  netEvent(L: Level3D, ev: string, data?: unknown) {
    if (ev === 'gone') {
      const d = (data ?? {}) as { how?: string; by?: string };
      if (d.how === 'restore' && !this.dead) {
        this.dead = true;
        L.countKill(this);
        this.burst(L);
        vamp(L).restoredOne(this, d.by ?? null);
        return;
      }
    }
    super.netEvent(L, ev);
  }
  protected netExtra(): number[] { return [this.stun > 0 ? 1 : 0]; }
  protected netExtraApply(a: number[], i: number) { this.netStun = !!a[i]; }

  sync(L: Level3D, dt: number) {
    super.sync(L, dt);
    const stunned = L.authority ? this.stun > 0 : this.netStun;
    this.stars.visible = stunned && !this.dead;
    if (stunned) spinStars(this.stars, this.t, 0.3);
  }
  syncRig(dt: number) {
    const stunned = this.stun > 0 || this.netStun;
    this.anim.st = stunned ? 'stun' : 'shuffle';
    this.anim.speed = Math.hypot(this.body.vel.x, this.body.vel.z);
    this.anim.flash = this.flash;
    this.rig.sleepy = 1;
    this.setGrey(1);
    this.rig.update(dt, this.anim);
  }
  takeRig() { const r = this.rig; this.root.remove(r.root); return { rig: r, setGrey: this.setGrey }; }
  deathFx() { /* restored, never killed */ }
}

/** a restored goat: colour flows back, a «Ме-е!», then hopping about (a local actor on every machine) */
class HappyGoat implements Actor3 {
  dead = false;
  root = new THREE.Group();
  private rig: GoatRig;
  private setGrey: (k: number) => void;
  private grey: number;
  private t = 0;
  private anim: GoatAnim = { st: 'happy', speed: 0, flash: 0 };
  private home: THREE.Vector3;
  private goal: THREE.Vector3 | null = null;
  private waitT = 2.2;
  private vel = new THREE.Vector3();
  private said = false;
  constructor(L: Level3D, g: Goat3, private line: string, quiet = false) {
    const r = g.takeRig();
    this.rig = r.rig; this.setGrey = r.setGrey; this.grey = quiet ? 0 : 1;
    if (quiet) { this.said = true; this.t = 3; this.rig.sleepy = 0; }
    this.root.position.copy(g.body.pos);
    this.root.rotation.y = g.yaw;
    this.root.add(this.rig.root);
    this.home = g.body.pos.clone();
    L.scene.add(this.root);
  }
  update(L: Level3D, dt: number) {
    this.t += dt;
    this.grey = damp(this.grey, 0, 5, dt);
    this.setGrey(this.grey);
    this.rig.sleepy = Math.max(0, this.rig.sleepy - dt * 3);
    if (!this.said && this.t > 0.35) { this.said = true; ambient(L, () => L.bark(this.root, this.line, 2.4, this.rig.top + 0.6)); }
    const p = this.root.position;
    if (this.t < 2.2) { this.anim.st = 'happy'; this.vel.set(0, 0, 0); }
    else {
      const near = L.heroes().find((h) => h.pos.distanceTo(p) < 3.5);
      if ((this.waitT -= dt) <= 0 || this.goal) {
        if (!this.goal) { const a = rand(0, Math.PI * 2), r = rand(0.5, 2.5); this.goal = new THREE.Vector3(this.home.x + Math.cos(a) * r, p.y, this.home.z + Math.sin(a) * r); }
        const dx = this.goal.x - p.x, dz = this.goal.z - p.z, d = Math.hypot(dx, dz);
        const gy = L.phys.groundAt(p.x + dx / (d || 1) * 0.5, p.z + dz / (d || 1) * 0.5, p.y + 0.5, 0.1);
        if (d < 0.2 || gy < p.y - 0.4) { this.goal = null; this.waitT = rand(2, 5); this.vel.set(0, 0, 0); }
        else { this.vel.set(dx / d * 1.3, 0, dz / d * 1.3); this.root.rotation.y = Math.atan2(dx, dz); }
      }
      p.addScaledVector(this.vel, dt);
      this.anim.st = near && !this.goal ? 'wave' : this.goal ? 'shuffle' : 'idle';
      if (near && !this.goal) this.root.rotation.y = Math.atan2(near.pos.x - p.x, near.pos.z - p.z);
    }
    this.anim.speed = this.vel.length();
    this.rig.update(dt, this.anim);
  }
}

ENEMY_KINDS.goat = (p, o) => new Goat3(p, o);
