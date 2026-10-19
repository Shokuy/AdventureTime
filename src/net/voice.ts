/**
 * Voice chat: mic capture, push-to-talk / open mic, speaking detection, per-member volume and mute, 3D voices.
 * The mic track goes into every mesh link's audio transceiver (replaceTrack, no renegotiation).
 *
 * Remote audio goes through WebAudio (one AudioContext of our own):
 *   track → source ─┬→ analyser (speaking detection, before any volume)
 *                   └→ gain (member volume 0..1.5 / mute, mono) ─┬→ flat ─────────────┐
 *                                                                └→ panner (HRTF) → spat ┴→ mix (stereo) → master → speakers
 * `flat` = the old walkie-talkie sound (both ears, full volume); `spat` = the friend's voice from where his Tosha
 * stands, with a distance gain. A level's voice3d plugin (src/three/game/voice3d.ts) calls frame3d() every tick
 * with my ears (the camera) and every friend's head; outside levels, on the results card / PvP podium and with
 * 3D voices off («рация») everyone is flat. Friends who aren't in the level (loading, waiting in the lobby) are
 * flat and quieter. `master` = the settings volume (a slider position, same taper as music: audio.ts sliderGain;
 * 0 in dev builds unless ?music=1); tests tap `mix`.
 * Chrome feeds remote WebRTC audio into WebAudio only while a media element plays the stream too, so each friend
 * keeps a hidden, MUTED <audio>. Echo cancellation: Chrome (111+, «Chrome-wide AEC»), Firefox and Safari cancel
 * everything the page plays, WebAudio included. Without WebAudio the <audio> elements play as before (flat).
 * ?fakemic=1 uses a beeping oscillator.
 */
import { urlParam } from './config';
import { sliderGain } from '../engine/audio';

const PREF_KEY = 'gk-voice-v1';
/** RMS above this = speaking; held for HOLD_MS to avoid flicker */
const SPEAK_RMS = 0.015;
const HOLD_MS = 350;
/** friends' voices' volume until the settings say otherwise (slider position 0..1, settings «Голоса друзей») */
export const VOICE_VOLUME = 0.8;
/** a friend who isn't in my level (loading, in the lobby) talks flat at this volume while I'm in one */
const AWAY_GAIN = 0.5;
/** the HRTF panner makes a voice in front ≈ +2.5 dB louder than flat: trimmed so 3D on / off keeps the loudness */
const HRTF_TRIM = 0.75;
/** the level stopped sending 3D frames this long ago (stuck, gone without dispose): back to flat */
const FRAME3D_TIMEOUT = 1000;
/** gain changes glide with this time constant (s): no clicks when a friend walks off or 3D turns on */
const GLIDE = 0.06;
/** dev builds are silent (the test pages use beeping fake mics): ?music=1 to hear voices */
const DEV_SILENT = !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof location !== 'undefined' && !new URLSearchParams(location.search).has('music');

/** where a friend's voice is in the 3D scene: his head (world metres) and the distance gain 0..1 */
export interface VoiceSpot { x: number; y: number; z: number; g: number }
type V3 = { x: number; y: number; z: number };
/** my ears in the 3D scene: position, forward and up (unit vectors) */
export interface VoiceEars { pos: V3; fwd: V3; up: V3 }

interface Remote {
  el: HTMLAudioElement;
  stream: MediaStream;
  src: MediaStreamAudioSourceNode | null;
  analyser: AnalyserNode | null;
  /** member volume / mute (null: no WebAudio for this one, the element plays it) */
  gain: GainNode | null;
  flat: GainNode | null;
  panner: PannerNode | null;
  spat: GainNode | null;
  /** last targets set on flat / spat (only changes are scheduled) */
  flatT: number;
  spatT: number;
  speaking: boolean;
  lastLoud: number;
}

type Ctx = AudioContext;

export class Voice {
  /** mic captured */
  enabled = false;
  /** push-to-talk (else open mic) */
  ptt = true;
  /** PTT key held */
  talking = false;
  /** my mic is open and loud right now */
  speaking = false;
  /** why the last enable() failed — ready to show to the player */
  error = '';
  /** the mesh takes my track from here (set by the session) */
  sink: (track: MediaStreamTrack | null) => void = () => {};
  /** friends' voices' volume: a slider position 0..1 (setVolume(v)); the gain is sliderGain(volume) */
  volume = VOICE_VOLUME;
  /** 3D voices in levels (setSpatial; off = «рация»: everyone flat at full volume) */
  spatial = true;

  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private ctx: Ctx | null = null;
  private localSrc: MediaStreamAudioSourceNode | null = null;
  private localAn: AnalyserNode | null = null;
  private fake: { nodes: AudioNode[]; srcs: OscillatorNode[] } | null = null;
  private remotes = new Map<string, Remote>();
  private vols = new Map<string, number>();
  private mutes = new Set<string>();
  private subs = new Set<() => void>();
  private loop = 0;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private lastLoudMe = 0;
  private pendingPlay = new Set<HTMLAudioElement>();
  private gestureHooked = false;
  private enabling: Promise<boolean> | null = null;
  private gen = 0;
  /** all voices, stereo, before the master volume */
  private mix: GainNode | null = null;
  private master: GainNode | null = null;
  /** the level plugin that sends 3D frames (null = flat) and when it last did */
  private owner3d: object | null = null;
  private last3d = 0;
  private spots = new Map<string, VoiceSpot>();
  /** live per-friend WebAudio nodes (tests check that leaving frees them) */
  private nodes = 0;

  constructor() {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as { ptt?: boolean };
      if (typeof p.ptt === 'boolean') this.ptt = p.ptt;
    } catch { /* */ }
  }

  /** capture the mic; false (+ error) when denied / unavailable */
  enable(): Promise<boolean> {
    if (this.enabled) return Promise.resolve(true);
    this.enabling ??= this.doEnable().finally(() => { this.enabling = null; });
    return this.enabling;
  }

  private async doEnable(): Promise<boolean> {
    this.error = '';
    const gen = ++this.gen;
    this.hookGesture();
    const ctx = this.audioCtx();
    let stream: MediaStream;
    try {
      if (urlParam('fakemic') === '1') {
        if (!ctx) throw new Error('no WebAudio');
        stream = this.fakeMic(ctx);
      } else {
        if (!navigator.mediaDevices?.getUserMedia) {
          this.error = window.isSecureContext ? 'Этот браузер не умеет в микрофон' : 'Микрофон работает только по HTTPS';
          this.emit();
          return false;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      }
    } catch (e) {
      const name = (e as { name?: string })?.name ?? '';
      this.error =
        name === 'NotAllowedError' || name === 'SecurityError' ? 'Нет доступа к микрофону — разреши его в браузере'
        : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'Микрофон не найден'
        : name === 'NotReadableError' ? 'Микрофон занят другой программой'
        : 'Не удалось включить микрофон';
      this.emit();
      return false;
    }
    const track = stream.getAudioTracks()[0];
    if (gen !== this.gen || !track) {
      // disabled while we waited for permission, or no audio track at all
      for (const t of stream.getTracks()) t.stop();
      if (track) return false;
      this.error = 'Микрофон не найден';
      this.emit();
      return false;
    }
    this.stream = stream;
    this.track = track;
    track.onended = () => { if (this.track === track) this.disable(); }; // unplugged / revoked
    this.enabled = true;
    if (ctx) {
      try {
        this.localSrc = ctx.createMediaStreamSource(stream);
        this.localAn = ctx.createAnalyser();
        this.localAn.fftSize = 512;
        this.localSrc.connect(this.localAn);
      } catch { /* speaking detection off */ }
    }
    this.applyTalk();
    this.sink(track);
    this.startLoop();
    this.emit();
    return true;
  }

  /** release the mic */
  disable() {
    this.gen++;
    const wasOn = this.enabled;
    this.enabled = false;
    this.speaking = false;
    this.sink(null);
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.track = null;
    try { this.localSrc?.disconnect(); } catch { /* */ }
    this.localSrc = null;
    this.localAn = null;
    if (this.fake) {
      for (const s of this.fake.srcs) { try { s.stop(); } catch { /* */ } }
      for (const n of this.fake.nodes) { try { n.disconnect(); } catch { /* */ } }
      this.fake = null;
    }
    if (wasOn) this.emit();
  }

  setPTT(on: boolean) {
    this.ptt = on;
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ ptt: on })); } catch { /* */ }
    this.applyTalk();
    this.emit();
  }

  /** push-to-talk key down / up */
  setTalking(on: boolean) {
    if (this.talking === on) return;
    this.talking = on;
    this.applyTalk();
    this.emit();
  }

  /** my mic track (null when voice is off) */
  get micTrack(): MediaStreamTrack | null { return this.track; }

  /** is the mic actually transmitting right now */
  get live() { return !!this.track && this.track.enabled; }

  private applyTalk() {
    if (this.track) this.track.enabled = this.enabled && (!this.ptt || this.talking);
  }

  /** setVolume(v): all voices, a slider position 0..1 (settings); setVolume(id, v): one member's gain 0..1.5 (above 1 = boost) */
  setVolume(v: number): void;
  setVolume(id: string, v: number): void;
  setVolume(a: string | number, b?: number) {
    if (typeof a === 'number') {
      const v = Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : VOICE_VOLUME;
      if (v === this.volume) return;
      this.volume = v;
      this.applyMaster();
      for (const id of this.remotes.keys()) this.applyVolume(id);
      this.emit();
      return;
    }
    this.vols.set(a, Math.max(0, Math.min(1.5, b ?? 1)));
    this.applyVolume(a);
    this.emit();
  }
  getVolume(id: string) { return this.vols.get(id) ?? 1; }

  /** 3D voices in levels on / off (off = «рация»: everyone flat at full volume) */
  setSpatial(on: boolean) {
    if (this.spatial === on) return;
    this.spatial = on;
    this.applyPlaces();
    this.emit();
  }

  /**
   * 3D voices: one frame of a level — my ears (the camera) and where each friend's voice comes from. Friends missing
   * from `spots` aren't in the level (flat, quieter). Called every tick by the level's voice3d plugin (`owner`);
   * outside levels nobody calls it and everyone is flat.
   */
  frame3d(owner: object, ears: VoiceEars, spots: ReadonlyMap<string, VoiceSpot>) {
    this.owner3d = owner;
    this.last3d = performance.now();
    this.spots.clear();
    for (const [id, p] of spots) this.spots.set(id, { x: p.x, y: p.y, z: p.z, g: p.g });
    const ctx = this.ctx;
    if (ctx && this.spatial) {
      const l = ctx.listener;
      if (l.positionX) {
        l.positionX.value = ears.pos.x; l.positionY.value = ears.pos.y; l.positionZ.value = ears.pos.z;
        l.forwardX.value = ears.fwd.x; l.forwardY.value = ears.fwd.y; l.forwardZ.value = ears.fwd.z;
        l.upX.value = ears.up.x; l.upY.value = ears.up.y; l.upZ.value = ears.up.z;
      } else {
        l.setPosition(ears.pos.x, ears.pos.y, ears.pos.z);
        l.setOrientation(ears.fwd.x, ears.fwd.y, ears.fwd.z, ears.up.x, ears.up.y, ears.up.z);
      }
    }
    this.applyPlaces();
  }

  /** the level `owner` is done with 3D (left, results card, podium): everyone flat again */
  end3d(owner: object) {
    if (this.owner3d !== owner) return;
    this.owner3d = null;
    this.spots.clear();
    this.applyPlaces();
  }

  /** voices are in 3D right now (a level sends frames and 3D voices are on) */
  get in3d() { return this.spatial && !!this.owner3d && performance.now() - this.last3d < FRAME3D_TIMEOUT; }

  mute(id: string, on: boolean) {
    if (on) this.mutes.add(id); else this.mutes.delete(id);
    const r = this.remotes.get(id);
    if (r && on) r.speaking = false;
    this.applyVolume(id);
    this.emit();
  }
  isMuted(id: string) { return this.mutes.has(id); }

  /** remote member speaking (detected from their audio) */
  isSpeaking(id: string) { return this.remotes.get(id)?.speaking ?? false; }

  onChange(cb: () => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }

  // --- remote audio (called by the session for every mesh link) ---

  addRemote(id: string, track: MediaStreamTrack) {
    this.removeRemote(id);
    this.hookGesture();
    const stream = new MediaStream([track]);
    const el = document.createElement('audio');
    el.autoplay = true;
    el.setAttribute('playsinline', '');
    el.style.display = 'none';
    el.dataset.netVoice = id;
    el.srcObject = stream;
    document.body.appendChild(el);
    const r: Remote = { el, stream, src: null, analyser: null, gain: null, flat: null, panner: null, spat: null, flatT: -1, spatT: -1, speaking: false, lastLoud: 0 };
    const ctx = this.audioCtx();
    if (ctx) {
      try {
        // Chrome only feeds remote WebRTC audio into WebAudio while an element plays it too (ours stays muted)
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        r.src = src; r.analyser = an;
      } catch { /* no speaking detection, the element plays it */ }
      if (r.src) {
        const made: AudioNode[] = [];
        try {
          const out = this.output(ctx);
          const gain = ctx.createGain(); made.push(gain);
          gain.channelCount = 1; gain.channelCountMode = 'explicit'; // a voice is mono: one point in space
          const flat = ctx.createGain(); made.push(flat);
          const spat = ctx.createGain(); made.push(spat);
          flat.gain.value = 0; spat.gain.value = 0;
          const panner = ctx.createPanner(); made.push(panner);
          panner.panningModel = 'HRTF';
          // the distance gain is voice3d's curve on `spat`: the panner only gives the direction
          panner.distanceModel = 'inverse';
          panner.refDistance = 1;
          panner.rolloffFactor = 0;
          r.src.connect(gain);
          gain.connect(flat).connect(out);
          gain.connect(panner).connect(spat).connect(out);
          r.gain = gain; r.flat = flat; r.spat = spat; r.panner = panner;
        } catch {
          // no WebAudio playback for this one: the element plays it (flat)
          for (const n of made) { try { n.disconnect(); } catch { /* */ } }
        }
      }
      for (const n of [r.src, r.analyser, r.gain, r.flat, r.panner, r.spat]) if (n) this.nodes++;
    }
    this.remotes.set(id, r);
    this.applyVolume(id);
    this.applyPlace(id, r);
    this.play(el);
    this.startLoop();
  }

  removeRemote(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.remotes.delete(id);
    this.pendingPlay.delete(r.el);
    try { r.el.pause(); } catch { /* */ }
    r.el.srcObject = null;
    r.el.remove();
    for (const n of [r.src, r.analyser, r.gain, r.flat, r.panner, r.spat]) {
      if (!n) continue;
      try { n.disconnect(); } catch { /* */ }
      this.nodes--;
    }
    r.src = null; r.analyser = null; r.gain = r.flat = r.spat = null; r.panner = null;
    if (r.speaking) this.emit();
  }

  removeAllRemotes() { for (const id of [...this.remotes.keys()]) this.removeRemote(id); }

  /** for tests and the debug overlay: friends, live WebAudio nodes, 3D state and each friend's flat / 3D gains */
  debugState() {
    return {
      remotes: this.remotes.size, nodes: this.nodes, els: document.querySelectorAll('audio[data-net-voice]').length,
      ctx: this.ctx?.state ?? null, master: this.master?.gain.value ?? null, volume: this.volume, spatial: this.spatial, in3d: this.in3d,
      voices: [...this.remotes].map(([id, r]) => ({ id, flat: r.flatT, spat: r.spatT, wa: !!r.gain, muted: r.el.muted })),
    };
  }

  private applyVolume(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    const v = this.getVolume(id);
    const muted = this.mutes.has(id);
    if (r.gain && this.ctx) {
      r.el.muted = true; // only feeds WebAudio
      this.glide(r.gain.gain, muted ? 0 : v);
    } else {
      // no WebAudio: the element plays it (no boost, no 3D)
      r.el.muted = muted || DEV_SILENT;
      try { r.el.volume = Math.min(1, v) * sliderGain(this.volume); } catch { /* iOS: read-only */ }
    }
  }

  /** flat or 3D for every friend (after a frame / a setting / the level leaving) */
  private applyPlaces() { for (const [id, r] of this.remotes) this.applyPlace(id, r); }

  private applyPlace(id: string, r: Remote) {
    if (!r.flat || !r.spat || !r.panner) return;
    const in3d = this.in3d;
    const at = in3d ? this.spots.get(id) : undefined;
    const flatT = !in3d ? 1 : at ? 0 : AWAY_GAIN;
    const spatT = at ? Math.max(0, Math.min(1, at.g)) * HRTF_TRIM : 0;
    if (at) {
      const p = r.panner;
      if (p.positionX) { p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z; }
      else p.setPosition(at.x, at.y, at.z);
    }
    if (Math.abs(flatT - r.flatT) > 1e-4) { r.flatT = flatT; this.glide(r.flat.gain, flatT); }
    if (Math.abs(spatT - r.spatT) > 1e-4) { r.spatT = spatT; this.glide(r.spat.gain, spatT); }
  }

  /** move a gain smoothly (no clicks); right away when the context isn't running */
  private glide(p: AudioParam, v: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') { p.cancelScheduledValues(0); p.value = v; return; }
    p.cancelScheduledValues(ctx.currentTime);
    p.setTargetAtTime(v, ctx.currentTime, GLIDE);
  }

  private applyMaster() {
    if (this.master) this.glide(this.master.gain, DEV_SILENT ? 0 : sliderGain(this.volume));
  }

  /** the voices' mix → master volume → speakers (built once per context) */
  private output(ctx: Ctx): GainNode {
    if (this.mix) return this.mix;
    const mix = ctx.createGain();
    mix.channelCount = 2; mix.channelCountMode = 'explicit'; mix.channelInterpretation = 'speakers'; // flat mono → both ears
    const master = ctx.createGain();
    master.gain.value = DEV_SILENT ? 0 : sliderGain(this.volume);
    mix.connect(master).connect(ctx.destination);
    this.mix = mix;
    this.master = master;
    return mix;
  }

  // --- internals ---

  private audioCtx(): Ctx | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return this.ctx;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try { this.ctx = new AC(); } catch { return null; }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  /** test mic: 330 Hz tone gated on/off ~0.7 s (so "speaking" flips) */
  private fakeMic(ctx: Ctx): MediaStream {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 330;
    const gate = ctx.createGain();
    gate.gain.value = 0.15;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 0.7;
    const depth = ctx.createGain();
    depth.gain.value = 0.15;
    lfo.connect(depth).connect(gate.gain);
    const dest = ctx.createMediaStreamDestination();
    osc.connect(gate).connect(dest);
    osc.start();
    lfo.start();
    this.fake = { nodes: [osc, gate, lfo, depth, dest], srcs: [osc, lfo] };
    return dest.stream;
  }

  private play(el: HTMLAudioElement) {
    const p = el.play();
    if (p) p.catch(() => { this.pendingPlay.add(el); });
  }

  /** autoplay rules (Safari / iOS / Chrome): resume audio on the first user gesture */
  private hookGesture() {
    if (this.gestureHooked) return;
    this.gestureHooked = true;
    const unlock = () => {
      if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
      for (const el of [...this.pendingPlay]) {
        el.play().then(() => this.pendingPlay.delete(el), () => undefined);
      }
    };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, unlock, { capture: true, passive: true });
  }

  private startLoop() {
    if (this.loop) return;
    this.loop = window.setInterval(() => this.tick(), 100);
  }

  private rms(an: AnalyserNode): number {
    if (!this.buf || this.buf.length !== an.fftSize) this.buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    return Math.sqrt(s / this.buf.length);
  }

  private tick() {
    if (!this.enabled && !this.remotes.size) { clearInterval(this.loop); this.loop = 0; return; }
    const now = performance.now();
    // the level stopped sending 3D frames without saying so: flat again
    if (this.owner3d && now - this.last3d > FRAME3D_TIMEOUT) { this.owner3d = null; this.spots.clear(); this.applyPlaces(); }
    let changed = false;
    if (this.live && this.localAn && this.rms(this.localAn) > SPEAK_RMS) this.lastLoudMe = now;
    const me = this.live && now - this.lastLoudMe < HOLD_MS;
    if (me !== this.speaking) { this.speaking = me; changed = true; }
    for (const [id, r] of this.remotes) {
      if (r.analyser && !this.mutes.has(id) && this.rms(r.analyser) > SPEAK_RMS) r.lastLoud = now;
      const s = now - r.lastLoud < HOLD_MS && !this.mutes.has(id);
      if (s !== r.speaking) { r.speaking = s; changed = true; }
    }
    if (changed) this.emit();
  }

  private emit() { for (const f of [...this.subs]) { try { f(); } catch (e) { console.error('[voice]', e); } } }
}

// While developing (vite dev): never play voice audio (test pages use fake beeping microphones). WebAudio voices
// are silenced by the master gain (DEV_SILENT); this mutes the media elements (the no-WebAudio fallback).
// Add ?music=1 to the URL to hear it again.
if (DEV_SILENT) {
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) { this.muted = true; this.volume = 0; return play.call(this); };
  for (const el of Array.from(document.querySelectorAll('audio, video'))) { (el as HTMLMediaElement).muted = true; }
}
