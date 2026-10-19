import { W, H, srand, TAU } from '../engine/util';
import { rrPath } from './draw';
import type { Camera } from '../engine/camera';

type C = CanvasRenderingContext2D;
export type Theme = 'pantry' | 'feast' | 'library' | 'gallery' | 'throne';

export const THEME_INFO: Record<Theme, { top: string; bottom: string; tint: string; tintA: number; dust: string }> = {
  pantry: { top: '#5a3420', bottom: '#8a5434', tint: '#2a0e00', tintA: 0.06, dust: '255,220,170' },
  feast: { top: '#5a1a26', bottom: '#8a3040', tint: '#2a0008', tintA: 0.05, dust: '255,200,160' },
  library: { top: '#1a2e3c', bottom: '#2e4a5c', tint: '#001020', tintA: 0.08, dust: '190,220,255' },
  gallery: { top: '#2a1e3a', bottom: '#4a3660', tint: '#0a0018', tintA: 0.07, dust: '220,200,255' },
  throne: { top: '#221832', bottom: '#44305e', tint: '#0a0018', tintA: 0.06, dust: '210,225,255' },
};

export class Backdrop {
  constructor(public theme: Theme, public levelW: number, public levelH: number) {}

  draw(ctx: C, cam: Camera, t: number) {
    const info = THEME_INFO[this.theme];
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, info.top); g.addColorStop(1, info.bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // how far camera is above the bottom of the level
    const up = Math.max(0, this.levelH - (cam.top + cam.viewH));
    this.layer(ctx, cam, 0.12, up, t, 0);
    this.layer(ctx, cam, 0.3, up, t, 1);
    this.shafts(ctx, cam, t);
    this.layer(ctx, cam, 0.55, up, t, 2);
    this.dust(ctx, cam, t, info.dust);
  }

  private layer(ctx: C, cam: Camera, f: number, up: number, t: number, idx: number) {
    const left = cam.left * f;
    ctx.save();
    ctx.translate(-left, up * f);
    const topLimit = -up * f - 40;
    switch (this.theme) {
      case 'pantry': this.pantry(ctx, idx, left, topLimit, t); break;
      case 'feast': this.feast(ctx, idx, left, topLimit, t); break;
      case 'library': this.library(ctx, idx, left, topLimit, t); break;
      case 'gallery': case 'throne': this.gallery(ctx, idx, left, topLimit, t); break;
    }
    ctx.restore();
  }

  private cells(left: number, size: number, cb: (i: number, x: number) => void) {
    const i0 = Math.floor(left / size) - 1, i1 = Math.ceil((left + W) / size) + 1;
    for (let i = i0; i <= i1; i++) cb(i, i * size);
  }

  // ─────────── PANTRY ───────────
  private pantry(ctx: C, idx: number, left: number, topLimit: number, t: number) {
    if (idx === 0) {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 3;
      this.cells(left, 110, (_i, x) => { ctx.beginPath(); ctx.moveTo(x, topLimit); ctx.lineTo(x, H); ctx.stroke(); });
      return;
    }
    if (idx === 1) {
      const post = '#4a2a18', shelf = '#5e3820';
      this.cells(left, 560, (i, x) => {
        const R = srand(i * 7919 + 13);
        ctx.fillStyle = post; ctx.fillRect(x, topLimit, 34, H - topLimit);
        for (let y = H - 140, row = 0; y > topLimit - 300; y -= 250, row++) {
          ctx.fillStyle = shelf; ctx.fillRect(x, y, 560, 22);
          ctx.fillStyle = 'rgba(255,200,140,0.06)'; ctx.fillRect(x, y, 560, 4);
          let bx = x + 50 + R() * 30;
          while (bx < x + 520) {
            const kind = R();
            const bw = 50 + R() * 90, bh = 60 + R() * 140;
            const c = ['#6e4228', '#7a4a2e', '#644024', '#80523a', '#6a4430'][Math.floor(R() * 5)];
            ctx.fillStyle = c;
            if (kind < 0.4) { rrPath(ctx, bx, y - bh, bw, bh, 8); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(bx, y - bh, bw, 12); }
            else if (kind < 0.7) { rrPath(ctx, bx, y - bh, bw, bh, bw / 3); ctx.fill(); ctx.fillStyle = 'rgba(255,230,200,0.06)'; ctx.fillRect(bx + 8, y - bh + 14, 6, bh - 28); }
            else { ctx.beginPath(); ctx.moveTo(bx, y); ctx.lineTo(bx + bw * 0.15, y - bh); ctx.lineTo(bx + bw * 0.85, y - bh); ctx.lineTo(bx + bw, y); ctx.fill(); }
            bx += bw + 14 + R() * 40;
          }
        }
      });
      return;
    }
    // mid layer: hanging garlands and sacks
    this.cells(left, 760, (i, x) => {
      const R = srand(i * 104729 + 7);
      const hx = x + R() * 500;
      ctx.strokeStyle = '#3a2010'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(hx, topLimit); ctx.lineTo(hx, 240); ctx.stroke();
      ctx.fillStyle = '#4a2a18';
      const sway = Math.sin(t * 0.8 + i) * 4;
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(hx + sway * (k / 4), 120 + k * 46, 24, 30, 0, 0, TAU); ctx.fill(); }
      if (R() > 0.4) {
        const sx = x + 200 + R() * 400;
        ctx.fillStyle = '#4a2c1a';
        ctx.beginPath(); ctx.moveTo(sx - 90, H); ctx.quadraticCurveTo(sx - 120, H - 150, sx - 40, H - 230); ctx.lineTo(sx - 30, H - 270); ctx.lineTo(sx + 30, H - 270); ctx.lineTo(sx + 40, H - 230); ctx.quadraticCurveTo(sx + 120, H - 150, sx + 90, H); ctx.fill();
      }
    });
  }

  // ─────────── FEAST ───────────
  private feast(ctx: C, idx: number, left: number, topLimit: number, t: number) {
    if (idx === 0) {
      ctx.fillStyle = 'rgba(255,200,120,0.05)';
      this.cells(left, 90, (i, x) => {
        for (let y = H - 40 - (i % 2) * 45; y > topLimit; y -= 90) {
          ctx.beginPath(); ctx.moveTo(x, y - 20); ctx.lineTo(x + 14, y); ctx.lineTo(x, y + 20); ctx.lineTo(x - 14, y); ctx.fill();
        }
      });
      return;
    }
    if (idx === 1) {
      this.cells(left, 700, (i, x) => {
        // window
        const wx = x + 350, wy = H - 180, ww = 200, wh = 420;
        ctx.fillStyle = '#1a1e3e';
        ctx.beginPath(); ctx.moveTo(wx - ww / 2, wy); ctx.lineTo(wx - ww / 2, wy - wh + ww / 2); ctx.arc(wx, wy - wh + ww / 2, ww / 2, Math.PI, 0); ctx.lineTo(wx + ww / 2, wy); ctx.fill();
        ctx.fillStyle = 'rgba(255,250,220,0.55)'; ctx.beginPath(); ctx.arc(wx + 30, wy - wh + 110, 22, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        const R = srand(i * 31 + 5);
        for (let k = 0; k < 6; k++) { ctx.fillRect(wx - 80 + R() * 160, wy - wh + 40 + R() * 300, 2, 2); }
        ctx.strokeStyle = '#2a0c12'; ctx.lineWidth = 8;
        ctx.beginPath(); ctx.moveTo(wx, wy - wh); ctx.lineTo(wx, wy); ctx.moveTo(wx - ww / 2, wy - wh * 0.45); ctx.lineTo(wx + ww / 2, wy - wh * 0.45); ctx.stroke();
        // curtains
        for (const side of [-1, 1]) {
          const cx = wx + side * (ww / 2 + 30);
          ctx.fillStyle = '#7a1628';
          ctx.beginPath(); ctx.moveTo(cx - 70, topLimit); ctx.lineTo(cx + 70, topLimit); ctx.lineTo(cx + 50 + Math.sin(t + i) * 4, H); ctx.lineTo(cx - 50, H); ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 6;
          for (let k = -40; k <= 40; k += 26) { ctx.beginPath(); ctx.moveTo(cx + k, topLimit); ctx.lineTo(cx + k * 0.8, H); ctx.stroke(); }
        }
      });
      return;
    }
    this.cells(left, 900, (i, x) => {
      const R = srand(i * 271 + 9);
      // giant chair back
      const cx = x + 200 + R() * 300;
      ctx.fillStyle = '#3e1018';
      rrPath(ctx, cx - 120, H - 520, 240, 520, 40); ctx.fill();
      ctx.fillStyle = '#300a12';
      rrPath(ctx, cx - 80, H - 470, 160, 300, 30); ctx.fill();
      // chandelier silhouette
      const lx = x + 600;
      ctx.strokeStyle = '#1c050a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(lx, topLimit); ctx.lineTo(lx, 90); ctx.stroke();
      ctx.fillStyle = '#1c050a'; ctx.beginPath(); ctx.ellipse(lx, 100, 110, 20, 0, 0, TAU); ctx.fill();
      for (let k = -2; k <= 2; k++) {
        const fx = lx + k * 44;
        ctx.fillStyle = `rgba(255,200,90,${0.55 + Math.sin(t * 10 + k + i) * 0.1})`;
        ctx.beginPath(); ctx.ellipse(fx, 64, 5, 9, 0, 0, TAU); ctx.fill();
      }
    });
  }

  // ─────────── LIBRARY ───────────
  private library(ctx: C, idx: number, left: number, topLimit: number, t: number) {
    if (idx === 0) {
      ctx.fillStyle = 'rgba(120,180,220,0.04)';
      this.cells(left, 160, (_i, x) => ctx.fillRect(x, topLimit, 6, H - topLimit));
      return;
    }
    if (idx === 1) {
      const cols = ['#3a5266', '#4a4458', '#3c5a4e', '#5a4440', '#444c68', '#544258'];
      this.cells(left, 480, (i, x) => {
        ctx.fillStyle = '#1c2a34'; ctx.fillRect(x, topLimit, 28, H - topLimit);
        let row = 0;
        for (let y = H - 100; y > topLimit - 260; y -= 230, row++) {
          const R = srand(i * 977 + row * 31);
          ctx.fillStyle = '#26343e'; ctx.fillRect(x, y, 480, 18);
          let bx = x + 32;
          while (bx < x + 470) {
            const bw = 16 + R() * 26, bh = 120 + R() * 80;
            if (R() < 0.08) { bx += 40; continue; }
            ctx.fillStyle = cols[Math.floor(R() * cols.length)];
            if (R() < 0.12) { ctx.save(); ctx.translate(bx, y); ctx.rotate(-0.25); ctx.fillRect(0, -bh, bw, bh); ctx.restore(); bx += bw + 30; continue; }
            ctx.fillRect(bx, y - bh, bw, bh);
            ctx.fillStyle = 'rgba(240,200,120,0.12)';
            ctx.fillRect(bx + 3, y - bh + 14, bw - 6, 3);
            bx += bw + 2;
          }
        }
      });
      return;
    }
    this.cells(left, 820, (i, x) => {
      const R = srand(i * 613 + 3);
      // leaning ladder
      const lx = x + R() * 500;
      ctx.strokeStyle = 'rgba(14,20,24,0.45)'; ctx.lineWidth = 12;
      ctx.beginPath(); ctx.moveTo(lx, H); ctx.lineTo(lx + 160, topLimit + 100); ctx.moveTo(lx + 70, H); ctx.lineTo(lx + 230, topLimit + 100); ctx.stroke();
      ctx.lineWidth = 8;
      for (let k = 0; k < 40; k++) {
        const yy = H - k * 60; if (yy < topLimit + 100) break;
        const off = (H - yy) * (160 / (H - topLimit - 100));
        ctx.beginPath(); ctx.moveTo(lx + off, yy); ctx.lineTo(lx + off + 70, yy); ctx.stroke();
      }
      // hanging lamp
      const hx = x + 650;
      ctx.strokeStyle = '#0e1418'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(hx, topLimit); ctx.lineTo(hx, 160); ctx.stroke();
      ctx.fillStyle = '#0e1418'; ctx.beginPath(); ctx.moveTo(hx - 40, 200); ctx.lineTo(hx - 20, 160); ctx.lineTo(hx + 20, 160); ctx.lineTo(hx + 40, 200); ctx.fill();
      ctx.fillStyle = `rgba(230,240,160,${0.5 + Math.sin(t * 3 + i) * 0.05})`;
      ctx.beginPath(); ctx.ellipse(hx, 204, 14, 8, 0, 0, TAU); ctx.fill();
    });
  }

  // ─────────── GALLERY / THRONE ───────────
  private gallery(ctx: C, idx: number, left: number, topLimit: number, t: number) {
    if (idx === 0) {
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 2;
      for (let y = H; y > topLimit; y -= 60) { ctx.beginPath(); ctx.moveTo(left - 10, y); ctx.lineTo(left + W + 10, y); ctx.stroke(); }
      return;
    }
    if (idx === 1) {
      this.cells(left, 520, (i, x) => {
        ctx.fillStyle = '#2e2240';
        rrPath(ctx, x, topLimit, 80, H - topLimit + 10, 4); ctx.fill();
        ctx.fillStyle = '#3a2c4c';
        ctx.fillRect(x - 16, H - 60, 112, 60);
        // banner
        const bx = x + 300;
        ctx.fillStyle = '#5a1430';
        const sw = Math.sin(t * 1.2 + i) * 6;
        ctx.beginPath(); ctx.moveTo(bx - 60, 40); ctx.lineTo(bx + 60, 40); ctx.lineTo(bx + 60 + sw, 360); ctx.lineTo(bx, 320); ctx.lineTo(bx - 60 + sw, 360); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(242,194,58,0.35)';
        ctx.beginPath(); ctx.moveTo(bx - 30, 190); ctx.lineTo(bx - 36, 140); ctx.lineTo(bx - 14, 162); ctx.lineTo(bx, 128); ctx.lineTo(bx + 14, 162); ctx.lineTo(bx + 36, 140); ctx.lineTo(bx + 30, 190); ctx.closePath(); ctx.fill();
      });
      return;
    }
    this.cells(left, 980, (i, x) => {
      const R = srand(i * 409 + 1);
      // giant vase silhouette with a crown emblem
      const sx = x + 200 + R() * 400;
      const vh = 300 + R() * 120;
      ctx.fillStyle = '#2c2140';
      ctx.beginPath();
      ctx.moveTo(sx - 50, H);
      ctx.bezierCurveTo(sx - 140, H - vh * 0.35, sx - 120, H - vh * 0.75, sx - 40, H - vh * 0.85);
      ctx.lineTo(sx - 50, H - vh); ctx.lineTo(sx + 50, H - vh); ctx.lineTo(sx + 40, H - vh * 0.85);
      ctx.bezierCurveTo(sx + 120, H - vh * 0.75, sx + 140, H - vh * 0.35, sx + 50, H);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(200,170,255,0.12)'; ctx.lineWidth = 4; ctx.stroke();
      ctx.fillStyle = 'rgba(242,194,58,0.18)';
      const cy = H - vh * 0.5;
      ctx.beginPath(); ctx.moveTo(sx - 30, cy + 16); ctx.lineTo(sx - 34, cy - 14); ctx.lineTo(sx - 14, cy); ctx.lineTo(sx, cy - 22); ctx.lineTo(sx + 14, cy); ctx.lineTo(sx + 34, cy - 14); ctx.lineTo(sx + 30, cy + 16); ctx.closePath(); ctx.fill();
      // torch glow
      const tx = x + 800;
      ctx.fillStyle = '#120c1a'; ctx.fillRect(tx - 6, 260, 12, 60);
      ctx.fillStyle = `rgba(255,140,60,${0.6 + Math.sin(t * 9 + i) * 0.15})`;
      ctx.beginPath(); ctx.ellipse(tx, 248, 10, 18, 0, 0, TAU); ctx.fill();
    });
  }

  private shafts(ctx: C, cam: Camera, t: number) {
    if (this.theme === 'gallery') return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const col = this.theme === 'library' ? '140,190,255' : this.theme === 'throne' ? '160,190,255' : '255,210,150';
    for (let i = 0; i < 3; i++) {
      const base = ((i * 520 - cam.left * 0.2) % 1700 + 1700) % 1700 - 300;
      const a = 0.05 + Math.sin(t * 0.5 + i * 2) * 0.015;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(base, 0); ctx.lineTo(base + 120, 0); ctx.lineTo(base + 380, H); ctx.lineTo(base + 160, H); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  private dust(ctx: C, cam: Camera, t: number, col: string) {
    ctx.save();
    for (let i = 0; i < 40; i++) {
      const R = srand(i * 17 + 3);
      const sp = 8 + R() * 20;
      const px = ((R() * W * 1.3 + t * sp - cam.left * (0.4 + R() * 0.4)) % (W + 40) + W + 40) % (W + 40) - 20;
      const py = ((R() * H + Math.sin(t * 0.5 + i) * 30 - cam.top * 0.5) % H + H) % H;
      ctx.fillStyle = `rgba(${col},${0.15 + R() * 0.3})`;
      ctx.beginPath(); ctx.arc(px, py, 1 + R() * 2, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}
