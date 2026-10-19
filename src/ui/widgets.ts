import { input } from '../engine/input';
import { audio } from '../engine/audio';
import { rrect, text, OUT } from '../art/draw';
import { damp } from '../engine/util';

type C = CanvasRenderingContext2D;

export interface MenuItem {
  label: string | (() => string);
  action?: () => void;
  left?: () => void;
  right?: () => void;
  disabled?: () => boolean;
  hint?: string;
}

export class MenuList {
  sel = 0;
  hover = -1;
  anim: number[] = [];
  t = 0;
  w = 340;
  h = 54;
  gap = 12;
  size = 26;
  constructor(public items: MenuItem[], public x: number, public y: number, opts: { w?: number; h?: number; gap?: number; size?: number } = {}) {
    Object.assign(this, opts);
    this.anim = items.map(() => 0);
    this.skipDisabled(1);
  }

  private isDisabled(i: number) { return this.items[i]?.disabled?.() ?? false; }
  private skipDisabled(dir: number) {
    let n = 0;
    while (this.isDisabled(this.sel) && n++ < this.items.length) this.sel = (this.sel + dir + this.items.length) % this.items.length;
  }

  rect(i: number) { return { x: this.x - this.w / 2, y: this.y + i * (this.h + this.gap), w: this.w, h: this.h }; }

  update(dt: number) {
    this.t += dt;
    input.menuTick(); // the d-pad belongs to this menu (not to co-op quick phrases)
    const n = this.items.length;
    if (this.anim.length !== n) this.anim = this.items.map(() => 0);
    if (input.pressed('down')) { this.sel = (this.sel + 1) % n; this.skipDisabled(1); audio.sfx('menuMove'); }
    if (input.pressed('up')) { this.sel = (this.sel - 1 + n) % n; this.skipDisabled(-1); audio.sfx('menuMove'); }
    const it = this.items[this.sel];
    if (input.pressed('left') && it.left) { it.left(); audio.sfx('menuMove'); }
    if (input.pressed('right') && it.right) { it.right(); audio.sfx('menuMove'); }
    // mouse
    this.hover = -1;
    for (let i = 0; i < n; i++) {
      const r = this.rect(i);
      if (input.mouseX >= r.x && input.mouseX <= r.x + r.w && input.mouseY >= r.y && input.mouseY <= r.y + r.h) {
        this.hover = i;
        if (input.mouseMoved && this.sel !== i && !this.isDisabled(i)) { this.sel = i; audio.sfx('menuMove'); }
        if (input.mouseClicked && !this.isDisabled(i)) {
          this.sel = i;
          if (it.left || it.right) {
            const mid = r.x + r.w / 2;
            if (input.mouseX < mid - 60 && this.items[i].left) { this.items[i].left!(); audio.sfx('menuMove'); }
            else if (input.mouseX > mid + 60 && this.items[i].right) { this.items[i].right!(); audio.sfx('menuMove'); }
            else this.activate();
          } else this.activate();
        }
      }
    }
    if (input.pressed('confirm') || (input.pressed('jump') && !input.down('up')) || input.pressed('attack')) this.activate();
    for (let i = 0; i < n; i++) this.anim[i] = damp(this.anim[i], i === this.sel ? 1 : 0, 14, dt);
  }

  activate() {
    const it = this.items[this.sel];
    if (!it || this.isDisabled(this.sel)) return;
    if (it.action) { audio.sfx('menuSelect'); it.action(); }
    else if (it.right) { it.right(); audio.sfx('menuMove'); }
  }

  draw(ctx: C) {
    this.items.forEach((it, i) => {
      const r = this.rect(i);
      const a = this.anim[i] ?? 0;
      const dis = this.isDisabled(i);
      const label = typeof it.label === 'function' ? it.label() : it.label;
      ctx.save();
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      const sc = 1 + a * 0.06;
      ctx.scale(sc, sc);
      ctx.rotate(a * Math.sin(this.t * 3) * 0.012);
      rrect(ctx, -r.w / 2 + 4, -r.h / 2 + 6, r.w, r.h, 16, 'rgba(0,0,0,0.35)', 0);
      rrect(ctx, -r.w / 2, -r.h / 2, r.w, r.h, 16, dis ? '#6a5a5a' : a > 0.5 ? '#ffd34a' : '#f6ecd2', 4);
      if (a > 0.05) {
        ctx.globalAlpha = a;
        rrect(ctx, -r.w / 2 + 6, -r.h / 2 + 5, r.w - 12, 8, 4, 'rgba(255,255,255,0.6)', 0);
        ctx.globalAlpha = 1;
      }
      // a long label shrinks to fit its button (never spills over the edges)
      ctx.font = `900 ${this.size}px Rubik, "Arial Black", sans-serif`;
      const room = r.w - ((it.left || it.right) && a > 0.5 ? 76 : 28);
      const tw = ctx.measureText(label).width;
      const size = tw > room ? Math.max(12, Math.floor(this.size * room / tw)) : this.size;
      text(ctx, label, 0, 2, { size, color: dis ? '#a89898' : OUT, align: 'center', base: 'middle' });
      if ((it.left || it.right) && a > 0.5) {
        text(ctx, '◀', -r.w / 2 + 24, 2, { size: 20, color: OUT, align: 'center', base: 'middle' });
        text(ctx, '▶', r.w / 2 - 24, 2, { size: 20, color: OUT, align: 'center', base: 'middle' });
      }
      ctx.restore();
    });
  }
}
