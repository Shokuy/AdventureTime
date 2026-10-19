import { W, H, clamp, ease } from '../../../../engine/util';
import { rrect, text, wrap, OUT } from '../../../../art/draw';
import { WHO_INFO, drawPortrait, type Who } from '../../../../art/characters';
import { Dialog } from '../../../../ui/dialog';
import type { Waiter } from '../../../../game/coroutine';
import type { Level3D } from '../../level';

/**
 * Speakers of docs/script-fangs.md in the hub's scenes. Tosha / Bublik / the bear / the narrator are the game's own
 * dialog speakers (`Who`); the new ones (Пастила, Ноки, Пряник, Ириска, townsfolk) speak through the same dialog box
 * (same timing, co-op auto-advance, watchdog) with a candy portrait drawn here — until somebody adds them to `Who`
 * (WHO_INFO), which then wins automatically.
 */

export type SpeakerId = 'tosha' | 'bublik' | 'bear' | 'narrator' | 'pastila' | 'noki' | 'pryanik' | 'iriska' | 'zefirych' | 'beze' | 'ponchik' | 'marmeladka' | 'zhitel' | 'presnyak';

interface Speaker { name: string; color: string; bg: string; who?: Who }
export const SPEAKERS: Record<SpeakerId, Speaker> = {
  tosha: { name: 'Тоша', color: '#ff8a2a', bg: '#ffe7c4', who: 'hero' },
  bublik: { name: 'Бублик', color: '#b0612e', bg: '#ffe0b8', who: 'dog' },
  bear: { name: 'Медведь Вторник', color: '#b0453a', bg: '#e6d2b0', who: 'bear' },
  narrator: { name: '', color: '#f0c040', bg: '#2a1b1a', who: 'narrator' },
  pastila: { name: 'Пастила', color: '#e8508a', bg: '#ffe0ec' },
  noki: { name: 'Ноки', color: '#8a2a5a', bg: '#e6dcf2' },
  pryanik: { name: 'Пряник', color: '#a8642a', bg: '#f6e2c4' },
  iriska: { name: 'Ириска', color: '#c87a2a', bg: '#fff0d8' },
  zefirych: { name: 'Дед Зефирыч', color: '#8a8ab8', bg: '#f4f2ff' },
  beze: { name: 'Мадам Безе', color: '#e87aa0', bg: '#fff4f8' },
  ponchik: { name: 'Пончик', color: '#d0703a', bg: '#ffe8d0' },
  marmeladka: { name: 'Мармеладка', color: '#3aa84a', bg: '#e4ffe4' },
  zhitel: { name: 'Житель', color: '#c85a8a', bg: '#fff0f6' },
  presnyak: { name: 'Пресняк', color: '#7a7a86', bg: '#e6e6ea' },
};

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

/** a round portrait (also used by the hub's talk box) */
export function drawFace(ctx: CanvasRenderingContext2D, id: SpeakerId, cx: number, cy: number, r: number, t: number, talk: number, expr?: string) {
  const sp = SPEAKERS[id] ?? SPEAKERS.zhitel;
  const who = (WHO_INFO as Record<string, unknown>)[id] ? (id as Who) : sp.who;
  if (who) { drawPortrait(ctx, who, cx, cy, r, t, talk, expr); return; }
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = sp.bg; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 8; i++) { const a = t * 0.3 + (i / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, a + 0.25); ctx.closePath(); ctx.fill(); }
  const k = r / 50;
  const f = FACES[id] ?? FACES.zhitel;
  const hy = cy + 8 * k;
  // shoulders
  ctx.fillStyle = f.cloth; ctx.beginPath(); ctx.ellipse(cx, cy + 58 * k, 40 * k, 26 * k, 0, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 3 * k; ctx.strokeStyle = OUT; ctx.stroke();
  f.back?.(ctx, cx, hy, k, t);
  // head
  ctx.fillStyle = f.skin; ctx.beginPath(); ctx.ellipse(cx, hy, 30 * k * (f.wide ?? 1), 31 * k, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  f.front?.(ctx, cx, hy, k, t);
  // eyes
  const surprised = expr === 'surprised' || expr === 'scared';
  const sly = expr === 'sly', angry = expr === 'angry', happy = expr === 'happy', sleepy = expr === 'sleepy';
  for (const sx of [-1, 1]) {
    const ex = cx + sx * 11 * k, ey = hy - 2 * k;
    if (happy && !surprised) { ctx.lineWidth = 3.5 * k; ctx.strokeStyle = OUT; ctx.beginPath(); ctx.arc(ex, ey + 2 * k, 5 * k, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); continue; }
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(ex, ey, 6 * k, (surprised ? 9 : sleepy ? 3 : 7.5) * k, 0, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2 * k; ctx.strokeStyle = OUT; ctx.stroke();
    ctx.fillStyle = f.eye ?? '#1b1214'; ctx.beginPath(); ctx.ellipse(ex + (sly ? sx * 1.5 * k + 2 * k : 0), ey + 1 * k, 3.2 * k, (sleepy ? 2 : 4.2) * k, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(ex + 1.2 * k, ey - 1.5 * k, 1.2 * k, 0, Math.PI * 2); ctx.fill();
    if (angry || sly) { ctx.lineWidth = 3 * k; ctx.strokeStyle = OUT; ctx.beginPath(); ctx.moveTo(ex - 7 * k, ey - (angry ? 10 : 9) * k + (angry ? sx * -2 * k : 0)); ctx.lineTo(ex + 7 * k, ey - (angry ? 10 : 9) * k + (angry ? sx * 2 * k : 0)); ctx.stroke(); }
  }
  // blush + mouth
  ctx.fillStyle = 'rgba(255,120,150,0.45)';
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + sx * 19 * k, hy + 9 * k, 5 * k, 3 * k, 0, 0, Math.PI * 2); ctx.fill(); }
  const my = hy + 15 * k;
  if (talk > 0.15 || surprised) {
    ctx.fillStyle = '#7a1a2e'; ctx.beginPath(); ctx.ellipse(cx, my, 6 * k, (surprised ? 6 : 2 + talk * 5) * k, 0, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2 * k; ctx.strokeStyle = OUT; ctx.stroke();
  } else {
    ctx.lineWidth = 3 * k; ctx.strokeStyle = OUT; ctx.beginPath();
    if (angry || expr === 'sad') ctx.arc(cx, my + 6 * k, 6 * k, Math.PI * 1.15, Math.PI * 1.85); else ctx.arc(cx, my - 3 * k, 7 * k, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }
  f.over?.(ctx, cx, hy, k, t);
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 5; ctx.strokeStyle = OUT; ctx.stroke();
  ctx.lineWidth = 2.5; ctx.strokeStyle = sp.color; ctx.beginPath(); ctx.arc(cx, cy, r - 4, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

type Paint = (ctx: CanvasRenderingContext2D, cx: number, cy: number, k: number, t: number) => void;
interface FaceSpec { skin: string; cloth: string; eye?: string; wide?: number; back?: Paint; front?: Paint; over?: Paint }
const blob = (ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, lw = 0, rot = 0) => {
  ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
  if (lw) { ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.stroke(); }
};
const FACES: Record<string, FaceSpec> = {
  pastila: {
    skin: '#ffe6ee', cloth: '#fffdf8',
    back: (c, x, y, k) => { for (let i = 0; i < 5; i++) blob(c, x, y - 34 * k - i * 0, 24 * k - i * 3 * k, 14 * k, i % 2 ? '#fff2f6' : '#ff8ab0', 0); blob(c, x, y - 40 * k, 20 * k, 15 * k, '#ff8ab0', 3 * k); blob(c, x, y - 44 * k, 14 * k, 4 * k, '#fff2f6'); },
    front: (c, x, y, k) => { c.fillStyle = '#ff7aa2'; c.beginPath(); c.ellipse(x, y - 20 * k, 30 * k, 13 * k, 0, Math.PI, Math.PI * 2); c.fill(); c.lineWidth = 3 * k; c.strokeStyle = OUT; c.stroke(); },
    over: (c, x, y, k) => {
      // goggles on the forehead + a tiny crown
      for (const sx of [-1, 1]) { blob(c, x + sx * 10 * k, y - 22 * k, 8 * k, 6 * k, '#bfe8ff', 2.5 * k); }
      c.lineWidth = 3 * k; c.strokeStyle = '#c88aff'; c.beginPath(); c.moveTo(x - 30 * k, y - 20 * k); c.lineTo(x + 30 * k, y - 20 * k); c.stroke();
      c.fillStyle = '#ffd34a'; c.beginPath(); c.moveTo(x + 6 * k, y - 46 * k); c.lineTo(x + 9 * k, y - 56 * k); c.lineTo(x + 13 * k, y - 49 * k); c.lineTo(x + 17 * k, y - 57 * k); c.lineTo(x + 20 * k, y - 46 * k); c.closePath(); c.fill(); c.lineWidth = 2 * k; c.strokeStyle = OUT; c.stroke();
      c.fillStyle = '#fffdf8'; c.beginPath(); c.moveTo(x - 22 * k, y + 40 * k); c.lineTo(x - 6 * k, y + 60 * k); c.lineTo(x - 30 * k, y + 64 * k); c.fill();
      c.beginPath(); c.moveTo(x + 22 * k, y + 40 * k); c.lineTo(x + 6 * k, y + 60 * k); c.lineTo(x + 30 * k, y + 64 * k); c.fill();
    },
  },
  noki: {
    skin: '#ece2f2', cloth: '#2a1f30', eye: '#c8203a',
    back: (c, x, y, k) => { blob(c, x, y - 4 * k, 36 * k, 38 * k, '#2a1f30', 3 * k); },
    front: (c, x, y, k) => {
      c.fillStyle = '#2a1f30'; c.beginPath(); c.moveTo(x - 32 * k, y - 4 * k); c.quadraticCurveTo(x - 20 * k, y - 40 * k, x + 4 * k, y - 32 * k); c.quadraticCurveTo(x + 30 * k, y - 32 * k, x + 32 * k, y - 2 * k); c.lineTo(x + 14 * k, y - 20 * k); c.lineTo(x - 2 * k, y - 12 * k); c.lineTo(x - 16 * k, y - 22 * k); c.closePath(); c.fill();
      c.fillStyle = '#c8203a'; c.fillRect(x + 8 * k, y - 34 * k, 5 * k, 20 * k);
    },
    over: (c, x, y, k) => { c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(x + 3 * k, y + 15 * k); c.lineTo(x + 6 * k, y + 22 * k); c.lineTo(x + 8 * k, y + 15 * k); c.fill(); c.lineWidth = 1.5 * k; c.strokeStyle = OUT; c.stroke(); blob(c, x, y + 33 * k, 16 * k, 3 * k, '#1a1418'); },
  },
  pryanik: {
    skin: '#c8803e', cloth: '#7a3a2a',
    over: (c, x, y, k) => {
      c.lineWidth = 3 * k; c.strokeStyle = '#ffffff'; c.beginPath(); c.arc(x, y - 4 * k, 26 * k, Math.PI * 0.2, Math.PI * 0.8); c.stroke();
      // cookie-cutter helmet
      c.fillStyle = '#d8dce8'; c.beginPath(); c.moveTo(x - 30 * k, y - 16 * k); c.lineTo(x - 22 * k, y - 40 * k); c.lineTo(x - 8 * k, y - 34 * k); c.lineTo(x, y - 48 * k); c.lineTo(x + 8 * k, y - 34 * k); c.lineTo(x + 22 * k, y - 40 * k); c.lineTo(x + 30 * k, y - 16 * k); c.closePath(); c.fill(); c.lineWidth = 3 * k; c.strokeStyle = OUT; c.stroke();
    },
  },
  iriska: {
    skin: '#e0a060', cloth: '#fffdf8',
    back: (c, x, y, k) => { blob(c, x, y - 18 * k, 32 * k, 24 * k, '#8a4a1a', 3 * k); },
    over: (c, x, y, k) => {
      for (const sx of [-1, 1]) { c.lineWidth = 4 * k; c.strokeStyle = '#3a2a2a'; c.beginPath(); c.arc(x + sx * 11 * k, y - 2 * k, 11 * k, 0, Math.PI * 2); c.stroke(); }
      c.beginPath(); c.moveTo(x - 1 * k, y - 4 * k); c.lineTo(x + 1 * k, y - 4 * k); c.stroke();
      c.fillStyle = 'rgba(40,30,30,0.45)'; for (const [dx, dy, s] of [[-18, 12, 5], [16, -14, 4], [6, 20, 3]] as const) { c.beginPath(); c.arc(x + dx * k, y + dy * k, s * k, 0, Math.PI * 2); c.fill(); }
    },
  },
  zefirych: {
    skin: '#fff8fa', cloth: '#6a6a9a',
    over: (c, x, y, k) => { blob(c, x - 9 * k, y + 10 * k, 12 * k, 6 * k, '#ffffff', 2 * k, 0.3); blob(c, x + 9 * k, y + 10 * k, 12 * k, 6 * k, '#ffffff', 2 * k, -0.3); blob(c, x, y - 30 * k, 30 * k, 10 * k, '#4a4a7a', 3 * k); blob(c, x, y - 38 * k, 20 * k, 10 * k, '#4a4a7a', 3 * k); },
  },
  beze: {
    skin: '#fffaf6', cloth: '#ff9fc0', wide: 1.12,
    over: (c, x, y, k) => { for (let i = 0; i < 4; i++) blob(c, x, y - 34 * k - i * 7 * k, (22 - i * 5) * k, 8 * k, '#ffffff', 2.5 * k); },
  },
  ponchik: {
    skin: '#e8a050', cloth: '#3a6ad8',
    over: (c, x, y, k) => {
      c.fillStyle = '#ff9fc8'; c.beginPath(); c.ellipse(x, y - 18 * k, 30 * k, 15 * k, 0, Math.PI, Math.PI * 2); c.fill();
      for (let i = 0; i < 7; i++) { c.fillStyle = ['#ffd34a', '#7ad8ff', '#ffffff', '#9af08a'][i % 4]; c.fillRect(x - 20 * k + i * 6 * k, y - 26 * k + (i % 2) * 4 * k, 4 * k, 1.6 * k); }
      blob(c, x, y - 34 * k, 22 * k, 8 * k, '#3a6ad8', 3 * k);
    },
  },
  marmeladka: {
    skin: '#7ae07a', cloth: '#3aa84a',
    over: (c, x, y, k) => { for (const [dx, dy] of [[-14, -16], [12, -20], [-4, -26], [18, -6], [-20, -2]] as const) { c.fillStyle = 'rgba(255,255,255,0.7)'; c.beginPath(); c.arc(x + dx * k, y + dy * k, 2 * k, 0, Math.PI * 2); c.fill(); } blob(c, x + 14 * k, y - 28 * k, 7 * k, 5 * k, '#ff5a8a', 2 * k); },
  },
  zhitel: { skin: '#ffd6e4', cloth: '#7ad8ff', over: (c, x, y, k) => blob(c, x, y - 30 * k, 22 * k, 7 * k, '#ff7aa8', 2.5 * k) },
  presnyak: { skin: '#c8c8cc', cloth: '#8a8a90', eye: '#4a4a52' },
};
