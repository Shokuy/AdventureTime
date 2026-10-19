import * as THREE from 'three';
import { audio, type SfxName } from '../../../../engine/audio';
import { W, H, clamp } from '../../../../engine/util';
import { toUI, viewUI } from '../../../runtime';
import type { Level3D } from '../../level';

/**
 * Шёпот is heard, not seen: whispers are quiet italic lines floating where they come from (off screen: at the edge,
 * on the side they come from), with a positional sound (stereo pan + distance) — every machine shows its own, from
 * the same replicated spot. Not the level's speech barks (those are white bubbles over someone).
 */
interface Wh { at: THREE.Vector3; str: string; t: number; dur: number; seed: number }

const tmp = new THREE.Vector3();
const right = new THREE.Vector3();

export class Whispers {
  private list: Wh[] = [];
  constructor(private L: Level3D) {}

  /** show a whisper at a world point (local; callers replicate) */
  say(at: THREE.Vector3, str: string, dur = 2.6, sound = true) {
    this.list = this.list.filter((w) => w.str !== str);
    this.list.push({ at: at.clone(), str, t: 0, dur, seed: Math.random() * 10 });
    if (this.list.length > 5) this.list.shift();
    if (sound) posSfx(this.L, 'mist', at, { volume: 0.55, pitch: 1.5 + Math.random() * 0.2 });
  }

  update(dt: number) {
    for (const w of this.list) w.t += dt;
    if (this.list.some((w) => w.t >= w.dur)) this.list = this.list.filter((w) => w.t < w.dur);
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (!this.list.length) return;
    const L = this.L, cam = L.tcam.cam;
    const v = viewUI();
    const placed: { x: number; y: number; w: number }[] = [];
    for (const w of this.list) {
      const a = clamp(Math.min(w.t / 0.35, (w.dur - w.t) / 0.6), 0, 1) * (0.75 + 0.25 * Math.sin(w.t * 9 + w.seed));
      tmp.copy(w.at).setY(w.at.y + 1.6 + w.t * 0.25);
      const s = toUI(tmp, cam);
      const onScreen = s.vis && s.x > v.x0 + 60 && s.x < v.x1 - 60 && s.y > v.y0 + 50 && s.y < v.y1 - 80;
      let x = s.x, y = s.y;
      let edge = 0;
      if (!onScreen) {
        // off screen: on the edge it comes from (left / right / behind = bottom)
        const p = tmp.clone().project(cam);
        let ax = p.x, ay = -p.y;
        if (p.z > 1) { ax = -ax; ay = Math.abs(ay) + 0.6; }
        const l = Math.hypot(ax, ay) || 1;
        ax /= l; ay /= l;
        x = W / 2 + ax * (W / 2 - 170); y = H / 2 + ay * (H / 2 - 120);
        edge = Math.atan2(ay, ax);
      }
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = 'italic 400 24px Pangolin, "Comic Sans MS", sans-serif';
      // (two whispers from about the same place: one above the other, not on top of each other)
      const tw = ctx.measureText(w.str).width;
      for (let k = 0; k < 4 && placed.some((q) => Math.abs(q.x - x) < (q.w + tw) / 2 && Math.abs(q.y - y) < 28); k++) y -= 30;
      placed.push({ x, y, w: tw });
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const wob = Math.sin(w.t * 2.3 + w.seed) * 4;
      ctx.shadowColor = 'rgba(120,140,255,0.9)'; ctx.shadowBlur = 14;
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(10,8,24,0.85)';
      ctx.strokeText(w.str, x + wob, y);
      ctx.fillStyle = '#dcd8ff';
      ctx.fillText(w.str, x + wob, y);
      if (!onScreen) {
        // little sound waves pointing out of the screen toward the voice
        ctx.shadowBlur = 0;
        ctx.translate(x + Math.cos(edge) * 120, y + Math.sin(edge) * 26);
        ctx.rotate(edge);
        ctx.strokeStyle = 'rgba(200,205,255,0.8)'; ctx.lineWidth = 3;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(-10 + i * 7, 0, 6 + i * 5, -0.7, 0.7); ctx.stroke(); }
      }
      ctx.restore();
    }
  }
  clear() { this.list = []; }
}

/** a sound at a world point: louder near my hero / the camera, panned left / right by where it is on screen */
export function posSfx(L: Level3D, name: SfxName, at: THREE.Vector3, o: { volume?: number; pitch?: number } = {}) {
  const cam = L.tcam.cam;
  const d = Math.min(at.distanceTo(L.player.pos), at.distanceTo(cam.position));
  const vol = (o.volume ?? 1) * clamp(1 / (1 + Math.max(0, d - 3) / 7), 0.08, 1);
  right.set(1, 0, 0).applyQuaternion(cam.quaternion);
  tmp.copy(at).sub(cam.position);
  const l = tmp.length() || 1;
  const pan = clamp((tmp.dot(right) / l) * 1.1, -0.95, 0.95);
  audio.sfx(name, { volume: vol, pitch: o.pitch, pan });
}
