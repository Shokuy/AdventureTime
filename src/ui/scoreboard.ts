import { W, H, clamp, ease, TAU } from '../engine/util';
import type { Action } from '../engine/input';
import { rrect, text, OUT, fillStroke } from '../art/draw';
import { drawGlyph } from './glyphs';
import { net } from '../net/session';

/**
 * Co-op score tables (feature 23): the hold-to-show scoreboard (Tab / Share), the PvP live board,
 * and the leader's crown. Pure drawing — the data comes from score.ts / pvp.ts.
 */

type C = CanvasRenderingContext2D;

export interface BoardCol { label: string; w: number }
export interface BoardRow {
  id: string;
  name: string;
  /** nameplate colour (look.tagColor) */
  color: string;
  cells: (string | number)[];
  me?: boolean;
  crown?: boolean;
  host?: boolean;
  /** round trip in ms (-1 unknown); omitted = no ping column value */
  ping?: number;
  /** how this player is linked to me; omitted = looked up in net.members by id */
  link?: NetLink;
  /** greyed out (left the room, downed…) */
  dim?: boolean;
}

/** a chunky golden crown centred at (x, y); s = 1 is about 32 px wide */
export function drawCrown(ctx: C, x: number, y: number, s = 1, t = 0, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.rotate(Math.sin(t * 2.2) * 0.06);
  // glow
  const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
  g.addColorStop(0, 'rgba(255,225,90,0.55)'); g.addColorStop(1, 'rgba(255,225,90,0)');
  ctx.fillStyle = g; ctx.fillRect(-26, -26, 52, 52);
  // body: band + three spikes
  ctx.beginPath();
  ctx.moveTo(-15, 9); ctx.lineTo(-16, -7); ctx.lineTo(-8, 0); ctx.lineTo(0, -12); ctx.lineTo(8, 0); ctx.lineTo(16, -7); ctx.lineTo(15, 9);
  ctx.closePath();
  const gr = ctx.createLinearGradient(0, -12, 0, 10);
  gr.addColorStop(0, '#fff3a0'); gr.addColorStop(0.5, '#ffd03a'); gr.addColorStop(1, '#d8901a');
  fillStroke(ctx, gr, 2.6);
  // band
  ctx.beginPath(); ctx.rect(-15, 4, 30, 5); ctx.fillStyle = '#e8a020'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = OUT; ctx.beginPath(); ctx.moveTo(-15, 4); ctx.lineTo(15, 4); ctx.stroke();
  // balls on the tips + a gem
  for (const [bx, by] of [[-16, -8], [0, -13], [16, -8]] as const) {
    ctx.beginPath(); ctx.arc(bx, by, 2.8, 0, TAU); fillStroke(ctx, '#fff6c8', 1.8);
  }
  ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); fillStroke(ctx, '#ff4a6a', 1.6);
  ctx.restore();
}

/** direct (peer to peer), through a TURN server (fast too), through the Supabase relay (slow, jerky), not up yet */
export type NetLink = 'p2p' | 'turn' | 'relay' | 'connecting';
const LINK_TEXT: Record<NetLink, [string, string]> = {
  p2p: ['прямая', '#9fc88a'], turn: ['через TURN', '#d8c878'], relay: ['через сервер', '#ff8a5a'], connecting: ['соединяемся…', '#a8949c'],
};

/** a member's link as the scoreboard shows it */
export function linkOf(id: string): NetLink | undefined {
  const m = net.members.get(id);
  if (!m || m.isMe) return undefined;
  return m.link === 'p2p' ? (m.turn ? 'turn' : 'p2p') : m.link;
}

/** ping as three bars + "45 мс" (-1 = not measured yet, 0 = me), then how we're linked («прямая» / «через сервер») */
export function drawPing(ctx: C, x: number, y: number, ping: number, alpha = 1, link?: NetLink) {
  const lvl = ping < 0 ? 0 : ping < 90 ? 3 : ping < 180 ? 2 : 1;
  const col = lvl === 3 ? '#7ad04a' : lvl === 2 ? '#ffd34a' : lvl === 1 ? '#ff6a5a' : '#8a7a80';
  for (let i = 0; i < 3; i++) {
    const h = 6 + i * 5;
    ctx.fillStyle = i < lvl ? col : 'rgba(255,255,255,0.18)';
    ctx.globalAlpha = alpha;
    ctx.fillRect(x + i * 7, y - h, 5, h);
  }
  ctx.globalAlpha = 1;
  text(ctx, ping < 0 ? '…' : `${Math.round(ping)} мс`, x + 26, y, { size: 15, font: 'body', color: col, alpha });
  if (link) {
    const [s, c] = LINK_TEXT[link];
    text(ctx, s, x + 92, y, { size: 13, font: 'body', color: c, alpha });
  }
}

const ROW_H = 44;
const NAME_W = 250;
const PING_W = 200;

/**
 * The scoreboard while Tab / Share is held: one row per player, sorted by the caller.
 * k = open animation 0..1.
 */
export function drawScoreboard(ctx: C, o: {
  title: string; sub?: string; cols: BoardCol[]; rows: BoardRow[]; k: number; t: number;
  /** show a ping column */
  ping?: boolean; hold?: Action; footer?: string;
}) {
  const k = clamp(o.k, 0, 1);
  if (k <= 0.01) return;
  const e = ease.outCubic(k);
  const colsW = o.cols.reduce((a, c) => a + c.w, 0);
  const pw = Math.min(W - 40, 30 + NAME_W + colsW + (o.ping ? PING_W : 0) + 30);
  const ph = 96 + 34 + Math.max(1, o.rows.length) * ROW_H + (o.footer ? 44 : 22);
  const px = W / 2 - pw / 2, py = Math.max(20, H / 2 - ph / 2 - 30) - (1 - e) * 30;
  ctx.save();
  ctx.globalAlpha = e;
  rrect(ctx, px + 6, py + 8, pw, ph, 24, 'rgba(0,0,0,0.35)', 0);
  rrect(ctx, px, py, pw, ph, 24, 'rgba(26,14,22,0.9)', 4);
  // title + "hold" hint
  text(ctx, o.title, px + 30, py + 50, { size: 30, color: '#ffd34a', stroke: 6 });
  if (o.sub) text(ctx, o.sub, px + 30, py + 76, { size: 16, font: 'body', color: '#c8b8c0' });
  if (o.hold) {
    ctx.font = '400 17px Pangolin, "Comic Sans MS", sans-serif';
    const lw = ctx.measureText('держи').width;
    text(ctx, 'держи', px + pw - 28, py + 46, { size: 17, font: 'body', color: '#c8b8c0', align: 'right' });
    drawGlyph(ctx, o.hold, px + pw - 40 - lw - 22, py + 40, 30);
  }
  // column headers
  let hy = py + 116;
  let cx = px + 30 + NAME_W;
  text(ctx, 'Игрок', px + 30 + 34, hy, { size: 15, font: 'body', color: '#a8949c' });
  for (const c of o.cols) {
    text(ctx, c.label, cx + c.w / 2, hy, { size: 15, font: 'body', color: '#a8949c', align: 'center' });
    cx += c.w;
  }
  if (o.ping) text(ctx, 'Связь', cx + 12, hy, { size: 15, font: 'body', color: '#a8949c' });
  hy += 12;
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(px + 22, hy, pw - 44, 2);
  // rows
  o.rows.forEach((r, i) => {
    const ry = hy + 6 + i * ROW_H;
    const ra = clamp((k - 0.15 - i * 0.07) / 0.3, 0, 1);
    ctx.globalAlpha = e * ra * (r.dim ? 0.5 : 1);
    if (r.me) rrect(ctx, px + 18, ry, pw - 36, ROW_H - 4, 12, 'rgba(255,211,74,0.16)', 0);
    else if (i % 2 === 0) rrect(ctx, px + 18, ry, pw - 36, ROW_H - 4, 12, 'rgba(255,255,255,0.04)', 0);
    const my = ry + ROW_H / 2 - 2;
    if (r.crown) drawCrown(ctx, px + 44, my - 1, 0.62, o.t + i);
    else text(ctx, String(i + 1), px + 44, my + 7, { size: 18, color: '#8a7a80', align: 'center' });
    // name (shrunk to fit)
    ctx.font = '700 21px Rubik, sans-serif';
    const maxW = NAME_W - 50 - (r.host ? 46 : 0);
    const nw = ctx.measureText(r.name).width;
    const ns = nw > maxW ? Math.max(13, Math.floor(21 * maxW / nw)) : 21;
    text(ctx, r.name, px + 64, my + 7, { size: ns, weight: 700, color: r.color, stroke: 4 });
    if (r.host) {
      ctx.font = `700 ${ns}px Rubik, sans-serif`;
      const hx = px + 64 + Math.min(maxW, ctx.measureText(r.name).width) + 8;
      rrect(ctx, hx, my - 9, 40, 18, 9, 'rgba(255,255,255,0.14)', 0);
      text(ctx, 'хост', hx + 20, my + 4, { size: 12, font: 'body', color: '#d8c8d0', align: 'center' });
    }
    let x = px + 30 + NAME_W;
    r.cells.forEach((v, j) => {
      const c = o.cols[j];
      if (!c) return;
      text(ctx, String(v), x + c.w / 2, my + 8, { size: 21, color: '#fff3d8', align: 'center', stroke: 4 });
      x += c.w;
    });
    if (o.ping) {
      if (r.me) text(ctx, '—', x + 12, my + 7, { size: 16, font: 'body', color: '#8a7a80' });
      else if (r.ping !== undefined) drawPing(ctx, x + 12, my + 8, r.ping, ctx.globalAlpha, r.link ?? linkOf(r.id));
    }
  });
  ctx.globalAlpha = e;
  if (o.footer) text(ctx, o.footer, W / 2, py + ph - 18, { size: 16, font: 'body', color: '#c8b8c0', align: 'center' });
  ctx.restore();
}

export interface MiniRow { name: string; color: string; value: number; me?: boolean; crown?: boolean }

/** compact live board (top right), e.g. the PvP crumb race */
export function drawMiniBoard(ctx: C, x: number, y: number, title: string, rows: MiniRow[], t: number, w = 250) {
  const h = 40 + rows.length * 30 + 8;
  ctx.save();
  rrect(ctx, x, y, w, h, 16, 'rgba(26,14,22,0.78)', 3);
  text(ctx, title, x + w / 2, y + 27, { size: 16, color: '#ffd34a', align: 'center', stroke: 4 });
  rows.forEach((r, i) => {
    const ry = y + 42 + i * 30;
    if (r.me) rrect(ctx, x + 6, ry - 2, w - 12, 28, 10, 'rgba(255,211,74,0.18)', 0);
    if (r.crown) drawCrown(ctx, x + 22, ry + 12, 0.5, t);
    else text(ctx, String(i + 1), x + 22, ry + 19, { size: 15, color: '#a8949c', align: 'center' });
    ctx.font = '700 17px Rubik, sans-serif';
    const maxW = w - 110;
    const nw = ctx.measureText(r.name).width;
    text(ctx, r.name, x + 40, ry + 19, { size: nw > maxW ? Math.max(11, Math.floor(17 * maxW / nw)) : 17, weight: 700, color: r.color, stroke: 3 });
    text(ctx, String(r.value), x + w - 16, ry + 20, { size: 19, color: '#ffe0a0', align: 'right', stroke: 4 });
  });
  ctx.restore();
}
