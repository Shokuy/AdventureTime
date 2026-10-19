import { approach, clamp, damp, overlap, rand, sign, Rect, choose, lerp, TAU } from '../engine/util';
import { audio } from '../engine/audio';
import { save } from '../engine/save';
import { drawKing, drawKingArms, drawThrone, KingHand, KingPose } from '../art/characters';
import { glow } from '../art/draw';
import type { LevelScene, BossLike } from '../scenes/level';
import { Projectile, Shockwave, Faller, makeEnemy, Enemy } from './entities';

type C = CanvasRenderingContext2D;

type HandState = 'rest' | 'rise' | 'track' | 'slam' | 'stuck' | 'lift' | 'sweepPrep' | 'sweep' | 'clap';

class Hand {
  x: number; y: number;
  state: HandState = 'rest';
  t = 0; vy = 0;
  glow = 0; flash = 0;
  look: KingHand['state'] = 'rest';
  hitIds = new Set<number>();
  targetX = 0;
  sweepDir = 1;
  rot = 0;
  constructor(public side: -1 | 1, public restX: number, public restY: number) { this.x = restX; this.y = restY; }
  rect(s: number): Rect {
    if (this.state === 'sweep' || this.state === 'sweepPrep') return { x: this.x - 85 * s, y: this.y - 80 * s, w: 170 * s, h: 80 * s };
    return { x: this.x - 85 * s, y: this.y - 140 * s, w: 170 * s, h: 140 * s };
  }
}

// ───────────────────────────── THRONE BOSS ─────────────────────────────
export class KingBoss implements BossLike {
  name = 'КОРОЛЬ ГРОМАДИН';
  hp = 120; maxHp = 120;
  s = 0.8;
  x: number; floorY: number;
  t = 0;
  eye = 0.5; mouth = 0; anger = 0.2; look = 0; dizzy = 0; slump = 0; flash = 0; talk = 0; stand = 0; lean = 0; chew = 0;
  hands: Hand[];
  state: 'intro' | 'idle' | 'attack' | 'dizzy' | 'roar' | 'dead' = 'intro';
  phase = 1;
  cd = 1.5;
  attackFn: ((dt: number) => boolean) | null = null;
  attackCount = 0;
  dizzyT = 0;
  faceHit = new Set<number>();
  hidden = false;
  onDefeat: (() => void) | null = null;
  lastAttack = '';
  freezeHands = false;

  constructor(x: number, floorY: number) {
    this.x = x; this.floorY = floorY;
    this.hands = [new Hand(-1, x - 400, floorY), new Hand(1, x + 400, floorY)];
  }

  get baseY() { return this.floorY + 60 + this.slump * 170; }
  faceCenter() { return { x: this.x, y: this.baseY - (620 - 30) * this.s - this.stand * 160 * this.s }; }
  faceTarget() { const f = this.faceCenter(); return { x: f.x, y: f.y + 80 * this.s }; }
  faceRect(): Rect {
    const f = this.faceCenter();
    return { x: f.x - 170 * this.s, y: f.y - 120 * this.s, w: 340 * this.s, h: 300 * this.s };
  }

  start() { this.state = 'idle'; this.cd = 1.2; }

  update(L: LevelScene, dt: number) {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    this.talk = Math.max(0, this.talk - dt * 3);
    for (const h of this.hands) { h.flash = Math.max(0, h.flash - dt * 5); }
    const p = L.player;
    this.look = damp(this.look, clamp((p.cx - this.x) / 500, -1, 1), 4, dt);
    L.hud.bossHp = this.hp; L.hud.bossMax = this.state === 'intro' || this.state === 'dead' ? 0 : this.maxHp; L.hud.bossName = this.name;

    if (this.state === 'intro' || this.state === 'dead') {
      this.updateHands(L, dt);
      return;
    }
    if (this.state === 'dizzy') {
      this.dizzyT -= dt;
      this.dizzy = damp(this.dizzy, 1, 6, dt);
      this.slump = damp(this.slump, 1, 5, dt);
      this.eye = 0.9;
      this.mouth = damp(this.mouth, 0.3, 5, dt);
      for (const h of this.hands) if (h.state !== 'rest') this.handTo(h, 'lift');
      if (this.dizzyT <= 0) { this.state = 'idle'; this.cd = 0.8; this.faceHit.clear(); }
      this.updateHands(L, dt);
      return;
    }
    this.dizzy = damp(this.dizzy, 0, 4, dt);
    this.slump = damp(this.slump, 0, 4, dt);
    this.mouth = damp(this.mouth, this.talk > 0 ? 0.4 : 0, 6, dt);
    this.eye = damp(this.eye, 0.75 + this.anger * 0.25, 3, dt);

    if (this.state === 'roar') {
      this.attackFn && this.attackFn(dt);
      this.updateHands(L, dt);
      return;
    }

    if (this.state === 'idle') {
      this.cd -= dt;
      if (this.cd <= 0) this.pickAttack(L);
    } else if (this.state === 'attack' && this.attackFn) {
      if (this.attackFn(dt)) {
        this.state = 'idle';
        this.cd = [1.2, 0.9, 0.65][this.phase - 1];
      }
    }
    this.updateHands(L, dt);
  }

  private pickAttack(L: LevelScene) {
    this.attackCount++;
    const ph = this.phase;
    const opts: string[] = ['slam', 'slam', 'meat'];
    if (ph >= 2) opts.push('sweep', 'clap', 'slam2');
    if (ph >= 3) opts.push('walnuts', 'sweep', 'slam2');
    if (this.attackCount % 5 === 0 && L.enemies.length < 3) opts.push('summon', 'summon');
    let a = choose(opts);
    if (a === this.lastAttack && Math.random() < 0.6) a = choose(opts);
    this.lastAttack = a;
    this.state = 'attack';
    switch (a) {
      case 'slam': this.attackFn = this.atkSlam(L, 1); break;
      case 'slam2': this.attackFn = this.atkSlam(L, 2); break;
      case 'meat': this.attackFn = this.atkMeat(L); break;
      case 'sweep': this.attackFn = this.atkSweep(L); break;
      case 'clap': this.attackFn = this.atkClap(L); break;
      case 'walnuts': this.attackFn = this.atkWalnuts(L); break;
      case 'summon': this.attackFn = this.atkSummon(L); break;
    }
  }

  private handTo(h: Hand, st: HandState) { h.state = st; h.t = 0; h.hitIds.clear(); }

  // ── attacks return per-frame functions that report completion ──
  private atkSlam(L: LevelScene, count: number) {
    let n = 0; let t = 0; let cur: Hand | null = null;
    const trackT = [0.95, 0.75, 0.55][this.phase - 1];
    return (dt: number) => {
      t += dt;
      if (!cur) {
        if (n >= count) return this.hands.every((h) => h.state === 'rest');
        const p = L.player;
        const near = p.cx < this.x ? this.hands[0] : this.hands[1];
        cur = n % 2 === 0 ? near : this.hands[near === this.hands[0] ? 1 : 0];
        if (cur.state !== 'rest') cur = this.hands.find((h) => h.state === 'rest') ?? null;
        if (!cur) return false;
        this.handTo(cur, 'rise');
        (cur as Hand & { trackT: number }).trackT = trackT;
        audio.sfx('warn', { volume: 0.5 });
        n++; t = 0;
      } else if (cur.state === 'stuck' || cur.state === 'lift' || cur.state === 'rest') {
        cur = null;
        if (n < count) t = 0;
      }
      return false;
    };
  }

  private atkMeat(L: LevelScene) {
    let t = 0; let thrown = 0;
    const total = 2 + this.phase;
    this.talk = 0.6;
    L.bark({ cx: this.x, y: this.faceCenter().y - 160 * this.s }, choose(['Отведай-ка!', 'Мясной дождик!', 'Ам-ням... НА!', 'Лови котлетку!']), 1.4);
    return (dt: number) => {
      t += dt;
      this.mouth = damp(this.mouth, 1, 10, dt);
      if (t > 0.5 + thrown * 0.32 && thrown < total) {
        thrown++;
        const f = this.faceTarget();
        const sx = f.x + rand(-30, 30), sy = f.y + 40 * this.s;
        const tx = clamp(L.player.cx + rand(-160, 160) + L.player.vx * 0.5, 120, L.def.w - 120);
        const ty = this.floorY - 20;
        const T = 1.15, g = 900;
        const pr = new Projectile('meat', sx, sy, (tx - sx) / T, (ty - sy - 0.5 * g * T * T) / T, 'enemy');
        L.projectiles.push(pr);
        audio.sfx('throw', { pitch: 0.7 });
        audio.sfx('chomp', { volume: 0.5 });
      }
      return t > 0.6 + total * 0.32 + 0.4;
    };
  }

  private atkSweep(L: LevelScene) {
    const p = L.player;
    const h = this.hands.find((hh) => hh.state === 'rest') ?? this.hands[0];
    const fromLeft = p.cx > this.x;
    h.sweepDir = fromLeft ? 1 : -1;
    h.targetX = fromLeft ? 90 : L.def.w - 90;
    this.handTo(h, 'sweepPrep');
    audio.sfx('warn');
    L.bark({ cx: this.x, y: this.faceCenter().y - 160 * this.s }, choose(['А ну, подметём!', 'Прыгай-прыгай!', 'Шмяк по полу!']), 1.4);
    return () => h.state === 'rest';
  }

  private atkClap(L: LevelScene) {
    let t = 0; let done = false;
    for (const h of this.hands) { this.handTo(h, 'clap'); h.targetX = this.x + h.side * 260; }
    audio.sfx('warn'); audio.sfx('warn', { pitch: 1.3 });
    return (dt: number) => {
      t += dt;
      if (!done && this.hands.every((h) => h.state === 'stuck')) {
        done = true;
        for (const h of this.hands) {
          L.waves.push(new Shockwave(h.x + h.side * 80, this.floorY, h.side, 560, 34));
        }
      }
      return this.hands.every((h) => h.state === 'rest') && t > 0.5;
    };
  }

  private atkWalnuts(L: LevelScene) {
    let t = 0; let dropped = 0;
    const n = 8;
    this.talk = 0.6;
    L.bark({ cx: this.x, y: this.faceCenter().y - 160 * this.s }, 'ОРЕХОВЫЙ ДОЖДЬ!', 1.6);
    audio.sfx('roar', { volume: 0.5, pitch: 1.2 });
    L.cam.shake(0.4);
    return (dt: number) => {
      t += dt;
      this.anger = Math.max(this.anger, 0.8);
      if (t > 0.4 + dropped * 0.18 && dropped < n) {
        dropped++;
        const x = clamp(L.player.cx + rand(-320, 320), 80, L.def.w - 80);
        const f = new Faller(x, this.floorY - 900, this.floorY, 'walnut');
        f.warn = 0.75;
        L.fallers.push(f);
      }
      return t > 0.4 + n * 0.18 + 1.2;
    };
  }

  private atkSummon(L: LevelScene) {
    let t = 0;
    this.talk = 0.6;
    L.bark({ cx: this.x, y: this.faceCenter().y - 160 * this.s }, 'СТРАЖА! ВЗЯТЬ ЕГО!', 1.6);
    audio.sfx('roar', { volume: 0.4, pitch: 1.4 });
    let spawned = false;
    return (dt: number) => {
      t += dt;
      if (t > 0.6 && !spawned) {
        spawned = true;
        const xs = [140, L.def.w - 140];
        for (const x of xs) {
          const e: Enemy = makeEnemy(Math.random() < 0.7 || this.phase === 1 ? 'guard' : 'spitter', x, this.floorY - 360, 400, x < this.x ? 1 : -1);
          if (e.kind === 'guard') (e as unknown as { state: string }).state = 'chase';
          e.loot = 1;
          L.enemies.push(e);
          L.fx.emit(x, this.floorY - 360, { count: 14, speed: [60, 200], life: [0.4, 0.8], size: [6, 12], colors: ['#ffffff'], shape: 'smoke' });
        }
      }
      return t > 1.2;
    };
  }

  // ── hands ──
  private updateHands(L: LevelScene, dt: number) {
    if (this.freezeHands) return;
    const p = L.player;
    const s = this.s;
    for (const h of this.hands) {
      h.t += dt;
      h.glow = damp(h.glow, h.state === 'stuck' ? 1 : 0, 10, dt);
      switch (h.state) {
        case 'rest': {
          const bob = Math.sin(this.t * 1.5 + h.side) * 4;
          h.x = damp(h.x, h.restX, 6, dt);
          h.y = damp(h.y, h.restY - 6 + bob - this.slump * 0, 6, dt);
          h.look = 'rest'; h.rot = damp(h.rot, 0, 6, dt);
          break;
        }
        case 'rise':
          h.y = damp(h.y, this.floorY - 470, 8, dt);
          h.x = damp(h.x, this.reach(h, p.cx, L), 3, dt);
          h.look = 'open';
          if (h.t > 0.35) this.handTo(h, 'track');
          break;
        case 'track': {
          const tt = (h as Hand & { trackT?: number }).trackT ?? 0.9;
          h.x = damp(h.x, this.reach(h, p.cx, L), 5, dt);
          h.y = this.floorY - 470 + Math.sin(h.t * 30) * (h.t > tt - 0.25 ? 4 : 0);
          h.look = 'open';
          if (h.t > tt) { this.handTo(h, 'slam'); h.vy = 600; }
          break;
        }
        case 'slam':
          h.vy += 5200 * dt;
          h.y += h.vy * dt;
          h.look = 'flat';
          if (!p.dead && overlap(h.rect(s), p)) p.hurt(L, this.phase >= 3 ? 2 : 1, h.x);
          if (h.y >= this.floorY) {
            h.y = this.floorY;
            this.handTo(h, 'stuck');
            this.impact(L, h.x, 0.5);
            if (this.phase >= 2) {
              L.waves.push(new Shockwave(h.x - 90 * s, this.floorY, -1, 480, 28, 1.6));
              L.waves.push(new Shockwave(h.x + 90 * s, this.floorY, 1, 480, 28, 1.6));
            }
          }
          break;
        case 'stuck': {
          h.look = 'flat';
          const st = [1.6, 1.25, 1.0][this.phase - 1];
          if (h.t > st) this.handTo(h, 'lift');
          break;
        }
        case 'lift':
          h.y = damp(h.y, h.restY - 140, 6, dt);
          h.x = damp(h.x, h.restX, 4, dt);
          h.look = 'open';
          if (h.t > 0.45) this.handTo(h, 'rest');
          break;
        case 'sweepPrep':
          h.x = damp(h.x, h.targetX, 5, dt);
          h.y = damp(h.y, this.floorY, 8, dt);
          h.look = 'flat'; h.rot = h.sweepDir * 0.0;
          if (h.t > 0.9) { this.handTo(h, 'sweep'); audio.sfx('whoosh', { pitch: 0.6 }); }
          break;
        case 'sweep':
          h.x += h.sweepDir * 980 * dt;
          h.look = 'flat';
          if (Math.random() < 0.7) L.fx.dust(h.x - h.sweepDir * 60 * s, this.floorY, 2);
          if (!p.dead && overlap(h.rect(s), p)) p.hurt(L, 1, h.x - h.sweepDir * 100);
          if ((h.sweepDir > 0 && h.x > L.def.w - 90) || (h.sweepDir < 0 && h.x < 90)) { this.handTo(h, 'lift'); L.cam.shake(0.2); audio.sfx('thud'); }
          break;
        case 'clap':
          if (h.t < 0.6) { h.y = damp(h.y, this.floorY - 420, 8, dt); h.x = damp(h.x, h.targetX, 6, dt); h.look = 'open'; }
          else {
            h.vy = h.t < 0.62 ? 900 : h.vy + 5200 * dt;
            h.y += h.vy * dt; h.look = 'flat';
            if (!p.dead && overlap(h.rect(s), p)) p.hurt(L, 1, h.x);
            if (h.y >= this.floorY) { h.y = this.floorY; this.handTo(h, 'stuck'); this.impact(L, h.x, 0.35); }
          }
          break;
      }
    }
  }

  /** each hand only reaches its own side (plus a bit past the middle) */
  private reach(h: Hand, x: number, L: LevelScene) {
    return h.side < 0 ? clamp(x, 100, this.x + 220) : clamp(x, this.x - 220, L.def.w - 100);
  }

  private impact(L: LevelScene, x: number, shake: number) {
    L.cam.shake(shake);
    audio.sfx('bigSlam');
    L.fx.dust(x, this.floorY, 16, '#c8b0e0');
    L.fx.emit(x, this.floorY, { count: 14, speed: [200, 500], angle: [Math.PI * 1.05, Math.PI * 1.95], life: [0.4, 0.8], size: [4, 7], colors: ['#8a7aa0', '#5a4a6e'], shape: 'chunk', g: 1400, floorY: this.floorY, bounce: 0.3 });
    L.fx.ring(x, this.floorY - 10, 160, '#ffffff', 0.35, 6);
  }

  // ── damage ──
  private damage(L: LevelScene, amount: number, x: number, y: number) {
    if (this.state === 'dead' || this.state === 'intro') return;
    this.hp = Math.max(0, this.hp - amount);
    this.flash = 1;
    audio.sfx('bossHit');
    L.fx.text(x + rand(-10, 10), y - 20, String(amount), '#ffe14a', 26);
    L.fx.sparks(x, y, 14);
    L.fx.juice(x, y, 8, ['#c6a2e4', '#ffffff']);
    const before = this.phase;
    if (this.hp <= 0) { this.die(L); return; }
    if (this.hp <= this.maxHp * 0.25) this.phase = 3;
    else if (this.hp <= this.maxHp * 0.6) this.phase = 2;
    if (this.phase !== before) this.phaseChange(L);
  }

  private phaseChange(L: LevelScene) {
    this.state = 'roar';
    let t = 0;
    for (const h of this.hands) if (h.state !== 'rest') this.handTo(h, 'lift');
    this.dizzyT = 0;
    audio.sfx('roar');
    if (this.phase === 2) audio.playMusic('boss2');
    L.cam.shake(0.8);
    L.bark({ cx: this.x, y: this.faceCenter().y - 160 * this.s }, this.phase === 2 ? 'ТЫ МЕНЯ РАЗОЗЛИЛ!!!' : 'ВСЁ! Я ГОЛОДЕН И ЗОЛ!!!', 2);
    L.hud.showBanner(this.phase === 2 ? 'КОРОЛЬ В ЯРОСТИ!' : 'ПОСЛЕДНИЙ РЫВОК!', '#ff5a6a');
    this.attackFn = (dt: number) => {
      t += dt;
      this.anger = lerp(this.anger, this.phase === 2 ? 0.7 : 1, Math.min(1, dt * 3));
      this.mouth = damp(this.mouth, 1, 10, dt);
      this.eye = 1;
      if (t < 1.4 && Math.random() < 0.3) L.cam.shake(0.15);
      const p = L.player;
      if (t > 0.3 && t < 0.35 && !p.dead) {
        L.fx.ring(this.x, this.faceCenter().y + 100, 600, '#ffd0e0', 0.6, 14);
        p.vx = sign(p.cx - this.x) * 600; p.vy = -380; p.knockT = 0.3;
      }
      if (t > 2) { this.state = 'idle'; this.cd = 0.6; this.mouth = 0; return true; }
      return false;
    };
  }

  private die(L: LevelScene) {
    this.state = 'dead';
    this.dizzy = 1;
    for (const h of this.hands) this.handTo(h, 'lift');
    L.projectiles.forEach((p) => { if (p.owner === 'enemy') p.pop(L); });
    L.fallers.length = 0; L.waves.length = 0;
    for (const e of L.enemies) e.die(L);
    audio.sfx('roar', { pitch: 0.8 });
    L.cam.shake(1);
    L.hitstop(0.4);
    L.whiteFlash = 0.8;
    save.data.bossBeaten = true;
    this.onDefeat?.();
  }

  meleeHit(L: LevelScene, r: Rect, dmg: number, dir: number, atkId: number, kind: string): boolean {
    if (this.state === 'intro' || this.state === 'dead') return false;
    let hit = false;
    const mult = 3;
    for (const h of this.hands) {
      if (h.state !== 'stuck' || h.hitIds.has(atkId)) continue;
      if (overlap(r, h.rect(this.s))) {
        h.hitIds.add(atkId); h.flash = 1;
        this.damage(L, dmg * mult, h.x, h.y - 60 * this.s);
        hit = true;
      }
    }
    if (this.state === 'dizzy' && !this.faceHit.has(atkId) && overlap(r, this.faceRect())) {
      this.faceHit.add(atkId);
      const f = this.faceCenter();
      this.damage(L, dmg * mult * 2, clamp(L.player.cx, f.x - 120, f.x + 120), L.player.y);
      hit = true;
    }
    void dir; void kind;
    return hit;
  }

  projectileHit(L: LevelScene, p: Projectile): boolean {
    if (this.state === 'intro' || this.state === 'dead') return false;
    const box = { x: p.x - p.r, y: p.y - p.r, w: p.r * 2, h: p.r * 2 };
    if (p.kind === 'reflected') {
      if (overlap(box, this.faceRect())) {
        this.damage(L, 10, p.x, p.y);
        const st = this.state as string;
        if (st !== 'dead' && st !== 'roar') {
          this.state = 'dizzy'; this.dizzyT = 3.8; this.faceHit.clear();
          this.attackFn = null;
          L.hud.showBanner('ОГЛУШЁН!', '#ffe14a');
          L.bark({ cx: this.x, y: this.faceCenter().y - 160 * this.s }, choose(['Ой-ой... звёздочки...', 'Моя котлетка...', 'Ыыых...']), 1.8);
          L.toast('Бей Короля по носу, пока он оглушён!');
        }
        return true;
      }
      return false;
    }
    for (const h of this.hands) {
      if (h.state === 'stuck' && overlap(box, h.rect(this.s))) { h.flash = 1; this.damage(L, 1, p.x, p.y); return true; }
    }
    if (overlap(box, this.faceRect())) { this.damage(L, this.state === 'dizzy' ? 2 : 1, p.x, p.y); return true; }
    return false;
  }

  pose(): KingPose {
    return {
      x: this.x, y: this.baseY, s: this.s, t: this.t,
      eye: this.eye, mouth: Math.max(this.mouth, this.talk > 0 ? Math.abs(Math.sin(this.t * 14)) * 0.5 : 0),
      anger: this.anger, look: this.look, dizzy: this.dizzy, flash: this.flash, stand: this.stand, chew: this.chew,
      lean: Math.sin(this.t * 0.9) * 0.015 + this.slump * 0.04,
      hands: this.hands.map((h) => ({ x: h.x, y: h.y, state: h.look, side: h.side, glow: h.glow, flash: h.flash, rot: h.rot })),
      armsLater: true,
    };
  }

  drawBack(ctx: C, L: LevelScene) {
    if (this.hidden) return;
    drawThrone(ctx, this.x, this.floorY + 40, this.s * 1.05);
    const pose = this.pose();
    drawKing(ctx, pose);
    drawKingArms(ctx, pose);
    void L;
  }

  drawFront(ctx: C, L: LevelScene) {
    if (this.hidden) return;
    // slam shadows
    for (const h of this.hands) {
      if (h.state === 'track' || h.state === 'rise' || (h.state === 'clap' && h.t < 0.8) || h.state === 'slam') {
        const k = clamp(1 - (this.floorY - h.y) / 500, 0.2, 1);
        ctx.save();
        ctx.globalAlpha = 0.25 + k * 0.35 + Math.sin(this.t * 25) * 0.08;
        ctx.fillStyle = '#300010';
        ctx.beginPath(); ctx.ellipse(h.x, this.floorY - 2, 80 * this.s * (0.6 + k * 0.6), 14, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
      if (h.state === 'sweepPrep' && Math.sin(this.t * 25) > 0) {
        ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = '#ff3040';
        ctx.fillRect(Math.min(h.x, h.targetX + h.sweepDir * 2000) * 0 + 0, this.floorY - 6, L.def.w, 6);
        ctx.restore();
      }
    }
    if (this.state === 'dizzy') {
      const f = this.faceRect();
      glow(ctx, f.x + f.w / 2, f.y + f.h / 2, 220, '#ffe14a', 0.18 + Math.sin(this.t * 8) * 0.06);
    }
  }
}

// ───────────────────────────── CHASER (chase level) ─────────────────────────────
export class KingChaser {
  front: number;
  floorY: number;
  s = 0.62;
  t = 0;
  active = false;
  speed = 0;
  talk = 0;
  eye = 0;
  mouth = 0;
  anger = 0;
  stand = 0;
  bodyX: number;
  reachT = 0;
  handA = { x: 0, y: 0, look: 'open' as KingHand['state'] };
  handB = { x: 0, y: 0, look: 'open' as KingHand['state'], state: 'idle' as 'idle' | 'track' | 'slam' | 'lift', t: 0, vy: 0, tx: 0 };
  slamCD = 3;
  sleeping = true;
  hidden = false;
  grabT = 0;

  constructor(front: number, floorY: number) {
    this.front = front; this.floorY = floorY;
    this.bodyX = front - 420;
    this.handA.x = front; this.handA.y = floorY;
    this.handB.x = front - 700; this.handB.y = floorY;
  }

  update(L: LevelScene, dt: number) {
    this.t += dt;
    this.talk = Math.max(0, this.talk - dt * 3);
    const p = L.player;
    if (this.sleeping) {
      this.eye = 0; this.mouth = 0.15 + Math.sin(this.t * 1.2) * 0.1;
      this.handA.x = this.bodyX + 330; this.handA.y = this.floorY;
      this.handB.x = this.bodyX - 330; this.handB.y = this.floorY;
      this.handA.look = 'rest'; this.handB.look = 'rest';
      if (Math.floor(this.t * 0.8) !== Math.floor((this.t - dt) * 0.8) && Math.random() < 0.6) L.fx.text(this.bodyX + 120, this.floorY - 560, 'z', '#e0d0ff', 26);
      return;
    }
    this.eye = damp(this.eye, 1, 4, dt);
    this.anger = damp(this.anger, 0.9, 1, dt);
    this.stand = damp(this.stand, 0.5, 2, dt);
    this.mouth = damp(this.mouth, this.talk > 0 ? Math.abs(Math.sin(this.t * 14)) * 0.6 : 0.25 + Math.sin(this.t * 3) * 0.15, 8, dt);
    if (!this.active) return;

    // rubber-band speed
    const gap = p.cx - this.front;
    const target = p.dead ? 60 : clamp(205 + (gap - 520) * 0.55, 175, 560);
    this.speed = approach(this.speed, target, 400 * dt);
    this.front += this.speed * dt;
    this.bodyX = damp(this.bodyX, this.front - 430, 3, dt);

    // reaching hand: periodic grabs at the front
    this.reachT += dt * (this.speed / 220) * 2.2;
    const k = (Math.sin(this.reachT) + 1) / 2;
    this.handA.x = this.front + 20;
    this.handA.y = this.floorY - k * 180;
    this.handA.look = k > 0.5 ? 'open' : 'flat';
    if (Math.floor(this.reachT / TAU) !== Math.floor((this.reachT - dt * (this.speed / 220) * 2.2) / TAU)) {
      L.cam.shake(0.18); audio.sfx('slam', { volume: 0.6 });
      L.fx.dust(this.handA.x, this.floorY, 8, '#c8b0e0');
    }

    // targeted slam
    const b = this.handB;
    b.t += dt;
    switch (b.state) {
      case 'idle':
        b.x = damp(b.x, this.bodyX - 300, 4, dt); b.y = damp(b.y, this.floorY - 100, 4, dt); b.look = 'fist';
        this.slamCD -= dt;
        if (this.slamCD <= 0 && !p.dead) { b.state = 'track'; b.t = 0; audio.sfx('warn', { volume: 0.6 }); }
        break;
      case 'track':
        b.tx = p.cx + p.vx * 0.3;
        b.x = damp(b.x, b.tx, 6, dt); b.y = damp(b.y, p.y - 360, 6, dt); b.look = 'open';
        if (b.t > 0.85) { b.state = 'slam'; b.t = 0; b.vy = 500; }
        break;
      case 'slam': {
        b.vy += 5000 * dt; b.y += b.vy * dt; b.look = 'flat';
        const r = { x: b.x - 55, y: b.y - 90, w: 110, h: 90 };
        if (!p.dead && overlap(r, p)) p.hurt(L, 1, b.x);
        const gy = this.groundBelow(L, b.x, b.y);
        if (b.y >= gy) {
          b.y = gy; b.state = 'lift'; b.t = 0;
          L.cam.shake(0.45); audio.sfx('bigSlam');
          L.fx.dust(b.x, gy, 14, '#c8b0e0');
          L.fx.ring(b.x, gy - 10, 130, '#fff', 0.3, 5);
        }
        break;
      }
      case 'lift':
        if (b.t > 0.5) { b.y = damp(b.y, this.floorY - 300, 5, dt); b.x = damp(b.x, this.bodyX - 200, 3, dt); }
        if (b.t > 1.1) { b.state = 'idle'; b.t = 0; this.slamCD = rand(2.2, 3.6); }
        break;
    }

    // caught!
    this.grabT -= dt;
    if (!p.dead && p.cx < this.front + 40 && this.grabT <= 0) {
      this.grabT = 1.2;
      if (p.hurt(L, 1, this.front - 100)) {
        p.vx = 760; p.vy = -560; p.knockT = 0.35;
        L.bark({ cx: this.bodyX + 100, y: this.floorY - 600 }, choose(['ПОПАЛСЯ!', 'Куда собрался?!', 'НЕ УЙДЁШЬ!']), 1.2);
      }
      this.front -= 120;
    }
    if (Math.random() < 0.08) L.fx.dust(this.front - 80, this.floorY, 3, '#c8b0e0');
  }

  private groundBelow(L: LevelScene, x: number, y: number) {
    for (let yy = Math.max(y, 0); yy < L.def.h; yy += 6) if (L.solidAt(x, yy, true)) return yy;
    return this.floorY;
  }

  pose(): KingPose {
    return {
      x: this.bodyX, y: this.floorY + 80 + Math.abs(Math.sin(this.t * 4)) * -14 * (this.active ? 1 : 0), s: this.s, t: this.t,
      eye: this.eye, mouth: this.mouth, anger: this.anger, stand: this.stand, look: 1,
      lean: this.active ? 0.08 + Math.sin(this.t * 4) * 0.03 : 0,
      hands: [
        { x: this.handB.x, y: this.handB.y, state: this.handB.look, side: -1 },
        { x: this.handA.x, y: this.handA.y, state: this.handA.look, side: 1 },
      ],
      armsLater: true,
    };
  }

  drawBack(ctx: C, L: LevelScene) {
    if (this.hidden) return;
    if (this.sleeping) drawThrone(ctx, this.bodyX, this.floorY + 40, this.s * 1.05);
    drawKing(ctx, this.pose());
    void L;
  }

  drawFront(ctx: C, L: LevelScene) {
    if (this.hidden) return;
    const b = this.handB;
    if (b.state === 'track' || b.state === 'slam') {
      const gy = this.groundBelow(L, b.x, b.y);
      ctx.save();
      ctx.globalAlpha = 0.35 + Math.sin(this.t * 25) * 0.1;
      ctx.fillStyle = '#300010';
      ctx.beginPath(); ctx.ellipse(b.x, gy - 2, 60, 12, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    drawKingArms(ctx, this.pose());
    // darkness gradient behind the king's front (sense of danger)
    if (this.active) {
      const g = ctx.createLinearGradient(this.front - 900, 0, this.front + 60, 0);
      g.addColorStop(0, 'rgba(40,0,20,0.0)'); g.addColorStop(1, 'rgba(40,0,20,0)');
      void g;
    }
  }
}
