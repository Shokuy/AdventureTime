import { W, H, clamp, ease } from '../../../../engine/util';
import { rrect, text, wrap, OUT } from '../../../../art/draw';
import { WHO_INFO, type Who } from '../../../../art/characters';
import { drawPortrait, PORTRAIT_INFO } from '../../../../art/portraits';
import { Dialog } from '../../../../ui/dialog';
import type { Waiter } from '../../../../game/coroutine';
import type { Level3D } from '../../level';
import { hasStoryFlag } from '../../episodes';

/**
 * Speakers of docs/script-fangs.md in the hub's scenes. Tosha / Bublik / the bear / the narrator are the game's own
 * dialog speakers (`Who`); the new ones (Пастила, Ноки, Пряник, Ириска, townsfolk) speak through the same dialog box
 * (same timing, co-op auto-advance, watchdog) with the shared portraits of art/portraits.ts.
 */

export type SpeakerId = 'tosha' | 'bublik' | 'bear' | 'narrator' | 'pastila' | 'noki' | 'pryanik' | 'iriska' | 'zefirych' | 'beze' | 'ponchik' | 'marmeladka' | 'zhitel' | 'presnyak'
  // v2 (docs/script-fangs-v2.md §0): the voice of the invitation card (4.4а), the diary, the raven (barks), Шёпот / Шуршик
  | 'polnoch' | 'karamel' | 'voron' | 'shepot' | 'shurshik';

interface Speaker { name: string; color: string; bg: string; who?: Who }
export const SPEAKERS: Record<SpeakerId, Speaker> = {
  tosha: { name: 'Тоша', color: PORTRAIT_INFO.tosha.color, bg: '#ffe7c4', who: 'hero' },
  bublik: { name: 'Бублик', color: PORTRAIT_INFO.bublik.color, bg: '#ffe0b8', who: 'dog' },
  bear: { name: 'Медведь Вторник', color: PORTRAIT_INFO.bear.color, bg: '#e6d2b0', who: 'bear' },
  narrator: { name: '', color: PORTRAIT_INFO.narrator.color, bg: '#2a1b1a', who: 'narrator' },
  pastila: { name: 'Пастила', color: PORTRAIT_INFO.pastila.color, bg: '#ffe0ec' },
  noki: { name: 'Ноки', color: PORTRAIT_INFO.noki.color, bg: '#e6dcf2' },
  pryanik: { name: 'Пряник', color: PORTRAIT_INFO.pryanik.color, bg: '#f6e2c4' },
  iriska: { name: 'Ириска', color: PORTRAIT_INFO.iriska.color, bg: '#fff0d8' },
  zefirych: { name: 'Дед Зефирыч', color: PORTRAIT_INFO.zefirych.color, bg: '#f4f2ff' },
  beze: { name: 'Мадам Безе', color: PORTRAIT_INFO.beze.color, bg: '#fff4f8' },
  ponchik: { name: 'Пончик', color: PORTRAIT_INFO.ponchik.color, bg: '#ffe8d0' },
  marmeladka: { name: 'Мармеладка', color: PORTRAIT_INFO.marmeladka.color, bg: '#e4ffe4' },
  zhitel: { name: 'Житель', color: PORTRAIT_INFO.zhitel.color, bg: '#fff0f6' },
  presnyak: { name: 'Пресняк', color: PORTRAIT_INFO.presnyak.color, bg: '#e6e6ea' },
  polnoch: { name: PORTRAIT_INFO.polnoch.name, color: PORTRAIT_INFO.polnoch.color, bg: PORTRAIT_INFO.polnoch.bg },
  karamel: { name: PORTRAIT_INFO.karamel.name, color: PORTRAIT_INFO.karamel.color, bg: PORTRAIT_INFO.karamel.bg },
  voron: { name: PORTRAIT_INFO.voron.name, color: PORTRAIT_INFO.voron.color, bg: PORTRAIT_INFO.voron.bg },
  shepot: { name: PORTRAIT_INFO.shepot.name, color: PORTRAIT_INFO.shepot.color, bg: PORTRAIT_INFO.shepot.bg },
  shurshik: { name: PORTRAIT_INFO.shurshik.name, color: PORTRAIT_INFO.shurshik.color, bg: PORTRAIT_INFO.shurshik.bg },
};

/** the story flag set by 7.5 (fangs3): from then on Шёпот is called Шуршик in the dialog box */
export const SHURSHIK_FLAG = 'f3:named';
/** the name in the box: Шёпот → Шуршик once the flag is set (one portrait, the name by the flag) */
export function speakerName(id: SpeakerId): string {
  if (id === 'shepot' && hasStoryFlag(SHURSHIK_FLAG)) return SPEAKERS.shurshik.name;
  return (SPEAKERS[id] ?? SPEAKERS.zhitel).name;
}

/** the speaker of the line on screen (custom ones only), per dialog box */
const current = new WeakMap<Dialog, SpeakerId | null>();
const installed = new WeakSet<Dialog>();

/** let the level's dialog box draw the candy speakers (call once per level) */
export function installSpeech(L: Level3D) {
  const d = L.dialog;
  if (installed.has(d)) return;
  installed.add(d);
  const orig = d.draw.bind(d);
  d.draw = (ctx: CanvasRenderingContext2D) => {
    const sp = current.get(d);
    if (sp && d.who === 'narrator') drawBox(d, ctx, sp); else orig(ctx);
  };
}

/** a line of the script spoken by `id` in the level's dialog box (a Waiter for scripts, like L.say) */
export function say(L: Level3D, id: SpeakerId, str: string, expr?: string): Waiter {
  installSpeech(L);
  const sp = SPEAKERS[id] ?? SPEAKERS.zhitel;
  const known = (WHO_INFO as Record<string, unknown>)[id] ? (id as Who) : sp.who;
  current.set(L.dialog, known ? null : id);
  return L.say(known ?? 'narrator', str, expr);
}

/** who is talking right now in this level's box (for mouths of the NPC figures) */
export function speakingNow(L: Level3D): { id: SpeakerId | Who; talking: boolean } | null {
  const d = L.dialog;
  if (!d.active) return null;
  const sp = current.get(d);
  const id = sp && d.who === 'narrator' ? sp : (Object.entries(SPEAKERS).find(([, s]) => s.who === d.who)?.[0] as SpeakerId | undefined) ?? d.who;
  return { id, talking: d.shown < d.str.length };
}

// ───────────────────────── the dialog box for candy speakers ─────────────────────────

function drawBox(d: Dialog, ctx: CanvasRenderingContext2D, id: SpeakerId) {
  if (d.appear <= 0) return;
  const sp = SPEAKERS[id];
  const a = ease.outBack(clamp(d.appear, 0, 1));
  const bw = 1060, bh = Dialog.BOX_H;
  const bx = (W - bw) / 2, by = d.top ? 30 - (1 - a) * 80 : H - bh - 26 + (1 - a) * 80;
  ctx.save();
  ctx.globalAlpha = clamp(d.appear * 1.5, 0, 1);
  rrect(ctx, bx + 6, by + 8, bw, bh, 22, 'rgba(0,0,0,0.4)', 0);
  rrect(ctx, bx, by, bw, bh, 22, '#fff7e6', 5);
  drawFace(ctx, id, bx + 86, by + bh / 2 - 6, 62, d.t, d.shown < d.str.length ? Math.abs(Math.sin(d.t * 16)) : 0, d.expr);
  ctx.font = '900 20px Rubik, sans-serif';
  const name = speakerName(id);
  const nw = ctx.measureText(name).width + 30;
  rrect(ctx, bx + 160, by - 18, nw, 34, 12, sp.color, 4);
  text(ctx, name, bx + 175, by + 6, { size: 20, color: '#fff', stroke: 0 });
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

/** a round portrait (also used by the hub's talk box and the finale): the shared cast portraits (art/portraits.ts) */
export function drawFace(ctx: CanvasRenderingContext2D, id: SpeakerId, cx: number, cy: number, r: number, t: number, talk: number, expr?: string) {
  drawPortrait(ctx, id in SPEAKERS ? id : 'zhitel', cx, cy, r, t, talk, expr);
}
