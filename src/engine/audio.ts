/**
 * audio.ts — fully procedural audio for the game (Web Audio API only, no assets).
 *
 * Layout of this file:
 *   1. Public types
 *   2. Low-level synthesis helpers (shared noise buffer, pulse waves, tone/noise one-shots)
 *   3. Drum kit (used by music and some SFX)
 *   4. SFX table (one entry per SfxName)
 *   5. Music: instrument patches, track data (chords / MML melodies / pattern strings),
 *      compiler (track data -> per-16th-step event list) and the lookahead scheduler
 *   6. Engine state + exported `audio` API
 *
 * Signal chain:
 *   track players -> duck gain -> music volume --\
 *                                                 >-- master gain (× master volume) -> compressor -> destination
 *   sfx one-shots ----------------> sfx volume --/
 *
 * Volumes (music, sfx, master) are slider positions 0..1; sliderGain() maps them to gain with a loudness taper.
 *
 * Music notation used in the track data below:
 *   ch    : chord per bar, bars separated by '|'. Several chords in a bar split it evenly
 *           ("F G"). Slash chords ("C/G") set the bass note. '%' repeats the previous bar,
 *           'N' = no chord.
 *   lead  : MML-ish melody. Tokens "c5:4" = C5 for 4 sixteenths, "r:2" = rest. Lengths are
 *           sticky (omit ":n" to reuse the previous length). '|' is ignored (readability).
 *           Suffix '!' = accent, '?' = soft.
 *   bass  : one char per 16th step, cycled. 1 root(/slash bass) 3 third 5 fifth 7 seventh
 *           8 octave 0 fifth-below 2 4 6 scale steps, b b7, m b6, f b5, u b2, n root-1,
 *           a = chromatic approach to the next chord, '-' hold, '.' rest.
 *   arp   : a..h index chord tones upward from the track's arp floor, '-' hold, '.' rest.
 *   pad   : 'x' = play the whole chord, '-' hold.
 *   k/s/h/x : kick / snare / hat / percussion lines (see DRUM_MAP), cycled per step.
 *   fill  : replacement drum lines for the final bar of the section. cr = crash on bar 1.
 *   Undefined bass/arp/pad/drum lines inherit from the previous section ('' = silence).
 */

// ════════════════════════════════════════════════════════════════════════
// 1. Public types
// ════════════════════════════════════════════════════════════════════════

export type SfxName =
  | 'jump' | 'doubleJump' | 'land' | 'swing' | 'swingHeavy' | 'hit' | 'enemyDie' | 'hurt'
  | 'coin' | 'heal' | 'shoot' | 'dash' | 'slam' | 'bigSlam' | 'roar' | 'grab' | 'break'
  | 'checkpoint' | 'artifact' | 'menuMove' | 'menuSelect' | 'pause' | 'textBlip' | 'splash'
  | 'bounce' | 'crumble' | 'throw' | 'reflect' | 'victory' | 'door' | 'whoosh' | 'thud'
  | 'buy' | 'denied' | 'bossHit' | 'snore' | 'chomp' | 'fall' | 'pogo' | 'warn'
  | 'clang' | 'boom' | 'alert' | 'fuse' | 'nut'
  // «Ночь клыков» (arc/vampires)
  | 'batFlap' | 'batScreech' | 'bite' | 'colorRestore' | 'mist' | 'hiss' | 'lanternOn' | 'snuff' | 'drain';

export type MusicName =
  | 'menu' | 'forest' | 'pantry' | 'feast' | 'library' | 'chase' | 'boss' | 'boss2'
  | 'ending' | 'den' | 'tension' | 'credits'
  // «Хрумляндия»: the candy town by day, the vampire arc
  | 'hub_day' | 'night_town' | 'swamp' | 'garden' | 'pass' | 'castle' | 'vampire_boss';

export interface AudioApi {
  /** Safe to call many times. Creates/resumes the AudioContext. Called on first user gesture (keydown/pointerdown). */
  init(): void;
  /** Fire-and-forget sound effect. pitch is a multiplier (1 = normal). volume 0..1 multiplier. pan −1 (left) … 1 (right)
   *  places it in the stereo field (positional sounds: a whisper behind the hero). Must never throw. */
  sfx(name: SfxName, opts?: { volume?: number; pitch?: number; pan?: number }): void;
  /** Start a looping procedural music track; crossfade (~0.8s) from current. Same track = no-op. Remembered if called before init(). */
  playMusic(name: MusicName): void;
  /** Fade out and stop current music. */
  stopMusic(fadeSec?: number): void;
  /** slider position 0..1 (perceptual, see sliderGain), applied immediately and smoothly */
  setMusicVolume(v: number): void;
  setSfxVolume(v: number): void;
  /** slider position 0..1 for everything (music + sounds) */
  setMasterVolume(v: number): void;
  getMusicVolume(): number;
  getSfxVolume(): number;
  getMasterVolume(): number;
  /** Optional ducking used during dialogs: multiplies music gain (0..1) smoothly */
  duckMusic(amount: number): void;
  /** Current playing track name or null */
  currentMusic(): MusicName | null;
}

// ════════════════════════════════════════════════════════════════════════
// 2. Synthesis helpers
// ════════════════════════════════════════════════════════════════════════

type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'pulse25' | 'pulse12';
type Ctx = BaseAudioContext;

const EPS = 0.0001;
const LOOKAHEAD = 0.12;
const LOOKAHEAD_HIDDEN = 1.2; // background tabs throttle timers to ~1s
const TICK_MS = 25;
const CROSSFADE = 0.8;
const MAX_SFX_VOICES = 32;
const MASTER_GAIN = 0.9;
const MUSIC_TAIL = 4; // seconds a faded player is kept alive for release/echo tails
const MAX_FADING = 2; // fading players kept during rapid track switching

let noiseBuf: AudioBuffer | null = null;
let pulse25: PeriodicWave | null = null;
let pulse12: PeriodicWave | null = null;

const mod12 = (x: number): number => ((x % 12) + 12) % 12;
const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && isFinite(v) ? v : d);
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/** Band-limited pulse wave with the given duty cycle (Fourier series). */
function makePulse(c: Ctx, duty: number): PeriodicWave {
  const n = 48;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    re[k] = Math.sin(2 * Math.PI * k * duty) / (k * Math.PI);
    const s = Math.sin(Math.PI * k * duty);
    im[k] = (2 * s * s) / (k * Math.PI);
  }
  return c.createPeriodicWave(re, im);
}

/** Creates the shared noise buffer and pulse waves for a context. */
function setupShared(c: Ctx): void {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    const len = Math.floor(c.sampleRate * 2);
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = b;
  }
  pulse25 = makePulse(c, 0.25);
  pulse12 = makePulse(c, 0.125);
}

function mkOsc(c: Ctx, w: Wave): OscillatorNode {
  const o = c.createOscillator();
  if (w === 'pulse25' || w === 'pulse12') {
    const pw = w === 'pulse25' ? pulse25 : pulse12;
    if (pw) o.setPeriodicWave(pw);
    else o.type = 'square';
  } else {
    o.type = w;
  }
  return o;
}

/** Disconnect every node of a voice once its source has finished. */
function cleanup(src: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  src.onended = () => {
    for (const n of nodes) {
      try { n.disconnect(); } catch { /* already disconnected */ }
    }
  };
}

/** Standard one-shot envelope: 0 -> vol (attack) -> hold -> exponential decay to silence at t+dur. */
function envelope(g: AudioParam, t: number, dur: number, vol: number, a0: number | undefined, hold0: number | undefined): void {
  const a = Math.min(a0 ?? 0.004, dur * 0.5);
  const hold = Math.max(0, Math.min(hold0 ?? 0, dur - a - 0.005));
  // intrinsic value must be 0 too: a GainNode defaults to 1 before its first event, which
  // otherwise lets the source's first (sub-sample) frame through at full level as a spike
  g.value = 0;
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(vol, t + a);
  if (hold > 0) g.setValueAtTime(vol, t + a + hold);
  g.exponentialRampToValueAtTime(EPS, t + dur);
}

interface ToneX {
  a?: number;                       // attack seconds
  hold?: number;                    // time held at peak before the decay
  lin?: boolean;                    // linear pitch slide (default exponential)
  pts?: Array<[number, number]>;    // pitch breakpoints [offset s, Hz] (exp ramps) — overrides f2
  ft?: BiquadFilterType;            // filter type (default lowpass when ff is set)
  ff?: number;                      // filter start frequency
  ff2?: number;                     // filter end frequency
  q?: number;
  vib?: number;                     // vibrato depth in Hz
  vibHz?: number;
  vibDecay?: boolean;               // vibrato depth fades out over the note
  am?: number;                      // amplitude flutter depth 0..1
  amHz?: number;
  det?: number;                     // detune cents
}

/** One-shot oscillator voice with pitch slide, optional filter, vibrato and flutter. */
function tone(c: Ctx, out: AudioNode, w: Wave, t: number, dur: number, f: number, f2: number | null, vol: number, x: ToneX = {}): void {
  const end = t + dur;
  const o = mkOsc(c, w);
  const nodes: AudioNode[] = [o];
  const fr = o.frequency;
  fr.value = Math.max(1, f);
  fr.setValueAtTime(Math.max(1, f), t);
  if (x.pts) {
    for (const [dt, hz] of x.pts) fr.exponentialRampToValueAtTime(Math.max(1, hz), t + Math.min(dt, dur));
  } else if (f2 !== null) {
    if (x.lin) fr.linearRampToValueAtTime(Math.max(1, f2), end);
    else fr.exponentialRampToValueAtTime(Math.max(1, f2), end);
  }
  if (x.det) o.detune.value = x.det;
  let head: AudioNode = o;
  if (x.ff) {
    const fl = c.createBiquadFilter();
    fl.type = x.ft ?? 'lowpass';
    fl.Q.value = x.q ?? 0.7;
    fl.frequency.value = x.ff;
    fl.frequency.setValueAtTime(x.ff, t);
    if (x.ff2) fl.frequency.exponentialRampToValueAtTime(Math.max(10, x.ff2), end);
    head.connect(fl);
    head = fl;
    nodes.push(fl);
  }
  if (x.am) {
    const amg = c.createGain();
    amg.gain.value = 1 - x.am;
    const l = c.createOscillator();
    l.frequency.value = x.amHz ?? 20;
    const lg = c.createGain();
    lg.gain.value = x.am;
    l.connect(lg);
    lg.connect(amg.gain);
    l.start(t);
    l.stop(end + 0.05);
    head.connect(amg);
    head = amg;
    nodes.push(amg, l, lg);
  }
  if (x.vib) {
    const l = c.createOscillator();
    l.frequency.value = x.vibHz ?? 6;
    const lg = c.createGain();
    lg.gain.setValueAtTime(x.vib, t);
    if (x.vibDecay) lg.gain.exponentialRampToValueAtTime(Math.max(0.01, x.vib * 0.05), end);
    l.connect(lg);
    lg.connect(fr);
    l.start(t);
    l.stop(end + 0.05);
    nodes.push(l, lg);
  }
  const g = c.createGain();
  envelope(g.gain, t, dur, vol, x.a, x.hold);
  head.connect(g);
  g.connect(out);
  nodes.push(g);
  o.start(t);
  o.stop(end + 0.03);
  cleanup(o, nodes);
}

interface NoiseX {
  a?: number;
  hold?: number;
  q?: number;
  pts?: Array<[number, number]>; // filter frequency breakpoints [offset s, Hz]
}

/** Filtered white-noise burst using the shared noise buffer. */
function noise(c: Ctx, out: AudioNode, t: number, dur: number, vol: number, ft: BiquadFilterType, f: number, f2: number | null, x: NoiseX = {}): void {
  if (!noiseBuf) return;
  const end = t + dur;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const fl = c.createBiquadFilter();
  fl.type = ft;
  fl.Q.value = x.q ?? (ft === 'bandpass' ? 1 : 0.7);
  fl.frequency.value = Math.max(10, f);
  fl.frequency.setValueAtTime(Math.max(10, f), t);
  if (x.pts) {
    for (const [dt, hz] of x.pts) fl.frequency.exponentialRampToValueAtTime(Math.max(10, hz), t + Math.min(dt, dur));
  } else if (f2 !== null) {
    fl.frequency.exponentialRampToValueAtTime(Math.max(10, f2), end);
  }
  const g = c.createGain();
  envelope(g.gain, t, dur, vol, x.a, x.hold);
  s.connect(fl);
  fl.connect(g);
  g.connect(out);
  s.start(t, Math.random() * 1.5);
  s.stop(end + 0.02);
  cleanup(s, [s, fl, g]);
}

// ════════════════════════════════════════════════════════════════════════
// 3. Drum kit
// ════════════════════════════════════════════════════════════════════════

type DrumKind =
  | 'kick' | 'snare' | 'hat' | 'ohat' | 'clap' | 'block' | 'blockHi' | 'shaker'
  | 'tom' | 'tomHi' | 'crash' | 'heart';

function drum(c: Ctx, k: DrumKind, t: number, v: number, out: AudioNode): void {
  switch (k) {
    case 'kick':
      tone(c, out, 'sine', t, 0.3, 150, null, 0.62 * v, { a: 0.002, pts: [[0.08, 50], [0.3, 40]] });
      noise(c, out, t, 0.012, 0.08 * v, 'highpass', 3000, null, { a: 0.001 });
      break;
    case 'snare':
      noise(c, out, t, 0.16, 0.26 * v, 'highpass', 1400, null, { a: 0.001 });
      tone(c, out, 'triangle', t, 0.09, 210, 150, 0.24 * v, { a: 0.001 });
      break;
    case 'hat':
      noise(c, out, t, 0.04, 0.11 * v, 'highpass', 7500, null, { a: 0.001 });
      break;
    case 'ohat':
      noise(c, out, t, 0.25, 0.08 * v, 'highpass', 6500, null, { a: 0.002, hold: 0.04 });
      break;
    case 'clap':
      for (let i = 0; i < 3; i++) noise(c, out, t + i * 0.011, 0.02, 0.2 * v, 'bandpass', 1300, null, { a: 0.001, q: 1.4 });
      noise(c, out, t + 0.03, 0.14, 0.18 * v, 'bandpass', 1200, null, { a: 0.002, q: 1.2 });
      break;
    case 'block':
      tone(c, out, 'sine', t, 0.06, 880, 840, 0.24 * v, { a: 0.001 });
      tone(c, out, 'triangle', t, 0.03, 1760, null, 0.05 * v, { a: 0.001 });
      break;
    case 'blockHi':
      tone(c, out, 'sine', t, 0.05, 1320, 1280, 0.18 * v, { a: 0.001 });
      break;
    case 'shaker':
      noise(c, out, t, 0.07, 0.08 * v, 'bandpass', 6500, null, { a: 0.02, q: 1.2 });
      break;
    case 'tom':
      tone(c, out, 'sine', t, 0.25, 150, 85, 0.45 * v, { a: 0.002 });
      break;
    case 'tomHi':
      tone(c, out, 'sine', t, 0.2, 220, 140, 0.4 * v, { a: 0.002 });
      break;
    case 'crash':
      noise(c, out, t, 1.3, 0.11 * v, 'highpass', 4500, null, { a: 0.002 });
      noise(c, out, t, 0.6, 0.06 * v, 'bandpass', 3000, null, { a: 0.002, q: 0.8 });
      break;
    case 'heart':
      tone(c, out, 'sine', t, 0.2, 80, 45, 0.55 * v, { a: 0.006 });
      tone(c, out, 'triangle', t, 0.08, 160, 80, 0.16 * v, { a: 0.004, ff: 600 });
      break;
  }
}

// ════════════════════════════════════════════════════════════════════════
// 4. Sound effects
// ════════════════════════════════════════════════════════════════════════

type SfxFn = (c: Ctx, o: AudioNode, t: number, p: number, v: number) => void;
interface SfxDef {
  dur: number;     // approximate length, used for voice accounting
  gap?: number;    // minimum seconds between two triggers of this sfx
  pri?: boolean;   // bypasses the voice limit
  fn: SfxFn;
}

const SFX: Record<SfxName, SfxDef> = {
  jump: {
    dur: 0.16,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'pulse25', t, 0.15, 260 * p, 560 * p, 0.2 * v, { ff: 3500 });
      tone(c, o, 'triangle', t, 0.12, 520 * p, 1100 * p, 0.12 * v);
    },
  },
  doubleJump: {
    dur: 0.25,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'pulse25', t, 0.08, 500 * p, 900 * p, 0.15 * v, { ff: 5000 });
      tone(c, o, 'pulse25', t + 0.06, 0.11, 750 * p, 1500 * p, 0.15 * v, { ff: 6000 });
      tone(c, o, 'sine', t + 0.05, 0.2, 2400 * p, 3200 * p, 0.07 * v);
      tone(c, o, 'sine', t + 0.1, 0.18, 3000 * p, 3800 * p, 0.05 * v);
    },
  },
  land: {
    dur: 0.12,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'sine', t, 0.11, 150 * p, 50 * p, 0.42 * v, { a: 0.002 });
      noise(c, o, t, 0.07, 0.2 * v, 'lowpass', 900 * p, 200 * p, { a: 0.002 });
    },
  },
  swing: {
    dur: 0.18,
    fn: (c, o, t, p, v) => {
      noise(c, o, t, 0.17, 0.5 * v, 'bandpass', 700 * p, 3200 * p, { a: 0.04, q: 1.6 });
    },
  },
  swingHeavy: {
    dur: 0.32,
    fn: (c, o, t, p, v) => {
      noise(c, o, t, 0.3, 0.44 * v, 'bandpass', 300 * p, 1500 * p, { a: 0.07, q: 1.3 });
      tone(c, o, 'sine', t + 0.02, 0.22, 110 * p, 70 * p, 0.14 * v, { a: 0.05 });
    },
  },
  hit: {
    dur: 0.14,
    gap: 0.03,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'sine', t, 0.12, 240 * p, 60 * p, 0.5 * v, { a: 0.002 });
      noise(c, o, t, 0.09, 0.32 * v, 'lowpass', 3000 * p, 500 * p, { a: 0.001 });
      // wet squelch: resonant filtered square diving down
      tone(c, o, 'square', t, 0.09, 700 * p, 140 * p, 0.12 * v, { a: 0.002, ff: 1600 * p, q: 9 });
    },
  },
  enemyDie: {
    dur: 0.3,
    fn: (c, o, t, p, v) => {
      noise(c, o, t, 0.06, 0.32 * v, 'bandpass', 1400 * p, 600 * p, { q: 1.2, a: 0.001 });
      tone(c, o, 'sine', t, 0.08, 500 * p, 1400 * p, 0.32 * v, { a: 0.002 });
      tone(c, o, 'triangle', t + 0.07, 0.2, 1600 * p, 600 * p, 0.18 * v, { a: 0.004 });
      tone(c, o, 'pulse12', t + 0.1, 0.16, 1300 * p, 500 * p, 0.06 * v, { a: 0.004 });
    },
  },
  hurt: {
    dur: 0.36,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'square', t, 0.34, 560 * p, 170 * p, 0.18 * v, { a: 0.004, hold: 0.05, ff: 1800, vib: 22 * p, vibHz: 16 });
      tone(c, o, 'sine', t, 0.12, 180 * p, 70 * p, 0.32 * v);
    },
  },
  coin: {
    dur: 0.32,
    gap: 0.03,
    fn: (c, o, t, p, v) => {
      const r = p * rnd(0.97, 1.03);
      tone(c, o, 'pulse25', t, 0.07, 988 * r, null, 0.13 * v, { a: 0.002, hold: 0.04 });
      tone(c, o, 'pulse25', t + 0.065, 0.28, 1319 * r, null, 0.13 * v, { a: 0.002, hold: 0.03 });
      tone(c, o, 'sine', t + 0.065, 0.3, 2638 * r, null, 0.05 * v);
    },
  },
  heal: {
    dur: 0.6,
    fn: (c, o, t, p, v) => {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        tone(c, o, 'triangle', t + i * 0.065, 0.34, f * p, null, 0.2 * v, { a: 0.006 });
        tone(c, o, 'sine', t + i * 0.065, 0.3, f * 2 * p, null, 0.05 * v, { a: 0.006 });
      });
    },
  },
  shoot: {
    dur: 0.12,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'triangle', t, 0.09, 220 * p, 1500 * p, 0.3 * v, { a: 0.002 });
      tone(c, o, 'square', t, 0.07, 300 * p, 1200 * p, 0.06 * v, { a: 0.002, ff: 2500 });
      noise(c, o, t, 0.06, 0.12 * v, 'bandpass', 2500 * p, 6000 * p, { q: 2 });
    },
  },
  dash: {
    dur: 0.24,
    fn: (c, o, t, p, v) => {
      noise(c, o, t, 0.22, 0.34 * v, 'bandpass', 1000 * p, 5000 * p, { a: 0.02, q: 1 });
      tone(c, o, 'sine', t, 0.15, 300 * p, 700 * p, 0.08 * v);
    },
  },
  slam: {
    dur: 0.46,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'sine', t, 0.4, 130 * p, 34 * p, 0.6 * v, { a: 0.003 });
      noise(c, o, t, 0.45, 0.36 * v, 'lowpass', 1400 * p, 120 * p, { a: 0.003 });
      tone(c, o, 'triangle', t, 0.15, 90 * p, 40 * p, 0.28 * v);
    },
  },
  bigSlam: {
    dur: 1.3,
    pri: true,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'sine', t, 0.8, 95 * p, 24 * p, 0.6 * v, { a: 0.004 });
      tone(c, o, 'triangle', t, 0.6, 60 * p, 28 * p, 0.3 * v, { a: 0.004 });
      noise(c, o, t, 0.5, 0.38 * v, 'lowpass', 1800 * p, 150 * p, { a: 0.002 });
      noise(c, o, t + 0.05, 1.2, 0.3 * v, 'lowpass', 260 * p, 80 * p, { a: 0.06, hold: 0.2 });
      for (let i = 0; i < 5; i++) {
        noise(c, o, t + 0.15 + Math.random() * 0.6, 0.05, 0.08 * v, 'bandpass', rnd(1200, 3200) * p, null, { q: 2 });
      }
    },
  },
  roar: {
    dur: 1.3,
    pri: true,
    fn: (c, o, t, p, v) => {
      const d = 1.25;
      const fl = c.createBiquadFilter();
      fl.type = 'lowpass';
      fl.Q.value = 5;
      fl.frequency.setValueAtTime(350 * p, t);
      fl.frequency.linearRampToValueAtTime(1100 * p, t + 0.25);
      fl.frequency.linearRampToValueAtTime(450 * p, t + d);
      // growl LFO wobbles both the filter and the amplitude
      const lfo = c.createOscillator();
      lfo.type = 'triangle';
      lfo.frequency.setValueAtTime(22, t);
      lfo.frequency.linearRampToValueAtTime(15, t + d);
      const lg = c.createGain();
      lg.gain.value = 320 * p;
      lfo.connect(lg);
      lg.connect(fl.frequency);
      const am = c.createGain();
      am.gain.value = 0.7;
      const lg2 = c.createGain();
      lg2.gain.value = 0.3;
      lfo.connect(lg2);
      lg2.connect(am.gain);
      const g = c.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.3 * v, t + 0.12);
      g.gain.setValueAtTime(0.3 * v, t + 0.75);
      g.gain.exponentialRampToValueAtTime(EPS, t + d);
      fl.connect(am);
      am.connect(g);
      g.connect(o);
      const nodes: AudioNode[] = [fl, lfo, lg, lg2, am, g];
      let last: OscillatorNode | null = null;
      for (const base of [65, 68.5, 98, 131]) {
        const os = c.createOscillator();
        os.type = 'sawtooth';
        const f = base * p;
        os.frequency.setValueAtTime(f * 0.8, t);
        os.frequency.exponentialRampToValueAtTime(f * 1.12, t + 0.3);
        os.frequency.exponentialRampToValueAtTime(f * 0.72, t + d);
        os.connect(fl);
        os.start(t);
        os.stop(t + d + 0.05);
        nodes.push(os);
        last = os;
      }
      lfo.start(t);
      lfo.stop(t + d + 0.05);
      if (last) cleanup(last, nodes);
      noise(c, o, t, d, 0.16 * v, 'bandpass', 600 * p, 300 * p, { a: 0.1, hold: 0.55, q: 1.2 });
      tone(c, o, 'sine', t, d, 45 * p, 35 * p, 0.22 * v, { a: 0.1, hold: 0.6 });
    },
  },
  grab: {
    dur: 0.3,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'sawtooth', t, 0.26, 160 * p, 650 * p, 0.2 * v, { a: 0.02, lin: true, ff: 500 * p, ff2: 2600 * p, q: 10, vib: 30 * p, vibHz: 25 });
      tone(c, o, 'sine', t + 0.17, 0.09, 400 * p, 950 * p, 0.14 * v, { a: 0.005 });
    },
  },
  break: {
    dur: 0.3,
    fn: (c, o, t, p, v) => {
      noise(c, o, t, 0.18, 0.42 * v, 'bandpass', 1800 * p, 700 * p, { q: 0.8, a: 0.001 });
      tone(c, o, 'square', t, 0.09, 200 * p, 55 * p, 0.18 * v, { ff: 1200 });
      for (let i = 0; i < 4; i++) {
        noise(c, o, t + 0.02 + i * 0.035 + Math.random() * 0.02, 0.03, 0.2 * v, 'highpass', rnd(2500, 5000) * p, null);
      }
    },
  },
  checkpoint: {
    dur: 1.2,
    pri: true,
    fn: (c, o, t, p, v) => {
      [784, 1175, 1568, 1976].forEach((f, i) => {
        tone(c, o, 'sine', t + i * 0.08, 0.9, f * p, null, 0.12 * v, { a: 0.004 });
        tone(c, o, 'sine', t + i * 0.08, 0.9, f * p, null, 0.05 * v, { a: 0.004, det: 9 });
      });
      tone(c, o, 'triangle', t, 0.6, 392 * p, null, 0.08 * v, { a: 0.01 });
    },
  },
  artifact: {
    dur: 1.25,
    pri: true,
    fn: (c, o, t, p, v) => {
      [523.25, 659.25, 783.99].forEach((f, i) => {
        tone(c, o, 'pulse25', t + i * 0.09, 0.12, f * p, null, 0.16 * v, { a: 0.004, hold: 0.05, ff: 4000 });
      });
      tone(c, o, 'pulse25', t + 0.28, 0.95, 1046.5 * p, null, 0.17 * v, { a: 0.01, hold: 0.5, ff: 4500, vib: 12 * p, vibHz: 6 });
      tone(c, o, 'triangle', t + 0.28, 0.9, 659.25 * p, null, 0.13 * v, { a: 0.01, hold: 0.5 });
      tone(c, o, 'triangle', t + 0.28, 0.9, 783.99 * p, null, 0.11 * v, { a: 0.01, hold: 0.5 });
      tone(c, o, 'triangle', t + 0.28, 0.9, 261.63 * p, null, 0.24 * v, { a: 0.01, hold: 0.45 });
      for (let i = 0; i < 5; i++) {
        tone(c, o, 'sine', t + 0.35 + i * 0.1, 0.25, (2093 + i * 300) * p, null, 0.04 * v, { a: 0.003 });
      }
      noise(c, o, t + 0.28, 0.6, 0.05 * v, 'highpass', 8000, null, { a: 0.05 });
    },
  },
  menuMove: {
    dur: 0.04,
    gap: 0.02,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'square', t, 0.03, 1400 * p, 1200 * p, 0.09 * v, { a: 0.001 });
    },
  },
  menuSelect: {
    dur: 0.2,
    pri: true,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'pulse25', t, 0.06, 660 * p, null, 0.15 * v, { hold: 0.03 });
      tone(c, o, 'pulse25', t + 0.06, 0.12, 990 * p, null, 0.15 * v, { hold: 0.04 });
    },
  },
  pause: {
    dur: 0.22,
    pri: true,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'square', t, 0.08, 988 * p, null, 0.11 * v, { hold: 0.05, ff: 4000 });
      tone(c, o, 'square', t + 0.09, 0.12, 659 * p, null, 0.11 * v, { hold: 0.06, ff: 4000 });
    },
  },
  textBlip: {
    dur: 0.04,
    gap: 0.025,
    fn: (c, o, t, p, v) => {
      // cheapest possible: one oscillator + one gain
      const r = p * rnd(0.96, 1.04);
      tone(c, o, 'pulse25', t, 0.035, 420 * r, 380 * r, 0.075 * v, { a: 0.003 });
    },
  },
  splash: {
    dur: 0.46,
    fn: (c, o, t, p, v) => {
      noise(c, o, t, 0.45, 0.36 * v, 'lowpass', 5000 * p, 600 * p, { a: 0.005 });
      noise(c, o, t, 0.2, 0.18 * v, 'highpass', 2500 * p, null, { a: 0.002 });
      for (let i = 0; i < 3; i++) {
        const tt = t + 0.03 + Math.random() * 0.2;
        tone(c, o, 'sine', tt, 0.06, rnd(500, 1000) * p, rnd(1200, 2000) * p, 0.08 * v);
      }
    },
  },
  bounce: {
    dur: 0.42,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'sine', t, 0.42, 140 * p, null, 0.34 * v, { a: 0.003, pts: [[0.07, 520 * p], [0.42, 420 * p]], vib: 60 * p, vibHz: 14, vibDecay: true });
      tone(c, o, 'triangle', t, 0.3, 280 * p, null, 0.09 * v, { a: 0.003, pts: [[0.07, 1040 * p], [0.3, 840 * p]], vib: 120 * p, vibHz: 14, vibDecay: true });
    },
  },
  crumble: {
    dur: 0.5,
    fn: (c, o, t, p, v) => {
      noise(c, o, t, 0.45, 0.24 * v, 'lowpass', 900 * p, 200 * p, { a: 0.01 });
      for (let i = 0; i < 10; i++) {
        noise(c, o, t + Math.random() * 0.4, rnd(0.025, 0.055), rnd(0.15, 0.3) * v, 'bandpass', rnd(700, 3300) * p, null, { q: 3 });
      }
    },
  },
  throw: {
    dur: 0.18,
    fn: (c, o, t, p, v) => {
      noise(c, o, t, 0.16, 0.4 * v, 'bandpass', 500 * p, 2600 * p, { a: 0.03, q: 1.4 });
      tone(c, o, 'triangle', t, 0.1, 260 * p, 620 * p, 0.1 * v);
    },
  },
  reflect: {
    dur: 0.5,
    fn: (c, o, t, p, v) => {
      [1, 2.76, 5.4, 8.93].forEach((r, i) => {
        tone(c, o, 'sine', t, 0.5 / (1 + i * 0.6), 1300 * p * r, null, (0.15 / (1 + i)) * v, { a: 0.001 });
      });
      tone(c, o, 'square', t, 0.02, 3000 * p, null, 0.05 * v, { a: 0.001 });
    },
  },
  victory: {
    dur: 2.5,
    pri: true,
    fn: (c, o, t, p, v) => {
      const lead: Array<[number, number, number]> = [
        [0, 392, 0.12], [0.12, 523.25, 0.12], [0.24, 659.25, 0.12], [0.36, 783.99, 0.22],
        [0.6, 659.25, 0.12], [0.72, 783.99, 0.55], [1.32, 880, 0.12], [1.44, 987.77, 0.12], [1.56, 1046.5, 0.9],
      ];
      for (const [dt, f, d] of lead) {
        const last = dt > 1.5;
        tone(c, o, 'pulse25', t + dt, d + 0.05, f * p, null, 0.14 * v, { a: 0.006, hold: d * 0.7, ff: 4500, vib: last ? 10 * p : 0, vibHz: 6 });
      }
      const harm: Array<[number, number, number]> = [[0.72, 523.25, 0.55], [0.72, 659.25, 0.55], [1.56, 659.25, 0.9], [1.56, 783.99, 0.9]];
      for (const [dt, f, d] of harm) tone(c, o, 'triangle', t + dt, d + 0.1, f * p, null, 0.1 * v, { a: 0.01, hold: d * 0.6 });
      const bass: Array<[number, number, number]> = [[0, 130.81, 0.3], [0.36, 98, 0.3], [0.72, 130.81, 0.55], [1.32, 98, 0.22], [1.56, 130.81, 0.9]];
      for (const [dt, f, d] of bass) tone(c, o, 'triangle', t + dt, d + 0.05, f * p, null, 0.28 * v, { a: 0.005, hold: d * 0.6 });
      drum(c, 'kick', t, 0.6 * v, o);
      drum(c, 'kick', t + 0.36, 0.5 * v, o);
      drum(c, 'kick', t + 0.72, 0.6 * v, o);
      for (let i = 0; i < 4; i++) drum(c, 'snare', t + 1.32 + i * 0.06, (0.25 + i * 0.08) * v, o);
      drum(c, 'kick', t + 1.56, 0.7 * v, o);
      drum(c, 'crash', t + 1.56, 0.8 * v, o);
      tone(c, o, 'sine', t + 1.56, 0.95, 2093 * p, null, 0.04 * v, { a: 0.05, hold: 0.5, vib: 8, vibHz: 6 });
    },
  },
  door: {
    dur: 0.65,
    fn: (c, o, t, p, v) => {
      // creak: very low buzzy saw through narrow resonant bandpasses
      const creak: Array<[number, number]> = [[0.2, 58 * p], [0.45, 40 * p]];
      tone(c, o, 'sawtooth', t, 0.46, 42 * p, null, 0.7 * v, { a: 0.03, hold: 0.3, pts: creak, ft: 'bandpass', ff: 1100 * p, q: 9 });
      tone(c, o, 'sawtooth', t, 0.46, 42 * p, null, 0.4 * v, { a: 0.03, hold: 0.3, pts: creak, ft: 'bandpass', ff: 2300 * p, q: 12 });
      // thunk
      tone(c, o, 'sine', t + 0.42, 0.18, 130 * p, 60 * p, 0.5 * v, { a: 0.002 });
      noise(c, o, t + 0.42, 0.1, 0.28 * v, 'lowpass', 700 * p, 200 * p);
      tone(c, o, 'triangle', t + 0.42, 0.08, 320 * p, 200 * p, 0.14 * v);
    },
  },
  whoosh: {
    dur: 0.6,
    fn: (c, o, t, p, v) => {
      noise(c, o, t, 0.6, 0.34 * v, 'bandpass', 250 * p, null, { a: 0.28, q: 1.2, pts: [[0.3, 2400 * p], [0.6, 500 * p]] });
    },
  },
  thud: {
    dur: 0.3,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'sine', t, 0.3, 95 * p, 38 * p, 0.65 * v, { a: 0.002 });
      noise(c, o, t, 0.14, 0.32 * v, 'lowpass', 500 * p, 120 * p, { a: 0.002 });
    },
  },
  buy: {
    dur: 0.65,
    pri: true,
    fn: (c, o, t, p, v) => {
      // "ka"
      noise(c, o, t, 0.05, 0.28 * v, 'highpass', 2500 * p, null, { a: 0.001 });
      tone(c, o, 'square', t, 0.04, 180 * p, 90 * p, 0.1 * v);
      // "ching"
      [2093, 2637, 3136, 4186].forEach((f, i) => {
        tone(c, o, 'sine', t + 0.07, 0.6 - i * 0.08, f * p, null, (0.11 - i * 0.02) * v, { a: 0.002 });
      });
      tone(c, o, 'pulse25', t + 0.07, 0.12, 1568 * p, null, 0.07 * v, { a: 0.002 });
      tone(c, o, 'pulse25', t + 0.15, 0.4, 2093 * p, null, 0.07 * v, { a: 0.002, hold: 0.05 });
    },
  },
  denied: {
    dur: 0.3,
    pri: true,
    fn: (c, o, t, p, v) => {
      for (let i = 0; i < 2; i++) {
        tone(c, o, 'square', t + i * 0.13, 0.1, 110 * p, null, 0.15 * v, { a: 0.003, hold: 0.07, ff: 1400 });
        tone(c, o, 'sawtooth', t + i * 0.13, 0.1, 116.5 * p, null, 0.11 * v, { a: 0.003, hold: 0.07, ff: 1400 });
      }
    },
  },
  bossHit: {
    dur: 0.3,
    gap: 0.03,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'sine', t, 0.24, 170 * p, 38 * p, 0.62 * v, { a: 0.002 });
      noise(c, o, t, 0.2, 0.4 * v, 'lowpass', 3500 * p, 300 * p, { a: 0.001 });
      tone(c, o, 'square', t, 0.12, 500 * p, 110 * p, 0.13 * v, { ff: 1500 * p, q: 8 });
      tone(c, o, 'sine', t, 0.25, 720 * p, null, 0.07 * v);
      tone(c, o, 'sine', t, 0.2, 1130 * p, null, 0.05 * v);
    },
  },
  snore: {
    dur: 1.6,
    fn: (c, o, t, p, v) => {
      // inhale: rising whistly noise
      noise(c, o, t, 0.8, 0.2 * v, 'bandpass', 350 * p, 1200 * p, { a: 0.45, q: 3.5, hold: 0.1 });
      // exhale: fluttering low rumble
      tone(c, o, 'sawtooth', t + 0.78, 0.8, 66 * p, 48 * p, 0.34 * v, { a: 0.06, hold: 0.35, ff: 420 * p, q: 2, am: 0.55, amHz: 24 });
      noise(c, o, t + 0.78, 0.75, 0.1 * v, 'lowpass', 600 * p, 200 * p, { a: 0.05, hold: 0.3 });
    },
  },
  chomp: {
    dur: 0.22,
    fn: (c, o, t, p, v) => {
      const bite = (tt: number, s: number): void => {
        noise(c, o, tt, 0.07, 0.38 * v * s, 'bandpass', 1500 * p, 700 * p, { q: 1.2, a: 0.002 });
        tone(c, o, 'sine', tt, 0.07, 260 * p, 90 * p, 0.38 * v * s, { a: 0.002 });
        tone(c, o, 'square', tt, 0.03, 140 * p, 70 * p, 0.07 * v * s, { ff: 900 });
      };
      bite(t, 1);
      bite(t + 0.11, 0.6);
    },
  },
  fall: {
    dur: 1.25,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'sine', t, 1.2, 1500 * p, 240 * p, 0.22 * v, { a: 0.04, hold: 0.9, vib: 18 * p, vibHz: 6 });
      tone(c, o, 'triangle', t, 1.2, 1500 * p, 240 * p, 0.05 * v, { a: 0.04, hold: 0.9 });
    },
  },
  pogo: {
    dur: 0.2,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'triangle', t, 0.2, 250 * p, null, 0.3 * v, { pts: [[0.05, 750 * p], [0.2, 520 * p]], vib: 50 * p, vibHz: 22, vibDecay: true });
      tone(c, o, 'sine', t, 0.12, 500 * p, 1100 * p, 0.1 * v);
    },
  },
  warn: {
    dur: 0.26,
    pri: true,
    fn: (c, o, t, p, v) => {
      [1046, 784, 1046].forEach((f, i) => {
        tone(c, o, 'square', t + i * 0.085, 0.075, f * p, null, 0.11 * v, { a: 0.003, hold: 0.05, ff: 3500 });
      });
    },
  },
  /** sword on a pot-lid shield */
  clang: {
    dur: 0.6,
    gap: 0.05,
    fn: (c, o, t, p, v) => {
      [1, 2.32, 3.87, 5.6].forEach((r, i) => {
        tone(c, o, 'sine', t, 0.55 / (1 + i * 0.5), 620 * p * r, 600 * p * r, (0.16 / (1 + i * 0.7)) * v, { a: 0.001 });
      });
      noise(c, o, t, 0.05, 0.25 * v, 'highpass', 3000 * p, null, { a: 0.001 });
    },
  },
  /** cherry bomb */
  boom: {
    dur: 0.9,
    pri: true,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'sine', t, 0.5, 120 * p, 30 * p, 0.55 * v, { a: 0.002 });
      noise(c, o, t, 0.7, 0.5 * v, 'lowpass', 2600 * p, 120 * p, { a: 0.002 });
      noise(c, o, t, 0.15, 0.25 * v, 'highpass', 2000 * p, null, { a: 0.001 });
      for (let i = 0; i < 4; i++) noise(c, o, t + 0.08 + Math.random() * 0.3, 0.04, 0.07 * v, 'bandpass', rnd(1500, 3500) * p, null, { q: 2 });
    },
  },
  /** an enemy spotted the hero ("!") */
  alert: {
    dur: 0.3,
    gap: 0.12,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'square', t, 0.07, 660 * p, 1320 * p, 0.09 * v, { a: 0.002, ff: 4000 });
      tone(c, o, 'triangle', t + 0.07, 0.16, 1320 * p, 1250 * p, 0.12 * v, { a: 0.002 });
    },
  },
  /** a lit fuse hissing */
  fuse: {
    dur: 0.4,
    gap: 0.2,
    fn: (c, o, t, p, v) => {
      noise(c, o, t, 0.38, 0.09 * v, 'bandpass', 5200 * p, 6500 * p, { a: 0.02, q: 2 });
    },
  },
  /** golden walnut picked up */
  nut: {
    dur: 1.1,
    pri: true,
    fn: (c, o, t, p, v) => {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
        tone(c, o, 'triangle', t + i * 0.07, 0.35, f * p, null, 0.13 * v, { a: 0.003 });
        tone(c, o, 'sine', t + i * 0.07, 0.5, f * 2 * p, null, 0.04 * v, { a: 0.003 });
      });
    },
  },

  // ───── «Ночь клыков» ─────
  /** leathery bat wings: two quick flaps */
  batFlap: {
    dur: 0.2,
    gap: 0.08,
    fn: (c, o, t, p, v) => {
      for (let i = 0; i < 2; i++) noise(c, o, t + i * 0.075, 0.055, 0.13 * v, 'bandpass', 950 * p, 420 * p, { a: 0.004, q: 1.3 });
      tone(c, o, 'sine', t, 0.05, 160 * p, 90 * p, 0.05 * v, { a: 0.002 });
    },
  },
  /** a bat scout's screech (calls the others) */
  batScreech: {
    dur: 0.45,
    gap: 0.15,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'square', t, 0.38, 2500 * p, 3300 * p, 0.08 * v, { a: 0.01, ff: 5200, vib: 320, vibHz: 27, am: 0.45, amHz: 33 });
      tone(c, o, 'sine', t + 0.03, 0.32, 4100 * p, 3500 * p, 0.09 * v, { a: 0.01, vib: 220, vibHz: 21 });
      tone(c, o, 'triangle', t + 0.18, 0.2, 3000 * p, 4200 * p, 0.06 * v, { a: 0.01, vib: 150, vibHz: 30 });
    },
  },
  /** fangs: a crunchy chomp and a little slurp of colour */
  bite: {
    dur: 0.42,
    gap: 0.06,
    fn: (c, o, t, p, v) => {
      noise(c, o, t, 0.06, 0.32 * v, 'bandpass', 2300 * p, null, { a: 0.001, q: 2 });
      tone(c, o, 'triangle', t, 0.09, 320 * p, 110 * p, 0.28 * v, { a: 0.002 });
      tone(c, o, 'sine', t + 0.07, 0.32, 760 * p, 170 * p, 0.11 * v, { a: 0.01, vib: 24, vibHz: 13 });
    },
  },
  /** a townsperson / a district gets its colour back: a whoosh and a bright rising sparkle */
  colorRestore: {
    dur: 1.0,
    pri: true,
    fn: (c, o, t, p, v) => {
      noise(c, o, t, 0.4, 0.07 * v, 'bandpass', 700 * p, 6500 * p, { a: 0.05, q: 1.4 });
      [659.25, 830.61, 987.77, 1318.5, 1661.2].forEach((f, i) => {
        tone(c, o, 'triangle', t + 0.12 + i * 0.06, 0.38, f * p, null, 0.11 * v, { a: 0.003 });
        tone(c, o, 'sine', t + 0.12 + i * 0.06, 0.5, f * 2 * p, null, 0.035 * v, { a: 0.003, vib: 9, vibHz: 7 });
      });
      for (let i = 0; i < 5; i++) tone(c, o, 'sine', t + 0.35 + Math.random() * 0.35, 0.12, rnd(2600, 4200) * p, null, 0.025 * v, { a: 0.002 });
    },
  },
  /** turning into mist (or forming again): an airy falling whoosh */
  mist: {
    dur: 0.75,
    gap: 0.1,
    fn: (c, o, t, p, v) => {
      noise(c, o, t, 0.7, 0.16 * v, 'bandpass', 3200 * p, 380 * p, { a: 0.08, q: 0.9 });
      tone(c, o, 'sine', t, 0.6, 540 * p, 250 * p, 0.05 * v, { a: 0.06, vib: 9, vibHz: 5 });
    },
  },
  /** a vampire's hiss */
  hiss: {
    dur: 0.5,
    gap: 0.12,
    fn: (c, o, t, p, v) => {
      noise(c, o, t, 0.45, 0.11 * v, 'highpass', 4300 * p, null, { a: 0.03, hold: 0.14 });
      noise(c, o, t, 0.35, 0.06 * v, 'bandpass', 2600 * p, 1800 * p, { a: 0.02, q: 2.5 });
    },
  },
  /** a «солнышко» lantern lights up: a warm bell and a soft whoom */
  lanternOn: {
    dur: 0.7,
    gap: 0.08,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'sine', t, 0.65, 880 * p, null, 0.11 * v, { a: 0.004 });
      tone(c, o, 'triangle', t + 0.04, 0.45, 1318.5 * p, null, 0.06 * v, { a: 0.004 });
      noise(c, o, t, 0.3, 0.07 * v, 'lowpass', 1300 * p, 260 * p, { a: 0.02 });
    },
  },
  /** a lantern put out: pfff */
  snuff: {
    dur: 0.4,
    gap: 0.08,
    fn: (c, o, t, p, v) => {
      noise(c, o, t, 0.35, 0.15 * v, 'lowpass', 1700 * p, 200 * p, { a: 0.01 });
      tone(c, o, 'sine', t, 0.25, 420 * p, 120 * p, 0.06 * v, { a: 0.004 });
    },
  },
  /** colour draining out of a bitten hero: a wobbly sinking tone */
  drain: {
    dur: 0.55,
    gap: 0.2,
    fn: (c, o, t, p, v) => {
      tone(c, o, 'triangle', t, 0.5, 660 * p, 210 * p, 0.08 * v, { a: 0.01, vib: 30, vibHz: 9, ff: 2200, ff2: 500 });
      tone(c, o, 'sine', t + 0.05, 0.45, 990 * p, 330 * p, 0.035 * v, { a: 0.01, vib: 20, vibHz: 11 });
    },
  },
};

// ════════════════════════════════════════════════════════════════════════
// 5. Music
// ════════════════════════════════════════════════════════════════════════

// ---------- instrument patches ----------

interface Patch {
  w: Wave;          // main oscillator
  w2?: Wave;        // optional second oscillator
  o2?: number;      // osc2 offset in semitones
  d2?: number;      // osc2 detune in cents
  m2?: number;      // osc2 level
  a: number; d: number; s: number; r: number; // ADSR (s = sustain fraction of peak)
  lp?: number;      // lowpass cutoff Hz
  lpe?: number;     // extra cutoff Hz at note-on, decaying to lp (filter envelope)
  lpd?: number;     // filter envelope decay seconds
  q?: number;
  vib?: number;     // vibrato depth in cents
  vibHz?: number;
  vibDel?: number;  // vibrato fade-in seconds
  glide?: number;   // scoop up from this many semitones below
  g: number;        // peak gain
}

type PatchName =
  | 'lead' | 'pluck' | 'pizz' | 'flute' | 'bell' | 'glock' | 'harp' | 'ep' | 'brass' | 'sqlead'
  | 'accordion' | 'arp' | 'bassTri' | 'bassSq' | 'bassPluck' | 'bassoon' | 'tuba' | 'sub'
  | 'stab' | 'organ' | 'softpad' | 'warmpad' | 'drone' | 'darkpad';

const PATCHES: Record<PatchName, Patch> = {
  lead:      { w: 'pulse25', a: 0.005, d: 0.3, s: 0.55, r: 0.08, lp: 3000, lpe: 2600, lpd: 0.12, vib: 14, vibHz: 5.5, vibDel: 0.18, g: 0.15 },
  pluck:     { w: 'pulse25', a: 0.002, d: 0.3, s: 0, r: 0.06, lp: 1800, lpe: 3200, lpd: 0.05, g: 0.24 },
  pizz:      { w: 'triangle', w2: 'pulse25', m2: 0.35, a: 0.002, d: 0.18, s: 0, r: 0.04, lp: 1500, lpe: 3200, lpd: 0.04, g: 0.32 },
  flute:     { w: 'triangle', w2: 'sine', o2: 12, m2: 0.18, a: 0.05, d: 0.4, s: 0.75, r: 0.2, vib: 16, vibHz: 4.8, vibDel: 0.25, g: 0.26 },
  bell:      { w: 'sine', w2: 'sine', o2: 24, m2: 0.18, a: 0.002, d: 1, s: 0, r: 0.5, g: 0.16 },
  glock:     { w: 'sine', w2: 'triangle', o2: 12, m2: 0.3, a: 0.001, d: 0.45, s: 0, r: 0.2, g: 0.13 },
  harp:      { w: 'triangle', a: 0.002, d: 0.8, s: 0, r: 0.3, lp: 2400, lpe: 2600, lpd: 0.05, g: 0.24 },
  ep:        { w: 'sine', w2: 'triangle', o2: 12, m2: 0.16, a: 0.006, d: 1, s: 0.3, r: 0.35, vib: 5, vibHz: 4, vibDel: 0.3, g: 0.26 },
  brass:     { w: 'sawtooth', w2: 'pulse25', d2: 6, m2: 0.45, a: 0.03, d: 0.3, s: 0.65, r: 0.12, lp: 1300, lpe: 2200, lpd: 0.15, q: 1.1, vib: 14, vibHz: 5.2, vibDel: 0.2, g: 0.13 },
  sqlead:    { w: 'square', a: 0.003, d: 0.12, s: 0.55, r: 0.05, lp: 3600, lpe: 2000, lpd: 0.06, vib: 10, vibHz: 6, vibDel: 0.15, g: 0.09 },
  accordion: { w: 'pulse25', w2: 'sawtooth', d2: 10, m2: 0.45, a: 0.02, d: 0.2, s: 0.7, r: 0.07, lp: 2600, vib: 9, vibHz: 6.5, vibDel: 0.05, g: 0.12 },
  arp:       { w: 'pulse12', a: 0.001, d: 0.1, s: 0, r: 0.03, lp: 3200, g: 0.15 },
  bassTri:   { w: 'triangle', a: 0.004, d: 0.25, s: 0.7, r: 0.05, g: 0.38 },
  bassSq:    { w: 'pulse25', a: 0.003, d: 0.14, s: 0.45, r: 0.04, lp: 450, lpe: 1500, lpd: 0.07, q: 4, g: 0.22 },
  bassPluck: { w: 'triangle', w2: 'square', m2: 0.3, a: 0.002, d: 0.2, s: 0, r: 0.04, lp: 650, lpe: 1500, lpd: 0.04, q: 3, g: 0.42 },
  bassoon:   { w: 'sawtooth', w2: 'sawtooth', d2: 8, m2: 0.7, a: 0.02, d: 0.25, s: 0.7, r: 0.08, lp: 380, lpe: 900, lpd: 0.12, q: 5, vib: 12, vibHz: 4.5, vibDel: 0.2, glide: 1, g: 0.25 },
  tuba:      { w: 'triangle', w2: 'sawtooth', m2: 0.4, a: 0.015, d: 0.18, s: 0.5, r: 0.05, lp: 380, lpe: 700, lpd: 0.08, q: 2, glide: 0.5, g: 0.4 },
  sub:       { w: 'sine', w2: 'triangle', o2: 12, m2: 0.2, a: 0.4, d: 0.6, s: 0.9, r: 0.9, g: 0.22 },
  stab:      { w: 'pulse12', w2: 'triangle', m2: 0.6, a: 0.003, d: 0.12, s: 0.15, r: 0.05, lp: 2400, g: 0.11 },
  organ:     { w: 'square', w2: 'triangle', o2: 12, m2: 0.8, a: 0.03, d: 0.3, s: 0.8, r: 0.25, lp: 1800, g: 0.045 },
  softpad:   { w: 'triangle', w2: 'sine', o2: 12, d2: 5, m2: 0.4, a: 0.6, d: 1, s: 0.85, r: 1, g: 0.07 },
  warmpad:   { w: 'triangle', w2: 'sawtooth', d2: 7, m2: 0.25, a: 0.4, d: 1, s: 0.8, r: 0.9, lp: 1100, g: 0.06 },
  drone:     { w: 'sawtooth', w2: 'sawtooth', d2: -11, m2: 1, a: 1.5, d: 2, s: 0.9, r: 1.8, lp: 320, q: 1.5, vib: 7, vibHz: 0.25, vibDel: 0.5, g: 0.08 },
  darkpad:   { w: 'sawtooth', w2: 'pulse25', d2: 9, m2: 0.7, a: 0.25, d: 0.6, s: 0.75, r: 0.5, lp: 700, q: 1, g: 0.04 },
};

/** Plays one pitched music note. */
function voice(c: Ctx, pt: Patch, midi: number, t: number, dur: number, vel: number, out: AudioNode, send: AudioNode | null): void {
  const f = mtof(midi);
  const nodes: AudioNode[] = [];
  const env = c.createGain();
  nodes.push(env);
  let input: AudioNode = env;
  if (pt.lp) {
    const fl = c.createBiquadFilter();
    fl.type = 'lowpass';
    fl.Q.value = pt.q ?? 0.7;
    fl.frequency.value = pt.lp + (pt.lpe ?? 0);
    if (pt.lpe) {
      fl.frequency.setValueAtTime(pt.lp + pt.lpe, t);
      fl.frequency.setTargetAtTime(pt.lp, t, Math.max(0.005, (pt.lpd ?? 0.1) / 3));
    } else {
      fl.frequency.setValueAtTime(pt.lp, t);
    }
    fl.connect(env);
    input = fl;
    nodes.push(fl);
  }
  const oscs: OscillatorNode[] = [];
  const o1 = mkOsc(c, pt.w);
  o1.connect(input);
  oscs.push(o1);
  if (pt.w2) {
    const o2 = mkOsc(c, pt.w2);
    if (pt.d2) o2.detune.value = pt.d2;
    const g2 = c.createGain();
    g2.gain.value = pt.m2 ?? 1;
    o2.connect(g2);
    g2.connect(input);
    oscs.push(o2);
    nodes.push(g2);
  }
  oscs.forEach((o, i) => {
    const ff = i === 0 ? f : f * Math.pow(2, (pt.o2 ?? 0) / 12);
    o.frequency.value = ff;
    if (pt.glide) {
      o.frequency.setValueAtTime(ff * Math.pow(2, -pt.glide / 12), t);
      o.frequency.exponentialRampToValueAtTime(ff, t + 0.06);
    } else {
      o.frequency.setValueAtTime(ff, t);
    }
  });
  let lfo: OscillatorNode | null = null;
  if (pt.vib) {
    // vibrato drives the detune params (cents), so one LFO serves both oscillators
    lfo = c.createOscillator();
    lfo.frequency.value = pt.vibHz ?? 5;
    const lg = c.createGain();
    lg.gain.value = 0;
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(pt.vib, t + Math.max(0.01, pt.vibDel ?? 0.1));
    lfo.connect(lg);
    for (const o of oscs) lg.connect(o.detune);
    nodes.push(lfo, lg);
  }
  // envelope
  const peak = pt.g * vel;
  const a = Math.min(pt.a, Math.max(0.003, dur * 0.6));
  const g = env.gain;
  g.value = 0; // see envelope(): avoid a full-level first frame
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + a);
  g.setTargetAtTime(peak * pt.s, t + a, Math.max(0.004, pt.d / 3));
  const rel = t + Math.max(dur, a + 0.002);
  const relTau = Math.max(0.004, pt.r / 3);
  let stopAt: number;
  if (pt.s <= 0) {
    stopAt = t + a + pt.d * 2.2;
    if (rel < stopAt) {
      g.setTargetAtTime(0, rel, relTau);
      stopAt = Math.min(stopAt, rel + pt.r * 2.2);
    }
  } else {
    g.setTargetAtTime(0, rel, relTau);
    stopAt = rel + pt.r * 2.2;
  }
  stopAt += 0.02;
  env.connect(out);
  if (send) env.connect(send);
  for (const o of oscs) {
    o.start(t);
    o.stop(stopAt);
  }
  if (lfo) {
    lfo.start(t);
    lfo.stop(stopAt);
  }
  cleanup(o1, [...oscs, ...nodes]);
}

// ---------- track data types ----------

type PartKey = 'lead' | 'lead2' | 'bass' | 'arp' | 'pad';
type DrumLine = 'k' | 's' | 'h' | 'x';

interface Section {
  ch: string;
  lead?: string;
  lead2?: string;
  bass?: string;
  arp?: string;
  pad?: string;
  k?: string;
  s?: string;
  h?: string;
  x?: string;
  fill?: Partial<Record<DrumLine, string>>;
  cr?: boolean;
}

interface TrackDef {
  bpm: number;
  swing?: number;   // 8th-note swing amount (0..0.35)
  tr?: number;      // transpose semitones
  gain?: number;
  inst: Partial<Record<PartKey, PatchName>>;
  mix?: Partial<Record<PartKey | 'drums', number>>;
  bassLo?: number;  // lowest MIDI note for bass roots
  arpLo?: number;   // lowest MIDI note for arpeggio tones
  padMid?: number;  // centre MIDI note for pad voicings
  delay?: { steps: number; fb: number; mix: number; parts: PartKey[] };
  sections: Section[];
  order?: number[];
}

// ---------- the tracks ----------

// MENU — whimsical, C major, bouncy hook with chromatic cartoon turns.
const MENU_A: Section = {
  ch: 'C | E7/B | Am | C7 | F | Fm | C/G G7 | C',
  lead: 'e5:2 g5:2 c6:3 g5:1 a5:2 g5:2 e5:4 | g#5:2 b5:2 e5:3 g#5:1 b5:4 r:4 | a5:2 c6:2 e6:3 c6:1 b5:2 a5:2 e5:4 | ' +
    'g5:2 e5:2 c5:2 e5:2 bb5:6 r:2 | a5:3 g5:1 f5:2 a5:2 c6:4 a5:4 | ab5:3 g5:1 f5:2 ab5:2 c6:4 r:4 | ' +
    'e5:2 g5:2 c6:2 e6:2 d6:2 b5:2 g5:2 f5:2 | e5:4 c5:2 g4:2 c5:4 r:4',
  bass: '1.8.5.8.1.8.5.8.',
  arp: '....c.......d...',
  k: 'x.......x.o.....',
  s: '....o.......o...',
  h: 'x.o.x.o.x.o.x.o.',
  x: '..b.......b..B..',
  fill: { s: '....o...o.o.oooo' },
};
const MENU_B: Section = {
  ch: 'Dm | G | C | Am | Dm | G | Ab | G7',
  lead: 'f5:2 a5:2 d6:4 c6:2 a5:2 f5:4 | g5:2 b5:2 d6:4 b5:6 r:2 | e6:2 d6:2 c6:2 b5:2 c6:4 g5:4 | a5:2 g5:2 e5:2 c5:2 e5:8 | ' +
    'd5:2 f5:2 a5:2 d6:2 c6:3 a5:1 f5:4 | g5:2 b5:2 d6:2 g6:2 f6:4 d6:4 | c6:2 eb6:2 c6:2 ab5:2 eb5:4 c6:4 | ' +
    'b5:2 d6:2 f6:2 d6:2 b5:2 g5:2 f5:2 d5:2',
  bass: '1-..5-..8-..5-..',
  arp: 'a.b.c.d.c.b.a.b.',
  k: 'x.....x.x.......',
  s: '....x.......x...',
  fill: { s: '....x...x.x.xxxx', k: 'x.......x.......' },
};
const MENU: TrackDef = {
  bpm: 116,
  swing: 0.1,
  inst: { lead: 'lead', bass: 'bassTri', arp: 'glock' },
  mix: { arp: 0.8, drums: 0.8 },
  sections: [MENU_A, MENU_B],
};

// FOREST — calm night, A minor, sparse triangle flute + soft harp arps.
const FOREST: TrackDef = {
  bpm: 84,
  gain: 0.7,
  inst: { lead: 'flute', lead2: 'bell', bass: 'bassTri', arp: 'harp', pad: 'softpad' },
  mix: { arp: 0.7, drums: 0.6, bass: 0.8, lead2: 0.8 },
  sections: [
    {
      ch: 'Am | Fmaj7 | Dm7 | E | Am | Fmaj7 | Bm7b5 | E7',
      lead: 'e5:6 d5:2 c5:4 b4:4 | a4:12 r:4 | r:4 f5:4 e5:2 d5:2 c5:4 | b4:8 g#4:8 | ' +
        'e5:6 a5:2 g5:4 e5:4 | f5:4 e5:4 c5:8 | d5:4 f5:4 a5:4 g#5:4 | b5:12 r:4',
      bass: '1-------5-------',
      arp: 'a..c..e.d..c..b.',
      pad: 'x---------------',
      k: '', s: '',
      h: '........o.......',
      x: '......s.......s.',
    },
    {
      ch: 'Fmaj7 | G | Em7 | Am | Dm7 | G | Fmaj7 | E',
      lead: 'c6:4 a5:4 e5:4 f5:4 | d5:8 r:4 b4:4 | g5:6 f#5:2 e5:4 d5:4 | e5:8 c5:8 | ' +
        'a5:6 g5:2 f5:4 e5:4 | d5:4 b4:4 g4:4 b4:4 | c5:6 e5:2 a5:8 | g#5:8 e5:8',
      lead2: 'r:8 e6:8 | r:8 d6:8 | r:8 b5:8 | r:8 c6:8 | r:8 a5:8 | r:8 b5:8 | r:8 c6:8 | r:8 b5:8',
      arp: 'a.c.e.c.b.d.e.d.',
      k: 'o...............',
    },
  ],
};

// PANTRY — sneaky tiptoe pizzicato, D dorian, swung.
const PANTRY: TrackDef = {
  bpm: 104,
  swing: 0.16,
  inst: { lead: 'pizz', bass: 'bassPluck', arp: 'harp' },
  mix: { arp: 0.55, drums: 0.8 },
  sections: [
    {
      ch: 'Dm | G | Dm | G | Fmaj7 | Em7 | Dm C | A7',
      lead: 'd5:2 f5:2 a5:4 g5:2 f5:2 e5:4 | d5:2 b4:2 d5:4 e5:2 f5:2 g5:4 | a5:2 f5:2 d5:4 c#5:2 d5:2 e5:4 | f5:2 e5:2 d5:2 b4:2 g4:8 | ' +
        'c5:2 f5:2 a5:2 c6:2 b5:2 a5:2 g5:4 | g5:2 e5:2 b4:2 d5:2 e5:8 | f5:2 e5:2 d5:2 a4:2 e5:2 d5:2 c5:2 g4:2 | a4:2 c#5:2 e5:2 g5:2 a5:8',
      bass: '1...5...8...5..a',
      arp: '',
      k: 'x.......o.......',
      s: '',
      h: '..o...o...o...o.',
      x: '....b.......b...',
      fill: { x: '....b...b.b.b.B.' },
    },
    {
      ch: 'Gm | Dm | Gm | A7 | Bb | C | Dm Em | A7',
      lead: 'g5:3 a5:1 bb5:2 a5:2 g5:2 d5:2 r:4 | f5:3 g5:1 a5:2 g5:2 f5:2 d5:2 r:4 | bb5:3 c6:1 d6:2 c6:2 bb5:2 g5:2 r:4 | a5:2 g5:2 e5:2 c#5:2 e5:4 r:4 | ' +
        'd6:2 bb5:2 f5:2 bb5:2 d6:8 | e6:2 c6:2 g5:2 c6:2 e6:8 | f6:2 e6:2 d6:2 a5:2 g5:2 a5:2 b5:2 g5:2 | c#6:2 a5:2 e5:2 c#5:2 a4:8',
      bass: '1.1.5...1.1.5..a',
      arp: '..a...b...c...b.',
      s: '....o.......o...',
      fill: { s: '....o...o.o.oooo' },
    },
  ],
};

// FEAST — jolly oompah polka in F, tuba bass + accordion, comic minor turns.
const FEAST: TrackDef = {
  bpm: 132,
  inst: { lead: 'accordion', bass: 'tuba', pad: 'stab' },
  bassLo: 34,
  mix: { drums: 0.85 },
  sections: [
    {
      ch: 'F | C7 | C7 | F | F | Bb | F/C C7 | F',
      lead: 'c5:2 f5:2 a5:2 f5:2 c6:4 a5:4 | bb5:2 g5:2 e5:2 g5:2 bb5:4 g5:4 | c6:2 bb5:2 a5:2 g5:2 e5:2 f5:2 g5:4 | a5:4 f5:4 c5:4 r:4 | ' +
        'c5:2 f5:2 a5:2 c6:2 f6:4 c6:4 | d6:2 bb5:2 f5:2 bb5:2 d6:4 f6:4 | c6:3 a5:1 f5:2 a5:2 g5:2 e5:2 bb4:2 c5:2 | f5:4 a4:2 c5:2 f5:4 r:4',
      bass: '1.......0.......',
      pad: '....x.......x...',
      k: 'x.......x.......',
      s: '....o.......o...',
      h: '',
      x: '',
      fill: { k: 'x.......x...x.x.', s: '....o...o.o.oooo' },
    },
    {
      ch: 'Dm | Dm | Gm | C7 | Bb | Bbm | F/C C7 | F C7',
      lead: 'a5:2 g#5:2 a5:2 d6:2 a5:4 f5:4 | e5:2 f5:2 a5:2 f5:2 d5:8 | bb5:2 a5:2 bb5:2 d6:2 bb5:4 g5:4 | e5:2 f5:2 g5:2 bb5:2 e6:4 c6:4 | ' +
        'd6:3 c6:1 bb5:2 f5:2 d5:4 f5:4 | db6:3 c6:1 bb5:2 f5:2 db5:8 | c5:2 f5:2 a5:2 c6:2 bb5:2 g5:2 e5:2 c5:2 | ' +
        'f5:4 r:2 c5:1 c5:1 e5:1 f5:1 g5:1 a5:1 bb5:2 c6:2',
      bass: '1.......5.......',
      s: '....c.......c...',
      x: '..s...s...s...s.',
      fill: { s: '....c...c.c.cccc' },
    },
  ],
};

// LIBRARY — mysterious E minor line-cliché, echoey plucks through a feedback delay, clock ticks.
const LIBRARY: TrackDef = {
  bpm: 88,
  inst: { lead: 'pluck', lead2: 'bell', bass: 'bassTri', arp: 'harp', pad: 'softpad' },
  mix: { arp: 0.6, bass: 0.75, lead2: 0.7, drums: 0.7 },
  delay: { steps: 3, fb: 0.42, mix: 0.38, parts: ['lead', 'arp', 'lead2'] },
  sections: [
    {
      ch: 'Em | Emmaj7 | Em7 | Em6 | Cmaj7 | Am7 | F#m7b5 | B7',
      lead: 'b4:2 e5:2 g5:2 b5:6 a5:2 g5:2 | f#5:4 d#5:8 r:4 | b4:2 e5:2 g5:2 b5:6 c6:2 b5:2 | a5:6 g5:2 f#5:4 c#5:4 | ' +
        'e5:2 g5:2 b5:2 e6:6 d6:2 b5:2 | c6:6 b5:2 a5:4 e5:4 | a5:4 c6:4 e6:4 d#6:4 | f#5:8 d#5:4 b4:4',
      bass: '1-------5-------',
      arp: 'a...c...b...d...',
      pad: 'x---------------',
      k: '', s: '', h: '',
      x: 'B...b...B...b...',
    },
    {
      ch: 'Am | Am/G | F#m7b5 | B7 | Em | C | Am6 | B7',
      lead: 'e5:4 a5:4 c6:6 b5:2 | a5:4 e5:4 c5:8 | a5:4 c6:4 a5:2 f#5:2 e5:4 | d#5:6 f#5:2 a5:4 b5:4 | ' +
        'g5:6 f#5:2 e5:4 b4:4 | c5:4 e5:4 g5:4 b5:4 | a5:6 f#5:2 e5:4 c5:4 | d#5:8 r:8',
      lead2: 'r:12 e6:4 | r:16 | r:12 c6:4 | r:16 | r:12 b5:4 | r:16 | r:12 a5:4 | r:16',
      arp: 'a.c.e.c.b.d.f.d.',
      k: 'o...............',
    },
  ],
};

// CHASE — 170 BPM, E minor, octave-pumping bass, urgent square lead, driving drums.
const CHASE: TrackDef = {
  bpm: 170,
  inst: { lead: 'sqlead', bass: 'bassSq', arp: 'arp' },
  mix: { arp: 0.8 },
  sections: [
    {
      ch: 'Em | Em | C | D | Em | Em | C | B7',
      lead: 'e5:2 e5:2 g5:2 e5:2 b5:4 a5:2 g5:2 | f#5:2 g5:2 f#5:2 e5:2 d5:4 e5:4 | e5:2 e5:2 g5:2 e5:2 c6:4 b5:2 a5:2 | b5:2 a5:2 f#5:2 d5:2 a5:4 f#5:4 | ' +
        'e6:2 d6:2 b5:2 g5:2 e6:2 d6:2 b5:2 g5:2 | f#6:2 e6:2 b5:2 g5:2 f#6:4 e6:4 | g6:2 e6:2 c6:2 g5:2 e6:4 c6:4 | d#6:4 b5:4 f#5:4 d#5:4',
      bass: '1.8.1.8.1.8.1.8.',
      arp: 'a.b.c.b.a.b.c.b.',
      k: 'x...x...x...x...',
      s: '....x.......x...',
      h: 'x.x.x.x.x.x.x.x.',
      x: '',
      cr: true,
      fill: { s: '....x...x.x.xxxx', k: 'x...x...x.x.....' },
    },
    {
      ch: 'Am | Em | C | G | Am | B7 | C D | B7',
      lead: 'a5:6 c6:2 e6:4 a5:4 | g5:6 b5:2 e6:4 g5:4 | e6:4 d6:2 c6:2 g5:4 e5:4 | d6:4 b5:2 g5:2 d5:4 g5:4 | ' +
        'c6:2 b5:2 a5:2 b5:2 c6:2 d6:2 e6:4 | d#6:2 c#6:2 b5:2 c#6:2 d#6:2 e6:2 f#6:4 | g6:4 e6:4 f#6:4 d6:4 | b5:2 r:2 b5:2 r:2 b5:2 a5:2 g5:2 f#5:2',
      bass: '1.1.8.1.1.1.8.1.',
      arp: 'abcbabcbabcbabcb',
      k: 'x.x...x.x.x...x.',
      h: 'xoxoxoxoxoxoxoxo',
      cr: true,
      fill: { s: 'x.x.x.x.xxxxxxxx', k: 'x...x...x...x...', x: '........t.t.T.T.' },
    },
  ],
};

// BOSS — the King: D minor, 140 BPM, low "bassoon" saw riff, brass stabs, toms.
const BOSS_A: Section = {
  ch: 'Dm | Dm | Bb | A7 | Dm | Dm | Gm | A7',
  lead: 'd5:2 r:2 d5:2 r:2 f5:2 e5:2 d5:4 | a5:4 g#5:4 a5:4 r:4 | bb5:2 r:2 bb5:2 r:2 d6:2 c6:2 bb5:4 | a5:4 c#6:4 e6:4 r:4 | ' +
    'd6:2 c6:2 a5:2 f5:2 d6:2 c6:2 a5:2 f5:2 | e6:2 d6:2 a5:2 f5:2 e6:4 f6:4 | g6:4 f6:2 d6:2 bb5:4 g5:4 | a5:2 bb5:2 a5:2 g5:2 f5:2 e5:2 c#5:4',
  bass: '1..1..1.5..f..5.',
  pad: 'x-------x-------',
  arp: '',
  k: 'x.....x.x.......',
  s: '....x.......x...',
  h: 'x.o.x.o.x.o.x.o.',
  x: '',
  cr: true,
  fill: { s: '....x.......x.x.', x: '........t.t.T.T.' },
};
const BOSS_B: Section = {
  ch: 'Gm | Dm | Bb | A | Gm | Dm | Eb | A7',
  lead: 'g5:6 a5:2 bb5:4 d6:4 | a5:8 f5:4 d5:4 | bb5:6 c6:2 d6:4 f6:4 | e6:8 c#6:4 a5:4 | ' +
    'g6:6 f6:2 d6:4 bb5:4 | a5:6 g5:2 f5:4 d5:4 | eb6:4 bb5:4 g5:4 eb5:4 | c#6:4 e6:4 a6:4 g6:4',
  bass: '1.1.1.5.1.1.b.m.',
  k: 'x.....x.x.....x.',
  cr: false,
  fill: { s: '....x...x.x.xxxx', x: 'C...............' },
};
const BOSS: TrackDef = {
  bpm: 140,
  gain: 0.75,
  inst: { lead: 'brass', bass: 'bassoon', pad: 'darkpad', arp: 'arp' },
  bassLo: 33,
  mix: { pad: 0.9, arp: 0.8, bass: 0.85 },
  sections: [BOSS_A, BOSS_B],
};

// BOSS2 — phase two: same material, a semitone higher, faster, denser drums + 16th arps.
const BOSS2: TrackDef = {
  ...BOSS,
  bpm: 156,
  tr: 1,
  sections: [
    { ...BOSS_A, arp: 'abcdcbabcdcbabcd', k: 'x.x...x.x.x...x.', s: '....x..x....x.x.', h: 'xoxoxoxoxoxoxoxo', bass: '1.11.11.1.11.5.f' },
    { ...BOSS_B, arp: 'abcdcbabcdcbabcd', k: 'x.x...x.x.x.x.x.', s: '....x..x....x..x', h: 'xoxoxoxoxoxoxoxo', cr: true },
  ],
};

// ENDING — triumphant G major brass anthem, then a sweet flute/harp verse.
const ENDING: TrackDef = {
  bpm: 100,
  gain: 0.75,
  inst: { lead: 'brass', lead2: 'flute', bass: 'bassTri', pad: 'organ', arp: 'harp' },
  padMid: 62,
  mix: { arp: 0.65, drums: 0.85 },
  sections: [
    {
      ch: 'G | D/F# | Em | C | G/D | D | C D | G',
      lead: 'd5:4 g5:4 b5:6 a5:2 | a5:4 f#5:4 d5:8 | e5:4 g5:4 b5:4 e6:4 | e6:6 d6:2 c6:4 g5:4 | ' +
        'b5:4 d6:4 g6:6 f#6:2 | f#6:4 e6:2 d6:2 a5:8 | g5:4 c6:4 a5:4 d6:4 | b5:2 c6:2 b5:2 a5:2 g5:8',
      bass: '1...5...8...5...',
      pad: 'x-------x-------',
      arp: '',
      k: 'x.......x.x.....',
      s: '....x.......x...',
      h: 'x.x.x.x.x.x.x.x.',
      x: '',
      cr: true,
      fill: { s: '....x...x.x.xxxx' },
    },
    {
      ch: 'Cmaj7 | Bm7 | Am7 | G | Cmaj7 | Bm7 | Am7 D7 | G',
      lead2: 'e5:4 g5:4 b5:8 | a5:4 f#5:4 d5:8 | c5:4 e5:4 g5:6 f#5:2 | d5:12 r:4 | ' +
        'e5:4 g5:4 c6:6 b5:2 | d6:4 b5:4 f#5:8 | a5:4 c6:4 b5:2 a5:2 f#5:4 | g5:12 r:4',
      bass: '1-------5-------',
      pad: 'x---------------',
      arp: 'a.b.c.d.c.b.a.b.',
      k: 'o...............',
      s: '',
      h: '....o.......o...',
      fill: { s: '............o.oo' },
    },
  ],
};

// DEN — cozy, slow, swung F major with maj7 colours; soft e-piano and walking bass.
const DEN: TrackDef = {
  bpm: 76,
  swing: 0.3,
  inst: { lead: 'ep', bass: 'bassTri', pad: 'warmpad' },
  bassLo: 36,
  mix: { bass: 0.8, drums: 0.6 },
  sections: [
    {
      ch: 'Fmaj7 | Dm7 | Gm7 | C7 | Fmaj7 | Am7 | Bbmaj7 | C7',
      lead: 'a4:2 c5:2 e5:4 f5:2 e5:2 c5:4 | d5:2 f5:2 a5:4 c6:4 a5:4 | bb5:3 a5:1 g5:4 f5:4 d5:4 | e5:8 g5:4 bb4:4 | ' +
        'a4:2 c5:2 e5:4 a5:4 g5:4 | e5:2 g5:2 c6:6 a5:2 e5:4 | d5:2 f5:2 a5:4 g5:4 f5:4 | e5:4 d5:2 c5:2 bb4:4 g4:4',
      bass: '1...3...5...a...',
      pad: 'x---------------',
      k: 'o.......o.......',
      s: '....o.......o...',
      h: '..o...o...o...o.',
      x: '',
    },
    {
      ch: 'Bbmaj7 | Bbm6 | Am7 | D7 | Gm7 | C7 | Fmaj7 Dm7 | Gm7 C7',
      lead: 'f5:6 d5:2 a4:8 | f5:6 db5:2 g4:8 | e5:4 g5:4 c6:4 a5:4 | f#5:6 a5:2 c6:8 | ' +
        'bb5:4 a5:2 g5:2 f5:4 d5:4 | e5:4 g5:2 bb5:2 a5:4 g5:4 | a5:4 c6:4 f5:4 a5:4 | bb5:4 a5:2 g5:2 e5:4 c5:4',
      bass: '1...5...1...a...',
      x: '..s.......s.....',
    },
  ],
};

// TENSION — near-silent low drone, eerie bell notes and a heartbeat pulse.
const TENSION: TrackDef = {
  bpm: 70,
  inst: { lead2: 'bell', bass: 'sub', pad: 'drone' },
  bassLo: 36,
  padMid: 50,
  mix: { lead2: 0.7, bass: 0.6, drums: 1 },
  sections: [
    {
      ch: 'Cm | Cm | Db | Db | Ab | Ab | G | G',
      lead2: 'r:16 | r:8 g5:8 | r:16 | r:12 ab5:4 | r:16 | r:8 c6:8 | r:16 | r:8 b5:8',
      bass: '1-------------------------------',
      pad: 'x-------------------------------',
      k: '', s: '', h: '',
      x: 'Hh......Hh......',
    },
    {
      ch: 'Fm | Fm | Db | Db | Ab | Ab | G | G',
      lead2: 'r:8 ab5:8 | r:16 | r:8 f5:8 | r:16 | r:8 eb6:8 | r:8 c6:8 | r:16 | r:8 b4:8',
      x: 'Hh..Hh..Hh..Hh..',
    },
  ],
};

// CREDITS — upbeat reprise of the menu hook in D major, plus a celebratory new section.
const CREDITS_GROOVE: Partial<Section> = {
  bass: '1.8.1.8.1.8.1.8.',
  arp: 'a.c.b.c.a.c.b.c.',
  pad: '..x...x...x...x.',
  k: 'x...x...x...x...',
  s: '....x.......x...',
  h: 'x.o.x.o.x.o.x.o.',
  x: '',
  cr: true,
  fill: { s: '....x...x.x.xxxx' },
};
const CREDITS: TrackDef = {
  bpm: 132,
  tr: 2,
  inst: { lead: 'lead', bass: 'bassSq', arp: 'glock', pad: 'stab' },
  mix: { arp: 0.7, pad: 0.9 },
  sections: [
    { ...MENU_A, ...CREDITS_GROOVE },
    { ...MENU_B, ...CREDITS_GROOVE, bass: '1.851.8.1.851.8.' },
    {
      ch: 'F | G | Em | Am | Dm | G | C | C',
      lead: 'c6:2 a5:2 f5:2 a5:2 c6:4 f6:4 | d6:2 b5:2 g5:2 b5:2 d6:4 g6:4 | e6:2 b5:2 g5:2 b5:2 e6:4 g6:4 | a6:4 g6:2 e6:2 c6:4 a5:4 | ' +
        'f6:2 e6:2 d6:2 c6:2 a5:4 d6:4 | b5:2 c6:2 d6:2 e6:2 f6:4 d6:4 | e6:4 g6:4 c7:8 | r:4 g5:2 g5:2 c6:2 r:2 c6:4',
      ...CREDITS_GROOVE,
      x: '..b.......b.....',
      fill: { s: 'x.x.x.x.xxxxxxxx', x: '........t.t.T.T.' },
    },
  ],
};


// ───────── «Хрумляндия» ─────────

// HUB_DAY — the candy town by day: F major, swung, flute + glockenspiel over an oompah tuba, claps and shakers.
const HUB_DAY: TrackDef = {
  bpm: 118,
  swing: 0.18,
  inst: { lead: 'flute', lead2: 'glock', bass: 'tuba', pad: 'stab', arp: 'harp' },
  bassLo: 34,
  mix: { lead2: 0.75, arp: 0.6, pad: 0.8, drums: 0.75 },
  sections: [
    {
      ch: 'F | Bb | C7 | F | Dm | Gm | C7 | F',
      lead: 'c5:2 f5:2 a5:2 c6:2 a5:4 f5:4 | d5:2 f5:2 bb5:2 d6:2 bb5:4 f5:4 | e5:2 g5:2 bb5:2 c6:2 d6:2 c6:2 bb5:2 g5:2 | a5:8 r:4 c5:4 | ' +
        'd5:2 f5:2 a5:2 d6:2 c6:4 a5:4 | bb5:2 a5:2 g5:2 d5:2 g5:4 bb5:4 | a5:2 bb5:2 c6:2 e6:2 g6:4 e6:4 | f6:8 r:8',
      bass: '1...5...8...5...',
      pad: '....x.......x...',
      arp: '',
      k: 'x.......x.......',
      s: '....c.......c...',
      h: '..o...o...o...o.',
      x: '..s...s...s...s.',
      fill: { s: '....c...c.c.cccc' },
    },
    {
      ch: 'Bb | C | Am | Dm | Gm | C7 | F/C C7 | F',
      lead: 'd6:8 c6:4 bb5:4 | c6:8 bb5:4 a5:4 | a5:8 g5:4 e5:4 | f5:12 r:4 | g5:8 a5:4 bb5:4 | c6:8 e6:4 g6:4 | f6:4 c6:4 a5:2 g5:2 e5:4 | f5:12 r:4',
      lead2: 'f6:2 d6:2 bb5:2 d6:2 f6:4 r:4 | g6:2 e6:2 c6:2 e6:2 g6:4 r:4 | e6:2 c6:2 a5:2 c6:2 e6:4 r:4 | f6:2 d6:2 a5:2 d6:2 f6:4 r:4 | ' +
        'd6:2 bb5:2 g5:2 bb5:2 d6:4 r:4 | e6:2 c6:2 g5:2 c6:2 e6:4 g6:4 | f6:2 e6:2 d6:2 c6:2 bb5:2 a5:2 g5:2 e5:2 | f5:4 a5:4 c6:4 f6:4',
      arp: 'a...c...b...c...',
      x: '..s...s...s.s.s.',
    },
  ],
};

// NIGHT_TOWN — the town under the red moon: spooky-cute A minor, staccato pizzicato, a ticking clock, glockenspiel
// answers; dark but never scary-scary.
const NIGHT_TOWN: TrackDef = {
  bpm: 96,
  swing: 0.12,
  gain: 0.74,
  inst: { lead: 'pizz', lead2: 'glock', bass: 'bassPluck', arp: 'harp', pad: 'darkpad' },
  mix: { lead2: 0.7, arp: 0.55, pad: 1, drums: 0.7 },
  sections: [
    {
      ch: 'Am | Am | Dm | E7 | Am | F | B7 | E7',
      lead: 'a4:2 c5:2 e5:2 a5:2 g#5:2 a5:2 e5:4 | c5:2 b4:2 a4:2 e4:2 a4:8 | d5:2 f5:2 a5:2 d6:2 c6:2 a5:2 f5:4 | e5:2 g#5:2 b5:2 d6:2 b5:4 r:4 | ' +
        'a5:2 e5:2 c5:2 e5:2 a5:3 b5:1 c6:4 | c6:2 a5:2 f5:2 a5:2 c6:4 r:4 | b5:2 a5:2 f#5:2 d#5:2 b4:4 d#5:4 | e5:3 d#5:1 e5:2 g#5:2 b5:4 r:4',
      bass: '1...5...1.8.5...',
      arp: '..a...c...b...c.',
      pad: 'x---------------',
      k: 'x.......x.......',
      s: '',
      h: '',
      x: 'b...B...b...B...',
      fill: { x: 'b.B.b.B.bBbBbBbB' },
    },
    {
      ch: 'F | E | Dm | Am | F | E | Dm E | Am',
      lead: 'f5:2 a5:2 c6:2 a5:2 f5:2 e5:2 f5:4 | e5:2 g#5:2 b5:2 g#5:2 e5:2 d5:2 e5:4 | d5:2 f5:2 a5:2 f5:2 d5:2 c5:2 d5:4 | c5:2 e5:2 a5:2 e5:2 c5:2 b4:2 a4:4 | ' +
        'f5:2 a5:2 c6:2 f6:2 e6:2 c6:2 a5:4 | g#5:2 b5:2 e6:2 b5:2 g#5:2 f5:2 e5:4 | d5:2 f5:2 a5:2 d6:2 b5:2 g#5:2 e5:2 d5:2 | c5:4 e5:4 a5:4 r:4',
      lead2: 'r:8 c6:4 b5:4 | r:8 g#5:8 | r:8 f5:4 a5:4 | e5:16 | r:8 c6:4 d6:4 | e6:8 b5:8 | a5:4 f5:4 g#5:4 b5:4 | a5:16',
      bass: '1...5...1...5..a',
      x: 'b...B...b..sB...',
    },
  ],
};

// SWAMP — Туманные топи: slow, murky D minor, a wobbly flute over a droning bassoon, frogs plonking in the reeds.
const SWAMP: TrackDef = {
  bpm: 72,
  swing: 0.2,
  gain: 0.8,
  inst: { lead: 'flute', lead2: 'bell', bass: 'bassoon', arp: 'harp', pad: 'drone' },
  bassLo: 33,
  padMid: 52,
  mix: { lead2: 0.6, arp: 0.55, pad: 0.9, bass: 0.8, drums: 0.7 },
  sections: [
    {
      ch: 'Dm | Dm | C | C | Bb | Bb | A7 | A7',
      lead: 'd5:6 e5:2 f5:4 a5:4 | g5:8 f5:4 e5:4 | e5:6 f5:2 g5:4 c6:4 | bb5:8 a5:4 g5:4 | f5:6 g5:2 a5:4 d6:4 | c6:4 bb5:4 a5:4 f5:4 | e5:6 f5:2 g5:4 c#5:4 | a4:12 r:4',
      bass: '1-------5-------',
      arp: 'a.....c.....b...',
      pad: 'x---------------',
      k: 'o...............',
      s: '',
      h: '',
      x: '....b.....b...s.',
      fill: { x: '....b.....bb.bbB' },
    },
    {
      ch: 'Gm | Gm | Dm | Dm | Eb | Eb | A7 | A7',
      lead: 'g4:6 a4:2 bb4:4 d5:4 | g5:8 f5:4 d5:4 | f5:6 e5:2 d5:4 a4:4 | d5:12 r:4 | eb5:6 f5:2 g5:4 bb5:4 | a5:4 g5:4 f5:4 eb5:4 | e5:6 g5:2 bb5:4 c#5:4 | d5:12 r:4',
      lead2: 'r:16 | r:8 d6:8 | r:16 | r:8 a5:8 | r:16 | r:8 g5:8 | r:16 | c#6:8 r:8',
    },
  ],
};

// GARDEN — Стеклянная оранжерея: glassy E lydian, bells and glockenspiel through a long echo, a soft sub.
const GARDEN: TrackDef = {
  bpm: 84,
  gain: 0.8,
  inst: { lead: 'bell', lead2: 'glock', bass: 'sub', arp: 'glock', pad: 'softpad' },
  arpLo: 64,
  mix: { arp: 0.55, lead2: 0.6, bass: 0.8, drums: 0.5 },
  delay: { steps: 3, fb: 0.45, mix: 0.4, parts: ['lead', 'arp', 'lead2'] },
  sections: [
    {
      ch: 'Emaj7 | F#/E | Emaj7 | F#/E | C#m7 | Amaj7 | F#m7 | B7',
      lead: 'b5:4 g#5:4 d#6:8 | a#5:4 c#6:4 f#6:8 | e6:4 d#6:4 b5:8 | c#6:6 a#5:2 f#5:8 | e5:4 g#5:4 b5:4 c#6:4 | e6:6 c#6:2 a5:8 | f#5:4 a5:4 c#6:4 e6:4 | d#6:8 b5:4 f#5:4',
      bass: '1-------5-------',
      arp: 'a.c.e.g.e.c.a.c.',
      pad: 'x---------------',
      k: '',
      s: '',
      h: '....o.......o...',
      x: '..B.......B.....',
    },
    {
      ch: 'C#m | G#m | A | E | C#m | G#m | A | B',
      lead: 'c#6:8 b5:4 g#5:4 | d#6:8 b5:8 | e6:8 c#6:4 a5:4 | b5:16 | e6:8 d#6:4 c#6:4 | b5:8 g#5:8 | a5:4 c#6:4 e6:4 a6:4 | f#6:8 d#6:8',
      lead2: 'g#6:1 e6:1 c#6:1 e6:1 g#6:4 r:8 | g#6:1 d#6:1 b5:1 d#6:1 g#6:4 r:8 | a6:1 e6:1 c#6:1 e6:1 a6:4 r:8 | g#6:1 e6:1 b5:1 e6:1 g#6:4 r:8 | ' +
        'g#6:1 e6:1 c#6:1 e6:1 g#6:4 r:8 | b6:1 g#6:1 d#6:1 g#6:1 b6:4 r:8 | c#7:1 a6:1 e6:1 a6:1 c#7:4 r:8 | b6:1 f#6:1 d#6:1 f#6:1 a6:4 r:8',
      arp: 'a...c...e...c...',
    },
  ],
};

// PASS — Чёрный перевал: a windy mountain road at a gallop, G minor, brass over pumping octaves and toms.
const PASS: TrackDef = {
  bpm: 150,
  gain: 0.7,
  inst: { lead: 'brass', bass: 'bassSq', arp: 'arp', pad: 'darkpad' },
  mix: { arp: 0.7, pad: 0.8, drums: 0.75, bass: 0.9 },
  sections: [
    {
      ch: 'Gm | Gm | Eb | F | Gm | Gm | Cm | D7',
      lead: 'g4:2 bb4:2 d5:4 c5:2 bb4:2 a4:4 | g4:2 a4:2 bb4:2 c5:2 d5:8 | eb5:2 d5:2 c5:2 bb4:2 g5:4 eb5:4 | f5:2 eb5:2 d5:2 c5:2 a4:8 | ' +
        'g5:2 f5:2 d5:2 bb4:2 g5:4 a5:4 | bb5:4 a5:2 g5:2 d5:8 | c6:2 bb5:2 g5:2 eb5:2 c5:4 eb5:4 | d5:4 f#5:4 a5:4 c6:4',
      bass: '1.1.8.1.1.1.8.5.',
      arp: 'a.b.c.b.a.b.c.b.',
      pad: 'x-------x-------',
      k: 'x...x...x...x...',
      s: '....x.......x...',
      h: 'x.x.x.x.x.x.x.x.',
      x: '..........t.t...',
      cr: true,
      fill: { s: '....x...x.x.xxxx', x: '........t.t.T.T.' },
    },
    {
      ch: 'Eb | F | Dm | Gm | Eb | F | D | D7',
      lead: 'g5:6 f5:2 eb5:4 bb4:4 | a4:4 c5:4 f5:8 | f5:6 e5:2 d5:4 a4:4 | bb4:4 d5:4 g5:8 | g5:4 bb5:4 eb6:6 d6:2 | c6:4 a5:4 f5:8 | f#5:4 a5:4 d6:4 c6:4 | a5:4 f#5:4 d5:4 c5:4',
      bass: '1.1.1.5.1.1.b.5.',
      h: 'xoxoxoxoxoxoxoxo',
      cr: false,
    },
  ],
};

// CASTLE — Замок Полночь: gothic C minor, a harpsichord-like pluck spinning arpeggios, organ, a tolling bell.
const CASTLE: TrackDef = {
  bpm: 100,
  gain: 0.8,
  inst: { lead: 'pluck', lead2: 'bell', bass: 'bassTri', pad: 'organ' },
  padMid: 58,
  mix: { lead2: 0.75, bass: 0.85, drums: 0.7 },
  delay: { steps: 3, fb: 0.3, mix: 0.25, parts: ['lead', 'lead2'] },
  sections: [
    {
      ch: 'Cm | G/B | Cm/Bb | F/A | Ab | Fm | G | G7',
      lead: 'c5:1 eb5:1 g5:1 c6:1 g5:1 eb5:1 c5:1 g4:1 c5:2 eb5:2 g5:4 | b4:1 d5:1 g5:1 b5:1 g5:1 d5:1 b4:1 g4:1 b4:2 d5:2 g5:4 | ' +
        'bb4:1 eb5:1 g5:1 c6:1 g5:1 eb5:1 bb4:1 g4:1 bb4:2 eb5:2 g5:4 | a4:1 c5:1 f5:1 a5:1 f5:1 c5:1 a4:1 f4:1 a4:2 c5:2 f5:4 | ' +
        'ab4:1 c5:1 eb5:1 ab5:1 eb5:1 c5:1 ab4:1 eb4:1 c6:4 bb5:2 ab5:2 | f4:1 ab4:1 c5:1 f5:1 c5:1 ab4:1 f4:1 c4:1 ab5:4 g5:2 f5:2 | ' +
        'g4:1 b4:1 d5:1 g5:1 d5:1 b4:1 g4:1 d4:1 g5:4 f5:2 eb5:2 | d5:4 f5:4 b5:4 d6:4',
      lead2: 'c6:16 | r:16 | g5:16 | r:16 | ab5:16 | r:16 | g5:16 | b5:16',
      bass: '1-------5-------',
      pad: 'x-------x-------',
      k: 'o.......o.......',
      s: '',
      h: '',
      x: '....t.......T...',
    },
    {
      ch: 'Ab | Eb/G | Fm | Cm | Ab | Eb | Fm | G7',
      lead: 'c6:4 bb5:2 ab5:2 g5:4 eb5:4 | bb5:4 ab5:2 g5:2 eb5:8 | ab5:4 g5:2 f5:2 c5:4 ab4:4 | g4:4 c5:4 eb5:4 g5:4 | ' +
        'c6:4 eb6:4 ab6:4 g6:2 f6:2 | g6:4 eb6:4 bb5:8 | ab5:4 c6:4 f6:4 eb6:2 d6:2 | d6:4 b5:4 g5:4 f5:4',
      lead2: 'r:16 | eb6:16 | r:16 | c6:16 | r:16 | g5:16 | r:16 | d6:16',
      k: 'x.......x...x...',
      x: '....t.......T.t.',
      cr: true,
    },
  ],
};

// VAMPIRE_BOSS — the vampire lords: E phrygian at 148 BPM, a square-wave lead, bassoon riff with the flat second,
// church organ stabs, heavy drums; a half-time doom section.
const VAMPIRE_BOSS: TrackDef = {
  bpm: 148,
  gain: 0.75,
  inst: { lead: 'sqlead', bass: 'bassoon', pad: 'organ', arp: 'arp' },
  bassLo: 33,
  mix: { arp: 0.75, bass: 0.9, pad: 1 },
  sections: [
    {
      ch: 'Em | F | Em | F | Am | G | F | B7',
      lead: 'e5:2 r:2 e5:2 f5:2 g5:2 f5:2 e5:4 | f5:2 r:2 f5:2 g5:2 a5:2 g5:2 f5:4 | e5:2 g5:2 b5:2 e6:2 d6:2 b5:2 g5:4 | f5:2 a5:2 c6:2 f6:2 e6:2 c6:2 a5:4 | ' +
        'a5:4 c6:4 e6:4 a6:4 | g6:4 d6:4 b5:4 g5:4 | f6:2 e6:2 c6:2 a5:2 f5:4 a5:4 | b5:2 d#6:2 f#6:2 a6:2 b6:8',
      bass: '1.1.1u1.1.1.5.u.',
      arp: 'abcdcbabcdcbabcd',
      pad: 'x-------x-------',
      k: 'x.x...x.x.x...x.',
      s: '....x.......x...',
      h: 'xoxoxoxoxoxoxoxo',
      x: '',
      cr: true,
      fill: { s: '....x...x.x.xxxx', x: '........t.t.T.T.' },
    },
    {
      ch: 'Em | Em | C | C | Am | Am | B | B7',
      lead: 'b4:8 c5:4 b4:4 | e5:8 g5:4 f#5:4 | e5:8 c5:4 g4:4 | c5:16 | a4:8 c5:4 e5:4 | a5:8 g5:4 e5:4 | d#5:8 f#5:4 a5:4 | b5:16',
      bass: '1-------1---5---',
      arp: 'a...c...b...c...',
      k: 'x.......x.......',
      s: '........x.......',
      h: 'x...x...x...x...',
      cr: false,
      fill: { s: '........x...x.xx', x: 'C...............' },
    },
  ],
};

const TRACKS: Record<MusicName, TrackDef> = {
  menu: MENU,
  forest: FOREST,
  pantry: PANTRY,
  feast: FEAST,
  library: LIBRARY,
  chase: CHASE,
  boss: BOSS,
  boss2: BOSS2,
  ending: ENDING,
  den: DEN,
  tension: TENSION,
  credits: CREDITS,
  hub_day: HUB_DAY,
  night_town: NIGHT_TOWN,
  swamp: SWAMP,
  garden: GARDEN,
  pass: PASS,
  castle: CASTLE,
  vampire_boss: VAMPIRE_BOSS,
};

// ---------- compiler: track data -> per-step event list ----------

interface Chord {
  root: number;   // pitch class
  iv: number[];   // intervals
  bass: number;   // pitch class of the bass note (slash chords)
  arpT?: number[];
  padT?: number[];
}
interface CNote { part: PartKey; m: number; d: number; v: number }
interface CDrum { k: DrumKind; v: number }
interface CStep { n: CNote[]; dr: CDrum[] }
interface Compiled {
  steps: CStep[];
  stepDur: number;
  swing: number;
  gain: number;
  patches: Partial<Record<PartKey, Patch>>;
  mix: Record<PartKey | 'drums', number>;
  delay: { time: number; fb: number; mix: number } | null;
  delayParts: PartKey[];
}

const PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const QUAL: Record<string, number[]> = {
  '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
  mmaj7: [0, 3, 7, 11], m6: [0, 3, 7, 9], '6': [0, 4, 7, 9], dim: [0, 3, 6], dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10], aug: [0, 4, 8], sus4: [0, 5, 7], sus2: [0, 2, 7], add9: [0, 4, 7, 14],
  '9': [0, 4, 7, 10, 14],
};
const MEL_RE = /^([a-gr])([#b]?)(-?\d)?(?::(\d+))?([!?]?)$/;
const CH_RE = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/;
const INHERIT = ['bass', 'arp', 'pad', 'k', 's', 'h', 'x'] as const;
const DRUM_MAP: Record<DrumLine, Record<string, [DrumKind, number]>> = {
  k: { x: ['kick', 1], o: ['kick', 0.55] },
  s: { x: ['snare', 1], o: ['snare', 0.5], c: ['clap', 0.9] },
  h: { x: ['hat', 1], o: ['hat', 0.5], O: ['ohat', 0.8] },
  x: {
    b: ['block', 0.9], B: ['blockHi', 0.8], c: ['clap', 0.9], s: ['shaker', 1], t: ['tom', 0.9],
    T: ['tomHi', 0.9], C: ['crash', 1], H: ['heart', 1], h: ['heart', 0.55], k: ['kick', 0.8], o: ['ohat', 0.8],
  },
};

const acc = (s: string | undefined): number => (s === '#' ? 1 : s === 'b' ? -1 : 0);
const place = (pc: number, lo: number): number => lo + mod12(pc - lo);

/** Parses an MML-ish melody, calling emit for each note. Returns the total length in steps. */
function parseMel(src: string, tr: number, limit: number, emit: (at: number, m: number, d: number, v: number) => void): number {
  let pos = 0;
  let len = 2;
  for (const tok of src.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const mm = MEL_RE.exec(tok.toLowerCase());
    if (!mm) continue;
    if (mm[4]) len = Math.max(1, parseInt(mm[4], 10));
    if (mm[1] !== 'r' && mm[3] !== undefined) {
      const midi = 12 * (parseInt(mm[3], 10) + 1) + (PC[mm[1]] ?? 0) + acc(mm[2]) + tr;
      if (pos < limit) emit(pos, midi, Math.min(len, limit - pos), mm[5] === '!' ? 1 : mm[5] === '?' ? 0.55 : 0.8);
    }
    pos += len;
  }
  return pos;
}

function parseChord(sym: string, tr: number): Chord | null {
  const m = CH_RE.exec(sym);
  if (!m) return null;
  const root = mod12((PC[m[1].toLowerCase()] ?? 0) + acc(m[2]) + tr);
  const iv = QUAL[m[3]] ?? QUAL[''];
  const bass = m[4] ? mod12((PC[m[4].toLowerCase()] ?? 0) + acc(m[5]) + tr) : root;
  return { root, iv, bass };
}

function arpTones(ch: Chord, lo: number): number[] {
  if (ch.arpT) return ch.arpT;
  const pcs = ch.iv.map((i) => mod12(ch.root + i));
  const out: number[] = [];
  for (let m = lo; out.length < 8 && m < lo + 48; m++) if (pcs.includes(mod12(m))) out.push(m);
  while (out.length < 8) out.push(out.length ? out[out.length - 1] + 12 : lo);
  ch.arpT = out;
  return out;
}

function padTones(ch: Chord, mid: number): number[] {
  if (ch.padT) return ch.padT;
  const pcs = Array.from(new Set(ch.iv.map((i) => mod12(ch.root + i))));
  const out = pcs.map((pc) => place(pc, mid - 6)).sort((a, b) => a - b);
  ch.padT = out;
  return out;
}

function bassNote(c: string, ch: Chord, lo: number, next: Chord): number | null {
  const r = place(ch.root, lo);
  switch (c) {
    case '1': return place(ch.bass, lo);
    case '3': return r + (ch.iv[1] ?? 4);
    case '5': return r + (ch.iv[2] ?? 7);
    case '7': return r + (ch.iv[3] ?? 12);
    case '8': return r + 12;
    case '0': return r + (ch.iv[2] ?? 7) - 12;
    case '2': return r + 2;
    case '4': return r + 5;
    case '6': return r + 9;
    case 'b': return r + 10;
    case 'm': return r + 8;
    case 'f': return r + 6;
    case 'u': return r + 1;
    case 'n': return r - 1;
    case 'a': return place(next.root, lo) - 1;
    default: return null;
  }
}

/** Walks a cyclic pattern string; calls fn for each trigger with its held length. */
function runPattern(tmpl: string | undefined, n: number, fn: (i: number, ch: string, d: number) => void): void {
  if (!tmpl) return;
  const L = tmpl.length;
  for (let i = 0; i < n; i++) {
    const c = tmpl[i % L];
    if (c === '.' || c === '-' || c === ' ') continue;
    let d = 1;
    while (i + d < n && tmpl[(i + d) % L] === '-') d++;
    fn(i, c, d);
  }
}

function compileSection(sec: Section, def: TrackDef, steps: CStep[]): void {
  const tr = def.tr ?? 0;
  const bassLo = def.bassLo ?? 38;
  const arpLo = def.arpLo ?? 62;
  const padMid = def.padMid ?? 60;
  const bars = sec.ch.split('|');
  const N = bars.length * 16;
  const chordAt: Array<Chord | null> = new Array<Chord | null>(N).fill(null);
  let prevBar: Array<Chord | null> = [null];
  bars.forEach((b, bi) => {
    const syms = b.trim().split(/\s+/).filter(Boolean);
    const chs = syms.length === 0 || (syms.length === 1 && syms[0] === '%') ? prevBar : syms.map((s) => parseChord(s, tr));
    const per = 16 / chs.length;
    for (let s = 0; s < 16; s++) chordAt[bi * 16 + s] = chs[Math.min(chs.length - 1, Math.floor(s / per))] ?? null;
    prevBar = chs;
  });

  const base = steps.length;
  for (let i = 0; i < N; i++) steps.push({ n: [], dr: [] });
  const addN = (i: number, note: CNote): void => { steps[base + i].n.push(note); };
  const addD = (i: number, k: DrumKind, v: number): void => { steps[base + i].dr.push({ k, v }); };

  if (sec.lead) parseMel(sec.lead, tr, N, (i, m, d, v) => addN(i, { part: 'lead', m, d, v }));
  if (sec.lead2) parseMel(sec.lead2, tr, N, (i, m, d, v) => addN(i, { part: 'lead2', m, d, v }));

  runPattern(sec.bass, N, (i, c, d) => {
    const ch = chordAt[i];
    if (!ch) return;
    let next: Chord = ch;
    if (c === 'a') {
      let j = i + 1;
      while (j < i + N && chordAt[j % N] === ch) j++;
      next = chordAt[j % N] ?? ch;
    }
    const m = bassNote(c, ch, bassLo, next);
    if (m !== null) addN(i, { part: 'bass', m, d, v: i % 4 === 0 ? 1 : 0.82 });
  });

  runPattern(sec.arp, N, (i, c, d) => {
    const ch = chordAt[i];
    if (!ch) return;
    const idx = c.charCodeAt(0) - 97;
    if (idx < 0 || idx > 7) return;
    addN(i, { part: 'arp', m: arpTones(ch, arpLo)[idx], d, v: i % 2 === 0 ? 0.9 : 0.7 });
  });

  runPattern(sec.pad, N, (i, c, d) => {
    const ch = chordAt[i];
    if (!ch || c !== 'x') return;
    for (const m of padTones(ch, padMid)) addN(i, { part: 'pad', m, d, v: 0.8 });
  });

  const lastBar = N - 16;
  for (const line of ['k', 's', 'h', 'x'] as const) {
    const main = sec[line];
    const fill = sec.fill ? sec.fill[line] : undefined;
    const map = DRUM_MAP[line];
    for (let i = 0; i < N; i++) {
      let c: string | undefined;
      if (fill !== undefined && i >= lastBar) c = fill[i - lastBar];
      else if (main) c = main[i % main.length];
      if (!c || c === '.') continue;
      const hit = map[c];
      if (hit) addD(i, hit[0], hit[1]);
    }
  }
  if (sec.cr) addD(0, 'crash', 1);
}

function compileTrack(def: TrackDef): Compiled {
  const resolved: Section[] = [];
  let prev: Section | null = null;
  for (const s of def.sections) {
    const r: Section = { ...s };
    if (prev) for (const k of INHERIT) if (r[k] === undefined) r[k] = prev[k];
    resolved.push(r);
    prev = r;
  }
  const order = def.order ?? resolved.map((_, i) => i);
  const steps: CStep[] = [];
  for (const si of order) {
    const sec = resolved[si];
    if (sec) compileSection(sec, def, steps);
  }
  if (steps.length === 0) steps.push({ n: [], dr: [] });
  const stepDur = 60 / def.bpm / 4;
  const patches: Partial<Record<PartKey, Patch>> = {};
  for (const part of ['lead', 'lead2', 'bass', 'arp', 'pad'] as const) {
    const pn = def.inst[part];
    if (pn) patches[part] = PATCHES[pn];
  }
  const mx = def.mix ?? {};
  return {
    steps,
    stepDur,
    swing: clamp(def.swing ?? 0, 0, 0.35),
    gain: def.gain ?? 0.85,
    patches,
    mix: {
      lead: mx.lead ?? 1, lead2: mx.lead2 ?? 1, bass: mx.bass ?? 1,
      arp: mx.arp ?? 1, pad: mx.pad ?? 1, drums: mx.drums ?? 1,
    },
    delay: def.delay ? { time: Math.min(1.9, def.delay.steps * stepDur), fb: def.delay.fb, mix: def.delay.mix } : null,
    delayParts: def.delay ? def.delay.parts : [],
  };
}

const compiledCache: Partial<Record<MusicName, Compiled>> = {};
function getCompiled(name: MusicName): Compiled {
  let c = compiledCache[name];
  if (!c) {
    c = compileTrack(TRACKS[name]);
    compiledCache[name] = c;
  }
  return c;
}

// ---------- player + lookahead scheduler ----------

class Player {
  readonly name: MusicName;
  readonly trk: Compiled;
  readonly out: GainNode;
  private send: GainNode | null = null;
  private extra: AudioNode[] = [];
  step = 0;
  next: number;
  endAt = Infinity;   // stop scheduling new notes after this time
  killAt = Infinity;  // disconnect the player after this time
  fading = false;

  constructor(c: Ctx, dest: AudioNode, name: MusicName, trk: Compiled, start: number, fadeIn: number) {
    this.name = name;
    this.trk = trk;
    this.next = start;
    this.out = c.createGain();
    const now = c.currentTime;
    if (fadeIn > 0.01) {
      this.out.gain.value = 0;
      this.out.gain.setValueAtTime(0, now);
      this.out.gain.linearRampToValueAtTime(trk.gain, now + fadeIn);
    } else {
      this.out.gain.setValueAtTime(trk.gain, now);
    }
    this.out.connect(dest);
    if (trk.delay) {
      // feedback echo: send -> delay -> lowpass -> (feedback -> delay) & -> out
      const send = c.createGain();
      send.gain.value = trk.delay.mix;
      const dl = c.createDelay(2);
      dl.delayTime.value = trk.delay.time;
      const fb = c.createGain();
      fb.gain.value = trk.delay.fb;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2600;
      send.connect(dl);
      dl.connect(lp);
      lp.connect(fb);
      fb.connect(dl);
      lp.connect(this.out);
      this.send = send;
      this.extra.push(send, dl, fb, lp);
    }
  }

  pump(c: Ctx, until: number): void {
    const sd = this.trk.stepDur;
    const n = this.trk.steps.length;
    const now = c.currentTime;
    if (this.next < now - 0.05) {
      // fell behind (tab throttled / main thread stall): skip ahead, keep the groove position
      const k = Math.ceil((now + 0.02 - this.next) / sd);
      this.step = (this.step + k) % n;
      this.next += k * sd;
    }
    let guard = 0;
    while (this.next < until && this.next < this.endAt && guard++ < 512) {
      this.play(c, this.step, this.next);
      this.step = (this.step + 1) % n;
      this.next += sd;
    }
  }

  private play(c: Ctx, i: number, t0: number): void {
    const tr = this.trk;
    const st = tr.steps[i];
    if (!st) return;
    const t = t0 + (tr.swing > 0 && i % 4 === 2 ? tr.swing * 2 * tr.stepDur : 0);
    for (const n of st.n) {
      const pt = tr.patches[n.part];
      if (!pt) continue;
      const send = this.send && tr.delayParts.includes(n.part) ? this.send : null;
      voice(c, pt, n.m, t, Math.max(0.03, n.d * tr.stepDur - 0.012), n.v * tr.mix[n.part], this.out, send);
    }
    for (const d of st.dr) drum(c, d.k, t, d.v * tr.mix.drums, this.out);
  }

  fadeOut(c: Ctx, sec: number, tail = MUSIC_TAIL): void {
    const now = c.currentTime;
    const g = this.out.gain;
    const cur = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(cur, now);
    g.linearRampToValueAtTime(0, now + sec);
    this.endAt = Math.min(this.endAt, now + sec);
    this.killAt = Math.min(this.killAt, now + sec + tail);
    this.fading = true;
  }

  dispose(): void {
    try { this.out.disconnect(); } catch { /* ignore */ }
    for (const n of this.extra) {
      try { n.disconnect(); } catch { /* ignore */ }
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// 6. Engine state + public API
// ════════════════════════════════════════════════════════════════════════

let ctx: AudioContext | null = null;
let musicIn: GainNode | null = null;   // duck gain: players connect here
let musicVolNode: GainNode | null = null;
let sfxNode: GainNode | null = null;
let musicVolume = 0.8;
let sfxVolume = 0.9;
let masterVolume = 1;
let masterNode: GainNode | null = null;
let duckAmount = 1;
let current: MusicName | null = null;
let pending: MusicName | null = null;
let timer: number | null = null;
const players: Player[] = [];
const lastSfx: Partial<Record<SfxName, number>> = {};
const sfxEnds: number[] = [];

/**
 * Volume slider position (0..1, 20 steps in the settings) → gain. Loudness taper: dB = −50·(1−v)^1.5, so the first
 * step is ≈ −46 dB (barely there), the middle ≈ −18 dB, 16/20 ≈ −4.5 dB, the top 0 dB; 0 is silence. A linear gain
 * made 1 of 10 squares still −20 dB — "loud, like 30%". The voice chat uses the same curve for friends' voices.
 */
export function sliderGain(v: number): number {
  if (!(v > 0.001)) return 0;
  return Math.pow(10, (-50 * Math.pow(1 - Math.min(1, v), 1.5)) / 20);
}

function smooth(param: AudioParam, v: number, tau: number): void {
  if (!ctx) return;
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.setTargetAtTime(v, now, tau);
}

function tryResume(): void {
  const c = ctx;
  if (!c) return;
  const st = c.state as string;
  if (st === 'suspended' || st === 'interrupted') {
    try {
      const pr = c.resume();
      if (pr && typeof pr.catch === 'function') pr.catch(() => { /* needs a user gesture */ });
    } catch { /* ignore */ }
  }
}

function tick(): void {
  const c = ctx;
  if (!c) return;
  try {
    const hidden = typeof document !== 'undefined' && document.hidden;
    const until = c.currentTime + (hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD);
    for (let i = players.length - 1; i >= 0; i--) {
      const p = players[i];
      if (p.fading && c.currentTime > p.killAt) {
        p.dispose();
        players.splice(i, 1);
        continue;
      }
      p.pump(c, until);
    }
    if (players.length === 0) stopTimer();
  } catch { /* the scheduler must never throw */ }
}

function ensureTimer(): void {
  if (timer === null && typeof window !== 'undefined') timer = window.setInterval(tick, TICK_MS);
}

function stopTimer(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

function startTrack(name: MusicName): void {
  const c = ctx;
  if (!c || !musicIn) return;
  const trk = getCompiled(name);
  const now = c.currentTime;
  let hadActive = false;
  for (const p of players) {
    if (!p.fading) {
      p.fadeOut(c, CROSSFADE);
      hadActive = true;
    }
  }
  // rapid switching: keep at most MAX_FADING players around, quickly silencing the oldest
  let fadingCount = 0;
  for (let i = players.length - 1; i >= 0; i--) {
    const p = players[i];
    if (p.fading && ++fadingCount > MAX_FADING) p.fadeOut(c, 0.05, 0.1);
  }
  const pl = new Player(c, musicIn, name, trk, now + 0.06, hadActive ? CROSSFADE : 0.03);
  players.push(pl);
  pl.pump(c, now + LOOKAHEAD);
  ensureTimer();
}

function buildGraph(c: AudioContext): void {
  setupShared(c);
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.004;
  comp.release.value = 0.25;
  comp.connect(c.destination);
  const master = c.createGain();
  master.gain.value = MASTER_GAIN * sliderGain(masterVolume);
  master.connect(comp);
  masterNode = master;
  musicVolNode = c.createGain();
  musicVolNode.gain.value = sliderGain(musicVolume);
  musicVolNode.connect(master);
  musicIn = c.createGain();
  musicIn.gain.value = duckAmount;
  musicIn.connect(musicVolNode);
  sfxNode = c.createGain();
  sfxNode.gain.value = sliderGain(sfxVolume);
  sfxNode.connect(master);
}

export const audio: AudioApi = {
  init(): void {
    try {
      if (!ctx) {
        if (typeof window === 'undefined') return;
        const AC: typeof AudioContext | undefined = window.AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        const c = new AC();
        ctx = c;
        buildGraph(c);
      }
      tryResume();
      if (pending) {
        const n = pending;
        pending = null;
        if (current === n) startTrack(n);
      }
    } catch { /* audio unavailable — the game keeps running silently */ }
  },

  sfx(name: SfxName, opts?: { volume?: number; pitch?: number; pan?: number }): void {
    try {
      const c = ctx;
      if (!c || !sfxNode) return;
      if (c.state !== 'running') {
        // don't queue sounds on a frozen clock (they would all fire at once on resume)
        tryResume();
        return;
      }
      const def = SFX[name];
      if (!def) return;
      const v = clamp(num(opts ? opts.volume : undefined, 1), 0, 1);
      const p = clamp(num(opts ? opts.pitch : undefined, 1), 0.25, 4);
      if (v <= 0.001) return;
      const now = c.currentTime;
      const last = lastSfx[name];
      if (last !== undefined && now >= last && now - last < (def.gap ?? 0.012)) return;
      // voice limiting
      let w = 0;
      for (let i = 0; i < sfxEnds.length; i++) if (sfxEnds[i] > now) sfxEnds[w++] = sfxEnds[i];
      sfxEnds.length = w;
      if (w >= MAX_SFX_VOICES && !def.pri) return;
      lastSfx[name] = now;
      sfxEnds.push(now + def.dur);
      const pan = clamp(num(opts ? opts.pan : undefined, 0), -1, 1);
      if (Math.abs(pan) > 0.02 && typeof c.createStereoPanner === 'function') {
        // positional: through a stereo panner of its own, dropped when the sound is over
        const pn = c.createStereoPanner();
        pn.pan.value = pan;
        pn.connect(sfxNode);
        def.fn(c, pn, now + 0.005, p, v);
        setTimeout(() => { try { pn.disconnect(); } catch { /* gone */ } }, (def.dur + 0.6) * 1000);
      } else def.fn(c, sfxNode, now + 0.005, p, v);
    } catch { /* never throw from sfx */ }
  },

  playMusic(name: MusicName): void {
    try {
      if (!TRACKS[name]) return;
      if (name === current) return;
      current = name;
      if (!ctx) {
        pending = name;
        return;
      }
      startTrack(name);
    } catch { /* ignore */ }
  },

  stopMusic(fadeSec?: number): void {
    try {
      current = null;
      pending = null;
      const c = ctx;
      if (!c) return;
      const f = clamp(num(fadeSec, 1), 0.02, 30);
      for (const p of players) if (!p.fading) p.fadeOut(c, f);
    } catch { /* ignore */ }
  },

  setMusicVolume(v: number): void {
    try {
      musicVolume = clamp(num(v, musicVolume), 0, 1);
      if (musicVolNode) smooth(musicVolNode.gain, sliderGain(musicVolume), 0.03);
    } catch { /* ignore */ }
  },

  setSfxVolume(v: number): void {
    try {
      sfxVolume = clamp(num(v, sfxVolume), 0, 1);
      if (sfxNode) smooth(sfxNode.gain, sliderGain(sfxVolume), 0.03);
    } catch { /* ignore */ }
  },

  setMasterVolume(v: number): void {
    try {
      masterVolume = clamp(num(v, masterVolume), 0, 1);
      if (masterNode) smooth(masterNode.gain, MASTER_GAIN * sliderGain(masterVolume), 0.03);
    } catch { /* ignore */ }
  },

  getMusicVolume(): number {
    return musicVolume;
  },

  getSfxVolume(): number {
    return sfxVolume;
  },

  getMasterVolume(): number {
    return masterVolume;
  },

  duckMusic(amount: number): void {
    try {
      duckAmount = clamp(num(amount, 1), 0, 1);
      if (musicIn) smooth(musicIn.gain, duckAmount, 0.1);
    } catch { /* ignore */ }
  },

  currentMusic(): MusicName | null {
    return current;
  },
};

/**
 * Dev / tests only: render a music track (`sec` seconds) or one sound effect into an AudioBuffer through an
 * OfflineAudioContext — nothing is ever played (no speakers involved), so procedural audio can be checked (levels,
 * spectrum, length) in a muted test browser. Not used by the game.
 */
export async function renderOffline(what: { music?: MusicName; sfx?: SfxName; sec?: number; rate?: number; pitch?: number }): Promise<AudioBuffer | null> {
  if (typeof OfflineAudioContext === 'undefined') return null;
  const sec = clamp(num(what.sec, 4), 0.1, 30);
  const rate = clamp(num(what.rate, 22050), 8000, 48000);
  const c = new OfflineAudioContext(2, Math.ceil(sec * rate), rate);
  setupShared(c);
  try {
    const out = c.createGain();
    out.connect(c.destination);
    if (what.music && TRACKS[what.music]) {
      const pl = new Player(c, out, what.music, getCompiled(what.music), 0.02, 0);
      for (let t = 0.5; t < sec + 0.5; t += 0.5) pl.pump(c, Math.min(sec, t));
    } else if (what.sfx && SFX[what.sfx]) {
      SFX[what.sfx].fn(c, out, 0.01, clamp(num(what.pitch, 1), 0.25, 4), 1);
    } else return null;
  } finally {
    // pulse waves belong to one context: give the live one its own back right away
    if (ctx) setupShared(ctx);
  }
  return c.startRendering();
}
