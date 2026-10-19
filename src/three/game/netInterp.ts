import * as THREE from 'three';
import { clamp } from '../../engine/util';

/**
 * Smooth playback of replicated movement (friends' heroes, the host's enemy snapshots).
 *
 * Chasing the newest packet turns jittery or bursty arrival into rubber-banding, and 2.5 Hz relay updates into
 * teleports. Instead every stream is played back a little in the past, between two samples that already arrived:
 *
 *  • NetClock — one per sender stream. Samples carry the SENDER's clock. base = the smallest (arrival − sent) of the
 *    last few seconds (fastest trip + clock offset). A sample k is needed when playback leaves sample k−1, so it has to
 *    be there (gap to the previous sample + its lateness above base) after the playback point; the delay is that,
 *    in the worst ~15 % of the window, clamped to 70–700 ms. That is ≈ 1.2 × interval + 2 × jitter in practice:
 *    clean P2P at 15 Hz ≈ 80–100 ms, P2P with 80 ms of jitter ≈ 250 ms, relay batches (10 Hz samples flushed
 *    2.5×/s) ≈ 0.5 s (more when Supabase is slow: its delivery time was seen swinging by a second). Changes are
 *    eased (playback runs at 85–125 % speed): it never jumps or runs backwards. When starved anyway, playback
 *    waits just past the newest sample (time stretches) instead of skipping data when it finally comes.
 *  • NetTrack — one per replicated thing. Cubic Hermite through the samples using the sent velocities (or finite
 *    differences), ≤ 140 ms of eased-out extrapolation when starved, and a step — never a slide — across a teleport
 *    (the sender's counter changed) or a physically impossible jump. When a late sample rewrites what was already
 *    on screen (the extrapolation guessed wrong) the difference fades out over ~0.1 s instead of popping.
 *    Discrete fields (anim state, attack start, flags) are handed out as the playback passes their sample, so a
 *    swing shows where it happened; continuous ones (a face, a timer) are read in between with `lerp()`.
 *    Big things with several moving parts (a boss: body + palms, servants…) keep one NetTrack per part, all fed
 *    the same snapshot time and played at the same NetLevel.playT. Host events that go with what such a puppet
 *    shows (a palm lands, a wall bursts) are delivered at that playback time too (`Netted.netTimed`).
 *
 * Times are seconds; `now` is performance.now() / 1000 on this machine.
 */

const MIN_DELAY = 0.07;
const MAX_DELAY = 0.7;
/** history used for base / delay (s) */
const WINDOW = 4;
/** the delay covers this share of the samples (the rest: extrapolation for a moment) */
const QUANTILE = 0.85;
/** starved: keep moving at full speed this long, then ease to a stop over EXT_EASE (140 ms in all: longer guesses overshoot turns) */
const EXT_FULL = 0.04;
const EXT_EASE = 0.1;
/** starved: the playback waits this far past the newest sample (the next packets play on from there, no jump) */
const HOLD = 0.15;
/** a segment longer than this is a hole (sender frozen, thing out of snapshot range): step, don't slide (a slow relay can leave ~1.5 s between samples) */
const MAX_GAP = 2;
/** samples closer than this (sender time) are one sample: the newer one replaces the older */
const MERGE = 0.025;
/** a velocity estimated from positions looks back at least this far (two samples 2 ms apart say nothing) */
const VEL_BASE = 0.05;
/** a correction offset fades with this time constant; a bigger one than ERR_SNAP is dropped at once */
const ERR_TAU = 0.1;
const ERR_SNAP = 3;

/** clock of one sender stream: when (in the sender's time) to show things now */
export class NetClock {
  /** current playback delay above base (s) and the target it eases to — for stats / the debug overlay */
  delay = 0.12;
  target = 0.12;
  /** median sender interval (s) */
  interval = 1 / 15;
  /** samples that arrived after the playback had already passed their time */
  late = 0;
  private base = NaN;
  /** local time − sender time used for playback (base + delay, eased) */
  private lag = NaN;
  private hist: { at: number; off: number; gap: number }[] = [];
  private newest = NaN;
  private lastPlay = NaN;
  private startAt = 0;

  reset() {
    this.hist = [];
    this.base = this.lag = this.newest = this.lastPlay = NaN;
  }

  /** a sample sent at sender time t arrived at local time at */
  note(t: number, at: number) {
    if (!Number.isFinite(t) || !Number.isFinite(at)) return;
    // the sender's clock jumped (reloaded tab, new host, very long freeze): start over
    if (Number.isFinite(this.newest) && (t < this.newest - 3 || t > this.newest + 15)) this.reset();
    const off = at - t;
    const gap = Number.isFinite(this.newest) && t > this.newest ? Math.min(t - this.newest, MAX_DELAY) : 0;
    if (!(t <= this.newest)) this.newest = t;
    if (Number.isFinite(this.lag) && t < at - this.lag) this.late++;
    if (!this.hist.length) this.startAt = at;
    this.hist.push({ at, off, gap });
    while (this.hist.length > 1 && (at - this.hist[0].at > WINDOW || this.hist.length > 160)) this.hist.shift();
    let base = Infinity;
    for (const h of this.hist) if (h.off < base) base = h.off;
    this.base = base;
    const need: number[] = [];
    const gaps: number[] = [];
    for (const h of this.hist) { need.push(h.gap + h.off - base); if (h.gap > 0) gaps.push(h.gap); }
    need.sort((a, b) => a - b);
    gaps.sort((a, b) => a - b);
    if (gaps.length) this.interval = gaps[gaps.length >> 1];
    // too few samples to judge: assume ~15 Hz with a little jitter
    const q = this.hist.length < 6 ? Math.max(0.12, need[need.length - 1]) : need[Math.min(need.length - 1, Math.floor(need.length * QUANTILE))];
    this.target = clamp(q + 0.012, MIN_DELAY, MAX_DELAY);
  }

  /** sender time to show at local time now (call once per frame or more; extra calls in one frame change nothing) */
  play(now: number): number {
    if (!Number.isFinite(this.base)) return -Infinity;
    const want = this.base + this.target;
    if (!Number.isFinite(this.lag) || Math.abs(want - this.lag) > 1.5 || now - this.startAt < 0.6) this.lag = want;
    else {
      const dt = clamp(now - this.lastPlay, 0, 0.25);
      const d = want - this.lag;
      // build up a delay by slowing playback a bit (faster while far behind), shed one by speeding up a bit;
      // small differences are left alone so playback speed doesn't wobble
      if (d > 0.004) this.lag += Math.min(d, dt * (d > 0.1 ? 0.3 : 0.15));
      else if (d < -0.02) this.lag += Math.max(d, -dt * (d < -0.3 ? 0.25 : 0.12));
    }
    // starved (nothing new for a moment): wait just past the newest sample rather than run ahead of the data —
    // the late packets then play on from there (a short stop) instead of skipping ahead (a jump); the extra
    // delay this builds up is shed again by the easing above
    if (now - this.lag > this.newest + HOLD) this.lag = now - this.newest - HOLD;
    this.lastPlay = now;
    this.delay = this.lag - this.base;
    return now - this.lag;
  }
}

/** pose evaluated at the playback time */
export interface NetPose { pos: THREE.Vector3; vel: THREE.Vector3; yaw: number }

interface Sample<T> {
  t: number;
  p: THREE.Vector3;
  /** sent velocity (null: estimate from the neighbours) */
  v: THREE.Vector3 | null;
  yaw: number;
  /** sender's teleport counter */
  tp: number;
  /** can't be reached by moving from the previous sample (teleport / impossible jump / hole): step to it */
  brk: boolean;
  d: T;
}

const ta = new THREE.Vector3();
const tb = new THREE.Vector3();
const tc = new THREE.Vector3();
const tmp = new THREE.Vector3();
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** the samples of one replicated thing, played back at the times its NetClock gives */
export class NetTrack<T> {
  private s: Sample<T>[] = [];
  /** visual correction that fades (new data rewrote what was already shown) */
  private err = new THREE.Vector3();
  private lastP = NaN;
  /** sender time of the newest sample whose discrete fields were handed out */
  private appliedT = -Infinity;
  /** index of the sample the last eval() was at (−1 = before the first) */
  private at = -1;
  private raw: NetPose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };
  /** after eval(): the playback crossed a teleport this frame */
  teleported = false;
  /** after eval(): discrete data of the sample at / before the playback, the next one (if any) and how far between (0..1) */
  cur: T | null = null;
  next: T | null = null;
  u = 0;

  /**
   * maxSpeed: anything faster between two samples is a teleport (m/s). errSnap: a correction bigger than this is
   * dropped at once instead of faded (fast things — a boss's palm — can be rewritten by more than a hero ever is).
   */
  constructor(private maxSpeed = 40, private errSnap = ERR_SNAP) {}

  get count() { return this.s.length; }
  /** the newest sample's data / position (no playback delay) */
  get newest(): T | null { return this.s.length ? this.s[this.s.length - 1].d : null; }
  newestPos(out: THREE.Vector3): THREE.Vector3 { const n = this.s[this.s.length - 1]; return n ? out.copy(n.p) : out; }

  clear() { this.s = []; this.err.set(0, 0, 0); this.lastP = NaN; this.appliedT = -Infinity; this.at = -1; this.cur = this.next = null; }

  /** a sample (sender time t). vx..vz undefined = no velocity sent. tp = the sender's teleport counter (or 0). */
  push(t: number, x: number, y: number, z: number, yaw: number, d: T, tp = 0, vx?: number, vy?: number, vz?: number): boolean {
    if (![t, x, y, z].every(Number.isFinite)) return false;
    const s = this.s;
    if (s.length && t < s[0].t) {
      // far older than everything: the sender's clock started over (reloaded tab, new host) — so do I
      if (t < s[s.length - 1].t - 3) this.clear();
      // older than what playback already left behind: useless
      else return false;
    }
    let i = s.length;
    while (i > 0 && s[i - 1].t > t) i--;
    const smp: Sample<T> = {
      t, p: new THREE.Vector3(x, y, z), yaw: Number.isFinite(yaw) ? yaw : 0, tp, brk: false, d,
      v: vx !== undefined && Number.isFinite(vx) && Number.isFinite(vy!) && Number.isFinite(vz!) ? new THREE.Vector3(vx, vy!, vz!) : null,
    };
    const shown = Number.isFinite(this.lastP);
    if (shown) this.evalRaw(this.lastP, ta);
    if (i > 0 && t - s[i - 1].t < MERGE) {
      // a near-duplicate (the sender caught up after a slow frame): keep the newer one
      smp.t = Math.max(t, s[i - 1].t);
      s[i - 1] = smp; i--;
    } else if (i < s.length && s[i].t - t < MERGE) return true; // an older near-duplicate of one I have
    else s.splice(i, 0, smp);
    this.mark(i);
    if (i + 1 < s.length) this.mark(i + 1);
    if (shown) {
      // what this sample changed on screen right now is kept as an offset that fades
      this.evalRaw(this.lastP, tb);
      this.err.add(ta.sub(tb));
      if (this.err.length() > this.errSnap) this.err.set(0, 0, 0);
    }
    if (s.length > 64) { s.splice(0, s.length - 64); this.at = Math.min(this.at, s.length - 1); }
    return true;
  }

  /** sample i can't be reached from sample i−1 by moving */
  private mark(i: number) {
    const s = this.s, b = s[i], a = s[i - 1];
    if (!b) return;
    if (!a) { b.brk = false; return; }
    const h = b.t - a.t;
    b.brk = b.tp !== a.tp || h > MAX_GAP || a.p.distanceTo(b.p) > this.maxSpeed * h + 1.5;
  }

  /** index of the last sample with t ≤ p (−1 = none) */
  private find(p: number): number {
    const s = this.s;
    let i = s.length - 1;
    while (i >= 0 && s[i].t > p) i--;
    return i;
  }

  /** velocity to use at a sample: the sent one unless it disagrees a lot with how it actually moved (chord) */
  private tangent(i: number, chord: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const s = this.s, k = s[i];
    if (!k.v) {
      // no velocity sent: through the neighbours (Catmull-Rom), limited per axis so it never overshoots
      // (a stop or a turn-around would otherwise swing past the sample and back)
      const a = s[i - 1], b = s[i + 1];
      if (!a || !b || k.brk || b.brk || !(k.t > a.t && b.t > k.t)) return out.copy(chord);
      const ha = k.t - a.t, hb = b.t - k.t;
      const lim = (pa: number, pk: number, pb: number) => {
        const d0 = (pk - pa) / ha, d1 = (pb - pk) / hb;
        if (d0 * d1 <= 0) return 0;
        const m = (pb - pa) / (ha + hb);
        const cap = 3 * Math.min(Math.abs(d0), Math.abs(d1));
        return Math.abs(m) > cap ? Math.sign(m) * cap : m;
      };
      return out.set(lim(a.p.x, k.p.x, b.p.x), lim(a.p.y, k.p.y, b.p.y), lim(a.p.z, k.p.z, b.p.z));
    }
    out.copy(k.v);
    const diff = tmp.copy(out).sub(chord).length();
    const lim = 1.5 + 0.35 * chord.length();
    if (diff > lim) out.lerp(chord, Math.min(1, (diff - lim) / lim));
    return out;
  }

  /** pose at sender time p, without the fading correction; returns the sample index it is at */
  private evalRaw(p: number, pos: THREE.Vector3, vel?: THREE.Vector3, pose?: NetPose): number {
    const s = this.s;
    const n = s.length;
    if (!n) return -1;
    const i = this.find(p);
    if (i < 0) {
      pos.copy(s[0].p);
      vel?.set(0, 0, 0);
      if (pose) pose.yaw = s[0].yaw;
      return -1;
    }
    const a = s[i], b = s[i + 1];
    if (!b || b.brk) {
      // starved (or waiting for a teleport): go on a moment with the last known velocity, then ease to a stop
      const tau = p - a.t;
      let v: THREE.Vector3 | null = a.v;
      if (!v) {
        // estimated from an older sample (far enough back to mean something, not across a teleport)
        let j = i - 1;
        while (j > 0 && a.t - s[j].t < VEL_BASE && !s[j + 1].brk) j--;
        const z = s[j];
        let ok = !!z && j < i && a.t - z.t >= VEL_BASE * 0.5;
        for (let q = j + 1; ok && q <= i; q++) if (s[q].brk) ok = false;
        v = ok ? tc.copy(a.p).sub(z.p).divideScalar(a.t - z.t) : null;
      }
      const e = tau - EXT_FULL;
      const f = tau <= EXT_FULL ? tau : e < EXT_EASE ? EXT_FULL + e - (e * e) / (2 * EXT_EASE) : EXT_FULL + EXT_EASE / 2;
      const df = tau <= EXT_FULL ? 1 : e < EXT_EASE ? 1 - e / EXT_EASE : 0;
      pos.copy(a.p);
      if (v) pos.addScaledVector(v, f);
      if (vel) { if (v) vel.copy(v).multiplyScalar(df); else vel.set(0, 0, 0); }
      if (pose) pose.yaw = a.yaw;
      return i;
    }
    const h = b.t - a.t;
    const u = clamp((p - a.t) / h, 0, 1);
    const chord = tc.copy(b.p).sub(a.p).divideScalar(h);
    const ma = this.tangent(i, chord, ta.clone());
    const mb = this.tangent(i + 1, chord, tb.clone());
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    pos.copy(a.p).multiplyScalar(h00).addScaledVector(ma, h10 * h).addScaledVector(b.p, h01).addScaledVector(mb, h11 * h);
    if (vel) {
      const d00 = (6 * u2 - 6 * u) / h, d10 = 3 * u2 - 4 * u + 1, d01 = (-6 * u2 + 6 * u) / h, d11 = 3 * u2 - 2 * u;
      vel.copy(a.p).multiplyScalar(d00).addScaledVector(ma, d10).addScaledVector(b.p, d01).addScaledVector(mb, d11);
    }
    if (pose) pose.yaw = a.yaw + wrapA(b.yaw - a.yaw) * u;
    return i;
  }

  /**
   * The pose at playback time p (sender's clock) into out; dt = frame time for the fading correction.
   * Then: `cur` / `next` / `u` (discrete data around p), `teleported` (crossed a teleport this frame).
   */
  eval(p: number, dt: number, out: NetPose): boolean {
    const s = this.s;
    this.teleported = false;
    if (!s.length || !Number.isFinite(p)) return false;
    const i = this.evalRaw(p, this.raw.pos, this.raw.vel, this.raw);
    // crossed a teleport (or a hole) since the last frame: no smoothing across it
    for (let k = Math.max(0, this.at + 1); k <= i; k++) if (s[k].brk) { this.teleported = this.at >= 0; this.err.set(0, 0, 0); }
    this.at = i;
    if (dt > 0) this.err.multiplyScalar(Math.exp(-dt / ERR_TAU));
    if (this.err.lengthSq() < 1e-6) this.err.set(0, 0, 0);
    out.pos.copy(this.raw.pos).add(this.err);
    out.vel.copy(this.raw.vel);
    out.yaw = this.raw.yaw;
    const a = s[Math.max(0, i)], b = i >= 0 ? s[i + 1] : undefined;
    this.cur = a.d;
    this.next = b && !b.brk ? b.d : null;
    this.u = b && i >= 0 ? clamp((p - a.t) / (b.t - a.t), 0, 1) : 0;
    this.lastP = p;
    // keep two samples behind the playback (neighbours for the tangents), drop older ones
    if (i > 2) { s.splice(0, i - 2); this.at -= i - 2; }
    return true;
  }

  /**
   * A number field of the samples around the playback (after eval()): linear from `cur` to `next` (angles the short
   * way round). Fields that are discrete or have a "none" value (−1) should be read from `cur` instead.
   */
  lerp(this: NetTrack<number[]>, i: number, angle = false): number {
    const a = this.cur, b = this.next;
    if (!a) return 0;
    const x = a[i];
    if (!b || !Number.isFinite(b[i]) || !Number.isFinite(x)) return x;
    return x + (angle ? wrapA(b[i] - x) : b[i] - x) * this.u;
  }

  /** hand out the discrete data of every sample the playback reached since the last call, oldest first */
  passed(p: number, f: (d: T) => void) {
    const s = this.s;
    if (!s.length) return;
    // nothing handed out yet: the first sample at once (flags like hidden / dead before the first frame)
    if (this.appliedT === -Infinity && s[0].t > p) { this.appliedT = s[0].t; f(s[0].d); return; }
    for (const k of s) {
      if (k.t <= this.appliedT) continue;
      if (k.t > p) break;
      this.appliedT = k.t;
      f(k.d);
    }
  }
}
