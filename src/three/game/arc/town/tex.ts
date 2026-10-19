import * as THREE from 'three';
import { canvasTex } from '../../../gfx';
import { rng } from '../../../world/kit';
import { shade } from '../../../world/textures';
import { OUT } from '../../../../art/draw';

/* Procedural candy textures for the town kit (cached by key; never mutate a returned texture). */

const TAU = Math.PI * 2;
const cache = new Map<string, THREE.Texture>();
function tex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, wrap = true): THREE.Texture {
  let t = cache.get(key);
  if (!t) { t = canvasTex(w, h, draw, { wrap }); cache.set(key, t); }
  return t;
}

/** baked gingerbread: warm brown, darker crust speckles, pale sugar crumbs */
export function gingerTex(base: string) {
  return tex(`ginger:${base}`, 256, 256, (g, w, h) => {
    const R = rng(91);
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = R() < 0.6 ? 'rgba(90,40,10,0.18)' : 'rgba(255,220,170,0.16)';
      g.beginPath(); g.ellipse(R() * w, R() * h, 1 + R() * 4, 1 + R() * 3, R() * 3, 0, TAU); g.fill();
    }
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(70,30,8,0.35)'; g.beginPath(); g.arc(R() * w, R() * h, 1.2 + R() * 1.4, 0, TAU); g.fill(); }
  });
}

/** marshmallow / pastila plaster: soft powdery colour with sugar dust */
export function marshTex(base: string) {
  return tex(`marsh:${base}`, 128, 128, (g, w, h) => {
    const R = rng(17);
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.35)' : `rgba(0,0,0,${0.03 + R() * 0.04})`;
      g.beginPath(); g.arc(R() * w, R() * h, 0.6 + R() * 2.2, 0, TAU); g.fill();
    }
  });
}

/** horizontal pastila layers (bridges, creek banks, bricks): colours from top to bottom, wobbly edges */
export function layersTex(colors: string[], seed = 3) {
  return tex(`layers:${colors.join(',')}:${seed}`, 128, 256, (g, w, h) => {
    const R = rng(seed);
    const n = colors.length;
    for (let i = 0; i < n; i++) {
      const y0 = (i / n) * h, y1 = ((i + 1) / n) * h;
      g.fillStyle = colors[i];
      g.beginPath(); g.moveTo(0, y0 - 4);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, y0 + Math.sin(x * 0.08 + i * 2 + seed) * 3);
      g.lineTo(w, y1 + 4); g.lineTo(0, y1 + 4); g.closePath(); g.fill();
      for (let k = 0; k < 30; k++) { g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(R() * w, y0 + R() * (y1 - y0), 0.7 + R() * 1.5, 0, TAU); g.fill(); }
    }
  });
}

/** candy-cane stripes (diagonal; on a cylinder they spiral) */
export function caneTex(a: string, b: string, n = 6) {
  return tex(`cane:${a}:${b}:${n}`, 128, 128, (g, w, h) => {
    g.fillStyle = a; g.fillRect(0, 0, w, h);
    g.fillStyle = b;
    const s = w / n;
    for (let i = -n * 2; i < n * 2; i++) {
      g.beginPath();
      g.moveTo(i * s, 0); g.lineTo(i * s + s * 0.5, 0); g.lineTo(i * s + s * 0.5 + h, h); g.lineTo(i * s + h, h); g.closePath(); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 0, w, h * 0.12);
  });
}

/** vertical stripes (awnings, cone roofs: on a cone the stripes run up to the tip) */
export function stripeTex(a: string, b: string, n = 8) {
  return tex(`stripe:${a}:${b}:${n}`, 256, 64, (g, w, h) => {
    for (let i = 0; i < n * 2; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect((i / (n * 2)) * w, 0, w / (n * 2) + 1, h); }
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 0, w, h * 0.3);
  });
}

/** icing with sprinkles (roof tops, cake-like surfaces) */
export function sprinkleTex(base: string, colors: string[]) {
  return tex(`sprinkle:${base}:${colors.join(',')}`, 256, 256, (g, w, h) => {
    const R = rng(55);
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 110; i++) {
      const x = R() * w, y = R() * h, a = R() * TAU;
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = colors[i % colors.length];
      g.beginPath(); g.roundRect(-5, -1.6, 10, 3.2, 1.6); g.fill();
      g.restore();
    }
  });
}

/** sugar grass: mint with sparkly sugar dots and tiny candy flowers */
export function grassTex(base: string, dots: string) {
  return tex(`grass:${base}:${dots}`, 256, 256, (g, w, h) => {
    const R = rng(7);
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(0,60,30,${0.05 + R() * 0.06})`;
      g.beginPath(); g.ellipse(R() * w, R() * h, 6 + R() * 16, 4 + R() * 10, R() * 3, 0, TAU); g.fill();
    }
    for (let i = 0; i < 300; i++) { g.fillStyle = dots; g.globalAlpha = 0.35 + R() * 0.5; g.beginPath(); g.arc(R() * w, R() * h, 0.7 + R() * 1.3, 0, TAU); g.fill(); }
    g.globalAlpha = 1;
  });
}

/** cobble path: rounded pastel stones in rows */
export function cobbleTex(colors: string[], gap: string) {
  return tex(`cobble:${colors.join(',')}:${gap}`, 256, 256, (g, w, h) => {
    const R = rng(31);
    g.fillStyle = gap; g.fillRect(0, 0, w, h);
    const rows = 6, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? rh * 0.6 : 0;
      for (let x = -rh; x < w + rh; x += rh * 1.25) {
        const c = colors[Math.floor(R() * colors.length)];
        const sx = x + off + (R() - 0.5) * 3, sy = r * rh + (R() - 0.5) * 2;
        g.fillStyle = shade(c, -0.12);
        g.beginPath(); g.roundRect(sx + 3, sy + 4, rh * 1.12, rh * 0.82, rh * 0.32); g.fill();
        g.fillStyle = c;
        g.beginPath(); g.roundRect(sx + 3, sy + 3, rh * 1.12, rh * 0.76, rh * 0.32); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.beginPath(); g.ellipse(sx + 3 + rh * 0.4, sy + 3 + rh * 0.22, rh * 0.28, rh * 0.1, 0, 0, TAU); g.fill();
      }
    }
  });
}

/** the square's tiles: concentric rings of alternating colours, to be laid as a disc (u = angle, v = radius) */
export function plazaTex(colors: string[], gap: string) {
  return tex(`plaza:${colors.join(',')}:${gap}`, 512, 256, (g, w, h) => {
    g.fillStyle = gap; g.fillRect(0, 0, w, h);
    const rings = 8, segs = 32;
    for (let r = 0; r < rings; r++) {
      const y0 = (r / rings) * h, rh = h / rings;
      const n = Math.max(6, Math.round(segs * (0.35 + r / rings)));
      for (let i = 0; i < n; i++) {
        const c = colors[(i + r) % colors.length];
        const x0 = (i / n) * w, sw = w / n;
        g.fillStyle = shade(c, -0.1); g.beginPath(); g.roundRect(x0 + 2, y0 + 3, sw - 4, rh - 4, 6); g.fill();
        g.fillStyle = c; g.beginPath(); g.roundRect(x0 + 2, y0 + 2, sw - 4, rh - 6, 6); g.fill();
      }
    }
  });
}

/** syrup water: pink with lighter swirls (scrolled by the creek) */
export function syrupTex(base: string, light: string) {
  return tex(`syrup:${base}:${light}`, 256, 256, (g, w, h) => {
    const R = rng(13);
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.strokeStyle = light; g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      g.globalAlpha = 0.25 + R() * 0.45; g.lineWidth = 2 + R() * 4;
      const x = R() * w, y = R() * h, l = 20 + R() * 50;
      g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + l * 0.3, y - 8, x + l * 0.6, y + 8, x + l, y); g.stroke();
      g.beginPath(); g.moveTo(x - w, y); g.bezierCurveTo(x - w + l * 0.3, y - 8, x - w + l * 0.6, y + 8, x - w + l, y); g.stroke();
    }
    g.globalAlpha = 1;
  });
}

/** an icing-trimmed window: dark/clear glass with a candy frame cross (day) or a warm glow (night) */
export function windowTex(glass: string, frame: string, lit: boolean) {
  return tex(`win:${glass}:${frame}:${lit ? 1 : 0}`, 64, 96, (g, w, h) => {
    g.fillStyle = frame; g.beginPath(); g.roundRect(0, 0, w, h, [w / 2, w / 2, 6, 6]); g.fill();
    const gr = g.createLinearGradient(0, 0, 0, h);
    if (lit) { gr.addColorStop(0, '#fff2b0'); gr.addColorStop(1, glass); } else { gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, glass); gr.addColorStop(1, shade(glass, -0.25)); }
    g.fillStyle = gr; g.beginPath(); g.roundRect(7, 7, w - 14, h - 14, [w / 2 - 7, w / 2 - 7, 3, 3]); g.fill();
    g.fillStyle = frame; g.fillRect(w / 2 - 3, 8, 6, h - 16); g.fillRect(8, h * 0.52, w - 16, 6);
    if (!lit) { g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(w * 0.32, h * 0.3, 5, 11, -0.4, 0, TAU); g.fill(); }
  }, false);
}

/** a door: candy planks with a heart window and a round knob */
export function doorTex(wood: string) {
  return tex(`door:${wood}`, 128, 192, (g, w, h) => {
    g.fillStyle = shade(wood, -0.2); g.beginPath(); g.roundRect(0, 0, w, h, [w / 2, w / 2, 0, 0]); g.fill();
    for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? wood : shade(wood, 0.08); g.fillRect(8 + i * (w - 16) / 4, 8, (w - 16) / 4 - 3, h - 8); }
    g.globalCompositeOperation = 'destination-in'; g.beginPath(); g.roundRect(0, 0, w, h, [w / 2, w / 2, 0, 0]); g.fill(); g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#ffe9a8';
    const hx = w / 2, hy = h * 0.3, s = 13;
    g.beginPath(); g.moveTo(hx, hy + s); g.bezierCurveTo(hx - s * 1.6, hy, hx - s * 0.7, hy - s * 1.1, hx, hy - s * 0.35); g.bezierCurveTo(hx + s * 0.7, hy - s * 1.1, hx + s * 1.6, hy, hx, hy + s); g.fill();
    g.fillStyle = '#ffd34a'; g.beginPath(); g.arc(w * 0.78, h * 0.6, 7, 0, TAU); g.fill();
    g.strokeStyle = OUT; g.lineWidth = 2; g.stroke();
  }, false);
}

/** a candy-styled sign board: rounded cream plate with a coloured rim and big text */
export function boardTex(label: string, rim: string, ink = '#7a2a4a', w = 512, h = 160) {
  return tex(`board:${label}:${rim}:${ink}:${w}x${h}`, w, h, (g) => {
    g.fillStyle = rim; g.beginPath(); g.roundRect(0, 0, w, h, h * 0.3); g.fill();
    g.fillStyle = '#fff8ee'; g.beginPath(); g.roundRect(10, 10, w - 20, h - 20, h * 0.24); g.fill();
    let fs = Math.round(h * 0.52);
    g.font = `900 ${fs}px Rubik, "Arial Black", sans-serif`;
    while (g.measureText(label).width > w - 50 && fs > 12) { fs -= 2; g.font = `900 ${fs}px Rubik, "Arial Black", sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = ink; g.fillText(label, w / 2, h / 2 + 4);
  }, false);
}

/** a pinned paper note with handwriting (the notice board): title + a few lines */
export function noteTex(title: string, lines: string[], paper: string, pin: string) {
  return tex(`note:${title}:${lines.join('|')}:${paper}:${pin}`, 256, 256, (g, w, h) => {
    g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, w, h);
    g.fillStyle = paper; g.beginPath();
    g.moveTo(10, 14); g.lineTo(w - 12, 8); g.lineTo(w - 8, h - 14); g.lineTo(14, h - 8); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(80,40,30,0.2)'; g.lineWidth = 2;
    for (let y = 92; y < h - 20; y += 30) { g.beginPath(); g.moveTo(26, y); g.lineTo(w - 26, y - 2); g.stroke(); }
    g.fillStyle = '#5a2a3a'; g.textAlign = 'center';
    let fs = 34; g.font = `900 ${fs}px Rubik, "Arial Black", sans-serif`;
    while (g.measureText(title).width > w - 40 && fs > 14) { fs -= 2; g.font = `900 ${fs}px Rubik, "Arial Black", sans-serif`; }
    g.fillText(title, w / 2, 66);
    g.font = '400 24px Pangolin, "Comic Sans MS", sans-serif'; g.fillStyle = '#4a3a4a';
    lines.slice(0, 5).forEach((l, i) => g.fillText(l, w / 2, 112 + i * 30));
    g.fillStyle = pin; g.beginPath(); g.arc(w / 2, 22, 11, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.arc(w / 2 - 3, 19, 4, 0, TAU); g.fill();
  }, false);
}

/** the magic mirror's surface: a soft lilac-blue gradient with a diagonal sheen (animated by offset) */
export function mirrorTex() {
  return tex('mirror', 128, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#e8f4ff'); gr.addColorStop(0.35, '#b8d4ff'); gr.addColorStop(0.6, '#d8c4ff'); gr.addColorStop(1, '#9ab8f0');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath(); g.moveTo(0, h * 0.55); g.lineTo(w, h * 0.25); g.lineTo(w, h * 0.33); g.lineTo(0, h * 0.63); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.beginPath(); g.moveTo(0, h * 0.7); g.lineTo(w, h * 0.42); g.lineTo(w, h * 0.45); g.lineTo(0, h * 0.73); g.fill();
  });
}

/** chalkboard with formulas (the lab) */
export function chalkTex() {
  return tex('chalk', 256, 160, (g, w, h) => {
    g.fillStyle = '#2f5a4a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c89a6a'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = '400 20px Pangolin, "Comic Sans MS", sans-serif';
    g.fillText('☀ + сироп = ?', 22, 44);
    g.fillText('H₂O + 🍓 → ♥', 22, 76);
    g.fillText('t° = 451 ...', 22, 108);
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2;
    g.beginPath(); g.arc(200, 60, 26, 0, TAU); g.stroke();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; g.beginPath(); g.moveTo(200 + Math.cos(a) * 32, 60 + Math.sin(a) * 32); g.lineTo(200 + Math.cos(a) * 42, 60 + Math.sin(a) * 42); g.stroke(); }
    g.beginPath(); g.moveTo(150, 130); g.quadraticCurveTo(190, 100, 236, 132); g.stroke();
  }, false);
}
