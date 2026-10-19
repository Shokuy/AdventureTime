import { input } from '../engine/input';
import { audio } from '../engine/audio';
import { W, H, ease, clamp } from '../engine/util';
import { rrect, text, wrap, OUT } from '../art/draw';
import { drawPortrait, Who, WHO_INFO } from '../art/characters';
import type { Waiter } from '../game/coroutine';

type C = CanvasRenderingContext2D;

export class Dialog {
  active = false;
  who: Who = 'narrator';
  str = '';
  expr: string | undefined;
  shown = 0;
  t = 0;
  appear = 0;
  finished = false;
  blipAcc = 0;
  auto = 0;
  /** co-op: lines advance on their own timer only (everyone stays on the same beat) */
  noInput = false;
  onSpeak: ((who: Who) => void) | null = null;
  top = false;

  say(who: Who, str: string, expr?: string, auto = 0): Waiter {
    this.active = true; this.who = who; this.str = str; this.expr = expr;
    this.shown = 0; this.t = 0; this.finished = false; this.auto = auto;
    if (this.appear < 0.01) this.appear = 0;
    audio.duckMusic(0.55);
    return { update: () => this.finished };
  }

  close() { this.active = false; audio.duckMusic(1); }

  update(dt: number) {
    if (!this.active) { this.appear = Math.max(0, this.appear - dt * 6); return; }
    this.t += dt;
    this.appear = Math.min(1, this.appear + dt * 6);
    const speed = 42;
    const before = Math.floor(this.shown);
    if (this.shown < this.str.length) {
      this.shown = Math.min(this.str.length, this.shown + dt * speed * (input.down('confirm') ? 2.5 : 1));
      const now = Math.floor(this.shown);
      if (now !== before) {
        this.blipAcc += now - before;
        if (this.blipAcc >= 2) {
          this.blipAcc = 0;
          const ch = this.str[now - 1];
          if (ch && ch !== ' ') audio.sfx('textBlip', { pitch: WHO_INFO[this.who].pitch * (0.92 + Math.random() * 0.16), volume: 0.5 });
          this.onSpeak?.(this.who);
        }
      }
    }
    const adv = !this.noInput && (input.pressed('confirm') || input.pressed('attack') || input.pressed('jump') || input.mouseClicked);
    if (adv && this.t > 0.12) {
      if (this.shown < this.str.length) this.shown = this.str.length;
      else { this.finished = true; this.active = false; audio.sfx('menuMove', { volume: 0.5 }); }
    }
    if (this.auto > 0 && this.shown >= this.str.length && this.t > Dialog.hold(this.str, this.auto)) { this.finished = true; this.active = false; }
  }

  /** an auto-advancing line (co-op) stays up `min` s plus READ s per character from its first letter, so it can be read */
  static readonly READ = 0.06;
  static hold(str: string, min: number) { return min + str.length * Dialog.READ; }

  /** the top edge (name tag included) of the box while it is shown at the bottom, else null — speech bubbles stay above it */
  coverTop(): number | null {
    return this.appear > 0.05 && !this.top ? H - Dialog.BOX_H - 26 - 22 : null;
  }
  static readonly BOX_H = 150;

  draw(ctx: C) {
    if (this.appear <= 0) return;
    const a = ease.outBack(clamp(this.appear, 0, 1));
    const bw = 1060, bh = Dialog.BOX_H;
    const bx = (W - bw) / 2, by = this.top ? 30 - (1 - a) * 80 : H - bh - 26 + (1 - a) * 80;
    ctx.save();
    ctx.globalAlpha = clamp(this.appear * 1.5, 0, 1);
    const hasPortrait = this.who !== 'narrator';
    rrect(ctx, bx + 6, by + 8, bw, bh, 22, 'rgba(0,0,0,0.4)', 0);
    rrect(ctx, bx, by, bw, bh, 22, this.who === 'narrator' ? '#2a1b1a' : '#fff7e6', 5);
    if (hasPortrait) {
      drawPortrait(ctx, this.who, bx + 86, by + bh / 2 - 6, 62, this.t, this.shown < this.str.length ? Math.abs(Math.sin(this.t * 16)) : 0, this.expr);
      const info = WHO_INFO[this.who];
      ctx.font = '900 20px Rubik, sans-serif';
      const nw = ctx.measureText(info.name).width + 30;
      rrect(ctx, bx + 160, by - 18, nw, 34, 12, info.color, 4);
      text(ctx, info.name, bx + 175, by + 6, { size: 20, color: '#fff', stroke: 0 });
    }
    const tx = hasPortrait ? bx + 170 : bx + 40;
    const maxW = bw - (tx - bx) - 40;
    ctx.font = '400 27px Pangolin, "Comic Sans MS", sans-serif';
    const lines = wrap(ctx, this.str, maxW);
    let remaining = Math.floor(this.shown);
    lines.forEach((ln, i) => {
      const part = ln.slice(0, Math.max(0, remaining));
      remaining -= ln.length + 1;
      text(ctx, part, tx, by + 50 + i * 34, { size: 27, font: 'body', color: this.who === 'narrator' ? '#f6ecd2' : OUT });
    });
    if (this.shown >= this.str.length && this.active) {
      const bob = Math.sin(this.t * 6) * 4;
      text(ctx, '▼', bx + bw - 36, by + bh - 20 + bob, { size: 22, color: this.who === 'narrator' ? '#ffd34a' : '#b0453a', align: 'center' });
    }
    ctx.restore();
  }
}
