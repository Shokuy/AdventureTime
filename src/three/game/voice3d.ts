import * as THREE from 'three';
import { W, H, clamp } from '../../engine/util';
import { net } from '../../net/session';
import type { VoiceSpot } from '../../net/voice';
import { drawSpeaker } from '../../ui/voiceHud';
import { toUI } from '../runtime';
import { LEVEL_PLUGINS, type Level3D, type LevelPlugin } from './level';
import { PVP_ID } from './score';

/*
 * 3D voice chat in co-op levels (a LEVEL_PLUGINS module, solo never creates it): every tick my ears are the camera
 * (so left / right / behind / above match the screen) and each friend talks from his Tosha's head — downed, dead or
 * hidden ones too, from where they are. Loudness follows the distance from the nearer of my Tosha and the camera
 * (VOICE_NEAR / VOICE_ROLLOFF / VOICE_FADE / VOICE_MAX below). A friend not in the level yet (loading, his stream
 * quiet for STALE_KEEP s, waiting in the lobby) talks flat and quieter (net/voice.ts AWAY_GAIN). The results card
 * and the PvP podium are flat; so is everything outside levels and the «рация» setting (net.voice.setSpatial(false)).
 * HUD: a friend talking off-screen gets a small speaker at the screen edge toward him (fainter when far).
 */

/** voices are at full volume up to this far (m) */
export const VOICE_NEAR = 4;
/** beyond VOICE_NEAR: gain = NEAR / (NEAR + ROLLOFF·(d − NEAR)) — 1 would be real life (−6 dB per doubling), a bit steeper for play */
export const VOICE_ROLLOFF = 1.25;
/** from here the fall-off eases down to silence at VOICE_MAX (≈ −20 dB at 30 m) */
export const VOICE_FADE = 26;
/** voices are silent beyond this (m) */
export const VOICE_MAX = 45;
/** a friend's voice comes from this high above his feet (his mouth) */
const MOUTH_Y = 1.25;
/** a friend whose state stream went quiet keeps talking from where he was this long (lag), then counts as away */
const STALE_KEEP = 4;

/** distance gain of a voice d metres away: 1 near, natural fall-off, 0 beyond VOICE_MAX */
export function voiceGain(d: number): number {
  if (!(d > VOICE_NEAR)) return 1;
  if (d >= VOICE_MAX) return 0;
  const inv = VOICE_NEAR / (VOICE_NEAR + VOICE_ROLLOFF * (d - VOICE_NEAR));
  if (d <= VOICE_FADE) return inv;
  const x = (d - VOICE_FADE) / (VOICE_MAX - VOICE_FADE);
  return inv * (1 - x * x * (3 - 2 * x));
}

const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const me = new THREE.Vector3();

class Voice3D implements LevelPlugin {
  private spots = new Map<string, VoiceSpot>();
  private pool = new Map<string, VoiceSpot>();
  /** when each friend's stream was last fresh (plugin time) */
  private seen = new Map<string, number>();
  private ears = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), up: new THREE.Vector3() };
  private t = 0;

  constructor(private L: Level3D) {}

  update(dt: number) {
    const L = this.L;
    const v = net.voice;
    this.t += dt;
    if (!v.spatial || L.results || this.podium()) { v.end3d(this); return; }
    const cam = L.tcam.cam;
    const e = this.ears;
    e.pos.copy(cam.position);
    e.fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    // up without the camera's roll (screen shake shouldn't wobble the voices)
    e.up.copy(UP).addScaledVector(e.fwd, -e.fwd.y);
    if (e.up.lengthSq() < 1e-6) e.up.set(0, 0, 1).applyQuaternion(cam.quaternion);
    e.up.normalize();
    me.copy(L.player.pos); me.y += MOUTH_Y;
    this.spots.clear();
    for (const r of L.nl?.remotes.values() ?? []) {
      if (!r.stale) this.seen.set(r.id, this.t);
      const seen = this.seen.get(r.id);
      if (seen === undefined || this.t - seen > STALE_KEEP) continue; // not here (yet): flat, quieter
      tmp.copy(r.pos); tmp.y += MOUTH_Y;
      const d = Math.min(tmp.distanceTo(cam.position), tmp.distanceTo(me));
      let s = this.pool.get(r.id);
      if (!s) { s = { x: 0, y: 0, z: 0, g: 0 }; this.pool.set(r.id, s); }
      s.x = tmp.x; s.y = tmp.y; s.z = tmp.z; s.g = voiceGain(d);
      this.spots.set(r.id, s);
    }
    for (const id of this.seen.keys()) if (!L.nl?.remotes.has(id)) { this.seen.delete(id); this.pool.delete(id); }
    v.frame3d(this, e, this.spots);
  }

  /** the PvP round is over: winners on the podium, everyone talks flat */
  private podium() {
    return this.L.def.id === PVP_ID && this.L.plugins.some((p) => (p as { phase?: unknown }).phase === 'end');
  }

  dispose() { net.voice.end3d(this); }

  /**
   * A friend talking off-screen: a small speaker by his edge arrow — beside his name label (socialPlugin draws the
   * arrow + name for friends up and about), inside the red arrow for a downed one, at the edge for hidden / dead ones.
   */
  draw(ctx: CanvasRenderingContext2D) {
    const L = this.L;
    if (L.worldCut || L.results || !L.nl) return;
    const v = net.voice;
    const cam = L.tcam.cam;
    const t = performance.now() / 1000;
    for (const r of L.nl.remotes.values()) {
      if (!v.isSpeaking(r.id)) continue;
      const s = toUI(tmp.copy(r.pos).setY(r.pos.y + 1.55), cam);
      if (s.vis && s.x > 0 && s.x < W && s.y > 0 && s.y < H) continue; // on screen: his nameplate shows 🔊
      const p = tmp.copy(r.pos).project(cam);
      let ax = p.x, ay = -p.y;
      if (p.z > 1) { ax = -ax; ay = -ay; }
      const len = Math.hypot(ax, ay) || 1;
      const ux = ax / len, uy = ay / len;
      let x: number, y: number;
      if (!r.hidden && !r.downed && !r.dead && !r.stale) {
        // the same spot as socialPlugin's name label under the arrow, then beside it toward the screen centre
        const cx = clamp(W / 2 + ux * (W / 2 - 30), 30, W - 30), cy = clamp(H / 2 + uy * (H / 2 - 30), 30, H - 30);
        const lx = clamp(cx - ux * 26, 50, W - 50), ly = clamp(cy - uy * 22, 24, H - 12);
        ctx.font = '700 13px Rubik, sans-serif';
        const hw = ctx.measureText(r.name).width / 2;
        x = lx + (lx > W / 2 ? -1 : 1) * (hw + 14);
        y = ly + 1;
      } else {
        const m = r.downed ? 84 : 40; // inside level.ts's red "help" arrow (50 px in)
        x = clamp(W / 2 + ux * (W / 2 - m), 40, W - 40);
        y = clamp(H / 2 + uy * (H / 2 - m), 40, H - 40);
      }
      const spot = this.spots.get(r.id);
      const loud = Math.min(1, (spot ? spot.g : 0.5) * 2); // fainter when far
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.5 * loud;
      drawSpeaker(ctx, x, y, 18 + 6 * loud, { speaking: true, color: r.look.tagColor || '#ffd34a', t });
      ctx.restore();
    }
  }
}

LEVEL_PLUGINS.push((L) => (L.nl ? new Voice3D(L) : null));
