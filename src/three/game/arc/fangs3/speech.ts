import * as THREE from 'three';
import { W, H, clamp, ease } from '../../../../engine/util';
import { rrect, text, wrap } from '../../../../art/draw';
import { Dialog } from '../../../../ui/dialog';
import type { Waiter } from '../../../../game/coroutine';
import type { Level3D } from '../../level';
import { say as townSay, installSpeech } from '../town/speech';

/**
 * Dialog lines of the episode (docs/script-fangs.md §7). Тоша / Бублик / Пастила / Ноки / the narrator speak through the
 * town's speakers (arc/town/speech.ts); Шёпот gets his own box: dark, italic, a portrait of two eyes in the dark —
 * or, once he is seen (the defeat scene), the little eared vampire. The story cast's mouths move with their lines.
 */
export type Spk = 'tosha' | 'bublik' | 'noki' | 'pastila' | 'narrator' | 'shepot';

interface SpeechState { str: string; who: Spk; shepotSeen: boolean }
const state = new WeakMap<Level3D, SpeechState>();
const mine = new WeakSet<Dialog>();

/** Шёпот's portrait shows the little vampire (after the reveal) instead of eyes in the dark */
export function shepotSeen(L: Level3D, on: boolean) { st(L).shepotSeen = on; }

function st(L: Level3D): SpeechState {
  let s = state.get(L);
  if (!s) { s = { str: '', who: 'narrator', shepotSeen: false }; state.set(L, s); }
  return s;
}

function install(L: Level3D) {
  const d = L.dialog;
  if (mine.has(d)) return;
  installSpeech(L); // (the town's box first: mine wraps it, so a Шёпот line is drawn by me whatever the town thinks)
  mine.add(d);
  const orig = d.draw.bind(d);
  d.draw = (ctx: CanvasRenderingContext2D) => {
    const s = state.get(L);
    if (s && s.who === 'shepot' && d.who === 'narrator' && d.str === s.str) drawShepot(L, d, ctx, s);
    else orig(ctx);
  };
}

/** a line of the script (a Waiter for scripts, like L.say) */
export function say(L: Level3D, who: Spk, str: string, expr?: string): Waiter {
  install(L);
  const s = st(L);
  s.who = who; s.str = str;
  if (who === 'shepot') return L.say('narrator', str, expr);
  return townSay(L, who, str, expr);
}

/** every frame: the cast figure of the speaker moves its mouth while its line types out (Пастила / Ноки: the town's
 *  speakers talk as 'narrator', which the level's own talk hook doesn't map to a figure) */
export function castMouths(L: Level3D) {
  const d = L.dialog, s = state.get(L);
  if (!s || !d.active || d.str !== s.str || d.shown >= d.str.length) return;
  const n = L.npcs[s.who];
  if (n && (s.who === 'pastila' || s.who === 'noki')) n.talk = 0.35;
}

// ───────────────────────── Шёпот's box ─────────────────────────
function drawShepot(L: Level3D, d: Dialog, ctx: CanvasRenderingContext2D, s: SpeechState) {
  if (d.appear <= 0) return;
  const a = ease.outBack(clamp(d.appear, 0, 1));
  const bw = 1060, bh = Dialog.BOX_H;
  const bx = (W - bw) / 2, by = d.top ? 30 - (1 - a) * 80 : H - bh - 26 + (1 - a) * 80;
  ctx.save();
  ctx.globalAlpha = clamp(d.appear * 1.5, 0, 1);
  rrect(ctx, bx + 6, by + 8, bw, bh, 22, 'rgba(0,0,0,0.45)', 0);
  rrect(ctx, bx, by, bw, bh, 22, '#1c1830', 5);
  // a cold shimmer running over the box
  const g = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
  const k = (L.t * 0.25) % 1;
  g.addColorStop(Math.max(0, k - 0.15), 'rgba(160,190,255,0)');
  g.addColorStop(k, 'rgba(160,190,255,0.10)');
  g.addColorStop(Math.min(1, k + 0.15), 'rgba(160,190,255,0)');
  ctx.fillStyle = g; ctx.fillRect(bx + 4, by + 4, bw - 8, bh - 8);
  drawShepotFace(ctx, bx + 86, by + bh / 2 - 6, 62, d.t, d.shown < d.str.length ? Math.abs(Math.sin(d.t * 14)) : 0, s.shepotSeen, d.expr);
  ctx.font = '900 20px Rubik, sans-serif';
  const name = 'Шёпот';
  const nw = ctx.measureText(name).width + 30;
  rrect(ctx, bx + 160, by - 18, nw, 34, 12, '#5a4a8a', 4);
  text(ctx, name, bx + 175, by + 6, { size: 20, color: '#e8e0ff', stroke: 0 });
  const tx = bx + 170, maxW = bw - 170 - 40;
  ctx.font = 'italic 400 27px Pangolin, "Comic Sans MS", sans-serif';
  const lines = wrap(ctx, d.str, maxW);
  let remaining = Math.floor(d.shown);
  lines.forEach((ln, i) => {
    const part = ln.slice(0, Math.max(0, remaining));
    remaining -= ln.length + 1;
    ctx.save();
    ctx.globalAlpha *= 0.85 + Math.sin(L.t * 3 + i) * 0.1;
    ctx.font = 'italic 400 27px Pangolin, "Comic Sans MS", sans-serif';
    ctx.fillStyle = '#d8d4f4';
    ctx.textBaseline = 'middle';
    ctx.fillText(part, tx, by + 50 + i * 34);
    ctx.restore();
  });
  if (d.shown >= d.str.length && d.active) text(ctx, '▼', bx + bw - 36, by + bh - 20 + Math.sin(d.t * 6) * 4, { size: 22, color: '#9a8ad8', align: 'center' });
  ctx.restore();
}

/** Шёпот's round portrait: eyes and ears in the dark — or the little vampire himself once he has been seen */
export function drawShepotFace(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: number, talk: number, seen: boolean, expr?: string) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = seen ? '#3a3260' : '#0e0c18'; ctx.fill();
  ctx.save(); ctx.clip();
  const k = r / 50;
  if (!seen) {
    // a heat haze, two pale eyes, the tips of big ears
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = `rgba(150,170,230,${0.08 + 0.05 * Math.sin(t * 2 + i)})`; ctx.lineWidth = 3 * k;
      ctx.beginPath(); ctx.ellipse(cx + Math.sin(t + i) * 4 * k, cy + 6 * k, (18 + i * 6) * k, (24 + i * 5) * k, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(190,200,255,0.18)';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + s * 14 * k, cy - 18 * k); ctx.lineTo(cx + s * 34 * k, cy - 46 * k); ctx.lineTo(cx + s * 28 * k, cy - 10 * k); ctx.closePath(); ctx.fill(); }
    const blink = Math.sin(t * 0.9) > 0.97 ? 0.15 : 1;
    for (const s of [-1, 1]) {
      const g = ctx.createRadialGradient(cx + s * 11 * k, cy, 0, cx + s * 11 * k, cy, 12 * k);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.4, 'rgba(200,215,255,0.7)'); g.addColorStop(1, 'rgba(120,140,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx + s * 11 * k, cy, 12 * k, 12 * k * blink, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (talk > 0.15) { ctx.fillStyle = 'rgba(200,210,255,0.35)'; ctx.beginPath(); ctx.ellipse(cx, cy + 18 * k, 5 * k, (1 + talk * 3) * k, 0, 0, Math.PI * 2); ctx.fill(); }
  } else {
    // the little eared vampire in a cloak far too big for him
    ctx.fillStyle = '#1a1424'; ctx.beginPath(); ctx.ellipse(cx, cy + 52 * k, 46 * k, 30 * k, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c8bce4';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + s * 10 * k, cy - 12 * k); ctx.quadraticCurveTo(cx + s * 44 * k, cy - 40 * k, cx + s * 40 * k, cy + 4 * k); ctx.closePath(); ctx.fill(); ctx.lineWidth = 2.5 * k; ctx.strokeStyle = '#2a1b2a'; ctx.stroke(); }
    ctx.fillStyle = '#f0a8c8';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + s * 14 * k, cy - 10 * k); ctx.quadraticCurveTo(cx + s * 36 * k, cy - 30 * k, cx + s * 34 * k, cy - 2 * k); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = '#d8cef0'; ctx.beginPath(); ctx.ellipse(cx, cy + 6 * k, 22 * k, 24 * k, 0, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 3 * k; ctx.strokeStyle = '#2a1b2a'; ctx.stroke();
    const scared = expr === 'scared' || expr === 'sad';
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(cx + s * 8 * k, cy + 2 * k, 6 * k, 8 * k, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c0203a'; ctx.beginPath(); ctx.ellipse(cx + s * 8 * k, cy + (scared ? 4 : 3) * k, 3 * k, 4 * k, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (scared) { ctx.fillStyle = 'rgba(140,200,255,0.8)'; ctx.beginPath(); ctx.ellipse(cx + 14 * k, cy + 12 * k, 2 * k, 3.5 * k, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#2a1b2a'; ctx.lineWidth = 2.5 * k; ctx.beginPath();
    if (talk > 0.15) ctx.ellipse(cx, cy + 16 * k, 4 * k, (1 + talk * 3) * k, 0, 0, Math.PI * 2);
    else ctx.arc(cx, cy + 20 * k, 5 * k, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + s * 3 * k, cy + 17 * k); ctx.lineTo(cx + s * 4.5 * k, cy + 22 * k); ctx.lineTo(cx + s * 6 * k, cy + 17 * k); ctx.fill(); }
  }
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 5; ctx.strokeStyle = '#0a0812'; ctx.stroke();
  ctx.lineWidth = 2.5; ctx.strokeStyle = '#8a7ad8'; ctx.beginPath(); ctx.arc(cx, cy, r - 4, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
void THREE;
