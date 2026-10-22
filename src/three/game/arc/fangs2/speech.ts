import { W, H, clamp, ease } from '../../../../engine/util';
import { rrect, text, wrap, OUT } from '../../../../art/draw';
import { WHO_INFO, type Who } from '../../../../art/characters';
import { Dialog } from '../../../../ui/dialog';
import type { Waiter } from '../../../../game/coroutine';
import type { Level3D } from '../../level';
import { drawPortrait, PORTRAIT_INFO, type PortraitVariant } from '../../../../art/portraits';

/**
 * Speakers of «Туманные топи». Тоша / Бублик / the narrator are the game's own dialog speakers (`Who`); Пастила and Ноки
 * and everybody else get the shared cast portraits (art/portraits.ts).
 * Every line goes through the level's dialog box (same timing, co-op auto-advance, the scene watchdog). If someone adds
 * a speaker to `Who` (WHO_INFO), that wins automatically.
 */
export type Spk = 'tosha' | 'bublik' | 'narrator' | 'pastila' | 'noki' | 'kamysh' | 'morok' | 'svetlyachikha'
  | 'polnoch' | 'morokMouse' | 'morosya';

/** `portrait`: which shared portrait to draw (default: the id); `variant`: its variant; 'morosya' is painted here */
interface Speaker { name: string; color: string; bg: string; who?: Who; portrait?: string; variant?: PortraitVariant }
const SPK: Record<Spk, Speaker> = {
  tosha: { name: 'Тоша', color: '#ff8a2a', bg: '#ffe7c4', who: 'hero' },
  bublik: { name: 'Бублик', color: '#b0612e', bg: '#ffe0b8', who: 'dog' },
  narrator: { name: '', color: '#f0c040', bg: '#2a1b1a', who: 'narrator' },
  pastila: { name: 'Пастила', color: '#e8508a', bg: '#ffe0ec' },
  noki: { name: 'Ноки', color: '#8a2a5a', bg: '#e6dcf2' },
  kamysh: { name: 'Камыш', color: PORTRAIT_INFO.kamysh.color, bg: PORTRAIT_INFO.kamysh.bg },
  morok: { name: 'Мадам Морок', color: PORTRAIT_INFO.morok.color, bg: PORTRAIT_INFO.morok.bg },
  svetlyachikha: { name: 'Матушка Светлячиха', color: PORTRAIT_INFO.svetlyachikha.color, bg: PORTRAIT_INFO.svetlyachikha.bg },
  // 6.7: the King off-screen; Морок as a little bat-mouse
  polnoch: { name: 'Король Полночь', color: PORTRAIT_INFO.polnoch.color, bg: PORTRAIT_INFO.polnoch.bg },
  morokMouse: { name: 'Мадам Морок', color: PORTRAIT_INFO.morok.color, bg: PORTRAIT_INFO.morok.bg, portrait: 'morok', variant: 'mouse' },
  // 6.5: under the veil — Морося, Камыш's sister (a portrait of her own, painted below)
  morosya: { name: 'Морося', color: '#4f8a3a', bg: '#e2f2d6' },
};

const current = new WeakMap<Dialog, Spk | null>();
/** who is on screen in this dialog (any of mine), for mouths of the figures */
const speaking = new WeakMap<Dialog, Spk>();
const installed = new WeakSet<Dialog>();

function install(L: Level3D) {
  const d = L.dialog;
  if (installed.has(d)) return;
  installed.add(d);
  const orig = d.draw.bind(d);
  d.draw = (ctx: CanvasRenderingContext2D) => {
    const sp = current.get(d);
    if (sp && d.who === 'narrator') drawBox(d, ctx, sp); else orig(ctx);
  };
}

/** a line spoken by `id` in the level's dialog box (a Waiter, like L.say) */
export function say(L: Level3D, id: Spk, str: string, expr?: string): Waiter {
  install(L);
  const sp = SPK[id];
  const known = (WHO_INFO as Record<string, unknown>)[id] ? (id as Who) : sp.who;
  current.set(L.dialog, known ? null : id);
  speaking.set(L.dialog, id);
  return L.say(known ?? 'narrator', str, expr);
}

/** the speaker whose mouth moves now (null: nobody of mine, or the line is fully typed) */
export function talkingNow(L: Level3D): Spk | null {
  const d = L.dialog;
  if (!d.active || d.shown >= d.str.length) return null;
  return speaking.get(d) ?? null;
}

// ───────────────────────── the box ─────────────────────────
function drawBox(d: Dialog, ctx: CanvasRenderingContext2D, id: Spk) {
  if (d.appear <= 0) return;
  const sp = SPK[id];
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

/** a round portrait: the shared cast portraits (art/portraits.ts) */
export function face(ctx: CanvasRenderingContext2D, id: Spk, cx: number, cy: number, r: number, t: number, talk: number, expr?: string) {
  if (id === 'morosya') { drawMorosya(ctx, cx, cy, r, t, talk, expr); return; }
  const sp = SPK[id];
  drawPortrait(ctx, sp.portrait ?? id, cx, cy, r, t, talk, expr, sp.variant);
}

/** Морося: a young frog with freckles and pink cheeks, big shy eyes, a scrap of the torn veil on her head */
function drawMorosya(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: number, talk: number, expr?: string) {
  const k = r / 50;
  c.save();
  c.translate(cx, cy); c.scale(k, k);
  c.beginPath(); c.arc(0, 0, 50, 0, Math.PI * 2);
  const g = c.createRadialGradient(-12, -16, 4, 0, 0, 52);
  g.addColorStop(0, '#f6fff0'); g.addColorStop(0.65, '#e2f2d6'); g.addColorStop(1, '#b8d8a8');
  c.fillStyle = g; c.fill();
  c.save(); c.clip();
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.lineWidth = 3.4; c.strokeStyle = OUT;
  const blob = (x: number, y: number, rx: number, ry: number, fill: string, stroke = true) => { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = fill; c.fill(); if (stroke) c.stroke(); };
  // shoulders: the violet gown
  blob(0, 58, 36, 22, '#4a2862');
  blob(0, 40, 14, 5, '#2a1438');
  // the head: wide and flat, eye bumps on top
  const sad = expr === 'sad' || expr === 'hurt' || expr === 'scared';
  blob(-15, -12, 13, 12, '#8cc46a'); blob(15, -12, 13, 12, '#8cc46a');
  blob(0, 10, 34, 24, '#8cc46a');
  c.beginPath(); c.ellipse(0, 18, 24, 12, 0, 0, Math.PI); c.fillStyle = '#eef0c8'; c.fill();
  // eyes
  const blink = (t % 3.7) < 0.13;
  for (const s of [-1, 1]) {
    if (blink) { c.beginPath(); c.moveTo(s * 15 - 7, -11); c.quadraticCurveTo(s * 15, -7, s * 15 + 7, -11); c.stroke(); continue; }
    blob(s * 15, -11, 8, 8.5, '#fff6e0');
    blob(s * 15 + s * 0.5, -10 + (sad ? 1.5 : 0), 4.2, 5, '#2a1a18', false);
    blob(s * 15 - 1.4, -12.5, 1.4, 1.4, '#ffffff', false);
    // shy lids
    c.beginPath(); c.ellipse(s * 15, -11, 8.4, 8.8, 0, Math.PI * 1.05, Math.PI * 1.95); c.fillStyle = '#7ab05a'; c.fill(); c.stroke();
    if (sad) { c.beginPath(); c.moveTo(s * 9, -21); c.lineTo(s * 19, -24 + 3); c.stroke(); }
  }
  // freckles + cheeks
  c.fillStyle = 'rgba(255,140,170,0.55)';
  for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * 21, 10, 6, 3.4, 0, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = '#a86a3a';
  for (const [x, y] of [[-22, 4], [-17, 7], [-25, 9], [22, 4], [17, 7], [25, 9], [-4, 3], [4, 3.5], [0, 1]] as const) { c.beginPath(); c.arc(x, y, 1.3, 0, Math.PI * 2); c.fill(); }
  // the mouth: a small shy smile (opens a little when she talks)
  const open = talk * 4;
  c.beginPath(); c.moveTo(-9, 16); c.quadraticCurveTo(0, sad ? 13 + open : 21 + open, 9, 16);
  if (open > 0.5) { c.quadraticCurveTo(0, 18, -9, 16); c.fillStyle = '#5a1a20'; c.fill(); }
  c.stroke();
  // a torn scrap of the black veil, still on her head
  c.beginPath(); c.moveTo(-26, -20); c.quadraticCurveTo(-8, -32, 18, -26); c.lineTo(10, -18); c.lineTo(4, -23); c.lineTo(-6, -17); c.lineTo(-14, -22); c.closePath();
  c.fillStyle = 'rgba(20,10,28,0.8)'; c.fill(); c.stroke();
  c.restore();
  c.restore();
  c.save();
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2);
  c.lineWidth = 5; c.strokeStyle = OUT; c.stroke();
  c.lineWidth = 2.5; c.strokeStyle = SPK.morosya.color; c.beginPath(); c.arc(cx, cy, r - 4, 0, Math.PI * 2); c.stroke();
  c.restore();
}
