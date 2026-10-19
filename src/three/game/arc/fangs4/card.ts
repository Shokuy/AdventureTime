import { W, H, clamp, ease } from '../../../../engine/util';
import { input } from '../../../../engine/input';
import { audio } from '../../../../engine/audio';
import { rrect, text, wrap, OUT } from '../../../../art/draw';
import type { Waiter } from '../../../../game/coroutine';
import type { Level3D } from '../../level';

/**
 * «card:» of the script (§10): a story item card at the bottom of the screen — the third ingredient, the Солнечный
 * сироп. Solo: closes on a press (after a moment) or by itself after a while; co-op: by itself after ~3.5 s, so the
 * shared scene never waits for the slowest reader.
 */
type Icon = 'dust' | 'syrup';

export function storyCard(L: Level3D, card: { title: string; desc: string }, icon: Icon): Waiter {
  let t = 0, closing = -1;
  const max = L.nl ? 3.6 : 9;
  audio.sfx('artifact');
  L.tcam.shake(0.15);
  const draw = (ctx: CanvasRenderingContext2D) => {
    const k = closing >= 0 ? 1 - clamp(closing / 0.25, 0, 1) : 1;
    drawCard(ctx, card, icon, t, k);
  };
  L.overlayDraw.push(draw);
  const off = () => { const i = L.overlayDraw.indexOf(draw); if (i >= 0) L.overlayDraw.splice(i, 1); };
  return {
    update(dt) {
      t += dt;
      if (closing >= 0) { closing += dt; if (closing > 0.25) { off(); return true; } return false; }
      const press = !L.nl && t > 0.8 && (input.pressed('confirm') || input.pressed('jump') || input.pressed('attack') || input.mouseClicked);
      if (press || t > max) { closing = 0; if (press) audio.sfx('menuSelect'); }
      return false;
    },
  };
}

function drawCard(ctx: CanvasRenderingContext2D, info: { title: string; desc: string }, icon: Icon, t: number, vis: number) {
  const a = ease.outBack(clamp(t * 3, 0, 1)) * vis;
  if (a <= 0.01) return;
  ctx.save();
  const g = ctx.createLinearGradient(0, H - 260, 0, H);
  g.addColorStop(0, 'rgba(10,4,8,0)'); g.addColorStop(1, `rgba(10,4,8,${0.55 * clamp(t * 3, 0, 1) * vis})`);
  ctx.fillStyle = g; ctx.fillRect(-2000, H - 260, W + 4000, 2260);
  ctx.translate(W / 2, H - 112);
  ctx.scale(a, a);
  const w = 720, h = 170;
  rrect(ctx, -w / 2 + 6, -h / 2 + 8, w, h, 26, 'rgba(0,0,0,0.3)', 0);
  rrect(ctx, -w / 2, -h / 2, w, h, 26, '#fff7e6', 5);
  rrect(ctx, -w / 2 + 22, -h / 2 - 22, 250, 44, 18, '#ffd34a', 4);
  text(ctx, 'НОВАЯ ШТУКА!', -w / 2 + 147, -h / 2 + 8, { size: 24, color: OUT, align: 'center' });
  const ix = -w / 2 + 92, iy = 8 + Math.sin(t * 3) * 3;
  const gl = ctx.createRadialGradient(ix, iy, 0, ix, iy, 70);
  gl.addColorStop(0, 'rgba(255,233,160,0.7)'); gl.addColorStop(1, 'rgba(255,233,160,0)');
  ctx.fillStyle = gl; ctx.fillRect(ix - 70, iy - 70, 140, 140);
  if (icon === 'dust') drawVial(ctx, ix, iy, t); else drawBottle(ctx, ix, iy, t);
  text(ctx, info.title, -w / 2 + 180, -22, { size: 32, color: '#b0453a' });
  ctx.font = '400 21px Pangolin, sans-serif';
  const lines = wrap(ctx, info.desc, w - 210);
  lines.forEach((l, i) => text(ctx, l, -w / 2 + 182, 14 + i * 26, { size: 21, font: 'body', color: OUT }));
  ctx.restore();
}

/** a little glass vial of golden dust that blinks yellow */
function drawVial(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 2) * 0.08);
  ctx.lineWidth = 4; ctx.strokeStyle = OUT;
  ctx.fillStyle = '#c8a070'; rrect(ctx, -12, -46, 24, 14, 4, '#c8a070', 4);
  ctx.beginPath(); ctx.moveTo(-16, -32); ctx.lineTo(-22, 30); ctx.quadraticCurveTo(0, 46, 22, 30); ctx.lineTo(16, -32); ctx.closePath();
  ctx.fillStyle = 'rgba(220,240,255,0.85)'; ctx.fill(); ctx.stroke();
  const blink = 0.6 + 0.4 * (Math.sin(t * 5) > 0 ? 1 : 0);
  ctx.fillStyle = `rgba(255,${200 + 30 * blink},60,1)`;
  ctx.beginPath(); ctx.moveTo(-19, 4); ctx.lineTo(-21, 29); ctx.quadraticCurveTo(0, 43, 21, 29); ctx.lineTo(19, 4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff8c0';
  for (let i = 0; i < 7; i++) { const a = t * 2 + i; ctx.fillRect(Math.sin(a * 1.7) * 12 - 1.5, 12 + Math.cos(a) * 10, 3, 3); }
  ctx.restore();
}
/** a round bottle of golden syrup with a sun on the label */
function drawBottle(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 2) * 0.06);
  ctx.lineWidth = 4; ctx.strokeStyle = OUT;
  rrect(ctx, -9, -52, 18, 12, 3, '#8a4a2c', 4);
  ctx.fillStyle = '#ffc828';
  ctx.beginPath(); ctx.moveTo(-8, -40); ctx.lineTo(-8, -26); ctx.bezierCurveTo(-34, -18, -34, 38, 0, 40); ctx.bezierCurveTo(34, 38, 34, -18, 8, -26); ctx.lineTo(8, -40); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff3d0'; ctx.beginPath(); ctx.arc(0, 10, 14, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = '#ff9a1a'; ctx.beginPath(); ctx.arc(0, 10, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ff9a1a'; ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + t; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 8, 10 + Math.sin(a) * 8); ctx.lineTo(Math.cos(a) * 12, 10 + Math.sin(a) * 12); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.ellipse(-14, -4, 4, 10, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
