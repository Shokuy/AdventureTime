import * as THREE from 'three';
import { W, H, clamp, ease } from '../../../../engine/util';
import { rrect, text, wrap, OUT } from '../../../../art/draw';
import { Dialog } from '../../../../ui/dialog';
import type { Waiter } from '../../../../game/coroutine';
import type { Level3D } from '../../level';
import { say as townSay, installSpeech } from '../town/speech';
import { drawPortrait, PORTRAIT_INFO } from '../../../../art/portraits';

/**
 * Dialog lines of the episode (docs/script-fangs.md §7). Тоша / Бублик / Пастила / Ноки / the narrator speak through the
 * town's speakers (arc/town/speech.ts); Шёпот gets his own box: dark, italic, a portrait of two eyes in the dark —
 * or, once he is seen (the defeat scene), the little eared vampire. The story cast's mouths move with their lines.
 */
export type Spk = 'tosha' | 'bublik' | 'noki' | 'pastila' | 'narrator' | 'shepot' | 'polnoch';

/** v2 §0: Шёпот's name in the box turns into «Шуршик» from the line «…она велела отдать…» on (flag `f3:named`) */
export const NAMED = 'f3:named';

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
    else if (s && s.who === 'polnoch' && d.who === 'narrator' && d.str === s.str) drawKing(d, ctx);
    else orig(ctx);
  };
}

/** a line of the script (a Waiter for scripts, like L.say) */
export function say(L: Level3D, who: Spk, str: string, expr?: string): Waiter {
  install(L);
  const s = st(L);
  s.who = who; s.str = str;
  if (who === 'shepot' || who === 'polnoch') return townSay(L, 'narrator', str, expr); // (the town's speaker map forgets the last one)
  return townSay(L, who, str, expr);
}

/** every frame: the cast figure of the speaker moves its mouth while its line types out (Пастила / Ноки: the town's
 *  speakers talk as 'narrator', which the level's own talk hook doesn't map to a figure) */
export function castMouths(L: Level3D) {
  const d = L.dialog, s = state.get(L);
  if (!s || !d.active || d.str !== s.str || d.shown >= d.str.length) return;
  // (a voice from the air / the mirror: nobody on stage moves their mouth)
  if (s.who === 'shepot' || s.who === 'polnoch' || s.who === 'narrator') { for (const k of ['tosha', 'bublik', 'noki', 'pastila']) { const m = L.npcs[k]; if (m) m.talk = 0; } return; }
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
  const name = L.seen.has(NAMED) ? 'Шуршик' : 'Шёпот';
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

// ───────────────────────── the King's box (his voice from the mirror, §7.6) ─────────────────────────
function drawKing(d: Dialog, ctx: CanvasRenderingContext2D) {
  if (d.appear <= 0) return;
  const info = PORTRAIT_INFO.polnoch;
  const a = ease.outBack(clamp(d.appear, 0, 1));
  const bw = 1060, bh = Dialog.BOX_H;
  const bx = (W - bw) / 2, by = d.top ? 30 - (1 - a) * 80 : H - bh - 26 + (1 - a) * 80;
  ctx.save();
  ctx.globalAlpha = clamp(d.appear * 1.5, 0, 1);
  rrect(ctx, bx + 6, by + 8, bw, bh, 22, 'rgba(0,0,0,0.4)', 0);
  rrect(ctx, bx, by, bw, bh, 22, '#fff7e6', 5);
  drawPortrait(ctx, 'polnoch', bx + 86, by + bh / 2 - 6, 62, d.t, d.shown < d.str.length ? Math.abs(Math.sin(d.t * 16)) : 0, d.expr);
  ctx.font = '900 20px Rubik, sans-serif';
  const nw = ctx.measureText(info.name).width + 30;
  rrect(ctx, bx + 160, by - 18, nw, 34, 12, info.color, 4);
  text(ctx, info.name, bx + 175, by + 6, { size: 20, color: '#fff', stroke: 0 });
  const tx = bx + 170, maxW = bw - 170 - 40;
  ctx.font = '400 27px Pangolin, "Comic Sans MS", sans-serif';
  const lines = wrap(ctx, d.str, maxW);
  let remaining = Math.floor(d.shown);
  lines.forEach((ln, i) => {
    const part = ln.slice(0, Math.max(0, remaining));
    remaining -= ln.length + 1;
    text(ctx, part, tx, by + 50 + i * 34, { size: 27, font: 'body', color: OUT });
  });
  if (d.shown >= d.str.length && d.active) text(ctx, '▼', bx + bw - 36, by + bh - 20 + Math.sin(d.t * 6) * 4, { size: 22, color: info.color, align: 'center' });
  ctx.restore();
}

/** Шёпот's round portrait: eyes and ears in the dark — or the little vampire himself once he has been seen (art/portraits.ts) */
export function drawShepotFace(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: number, talk: number, seen: boolean, expr?: string) {
  drawPortrait(ctx, 'shepot', cx, cy, r, t, talk, expr, seen ? 'seen' : undefined);
}
void THREE;

/** who of this episode's own speakers is typing a line right now (the King's face in the mirror moves its mouth) */
export function speakingNow(L: Level3D): Spk | null {
  const d = L.dialog, s = state.get(L);
  if (!s || !d.active || d.str !== s.str || d.shown >= d.str.length) return null;
  return s.who;
}
