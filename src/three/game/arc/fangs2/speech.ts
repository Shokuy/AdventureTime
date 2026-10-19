import { W, H, clamp, ease } from '../../../../engine/util';
import { rrect, text, wrap, OUT } from '../../../../art/draw';
import { WHO_INFO, type Who } from '../../../../art/characters';
import { Dialog } from '../../../../ui/dialog';
import type { Waiter } from '../../../../game/coroutine';
import type { Level3D } from '../../level';
import { drawPortrait, PORTRAIT_INFO } from '../../../../art/portraits';

/**
 * Speakers of «Туманные топи». Тоша / Бублик / the narrator are the game's own dialog speakers (`Who`); Пастила and Ноки
 * and everybody else get the shared cast portraits (art/portraits.ts).
 * Every line goes through the level's dialog box (same timing, co-op auto-advance, the scene watchdog). If someone adds
 * a speaker to `Who` (WHO_INFO), that wins automatically.
 */
export type Spk = 'tosha' | 'bublik' | 'narrator' | 'pastila' | 'noki' | 'kamysh' | 'morok' | 'svetlyachikha';

interface Speaker { name: string; color: string; bg: string; who?: Who }
const SPK: Record<Spk, Speaker> = {
  tosha: { name: 'Тоша', color: '#ff8a2a', bg: '#ffe7c4', who: 'hero' },
  bublik: { name: 'Бублик', color: '#b0612e', bg: '#ffe0b8', who: 'dog' },
  narrator: { name: '', color: '#f0c040', bg: '#2a1b1a', who: 'narrator' },
  pastila: { name: 'Пастила', color: '#e8508a', bg: '#ffe0ec' },
  noki: { name: 'Ноки', color: '#8a2a5a', bg: '#e6dcf2' },
  kamysh: { name: 'Камыш', color: PORTRAIT_INFO.kamysh.color, bg: PORTRAIT_INFO.kamysh.bg },
  morok: { name: 'Мадам Морок', color: PORTRAIT_INFO.morok.color, bg: PORTRAIT_INFO.morok.bg },
  svetlyachikha: { name: 'Матушка Светлячиха', color: PORTRAIT_INFO.svetlyachikha.color, bg: PORTRAIT_INFO.svetlyachikha.bg },
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
  drawPortrait(ctx, id, cx, cy, r, t, talk, expr);
}
