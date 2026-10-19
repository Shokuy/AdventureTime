import { W, H, clamp, ease } from '../../../../engine/util';
import { rrect, text, wrap, OUT } from '../../../../art/draw';
import { Dialog } from '../../../../ui/dialog';
import type { Waiter } from '../../../../game/coroutine';
import type { Level3D } from '../../level';
import { say as townSay, type SpeakerId } from '../town/speech';

/**
 * Lines of docs/script-fangs.md §8 in this level's dialog box. The cast and the narrator speak through the hub's
 * speech helper (arc/town/speech.ts); the twins Ночка / Тенька get their own box and portrait here. While a line is
 * typed, the matching story-cast figure (L.npc) moves its mouth; `onTalk` lets the boss rigs talk too.
 */
export type F4Speaker = SpeakerId | 'nochka' | 'tenka';

const SIS: Record<'nochka' | 'tenka', { name: string; color: string; bg: string; dress: string; hair: string; eye: string }> = {
  nochka: { name: 'Ночка', color: '#4a2a8a', bg: '#e2dcf2', dress: '#221a30', hair: '#141019', eye: '#9a7aff' },
  tenka: { name: 'Тенька', color: '#b04ab0', bg: '#f8e4fa', dress: '#a678d8', hair: '#efe6ff', eye: '#ff8ae6' },
};

const mine = new WeakMap<Dialog, 'nochka' | 'tenka' | null>();
const hooked = new WeakSet<Dialog>();
/** boss rigs that talk (set by twins.ts) */
export const talkers = new WeakMap<Level3D, (who: 'nochka' | 'tenka') => void>();

function hook(L: Level3D) {
  const d = L.dialog;
  if (hooked.has(d)) return;
  hooked.add(d);
  const orig = d.draw.bind(d);
  d.draw = (ctx: CanvasRenderingContext2D) => {
    const s = mine.get(d);
    if (s && d.who === 'narrator') drawBox(d, ctx, s); else orig(ctx);
  };
}

const CAST: Partial<Record<F4Speaker, string>> = { tosha: 'tosha', bublik: 'bublik', noki: 'noki', pastila: 'pastila' };

/** a line of the script (a Waiter, like L.say) */
export function say(L: Level3D, who: F4Speaker, str: string, expr?: string): Waiter {
  hook(L);
  const d = L.dialog;
  let w: Waiter;
  if (who === 'nochka' || who === 'tenka') {
    // (the hub helper's own speaker must not draw over ours: hand it a plain narrator line first)
    w = townSay(L, 'narrator', str, expr);
    mine.set(d, who);
  } else {
    mine.set(d, null);
    w = townSay(L, who as SpeakerId, str, expr);
  }
  const cast = CAST[who];
  return {
    update: (dt) => {
      const typing = d.active && d.shown < d.str.length;
      if (typing) {
        if (cast) { const n = L.npcs[cast]; if (n) n.talk = 0.35; }
        if (who === 'nochka' || who === 'tenka') talkers.get(L)?.(who);
      }
      return w.update(dt);
    },
  };
}

function drawBox(d: Dialog, ctx: CanvasRenderingContext2D, id: 'nochka' | 'tenka') {
  if (d.appear <= 0) return;
  const sp = SIS[id];
  const a = ease.outBack(clamp(d.appear, 0, 1));
  const bw = 1060, bh = Dialog.BOX_H;
  const bx = (W - bw) / 2, by = d.top ? 30 - (1 - a) * 80 : H - bh - 26 + (1 - a) * 80;
  ctx.save();
  ctx.globalAlpha = clamp(d.appear * 1.5, 0, 1);
  rrect(ctx, bx + 6, by + 8, bw, bh, 22, 'rgba(0,0,0,0.4)', 0);
  rrect(ctx, bx, by, bw, bh, 22, '#fff7e6', 5);
  face(ctx, id, bx + 86, by + bh / 2 - 6, 62, d.t, d.shown < d.str.length ? Math.abs(Math.sin(d.t * 16)) : 0, d.expr);
  ctx.font = '900 20px Rubik, sans-serif';
  const nw = ctx.measureText(sp.name).width + 30;
  rrect(ctx, bx + 160, by - 18, nw, 34, 12, sp.color, 4);
  text(ctx, sp.name, bx + 175, by + 6, { size: 20, color: '#fff', stroke: 0 });
  const tx = bx + 170, maxW = bw - 170 - 40;
  ctx.font = '400 27px Pangolin, "Comic Sans MS", sans-serif';
  const lines = wrap(ctx, d.str, maxW);
  let remaining = Math.floor(d.shown);
  lines.forEach((ln, i) => {
    const part = ln.slice(0, Math.max(0, remaining));
    remaining -= ln.length + 1;
    text(ctx, part, tx, by + 50 + i * 34, { size: 27, font: 'body', color: OUT });
  });
  if (d.shown >= d.str.length && d.active) text(ctx, '▼', bx + bw - 36, by + bh - 20 + Math.sin(d.t * 6) * 4, { size: 22, color: sp.color, align: 'center' });
  ctx.restore();
}

/** round portrait of a sister: pale face, her hair, glowing eyes, fangs */
function face(ctx: CanvasRenderingContext2D, id: 'nochka' | 'tenka', cx: number, cy: number, r: number, t: number, talk: number, expr?: string) {
  const s = SIS[id];
  const k = r / 50;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = s.bg; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.lineWidth = 3 * k; ctx.strokeStyle = OUT;
  // dress + collar
  ctx.fillStyle = s.dress; ctx.beginPath(); ctx.ellipse(cx, cy + 58 * k, 38 * k, 26 * k, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  const hy = cy + 6 * k;
  // hair behind (Тенька: pigtails, Ночка: a bun)
  ctx.fillStyle = s.hair;
  if (id === 'tenka') for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + sx * 34 * k, hy + 14 * k, 9 * k, 22 * k, sx * 0.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  else { ctx.beginPath(); ctx.arc(cx, hy - 34 * k, 14 * k, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  // head
  ctx.fillStyle = '#ddd0ee'; ctx.beginPath(); ctx.ellipse(cx, hy, 29 * k, 30 * k, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // pointy ears
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + sx * 26 * k, hy - 4 * k); ctx.lineTo(cx + sx * 42 * k, hy - 14 * k); ctx.lineTo(cx + sx * 27 * k, hy + 8 * k); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  // bangs
  ctx.fillStyle = s.hair; ctx.beginPath(); ctx.ellipse(cx, hy - 16 * k, 31 * k, 18 * k, 0, Math.PI, Math.PI * 2); ctx.fill(); ctx.stroke();
  // eyes (scared: round; sly: half-closed)
  const look = id === 'nochka' ? -3 : 3;
  for (const sx of [-1, 1]) {
    const ex = cx + sx * 11 * k, ey = hy + 2 * k;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(ex, ey, 7 * k, expr === 'sly' ? 3.5 * k : 8 * k, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = s.eye; ctx.beginPath(); ctx.arc(ex + look * k, ey, (expr === 'scared' ? 2.5 : 3.5) * k, 0, Math.PI * 2); ctx.fill();
  }
  // mouth + fangs
  const mo = 2 + talk * 6;
  ctx.fillStyle = '#4a0f1c'; ctx.beginPath(); ctx.ellipse(cx, hy + 16 * k, 6 * k, mo * k * 0.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + sx * 4 * k, hy + 14 * k); ctx.lineTo(cx + sx * 2 * k, hy + 20 * k); ctx.lineTo(cx + sx * 6 * k, hy + 14 * k); ctx.fill(); }
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = OUT; ctx.stroke();
  void t;
  ctx.restore();
}
