import { approach, clamp, damp, overlap, rand, sign, TAU, Rect, dist, choose } from '../engine/util';
import { input } from '../engine/input';
import { audio } from '../engine/audio';
import { save } from '../engine/save';
import { drawHero, drawGuard, drawMeatball, drawJelly, drawBookBat, drawBear, drawDog, drawKing, HeroState, HeroExpr } from '../art/characters';
import { drawCrumb, drawBerryHeart, drawPeaPod, drawHoney, drawFeather, drawCloak, drawForkIcon, drawSlingIcon, drawPea } from '../art/props';
import { OUT, circle, ellipse, limb, line, glow, groundShadow, rrect } from '../art/draw';
import type { LevelScene } from '../scenes/level';
import type { Solid, EnemyKind, PickupKind } from './types';

type C = CanvasRenderingContext2D;
export const GRAV = 2000;

// ───────────────────────────── BODY ─────────────────────────────
export class Body implements Rect {
  x = 0; y = 0; w = 20; h = 20; vx = 0; vy = 0;
  onGround = false;
  groundSolid: Solid | null = null;
  hitWall = 0;
  gravity = 1;
  dropT = 0;
  dead = false;
  facing = 1;
  bounced = false;
  maxFall = 1000;
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  get bottom() { return this.y + this.h; }
}

// ───────────────────────────── PLAYER ─────────────────────────────
export type AtkKind = 'sword' | 'fork' | 'pogo' | 'sling';

export class Player extends Body {
  w = 22; h = 46;
  hp = 5; maxHp = 5;
  invuln = 0; flash = 0;
  coyote = 0; jumpBuf = 0; jumping = false;
  canDouble = false; airDash = true;
  dashT = 0; dashCD = 0;
  atkT = 0; atkDur = 0; atkKind: AtkKind | null = null; atkId = 0; atkCD = 0; atkAlt = false;
  shootCD = 0;
  weapon: 'sword' | 'fork' = 'sword';
  ammo = 10;
  grabbedBy: Noodle | null = null; grip = 0; grabDmgT = 0;
  runPhase = 0; sx = 1; sy = 1;
  control = true;
  auto: { x: number; speed: number } | null = null;
  forceState: HeroState | null = null;
  expr: HeroExpr | undefined;
  lastSafe = { x: 0, y: 0 }; safeT = 0;
  deadT = 0;
  t = 0;
  hidden = false;
  talk = 0;
  fallPeak = 0;
  stepT = 0;
  knockT = 0;

  reset(x: number, y: number) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.maxHp = save.data.maxHp; this.hp = this.maxHp;
    this.ammo = save.data.ammoMax;
    this.dead = false; this.deadT = 0; this.invuln = 0; this.grabbedBy = null;
    this.lastSafe = { x, y };
    this.weapon = this.weapon === 'fork' && save.data.abilities.fork ? 'fork' : 'sword';
  }

  get dashing() { return this.dashT > 0; }

  update(L: LevelScene, dt: number) {
    this.t += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.flash = Math.max(0, this.flash - dt * 6);
    this.atkCD -= dt; this.shootCD -= dt; this.dashCD -= dt; this.jumpBuf -= dt; this.dropT -= dt; this.knockT -= dt;
    this.sx = damp(this.sx, 1, 14, dt); this.sy = damp(this.sy, 1, 14, dt);
    this.talk = Math.max(0, this.talk - dt * 3);
    const ctl = this.control && !L.paused;

    if (this.dead) {
      this.deadT += dt;
      this.vx = approach(this.vx, 0, 600 * dt);
      L.moveBody(this, dt);
      return;
    }

    if (this.grabbedBy) { this.updateGrabbed(L, dt, ctl); return; }

    let ax = ctl ? input.axisX() : 0;
    let speedMul = 1;
    if (this.auto) {
      const d = this.auto.x - this.cx;
      if (Math.abs(d) < 6) { this.auto = null; ax = 0; }
      else { ax = sign(d); speedMul = this.auto.speed; }
    }
    if (ax !== 0 && this.atkT <= 0 && this.knockT <= 0) this.facing = ax;

    // dash
    if (ctl && input.pressed('dash') && save.data.abilities.dash && this.dashCD <= 0 && (this.onGround || this.airDash) && this.dashT <= 0) {
      this.dashT = 0.17; this.dashCD = 0.5;
      if (!this.onGround) this.airDash = false;
      if (ax !== 0) this.facing = ax;
      this.sx = 1.35; this.sy = 0.75;
      audio.sfx('dash');
      L.fx.ring(this.cx, this.cy, 30, '#bfe8ff', 0.25, 3);
      this.atkT = 0; this.atkKind = null;
    }

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.facing * 800; this.vy = 0; this.gravity = 0;
      L.fx.emit(this.cx - this.facing * 10, this.cy, { count: 2, speed: [10, 40], life: [0.15, 0.3], size: [4, 7], colors: ['#bfe8ff', '#ffffff', '#ff8a2a'], drag: 3, shape: 'smoke' });
      if (this.dashT <= 0) { this.vx *= 0.45; this.gravity = 1; }
    } else {
      const RUN = 285 * speedMul;
      const target = ax * RUN;
      if (this.knockT > 0) {
        this.vx = approach(this.vx, 0, 500 * dt);
      } else if (ax !== 0) {
        const acc = this.onGround ? 2800 : 1900;
        this.vx = approach(this.vx, target, acc * dt * (sign(this.vx) !== ax && this.vx !== 0 ? 1.6 : 1));
      } else {
        this.vx = approach(this.vx, 0, (this.onGround ? 3200 : 1100) * dt);
      }
    }

    // jump
    if (ctl && input.pressed('jump')) this.jumpBuf = 0.13;
    if (this.onGround) { this.coyote = 0.1; this.canDouble = true; this.airDash = true; } else this.coyote -= dt;
    if (this.jumpBuf > 0 && this.dashT <= 0) {
      if (ctl && input.down('down') && this.onGround && this.groundSolid?.oneway) {
        this.dropT = 0.25; this.jumpBuf = 0; this.y += 2; this.onGround = false;
      } else if (this.coyote > 0) {
        this.vy = -700; this.jumping = true; this.jumpBuf = 0; this.coyote = 0;
        this.sx = 0.7; this.sy = 1.32;
        audio.sfx('jump');
        L.fx.dust(this.cx, this.bottom, 5);
      } else if (this.canDouble && save.data.abilities.doubleJump) {
        this.vy = -620; this.jumping = true; this.jumpBuf = 0; this.canDouble = false;
        this.sx = 0.75; this.sy = 1.3;
        audio.sfx('doubleJump');
        L.fx.ring(this.cx, this.bottom, 26, '#bfe8ff', 0.3, 4);
        L.fx.emit(this.cx, this.bottom, { count: 8, speed: [60, 160], angle: [0.2, Math.PI - 0.2], life: [0.3, 0.5], size: [2, 4], colors: ['#bfe8ff', '#ffffff'], shape: 'star', drag: 3 });
      }
    }
    if (this.jumping && this.vy < 0 && !(ctl && input.down('jump'))) this.vy += GRAV * 1.6 * dt;
    if (this.vy >= 0) this.jumping = false;

    // attack
    if (ctl && input.pressed('attack') && this.atkCD <= 0 && this.dashT <= 0) this.startAttack(L);
    if (ctl && input.pressed('shoot') && this.shootCD <= 0 && this.dashT <= 0) this.shoot(L);
    if (ctl && input.pressed('swap')) {
      if (save.data.abilities.fork) {
        this.weapon = this.weapon === 'sword' ? 'fork' : 'sword';
        audio.sfx('menuMove', { pitch: 1.3 });
        L.fx.text(this.cx, this.y - 22, this.weapon === 'fork' ? 'Вилка-копьё' : 'Деревянный меч', '#fff', 16);
      }
    }
    if (ctl && input.pressed('heal')) this.heal(L);

    // physics
    const wasGround = this.onGround;
    const preVy = this.vy;
    this.bounced = false;
    L.moveBody(this, dt);
    if (this.bounced) {
      this.jumping = false; this.canDouble = true; this.airDash = true;
      this.sx = 0.7; this.sy = 1.35;
      audio.sfx('bounce');
      L.fx.ring(this.cx, this.bottom, 40, '#ff9ac0', 0.3, 5);
    }
    if (!wasGround && this.onGround) {
      if (preVy > 300) {
        this.sx = 1.3; this.sy = 0.75;
        L.fx.dust(this.cx, this.bottom, preVy > 700 ? 9 : 5);
        audio.sfx('land', { volume: clamp(preVy / 900, 0.3, 1) });
      }
    }
    if (this.onGround && Math.abs(this.vx) > 120) {
      this.stepT -= dt;
      if (this.stepT <= 0) { this.stepT = 0.28; L.fx.dust(this.cx - this.facing * 6, this.bottom, 1); }
    }

    // attack processing
    if (this.atkKind) {
      this.atkT += dt;
      const k = this.atkT / this.atkDur;
      const rect = this.attackRect(k);
      if (rect) {
        const hit = L.meleeHit(rect, this.atkDamage(), this.facing, this.atkId, this.atkKind);
        if (hit && this.atkKind === 'pogo') {
          this.vy = -620; this.canDouble = true; this.airDash = true; this.jumping = false;
          audio.sfx('pogo');
          this.atkKind = null; this.atkT = 0;
        }
      }
      if (this.atkKind && this.atkT >= this.atkDur) { this.atkKind = null; this.atkT = 0; }
    }

    // hazards
    for (const hz of L.hazards) {
      // spikes hurt only past their thin tips, so jumps feel fair
      const spiky = hz.style === 'forks' || hz.style === 'pins';
      const box = spiky ? { x: hz.x + 8, y: hz.y + 10, w: hz.w - 16, h: hz.h - 10 } : hz;
      if (overlap(this, box)) { this.hazardHit(L, hz.dmg); break; }
    }
    if (this.y > L.def.h + 60) this.hazardHit(L, 1);

    // remember safe ground
    if (this.onGround && this.groundSolid && !this.groundSolid.crumbly && !this.groundSolid.bounce && !this.groundSolid.gate) {
      this.safeT -= dt;
      if (this.safeT <= 0) {
        const probe = { x: this.x - 20, y: this.y, w: this.w + 40, h: this.h + 10 };
        if (!L.hazards.some((h) => overlap(probe, h))) { this.lastSafe = { x: this.x, y: this.y }; this.safeT = 0.25; }
      }
    }

    if (this.onGround) this.runPhase += Math.abs(this.vx) * dt * 0.055;
  }

  private updateGrabbed(L: LevelScene, dt: number, ctl: boolean) {
    const n = this.grabbedBy!;
    const tip = n.tip();
    this.x = damp(this.x, tip.x - this.w / 2, 10, dt);
    this.y = damp(this.y, tip.y - this.h / 2, 10, dt);
    this.vx = 0; this.vy = 0;
    if (ctl && (input.pressed('jump') || input.pressed('attack') || input.pressed('left') || input.pressed('right') || input.pressed('dash'))) {
      this.grip -= 1;
      this.sx = 1.2; this.sy = 0.85;
      L.fx.emit(this.cx, this.cy, { count: 4, speed: [80, 200], life: [0.3, 0.6], size: [5, 9], colors: ['#f6d06a', '#e8b84a'], shape: 'noodle', g: 600 });
      audio.sfx('grab', { pitch: 1.4, volume: 0.5 });
      L.cam.shake(0.08);
    }
    this.grabDmgT -= dt;
    if (this.grabDmgT <= 0) {
      this.grabDmgT = 1.4;
      this.hp -= 1; this.flash = 1;
      audio.sfx('hurt');
      L.cam.shake(0.25);
      if (this.hp <= 0) { this.grabbedBy = null; n.release(L); this.die(L); return; }
    }
    if (this.grip <= 0) {
      this.grabbedBy = null;
      n.release(L);
      this.vy = -520; this.invuln = 0.8;
      audio.sfx('break');
      L.fx.text(this.cx, this.y - 20, 'Вырвался!', '#ffe14a', 18);
    }
  }

  attackRect(k: number): Rect | null {
    const f = this.facing;
    switch (this.atkKind) {
      case 'sword':
        if (k < 0.1 || k > 0.62) return null;
        return { x: f > 0 ? this.cx - 4 : this.cx - 58, y: this.y - 14, w: 62, h: this.h + 14 };
      case 'pogo':
        if (k > 0.75) return null;
        return { x: this.cx - 24, y: this.bottom - 10, w: 48, h: 46 };
      case 'fork':
        if (k < 0.08 || k > 0.5) return null;
        return { x: f > 0 ? this.cx : this.cx - 100, y: this.y + 8, w: 100, h: 22 };
      default: return null;
    }
  }

  atkDamage() {
    const base = save.data.dmg;
    if (this.atkKind === 'fork') return base + 1;
    if (this.atkKind === 'pogo') return base;
    return base;
  }

  startAttack(L: LevelScene) {
    this.atkId++;
    this.atkT = 0;
    if (!this.onGround && input.down('down') && this.weapon === 'sword') {
      this.atkKind = 'pogo'; this.atkDur = 0.28; this.atkCD = 0.3;
      audio.sfx('swing', { pitch: 1.2 });
    } else if (this.weapon === 'fork') {
      this.atkKind = 'fork'; this.atkDur = 0.42; this.atkCD = 0.46;
      audio.sfx('swingHeavy');
      if (this.onGround) this.vx += this.facing * 160;
    } else {
      this.atkKind = 'sword'; this.atkDur = 0.26; this.atkCD = 0.3;
      this.atkAlt = !this.atkAlt;
      audio.sfx('swing', { pitch: this.atkAlt ? 1.1 : 0.95 });
    }
    L.onPlayerAttack();
  }

  shoot(L: LevelScene) {
    if (!save.data.abilities.slingshot) return;
    if (this.ammo <= 0) {
      audio.sfx('denied', { volume: 0.5 });
      L.fx.text(this.cx, this.y - 20, 'Нет гороха!', '#ff9a9a', 16);
      this.shootCD = 0.4;
      return;
    }
    this.ammo--;
    this.shootCD = 0.3;
    this.atkKind = 'sling'; this.atkT = 0; this.atkDur = 0.25; this.atkId++;
    const p = new Projectile('pea', this.cx + this.facing * 16, this.y + 20, this.facing * 860 + this.vx * 0.3, -60, 'player');
    p.dmg = Math.max(1, save.data.dmg);
    L.projectiles.push(p);
    audio.sfx('shoot');
  }

  heal(L: LevelScene) {
    if (save.data.potions <= 0 || this.hp >= this.maxHp) { audio.sfx('denied', { volume: 0.4 }); return; }
    save.data.potions--;
    this.hp = Math.min(this.maxHp, this.hp + 3);
    audio.sfx('heal');
    L.fx.emit(this.cx, this.cy, { count: 16, speed: [40, 140], life: [0.5, 1], size: [3, 6], colors: ['#ffb020', '#ffe080', '#ffffff'], shape: 'star', g: -120, drag: 2 });
    L.fx.text(this.cx, this.y - 22, '+3 ♥', '#ffd060', 20);
  }

  hurt(L: LevelScene, dmg: number, srcX: number): boolean {
    if (this.dead || this.invuln > 0 || this.dashT > 0 || !this.control && !L.allowHurtInCutscene) return false;
    this.hp -= dmg;
    this.invuln = 1.1; this.flash = 1;
    const dir = sign(this.cx - srcX) || -this.facing;
    this.vx = dir * 330; this.vy = -400; this.knockT = 0.22;
    this.jumping = false;
    this.atkKind = null;
    if (this.grabbedBy) { this.grabbedBy.release(L); this.grabbedBy = null; }
    L.hitstop(0.1);
    L.cam.shake(0.45);
    audio.sfx('hurt');
    L.fx.sparks(this.cx, this.cy, 10, ['#ffffff', '#ff5a5a', '#ffd34a']);
    L.fx.emit(this.cx, this.cy, { count: 6, speed: [100, 250], life: [0.4, 0.7], size: [3, 5], colors: ['#ff5a5a'], shape: 'star', g: 500 });
    if (this.hp <= 0) this.die(L);
    return true;
  }

  hazardHit(L: LevelScene, dmg: number) {
    if (this.dead) return;
    const was = this.invuln;
    this.invuln = 0;
    this.dashT = 0; this.gravity = 1;
    this.hp -= dmg; this.flash = 1;
    audio.sfx('hurt');
    L.cam.shake(0.4);
    L.fx.sparks(this.cx, this.cy, 10, ['#ffffff', '#ff5a5a']);
    if (this.hp <= 0) { this.die(L); return; }
    L.fadeFlash();
    this.x = this.lastSafe.x; this.y = this.lastSafe.y - 4;
    this.vx = 0; this.vy = 0;
    this.invuln = Math.max(was, 1.2);
  }

  die(L: LevelScene) {
    if (this.dead) return;
    this.hp = 0; this.dead = true; this.deadT = 0;
    this.vy = -500; this.vx = -this.facing * 120;
    this.grabbedBy = null;
    audio.sfx('fall');
    L.onPlayerDeath();
  }

  heroState(): HeroState {
    if (this.forceState) return this.forceState;
    if (this.dead) return 'dead';
    if (this.grabbedBy) return 'grabbed';
    if (this.dashT > 0) return 'dash';
    if (this.knockT > 0 || (this.invuln > 0.85 && !this.onGround)) return 'hurt';
    if (!this.onGround) return this.vy < 0 ? 'jump' : 'fall';
    if (Math.abs(this.vx) > 20) return this.auto && this.auto.speed < 0.7 ? 'walk' : 'run';
    return 'idle';
  }

  draw(ctx: C, L: LevelScene) {
    if (this.hidden) return;
    const st = this.heroState();
    if (st !== 'dead' && this.onGround) groundShadow(ctx, this.cx, this.bottom, 14, 0.25);
    const blink = this.invuln > 0 && !this.dead && Math.floor(this.invuln * 14) % 2 === 0;
    let rot = 0;
    if (st === 'dead') rot = -this.facing * Math.min(1.5, this.deadT * 5);
    const atk = this.atkKind ? { kind: this.atkKind, p: this.atkT / this.atkDur, alt: this.atkAlt } : null;
    drawHero(ctx, this.cx, this.bottom, 1, {
      t: this.t, facing: this.facing, state: st, phase: this.runPhase,
      sx: this.sx, sy: this.sy, rot, atk, weapon: this.weapon,
      flash: this.flash, alpha: blink ? 0.4 : 1,
      wind: Math.min(1, Math.abs(this.vx) / 300), expr: this.expr, talk: this.talk > 0 ? Math.abs(Math.sin(this.t * 18)) : 0,
    });
    if (this.grabbedBy) {
      // struggle hint
      const n = Math.max(0, Math.ceil(this.grip));
      ctx.save();
      ctx.font = '900 16px Rubik, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = OUT; ctx.fillStyle = '#ffe14a';
      const txt = 'ЖМИ! ' + '●'.repeat(n);
      ctx.strokeText(txt, this.cx, this.y - 30 + Math.sin(this.t * 20) * 2);
      ctx.fillText(txt, this.cx, this.y - 30 + Math.sin(this.t * 20) * 2);
      ctx.restore();
    }
    void L;
  }
}

// ───────────────────────────── ENEMIES ─────────────────────────────
export abstract class Enemy extends Body {
  kind: EnemyKind;
  hp = 2; maxHp = 2;
  flash = 0; lastHit = -1; stun = 0; contact = 1; t = rand(0, 10);
  heavy = 0;
  loot = 2;
  arena = false;
  spawnT = 0;
  constructor(kind: EnemyKind, x: number, y: number) {
    super(); this.kind = kind; this.x = x; this.y = y;
  }
  abstract tick(L: LevelScene, dt: number): void;
  abstract render(ctx: C, L: LevelScene): void;

  update(L: LevelScene, dt: number) {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 6);
    if (this.spawnT > 0) { this.spawnT -= dt; return; }
    this.tick(L, dt);
    const p = L.player;
    if (this.contact > 0 && !p.dead && overlap(this, p)) p.hurt(L, this.contact, this.cx);
    if (this.y > L.def.h + 200) this.dead = true;
  }

  draw(ctx: C, L: LevelScene) {
    if (this.spawnT > 0) {
      const k = this.spawnT / 0.6;
      ctx.save(); ctx.globalAlpha = 1 - k;
      this.render(ctx, L);
      ctx.restore();
      return;
    }
    this.render(ctx, L);
  }

  hurt(L: LevelScene, dmg: number, dir: number, kind: string) {
    this.hp -= dmg;
    this.flash = 1;
    this.stun = 0.28;
    this.vx = dir * 280 * (1 - this.heavy);
    this.vy = Math.min(this.vy, -180 * (1 - this.heavy));
    audio.sfx('hit', { pitch: rand(0.9, 1.15) });
    L.fx.sparks(this.cx, this.cy, 8);
    L.fx.text(this.cx + rand(-8, 8), this.y - 8, String(dmg), kind === 'fork' ? '#ffe14a' : '#ffffff', 18);
    this.onHurt(L);
    if (this.hp <= 0) this.die(L);
  }

  onHurt(L: LevelScene) { L.fx.juice(this.cx, this.cy, 8); }

  die(L: LevelScene) {
    this.dead = true;
    audio.sfx('enemyDie');
    L.cam.shake(0.15);
    L.fx.ring(this.cx, this.cy, 46, '#ffffff', 0.3, 5);
    this.deathFx(L);
    for (let i = 0; i < this.loot; i++) L.dropPickup(Math.random() < 0.15 ? 'bigcrumb' : 'crumb', this.cx, this.cy);
    if (Math.random() < 0.18) L.dropPickup('heart', this.cx, this.cy);
    if (save.data.abilities.slingshot && Math.random() < 0.25) L.dropPickup('peas', this.cx, this.cy);
  }

  deathFx(L: LevelScene) {
    L.fx.juice(this.cx, this.cy, 18);
    L.fx.emit(this.cx, this.cy, { count: 7, speed: [150, 380], angle: [Math.PI * 1.1, Math.PI * 1.9], life: [0.6, 1.1], size: [6, 11], colors: ['#3e9a3a', '#ff5468'], shape: 'chunk', g: 1100, vr: 12, floorY: this.bottom, bounce: 0.35 });
    L.fx.emit(this.cx, this.cy, { count: 8, speed: [100, 300], life: [0.6, 1], size: [2.5, 4], colors: ['#2a1b1a'], shape: 'seed', g: 1000, floorY: this.bottom, bounce: 0.3 });
  }

  aheadIsLedge(L: LevelScene) {
    const ax = this.facing > 0 ? this.x + this.w + 4 : this.x - 4;
    return !L.solidAt(ax, this.bottom + 8, true);
  }
}

export class Guard extends Enemy {
  w = 30; h = 40;
  state: 'patrol' | 'chase' | 'windup' | 'attack' | 'recover' = 'patrol';
  st = 0; home: number; range: number; phase = 0;
  constructor(x: number, y: number, range = 160, facing = 1) {
    super('guard', x, y);
    this.hp = this.maxHp = 3; this.home = x; this.range = range; this.facing = facing; this.loot = 3;
  }
  tick(L: LevelScene, dt: number) {
    const p = L.player;
    const dx = p.cx - this.cx, dy = p.cy - this.cy;
    if (this.stun > 0) {
      this.stun -= dt;
      this.vx = approach(this.vx, 0, 1200 * dt);
      L.moveBody(this, dt);
      if (this.stun <= 0 && this.state !== 'patrol') this.state = 'chase';
      return;
    }
    const sees = !p.dead && Math.abs(dy) < 110 && (Math.abs(dx) < 140 || (Math.abs(dx) < 420 && sign(dx) === this.facing));
    switch (this.state) {
      case 'patrol':
        this.vx = this.facing * 60;
        if ((this.x < this.home - this.range && this.facing < 0) || (this.x > this.home + this.range && this.facing > 0)) this.facing *= -1;
        if (this.hitWall || (this.onGround && this.aheadIsLedge(L))) { this.facing *= -1; this.vx = 0; }
        if (sees) {
          this.state = 'chase';
          L.fx.text(this.cx, this.y - 34, '!', '#ffe14a', 30);
          audio.sfx('warn', { volume: 0.4, pitch: 1.4 });
          if (Math.random() < 0.35) L.bark(this, choose(['Стой!', 'Нарушитель!', 'Держи его!', 'Ага!']));
        }
        break;
      case 'chase':
        this.facing = sign(dx) || this.facing;
        this.vx = this.facing * 140;
        if (this.onGround && this.aheadIsLedge(L)) this.vx = 0;
        if (Math.abs(dx) > 650 || Math.abs(dy) > 260 || p.dead) this.state = 'patrol';
        if (Math.abs(dx) < 70 && Math.abs(dy) < 56) { this.state = 'windup'; this.st = 0.42; audio.sfx('warn', { volume: 0.25, pitch: 1.8 }); }
        break;
      case 'windup':
        this.vx = approach(this.vx, 0, 1500 * dt);
        this.st -= dt;
        if (this.st <= 0) { this.state = 'attack'; this.st = 0.2; this.vx = this.facing * 430; audio.sfx('swing', { pitch: 1.5 }); }
        break;
      case 'attack': {
        this.st -= dt;
        this.vx = approach(this.vx, 0, 1400 * dt);
        const spear = { x: this.facing > 0 ? this.cx + 4 : this.cx - 58, y: this.y + 14, w: 54, h: 14 };
        if (!p.dead && overlap(spear, p)) p.hurt(L, 1, this.cx);
        if (this.st <= 0) { this.state = 'recover'; this.st = 0.55; }
        break;
      }
      case 'recover':
        this.vx = approach(this.vx, 0, 1200 * dt);
        this.st -= dt;
        if (this.st <= 0) this.state = 'chase';
        break;
    }
    L.moveBody(this, dt);
    this.phase += Math.abs(this.vx) * dt * 0.09;
  }
  render(ctx: C) {
    groundShadow(ctx, this.cx, this.bottom, 16, 0.22);
    const st = this.stun > 0 ? 'hurt' : this.state === 'windup' ? 'windup' : this.state === 'attack' ? 'attack' : this.state === 'chase' ? (Math.abs(this.vx) > 10 ? 'walk' : 'alert') : Math.abs(this.vx) > 10 ? 'walk' : 'idle';
    const shake = this.state === 'windup' ? Math.sin(this.t * 60) * 1.5 : 0;
    drawGuard(ctx, this.cx + shake, this.bottom, 1, { t: this.t, facing: this.facing, state: st, phase: this.phase, flash: this.flash, kind: 'guard' });
  }
}

export class Spitter extends Enemy {
  w = 30; h = 40; cd = 1.4; spitT = 0;
  constructor(x: number, y: number, facing = -1) {
    super('spitter', x, y);
    this.hp = this.maxHp = 2; this.facing = facing; this.loot = 2;
  }
  tick(L: LevelScene, dt: number) {
    const p = L.player;
    const dx = p.cx - this.cx, dy = p.cy - this.cy;
    if (this.stun > 0) { this.stun -= dt; this.vx = approach(this.vx, 0, 1200 * dt); L.moveBody(this, dt); return; }
    this.vx = approach(this.vx, 0, 900 * dt);
    const inRange = !p.dead && p.control && Math.abs(dx) < 540 && Math.abs(dy) < 340;
    if (inRange && this.spitT <= 0) this.facing = sign(dx) || this.facing;
    this.cd -= dt;
    if (this.spitT > 0) {
      this.spitT -= dt;
      if (this.spitT <= 0) {
        const tx = p.cx, ty = p.cy;
        const ang = Math.atan2(ty - (this.y + 18), tx - this.cx);
        const sp = 420;
        const pr = new Projectile('seed', this.cx + this.facing * 20, this.y + 18, Math.cos(ang) * sp, Math.sin(ang) * sp - 60, 'enemy');
        L.projectiles.push(pr);
        audio.sfx('throw', { pitch: 1.5, volume: 0.6 });
      }
    } else if (inRange && this.cd <= 0) {
      this.spitT = 0.4; this.cd = 2.1;
    }
    L.moveBody(this, dt);
  }
  render(ctx: C) {
    groundShadow(ctx, this.cx, this.bottom, 16, 0.22);
    drawGuard(ctx, this.cx, this.bottom, 1, { t: this.t, facing: this.facing, state: this.stun > 0 ? 'hurt' : this.spitT > 0 ? 'spit' : 'idle', flash: this.flash, kind: 'spitter' });
  }
}

export class Meatball extends Enemy {
  w = 34; h = 34; rot = 0; speed = 150;
  constructor(x: number, y: number, facing = -1) {
    super('meatball', x, y);
    this.hp = this.maxHp = 3; this.facing = facing; this.heavy = 0.4; this.loot = 3;
  }
  tick(L: LevelScene, dt: number) {
    if (this.stun > 0) { this.stun -= dt; this.vx = approach(this.vx, 0, 900 * dt); }
    else this.vx = approach(this.vx, this.facing * this.speed, 600 * dt);
    L.moveBody(this, dt);
    if (this.hitWall) this.facing = -this.hitWall;
    else if (this.onGround && this.aheadIsLedge(L)) this.facing *= -1;
    this.rot += (this.vx * dt) / 17;
  }
  onHurt(L: LevelScene) { L.fx.emit(this.cx, this.cy, { count: 8, speed: [80, 220], life: [0.3, 0.6], size: [3, 5], colors: ['#8c4a2c', '#c8402a'], g: 700 }); }
  deathFx(L: LevelScene) {
    L.fx.emit(this.cx, this.cy, { count: 14, speed: [120, 360], angle: [Math.PI, TAU], life: [0.5, 1], size: [4, 8], colors: ['#8c4a2c', '#6a3218', '#c8402a'], shape: 'chunk', g: 1100, floorY: this.bottom, bounce: 0.3 });
  }
  render(ctx: C) {
    groundShadow(ctx, this.cx, this.bottom, 16, 0.25);
    drawMeatball(ctx, this.cx, this.bottom, 1, this.rot, this.t, this.facing, this.flash);
  }
}

export class Jelly extends Enemy {
  w = 34; h = 30; hop = 1; sq = 0; hue: number;
  constructor(x: number, y: number, hue = 0) {
    super('jelly', x, y);
    this.hp = this.maxHp = 2; this.hue = hue; this.loot = 2;
  }
  tick(L: LevelScene, dt: number) {
    const p = L.player;
    const dx = p.cx - this.cx;
    const was = this.onGround;
    if (this.stun > 0) this.stun -= dt;
    if (this.onGround) {
      this.vx = approach(this.vx, 0, 1400 * dt);
      this.hop -= dt;
      if (this.hop <= 0 && Math.abs(dx) < 460 && !p.dead) {
        this.vy = -580; this.vx = (sign(dx) || 1) * 170; this.facing = sign(dx) || 1;
        this.hop = 1 + Math.random() * 0.6; this.sq = -0.7;
        audio.sfx('bounce', { volume: 0.35, pitch: 1.3 });
      }
    }
    L.moveBody(this, dt);
    if (!was && this.onGround) { this.sq = 0.9; L.fx.dust(this.cx, this.bottom, 3, '#ff9ac0'); }
    this.sq = damp(this.sq, 0, 9, dt);
  }
  onHurt(L: LevelScene) { L.fx.juice(this.cx, this.cy, 8, ['#ff5f9e', '#ff9ac0']); }
  deathFx(L: LevelScene) { L.fx.juice(this.cx, this.cy, 20, this.hue === 1 ? ['#5ad1ff', '#a8e8ff'] : ['#ff5f9e', '#ff9ac0', '#ffffff']); }
  render(ctx: C) {
    groundShadow(ctx, this.cx, this.bottom, 15, 0.2);
    drawJelly(ctx, this.cx, this.bottom, 1, this.t, this.sq, this.facing, this.flash, this.hue);
  }
}

export class BookBat extends Enemy {
  w = 34; h = 26;
  hx: number; hy: number;
  state: 'hover' | 'swoop' | 'back' = 'hover';
  st = 0; color: string; tx = 0; ty = 0;
  constructor(x: number, y: number) {
    super('book', x, y);
    this.hp = this.maxHp = 1; this.gravity = 0; this.hx = x; this.hy = y; this.loot = 2;
    this.color = choose(['#c0392b', '#2e86c1', '#8e44ad', '#27ae60', '#d35400']);
  }
  tick(L: LevelScene, dt: number) {
    const p = L.player;
    if (this.stun > 0) { this.stun -= dt; this.x += this.vx * dt; this.y += this.vy * dt; this.vx *= 0.9; this.vy *= 0.9; return; }
    switch (this.state) {
      case 'hover': {
        const gx = this.hx + Math.sin(this.t * 1.3) * 70, gy = this.hy + Math.sin(this.t * 2.2) * 24;
        this.vx = (gx - this.x) * 3; this.vy = (gy - this.y) * 3;
        this.facing = sign(p.cx - this.cx) || 1;
        this.st -= dt;
        if (this.st <= 0 && !p.dead && dist(p.cx, p.cy, this.cx, this.cy) < 400) {
          this.state = 'swoop'; this.st = 1.0;
          this.tx = p.cx; this.ty = p.cy;
          const a = Math.atan2(this.ty - this.cy, this.tx - this.cx);
          this.vx = Math.cos(a) * 430; this.vy = Math.sin(a) * 430;
          audio.sfx('whoosh', { volume: 0.4, pitch: 1.4 });
        }
        break;
      }
      case 'swoop':
        this.st -= dt;
        if (this.st <= 0) this.state = 'back';
        break;
      case 'back': {
        const a = Math.atan2(this.hy - this.cy, this.hx - this.cx);
        this.vx = Math.cos(a) * 200; this.vy = Math.sin(a) * 200;
        if (dist(this.cx, this.cy, this.hx, this.hy) < 20) { this.state = 'hover'; this.st = 1.4; }
        break;
      }
    }
    this.x += this.vx * dt; this.y += this.vy * dt;
  }
  onHurt(L: LevelScene) { L.fx.emit(this.cx, this.cy, { count: 6, speed: [80, 220], life: [0.5, 1], size: [5, 8], colors: ['#f6ecd2', '#ffffff'], shape: 'square', g: 300, vr: 10 }); }
  deathFx(L: LevelScene) {
    L.fx.emit(this.cx, this.cy, { count: 16, speed: [80, 260], life: [0.8, 1.6], size: [6, 10], colors: ['#f6ecd2', '#ffffff', this.color], shape: 'square', g: 260, drag: 2, vr: 10 });
  }
  render(ctx: C) {
    drawBookBat(ctx, this.cx, this.cy, 1.1, this.t, this.color, this.facing, this.flash);
  }
}

export function makeEnemy(kind: EnemyKind, x: number, y: number, range?: number, facing?: number, hue?: number): Enemy {
  switch (kind) {
    case 'guard': return new Guard(x, y - 40, range ?? 160, facing ?? 1);
    case 'spitter': return new Spitter(x, y - 40, facing ?? -1);
    case 'meatball': return new Meatball(x, y - 34, facing ?? -1);
    case 'jelly': return new Jelly(x, y - 30, hue ?? 0);
    case 'book': return new BookBat(x, y);
  }
}

// ───────────────────────────── PROJECTILES ─────────────────────────────
export type ProjKind = 'pea' | 'seed' | 'meat' | 'walnut' | 'reflected';

export class Projectile {
  dead = false; life = 4; rot = 0; r = 6; g = 0; dmg = 1; hitIds = new Set<unknown>();
  bounces = 0; reflectable = false; landed = false;
  constructor(public kind: ProjKind, public x: number, public y: number, public vx: number, public vy: number, public owner: 'player' | 'enemy') {
    if (kind === 'pea') { this.r = 5; this.g = 260; this.life = 1.4; }
    if (kind === 'seed') { this.r = 6; this.g = 160; this.life = 3; }
    if (kind === 'meat') { this.r = 22; this.g = 900; this.life = 6; this.reflectable = true; this.bounces = 1; this.dmg = 1; }
    if (kind === 'walnut') { this.r = 16; this.g = 1300; this.life = 4; this.dmg = 1; }
  }
  update(L: LevelScene, dt: number) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.vy += this.g * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.rot += dt * (this.kind === 'meat' ? 6 : 14) * sign(this.vx || 1);
    const box = { x: this.x - this.r, y: this.y - this.r, w: this.r * 2, h: this.r * 2 };
    if (this.owner === 'player') {
      for (const e of L.enemies) {
        if (!e.dead && e.spawnT <= 0 && overlap(box, e)) {
          e.hurt(L, this.dmg, sign(this.vx), 'pea');
          this.pop(L); return;
        }
      }
      if (L.boss && L.boss.projectileHit(L, this)) { this.pop(L); return; }
      for (const n of L.noodles) if (n.hitTest(box)) { n.cut(L); this.pop(L); return; }
    } else {
      const p = L.player;
      if (!p.dead && overlap(box, p)) {
        if (p.hurt(L, this.dmg, this.x)) { this.pop(L); return; }
      }
    }
    if (this.kind !== 'reflected' && L.solidAt(this.x, this.y + (this.vy > 0 ? this.r * 0.6 : 0), false)) {
      if (this.bounces > 0 && this.vy > 0) {
        this.bounces--;
        this.vy = -this.vy * 0.45; this.vx *= 0.6;
        this.y -= this.r * 0.5;
        audio.sfx('thud', { volume: 0.5 });
        L.fx.dust(this.x, this.y + this.r, 4);
      } else { this.pop(L); }
    }
  }
  pop(L: LevelScene) {
    this.dead = true;
    if (this.kind === 'pea') L.fx.emit(this.x, this.y, { count: 6, speed: [60, 180], life: [0.2, 0.4], size: [2, 3], colors: ['#7ad04a', '#c8f0a0'], g: 400 });
    else if (this.kind === 'seed') L.fx.emit(this.x, this.y, { count: 5, speed: [60, 160], life: [0.2, 0.4], size: [2, 3], colors: ['#2a1b1a'], g: 400 });
    else if (this.kind === 'meat') { L.fx.juice(this.x, this.y, 10, ['#a8402a', '#c86040', '#f4d0b0']); audio.sfx('splash', { volume: 0.5 }); }
    else if (this.kind === 'walnut') { L.fx.emit(this.x, this.y, { count: 10, speed: [100, 300], angle: [Math.PI, TAU], life: [0.4, 0.8], size: [4, 7], colors: ['#8a5a2a', '#c8904a'], shape: 'chunk', g: 1000 }); audio.sfx('crumble', { volume: 0.6 }); L.cam.shake(0.1); }
  }
  reflect(L: LevelScene, tx: number, ty: number) {
    this.kind = 'reflected'; this.owner = 'player'; this.g = 0;
    const a = Math.atan2(ty - this.y, tx - this.x);
    this.vx = Math.cos(a) * 1100; this.vy = Math.sin(a) * 1100; this.life = 2;
    audio.sfx('reflect');
    L.hitstop(0.08);
    L.fx.sparks(this.x, this.y, 14);
    L.fx.ring(this.x, this.y, 50, '#ffe14a', 0.3, 5);
  }
  draw(ctx: C, L: LevelScene) {
    switch (this.kind) {
      case 'pea': drawPea(ctx, this.x, this.y, 1); break;
      case 'seed':
        ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(Math.atan2(this.vy, this.vx) + Math.PI / 2);
        ellipse(ctx, 0, 0, 4.5, 7, '#2a1b1a', 2); ctx.fillStyle = '#fff'; ctx.fillRect(-1.5, -3, 1.5, 3);
        ctx.restore(); break;
      case 'meat': case 'reflected':
        ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rot);
        if (this.kind === 'reflected') glow(ctx, 0, 0, 60, '#ffe14a', 0.6);
        ellipse(ctx, 0, 0, 24, 16, '#a8402a', 3);
        ellipse(ctx, -4, -3, 14, 7, '#c86040', 0);
        line(ctx, -14, -2, 10, 4, '#f4d0b0', 3);
        limb(ctx, 14, 0, 30, -4, 6, '#f6ecd2', 2);
        circle(ctx, 32, -7, 5, '#f6ecd2', 2); circle(ctx, 32, -1, 5, '#f6ecd2', 2);
        ctx.restore(); break;
      case 'walnut':
        ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rot);
        ellipse(ctx, 0, 0, 16, 14, '#b07a3a', 3);
        ctx.strokeStyle = '#7a4a1a'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(0, -14); ctx.bezierCurveTo(-6, -5, 6, 5, 0, 14); ctx.stroke();
        ctx.beginPath(); ctx.arc(-6, -2, 4, 0, Math.PI); ctx.arc(6, 3, 4, Math.PI, TAU); ctx.stroke();
        ctx.restore(); break;
    }
    void L;
  }
}

// ───────────────────────────── PICKUPS ─────────────────────────────
export class Pickup extends Body {
  t = rand(0, 5); age = 0;
  physics: boolean;
  permanent: boolean;
  constructor(public kind: PickupKind, x: number, y: number, public id?: string, physics = false) {
    super();
    this.w = 18; this.h = 18; this.x = x - 9; this.y = y - 9; this.physics = physics;
    this.permanent = ['container', 'doubleJump', 'dash', 'fork', 'sling'].includes(kind);
    if (this.permanent) { this.w = 36; this.h = 40; this.x = x - 18; this.y = y - 20; }
    if (!physics) this.gravity = 0;
  }
  update(L: LevelScene, dt: number) {
    this.t += dt; this.age += dt;
    const p = L.player;
    const magnetic = this.kind === 'crumb' || this.kind === 'bigcrumb' || this.kind === 'peas';
    const d = dist(p.cx, p.cy, this.cx, this.cy);
    if (magnetic && this.age > 0.4 && d < 120 && !p.dead) {
      const a = Math.atan2(p.cy - this.cy, p.cx - this.cx);
      const sp = 500 + (120 - d) * 8;
      this.x += Math.cos(a) * sp * dt; this.y += Math.sin(a) * sp * dt;
    } else if (this.physics) {
      this.vx = approach(this.vx, 0, (this.onGround ? 600 : 60) * dt);
      const vy0 = this.vy;
      L.moveBody(this, dt);
      if (this.onGround && vy0 > 200) { this.vy = -vy0 * 0.35; this.onGround = false; }
    }
    if (!p.dead && this.age > 0.25 && overlap(this, { x: p.x - 4, y: p.y - 4, w: p.w + 8, h: p.h + 8 })) {
      if (this.kind === 'heart' && p.hp >= p.maxHp && this.age < 12) return;
      this.dead = true;
      L.collect(this);
    }
    if (!this.permanent && this.age > 20) this.dead = true;
  }
  draw(ctx: C, L: LevelScene) {
    const x = this.cx, y = this.cy;
    if (!this.permanent && this.age > 16 && Math.floor(this.age * 8) % 2 === 0) return;
    switch (this.kind) {
      case 'crumb': drawCrumb(ctx, x, y, 1, this.t); break;
      case 'bigcrumb': drawCrumb(ctx, x, y, 1.1, this.t, true); break;
      case 'heart': drawBerryHeart(ctx, x, y, 0.85, this.t); break;
      case 'peas': drawPeaPod(ctx, x, y, 1, this.t); break;
      case 'honey': drawHoney(ctx, x, y, 1.1, this.t); break;
      default: {
        // pedestal artifact
        const base = this.y + this.h + 2;
        rrect(ctx, x - 26, base, 52, 14, 4, '#d8c8a8', 2.5);
        rrect(ctx, x - 18, base - 6, 36, 8, 3, '#e8dcc0', 2.5);
        glow(ctx, x, y, 90, '#ffe9a0', 0.45 + Math.sin(this.t * 3) * 0.1);
        const fy = y - 6 + Math.sin(this.t * 2.5) * 5;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,240,180,0.25)';
        for (let i = 0; i < 6; i++) {
          const a = this.t * 0.6 + (i / 6) * TAU;
          ctx.beginPath(); ctx.moveTo(x, fy); ctx.arc(x, fy, 70, a, a + 0.18); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
        if (this.kind === 'container') drawBerryHeart(ctx, x, fy, 1.3, this.t, true);
        if (this.kind === 'doubleJump') drawFeather(ctx, x, fy, 1.2, this.t);
        if (this.kind === 'dash') drawCloak(ctx, x, fy, 1.3, this.t);
        if (this.kind === 'fork') drawForkIcon(ctx, x, fy, 1.5);
        if (this.kind === 'sling') drawSlingIcon(ctx, x, fy, 1.3);
        if (Math.random() < 0.15) L.fx.emit(x + rand(-20, 20), fy + rand(-20, 20), { count: 1, speed: [10, 40], life: [0.6, 1.2], size: [2, 4], colors: ['#fff6c0', '#ffe14a'], shape: 'star', g: -30, additive: true });
      }
    }
  }
}

// ───────────────────────────── SPAGHETTI NOODLE ─────────────────────────────
export class Noodle {
  t = rand(0, 10); cool = 0; vis = 1; grabbing = false; flash = 0;
  pts: { x: number; y: number }[] = [];
  constructor(public ax: number, public ay: number, public len: number, public dir: 1 | -1 = 1) { this.compute(null); }

  tip() { return this.pts[this.pts.length - 1]; }

  compute(target: { x: number; y: number } | null) {
    const N = 12;
    this.pts.length = 0;
    const L = this.len * this.vis;
    for (let i = 0; i <= N; i++) {
      const k = i / N;
      let x = this.ax + Math.sin(this.t * 1.7 + k * 3.2) * k * 30 + Math.sin(this.t * 3.1 + k * 7) * k * 6;
      let y = this.ay + this.dir * k * L;
      if (target) {
        const w = k * k;
        x = x * (1 - w) + target.x * w;
        y = y * (1 - w) + target.y * w;
      }
      this.pts.push({ x, y });
    }
  }

  hitTest(r: Rect) {
    if (this.cool > 0 || this.vis < 0.6) return false;
    for (let i = Math.floor(this.pts.length * 0.4); i < this.pts.length; i++) {
      const p = this.pts[i];
      if (p.x > r.x - 6 && p.x < r.x + r.w + 6 && p.y > r.y - 6 && p.y < r.y + r.h + 6) return true;
    }
    return false;
  }

  update(L: LevelScene, dt: number) {
    this.t += dt;
    this.cool -= dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    const targetVis = this.cool > 0 ? 0.25 : 1;
    this.vis = damp(this.vis, targetVis, this.cool > 0 ? 12 : 2.5, dt);
    const p = L.player;
    this.compute(this.grabbing ? { x: p.cx, y: p.cy } : null);
    if (!this.grabbing && this.cool <= 0 && this.vis > 0.85 && !p.dead && !p.grabbedBy && p.invuln <= 0 && !p.dashing && p.control) {
      const tip = this.tip();
      // check last few points
      for (let i = this.pts.length - 3; i < this.pts.length; i++) {
        const q = this.pts[i];
        if (dist(q.x, q.y, p.cx, p.cy) < 36) {
          this.grabbing = true;
          p.grabbedBy = this; p.grip = 5; p.grabDmgT = 1.2;
          p.atkKind = null; p.dashT = 0; p.gravity = 1;
          audio.sfx('grab');
          L.cam.shake(0.2);
          L.fx.text(tip.x, tip.y - 30, 'Хвать!', '#f6d06a', 20);
          break;
        }
      }
    }
  }

  release(L: LevelScene) {
    this.grabbing = false;
    this.cool = 2.6;
    void L;
  }

  cut(L: LevelScene) {
    if (this.cool > 0) return;
    if (this.grabbing) { L.player.grabbedBy = null; L.player.vy = -420; L.player.invuln = 0.7; }
    this.grabbing = false;
    this.cool = 4.5; this.flash = 1;
    const tip = this.tip();
    audio.sfx('break', { pitch: 1.3 });
    L.fx.emit(tip.x, tip.y, { count: 10, speed: [80, 260], life: [0.5, 1], size: [6, 12], colors: ['#f6d06a', '#e8b84a'], shape: 'noodle', g: 800 });
    L.fx.juice(tip.x, tip.y, 8, ['#d8402a', '#b8301a']);
  }

  draw(ctx: C) {
    const pts = this.pts;
    // anchor
    if (this.dir === 1) {
      ellipse(ctx, this.ax, this.ay - 4, 34, 10, '#e8eef5', 3);
      ctx.fillStyle = '#c8402a'; ctx.beginPath(); ctx.ellipse(this.ax, this.ay - 6, 24, 5, 0, 0, TAU); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(this.ax - 46, this.ay - 30); ctx.quadraticCurveTo(this.ax - 44, this.ay, this.ax, this.ay); ctx.quadraticCurveTo(this.ax + 44, this.ay, this.ax + 46, this.ay - 30); ctx.closePath();
      ctx.fillStyle = '#e8eef5'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.fillStyle = '#4a7ad8'; ctx.fillRect(this.ax - 40, this.ay - 20, 80, 4);
    }
    const strand = (off: number, col: string, w: number) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x + off, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x + off * (1 - i / pts.length), pts[i].y, mx, my);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = OUT; ctx.lineWidth = w + 4; ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
    };
    const c1 = this.flash > 0 ? '#ffffff' : '#f6d06a';
    strand(-7, '#e8b84a', 5);
    strand(6, '#e8b84a', 5);
    strand(0, c1, 7);
    // sauce blobs
    ctx.fillStyle = '#c8402a';
    for (let i = 2; i < pts.length; i += 4) { ctx.beginPath(); ctx.arc(pts[i].x + 3, pts[i].y, 5, 0, TAU); ctx.fill(); }
    // tip "hand"
    const tp = pts[pts.length - 1];
    circle(ctx, tp.x, tp.y, 8, c1, 2.5);
    if (this.vis > 0.8 && !this.grabbing) {
      circle(ctx, tp.x - 3, tp.y - 1, 2, OUT, 0); circle(ctx, tp.x + 3, tp.y - 1, 2, OUT, 0);
    }
  }
}

// ───────────────────────────── CHECKPOINT CANDLE ─────────────────────────────
export class Checkpoint {
  lit = false; t = 0; flare = 0;
  constructor(public x: number, public y: number) {}
  update(L: LevelScene, dt: number) {
    this.t += dt;
    this.flare = Math.max(0, this.flare - dt);
    const p = L.player;
    if (!this.lit && !p.dead && Math.abs(p.cx - this.x) < 40 && p.bottom > this.y - 120 && p.y < this.y) {
      this.lit = true; this.flare = 1;
      L.setCheckpoint(this);
      audio.sfx('checkpoint');
      L.fx.emit(this.x, this.y - 90, { count: 24, speed: [60, 220], life: [0.6, 1.2], size: [2, 5], colors: ['#ffe14a', '#ffb02a', '#ffffff'], shape: 'star', g: -60, additive: true });
      L.fx.ring(this.x, this.y - 80, 80, '#ffe14a', 0.5, 6);
      L.toast('Свечка зажжена — тут ты возродишься');
    }
  }
  draw(ctx: C) {
    const x = this.x, y = this.y;
    rrect(ctx, x - 26, y - 10, 52, 12, 5, '#c8a050', 2.5);
    ctx.beginPath(); ctx.arc(x + 30, y - 4, 8, -Math.PI / 2, Math.PI / 2); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
    rrect(ctx, x - 13, y - 80, 26, 72, 5, this.lit ? '#fff3d8' : '#d8d0c0', 2.5);
    ctx.fillStyle = this.lit ? '#ffe9c0' : '#c8c0b0'; ctx.fillRect(x - 13, y - 80, 26, 6);
    rrect(ctx, x - 13, y - 52, 26, 8, 2, '#e8383d', 2);
    line(ctx, x, y - 80, x, y - 88, OUT, 2);
    if (this.lit) {
      const fl = Math.sin(this.t * 13) * 0.15 + Math.sin(this.t * 7.3) * 0.1 + this.flare * 0.5;
      ctx.save(); ctx.translate(x, y - 90); ctx.scale(1 + fl * 0.3, 1 + this.flare - fl);
      ctx.beginPath(); ctx.moveTo(0, -24); ctx.quadraticCurveTo(11, -6, 0, 2); ctx.quadraticCurveTo(-11, -6, 0, -24); ctx.fillStyle = '#ffb02a'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -15); ctx.quadraticCurveTo(5, -4, 0, 1); ctx.quadraticCurveTo(-5, -4, 0, -15); ctx.fillStyle = '#fff6c0'; ctx.fill();
      ctx.restore();
    } else {
      ctx.strokeStyle = 'rgba(200,200,200,0.4)'; ctx.lineWidth = 2;
      const k = (this.t * 0.7) % 1;
      ctx.beginPath(); ctx.moveTo(x, y - 90); ctx.quadraticCurveTo(x + 6, y - 100 - k * 10, x - 2, y - 112 - k * 14); ctx.stroke();
    }
  }
  light() { return this.lit ? { x: this.x, y: this.y - 92, r: 280 + this.flare * 200, color: '#ffb84a' } : null; }
}

// ───────────────────────────── NPC ─────────────────────────────
export class Npc {
  t = rand(0, 5); talk = 0; wave = 0; state = 'idle'; walk = 0; vx = 0; hidden = false;
  eye = 0.4; mouth = 0; chew = 1; anger = 0; look = 0;
  constructor(public kind: 'bear' | 'kingBg' | 'dog', public x: number, public y: number, public s = 1, public facing = 1) {}
  update(dt: number) {
    this.t += dt;
    this.talk = Math.max(0, this.talk - dt * 3);
    this.wave = Math.max(0, this.wave - dt);
    if (this.vx) { this.x += this.vx * dt; this.walk += Math.abs(this.vx) * dt * 0.08; }
  }
  draw(ctx: C) {
    if (this.hidden) return;
    const tk = this.talk > 0 ? Math.abs(Math.sin(this.t * 16)) : 0;
    if (this.kind === 'bear') {
      groundShadow(ctx, this.x, this.y, 52, 0.25);
      drawBear(ctx, this.x, this.y, this.s, this.t, { talk: tk, wave: this.wave, facing: this.facing, stand: this.state === 'walk', walkPhase: this.walk });
    } else if (this.kind === 'dog') {
      drawDog(ctx, this.x, this.y, this.s, this.t, { facing: this.facing, talk: tk, state: this.vx ? 'walk' : (this.state as 'idle'), walk: this.walk, expr: 'happy' });
    } else {
      ctx.save();
      drawKing(ctx, { x: this.x, y: this.y, s: this.s, t: this.t, eye: this.eye, mouth: Math.max(this.mouth, tk * 0.5), anger: this.anger, chew: this.chew, look: this.look, hands: [
        { x: this.x - 330 * this.s, y: this.y - 60 * this.s, state: 'rest', side: -1 },
        { x: this.x + 330 * this.s, y: this.y - 60 * this.s, state: 'rest', side: 1 },
      ] });
      // distance haze
      ctx.fillStyle = 'rgba(60,14,30,0.28)';
      ctx.fillRect(this.x - 480 * this.s, this.y - 1000 * this.s, 960 * this.s, 1100 * this.s);
      ctx.restore();
    }
  }
}

// ───────────────────────────── FALLING THINGS (traps) ─────────────────────────────
export class Faller {
  dead = false; t = 0; vy = 0; y: number; warn = 0.7; rot = rand(-0.3, 0.3); vr = rand(-2, 2);
  color = choose(['#c0392b', '#2e86c1', '#8e44ad', '#27ae60', '#d35400', '#16a085']);
  constructor(public x: number, public startY: number, public groundY: number, public kind: 'book' | 'walnut' = 'book') { this.y = startY; }
  update(L: LevelScene, dt: number) {
    this.t += dt;
    if (this.warn > 0) { this.warn -= dt; return; }
    this.vy += GRAV * 1.1 * dt;
    this.y += this.vy * dt;
    this.rot += this.vr * dt;
    const box = { x: this.x - 34, y: this.y - 18, w: 68, h: 36 };
    if (!L.player.dead && overlap(box, L.player)) L.player.hurt(L, 1, this.x);
    if (L.solidAt(this.x, this.y + 18, true) && this.y > this.startY + 40) {
      this.dead = true;
      if (this.kind === 'walnut') {
        audio.sfx('crumble'); L.cam.shake(0.15);
        L.fx.emit(this.x, this.y, { count: 12, speed: [100, 320], angle: [Math.PI, TAU], life: [0.4, 0.8], size: [4, 8], colors: ['#8a5a2a', '#c8904a'], shape: 'chunk', g: 1000 });
        return;
      }
      audio.sfx('thud');
      L.cam.shake(0.18);
      L.fx.dust(this.x, this.y + 18, 10);
      L.fx.emit(this.x, this.y, { count: 14, speed: [80, 300], angle: [Math.PI, TAU], life: [0.6, 1.4], size: [6, 10], colors: ['#f6ecd2', '#ffffff', this.color], shape: 'square', g: 500, drag: 2, vr: 10 });
    }
  }
  draw(ctx: C) {
    // warning marker on the ground
    const k = this.warn > 0 ? 1 : Math.max(0, 1 - (this.y - this.startY) / Math.max(1, this.groundY - this.startY));
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.3 * Math.sin(this.t * 20);
    ctx.fillStyle = '#200008';
    ctx.beginPath(); ctx.ellipse(this.x, this.groundY, 40 * (1.2 - k * 0.6), 9, 0, 0, TAU); ctx.fill();
    ctx.restore();
    if (this.warn > 0) return;
    ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rot);
    if (this.kind === 'walnut') {
      ellipse(ctx, 0, 0, 22, 19, '#b07a3a', 3);
      ctx.strokeStyle = '#7a4a1a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, -19); ctx.bezierCurveTo(-8, -6, 8, 6, 0, 19); ctx.stroke();
      ctx.beginPath(); ctx.arc(-8, -3, 5, 0, Math.PI); ctx.arc(8, 4, 5, Math.PI, TAU); ctx.stroke();
      ctx.restore();
      return;
    }
    rrect(ctx, -36, -16, 72, 32, 5, this.color, 3);
    ctx.fillStyle = '#f6ecd2'; ctx.fillRect(-30, -14, 60, 5);
    ctx.fillStyle = '#f0c040'; ctx.fillRect(-26, -10, 6, 24); ctx.fillRect(20, -10, 6, 24);
    ctx.restore();
  }
}

export class Shockwave {
  dead = false; t = 0;
  constructor(public x: number, public y: number, public dir: number, public speed = 520, public h = 34, public life = 2.6) {}
  update(L: LevelScene, dt: number) {
    this.t += dt;
    this.x += this.dir * this.speed * dt;
    if (this.t > this.life || this.x < -100 || this.x > L.def.w + 100) { this.dead = true; return; }
    const box = { x: this.x - 22, y: this.y - this.h, w: 44, h: this.h };
    if (!L.player.dead && overlap(box, L.player)) L.player.hurt(L, 1, this.x - this.dir * 40);
    if (Math.random() < 0.5) L.fx.dust(this.x, this.y, 1, '#c8b0e0');
  }
  draw(ctx: C) {
    const a = Math.min(1, (this.life - this.t) * 2);
    ctx.save(); ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.moveTo(this.x - 40 * this.dir, this.y);
    ctx.quadraticCurveTo(this.x - 6 * this.dir, this.y - this.h * 1.4, this.x + 14 * this.dir, this.y);
    ctx.closePath();
    ctx.fillStyle = '#e8d8ff'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
    ctx.restore();
  }
}
