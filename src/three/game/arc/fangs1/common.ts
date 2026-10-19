import * as THREE from 'three';
import { input } from '../../../../engine/input';
import { audio } from '../../../../engine/audio';
import { clamp, W, H } from '../../../../engine/util';
import { rrect } from '../../../../art/draw';
import { drawHint, glyphLabel } from '../../../../ui/glyphs';
import { toUI } from '../../../runtime';
import { net } from '../../../../net/session';
import type { Level3D } from '../../level';
import { vamp, isFolk, ambient } from '../vampires';
import type { Enemy3 } from '../../enemies';
import { TOAST, BARK } from './lines';
import type { CastKind } from './cast';

/* Bits both fangs1 levels share: the pocket squirter [E], the story four's in-level lines (solo), special townsfolk. */

const v1 = new THREE.Vector3();

/** script text placeholders → the player's buttons */
export function actText(s: string): string {
  return s.replace(/\[E\]/g, glyphLabel('interact')).replace(/\[атака\]/g, glyphLabel('attack')).replace(/\[приём\]/g, glyphLabel('special'));
}

/**
 * «Пробный сироп» (bible §8–9): stun a пресняк, then [E] near it squirts the trial syrup — its colour comes back
 * (vamp(L).syrupSpray: the host decides; any machine may ask). Mine only: a prompt over the nearest stunned one.
 */
export class Squirter {
  private target: Enemy3 | null = null;
  private cd = 0;
  constructor(private L: Level3D) {}
  update(dt: number) {
    const L = this.L, p = L.player;
    this.cd = Math.max(0, this.cd - dt);
    this.target = null;
    if (p.dead || p.downed || !p.control || L.inCutscene || L.letterbox > 0.05 || L.results || L.paused) return;
    let bd = 2.4;
    for (const e of L.enemies) {
      if (e.dead || !isFolk(e)) continue;
      const stunned = L.authority ? e.stun > 0 : !!(e as unknown as { netStun?: boolean }).netStun;
      if (!stunned) continue;
      const d = Math.hypot(e.body.pos.x - p.pos.x, e.body.pos.z - p.pos.z);
      if (d < bd && Math.abs(e.body.pos.y - p.pos.y) < 1.6) { bd = d; this.target = e; }
    }
    if (this.target && this.cd <= 0 && input.pressed('interact')) {
      input.consume('interact');
      this.cd = 0.5;
      const e = this.target;
      const at = e.center(v1).clone();
      p.yaw = Math.atan2(at.x - p.pos.x, at.z - p.pos.z);
      ambient(L, () => {
        const from = p.center().setY(p.pos.y + 1.0);
        const dir = at.clone().sub(from).normalize();
        L.fx.emit(from.clone().addScaledVector(dir, 0.4), { count: 18, speed: [2, 5], dir, spread: 0.35, life: [0.2, 0.45], size: [0.06, 0.12], colors: ['#ff3a7a', '#ffb0d0', '#ffffff'], g: 6 });
        audio.sfx('splash', { pitch: 1.5, volume: 0.5 });
      });
      vamp(L).syrupSpray(at, 1.6, L.nl ? net.myId : null);
    }
  }
  draw(ctx: CanvasRenderingContext2D) {
    const L = this.L, e = this.target;
    if (!e || e.dead) return;
    const u = toUI(e.center(v1).setY(e.body.pos.y + 1.7), L.tcam.cam);
    if (!u.vis) return;
    ctx.save();
    const label = TOAST.spray;
    ctx.font = '400 20px Pangolin, sans-serif';
    const w = 46 + ctx.measureText(label).width;
    const x = clamp(u.x - w / 2, 10, W - w - 10), y = clamp(u.y, 40, H - 40);
    rrect(ctx, x - 10, y - 20, w + 20, 40, 14, 'rgba(30,14,22,0.72)', 0);
    drawHint(ctx, 'interact', label, x, y, { size: 26 });
    ctx.restore();
  }
}

const NAMES: Record<CastKind, string> = { tosha: 'Тоша', bublik: 'Бублик', noki: 'Ноки', pastila: 'Пастила' };

/**
 * The story four's lines in a level (§5.2.4): solo only — the friend speaks from off screen (a line at the top);
 * never the hero I play myself; each line once per attempt (by key). Co-op: they keep quiet (script §5.2.4).
 */
export function companion(L: Level3D, key: string, kind: CastKind, str: string) {
  if (L.nl || L.player.kind === kind) return false;
  const k = 'f1say:' + key;
  if (L.seen.has(k)) return false;
  L.seen.add(k);
  L.shout(`${NAMES[kind]}: ${str}`, 2.6 + str.length * 0.04);
  return true;
}
/**
 * A named townsperson among the пресняки (Мармеладка 5.2.1, Зефирыч 5.2.2): a grey line when a hero first comes close
 * (each machine for its own hero), its own thank-you when restored (every machine), then `after` (every machine).
 */
export function specialFolk(L: Level3D, e: Enemy3, o: { grey?: string; back: string; after?: () => void }) {
  let near = false;
  L.updaters.push(() => {
    if (near || e.dead || !o.grey || L.inCutscene) return;
    if (Math.hypot(L.player.pos.x - e.body.pos.x, L.player.pos.z - e.body.pos.z) < 4.2) {
      near = true;
      L.bark(e.root, o.grey, 3.2, 1.6);
    }
  });
  vamp(L).onRestore((f) => {
    if (f !== e) return;
    // the townsperson who stays happy says our line instead of a generic thank-you
    for (const a of L.actors) {
      const h = a as unknown as { line?: string; root?: THREE.Object3D; said?: boolean };
      // (the kit's HappyFolk, found by its shape — class names don't survive minification)
      if (typeof h.line === 'string' && h.said === false && h.root && h.root.position.distanceTo(e.body.pos) < 0.5) h.line = o.back;
    }
    o.after?.();
  });
}

export { BARK };
