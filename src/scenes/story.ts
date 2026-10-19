import { W, H, TAU, srand, clamp, ease, lerp, rand } from '../engine/util';
import { input } from '../engine/input';
import { audio, MusicName } from '../engine/audio';
import { Particles } from '../engine/particles';
import { Dialog } from '../ui/dialog';
import { Coroutine, Script, wait, tween, all } from '../game/coroutine';
import { drawHero, drawDog, drawBear, drawKing, drawGuard, Who } from '../art/characters';
import { circle, ellipse, rrect, text, glow, limbQ, OUT, line } from '../art/draw';
import { vignetteCanvas } from '../art/props';
import { game } from '../game/game';

type C = CanvasRenderingContext2D;
const GY = 470;
type Shot = 'forest' | 'fall' | 'dogfall' | 'land' | 'climb' | 'dawn' | 'theend' | 'kingAlone';

export class StoryScene {
  t = 0;
  shotT = 0;
  shotName: Shot = 'forest';
  dialog = new Dialog();
  fx = new Particles();
  co: Coroutine;
  v: Record<string, number> = {};
  shake = 0;
  flash = 0;
  fade = 0;
  bigText: { text: string; t: number; color: string } | null = null;
  vignette = vignetteCanvas(W, H, 0.7);
  skipHold = 0;
  done = false;

  constructor(public id: 'intro' | 'ending') {
    this.co = new Coroutine(id === 'intro' ? intro(this) : ending(this));
    this.dialog.onSpeak = (who) => { this.v['talk_' + who] = 0.3; };
  }

  shot(s: Shot) { this.shotName = s; this.shotT = 0; }
  say(who: Who, str: string, expr?: string) { return this.dialog.say(who, str, expr); }
  music(m: MusicName) { audio.playMusic(m); }
  big(str: string, color = '#ffffff') { this.bigText = { text: str, t: 0, color }; }
  set(k: string, v: number) { this.v[k] = v; }
  g(k: string, d = 0) { return this.v[k] ?? d; }
  anim(k: string, to: number, d: number, e: (t: number) => number = ease.inOut) {
    const from = this.g(k);
    return tween(d, (x) => { this.v[k] = lerp(from, to, x); }, e);
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.dialog.close();
    if (this.id === 'intro') game.advance();
    else game.advance();
  }

  update(dt: number) {
    this.t += dt; this.shotT += dt;
    this.dialog.update(dt);
    this.fx.update(dt);
    this.shake = Math.max(0, this.shake - dt * 2);
    this.flash = Math.max(0, this.flash - dt * 2);
    for (const k of Object.keys(this.v)) if (k.startsWith('talk_')) this.v[k] = Math.max(0, this.v[k] - dt * 3);
    if (this.bigText) { this.bigText.t += dt; if (this.bigText.t > 1.6) this.bigText = null; }
    if (input.down('back') || input.down('pause')) {
      this.skipHold += dt;
      if (this.skipHold > 0.8) this.finish();
    } else this.skipHold = 0;
    this.co.update(dt);
    if (this.co.done) this.finish();
  }

  talk(who: string) { const v = this.g('talk_' + who); return v > 0 ? Math.abs(Math.sin(this.t * 16)) : 0; }

  render(ctx: C) {
    ctx.save();
    if (this.shake > 0) ctx.translate(rand(-1, 1) * this.shake * 14, rand(-1, 1) * this.shake * 10);
    switch (this.shotName) {
      case 'forest': this.drawForest(ctx); break;
      case 'fall': this.drawFall(ctx); break;
      case 'dogfall': this.drawDogFall(ctx); break;
      case 'land': ctx.fillStyle = '#0a0406'; ctx.fillRect(0, 0, W, H); break;
      case 'climb': this.drawClimb(ctx); break;
      case 'dawn': this.drawDawn(ctx); break;
      case 'theend': this.drawDawn(ctx); this.drawTheEnd(ctx); break;
      case 'kingAlone': this.drawKingAlone(ctx); break;
    }
    this.fx.draw(ctx);
    ctx.restore();
    ctx.drawImage(this.vignette, 0, 0, W, H);
    if (this.bigText) {
      const b = this.bigText;
      const s = 1 + Math.max(0, 0.25 - b.t) * 3;
      ctx.save(); ctx.translate(W / 2, H / 2 - 40); ctx.scale(s, s); ctx.rotate(Math.sin(b.t * 30) * 0.03 * Math.max(0, 1 - b.t));
      ctx.globalAlpha = clamp((1.6 - b.t) * 3, 0, 1);
      text(ctx, b.text, 0, 0, { size: 96, color: b.color, align: 'center', base: 'middle', stroke: 14 });
      ctx.restore();
    }
    if (this.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${this.flash})`; ctx.fillRect(0, 0, W, H); }
    if (this.fade > 0) { ctx.fillStyle = `rgba(10,4,6,${this.fade})`; ctx.fillRect(0, 0, W, H); }
    // letterbox
    ctx.fillStyle = '#0a0406'; ctx.fillRect(0, 0, W, 50); ctx.fillRect(0, H - 50, W, 50);
    this.dialog.draw(ctx);
    const a = 0.35 + (this.skipHold > 0 ? 0.6 : 0);
    text(ctx, this.skipHold > 0 ? 'Пропускаем...' : 'Держи Esc — пропустить', W - 20, 32, { size: 15, font: 'body', color: '#f6ecd2', align: 'right', alpha: a });
  }

  // ─────────── SHOTS ───────────
  private night(ctx: C, scroll: number) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0e1030'); g.addColorStop(0.6, '#2a1e4a'); g.addColorStop(1, '#3a2a50');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const R = srand(42);
    for (let i = 0; i < 90; i++) {
      const x = R() * W, y = R() * H * 0.6, tw = 0.5 + 0.5 * Math.sin(this.t * (1 + R() * 3) + i);
      ctx.fillStyle = `rgba(255,255,230,${0.3 + tw * 0.6})`;
      ctx.fillRect(x, y, 2, 2);
    }
    glow(ctx, 980, 150, 260, '#fff6d0', 0.35);
    circle(ctx, 980, 150, 58, '#fff6d8', 0);
    ctx.fillStyle = 'rgba(220,210,170,0.5)';
    ctx.beginPath(); ctx.arc(960, 135, 10, 0, TAU); ctx.arc(1000, 170, 7, 0, TAU); ctx.arc(1005, 128, 5, 0, TAU); ctx.fill();
    // hills
    const hill = (f: number, y: number, col: string, amp: number, seed: number) => {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W + 40; x += 40) {
        const wx = x + scroll * f;
        ctx.lineTo(x, y + Math.sin(wx * 0.004 + seed) * amp + Math.sin(wx * 0.011 + seed * 2) * amp * 0.4);
      }
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    };
    hill(0.1, GY - 140, '#241a40', 40, 1);
    hill(0.25, GY - 90, '#1a1430', 30, 3);
    // trees
    for (let layer = 0; layer < 2; layer++) {
      const f = layer === 0 ? 0.45 : 0.8;
      const col = layer === 0 ? '#161028' : '#0e0a1c';
      const sp = layer === 0 ? 220 : 340;
      const off = ((scroll * f) % sp + sp) % sp;
      for (let x = -sp; x < W + sp; x += sp) {
        const tx = x - off;
        const idx = Math.floor((x + scroll * f) / sp);
        const R2 = srand(idx * 13 + layer * 7);
        const h = 220 + R2() * 160 + layer * 60;
        ctx.fillStyle = col;
        ctx.fillRect(tx + 40, GY - h * 0.4, 18 + layer * 6, h * 0.4 + 10);
        ctx.beginPath(); ctx.moveTo(tx + 49, GY - h); ctx.lineTo(tx - 10 - layer * 20, GY - h * 0.35); ctx.lineTo(tx + 108 + layer * 20, GY - h * 0.35); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(tx + 49, GY - h * 1.1); ctx.lineTo(tx + 5 - layer * 10, GY - h * 0.6); ctx.lineTo(tx + 93 + layer * 10, GY - h * 0.6); ctx.closePath(); ctx.fill();
      }
    }
    // ground
    ctx.fillStyle = '#2a3a2a'; ctx.fillRect(0, GY, W, H - GY);
    ctx.fillStyle = '#3a5236'; ctx.fillRect(0, GY, W, 10);
    ctx.fillStyle = '#4a6a40';
    for (let x = -(scroll % 30); x < W; x += 30) { ctx.beginPath(); ctx.moveTo(x, GY + 2); ctx.lineTo(x + 5, GY - 12); ctx.lineTo(x + 10, GY + 2); ctx.fill(); }
    // fireflies
    for (let i = 0; i < 18; i++) {
      const R3 = srand(i * 9 + 1);
      const x = ((R3() * W * 1.5 - scroll * 0.6 + Math.sin(this.t * 0.7 + i) * 30) % W + W) % W;
      const y = 220 + R3() * 240 + Math.sin(this.t * 1.3 + i * 2) * 20;
      const a = 0.5 + 0.5 * Math.sin(this.t * 3 + i);
      glow(ctx, x, y, 16, '#d8ff7a', 0.5 * a);
      ctx.fillStyle = `rgba(230,255,150,${a})`; ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
  }

  private drawForest(ctx: C) {
    const scroll = this.g('scroll');
    this.night(ctx, scroll);
    const crack = this.g('crack');
    const holes = this.g('holes');
    // cracks
    if (crack > 0) {
      ctx.strokeStyle = '#0a0406'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      const R = srand(7);
      for (let i = 0; i < 6; i++) {
        let x = 470 + (R() - 0.5) * 60, y = GY + 6;
        ctx.beginPath(); ctx.moveTo(x, y);
        const dir = i % 2 ? 1 : -1;
        for (let k = 0; k < 8 * crack; k++) { x += dir * (20 + R() * 30); y += (R() - 0.3) * 10; ctx.lineTo(x, y); }
        ctx.stroke();
      }
    }
    for (const [hx, w] of [[360, 130], [700, 120]]) {
      if (holes <= 0) break;
      ellipse(ctx, hx, GY + 12, w * holes, 22 * holes, '#0a0406', 4);
      ctx.fillStyle = '#1a0e08'; ctx.beginPath(); ctx.ellipse(hx, GY + 6, w * holes * 0.9, 12 * holes, 0, Math.PI, TAU); ctx.fill();
    }
    const walking = this.g('walking', 1);
    const ph = this.t * 9 * walking;
    const fallH = this.g('fallH');
    const fallD = this.g('fallD');
    const heroY = GY + fallH * 500, dogY = GY + fallD * 500;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, GY + 6 + 8); if (holes > 0) { ctx.rect(0, 0, 0, 0); }
    ctx.restore();
    // clip characters to above ground when falling
    ctx.save();
    if (fallH > 0 || fallD > 0) { ctx.beginPath(); ctx.rect(0, 0, W, GY + 14); ctx.clip(); }
    drawDog(ctx, 330 + this.g('dogX'), dogY, 2.3, this.t, { facing: 1, state: walking > 0.5 ? 'walk' : 'idle', walk: ph, talk: this.talk('dog'), expr: this.g('dogScared') > 0 ? 'angry' : 'happy' });
    drawHero(ctx, 700 + this.g('heroX'), heroY, 2.3, {
      t: this.t, facing: this.g('heroFace', 1), state: fallH > 0 ? 'tumble' : walking > 0.5 ? 'walk' : this.g('heroScared') > 0 ? 'hurt' : 'idle', phase: ph,
      weapon: 'sword', talk: this.talk('hero'), expr: this.g('heroScared') > 0 ? 'scared' : 'happy', wind: 0.3,
    });
    ctx.restore();
  }

  private shaft(ctx: C, speed: number, col1: string, col2: string, seed: number) {
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, col1); g.addColorStop(0.5, col2); g.addColorStop(1, col1);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const off = (this.shotT * speed) % 220;
    for (let y = -220; y < H + 220; y += 220) {
      const idx = Math.floor((y - this.shotT * speed) / 220);
      const R = srand(idx * 31 + seed);
      for (let k = 0; k < 4; k++) {
        const side = R() > 0.5 ? 1 : 0;
        const x = side ? W - 120 - R() * 200 : 120 + R() * 200;
        const yy = y + off + R() * 200;
        if (R() > 0.5) {
          ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.moveTo(side ? W : 0, yy); ctx.quadraticCurveTo(x, yy + 30, x + (side ? -60 : 60), yy + 80); ctx.stroke();
        } else {
          ellipse(ctx, x, yy, 20 + R() * 30, 14 + R() * 20, '#6a5a4a', 3);
        }
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, 160, H); ctx.fillRect(W - 160, 0, 160, H);
  }

  private drawFall(ctx: C) {
    this.shaft(ctx, 1800, '#2a1a10', '#4a3020', 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
    const R = srand(Math.floor(this.t * 20));
    for (let i = 0; i < 14; i++) { const x = R() * W, y = R() * H; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 80 - R() * 120); ctx.stroke(); }
    drawHero(ctx, W / 2 + Math.sin(this.t * 3) * 40, H / 2 + 60, 2.6, { t: this.t, facing: 1, state: 'tumble', rot: this.t * 5, weapon: 'sword', expr: 'scared', talk: this.talk('hero'), wind: 1 });
  }

  private drawDogFall(ctx: C) {
    this.shaft(ctx, 60, '#1e2a1a', '#34402a', 9);
    const y = 300 + Math.sin(this.t * 1.2) * 8;
    const x = W / 2;
    // parachute (tarp)
    ctx.save(); ctx.translate(x, y - 250 + Math.sin(this.t * 1.1) * 6); ctx.rotate(Math.sin(this.t * 0.9) * 0.05);
    ctx.beginPath(); ctx.moveTo(-180, 50); ctx.quadraticCurveTo(0, -170, 180, 50); ctx.quadraticCurveTo(90, 25, 0, 50); ctx.quadraticCurveTo(-90, 25, -180, 50); ctx.closePath();
    ctx.fillStyle = '#c8a870'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = OUT; ctx.stroke();
    ctx.fillStyle = '#a8885a'; ctx.fillRect(-70, -50, 40, 70); ctx.fillRect(40, -30, 30, 50);
    for (const sx of [-170, -60, 60, 170]) line(ctx, sx, 48, sx * 0.35, 240, '#4a3a2a', 3);
    ctx.restore();
    // cart
    rrect(ctx, x - 120, y - 10, 240, 70, 10, '#8a5530', 5);
    ctx.strokeStyle = '#5a3520'; ctx.lineWidth = 4; for (let i = -80; i <= 80; i += 40) { ctx.beginPath(); ctx.moveTo(x + i, y - 6); ctx.lineTo(x + i, y + 56); ctx.stroke(); }
    ellipse(ctx, x - 80, y + 66, 22, 22, '#4a4a55', 4);
    ellipse(ctx, x + 80, y + 66, 6, 22, '#4a4a55', 4);
    drawDog(ctx, x - 20, y - 6, 2.2, this.t, { facing: 1, state: 'sit', talk: this.talk('dog'), expr: 'normal' });
    if (Math.floor(this.t * 1.5) % 2 === 0) text(ctx, '...', x + 120, y - 90, { size: 40, color: '#fff', stroke: 6 });
  }

  private drawClimb(ctx: C) {
    const prog = this.g('climb');
    this.shaft(ctx, 220 * (prog < 1 ? 1 : 0), '#1a1a30', '#2a2a48', 21);
    glow(ctx, W / 2, -100, 600, '#c8d8ff', 0.45);
    // dog stretched vertically
    const x = W / 2;
    const topY = 120 - prog * 60, botY = H + 200;
    ctx.save();
    limbQ(ctx, x, botY, x + Math.sin(this.t * 2) * 20, (topY + botY) / 2, x, topY + 30, 46, '#b0612e', 5);
    ctx.fillStyle = '#e0a066'; ctx.fillRect(x - 6, topY + 40, 12, botY - topY);
    ctx.restore();
    // head at top
    ctx.save(); ctx.translate(x, topY); ctx.rotate(-Math.PI / 2);
    drawDog(ctx, -30, 18, 2, this.t, { facing: 1, L: 0, state: 'idle', talk: this.talk('dog'), expr: 'happy' });
    ctx.restore();
    const climbY = 400 - (this.t % 2) * 6;
    drawHero(ctx, x - 40, climbY, 2.2, { t: this.t, facing: 1, state: 'jump', weapon: 'sword', expr: 'happy', talk: this.talk('hero') });
    drawBear(ctx, x + 70, climbY + 170, 1.4, this.t, { talk: this.talk('bear') > 0 ? 1 : 0, wave: 1 });
  }

  private drawDawn(ctx: C) {
    const k = this.g('sun', 0);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, lerpColor('#1a1840', '#5ab0ff', k)); g.addColorStop(0.55, lerpColor('#6a3a6a', '#ffb0a0', k)); g.addColorStop(1, lerpColor('#ff8a5a', '#ffe0a0', k));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const sy = 400 - k * 220;
    glow(ctx, 900, sy, 380, '#ffd870', 0.6);
    circle(ctx, 900, sy, 70, '#fff0b0', 0);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,220,150,0.08)';
    for (let i = 0; i < 12; i++) { const a = this.t * 0.05 + (i / 12) * TAU; ctx.beginPath(); ctx.moveTo(900, sy); ctx.arc(900, sy, 900, a, a + 0.12); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    // birds
    ctx.strokeStyle = '#3a2a3a'; ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const bx = ((this.t * 40 + i * 300) % (W + 200)) - 100, by = 160 + i * 30 + Math.sin(this.t * 2 + i) * 10;
      const f = Math.sin(this.t * 8 + i) * 6;
      ctx.beginPath(); ctx.moveTo(bx - 12, by - f); ctx.quadraticCurveTo(bx - 4, by - 6, bx, by); ctx.quadraticCurveTo(bx + 4, by - 6, bx + 12, by - f); ctx.stroke();
    }
    ctx.fillStyle = lerpColor('#3a2a4a', '#5a9a4a', k);
    ctx.beginPath(); ctx.moveTo(0, H); for (let x = 0; x <= W; x += 40) ctx.lineTo(x, 380 + Math.sin(x * 0.006) * 30); ctx.lineTo(W, H); ctx.fill();
    ctx.fillStyle = lerpColor('#2a3a2a', '#6ac05a', k);
    ctx.beginPath(); ctx.moveTo(0, H); for (let x = 0; x <= W; x += 40) ctx.lineTo(x, 470 + Math.sin(x * 0.01 + 2) * 14); ctx.lineTo(W, H); ctx.fill();
    // the hole
    ellipse(ctx, 220, 490, 120, 26, '#0a0406', 4);
    // trio
    drawBear(ctx, 560, 500, 1.6, this.t, { talk: this.talk('bear') > 0 ? 1 : 0 });
    drawHero(ctx, 720, 500, 2.2, { t: this.t, facing: -1, state: 'sit', weapon: 'none', expr: 'happy', talk: this.talk('hero') });
    drawDog(ctx, 800, 500, 2.2, this.t, { facing: -1, state: 'idle', talk: this.talk('dog'), expr: 'happy' });
  }

  private drawTheEnd(ctx: C) {
    const a = clamp(this.shotT / 1.2, 0, 1);
    ctx.save(); ctx.globalAlpha = a;
    const s = ease.outBack(a);
    ctx.translate(W / 2, 220); ctx.scale(s, s);
    text(ctx, 'КОНЕЦ', 0, 0, { size: 110, color: '#fff3d8', align: 'center', base: 'middle', stroke: 14 });
    ctx.restore();
  }

  private drawKingAlone(ctx: C) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#140e1e'); g.addColorStop(1, '#2e2040');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#4b3d5e'; ctx.fillRect(0, 480, W, H - 480);
    ctx.fillStyle = '#b8323a'; ctx.fillRect(0, 480, W, 14);
    drawKing(ctx, { x: W / 2 + 120, y: 560, s: 0.55, t: this.t, eye: this.g('kingEye', 0.3), mouth: this.talk('king') * 0.6, anger: this.g('kingAnger', 0), hands: [
      { x: W / 2 - 150, y: 490, state: 'rest', side: -1 }, { x: W / 2 + 390, y: 490, state: 'rest', side: 1 }] });
    if (this.g('guardIn') > 0) {
      for (let i = 0; i < 2; i++) {
        const gx = lerp(-80, 180 + i * 70, this.g('guardIn'));
        drawGuardSmall(ctx, gx, 480, this.t + i);
      }
    }
  }
}

function drawGuardSmall(ctx: C, x: number, y: number, t: number) {
  drawGuard(ctx, x, y, 1.8, { t, facing: 1, state: 'idle', kind: 'feeder', carry: true });
}

function lerpColor(a: string, b: string, t: number) {
  const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((na >> 16) & 255, (nb >> 16) & 255, t));
  const g = Math.round(lerp((na >> 8) & 255, (nb >> 8) & 255, t));
  const bl = Math.round(lerp(na & 255, nb & 255, t));
  return `rgb(${r},${g},${bl})`;
}

// ─────────────────────────── INTRO SCRIPT ───────────────────────────
function* intro(S: StoryScene): Script {
  S.music('forest');
  S.shot('forest');
  S.set('walking', 1);
  let walkingOn = true;
  const step = (dt: number) => { if (walkingOn) S.v.scroll = (S.v.scroll ?? 0) + dt * 110; };
  const W8 = (sec: number) => { let t = 0; return { update: (dt: number) => { step(dt); t += dt; return t >= sec; } }; };
  const SAY = (who: Who, s: string, e?: string) => { const w = S.say(who, s, e); return { update: (dt: number) => { step(dt); return w.update(dt); } }; };
  yield W8(1.5);
  yield SAY('narrator', 'Ночь. Тоша и его пёс Бублик возвращались домой после долгого-долгого приключения.');
  yield SAY('dog', 'Тоша, ещё чуть-чуть — и мы дома. Я так голоден, что съел бы целый пирог!');
  yield SAY('hero', 'А я — целого короля! С короной!', 'happy');
  yield SAY('dog', 'Хе-хе. Только не настоящего.');
  yield W8(0.6);
  walkingOn = false; S.set('walking', 0);
  audio.sfx('thud', { pitch: 0.6 }); S.shake = 0.5;
  yield wait(0.5);
  S.set('heroScared', 1); S.set('dogScared', 1);
  yield S.say('hero', 'Ой... Ты слышал?', 'scared');
  audio.sfx('break', { pitch: 0.5 }); audio.sfx('bigSlam');
  S.shake = 1.2;
  S.big('КРРРАК!', '#ffd34a');
  yield S.anim('crack', 1, 0.6);
  yield S.anim('holes', 1, 0.3, ease.outBack);
  audio.sfx('fall');
  yield all(S.anim('fallH', 1, 0.7, ease.inQuad), S.anim('fallD', 1, 0.8, ease.inQuad));
  yield wait(0.3);
  S.shot('fall');
  audio.playMusic('tension');
  yield S.say('hero', 'А-А-А-А-А-А!!!', 'scared');
  yield S.say('narrator', 'Тоша летел вниз долго-долго. А где-то совсем рядом, в соседней яме...');
  S.shot('dogfall');
  yield wait(1.0);
  yield S.say('dog', '...Хм. Тележка. Брезент. Похоже, спускаться я буду очень долго.');
  yield S.say('dog', 'Держись, Тоша. Я тебя найду. Рано или... очень поздно.');
  S.shot('fall');
  yield wait(1.0);
  S.shot('land');
  audio.stopMusic(0.2);
  audio.sfx('bigSlam'); S.shake = 1.5; S.flash = 1;
  S.big('БУМ!', '#ff8a2a');
  yield wait(1.8);
}

// ─────────────────────────── ENDING SCRIPT ───────────────────────────
function* ending(S: StoryScene): Script {
  S.music('ending');
  S.shot('climb');
  S.set('climb', 0);
  const up = S.anim('climb', 1, 9);
  const co = { update: (dt: number) => { up.update(dt); return true; } };
  yield co;
  const parallelClimb = (w: { update(dt: number): boolean }) => ({ update: (dt: number) => { up.update(dt); return w.update(dt); } });
  yield parallelClimb(S.say('narrator', 'Бублик вытянулся так длинно, как не вытягивался ещё никогда в жизни — до самой луны.'));
  yield parallelClimb(S.say('dog', 'Не щекочите! Ай! Тоша, это мой хвост!', 'happy'));
  yield parallelClimb(S.say('bear', 'Ох, мои старые лапы... Сорок лет не лазил!'));
  yield parallelClimb(S.say('hero', 'Ещё чуть-чуть! Я вижу небо!', 'happy'));
  yield parallelClimb(wait(1));
  S.flash = 1;
  S.shot('dawn');
  S.set('sun', 0);
  const sun = S.anim('sun', 1, 10, ease.outCubic);
  const withSun = (w: { update(dt: number): boolean }) => ({ update: (dt: number) => { sun.update(dt); return w.update(dt); } });
  yield withSun(wait(1.5));
  yield withSun(S.say('narrator', 'Так Тоша выбрался из Громадного Королевства. А медведь Вторник впервые за сорок лет увидел рассвет.'));
  yield withSun(S.say('bear', 'Ох... А я и забыл, какое оно тёплое — солнце.'));
  yield withSun(S.say('hero', 'Пойдём к нам, дедушка Вторник! Бублик испечёт пирог.', 'happy'));
  yield withSun(S.say('dog', 'Я?! ...Ладно. Испеку. Но без мяса! Хватит с меня королей.', 'happy'));
  yield withSun(wait(1));
  S.shot('theend');
  audio.sfx('victory');
  yield withSun(wait(4));
  S.fade = 0;
  yield tween(0.8, (k) => { S.fade = k; });
  S.shot('kingAlone');
  audio.playMusic('den');
  yield tween(0.8, (k) => { S.fade = 1 - k; });
  yield wait(1);
  S.set('kingEye', 0.7);
  yield S.say('king', '...Э-эй? Кто-нибудь? Где все?');
  yield S.say('king', 'Мясо... кто-нибудь принесёт мне мясо?');
  yield S.anim('guardIn', 1, 1.2);
  yield S.say('guard', 'Ваше Громадейшество! А может... сегодня салатик?', 'cheer');
  S.set('kingAnger', 1); S.set('kingEye', 1);
  audio.sfx('roar'); S.shake = 1;
  yield S.say('king', 'НЕЕЕЕЕЕТ!!!', 'angry');
  yield wait(1.2);
}
