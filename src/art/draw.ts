import { TAU } from '../engine/util';

export const OUT = '#2a1b1a';
export const LW = 3;

type C = CanvasRenderingContext2D;

export function fillStroke(ctx: C, fill: string | CanvasGradient | null, lw = LW, stroke = OUT) {
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (lw > 0) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
}

export function circle(ctx: C, x: number, y: number, r: number, fill: string | CanvasGradient | null, lw = LW) {
  ctx.beginPath(); ctx.arc(x, y, Math.max(0.01, r), 0, TAU); fillStroke(ctx, fill, lw);
}

export function ellipse(ctx: C, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient | null, lw = LW, rot = 0) {
  ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU); fillStroke(ctx, fill, lw);
}

export function rrPath(ctx: C, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function rrect(ctx: C, x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient | null, lw = LW) {
  rrPath(ctx, x, y, w, h, r); fillStroke(ctx, fill, lw);
}

/** a thick cartoon limb with outline */
export function limb(ctx: C, x1: number, y1: number, x2: number, y2: number, w: number, color: string, lw = 2.5) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = OUT; ctx.lineWidth = w + lw * 2;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

/** limb with a bend (quadratic) */
export function limbQ(ctx: C, x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, w: number, color: string, lw = 2.5) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = OUT; ctx.lineWidth = w + lw * 2;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2); ctx.stroke();
}

export function line(ctx: C, x1: number, y1: number, x2: number, y2: number, color = OUT, w = 2) {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

export function groundShadow(ctx: C, x: number, y: number, rx: number, alpha = 0.25) {
  ctx.fillStyle = `rgba(20,8,10,${alpha})`;
  ctx.beginPath(); ctx.ellipse(x, y, rx, rx * 0.28, 0, 0, TAU); ctx.fill();
}

export function heartPath(ctx: C, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x, y - s * 0.05, x - s * 0.55, y - s * 0.15, x - s * 0.55, y + s * 0.2);
  ctx.bezierCurveTo(x - s * 0.55, y + s * 0.5, x - s * 0.2, y + s * 0.7, x, y + s * 0.9);
  ctx.bezierCurveTo(x + s * 0.2, y + s * 0.7, x + s * 0.55, y + s * 0.5, x + s * 0.55, y + s * 0.2);
  ctx.bezierCurveTo(x + s * 0.55, y - s * 0.15, x, y - s * 0.05, x, y + s * 0.35);
  ctx.closePath();
}

export function starPath(ctx: C, x: number, y: number, r1: number, r2: number, n = 5, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = rot + (i / (n * 2)) * TAU;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

/** glow (additive radial gradient) */
export function glow(ctx: C, x: number, y: number, r: number, color: string, alpha = 0.5) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

export function text(
  ctx: C, str: string, x: number, y: number,
  o: { size?: number; color?: string; align?: CanvasTextAlign; base?: CanvasTextBaseline; font?: 'title' | 'body'; weight?: number; stroke?: number; strokeColor?: string; alpha?: number } = {},
) {
  const size = o.size ?? 24;
  const fam = o.font === 'body' ? 'Pangolin, "Comic Sans MS", sans-serif' : 'Rubik, "Arial Black", sans-serif';
  const weight = o.weight ?? (o.font === 'body' ? 400 : 900);
  ctx.font = `${weight} ${size}px ${fam}`;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.base ?? 'alphabetic';
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  if (o.stroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = o.stroke; ctx.strokeStyle = o.strokeColor ?? OUT;
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = o.color ?? '#fff';
  ctx.fillText(str, x, y);
  if (o.alpha !== undefined) ctx.globalAlpha = 1;
}

/** wraps text into lines that fit maxW with current ctx.font */
export function wrap(ctx: C, str: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of str.split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; }
      else line = test;
    }
    out.push(line);
  }
  return out;
}
