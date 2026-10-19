import { W, H, clamp, ease } from '../../../../engine/util';
import { rrect, text, wrap, OUT } from '../../../../art/draw';
import { WHO_INFO, drawPortrait, type Who } from '../../../../art/characters';
import { Dialog } from '../../../../ui/dialog';
import type { Waiter } from '../../../../game/coroutine';
import type { Level3D } from '../../level';
import { drawFace, type SpeakerId as TownSpeaker } from '../town/speech';

/**
 * Speakers of «Замок Полночь» (docs/script-fangs.md §0). Тоша / Бублик / Вторник / the narrator are the game's own
 * dialog speakers (`Who`); everyone else talks through the same dialog box (same timing, co-op auto-advance, the
 * scene watchdog) drawn with a portrait of their own: the town's candy faces (town/speech.ts drawFace) for Пастила,
 * Ноки and the townsfolk, and the faces below for the King, the five little bats and Граф Кислоплюй's letter.
 */

export type SpeakerId = 'tosha' | 'bublik' | 'bear' | 'narrator' | 'pastila' | 'noki' | 'polnoch' | 'kisloplyu'
  | 'netopyr' | 'morok' | 'shepot' | 'nochka' | 'tenka' | 'zefirych' | 'beze' | 'ponchik' | 'marmeladka';

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
  polnoch: { name: 'Король Полночь', color: '#5a4a7a', bg: '#d8d4e4' },
  kisloplyu: { name: 'Граф Кислоплюй', color: '#c8a010', bg: '#fff6b8' },
  netopyr: { name: 'Граф Нетопырь', color: '#6a3a8a', bg: '#e8dcf4' },
  morok: { name: 'Мадам Морок', color: '#3a6a5a', bg: '#dcf0e8' },
  shepot: { name: 'Шёпот', color: '#6a7a9a', bg: '#e4eaf4' },
  nochka: { name: 'Ночка', color: '#2a2a3a', bg: '#e0dce8' },
  tenka: { name: 'Тенька', color: '#9a5ac8', bg: '#f0e4fa' },
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

type C = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
const blob = (c: C, x: number, y: number, rx: number, ry: number, fill: string, lw = 0, rot = 0) => {
  c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, TAU); c.fill();
  if (lw) { c.lineWidth = lw; c.strokeStyle = OUT; c.stroke(); }
};

/** a round portrait for any speaker of this episode */
export function face(ctx: C, id: SpeakerId, cx: number, cy: number, r: number, t: number, talk: number, expr?: string) {
  const sp = SPEAKERS[id];
  if (sp.who) { drawPortrait(ctx, sp.who, cx, cy, r, t, talk, expr); return; }
  if (sp.town) { drawFace(ctx, sp.town, cx, cy, r, t, talk, expr); return; }
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
  ctx.fillStyle = sp.bg; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 8; i++) { const a = t * 0.3 + (i / 8) * TAU; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, a + 0.25); ctx.closePath(); ctx.fill(); }
  const k = r / 50;
  if (id === 'polnoch') king(ctx, cx, cy, k, t, talk, expr);
  else if (id === 'kisloplyu') envelope(ctx, cx, cy, k, t);
  else mouse(ctx, id, cx, cy, k, t, talk, expr);
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
  ctx.lineWidth = 5; ctx.strokeStyle = OUT; ctx.stroke();
  ctx.lineWidth = 2.5; ctx.strokeStyle = sp.color; ctx.beginPath(); ctx.arc(cx, cy, r - 4, 0, TAU); ctx.stroke();
  ctx.restore();
  void WHO_INFO;
}

/** Король Полночь: pale grey, a crescent crown, a collar of stolen shadows */
function king(c: C, x: number, y: number, k: number, t: number, talk: number, expr?: string) {
  // the cloak's high collar with silhouettes in it
  c.fillStyle = '#1e1830';
  c.beginPath(); c.moveTo(x - 46 * k, y + 60 * k); c.lineTo(x - 40 * k, y + 4 * k); c.lineTo(x - 18 * k, y + 30 * k); c.lineTo(x + 18 * k, y + 30 * k); c.lineTo(x + 40 * k, y + 4 * k); c.lineTo(x + 46 * k, y + 60 * k); c.closePath(); c.fill();
  c.lineWidth = 3 * k; c.strokeStyle = OUT; c.stroke();
  c.fillStyle = 'rgba(150,120,200,0.45)';
  for (const [dx, dy] of [[-32, 36], [30, 40], [-22, 52]] as const) { blob(c, x + dx * k, y + (dy - 7) * k, 3 * k, 3.5 * k, 'rgba(150,120,200,0.45)'); c.fillRect(x + (dx - 3) * k, y + (dy - 4) * k, 6 * k, 10 * k); }
  // long pale face
  blob(c, x, y + 4 * k, 24 * k, 33 * k, '#cfcfdb', 3 * k);
  // ears
  for (const s of [-1, 1]) { c.fillStyle = '#bdbdcb'; c.beginPath(); c.moveTo(x + s * 22 * k, y - 2 * k); c.lineTo(x + s * 36 * k, y - 14 * k); c.lineTo(x + s * 22 * k, y + 10 * k); c.closePath(); c.fill(); c.lineWidth = 2.5 * k; c.strokeStyle = OUT; c.stroke(); }
  // slicked silver hair + widow's peak
  c.fillStyle = '#8c8a9e'; c.beginPath(); c.moveTo(x - 25 * k, y - 4 * k); c.quadraticCurveTo(x - 22 * k, y - 34 * k, x, y - 30 * k); c.quadraticCurveTo(x + 22 * k, y - 34 * k, x + 25 * k, y - 4 * k); c.lineTo(x + 8 * k, y - 18 * k); c.lineTo(x, y - 8 * k); c.lineTo(x - 8 * k, y - 18 * k); c.closePath(); c.fill();
  // crescent crown
  c.fillStyle = '#e8e4f4'; c.beginPath(); c.arc(x, y - 38 * k, 14 * k, Math.PI * 0.85, Math.PI * 2.15); c.arc(x, y - 33 * k, 10 * k, Math.PI * 2.1, Math.PI * 0.9, true); c.closePath(); c.fill();
  c.lineWidth = 2.5 * k; c.strokeStyle = OUT; c.stroke();
  // eyes: empty silver with a red spark
  const sad = expr === 'sad', surprised = expr === 'surprised';
  for (const s of [-1, 1]) {
    const ex = x + s * 10 * k, ey = y - 2 * k;
    blob(c, ex, ey, 7 * k, (surprised ? 7 : 4.5) * k, '#f4f2ff', 2 * k);
    blob(c, ex, ey + 0.5 * k, 2 * k, 2 * k, '#d02040');
    c.lineWidth = 3 * k; c.strokeStyle = OUT; c.beginPath();
    if (sad) { c.moveTo(ex - 7 * k, ey - 6 * k + s * -2 * k); c.lineTo(ex + 7 * k, ey - 6 * k + s * 2 * k); }
    else { c.moveTo(ex - 7 * k, ey - 7 * k + s * 2 * k); c.lineTo(ex + 7 * k, ey - 7 * k - s * 2 * k); }
    c.stroke();
  }
  // a thin mouth, fangs when talking
  const my = y + 20 * k;
  if (talk > 0.15 || surprised) {
    blob(c, x, my, 7 * k, (2 + talk * 4 + (surprised ? 3 : 0)) * k, '#3a1424', 2 * k);
    c.fillStyle = '#fff'; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(x + s * 4 * k, my - 2 * k); c.lineTo(x + s * 2.5 * k, my + 3 * k); c.lineTo(x + s * 1 * k, my - 2 * k); c.fill(); }
  } else { c.lineWidth = 2.5 * k; c.strokeStyle = OUT; c.beginPath(); c.moveTo(x - 8 * k, my); c.lineTo(x + 8 * k, my + (sad ? 2 : -1) * k); c.stroke(); }
  void t;
}

/** the letter: a yellow envelope with a lemon seal (it «talks» by wobbling) */
function envelope(c: C, x: number, y: number, k: number, t: number) {
  c.save();
  c.translate(x, y + 6 * k); c.rotate(Math.sin(t * 3) * 0.05);
  rrect(c, -36 * k, -24 * k, 72 * k, 48 * k, 4 * k, '#ffe45a', 3 * k);
  c.lineWidth = 3 * k; c.strokeStyle = OUT; c.beginPath(); c.moveTo(-36 * k, -24 * k); c.lineTo(0, 4 * k); c.lineTo(36 * k, -24 * k); c.stroke();
  blob(c, 0, 4 * k, 10 * k, 8 * k, '#f2c818', 2.5 * k);
  blob(c, 0, 4 * k, 4 * k, 3 * k, '#9ad020');
  // sour steam
  c.strokeStyle = 'rgba(160,200,40,0.7)'; c.lineWidth = 3 * k;
  for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * 14 * k, -26 * k); c.quadraticCurveTo(s * 20 * k + Math.sin(t * 4) * 4 * k, -36 * k, s * 12 * k, -46 * k); c.stroke(); }
  c.restore();
}

/** the five little bats (the defeated lieutenants, §9.2.3) */
function mouse(c: C, id: SpeakerId, x: number, y: number, k: number, t: number, talk: number, expr?: string) {
  const fur = id === 'tenka' ? '#6a4a8a' : id === 'nochka' ? '#2a2236' : id === 'shepot' ? '#7a7a92' : id === 'morok' ? '#3a4a4a' : '#4a3266';
  // wings behind
  for (const s of [-1, 1]) {
    c.fillStyle = fur; c.beginPath(); c.moveTo(x + s * 14 * k, y + 8 * k); c.quadraticCurveTo(x + s * 44 * k, y - 20 * k + Math.sin(t * 8) * 4 * k, x + s * 52 * k, y + 14 * k);
    c.quadraticCurveTo(x + s * 40 * k, y + 10 * k, x + s * 34 * k, y + 22 * k); c.quadraticCurveTo(x + s * 26 * k, y + 14 * k, x + s * 14 * k, y + 24 * k); c.closePath(); c.fill();
    c.lineWidth = 2.5 * k; c.strokeStyle = OUT; c.stroke();
  }
  if (id === 'shepot') { c.fillStyle = '#2a2a3a'; c.beginPath(); c.moveTo(x - 40 * k, y + 64 * k); c.lineTo(x - 30 * k, y + 2 * k); c.lineTo(x + 30 * k, y + 2 * k); c.lineTo(x + 40 * k, y + 64 * k); c.closePath(); c.fill(); }
  blob(c, x, y + 12 * k, 22 * k, 20 * k, fur, 3 * k);
  for (const s of [-1, 1]) { c.fillStyle = fur; c.beginPath(); c.moveTo(x + s * 8 * k, y - 4 * k); c.lineTo(x + s * (id === 'shepot' ? 30 : 20) * k, y - (id === 'shepot' ? 30 : 22) * k); c.lineTo(x + s * 19 * k, y + 2 * k); c.closePath(); c.fill(); c.lineWidth = 2.5 * k; c.strokeStyle = OUT; c.stroke(); }
  const surprised = expr === 'surprised', sly = expr === 'sly';
  for (const s of [-1, 1]) {
    const ex = x + s * 8 * k, ey = y + 8 * k;
    const look = id === 'nochka' ? -2 : id === 'tenka' ? 2 : 0;
    blob(c, ex, ey, 5 * k, (surprised ? 7 : 6) * k, '#fff6e0', 2 * k);
    blob(c, ex + look * k + (sly ? 1.5 * k : 0), ey + 1 * k, 2.4 * k, 3 * k, '#d0202e');
  }
  if (id === 'netopyr') { c.lineWidth = 2 * k; c.strokeStyle = '#ffd34a'; c.beginPath(); c.arc(x + 8 * k, y + 8 * k, 7 * k, 0, TAU); c.stroke(); c.beginPath(); c.moveTo(x + 15 * k, y + 8 * k); c.lineTo(x + 18 * k, y + 26 * k); c.stroke(); }
  if (id === 'morok') { c.fillStyle = 'rgba(30,40,40,0.55)'; c.fillRect(x - 22 * k, y - 4 * k, 44 * k, 10 * k); blob(c, x + 14 * k, y - 16 * k, 6 * k, 5 * k, '#1a1a1a'); }
  if (id === 'nochka' || id === 'tenka') { const bc = id === 'nochka' ? '#111018' : '#c88aff'; for (const s of [-1, 1]) blob(c, x + s * 6 * k, y - 10 * k, 6 * k, 4 * k, bc, 2 * k, s * 0.5); }
  const my = y + 20 * k;
  blob(c, x, my, 4 * k, (1.5 + talk * 3) * k, '#4a0f1c');
  c.fillStyle = '#fff'; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(x + s * 3 * k, my - 1 * k); c.lineTo(x + s * 2 * k, my + 3 * k); c.lineTo(x + s * 1 * k, my - 1 * k); c.fill(); }
}
