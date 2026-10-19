/**
 * `net` — the one object the game talks to (API in docs/MULTIPLAYER.md).
 * Rooms / chat ride Supabase Realtime (or BroadcastChannel with ?net=local); signaling goes into each
 * member's private inbox; gameplay messages and voice ride the WebRTC mesh, with a budgeted relay when a
 * link isn't up.
 *
 * Membership: presence (or a fresh 'meta' broadcast) adds a member; a member is never dropped while it is
 * still heard (directly, over the relay, or reported by others); one that vanished from presence gets a
 * short grace; a 'bye' over the data channel removes it at once, a room-channel 'bye' is only a hint.
 *
 * Host: every member follows (term, host). The newest term wins; a host keeps its seat until it is dead —
 * nobody (me or the members I hear, via ping gossip) heard it for ~5 s — or left. Then everyone elects the
 * earliest-joined live member at term + 1, which all members compute the same way. A host that comes back
 * from a freeze / outage finds a newer term and re-sorts itself after everyone (joinedAt = max + 1).
 *
 * Reliable messages carry a sequence number per sender → receiver on both paths (P2P and relay) and are
 * re-ordered on receipt; a hole is waited for LIMITS.seqGapMs, then skipped.
 */
import { CODE_ALPHABET, CODE_LEN, LIMITS, MAX_PLAYERS, NET_DEBUG, NET_SIM, PROTOCOL_VERSION, transportKind } from './config';
import { profile, type HeroLook, type HeroPick } from './profile';
import { decodeSeq, encode, ERR_TEXT, isSysType, NetError, SYS, withSeq } from './protocol';
import { getTransport } from './signal';
import { Lobby, type RoomInfo, type RoomState } from './lobby';
import { parseMeta, PRESENCE_SETTLE_MS, Room, type MemberMeta } from './room';
import { Mesh, type LinkState, type SigData } from './mesh';
import { Voice } from './voice';

export type { LinkState } from './mesh';
export type { RoomInfo, RoomState } from './lobby';
export { NetError } from './protocol';

export interface Member {
  id: string;
  name: string;
  /** the member's Tosha look */
  look: HeroLook;
  /** the hero the member picked (kind + its look); an older build: Tosha */
  hero: HeroPick;
  ready: boolean;
  joinedAt: number;
  /** whatever the game puts there (current scene / chapter) */
  scene: string;
  /** round trip to this member in ms (-1 = not measured yet, 0 = me) */
  ping: number;
  link: LinkState;
  /** link is 'p2p' but runs through a TURN server (still fast; shown as «через TURN») */
  turn: boolean;
  /** from voice activity (see net.voice.onChange) */
  speaking: boolean;
  /** I muted them */
  muted: boolean;
  isHost: boolean;
  isMe: boolean;
}

export interface ChatMsg {
  id: string;
  from: string;
  name: string;
  text: string;
  ts: number;
}

export type MetaPatch = Partial<{ name: string; look: HeroLook; hero: HeroPick; ready: boolean; scene: string }>;
/** 'full': I turned out to be the 7th (two people took the last seat at once) */
export type LeaveReason = 'leave' | 'kicked' | 'unload' | 'full';
export type NetStatus = 'idle' | 'joining' | 'room';

type Handler = (data: any, from: string) => void;
type ChatHandler = (from: string, text: string, ts: number, name: string, history: boolean) => void;
type Via = 'p2p' | 'relay' | 'self';

/** inbox payloads */
interface SigMsg { from: string; sid: string; items: SigData[] }
interface CtlMsg { type: 'bye' | 'chatlog' | 'meta'; from: string; to?: string; data?: unknown }
/** one relayed message: [type, data, [member id, seq (0 = unreliable), member sid][]] */
type Dest = [id: string, seq: number, sid: string];
type RelayEntry = [type: string, data: unknown, dests: Dest[]];
interface RelayMsg { from: string; sid: string; b: RelayEntry[] }
interface RelayItem { t: string; d: unknown; dests: Dest[]; size: number }

/** what I know about another member's liveness */
interface Live {
  sid: string;
  /** last message from them, any path / over a data channel (0 = never) */
  heardAt: number;
  heardP2P: number;
  /** freshest "I heard them" reported by another member (ping gossip) */
  gossipAt: number;
  /** last time someone (me or a member, via gossip) had a live direct link to them (see LIMITS.aliveLinkedMs) */
  linkAt: number;
  /** someone had a direct link with them: silence then means they're gone (relay-only members go by presence) */
  p2pEver: boolean;
  /** my link to them is direct since (0 = it isn't) */
  p2pSince: number;
  /** dropped out of presence at (0 = present) */
  missingSince: number;
  /** an (unauthenticated) room-channel bye */
  bye: { sid: string; at: number } | null;
  /** the host they follow */
  ann: { term: number; host: string; hsid: string } | null;
}

/** reliable messages from one member, put back in order; holes = skipped ranges [from, to) (late beats never) */
interface InSeq { sid: string; next: number; buf: Map<number, [string, unknown, Via]>; holes: [number, number][]; timer: number }

const log = (...a: unknown[]) => { if (NET_DEBUG) console.log('[net]', ...a); };
/** monotonic wall clock in ms (Date.now() can jump) */
const wallNow = () => performance.timeOrigin + performance.now();
/** a bye is ignored while the member still talks over its data channel this recently */
const BYE_HEARD_MS = 2500;
/** "I heard X" gossip covers members heard within this */
const GOSSIP_MS = 10_000;
/** relay batches "from" someone I've talked to directly this long are not theirs (they'd use the link) */
const RELAY_AFTER_P2P_MS = 5000;
/** a sequence number this far ahead is not plausible (the relay queue holds 300) */
const SEQ_MAX_JUMP = 5000;

function randomCode() {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

/** 'ab c-d e' -> 'ABCDE'; null if not a valid code */
export function normalizeCode(code: string): string | null {
  const c = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== CODE_LEN) return null;
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
  return c;
}

const cancelled = () => new NetError('cancelled', ERR_TEXT.cancelled);
const earlier = (a: { joinedAt: number; id: string }, b: { joinedAt: number; id: string }) =>
  a.joinedAt < b.joinedAt || (a.joinedAt === b.joinedAt && a.id < b.id);

class Net {
  /** in a room */
  active = false;
  hostId: string | null = null;
  /** everyone in the room, me included, in join order */
  readonly members = new Map<string, Member>();
  code: string | null = null;
  isPublic = false;
  status: NetStatus = 'idle';
  /** host-controlled: 'lobby' | 'playing' (shown in the public list; quick match only joins 'lobby') */
  roomState: RoomState = 'lobby';
  /** last 50 chat messages, oldest first */
  readonly chatLog: ChatMsg[] = [];
  /** last error text (Russian), '' when fine */
  lastError = '';
  /** signaling server reachable (P2P links may still work without it) */
  online = true;
  readonly voice = new Voice();
  readonly stats = {
    sent: 0, recv: 0, relayed: 0, relayDropped: 0, relayReordered: 0, late: 0, skipped: 0,
    relayBatches: 0, relayUnits: 0, hostChanges: 0, simDropped: 0,
  };
  /** the simulated bad network (?lag / ?jitter / ?loss), null = off */
  readonly sim = NET_SIM;

  private room: Room | null = null;
  private mesh: Mesh | null = null;
  private readonly lobby = new Lobby(getTransport, () => this.myId);
  private handlers = new Map<string, Set<Handler>>();
  private memberSubs = new Set<() => void>();
  private chatSubs = new Set<ChatHandler>();
  private leaveSubs = new Set<(reason: LeaveReason) => void>();
  /** bumped by leave(): a create / join / quickMatch in flight sees it and backs out */
  private gen = 0;
  /** generation of the connect in flight (0 = none) */
  private connecting = 0;
  /** rooms being joined right now (leave() closes them) */
  private joining = new Set<Room>();
  private pre = { scene: '' };
  private epoch = 0;
  private enteredAt = 0;

  // ---- membership / liveness
  private live = new Map<string, Live>();
  /** sids that left (presence may linger a moment) */
  private gone = new Set<string>();
  /** member id -> sid */
  private sids = new Map<string, string>();
  /** the room I left last (its listing may linger a moment: quick match must not pick it) */
  private lastLeft: string | null = null;
  /**
   * Supabase presence reaches other server nodes ~2 s late, so every meta change is also broadcast
   * ('meta' ctl): newer rev wins; a member known only from a broadcast counts for a while.
   */
  private metaCast = new Map<string, { meta: MemberMeta; at: number }>();
  /** I was frozen: everyone counts as alive until then (they get time to be heard again) */
  private resumeUntil = 0;
  /** I was the host and got frozen: until then I only follow a newer term (never take the seat back) */
  private rejoinUntil = 0;
  private downSince = 0;
  private lastTick = 0;

  // ---- host / clock
  private term = 0;
  private hostSid = '';
  /** the latest term in which I was the host (a newer one = I'm an ex-host and re-sort myself) */
  private hostedTerm = 0;
  /** room clock = my wall clock + hostBase while I'm the host (continuous across host changes) */
  private hostBase = 0;
  /** room clock = my wall clock + clockOffset while I'm a client */
  private clockOffset = 0;
  private clockSamples: { rtt: number; off: number }[] = [];

  // ---- timers / rate limits
  private timers: number[] = [];
  private metaTimer = 0;
  private lastMetaSent = 0;
  private lastChat = 0;
  private chatSeq = 0;
  private lobbyWatchers = 0;

  // ---- reliable sequencing (per sender → receiver, both paths)
  private outSeq = new Map<string, { sid: string; n: number }>();
  private inSeq = new Map<string, InSeq>();

  // ---- relay
  private relayQ: RelayItem[] = [];
  /** reliable relay items queued per member (a direct send must not overtake them) */
  private relayPending = new Map<string, number>();
  /**
   * unreliable messages for relay-linked members, per (type, member): the newest one — or, for the streams in
   * LIMITS.relaySampleHz, samples at that rate since the last batch (newest last)
   */
  private relayLatest = new Map<string, { id: string; t: string; list: { d: unknown; size: number }[]; next: number }>();
  private relayTokens = LIMITS.relayBurstUnits;
  private relayRefill = 0;
  private relayTimer = 0;
  private lastRelayFlush = 0;
  private lastRelayPing = 0;

  /** relay batches from someone not (yet) a member: replayed once their membership shows up */
  private relayHold = new Map<string, { at: number; list: RelayMsg[] }>();

  // ---- outgoing signaling (one post per member per tick)
  private sigQ = new Map<string, SigData[]>();
  private sigTimer = 0;

  /** simulated network: when the last held message of an ordered stream (reliable per member, relay per member) is due */
  private simDue = new Map<string, number>();

  constructor() {
    profile.onChange(() => { if (this.room) this.setMeta({ name: profile.name, look: { ...profile.look }, hero: profile.pick() }); });
    // speaking / mute live on the members (no onMembers spam: UIs listen to net.voice.onChange)
    this.voice.onChange(() => {
      for (const m of this.members.values()) {
        m.speaking = m.isMe ? this.voice.speaking : this.voice.isSpeaking(m.id);
        m.muted = !m.isMe && this.voice.isMuted(m.id);
      }
    });
    // registered before any transport exists, so the bye goes out before presence is dropped
    addEventListener('pagehide', () => { if (this.room || this.connecting) this.leave('unload'); });
    addEventListener('pageshow', (e) => { if ((e as PageTransitionEvent).persisted && this.room) this.leave('unload'); });
    // a frozen page (mobile app switch, background tab) resumed: check liveness / host at once
    document.addEventListener('resume', () => { if (this.room) this.pingTick(); });
    document.addEventListener('visibilitychange', () => { if (this.room && document.visibilityState === 'visible') this.pingTick(); });
  }

  /** my player id (unique per tab; final once a room was joined) */
  get myId(): string { return profile.id; }
  get isHost() { return this.active && this.hostId === this.myId; }
  /** 'supabase' or 'local' (?net=local) */
  get transport() { return transportKind(); }
  get me(): Member | undefined { return this.members.get(this.myId); }

  // ---------------------------------------------------------------- rooms

  /** open a new room; returns its code */
  create(opts: { public: boolean } = { public: false }): Promise<string> {
    return this.connect((g) => this.createRoom(!!opts.public, g));
  }

  /** join a room by code (throws NetError with a Russian message: not found / full / version / network / cancelled) */
  join(code: string): Promise<void> {
    const c = normalizeCode(code);
    if (!c) return Promise.reject(new NetError('bad_code', ERR_TEXT.bad_code));
    return this.connect(async (g) => {
      const room = this.makeRoom(c, false);
      await room.join('join');
      this.check(g, room);
      this.enter(room);
    });
  }

  /** join the fullest public room that waits in the lobby, or open a new public one */
  quickMatch(): Promise<string> {
    return this.connect(async (g) => {
      try { await this.lobby.open(); } catch { this.check(g); throw new NetError('network', ERR_TEXT.network); }
      this.check(g);
      const list = this.lobby.rooms().filter((r) => r.state === 'lobby' && r.n < r.max && r.v === PROTOCOL_VERSION && r.code !== this.lastLeft);
      list.sort((a, b) => b.n - a.n);
      for (const r of list.slice(0, 4)) {
        const room = this.makeRoom(r.code, true);
        try {
          await room.join('join');
          this.check(g, room);
          this.enter(room);
          return r.code;
        } catch (e) {
          this.check(g);
          // stale listing / filled up meanwhile: try the next one
          if (e instanceof NetError && (e.code === 'full' || e.code === 'not_found' || e.code === 'version')) continue;
          throw e;
        }
      }
      return this.createRoom(true, g);
    });
  }

  /** leave the room (safe to call when not in one); releases the mic. Cancels a create / join in flight. */
  leave(reason: LeaveReason = 'leave') {
    if (this.connecting) {
      this.gen++;
      this.connecting = 0;
      for (const r of this.joining) void r.close();
      this.joining.clear();
      log('join cancelled');
    }
    if (this.room) this.teardown(reason, false);
    else if (this.status === 'joining') {
      this.status = 'idle';
      this.emitMembers();
    }
  }

  private teardown(reason: LeaveReason, keepVoice: boolean) {
    const room = this.room;
    if (!room) return;
    this.lastLeft = room.code;
    log('leave', reason);
    const mySid = room.meta.sid;
    const mesh = this.mesh;
    // the authenticated goodbye rides the data channels; the room-channel one is a hint for relay-linked members
    if (mesh) { mesh.sendAll(encode(SYS.bye, { sid: mySid })); mesh.detach(); }
    room.send('ctl', { type: 'bye', from: this.myId, data: { sid: mySid } } satisfies CtlMsg);
    if (reason === 'unload') room.leaveNow();
    this.lobby.unpublish();
    if (!this.lobbyWatchers) this.lobby.close();
    // give the goodbye a moment to leave before the connections close
    if (mesh) { if (reason === 'unload') mesh.closeAll(); else window.setTimeout(() => mesh.closeAll(), 300); }
    this.mesh = null;
    this.voice.sink = () => {};
    this.voice.removeAllRemotes();
    if (!keepVoice) this.voice.disable();
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    clearTimeout(this.metaTimer);
    clearTimeout(this.relayTimer);
    clearTimeout(this.sigTimer);
    this.metaTimer = this.relayTimer = this.sigTimer = 0;
    this.relayQ = [];
    this.relayPending.clear();
    this.relayLatest.clear();
    this.sigQ.clear();
    this.simDue.clear();
    for (const st of this.inSeq.values()) clearTimeout(st.timer);
    this.inSeq.clear();
    this.outSeq.clear();
    this.room = null;
    this.active = false;
    this.code = null;
    this.isPublic = false;
    this.hostId = null;
    this.hostSid = '';
    this.term = this.hostedTerm = 0;
    this.status = 'idle';
    this.roomState = 'lobby';
    this.members.clear();
    this.gone.clear();
    this.live.clear();
    this.sids.clear();
    this.metaCast.clear();
    this.relayHold.clear();
    this.clockSamples = [];
    this.clockOffset = this.hostBase = 0;
    this.resumeUntil = this.rejoinUntil = this.downSince = 0;
    this.online = true;
    void room.close();
    this.emitMembers();
    for (const f of [...this.leaveSubs]) { try { f(reason); } catch (e) { console.error(e); } }
  }

  /** host only: kick a member (they get onLeave('kicked')). Goes over the data channel (or the relay). */
  kick(id: string) {
    if (!this.isHost || id === this.myId || !this.room || !this.members.has(id)) return;
    this.send(id, SYS.kick, { sid: this.sids.get(id) ?? '' });
  }

  /** host only: 'lobby' | 'playing' (public list + quick match) */
  setRoomState(state: RoomState) {
    if (!this.room || !this.isHost || state === this.roomState) return;
    this.roomState = state;
    this.room.meta.rs = state;
    this.room.meta.rev++;
    this.scheduleTrack();
    this.updateListing();
    this.emitMembers();
  }

  /** public rooms (subscribe with watchRooms first) */
  rooms(): RoomInfo[] { return this.lobby.rooms(); }

  /** keep the public room list fresh while the callback is subscribed */
  watchRooms(cb: () => void): () => void {
    this.lobbyWatchers++;
    void this.lobby.open().then(cb, () => undefined);
    const off = this.lobby.onChange(cb);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      off();
      this.lobbyWatchers--;
      if (!this.lobbyWatchers && !(this.room && this.isHost && this.isPublic)) this.lobby.close();
    };
  }

  // ---------------------------------------------------------------- messages

  /** to: 'all' | 'host' | member id. Reliable = ordered + retransmitted; unreliable = latest-state streams */
  send(to: 'all' | 'host' | string, type: string, data: unknown, reliable = true) {
    const mesh = this.mesh;
    if (!this.active || !mesh) return;
    let targets: string[];
    if (to === 'all') {
      targets = [];
      for (const id of this.members.keys()) if (id !== this.myId) targets.push(id);
    } else {
      const id = to === 'host' ? this.hostId : to;
      if (!id) return;
      if (id === this.myId) {
        // the host sending to 'host' (e.g. its own hits) gets it like everyone else, asynchronously
        queueMicrotask(() => this.deliver(this.myId, type, data, 'self'));
        return;
      }
      if (!this.members.has(id)) return;
      targets = [id];
    }
    if (!targets.length) return;
    const raw = encode(type, data);
    let relay: Dest[] | null = null;
    for (const id of targets) {
      if (reliable) {
        const seq = this.nextSeq(id);
        // older messages still queued for the relay go first (direct now if the link came up)
        if (this.relayPending.get(id)) this.relayKick(id);
        if (!this.relayPending.get(id) && mesh.send(id, withSeq(raw, seq), true)) this.stats.sent++;
        else (relay ??= []).push([id, seq, this.sids.get(id) ?? '']);
      } else if (mesh.send(id, raw, false)) this.stats.sent++;
      else if (mesh.link(id) === 'relay') this.relayState(id, type, data, raw.length);
    }
    if (relay) this.relayOut(type, data, relay, raw.length);
  }

  /** subscribe to a message type; returns unsubscribe */
  on(type: string, cb: Handler): () => void {
    let s = this.handlers.get(type);
    if (!s) { s = new Set(); this.handlers.set(type, s); }
    s.add(cb);
    return () => { s!.delete(cb); };
  }

  /** join / leave / meta change / host change / link change / room state change */
  onMembers(cb: () => void): () => void { this.memberSubs.add(cb); return () => { this.memberSubs.delete(cb); }; }

  /** I left the room (by myself, kicked, page closed) */
  onLeave(cb: (reason: LeaveReason) => void): () => void { this.leaveSubs.add(cb); return () => { this.leaveSubs.delete(cb); }; }

  /** my name / look / ready / scene, as everyone sees it (published at most once a second, coalesced) */
  setMeta(patch: MetaPatch) {
    if (patch.scene !== undefined) this.pre.scene = String(patch.scene);
    const room = this.room;
    if (!room) return;
    const m = room.meta;
    if (patch.name !== undefined) m.name = String(patch.name).trim().slice(0, 16) || m.name;
    if (patch.look) m.look = { ...m.look, ...patch.look };
    if (patch.hero) m.hero = { kind: patch.hero.kind, look: { ...patch.hero.look } };
    if (patch.ready !== undefined) m.ready = !!patch.ready;
    if (patch.scene !== undefined) m.scene = String(patch.scene);
    m.rev++;
    this.scheduleTrack();
    this.refresh();
  }

  // ---------------------------------------------------------------- chat

  /**
   * send a chat line to the room (rides the room channel, so it arrives even before P2P is up).
   * While the server is unreachable the line is queued and goes out when it is back (true = sent or queued).
   */
  chat(text: string): boolean {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.chatMaxLen);
    const room = this.room;
    if (!t || !room) return false;
    const now = Date.now();
    if (now - this.lastChat < LIMITS.chatMinGapMs) return false;
    this.lastChat = now;
    const msg: ChatMsg = { id: this.myId + '-' + ++this.chatSeq, from: this.myId, name: room.meta.name, text: t, ts: now };
    if (!room.send('chat', msg)) log('chat queued until the server is back');
    this.addChat(msg, false);
    return true;
  }

  /** (from, text, ts, name, history) — history = old lines sent by the host when I joined */
  onChat(cb: ChatHandler): () => void { this.chatSubs.add(cb); return () => { this.chatSubs.delete(cb); }; }

  // ---------------------------------------------------------------- clock

  /** host-synchronized clock in seconds (room epoch based; continuous across host changes; local clock when not in a room) */
  time(): number {
    if (!this.active) return performance.now() / 1000;
    const off = this.isHost ? this.hostBase : this.clockOffset;
    return (wallNow() + off - this.epoch) / 1000;
  }

  /** debug info for the test page */
  debug() {
    const tr = getTransport();
    return {
      transport: this.transport, status: this.status, online: this.online, code: this.code, host: this.hostId, term: this.term,
      me: this.myId, clockOffset: Math.round(this.isHost ? this.hostBase : this.clockOffset),
      relayQueue: this.relayQ.length, relayLatest: this.relayLatest.size, stats: { ...this.stats }, wire: { ...tr.stats },
      mesh: this.mesh ? { ...this.mesh.stats } : null, links: this.mesh?.debug() ?? [],
    };
  }

  // ================================================================ internals

  private check(g: number, room?: Room) {
    if (g === this.gen) return;
    if (room) void room.close();
    throw cancelled();
  }

  private async connect<T>(fn: (g: number) => Promise<T>): Promise<T> {
    if (this.connecting) throw new NetError('busy', ERR_TEXT.busy);
    const g = ++this.gen;
    this.connecting = g;
    if (this.room) this.teardown('leave', true); // switching rooms keeps the mic on
    this.status = 'joining';
    this.lastError = '';
    this.emitMembers();
    try {
      // a duplicated tab must have its own id before anyone sees it
      await profile.ready;
      this.check(g);
      profile.lock();
      return await fn(g);
    } catch (e) {
      if (g !== this.gen) throw e instanceof NetError && e.code === 'cancelled' ? e : cancelled();
      const err = e instanceof NetError ? e : new NetError('network', ERR_TEXT.network);
      if (!(e instanceof NetError)) console.warn('[net]', e);
      this.status = this.room ? 'room' : 'idle';
      this.lastError = err.message;
      this.emitMembers();
      throw err;
    } finally {
      if (this.connecting === g) { this.connecting = 0; this.joining.clear(); }
    }
  }

  private async createRoom(pub: boolean, g: number): Promise<string> {
    for (let i = 0; i < 6; i++) {
      const code = randomCode();
      const room = this.makeRoom(code, pub);
      try {
        await room.join('create');
      } catch (e) {
        this.check(g);
        if (e instanceof NetError && e.code === 'taken') continue;
        throw e;
      }
      this.check(g, room);
      this.enter(room);
      return code;
    }
    throw new NetError('network', ERR_TEXT.network);
  }

  private makeRoom(code: string, pub: boolean): Room {
    const now = Date.now();
    const sid = Math.random().toString(36).slice(2, 10);
    const meta: MemberMeta = {
      id: this.myId,
      sid,
      name: profile.name,
      look: { ...profile.look },
      hero: profile.pick(),
      ready: false,
      joinedAt: now,
      scene: this.pre.scene,
      v: PROTOCOL_VERSION,
      pub,
      ep: now,
      rs: 'lobby',
      rev: 0,
      // the creator hosts term 1; a joiner takes the room's (Room.join)
      h: this.myId,
      hs: sid,
      ht: 1,
    };
    const room = new Room(getTransport(), code, this.myId, meta);
    this.joining.add(room);
    return room;
  }

  private enter(room: Room) {
    this.joining.delete(room);
    this.room = room;
    this.code = room.code;
    this.isPublic = room.meta.pub;
    this.active = true;
    this.status = 'room';
    this.online = room.online;
    this.roomState = room.meta.rs;
    // the clock epoch is the creator's join time, so net.time() starts near 0 and survives host changes
    this.epoch = room.meta.ep;
    this.chatLog.length = 0;
    const now = Date.now();
    this.enteredAt = now;
    this.lastTick = now;
    for (const k of Object.keys(this.stats) as (keyof Net['stats'])[]) this.stats[k] = 0;
    // the host I follow (the creator: me, term 1); the session confirms it against liveness
    this.term = room.meta.ht || 1;
    this.hostId = room.meta.h || this.myId;
    this.hostSid = room.meta.hs;
    if (this.hostId === this.myId) this.hostedTerm = this.term;
    this.hostBase = this.clockOffset = 0;
    const myId = this.myId;
    const mesh = new Mesh({
      myId,
      mySid: room.meta.sid,
      signal: (to, data) => this.sigOut(to, data),
      onMessage: (from, sid, raw) => (NET_SIM ? this.simP2P(from, sid, raw) : this.onP2P(from, sid, raw)),
      onLink: (id, link) => {
        const L = this.live.get(id);
        if (L) L.p2pSince = link === 'p2p' ? Date.now() : 0;
        if (link === 'p2p') { if (L) L.p2pEver = true; this.relayKick(id); }
        const m = this.members.get(id);
        const turn = !!this.mesh?.viaTurn(id);
        if (m && (m.link !== link || m.turn !== turn)) { m.link = link; m.turn = turn; this.emitMembers(); }
      },
      onTrack: (id, track) => this.voice.addRemote(id, track),
      onPeerClosed: (id) => this.voice.removeRemote(id),
    });
    this.mesh = mesh;
    mesh.setLocalAudio(this.voice.micTrack);
    this.voice.sink = (t) => this.mesh?.setLocalAudio(t);
    room.ch.onPresence(() => this.refresh());
    room.onStatus((s) => this.onServer(s === 'up'));
    for (const m of room.drainAcks()) this.metaCast.set(m.id, { meta: m, at: now });
    // members + host first: queued room events (e.g. the host's chat history) are checked against them
    this.refresh();
    this.castMeta();
    this.lastMetaSent = now;
    room.start({
      sig: (p: SigMsg) => this.onSig(p),
      chat: (p: ChatMsg) => this.onChatMsg(p),
      ctl: (p: CtlMsg) => this.onCtl(p),
      relay: (p: RelayMsg) => (NET_SIM ? this.simHold('relay:' + p?.from, () => this.onRelay(p)) : this.onRelay(p)),
    });
    this.timers.push(window.setInterval(() => this.pingTick(), LIMITS.pingMs));
    log('entered', room.code, room.meta.pub ? 'public' : 'private', 'host', this.hostId, 'term', this.term);
  }

  private sidOf(id: string) { return id === this.myId ? this.room?.meta.sid ?? '' : this.sids.get(id) ?? ''; }

  private liveOf(id: string, sid: string): Live {
    let L = this.live.get(id);
    if (!L || L.sid !== sid) {
      L = { sid, heardAt: 0, heardP2P: 0, gossipAt: 0, linkAt: 0, p2pEver: false, p2pSince: 0, missingSince: 0, bye: null, ann: null };
      this.live.set(id, L);
    }
    return L;
  }

  /**
   * how long a member may stay silent: aliveMs, or aliveLinkedMs while someone's direct link to it is still up (its
   * page is busy, its browser isn't gone). Everyone sees the same gossip, so everyone picks the same limit.
   */
  private silence(id: string, L: Live, now: number): number {
    if (this.mesh?.linkAlive(id)) L.linkAt = now;
    return now - L.linkAt < 2500 ? LIMITS.aliveLinkedMs : LIMITS.aliveMs;
  }

  /** alive = heard lately (by me or someone I hear, see silence()), or a relay-only member still in the room */
  private alive(id: string, now: number): boolean {
    if (id === this.myId) return true;
    if (!this.members.has(id)) return false;
    if (now < this.resumeUntil) return true;
    const L = this.live.get(id);
    if (!L) return true;
    const fresh = Math.max(L.heardAt, L.gossipAt);
    if (fresh && now - fresh <= this.silence(id, L, now)) return true;
    return !L.p2pEver;
  }

  private heard(id: string, p2p: boolean) {
    const L = this.live.get(id);
    if (!L) return;
    const now = Date.now();
    L.heardAt = now;
    if (p2p) { L.heardP2P = now; L.p2pEver = true; }
  }

  private noteAnn(id: string, term: unknown, host: unknown, hsid: unknown) {
    const L = this.live.get(id);
    if (!L || typeof term !== 'number' || typeof host !== 'string' || !host) return;
    const hs = typeof hsid === 'string' ? hsid : '';
    if (!L.ann || term >= L.ann.term) {
      const newer = !L.ann || term > L.ann.term || L.ann.host !== host;
      L.ann = { term, host, hsid: hs };
      // a newer term than mine: settle the host now rather than on the next tick
      if (newer && term > this.term) queueMicrotask(() => this.refresh());
    }
  }

  /** ping gossip: who the sender hears and how long ago */
  private noteSeen(from: string, seen: unknown) {
    if (!Array.isArray(seen)) return;
    const now = Date.now();
    for (const e of seen) {
      if (!Array.isArray(e) || typeof e[0] !== 'string' || e[0] === this.myId || e[0] === from) continue;
      const L = this.live.get(e[0]);
      if (!L) continue;
      const age = Number(e[1]);
      if (!(age >= 0 && age < GOSSIP_MS)) continue;
      L.gossipAt = Math.max(L.gossipAt, now - age);
      if (e[2]) L.p2pEver = true;
      // 2 = their direct link to it is up right now
      if (e[2] === 2) L.linkAt = now;
    }
  }

  /** members I heard lately (or whose direct link is up): [id, ms ago, 0 relay / 1 direct / 2 direct and up now] */
  private seenList(now: number): [string, number, number][] {
    const out: [string, number, number][] = [];
    for (const [id, L] of this.live) {
      const up = !!this.mesh?.linkAlive(id);
      if (!this.members.has(id) || ((!L.heardAt || now - L.heardAt > GOSSIP_MS) && !up)) continue;
      out.push([id, L.heardAt ? Math.min(now - L.heardAt, GOSSIP_MS - 1) : GOSSIP_MS - 1, up ? 2 : this.mesh?.link(id) === 'p2p' ? 1 : 0]);
    }
    return out;
  }

  /** rebuild members from presence + liveness; host; mesh links; lobby listing */
  private refresh() {
    const room = this.room;
    const mesh = this.mesh;
    if (!room || !mesh) return;
    const now = Date.now();
    const myId = this.myId;
    const presence = room.members();
    const inPresence = new Set(presence.map((m) => m.sid));
    for (const sid of [...this.gone]) {
      if (!inPresence.has(sid) && ![...this.metaCast.values()].some((c) => c.meta.sid === sid)) this.gone.delete(sid);
    }
    // presence merged with the fresher broadcast metas
    const byId = new Map(presence.map((m) => [m.id, m]));
    for (const [id, c] of this.metaCast) {
      const p = byId.get(id);
      // same tab: higher rev wins; reloaded tab (new sid): the later join wins
      const stale = p && (p.sid === c.meta.sid ? p.rev >= c.meta.rev : p.joinedAt >= c.meta.joinedAt);
      if (stale) { this.metaCast.delete(id); continue; }
      if (!p && now - c.at > PRESENCE_SETTLE_MS * 2) { this.metaCast.delete(id); continue; }
      byId.set(id, c.meta);
    }
    const present = [...byId.values()].filter((m) => !this.gone.has(m.sid) && (m.id !== myId || m.sid === room.meta.sid));
    let changed = false;
    const newcomers: string[] = [];

    for (const m of present) {
      const isMe = m.id === myId;
      const meta = isMe ? room.meta : m;
      let mem = this.members.get(m.id);
      if (!isMe) {
        const oldSid = this.sids.get(m.id);
        if (oldSid && oldSid !== meta.sid) {
          // reloaded tab: a new instance (the old one's host seat, sequence and link are gone)
          log('member', m.id, 'new instance');
          this.relayPurge(m.id);
        }
        this.sids.set(m.id, meta.sid);
        const L = this.liveOf(m.id, meta.sid);
        L.missingSince = 0;
        this.noteAnn(m.id, meta.ht, meta.h, meta.hs);
      }
      if (!mem) {
        mem = {
          id: m.id, name: meta.name, look: meta.look, hero: meta.hero, ready: meta.ready, joinedAt: meta.joinedAt, scene: meta.scene,
          ping: isMe ? 0 : -1, link: isMe ? 'p2p' : mesh.link(m.id), turn: !isMe && mesh.viaTurn(m.id),
          speaking: false, muted: !isMe && this.voice.isMuted(m.id), isHost: false, isMe,
        };
        this.members.set(m.id, mem);
        changed = true;
        if (!isMe) newcomers.push(m.id);
      } else if (
        mem.name !== meta.name || mem.ready !== meta.ready || mem.scene !== meta.scene || mem.joinedAt !== meta.joinedAt ||
        JSON.stringify(mem.look) !== JSON.stringify(meta.look) || JSON.stringify(mem.hero) !== JSON.stringify(meta.hero)
      ) {
        mem.name = meta.name; mem.ready = meta.ready; mem.scene = meta.scene; mem.joinedAt = meta.joinedAt; mem.look = meta.look; mem.hero = meta.hero;
        changed = true;
      }
    }
    // the last seat taken twice (presence reaches everyone with a delay): the later one backs off
    if (this.members.size > MAX_PLAYERS && now - this.enteredAt < PRESENCE_SETTLE_MS * 2) {
      const order = [...this.members.values()].sort((a, b) => (earlier(a, b) ? -1 : 1));
      if (order.findIndex((m) => m.isMe) >= MAX_PLAYERS) {
        this.lastError = ERR_TEXT.full;
        this.leave('full');
        return;
      }
    }

    // not in presence: keep while heard / in grace / while I can't see presence myself
    const seen = new Set(present.map((m) => m.id));
    for (const [id, mem] of [...this.members]) {
      if (mem.isMe) continue;
      const sid = this.sids.get(id) ?? '';
      const L = this.liveOf(id, sid);
      let drop = this.gone.has(sid);
      if (!drop && L.bye) {
        // an unauthenticated bye: believe it unless they still talk to me directly
        const talking = mesh.link(id) === 'p2p' && now - L.heardP2P < BYE_HEARD_MS;
        if (L.bye.sid !== sid || (talking && now - L.bye.at > 5000)) L.bye = null;
        else if (!talking) { this.gone.add(sid); drop = true; log('bye (hint) from', id); }
      }
      if (!drop && !seen.has(id)) {
        L.missingSince ||= now;
        const fresh = Math.max(L.heardAt, L.gossipAt);
        const heard = fresh > 0 && now - fresh <= this.silence(id, L, now);
        // never drop someone still heard; relay-linked members (heard over the relay, never directly) get a
        // grace for presence blips; while my own server link is down my presence view is stale: keep everyone.
        // Someone never heard at all (a joiner that backed off) goes at once.
        const graced = !L.p2pEver && fresh > 0 && now - L.missingSince < LIMITS.presenceGraceMs;
        drop = !(!this.online || now < this.resumeUntil || heard || graced);
      }
      if (drop) { this.removeMember(id); changed = true; }
    }

    if (this.decideHost(now)) changed = true;
    for (const mem of this.members.values()) mem.isHost = mem.id === this.hostId;

    // room state comes from the host's meta (mine when I'm the host)
    if (this.hostId && this.hostId !== myId) {
      const hm = byId.get(this.hostId);
      if (hm && hm.rs !== this.roomState) { this.roomState = hm.rs; changed = true; }
    }

    // keep member order = join order
    if (changed) this.sortMembers();

    mesh.sync([...this.members.keys()].filter((id) => id !== myId).map((id) => ({ id, sid: this.sids.get(id) ?? '' })));
    this.updateListing();
    if (this.isHost && newcomers.length && this.chatLog.length) {
      const log20 = this.chatLog.slice(-20);
      for (const id of newcomers) room.sendTo(id, 'ctl', { type: 'chatlog', from: myId, to: id, data: log20 } satisfies CtlMsg);
    }
    if (changed) this.emitMembers();
    // relayed messages that arrived before their sender's membership
    for (const [id, h] of this.relayHold) {
      if (now - h.at > PRESENCE_SETTLE_MS) { this.relayHold.delete(id); continue; }
      if (!this.members.has(id) || this.sids.get(id) !== h.list[0]?.sid) continue;
      this.relayHold.delete(id);
      queueMicrotask(() => { for (const p of h.list) this.onRelay(p); });
    }
  }

  private sortMembers() {
    const sorted = [...this.members.values()].sort((a, b) => (earlier(a, b) ? -1 : 1));
    this.members.clear();
    for (const m of sorted) this.members.set(m.id, m);
  }

  private removeMember(id: string) {
    log('member gone', id);
    this.members.delete(id);
    this.live.delete(id);
    this.sids.delete(id);
    this.metaCast.delete(id);
    this.relayPurge(id);
    this.mesh?.drop(id);
    this.voice.removeRemote(id);
  }

  /**
   * The host everyone follows: the newest term announced by a live member wins (ties: smaller id), as long
   * as that host is still a live member with the same instance. Otherwise (it died / left / reloaded) elect
   * the earliest-joined live member at term + 1 — everybody computes the same from the same gossip.
   */
  private decideHost(now: number): boolean {
    const room = this.room;
    if (!room) return false;
    let maxTerm = this.term;
    for (const [id, L] of this.live) if (L.ann && this.alive(id, now)) maxTerm = Math.max(maxTerm, L.ann.term);
    let pick: { host: string; hsid: string } | null = null;
    const consider = (term: number, host: string | null, hsid: string) => {
      if (term !== maxTerm || !host || !this.members.has(host) || !this.alive(host, now)) return;
      const sid = this.sidOf(host);
      if (hsid && hsid !== sid) return; // a previous instance of that tab
      if (!pick || host < pick.host) pick = { host, hsid: sid };
    };
    consider(this.term, this.hostId, this.hostSid);
    for (const [id, L] of this.live) if (L.ann && this.alive(id, now)) consider(L.ann.term, L.ann.host, L.ann.hsid);
    if (now < this.rejoinUntil) {
      // a frozen ex-host: the room has most likely moved on — follow its newer term, never elect myself
      if (pick && maxTerm > this.term) return this.setHost((pick as { host: string }).host, (pick as { hsid: string }).hsid, maxTerm);
      return false;
    }
    if (pick) return this.setHost((pick as { host: string }).host, (pick as { hsid: string }).hsid, maxTerm);
    // presence may still be settling right after I came in: keep what the room told me
    if (now - this.enteredAt < PRESENCE_SETTLE_MS && this.members.size > 1) return false;
    // I hear nobody and can't reach the server: I'm the one cut off — don't crown myself
    if (!this.online && this.members.size > 1) {
      let anyone = false;
      for (const [id, L] of this.live) if (this.members.has(id) && now - Math.max(L.heardAt, L.gossipAt) <= LIMITS.aliveMs) anyone = true;
      if (!anyone) return false;
    }
    let best: Member | null = null;
    for (const m of this.members.values()) if (this.alive(m.id, now) && (!best || earlier(m, best))) best = m;
    if (!best) return false;
    log('elect', best.id, 'term', maxTerm + 1);
    return this.setHost(best.id, this.sidOf(best.id), maxTerm + 1);
  }

  private setHost(host: string, hsid: string, term: number): boolean {
    const room = this.room;
    if (!room) return false;
    if (host === this.hostId && hsid === this.hostSid && term === this.term) return false;
    const me = this.myId;
    const prev = this.hostId;
    const prevTerm = this.term;
    this.term = term;
    this.hostId = host;
    this.hostSid = hsid;
    room.meta.h = host;
    room.meta.ht = term;
    room.meta.hs = hsid;
    room.meta.rev++;
    if (prev !== host) {
      this.stats.hostChanges++;
      log('host', prev, '->', host, 'term', prevTerm, '->', term);
      this.clockSamples = [];
      if (host === me) {
        // my room clock continues where I had it synced; I inherit the room state
        this.hostBase = this.clockOffset;
        this.hostedTerm = term;
        room.meta.rs = this.roomState;
      } else if (prev === me) {
        this.clockOffset = this.hostBase;
      }
    } else if (host === me) this.hostedTerm = term;
    // the room moved on without me while I was its host: sort myself after everyone (never grab it back)
    if (host !== me && this.hostedTerm && term > this.hostedTerm) {
      this.hostedTerm = 0;
      this.rejoinUntil = 0;
      this.resort();
    }
    this.scheduleTrack();
    return true;
  }

  /** re-join order: joinedAt = max(others) + 1 (a returning member never sorts before the others again) */
  private resort() {
    const room = this.room;
    if (!room) return;
    let max = 0;
    for (const m of this.members.values()) if (!m.isMe) max = Math.max(max, m.joinedAt);
    if (room.meta.joinedAt > max) return;
    log('re-sort after', max);
    room.meta.joinedAt = max + 1;
    room.meta.rev++;
    const me = this.members.get(this.myId);
    if (me) { me.joinedAt = room.meta.joinedAt; this.sortMembers(); this.emitMembers(); }
    this.trackNow();
  }

  /** signaling server link up / down */
  private onServer(up: boolean) {
    const now = Date.now();
    if (!up) {
      this.online = false;
      this.downSince = now;
      log('server down');
      this.emitMembers();
      return;
    }
    const long = this.downSince > 0 && now - this.downSince >= LIMITS.longOutageMs;
    log('server up', long ? '(after a long outage)' : '');
    this.online = true;
    this.downSince = 0;
    // presence was re-tracked by the channel: a returning non-host re-sorts itself after everyone
    if (long && this.hostId !== this.myId) this.resort();
    this.castMeta();
    this.refresh();
    this.flushRelay();
    this.emitMembers();
  }

  /** my page didn't run for a while (frozen tab, sleeping laptop): the others likely moved on */
  private onResume(gap: number) {
    const now = Date.now();
    log('resumed after', gap, 'ms');
    this.resumeUntil = now + LIMITS.aliveMs;
    // the others waited longer for me if my direct links stayed up (they still are now): then they didn't move on yet
    let linked = false;
    for (const id of this.members.keys()) if (id !== this.myId && this.mesh?.linkAlive(id)) linked = true;
    if (this.isHost && this.members.size > 1 && gap > (linked ? LIMITS.aliveLinkedMs : LIMITS.aliveMs)) {
      // they stopped hearing me long ago and elected the next one: follow it at my term, so a newer term
      // (theirs) wins at once — and if they never moved on, their announcements give the seat back to me
      let next: Member | null = null;
      for (const m of this.members.values()) if (!m.isMe && (!next || earlier(m, next))) next = m;
      if (next) {
        this.setHost(next.id, this.sidOf(next.id), this.term);
        this.rejoinUntil = now + 20_000;
        // what I knew about their hosts is from before the freeze
        for (const L of this.live.values()) L.ann = null;
      }
      for (const mem of this.members.values()) mem.isHost = mem.id === this.hostId;
      this.emitMembers();
    }
  }

  private updateListing() {
    if (!this.room) return;
    if (this.isPublic && this.isHost) {
      this.lobby.publish({
        code: this.room.code, n: this.members.size, max: MAX_PLAYERS, state: this.roomState,
        host: this.room.meta.name, v: PROTOCOL_VERSION,
      });
    } else if (this.lobby.isOpen) {
      this.lobby.unpublish();
      if (!this.lobbyWatchers) this.lobby.close();
    }
  }

  /** presence + meta broadcast, at most once per LIMITS.metaMinGapMs (leading + trailing, coalesced) */
  private scheduleTrack() {
    if (this.metaTimer || !this.room) return;
    const wait = Math.max(0, this.lastMetaSent + LIMITS.metaMinGapMs - Date.now());
    this.metaTimer = window.setTimeout(() => {
      this.metaTimer = 0;
      this.lastMetaSent = Date.now();
      this.room?.update();
      this.castMeta();
    }, wait);
  }

  private trackNow() {
    clearTimeout(this.metaTimer);
    this.metaTimer = 0;
    this.lastMetaSent = Date.now();
    this.room?.update();
    this.castMeta();
  }

  /** fast path for my meta (presence is the slow, authoritative one) */
  private castMeta() {
    const room = this.room;
    if (room) room.send('ctl', { type: 'meta', from: this.myId, data: { ...room.meta } } satisfies CtlMsg);
  }

  private deliver(from: string, type: string, data: unknown, via: Via) {
    if (isSysType(type)) { this.onSys(from, type, data, via); return; }
    this.stats.recv++;
    const hs = this.handlers.get(type);
    if (!hs) return;
    for (const h of [...hs]) {
      try { h(data, from); } catch (e) { console.error('[net] handler', type, e); }
    }
  }

  // ---- reliable sequencing

  private nextSeq(id: string): number {
    const sid = this.sids.get(id) ?? '';
    let s = this.outSeq.get(id);
    if (!s || s.sid !== sid) { s = { sid, n: 0 }; this.outSeq.set(id, s); }
    return ++s.n;
  }

  /** a numbered reliable message (either path): delivered in order; a hole waits seqGapMs, then is skipped */
  private receive(from: string, sid: string, seq: number, type: string, data: unknown, via: Via) {
    let st = this.inSeq.get(from);
    if (!st || st.sid !== sid) {
      if (st) clearTimeout(st.timer);
      st = { sid, next: 1, buf: new Map(), holes: [], timer: 0 };
      this.inSeq.set(from, st);
    }
    if (seq < st.next) {
      // arrived after its hole was skipped: late beats never (duplicates can't happen: each message takes one path)
      if (this.unhole(st, seq)) { this.stats.late++; this.deliver(from, type, data, via); }
      return;
    }
    if (seq > st.next + SEQ_MAX_JUMP) return;
    if (seq > st.next) {
      if (!st.buf.has(seq)) { st.buf.set(seq, [type, data, via]); this.stats.relayReordered++; }
      this.armGap(from, st);
      return;
    }
    st.next++;
    this.deliver(from, type, data, via);
    this.drain(from, st);
  }

  private drain(from: string, st: InSeq) {
    let m: [string, unknown, Via] | undefined;
    while (this.inSeq.get(from) === st && (m = st.buf.get(st.next))) {
      st.buf.delete(st.next);
      st.next++;
      this.deliver(from, m[0], m[1], m[2]);
    }
    if (this.inSeq.get(from) !== st) return;
    if (st.buf.size) this.armGap(from, st);
    else { clearTimeout(st.timer); st.timer = 0; }
  }

  private armGap(from: string, st: InSeq) {
    if (st.timer) return;
    st.timer = window.setTimeout(() => {
      st.timer = 0;
      if (this.inSeq.get(from) !== st || !st.buf.size) return;
      const to = Math.min(...st.buf.keys());
      st.holes.push([st.next, to]);
      if (st.holes.length > 64) st.holes.shift();
      this.stats.skipped += to - st.next;
      log('skip', from, st.next, '->', to);
      st.next = to;
      this.drain(from, st);
    }, LIMITS.seqGapMs);
  }

  /** seq was skipped earlier: take it out of its hole (true = deliver it late) */
  private unhole(st: InSeq, seq: number): boolean {
    for (let i = 0; i < st.holes.length; i++) {
      const [a, b] = st.holes[i];
      if (seq < a || seq >= b) continue;
      const parts: [number, number][] = [];
      if (seq > a) parts.push([a, seq]);
      if (seq + 1 < b) parts.push([seq + 1, b]);
      st.holes.splice(i, 1, ...parts);
      return true;
    }
    return false;
  }

  // ---- incoming

  private onP2P(from: string, sid: string, raw: string) {
    // only the member's current instance is heard (a leftover connection of someone who left is not)
    if (!this.members.has(from) || this.sids.get(from) !== sid) return;
    this.heard(from, true);
    const m = decodeSeq(raw);
    if (!m) return;
    if (m.seq) this.receive(from, sid, m.seq, m.type, m.data, 'p2p');
    else this.deliver(from, m.type, m.data, 'p2p');
  }

  // ---- simulated bad network (tests: ?lag / ?jitter / ?loss, see NET_SIM)

  /** an incoming data-channel message: numbered = the reliable, ordered channel (so is my bye); the rest may be lost */
  private simP2P(from: string, sid: string, raw: string) {
    const ordered = raw.charCodeAt(1) !== 34 || raw.startsWith('["' + SYS.bye);
    this.simHold(ordered ? 'r:' + from : null, () => this.onP2P(from, sid, raw));
  }

  /** hold an incoming message for lag ± jitter; an ordered stream keeps its order, a lossy one may drop it */
  private simHold(stream: string | null, f: () => void) {
    const s = NET_SIM;
    if (!s) { f(); return; }
    const now = performance.now();
    let d = s.lag + (Math.random() * 2 - 1) * s.jitter;
    if (Math.random() * 100 < s.loss) {
      if (!stream) { this.stats.simDropped++; return; }
      d += Math.max(200, s.lag * 2); // lost on the wire: SCTP / TCP sends it again
    }
    let due = now + Math.max(0, d);
    if (stream) { due = Math.max(due, this.simDue.get(stream) ?? 0); this.simDue.set(stream, due); }
    const room = this.room;
    window.setTimeout(() => { if (this.room && this.room === room) f(); }, due - now);
  }

  private onSig(p: SigMsg) {
    if (!p || typeof p.from !== 'string' || p.from === this.myId || !Array.isArray(p.items)) return;
    // any sign of life counts (a member renegotiating its link is there)
    if (this.sids.get(p.from) === p.sid) this.heard(p.from, false);
    for (const d of p.items) if (d && typeof d === 'object') this.mesh?.signal(p.from, d);
  }

  /** outgoing signaling: everything for one member in this tick goes in one post */
  private sigOut(to: string, data: SigData) {
    let q = this.sigQ.get(to);
    if (!q) { q = []; this.sigQ.set(to, q); }
    q.push(data);
    if (this.sigTimer) return;
    this.sigTimer = window.setTimeout(() => {
      this.sigTimer = 0;
      const room = this.room;
      if (!room) return;
      for (const [id, items] of this.sigQ) room.sendTo(id, 'sig', { from: this.myId, sid: room.meta.sid, items } satisfies SigMsg);
      this.sigQ.clear();
    }, 0);
  }

  // ---- ping / clock / liveness

  private pingTick() {
    const now = Date.now();
    const gap = now - this.lastTick;
    this.lastTick = now;
    const mesh = this.mesh;
    if (!mesh || !this.room) return;
    if (gap > LIMITS.frozenMs) this.onResume(gap);
    const t = performance.now();
    const ping = encode(SYS.ping, [t, this.term, this.hostId, this.hostSid, this.seenList(now)]);
    for (const id of this.members.keys()) {
      if (id === this.myId) continue;
      if (mesh.link(id) === 'p2p') mesh.send(id, ping, false);
    }
    // the host link is relayed: ping it over the relay (clock sync + it hears me, I hear it)
    const h = this.hostId;
    if (h && h !== this.myId && this.members.has(h) && mesh.link(h) === 'relay' && now - this.lastRelayPing > LIMITS.relayPingMs) {
      this.lastRelayPing = now;
      this.relayState(h, SYS.ping, [t, this.term, this.hostId, this.hostSid, this.seenList(now), this.members.get(h)?.ping ?? -1], 200);
    }
    this.refresh();
    if (this.relayQ.length || this.relayLatest.size) this.flushRelay();
  }

  private onSys(from: string, type: string, data: unknown, via: Via) {
    if (type === SYS.ping && Array.isArray(data)) {
      this.noteAnn(from, data[1], data[2], data[3]);
      this.noteSeen(from, data[4]);
      const reply = [data[0], wallNow() + (this.isHost ? this.hostBase : this.clockOffset), this.term, this.hostId, this.hostSid];
      if (via === 'relay') {
        this.relayState(from, SYS.pong, reply, 80);
        // a relay-linked member's round trip to me, as it measured it (I don't ping over the relay myself)
        const rtt = Number(data[5]), m = this.members.get(from);
        if (m && rtt > 0 && rtt < 30_000) m.ping = Math.round(rtt);
      }
      else this.mesh?.send(from, encode(SYS.pong, reply), false);
    } else if (type === SYS.pong && Array.isArray(data)) {
      const t0 = Number(data[0]);
      const theirNow = Number(data[1]);
      this.noteAnn(from, data[2], data[3], data[4]);
      const rtt = performance.now() - t0;
      if (!(rtt >= 0 && rtt < 30_000)) return;
      const m = this.members.get(from);
      if (m) m.ping = Math.round(m.ping < 0 ? rtt : m.ping * 0.7 + rtt * 0.3);
      if (from === this.hostId && !this.isHost && Number.isFinite(theirNow)) {
        this.clockSamples.push({ rtt, off: theirNow + rtt / 2 - wallNow() });
        if (this.clockSamples.length > 12) this.clockSamples.shift();
        // the fastest round trip gives the most trustworthy offset
        let best = this.clockSamples[0];
        for (const s of this.clockSamples) if (s.rtt < best.rtt) best = s;
        this.clockOffset = best.off;
      }
    } else if (type === SYS.kick) {
      // only the current host may kick, over its own data channel (a relayed kick only when there is no direct link)
      const sid = (data as { sid?: unknown } | null)?.sid;
      if (from !== this.hostId || sid !== this.room?.meta.sid) return;
      if (via === 'relay' && this.mesh?.link(from) === 'p2p') return;
      if (via === 'self') return;
      log('kicked by', from);
      this.leave('kicked');
    } else if (type === SYS.bye) {
      // over the data channel = really them
      const sid = (data as { sid?: unknown } | null)?.sid;
      if (via !== 'p2p' || typeof sid !== 'string' || sid !== this.sids.get(from)) return;
      log('bye from', from);
      this.gone.add(sid);
      this.removeMember(from);
      this.refresh();
      this.emitMembers();
    }
  }

  // ---- relay (Supabase, budgeted, batched)

  private relayOut(t: string, d: unknown, dests: Dest[], rawLen: number) {
    this.relayQ.push({ t, d, dests, size: rawLen + 28 * dests.length + 16 });
    for (const [id] of dests) this.relayPending.set(id, (this.relayPending.get(id) ?? 0) + 1);
    // overflow: the oldest go (their receivers skip the hole after seqGapMs)
    while (this.relayQ.length > LIMITS.relayQueue) {
      const it = this.relayQ.shift()!;
      for (const [id] of it.dests) this.unpend(id);
      this.stats.relayDropped++;
    }
    this.flushRelay();
  }

  /** newest unreliable message per (type, member): older ones are worthless — except sampled streams (see LIMITS) */
  private relayState(id: string, t: string, d: unknown, rawLen: number) {
    const k = t + '\u0000' + id;
    let e = this.relayLatest.get(k);
    if (!e) { e = { id, t, list: [], next: 0 }; this.relayLatest.set(k, e); }
    const it = { d, size: rawLen + 40 };
    const hz = LIMITS.relaySampleHz[t] ?? 0;
    const now = performance.now();
    if (hz > 0 && (!e.list.length || now >= e.next)) {
      // a new sample slot (the newest message always fills the last one)
      const period = 1000 / hz;
      e.next = e.list.length && e.next + period > now ? e.next + period : now + period;
      e.list.push(it);
      if (e.list.length > LIMITS.relaySampleKeep) e.list.shift();
    } else if (e.list.length) e.list[e.list.length - 1] = it;
    else e.list.push(it);
    this.flushRelay();
  }

  private unpend(id: string) {
    const n = (this.relayPending.get(id) ?? 1) - 1;
    if (n > 0) this.relayPending.set(id, n);
    else this.relayPending.delete(id);
  }

  /** a member left / reloaded: nothing queued for it goes out */
  private relayPurge(id: string) {
    if (this.relayPending.get(id)) {
      for (const it of this.relayQ) it.dests = it.dests.filter((x) => x[0] !== id);
      this.relayQ = this.relayQ.filter((it) => it.dests.length);
      this.relayPending.delete(id);
    }
    for (const [k, it] of this.relayLatest) if (it.id === id) this.relayLatest.delete(k);
  }

  /** a link came up: messages queued for it go direct, in order */
  private relayKick(id: string) {
    const mesh = this.mesh;
    // queued state for it is stale only once the link is direct (this also runs on every reliable send while
    // it's relayed: wiping the state then dropped most of the host's snapshots to relay-linked friends)
    if (mesh?.link(id) === 'p2p') for (const [k, it] of this.relayLatest) if (it.id === id) this.relayLatest.delete(k);
    if (!mesh || !this.relayPending.get(id)) return;
    for (const it of this.relayQ) {
      const i = it.dests.findIndex((x) => x[0] === id);
      if (i < 0) continue;
      if (!mesh.send(id, withSeq(encode(it.t, it.d), it.dests[i][1]), true)) break;
      it.dests.splice(i, 1);
      this.unpend(id);
      this.stats.sent++;
    }
    this.relayQ = this.relayQ.filter((it) => it.dests.length);
  }

  /**
   * One relay batch, at most every relayMinGapMs, within the Supabase budget (LIMITS.relayUnitsPerSec):
   * a room-wide batch costs N (1 sent + N-1 delivered), a batch into one inbox costs 2 per member.
   * Never while the server is unreachable: the queue waits (and a link that comes up meanwhile takes it).
   */
  private flushRelay() {
    const room = this.room;
    const mesh = this.mesh;
    if (!room || !mesh || this.relayTimer) return;
    if (!this.relayQ.length && !this.relayLatest.size) return;
    if (!this.online) return;
    const later = (ms: number) => { this.relayTimer = window.setTimeout(() => { this.relayTimer = 0; this.flushRelay(); }, ms); };
    const now = performance.now();
    const gap = this.lastRelayFlush + LIMITS.relayMinGapMs - now;
    if (gap > 0) { later(gap); return; }
    // assemble one batch
    const entries: RelayEntry[] = [];
    const targets = new Set<string>();
    let size = 0;
    let nRel = 0;
    for (const it of this.relayQ) {
      if (entries.length && size + it.size > LIMITS.relayBatchBytes) break;
      entries.push([it.t, it.d, it.dests]);
      for (const [id] of it.dests) targets.add(id);
      size += it.size;
      nRel++;
    }
    const latest: string[] = [];
    // the same state sent to several relay-linked members ('all') goes into the batch once, with all of them as dests
    const shared = new Map<unknown, RelayEntry>();
    for (const [k, it] of this.relayLatest) {
      if (mesh.link(it.id) !== 'relay' || !this.members.has(it.id)) { this.relayLatest.delete(k); continue; }
      let sz = 0;
      for (const x of it.list) sz += shared.has(x.d) ? 28 : x.size;
      if (entries.length && size + sz > LIMITS.relayBatchBytes) break;
      const dest: Dest = [it.id, 0, this.sids.get(it.id) ?? ''];
      for (const x of it.list) {
        const e = shared.get(x.d);
        if (e) e[2].push(dest);
        else { const ne: RelayEntry = [it.t, x.d, [dest]]; entries.push(ne); if (x.d && typeof x.d === 'object') shared.set(x.d, ne); }
      }
      targets.add(it.id);
      size += sz;
      latest.push(k);
    }
    if (!entries.length) return;
    const n = Math.max(2, this.members.size);
    const viaInbox = 2 * targets.size < n;
    const cost = viaInbox ? 2 * targets.size : n;
    // my share of the room's budget (every member may be relaying at the same time)
    const rate = Math.min(LIMITS.relayUnitsPerSec, LIMITS.relayRoomUnitsPerSec / Math.max(1, this.members.size - 1));
    this.relayTokens = Math.min(LIMITS.relayBurstUnits, this.relayTokens + ((now - this.relayRefill) / 1000) * rate);
    this.relayRefill = now;
    if (this.relayTokens < cost) { later(Math.max(50, Math.ceil(((cost - this.relayTokens) / rate) * 1000))); return; }
    this.relayTokens -= cost;
    this.lastRelayFlush = now;
    for (const it of this.relayQ.splice(0, nRel)) for (const [id] of it.dests) this.unpend(id);
    for (const k of latest) this.relayLatest.delete(k);
    const from = this.myId;
    const sid = room.meta.sid;
    if (viaInbox) {
      for (const id of targets) {
        const b: RelayEntry[] = [];
        for (const [t, d, ds] of entries) { const mine = ds.filter((x) => x[0] === id); if (mine.length) b.push([t, d, mine]); }
        room.sendTo(id, 'relay', { from, sid, b } satisfies RelayMsg);
      }
    } else room.send('relay', { from, sid, b: entries } satisfies RelayMsg);
    this.stats.relayed += entries.length;
    this.stats.relayBatches++;
    this.stats.relayUnits += cost;
    if (this.relayQ.length || this.relayLatest.size) later(LIMITS.relayMinGapMs);
  }

  private onRelay(p: RelayMsg) {
    if (!p || typeof p.from !== 'string' || typeof p.sid !== 'string' || !Array.isArray(p.b) || p.from === this.myId) return;
    // only current members (that instance) are heard; a joiner's batch may beat its presence: hold it a moment
    if (!this.members.has(p.from) || this.sids.get(p.from) !== p.sid) {
      let h = this.relayHold.get(p.from);
      if (!h || h.list[0]?.sid !== p.sid) { h = { at: Date.now(), list: [] }; this.relayHold.set(p.from, h); }
      if (h.list.length < 16) h.list.push(p);
      return;
    }
    // they talk to me over a data channel: a relay batch "from" them now is forged (in-flight ones arrive sooner)
    const L = this.live.get(p.from);
    if (L && L.p2pSince && Date.now() - L.p2pSince > RELAY_AFTER_P2P_MS && this.mesh?.link(p.from) === 'p2p') return;
    this.heard(p.from, false);
    const me = this.myId;
    const mySid = this.room?.meta.sid;
    for (const e of p.b) {
      if (!this.active) return;
      if (!Array.isArray(e) || typeof e[0] !== 'string' || !Array.isArray(e[2])) continue;
      const dest = e[2].find((x) => Array.isArray(x) && x[0] === me);
      if (!dest) continue;
      if (dest[2] && dest[2] !== mySid) continue; // for my previous instance
      const seq = Number(dest[1]) || 0;
      // kick / bye are only ever sent reliable
      if (!seq && (e[0] === SYS.kick || e[0] === SYS.bye)) continue;
      if (seq > 0) this.receive(p.from, p.sid, seq, e[0], e[1], 'relay');
      else this.deliver(p.from, e[0], e[1], 'relay');
    }
  }

  // ---- chat / control

  private onChatMsg(p: ChatMsg) {
    if (!p || typeof p.text !== 'string' || typeof p.from !== 'string') return;
    this.addChat({
      id: String(p.id ?? p.from + '-' + p.ts), from: p.from, name: String(p.name ?? '?').slice(0, 16),
      text: p.text.slice(0, LIMITS.chatMaxLen), ts: Number(p.ts) || Date.now(),
    }, false);
  }

  private addChat(msg: ChatMsg, history: boolean) {
    if (this.chatLog.some((m) => m.id === msg.id)) return;
    this.chatLog.push(msg);
    if (history) this.chatLog.sort((a, b) => a.ts - b.ts);
    if (this.chatLog.length > LIMITS.chatKeep) this.chatLog.splice(0, this.chatLog.length - LIMITS.chatKeep);
    for (const f of [...this.chatSubs]) {
      try { f(msg.from, msg.text, msg.ts, msg.name, history); } catch (e) { console.error('[net] chat', e); }
    }
  }

  private onCtl(p: CtlMsg) {
    if (!p || typeof p.from !== 'string' || p.from === this.myId || (p.to && p.to !== this.myId)) return;
    if (p.type === 'meta') {
      const m = p.data && typeof p.data === 'object' ? parseMeta(p.from, p.data as Record<string, unknown>) : null;
      if (!m || m.v !== PROTOCOL_VERSION) return;
      const old = this.metaCast.get(p.from);
      if (old && old.meta.sid === m.sid && old.meta.rev > m.rev) return;
      if (this.sids.get(p.from) === m.sid) this.heard(p.from, false);
      this.metaCast.set(p.from, { meta: m, at: Date.now() });
      this.refresh();
    } else if (p.type === 'bye') {
      const sid = (p.data as { sid?: unknown } | undefined)?.sid;
      if (typeof sid !== 'string' || !sid) return;
      if (this.members.has(p.from) && this.sids.get(p.from) === sid) {
        // only a hint (anyone can send it): believed unless they still talk to me directly
        const L = this.live.get(p.from);
        if (L) L.bye = { sid, at: Date.now() };
      } else if (!this.members.has(p.from)) {
        // not a member (any more): its presence may linger a moment
        this.gone.add(sid);
        if (this.metaCast.get(p.from)?.meta.sid === sid) this.metaCast.delete(p.from);
      }
      this.refresh();
    } else if (p.type === 'chatlog') {
      if (p.from !== this.hostId || !Array.isArray(p.data)) return;
      for (const m of p.data as ChatMsg[]) {
        if (m && typeof m.text === 'string' && typeof m.from === 'string') {
          this.addChat({ id: String(m.id), from: m.from, name: String(m.name ?? '?'), text: m.text, ts: Number(m.ts) || 0 }, true);
        }
      }
    }
  }

  private emitMembers() {
    for (const f of [...this.memberSubs]) { try { f(); } catch (e) { console.error('[net] members', e); } }
  }
}

export const net = new Net();
export type { Net };
