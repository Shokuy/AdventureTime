/**
 * Signaling transport: presence + broadcast on named channels, plus one-way posts into a channel I'm not
 * subscribed to (a member's private inbox — no fan-out to the whole room).
 * - Supabase Realtime (default, internet). Posts use the REST broadcast endpoint.
 * - BroadcastChannel (?net=local): tabs of one browser, presence emulated with heartbeats
 * Both behave the same: broadcasts never echo to the sender, presence includes me once tracked, and
 * nothing is dropped while the link to the server is down — sends wait in an outbox and go out (in order)
 * when it is back; posts are retried with backoff.
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { LIMITS, NET_DEBUG, SUPABASE_KEY, SUPABASE_URL, transportKind } from './config';

export type PresenceMeta = Record<string, unknown>;
/** presence key -> meta */
export type PresenceMap = Map<string, PresenceMeta>;
export type LinkStatus = 'up' | 'down';

export interface ChannelOpts {
  /** track / receive presence on this channel (default true) */
  presence?: boolean;
}

export interface SignalChannel {
  readonly name: string;
  /** the link to the server is up (false while reconnecting) */
  readonly online: boolean;
  /** join; resolves after the first presence snapshot arrived (rejects when the server can't be reached) */
  subscribe(): Promise<void>;
  /** publish / replace my presence meta under my key (while down: remembered and published on reconnect) */
  track(meta: PresenceMeta): Promise<void>;
  untrack(): Promise<void>;
  /** everyone tracked on the channel, me included once tracked */
  presence(): PresenceMap;
  onPresence(cb: () => void): () => void;
  /** broadcast to every OTHER subscriber; false = the link is down, the message waits in the outbox */
  send(event: string, payload: unknown): boolean;
  onMessage(event: string, cb: (payload: any) => void): () => void;
  /** 'down' when the link to the server dropped, 'up' when it is back (presence is re-tracked) */
  onStatus(cb: (s: LinkStatus) => void): () => void;
  /** best-effort synchronous leave for pagehide */
  leaveNow(): void;
  close(): Promise<void>;
}

/** what went over the wire (the session turns it into Supabase message units for the debug panel / tests) */
export interface TransportStats {
  /** room-wide broadcasts (each one is delivered to every other subscriber) */
  broadcasts: number;
  /** messages posted into one channel (an inbox) */
  posts: number;
  /** presence updates */
  tracks: number;
  /** HTTP requests the posts took */
  postRequests: number;
  postFailures: number;
}

export interface SignalTransport {
  readonly kind: 'supabase' | 'local';
  readonly stats: TransportStats;
  channel(name: string, key: string, opts?: ChannelOpts): SignalChannel;
  /**
   * One-way message into a channel I'm not subscribed to (a member's inbox). Posts leave in order,
   * several per request; a failed request is retried with backoff (messages older than a minute are dropped).
   */
  post(name: string, event: string, payload: unknown): void;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => { if (NET_DEBUG) console.log('[signal]', ...a); };
const newStats = (): TransportStats => ({ broadcasts: 0, posts: 0, tracks: 0, postRequests: 0, postFailures: 0 });

/** outbox entries older than this are not sent after a reconnect */
const OUTBOX_MAX_AGE_MS = 60_000;
const OUTBOX_MAX = 300;
/**
 * Supabase closes a channel whose client sends more than 5 presence updates (track + untrack) within 30 s
 * ("Client presence rate limit exceeded", per channel). Presence is for slow state: at most PRES_MAX per
 * window, the newest meta wins (fast changes ride a broadcast instead — see the session's 'meta' cast).
 */
const PRES_WINDOW_MS = 30_000;
const PRES_MAX = 4;

/** listener bookkeeping shared by both implementations */
abstract class ChannelBase implements SignalChannel {
  private presSubs = new Set<() => void>();
  private msgSubs = new Map<string, Set<(p: any) => void>>();
  private statusSubs = new Set<(s: LinkStatus) => void>();
  /** sends made while the link was down, flushed in order when it is back */
  protected outbox: { event: string; payload: unknown; at: number }[] = [];
  /** my presence as it should be (null = not tracked) and what was last sent */
  protected meta: PresenceMeta | null = null;
  private presSent = 'null';
  private presTimes: number[] = [];
  private presTimer = 0;

  constructor(readonly name: string, protected key: string, protected withPresence: boolean) {}

  abstract readonly online: boolean;
  abstract subscribe(): Promise<void>;
  abstract track(meta: PresenceMeta): Promise<void>;
  abstract untrack(): Promise<void>;
  abstract presence(): PresenceMap;
  abstract send(event: string, payload: unknown): boolean;
  abstract leaveNow(): void;
  abstract close(): Promise<void>;

  onPresence(cb: () => void) { this.presSubs.add(cb); return () => { this.presSubs.delete(cb); }; }
  onMessage(event: string, cb: (p: any) => void) {
    let s = this.msgSubs.get(event);
    if (!s) { s = new Set(); this.msgSubs.set(event, s); }
    s.add(cb);
    return () => { s!.delete(cb); };
  }
  onStatus(cb: (s: LinkStatus) => void) { this.statusSubs.add(cb); return () => { this.statusSubs.delete(cb); }; }

  protected emitPresence() { for (const f of [...this.presSubs]) safe(f); }
  protected emitMessage(event: string, payload: unknown) {
    const s = this.msgSubs.get(event);
    if (s) for (const f of [...s]) safe(() => f(payload));
  }
  protected emitStatus(st: LinkStatus) { for (const f of [...this.statusSubs]) safe(() => f(st)); }

  /** really send my presence (meta) or remove it (null) */
  protected abstract pushPresence(meta: PresenceMeta | null): Promise<unknown>;
  /** presence may go out now (the link is up) */
  protected abstract canPushPresence(): boolean;

  /**
   * Publish this.meta within the presence budget: now if the window allows, else once it does (coalesced:
   * only the newest meta goes). Resolves when sent now; a deferred update resolves at once.
   */
  protected syncPresence(): Promise<void> {
    if (this.presTimer || !this.canPushPresence()) return Promise.resolve();
    const want = JSON.stringify(this.meta);
    if (want === this.presSent) return Promise.resolve();
    const now = Date.now();
    this.presTimes = this.presTimes.filter((t) => now - t < PRES_WINDOW_MS);
    if (this.presTimes.length >= PRES_MAX) {
      const wait = this.presTimes[0] + PRES_WINDOW_MS + 250 - now;
      log(this.name, 'presence deferred', wait, 'ms');
      this.presTimer = window.setTimeout(() => { this.presTimer = 0; void this.syncPresence().catch(() => undefined); }, wait);
      return Promise.resolve();
    }
    this.presTimes.push(now);
    this.presSent = want;
    return this.pushPresence(this.meta).then((r) => {
      if (r !== undefined && r !== 'ok') { this.presSent = ''; throw new Error('presence: ' + String(r)); }
    });
  }

  /** a fresh server session (rejoined channel): its budget starts over, presence must be sent again */
  protected resetPresence() {
    clearTimeout(this.presTimer);
    this.presTimer = 0;
    this.presTimes = [];
    this.presSent = 'null';
  }

  protected stopPresence() {
    clearTimeout(this.presTimer);
    this.presTimer = 0;
  }

  protected queue(event: string, payload: unknown) {
    this.outbox.push({ event, payload, at: Date.now() });
    if (this.outbox.length > OUTBOX_MAX) this.outbox.splice(0, this.outbox.length - OUTBOX_MAX);
  }
  /** the queued sends that are still worth sending */
  protected takeOutbox() {
    const now = Date.now();
    const out = this.outbox.filter((m) => now - m.at < OUTBOX_MAX_AGE_MS);
    this.outbox = [];
    return out;
  }
}

function safe(f: () => void) {
  try { f(); } catch (e) { console.error('[net]', e); }
}

/** a queue of posts that leave strictly in order, several per request, retried with backoff */
class PostQueue {
  private q: { topic: string; event: string; payload: unknown; at: number }[] = [];
  private busy = false;
  private timer = 0;
  private fails = 0;
  /** paused (local transport outage simulation) */
  paused = false;

  constructor(private stats: TransportStats, private deliver: (batch: { topic: string; event: string; payload: unknown }[]) => Promise<boolean>) {}

  push(topic: string, event: string, payload: unknown) {
    this.q.push({ topic, event, payload, at: Date.now() });
    this.stats.posts++;
    if (this.q.length > OUTBOX_MAX) this.q.splice(0, this.q.length - OUTBOX_MAX);
    // same-tick posts share one request
    if (!this.busy && !this.timer) this.timer = window.setTimeout(() => { this.timer = 0; void this.pump(); }, 0);
  }

  kick() {
    if (this.busy || !this.q.length) return;
    clearTimeout(this.timer);
    this.timer = 0;
    void this.pump();
  }

  private async pump() {
    if (this.busy || this.paused) return;
    const now = Date.now();
    this.q = this.q.filter((m) => now - m.at < OUTBOX_MAX_AGE_MS);
    if (!this.q.length) return;
    this.busy = true;
    // up to 50 messages / ~200 KB per request
    let n = 0, size = 0;
    while (n < this.q.length && n < 50) {
      let s = 64;
      try { s += JSON.stringify(this.q[n].payload ?? null).length; } catch { /* */ }
      if (n && size + s > 200_000) break;
      size += s;
      n++;
    }
    const batch = this.q.slice(0, n);
    let ok = false;
    try { ok = await this.deliver(batch); } catch (e) { log('post failed', e); }
    this.busy = false;
    this.stats.postRequests++;
    if (ok) {
      // the queue may have been trimmed meanwhile: drop exactly what was sent
      this.q = this.q.filter((m) => !batch.includes(m));
      this.fails = 0;
      if (this.q.length) void this.pump();
    } else {
      this.stats.postFailures++;
      this.fails++;
      const wait = Math.min(5000, 400 * 2 ** Math.min(4, this.fails - 1));
      this.timer = window.setTimeout(() => { this.timer = 0; void this.pump(); }, wait);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Supabase Realtime

class SupabaseTransport implements SignalTransport {
  readonly kind = 'supabase' as const;
  readonly stats = newStats();
  private clientP: Promise<SupabaseClient> | null = null;
  /** topics being removed: a new channel with the same topic must wait (realtime-js reuses topics) */
  private closing = new Map<string, Promise<unknown>>();
  readonly open = new Set<SupaChannel>();
  private posts = new PostQueue(this.stats, (b) => this.sendPosts(b));
  private nudgeTimer = 0;

  constructor() {
    const bye = () => { for (const ch of [...this.open]) ch.leaveNow(); };
    // pagehide fires on every unload (incl. mobile Safari); beforeunload may still be cancelled
    addEventListener('pagehide', bye);
    // the network is back: retry pending posts now instead of waiting for the backoff
    addEventListener('online', () => this.posts.kick());
  }

  /**
   * realtime-js (Phoenix) never reconnects while the page is hidden ("Not reconnecting as page is hidden"):
   * a player in another tab / app would stay cut off from the room channel until they look at the game.
   * While a channel is down and the page is hidden, ask for a connection every few seconds.
   */
  watchDown() {
    if (this.nudgeTimer) return;
    this.nudgeTimer = window.setInterval(() => {
      if (![...this.open].some((ch) => !ch.online)) { clearInterval(this.nudgeTimer); this.nudgeTimer = 0; return; }
      if (document.visibilityState !== 'hidden' || !this.clientP) return;
      void this.clientP.then((c) => {
        const rt = c.realtime;
        try { if (!rt.isConnected() && !rt.isConnecting()) { log('hidden page: reconnecting'); rt.connect(); } } catch { /* */ }
      });
    }, 4000);
  }

  client(): Promise<SupabaseClient> {
    // loaded lazily so solo play never downloads supabase-js
    this.clientP ??= import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
    );
    return this.clientP;
  }

  channel(name: string, key: string, opts?: ChannelOpts): SignalChannel { return new SupaChannel(this, name, key, opts?.presence !== false); }

  post(name: string, event: string, payload: unknown) { this.posts.push(name, event, payload); }
  /** a channel came back: posts that failed meanwhile can go now */
  kickPosts() { this.posts.kick(); }

  /** REST broadcast: one request, many messages (each counts as one Supabase message + one delivery) */
  private async sendPosts(batch: { topic: string; event: string; payload: unknown }[]): Promise<boolean> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(SUPABASE_URL.replace(/\/+$/, '') + '/realtime/v1/api/broadcast', {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: batch.map((m) => ({ topic: m.topic, event: 'm', payload: { e: m.event, p: m.payload }, private: false })) }),
        signal: ctl.signal,
        keepalive: false,
      });
      void r.body?.cancel().catch(() => undefined);
      return r.ok;
    } finally {
      clearTimeout(timer);
    }
  }

  waitClosed(name: string) { return this.closing.get(name) ?? Promise.resolve(); }
  markClosing(name: string, p: Promise<unknown>) {
    const done = p.catch(() => undefined).then(() => { if (this.closing.get(name) === done) this.closing.delete(name); });
    this.closing.set(name, done);
  }
}

class SupaChannel extends ChannelBase {
  private ch: RealtimeChannel | null = null;
  private client: SupabaseClient | null = null;
  private pres: PresenceMap = new Map();
  private closed = false;
  private up = false;

  constructor(private t: SupabaseTransport, name: string, key: string, presence: boolean) { super(name, key, presence); }

  get online() { return this.up && !this.closed; }

  async subscribe(): Promise<void> {
    await this.t.waitClosed(this.name);
    const client = await this.t.client();
    if (this.closed) throw new Error('closed');
    this.client = client;
    const ch = client.channel(this.name, {
      config: this.withPresence
        ? { presence: { key: this.key, enabled: true }, broadcast: { self: false, ack: false } }
        : { broadcast: { self: false, ack: false } },
    });
    this.ch = ch;
    let synced: () => void = () => {};
    const firstSync = new Promise<void>((r) => { synced = r; });
    if (this.withPresence) {
      ch.on('presence', { event: 'sync' }, () => {
        this.readPresence();
        synced();
        this.emitPresence();
      });
    } else synced();
    ch.on('broadcast', { event: 'm' }, (msg: { payload?: { e?: string; p?: unknown } }) => {
      const pl = msg.payload;
      if (pl && typeof pl.e === 'string') this.emitMessage(pl.e, pl.p);
    });
    this.t.open.add(this);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => fail(new Error('timeout')), LIMITS.joinTimeoutMs);
      const fail = (e: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      };
      ch.subscribe((status, err) => {
        log(this.name, status, err?.message ?? '');
        if (this.closed) { if (!settled) fail(new Error('closed')); return; }
        if (status === 'SUBSCRIBED') {
          const wasDown = !this.up && settled;
          this.up = true;
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            // the server sends a presence snapshot right after the join; give it a moment
            void Promise.race([firstSync, delay(2500)]).then(() => resolve());
          } else if (wasDown) this.backUp();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (!settled) { fail(err ?? new Error(status)); return; }
          if (this.up) { this.up = false; this.t.watchDown(); this.emitStatus('down'); }
        }
      });
    }).catch((e) => {
      this.t.open.delete(this);
      this.closed = true;
      this.t.markClosing(this.name, client.removeChannel(ch));
      throw e;
    });
  }

  /** rejoined after a drop: the server forgot my presence; queued sends go out in order */
  private backUp() {
    const ch = this.ch;
    if (!ch) return;
    // the server forgot my presence (and the rejoined channel has a fresh presence budget)
    this.resetPresence();
    // listeners may update the meta first (a returning member re-sorts itself), then it is tracked once
    this.emitStatus('up');
    if (this.closed || !this.up) return;
    if (this.meta) void this.syncPresence().catch(() => undefined);
    for (const m of this.takeOutbox()) this.rawSend(m.event, m.payload);
    this.t.kickPosts();
  }

  private readPresence() {
    if (!this.ch) return;
    const state = this.ch.presenceState() as Record<string, PresenceMeta[]>;
    const map: PresenceMap = new Map();
    for (const key of Object.keys(state)) {
      const list = state[key];
      if (!list || !list.length) continue;
      // the same key can appear twice for a moment (reload before the old socket timed out): newest wins
      let best = list[0];
      for (const m of list) if (Number(m.joinedAt ?? 0) >= Number(best.joinedAt ?? 0)) best = m;
      const { presence_ref: _ref, ...meta } = best as PresenceMeta & { presence_ref?: string };
      map.set(key, meta);
    }
    this.pres = map;
  }

  protected canPushPresence() { return !!this.ch && !this.closed && this.up; }
  protected pushPresence(meta: PresenceMeta | null) {
    const ch = this.ch!;
    this.t.stats.tracks++;
    return meta ? ch.track(meta) : ch.untrack();
  }

  /** while down it is only remembered: realtime-js would buffer every intermediate version and replay them all */
  track(meta: PresenceMeta) {
    this.meta = meta;
    return this.syncPresence();
  }

  untrack() {
    this.meta = null;
    return this.syncPresence();
  }

  presence() { return this.pres; }

  private rawSend(event: string, payload: unknown) {
    this.t.stats.broadcasts++;
    void this.ch!.send({ type: 'broadcast', event: 'm', payload: { e: event, p: payload } });
  }

  send(event: string, payload: unknown): boolean {
    if (!this.ch || this.closed) return false;
    // never fall back to REST implicitly (realtime-js does when the channel isn't joined): wait for the socket
    if (!this.up || (this.ch as unknown as { state?: string }).state !== 'joined' || !this.client?.realtime.isConnected()) {
      this.queue(event, payload);
      return false;
    }
    this.rawSend(event, payload);
    return true;
  }

  leaveNow() {
    if (!this.ch || this.closed) return;
    if (this.meta) { this.meta = null; void this.ch.untrack(); }
    void this.ch.unsubscribe();
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.outbox = [];
    this.stopPresence();
    this.meta = null;
    this.t.open.delete(this);
    const ch = this.ch;
    if (!ch || !this.client) return;
    // leaving the channel removes my presence (an explicit untrack would only spend the presence budget)
    const p = this.client.removeChannel(ch);
    this.t.markClosing(this.name, p);
    await p.catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------
// BroadcastChannel (?net=local): same-browser tabs, no internet

const LOCAL_HB_MS = 1000;
/** background tabs run timers at most once per second, so be generous */
const LOCAL_TIMEOUT_MS = 6000;

type LocalMsg =
  | { k: 'hello'; i: string }
  | { k: 'hb'; i: string; key: string; meta: PresenceMeta }
  | { k: 'bye'; i: string; key: string }
  | { k: 'b'; i: string; e: string; p: unknown };

class LocalTransport implements SignalTransport {
  readonly kind = 'local' as const;
  readonly stats = newStats();
  readonly open = new Set<LocalChannel>();
  /** simulated server outage (tests): nothing goes in or out, presence is dropped by the "server" */
  down = false;
  private outs = new Map<string, BroadcastChannel>();
  private posts = new PostQueue(this.stats, async (batch) => {
    if (this.down) return false;
    for (const m of batch) this.postNow(m.topic, m.event, m.payload);
    return true;
  });

  constructor() {
    const bye = () => { for (const ch of [...this.open]) ch.leaveNow(); };
    // pagehide fires on every unload (incl. mobile Safari); beforeunload may still be cancelled
    addEventListener('pagehide', bye);
  }
  channel(name: string, key: string, opts?: ChannelOpts): SignalChannel { return new LocalChannel(this, name, key, opts?.presence !== false); }

  post(name: string, event: string, payload: unknown) { this.posts.push(name, event, payload); }

  private postNow(name: string, event: string, payload: unknown) {
    let bc = this.outs.get(name);
    if (!bc) {
      if (this.outs.size > 32) { for (const b of this.outs.values()) b.close(); this.outs.clear(); }
      bc = new BroadcastChannel('gk-net:' + name);
      this.outs.set(name, bc);
    }
    const m: LocalMsg = { k: 'b', i: 'post', e: event, p: JSON.parse(JSON.stringify(payload ?? null)) };
    try { bc.postMessage(m); } catch { /* closed */ }
  }

  /** tests: cut / restore this tab's "server" connection (all channels + posts) */
  simulateOutage(on: boolean) {
    if (on === this.down) return;
    this.down = on;
    this.posts.paused = on;
    for (const ch of [...this.open]) ch.setDown(on);
    if (!on) this.posts.kick();
  }
}

class LocalChannel extends ChannelBase {
  private bc: BroadcastChannel | null = null;
  /** this channel object (several objects in one tab must still hear each other) */
  private inst = Math.random().toString(36).slice(2, 10);
  /** what the others see (heartbeats carry it); this.meta is what I want them to see */
  private shown: PresenceMeta | null = null;
  private peers = new Map<string, { meta: PresenceMeta; at: number; inst: string }>();
  private hbTimer = 0;
  private sweepTimer = 0;
  private closed = false;
  private down = false;

  constructor(private t: LocalTransport, name: string, key: string, presence: boolean) { super(name, key, presence); }

  get online() { return !this.closed && !this.down && !!this.bc; }

  async subscribe() {
    if (typeof BroadcastChannel === 'undefined') throw new Error('BroadcastChannel unsupported');
    if (this.t.down) { await delay(LIMITS.joinTimeoutMs); throw new Error('timeout'); }
    const bc = new BroadcastChannel('gk-net:' + this.name);
    this.bc = bc;
    bc.onmessage = (e: MessageEvent) => this.onRaw(e.data as LocalMsg);
    this.t.open.add(this);
    this.post({ k: 'hello', i: this.inst });
    this.sweepTimer = window.setInterval(() => this.sweep(), 1000);
    // trackers answer the hello with a heartbeat right away
    await delay(this.withPresence ? 350 : 0);
    if (this.closed) throw new Error('closed');
    this.emitPresence();
  }

  private post(m: LocalMsg) {
    if (!this.bc || this.closed || this.down) return;
    try { this.bc.postMessage(m); } catch { /* closed */ }
  }

  private beat() {
    if (this.shown) this.post({ k: 'hb', i: this.inst, key: this.key, meta: this.shown });
  }

  private onRaw(m: LocalMsg) {
    if (!m || m.i === this.inst || this.closed || this.down) return;
    switch (m.k) {
      case 'hello':
        this.beat();
        break;
      case 'hb': {
        if (!this.withPresence) break;
        const old = this.peers.get(m.key);
        this.peers.set(m.key, { meta: m.meta, at: Date.now(), inst: m.i });
        if (!old || old.inst !== m.i || JSON.stringify(old.meta) !== JSON.stringify(m.meta)) this.emitPresence();
        break;
      }
      case 'bye': {
        const old = this.peers.get(m.key);
        if (old && old.inst === m.i) { this.peers.delete(m.key); this.emitPresence(); }
        break;
      }
      case 'b':
        this.emitMessage(m.e, m.p);
        break;
    }
  }

  private sweep() {
    // while "disconnected" the client keeps its last presence view (like realtime-js)
    if (this.down) return;
    const now = Date.now();
    let changed = false;
    for (const [key, p] of this.peers) {
      if (key === this.key && p.inst === this.inst) continue;
      if (now - p.at > LOCAL_TIMEOUT_MS) { this.peers.delete(key); changed = true; }
    }
    if (changed) this.emitPresence();
  }

  /** simulated outage: the "server" drops my presence; nothing goes in or out until it is back */
  setDown(on: boolean) {
    if (this.closed || on === this.down) return;
    if (on) {
      if (this.shown) this.post({ k: 'bye', i: this.inst, key: this.key });
      this.down = true;
      this.emitStatus('down');
    } else {
      this.down = false;
      // everyone's heartbeat refreshes my view; mine refreshes theirs (a fresh server session: presence again)
      const now = Date.now();
      for (const p of this.peers.values()) p.at = now;
      this.post({ k: 'hello', i: this.inst });
      this.resetPresence();
      this.emitStatus('up');
      if (this.meta) void this.syncPresence();
      for (const m of this.takeOutbox()) this.rawSend(m.event, m.payload);
    }
  }

  protected canPushPresence() { return !this.closed && !this.down && !!this.bc; }
  /** same budget as Supabase (parity: tests see the same presence lag) */
  protected async pushPresence(meta: PresenceMeta | null) {
    this.t.stats.tracks++;
    this.shown = meta;
    if (meta) {
      this.peers.set(this.key, { meta, at: Date.now(), inst: this.inst });
      this.beat();
      if (!this.hbTimer) this.hbTimer = window.setInterval(() => this.beat(), LOCAL_HB_MS);
    } else {
      clearInterval(this.hbTimer);
      this.hbTimer = 0;
      this.post({ k: 'bye', i: this.inst, key: this.key });
      this.peers.delete(this.key);
    }
    this.emitPresence();
    return 'ok';
  }

  track(meta: PresenceMeta) {
    if (this.closed) return Promise.resolve();
    this.meta = meta;
    return this.syncPresence();
  }

  untrack() {
    this.meta = null;
    return this.syncPresence();
  }

  presence(): PresenceMap {
    const map: PresenceMap = new Map();
    for (const [k, p] of this.peers) map.set(k, p.meta);
    return map;
  }

  private rawSend(event: string, payload: unknown) {
    this.t.stats.broadcasts++;
    // structured clone keeps the same semantics as JSON over the wire
    this.post({ k: 'b', i: this.inst, e: event, p: JSON.parse(JSON.stringify(payload ?? null)) });
  }

  send(event: string, payload: unknown): boolean {
    if (this.closed || !this.bc) return false;
    if (this.down) { this.queue(event, payload); return false; }
    this.rawSend(event, payload);
    return true;
  }

  leaveNow() {
    if (this.shown) { this.meta = this.shown = null; this.post({ k: 'bye', i: this.inst, key: this.key }); }
  }

  async close() {
    if (this.closed) return;
    // leaving removes my presence at once (like the server dropping a channel member)
    this.stopPresence();
    if (this.shown) this.post({ k: 'bye', i: this.inst, key: this.key });
    this.meta = this.shown = null;
    this.closed = true;
    this.outbox = [];
    this.t.open.delete(this);
    clearInterval(this.hbTimer);
    clearInterval(this.sweepTimer);
    this.bc?.close();
    this.bc = null;
  }
}

let transport: SignalTransport | null = null;

/** the transport for this page (?net=local -> BroadcastChannel, else Supabase) */
export function getTransport(): SignalTransport {
  transport ??= transportKind() === 'local' ? new LocalTransport() : new SupabaseTransport();
  return transport;
}
