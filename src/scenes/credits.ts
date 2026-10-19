import { W, H, clamp } from '../engine/util';
import { input } from '../engine/input';
import { audio } from '../engine/audio';
import { save } from '../engine/save';
import { Particles } from '../engine/particles';
import { drawHero, drawDog, drawBear, drawGuard } from '../art/characters';
import { text } from '../art/draw';
import { vignetteCanvas } from '../art/props';
import { game } from '../game/game';

type C = CanvasRenderingContext2D;

/** the prologue's chapters (the medal count in the stats) */
const PROLOGUE = ['pantry', 'feast', 'library', 'chase', 'throne'];

export class CreditsScene {
  t = 0;
  scroll = 0;
  fx = new Particles();
  vignette = vignetteCanvas(W, H, 0.6);
  lines: { text: string; size: number; color: string; font?: 'body' }[];
  leaving = false;

  constructor() {
    audio.playMusic('credits');
    const d = save.data;
    const mins = Math.floor(d.playTime / 60), secs = Math.floor(d.playTime % 60);
    this.lines = [
      { text: 'ГРОМАДНОЕ КОРОЛЕВСТВО', size: 56, color: '#ffd34a' },
      { text: 'Серия 1. Побег из ямы', size: 28, color: '#f6ecd2', font: 'body' },
      { text: '', size: 30, color: '#fff' },
      { text: 'В ролях', size: 30, color: '#ff8a2a' },
      { text: 'Тоша — храбрый маленький путешественник', size: 24, color: '#fff', font: 'body' },
      { text: 'Бублик — такса, которая умеет тянуться', size: 24, color: '#fff', font: 'body' },
      { text: 'Медведь Вторник — свалился во вторник, так и зовётся', size: 24, color: '#fff', font: 'body' },
      { text: 'Король Громадин — последний великан: очень большой и очень одинокий', size: 24, color: '#fff', font: 'body' },
      { text: 'Арбузята — стража, плевуны и официанты', size: 24, color: '#fff', font: 'body' },
      { text: '', size: 30, color: '#fff' },
      { text: 'Автор', size: 30, color: '#ff8a2a' },
      { text: 'Imran Shokuev', size: 28, color: '#fff', font: 'body' },
      { text: '', size: 30, color: '#fff' },
      { text: 'Твоя статистика', size: 30, color: '#ff8a2a' },
      { text: `Время в игре: ${mins} мин ${secs} сек`, size: 24, color: '#fff', font: 'body' },
      { text: `Падений: ${d.deaths}`, size: 24, color: '#fff', font: 'body' },
      { text: `Крошек в кармане: ${d.crumbs}`, size: 24, color: '#fff', font: 'body' },
      { text: `Золотых орешков найдено: ${d.collected.filter((c) => c.startsWith('nut_')).length} из 11`, size: 24, color: '#ffe680', font: 'body' },
      { text: `Золотых медалей: ${PROLOGUE.filter((id) => (d.medals[id] ?? 0) >= 3).length} из ${PROLOGUE.length}`, size: 24, color: '#fff', font: 'body' },
      { text: `Сердечек: ${d.maxHp}`, size: 24, color: '#fff', font: 'body' },
      { text: '', size: 30, color: '#fff' },
      { text: 'Конец первой серии', size: 44, color: '#ffd34a' },
      { text: 'А над Хрумляндией всё краснее луна…', size: 26, color: '#ff8a8a', font: 'body' },
      { text: 'Продолжение — на карте Хрумляндии', size: 26, color: '#f6ecd2', font: 'body' },
      { text: '', size: 30, color: '#fff' },
      { text: 'Спасибо, что играете!', size: 36, color: '#ffd34a' },
    ];
  }

  update(dt: number) {
    this.t += dt;
    this.fx.update(dt);
    const fast = input.down('confirm') || input.down('jump') || input.down('attack');
    this.scroll += dt * (fast ? 260 : 55);
    if (Math.random() < 0.4) this.fx.emit(Math.random() * W, -10, { count: 1, speed: [30, 90], angle: [1.3, 1.8], life: [5, 8], size: [3, 6], colors: ['#ffd34a', '#ff8a2a', '#e83a6a', '#7ad8ff', '#9cf25a'], g: 30, shape: 'square', vr: 4, drag: 0.3 });
    const total = this.lines.length * 64 + H;
    if (!this.leaving && (this.scroll > total || input.pressed('back'))) {
      this.leaving = true;
      // the prologue is done: on to the world map of Хрумляндия
      game.endPrologue();
    }
  }

  render(ctx: C) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1a1240'); g.addColorStop(1, '#5a2a5a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    this.fx.draw(ctx);
    let y = H + 40 - this.scroll;
    for (const l of this.lines) {
      if (y > -60 && y < H + 60) {
        const a = clamp(Math.min(y / 120, (H - y) / 120), 0, 1);
        text(ctx, l.text, W / 2, y, { size: l.size, color: l.color, align: 'center', font: l.font, stroke: l.font ? 4 : 7, alpha: a });
      }
      y += l.size > 40 ? 80 : 56;
    }
    // parade at the bottom
    ctx.fillStyle = '#2a1a30'; ctx.fillRect(0, H - 70, W, 70);
    const px = ((this.t * 90) % (W + 600)) - 300;
    drawGuard(ctx, px - 220, H - 70, 1.2, { t: this.t, facing: 1, state: 'walk', phase: this.t * 8, kind: 'feeder', carry: true });
    drawBear(ctx, px - 90, H - 70, 0.7, this.t, { stand: true, walkPhase: this.t * 6 });
    drawDog(ctx, px + 40, H - 70, 1.3, this.t, { facing: 1, state: 'walk', walk: this.t * 9, expr: 'happy' });
    drawHero(ctx, px + 150, H - 70, 1.4, { t: this.t, facing: 1, state: 'run', phase: this.t * 11, weapon: 'sword', wind: 1 });
    ctx.drawImage(this.vignette, 0, 0, W, H);
    text(ctx, 'Держи Пробел — быстрее, Esc — дальше', W - 20, 30, { size: 15, font: 'body', color: '#f6ecd2', align: 'right', alpha: 0.5 });
  }
}
