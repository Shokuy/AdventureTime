import { W, H, Rect, overlap, clamp, damp, ease, rand, TAU } from '../engine/util';
import { input } from '../engine/input';
import { audio } from '../engine/audio';
import { save } from '../engine/save';
import { Camera } from '../engine/camera';
import { Particles } from '../engine/particles';
import { Backdrop, THEME_INFO } from '../art/backgrounds';
import { drawSolid, drawHazard, drawDecor, decorLight, vignetteCanvas, Decor } from '../art/props';
import { rrect, text, glow, wrap, OUT } from '../art/draw';
import type { Who } from '../art/characters';
import { Dialog } from '../ui/dialog';
import { Hud, ItemPopup, drawControlsCard } from '../ui/hud';
import { MenuList } from '../ui/widgets';
import { Coroutine, Script, Waiter, tween, wait } from '../game/coroutine';
import {
  Body, Player, Enemy, Projectile, Pickup, Noodle, Checkpoint, Npc, Faller, Shockwave, makeEnemy, GRAV,
} from '../game/entities';
import type { LevelDef, Solid, Hazard, PickupKind, ArenaDef, EnemyDef, SignDef, TriggerDef, TrapDef } from '../game/types';
import { game, STORY } from '../game/game';
import { LEVELS } from '../game/levels';
import { SCRIPTS } from '../game/scripts';

type C = CanvasRenderingContext2D;

export interface BossLike {
  name: string;
  hp: number; maxHp: number;
  update(L: LevelScene, dt: number): void;
  drawBack(ctx: C, L: LevelScene): void;
  drawFront(ctx: C, L: LevelScene): void;
  meleeHit(L: LevelScene, r: Rect, dmg: number, dir: number, atkId: number, kind: string): boolean;
  projectileHit(L: LevelScene, p: Projectile): boolean;
}

interface Bark { x: () => number; y: () => number; text: string; t: number; dur: number }

interface ArenaState { def: ArenaDef; state: 'idle' | 'active' | 'done'; wave: number; gates: Solid[]; alive: Enemy[] }

export class LevelScene {
  def: LevelDef;
  cam = new Camera();
  fx = new Particles();
  backdrop: Backdrop;
  player = new Player();
  solids: Solid[] = [];
  hazards: Hazard[] = [];
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  pickups: Pickup[] = [];
  noodles: Noodle[] = [];
  checkpoints: Checkpoint[] = [];
  npcs: Record<string, Npc> = {};
  npcList: Npc[] = [];
  fallers: Faller[] = [];
  waves: Shockwave[] = [];
  decor: Decor[] = [];
  signs: SignDef[] = [];
  triggers: (TriggerDef & { fired: boolean })[] = [];
  traps: (TrapDef & { cd: number })[] = [];
  arenas: ArenaState[] = [];
  boss: BossLike | null = null;
  chaser: { update(L: LevelScene, dt: number): void; drawBack(ctx: C, L: LevelScene): void; drawFront(ctx: C, L: LevelScene): void } | null = null;

  dialog = new Dialog();
  hud = new Hud();
  popup = new ItemPopup();
  scripts: Coroutine[] = [];
  barks: Bark[] = [];
  seen = new Set<string>();

  t = 0;
  freeze = 0;
  paused = false;
  pauseMenu: MenuList | null = null;
  showControls = false;
  letterbox = 0;
  letterboxTarget = 0;
  allowHurtInCutscene = false;
  checkpoint: { x: number; y: number } | null = null;
  deathMenu: MenuList | null = null;
  deathT = 0;
  flashT = 0;
  whiteFlash = 0;
  vignette: HTMLCanvasElement;
  timeScale = 1;
  slowT = 0;
  complete = false;
  camOverride = false;
  camLook = { x: 0, y: 0 };
  camZoomTarget = 1;
  levelIndex: number;
  nextSolidId = 1;
  darkness: number;
  musicName: string;
  bannerShown = false;
  extraDraw: ((ctx: C) => void)[] = [];
  extraDrawFront: ((ctx: C) => void)[] = [];
  noControlHint = 0;
  camTarget: (() => { x: number; y: number }) | null = null;

  constructor(id: string, index: number, fromCheckpoint?: { x: number; y: number }, seen?: Set<string>) {
    this.def = LEVELS[id]();
    this.levelIndex = index;
    this.backdrop = new Backdrop(this.def.theme, this.def.w, this.def.h);
    this.vignette = vignetteCanvas(W, H, 0.5);
    this.darkness = this.def.darkness ?? 0.1;
    this.musicName = this.def.music;
    if (seen) this.seen = seen;
    this.dialog.onSpeak = (who) => this.speakAnim(who);
    this.dialog.top = true;
    this.build(fromCheckpoint);
  }

  // ─────────────── construction ───────────────
  build(cp?: { x: number; y: number }) {
    const d = this.def;
    this.solids = d.solids.map((s, i) => ({ ...s, id: this.nextSolidId++, seed: s.seed ?? (i * 7919 + d.chapter * 31), active: true }));
    this.hazards = d.hazards.map((h) => ({ ...h }));
    this.enemies = d.enemies.map((e) => makeEnemy(e.kind, e.x, e.y, e.range, e.facing, e.hue));
    this.pickups = d.pickups.filter((p) => !p.id || !save.has(p.id)).map((p) => new Pickup(p.kind, p.x, p.y, p.id));
    this.noodles = d.noodles.map((n) => new Noodle(n.x, n.y, n.len, n.dir ?? 1));
    this.checkpoints = d.checkpoints.map((c) => new Checkpoint(c.x, c.y));
    this.decor = d.decor;
    this.signs = d.signs;
    this.triggers = d.triggers.map((t) => ({ ...t, fired: !!t.once && this.seen.has(t.script) }));
    this.traps = d.traps.map((t) => ({ ...t, cd: 0 }));
    this.arenas = d.arenas.map((a) => ({ def: a, state: this.seen.has('arena' + a.x) ? 'done' : 'idle', wave: 0, gates: [], alive: [] }));
    this.npcs = {}; this.npcList = [];
    for (const n of d.npcs) {
      const npc = new Npc(n.kind, n.x, n.y, n.s ?? 1, n.facing ?? 1);
      this.npcs[n.kind] = npc; this.npcList.push(npc);
    }
    const start = cp ?? d.spawn;
    this.player.reset(start.x, start.y - this.player.h);
    this.player.facing = 1;
    this.cam.bounds = { x: 0, y: 0, w: d.w, h: d.h };
    this.cam.zoom = d.zoom ?? 1.2;
    this.camZoomTarget = this.cam.zoom;
    this.cam.x = this.player.cx; this.cam.y = this.player.cy - 60;
    this.cam.clampToBounds();
    if (cp) {
      this.checkpoint = cp;
      for (const c of this.checkpoints) if (Math.abs(c.x - cp.x) < 5) c.lit = true;
    }
    this.setupSpecial();
    audio.playMusic(this.def.music);
    if (!cp && d.startScript && !this.seen.has(d.startScript)) this.run(d.startScript);
    else if (!cp && !this.bannerShown) { this.hud.showChapter(d.title, d.subtitle); this.bannerShown = true; }
  }

  setupSpecial() {
    const s = SCRIPTS.special?.[this.def.id];
    if (s) s(this);
  }

  // ─────────────── world helpers used by entities ───────────────
  moveBody(b: Body, dt: number) {
    if (b.gravity) b.vy = Math.min(b.vy + GRAV * b.gravity * dt, b.maxFall);
    b.hitWall = 0;
    b.x += b.vx * dt;
    for (const s of this.solids) {
      if (!s.active || s.oneway) continue;
      if (overlap(b, s)) {
        if (b.vx > 0) { b.x = s.x - b.w; b.hitWall = 1; }
        else if (b.vx < 0) { b.x = s.x + s.w; b.hitWall = -1; }
        else {
          const pl = b.x + b.w - s.x, pr = s.x + s.w - b.x;
          if (pl < pr) b.x -= pl; else b.x += pr;
        }
        b.vx = 0;
      }
    }
    const prevBottom = b.y + b.h;
    b.y += b.vy * dt;
    b.onGround = false; b.groundSolid = null;
    for (const s of this.solids) {
      if (!s.active || !overlap(b, s)) continue;
      if (s.oneway) {
        if (b.vy >= 0 && prevBottom <= s.y + 3 && b.dropT <= 0) this.land(b, s);
      } else if (b.vy > 0 || prevBottom <= s.y + 3) {
        this.land(b, s);
      } else {
        b.y = s.y + s.h;
        if (b.vy < 0) b.vy = 0;
      }
    }
    if (b.x < 0) { b.x = 0; b.hitWall = -1; }
    if (b.x + b.w > this.def.w) { b.x = this.def.w - b.w; b.hitWall = 1; }
  }

  private land(b: Body, s: Solid) {
    b.y = s.y - b.h;
    if (s.bounce && b.vy > 60) {
      b.vy = -s.bounce; s.wob = 1; b.bounced = true;
      return;
    }
    b.vy = 0; b.onGround = true; b.groundSolid = s;
  }

  solidAt(x: number, y: number, includeOneway: boolean) {
    for (const s of this.solids) {
      if (!s.active || (s.oneway && !includeOneway)) continue;
      if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + (s.oneway ? 14 : s.h)) return true;
    }
    return false;
  }

  meleeHit(r: Rect, dmg: number, dir: number, atkId: number, kind: string): boolean {
    let hit = false;
    for (const e of this.enemies) {
      if (e.dead || e.spawnT > 0 || e.lastHit === atkId) continue;
      if (overlap(r, e)) {
        e.lastHit = atkId;
        e.hurt(this, dmg, dir, kind);
        hit = true;
      }
    }
    for (const p of this.projectiles) {
      if (p.dead || p.owner === 'player') continue;
      const box = { x: p.x - p.r, y: p.y - p.r, w: p.r * 2, h: p.r * 2 };
      if (!overlap(r, box)) continue;
      if (p.reflectable && this.boss) {
        const tgt = (this.boss as unknown as { faceTarget(): { x: number; y: number } }).faceTarget();
        p.reflect(this, tgt.x, tgt.y);
        hit = true;
      } else {
        p.pop(this); hit = true;
        this.fx.sparks(p.x, p.y, 6);
      }
    }
    for (const n of this.noodles) if (n.hitTest(r)) { n.cut(this); hit = true; }
    if (this.boss && this.boss.meleeHit(this, r, dmg, dir, atkId, kind)) hit = true;
    if (kind === 'pogo') {
      for (const h of this.hazards) if (overlap(r, h) && (h.style === 'forks' || h.style === 'pins')) { hit = true; this.fx.sparks(this.player.cx, this.player.bottom + 10, 6); }
    }
    if (hit) { this.hitstop(0.045); this.cam.shake(0.1); }
    return hit;
  }

  onPlayerAttack() { /* hook for tutorials */ }

  hitstop(sec: number) { this.freeze = Math.max(this.freeze, sec); }
  fadeFlash() { this.flashT = 0.35; }

  dropPickup(kind: PickupKind, x: number, y: number) {
    const p = new Pickup(kind, x, y, undefined, true);
    p.vx = rand(-160, 160); p.vy = rand(-460, -260);
    this.pickups.push(p);
  }

  collect(p: Pickup) {
    const pl = this.player;
    switch (p.kind) {
      case 'crumb': save.data.crumbs += 1; audio.sfx('coin'); this.fx.emit(p.cx, p.cy, { count: 5, speed: [40, 120], life: [0.2, 0.4], size: [2, 3], colors: ['#ffe0a0', '#fff'], shape: 'star', additive: true }); break;
      case 'bigcrumb': save.data.crumbs += 5; audio.sfx('coin', { pitch: 0.8 }); this.fx.text(p.cx, p.cy - 10, '+5', '#ffe0a0', 18); this.fx.emit(p.cx, p.cy, { count: 10, speed: [60, 160], life: [0.3, 0.5], size: [2, 4], colors: ['#ffe0a0', '#fff'], shape: 'star', additive: true }); break;
      case 'heart': pl.hp = Math.min(pl.maxHp, pl.hp + 1); audio.sfx('heal'); this.fx.text(p.cx, p.cy - 10, '+1 ♥', '#ff8aa0', 18); break;
      case 'peas': pl.ammo = Math.min(save.data.ammoMax, pl.ammo + 5); audio.sfx('coin', { pitch: 1.4 }); this.fx.text(p.cx, p.cy - 10, '+5 горох', '#c8f0a0', 16); break;
      case 'honey': save.data.potions = Math.min(3, save.data.potions + 1); audio.sfx('heal'); this.fx.text(p.cx, p.cy - 10, '+мёд', '#ffd060', 18); break;
      case 'container':
        save.data.maxHp += 1; pl.maxHp = save.data.maxHp; pl.hp = pl.maxHp; this.itemGet(p); break;
      case 'doubleJump': save.data.abilities.doubleJump = true; this.itemGet(p); break;
      case 'dash': save.data.abilities.dash = true; this.itemGet(p); break;
      case 'fork': save.data.abilities.fork = true; pl.weapon = 'fork'; this.itemGet(p); break;
      case 'sling': save.data.abilities.slingshot = true; pl.ammo = save.data.ammoMax; this.itemGet(p); break;
    }
    if (p.id) save.collect(p.id);
  }

  itemGet(p: Pickup) {
    audio.sfx('artifact');
    this.cam.shake(0.2);
    this.fx.ring(p.cx, p.cy, 120, '#ffe14a', 0.6, 8);
    this.fx.emit(p.cx, p.cy, { count: 40, speed: [100, 420], life: [0.6, 1.2], size: [3, 6], colors: ['#ffe14a', '#ffffff', '#ffb02a'], shape: 'star', drag: 2, additive: true });
    this.popup.show(p.kind);
    save.write();
  }

  bark(target: { cx: number; y: number }, str: string, dur = 1.6) {
    this.barks = this.barks.filter((b) => b.x() !== target.cx);
    this.barks.push({ x: () => target.cx, y: () => target.y, text: str, t: 0, dur });
  }

  barkAt(x: number, y: number, str: string, dur = 1.8) {
    this.barks.push({ x: () => x, y: () => y, text: str, t: 0, dur });
  }

  toast(str: string) { this.hud.toast(str); }

  setCheckpoint(c: Checkpoint) {
    this.checkpoint = { x: c.x, y: c.y };
    const p = this.player;
    p.hp = p.maxHp; p.ammo = Math.max(p.ammo, save.data.ammoMax);
    save.write();
  }

  onPlayerDeath() {
    save.data.deaths++;
    save.write();
    this.slowT = 1.2;
    this.cam.shake(0.6);
    this.deathT = 0;
  }

  speakAnim(who: Who) {
    if (who === 'hero') this.player.talk = 0.35;
    else if (who === 'bear' && this.npcs.bear) this.npcs.bear.talk = 0.35;
    else if (who === 'dog' && this.npcs.dog) this.npcs.dog.talk = 0.35;
    else if (who === 'king') {
      if (this.npcs.kingBg) this.npcs.kingBg.talk = 0.35;
      const b = this.boss as unknown as { talk?: number } | null;
      if (b && 'talk' in b) b.talk = 0.35;
      const ch = this.chaser as unknown as { talk?: number } | null;
      if (ch && 'talk' in ch) ch.talk = 0.35;
    }
  }

  // ─────────────── cutscene helpers ───────────────
  run(id: string) {
    const s = SCRIPTS.scripts[id];
    if (!s) return;
    this.seen.add(id);
    this.scripts.push(new Coroutine(s(this)));
  }
  runGen(gen: Script) { this.scripts.push(new Coroutine(gen)); }
  get inCutscene() { return this.scripts.length > 0 || this.dialog.active; }

  say(who: Who, str: string, expr?: string): Waiter { return this.dialog.say(who, str, expr); }
  endSay() { this.dialog.close(); }

  cutscene(on: boolean) {
    this.letterboxTarget = on ? 1 : 0;
    this.player.control = !on;
    if (on) { this.player.vx = 0; this.player.atkKind = null; this.player.dashT = 0; this.player.gravity = 1; }
    if (!on) { this.camOverride = false; this.dialog.close(); }
  }

  camTo(x: number, y: number, d: number, zoom?: number): Waiter {
    this.camOverride = true;
    const sx = this.cam.x, sy = this.cam.y, sz = this.cam.zoom;
    const tz = zoom ?? sz;
    return tween(d, (k) => {
      this.cam.x = sx + (x - sx) * k; this.cam.y = sy + (y - sy) * k;
      this.cam.zoom = sz + (tz - sz) * k;
    }, ease.inOut);
  }

  camBack(d: number): Waiter {
    const p = this.player;
    const tx = p.cx + p.facing * 90, ty = p.cy - 70;
    const z = this.def.zoom ?? 1.2;
    const w = this.camTo(tx, ty, d, z);
    return { update: (dt) => { const r = w.update(dt); if (r) this.camOverride = false; return r; } };
  }

  walkTo(x: number, speed = 0.6): Waiter {
    this.player.auto = { x, speed };
    return { update: () => this.player.auto === null };
  }

  // ─────────────── arenas / traps / triggers ───────────────
  private updateArenas(dt: number) {
    const p = this.player;
    for (const a of this.arenas) {
      const d = a.def;
      if (a.state === 'idle' && p.cx > d.x + 120 && p.cx < d.x + d.w - 120 && p.onGround && !this.inCutscene) {
        a.state = 'active'; a.wave = 0;
        const mk = (x: number): Solid => ({ id: this.nextSolidId++, x, y: d.floorY - 420, w: 40, h: 420, style: 'pillar', seed: 1, active: true, gate: true, color: '#6a3a2a' });
        a.gates = [mk(d.x), mk(d.x + d.w - 40)];
        this.solids.push(...a.gates);
        this.hud.showBanner('ЗАСАДА!', '#ff5a4a');
        audio.sfx('warn'); audio.sfx('roar', { volume: 0.25, pitch: 2 });
        this.cam.shake(0.3);
        for (const g of a.gates) this.fx.dust(g.x + 20, d.floorY, 12);
        this.spawnWave(a);
      }
      if (a.state === 'active') {
        a.alive = a.alive.filter((e) => !e.dead);
        if (a.alive.length === 0) {
          a.wave++;
          if (a.wave < d.waves.length) this.spawnWave(a);
          else {
            a.state = 'done';
            this.seen.add('arena' + d.x);
            this.solids = this.solids.filter((s) => !a.gates.includes(s));
            for (const g of a.gates) this.fx.dust(g.x + 20, d.floorY, 14);
            audio.sfx('victory', { volume: 0.6 });
            this.hud.showBanner('ПОБЕДА!', '#ffd34a');
            for (const r of d.reward ?? []) {
              if (r.id && save.has(r.id)) continue;
              const pk = new Pickup(r.kind, r.x, r.y, r.id, !r.id);
              this.pickups.push(pk);
            }
            for (let i = 0; i < 6; i++) this.dropPickup('crumb', d.x + d.w / 2, d.floorY - 100);
          }
        }
      }
    }
    void dt;
  }

  private spawnWave(a: ArenaState) {
    const wave = a.def.waves[a.wave];
    a.alive = [];
    wave.forEach((ed: EnemyDef, i) => {
      const e = makeEnemy(ed.kind, ed.x, ed.y, ed.range ?? 300, ed.facing, ed.hue);
      e.spawnT = 0.6 + i * 0.15; e.arena = true;
      if (e.kind === 'guard') (e as unknown as { state: string }).state = 'chase';
      this.enemies.push(e); a.alive.push(e);
      this.fx.emit(e.cx, e.cy, { count: 16, speed: [60, 200], life: [0.4, 0.8], size: [6, 12], colors: ['#ffffff', '#e8d8c8'], shape: 'smoke', drag: 3 });
    });
    if (a.wave > 0) this.toast(`Волна ${a.wave + 1} из ${a.def.waves.length}`);
  }

  private updateTraps(dt: number) {
    const p = this.player;
    for (const tr of this.traps) {
      tr.cd -= dt;
      if (tr.cd <= 0 && overlap(p, tr)) {
        tr.cd = 4;
        tr.drops.forEach((dx, i) => {
          let gy = tr.y + tr.h;
          for (let yy = tr.dropY; yy < this.def.h; yy += 8) { if (this.solidAt(dx, yy, true)) { gy = yy; break; } }
          const f = new Faller(dx, tr.dropY, gy);
          f.warn = 0.6 + i * 0.22;
          this.fallers.push(f);
        });
        audio.sfx('warn', { pitch: 0.8 });
      }
    }
  }

  private updateTriggers() {
    const p = this.player;
    for (const tr of this.triggers) {
      if (tr.fired || this.inCutscene) continue;
      if (overlap(p, tr) && !p.dead) {
        tr.fired = true;
        this.run(tr.script);
      }
    }
    // exit
    const ex = this.def.exit;
    if (ex && !this.complete && !p.dead && overlap(p, ex) && !this.inCutscene) {
      this.complete = true;
      this.finishLevel();
    }
  }

  finishLevel() {
    audio.sfx('door');
    if (('exit_' + this.def.id) in SCRIPTS.scripts) { this.run('exit_' + this.def.id); return; }
    this.cutscene(true);
    this.player.auto = { x: this.player.cx + this.player.facing * 120, speed: 0.6 };
    this.runGen((function* (L: LevelScene) {
      yield wait(0.5);
      L.endLevel();
    })(this));
  }

  endLevel() {
    save.data.potions = Math.max(save.data.potions, 0);
    save.write();
    if (STORY[save.data.story]?.kind === 'level' && (STORY[save.data.story] as { id: string }).id === this.def.id) game.advance();
    else {
      // replaying a chapter from chapter select: continue the story from where it is
      const idx = STORY.findIndex((s) => s.kind === 'level' && s.id === this.def.id);
      game.story(Math.max(idx + 1, 0));
    }
  }

  respawn() {
    const cp = this.checkpoint;
    const id = this.def.id;
    const seen = this.seen;
    const idx = this.levelIndex;
    game.go(() => new LevelScene(id, idx, cp ?? undefined, seen), 3);
  }

  // ─────────────── update ───────────────
  update(rawDt: number) {
    this.t += rawDt;
    this.dialog.update(rawDt);
    this.hud.update(rawDt, this.player);
    this.letterbox = damp(this.letterbox, this.letterboxTarget, 8, rawDt);
    this.flashT = Math.max(0, this.flashT - rawDt);
    this.whiteFlash = Math.max(0, this.whiteFlash - rawDt * 2);

    if (this.popup.active) {
      this.popup.update(rawDt);
      if (this.popup.t > 0.7 && (input.pressed('confirm') || input.pressed('jump') || input.pressed('attack') || input.mouseClicked)) {
        this.popup.close(); audio.sfx('menuSelect');
      }
      return;
    }

    if (this.player.dead && this.deathT > 1.4) {
      if (!this.deathMenu) {
        this.deathMenu = new MenuList([
          { label: 'Ещё разок!', action: () => this.respawn() },
          { label: 'В главное меню', action: () => game.toMenu() },
        ], W / 2, H / 2 + 40, { w: 360 });
      }
      this.deathMenu.update(rawDt);
    }

    if (input.pressed('pause') && !this.player.dead && !this.complete) {
      if (this.showControls) this.showControls = false;
      else this.togglePause();
    }
    if (this.paused) {
      if (this.showControls) { if (input.pressed('confirm') || input.pressed('back') || input.mouseClicked) this.showControls = false; }
      else this.pauseMenu?.update(rawDt);
      return;
    }

    let dt = rawDt;
    if (this.slowT > 0) { this.slowT -= rawDt; dt *= 0.35; }
    if (this.player.dead) this.deathT += rawDt;
    if (this.freeze > 0) { this.freeze -= rawDt; this.cam.update(rawDt); return; }
    dt *= this.timeScale;

    // scripts
    for (const s of this.scripts) s.update(dt);
    this.scripts = this.scripts.filter((s) => !s.done);

    this.player.update(this, dt);
    const frozen = this.letterboxTarget > 0.5;
    if (!frozen) for (const e of this.enemies) e.update(this, dt);
    this.enemies = this.enemies.filter((e) => !e.dead);
    for (const p of this.projectiles) p.update(this, dt);
    this.projectiles = this.projectiles.filter((p) => !p.dead);
    for (const p of this.pickups) p.update(this, dt);
    this.pickups = this.pickups.filter((p) => !p.dead);
    for (const n of this.noodles) n.update(this, dt);
    for (const c of this.checkpoints) c.update(this, dt);
    for (const n of this.npcList) n.update(dt);
    for (const f of this.fallers) f.update(this, dt);
    this.fallers = this.fallers.filter((f) => !f.dead);
    for (const w of this.waves) w.update(this, dt);
    this.waves = this.waves.filter((w) => !w.dead);
    this.boss?.update(this, dt);
    this.chaser?.update(this, dt);
    for (const b of this.barks) b.t += dt;
    this.barks = this.barks.filter((b) => b.t < b.dur);

    this.updateSolids(dt);
    if (!this.player.dead) {
      this.updateTriggers();
      this.updateTraps(dt);
      this.updateArenas(dt);
    }
    this.fx.update(dt);
    this.updateCamera(dt);
    save.data.playTime += rawDt;
  }

  private updateSolids(dt: number) {
    const p = this.player;
    for (const s of this.solids) {
      if (s.wob) s.wob = Math.max(0, s.wob - dt * 2.5);
      if (s.crumbly) {
        if (s.active) {
          const standing = p.onGround && p.groundSolid === s;
          if (standing || (s.crumble ?? 0) > 0) {
            const before = s.crumble ?? 0;
            s.crumble = before + dt / 0.55;
            if (before === 0) audio.sfx('crumble', { volume: 0.5 });
            if (Math.random() < 0.3) this.fx.emit(s.x + rand(0, s.w), s.y + s.h, { count: 1, speed: [10, 40], angle: [1.2, 1.9], life: [0.4, 0.8], size: [3, 5], colors: ['#d89a52', '#8a5a2a'], shape: 'crumb', g: 800 });
            if (s.crumble >= 1) {
              s.active = false; s.gone = 3.2; s.crumble = 0;
              audio.sfx('break', { volume: 0.6 });
              this.fx.emit(s.x + s.w / 2, s.y + s.h / 2, { count: 22, speed: [60, 260], life: [0.5, 1], size: [4, 8], colors: ['#d89a52', '#4a2a18', '#eab26a'], shape: 'crumb', g: 1100, spread: s.w / 3 });
            }
          }
        } else if (s.gone !== undefined) {
          s.gone -= dt;
          if (s.gone <= 0 && !overlap(p, s)) { s.active = true; s.gone = undefined; this.fx.emit(s.x + s.w / 2, s.y + s.h / 2, { count: 10, speed: [20, 80], life: [0.3, 0.6], size: [4, 8], colors: ['#fff3d8'], shape: 'smoke', spread: s.w / 3 }); }
        }
      }
    }
  }

  private updateCamera(dt: number) {
    this.cam.update(dt);
    if (this.camOverride) return;
    const p = this.player;
    this.cam.zoom = damp(this.cam.zoom, this.camZoomTarget, 3, dt);
    const look = p.facing * 90 + p.vx * 0.25;
    this.camLook.x = damp(this.camLook.x, look, 2.5, dt);
    const lookY = p.onGround ? -60 : p.vy > 400 ? 60 : -40;
    this.camLook.y = damp(this.camLook.y, lookY, 2, dt);
    let tx = p.cx + this.camLook.x, ty = p.cy + this.camLook.y;
    if (this.camTarget) { const c = this.camTarget(); tx = c.x; ty = c.y; }
    this.cam.follow(tx, ty, dt, 6, p.onGround ? 5 : 3.5);
    let bounds = { x: 0, y: 0, w: this.def.w, h: this.def.h };
    for (const a of this.arenas) if (a.state === 'active') bounds = { x: a.def.x - 40, y: 0, w: a.def.w + 80, h: this.def.h };
    this.cam.bounds = bounds;
    this.cam.clampToBounds();
  }

  togglePause() {
    this.paused = !this.paused;
    audio.sfx('pause');
    if (this.paused) {
      audio.duckMusic(0.35);
      this.pauseMenu = new MenuList([
        { label: 'Продолжить', action: () => this.togglePause() },
        { label: 'Управление', action: () => { this.showControls = true; } },
        { label: () => `Музыка: ${Math.round(save.data.settings.music * 10)}`, left: () => this.vol('music', -0.1), right: () => this.vol('music', 0.1) },
        { label: () => `Звуки: ${Math.round(save.data.settings.sfx * 10)}`, left: () => this.vol('sfx', -0.1), right: () => this.vol('sfx', 0.1) },
        { label: () => `Тряска: ${save.data.settings.shake ? 'да' : 'нет'}`, action: () => { save.data.settings.shake = !save.data.settings.shake; save.write(); } },
        { label: 'Начать с чекпоинта', action: () => { this.paused = false; this.respawn(); } },
        { label: 'В главное меню', action: () => { save.write(); game.toMenu(); } },
      ], W / 2, 170, { w: 380, h: 50, gap: 10, size: 24 });
    } else {
      audio.duckMusic(1);
      this.pauseMenu = null;
    }
  }

  vol(kind: 'music' | 'sfx', d: number) {
    const s = save.data.settings;
    s[kind] = clamp(Math.round((s[kind] + d) * 10) / 10, 0, 1);
    if (kind === 'music') audio.setMusicVolume(s.music); else { audio.setSfxVolume(s.sfx); audio.sfx('coin'); }
    save.write();
  }

  // ─────────────── render ───────────────
  render(ctx: C) {
    const cam = this.cam;
    this.backdrop.draw(ctx, cam, this.t);

    ctx.save();
    cam.apply(ctx);
    const view = cam.view(120);
    const vis = (r: Rect) => r.x < view.x + view.w && r.x + r.w > view.x && r.y < view.y + view.h && r.y + r.h > view.y;

    for (const fn of this.extraDraw) fn(ctx);
    this.boss?.drawBack(ctx, this);
    this.chaser?.drawBack(ctx, this);

    // background decor
    for (const d of this.decor) {
      if (d.front) continue;
      if (d.x < view.x - 400 || d.x > view.x + view.w + 400) continue;
      drawDecor(ctx, d, this.t);
    }
    for (const n of this.npcList) if (n.kind === 'kingBg') n.draw(ctx);
    // signs
    for (const s of this.signs) {
      if (s.x < view.x - 100 || s.x > view.x + view.w + 100) continue;
      drawDecor(ctx, { type: 'sign', x: s.x, y: s.y, text: s.label }, this.t);
    }
    for (const c of this.checkpoints) if (c.x > view.x - 100 && c.x < view.x + view.w + 100) c.draw(ctx);

    // solids
    for (const s of this.solids) {
      if (!s.active && !s.crumbly) continue;
      if (!s.active) continue;
      if (!vis({ x: s.x - 40, y: s.y - 60, w: s.w + 80, h: (s.legs ? s.legs - s.y : s.h) + 100 })) continue;
      drawSolid(ctx, s, this.t);
    }
    for (const h of this.hazards) if (vis(h)) drawHazard(ctx, h.style, h.x, h.y, h.w, h.h, this.t);
    for (const n of this.noodles) if (Math.abs(n.ax - cam.x) < cam.viewW) n.draw(ctx);

    for (const n of this.npcList) if (n.kind !== 'kingBg') n.draw(ctx);
    for (const p of this.pickups) if (vis(p)) p.draw(ctx, this);
    for (const e of this.enemies) if (vis(e)) e.draw(ctx, this);
    for (const w of this.waves) w.draw(ctx);
    this.player.draw(ctx, this);
    for (const p of this.projectiles) p.draw(ctx, this);
    for (const f of this.fallers) f.draw(ctx);
    this.boss?.drawFront(ctx, this);
    this.chaser?.drawFront(ctx, this);
    for (const fn of this.extraDrawFront) fn(ctx);
    for (const d of this.decor) if (d.front && d.x > view.x - 400 && d.x < view.x + view.w + 400) drawDecor(ctx, d, this.t);
    this.fx.draw(ctx, view);

    // lights
    ctx.save();
    for (const d of this.decor) {
      const l = decorLight(d);
      if (l && l.x > view.x - l.r && l.x < view.x + view.w + l.r) glow(ctx, l.x, l.y, l.r, l.color, 0.22 + Math.sin(this.t * 9 + d.x) * 0.02);
    }
    for (const c of this.checkpoints) { const l = c.light(); if (l) glow(ctx, l.x, l.y, l.r, l.color, 0.22); }
    ctx.restore();

    // barks (world space)
    for (const b of this.barks) this.drawBark(ctx, b);
    // sign tooltips
    this.drawSignTips(ctx);
    ctx.restore();

    // ambient tint + vignette
    const info = THEME_INFO[this.def.theme];
    ctx.save();
    ctx.globalAlpha = info.tintA + this.darkness * 0.2;
    ctx.fillStyle = info.tint; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.drawImage(this.vignette, 0, 0, W, H);

    if (this.flashT > 0) { ctx.fillStyle = `rgba(10,4,8,${this.flashT / 0.35})`; ctx.fillRect(0, 0, W, H); }
    if (this.whiteFlash > 0) { ctx.fillStyle = `rgba(255,255,255,${this.whiteFlash})`; ctx.fillRect(0, 0, W, H); }
    // low hp red pulse
    if (!this.player.dead && this.player.hp === 1) {
      ctx.save(); ctx.globalAlpha = 0.18 + Math.sin(this.t * 6) * 0.08;
      ctx.strokeStyle = '#ff2040'; ctx.lineWidth = 40; ctx.strokeRect(0, 0, W, H);
      ctx.restore();
    }

    // letterbox
    if (this.letterbox > 0.01) {
      const bh = 70 * this.letterbox;
      ctx.fillStyle = '#0a0406';
      ctx.fillRect(0, 0, W, bh); ctx.fillRect(0, H - bh, W, bh);
    }

    this.hud.draw(ctx, this.player, this.t, this.player.dead ? 0 : clamp(1 - this.letterbox * 1.5, 0, 1));
    this.dialog.draw(ctx);
    this.popup.draw(ctx);

    if (this.player.dead && this.deathT > 0.6) this.drawDeath(ctx);
    if (this.paused) this.drawPause(ctx);
  }

  private drawBark(ctx: C, b: Bark) {
    const a = b.t < 0.15 ? b.t / 0.15 : b.t > b.dur - 0.3 ? (b.dur - b.t) / 0.3 : 1;
    const x = b.x(), y = b.y() - 30;
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.font = '400 20px Pangolin, sans-serif';
    const w = ctx.measureText(b.text).width + 26;
    const sc = ease.outBack(clamp(b.t * 5, 0, 1));
    ctx.translate(x, y); ctx.scale(sc, sc);
    rrect(ctx, -w / 2, -40, w, 34, 12, '#fffaf0', 3);
    ctx.beginPath(); ctx.moveTo(-6, -7); ctx.lineTo(0, 4); ctx.lineTo(8, -7); ctx.closePath(); ctx.fillStyle = '#fffaf0'; ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(0, 4); ctx.lineTo(8, -6); ctx.stroke();
    text(ctx, b.text, 0, -16, { size: 20, font: 'body', color: OUT, align: 'center' });
    ctx.restore();
  }

  private drawSignTips(ctx: C) {
    const p = this.player;
    for (const s of this.signs) {
      const d = Math.abs(p.cx - s.x);
      if (d > 110 || Math.abs(p.bottom - s.y) > 160) continue;
      const a = clamp((110 - d) / 40, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = '400 21px Pangolin, sans-serif';
      const lines = wrap(ctx, s.text, 340);
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 34;
      const h = lines.length * 26 + 22;
      const x = s.x - w / 2, y = s.y - 120 - h;
      rrect(ctx, x + 4, y + 6, w, h, 14, 'rgba(0,0,0,0.3)', 0);
      rrect(ctx, x, y, w, h, 14, '#fff7e6', 3);
      lines.forEach((l, i) => text(ctx, l, s.x, y + 30 + i * 26, { size: 21, font: 'body', color: OUT, align: 'center' }));
      ctx.restore();
    }
  }

  private drawDeath(ctx: C) {
    const k = clamp((this.deathT - 0.6) / 0.8, 0, 1);
    ctx.save();
    ctx.fillStyle = `rgba(20,4,10,${0.65 * k})`; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = k;
    const s = 1 + (1 - ease.outBack(k)) * 0.5;
    ctx.translate(W / 2, H / 2 - 90); ctx.scale(s, s); ctx.rotate(Math.sin(this.t * 2) * 0.02);
    text(ctx, 'ОЙ-ОЙ-ОЙ!', 0, 0, { size: 72, color: '#ff5a6a', align: 'center', stroke: 12 });
    text(ctx, 'Тошу чуть не съели...', 0, 50, { size: 26, font: 'body', color: '#fff3d8', align: 'center', stroke: 6 });
    ctx.restore();
    if (this.deathMenu && this.deathT > 1.4) this.deathMenu.draw(ctx);
  }

  private drawPause(ctx: C) {
    ctx.fillStyle = 'rgba(15,6,12,0.7)'; ctx.fillRect(0, 0, W, H);
    text(ctx, 'ПАУЗА', W / 2, 120, { size: 60, color: '#ffd34a', align: 'center', stroke: 10 });
    const step = STORY[save.data.story];
    if (step && step.kind === 'level') text(ctx, step.title, W / 2, 152, { size: 18, font: 'body', color: '#f6ecd2', align: 'center' });
    if (this.showControls) {
      drawControlsCard(ctx, W / 2, 180);
      return;
    }
    this.pauseMenu?.draw(ctx);
  }
}

export function spawnRing(L: LevelScene, x: number, y: number) {
  L.fx.emit(x, y, { count: 20, speed: [100, 300], angle: [0, TAU], life: [0.3, 0.6], size: [3, 6], colors: ['#fff'], shape: 'star' });
}
