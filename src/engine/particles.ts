import { rand, choose, TAU, Rect } from './util';

export type PShape = 'circle' | 'square' | 'spark' | 'ring' | 'seed' | 'chunk' | 'star' | 'text' | 'smoke' | 'crumb' | 'noodle' | 'leaf';

export interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number;
  size: number; size2: number;
  color: string; color2?: string;
  g: number; drag: number;
  shape: PShape;
  rot: number; vr: number;
  text?: string;
  additive?: boolean;
  bounce?: number;
  floorY?: number;
}

export interface EmitOpts {
  count?: number;
  speed?: [number, number];
  angle?: [number, number];
  life?: [number, number];
  size?: [number, number];
  size2?: number; // end-size multiplier
  colors?: string[];
  g?: number;
  drag?: number;
  shape?: PShape;
  spread?: number;
  vr?: number;
  additive?: boolean;
  vx?: number; vy?: number;
  bounce?: number;
  floorY?: number;
}

export class Particles {
  list: Particle[] = [];
  max = 1400;

  emit(x: number, y: number, o: EmitOpts) {
    const n = o.count ?? 8;
    for (let i = 0; i < n; i++) {
      if (this.list.length >= this.max) this.list.shift();
      const a = rand(o.angle?.[0] ?? 0, o.angle?.[1] ?? TAU);
      const s = rand(o.speed?.[0] ?? 50, o.speed?.[1] ?? 200);
      const life = rand(o.life?.[0] ?? 0.4, o.life?.[1] ?? 0.9);
      const size = rand(o.size?.[0] ?? 3, o.size?.[1] ?? 6);
      const sp = o.spread ?? 0;
      this.list.push({
        x: x + rand(-sp, sp), y: y + rand(-sp, sp),
        vx: Math.cos(a) * s + (o.vx ?? 0), vy: Math.sin(a) * s + (o.vy ?? 0),
        life, max: life, size, size2: o.size2 ?? 0,
        color: choose(o.colors ?? ['#ffffff']),
        g: o.g ?? 0, drag: o.drag ?? 1.5,
        shape: o.shape ?? 'circle',
        rot: rand(0, TAU), vr: rand(-(o.vr ?? 6), o.vr ?? 6),
        additive: o.additive, bounce: o.bounce, floorY: o.floorY,
      });
    }
  }

  text(x: number, y: number, text: string, color = '#fff', size = 22) {
    this.list.push({ x, y, vx: rand(-15, 15), vy: -90, life: 0.9, max: 0.9, size, size2: 1, color, g: 120, drag: 1, shape: 'text', rot: 0, vr: 0, text });
  }

  ring(x: number, y: number, r: number, color = '#fff', life = 0.35, width = 4) {
    this.list.push({ x, y, vx: 0, vy: 0, life, max: life, size: r * 0.2, size2: r, color, g: 0, drag: 0, shape: 'ring', rot: width, vr: 0 });
  }

  dust(x: number, y: number, n = 6, color = '#d8c0a0') {
    this.emit(x, y, { count: n, angle: [Math.PI * 1.05, Math.PI * 1.95], speed: [30, 120], life: [0.3, 0.6], size: [4, 9], size2: 1.8, colors: [color], g: -40, drag: 4, shape: 'smoke' });
  }

  sparks(x: number, y: number, n = 10, colors = ['#fff6c0', '#ffd34a', '#ffffff']) {
    this.emit(x, y, { count: n, speed: [180, 480], life: [0.15, 0.35], size: [2, 4], colors, drag: 6, shape: 'spark', additive: true });
  }

  juice(x: number, y: number, n = 14, colors = ['#ff4d6d', '#ff7a8a', '#d92b4a']) {
    this.emit(x, y, { count: n, speed: [100, 380], angle: [Math.PI * 1.0, Math.PI * 2.0], life: [0.4, 0.8], size: [3, 7], colors, g: 900, drag: 1, shape: 'circle' });
  }

  update(dt: number) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) { L[i] = L[L.length - 1]; L.pop(); continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy = p.vy * d + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.floorY !== undefined && p.y > p.floorY && p.vy > 0) {
        p.y = p.floorY; p.vy *= -(p.bounce ?? 0.3); p.vx *= 0.6;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, view?: Rect) {
    for (const p of this.list) {
      if (view && (p.x < view.x - 60 || p.x > view.x + view.w + 60 || p.y < view.y - 60 || p.y > view.y + view.h + 60)) continue;
      const t = p.life / p.max; // 1 → 0
      const k = 1 - t;
      const s = p.size2 ? p.size * (1 + (p.size2 - 1) * k) : p.size * (0.4 + 0.6 * t);
      ctx.globalAlpha = Math.min(1, t * 2.2);
      if (p.additive) ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = p.color;
      switch (p.shape) {
        case 'circle':
          ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, TAU); ctx.fill(); break;
        case 'smoke':
          ctx.globalAlpha = t * 0.55;
          ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, TAU); ctx.fill(); break;
        case 'square':
        case 'crumb':
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillRect(-s / 2, -s / 2, s, s * (p.shape === 'crumb' ? 0.7 : 1));
          ctx.restore(); break;
        case 'chunk': {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.beginPath(); ctx.moveTo(-s, s * 0.6); ctx.lineTo(s, s * 0.6); ctx.lineTo(0, -s); ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#2a1b1a'; ctx.lineWidth = 1.5; ctx.stroke();
          if (p.color2) { ctx.fillStyle = p.color2; ctx.fillRect(-s, s * 0.35, s * 2, s * 0.3); }
          ctx.restore(); break;
        }
        case 'seed':
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.beginPath(); ctx.ellipse(0, 0, s * 0.55, s, 0, 0, TAU); ctx.fill();
          ctx.restore(); break;
        case 'leaf':
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.4, 0, 0, TAU); ctx.fill();
          ctx.restore(); break;
        case 'spark': {
          const len = Math.hypot(p.vx, p.vy) * 0.035 + s;
          const a = Math.atan2(p.vy, p.vx);
          ctx.strokeStyle = p.color; ctx.lineWidth = s; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - Math.cos(a) * len, p.y - Math.sin(a) * len); ctx.stroke();
          break;
        }
        case 'ring': {
          const r = p.size + (p.size2 - p.size) * (1 - t * t);
          ctx.globalAlpha = t;
          ctx.strokeStyle = p.color; ctx.lineWidth = p.rot * t + 0.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
          break;
        }
        case 'star': {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const r = i % 2 === 0 ? s : s * 0.4;
            const a = (i / 8) * TAU;
            if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          ctx.closePath(); ctx.fill(); ctx.restore(); break;
        }
        case 'noodle': {
          ctx.strokeStyle = p.color; ctx.lineWidth = 4; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.x, p.y);
          ctx.quadraticCurveTo(p.x + Math.cos(p.rot) * s, p.y + Math.sin(p.rot) * s, p.x + Math.cos(p.rot * 1.3) * s * 2, p.y + Math.sin(p.rot * 0.7) * s * 2);
          ctx.stroke(); break;
        }
        case 'text': {
          ctx.globalAlpha = Math.min(1, t * 3);
          ctx.font = `900 ${p.size}px Rubik, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.lineWidth = 5; ctx.strokeStyle = '#2a1b1a'; ctx.lineJoin = 'round';
          ctx.strokeText(p.text ?? '', p.x, p.y);
          ctx.fillText(p.text ?? '', p.x, p.y);
          break;
        }
      }
      if (p.additive) ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  clear() { this.list.length = 0; }
}
