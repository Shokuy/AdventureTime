import { W, H, clamp, ease } from '../../../../engine/util';
import { rrect, text, wrap, OUT } from '../../../../art/draw';
import { type Who } from '../../../../art/characters';
import { drawPortrait, PORTRAIT_INFO } from '../../../../art/portraits';
import { Dialog } from '../../../../ui/dialog';
import type { Waiter } from '../../../../game/coroutine';
import type { Level3D } from '../../level';
import { type SpeakerId as TownSpeaker } from '../town/speech';

/**
 * Speakers of «Замок Полночь» (docs/script-fangs.md §0). Тоша / Бублик / Вторник / the narrator are the game's own
 * dialog speakers (`Who`); everyone else talks through the same dialog box (same timing, co-op auto-advance, the
 * scene watchdog) with the shared cast portraits (art/portraits.ts): the King, Граф Кислоплюй's letter, and the five
 * lieutenants as the little bat-mice they shrank into.
 */

export type SpeakerId = 'tosha' | 'bublik' | 'bear' | 'narrator' | 'pastila' | 'noki' | 'polnoch' | 'kisloplyu'
  | 'netopyr' | 'morok' | 'shepot' | 'shurshik' | 'nochka' | 'tenka' | 'zefirych' | 'beze' | 'ponchik' | 'marmeladka';

interface Speaker { name: string; color: string; bg: string; who?: Who; town?: TownSpeaker }
export const SPEAKERS: Record<SpeakerId, Speaker> = {
  tosha: { name: 'Тоша', color: '#ff8a2a', bg: '#ffe7c4', who: 'hero' },
  bublik: { name: 'Бублик', color: '#b0612e', bg: '#ffe0b8', who: 'dog' },
  bear: { name: 'Медведь Вторник', color: '#b0453a', bg: '#e6d2b0', who: 'bear' },
  narrator: { name: '', color: '#f0c040', bg: '#2a1b1a', who: 'narrator' },
  pastila: { name: 'Пастила', color: '#e8508a', bg: '#ffe0ec', town: 'pastila' },
  noki: { name: 'Ноки', color: '#8a2a5a', bg: '#e6dcf2', town: 'noki' },
  zefirych: { name: 'Дед Зефирыч', color: '#8a8ab8', bg: '#f4f2ff', town: 'zefirych' },
  beze: { name: 'Мадам Безе', color: '#e87aa0', bg: '#fff4f8', town: 'beze' },
  ponchik: { name: 'Пончик', color: '#d0703a', bg: '#ffe8d0', town: 'ponchik' },
  marmeladka: { name: 'Мармеладка', color: '#3aa84a', bg: '#e4ffe4', town: 'marmeladka' },
  polnoch: { name: 'Король Полночь', color: PORTRAIT_INFO.polnoch.color, bg: PORTRAIT_INFO.polnoch.bg },
  kisloplyu: { name: 'Граф Кислоплюй', color: PORTRAIT_INFO.kisloplyu.color, bg: PORTRAIT_INFO.kisloplyu.bg },
  netopyr: { name: 'Граф Нетопырь', color: PORTRAIT_INFO.netopyr.color, bg: PORTRAIT_INFO.netopyr.bg },
  morok: { name: 'Мадам Морок', color: PORTRAIT_INFO.morok.color, bg: PORTRAIT_INFO.morok.bg },
  shepot: { name: 'Шёпот', color: PORTRAIT_INFO.shepot.color, bg: PORTRAIT_INFO.shepot.bg },
  // (v2 §0: after the garden Шёпот is Шуршик — the same portrait, his own name)
  shurshik: { name: 'Шуршик', color: PORTRAIT_INFO.shepot.color, bg: PORTRAIT_INFO.shepot.bg },
  nochka: { name: 'Ночка', color: PORTRAIT_INFO.nochka.color, bg: PORTRAIT_INFO.nochka.bg },
  tenka: { name: 'Тенька', color: PORTRAIT_INFO.tenka.color, bg: PORTRAIT_INFO.tenka.bg },
};

/** the speaker of the line on screen, per dialog box */
const current = new WeakMap<Dialog, SpeakerId>();
const installed = new WeakSet<Dialog>();

function install(L: Level3D) {
  const d = L.dialog;
  if (installed.has(d)) return;
  installed.add(d);
  const orig = d.draw.bind(d);
  d.draw = (ctx: CanvasRenderingContext2D) => {
    const sp = current.get(d);
    if (sp && !SPEAKERS[sp].who && d.who === 'narrator') drawBox(d, ctx, sp); else orig(ctx);
  };
}

/** a line of the script in the level's dialog box (a Waiter, like L.say) */
export function say(L: Level3D, id: SpeakerId, str: string, expr?: string): Waiter {
  install(L);
  const sp = SPEAKERS[id] ?? SPEAKERS.narrator;
  current.set(L.dialog, id);
  return L.say(sp.who ?? 'narrator', str, expr);
}

/** who is talking right now (for the mouths of the cast figures) */
export function speakingNow(L: Level3D): SpeakerId | null {
  const d = L.dialog;
  if (!d.active || d.shown >= d.str.length) return null;
  const id = current.get(d);
  if (id && (SPEAKERS[id].who ?? 'narrator') === d.who) return id;
  return d.who === 'hero' ? 'tosha' : d.who === 'dog' ? 'bublik' : d.who === 'bear' ? 'bear' : null;
}

// ───────────────────────── the box ─────────────────────────
function drawBox(d: Dialog, ctx: CanvasRenderingContext2D, id: SpeakerId) {
  if (d.appear <= 0) return;
  const sp = SPEAKERS[id];
  const a = ease.outBack(clamp(d.appear, 0, 1));
  const bw = 1060, bh = Dialog.BOX_H;
  const bx = (W - bw) / 2, by = d.top ? 30 - (1 - a) * 80 : H - bh - 26 + (1 - a) * 80;
  ctx.save();
  ctx.globalAlpha = clamp(d.appear * 1.5, 0, 1);
  rrect(ctx, bx + 6, by + 8, bw, bh, 22, 'rgba(0,0,0,0.4)', 0);
  const letter = id === 'kisloplyu';
  rrect(ctx, bx, by, bw, bh, 22, letter ? '#fffbe0' : '#fff7e6', 5);
  face(ctx, id, bx + 86, by + bh / 2 - 6, 62, d.t, d.shown < d.str.length ? Math.abs(Math.sin(d.t * 16)) : 0, d.expr);
  ctx.font = '900 20px Rubik, sans-serif';
  const nw = ctx.measureText(sp.name).width + 30;
  rrect(ctx, bx + 160, by - 18, nw, 34, 12, sp.color, 4);
  text(ctx, sp.name, bx + 175, by + 6, { size: 20, color: '#fff', stroke: 0 });
  const tx = bx + 170, maxW = bw - 170 - 40;
  ctx.font = letter ? 'italic 400 27px Pangolin, "Comic Sans MS", sans-serif' : '400 27px Pangolin, "Comic Sans MS", sans-serif';
  const lines = wrap(ctx, d.str, maxW);
  let remaining = Math.floor(d.shown);
  lines.forEach((ln, i) => {
    const part = ln.slice(0, Math.max(0, remaining));
    remaining -= ln.length + 1;
    text(ctx, part, tx, by + 50 + i * 34, { size: 27, font: 'body', color: letter ? '#5a4a10' : OUT });
  });
  if (d.shown >= d.str.length && d.active) text(ctx, '▼', bx + bw - 36, by + bh - 20 + Math.sin(d.t * 6) * 4, { size: 22, color: sp.color, align: 'center' });
  ctx.restore();
}

/** the lieutenants speak here only as the little bat-mice they shrank into (§9.2.3) */
const MICE: Partial<Record<SpeakerId, true>> = { netopyr: true, morok: true, shepot: true, shurshik: true, nochka: true, tenka: true };

/** a round portrait for any speaker of this episode: the shared cast portraits (art/portraits.ts) */
export function face(ctx: CanvasRenderingContext2D, id: SpeakerId, cx: number, cy: number, r: number, t: number, talk: number, expr?: string) {
  drawPortrait(ctx, id === 'shurshik' ? 'shepot' : id, cx, cy, r, t, talk, expr, MICE[id] ? 'mouse' : undefined);
}
