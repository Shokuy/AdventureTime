/**
 * A room = two channels:
 *  - `gk-room-<CODE>`: presence (members), chat, control, relay batches meant for (almost) everyone, join probes;
 *  - `gk-room-<CODE>-<myId>`: my private inbox (no presence): signaling, targeted relay / control, probe answers.
 *    Others post into it without subscribing, so a signaling message costs 2 Supabase messages, not 1 + N.
 * The host is decided by the session (host terms + liveness); joinedAt only orders members and breaks ties.
 */
import { inboxChannel, MAX_PLAYERS, PROTOCOL_VERSION, roomChannel } from './config';
import type { HeroLook, HeroPick } from './profile';
import { DEFAULT_LOOK, cleanPick } from './profile';
import { ERR_TEXT, NetError } from './protocol';
import type { RoomState } from './lobby';
import type { LinkStatus, SignalChannel, SignalTransport } from './signal';

/** what every member tracks in room presence */
export interface MemberMeta {
  id: string;
  /** per-join instance: a reloaded tab keeps its id but gets a new sid (peers rebuild the link) */
  sid: string;
  name: string;
  /** the member's Tosha look (the prologue, older builds) */
  look: HeroLook;
  /** «Хрумляндия»: the hero the member picked and its look (absent from older builds: their Tosha) */
  hero: HeroPick;
  ready: boolean;
  joinedAt: number;
  scene: string;
  v: number;
  /** room flags copied from the creator: public listing, clock epoch */
  pub: boolean;
  ep: number;
  /** room state — only the host's value counts */
  rs: RoomState;
  /** bumped on every change: the newest of presence / 'meta' broadcast wins */
  rev: number;
  /** the host this member follows (id + instance) and its term (elections bump the term; the highest term wins) */
  h: string;
  hs: string;
  ht: number;
}

/** room-channel / inbox events the session handles */
export type RoomEvent = 'sig' | 'chat' | 'ctl' | 'relay';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** how long presence may take to reach everyone (server-side replication) */
export const PRESENCE_SETTLE_MS = 3500;

export function sortMembers(list: MemberMeta[]) {
  return list.sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function parseMeta(key: string, m: Record<string, unknown>): MemberMeta | null {
  if (m.id !== key || typeof m.joinedAt !== 'number') return null;
  const look = { ...DEFAULT_LOOK, ...((m.look as Partial<HeroLook>) ?? {}) };
  return {
    id: key,
    sid: typeof m.sid === 'string' ? m.sid : '',
    name: typeof m.name === 'string' ? m.name.slice(0, 16) : '?',
    look,
    hero: cleanPick(m.hero, look),
    ready: !!m.ready,
    joinedAt: m.joinedAt,
    scene: typeof m.scene === 'string' ? m.scene : '',
    v: typeof m.v === 'number' ? m.v : 0,
    pub: !!m.pub,
    ep: typeof m.ep === 'number' ? m.ep : m.joinedAt,
    rs: m.rs === 'playing' ? 'playing' : 'lobby',
    rev: typeof m.rev === 'number' ? m.rev : 0,
    h: typeof m.h === 'string' ? m.h : '',
    hs: typeof m.hs === 'string' ? m.hs : '',
    ht: typeof m.ht === 'number' && Number.isFinite(m.ht) ? m.ht : 0,
  };
}

const cancelled = () => new NetError('cancelled', ERR_TEXT.cancelled);

export class Room {
  readonly ch: SignalChannel;
  readonly inbox: SignalChannel;
  /** messages that arrive while joining are kept until start() */
  private queue: [RoomEvent, unknown][] | null = [];
  private handlers = new Map<RoomEvent, (payload: any) => void>();
  private closed = false;
  /** I'm inside (start() called): answer joiners' probes */
  private inside = false;
  /** members that answered my probe (faster than presence, which lags between server nodes) */
  private acks = new Map<string, MemberMeta>();
  private statusSubs = new Set<(s: LinkStatus) => void>();
  private wasOnline = true;

  constructor(private transport: SignalTransport, readonly code: string, readonly myId: string, public meta: MemberMeta) {
    this.ch = transport.channel(roomChannel(code), myId);
    this.inbox = transport.channel(inboxChannel(code, myId), myId, { presence: false });
    for (const ev of ['sig', 'chat', 'ctl', 'relay'] as RoomEvent[]) {
      const on = (p: unknown) => {
        if (this.closed) return;
        if (this.queue) this.queue.push([ev, p]);
        else this.handlers.get(ev)?.(p);
      };
      this.ch.onMessage(ev, on);
      this.inbox.onMessage(ev, on);
    }
    this.ch.onMessage('probe', (p: { from?: unknown }) => {
      if (this.inside && !this.closed && p && typeof p.from === 'string' && p.from !== myId) {
        this.sendTo(p.from, 'probe-ack', { to: p.from, meta: { ...this.meta } });
      }
    });
    this.inbox.onMessage('probe-ack', (p: { to?: unknown; meta?: Record<string, unknown> }) => {
      if (!p || p.to !== myId || !p.meta || typeof p.meta.id !== 'string') return;
      const m = parseMeta(p.meta.id, p.meta);
      if (m) this.acks.set(m.id, m);
    });
    // both channels share one socket: report the pair as one link
    const st = () => {
      const on = this.online;
      if (on === this.wasOnline || this.closed) return;
      this.wasOnline = on;
      for (const f of [...this.statusSubs]) f(on ? 'up' : 'down');
    };
    this.ch.onStatus(st);
    this.inbox.onStatus(st);
  }

  /** the link to the signaling server is up */
  get online() { return this.ch.online && this.inbox.online; }
  onStatus(cb: (s: LinkStatus) => void) { this.statusSubs.add(cb); return () => { this.statusSubs.delete(cb); }; }

  /** everyone in the room with my protocol version, ordered by join time (host first) */
  members(): MemberMeta[] {
    const out: MemberMeta[] = [];
    for (const [key, m] of this.ch.presence()) {
      if (key === this.myId) continue;
      const mm = parseMeta(key, m);
      if (mm && mm.v === PROTOCOL_VERSION) out.push(mm);
    }
    if (!this.closed) out.push(this.meta);
    return sortMembers(out);
  }

  /** everyone else (presence + probe answers), any version */
  private others(): MemberMeta[] {
    const byId = new Map(this.acks);
    for (const [key, m] of this.ch.presence()) {
      if (key === this.myId) continue;
      const mm = parseMeta(key, m);
      if (mm) byId.set(key, mm);
    }
    return sortMembers([...byId.values()]);
  }

  /**
   * Join the channels and claim a seat.
   * mode 'create': the code must be free; 'join': the room must exist, have space and my version.
   * Throws NetError('cancelled') as soon as the room is closed meanwhile (net.leave() during a join).
   */
  async join(mode: 'create' | 'join'): Promise<void> {
    try {
      // the inbox first: probe answers and signaling arrive there
      await Promise.all([this.inbox.subscribe(), this.ch.subscribe()]);
    } catch {
      if (this.closed) throw cancelled();
      await this.close();
      throw new NetError('network', ERR_TEXT.network);
    }
    if (this.closed) throw cancelled();
    if (mode === 'join') {
      // members answer a probe at once; presence of members on other Supabase nodes can lag ~2 s
      this.ch.send('probe', { from: this.myId });
      const t0 = Date.now();
      while (Date.now() - t0 < PRESENCE_SETTLE_MS) {
        await delay(150);
        if (this.closed) throw cancelled();
        if (this.others().length && Date.now() - t0 >= 450) break;
      }
    }
    const others = this.others();
    if (mode === 'create') {
      if (others.length) { await this.close(); throw new NetError('taken', ERR_TEXT.taken); }
    } else {
      if (!others.length) { await this.close(); throw new NetError('not_found', ERR_TEXT.not_found); }
      const same = others.filter((m) => m.v === PROTOCOL_VERSION);
      if (!same.length) { await this.close(); throw new NetError('version', ERR_TEXT.version); }
      if (same.length >= MAX_PLAYERS) { await this.close(); throw new NetError('full', ERR_TEXT.full); }
      // the host everyone follows: the highest term announced (ties: the earlier member)
      let best = same[0];
      for (const m of same) if (m.ht > best.ht) best = m;
      const host = same.find((m) => m.id === best.h) ?? same[0];
      // inherit room flags; never sort before people already inside (clock skew between PCs)
      this.meta.pub = host.pub;
      this.meta.ep = host.ep;
      this.meta.rs = host.rs;
      this.meta.h = best.h || host.id;
      this.meta.hs = best.h ? best.hs : host.sid;
      this.meta.ht = best.ht;
      if (this.meta.h === this.myId) {
        // my previous instance (reloaded tab) was the host: that seat is gone, the room elects someone else
        this.meta.h = same[0].id;
        this.meta.hs = same[0].sid;
      }
      this.meta.joinedAt = Math.max(this.meta.joinedAt, same[same.length - 1].joinedAt + 1);
    }
    try {
      await this.ch.track({ ...this.meta });
    } catch {
      if (this.closed) throw cancelled();
      await this.close();
      throw new NetError('network', ERR_TEXT.network);
    }
    if (this.closed) throw cancelled();
    if (mode === 'join' && others.length >= MAX_PLAYERS - 1) {
      // two people may grab the last seat at once: whoever sorts 7th backs off (checked again later by the session)
      await delay(600);
      if (this.closed) throw cancelled();
      const list = this.members();
      if (list.findIndex((m) => m.id === this.myId) >= MAX_PLAYERS) {
        await this.close();
        throw new NetError('full', ERR_TEXT.full);
      }
    }
  }

  /** start delivering room events (queued ones first) */
  start(handlers: Partial<Record<RoomEvent, (payload: any) => void>>) {
    this.inside = true;
    for (const k of Object.keys(handlers) as RoomEvent[]) this.handlers.set(k, handlers[k]!);
    const q = this.queue ?? [];
    this.queue = null;
    for (const [ev, p] of q) this.handlers.get(ev)?.(p);
  }

  /** members that answered my join probe (the session counts them until their presence shows up) */
  drainAcks(): MemberMeta[] {
    const out = [...this.acks.values()].filter((m) => m.v === PROTOCOL_VERSION);
    this.acks.clear();
    return out;
  }

  /** room-wide broadcast (every member receives it); false = queued until the server link is back */
  send(ev: RoomEvent | 'probe', payload: unknown): boolean {
    return !this.closed && this.ch.send(ev, payload);
  }

  /** into one member's inbox (REST post: queued and retried, in order) */
  sendTo(id: string, ev: RoomEvent | 'probe-ack', payload: unknown) {
    if (!this.closed) this.transport.post(inboxChannel(this.code, id), ev, payload);
  }

  /** re-publish my meta */
  update() {
    if (!this.closed) void this.ch.track({ ...this.meta }).catch(() => undefined);
  }

  leaveNow() { this.ch.leaveNow(); this.inbox.leaveNow(); }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.handlers.clear();
    this.queue = null;
    this.statusSubs.clear();
    await Promise.all([this.ch.close(), this.inbox.close()]);
  }
}
