import { W, H, clamp, ease } from '../../../../engine/util';
import { input } from '../../../../engine/input';
import { audio } from '../../../../engine/audio';
import { save } from '../../../../engine/save';
import { rrect, text, wrap, OUT } from '../../../../art/draw';
import type { Script } from '../../../../game/coroutine';
import type { Level3D } from '../../level';

/**
 * «card:» of the script (§10): the ingredient card at the bottom of the screen — the scene stays visible above it
 * (like the prologue's compact item card). Solo: it waits for a press. Co-op: it closes by itself after a few seconds
 * so the shared scene never waits for the slowest reader.
 */
export function* ingredientCard(L: Level3D, title: string, desc: string, saveId?: string): Script {
  if (saveId) { save.collect(saveId); save.write(); }
  let t = 0, closed = false;
  const draw = (ctx: CanvasRenderingContext2D) => drawCard(ctx, title, desc, t, !L.nl);
  L.overlayDraw.push(draw);
  audio.sfx('artifact');
  try {
    yield {
      update: (dt: number) => {
        t += dt;
        if (L.nl) return t > 4.6;
        if (t > 0.8 && (input.pressed('confirm') || input.pressed('jump') || input.pressed('attack') || input.mouseClicked)) closed = true;
        return closed || t > 30;
      },
    };
    audio.sfx('menuSelect');
  } finally {
    const i = L.overlayDraw.indexOf(draw);
    if (i >= 0) L.overlayDraw.splice(i, 1);
  }
}

function drawCard(ctx: CanvasRenderingContext2D, title: string, desc: string, t: number, press: boolean) {
  const a = ease.outBack(clamp(t * 3, 0, 1));
  ctx.save();
  const g = ctx.createLinearGradient(0, H - 280, 0, H);
  g.addColorStop(0, 'rgba(10,4,8,0)'); g.addColorStop(1, `rgba(10,4,8,${0.6 * clamp(t * 3, 0, 1)})`);
  ctx.fillStyle = g; ctx.fillRect(-2000, H - 280, W + 4000, 2280);
  ctx.translate(W / 2, H - 128);
  ctx.scale(a, a);
  const w = 760, h = 180;
  rrect(ctx, -w / 2 + 6, -h / 2 + 8, w, h, 26, 'rgba(0,0,0,0.3)', 0);
  rrect(ctx, -w / 2, -h / 2, w, h, 26, '#fff7e6', 5);
  rrect(ctx, -w / 2 + 22, -h / 2 - 22, 300, 44, 18, '#ffd34a', 4);
  text(ctx, 'НОВЫЙ ИНГРЕДИЕНТ!', -w / 2 + 172, -h / 2 + 8, { size: 23, color: OUT, align: 'center' });
  // the icon: a little flask with a glowing drop
  const ix = -w / 2 + 96, iy = 10 + Math.sin(t * 3) * 3;
  const glow = ctx.createRadialGradient(ix, iy, 4, ix, iy, 74);
  glow.addColorStop(0, `rgba(255,236,120,${0.85 + 0.15 * Math.sin(t * 5)})`); glow.addColorStop(1, 'rgba(255,220,90,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(ix, iy, 74, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = OUT;
  ctx.fillStyle = 'rgba(220,240,255,0.55)';
  ctx.beginPath(); ctx.moveTo(ix - 9, iy - 46); ctx.lineTo(ix - 9, iy - 18); ctx.arc(ix, iy + 10, 32, -Math.PI / 2 - 0.3, Math.PI * 1.5 + 0.3, false); ctx.lineTo(ix + 9, iy - 46); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#c8905a'; ctx.fillRect(ix - 12, iy - 56, 24, 12); ctx.strokeRect(ix - 12, iy - 56, 24, 12);
  // the tear
  ctx.fillStyle = '#fff070';
  ctx.beginPath(); ctx.moveTo(ix, iy - 8); ctx.quadraticCurveTo(ix + 15, iy + 14, ix, iy + 24); ctx.quadraticCurveTo(ix - 15, iy + 14, ix, iy - 8); ctx.fill();
  ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(ix - 4, iy + 12, 3.5, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 5; i++) { const an = t * 1.6 + i * 1.26; ctx.fillStyle = 'rgba(255,250,200,0.9)'; ctx.beginPath(); ctx.arc(ix + Math.cos(an) * 46, iy + Math.sin(an) * 38, 2.5, 0, Math.PI * 2); ctx.fill(); }
  text(ctx, title, -w / 2 + 190, -26, { size: 34, color: '#b0453a' });
  ctx.font = '400 21px Pangolin, sans-serif';
  const lines = wrap(ctx, desc, w - 220);
  lines.forEach((l, i) => text(ctx, l, -w / 2 + 192, 12 + i * 26, { size: 21, font: 'body', color: OUT }));
  if (press && t > 0.8) text(ctx, 'Пробел / Enter', w / 2 - 22, h / 2 - 16, { size: 15, color: '#8a6a4a', align: 'right', alpha: 0.6 + Math.sin(t * 5) * 0.3 });
  ctx.restore();
}
