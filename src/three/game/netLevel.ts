import * as THREE from 'three';
import { audio } from '../../engine/audio';
import { net } from '../../net/session';
import type { Level3D } from './level';
import { RemoteHero3 } from './remoteHero';
import { NetClock } from './netInterp';

/**
 * Co-op glue for one Level3D (see docs/MULTIPLAYER.md):
 *  • a registry of replicated things by numeric netId (build-time ids follow build order, runtime ids come from the host);
 *  • remote heroes (state stream in, my hero's state stream out);
 *  • host → clients world snapshots + runtime spawns (clients play them back smoothly, see netInterp.ts);
 *  • the host's effects/sounds/barks inside the world tick are captured and replayed on clients;
 *  • every inbound message is queued and handled inside the fixed tick (never inside a network callback).
 */

/** something the host replicates to clients */
export interface Netted {
  netId: number;
  /** factory key for runtime spawns (see NET_SPAWN) */
  netKind?: string;
  /** host: compact state for the snapshot (omit = never in snapshots) */
  netSnap?(): number[];
  /** client: apply a snapshot record (values after the id); t = the host's clock when it was taken (NetLevel.playT plays it back) */
  netApply?(a: number[], t?: number): void;
  /** client: one-off event addressed to this thing (e.g. 'bat', 'reflect', 'burst') */
  netEvent?(L: Level3D, ev: string, data: unknown): void;
  /** client: host events that go with what the puppet shows (a palm lands, a wall bursts) — delivered when the
   *  playback (NetLevel.playT) reaches the moment the host sent them, not on arrival */
  netTimed?: readonly string[];
  /** the object barks/fx are anchored to (lets captured barks find their owner) */
  netRoot?: THREE.Object3D;
  /** skip this thing in snapshots when it is this far from every hero */
  netFar?: number;
  dead?: boolean;
}

/** runtime spawn factories: kind → (L, args) => thing (registered by the modules that own the classes) */
export const NET_SPAWN: Record<string, (L: Level3D, a: any) => Netted | null> = {};

/** game message types (on top of net.send/net.on) */
export const GM = {
  heroState: 'st', //        u  everyone → all
  snapshot: 'snap', //       u  host → all
  spawn: 'spawn', //            host → all {id, k, a}
  gone: 'gone', //              host → all {id, how, at, loot}
  fx: 'fx', //                  host → all [batch of captured calls]
  hurt: 'hurt', //              host → owner {d, f, k?, kt?}
  melee: 'melee', //            client → host: my swing
  pea: 'pea', //                client → host: my pea (host simulates it; the shooter sends the others a 'vpea')
  vpea: 'vpea', //              shooter → all: visual pea {f, v, t: launch net.time(), by?, c?: a client's (host ignores)}
  drop: 'drop', //              host → all: instanced loot drop {k, at}
  ent: 'ent', //                any → host / host → all: event for a netted thing {id, ev, d, ht?: host's net.time()}
  script: 'script', //          host → all: run story script
  arena: 'arena', //            host → all {i, s, w}
  candle: 'candle', //          host → all {i}
  grab: 'grab', //              host → owner {by}
  release: 'release', //        host → owner / owner → host
  level: 'lvl', //              host → all: load a level
  loaded: 'loaded', //          client → host
  go: 'go', //                  host → all: start the world
  end: 'end', //                host → all: level complete
  wipe: 'wipe', //              host → all: whole team down → restart from candle
  exitWait: 'exitw', //         host → all {n, of, t}
  noodleCut: 'ncut', //         host → all {i}
  seen: 'seen', //              host → all {k: new keys of L.seen} — so a new host rebuilds with the room's progress
} as const;

/** at = when it arrived (performance.now() / 1000), for the playback clocks */
type Msg = { type: string; data: any; from: string; at: number };

/** my hero's state stream and the host's snapshots, per second of real time */
const STATE_HZ = 15;
const SNAP_HZ = 12;
/** a timed event waits at most this long (local s) for the playback — the host's snapshots may have stopped */
const TIMED_MAX_WAIT = 1.5;
/** friends whose link fell back to the Supabase relay were told about it once (per page, not per level) */
const relayToasted = new Set<string>();

const v3 = (v: THREE.Vector3) => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
export const toV = (a: number[] | undefined, out = new THREE.Vector3()) => (a ? out.set(a[0], a[1], a[2]) : out.set(0, 0, 0));

/** serialize captured call args: Vector3 → {v:[..]}, arrays/objects recursively */
function ser(x: unknown): unknown {
  if (x instanceof THREE.Vector3) return { v: v3(x) };
  if (Array.isArray(x)) return x.map(ser);
  if (x && typeof x === 'object') { const o: Record<string, unknown> = {}; for (const [k, val] of Object.entries(x)) o[k] = ser(val); return o; }
  if (typeof x === 'number') return Math.round(x * 1000) / 1000;
  return x;
}
function des(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(des);
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    if (Array.isArray(o.v) && Object.keys(o).length === 1) return new THREE.Vector3(...(o.v as [number, number, number]));
    const r: Record<string, unknown> = {}; for (const [k, val] of Object.entries(o)) r[k] = des(val); return r;
  }
  return x;
}

const FX_METHODS = ['emit', 'sparks', 'dust', 'juice', 'stars', 'chunks', 'ring', 'text'] as const;

export class NetLevel {
  ents = new Map<number, Netted>();
  remotes = new Map<string, RemoteHero3>();
  private inbox: Msg[] = [];
  private unsubs: (() => void)[] = [];
  private buildSeq = 1;
  private dynSeq = 100000;
  /** send accumulators (real seconds) and the game time since the last send (keeps a burst of debug ticks streaming) */
  private stT = 0; private snapT = 0; private stGame = 0; private snapGame = 0;
  private lastPost = 0;
  /** client: playback of the host's snapshots (one clock: they all come from the host) */
  readonly snapClock = new NetClock();
  /** client: the host's time puppets show this tick (−Infinity before the first snapshot) */
  playT = -Infinity;
  /**
   * client: how far the playback moved this tick (host seconds, ≈ dt × 0.85–1.25 while the delay adapts). Local
   * simulations of what a puppet shows (a palm's fall, a rolling meatball) step by this, so they stay in step with
   * the played-back snapshots instead of drifting ahead or behind them.
   */
  playDt = 0;
  /** client: things to do when the playback reaches a host time (see atPlay) */
  private timed: { t: number; at: number; f: () => void }[] = [];
  private noted = false;
  /** host: capturing effects of the world tick */
  capturing = false;
  private depth = 0;
  private batch: unknown[][] = [];
  private restore: (() => void)[] = [];
  /** clients: world not started yet (waiting for the host's go) */
  waiting = true;
  /** host: who has finished loading */
  loaded = new Set<string>();
  private goT = 0;

  constructor(public L: Level3D) {
    const types = Object.values(GM) as string[];
    for (const t of types) this.unsubs.push(net.on(t, (data, from) => this.inbox.push({ type: t, data, from, at: performance.now() / 1000 })));
    this.unsubs.push(net.onMembers(() => { this.syncRemotes(); this.linkNotes(); }));
    this.syncRemotes();
    this.installCapture();
    if (net.isHost) { this.loaded.add(net.myId); }
  }

  dispose() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    for (const r of this.restore) r();
    this.restore = [];
    for (const r of this.remotes.values()) r.dispose(this.L);
    this.remotes.clear();
  }

  get isHost() { return net.isHost; }

  // ───────────────────────── registry ─────────────────────────
  /** build-time things get ids in build order (identical on every client); runtime things get host ids */
  add(e: Netted, id?: number) {
    if (id === undefined) id = this.L.building ? this.buildSeq++ : this.dynSeq++;
    e.netId = id;
    this.ents.set(id, e);
    return id;
  }
  get(id: number) { return this.ents.get(id); }
  remove(e: Netted) { if (this.ents.get(e.netId) === e) this.ents.delete(e.netId); }

  /** host: spawn a runtime thing everywhere (the host already created `e`) */
  spawned(e: Netted, kind: string, args: unknown) {
    if (!this.isHost) return;
    if (!e.netId || !this.ents.has(e.netId)) this.add(e);
    net.send('all', GM.spawn, { id: e.netId, k: kind, a: ser(args) });
  }

  /** host: a thing is gone (died / exploded / removed) */
  gone(e: Netted, how: string, at?: THREE.Vector3, extra?: Record<string, unknown>) {
    if (!this.isHost || !e.netId) return;
    net.send('all', GM.gone, { id: e.netId, how, at: at ? v3(at) : undefined, ...extra });
    this.remove(e);
  }

  /** send an event to a thing on the host (client) or to everyone's copy (host; stamped with its clock for netTimed) */
  entEvent(e: Netted, ev: string, data?: unknown) {
    if (this.isHost) net.send('all', GM.ent, { id: e.netId, ev, d: ser(data), ht: Math.round(net.time() * 1000) / 1000 });
    else net.send('host', GM.ent, { id: e.netId, ev, d: ser(data) });
  }

  /**
   * Client: run f when the playback reaches host time t — a host event or state change that goes with what the
   * puppets show (they are drawn ~0.1–0.5 s in the past). In order; at once on the host, without a time or before
   * the first snapshot; at most TIMED_MAX_WAIT late if the snapshots stop.
   */
  atPlay(t: number | undefined, f: () => void) {
    if (this.isHost || t === undefined || !Number.isFinite(t) || !Number.isFinite(this.playT) || (!this.timed.length && t <= this.playT)) { f(); return; }
    this.timed.push({ t, at: performance.now() / 1000, f });
  }

  private runTimed() {
    const now = performance.now() / 1000;
    while (this.timed.length) {
      const q = this.timed[0];
      if (q.t > this.playT && now - q.at < TIMED_MAX_WAIT) break;
      this.timed.shift();
      try { q.f(); } catch (e) { console.error('[net] timed event failed', e); }
    }
  }

  // ───────────────────────── remote heroes ─────────────────────────
  private syncRemotes() {
    const L = this.L;
    for (const [id, m] of net.members) {
      if (m.isMe || m.scene === 'lobby') continue; // waits in the lobby for the next chapter: not in this level
      let r = this.remotes.get(id);
      if (!r) { r = new RemoteHero3(id, m.name, m.look); this.remotes.set(id, r); r.attach(L, L.player.pos); }
      else r.setLook(m.name, m.look);
    }
    for (const [id, r] of this.remotes) {
      const m = net.members.get(id);
      if (!m || m.scene === 'lobby') { r.dispose(L); this.remotes.delete(id); if (!m) L.feed(`${r.name} вышел`, '#c8b8d8'); }
    }
  }

  /** a friend's link fell back to the (slow) Supabase relay: say so once — his moves will lag and come in bursts */
  private linkNotes() {
    for (const [id, m] of net.members) {
      if (m.isMe || m.link !== 'relay' || m.scene === 'lobby' || relayToasted.has(id)) continue;
      relayToasted.add(id);
      this.L.hud.toast(`Связь с ${m.name} идёт через сервер — возможны рывки`, 4);
    }
  }

  // ───────────────────────── effects capture (host) ─────────────────────────
  private installCapture() {
    const L = this.L;
    const fx = L.fx as unknown as Record<string, (...a: unknown[]) => unknown>;
    const wrap = (obj: Record<string, (...a: unknown[]) => unknown>, name: string, code: string) => {
      const orig = obj[name].bind(obj);
      obj[name] = (...args: unknown[]) => {
        if (this.capturing && this.depth === 0) this.batch.push([code, ser(args)]);
        this.depth++;
        try { return orig(...args); } finally { this.depth--; }
      };
      this.restore.push(() => { obj[name] = orig; });
    };
    for (const m of FX_METHODS) wrap(fx, m, m);
    wrap(L.fx.glow as unknown as Record<string, (...a: unknown[]) => unknown>, 'emit', 'glow');
    // sounds
    const origSfx = audio.sfx.bind(audio);
    audio.sfx = ((name: string, opts?: unknown) => { if (this.capturing && this.depth === 0) this.batch.push(['sfx', [name, ser(opts)]]); return origSfx(name as never, opts as never); }) as typeof audio.sfx;
    this.restore.push(() => { audio.sfx = origSfx; });
    // camera shake, toasts, banners, barks, King's shouts
    const cam = L.tcam as unknown as Record<string, (...a: unknown[]) => unknown>;
    wrap(cam, 'shake', 'shake');
    const hud = L.hud as unknown as Record<string, (...a: unknown[]) => unknown>;
    wrap(hud, 'toast', 'toast');
    wrap(hud, 'showBanner', 'banner');
    const origShout = L.shout.bind(L);
    L.shout = (s: string, dur?: number) => { if (this.capturing && this.depth === 0) this.batch.push(['shout', [s, dur]]); origShout(s, dur); };
    this.restore.push(() => { L.shout = origShout; });
    const origBark = L.bark.bind(L);
    L.bark = (obj: THREE.Object3D, str: string, dur?: number, dy?: number) => {
      if (this.capturing && this.depth === 0) { const id = this.ownerOf(obj); if (id) this.batch.push(['bark', [id, str, dur, dy]]); }
      origBark(obj, str, dur, dy);
    };
    this.restore.push(() => { L.bark = origBark; });
  }

  private ownerOf(obj: THREE.Object3D): number | null {
    for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
      for (const e of this.ents.values()) if (e.netRoot === o) return e.netId;
    }
    return null;
  }

  /** replay a captured batch on a client */
  private replay(batch: unknown[][]) {
    const L = this.L;
    for (const [code, raw] of batch as [string, unknown][]) {
      const a = des(raw) as unknown[];
      try {
        switch (code) {
          case 'sfx': audio.sfx(a[0] as never, (a[1] ?? undefined) as never); break;
          case 'glow': L.fx.glow.emit(a[0] as THREE.Vector3, a[1] as never); break;
          case 'shake': L.tcam.shake(a[0] as number); break;
          case 'toast': L.hud.toast(a[0] as string, a[1] as number | undefined); break;
          case 'banner': L.hud.showBanner(a[0] as string, a[1] as string | undefined); break;
          case 'shout': L.shout(a[0] as string, a[1] as number | undefined); break;
          case 'bark': { const e = this.ents.get(a[0] as number); if (e?.netRoot) L.bark(e.netRoot, a[1] as string, a[2] as number | undefined, a[3] as number | undefined); break; }
          default: (L.fx as unknown as Record<string, (...x: unknown[]) => void>)[code]?.(...a);
        }
      } catch { /* a bad effect never breaks the game */ }
    }
  }

  // ───────────────────────── per tick ─────────────────────────
  /** handle queued messages (start of the fixed tick) */
  preTick() {
    if (!this.isHost) {
      const p = this.snapClock.play(performance.now() / 1000);
      this.playDt = Number.isFinite(p) && Number.isFinite(this.playT) ? Math.min(0.1, Math.max(0, p - this.playT)) : 0;
      this.playT = p;
    }
    if (!this.noted) { this.noted = true; this.linkNotes(); } // links that were relayed before this level loaded
    const msgs = this.inbox;
    this.inbox = [];
    for (const m of msgs) this.handle(m);
    if (this.timed.length) this.runTimed();
  }

  private handle(m: Msg) {
    const L = this.L;
    const d = m.data;
    switch (m.type) {
      case GM.heroState: this.remotes.get(m.from)?.applyState(d, m.at); break;
      case GM.snapshot: if (!this.isHost && m.from === net.hostId) this.applySnapshot(d, m.at); break;
      case GM.fx: if (!this.isHost) this.replay(d); break;
      case GM.spawn: {
        if (this.isHost || this.ents.has(d.id)) break;
        const f = NET_SPAWN[d.k];
        const e = f?.(L, des(d.a));
        if (e) this.add(e, d.id);
        break;
      }
      case GM.gone: {
        if (this.isHost) break;
        const e = this.ents.get(d.id);
        this.ents.delete(d.id);
        if (e) e.netEvent?.(L, 'gone', { how: d.how, at: d.at ? toV(d.at) : null, ...d });
        break;
      }
      case GM.ent: {
        const e = this.ents.get(d.id);
        if (!e?.netEvent) break;
        const data = { ...(des(d.d) as object ?? {}), from: m.from };
        if (!this.isHost && m.from === net.hostId && e.netTimed?.includes(d.ev)) this.atPlay(d.ht, () => e.netEvent!(L, d.ev, data));
        else e.netEvent(L, d.ev, data);
        break;
      }
      case GM.drop: L.dropPickup(d.k, toV(d.at), true); break;
      // (only the host's enemies hurt me this way: anyone else's 'hurt' is a forgery)
      case GM.hurt: if (m.from === net.hostId) L.player.hurt(L, d.d, toV(d.f), d.k ? toV(d.k) : undefined, d.kt); break;
      case GM.melee: if (this.isHost) L.remoteMelee(m.from, d); break;
      case GM.pea: if (this.isHost) L.remotePea(m.from, d); break;
      // (a client's own copy reaches the host too: the host flies the real pea from GM.pea)
      case GM.vpea: if (m.from !== net.myId && d.by !== net.myId && !(this.isHost && d.c)) L.visualPea(toV(d.f), toV(d.v), d.t); break;
      case GM.script: if (!this.isHost) L.run(d.name, true); break;
      case GM.arena: if (!this.isHost) L.netArena(d); break;
      case GM.candle: if (!this.isHost) L.lightCandle(d.i, false); break;
      case GM.grab: L.netGrab(d); break;
      case GM.release: L.netRelease(d, m.from); break;
      case GM.loaded:
        if (!this.isHost) break;
        this.loaded.add(m.from);
        // a friend who finished loading after the world started still gets the go
        if (!this.waiting) net.send(m.from, GM.go, {});
        break;
      case GM.go: if (!this.isHost && this.waiting) { this.waiting = false; L.begin(); } break;
      case GM.end: if (!this.isHost) L.endLevel(); break;
      case GM.wipe: if (!this.isHost) L.teamWipe(false); break;
      case GM.exitWait: L.exitWait = { n: d.n, of: d.of, t: d.t }; break;
      case GM.noodleCut: if (!this.isHost) L.noodles[d.i]?.netCut(L); break;
      case GM.seen:
        if (!this.isHost && m.from === net.hostId && Array.isArray(d?.k)) for (const k of d.k) if (typeof k === 'string' && k.length <= 120) L.seen.add(k);
        break;
      default: break;
    }
  }

  /** end of the fixed tick: stream my hero, host snapshots, flush captured effects */
  postTick(dt: number) {
    const L = this.L;
    // paced by real time, not ticks: a slow frame rate (the game then runs slower than real time) or a hidden tab
    // still streams at the full rate. Debug bursts of ticks (no real time passes) stream by game time.
    const now = performance.now();
    const real = this.lastPost ? Math.min(0.25, (now - this.lastPost) / 1000) : dt;
    this.lastPost = now;
    this.stT += real; this.stGame += dt;
    if (this.stT >= 1 / STATE_HZ || this.stGame >= 4 / STATE_HZ) {
      // after a slow frame catch up by at most half a beat (never two packets a few ms apart)
      this.stT = Math.min(Math.max(0, this.stT - 1 / STATE_HZ), 0.5 / STATE_HZ); this.stGame = 0;
      net.send('all', GM.heroState, L.player.netState(), false);
    }
    if (!this.isHost) return;
    // host: start the world once everyone has loaded (or after a few seconds)
    if (this.waiting) {
      this.goT += dt;
      let all = true;
      for (const id of net.members.keys()) if (!this.loaded.has(id)) all = false;
      if (all || this.goT > 8) { this.waiting = false; net.send('all', GM.go, {}); L.begin(); }
    }
    if (this.batch.length) { net.send('all', GM.fx, this.batch); this.batch = []; }
    this.snapT += real; this.snapGame += dt;
    if (this.snapT >= 1 / SNAP_HZ || this.snapGame >= 4 / SNAP_HZ) {
      this.snapT = Math.min(Math.max(0, this.snapT - 1 / SNAP_HZ), 0.5 / SNAP_HZ); this.snapGame = 0;
      this.sendSnapshot();
      this.shareSeen();
    }
  }

  /**
   * host: what the level remembers only here (a puzzle solved — a mirror locked, the siege won, the candles —, things
   * smashed, enemies done…) goes to everyone's L.seen, so a client who takes over when I leave rebuilds the level
   * with it (takeOver sends ITS seen) instead of closing doors that were open.
   */
  private seenSent: Set<string> | null = null;
  private seenN = -1;
  private shareSeen() {
    const seen = this.L.seen;
    if (!this.seenSent) { this.seenSent = new Set(seen); this.seenN = seen.size; return; } // (everyone loaded with these)
    if (seen.size === this.seenN) return;
    this.seenN = seen.size;
    const fresh: string[] = [];
    for (const k of seen) if (!this.seenSent.has(k)) { this.seenSent.add(k); fresh.push(k); }
    if (fresh.length) net.send('all', GM.seen, { k: fresh });
  }

  private sendSnapshot() {
    const L = this.L;
    const heroes = L.heroes();
    const recs: number[][] = [];
    for (const e of this.ents.values()) {
      if (!e.netSnap || e.dead) continue;
      if (e.netFar) {
        const p = (e as unknown as { body?: { pos: THREE.Vector3 }; pos?: THREE.Vector3 }).body?.pos ?? (e as { pos?: THREE.Vector3 }).pos;
        if (p && !heroes.some((h) => h.pos.distanceTo(p) < e.netFar!)) continue;
      }
      const s = e.netSnap();
      recs.push([e.netId, ...s.map((x) => Math.round(x * 100) / 100)]);
    }
    if (recs.length) net.send('all', GM.snapshot, { t: Math.round(net.time() * 1000) / 1000, e: recs }, false);
  }

  private applySnapshot(d: { t: number; e: number[][] }, at: number) {
    if (!d || !Array.isArray(d.e)) return;
    const t = Number(d.t);
    if (Number.isFinite(t)) this.snapClock.note(t, at);
    for (const r of d.e) {
      if (!Array.isArray(r)) continue;
      const e = this.ents.get(r[0]);
      if (e?.netApply) e.netApply(r.slice(1), Number.isFinite(t) ? t : undefined);
    }
  }

  /** run `f` with effects captured for clients (host world tick) */
  capture(f: () => void) {
    if (!this.isHost) { f(); return; }
    this.capturing = true;
    try { f(); } finally { this.capturing = false; }
  }
}

export { v3 as netV3, ser as netSer, des as netDes };
