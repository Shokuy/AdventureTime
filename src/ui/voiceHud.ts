import { input } from '../engine/input';
import { save } from '../engine/save';
import { net } from '../net/session';
import { VOICE_VOLUME } from '../net/voice';
import { rrect, text, OUT } from '../art/draw';
import { drawGlyph, glyphWidth } from './glyphs';

/*
 * Voice chat on the game side: push-to-talk from the 'talk' action (V / touchpad), "mute myself",
 * and the little mic / speaker icons used by the lobby, the den and the level overlay.
 * The PTT key is read by a small timer of its own, so it works in every scene (lobby, den, story, level).
 * The same timer applies the saved voice settings (save.data.settings.voice = slider 0..1, .voice3d = 3D voices in
 * levels, off = «рация») whenever they change; the settings panel may also call net.voice.setVolume(v) / setSpatial(b).
 */

type C = CanvasRenderingContext2D;

class VoiceUI {
  /** I muted myself (the mic stays captured, nothing is sent) */
  selfMute = false;
  /** last error from enabling the mic (Russian, ready to show) */
  error = '';
  private timer = 0;
  /** saved voice settings last applied (applied again only when they change) */
  private savedVol = NaN;
  private saved3d: boolean | null = null;

  /** start reading the PTT key (idempotent) */
  start() {
    if (this.timer) return;
    this.timer = window.setInterval(() => this.tick(), 40);
  }

  private tick() {
    const v = net.voice;
    this.syncSettings();
    if (!v.enabled) { if (v.talking) v.setTalking(false); return; }
    if (this.selfMute) {
      if (v.talking) v.setTalking(false);
      const t = v.micTrack;
      if (t && t.enabled) t.enabled = false;
      return;
    }
    // typing (chat box open) suspends input: down('talk') is false then
    if (v.ptt) v.setTalking(input.down('talk'));
  }

  /** the saved voice volume / 3D setting (tolerates saves from before these settings existed) */
  private syncSettings() {
    const s = save.data.settings as unknown as { voice?: unknown; voice3d?: unknown };
    const vol = typeof s.voice === 'number' && Number.isFinite(s.voice) ? s.voice : VOICE_VOLUME;
    if (vol !== this.savedVol) { this.savedVol = vol; net.voice.setVolume(vol); }
    const on = typeof s.voice3d === 'boolean' ? s.voice3d : true;
    if (on !== this.saved3d) { this.saved3d = on; net.voice.setSpatial(on); }
  }

  /** turn the mic on / off; returns false with `error` set when the browser refused */
  async toggleMic(): Promise<boolean> {
    const v = net.voice;
    if (v.enabled) { v.disable(); this.error = ''; return true; }
    const ok = await v.enable();
    this.error = ok ? '' : v.error || 'Не удалось включить микрофон';
    if (ok && this.selfMute) this.setSelfMute(true);
    return ok;
  }

  setSelfMute(on: boolean) {
    this.selfMute = on;
    const v = net.voice;
    if (on) { v.setTalking(false); const t = v.micTrack; if (t) t.enabled = false; }
    else v.setPTT(v.ptt); // re-applies the normal PTT / open-mic gate
  }

  /** my mic is sending right now (PTT held or open mic) */
  get onAir() { const v = net.voice; return v.enabled && !this.selfMute && v.live; }

  /** what friends should see over my head */
  get talking() { const v = net.voice; return this.onAir && (v.speaking || (v.ptt && v.talking)); }

  /** one short status line for menus */
  status(): string {
    const v = net.voice;
    if (!v.enabled) return 'выключен';
    if (this.selfMute) return 'заглушён';
    return v.ptt ? 'по кнопке' : 'открытый';
  }
}

export const voiceUI = new VoiceUI();
voiceUI.start();

/** a microphone glyph (crossed out when off / muted) */
export function drawMic(ctx: C, x: number, y: number, s: number, color: string, crossed = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // capsule
  ctx.beginPath();
  const w = s * 0.32, h = s * 0.5;
  ctx.roundRect(-w / 2, -s * 0.45, w, h, w / 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = Math.max(1.5, s * 0.09); ctx.strokeStyle = OUT; ctx.stroke();
  // cradle + stand
  ctx.beginPath();
  ctx.arc(0, -s * 0.18, s * 0.3, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.moveTo(0, s * 0.12); ctx.lineTo(0, s * 0.3);
  ctx.moveTo(-s * 0.16, s * 0.3); ctx.lineTo(s * 0.16, s * 0.3);
  ctx.lineWidth = Math.max(1.5, s * 0.1); ctx.strokeStyle = OUT; ctx.stroke();
  if (crossed) {
    ctx.beginPath(); ctx.moveTo(-s * 0.38, -s * 0.42); ctx.lineTo(s * 0.38, s * 0.32);
    ctx.lineWidth = s * 0.16; ctx.strokeStyle = OUT; ctx.stroke();
    ctx.lineWidth = s * 0.08; ctx.strokeStyle = '#ff5a5a'; ctx.stroke();
  }
  ctx.restore();
}

/** a speaker glyph: sound waves when `level` > 0 (speaking), a cross when muted */
export function drawSpeaker(ctx: C, x: number, y: number, s: number, o: { speaking?: boolean; muted?: boolean; color?: string; t?: number } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-s * 0.42, -s * 0.14); ctx.lineTo(-s * 0.2, -s * 0.14); ctx.lineTo(s * 0.06, -s * 0.38);
  ctx.lineTo(s * 0.06, s * 0.38); ctx.lineTo(-s * 0.2, s * 0.14); ctx.lineTo(-s * 0.42, s * 0.14); ctx.closePath();
  ctx.fillStyle = o.muted ? '#a89898' : o.color ?? '#fff3d8'; ctx.fill();
  ctx.lineWidth = Math.max(1.5, s * 0.09); ctx.strokeStyle = OUT; ctx.stroke();
  if (o.muted) {
    ctx.beginPath(); ctx.moveTo(s * 0.18, -s * 0.18); ctx.lineTo(s * 0.48, s * 0.18); ctx.moveTo(s * 0.48, -s * 0.18); ctx.lineTo(s * 0.18, s * 0.18);
    ctx.lineWidth = s * 0.14; ctx.strokeStyle = OUT; ctx.stroke();
    ctx.lineWidth = s * 0.07; ctx.strokeStyle = '#ff5a5a'; ctx.stroke();
  } else if (o.speaking) {
    const t = o.t ?? performance.now() / 1000;
    for (let i = 0; i < 2; i++) {
      const r = s * (0.24 + i * 0.18);
      ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(t * 8 - i));
      ctx.beginPath(); ctx.arc(s * 0.08, 0, r, -0.9, 0.9);
      ctx.lineWidth = s * 0.15; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.lineWidth = s * 0.08; ctx.strokeStyle = '#7ef08a'; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/**
 * The "my mic" capsule: hidden while voice is off unless `always`; shows PTT prompt / ON AIR / open mic / muted.
 * (x, y) = left edge / vertical centre. Returns the width drawn.
 */
export function drawMicBadge(ctx: C, x: number, y: number, o: { always?: boolean; t?: number; alpha?: number } = {}): number {
  const v = net.voice;
  if (!v.enabled && !o.always) return 0;
  const t = o.t ?? performance.now() / 1000;
  const air = voiceUI.onAir;
  const loud = voiceUI.talking;
  let label: string;
  if (!v.enabled) label = 'Микрофон выключен';
  else if (voiceUI.selfMute) label = 'Ты заглушён';
  else if (air) label = v.ptt ? 'В эфире' : 'Открытый микрофон';
  else label = 'говорить';
  const ptt = v.enabled && !voiceUI.selfMute && v.ptt && !air;
  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  ctx.font = '400 17px Pangolin, sans-serif';
  const gw = ptt ? glyphWidth(ctx, 'talk', 24) + 6 : 0;
  ctx.font = '400 17px Pangolin, sans-serif';
  const w = 44 + gw + ctx.measureText(label).width + 14;
  const bg = air ? (loud ? '#3a8a3a' : 'rgba(40,90,40,0.85)') : 'rgba(20,10,16,0.7)';
  rrect(ctx, x, y - 17, w, 34, 15, bg, air ? 3 : 0);
  if (air && loud) {
    ctx.globalAlpha = (o.alpha ?? 1) * (0.25 + 0.2 * Math.sin(t * 9));
    rrect(ctx, x - 4, y - 21, w + 8, 42, 18, '#7ef08a', 0);
    ctx.globalAlpha = o.alpha ?? 1;
  }
  drawMic(ctx, x + 22, y + 1, 22, air ? '#c8ffc8' : '#f6ecd2', !v.enabled || voiceUI.selfMute);
  let tx = x + 40;
  if (ptt) tx += drawGlyph(ctx, 'talk', tx, y, 24, 'left') + 6;
  text(ctx, label, tx, y + 1, { size: 17, font: 'body', color: '#fff3d8', base: 'middle', stroke: 3 });
  ctx.restore();
  return w;
}
