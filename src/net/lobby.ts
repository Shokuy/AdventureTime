/** Public room directory: room hosts track a listing on the `gk-lobby` presence channel. */
import { LIMITS, LOBBY_CHANNEL, MAX_PLAYERS, PROTOCOL_VERSION } from './config';
import type { SignalChannel, SignalTransport } from './signal';
import { profile } from './profile';

export type RoomState = 'lobby' | 'playing';

export interface RoomInfo {
  code: string;
  /** players inside */
  n: number;
  max: number;
  state: RoomState;
  /** host name */
  host: string;
  v: number;
}

function parseInfo(m: Record<string, unknown>): RoomInfo | null {
  if (typeof m.code !== 'string' || typeof m.n !== 'number') return null;
  return {
    code: m.code,
    n: m.n,
    max: typeof m.max === 'number' ? m.max : MAX_PLAYERS,
    state: m.state === 'playing' ? 'playing' : 'lobby',
    host: typeof m.host === 'string' ? m.host : '?',
    v: typeof m.v === 'number' ? m.v : 0,
  };
}

export class Lobby {
  private ch: SignalChannel | null = null;
  private opening: Promise<void> | null = null;
  private ready = false;
  private subs = new Set<() => void>();
  /** what I publish (as a room host) */
  private listing: RoomInfo | null = null;
  private sent = '';
  private lastSent = 0;
  private timer = 0;

  /** bumped by close(): an open() still waiting for the tab id is abandoned */
  private gen = 0;
  private wantOpen = false;

  /** myId: read at open time (a duplicated tab may still change its id at startup) */
  constructor(private transport: () => SignalTransport, private myId: () => string) {}

  get isOpen() { return !!this.ch || this.wantOpen; }

  /** subscribe to the directory (idempotent) */
  open(): Promise<void> {
    if (this.opening) return this.opening;
    const gen = ++this.gen;
    this.wantOpen = true;
    this.opening = profile.ready.then(() => {
      if (gen !== this.gen) throw new Error('closed');
      // my key on the directory is my tab id (the listing I publish as a host)
      const ch = this.transport().channel(LOBBY_CHANNEL, this.myId());
      ch.onPresence(() => { for (const f of [...this.subs]) f(); });
      ch.onStatus((s) => { if (s === 'up') { this.sent = ''; this.flush(); } });
      this.ch = ch;
      return ch.subscribe().then(
        () => { if (this.ch === ch) { this.ready = true; this.flush(); } },
        (e) => { if (this.ch === ch) { this.ch = null; this.opening = null; this.wantOpen = false; } throw e; },
      );
    });
    return this.opening;
  }

  close() {
    const ch = this.ch;
    this.gen++;
    this.wantOpen = false;
    this.ch = null;
    this.opening = null;
    this.ready = false;
    this.listing = null;
    this.sent = '';
    clearTimeout(this.timer);
    this.timer = 0;
    if (ch) void ch.close();
  }

  /** public rooms of my protocol version, fullest first (the ones I host included) */
  rooms(): RoomInfo[] {
    if (!this.ch) return [];
    const out: RoomInfo[] = [];
    const seen = new Set<string>();
    for (const m of this.ch.presence().values()) {
      const r = parseInfo(m);
      if (!r || r.v !== PROTOCOL_VERSION || seen.has(r.code)) continue;
      seen.add(r.code);
      out.push(r);
    }
    out.sort((a, b) => (a.state === b.state ? b.n - a.n : a.state === 'lobby' ? -1 : 1));
    return out;
  }

  onChange(cb: () => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }

  /** keep my room listed (throttled: Supabase counts every presence update) */
  publish(info: RoomInfo) {
    this.listing = info;
    if (!this.ch) void this.open().catch(() => undefined);
    else this.flush();
  }

  unpublish() {
    this.listing = null;
    this.flush();
  }

  private flush() {
    const ch = this.ch;
    if (!ch || !this.ready) return;
    const want = this.listing ? JSON.stringify(this.listing) : '';
    if (want === this.sent) return;
    const wait = this.lastSent + LIMITS.lobbyMinGapMs - Date.now();
    if (wait > 0 && want) {
      if (!this.timer) this.timer = window.setTimeout(() => { this.timer = 0; this.flush(); }, wait);
      return;
    }
    this.sent = want;
    this.lastSent = Date.now();
    if (this.listing) void ch.track({ ...this.listing }).catch(() => { this.sent = ''; });
    else void ch.untrack().catch(() => undefined);
  }
}
