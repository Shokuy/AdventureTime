import { W, H, clamp, ease } from '../../../../engine/util';
import { rrect, text, wrap, OUT } from '../../../../art/draw';
import { WHO_INFO, type Who } from '../../../../art/characters';
import { Dialog } from '../../../../ui/dialog';
import type { Waiter } from '../../../../game/coroutine';
import type { Level3D } from '../../level';
import { SPEAKERS as TOWN, type SpeakerId } from '../town/speech';
import { drawPortrait, PORTRAIT_INFO } from '../../../../art/portraits';

/**
 * Speakers of «Клыки в пастиле» (docs/script-fangs.md §5). Тоша / Бублик / the bear / the narrator are the game's own
 * dialog speakers (`Who`); everybody's portrait comes from the shared cast portraits (art/portraits.ts). Every line goes through the level's dialog box (same timing, co-op auto-advance, the
 * scene watchdog). The box is drawn for a line only while that very line is on screen (other modules' speech hooks
 * may share the dialog box — the hub's interludes use town/speech.ts directly).
 */
export type Spk = 'tosha' | 'bublik' | 'narrator' | 'bear' | 'pastila' | 'noki' | 'zefirych' | 'marmeladka' | 'zhitel' | 'presnyak' | 'netopyr';

interface Speaker { name: string; color: string; bg: string; who?: Who }
const OWN: Record<'netopyr', Speaker> = {
  netopyr: { name: PORTRAIT_INFO.netopyr.name, color: PORTRAIT_INFO.netopyr.color, bg: PORTRAIT_INFO.netopyr.bg },
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

/** a round portrait: the shared cast portraits (art/portraits.ts) */
export function face(ctx: CanvasRenderingContext2D, id: Spk, cx: number, cy: number, r: number, t: number, talk: number, expr?: string) {
  drawPortrait(ctx, id, cx, cy, r, t, talk, expr);
}
