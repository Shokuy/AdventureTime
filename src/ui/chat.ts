import { input } from '../engine/input';
import { audio } from '../engine/audio';
import { clamp } from '../engine/util';
import { net } from '../net/session';
import { LIMITS } from '../net/config';
import { rrect, text, wrap, OUT } from '../art/draw';
import { TextInput } from './textInput';
import { drawGlyph } from './glyphs';

/*
 * Room chat panel (lobby, den, levels): the room's chat log with names in each player's colour,
 * T (or a click on the panel) opens a text box, Enter sends, Esc closes.
 * `fade`: in a level old lines melt away after a few seconds and the panel has no background
 * unless the player is typing.
 */

type C = CanvasRenderingContext2D;

export interface ChatLine { name: string; text: string; color: string; t: number; sys?: boolean }

/** quick phrases: keys 1–4 / d-pad ↑ → ↓ ← in co-op (message 'phrase' {i}) */
export const QUICK_PHRASES = ['Сюда!', 'Помогите!', 'Спасибо!', 'Вперёд!'] as const;
export const QP_ACTIONS = ['qp1', 'qp2', 'qp3', 'qp4'] as const;

/** a member's nameplate colour (falls back to gold) */
export function memberColor(id: string): string {
  return net.members.get(id)?.look.tagColor || '#ffd34a';
}

export interface ChatOpts {
  /** logical rectangle of the panel (the input box sits at its bottom) */
  x: number; y: number; w: number; h: number;
  /** in-level style: lines fade out, no background while not typing */
  fade?: boolean;
  /** heard a line from someone (not history): (member id, text) */
  onLine?(from: string, text: string): void;
}

const LINE_H = 22;
const FS = 17;
const SHOW_S = 9;

export class ChatPanel {
  lines: ChatLine[] = [];
  box: TextInput | null = null;
  private off: (() => void) | null = null;
  private t = 0;
  private boxY = 0;

  constructor(public o: ChatOpts) {}

  /** subscribe to the room chat (call when the scene becomes active; safe to call again) */
  attach() {
    if (this.off) return;
    // what was said before (lobby → level → den keeps the conversation)
    this.lines = net.chatLog.slice(-30).map((m) => ({ name: m.name, text: m.text, color: memberColor(m.from), t: this.o.fade ? 99 : 0 }));
    this.off = net.onChat((from, txt, _ts, name, history) => {
      this.lines.push({ name, text: txt, color: memberColor(from), t: history && this.o.fade ? 99 : 0 });
      if (this.lines.length > 40) this.lines.shift();
      if (history) return;
      if (from !== net.myId) audio.sfx('textBlip', { volume: 0.5, pitch: 1.3 });
      this.o.onLine?.(from, txt);
    });
  }

  detach() {
    this.off?.();
    this.off = null;
    this.close();
  }

  /** a local grey line (joins, quick phrases…) */
  sys(txt: string, color = '#d8c8e8', name = '') {
    this.lines.push({ name, text: txt, color, t: 0, sys: true });
    if (this.lines.length > 40) this.lines.shift();
  }

  get typing() { return !!this.box && !this.box.closed; }

  open() {
    if (this.typing || !net.active) return;
    const o = this.o;
    this.boxY = o.y;
    this.box = new TextInput({
      x: o.x + 6, y: o.y + o.h - 42, w: o.w - 12, h: 36, size: 18,
      maxLength: LIMITS.chatMaxLen, placeholder: 'Сообщение…', align: 'left', select: false,
      onBlur: 'cancel',
      onSubmit: (v) => { if (v.trim()) net.chat(v); },
    });
  }

  close() { this.box?.close(); this.box = null; }

  /** the panel rectangle contains this logical point */
  hit(x: number, y: number) { const o = this.o; return x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h; }

  /** returns true when it used this tick's input (opened the box) */
  update(dt: number, opts: { allowOpen?: boolean; mouse?: boolean } = {}): boolean {
    this.t += dt;
    for (const l of this.lines) l.t += dt;
    if (this.box && this.box.closed) this.box = null;
    // the panel moved (a dialog box pushed it up): the text box follows
    const o = this.o;
    if (this.box && this.boxY !== o.y) { this.boxY = o.y; this.box.setRect(o.x + 6, o.y + o.h - 42, o.w - 12, 36); }
    if (this.typing || opts.allowOpen === false || !net.active) return false;
    if (input.pressed('chat') || (opts.mouse !== false && input.mouseClicked && this.hit(input.mouseX, input.mouseY))) {
      input.consume('chat');
      this.open();
      return true;
    }
    return false;
  }

  draw(ctx: C) {
    const o = this.o;
    const typing = this.typing;
    const solid = !o.fade || typing;
    if (solid) {
      rrect(ctx, o.x, o.y, o.w, o.h, 16, o.fade ? 'rgba(20,10,16,0.62)' : 'rgba(30,14,10,0.78)', o.fade ? 0 : 4);
      if (!o.fade) text(ctx, 'Чат', o.x + 14, o.y + 28, { size: 20, color: '#ffd34a', stroke: 4 });
    }
    // lines, bottom-up above the input row
    const top = o.y + (o.fade ? 8 : 40);
    let y = o.y + o.h - 52;
    ctx.font = `400 ${FS}px Pangolin, sans-serif`;
    const maxW = o.w - 24;
    for (let i = this.lines.length - 1; i >= 0 && y > top; i--) {
      const l = this.lines[i];
      let a = 1;
      if (o.fade && !typing) a = clamp((SHOW_S - l.t) / 1.5, 0, 1);
      if (a <= 0) continue;
      const prefix = l.name ? l.name + ': ' : '';
      ctx.font = `400 ${FS}px Pangolin, sans-serif`;
      const rows = wrap(ctx, prefix + l.text, maxW);
      for (let r = rows.length - 1; r >= 0 && y > top; r--) {
        const row = rows[r];
        const x = o.x + 12;
        text(ctx, row, x, y, { size: FS, font: 'body', color: l.sys ? l.color : '#fff3d8', stroke: o.fade ? 4 : 0, alpha: a });
        // the name part in the speaker's colour (first row only)
        if (r === 0 && prefix && !l.sys) {
          text(ctx, l.name + ':', x, y, { size: FS, font: 'body', color: l.color, alpha: a });
        }
        y -= LINE_H;
      }
    }
    // prompt row
    if (!typing && !o.fade) {
      const py = o.y + o.h - 24;
      const gw = drawGlyph(ctx, 'chat', o.x + 14, py, 24, 'left');
      text(ctx, net.active ? 'написать сообщение' : '', o.x + 22 + gw, py + 1, { size: 16, font: 'body', color: '#d8c8b0', base: 'middle' });
    } else if (!typing && o.fade && this.lines.some((l) => l.t < SHOW_S)) {
      const py = o.y + o.h - 24;
      const gw = drawGlyph(ctx, 'chat', o.x + 12, py, 20, 'left');
      text(ctx, 'ответить', o.x + 18 + gw, py + 1, { size: 15, font: 'body', color: '#fff3d8', base: 'middle', stroke: 3, alpha: 0.8 });
    }
    void OUT;
  }
}
