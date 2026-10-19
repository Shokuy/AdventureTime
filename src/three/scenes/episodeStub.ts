import { W, H, TAU, clamp, ease } from '../../engine/util';
import { input } from '../../engine/input';
import { audio } from '../../engine/audio';
import { text, rrect, wrap, OUT } from '../../art/draw';
import { drawHint } from '../../ui/glyphs';
import { game } from '../../game/game';
import { net } from '../../net/session';
import { coop } from '../game/coop';
import { coopFlow, stepDone } from '../game/coopFlow';
import { EPISODES, EPISODE_SCENES, partName, type Episode } from '../game/episodes';

/*
 * «Серия в разработке»: what an episode step plays while its level / scene isn't built yet. A clearly marked
 * placeholder card (series, title, what's planned), so the whole map → episode → map flow already works.
 * Enter / ✕ = done (the episode counts as played once all its steps are). Co-op: clients press «Готов», the host
 * moves the room on (asks once more when not everyone is ready).
 */

type C = CanvasRenderingContext2D;

/** what an episode scene step plays: a registered scene (EPISODE_SCENES) or this card */
export function episodeScene(ep: string, id: string) {
  const f = EPISODE_SCENES[id];
  return f ? f() : new EpisodeStub(ep, id);
}

export class EpisodeStub {
  t = 0;
  private ep: Episode;
  private part: string;
  private done = false;
  private confirmT = 0;
  private note: { text: string; t: number } | null = null;
  constructor(epId: string, public id: string) {
    this.ep = EPISODES[epId] ?? EPISODES.prologue;
    const i = this.ep.levels.findIndex((l) => l === id || l === 'scene:' + id);
    this.part = i >= 0 ? partName(this.ep, i) : '';
    if (coop.active) net.setMeta({ ready: false, scene: 'scene' });
    audio.playMusic('den');
  }

  update(dt: number) {
    this.t += dt;
    this.confirmT = Math.max(0, this.confirmT - dt);
    if (this.note) { this.note.t += dt; if (this.note.t > 3) this.note = null; }
    const n = coopFlow.takeNotice();
    if (n) this.note = { text: n, t: 0 };
    input.menuTick();
    if (this.t < 0.6) return;
    if (input.pressed('confirm') || input.pressed('attack') || input.mouseClicked) this.next();
    if (input.pressed('back') && !coop.active && !this.done) { this.done = true; game.toMap(); }
  }

  private next() {
    if (coop.active) {
      if (!net.isHost) { net.setMeta({ ready: !net.me?.ready }); audio.sfx('checkpoint', { volume: 0.6 }); return; }
      const [r, n] = coopFlow.othersReady();
      if (n && r < n && this.confirmT <= 0) { this.confirmT = 4; this.note = { text: 'Не все готовы — нажми ещё раз', t: 0 }; audio.sfx('denied'); return; }
    }
    if (this.done) return;
    this.done = true;
    audio.sfx('menuSelect');
    stepDone();
  }

  render(ctx: C) {
    const ep = this.ep;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    const night = ep.arc ? ['#1a1236', '#4a1e3e'] : ['#2a4a6a', '#6a8aa0'];
    g.addColorStop(0, night[0]); g.addColorStop(1, night[1]);
    ctx.fillStyle = g; ctx.fillRect(-2000, -2000, W + 4000, H + 4000);
    // a big moon for the vampire arc, stars
    if (ep.arc) {
      ctx.save(); ctx.globalAlpha = 0.9;
      const mg = ctx.createRadialGradient(1040, 150, 20, 1040, 150, 150);
      mg.addColorStop(0, 'rgba(255,120,130,0.5)'); mg.addColorStop(1, 'rgba(255,80,110,0)');
      ctx.fillStyle = mg; ctx.fillRect(880, 0, 320, 320);
      ctx.beginPath(); ctx.arc(1040, 150, 70, 0, TAU); ctx.fillStyle = '#f8e6cc'; ctx.fill();
      ctx.restore();
    }
    for (let i = 0; i < 60; i++) {
      const x = (i * 211) % W, y = (i * 97) % 300;
      ctx.globalAlpha = 0.3 + 0.3 * Math.sin(this.t * 2 + i);
      ctx.fillStyle = '#fff8e8'; ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;
    // the card
    const a = ease.outBack(clamp(this.t / 0.5, 0, 1));
    ctx.save();
    ctx.translate(W / 2, H / 2 - 10); ctx.scale(a, a); ctx.translate(-W / 2, -(H / 2 - 10));
    const cw = 640, ch = 470, x0 = W / 2 - cw / 2, y0 = 110;
    rrect(ctx, x0 + 8, y0 + 10, cw, ch, 26, 'rgba(0,0,0,0.35)', 0);
    rrect(ctx, x0, y0, cw, ch, 26, '#fff6e4', 4);
    // hazard tape: clearly a placeholder
    ctx.save();
    ctx.beginPath(); ctx.rect(x0 + 4, y0 + 4, cw - 8, 40); ctx.clip();
    for (let i = -2; i < 24; i++) {
      ctx.beginPath();
      const sx = x0 + i * 34 + (this.t * 20) % 34;
      ctx.moveTo(sx, y0 + 44); ctx.lineTo(sx + 17, y0 + 44); ctx.lineTo(sx + 37, y0 + 4); ctx.lineTo(sx + 20, y0 + 4); ctx.closePath();
      ctx.fillStyle = i % 2 ? '#2a1b1a' : '#ffc832'; ctx.fill();
    }
    ctx.restore();
    rrect(ctx, W / 2 - 170, y0 + 8, 340, 32, 12, '#ffc832', 3);
    text(ctx, 'СЕРИЯ В РАЗРАБОТКЕ', W / 2, y0 + 32, { size: 20, color: OUT, align: 'center' });
    const tag = ep.hub ? 'Город' : ep.n ? `Серия ${ep.n}` + (ep.arc ? ` · арка «${ep.arc}»` : '') : '';
    text(ctx, tag, W / 2, y0 + 86, { size: 20, font: 'body', color: '#7a5a4a', align: 'center' });
    text(ctx, ep.title, W / 2, y0 + 136, { size: 46, color: '#e8383d', align: 'center', stroke: 0 });
    text(ctx, [ep.subtitle, this.part].filter(Boolean).join(' · '), W / 2, y0 + 172, { size: 20, font: 'body', color: '#7a5a4a', align: 'center' });
    ctx.font = '400 21px Pangolin, sans-serif';
    const lines = wrap(ctx, ep.teaser ?? '', cw - 90).slice(0, 4);
    lines.forEach((l, i) => text(ctx, l, W / 2, y0 + 222 + i * 30, { size: 21, font: 'body', color: OUT, align: 'center' }));
    const what = ep.hub
      ? 'Скоро здесь: прогулка по городу, лавка, Зеркало героев и лаборатория Пастилы.'
      : `Здесь будет уровень «${this.id}». Пока можно засчитать серию и идти дальше по карте.`;
    ctx.font = '400 18px Pangolin, sans-serif';
    wrap(ctx, what, cw - 90).slice(0, 2).forEach((l, i) => text(ctx, l, W / 2, y0 + 352 + i * 26, { size: 18, font: 'body', color: '#a0704a', align: 'center' }));
    // the button / co-op state
    const mp = coop.active;
    let label = ep.hub ? 'Вернуться на карту' : 'Засчитать и дальше';
    if (mp && !net.isHost) label = net.me?.ready ? '✓ Готов (отменить)' : 'Я готов!';
    else if (mp) { const [r, n] = coopFlow.othersReady(); if (n) label += ` (готовы ${r} из ${n})`; }
    const pulse = 1 + Math.sin(this.t * 4) * 0.03;
    ctx.save(); ctx.translate(W / 2, y0 + ch - 44); ctx.scale(pulse, pulse);
    rrect(ctx, -200, -24, 400, 48, 16, '#ffd34a', 3.5);
    text(ctx, label, 0, 1, { size: 21, color: OUT, align: 'center', base: 'middle' });
    ctx.restore();
    ctx.restore();
    drawHint(ctx, 'confirm', mp && !net.isHost ? 'готов' : 'дальше', W / 2 - 150, H - 40, { size: 26 });
    if (!mp) drawHint(ctx, 'back', 'на карту', W / 2 + 40, H - 40, { size: 26 });
    if (mp && !net.isHost) text(ctx, 'Дальше поведёт хозяин комнаты', W / 2 + 120, H - 34, { size: 18, font: 'body', color: '#fff3d8', stroke: 4 });
    if (this.note) {
      const al = clamp(Math.min(this.note.t * 5, (3 - this.note.t) * 2), 0, 1);
      ctx.save(); ctx.globalAlpha = al;
      ctx.font = '400 20px Pangolin, sans-serif';
      const w = ctx.measureText(this.note.text).width + 40;
      rrect(ctx, W / 2 - w / 2, 40, w, 42, 14, 'rgba(26,14,30,0.85)', 3);
      text(ctx, this.note.text, W / 2, 68, { size: 20, font: 'body', color: '#ffe680', align: 'center' });
      ctx.restore();
    }
  }
}
