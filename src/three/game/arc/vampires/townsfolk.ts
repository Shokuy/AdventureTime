import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { approach, choose, rand } from '../../../../engine/util';
import { Enemy3, ENEMY_KINDS, type EnemyOpts } from '../../enemies';
import type { Level3D, Actor3 } from '../../level';
import { vamp, type FolkLike } from './kit';
import { markCharacter, greyHandle } from './greyShader';
import { createFolk, createStars, spinStars, FOLK_KINDS, FOLK_COLORS, type FolkKind, type VAnim, type VRig } from './models';
import { LINES } from './lines';
import { ambient } from './fxUtil';
import { damp } from '../../../models/kit';

/**
 * Пресняки — candy townsfolk the vampires drained: grey, sleepy, shuffling about. They are never killed:
 *  • any hit stuns them (stars, 5 s);
 *  • a sword / spin / fork hit while stunned restores them — and so does a 'chord' or 'syrup' hit at any time, or
 *    `folk.restore(L, by)` / `vamp(L).restoreAround(...)` / `vamp(L).chord(...)`;
 *  • restored: colour pops back (confetti, sound), they thank you, drop a few crumbs and stay in town, happy.
 * A restore counts like a kill (the restorer's score, the level's «Враги» line) and for the kit's counter / onRestore.
 * Co-op: the host decides; clients get the restore with the 'gone' event (how 'restore') and show the same.
 */
const v = new THREE.Vector3();
// any hero's melee (Бублик's paw too) wakes a stunned пресняк
const RESTORE_HITS = new Set(['sword', 'spin', 'fork', 'punch']);
const STUN = 5;

export class Folk3 extends Enemy3 implements FolkLike {
  readonly folk = true as const;
  rig: VRig & { sleepy: number };
  anim: VAnim = { st: 'shuffle', p: 0, speed: 0, flash: 0 };
  folkKind: FolkKind;
  stars = createStars();
  private setGrey: (k: number) => void;
  private grey = 1;
  private goal: THREE.Vector3 | null = null;
  private waitT = rand(0.5, 3);
  private yawnT = rand(4, 12);
  private netStun = false;
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('presnyak', pos, 0.32, 0.9);
    const seed = Math.abs(Math.round(pos.x * 7 + pos.z * 13));
    this.folkKind = o.folk ?? FOLK_KINDS[seed % FOLK_KINDS.length];
    this.rig = createFolk(this.folkKind, seed);
    this.root.add(this.rig.root);
    markCharacter(this.rig.root);
    this.setGrey = greyHandle(this.rig.root);
    this.setGrey(1);
    this.stars.position.y = this.rig.top + 0.12;
    this.root.add(this.stars);
    this.hp = this.maxHp = 1; this.loot = 0; this.contact = 0;
    this.yaw = o.yaw ?? rand(0, Math.PI * 2);
  }
  provoke() { /* townsfolk don't fight */ }

  private checked = false;
  update(L: Level3D, dt: number) {
    // restored in an earlier try (respawn / team restart rebuilt the level): already happy, quietly
    if (!this.checked) {
      this.checked = true;
      vamp(L).folkTotal++;
      if (this.key && L.seen.has(this.key)) {
        this.dead = true;
        L.nl?.remove(this);
        L.actors.push(new HappyFolk(L, this, '', true));
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
    // sleepwalking around home
    if (this.waitT > 0) { this.waitT -= dt; b.vel.x = approach(b.vel.x, 0, 8 * dt); b.vel.z = approach(b.vel.z, 0, 8 * dt); }
    else {
      if (!this.goal) { const a = rand(0, Math.PI * 2), r = rand(0.5, 3); this.goal = new THREE.Vector3(this.home.x + Math.cos(a) * r, b.pos.y, this.home.z + Math.sin(a) * r); }
      let dx = this.goal.x - b.pos.x, dz = this.goal.z - b.pos.z;
      const d = Math.hypot(dx, dz);
      dx /= d || 1; dz /= d || 1;
      const ok = b.onGround ? this.groundAhead(L, dx, dz) : true;
      const sp = ok ? 0.6 : 0;
      b.vel.x = approach(b.vel.x, dx * sp, 6 * dt); b.vel.z = approach(b.vel.z, dz * sp, 6 * dt);
      this.faceToward(this.goal.x, this.goal.z, dt, 2.5);
      if (d < 0.3 || !ok || b.hitWall) { this.goal = null; this.waitT = rand(1.5, 4); }
    }
    if ((this.yawnT -= dt) <= 0) {
      this.yawnT = rand(8, 16);
      if (L.heroes().some((h) => h.pos.distanceTo(b.pos) < 10)) L.bark(this.root, choose(LINES.folkSleepy as unknown as string[]), 1.8, this.rig.top + 0.5);
    }
    L.phys.move(b, dt);
  }

  hurt(L: Level3D, _dmg: number, from: THREE.Vector3, kind: string) {
    if (!L.authority || this.dead) return;
    if (kind === 'chord' || kind === 'syrup' || (this.stun > 0 && RESTORE_HITS.has(kind))) { this.restore(L, L.attacker); return; }
    // any other hit (or a first hit): stunned
    const fresh = this.stun <= 0;
    this.stun = STUN;
    this.flash = 1;
    v.copy(this.body.pos).sub(from).setY(0);
    if (v.lengthSq() > 1e-4) { v.normalize(); this.body.vel.x = v.x * 3; this.body.vel.z = v.z * 3; }
    audio.sfx('pogo', { pitch: 0.8, volume: 0.6 });
    L.fx.stars(this.center().setY(this.body.pos.y + this.rig.top), 12);
    if (fresh) {
      L.bark(this.root, choose(LINES.folkStun as unknown as string[]), 1.2, this.rig.top + 0.5);
      L.hint('presnyak', 'Пресняк оглушён! Ударьте его мечом ещё раз или брызните сиропом — и вернёте ему цвет');
    }
  }

  /** bring the colour back (host / solo; `by` = member id for the score) */
  restore(L: Level3D, by: string | null = null) {
    if (!L.authority || this.dead) return;
    this.dead = true;
    this.hp = 0; // (the score plugin credits the hit that dropped the hp)
    const li = Math.floor(Math.random() * LINES.folkThanks.length);
    const c = this.center();
    L.nl?.gone(this, 'restore', c, { li, by: by ?? undefined });
    this.burst(L, li);
    for (let i = 0; i < 2; i++) L.dropPickup('crumb', c);
    if (Math.random() < 0.15) L.dropPickup('heart', c);
    L.countKill(this);
    vamp(L).restoredOne(this, by);
  }

  /** every machine: the colour bursts back, a happy townsperson stays */
  private burst(L: Level3D, li: number) {
    const c = this.center();
    // (every machine shows it itself — never captured / re-sent)
    ambient(L, () => {
      audio.sfx('colorRestore');
      L.fx.stars(c.clone().setY(c.y + 0.3), 26, FOLK_COLORS[this.folkKind]);
      L.fx.juice(c.clone(), 18, FOLK_COLORS[this.folkKind], this.body.pos.y);
      L.fx.ring(this.body.pos.clone().setY(this.body.pos.y + 0.08), 2.2, FOLK_COLORS[this.folkKind][0], 0.5);
    });
    this.stars.visible = false;
    const happy = new HappyFolk(L, this, LINES.folkThanks[li % LINES.folkThanks.length]);
    L.actors.push(happy);
  }

  netEvent(L: Level3D, ev: string, data?: unknown) {
    if (ev === 'gone') {
      const d = (data ?? {}) as { how?: string; li?: number; by?: string };
      if (d.how === 'restore' && !this.dead) {
        this.dead = true;
        L.countKill(this);
        this.burst(L, d.li ?? 0);
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
    const a = this.anim;
    const stunned = this.stun > 0 || this.netStun;
    a.st = stunned ? 'stun' : 'shuffle';
    a.speed = Math.hypot(this.body.vel.x, this.body.vel.z);
    a.flash = this.flash;
    this.rig.sleepy = 1;
    this.setGrey(this.grey);
    this.rig.update(dt, a);
  }
  /** (happy folk take the rig over) */
  takeRig() { const r = this.rig; this.root.remove(r.root); return { rig: r, setGrey: this.setGrey, grey: this.grey }; }
  deathFx() { /* restored, not killed */ }
}

/** a restored townsperson: colour flows back, a thank-you, then a happy little life in town (local on every machine) */
class HappyFolk implements Actor3 {
  dead = false;
  root = new THREE.Group();
  private rig: VRig & { sleepy: number };
  private setGrey: (k: number) => void;
  private grey: number;
  private t = 0;
  private anim: VAnim = { st: 'happy', p: 0, speed: 0, flash: 0 };
  private home: THREE.Vector3;
  private goal: THREE.Vector3 | null = null;
  private waitT = 2.2;
  private vel = new THREE.Vector3();
  private said = false;
  constructor(private L: Level3D, f: Folk3, private line: string, quiet = false) {
    const r = f.takeRig();
    this.rig = r.rig; this.setGrey = r.setGrey; this.grey = quiet ? 0 : r.grey;
    if (quiet) { this.said = true; this.t = 3; this.rig.sleepy = 0; }
    this.root.position.copy(f.body.pos);
    this.root.rotation.y = f.yaw;
    this.root.add(this.rig.root);
    this.home = f.body.pos.clone();
    L.scene.add(this.root);
  }
  update(L: Level3D, dt: number) {
    this.t += dt;
    this.grey = damp(this.grey, 0, 5, dt);
    this.setGrey(this.grey);
    this.rig.sleepy = Math.max(0, this.rig.sleepy - dt * 3);
    if (!this.said && this.t > 0.35) { this.said = true; L.bark(this.root, this.line, 2.4, this.rig.top + 0.5); }
    const p = this.root.position;
    if (this.t < 2.2) { this.anim.st = 'happy'; this.vel.set(0, 0, 0); }
    else {
      // potter about: walk a little, wave at heroes passing by
      const near = L.heroes().find((h) => h.pos.distanceTo(p) < 3.5);
      if ((this.waitT -= dt) <= 0 || this.goal) {
        if (!this.goal) { const a = rand(0, Math.PI * 2), r = rand(0.5, 2.5); this.goal = new THREE.Vector3(this.home.x + Math.cos(a) * r, p.y, this.home.z + Math.sin(a) * r); }
        const dx = this.goal.x - p.x, dz = this.goal.z - p.z, d = Math.hypot(dx, dz);
        const gy = L.phys.groundAt(p.x + dx / (d || 1) * 0.5, p.z + dz / (d || 1) * 0.5, p.y + 0.5, 0.1);
        if (d < 0.2 || gy < p.y - 0.4) { this.goal = null; this.waitT = rand(2, 5); this.vel.set(0, 0, 0); }
        else { this.vel.set(dx / d * 1.1, 0, dz / d * 1.1); this.root.rotation.y = Math.atan2(dx, dz); }
      }
      p.addScaledVector(this.vel, dt);
      this.anim.st = near && !this.goal ? 'wave' : this.goal ? 'shuffle' : 'idle';
      if (near && !this.goal) this.root.rotation.y = Math.atan2(near.pos.x - p.x, near.pos.z - p.z);
    }
    this.anim.speed = this.vel.length();
    this.rig.update(dt, this.anim);
    void this.L;
  }
}

ENEMY_KINDS.presnyak = (p, o) => new Folk3(p, o);
