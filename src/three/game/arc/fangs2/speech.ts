import { W, H, clamp, ease } from '../../../../engine/util';
import { rrect, text, wrap, OUT } from '../../../../art/draw';
import { WHO_INFO, type Who } from '../../../../art/characters';
import { Dialog } from '../../../../ui/dialog';
import type { Waiter } from '../../../../game/coroutine';
import type { Level3D } from '../../level';
import { drawFace as townFace, type SpeakerId } from '../town/speech';

/**
 * Speakers of «Туманные топи». Тоша / Бублик / the narrator are the game's own dialog speakers (`Who`); Пастила and Ноки
 * use the candy-town portraits (town/speech.ts drawFace); Камыш, Мадам Морок and Матушка Светлячиха have their own here.
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
  kamysh: { name: 'Камыш', color: '#3f7a3a', bg: '#e0f0d0' },
  morok: { name: 'Мадам Морок', color: '#6a2a8a', bg: '#e8dcf0' },
  svetlyachikha: { name: 'Матушка Светлячиха', color: '#c89a10', bg: '#fff6c8' },
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

const blob = (c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, lw = 0, rot = 0) => {
  c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); c.fill();
  if (lw) { c.lineWidth = lw; c.strokeStyle = OUT; c.stroke(); }
};

/** a round portrait */
export function face(ctx: CanvasRenderingContext2D, id: Spk, cx: number, cy: number, r: number, t: number, talk: number, expr?: string) {
  if (id === 'pastila' || id === 'noki' || id === 'tosha' || id === 'bublik' || id === 'narrator') { townFace(ctx, id as SpeakerId, cx, cy, r, t, talk, expr); return; }
  const sp = SPK[id];
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = sp.bg; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 8; i++) { const a = t * 0.3 + (i / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, a + 0.25); ctx.closePath(); ctx.fill(); }
  const k = r / 50;
  if (id === 'kamysh') kamysh(ctx, cx, cy + 6 * k, k, t, talk, expr);
  else if (id === 'morok') morok(ctx, cx, cy + 4 * k, k, t, talk, expr);
  else svetl(ctx, cx, cy + 4 * k, k, t, talk, expr);
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 5; ctx.strokeStyle = OUT; ctx.stroke();
  ctx.lineWidth = 2.5; ctx.strokeStyle = sp.color; ctx.beginPath(); ctx.arc(cx, cy, r - 4, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/** an old frog ferryman: droopy lids, a straw hat, a reed in the corner of his mouth */
function kamysh(c: CanvasRenderingContext2D, x: number, y: number, k: number, t: number, talk: number, expr?: string) {
  blob(c, x, y + 44 * k, 42 * k, 24 * k, '#6a5a3a', 3 * k); // vest
  blob(c, x, y + 8 * k, 38 * k, 28 * k, '#7fb35a', 3 * k); // head
  blob(c, x, y + 20 * k, 30 * k, 12 * k, '#c8e0a0'); // chin
  const happy = expr === 'happy', sad = expr === 'sad';
  for (const s of [-1, 1]) {
    const ex = x + s * 18 * k, ey = y - 16 * k;
    blob(c, ex, ey, 13 * k, 13 * k, '#7fb35a', 3 * k);
    blob(c, ex, ey, 9 * k, 9 * k, '#fff8d8');
    blob(c, ex, ey + 1 * k, 4 * k, 5 * k, '#1b1214');
    // droopy lids (sad: lower)
    c.fillStyle = '#6a9a4a'; c.beginPath(); c.ellipse(ex, ey - (happy ? 7 : sad ? 2 : 4) * k, 10.5 * k, 8 * k, 0, Math.PI, Math.PI * 2); c.fill();
    c.lineWidth = 2.5 * k; c.strokeStyle = OUT; c.stroke();
  }
  // mouth
  c.lineWidth = 3 * k; c.strokeStyle = OUT; c.beginPath();
  if (talk > 0.15) { blob(c, x, y + 14 * k, 14 * k, (3 + talk * 6) * k, '#7a2a2e', 2.5 * k); }
  else if (sad) c.arc(x, y + 22 * k, 16 * k, Math.PI * 1.15, Math.PI * 1.85);
  else c.arc(x, y + 6 * k, 18 * k, Math.PI * 0.2, Math.PI * 0.8);
  c.stroke();
  // reed
  c.strokeStyle = '#c8a050'; c.lineWidth = 3 * k; c.beginPath(); c.moveTo(x + 18 * k, y + 14 * k); c.lineTo(x + 36 * k, y + 2 * k + Math.sin(t * 2) * 2 * k); c.stroke();
  // straw hat
  blob(c, x, y - 32 * k, 44 * k, 9 * k, '#e0c070', 3 * k);
  c.fillStyle = '#e8cc7a'; c.beginPath(); c.ellipse(x, y - 36 * k, 22 * k, 16 * k, 0, Math.PI, Math.PI * 2); c.fill(); c.lineWidth = 3 * k; c.strokeStyle = OUT; c.stroke();
  c.fillStyle = '#8a3a2a'; c.fillRect(x - 22 * k, y - 38 * k, 44 * k, 5 * k);
}

/** the veiled lady: pale lavender, black lace over red eyes, a crow on her shoulder */
function morok(c: CanvasRenderingContext2D, x: number, y: number, k: number, t: number, talk: number, expr?: string) {
  blob(c, x, y + 48 * k, 40 * k, 24 * k, '#3a1f4e', 3 * k); // gown
  c.fillStyle = '#6a2a8a'; c.beginPath(); c.moveTo(x - 14 * k, y + 28 * k); c.lineTo(x, y + 44 * k); c.lineTo(x + 14 * k, y + 28 * k); c.fill();
  blob(c, x, y + 4 * k, 26 * k, 30 * k, '#e2d4ee', 3 * k); // face
  const scared = expr === 'scared', sly = expr === 'sly';
  for (const s of [-1, 1]) {
    const ex = x + s * 10 * k, ey = y - 2 * k;
    blob(c, ex, ey, 6 * k, (scared ? 8 : 5) * k, '#fff2f2', 2 * k);
    blob(c, ex + (sly ? 2 * k : 0), ey + 1 * k, 3 * k, 3.5 * k, '#d0202e');
    c.lineWidth = 2.5 * k; c.strokeStyle = OUT; c.beginPath();
    if (sly) { c.moveTo(ex - 7 * k, ey - 6 * k); c.lineTo(ex + 7 * k, ey - 8 * k + s * 2 * k); }
    else { c.moveTo(ex - 7 * k, ey - 8 * k); c.lineTo(ex + 7 * k, ey - 8 * k); }
    c.stroke();
  }
  // lips (dark plum) / mouth
  if (talk > 0.15 || scared) blob(c, x, y + 16 * k, 6 * k, (scared ? 6 : 2 + talk * 4) * k, '#4a0a2a', 2 * k);
  else { c.lineWidth = 3 * k; c.strokeStyle = '#5a1a4a'; c.beginPath(); c.arc(x, y + 10 * k, 8 * k, Math.PI * 0.2, Math.PI * 0.8); c.stroke(); }
  // the veil: black lace over the upper face
  c.fillStyle = 'rgba(20,10,28,0.55)';
  c.beginPath(); c.moveTo(x - 30 * k, y - 26 * k); c.lineTo(x + 30 * k, y - 26 * k); c.lineTo(x + 24 * k, y + 8 * k); c.lineTo(x - 24 * k, y + 8 * k); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(20,10,28,0.7)'; c.lineWidth = 1 * k;
  for (let i = -3; i <= 3; i++) { c.beginPath(); c.moveTo(x + i * 8 * k, y - 26 * k); c.lineTo(x + i * 7 * k, y + 8 * k); c.stroke(); }
  for (let j = 0; j < 4; j++) { c.beginPath(); c.moveTo(x - 28 * k, y - 18 * k + j * 8 * k); c.lineTo(x + 28 * k, y - 18 * k + j * 8 * k); c.stroke(); }
  // hat with a feather
  blob(c, x, y - 28 * k, 36 * k, 7 * k, '#2a1438', 3 * k);
  c.fillStyle = '#2a1438'; c.beginPath(); c.ellipse(x + 2 * k, y - 32 * k, 18 * k, 12 * k, 0, Math.PI, Math.PI * 2); c.fill(); c.stroke();
  c.strokeStyle = '#8a3ab0'; c.lineWidth = 4 * k; c.beginPath(); c.moveTo(x + 12 * k, y - 36 * k); c.quadraticCurveTo(x + 30 * k, y - 56 * k, x + 40 * k, y - 46 * k); c.stroke();
  // the crow on her shoulder
  const cx = x - 36 * k, cy = y + 20 * k + Math.sin(t * 2) * 1.5 * k;
  blob(c, cx, cy, 11 * k, 9 * k, '#1a1420', 2 * k);
  blob(c, cx + 4 * k, cy - 10 * k, 7 * k, 7 * k, '#1a1420', 2 * k);
  c.fillStyle = '#e0a020'; c.beginPath(); c.moveTo(cx + 10 * k, cy - 11 * k); c.lineTo(cx + 18 * k, cy - 9 * k); c.lineTo(cx + 10 * k, cy - 7 * k); c.fill();
  blob(c, cx + 6 * k, cy - 12 * k, 1.8 * k, 1.8 * k, '#ff3030');
}

/** a huge kind firefly: round dark face, feathery antennae, glowing */
function svetl(c: CanvasRenderingContext2D, x: number, y: number, k: number, t: number, talk: number, expr?: string) {
  const glowK = 0.7 + 0.3 * Math.sin(t * 3);
  const g = c.createRadialGradient(x, y + 30 * k, 4 * k, x, y + 30 * k, 50 * k);
  g.addColorStop(0, `rgba(255,240,120,${0.9 * glowK})`); g.addColorStop(1, 'rgba(255,220,80,0)');
  c.fillStyle = g; c.fillRect(x - 60 * k, y - 30 * k, 120 * k, 110 * k);
  blob(c, x, y + 44 * k, 30 * k, 20 * k, '#ffe86a', 3 * k); // the glowing belly
  for (const s of [-1, 1]) blob(c, x + s * 34 * k, y + 4 * k, 18 * k, 30 * k, 'rgba(140,90,160,0.85)', 2.5 * k, s * 0.5); // velvet wings
  blob(c, x, y + 4 * k, 28 * k, 26 * k, '#4a3a5a', 3 * k); // head
  const happy = expr === 'happy';
  for (const s of [-1, 1]) {
    const ex = x + s * 11 * k, ey = y + 0 * k;
    if (happy) { c.lineWidth = 3.5 * k; c.strokeStyle = '#fff6c0'; c.beginPath(); c.arc(ex, ey + 2 * k, 6 * k, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); }
    else { blob(c, ex, ey, 7 * k, 8 * k, '#fff6d8', 2 * k); blob(c, ex, ey + 1 * k, 3.5 * k, 4.5 * k, '#1b1214'); }
    // feathery antennae
    c.strokeStyle = '#2a1f30'; c.lineWidth = 2.5 * k; c.beginPath(); c.moveTo(x + s * 8 * k, y - 20 * k); c.quadraticCurveTo(x + s * 20 * k, y - 46 * k, x + s * 30 * k, y - 44 * k); c.stroke();
    blob(c, x + s * 30 * k, y - 44 * k, 5 * k, 3 * k, '#ffe86a');
  }
  if (talk > 0.15) blob(c, x, y + 14 * k, 6 * k, (2 + talk * 4) * k, '#2a1018', 2 * k);
  else { c.lineWidth = 3 * k; c.strokeStyle = '#fff2b0'; c.beginPath(); c.arc(x, y + 9 * k, 7 * k, Math.PI * 0.2, Math.PI * 0.8); c.stroke(); }
  blob(c, x - 16 * k, y + 10 * k, 4 * k, 2.5 * k, 'rgba(255,140,170,0.6)');
  blob(c, x + 16 * k, y + 10 * k, 4 * k, 2.5 * k, 'rgba(255,140,170,0.6)');
}
