import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { W, clamp, rand } from '../../../../engine/util';
import { rrect, text } from '../../../../art/draw';
import { net } from '../../../../net/session';
import { save } from '../../../../engine/save';
import { coop } from '../../coop';
import type { Level3D, Actor3 } from '../../level';
import { ambient } from '../vampires';
import { LINES4 } from './lines';

/**
 * Wind gusts on the ridge (fangs4): a rhythm everyone can learn — calm, a warning (flags snap, dust streaks, a howl,
 * «ПОРЫВ!» on the HUD), then a gust that shoves you toward the chasm. Hide in the lee of a concrete block, grab a rail,
 * or lean into it (walk against the wind: you hold your ground).
 *
 * The rhythm is a pure function of the shared clock (net.time() in co-op — the host's — or the level time solo), so
 * every machine has the same gusts at the same moment without a single message. Each machine pushes only its own hero
 * (through the physics step, so walls and rails still hold).
 */

export interface WindPhase { k: number; warn: number; t: number }

export class Wind implements Actor3 {
  dead = false;
  /** where it blows (boxes: x0, x1, z0, z1, y0, y1) */
  zones: number[][] = [];
  /** lee spots: boxes where a hero is sheltered */
  lee: number[][] = [];
  flags: ((k: number, t: number, yaw: number) => void)[] = [];
  readonly dir: THREE.Vector3;
  period = 5.6; calm = 3.0; warnT = 1.0; gust = 1.6;
  strength: number;
  /** what my hero feels now (0..1) and whether he is in the wind area / sheltered (HUD) */
  felt = 0; inZone = false; sheltered = false;
  phase: WindPhase = { k: 0, warn: 0, t: 0 };
  private wasGust = false;
  private fxT = 0;
  constructor(private L: Level3D, dir: THREE.Vector3, strength = 5.5) {
    this.dir = dir.clone().setY(0).normalize();
    const easy = L.nl ? coop.easy : save.data.settings.easy;
    this.strength = easy ? strength * 0.72 : strength;
    // my hero's physics step carries the push (like the vampire kit's «пресный» slowdown)
    const phys = L.phys, orig = phys.move.bind(phys);
    phys.move = (b, dt) => {
      if (b !== L.player.body || this.felt <= 0) { orig(b, dt); return; }
      const wx = this.dir.x * this.strength * this.felt, wz = this.dir.z * this.strength * this.felt;
      b.vel.x += wx; b.vel.z += wz;
      try { orig(b, dt); } finally { b.vel.x -= wx; b.vel.z -= wz; }
    };
    L.actors.push(this);
    L.overlayDraw.push((ctx) => this.draw(ctx));
  }
  zone(x0: number, x1: number, z0: number, z1: number, y0 = -10, y1 = 30) { this.zones.push([Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1), y0, y1]); }
  shelter(x0: number, x1: number, z0: number, z1: number) { this.lee.push([Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1)]); }

  /** the gust at clock time t: k = push 0..1 (eased in/out), warn = 0..1 in the warning beat */
  at(t: number): WindPhase {
    const ph = ((t % this.period) + this.period) % this.period;
    let k = 0, warn = 0;
    if (ph >= this.calm && ph < this.calm + this.warnT) warn = (ph - this.calm) / this.warnT;
    else if (ph >= this.calm + this.warnT) {
      const g = ph - this.calm - this.warnT;
      k = Math.min(1, g / 0.22, (this.gust - g) / 0.25);
      warn = 1;
    }
    return { k: clamp(k, 0, 1), warn, t: ph };
  }

  private inBox(p: THREE.Vector3, b: number[]) { return p.x >= b[0] && p.x <= b[1] && p.z >= b[2] && p.z <= b[3] && (b.length < 6 || (p.y >= b[4] && p.y <= b[5])); }

  update(L: Level3D, dt: number) {
    const now = L.nl ? net.time() : L.t;
    const ph = this.phase = this.at(now);
    const p = L.player;
    this.inZone = this.zones.some((z) => this.inBox(p.pos, z));
    this.sheltered = this.inZone && this.lee.some((z) => this.inBox(p.pos, z));
    const free = this.inZone && !this.sheltered && !p.dead && !p.downed && !p.hidden && p.control && !L.worldCut && !p.grabbedBy;
    this.felt = free ? ph.k : 0;
    const yaw = Math.atan2(this.dir.x, this.dir.z) - Math.PI / 2;
    for (const f of this.flags) f(Math.max(0.12, ph.k, ph.warn * 0.45), L.t, yaw);
    // (every machine shows its own: nothing here is captured for friends)
    ambient(L, () => this.fx(L, ph, dt));
  }

  private fx(L: Level3D, ph: WindPhase, dt: number) {
    const p = L.player;
    const gust = ph.k > 0.05;
    if (gust && !this.wasGust && this.inZone) {
      audio.sfx('whoosh', { pitch: 0.45, volume: 0.9 }); audio.sfx('whoosh', { pitch: 0.6, volume: 0.6 });
      L.tcam.shake(0.12);
      L.hint('f4wind', LINES4.windHint);
    }
    this.wasGust = gust;
    if (!this.inZone) return;
    // dust streaks blowing across the ridge (more in the gust, a few in the warning)
    this.fxT -= dt;
    const rate = gust ? 0.02 : ph.warn > 0 ? 0.08 : 0.5;
    if (this.fxT <= 0) {
      this.fxT = rate;
      const c = p.pos.clone().add(new THREE.Vector3(rand(-6, 6), rand(0.3, 3.5), rand(-8, 8))).addScaledVector(this.dir, -5);
      L.fx.emit(c, { count: gust ? 2 : 1, speed: gust ? [14, 22] : [5, 9], dir: this.dir, spread: 0.05, life: [0.35, 0.7], size: [0.05, 0.1], size2: 0.4, colors: ['#e8dcf0', '#c8b8d8', '#ffffff'], drag: 0.3 });
    }
  }

  /** HUD: the rhythm (calm … ПОРЫВ! … gust) while my hero is in the wind */
  private draw(ctx: CanvasRenderingContext2D) {
    const L = this.L;
    if (!this.inZone || L.letterbox > 0.3 || L.player.dead) return;
    const ph = this.phase;
    const x = W - 250, y = 150;
    rrect(ctx, x, y, 230, 54, 14, 'rgba(20,10,30,0.6)', 3);
    const k = ph.t / this.period;
    // the beat bar: calm (grey) → warning (amber) → gust (red), the cursor where we are
    const bx = x + 14, bw = 202, by = y + 34;
    const c1 = this.calm / this.period, c2 = (this.calm + this.warnT) / this.period;
    ctx.fillStyle = 'rgba(200,190,220,0.35)'; ctx.fillRect(bx, by, bw * c1, 8);
    ctx.fillStyle = '#ffb02a'; ctx.fillRect(bx + bw * c1, by, bw * (c2 - c1), 8);
    ctx.fillStyle = '#ff4a5a'; ctx.fillRect(bx + bw * c2, by, bw * (1 - c2), 8);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(bx + bw * k - 2, by - 4, 4, 16);
    const blink = 0.6 + 0.4 * Math.sin(L.t * 18);
    const label = this.sheltered ? LINES4.windHud.lee : ph.k > 0.05 ? LINES4.windHud.gust : ph.warn > 0 ? LINES4.windHud.warn : LINES4.windHud.calm;
    const col = this.sheltered ? '#9ae8a0' : ph.k > 0.05 ? '#ff6a7a' : ph.warn > 0 ? '#ffc04a' : '#e8dcf0';
    text(ctx, '➜ ' + label, x + 115, y + 24, { size: 19, color: col, align: 'center', stroke: 4, alpha: ph.warn > 0 && !this.sheltered ? blink : 1 });
  }
}
