import { TAU, srand, shade, rgba } from '../engine/util';
import { OUT, circle, ellipse, rrect, rrPath, fillStroke, line, limb, glow, text } from './draw';

type C = CanvasRenderingContext2D;

export type SolidStyle =
  | 'floor' | 'stone' | 'carpet' | 'table' | 'shelf' | 'book' | 'books' | 'bookRow' | 'crate' | 'jar' | 'can'
  | 'cheese' | 'bread' | 'plate' | 'cake' | 'jelly' | 'cookie' | 'pillar' | 'cushion' | 'sugar' | 'butter'
  | 'spoon' | 'pot' | 'tray' | 'wall' | 'woodwall' | 'invisible';

export interface SolidVisual {
  x: number; y: number; w: number; h: number;
  style: SolidStyle; seed: number; color?: string;
  wob?: number; crumble?: number; legs?: number;
}

const BOOK_COLORS = ['#c0392b', '#2e86c1', '#27ae60', '#8e44ad', '#d35400', '#16a085', '#7f5539', '#b03a6a', '#2c3e8f', '#c9a227'];

export function drawSolid(ctx: C, s: SolidVisual, t: number) {
  const { x, y, w, h } = s;
  const R = srand(s.seed);
  switch (s.style) {
    case 'invisible': return;
    case 'floor': {
      ctx.fillStyle = '#6e4128'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#a8703f'; ctx.fillRect(x, y, w, 12);
      ctx.fillStyle = '#c88a50'; ctx.fillRect(x, y, w, 3);
      ctx.strokeStyle = '#4f2c18'; ctx.lineWidth = 2.5;
      let px = x + R() * 100;
      while (px < x + w) {
        ctx.beginPath(); ctx.moveTo(px, y + 12); ctx.lineTo(px, y + h); ctx.stroke();
        ctx.fillStyle = '#3a2010'; ctx.beginPath(); ctx.arc(px + 8, y + 22, 2, 0, TAU); ctx.arc(px - 8, y + 22, 2, 0, TAU); ctx.fill();
        px += 120 + R() * 90;
      }
      const g = ctx.createLinearGradient(0, y + 12, 0, y + Math.min(h, 220));
      g.addColorStop(0, 'rgba(20,8,4,0)'); g.addColorStop(1, 'rgba(20,8,4,0.55)');
      ctx.fillStyle = g; ctx.fillRect(x, y + 12, w, h - 12);
      line(ctx, x, y + 12, x + w, y + 12, '#4f2c18', 3);
      line(ctx, x, y, x + w, y, OUT, 3);
      return;
    }
    case 'woodwall': {
      ctx.fillStyle = '#5c3520'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#43230f'; ctx.lineWidth = 2.5;
      for (let py = y + 40; py < y + h; py += 48) { ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x + w, py); ctx.stroke(); }
      ctx.strokeStyle = OUT; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
      return;
    }
    case 'stone': case 'carpet': case 'wall': {
      const base = s.color ?? '#4b3d5e';
      ctx.fillStyle = base; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = shade(base, -0.35); ctx.lineWidth = 2.5;
      const bh = 38;
      for (let row = 0; row * bh < h; row++) {
        const py = y + row * bh;
        ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x + w, py); ctx.stroke();
        const off = (row % 2) * 45;
        for (let px = x + off; px < x + w; px += 90) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, Math.min(py + bh, y + h)); ctx.stroke(); }
      }
      ctx.fillStyle = shade(base, 0.12); ctx.fillRect(x, y, w, 5);
      if (s.style === 'carpet') {
        ctx.fillStyle = '#b8323a'; ctx.fillRect(x, y, w, 16);
        ctx.fillStyle = '#f2c23a'; ctx.fillRect(x, y + 12, w, 4);
        ctx.fillStyle = '#8a1f2a';
        for (let px = x + 20; px < x + w; px += 60) { ctx.beginPath(); ctx.arc(px, y + 7, 3, 0, TAU); ctx.fill(); }
      }
      const g = ctx.createLinearGradient(0, y, 0, y + Math.min(h, 260));
      g.addColorStop(0, 'rgba(10,4,20,0)'); g.addColorStop(1, 'rgba(10,4,20,0.5)');
      ctx.fillStyle = g; ctx.fillRect(x, y + 16, w, h - 16);
      ctx.strokeStyle = OUT; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
      return;
    }
    case 'table': {
      // legs
      if (s.legs) {
        for (const lx of [x + 30, x + w - 60]) {
          rrect(ctx, lx, y + 20, 30, s.legs - y - 20, 6, '#6a3a20', 3);
        }
      }
      // drape
      ctx.beginPath();
      ctx.moveTo(x - 6, y);
      ctx.lineTo(x + w + 6, y);
      ctx.lineTo(x + w + 6, y + 50);
      const n = Math.max(2, Math.round(w / 70));
      for (let i = n; i >= 0; i--) {
        const px = x - 6 + (w + 12) * (i / n);
        ctx.quadraticCurveTo(px + (w + 12) / n / 2, y + 66, px, y + 50);
      }
      ctx.closePath();
      fillStroke(ctx, '#f6efe0', 3);
      ctx.save(); ctx.clip();
      ctx.fillStyle = 'rgba(210,50,60,0.75)';
      for (let px = x - 6; px < x + w + 6; px += 32) ctx.fillRect(px, y, 16, 70);
      ctx.fillStyle = 'rgba(210,50,60,0.45)';
      for (let py = y + 8; py < y + 70; py += 32) ctx.fillRect(x - 6, py, w + 12, 16);
      ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 3;
      for (let px = x + 40; px < x + w; px += 70) { ctx.beginPath(); ctx.moveTo(px, y + 14); ctx.lineTo(px - 4, y + 56); ctx.stroke(); }
      line(ctx, x - 6, y, x + w + 6, y, OUT, 3);
      return;
    }
    case 'shelf': {
      const bc = s.color ?? '#b47a46';
      for (let bx = x + 40; bx < x + w - 20; bx += 220) {
        ctx.beginPath(); ctx.moveTo(bx, y + h); ctx.lineTo(bx + 34, y + h); ctx.lineTo(bx, y + h + 40); ctx.closePath();
        fillStroke(ctx, shade(bc, -0.25), 2.5);
      }
      rrect(ctx, x, y, w, h, 4, bc, 3);
      ctx.fillStyle = shade(bc, 0.25); ctx.fillRect(x + 3, y + 3, w - 6, 5);
      ctx.strokeStyle = shade(bc, -0.3); ctx.lineWidth = 1.5;
      for (let gx = x + 30 + R() * 40; gx < x + w - 20; gx += 90 + R() * 60) {
        ctx.beginPath(); ctx.moveTo(gx, y + 10); ctx.quadraticCurveTo(gx + 20, y + 12, gx + 40, y + 11); ctx.stroke();
      }
      return;
    }
    case 'book': {
      const c = s.color ?? BOOK_COLORS[Math.floor(R() * BOOK_COLORS.length)];
      // pages visible on top
      rrect(ctx, x + 6, y - 6, w - 12, 10, 3, '#f4ead2', 2);
      ctx.strokeStyle = '#c8b890'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 10, y - 2); ctx.lineTo(x + w - 10, y - 2); ctx.stroke();
      rrect(ctx, x, y, w, h, 6, c, 3);
      ctx.fillStyle = shade(c, 0.18); ctx.fillRect(x + 4, y + 4, w - 8, 4);
      const band = '#f0c040';
      for (const bx of [x + 18, x + w - 26]) { ctx.fillStyle = band; ctx.fillRect(bx, y + 3, 8, h - 6); }
      if (w > 120) {
        rrect(ctx, x + w / 2 - Math.min(80, w / 4), y + h / 2 - 9, Math.min(160, w / 2), 18, 4, '#f6e7c0', 2);
        ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + w / 2 - Math.min(60, w / 5), y + h / 2); ctx.lineTo(x + w / 2 + Math.min(60, w / 5), y + h / 2); ctx.stroke();
      }
      return;
    }
    case 'books': {
      let py = y;
      const n = Math.max(1, Math.round(h / 34));
      const sh = h / n;
      for (let i = 0; i < n; i++) {
        const c = BOOK_COLORS[Math.floor(R() * BOOK_COLORS.length)];
        const inset = i === 0 ? 0 : R() * 18 - 9;
        rrect(ctx, x + inset, py, w - Math.abs(inset), sh, 5, c, 2.6);
        ctx.fillStyle = '#f0c040'; ctx.fillRect(x + inset + 14, py + 3, 6, sh - 6); ctx.fillRect(x + w - 24, py + 3, 6, sh - 6);
        ctx.fillStyle = shade(c, 0.2); ctx.fillRect(x + inset + 3, py + 3, w - 6 - Math.abs(inset), 3);
        py += sh;
      }
      return;
    }
    case 'bookRow': {
      ctx.fillStyle = '#3a2418'; ctx.fillRect(x, y, w, h);
      let px = x + 2;
      while (px < x + w - 4) {
        const bw = Math.min(18 + R() * 26, x + w - px - 2);
        const bh = h * (0.75 + R() * 0.25);
        const c = BOOK_COLORS[Math.floor(R() * BOOK_COLORS.length)];
        rrect(ctx, px, y + h - bh, bw, bh, 3, c, 2);
        ctx.fillStyle = '#f0c040';
        ctx.fillRect(px + 3, y + h - bh + 10, bw - 6, 3); ctx.fillRect(px + 3, y + h - 16, bw - 6, 3);
        px += bw + 1;
      }
      ctx.strokeStyle = OUT; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
      rrect(ctx, x - 6, y - 10, w + 12, 12, 3, '#8a5530', 3);
      return;
    }
    case 'crate': {
      rrect(ctx, x, y, w, h, 4, '#c08a50', 3);
      ctx.strokeStyle = '#8a5a2a'; ctx.lineWidth = 2;
      for (let py = y + h / 3; py < y + h - 4; py += h / 3) { ctx.beginPath(); ctx.moveTo(x + 4, py); ctx.lineTo(x + w - 4, py); ctx.stroke(); }
      rrect(ctx, x, y, 14, h, 3, '#a8703f', 2.5);
      rrect(ctx, x + w - 14, y, 14, h, 3, '#a8703f', 2.5);
      ctx.save(); rrPath(ctx, x + 14, y, w - 28, h, 0); ctx.clip();
      limb(ctx, x + 14, y + h - 6, x + w - 14, y + 6, 10, '#a8703f', 2.5);
      ctx.restore();
      ctx.fillStyle = '#5a3520';
      for (const [nx, ny] of [[x + 7, y + 8], [x + 7, y + h - 8], [x + w - 7, y + 8], [x + w - 7, y + h - 8]]) { ctx.beginPath(); ctx.arc(nx, ny, 2.2, 0, TAU); ctx.fill(); }
      if (w > 100) text(ctx, R() > 0.5 ? 'МУКА' : 'ГОРОХ', x + w / 2, y + h / 2 + 8, { size: 22, color: 'rgba(80,40,20,0.55)', align: 'center' });
      return;
    }
    case 'jar': {
      const jam = s.color ?? (R() > 0.5 ? '#c8203a' : '#e88a20');
      const bodyY = y + 26;
      ctx.save();
      rrPath(ctx, x, bodyY, w, h - 26, 22); ctx.clip();
      ctx.fillStyle = 'rgba(190,225,255,0.25)'; ctx.fillRect(x, bodyY, w, h);
      ctx.fillStyle = jam; ctx.fillRect(x, bodyY + (h - 26) * 0.25, w, h);
      ctx.fillStyle = shade(jam, 0.25);
      ctx.beginPath(); ctx.ellipse(x + w / 2, bodyY + (h - 26) * 0.25, w / 2, 8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = shade(jam, -0.3);
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(x + 15 + R() * (w - 30), bodyY + (h - 26) * (0.4 + R() * 0.5), 3 + R() * 4, 0, TAU); ctx.fill(); }
      ctx.restore();
      rrect(ctx, x, bodyY, w, h - 26, 22, null, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      rrPath(ctx, x + 12, bodyY + 14, 10, h - 70, 5); ctx.fill();
      // label
      if (h > 100) {
        rrect(ctx, x + w * 0.22, bodyY + (h - 26) * 0.45, w * 0.56, Math.min(46, h * 0.25), 4, '#f6ecd2', 2);
        line(ctx, x + w * 0.3, bodyY + (h - 26) * 0.45 + 16, x + w * 0.7, bodyY + (h - 26) * 0.45 + 16, '#b04040', 3);
      }
      // lid (cloth)
      rrect(ctx, x - 6, y + 4, w + 12, 24, 6, '#f6efe0', 3);
      ctx.save(); rrPath(ctx, x - 6, y + 4, w + 12, 24, 6); ctx.clip();
      ctx.fillStyle = 'rgba(210,50,60,0.75)';
      for (let px = x - 6; px < x + w + 6; px += 20) ctx.fillRect(px, y + 4, 10, 30);
      ctx.restore();
      line(ctx, x - 4, y + 24, x + w + 4, y + 24, '#c8a060', 4);
      return;
    }
    case 'can': {
      const c = s.color ?? (R() > 0.5 ? '#d8343a' : '#2e86c1');
      rrect(ctx, x, y, w, h, 6, '#cdd6e2', 3);
      ctx.strokeStyle = '#9aa4b2'; ctx.lineWidth = 2;
      for (const py of [y + 6, y + 12, y + h - 12, y + h - 6]) { ctx.beginPath(); ctx.moveTo(x + 3, py); ctx.lineTo(x + w - 3, py); ctx.stroke(); }
      ctx.fillStyle = c; ctx.fillRect(x + 2, y + 18, w - 4, h - 36);
      ctx.strokeStyle = OUT; ctx.lineWidth = 2; ctx.strokeRect(x + 2, y + 18, w - 4, h - 36);
      if (h > 70) {
        circle(ctx, x + w / 2, y + h / 2, Math.min(w, h) * 0.2, '#f6e7c0', 2);
        ellipse(ctx, x + w / 2, y + h / 2, Math.min(w, h) * 0.12, Math.min(w, h) * 0.07, '#e8743a', 1.5);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + 10, y + 20, 8, h - 40);
      return;
    }
    case 'cheese': {
      rrect(ctx, x, y, w, h, 8, '#f6c945', 3);
      ctx.fillStyle = '#e0a82a';
      for (let i = 0; i < Math.round((w * h) / 2500); i++) {
        const r = 4 + R() * 10;
        ctx.beginPath(); ctx.ellipse(x + r + R() * (w - 2 * r), y + r + 6 + R() * (h - 2 * r - 6), r, r * 0.8, 0, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = '#fbe08a'; ctx.fillRect(x + 4, y + 3, w - 8, 5);
      return;
    }
    case 'bread': {
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, y + 30);
      ctx.quadraticCurveTo(x, y, x + 40, y);
      ctx.lineTo(x + w - 40, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + 30);
      ctx.lineTo(x + w, y + h); ctx.closePath();
      fillStroke(ctx, '#c8823a', 3);
      ctx.fillStyle = '#e0a058'; ctx.fillRect(x + 20, y + 6, w - 40, 8);
      ctx.strokeStyle = '#8a5020'; ctx.lineWidth = 4;
      for (let px = x + 50; px < x + w - 30; px += 70) { ctx.beginPath(); ctx.moveTo(px, y + 4); ctx.quadraticCurveTo(px + 14, y + 14, px + 30, y + 6); ctx.stroke(); }
      return;
    }
    case 'plate': {
      ellipse(ctx, x + w / 2, y + h / 2 + 2, w / 2, h / 2 + 3, '#e8eef5', 3);
      ellipse(ctx, x + w / 2, y + h / 2, w / 2 - 14, h / 2 - 3, '#ffffff', 1.5);
      ctx.strokeStyle = '#4a7ad8'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2 + 2, w / 2 - 6, h / 2 - 1, 0, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    case 'cake': {
      const layers = ['#f4c8d8', '#fff6e8', '#8a4a2a', '#f4c8d8'];
      const lh = h / layers.length;
      for (let i = 0; i < layers.length; i++) { ctx.fillStyle = layers[i]; ctx.fillRect(x, y + i * lh, w, lh); }
      ctx.strokeStyle = OUT; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
      // icing
      ctx.beginPath(); ctx.moveTo(x - 4, y - 6); ctx.lineTo(x + w + 4, y - 6); ctx.lineTo(x + w + 4, y + 10);
      for (let px = x + w; px > x; px -= 30) ctx.quadraticCurveTo(px - 8, y + 34 + ((px * 7) % 13), px - 15, y + 12);
      ctx.lineTo(x - 4, y + 10); ctx.closePath();
      fillStroke(ctx, '#ffffff', 3);
      for (let px = x + 30; px < x + w - 20; px += 60) { circle(ctx, px, y - 14, 10, '#e02a4a', 2.5); line(ctx, px, y - 22, px + 6, y - 34, '#3a7a2a', 2.5); }
      ctx.fillStyle = '#ff6ac0';
      for (let i = 0; i < w / 12; i++) ctx.fillRect(x + R() * w, y + R() * 8, 5, 2);
      return;
    }
    case 'jelly': {
      const wob = s.wob ?? 0;
      const sq = Math.sin(t * 22) * wob;
      const c = s.color ?? '#ff4f7f';
      ctx.save();
      ctx.translate(x + w / 2, y + h);
      ctx.scale(1 + sq * 0.12, 1 - sq * 0.18);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(-w / 2, 0);
      ctx.lineTo(-w / 2 + 6, -h + 12);
      ctx.quadraticCurveTo(-w / 2 + 8, -h, -w / 2 + 22, -h);
      ctx.lineTo(w / 2 - 22, -h);
      ctx.quadraticCurveTo(w / 2 - 8, -h, w / 2 - 6, -h + 12);
      ctx.lineTo(w / 2, 0); ctx.closePath();
      fillStroke(ctx, c, 3);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = shade(c, -0.2); ctx.lineWidth = 3;
      for (let px = -w / 2 + 20; px < w / 2 - 10; px += 22) { ctx.beginPath(); ctx.moveTo(px, -h + 6); ctx.lineTo(px - 3, -4); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.ellipse(-w / 2 + 22, -h + 16, 6, 10, -0.3, 0, TAU); ctx.fill();
      ctx.restore();
      return;
    }
    case 'cookie': {
      const cr = s.crumble ?? 0;
      ctx.save();
      if (cr > 0) ctx.translate(Math.sin(t * 60) * cr * 3, 0);
      ctx.globalAlpha = 1 - Math.max(0, cr - 0.8) * 5;
      rrect(ctx, x, y, w, h, h / 2.2, '#d89a52', 3);
      ctx.fillStyle = '#4a2a18';
      for (let i = 0; i < w / 22; i++) { ctx.beginPath(); ctx.ellipse(x + 10 + R() * (w - 20), y + 6 + R() * (h - 12), 4, 3, R() * 3, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#eab26a'; ctx.fillRect(x + 12, y + 4, w - 24, 3);
      if (cr > 0.2) {
        ctx.strokeStyle = OUT; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + w * 0.3, y); ctx.lineTo(x + w * 0.38, y + h * 0.6); ctx.lineTo(x + w * 0.32, y + h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + w * 0.7, y); ctx.lineTo(x + w * 0.62, y + h * 0.5); ctx.stroke();
      }
      ctx.restore();
      return;
    }
    case 'pillar': {
      const c = s.color ?? '#6a5a82';
      rrect(ctx, x, y, w, h, 4, c, 3);
      ctx.fillStyle = shade(c, 0.15);
      for (let px = x + 12; px < x + w - 8; px += 22) ctx.fillRect(px, y + 30, 6, h - 60);
      rrect(ctx, x - 14, y, w + 28, 30, 6, shade(c, 0.1), 3);
      rrect(ctx, x - 14, y + h - 30, w + 28, 30, 6, shade(c, 0.1), 3);
      return;
    }
    case 'cushion': {
      const c = s.color ?? '#7a3aa0';
      ctx.beginPath();
      ctx.moveTo(x + 10, y + h); ctx.quadraticCurveTo(x - 8, y + h / 2, x + 10, y);
      ctx.quadraticCurveTo(x + w / 2, y + 12, x + w - 10, y);
      ctx.quadraticCurveTo(x + w + 8, y + h / 2, x + w - 10, y + h);
      ctx.quadraticCurveTo(x + w / 2, y + h - 10, x + 10, y + h); ctx.closePath();
      fillStroke(ctx, c, 3);
      circle(ctx, x + w / 2, y + h / 2, 5, '#f2c23a', 2);
      for (const tx of [x + 6, x + w - 6]) { line(ctx, tx, y + 4, tx, y + 22, '#f2c23a', 3); circle(ctx, tx, y + 24, 5, '#f2c23a', 2); }
      return;
    }
    case 'sugar': {
      rrect(ctx, x, y, w, h, 8, '#fbfbff', 3);
      ctx.fillStyle = 'rgba(160,180,220,0.35)';
      for (let i = 0; i < (w * h) / 300; i++) ctx.fillRect(x + 4 + R() * (w - 8), y + 4 + R() * (h - 8), 3, 3);
      ctx.fillStyle = '#ffffff';
      const sp = (t * 2 + s.seed) % 3;
      if (sp < 0.4) { ctx.save(); ctx.globalAlpha = 1 - sp / 0.4; ctx.translate(x + w * 0.7, y + 10); ctx.fillRect(-6, -1, 12, 2); ctx.fillRect(-1, -6, 2, 12); ctx.restore(); }
      return;
    }
    case 'butter': {
      rrect(ctx, x, y, w, h, 6, '#fde58a', 3);
      ctx.fillStyle = '#fff3c0'; ctx.fillRect(x + 6, y + 4, w - 12, 6);
      rrect(ctx, x - 4, y + h * 0.45, w + 8, h * 0.55, 4, '#f6f2e8', 3);
      text(ctx, 'МАСЛО', x + w / 2, y + h * 0.78, { size: Math.min(24, h * 0.25), color: '#3a6ad8', align: 'center' });
      return;
    }
    case 'spoon': {
      const bowlW = Math.min(110, w * 0.35);
      rrect(ctx, x + bowlW - 10, y + 2, w - bowlW + 10, h - 4, h / 2, '#cdd6e2', 3);
      ellipse(ctx, x + bowlW / 2, y + h / 2 + 4, bowlW / 2, h / 2 + 12, '#dfe6ef', 3);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(x + bowlW + 10, y + 5, w - bowlW - 30, 3);
      return;
    }
    case 'pot': {
      rrect(ctx, x - 16, y + 20, 22, 14, 6, '#3a3a44', 3);
      rrect(ctx, x + w - 6, y + 20, 22, 14, 6, '#3a3a44', 3);
      rrect(ctx, x, y + 6, w, h - 6, 14, '#5a5a6a', 3);
      rrect(ctx, x - 6, y, w + 12, 16, 6, '#6e6e80', 3);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x + 14, y + 22, 10, h - 40);
      return;
    }
    case 'tray': {
      rrect(ctx, x, y, w, h, h / 2, '#dfe6ef', 3);
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(x + 20, y + 3, w - 40, 3);
      return;
    }
  }
}

// ───────────────────────────── HAZARDS ─────────────────────────────
export type HazardStyle = 'forks' | 'soup' | 'pins' | 'jam';

export function drawHazard(ctx: C, style: HazardStyle, x: number, y: number, w: number, h: number, t: number) {
  if (style === 'forks' || style === 'pins') {
    const step = style === 'forks' ? 34 : 26;
    for (let px = x + 4; px < x + w - 8; px += step) {
      if (style === 'forks') {
        rrect(ctx, px + 10, y + 18, 10, h - 18, 3, '#b8c2d0', 2.5);
        rrect(ctx, px + 2, y + 12, 26, 10, 4, '#cdd6e2', 2.5);
        for (let i = 0; i < 3; i++) {
          ctx.beginPath(); ctx.moveTo(px + 4 + i * 9, y + 14); ctx.lineTo(px + 5.5 + i * 9, y); ctx.lineTo(px + 7 + i * 9, y + 14); ctx.closePath();
          fillStroke(ctx, '#e8eef5', 2);
        }
      } else {
        ctx.beginPath(); ctx.moveTo(px + 8, y + h); ctx.lineTo(px + 13, y); ctx.lineTo(px + 18, y + h); ctx.closePath();
        fillStroke(ctx, '#d8dee8', 2);
        circle(ctx, px + 13, y + h - 6, 7, ['#e04040', '#3a8ad8', '#f0c040'][Math.floor(px / step) % 3], 2);
      }
    }
    return;
  }
  // liquids
  const col = style === 'soup' ? '#e8742a' : '#c8203a';
  const top = style === 'soup' ? '#ffa04a' : '#e84a5a';
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + 8);
  for (let px = x; px <= x + w; px += 16) ctx.lineTo(px, y + 8 + Math.sin(px * 0.05 + t * 4) * 4);
  ctx.lineTo(x + w, y + h); ctx.closePath();
  fillStroke(ctx, col, 3);
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(x, y + 8);
  for (let px = x; px <= x + w; px += 16) ctx.lineTo(px, y + 8 + Math.sin(px * 0.05 + t * 4) * 4);
  for (let px = x + w; px >= x; px -= 16) ctx.lineTo(px, y + 16 + Math.sin(px * 0.05 + t * 4) * 4);
  ctx.closePath(); ctx.fill();
  // bubbles
  for (let i = 0; i < w / 60; i++) {
    const k = (t * 0.8 + i * 0.37) % 1;
    const bx = x + ((i * 97) % Math.max(1, w - 20)) + 10;
    const r = 3 + k * 7;
    ctx.globalAlpha = 1 - k;
    circle(ctx, bx, y + 14 - k * 10, r, top, 2);
    ctx.globalAlpha = 1;
  }
  if (style === 'soup') {
    // floating veggies
    for (let i = 0; i < w / 120; i++) {
      const bx = x + 30 + ((i * 131) % Math.max(1, w - 60));
      const by = y + 12 + Math.sin(t * 2 + i) * 3;
      if (i % 2) rrect(ctx, bx - 7, by - 4, 14, 8, 2, '#ff9a2a', 2);
      else circle(ctx, bx, by, 5, '#4fae3a', 2);
    }
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.3 + i / 3) % 1;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x + w * (0.2 + i * 0.3) + Math.sin(t + i) * 10, y - k * 80, 10 + k * 16, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

// ───────────────────────────── DECOR (world-space, non-colliding) ─────────────────────────────
export type DecorType =
  | 'candle' | 'sign' | 'sausages' | 'garlic' | 'bottle' | 'painting' | 'banner' | 'torch' | 'chandelier'
  | 'cobweb' | 'mousehole' | 'door' | 'window' | 'barrel' | 'sack' | 'teacup' | 'globe' | 'lamp' | 'statue' | 'arch' | 'moonbeam' | 'chain';

export interface Decor { type: DecorType; x: number; y: number; s?: number; text?: string; seed?: number; w?: number; h?: number; front?: boolean }

export function drawDecor(ctx: C, d: Decor, t: number) {
  const s = d.s ?? 1;
  const R = srand(d.seed ?? Math.floor(d.x));
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.scale(s, s);
  switch (d.type) {
    case 'candle': {
      rrect(ctx, -22, -8, 44, 10, 4, '#c8a050', 2.5);
      rrect(ctx, -12, -70, 24, 64, 4, '#fff3d8', 2.5);
      ctx.fillStyle = '#f6e2b8'; ctx.fillRect(-12, -70, 24, 6);
      // drip
      ctx.beginPath(); ctx.moveTo(-8, -70); ctx.quadraticCurveTo(-10, -50, -6, -48); ctx.quadraticCurveTo(-3, -52, -4, -70); ctx.fillStyle = '#fff8e8'; ctx.fill();
      line(ctx, 0, -70, 0, -78, OUT, 2);
      const fl = Math.sin(t * 13 + d.x) * 0.15 + Math.sin(t * 7.3) * 0.1;
      ctx.save(); ctx.translate(0, -80); ctx.scale(1 + fl * 0.3, 1 - fl);
      ctx.beginPath(); ctx.moveTo(0, -22); ctx.quadraticCurveTo(10, -6, 0, 2); ctx.quadraticCurveTo(-10, -6, 0, -22);
      ctx.fillStyle = '#ffb02a'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -14); ctx.quadraticCurveTo(5, -4, 0, 1); ctx.quadraticCurveTo(-5, -4, 0, -14);
      ctx.fillStyle = '#fff6c0'; ctx.fill();
      ctx.restore();
      break;
    }
    case 'torch': {
      rrect(ctx, -6, -40, 12, 50, 3, '#5a3520', 2.5);
      rrect(ctx, -12, -48, 24, 12, 3, '#8a8a9a', 2.5);
      const fl = Math.sin(t * 11 + d.x) * 0.2;
      ctx.save(); ctx.translate(0, -50); ctx.scale(1 + fl * 0.3, 1 - fl);
      ctx.beginPath(); ctx.moveTo(0, -36); ctx.quadraticCurveTo(16, -10, 0, 2); ctx.quadraticCurveTo(-16, -10, 0, -36);
      ctx.fillStyle = '#ff7a2a'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -22); ctx.quadraticCurveTo(7, -6, 0, 1); ctx.quadraticCurveTo(-7, -6, 0, -22);
      ctx.fillStyle = '#ffe680'; ctx.fill();
      ctx.restore();
      break;
    }
    case 'sign': {
      rrect(ctx, -5, -70, 10, 70, 3, '#8a5530', 2.5);
      ctx.save(); ctx.rotate(-0.04);
      rrect(ctx, -46, -96, 92, 40, 6, '#c89a5a', 3);
      ctx.strokeStyle = '#8a5a2a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-40, -76); ctx.lineTo(40, -76); ctx.stroke();
      text(ctx, d.text ?? '!', 0, -68, { size: 26, color: '#4a2a14', align: 'center' });
      ctx.restore();
      break;
    }
    case 'sausages': {
      const n = 3 + Math.floor(R() * 3);
      line(ctx, 0, -400, 0, 0, '#c8a060', 3);
      for (let i = 0; i < n; i++) {
        const sw = Math.sin(t * 1.2 + i + d.x) * 0.06;
        ctx.save(); ctx.translate(0, i * 70); ctx.rotate(sw);
        rrect(ctx, -16, 0, 32, 64, 16, i % 2 ? '#b8452a' : '#c85a3a', 3);
        ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(-8, 8, 5, 40);
        ctx.restore();
      }
      break;
    }
    case 'garlic': {
      line(ctx, 0, -400, 0, 0, '#c8a060', 3);
      for (let i = 0; i < 4; i++) {
        const sw = Math.sin(t * 1.1 + i * 0.7 + d.x) * 4;
        const gx = (i % 2 ? 14 : -14) + sw, gy = i * 46 + 20;
        ellipse(ctx, gx, gy, 20, 22, '#f8f0e0', 2.5);
        ctx.strokeStyle = '#d8c8b0'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(gx, gy - 20); ctx.quadraticCurveTo(gx - 8, gy, gx, gy + 20); ctx.stroke();
        line(ctx, gx, gy - 22, gx, gy - 30, '#a89870', 3);
      }
      break;
    }
    case 'bottle': {
      const c = ['#2f7d4a', '#7a3a2a', '#3a5a9a'][Math.floor(R() * 3)];
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.moveTo(-40, 0); ctx.lineTo(-40, -150); ctx.quadraticCurveTo(-40, -200, -14, -220); ctx.lineTo(-14, -280); ctx.lineTo(14, -280);
      ctx.lineTo(14, -220); ctx.quadraticCurveTo(40, -200, 40, -150); ctx.lineTo(40, 0); ctx.closePath();
      fillStroke(ctx, c, 3);
      ctx.globalAlpha = 1;
      rrect(ctx, -16, -296, 32, 20, 4, '#c8a060', 2.5);
      rrect(ctx, -30, -120, 60, 70, 4, '#f6ecd2', 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(-30, -190, 8, 170);
      break;
    }
    case 'painting': {
      rrect(ctx, -110, -150, 220, 170, 8, '#d8a838', 4);
      rrect(ctx, -92, -132, 184, 134, 4, '#3a2a4a', 3);
      ctx.save(); ctx.beginPath(); ctx.rect(-92, -132, 184, 134); ctx.clip();
      // tiny king portrait
      ctx.fillStyle = '#c6a2e4'; ctx.beginPath(); ctx.ellipse(0, -50, 52, 44, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#a8243a'; ctx.beginPath(); ctx.ellipse(0, 20, 80, 50, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e2762c'; ctx.beginPath(); ctx.ellipse(-24, -34, 24, 8, 0.2, 0, TAU); ctx.ellipse(24, -34, 24, 8, -0.2, 0, TAU); ctx.fill();
      ctx.fillStyle = OUT; ctx.fillRect(-24, -62, 10, 4); ctx.fillRect(14, -62, 10, 4);
      ctx.fillStyle = '#f2c23a'; ctx.beginPath(); ctx.moveTo(-12, -92); ctx.lineTo(-14, -104); ctx.lineTo(-4, -98); ctx.lineTo(0, -108); ctx.lineTo(4, -98); ctx.lineTo(14, -104); ctx.lineTo(12, -92); ctx.fill();
      ctx.restore();
      text(ctx, 'ЕГО ГРОМАДЕЙШЕСТВО', 0, 12, { size: 11, color: '#4a2a14', align: 'center' });
      break;
    }
    case 'banner': {
      line(ctx, -60, -10, 60, -10, '#8a6a3a', 6);
      ctx.beginPath(); ctx.moveTo(-50, -10); ctx.lineTo(50, -10); ctx.lineTo(50, 200 + Math.sin(t * 1.5 + d.x) * 4); ctx.lineTo(0, 170); ctx.lineTo(-50, 200 - Math.sin(t * 1.5 + d.x) * 4); ctx.closePath();
      fillStroke(ctx, '#8a1f3a', 3);
      ctx.fillStyle = '#f2c23a';
      ctx.beginPath(); ctx.moveTo(-26, 90); ctx.lineTo(-30, 50); ctx.lineTo(-12, 70); ctx.lineTo(0, 40); ctx.lineTo(12, 70); ctx.lineTo(30, 50); ctx.lineTo(26, 90); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#f2c23a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-40, 180); ctx.moveTo(40, 0); ctx.lineTo(40, 180); ctx.stroke();
      break;
    }
    case 'chandelier': {
      line(ctx, 0, -500, 0, -60, '#5a4a3a', 4);
      ellipse(ctx, 0, -40, 120, 26, '#d8a838', 4);
      for (let i = -2; i <= 2; i++) {
        const cx = i * 50;
        rrect(ctx, cx - 7, -100, 14, 54, 3, '#fff3d8', 2);
        const f = Math.sin(t * 12 + i) * 0.15;
        ctx.save(); ctx.translate(cx, -104); ctx.scale(1, 1 - f);
        ctx.beginPath(); ctx.moveTo(0, -18); ctx.quadraticCurveTo(8, -4, 0, 2); ctx.quadraticCurveTo(-8, -4, 0, -18); ctx.fillStyle = '#ffd04a'; ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'cobweb': {
      ctx.strokeStyle = 'rgba(240,240,255,0.35)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) { const a = (i / 5) * (Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 160, Math.sin(a) * 160); ctx.stroke(); }
      for (let r = 30; r < 160; r += 28) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI / 2); ctx.stroke(); }
      break;
    }
    case 'mousehole': case 'door': {
      const w = d.w ?? 90, h = d.h ?? 120;
      ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, -h + w / 2); ctx.arc(0, -h + w / 2, w / 2, Math.PI, 0); ctx.lineTo(w / 2, 0); ctx.closePath();
      fillStroke(ctx, '#140a08', 4);
      if (d.type === 'door') {
        ctx.strokeStyle = '#f2c23a'; ctx.lineWidth = 6; ctx.stroke();
      }
      const g = ctx.createRadialGradient(0, -h * 0.4, 0, 0, -h * 0.4, h);
      g.addColorStop(0, 'rgba(255,220,140,0.35)'); g.addColorStop(1, 'rgba(255,220,140,0)');
      ctx.fillStyle = g; ctx.fill();
      break;
    }
    case 'window': {
      const w = d.w ?? 160, h = d.h ?? 260;
      ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, -h + w / 2); ctx.arc(0, -h + w / 2, w / 2, Math.PI, 0); ctx.lineTo(w / 2, 0); ctx.closePath();
      const g = ctx.createLinearGradient(0, -h, 0, 0); g.addColorStop(0, '#1a2a5a'); g.addColorStop(1, '#3a4a8a');
      fillStroke(ctx, g, 6);
      circle(ctx, w * 0.15, -h * 0.65, 18, '#fff6d0', 0);
      ctx.strokeStyle = '#5a3a2a'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(0, -h); ctx.lineTo(0, 0); ctx.moveTo(-w / 2, -h * 0.4); ctx.lineTo(w / 2, -h * 0.4); ctx.stroke();
      break;
    }
    case 'barrel': {
      ctx.beginPath(); ctx.moveTo(-50, 0); ctx.quadraticCurveTo(-64, -70, -50, -140); ctx.lineTo(50, -140); ctx.quadraticCurveTo(64, -70, 50, 0); ctx.closePath();
      fillStroke(ctx, '#a8703f', 3);
      for (const by of [-20, -120]) { ctx.strokeStyle = '#4a4a55'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(-56, by); ctx.lineTo(56, by); ctx.stroke(); }
      ctx.strokeStyle = '#7a4a28'; ctx.lineWidth = 2;
      for (let px = -30; px <= 30; px += 20) { ctx.beginPath(); ctx.moveTo(px, -4); ctx.lineTo(px, -136); ctx.stroke(); }
      break;
    }
    case 'sack': {
      ctx.beginPath(); ctx.moveTo(-60, 0); ctx.quadraticCurveTo(-80, -100, -30, -150); ctx.lineTo(-20, -180); ctx.lineTo(20, -180); ctx.lineTo(30, -150); ctx.quadraticCurveTo(80, -100, 60, 0); ctx.closePath();
      fillStroke(ctx, '#d8c090', 3);
      line(ctx, -30, -150, 30, -150, '#8a6a3a', 5);
      text(ctx, 'МУКА', 0, -60, { size: 26, color: 'rgba(90,60,30,0.6)', align: 'center' });
      break;
    }
    case 'teacup': {
      ctx.beginPath(); ctx.moveTo(-70, -110); ctx.lineTo(70, -110); ctx.quadraticCurveTo(64, -10, 0, -6); ctx.quadraticCurveTo(-64, -10, -70, -110); ctx.closePath();
      fillStroke(ctx, '#f6f0ff', 3);
      ctx.beginPath(); ctx.arc(76, -70, 22, -Math.PI / 2, Math.PI / 2); ctx.lineWidth = 9; ctx.strokeStyle = OUT; ctx.stroke(); ctx.lineWidth = 5; ctx.strokeStyle = '#f6f0ff'; ctx.stroke();
      ellipse(ctx, 0, 0, 90, 10, '#f6f0ff', 3);
      ctx.strokeStyle = '#7a8ad8'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-60, -90); ctx.lineTo(60, -90); ctx.stroke();
      break;
    }
    case 'globe': {
      rrect(ctx, -40, -14, 80, 14, 5, '#8a5530', 2.5);
      line(ctx, 0, -14, 0, -40, '#8a5530', 6);
      circle(ctx, 0, -110, 70, '#4a8ad8', 3);
      ctx.fillStyle = '#5aae4a';
      ctx.beginPath(); ctx.ellipse(-20 + Math.sin(t * 0.5) * 20, -120, 26, 18, 0.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(24 + Math.sin(t * 0.5) * 20, -90, 18, 24, -0.3, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -110, 80, -Math.PI * 0.8, Math.PI * 0.3); ctx.lineWidth = 6; ctx.strokeStyle = '#d8a838'; ctx.stroke();
      break;
    }
    case 'lamp': {
      line(ctx, 0, -600, 0, -40, '#3a3a44', 3);
      ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-20, -40); ctx.lineTo(20, -40); ctx.lineTo(40, 0); ctx.closePath();
      fillStroke(ctx, '#2f7d4a', 3);
      ellipse(ctx, 0, 4, 12, 8, '#fff6c0', 2);
      break;
    }
    case 'statue': {
      rrect(ctx, -80, -60, 160, 60, 6, '#5a4a6e', 3);
      ctx.beginPath(); ctx.ellipse(0, -160, 90, 100, 0, 0, TAU); fillStroke(ctx, '#8a7aa0', 3);
      ctx.beginPath(); ctx.ellipse(0, -290, 70, 60, 0, 0, TAU); fillStroke(ctx, '#8a7aa0', 3);
      ctx.fillStyle = '#6a5a82';
      ctx.beginPath(); ctx.ellipse(-28, -270, 30, 10, 0.2, 0, TAU); ctx.ellipse(28, -270, 30, 10, -0.2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-16, -345); ctx.lineTo(-20, -370); ctx.lineTo(-6, -356); ctx.lineTo(0, -376); ctx.lineTo(6, -356); ctx.lineTo(20, -370); ctx.lineTo(16, -345); ctx.closePath(); ctx.fill();
      break;
    }
    case 'arch': {
      const w = d.w ?? 300, h = d.h ?? 400;
      ctx.fillStyle = 'rgba(10,5,15,0.6)';
      ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, -h + w / 2); ctx.arc(0, -h + w / 2, w / 2, Math.PI, 0); ctx.lineTo(w / 2, 0); ctx.closePath(); ctx.fill();
      ctx.lineWidth = 18; ctx.strokeStyle = '#6a5a82'; ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
      break;
    }
    case 'moonbeam': {
      const w = d.w ?? 220, h = d.h ?? 900;
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(0, -h, 0, 0);
      g.addColorStop(0, 'rgba(180,210,255,0.35)'); g.addColorStop(1, 'rgba(180,210,255,0.02)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-w * 0.35, -h); ctx.lineTo(w * 0.35, -h); ctx.lineTo(w / 2, 0); ctx.lineTo(-w / 2, 0); ctx.closePath(); ctx.fill();
      for (let i = 0; i < 12; i++) {
        const k = (t * 0.05 + i / 12) % 1;
        ctx.fillStyle = `rgba(220,235,255,${0.6 * Math.sin(k * Math.PI)})`;
        ctx.beginPath(); ctx.arc(Math.sin(i * 2.3 + t * 0.4) * w * 0.35, -h + k * h, 2.5, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'chain': {
      ctx.strokeStyle = '#6a6a78'; ctx.lineWidth = 5;
      for (let i = 0; i < (d.h ?? 300) / 22; i++) { ctx.beginPath(); ctx.ellipse(0, i * 22, i % 2 ? 4 : 8, 12, 0, 0, TAU); ctx.stroke(); }
      break;
    }
  }
  ctx.restore();
}

export function decorLight(d: Decor): { x: number; y: number; r: number; color: string } | null {
  const s = d.s ?? 1;
  if (d.type === 'candle') return { x: d.x, y: d.y - 90 * s, r: 260 * s, color: '#ffb84a' };
  if (d.type === 'torch') return { x: d.x, y: d.y - 64 * s, r: 300 * s, color: '#ff8a3a' };
  if (d.type === 'chandelier') return { x: d.x, y: d.y - 90 * s, r: 420 * s, color: '#ffc85a' };
  if (d.type === 'lamp') return { x: d.x, y: d.y + 10 * s, r: 260 * s, color: '#e8f0a0' };
  if (d.type === 'window') return { x: d.x, y: d.y - (d.h ?? 260) * 0.5 * s, r: 300 * s, color: '#7a9aff' };
  return null;
}

// ───────────────────────────── PICKUP ICONS ─────────────────────────────
export function drawCrumb(ctx: C, x: number, y: number, s: number, t: number, big = false) {
  ctx.save(); ctx.translate(x, y + Math.sin(t * 4 + x) * 2); ctx.scale(s, s); ctx.rotate(Math.sin(t * 2 + x) * 0.2);
  if (big) {
    rrect(ctx, -11, -8, 22, 16, 4, '#e8a850', 2.4);
    ctx.fillStyle = '#c8803a'; ctx.fillRect(-7, -4, 3, 3); ctx.fillRect(3, 1, 3, 3);
    ctx.fillStyle = '#ffd890'; ctx.fillRect(-8, -6, 12, 2.5);
  } else {
    ctx.beginPath(); ctx.moveTo(-6, 4); ctx.lineTo(-7, -2); ctx.lineTo(-1, -6); ctx.lineTo(6, -4); ctx.lineTo(7, 3); ctx.lineTo(1, 6); ctx.closePath();
    fillStroke(ctx, '#f0b850', 2);
    ctx.fillStyle = '#ffe0a0'; ctx.fillRect(-3, -3, 4, 2);
  }
  ctx.restore();
}

// ── small shared helpers for the artifact icons ──
/** four-point twinkle (filled, outlined) */
function iconTwinkle(ctx: C, x: number, y: number, r: number, color: string, lw = 1.1) {
  if (r <= 0.05) return;
  const k = r * 0.2;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + k, y - k, x + r, y);
  ctx.quadraticCurveTo(x + k, y + k, x, y + r);
  ctx.quadraticCurveTo(x - k, y + k, x - r, y);
  ctx.quadraticCurveTo(x - k, y - k, x, y - r);
  ctx.closePath();
  fillStroke(ctx, color, lw);
}
function iconStarPath(ctx: C, x: number, y: number, r1: number, r2: number, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? r2 : r1, a = rot + (i / 10) * TAU;
    if (i) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}
/** outlined bent stroke (like draw.ts limbQ) */
function iconLimbQ(ctx: C, x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, w: number, color: string, lw = 2) {
  ctx.lineCap = 'round';
  for (const [c, ww] of [[OUT, w + lw * 2], [color, w]] as const) {
    ctx.strokeStyle = c; ctx.lineWidth = ww;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2); ctx.stroke();
  }
}
/** leaf pointing along `rot` from (x, y), length L */
function iconLeaf(ctx: C, x: number, y: number, L: number, rot: number, fill = '#5ab83e') {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.bezierCurveTo(L * 0.25, -L * 0.42, L * 0.7, -L * 0.36, L, 0);
  ctx.bezierCurveTo(L * 0.7, L * 0.3, L * 0.25, L * 0.36, 0, 0);
  ctx.closePath();
  fillStroke(ctx, fill, 1.4);
  ctx.strokeStyle = '#2f7a28'; ctx.lineWidth = 0.9; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(L * 0.08, 0); ctx.quadraticCurveTo(L * 0.5, -L * 0.05, L * 0.88, 0); ctx.stroke();
  for (const f of [0.35, 0.6]) { ctx.beginPath(); ctx.moveTo(L * f, -L * 0.02); ctx.lineTo(L * (f + 0.14), -L * 0.17); ctx.moveTo(L * f, 0); ctx.lineTo(L * (f + 0.12), L * 0.14); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(L * 0.45, -L * 0.16, L * 0.16, L * 0.05, -0.1, 0, TAU); ctx.fill();
  ctx.restore();
}

/** «Сердце-Вишня»: glossy cherry-heart with two stems and leaves (container = the max-HP artifact, with glow & sparkles) */
export function drawBerryHeart(ctx: C, x: number, y: number, s: number, t: number, container = false) {
  ctx.save(); ctx.translate(x, y + Math.sin(t * 3) * 3);
  // lub-dub heartbeat for the artifact, gentle breathing for the plain pickup
  const ph = t % 1.25;
  const beat = container
    ? Math.exp(-(((ph - 0.08) / 0.055) ** 2)) * 0.07 + Math.exp(-(((ph - 0.3) / 0.06) ** 2)) * 0.045
    : Math.sin(t * 6) * 0.03;
  ctx.scale(s * (1 + beat), s * (1 + beat * 0.8));
  if (container) {
    const halo = ctx.createRadialGradient(0, 4, 4, 0, 4, 27);
    halo.addColorStop(0, 'rgba(255,120,150,0.45)'); halo.addColorStop(1, 'rgba(255,120,150,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 4, 27, 0, TAU); ctx.fill();
    ctx.save(); ctx.rotate(t * 0.8);
    ctx.strokeStyle = 'rgba(255,214,90,0.9)'; ctx.lineWidth = 1.6; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.arc(0, 3, 24 + beat * 20, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  // stems (meet at a knot above the heart) + leaves
  iconLimbQ(ctx, -7.6, -7.5, -6.5, -15, 1, -19, 1.9, '#6a9a34', 1.1);
  iconLimbQ(ctx, 7.6, -7.5, 6, -14, 1, -19, 1.9, '#6a9a34', 1.1);
  iconLeaf(ctx, 1.5, -19.5, 13, -0.35);
  iconLeaf(ctx, 0.5, -19, 8, -2.6, '#6cc44a');
  circle(ctx, 1, -19, 1.7, '#7a6030', 1);
  // heart body: two round cherry lobes meeting in a point
  ctx.beginPath();
  ctx.moveTo(0, -3.6);
  ctx.bezierCurveTo(-2.6, -10.5, -16.2, -11.5, -16.8, -0.5);
  ctx.bezierCurveTo(-17.2, 7.5, -8.5, 12.5, 0, 19.5);
  ctx.bezierCurveTo(8.5, 12.5, 17.2, 7.5, 16.8, -0.5);
  ctx.bezierCurveTo(16.2, -11.5, 2.6, -10.5, 0, -3.6);
  ctx.closePath();
  const body = ctx.createRadialGradient(-6, -3, 1, -2, 3, 22);
  body.addColorStop(0, container ? '#ff7486' : '#ff6a7c');
  body.addColorStop(0.42, container ? '#f0284a' : '#e01e3c');
  body.addColorStop(1, '#94082a');
  fillStroke(ctx, body, 2.4);
  // crease between the lobes + stem dimples
  ctx.strokeStyle = 'rgba(110,0,24,0.45)'; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -3); ctx.quadraticCurveTo(0.6, 0, 0, 2.6); ctx.stroke();
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * 9.6, -7.6); ctx.quadraticCurveTo(sx * 7.6, -6.2, sx * 5.8, -7.4); ctx.stroke(); }
  // rim light along the lower right edge
  ctx.strokeStyle = 'rgba(255,150,170,0.55)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(14.6, 3); ctx.quadraticCurveTo(11, 10, 3.5, 15.5); ctx.stroke();
  // glossy highlights
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath(); ctx.ellipse(-9.6, -3.6, 3.8, 2, -0.75, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(-5, -7, 1.15, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(-12.6, 1.6, 0.8, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,225,232,0.7)';
  ctx.beginPath(); ctx.ellipse(9.8, -4.2, 2.6, 1.2, 0.7, 0, TAU); ctx.fill();
  if (container) {
    const tw = (k: number) => Math.max(0, Math.sin(t * 3.4 + k * 2.1));
    iconTwinkle(ctx, -18, -14, 3.6 * tw(0), '#fff2b0');
    iconTwinkle(ctx, 19, -10, 3 * tw(1), '#ffffff');
    iconTwinkle(ctx, 17, 15, 2.6 * tw(2), '#ffd6e0');
    iconTwinkle(ctx, -17, 14, 2.4 * tw(3), '#fff2b0');
  }
  ctx.restore();
}

export function drawPea(ctx: C, x: number, y: number, s: number) {
  circle(ctx, x, y, 5 * s, '#7ad04a', 2);
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(x - 1.5 * s, y - 1.5 * s, 1.5 * s, 0, TAU); ctx.fill();
}

export function drawPeaPod(ctx: C, x: number, y: number, s: number, t: number) {
  ctx.save(); ctx.translate(x, y + Math.sin(t * 3 + x) * 2); ctx.scale(s, s); ctx.rotate(-0.3);
  ellipse(ctx, 0, 0, 16, 7, '#4fae3a', 2.4);
  for (let i = -1; i <= 1; i++) circle(ctx, i * 8, -1, 4, '#8ae05a', 1.4);
  ctx.restore();
}

export function drawHoney(ctx: C, x: number, y: number, s: number, t = 0) {
  ctx.save(); ctx.translate(x, y + Math.sin(t * 3) * 2); ctx.scale(s, s);
  rrect(ctx, -10, -10, 20, 22, 6, '#ffb020', 2.4);
  rrect(ctx, -11, -15, 22, 7, 3, '#f6efe0', 2);
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(-6, -6, 3, 12);
  ctx.restore();
}

/** «Перо Прыгуна»: curved cyan→white feather with notched vane, gold nib, wind curls and twinkles */
export function drawFeather(ctx: C, x: number, y: number, s: number, t = 0) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  // wind curls (behind, unrotated)
  const curl = (cx: number, cy: number, k: number, ph: number) => {
    const f = (t * 0.45 + ph) % 1;
    const a = Math.sin(Math.PI * f);
    if (a < 0.05) return;
    ctx.save(); ctx.translate(cx + f * 3 * k, cy); ctx.scale(k * (0.8 + 0.3 * f), 0.8 + 0.3 * f);
    ctx.globalAlpha = a;
    ctx.lineCap = 'round';
    for (const [c, w] of [['rgba(42,27,26,0.55)', 3], ['#8fe0ff', 1.6]] as const) {
      ctx.strokeStyle = c; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(-10, 0.5); ctx.quadraticCurveTo(-4, 1.5, 0, 0);
      ctx.bezierCurveTo(3.5, -1.6, 3.5, -6, 0, -6); ctx.bezierCurveTo(-2.6, -6, -2.6, -2.8, -0.4, -2.8);
      ctx.stroke();
    }
    ctx.restore();
  };
  curl(-9, -9, 1.3, 0);
  curl(10, 12, -1.15, 0.5);
  ctx.save();
  ctx.rotate(0.42 + Math.sin(t * 2) * 0.08);
  // rachis: quadratic curve base B → tip T bowing left
  const Bx = 0, By = 25, Cx = -7.5, Cy = 1, Tx = 3.5, Ty = -25;
  const P = (u: number): [number, number] => [(1 - u) ** 2 * Bx + 2 * u * (1 - u) * Cx + u * u * Tx, (1 - u) ** 2 * By + 2 * u * (1 - u) * Cy + u * u * Ty];
  const N = (u: number): [number, number] => {
    const dx = 2 * (1 - u) * (Cx - Bx) + 2 * u * (Tx - Cx), dy = 2 * (1 - u) * (Cy - By) + 2 * u * (Ty - Cy);
    const l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  };
  const U0 = 0.24; // vane starts here
  const hw = (v: number, side: number) => (side > 0 ? 9.2 : 6.6) * Math.pow(Math.sin(Math.PI * Math.pow(v, 0.72)), 0.75) * (1 - 0.15 * v);
  const notch: Record<number, number[]> = { 1: [0.3, 0.55, 0.76], [-1]: [0.42, 0.67] };
  const edge = (side: 1 | -1) => {
    const pts: Array<[number, number]> = [];
    const at = (v: number, k: number) => { const u = U0 + v * (1 - U0); const [px, py] = P(u); const [nx, ny] = N(u); const w = hw(v, side) * k * side; return [px + nx * w, py + ny * w] as [number, number]; };
    const n = 36;
    for (let i = 0; i <= n; i++) {
      const v = i / n;
      pts.push(at(v, 1));
      for (const c of notch[side]) if (v < c && (i + 1) / n >= c) { pts.push(at(c - 0.035, 0.98)); pts.push(at(c - 0.1, 0.5)); pts.push(at(c + 0.015, 0.98)); }
    }
    return pts;
  };
  const R = edge(1), L = edge(-1);
  const vane = () => {
    ctx.beginPath();
    const [bx, by] = P(U0); ctx.moveTo(bx, by);
    for (const [px, py] of R) ctx.lineTo(px, py);
    for (let i = L.length - 1; i >= 0; i--) ctx.lineTo(L[i][0], L[i][1]);
    ctx.closePath();
  };
  // bare quill
  const quill = () => { ctx.beginPath(); const [ax, ay] = P(0.02); ctx.moveTo(ax, ay); for (let u = 0.06; u <= U0 + 0.04; u += 0.04) { const [qx, qy] = P(u); ctx.lineTo(qx, qy); } };
  ctx.lineCap = 'round';
  quill(); ctx.strokeStyle = OUT; ctx.lineWidth = 4.4; ctx.stroke();
  quill(); ctx.strokeStyle = '#eef9ff'; ctx.lineWidth = 2.2; ctx.stroke();
  // downy fluff at the vane base
  const [fx, fy] = P(U0 + 0.02);
  for (const [dx, dy, cx2, cy2] of [[-5.5, 1, -3, -1.5], [5.8, 0, 3.5, -2], [-3.6, 4.2, -2.4, 2.4], [3.8, 3.8, 2.2, 2]] as const) iconLimbQ(ctx, fx, fy + 1, fx + cx2, fy + cy2, fx + dx, fy + dy, 1.8, '#d2f4ff', 0.8);
  // vane
  vane();
  const gr = ctx.createLinearGradient(Bx, By - 6, Tx, Ty);
  gr.addColorStop(0, '#1e8fd0'); gr.addColorStop(0.32, '#46c0f2'); gr.addColorStop(0.68, '#b4ecff'); gr.addColorStop(1, '#ffffff');
  ctx.fillStyle = gr; ctx.fill();
  ctx.save(); vane(); ctx.clip();
  // soft darker bars near the base
  for (const [u, a] of [[0.38, 0.22], [0.5, 0.13]] as const) {
    const [px, py] = P(u); const [nx, ny] = N(u);
    ctx.strokeStyle = `rgba(10,60,140,${a})`; ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.moveTo(px - nx * 12, py - ny * 12 + 2); ctx.lineTo(px + nx * 12, py + ny * 12 - 2); ctx.stroke();
  }
  // barbs: fine lines sweeping up and out from the rachis
  ctx.lineWidth = 0.55;
  for (let i = 0; i < 34; i++) {
    const u = U0 + (i / 34) * (1 - U0);
    const [px, py] = P(u);
    for (const side of [1, -1]) {
      const u2 = Math.min(1, u + 0.13); const [qx, qy] = P(u2); const [nx, ny] = N(u2);
      ctx.strokeStyle = i % 2 ? 'rgba(255,255,255,0.5)' : 'rgba(14,70,150,0.16)';
      ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + N(u)[0] * side * 5, py + N(u)[1] * side * 5 - 1.5, qx + nx * side * 11, qy + ny * side * 11); ctx.stroke();
    }
  }
  // pale tips on the outer edge
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2.4; vane(); ctx.stroke();
  ctx.restore();
  vane(); ctx.strokeStyle = OUT; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke();
  // rachis inside the vane
  ctx.beginPath(); { const [ax, ay] = P(U0); ctx.moveTo(ax, ay); for (let u = U0; u <= 0.97; u += 0.04) { const [qx, qy] = P(u); ctx.lineTo(qx, qy); } }
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.4; ctx.stroke();
  // golden nib at the quill end
  ctx.save();
  const [nbx, nby] = P(0.02);
  ctx.translate(nbx, nby); ctx.rotate(Math.atan2(By - Cy, Bx - Cx) - Math.PI / 2);
  ctx.beginPath(); ctx.moveTo(-2.5, -0.5); ctx.lineTo(2.5, -0.5); ctx.quadraticCurveTo(2, 4, 0, 7.5); ctx.quadraticCurveTo(-2, 4, -2.5, -0.5); ctx.closePath();
  fillStroke(ctx, '#f2c23a', 1.4);
  ctx.strokeStyle = OUT; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(0, 3.6); ctx.lineTo(0, 6.4); ctx.stroke();
  circle(ctx, 0, 2.2, 0.95, '#5ff4ff', 0.6);
  rrect(ctx, -2.9, -2.6, 5.8, 2.4, 1, '#d89a22', 1.2);
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(-1.6, 0.3, 0.9, 3);
  ctx.restore();
  ctx.restore();
  // twinkles
  const tw = (k: number) => Math.max(0, Math.sin(t * 3.2 + k * 2.3));
  iconTwinkle(ctx, -14, -12, 3.4 * tw(0), '#ffffff');
  iconTwinkle(ctx, 16, 6, 2.8 * tw(1), '#bff0ff');
  iconTwinkle(ctx, 2, -22, 2.2 * tw(2), '#fff2b0');
  ctx.restore();
}

/** «Плащ-Рывок»: violet star cape streaming back in the wind of a dash — scalloped mantle, winged clasp with a gem, comet emblem */
export function drawCloak(ctx: C, x: number, y: number, s: number, t = 0) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  const w1 = Math.sin(t * 5), w2 = Math.sin(t * 5 + 1.4), w3 = Math.sin(t * 3.7 + 2.2);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // speed streaks trailing behind (left)
  for (const [yy, x0, len, w] of [[-6, -15, 7, 2.2], [3, -21, 6, 2], [11, -19, 6, 1.7], [18, -9, 6, 1.5]] as const) {
    const d = ((t * 26 + yy * 1.7) % 5) - 2.5;
    ctx.strokeStyle = 'rgba(150,110,255,0.85)'; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0 - len + d, yy); ctx.lineTo(x0 + d, yy); ctx.stroke();
  }
  // cape body: hangs from the shoulders (upper right) and streams to the lower left
  const cape = () => {
    ctx.beginPath();
    ctx.moveTo(-2, -12.5);
    ctx.bezierCurveTo(-8, -9 + w2 * 0.6, -14, -7 + w1, -18 + w2 * 0.6, -2 + w1);
    ctx.quadraticCurveTo(-21 + w3 * 0.6, 1, -23 + w1 * 0.8, 6 + w2);
    ctx.quadraticCurveTo(-17, 8 + w3, -15 + w2 * 0.5, 13 + w1 * 0.8);
    ctx.quadraticCurveTo(-9, 12.5 + w2, -6.5, 17.5 + w3 * 0.8);
    ctx.quadraticCurveTo(-0.5, 15 + w1, 3.5, 19 + w2 * 0.6);
    ctx.quadraticCurveTo(8, 15.5, 12, 15.5 + w3 * 0.5);
    ctx.bezierCurveTo(13.5, 6, 15, -2, 14, -9.5);
    ctx.closePath();
  };
  cape();
  const gr = ctx.createLinearGradient(10, -12, -14, 18);
  gr.addColorStop(0, '#2e2378'); gr.addColorStop(0.5, '#4a2fa4'); gr.addColorStop(1, '#7040cc');
  ctx.fillStyle = gr; ctx.fill();
  ctx.save(); cape(); ctx.clip();
  // lining shows where the top edge rolls over in the wind
  ctx.beginPath();
  ctx.moveTo(-2, -12.5);
  ctx.bezierCurveTo(-8, -9 + w2 * 0.6, -14, -7 + w1, -18 + w2 * 0.6, -2 + w1);
  ctx.quadraticCurveTo(-21 + w3 * 0.6, 1, -23 + w1 * 0.8, 6 + w2);
  ctx.quadraticCurveTo(-17, 0.5 + w1 * 0.6, -12, -2.5 + w2 * 0.5);
  ctx.quadraticCurveTo(-7, -6, -2, -8.5);
  ctx.closePath();
  const lg = ctx.createLinearGradient(-20, 4, -2, -12);
  lg.addColorStop(0, '#c88af4'); lg.addColorStop(1, '#8a48d0');
  ctx.fillStyle = lg; ctx.fill();
  ctx.strokeStyle = 'rgba(42,27,26,0.7)'; ctx.lineWidth = 1; ctx.stroke();
  // fold shading
  ctx.strokeStyle = 'rgba(20,8,60,0.3)'; ctx.lineWidth = 2.4;
  for (const [ax, ay, bx, by] of [[-6, -3, -11, 12], [5, -4, 1, 16]] as const) { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + bx) / 2 + 2, (ay + by) / 2, bx, by); ctx.stroke(); }
  // constellations + tiny stars
  ctx.strokeStyle = 'rgba(255,232,170,0.75)'; ctx.lineWidth = 0.6;
  const cons: Array<Array<[number, number]>> = [[[-16, 6], [-12, 9.5], [-14.5, 12.5]], [[6, 7], [10, 4], [9.5, 11], [6.5, 14]]];
  for (const c of cons) { ctx.beginPath(); c.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke(); }
  ctx.fillStyle = '#fff4c8';
  for (const c of cons) for (const [px, py] of c) { ctx.beginPath(); ctx.arc(px, py, 0.95, 0, TAU); ctx.fill(); }
  for (const [px, py] of [[-8, 1], [3, -6], [-3, 15], [-9, 15], [10, -3], [-19, 5]] as const) { ctx.beginPath(); ctx.arc(px, py, 0.55, 0, TAU); ctx.fill(); }
  // emblem: golden shooting star, its tail streaming back like the cape
  ctx.strokeStyle = '#ffd34a';
  for (const [ex, ey, w] of [[-10.5, 0.5, 1.9], [-11, 5, 1.4], [-8.5, 8.5, 1]] as const) { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.quadraticCurveTo(-5, 3, -2.5, 5); ctx.stroke(); }
  iconStarPath(ctx, -0.5, 5.5, 5.4, 2.4, -Math.PI / 2 + 0.2); fillStroke(ctx, '#ffd34a', 1.2);
  iconStarPath(ctx, -0.9, 5.1, 3.1, 1.35, -Math.PI / 2 + 0.2); ctx.fillStyle = '#ffeea0'; ctx.fill();
  // gold trim inset along every edge (+ stitched dots)
  ctx.strokeStyle = '#f2c23a'; ctx.lineWidth = 3.4; cape(); ctx.stroke();
  ctx.strokeStyle = '#ffe58a'; ctx.lineWidth = 0.9; ctx.setLineDash([0.1, 2.6]); cape(); ctx.stroke(); ctx.setLineDash([]);
  ctx.restore();
  cape(); ctx.strokeStyle = OUT; ctx.lineWidth = 2.2; ctx.stroke();
  // high collar (behind the mantle)
  ctx.beginPath(); ctx.moveTo(1, -13); ctx.quadraticCurveTo(-1.5, -19, 1.5, -22.5); ctx.quadraticCurveTo(7.5, -19.5, 12.5, -19); ctx.quadraticCurveTo(12.5, -15, 11, -12.5); ctx.closePath();
  fillStroke(ctx, '#3a2a90', 1.6);
  ctx.strokeStyle = '#f2c23a'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(1.5, -22.5); ctx.quadraticCurveTo(7.5, -19.5, 12.5, -19); ctx.stroke();
  // scalloped shoulder mantle
  const mantle = () => {
    ctx.beginPath();
    ctx.moveTo(2, -15.5);
    ctx.quadraticCurveTo(-4.5, -13.5, -5.5, -7);
    for (let i = 0; i < 4; i++) { const x0 = -5.5 + i * 5.4; ctx.quadraticCurveTo(x0 + 2.7, -2.4 + i * 0.2, x0 + 5.4, -6.6 + i * 0.3); }
    ctx.quadraticCurveTo(17.5, -12, 12, -15.5);
    ctx.quadraticCurveTo(7, -17, 2, -15.5);
    ctx.closePath();
  };
  mantle();
  const mg = ctx.createLinearGradient(0, -16, 0, -4);
  mg.addColorStop(0, '#2a1f6c'); mg.addColorStop(1, '#4a32a8');
  ctx.fillStyle = mg; ctx.fill();
  ctx.save(); mantle(); ctx.clip();
  ctx.strokeStyle = '#f2c23a'; ctx.lineWidth = 3; mantle(); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-4.5, -9.2); ctx.quadraticCurveTo(5, -11.5, 15, -9); ctx.stroke();
  for (const px of [-1, 4.5, 10]) iconTwinkle(ctx, px, -12.2, 1.25, '#ffe58a', 0);
  ctx.strokeStyle = 'rgba(200,180,255,0.7)'; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(-3.5, -9.5); ctx.quadraticCurveTo(-2.5, -13, 2, -14.2); ctx.stroke();
  ctx.restore();
  mantle(); ctx.strokeStyle = OUT; ctx.lineWidth = 2; ctx.stroke();
  // winged clasp at the front of the neck, with a glowing gem
  ctx.save(); ctx.translate(15.5, -13.5);
  ctx.beginPath(); ctx.moveTo(0, -1); ctx.quadraticCurveTo(3, -6.5, 8.5, -7.2); ctx.quadraticCurveTo(6.6, -5.4, 5.6, -4.8);
  ctx.quadraticCurveTo(7.8, -4.2, 8.4, -3); ctx.quadraticCurveTo(5.6, -2.8, 4.4, -2.4); ctx.quadraticCurveTo(5.6, -1, 5.6, 0); ctx.quadraticCurveTo(2.5, 0.4, 0, -1);
  ctx.closePath(); fillStroke(ctx, '#f2c23a', 1.2);
  const gl = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 7);
  gl.addColorStop(0, 'rgba(120,240,255,0.75)'); gl.addColorStop(1, 'rgba(120,240,255,0)');
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
  circle(ctx, 0, 0, 3.4, '#f2c23a', 1.3);
  ctx.beginPath(); ctx.moveTo(0, -2.3); ctx.lineTo(1.7, 0); ctx.lineTo(0, 2.3); ctx.lineTo(-1.7, 0); ctx.closePath(); fillStroke(ctx, '#5ff4ff', 0.8);
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(-0.5, -0.8, 0.55, 0, TAU); ctx.fill();
  ctx.restore();
  // twinkles
  const tw = (k: number) => Math.max(0, Math.sin(t * 3 + k * 2.2));
  iconTwinkle(ctx, 20, -2, 3.2 * tw(0), '#fff2b0');
  iconTwinkle(ctx, -6, -18, 2.6 * tw(1), '#c9b0ff');
  iconTwinkle(ctx, 18, 19, 2.4 * tw(2), '#9ff0ff');
  ctx.restore();
}

/** «Рогатка»: wooden Y slingshot, leather-wrapped grip, red bands, leather pouch with a green pea */
export function drawSlingIcon(ctx: C, x: number, y: number, s: number) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.rotate(-0.1);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const tipL: [number, number] = [-12.5, -16.5], tipR: [number, number] = [12.5, -16.5];
  const arms: Array<[number, number, number, number, number, number]> = [
    [0, 5, -8.5, 0, tipL[0], tipL[1]],
    [0, 5, 8.5, 0, tipR[0], tipR[1]],
  ];
  const seg = (a: number[], w: number, c: string) => {
    ctx.strokeStyle = c; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(a[2], a[3], a[4], a[5]); ctx.stroke();
  };
  const handle = [0, 4, 0.6, 14, 0, 23.5];
  // outline pass, then wood, then grain highlights (so joints merge cleanly)
  for (const a of arms) seg(a, 9.4, OUT);
  seg(handle, 10.4, OUT);
  for (const a of arms) seg(a, 5.6, '#c27a40');
  seg(handle, 6.6, '#b06a36');
  for (const a of arms) { seg([a[0] - 1, a[1], a[2] - 1.2, a[3], a[4] - 1, a[5]], 1.4, 'rgba(255,214,150,0.75)'); seg([a[0] + 1.6, a[1] + 1, a[2] + 1.4, a[3] + 0.6, a[4] + 1.4, a[5] + 0.4], 1, 'rgba(110,52,18,0.45)'); }
  // knob tips with band wraps
  for (const [tx, ty] of [tipL, tipR]) {
    ellipse(ctx, tx, ty - 1.2, 3.2, 2.4, '#e0a868', 1.6);
    rrect(ctx, tx - 3.3, ty + 1, 6.6, 2, 1, '#e0303a', 1.1);
    rrect(ctx, tx - 3.2, ty + 3.6, 6.4, 1.8, 0.9, '#e0303a', 1.1);
  }
  // grip: leather wrap + brass bands + end knob
  ctx.save();
  ctx.beginPath(); ctx.rect(-3.4, 7.5, 6.8, 13.5); ctx.clip();
  ctx.fillStyle = '#7a4428'; ctx.fillRect(-4, 7, 8, 15);
  ctx.strokeStyle = '#4e2614'; ctx.lineWidth = 1.5;
  for (let yy = 6; yy < 24; yy += 3) { ctx.beginPath(); ctx.moveTo(-4, yy + 2.2); ctx.lineTo(4, yy - 0.4); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,200,150,0.35)'; ctx.lineWidth = 0.8;
  for (let yy = 6; yy < 24; yy += 3) { ctx.beginPath(); ctx.moveTo(-3, yy + 0.9); ctx.lineTo(3, yy - 1); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = OUT; ctx.lineWidth = 1.3; ctx.strokeRect(-3.4, 7.5, 6.8, 13.5);
  rrect(ctx, -4.2, 6.2, 8.4, 2.4, 1.1, '#e8b440', 1.3);
  rrect(ctx, -4.2, 19.8, 8.4, 2.4, 1.1, '#e8b440', 1.3);
  ellipse(ctx, 0.2, 24.2, 3.6, 2, '#e0a868', 1.6);
  // little sprout on the right arm
  iconLimbQ(ctx, 6.8, -5, 8.5, -7.5, 10.5, -8, 0.9, '#7a5a2a', 0.8);
  iconLeaf(ctx, 10.5, -8, 6.5, -0.5);
  // bands to the pouch (pulled toward the viewer)
  const pouchY = -5.2;
  for (const [tx, ty] of [tipL, tipR]) {
    const sx = Math.sign(tx);
    for (const [dy, py] of [[2, -1], [4.6, 1]] as const) {
      ctx.strokeStyle = OUT; ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.moveTo(tx, ty + dy); ctx.quadraticCurveTo(sx * 7, pouchY - 3 + py, sx * 4.2, pouchY + py); ctx.stroke();
      ctx.strokeStyle = '#e8343c'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(tx, ty + dy); ctx.quadraticCurveTo(sx * 7, pouchY - 3 + py, sx * 4.2, pouchY + py); ctx.stroke();
    }
  }
  // pouch + pea
  ellipse(ctx, 0, pouchY + 0.6, 5.6, 3.6, '#7a3a2a', 1.6);
  ctx.strokeStyle = '#e8c890'; ctx.lineWidth = 0.6; ctx.setLineDash([0.9, 1.1]);
  ctx.beginPath(); ctx.ellipse(0, pouchY + 0.6, 4.3, 2.5, 0, 0.15, Math.PI - 0.15); ctx.stroke(); ctx.setLineDash([]);
  const pg = ctx.createRadialGradient(-1.4, pouchY - 2.6, 0.5, 0, pouchY - 1, 4.4);
  pg.addColorStop(0, '#c8ff8a'); pg.addColorStop(0.5, '#7ad04a'); pg.addColorStop(1, '#3f9a2a');
  circle(ctx, 0, pouchY - 1.2, 3.9, pg, 1.6);
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.ellipse(-1.4, pouchY - 2.8, 1.3, 0.8, -0.6, 0, TAU); ctx.fill();
  // glint
  iconTwinkle(ctx, 6.5, -11, 2.2, '#fff6c8', 0.9);
  ctx.restore();
}

export function drawSwordIcon(ctx: C, x: number, y: number, s: number) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.rotate(-Math.PI / 4);
  ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(18, -4); ctx.lineTo(24, 0); ctx.lineTo(18, 4); ctx.lineTo(-6, 4); ctx.closePath();
  fillStroke(ctx, '#e2b77a', 2);
  rrect(ctx, -9, -9, 4, 18, 1.5, '#8a5530', 2);
  rrect(ctx, -18, -2.5, 10, 5, 2, '#5a3520', 2);
  ctx.restore();
}

/** «Вилка-Копьё»: silver four-tine fork-spear, gold collar with a ruby, red grip with gold wrap, pennant */
export function drawForkIcon(ctx: C, x: number, y: number, s: number) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.rotate(-Math.PI / 4);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // local frame: the fork lies along +x (tines at +x); the pennant flies back on the +y side
  ctx.beginPath();
  ctx.moveTo(4.5, 1.4); ctx.quadraticCurveTo(-3, 6.5, -13, 14); ctx.lineTo(-8.4, 9.2); ctx.lineTo(-15.5, 8.6); ctx.quadraticCurveTo(-8, 5.4, -3.5, 1.4); ctx.closePath();
  fillStroke(ctx, '#ee3a40', 1.5);
  ctx.save(); ctx.clip();
  ctx.strokeStyle = '#f2c23a'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-4, 2.6); ctx.lineTo(5.5, 2.6); ctx.stroke();
  ctx.strokeStyle = 'rgba(140,20,30,0.4)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, 5); ctx.quadraticCurveTo(-5, 7.8, -12, 11.5); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,190,190,0.6)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(1.5, 3.8); ctx.quadraticCurveTo(-5, 6, -12.5, 9.6); ctx.stroke();
  ctx.restore();
  iconStarPath(ctx, -4.2, 6.4, 2.4, 1.05, -Math.PI / 2 - 0.5); fillStroke(ctx, '#fff6da', 0.8);
  // shaft (silver)
  const sh = ctx.createLinearGradient(0, -1.7, 0, 1.7);
  sh.addColorStop(0, '#f2f6fb'); sh.addColorStop(0.5, '#c4cfde'); sh.addColorStop(1, '#8a98ae');
  rrect(ctx, -11, -1.6, 19, 3.2, 1.6, sh, 1.4);
  // grip: red leather + gold spiral wrap
  rrect(ctx, -21, -2.5, 11, 5, 1.5, '#a82434', 1.4);
  ctx.save(); rrPath(ctx, -21, -2.5, 11, 5, 1.5); ctx.clip();
  ctx.strokeStyle = '#f2c23a'; ctx.lineWidth = 1.2;
  for (let gx = -23; gx < -9; gx += 2.6) { ctx.beginPath(); ctx.moveTo(gx, 3); ctx.lineTo(gx + 2.4, -3); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-21, -1.9, 11, 1);
  ctx.restore();
  rrect(ctx, -11.4, -3, 2.3, 6, 1, '#f2c23a', 1.2);
  rrect(ctx, -22.2, -3, 2.3, 6, 1, '#f2c23a', 1.2);
  // pommel: spike + gold ball + ruby
  ctx.beginPath(); ctx.moveTo(-24, -1.3); ctx.lineTo(-28, 0); ctx.lineTo(-24, 1.3); ctx.closePath(); fillStroke(ctx, '#d89a22', 1.1);
  circle(ctx, -24, 0, 2.7, '#f2c23a', 1.3);
  circle(ctx, -24, 0, 1.1, '#ff3a5a', 0.7);
  // gold collar with a ruby
  rrect(ctx, 6.4, -3, 3, 6, 1.1, '#f2c23a', 1.2);
  ctx.beginPath(); ctx.moveTo(7.9, -1.5); ctx.lineTo(9, 0); ctx.lineTo(7.9, 1.5); ctx.lineTo(6.8, 0); ctx.closePath(); fillStroke(ctx, '#ff3a5a', 0.7);
  // head: neck flaring into the palm, four long pointed tines
  const tw = 1.05, xs = [-4.65, -1.55, 1.55, 4.65], tips = [28.4, 29.6, 29.6, 28.4], G0 = 16.2;
  const head = () => {
    ctx.beginPath();
    ctx.moveTo(9.4, -1.5);
    ctx.bezierCurveTo(12, -1.7, 12.6, xs[0] - tw, 15, xs[0] - tw);
    for (let k = 0; k < 4; k++) {
      const l = xs[k] - tw, r = xs[k] + tw;
      if (k > 0) ctx.lineTo(G0, l);
      ctx.lineTo(tips[k] - 3, l);
      ctx.quadraticCurveTo(tips[k] - 1.1, l + 0.1, tips[k], xs[k]);
      ctx.quadraticCurveTo(tips[k] - 1.1, r - 0.1, tips[k] - 3, r);
      if (k < 3) { ctx.lineTo(G0, r); ctx.arc(G0, (r + xs[k + 1] - tw) / 2, (xs[k + 1] - tw - r) / 2, -Math.PI / 2, Math.PI / 2, true); }
    }
    ctx.lineTo(15, xs[3] + tw);
    ctx.bezierCurveTo(12.6, xs[3] + tw, 12, 1.7, 9.4, 1.5);
    ctx.closePath();
  };
  head();
  const hg = ctx.createLinearGradient(0, -6, 0, 6);
  hg.addColorStop(0, '#f4f8fc'); hg.addColorStop(0.45, '#cdd7e4'); hg.addColorStop(1, '#8592a8');
  fillStroke(ctx, hg, 1.5);
  // star inlay + shines
  iconStarPath(ctx, 13.2, 0, 2.1, 0.95, 0); fillStroke(ctx, '#f2c23a', 0.8);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 0.65;
  for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(G0 + 1.2, xs[k] - 0.4); ctx.lineTo(tips[k] - 3.2, xs[k] - 0.4); ctx.stroke(); }
  ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-9.5, -0.65); ctx.lineTo(5.5, -0.65); ctx.stroke();
  iconTwinkle(ctx, 29, -4.5, 2.6, '#ffffff', 0.9);
  ctx.restore();
}

export function lightGlow(ctx: C, x: number, y: number, r: number, color: string, a: number) { glow(ctx, x, y, r, color, a); }

export function vignetteCanvas(w: number, h: number, strength = 0.6) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, `rgba(10,2,6,${strength})`);
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  return c;
}

export { rgba };

// ───────────────────────────── GOLDEN WALNUTS, UPGRADES & BOMBS (HUD / shop icons) ─────────────────────────────
// All centred at (x, y); about 40×40 px at s = 1.

/** walnut silhouette: egg-ish, a little point on top, slightly knobbly contour */
function walnutPath(ctx: C, rx: number, ry: number) {
  ctx.beginPath();
  const n = 56;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU - Math.PI / 2;
    const c = Math.cos(a), sn = Math.sin(a);
    const top = Math.max(0, -sn);
    const k = 1 + 0.035 * Math.sin(a * 13 + 0.7) + 0.015 * Math.sin(a * 5 + 2);
    const px = c * rx * k * (1 - 0.1 * top * top);
    const py = sn * ry * k - top ** 12 * ry * 0.12;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
}
/** brain-like wrinkle squiggles on both walnut halves (unit coords, the seam is x = 0) */
const WALNUT_WRINKLES: Array<Array<[number, number]>> = [
  // left half
  [[-0.14, -0.8], [-0.34, -0.74], [-0.3, -0.58], [-0.5, -0.52], [-0.46, -0.36]],
  [[-0.62, -0.62], [-0.7, -0.42]],
  [[-0.16, -0.4], [-0.32, -0.24], [-0.6, -0.22], [-0.56, -0.04], [-0.82, 0.02]],
  [[-0.2, -0.04], [-0.28, 0.14], [-0.48, 0.18], [-0.42, 0.36]],
  [[-0.72, 0.26], [-0.62, 0.46], [-0.36, 0.56], [-0.4, 0.74]],
  [[-0.16, 0.42], [-0.2, 0.62], [-0.12, 0.8]],
  // right half
  [[0.16, -0.76], [0.38, -0.7], [0.46, -0.52], [0.62, -0.5]],
  [[0.18, -0.5], [0.3, -0.34], [0.52, -0.3], [0.66, -0.14]],
  [[0.84, -0.22], [0.74, 0.0]],
  [[0.18, -0.12], [0.36, 0.04], [0.3, 0.22], [0.54, 0.26], [0.6, 0.44]],
  [[0.82, 0.24], [0.72, 0.46]],
  [[0.16, 0.36], [0.34, 0.52], [0.22, 0.68], [0.42, 0.78]],
];
const WALNUT_LUMPS: Array<[number, number]> = [[-0.46, -0.62], [-0.66, -0.12], [-0.4, 0.04], [-0.52, 0.32], [-0.26, 0.66], [-0.24, -0.28],
  [0.5, -0.62], [0.42, -0.16], [0.66, 0.08], [0.44, 0.38], [0.3, 0.64], [0.28, -0.42]];
function squiggle(ctx: C, pts: Array<[number, number]>, rx: number, ry: number, sx: number, dx = 0, dy = 0) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * rx * sx + dx, pts[0][1] * ry + dy);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = ((pts[i][0] + pts[i + 1][0]) / 2) * rx * sx + dx, my = ((pts[i][1] + pts[i + 1][1]) / 2) * ry + dy;
    ctx.quadraticCurveTo(pts[i][0] * rx * sx + dx, pts[i][1] * ry + dy, mx, my);
  }
  const l = pts[pts.length - 1];
  ctx.lineTo(l[0] * rx * sx + dx, l[1] * ry + dy);
  ctx.stroke();
}
/** shiny golden walnut body (centred at 0,0): gold gradient shell, embossed wrinkles, seam ridge, gloss */
function goldenWalnut(ctx: C, rx: number, ry: number, lw = 2.2) {
  walnutPath(ctx, rx, ry);
  const g = ctx.createRadialGradient(-rx * 0.35, -ry * 0.4, rx * 0.08, 0, 0, Math.max(rx, ry) * 1.2);
  g.addColorStop(0, '#fff8c0'); g.addColorStop(0.3, '#ffd83a'); g.addColorStop(0.72, '#f2a012'); g.addColorStop(1, '#b25c00');
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); walnutPath(ctx, rx, ry); ctx.clip();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const w = Math.max(0.7, rx * 0.085);
  // rounded lumps between the grooves
  ctx.fillStyle = 'rgba(255,246,190,0.5)';
  for (const [lx, ly] of WALNUT_LUMPS) { ctx.beginPath(); ctx.ellipse(lx * rx, ly * ry, rx * 0.11, ry * 0.07, 0.4, 0, TAU); ctx.fill(); }
  ctx.strokeStyle = 'rgba(255,248,190,0.85)'; ctx.lineWidth = w * 0.7;
  for (const p of WALNUT_WRINKLES) squiggle(ctx, p, rx, ry, 1, -w * 0.45, -w * 0.55);
  ctx.strokeStyle = 'rgba(140,62,0,0.8)'; ctx.lineWidth = w;
  for (const p of WALNUT_WRINKLES) squiggle(ctx, p, rx, ry, 1);
  // shade the lower right, rim light the lower left
  const sh = ctx.createLinearGradient(-rx, -ry, rx, ry);
  sh.addColorStop(0.55, 'rgba(160,70,0,0)'); sh.addColorStop(1, 'rgba(140,60,0,0.35)');
  ctx.fillStyle = sh; ctx.fillRect(-rx * 1.2, -ry * 1.3, rx * 2.4, ry * 2.6);
  // seam: dark groove + raised bright ridge
  const seam = () => { ctx.beginPath(); ctx.moveTo(0, -ry * 1.25); ctx.bezierCurveTo(rx * 0.1, -ry * 0.3, -rx * 0.08, ry * 0.4, 0, ry * 1.1); ctx.stroke(); };
  ctx.strokeStyle = 'rgba(130,56,0,0.7)'; ctx.lineWidth = rx * 0.24; seam();
  ctx.strokeStyle = '#ffe680'; ctx.lineWidth = rx * 0.11; seam();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = rx * 0.04;
  ctx.save(); ctx.translate(-rx * 0.03, 0); seam(); ctx.restore();
  ctx.restore();
  walnutPath(ctx, rx, ry); ctx.strokeStyle = OUT; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke();
  // gloss
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath(); ctx.ellipse(-rx * 0.5, -ry * 0.42, rx * 0.16, ry * 0.09, -0.9, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(-rx * 0.32, -ry * 0.66, Math.max(0.5, rx * 0.06), 0, TAU); ctx.fill();
}

/** «Золотой орешек»: shiny golden walnut with a warm halo and twinkles (HUD counter / shop currency) */
export function drawGoldenNut(ctx: C, x: number, y: number, s: number, t = 0) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.6);
  const halo = ctx.createRadialGradient(0, 0, 3, 0, 0, 21);
  halo.addColorStop(0, `rgba(255,214,90,${0.5 + 0.15 * pulse})`); halo.addColorStop(1, 'rgba(255,190,60,0)');
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, 21, 0, TAU); ctx.fill();
  ctx.rotate(Math.sin(t * 1.7) * 0.06);
  goldenWalnut(ctx, 13.5, 15.5, 2.3);
  ctx.rotate(-Math.sin(t * 1.7) * 0.06);
  const tw = (k: number) => Math.max(0, Math.sin(t * 3.3 + k * 2.2));
  iconTwinkle(ctx, 13, -12, 3.6 * (0.35 + 0.65 * tw(0)), '#fff6c0');
  iconTwinkle(ctx, -14, 9, 2.6 * tw(1), '#ffffff');
  iconTwinkle(ctx, 14, 12, 2 * tw(2), '#ffe27a');
  ctx.restore();
}

/** «Магнит»: red horseshoe magnet with silver poles pulling a few crumbs in */
export function drawMagnet(ctx: C, x: number, y: number, s: number, t = 0) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.rotate(-0.42);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const R = 12.5, r = 5, cy = -5, leg = 9;
  // crumbs being pulled up toward the poles (drawn first, behind)
  for (let k = 0; k < 3; k++) {
    const u = (t * 0.7 + k / 3) % 1;
    const tx = (k === 1 ? 1 : -1) * 8.6 * (k === 2 ? 0.2 : 1), ty = cy + leg + 4;
    const sx = (k - 1) * 7 + Math.sin(k * 2.1) * 2, sy = 17 + k * 1.2;
    const e = u * u * (3 - 2 * u);
    const px = sx + (tx - sx) * e, py = sy + (ty - sy) * e;
    const a = Math.min(1, u * 4) * (1 - Math.max(0, (u - 0.85) / 0.15));
    if (a <= 0.02) continue;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(px, py); ctx.rotate(u * 5 + k); ctx.scale(1 - 0.35 * e, 1 - 0.35 * e);
    // motion dashes behind the crumb
    ctx.strokeStyle = 'rgba(255,240,200,0.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-1, 5); ctx.lineTo(-1, 8.5); ctx.moveTo(2, 5.5); ctx.lineTo(2, 7.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-3.6, 2.2); ctx.lineTo(-4, -1.4); ctx.lineTo(-0.6, -3.6); ctx.lineTo(3.6, -2.4); ctx.lineTo(4, 2); ctx.lineTo(0.6, 3.6); ctx.closePath();
    fillStroke(ctx, '#f0b850', 1.4);
    ctx.fillStyle = '#ffe2a0'; ctx.fillRect(-2, -2, 2.6, 1.3);
    ctx.fillStyle = '#c8803a'; ctx.fillRect(0.8, 0.6, 1.3, 1.3);
    ctx.restore();
  }
  // magnetic field arcs between the poles
  const fa = 0.45 + 0.35 * Math.sin(t * 6);
  ctx.strokeStyle = `rgba(160,230,255,${fa})`; ctx.lineWidth = 1.3; ctx.setLineDash([2, 2.4]); ctx.lineDashOffset = -t * 12;
  for (const k of [1, 1.6]) { ctx.beginPath(); ctx.ellipse(0, cy + leg + 4, 8.6, 3.2 * k, 0, 0.15, Math.PI - 0.15); ctx.stroke(); }
  ctx.setLineDash([]);
  // horseshoe body
  const shoe = () => {
    ctx.beginPath();
    ctx.arc(0, cy, R, Math.PI, 0);
    ctx.lineTo(R, cy + leg); ctx.lineTo(r, cy + leg); ctx.lineTo(r, cy);
    ctx.arc(0, cy, r, 0, Math.PI, true);
    ctx.lineTo(-r, cy + leg); ctx.lineTo(-R, cy + leg);
    ctx.closePath();
  };
  shoe();
  const g = ctx.createLinearGradient(-R, cy - R, R, cy + leg);
  g.addColorStop(0, '#ff6a60'); g.addColorStop(0.45, '#e82a2a'); g.addColorStop(1, '#a8101a');
  fillStroke(ctx, g, 2.4);
  // shine along the top of the arch
  ctx.strokeStyle = 'rgba(255,220,210,0.85)'; ctx.lineWidth = 1.7;
  ctx.beginPath(); ctx.arc(0, cy, (R + r) / 2 + 1.6, Math.PI + 0.35, Math.PI * 1.62); ctx.stroke();
  ctx.strokeStyle = 'rgba(120,0,10,0.35)'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(0, cy, (R + r) / 2 - 1.8, Math.PI * 1.75, Math.PI * 2.05); ctx.stroke();
  // silver pole tips
  for (const sx of [-1, 1]) {
    const x0 = sx > 0 ? r : -R;
    const sg = ctx.createLinearGradient(x0, 0, x0 + (R - r), 0);
    sg.addColorStop(0, '#f6f9fc'); sg.addColorStop(0.5, '#cdd6e2'); sg.addColorStop(1, '#8592a8');
    rrect(ctx, x0, cy + leg - 0.5, R - r, 6.5, 1.2, sg, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x0 + 1.2, cy + leg + 0.8, 1.3, 3.8);
  }
  iconTwinkle(ctx, -10.5, cy - 9.5, 2.6 * (0.4 + 0.6 * Math.max(0, Math.sin(t * 3.2))), '#ffffff', 0.9);
  ctx.restore();
}

/** «Крышка-щит»: round pot-lid shield — riveted dark rim, pressed ring, black knob, a little dent */
export function drawPotLid(ctx: C, x: number, y: number, s: number, t = 0) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  const RX = 17.5, RY = 16.5;
  // rim
  ellipse(ctx, 0, 0.6, RX, RY, '#7a8494', 2.4);
  // face
  const face = () => { ctx.beginPath(); ctx.ellipse(0, 0, RX - 2.6, RY - 2.6, 0, 0, TAU); };
  face();
  const g = ctx.createRadialGradient(-6, -7, 1, 0, 0, RX);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#e2e8f0'); g.addColorStop(0.8, '#b4bfcd'); g.addColorStop(1, '#8e9aab');
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); face(); ctx.clip();
  // broad diagonal shine
  ctx.rotate(-0.7);
  const sg = ctx.createLinearGradient(0, -10, 0, 0);
  sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.55)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sg; ctx.fillRect(-20, -10, 40, 10);
  ctx.restore();
  // pressed concentric ring
  ctx.strokeStyle = 'rgba(110,122,140,0.75)'; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.ellipse(0, 0.5, 10.5, 9.8, 0, 0, TAU); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(0, -0.5, 10.5, 9.8, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  // dent + scratch
  ctx.fillStyle = 'rgba(120,132,150,0.55)'; ctx.beginPath(); ctx.ellipse(8.2, 7.4, 3.4, 2.3, -0.5, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.ellipse(8.2, 7.6, 3.4, 2.3, -0.5, 0.1 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.strokeStyle = 'rgba(90,100,118,0.6)'; ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.moveTo(-10, 4); ctx.lineTo(-6.5, 6.5); ctx.moveTo(-9, 6.2); ctx.lineTo(-7.2, 7.4); ctx.stroke();
  face(); ctx.strokeStyle = 'rgba(42,27,26,0.55)'; ctx.lineWidth = 1; ctx.stroke();
  // rivets on the rim
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + 0.3;
    const px = Math.cos(a) * (RX - 1.2), py = Math.sin(a) * (RY - 1.2) + 0.4;
    ctx.fillStyle = '#dfe5ee'; ctx.beginPath(); ctx.arc(px, py, 0.95, 0, TAU); ctx.fill();
  }
  // knob: washer, shadow, black ball
  ctx.fillStyle = 'rgba(40,40,60,0.3)'; ctx.beginPath(); ctx.ellipse(1.5, 3.4, 5.6, 3, 0, 0, TAU); ctx.fill();
  ellipse(ctx, 0, 1.6, 5, 3.4, '#9aa4b4', 1.4);
  const kg = ctx.createRadialGradient(-1.6, -2.6, 0.4, 0, -0.6, 5);
  kg.addColorStop(0, '#6a5f66'); kg.addColorStop(0.5, '#2e2629'); kg.addColorStop(1, '#141012');
  circle(ctx, 0, -0.8, 4.4, kg, 1.6);
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.ellipse(-1.5, -2.6, 1.4, 0.8, -0.6, 0, TAU); ctx.fill();
  iconTwinkle(ctx, -11, -10, 2.8 * (0.35 + 0.65 * Math.max(0, Math.sin(t * 3))), '#ffffff', 0.9);
  ctx.restore();
}

/** «Соты»: a honeycomb chunk, honey dripping off the bottom (with a falling drop) */
export function drawHoneycomb(ctx: C, x: number, y: number, s: number, t = 0) {
  ctx.save(); ctx.translate(x, y - 3); ctx.scale(s, s);
  const r = 6.4, hw = r * Math.sqrt(3) / 2;
  const cells: Array<[number, number]> = [[-hw, -r * 1.5], [hw, -r * 1.5], [-hw * 2, 0], [0, 0], [hw * 2, 0], [-hw, r * 1.5], [hw, r * 1.5]];
  const hex = (cx: number, cy: number, rr: number) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath();
  };
  // drips (behind the comb), lengths breathe; one drop falls and refills
  const drip = (dx: number, base: number, ph: number) => {
    const u = (t * 0.55 + ph) % 1;
    const L = base + 5 * Math.min(1, u / 0.7);
    const top = r * 1.5 + r * 0.6;
    ctx.beginPath();
    ctx.moveTo(dx - 3, top - 2);
    ctx.bezierCurveTo(dx - 2.4, top + L * 0.5, dx - 2.6, top + L - 1, dx, top + L + 1.6);
    ctx.bezierCurveTo(dx + 2.6, top + L - 1, dx + 2.4, top + L * 0.5, dx + 3, top - 2);
    ctx.closePath();
    fillStroke(ctx, '#ffad14', 1.5);
    ctx.fillStyle = 'rgba(255,240,170,0.85)'; ctx.beginPath(); ctx.ellipse(dx - 0.9, top + L * 0.55, 0.7, L * 0.25 + 0.5, 0, 0, TAU); ctx.fill();
    if (u > 0.7) {
      const f = (u - 0.7) / 0.3;
      const dy = top + L + 3 + f * f * 9;
      ctx.globalAlpha = 1 - f * 0.6;
      ctx.beginPath(); ctx.moveTo(dx, dy - 2.6); ctx.quadraticCurveTo(dx + 2, dy + 0.3, dx, dy + 1.6); ctx.quadraticCurveTo(dx - 2, dy + 0.3, dx, dy - 2.6); ctx.closePath();
      fillStroke(ctx, '#ffad14', 1.2);
      ctx.globalAlpha = 1;
    }
  };
  drip(-hw + 0.5, 2.5, 0);
  drip(hw + 1.5, 4.5, 0.45);
  // outer border (thick) → wax → cells
  ctx.lineJoin = 'round';
  for (const [cx, cy] of cells) { hex(cx, cy, r + 0.3); ctx.strokeStyle = OUT; ctx.lineWidth = 4.6; ctx.stroke(); }
  for (const [cx, cy] of cells) { hex(cx, cy, r + 0.3); ctx.fillStyle = '#f2b02a'; ctx.fill(); }
  cells.forEach(([cx, cy], i) => {
    hex(cx, cy, r * 0.72);
    const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    g.addColorStop(0, i === 3 ? '#ffe680' : '#ffd040'); g.addColorStop(1, '#e07c00');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(150,80,0,0.7)'; ctx.lineWidth = 1.1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.ellipse(cx - r * 0.25, cy - r * 0.3, r * 0.2, r * 0.1, -0.5, 0, TAU); ctx.fill();
  });
  // wax walls: light top edges
  ctx.strokeStyle = 'rgba(255,236,160,0.9)'; ctx.lineWidth = 0.9;
  for (const [cx, cy] of cells) { ctx.beginPath(); ctx.moveTo(cx - hw, cy - r * 0.5); ctx.lineTo(cx, cy - r); ctx.lineTo(cx + hw, cy - r * 0.5); ctx.stroke(); }
  // honey overflowing the lower cells
  ctx.beginPath();
  ctx.moveTo(-hw * 2 + 1, r * 1.5 + 1);
  ctx.quadraticCurveTo(-hw, r * 1.5 + 5.5, 0, r * 1.5 + 4);
  ctx.quadraticCurveTo(hw, r * 1.5 + 6, hw * 2 - 1, r * 1.5 + 1.5);
  ctx.lineTo(hw * 2 - 2, r * 0.8); ctx.lineTo(-hw * 2 + 2, r * 0.8); ctx.closePath();
  ctx.fillStyle = 'rgba(255,170,20,0.55)'; ctx.fill();
  iconTwinkle(ctx, 13, -14, 3 * (0.35 + 0.65 * Math.max(0, Math.sin(t * 3.1))), '#fff6c0');
  ctx.restore();
}

/** «Плащ Ветра»: light-blue dash cloak caught in a gust — wind swirls, silver trim and clasp */
export function drawWindCloak(ctx: C, x: number, y: number, s: number, t = 0) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  const w1 = Math.sin(t * 5.5), w2 = Math.sin(t * 5.5 + 1.3), w3 = Math.sin(t * 4.1 + 2);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // swirl helper (outlined white curl)
  const curl = (cx: number, cy: number, k: number, ph: number, alpha = 1) => {
    const f = (t * 0.5 + ph) % 1;
    const a = Math.sin(Math.PI * f) * alpha;
    if (a < 0.05) return;
    ctx.save(); ctx.translate(cx - f * 4, cy); ctx.scale(k, Math.abs(k)); ctx.globalAlpha = a;
    for (const [c, w] of [['rgba(42,27,26,0.6)', 3], ['#ffffff', 1.6]] as const) {
      ctx.strokeStyle = c; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(10, 0.5); ctx.quadraticCurveTo(3, 1.6, 0, 0);
      ctx.bezierCurveTo(-3.6, -1.8, -3.4, -6.4, 0.2, -6.2); ctx.bezierCurveTo(2.8, -6, 2.6, -2.8, 0.4, -2.9);
      ctx.stroke();
    }
    ctx.restore();
  };
  curl(-12, -12, 1.2, 0);
  // cape: shoulders upper right, billowing to the lower left
  const cape = () => {
    ctx.beginPath();
    ctx.moveTo(-1, -12.5);
    ctx.bezierCurveTo(-8, -10 + w2 * 0.6, -14, -6 + w1, -18.5 + w2 * 0.6, -1 + w1);
    ctx.quadraticCurveTo(-22.5 + w3 * 0.6, 3, -21.5 + w1 * 0.8, 9 + w2);
    ctx.quadraticCurveTo(-15, 8 + w3, -12.5 + w2 * 0.5, 14.5 + w1 * 0.8);
    ctx.quadraticCurveTo(-6, 12.5 + w2, -3, 18.5 + w3 * 0.8);
    ctx.quadraticCurveTo(2.5, 14.5 + w1, 7, 18 + w2 * 0.6);
    ctx.quadraticCurveTo(10.5, 15, 13, 15.5 + w3 * 0.5);
    ctx.bezierCurveTo(14, 6, 15, -2, 13.5, -10);
    ctx.closePath();
  };
  cape();
  const gr = ctx.createLinearGradient(12, -12, -16, 18);
  gr.addColorStop(0, '#2a8ad8'); gr.addColorStop(0.45, '#5cc6f4'); gr.addColorStop(1, '#a8ecff');
  ctx.fillStyle = gr; ctx.fill();
  ctx.save(); cape(); ctx.clip();
  // rolled-over lining along the top edge
  ctx.beginPath();
  ctx.moveTo(-1, -12.5);
  ctx.bezierCurveTo(-8, -10 + w2 * 0.6, -14, -6 + w1, -18.5 + w2 * 0.6, -1 + w1);
  ctx.quadraticCurveTo(-22.5 + w3 * 0.6, 3, -21.5 + w1 * 0.8, 9 + w2);
  ctx.quadraticCurveTo(-16, 2 + w1 * 0.6, -11.5, -2 + w2 * 0.5);
  ctx.quadraticCurveTo(-6.5, -6, -1, -8.5);
  ctx.closePath();
  const lg = ctx.createLinearGradient(-20, 6, -2, -12);
  lg.addColorStop(0, '#ffffff'); lg.addColorStop(1, '#bff0ff');
  ctx.fillStyle = lg; ctx.fill();
  ctx.strokeStyle = 'rgba(42,27,26,0.6)'; ctx.lineWidth = 1; ctx.stroke();
  // folds
  ctx.strokeStyle = 'rgba(10,70,150,0.3)'; ctx.lineWidth = 2.4;
  for (const [ax, ay, bx, by] of [[-5, -2, -10, 13], [6, -4, 2.5, 16]] as const) { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + bx) / 2 + 2, (ay + by) / 2, bx, by); ctx.stroke(); }
  // wind swirl emblem woven into the cloth
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-9, 7); ctx.quadraticCurveTo(-4, 9, 0, 6);
  ctx.bezierCurveTo(4, 3, 3, -2.5, -0.5, -1.8); ctx.bezierCurveTo(-3, -1.2, -2.4, 2.6, 0.2, 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-7, 11.5); ctx.quadraticCurveTo(-1, 12.5, 4, 10); ctx.stroke();
  // silver trim + stitched dots
  ctx.strokeStyle = '#e8f2fa'; ctx.lineWidth = 3.2; cape(); ctx.stroke();
  ctx.strokeStyle = '#8ab8d8'; ctx.lineWidth = 0.9; ctx.setLineDash([0.1, 2.6]); cape(); ctx.stroke(); ctx.setLineDash([]);
  ctx.restore();
  cape(); ctx.strokeStyle = OUT; ctx.lineWidth = 2.2; ctx.stroke();
  // collar
  ctx.beginPath(); ctx.moveTo(1, -13); ctx.quadraticCurveTo(-1.5, -19, 1.5, -22); ctx.quadraticCurveTo(7.5, -19.5, 12.5, -19); ctx.quadraticCurveTo(12.5, -15, 11, -12.5); ctx.closePath();
  fillStroke(ctx, '#2f7fc8', 1.6);
  ctx.strokeStyle = '#e8f2fa'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(1.5, -22); ctx.quadraticCurveTo(7.5, -19.5, 12.5, -19); ctx.stroke();
  // silver clasp with a sky gem
  ctx.save(); ctx.translate(14.5, -13.5);
  const gl = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 7);
  gl.addColorStop(0, 'rgba(160,240,255,0.7)'); gl.addColorStop(1, 'rgba(160,240,255,0)');
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
  circle(ctx, 0, 0, 3.4, '#dfe8f2', 1.3);
  ctx.beginPath(); ctx.moveTo(0, -2.3); ctx.lineTo(1.7, 0); ctx.lineTo(0, 2.3); ctx.lineTo(-1.7, 0); ctx.closePath(); fillStroke(ctx, '#7ff0ff', 0.8);
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(-0.5, -0.8, 0.55, 0, TAU); ctx.fill();
  ctx.restore();
  // gust lines + swirls in front
  for (const [yy, x0, len, w] of [[-4, -15, 6, 2], [4, -19.5, 5, 1.8], [12, -17, 5, 1.6]] as const) {
    const d = ((t * 24 + yy * 1.9) % 5) - 2.5;
    ctx.strokeStyle = 'rgba(42,27,26,0.45)'; ctx.lineWidth = w + 1.4;
    ctx.beginPath(); ctx.moveTo(x0 - len + d, yy); ctx.lineTo(x0 + d, yy); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0 - len + d, yy); ctx.lineTo(x0 + d, yy); ctx.stroke();
  }
  curl(8, 6, -1.1, 0.5);
  curl(-4, 19, 0.9, 0.25, 0.9);
  const tw = (k: number) => Math.max(0, Math.sin(t * 3 + k * 2.2));
  iconTwinkle(ctx, 20, -1, 3 * tw(0), '#ffffff');
  iconTwinkle(ctx, -5, -18, 2.4 * tw(1), '#bff0ff');
  ctx.restore();
}

/** «Ореховое сердце»: a golden walnut grown into a heart — two wrinkled lobes split by the seam, ruby heart inlay */
export function drawNutHeart(ctx: C, x: number, y: number, s: number, t = 0) {
  ctx.save(); ctx.translate(x, y);
  const ph = t % 1.25;
  const beat = Math.exp(-(((ph - 0.08) / 0.055) ** 2)) * 0.06 + Math.exp(-(((ph - 0.3) / 0.06) ** 2)) * 0.04;
  ctx.scale(s * (1 + beat), s * (1 + beat * 0.8));
  const halo = ctx.createRadialGradient(0, 2, 3, 0, 2, 22);
  halo.addColorStop(0, 'rgba(255,210,90,0.5)'); halo.addColorStop(1, 'rgba(255,190,60,0)');
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 2, 22, 0, TAU); ctx.fill();
  const heart = () => {
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.bezierCurveTo(-2.5, -13, -17.5, -14, -18, -2.5);
    ctx.bezierCurveTo(-18.4, 6.5, -9, 12, 0, 19);
    ctx.bezierCurveTo(9, 12, 18.4, 6.5, 18, -2.5);
    ctx.bezierCurveTo(17.5, -14, 2.5, -13, 0, -6);
    ctx.closePath();
  };
  heart();
  const g = ctx.createRadialGradient(-7, -6, 1, -1, 0, 24);
  g.addColorStop(0, '#fff8c0'); g.addColorStop(0.3, '#ffd83a'); g.addColorStop(0.72, '#f2a012'); g.addColorStop(1, '#b25c00');
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); heart(); ctx.clip();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.save(); ctx.translate(0, 1);
  ctx.strokeStyle = 'rgba(255,248,190,0.85)'; ctx.lineWidth = 0.9;
  for (const p of WALNUT_WRINKLES) squiggle(ctx, p, 19, 15, 1, -0.5, -0.6);
  ctx.strokeStyle = 'rgba(140,62,0,0.75)'; ctx.lineWidth = 1.3;
  for (const p of WALNUT_WRINKLES) squiggle(ctx, p, 19, 15, 1);
  ctx.restore();
  const sh = ctx.createLinearGradient(-18, -14, 18, 18);
  sh.addColorStop(0.55, 'rgba(160,70,0,0)'); sh.addColorStop(1, 'rgba(140,60,0,0.35)');
  ctx.fillStyle = sh; ctx.fillRect(-20, -16, 40, 36);
  // seam down the middle (from the notch to the tip)
  const seam = () => { ctx.beginPath(); ctx.moveTo(0, -7); ctx.bezierCurveTo(1.2, 2, -1, 10, 0, 20); ctx.stroke(); };
  ctx.strokeStyle = 'rgba(130,56,0,0.7)'; ctx.lineWidth = 3.4; seam();
  ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 1.5; seam();
  ctx.restore();
  heart(); ctx.strokeStyle = OUT; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.stroke();
  // ruby heart inlay in a gold bezel
  const ruby = (sc: number) => {
    ctx.beginPath();
    ctx.moveTo(0, 0.5 * sc);
    ctx.bezierCurveTo(-1, -2.4 * sc, -6 * sc, -2.4 * sc, -5.8 * sc, 1 * sc);
    ctx.bezierCurveTo(-5.6 * sc, 3.8 * sc, -2.4 * sc, 5.8 * sc, 0, 7.6 * sc);
    ctx.bezierCurveTo(2.4 * sc, 5.8 * sc, 5.6 * sc, 3.8 * sc, 5.8 * sc, 1 * sc);
    ctx.bezierCurveTo(6 * sc, -2.4 * sc, 1, -2.4 * sc, 0, 0.5 * sc);
    ctx.closePath();
  };
  ctx.save(); ctx.translate(0, 0.5);
  ruby(1.28); fillStroke(ctx, '#ffe27a', 1.6);
  const rg = ctx.createRadialGradient(-2, 0.5, 0.3, 0, 2.5, 7);
  rg.addColorStop(0, '#ff8a9a'); rg.addColorStop(0.5, '#e8203c'); rg.addColorStop(1, '#8a0620');
  ruby(1); fillStroke(ctx, rg, 1.1);
  ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.ellipse(-2.6, 1.2, 1.4, 0.8, -0.7, 0, TAU); ctx.fill();
  ctx.restore();
  // gloss on the left lobe
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath(); ctx.ellipse(-11, -5.5, 3.2, 1.6, -0.8, 0, TAU); ctx.fill();
  const tw = (k: number) => Math.max(0, Math.sin(t * 3.4 + k * 2.1));
  iconTwinkle(ctx, -18, -14, 3.2 * tw(0), '#fff2b0');
  iconTwinkle(ctx, 18, -12, 2.8 * tw(1), '#ffffff');
  iconTwinkle(ctx, 16, 14, 2.2 * tw(2), '#ffe27a');
  ctx.restore();
}

/** «Ореховая рогатка»: the slingshot loaded with a golden walnut instead of a pea */
export function drawNutSling(ctx: C, x: number, y: number, s: number, t = 0) {
  drawSlingIcon(ctx, x, y, s);
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.rotate(-0.1);
  const pouchY = -5.2;
  const glowR = 9 + Math.sin(t * 3) * 1;
  const gg = ctx.createRadialGradient(0, pouchY - 3, 1, 0, pouchY - 3, glowR);
  gg.addColorStop(0, 'rgba(255,220,100,0.7)'); gg.addColorStop(1, 'rgba(255,200,80,0)');
  ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(0, pouchY - 3, glowR, 0, TAU); ctx.fill();
  // walnut sitting in the pouch (covers the pea), pouch lip in front of it
  ctx.save(); ctx.translate(0, pouchY - 4.2); ctx.rotate(0.15);
  goldenWalnut(ctx, 5.6, 7, 1.5);
  ctx.restore();
  ctx.beginPath(); ctx.ellipse(0, pouchY + 0.6, 5.8, 3.4, 0, 0, Math.PI); ctx.closePath();
  fillStroke(ctx, '#7a3a2a', 1.5);
  ctx.strokeStyle = '#e8c890'; ctx.lineWidth = 0.6; ctx.setLineDash([0.9, 1.1]);
  ctx.beginPath(); ctx.ellipse(0, pouchY + 0.6, 4.4, 2.3, 0, 0.2, Math.PI - 0.2); ctx.stroke(); ctx.setLineDash([]);
  iconTwinkle(ctx, 7.5, -16, 2.8 * (0.35 + 0.65 * Math.max(0, Math.sin(t * 3.2))), '#fff6c0', 0.9);
  ctx.restore();
}

/** «Вишнёвая бомба»: glossy cherry with a short fuse stem and a crackling spark */
export function drawCherryBomb(ctx: C, x: number, y: number, s: number, t = 0) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const tipX = 9.5, tipY = -15.5;
  // fuse stem + leaf
  iconLimbQ(ctx, 0.5, -6.5, 1.5, -13.5, tipX, tipY, 2.6, '#6a4424', 1.2);
  iconLeaf(ctx, 0.8, -8.5, 9, -2.55, '#5cbc3e');
  // cherry
  const blink = Math.max(0, Math.sin(t * 5)) ** 10;
  const g = ctx.createRadialGradient(-4.5, -1, 1, 0, 3.5, 15);
  g.addColorStop(0, '#ff7a8a'); g.addColorStop(0.45, '#e41634'); g.addColorStop(1, '#8e0624');
  ctx.beginPath();
  ctx.moveTo(0, -6.4);
  ctx.bezierCurveTo(-5, -9.2, -13.8, -6.5, -13.8, 3.5);
  ctx.bezierCurveTo(-13.8, 11.5, -7, 16.5, 0, 16.5);
  ctx.bezierCurveTo(7, 16.5, 13.8, 11.5, 13.8, 3.5);
  ctx.bezierCurveTo(13.8, -6.5, 5, -9.2, 0, -6.4);
  ctx.closePath();
  fillStroke(ctx, g, 2.4);
  if (blink > 0.02) { ctx.fillStyle = `rgba(255,240,240,${blink * 0.4})`; ctx.fill(); }
  // dimple + suture + rim light + gloss
  ctx.strokeStyle = 'rgba(110,0,24,0.5)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-3, -5.6); ctx.quadraticCurveTo(0, -4, 3, -5.6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4.5, -2); ctx.quadraticCurveTo(7, 5, 4, 12); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,150,170,0.6)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(11.8, 6); ctx.quadraticCurveTo(9, 12.5, 2.5, 14.6); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath(); ctx.ellipse(-7, -0.5, 3.6, 2, -0.85, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(-3.4, -4, 1.1, 0, TAU); ctx.fill();
  // spark: glow, flickering star burst, flying sparks
  const fl = 0.8 + 0.25 * Math.abs(Math.sin(t * 29)) + 0.12 * Math.sin(t * 47);
  const sg = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, 9 * fl);
  sg.addColorStop(0, 'rgba(255,230,120,0.95)'); sg.addColorStop(0.4, 'rgba(255,150,40,0.55)'); sg.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(tipX, tipY, 9 * fl, 0, TAU); ctx.fill();
  circle(ctx, tipX, tipY, 1.6, '#2a1b1a', 0);
  iconStarPath(ctx, tipX, tipY, 6 * fl, 2.2 * fl, t * 6); fillStroke(ctx, '#ffd23a', 1.1);
  iconStarPath(ctx, tipX, tipY, 3 * fl, 1.2, t * 6 + 0.6); ctx.fillStyle = '#ffffff'; ctx.fill();
  for (let k = 0; k < 4; k++) {
    const u = (t * 2.4 + k / 4) % 1;
    const a = -1.9 + k * 0.85;
    const d = 4 + u * 9;
    ctx.globalAlpha = 1 - u;
    ctx.fillStyle = k % 2 ? '#ffe680' : '#ff9a2a';
    ctx.beginPath(); ctx.arc(tipX + Math.cos(a) * d, tipY + Math.sin(a) * d + u * u * 3, 1.1 * (1 - u * 0.5), 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
