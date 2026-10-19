import { W, H, TAU, clamp, ease, srand } from '../engine/util';
import { input } from '../engine/input';
import { audio } from '../engine/audio';
import { save } from '../engine/save';
import { Particles } from '../engine/particles';
import { drawKing, drawThrone, drawHero, drawGuard } from '../art/characters';
import { text, rrect, glow, OUT } from '../art/draw';
import { vignetteCanvas, drawDecor } from '../art/props';
import { MenuList } from '../ui/widgets';
import { drawControlsCard } from '../ui/hud';
import { game, STORY } from '../game/game';

type C = CanvasRenderingContext2D;
type Mode = 'main' | 'settings' | 'controls' | 'chapters' | 'confirm';

export class MenuScene {
  t = 0;
  fx = new Particles();
  mode: Mode = 'main';
  main: MenuList;
  sub: MenuList | null = null;
  vignette = vignetteCanvas(W, H, 0.7);
  guards = [{ x: -100, dir: 1, sp: 60 }, { x: W + 200, dir: -1, sp: 45 }];
  zT = 0;

  constructor() {
    this.main = this.buildMain();
    audio.playMusic('menu');
  }

  buildMain() {
    return new MenuList([
      { label: () => (save.data.started ? 'Новая игра' : 'Начать игру'), action: () => this.newGame() },
      { label: 'Продолжить', action: () => game.story(save.data.story), disabled: () => !save.data.started },
      { label: 'Главы', action: () => this.open('chapters'), disabled: () => save.data.reached < 1 },
      { label: 'Управление', action: () => this.open('controls') },
      { label: 'Настройки', action: () => this.open('settings') },
    ], 250, 360, { w: 340, h: 52, gap: 12, size: 25 });
  }

  newGame() {
    if (save.data.started) { this.open('confirm'); return; }
    save.reset();
    game.story(0);
  }

  open(m: Mode) {
    this.mode = m;
    const back = { label: 'Назад', action: () => { this.mode = 'main'; this.sub = null; } };
    if (m === 'settings') {
      const vol = (k: 'music' | 'sfx', d: number) => {
        const s = save.data.settings;
        s[k] = clamp(Math.round((s[k] + d) * 10) / 10, 0, 1);
        if (k === 'music') audio.setMusicVolume(s.music); else { audio.setSfxVolume(s.sfx); audio.sfx('coin'); }
        save.write();
      };
      this.sub = new MenuList([
        { label: () => `Музыка: ${bar(save.data.settings.music)}`, left: () => vol('music', -0.1), right: () => vol('music', 0.1) },
        { label: () => `Звуки: ${bar(save.data.settings.sfx)}`, left: () => vol('sfx', -0.1), right: () => vol('sfx', 0.1) },
        { label: () => `Тряска экрана: ${save.data.settings.shake ? 'да' : 'нет'}`, action: () => { save.data.settings.shake = !save.data.settings.shake; save.write(); } },
        { label: 'Полный экран', action: () => toggleFullscreen() },
        back,
      ], W / 2, 220, { w: 460, h: 54, gap: 12, size: 24 });
    } else if (m === 'chapters') {
      const items = STORY.map((s, i) => ({ s, i })).filter(({ s, i }) => s.kind === 'level' && i <= save.data.reached);
      this.sub = new MenuList([
        ...items.map(({ s, i }) => ({ label: (s as { title: string }).title, action: () => game.story(i) })),
        back,
      ], W / 2, 170, { w: 520, h: 52, gap: 10, size: 22 });
    } else if (m === 'confirm') {
      this.sub = new MenuList([
        { label: 'Да, начать заново', action: () => { save.reset(); game.story(0); } },
        { label: 'Нет, вернуться', action: () => { this.mode = 'main'; this.sub = null; } },
      ], W / 2, 360, { w: 420, h: 54, gap: 14, size: 24 });
    } else if (m === 'controls') {
      this.sub = new MenuList([back], W / 2, 620, { w: 260, h: 50 });
    }
  }

  update(dt: number) {
    this.t += dt;
    this.fx.update(dt);
    if (this.mode === 'main') this.main.update(dt);
    else {
      if (input.pressed('back')) { this.mode = 'main'; this.sub = null; audio.sfx('menuMove'); }
      else this.sub?.update(dt);
    }
    for (const g of this.guards) {
      g.x += g.dir * g.sp * dt;
      if (g.dir > 0 && g.x > W + 150) g.x = -150;
      if (g.dir < 0 && g.x < -150) g.x = W + 150;
    }
    this.zT += dt;
    if (this.zT > 0.9) {
      this.zT = 0;
      this.fx.text(905 + Math.random() * 40, 210, 'z', '#e8d8ff', 22 + Math.random() * 16);
    }
    if (Math.random() < 0.2) this.fx.emit(Math.random() * W, H + 10, { count: 1, speed: [20, 50], angle: [-1.8, -1.3], life: [3, 6], size: [1, 3], colors: ['#e0d0ff', '#ffe9b0'], drag: 0.2, additive: true });
  }

  render(ctx: C) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#140c22'); g.addColorStop(1, '#3a2448');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // pillars
    for (let i = 0; i < 6; i++) {
      const x = i * 260 - 60;
      ctx.fillStyle = '#1e1530'; ctx.fillRect(x, 0, 70, H);
      ctx.fillStyle = '#271c3a'; ctx.fillRect(x - 14, H - 160, 98, 30);
    }
    drawDecor(ctx, { type: 'moonbeam', x: 860, y: 640, w: 600, h: 760 }, this.t);
    // king sleeping
    const kx = 860, ky = 700;
    drawThrone(ctx, kx, ky - 20, 0.5);
    drawKing(ctx, {
      x: kx, y: ky + 30, s: 0.5, t: this.t, eye: 0, mouth: 0.15 + Math.sin(this.t * 1.2) * 0.12, anger: 0, chew: 0,
      hands: [{ x: kx - 220, y: ky - 60, state: 'rest', side: -1 }, { x: kx + 220, y: ky - 60, state: 'rest', side: 1 }],
    });
    // floor
    ctx.fillStyle = '#4b3d5e'; ctx.fillRect(0, 640, W, H - 640);
    ctx.fillStyle = '#b8323a'; ctx.fillRect(0, 640, W, 14);
    ctx.fillStyle = '#f2c23a'; ctx.fillRect(0, 652, W, 4);
    // guards marching
    for (const gd of this.guards) {
      drawGuard(ctx, gd.x, 642, 1.4, { t: this.t, facing: gd.dir, state: 'walk', phase: this.t * 6, kind: 'guard' });
    }
    // hero
    drawHero(ctx, 560, 645, 2.2, { t: this.t, facing: 1, state: 'lookUp', weapon: 'sword', wind: 0.4 + Math.sin(this.t) * 0.2 });
    this.fx.draw(ctx);
    // light sweep
    glow(ctx, 860, 120, 500, '#c8d8ff', 0.15);
    ctx.drawImage(this.vignette, 0, 0, W, H);

    if (this.mode === 'main') {
      this.drawLogo(ctx);
      this.main.draw(ctx);
      text(ctx, 'Пробел / Enter — выбрать   ↑ ↓ — листать', 250, 690, { size: 15, font: 'body', color: '#c8b8d8', align: 'center', alpha: 0.7 });
      if (save.data.started) {
        const step = STORY[save.data.story];
        const where = step?.kind === 'level' ? step.title : step?.kind === 'den' ? 'Берлога Вторника' : step?.kind === 'story' ? 'Заставка' : '';
        text(ctx, `Сохранение: ${where}`, 250, 345, { size: 16, font: 'body', color: '#ffd34a', align: 'center', alpha: 0.8 });
      }
    } else {
      ctx.fillStyle = 'rgba(12,6,16,0.72)'; ctx.fillRect(0, 0, W, H);
      const title = { settings: 'Настройки', controls: 'Управление', chapters: 'Главы', confirm: 'Начать заново?', main: '' }[this.mode];
      text(ctx, title, W / 2, 120, { size: 52, color: '#ffd34a', align: 'center', stroke: 9 });
      if (this.mode === 'controls') drawControlsCard(ctx, W / 2, 160);
      if (this.mode === 'confirm') text(ctx, 'Весь прогресс, крошки и находки пропадут.', W / 2, 300, { size: 24, font: 'body', color: '#f6ecd2', align: 'center' });
      this.sub?.draw(ctx);
    }
  }

  drawLogo(ctx: C) {
    const word = (str: string, x: number, y: number, size: number, c1: string, c2: string, phase: number) => {
      ctx.font = `900 ${size}px Rubik, sans-serif`;
      const total = ctx.measureText(str).width;
      let cx = x - total / 2;
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        const w = ctx.measureText(ch).width;
        const wob = Math.sin(this.t * 2.4 + i * 0.6 + phase) * 4;
        const rot = Math.sin(this.t * 1.7 + i * 0.9 + phase) * 0.05;
        ctx.save();
        ctx.translate(cx + w / 2, y + wob);
        ctx.rotate(rot);
        const gr = ctx.createLinearGradient(0, -size * 0.8, 0, 0);
        gr.addColorStop(0, c1); gr.addColorStop(1, c2);
        ctx.font = `900 ${size}px Rubik, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * 0.22; ctx.strokeStyle = OUT; ctx.strokeText(ch, 0, 0);
        ctx.fillStyle = gr; ctx.fillText(ch, 0, 0);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.restore();
        cx += w;
      }
    };
    const a = ease.outBack(clamp(this.t / 1.2, 0, 1));
    ctx.save();
    ctx.translate(250, 120); ctx.scale(a, a); ctx.translate(-250, -120);
    // crown
    ctx.save(); ctx.translate(250, 38); ctx.rotate(Math.sin(this.t * 1.5) * 0.08);
    ctx.beginPath(); ctx.moveTo(-34, 10); ctx.lineTo(-40, -22); ctx.lineTo(-18, -6); ctx.lineTo(0, -32); ctx.lineTo(18, -6); ctx.lineTo(40, -22); ctx.lineTo(34, 10); ctx.closePath();
    ctx.fillStyle = '#f2c23a'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = OUT; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -2, 6, 0, TAU); ctx.fillStyle = '#e83a5a'; ctx.fill(); ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
    word('ГРОМАДНОЕ', 250, 140, 62, '#ffe680', '#ff8a2a', 0);
    word('КОРОЛЕВСТВО', 250, 214, 52, '#ffd0f0', '#c66ae8', 2);
    rrect(ctx, 140, 238, 220, 40, 16, '#e8383d', 4);
    text(ctx, 'Побег из ямы', 250, 266, { size: 24, font: 'body', color: '#fff', align: 'center' });
    ctx.restore();
    void srand;
  }
}

function bar(v: number) {
  const n = Math.round(v * 10);
  return '■'.repeat(n) + '□'.repeat(10 - n);
}

function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen();
    else void document.exitFullscreen();
  } catch { /* ignore */ }
}
