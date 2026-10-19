import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { approach, choose, rand } from '../../../../engine/util';
import { Enemy3, ENEMY_KINDS, type EnemyOpts } from '../../enemies';
import type { Level3D, HeroLike } from '../../level';
import { Vamp3, Fanger3, Folk3, VAMP_LINES, GroundMark, ambient, markCharacter, greyHandle, type VampKit } from '../vampires';
import { ghoulize, createBloodFrog, createWisp, createFrogFolk } from './models';
import { GHOUL, BLOODFROG, WISP, FROG_SLEEPY, FROG_THANKS, TOASTS } from './lines';

/**
 * The swamp's own enemies (docs/script-fangs.md §6.2.3), on top of the vampire kit:
 *   ghoul      — Болотный упырь: a Клыкарь of the bog (crouch → lunge-bite: −1 ♥ and «пресный»), swamp barks
 *   bloodfrog  — Лягушка-кровосос: hops after you; crouches (red ring on the ground where it will land), leaps and bites
 *                (−1 ♥, «пресный»); sits dazed after the leap (×1.5 damage)
 *   wisp       — Огонёк-обманка: a cold flame over the bog; near a hero it «calls» and pulls him toward itself (into the
 *                трясина). One hit pops it. Real fireflies are warm, yellow and blink — wisps never blink.
 *   frogfolk   — a frog villager drained grey (a пресняк with a frog rig and frog barks)
 * Co-op: the host simulates; clients play the snapshots back. The wisp's pull is applied by every machine to its own
 * hero from the puppet it sees (victim side), like the kit's attacks.
 */

declare module '../../enemies' {
  interface ExtraEnemyKinds { ghoul: true; bloodfrog: true; wisp: true; frogfolk: true }
}

const v = new THREE.Vector3();
const v2 = new THREE.Vector3();

// ═════════════════════════════ БОЛОТНЫЙ УПЫРЬ ═════════════════════════════
export class Ghoul3 extends Fanger3 {
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super(pos, o);
    this.kind = 'ghoul';
    ghoulize(this.rig);
  }
  /** the Клыкарь's lines → the swamp ghoul's (§6.2.3); the kit's light lines stay */
  protected bark(L: Level3D, lines: readonly string[], chance = 1) {
    if (lines === VAMP_LINES.fangerSpot || lines === VAMP_LINES.fangerBite) lines = GHOUL;
    super.bark(L, lines, chance);
  }
}

// ═════════════════════════════ ЛЯГУШКА-КРОВОСОС ═════════════════════════════
export class BloodFrog3 extends Vamp3 {
  protected readonly ACTS = ['idle', 'walk', 'hop', 'crouch', 'leap', 'recover', 'hiss', 'stun', 'burn', 'home'] as const;
  private spot = new THREE.Vector3();
  private bitten = false;
  private hopT = rand(0, 0.5);
  private airT = 0;
  private mark = new GroundMark('#ff3040', true);
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('bloodfrog', pos, 0.36, 0.6, createBloodFrog(), { aggro: 12, ...o });
    this.hp = this.maxHp = 2; this.loot = 2;
    this.marks.push(this.mark);
  }
  protected brain(L: Level3D, K: VampKit, dt: number) {
    const b = this.body, t = this.target;
    if (this.act === 'leap') {
      this.airT += dt;
      if (!this.bitten && this.airT > 0.15) for (const h of L.alivePlayers()) {
        const c = h.center(v2);
        if (Math.hypot(c.x - b.pos.x, c.z - b.pos.z) < 0.85 && Math.abs(c.y - (b.pos.y + 0.3)) < 1.0) {
          this.bitten = true;
          if (h.hurt(L, 1, b.pos.clone())) { K.bland(h, 2); audio.sfx('bite'); this.bark(L, BLOODFROG, 0.6); }
          break;
        }
      }
      if ((b.onGround && this.airT > 0.12) || this.airT > 1.6) {
        this.go('recover', 0.9); b.vel.set(0, 0, 0);
        audio.sfx('splash', { pitch: 1.6, volume: 0.35 });
        L.fx.dust(b.pos.clone(), 8, '#8aa070');
      }
      return;
    }
    if (this.act === 'recover') { this.halt(dt, 14); if (this.at <= 0) this.go('walk'); return; }
    if (this.act === 'crouch') {
      this.halt(dt, 30);
      this.faceToward(this.spot.x, this.spot.z, dt, 10);
      if (t && this.pr < 0.55) this.aimAt(L, t);
      if (this.at <= 0) this.leap();
      return;
    }
    if (this.act === 'hop' && !b.onGround) return;
    if (!t) { this.idle(L, K, dt, 0.9); this.hopIdle(dt); return; }
    const dist = this.tdist(t), dy = t.pos.y - b.pos.y;
    if (K.sunAt(t.pos) > 0.3) {
      this.go('hiss');
      this.steer(L, K, t.pos.x, t.pos.z, 2, dt, true);
      this.faceToward(t.pos.x, t.pos.z, dt, 6);
      return;
    }
    if (this.cd <= 0 && b.onGround && dist < 5.5 && dist > 1.2 && Math.abs(dy) < 1.5) {
      this.aimAt(L, t);
      this.go('crouch', 0.7); this.cd = rand(2, 2.8) * this.cdMul(L);
      audio.sfx('hiss', { volume: 0.4, pitch: 1.4 });
      this.bark(L, BLOODFROG, 0.35);
      return;
    }
    // hop after him
    this.go('walk');
    this.steer(L, K, t.pos.x, t.pos.z, dist > 3 ? 3.2 : 0, dt);
    if ((this.hopT -= dt) <= 0 && b.onGround && dist > 3) {
      this.hopT = rand(0.45, 0.7);
      const dx = t.pos.x - b.pos.x, dz = t.pos.z - b.pos.z, l = Math.hypot(dx, dz) || 1;
      if (this.groundAhead(L, dx / l, dz / l, 1.4)) { b.vel.x = (dx / l) * 4.2; b.vel.z = (dz / l) * 4.2; b.vel.y = 6.5; this.go('hop'); }
    }
  }
  private hopIdle(dt: number) {
    const b = this.body;
    if ((this.hopT -= dt) <= 0 && b.onGround && Math.hypot(b.vel.x, b.vel.z) > 0.4) { this.hopT = rand(0.8, 1.4); b.vel.y = 5; }
  }
  private aimAt(L: Level3D, t: HeroLike) {
    const gy = L.phys.groundAt(t.pos.x, t.pos.z, t.pos.y + 0.5, 0.1);
    this.spot.set(t.pos.x + t.vel.x * 0.25, gy > -1e8 ? gy : t.pos.y, t.pos.z + t.vel.z * 0.25);
  }
  private leap() {
    const b = this.body;
    const T = 0.62;
    b.vel.set((this.spot.x - b.pos.x) / T, (this.spot.y - b.pos.y + 0.5 * 32 * T * T) / T, (this.spot.z - b.pos.z) / T);
    b.onGround = false;
    this.go('leap', T); this.bitten = false; this.airT = 0;
    audio.sfx('jump', { pitch: 0.7, volume: 0.5 });
  }
  protected onSpot(L: Level3D, t: HeroLike, loud = true) { super.onSpot(L, t, loud); if (loud) this.bark(L, BLOODFROG, 0.5); }
  protected dmgMul() { return this.act === 'recover' ? 1.5 : 1; }
  protected pose() { return this.act === 'walk' ? (this.body.onGround ? 'idle' : 'hop') : super.pose(); }
  protected visuals(L: Level3D) {
    if (this.act === 'crouch' || this.act === 'leap') this.mark.show(L, this.spot.x, this.spot.y, this.spot.z, 1.0, this.act === 'leap' ? 0.8 : 0.25 + 0.55 * this.pr);
    else this.mark.hide();
  }
  protected netMore() { return [this.spot.x, this.spot.y, this.spot.z]; }
  protected netMoreApply(a: number[], i: number) { this.spot.set(a[i], a[i + 1], a[i + 2]); }
}

// ═════════════════════════════ ОГОНЁК-ОБМАНКА ═════════════════════════════
const LURE_R = 7;
const PULL = 1.7;
export class Wisp3 extends Enemy3 {
  rig = createWisp();
  private anim = { st: 'idle', p: 0, speed: 0, flash: 0 };
  /** calling a hero now (host: decided; clients: from the snapshots) */
  luring = false;
  private lureT = 0;
  private barkCD = rand(0, 2);
  private tether: THREE.Line;
  private tetherPos: Float32Array;
  private hinted = false;
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super('wisp', pos, 0.3, 0.5);
    this.root.add(this.rig.root);
    this.hp = this.maxHp = 1; this.loot = 1; this.contact = 0;
    this.flying = true; this.body.gravity = 0;
    this.blob.visible = false;
    this.yaw = o.yaw ?? rand(0, Math.PI * 2);
    this.tetherPos = new Float32Array(3 * 12);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.tetherPos, 3));
    this.tether = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#7affe0', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tether.frustumCulled = false; this.tether.visible = false;
    this.tether.layers.set(1);
  }
  provoke() { /* lures, never hunts */ }
  tick(L: Level3D, dt: number) {
    const b = this.body;
    // drift around home, a little toward whoever it calls
    const hs = L.alivePlayers();
    let near: HeroLike | null = null, nd = LURE_R;
    for (const h of hs) { const d = Math.hypot(h.pos.x - b.pos.x, h.pos.z - b.pos.z); if (d < nd && Math.abs(h.pos.y - b.pos.y) < 4) { nd = d; near = h; } }
    const was = this.luring;
    this.luring = !!near && this.stun <= 0;
    if (this.luring && !was) {
      this.lureT = 0;
      if (this.barkCD <= 0) { this.barkCD = rand(3, 5); L.bark(this.root, choose(WISP), 1.6, 0.9); }
    }
    this.barkCD -= dt; this.lureT += dt;
    if (this.stun > 0) this.stun -= dt;
    const gx = this.home.x + Math.sin(this.t * 0.6) * 0.8, gz = this.home.z + Math.cos(this.t * 0.5) * 0.8, gy = this.home.y + Math.sin(this.t * 1.3) * 0.25;
    b.vel.set((gx - b.pos.x) * 1.5, (gy - b.pos.y) * 1.5, (gz - b.pos.z) * 1.5);
    if (near) this.faceToward(near.pos.x, near.pos.z, dt, 4);
    L.phys.move(b, dt);
  }
  protected netExtra() { return [this.luring ? 1 : 0]; }
  protected netExtraApply(a: number[], i: number) { this.luring = !!a[i]; }
  sync(L: Level3D, dt: number) {
    super.sync(L, dt);
    this.blob.visible = false;
    // the pull on MY hero (every machine, from the wisp it sees)
    const p = L.player;
    const on = this.luring && !this.dead && !p.dead && !p.downed && !p.hidden && !p.grabbedBy && !L.worldCut && p.control;
    const dx = this.body.pos.x - p.pos.x, dz = this.body.pos.z - p.pos.z, d = Math.hypot(dx, dz);
    const pulling = on && d < LURE_R && d > 0.6 && Math.abs(this.body.pos.y - p.pos.y) < 4;
    if (pulling) {
      p.body.pos.x += (dx / d) * PULL * dt; p.body.pos.z += (dz / d) * PULL * dt;
      if (!this.hinted) { this.hinted = true; L.hint('fangs2wisp', TOASTS.wispPull); }
    }
    // a faint wavy thread of cold light from the wisp to the hero it calls
    this.tether.visible = pulling;
    if (pulling) {
      if (!this.tether.parent) L.scene.add(this.tether);
      const a = this.center(v), c = p.center(v2);
      for (let i = 0; i < 12; i++) {
        const k = i / 11;
        const w = Math.sin(k * Math.PI) * 0.25 * Math.sin(this.t * 7 + k * 9);
        this.tetherPos[i * 3] = a.x + (c.x - a.x) * k + w;
        this.tetherPos[i * 3 + 1] = a.y + (c.y - a.y) * k + Math.sin(k * Math.PI) * 0.4;
        this.tetherPos[i * 3 + 2] = a.z + (c.z - a.z) * k - w;
      }
      (this.tether.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.tether.material as THREE.LineBasicMaterial).opacity = 0.35 + 0.2 * Math.sin(this.t * 10);
    }
  }
  syncRig(dt: number) {
    this.anim.st = this.stun > 0 ? 'stun' : this.luring ? 'lure' : 'idle';
    this.anim.flash = this.flash;
    this.rig.update(dt, this.anim);
  }
  center(out = new THREE.Vector3()) { return out.copy(this.body.pos).setY(this.body.pos.y + 0.1); }
  hurt(L: Level3D, _dmg: number, _from: THREE.Vector3, _kind: string) {
    if (!L.authority || this.dead) return;
    this.hp = 0;
    this.die(L);
  }
  deathFx(L: Level3D, c: THREE.Vector3) {
    this.tether.removeFromParent();
    ambient(L, () => {
      L.fx.stars(c.clone(), 18, ['#7affe0', '#c8fff4', '#ffffff']);
      L.fx.ring(c.clone(), 1.2, '#7affe0', 0.35, false);
      audio.sfx('pogo', { pitch: 1.8, volume: 0.5 });
    });
  }
  netEvent(L: Level3D, ev: string) {
    if (ev === 'gone' && !this.dead) { this.deathFx(L, this.center()); }
    super.netEvent(L, ev);
  }
}

// ═════════════════════════════ ЛЯГУШКИ-ПРЕСНЯКИ ═════════════════════════════
export class FrogFolk3 extends Folk3 {
  constructor(pos: THREE.Vector3, o: EnemyOpts = {}) {
    super(pos, { ...o, folk: 'marmelad' });
    this.kind = 'frogfolk';
    const seed = Math.abs(Math.round(pos.x * 7 + pos.z * 13));
    this.root.remove(this.rig.root);
    const frog = createFrogFolk(seed);
    this.rig = frog;
    this.root.add(frog.root);
    markCharacter(frog.root);
    const setGrey = greyHandle(frog.root);
    (this as unknown as { setGrey: (k: number) => void }).setGrey = setGrey;
    setGrey(1);
    this.stars.position.y = frog.top + 0.12;
  }
}

/** frog villagers bark like frogs: the kit's candy-town lines said over a frog become the swamp's (§6.2.3) */
export function frogBarks(L: Level3D) {
  const sleepy = new Set<string>([...VAMP_LINES.folkSleepy, ...VAMP_LINES.folkStun]);
  const thanks = new Set<string>(VAMP_LINES.folkThanks);
  const orig = L.bark.bind(L);
  L.bark = (obj: THREE.Object3D, str: string, dur?: number, dy?: number) => {
    if ((sleepy.has(str) || thanks.has(str)) && obj.getObjectByName('frogfolk')) {
      const list = thanks.has(str) ? FROG_THANKS : FROG_SLEEPY;
      str = list[str.length % list.length];
    }
    orig(obj, str, dur, dy);
  };
}

ENEMY_KINDS.ghoul = (p, o) => new Ghoul3(p, o);
ENEMY_KINDS.bloodfrog = (p, o) => new BloodFrog3(p, o);
ENEMY_KINDS.wisp = (p, o) => new Wisp3(p, o);
ENEMY_KINDS.frogfolk = (p, o) => new FrogFolk3(p, o);

void approach;
