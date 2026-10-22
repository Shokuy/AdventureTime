import { W, clamp, ease } from '../../../../engine/util';
import { rrect, text, wrap, OUT } from '../../../../art/draw';
import type { Waiter } from '../../../../game/coroutine';
import type { Level3D } from '../../level';

/*
 * `card:` of the script (docs/script-fangs-v2.md §0, §10): a story item card at the top of the screen — «Приглашение»
 * (4.4а), «Карманная карта» (4.4б), «Меню Алой полночи» (5.8), «Страница из дневника» (7.5)…
 *
 *   showCard(L, 'Приглашение', 'Чёрная карточка с серебряным полумесяцем. Блюдо — вы.', { icon: 'invite' });
 *   yield showCard(L, 'Карманная карта', '…', { icon: 'map', secs: 4 });   // a Waiter: until it's gone
 *
 * Local (drawn on every machine that runs the scene). One card at a time per level: a new one replaces the old.
 */

export type CardIcon = 'invite' | 'map' | 'page' | 'menu' | 'letter' | 'jar';
interface CardState { t: number; dur: number; title: string; body: string; icon: CardIcon }
const cards = new WeakMap<Level3D, CardState>();

function icon(ctx: CanvasRenderingContext2D, k: CardIcon, x: number, y: number) {
  ctx.save(); ctx.translate(x, y); ctx.lineWidth = 4; ctx.strokeStyle = OUT; ctx.lineJoin = 'round';
  if (k === 'invite' || k === 'menu') {
    rrect(ctx, -40, -34, 80, 62, 8, '#1e1626', 4);
    ctx.strokeStyle = '#c8c8e0'; ctx.lineWidth = 2; ctx.strokeRect(-33, -27, 66, 48);
    ctx.fillStyle = '#e8e8f8'; ctx.beginPath(); ctx.arc(0, -5, 13, Math.PI * 0.6, Math.PI * 1.9); ctx.arc(5, -8, 10, Math.PI * 1.9, Math.PI * 0.6, true); ctx.fill();
    if (k === 'menu') { ctx.fillStyle = '#c8c8e0'; for (let i = 0; i < 3; i++) ctx.fillRect(-22, 10 + i * 0, 44, 2); }
  } else if (k === 'map') {
    ctx.fillStyle = '#ffe8c0'; ctx.beginPath(); ctx.moveTo(-40, -28); ctx.lineTo(-14, -34); ctx.lineTo(14, -28); ctx.lineTo(40, -34); ctx.lineTo(40, 28); ctx.lineTo(14, 34); ctx.lineTo(-14, 28); ctx.lineTo(-40, 34); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8ad0ff'; ctx.beginPath(); ctx.arc(-14, 2, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff3a4a'; ctx.beginPath(); ctx.moveTo(16, 10); ctx.lineTo(16, -12); ctx.lineTo(28, -6); ctx.lineTo(16, 0); ctx.fill();
  } else if (k === 'page') {
    ctx.rotate(-0.08); rrect(ctx, -32, -38, 64, 76, 4, '#fff6e2', 4);
    ctx.strokeStyle = '#6a3a1a'; ctx.lineWidth = 2; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(-22, -22 + i * 11); ctx.lineTo(22 - (i % 2) * 10, -22 + i * 11); ctx.stroke(); }
  } else if (k === 'letter') {
    rrect(ctx, -42, -30, 84, 60, 6, '#ffe45a', 4);
    ctx.beginPath(); ctx.moveTo(-42, -30); ctx.lineTo(0, 4); ctx.lineTo(42, -30); ctx.stroke();
  } else {
    rrect(ctx, -24, -30, 48, 62, 12, '#e8f8ff', 4);
    ctx.fillStyle = '#ffd34a'; ctx.beginPath(); ctx.arc(0, 8, 18, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function install(L: Level3D) {
  if (cards.has(L)) return;
  cards.set(L, { t: -1, dur: 0, title: '', body: '', icon: 'invite' });
  L.updaters.push((_t, dt) => { const c = cards.get(L)!; if (c.t >= 0) { c.t += dt; if (c.t > c.dur) c.t = -1; } });
  L.overlayDraw.push((ctx) => {
    const c = cards.get(L)!;
    if (c.t < 0) return;
    const a = clamp(Math.min(c.t * 4, (c.dur - c.t) * 3), 0, 1);
    const s = ease.outBack(clamp(c.t * 3, 0, 1));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(W / 2, 170); ctx.scale(s, s);
    const dark = c.icon === 'invite' || c.icon === 'menu';
    rrect(ctx, -300, -74, 600, 148, 20, dark ? '#2a2236' : '#fff8d0', 5);
    icon(ctx, c.icon, -236, 0);
    ctx.font = '400 20px Pangolin, "Comic Sans MS", sans-serif';
    const lines = wrap(ctx, c.body, 410).slice(0, 3);
    const y0 = lines.length > 1 ? -28 : -16;
    text(ctx, c.title, -170, y0, { size: 30, color: dark ? '#e8e8ff' : '#a87a10', stroke: 5 });
    lines.forEach((l, i) => text(ctx, l, -170, y0 + 36 + i * 25, { size: 20, font: 'body', color: dark ? '#d8d0ec' : OUT }));
    ctx.restore();
  });
}

/** show a story card (see the header); the returned Waiter ends when the card is gone */
export function showCard(L: Level3D, title: string, body: string, o: { icon?: CardIcon; secs?: number } = {}): Waiter {
  install(L);
  const c = cards.get(L)!;
  Object.assign(c, { t: 0, dur: o.secs ?? 4, title, body, icon: o.icon ?? 'invite' });
  return { update: () => c.t < 0 || c.title !== title };
}
