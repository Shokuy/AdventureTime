import { W, H, clamp, ease } from '../../../../engine/util';
import { input } from '../../../../engine/input';
import { audio } from '../../../../engine/audio';
import { rrect, text, wrap, OUT } from '../../../../art/draw';
import type { Waiter } from '../../../../game/coroutine';
import type { Level3D } from '../../level';
import { CARD } from './lines';

/**
 * The ingredient card «Корень полуденника» (docs/script-fangs.md §10) — a compact card at the bottom like the item
 * cards of the prologue, with the root drawn on it. Solo: closes on a press (or after a while); co-op: by itself after
 * a few seconds, so the shared scene doesn't wait for the slowest reader.
 */
export function showCard(L: Level3D): Waiter {
  let t = 0, closing = -1;
  const draw = (ctx: CanvasRenderingContext2D) => {
    const k = closing >= 0 ? clamp(1 - closing * 4, 0, 1) : 1;
    const a = ease.outBack(clamp(t * 3, 0, 1)) * k;
    if (a <= 0.01) return;
    ctx.save();
    const g = ctx.createLinearGradient(0, H - 280, 0, H);
    g.addColorStop(0, 'rgba(10,4,8,0)'); g.addColorStop(1, `rgba(10,4,8,${0.55 * clamp(t * 3, 0, 1) * k})`);
    ctx.fillStyle = g; ctx.fillRect(-2000, H - 280, W + 4000, 2280);
    ctx.translate(W / 2, H - 122);
    ctx.scale(a, a);
    const w = 760, h = 180;
    rrect(ctx, -w / 2 + 6, -h / 2 + 8, w, h, 26, 'rgba(0,0,0,0.3)', 0);
    rrect(ctx, -w / 2, -h / 2, w, h, 26, '#fff7e6', 5);
    rrect(ctx, -w / 2 + 22, -h / 2 - 22, 300, 44, 18, '#ffd34a', 4);
    text(ctx, 'ИНГРЕДИЕНТ 2 ИЗ 3', -w / 2 + 172, -h / 2 + 8, { size: 22, color: OUT, align: 'center' });
    // the root: a warm glow, a knobbly golden root with a sprout
    const ix = -w / 2 + 96, iy = 10 + Math.sin(t * 3) * 3;
    const gl = ctx.createRadialGradient(ix, iy, 0, ix, iy, 70);
    gl.addColorStop(0, 'rgba(255,230,140,0.9)'); gl.addColorStop(1, 'rgba(255,200,80,0)');
    ctx.fillStyle = gl; ctx.fillRect(ix - 70, iy - 70, 140, 140);
    drawRoot(ctx, ix, iy, 1, t);
    text(ctx, CARD.title, -w / 2 + 190, -26, { size: 34, color: '#b0453a' });
    ctx.font = '400 21px Pangolin, sans-serif';
    const lines = wrap(ctx, CARD.desc, w - 220);
    lines.forEach((l, i) => text(ctx, l, -w / 2 + 192, 12 + i * 26, { size: 21, font: 'body', color: OUT }));
    if (!L.nl && t > 0.8) text(ctx, 'Пробел / Enter', w / 2 - 22, h / 2 - 16, { size: 15, color: '#8a6a4a', align: 'right', alpha: 0.6 + Math.sin(t * 5) * 0.3 });
    ctx.restore();
  };
  L.overlayDraw.push(draw);
  L.refs.f3card = (L.refs.f3card as number | undefined ?? 0) + 1;
  audio.sfx('artifact');
  return {
    update: (dt) => {
      t += dt;
      if (closing < 0) {
        const press = t > 0.8 && (input.pressed('confirm') || input.pressed('jump') || input.pressed('attack') || input.mouseClicked);
        if ((L.nl ? t > 3.8 : press || t > 9)) { closing = 0; if (press) audio.sfx('menuSelect'); }
        return false;
      }
      closing += dt;
      if (closing > 0.3) { const i = L.overlayDraw.indexOf(draw); if (i >= 0) L.overlayDraw.splice(i, 1); return true; }
      return false;
    },
  };
}

/** the root of the noon flower (also on the card) */
export function drawRoot(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s); ctx.rotate(-0.25);
  ctx.lineJoin = 'round';
  // little hair roots
  ctx.strokeStyle = '#a8742a'; ctx.lineWidth = 2.5;
  for (const [a, b, c, d] of [[-10, 30, -22, 46], [6, 32, 14, 50], [-2, 36, -4, 54], [12, 20, 30, 30], [-14, 18, -32, 24]]) { ctx.beginPath(); ctx.moveTo(a, b); ctx.quadraticCurveTo((a + c) / 2 + 4, (b + d) / 2, c, d); ctx.stroke(); }
  // the root body: a knobbly golden carrot
  ctx.fillStyle = '#ffc94a'; ctx.strokeStyle = OUT; ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-18, -20); ctx.quadraticCurveTo(-26, 4, -10, 22); ctx.quadraticCurveTo(-2, 40, 4, 30); ctx.quadraticCurveTo(22, 6, 18, -20); ctx.quadraticCurveTo(0, -30, -18, -20);
  ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(160,100,30,0.7)'; ctx.lineWidth = 2.5;
  for (const yy of [-6, 6, 16]) { ctx.beginPath(); ctx.moveTo(-14 + yy * 0.2, yy); ctx.lineTo(-4 + yy * 0.2, yy + 2); ctx.stroke(); }
  // a sunny sprout with a tiny sun bud
  ctx.strokeStyle = '#3a8a4a'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, -24); ctx.quadraticCurveTo(-4, -40, 4, -50); ctx.stroke();
  ctx.fillStyle = '#5ab85a';
  for (const s2 of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s2 * 10, -36, 9, 4, s2 * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = OUT; ctx.stroke(); }
  ctx.fillStyle = '#fff2a0';
  ctx.beginPath(); ctx.arc(4, -54, 7, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = OUT; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,220,90,0.9)'; ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + t; ctx.beginPath(); ctx.moveTo(4 + Math.cos(a) * 10, -54 + Math.sin(a) * 10); ctx.lineTo(4 + Math.cos(a) * 14, -54 + Math.sin(a) * 14); ctx.stroke(); }
  ctx.restore();
}
