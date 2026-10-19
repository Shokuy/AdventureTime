import { W, H, clamp, damp, noise1, Rect } from './util';
import { save } from './save';

export class Camera {
  x = W / 2;
  y = H / 2;
  zoom = 1;
  trauma = 0;
  private sx = 0;
  private sy = 0;
  private st = 0;
  bounds: Rect = { x: 0, y: 0, w: W, h: H };
  /** when set, camera is driven externally (cutscenes) */
  locked = false;

  shake(amount: number) {
    if (!save.data.settings.shake) amount *= 0.25;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  follow(tx: number, ty: number, dt: number, speedX = 7, speedY = 5) {
    this.x = damp(this.x, tx, speedX, dt);
    this.y = damp(this.y, ty, speedY, dt);
  }

  clampToBounds() {
    const hw = W / 2 / this.zoom, hh = H / 2 / this.zoom;
    const b = this.bounds;
    if (b.w <= hw * 2) this.x = b.x + b.w / 2;
    else this.x = clamp(this.x, b.x + hw, b.x + b.w - hw);
    if (b.h <= hh * 2) this.y = b.y + b.h - hh;
    else this.y = clamp(this.y, b.y + hh, b.y + b.h - hh);
  }

  update(dt: number) {
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.st += dt * 30;
    const p = this.trauma * this.trauma;
    this.sx = noise1(this.st, 1) * 22 * p;
    this.sy = noise1(this.st, 7) * 16 * p;
  }

  apply(ctx: CanvasRenderingContext2D) {
    ctx.translate(W / 2, H / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-Math.round((this.x + this.sx) * 2) / 2, -Math.round((this.y + this.sy) * 2) / 2);
  }

  /** left/top of view in world coords (with shake) */
  get left() { return this.x + this.sx - W / 2 / this.zoom; }
  get top() { return this.y + this.sy - H / 2 / this.zoom; }
  get viewW() { return W / this.zoom; }
  get viewH() { return H / this.zoom; }

  view(margin = 0): Rect {
    return { x: this.left - margin, y: this.top - margin, w: this.viewW + margin * 2, h: this.viewH + margin * 2 };
  }

  toScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.x - this.sx) * this.zoom + W / 2, (wy - this.y - this.sy) * this.zoom + H / 2];
  }
}
