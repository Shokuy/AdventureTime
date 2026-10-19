import { W, H, clamp, ease } from '../../../../engine/util';
import { rrect, text, wrap, OUT } from '../../../../art/draw';
import { WHO_INFO, type Who } from '../../../../art/characters';
import { Dialog } from '../../../../ui/dialog';
import type { Waiter } from '../../../../game/coroutine';
import type { Level3D } from '../../level';
import { drawFace as townFace, SPEAKERS as TOWN, type SpeakerId } from '../town/speech';

/**
 * Speakers of «Клыки в пастиле» (docs/script-fangs.md §5). Тоша / Бублик / the bear / the narrator are the game's own
 * dialog speakers (`Who`); Пастила, Ноки and the townsfolk use the candy-town portraits (town/speech.ts); Граф Нетопырь
 * has his own portrait here. Every line goes through the level's dialog box (same timing, co-op auto-advance, the
 * scene watchdog). The box is drawn for a line only while that very line is on screen (other modules' speech hooks
 * may share the dialog box — the hub's interludes use town/speech.ts directly).
 */
export type Spk = 'tosha' | 'bublik' | 'narrator' | 'bear' | 'pastila' | 'noki' | 'zefirych' | 'marmeladka' | 'zhitel' | 'presnyak' | 'netopyr';

interface Speaker { name: string; color: string; bg: string; who?: Who }
const OWN: Record<'netopyr', Speaker> = {
  netopyr: { name: 'Граф Нетопырь', color: '#6a1a3a', bg: '#ead8ec' },
};
const spk = (id: Spk): Speaker => (id === 'netopyr' ? OWN.netopyr : TOWN[id as SpeakerId] ?? TOWN.zhitel);

/** the line on screen and who says it (per dialog box) */
const current = new WeakMap<Dialog, { id: Spk; str: string }>();
const installed = new WeakSet<Dialog>();

function install(L: Level3D) {
  const d = L.dialog;
  if (installed.has(d)) return;
  installed.add(d);
  const orig = d.draw.bind(d);
  d.draw = (ctx: CanvasRenderingContext2D) => {
    const c = current.get(d);
    if (c && d.who === 'narrator' && d.str === c.str && c.id !== 'narrator') drawBox(d, ctx, c.id); else orig(ctx);
  };
}

/** a line spoken by `id` in the level's dialog box (a Waiter, like L.say) */
export function say(L: Level3D, id: Spk, str: string, expr?: string): Waiter {
  install(L);
  const sp = spk(id);
  const known = (WHO_INFO as Record<string, unknown>)[id] ? (id as Who) : sp.who;
  current.set(L.dialog, { id, str });
  return L.say(known ?? 'narrator', str, expr);
}

/** who of mine is talking right now (mouth moving: the line is still being typed) */
export function talkingNow(L: Level3D): Spk | null {
  const d = L.dialog;
  if (!d.active || d.shown >= d.str.length) return null;
  const c = current.get(d);
  if (!c || c.str !== d.str) return null;
  return c.id;
}

// ───────────────────────── the box ─────────────────────────
function drawBox(d: Dialog, ctx: CanvasRenderingContext2D, id: Spk) {
  if (d.appear <= 0) return;
  const sp = spk(id);
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

const blob = (c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, lw = 0, rot = 0) => {
  c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); c.fill();
  if (lw) { c.lineWidth = lw; c.strokeStyle = OUT; c.stroke(); }
};

/** a round portrait: the town's for its speakers, the Count's own */
export function face(ctx: CanvasRenderingContext2D, id: Spk, cx: number, cy: number, r: number, t: number, talk: number, expr?: string) {
  if (id !== 'netopyr') { townFace(ctx, id as SpeakerId, cx, cy, r, t, talk, expr); return; }
  const sp = OWN.netopyr;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = sp.bg; ctx.fill();
  ctx.save(); ctx.clip();
  // a red moon behind him
  blob(ctx, cx + r * 0.42, cy - r * 0.45, r * 0.5, r * 0.5, 'rgba(255,90,90,0.55)');
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  for (let i = 0; i < 8; i++) { const a = t * 0.3 + (i / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, a + 0.25); ctx.closePath(); ctx.fill(); }
  netopyrFace(ctx, cx, cy + 4 * (r / 50), r / 50, t, talk, expr);
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 5; ctx.strokeStyle = OUT; ctx.stroke();
  ctx.lineWidth = 2.5; ctx.strokeStyle = sp.color; ctx.beginPath(); ctx.arc(cx, cy, r - 4, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/** a thin vampire dandy: high collar, slick hair with a widow's peak, a monocle, fangs, pointy ears */
function netopyrFace(c: CanvasRenderingContext2D, x: number, y: number, k: number, t: number, talk: number, expr?: string) {
  // the cape's high collar (behind the head)
  c.fillStyle = '#7a1630';
  c.beginPath(); c.moveTo(x - 44 * k, y + 40 * k); c.lineTo(x - 36 * k, y - 26 * k); c.lineTo(x - 14 * k, y + 8 * k); c.lineTo(x + 14 * k, y + 8 * k); c.lineTo(x + 36 * k, y - 26 * k); c.lineTo(x + 44 * k, y + 40 * k); c.closePath(); c.fill();
  c.lineWidth = 3 * k; c.strokeStyle = OUT; c.stroke();
  blob(c, x, y + 50 * k, 34 * k, 18 * k, '#241a2e', 3 * k); // the coat
  blob(c, x, y + 36 * k, 8 * k, 6 * k, '#e8d8f0', 2 * k); // the cravat
  // ears
  for (const s of [-1, 1]) {
    c.fillStyle = '#d8cce6'; c.beginPath(); c.moveTo(x + s * 22 * k, y - 4 * k); c.lineTo(x + s * 40 * k, y - 22 * k); c.lineTo(x + s * 26 * k, y + 8 * k); c.closePath(); c.fill(); c.lineWidth = 2.5 * k; c.strokeStyle = OUT; c.stroke();
  }
  // a long pale face
  blob(c, x, y, 24 * k, 31 * k, '#ddd2ea', 3 * k);
  // hair: slick, with a sharp widow's peak
  c.fillStyle = '#1e1428';
  c.beginPath(); c.moveTo(x - 25 * k, y - 4 * k); c.quadraticCurveTo(x - 26 * k, y - 36 * k, x, y - 34 * k); c.quadraticCurveTo(x + 26 * k, y - 36 * k, x + 25 * k, y - 4 * k);
  c.lineTo(x + 16 * k, y - 20 * k); c.lineTo(x, y - 12 * k); c.lineTo(x - 16 * k, y - 20 * k); c.closePath(); c.fill();
  // eyes: red, narrow; sly by default
  const sly = !expr || expr === 'sly' || expr === 'normal';
  const scared = expr === 'scared' || expr === 'surprised' || expr === 'hurt';
  for (const s of [-1, 1]) {
    const ex = x + s * 10 * k, ey = y - 3 * k;
    blob(c, ex, ey, 6 * k, scared ? 7 * k : 4.5 * k, '#fff4f6', 2 * k);
    blob(c, ex + (sly ? 1.5 * k : 0), ey + 0.5 * k, 2.6 * k, scared ? 4 * k : 3 * k, '#d0203a');
    c.lineWidth = 3 * k; c.strokeStyle = OUT; c.beginPath();
    if (expr === 'angry') { c.moveTo(ex - 7 * k, ey - 9 * k + s * -2 * k); c.lineTo(ex + 7 * k, ey - 9 * k + s * 2 * k); }
    else if (scared) { c.moveTo(ex - 6 * k, ey - 11 * k); c.lineTo(ex + 6 * k, ey - 12 * k); }
    else { c.moveTo(ex - 7 * k, ey - 7 * k - s * 2 * k); c.lineTo(ex + 7 * k, ey - 7 * k + s * 2 * k); }
    c.stroke();
  }
  // the monocle (right eye) on a gold chain
  c.lineWidth = 2.5 * k; c.strokeStyle = '#e8c24a';
  c.beginPath(); c.arc(x + 10 * k, y - 3 * k, 8.5 * k, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.moveTo(x + 17 * k, y + 2 * k); c.quadraticCurveTo(x + 24 * k, y + 20 * k, x + 14 * k, y + 32 * k); c.stroke();
  // a thin moustache
  c.lineWidth = 2.2 * k; c.strokeStyle = '#1e1428';
  c.beginPath(); c.moveTo(x, y + 9 * k); c.quadraticCurveTo(x - 10 * k, y + 7 * k, x - 16 * k, y + 3 * k); c.moveTo(x, y + 9 * k); c.quadraticCurveTo(x + 10 * k, y + 7 * k, x + 16 * k, y + 3 * k); c.stroke();
  // the mouth + fangs
  const my = y + 15 * k;
  if (talk > 0.15 || scared) {
    blob(c, x, my, 7 * k, (scared ? 6 : 2 + talk * 5) * k, '#5a0a1e', 2 * k);
  } else {
    c.lineWidth = 2.5 * k; c.strokeStyle = OUT; c.beginPath();
    if (expr === 'angry' || expr === 'hurt') c.arc(x, my + 6 * k, 7 * k, Math.PI * 1.15, Math.PI * 1.85); else c.arc(x + 2 * k, my - 3 * k, 8 * k, Math.PI * 0.12, Math.PI * 0.8);
    c.stroke();
  }
  for (const s of [-1, 1]) { c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(x + s * 5 * k, my - 1 * k); c.lineTo(x + s * 3 * k, my + 6 * k); c.lineTo(x + s * 1.5 * k, my - 1 * k); c.closePath(); c.fill(); c.lineWidth = 1.2 * k; c.strokeStyle = OUT; c.stroke(); }
  void t;
}
