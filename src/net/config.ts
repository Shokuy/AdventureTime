/** Network settings: backend, ICE servers, protocol version and limits (see docs/MULTIPLAYER.md). */

type Env = Record<string, string | boolean | undefined>;
const env: Env = (import.meta as unknown as { env?: Env }).env ?? {};
const envStr = (k: string) => {
  const v = env[k];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};

/** Supabase Realtime (public by design; override with VITE_SUPABASE_URL / VITE_SUPABASE_KEY) */
export const SUPABASE_URL = envStr('VITE_SUPABASE_URL') ?? 'https://xcgbfklgenhwztcpjdyp.supabase.co';
export const SUPABASE_KEY = envStr('VITE_SUPABASE_KEY') ?? 'sb_publishable_vebpPhfIbBPIHl_vjgiDWw_2_qyGMfb';

/**
 * bump when messages change incompatibly: players on another version can't join each other.
 * 2: per-member signaling inboxes, sequenced reliable messages, host terms, kick over the data channel.
 */
export const PROTOCOL_VERSION = 2;

export const MAX_PLAYERS = 6;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 5;

export const LOBBY_CHANNEL = 'gk-lobby';
/** room-wide channel: presence, chat, control, relay batches meant for (almost) everyone */
export const roomChannel = (code: string) => 'gk-room-' + code;
/** one member's private inbox: signaling and targeted relay / control (no fan-out to the whole room) */
export const inboxChannel = (code: string, id: string) => 'gk-room-' + code + '-' + id;

/**
 * ICE servers: public STUN (Google, Cloudflare, Twilio — several, so a pair still finds its public addresses when
 * one is blocked or slow from the player's network) + optional TURN.
 *
 * Without TURN, players behind symmetric NAT / strict firewalls can't connect directly and fall back to the
 * Supabase relay (slow: ~1–3 batches per second). To plug a TURN provider set, at build time (.env / Vercel):
 *   VITE_TURN_URL   one url or several separated by commas, e.g.
 *                   "turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:443?transport=tcp,turns:global.relay.metered.ca:443"
 *   VITE_TURN_USER  username   VITE_TURN_PASS  credential
 * or, for providers that hand out several servers with different credentials, the whole list as JSON:
 *   VITE_ICE_SERVERS='[{"urls":"stun:stun.cloudflare.com:3478"},{"urls":["turn:turn.example.com:3478"],"username":"u","credential":"p"}]'
 * (VITE_ICE_SERVERS replaces the default STUN list; VITE_TURN_* is appended to it.)
 * Providers: Metered (metered.ca, free tier), Cloudflare Calls TURN, Twilio NTS, Xirsys, or your own coturn
 * (`turnserver --lt-cred-mech --user u:p --realm game --listening-port 3478 --tls-listening-port 5349`).
 * Static credentials end up in the client bundle — use a provider key restricted to your domain, or
 * short-lived credentials. Test with ?ice=relay (TURN only: if the link still says 'p2p', TURN works).
 */
export const ICE_SERVERS: RTCIceServer[] = (() => {
  let list: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ];
  const json = envStr('VITE_ICE_SERVERS');
  if (json) {
    try {
      const v = JSON.parse(json) as unknown;
      const ok = Array.isArray(v) ? v.filter((s): s is RTCIceServer => !!s && typeof s === 'object' && 'urls' in s) : [];
      if (ok.length) list = ok;
    } catch { console.warn('[net] VITE_ICE_SERVERS is not valid JSON'); }
  }
  const turn = envStr('VITE_TURN_URL') ?? envStr('VITE_TURN_URLS');
  if (turn) {
    const urls = turn.split(',').map((s) => s.trim()).filter(Boolean);
    if (urls.length) list.push({ urls, username: envStr('VITE_TURN_USER'), credential: envStr('VITE_TURN_PASS') });
  }
  return list;
})();

export const LIMITS = {
  /**
   * Supabase relay (links that never got direct). The Free plan allows ~100 messages/s for the whole
   * project, and a message costs 1 + one per receiver: a room-wide batch costs N (players), a batch into one
   * member's inbox costs 2. Each client spends at most relayUnitsPerSec of that budget.
   */
  relayUnitsPerSec: 6,
  /** ...and a whole room about this much: with N players each client gets relayRoomUnitsPerSec / (N - 1) */
  relayRoomUnitsPerSec: 24,
  relayBurstUnits: 12,
  /** at most this often (unreliable state rides along: the newest message per type and target, ≤ 2.5 Hz) */
  relayMinGapMs: 400,
  /**
   * ...except these state streams: samples at this rate (per second) since the last batch ride along (≈4 hero
   * states / 2 snapshots per batch), so the receiver replays the movement smoothly ~0.5 s late instead of jumping
   * 2.5× a second. Costs bytes, not messages (the budget counts messages).
   */
  relaySampleHz: { st: 10, snap: 5 } as Record<string, number>,
  /** at most this many samples of one stream wait for a batch (oldest dropped) */
  relaySampleKeep: 12,
  /** queued reliable messages waiting for the relay; older ones are dropped beyond this */
  relayQueue: 300,
  /** max JSON size of one relay batch */
  relayBatchBytes: 48_000,
  /** a hole in a member's reliable sequence is waited for this long, then skipped */
  seqGapMs: 2000,
  /** no open data channel after this -> link 'relay' */
  p2pTimeoutMs: 8000,
  /** ICE candidates are batched into one signaling message per this window */
  candidateBatchMs: 200,
  /** an offer / answer waits up to this for ICE gathering, so most candidates ride inside it */
  gatherWaitMs: 250,
  /** lost offer / answer: resend after this (doubling up to 20 s) */
  offerRetryMs: 3000,
  /** a connection that stays failed this long is rebuilt from scratch (doubling up to 60 s) */
  failedRebuildMs: 10_000,
  /** a link that never got direct is rebuilt after this (doubling up to 2 min) */
  stuckRebuildMs: 30_000,
  pingMs: 1000,
  /** a member not heard for this long (pings run at 1 Hz) is dead for host election */
  aliveMs: 5000,
  /**
   * ...unless someone's direct link to it is still up (ICE connected: its browser still answers, only its page
   * is busy — a long shader compile, a slow laptop loading a level): then only after this. A crashed or closed tab
   * drops its links (and a lost network turns ICE 'disconnected' in a few seconds), so failover stays quick.
   */
  aliveLinkedMs: 13_000,
  /** a member missing from presence stays this long (Supabase reconnects drop presence for a moment) */
  presenceGraceMs: 10_000,
  /** my signaling was down at least this long: on return I re-sort myself after everyone (unless I'm host) */
  longOutageMs: 8000,
  /** my page was frozen this long: I assume the room moved on (new host) */
  frozenMs: 7000,
  /** ping over the relay (when the host link is relayed): clock sync + liveness */
  relayPingMs: 2500,
  chatKeep: 50,
  chatMaxLen: 200,
  chatMinGapMs: 300,
  /** presence + meta broadcast at most once per this (coalesced; Supabase counts every track) */
  metaMinGapMs: 1000,
  lobbyMinGapMs: 1000,
  /** unreliable state messages are dropped while the channel buffer is fuller than this */
  unreliableMaxBuffered: 64 * 1024,
  joinTimeoutMs: 12_000,
};

/** reads a URL query flag (?name=value) */
export function urlParam(name: string): string | null {
  try { return new URLSearchParams(location.search).get(name); } catch { return null; }
}

/** which signaling transport: ?net=local -> BroadcastChannel (tabs of one browser), else Supabase */
export function transportKind(): 'supabase' | 'local' {
  return urlParam('net') === 'local' ? 'local' : 'supabase';
}

/** ?ice=relay: TURN only (with no TURN configured P2P never connects -> tests the Supabase relay fallback) */
export const ICE_POLICY: RTCIceTransportPolicy = urlParam('ice') === 'relay' ? 'relay' : 'all';

/** ?netdebug=1 logs signaling / link changes to the console */
export const NET_DEBUG = urlParam('netdebug') === '1';

/**
 * ?lag=<ms>&jitter=<ms>&loss=<pct>: a bad network for tests, applied to every game message this page RECEIVES
 * (direct and relayed): delay = lag ± jitter (uniform); `loss` % of unreliable messages are dropped, reliable
 * ones arrive late instead (a retransmission) and stay in order. Signaling is not touched. Each page applies its
 * own — give both sides the params for a symmetric link. null = off (the normal case).
 */
export const NET_SIM: { lag: number; jitter: number; loss: number } | null = (() => {
  const n = (k: string, max: number) => { const v = Number(urlParam(k)); return Number.isFinite(v) && v > 0 ? Math.min(max, v) : 0; };
  const s = { lag: n('lag', 5000), jitter: n('jitter', 5000), loss: n('loss', 100) };
  return s.lag || s.jitter || s.loss ? s : null;
})();
