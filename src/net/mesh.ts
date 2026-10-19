/**
 * Full mesh of RTCPeerConnections (one per other member) with "perfect negotiation".
 * Each link: negotiated data channels 'u' (id 0, unordered, no retransmits) and 'r' (id 1, reliable),
 * plus ONE audio transceiver created up front so voice never renegotiates (replaceTrack only).
 * polite = my id > their id. The impolite side creates everything and makes the first offer; the polite
 * side stays passive until that offer arrives (adopts the audio m-line, then opens its negotiated
 * channels). This avoids first-offer glare: Chrome rejects the data section (port 0) after rolling
 * back an offer that carried one, and the link then renegotiates forever without data channels.
 * Later renegotiations (ICE restarts) use regular perfect negotiation.
 *
 * Signaling may be lost (a dropped broadcast, a member that wasn't listening yet, a one-sided reset), so:
 *  - every connection has a number (`c`, bumped on each rebuild); messages carry it and the receiver's
 *    number as the sender knows it (`tc`). Messages for an older connection are dropped; a newer number
 *    from the other side means it rebuilt its end, so I rebuild mine (a fresh DTLS session can't be resumed);
 *  - an offer without an answer is re-sent (with the candidates gathered so far, they're in the SDP);
 *    the same offer arriving twice is answered again; the polite side asks for an offer when none came;
 *  - a connection that stays failed (or never gets direct) is rebuilt with backoff;
 *  - signaling from someone who is not a member (or with another sid) waits a few seconds for their
 *    membership, then is dropped — it never creates a connection by itself.
 */
import { ICE_POLICY, ICE_SERVERS, LIMITS, NET_DEBUG } from './config';

export type LinkState = 'p2p' | 'relay' | 'connecting';

/** signaling payload between two peers (carried by the receiver's inbox channel) */
export interface SigData {
  /** sender's per-join instance */
  sid: string;
  /** receiver's instance this is meant for (stale messages for an old instance are dropped) */
  tsid?: string;
  /** sender's connection number for this link */
  c: number;
  /** receiver's connection number as the sender knows it */
  tc?: number;
  desc?: RTCSessionDescriptionInit;
  cands?: RTCIceCandidateInit[];
  /** polite side got no offer: please (re)send it */
  req?: 'offer';
}

export interface MeshHooks {
  myId: string;
  mySid: string;
  signal(to: string, data: SigData): void;
  /** sid = the sender's instance this connection belongs to */
  onMessage(from: string, sid: string, raw: string): void;
  onLink(id: string, link: LinkState): void;
  onTrack(id: string, track: MediaStreamTrack): void;
  onPeerClosed(id: string): void;
}

const log = (...a: unknown[]) => { if (NET_DEBUG) console.log('[mesh]', ...a); };
const backoff = (base: number, n: number, cap: number) => Math.min(cap, base * 2 ** Math.min(n, 6));
/** identifies one offer: same session version + ICE credentials = a re-send, not a new negotiation */
const sdpKey = (sdp: string | undefined) => (sdp ?? '').match(/^o=.*$/m)?.[0] + '|' + ((sdp ?? '').match(/a=ice-ufrag:(\S+)/)?.[1] ?? '');
/** buffered signaling from not-yet-members is kept this long */
const PENDING_MS = 5000;

class Peer {
  readonly pc: RTCPeerConnection;
  /** null on the polite side until the first offer was applied */
  u: RTCDataChannel | null = null;
  r: RTCDataChannel | null = null;
  readonly polite: boolean;
  audio: RTCRtpTransceiver | null = null;
  readonly created = Date.now();
  /** the other side's connection number (-1 = not heard yet) */
  remoteGen = -1;
  lastRestart = 0;
  closed = false;
  /** a local description was set but not sent yet (waiting for ICE gathering) */
  descPending = false;
  /** my offer was (re)sent at / how many times */
  descAt = 0;
  descTries = 0;
  reqAt = 0;
  reqTries = 0;
  failedSince = 0;
  /** the direct link actually runs through a TURN server (fast, but not peer to peer) */
  turn = false;
  turnAt = 0;
  private makingOffer = false;
  private ignoreOffer = false;
  private answerPending = false;
  private chain: Promise<void> = Promise.resolve();
  private outCands: RTCIceCandidateInit[] = [];
  private candTimer = 0;
  private p2pTimer = 0;
  private discTimer = 0;

  constructor(private mesh: Mesh, readonly id: string, public sid: string, readonly gen: number, public link: LinkState, rebuilt: boolean) {
    this.polite = mesh.hooks.myId > id;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceTransportPolicy: ICE_POLICY });
    this.pc = pc;
    if (!this.polite) {
      this.openChannels();
      this.audio = pc.addTransceiver('audio', { direction: 'sendrecv' });
      if (mesh.localTrack) void this.audio.sender.replaceTrack(mesh.localTrack).catch(() => undefined);
    }
    pc.onnegotiationneeded = async () => {
      // the polite side never opens the first negotiation (see the header)
      if (this.polite && !pc.remoteDescription) return;
      try {
        this.makingOffer = true;
        this.descPending = true;
        await pc.setLocalDescription();
        await this.gathered();
        // rolled back by a colliding offer meanwhile: nothing to send
        if (pc.signalingState === 'have-local-offer') { this.descTries = 0; this.sendDesc(); }
      } catch (e) {
        log('offer failed', id, e);
      } finally {
        this.makingOffer = false;
        this.descPending = false;
      }
    };
    pc.onicecandidate = (e) => { if (e.candidate) this.queueCand(e.candidate.toJSON()); };
    pc.ontrack = (e) => {
      if (e.track.kind === 'audio' && !this.closed) mesh.hooks.onTrack(id, e.track);
    };
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      log(id, 'ice', s);
      clearTimeout(this.discTimer);
      if (s === 'failed') this.restart();
      else if (s === 'disconnected') {
        // often recovers by itself; restart if it doesn't
        this.discTimer = window.setTimeout(() => { if (pc.iceConnectionState === 'disconnected') this.restart(); }, 4000);
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.updateLink();
    };
    if (link !== 'p2p') {
      this.p2pTimer = window.setTimeout(() => {
        if (this.link !== 'p2p' && !this.closed) { this.setLink('relay'); this.restart(); }
      }, LIMITS.p2pTimeoutMs);
    }
    // I rebuilt my end on my own: the other side must hear about it (an impolite end offers anyway)
    if (rebuilt && this.polite) queueMicrotask(() => this.requestOffer());
  }

  /** incoming signaling, applied strictly in order */
  handle(data: SigData) {
    this.chain = this.chain.then(() => this.apply(data)).catch((e) => log('signal error', this.id, e));
  }

  private async apply(data: SigData) {
    if (this.closed) return;
    const pc = this.pc;
    const desc = data.desc;
    if (desc) {
      const rd = pc.remoteDescription;
      if (desc.type === 'offer' && pc.signalingState === 'stable' && rd?.type === 'offer' && sdpKey(rd.sdp) === sdpKey(desc.sdp)) {
        // the same offer again: my answer got lost
        log(this.id, 'offer repeated: answer again');
        this.sendDesc();
      } else if (desc.type === 'answer' && pc.signalingState !== 'have-local-offer') {
        log(this.id, 'stray answer', pc.signalingState);
      } else {
        const readyForOffer = !this.makingOffer && (pc.signalingState === 'stable' || this.answerPending);
        const collision = desc.type === 'offer' && !readyForOffer;
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) { log(this.id, 'ignore colliding offer'); return; }
        this.answerPending = desc.type === 'answer';
        await pc.setRemoteDescription(desc);
        this.answerPending = false;
        if (desc.type === 'offer') {
          this.adoptAudio();
          this.openChannels(); // polite side: the data section is negotiated now
          this.descPending = true;
          try {
            await pc.setLocalDescription();
            await this.gathered();
            if (!this.closed) this.sendDesc();
          } finally { this.descPending = false; }
        } else {
          this.descTries = 0;
        }
      }
    }
    if (data.req === 'offer') this.onOfferRequest();
    if (data.cands) {
      for (const c of data.cands) {
        try { await pc.addIceCandidate(c); } catch (e) { if (!this.ignoreOffer) log(this.id, 'bad candidate', e); }
      }
    }
  }

  /** wait (briefly) for ICE gathering so most candidates ride inside the offer / answer */
  private gathered(): Promise<void> {
    const pc = this.pc;
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', on); resolve(); };
      const on = () => { if (pc.iceGatheringState === 'complete') done(); };
      const t = setTimeout(done, LIMITS.gatherWaitMs);
      pc.addEventListener('icegatheringstatechange', on);
    });
  }

  private openChannels() {
    if (this.r) return;
    this.u = this.pc.createDataChannel('u', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
    this.r = this.pc.createDataChannel('r', { negotiated: true, id: 1, ordered: true });
    for (const dc of [this.u, this.r]) {
      dc.onopen = () => this.updateLink();
      dc.onclose = () => this.updateLink();
      dc.onmessage = (e: MessageEvent) => { if (typeof e.data === 'string' && !this.closed) this.mesh.hooks.onMessage(this.id, this.sid, e.data); };
    }
  }

  /** polite side: take the remote-created audio transceiver as mine */
  private adoptAudio() {
    if (this.audio) return;
    const t = this.pc.getTransceivers().find((x) => x.receiver.track.kind === 'audio' && x.currentDirection !== 'stopped');
    if (!t) return;
    t.direction = 'sendrecv';
    this.audio = t;
    if (this.mesh.localTrack) void t.sender.replaceTrack(this.mesh.localTrack).catch(() => undefined);
  }

  private sig(extra: Partial<SigData>) {
    if (this.closed) return;
    this.mesh.hooks.signal(this.id, {
      sid: this.mesh.hooks.mySid, tsid: this.sid, c: this.gen, tc: this.remoteGen >= 0 ? this.remoteGen : undefined, ...extra,
    });
  }

  /** my current local description (it already lists the candidates gathered so far) */
  private sendDesc() {
    const d = this.pc.localDescription;
    if (!d || this.closed) return;
    this.outCands.length = 0;
    clearTimeout(this.candTimer);
    this.candTimer = 0;
    if (d.type === 'offer') this.descAt = Date.now();
    log('->', this.id, d.type, this.pc.signalingState);
    this.sig({ desc: { type: d.type, sdp: d.sdp } });
  }

  /** my offer got no answer (lost, or they weren't listening yet): send it again */
  resendOffer() {
    const pc = this.pc;
    if (this.closed || this.descPending || pc.signalingState !== 'have-local-offer' || pc.localDescription?.type !== 'offer') return;
    this.descTries++;
    log(this.id, 'resend offer', this.descTries);
    this.sendDesc();
  }

  requestOffer() {
    if (this.closed) return;
    this.reqAt = Date.now();
    this.reqTries++;
    log(this.id, 'request offer', this.reqTries);
    this.sig({ req: 'offer' });
  }

  private onOfferRequest() {
    if (this.polite || this.closed) return;
    const pc = this.pc;
    if (pc.signalingState === 'have-local-offer') { this.resendOffer(); return; }
    if (pc.signalingState === 'stable' && this.link !== 'p2p') {
      // the other side never got my offer (lost / it wasn't listening yet): offer again
      log(this.id, 'offer requested');
      this.lastRestart = 0;
      this.restart();
    }
  }

  private queueCand(c: RTCIceCandidateInit) {
    this.outCands.push(c);
    if (this.candTimer) return;
    // one signaling message per batch of candidates (Supabase counts messages)
    const flush = () => {
      this.candTimer = 0;
      if (this.closed || !this.outCands.length) return;
      // never before the description they belong to (it carries the ones gathered so far)
      if (this.descPending) { this.candTimer = window.setTimeout(flush, LIMITS.candidateBatchMs); return; }
      this.sig({ cands: this.outCands.splice(0) });
    };
    this.candTimer = window.setTimeout(flush, LIMITS.candidateBatchMs);
  }

  restart() {
    if (this.closed) return;
    const now = Date.now();
    if (now - this.lastRestart < 2000) return;
    this.lastRestart = now;
    if (this.polite && !this.pc.remoteDescription) {
      // nothing to restart yet: ask the impolite side for its offer
      this.requestOffer();
      return;
    }
    log(this.id, 'ICE restart');
    try { this.pc.restartIce(); } catch { /* old browser */ }
  }

  private updateLink() {
    if (this.closed) return;
    if (this.r?.readyState === 'open') this.setLink('p2p');
    else if (this.link === 'p2p' || this.pc.connectionState === 'failed') this.setLink('relay');
  }

  private setLink(l: LinkState) {
    if (l === this.link || this.closed) return;
    this.link = l;
    log(this.id, 'link', l);
    if (l === 'p2p') { clearTimeout(this.p2pTimer); this.mesh.linked(this.id); this.checkTurn(); }
    else this.turn = false;
    this.mesh.hooks.onLink(this.id, l);
  }

  /** is the selected candidate pair relayed by TURN? (getStats; re-checked now and then: ICE may switch pairs) */
  checkTurn() {
    if (this.closed || this.link !== 'p2p') return;
    this.turnAt = Date.now();
    this.pc.getStats().then((rep) => {
      let pair: { localCandidateId?: string; remoteCandidateId?: string } | undefined;
      rep.forEach((s: { type: string; selectedCandidatePairId?: string; selected?: boolean; nominated?: boolean; state?: string }) => {
        if (s.type === 'transport' && s.selectedCandidatePairId) pair = rep.get(s.selectedCandidatePairId);
      });
      // Firefox: no transport stats, the pair says it is the selected one
      if (!pair) rep.forEach((s: { type: string; selected?: boolean }) => { if (s.type === 'candidate-pair' && s.selected) pair = s as typeof pair; });
      if (!pair) return;
      const kind = (id?: string) => (id ? (rep.get(id) as { candidateType?: string } | undefined)?.candidateType : undefined);
      const turn = kind(pair.localCandidateId) === 'relay' || kind(pair.remoteCandidateId) === 'relay';
      if (turn !== this.turn && !this.closed) { this.turn = turn; log(this.id, turn ? 'via TURN' : 'direct'); this.mesh.hooks.onLink(this.id, this.link); }
    }).catch(() => undefined);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.candTimer);
    clearTimeout(this.p2pTimer);
    clearTimeout(this.discTimer);
    for (const dc of [this.u, this.r]) { if (dc) dc.onopen = dc.onclose = dc.onmessage = null; }
    this.pc.onnegotiationneeded = this.pc.onicecandidate = this.pc.ontrack = null;
    this.pc.oniceconnectionstatechange = this.pc.onconnectionstatechange = null;
    try { this.pc.close(); } catch { /* */ }
  }
}

const NOOP_HOOKS = (h: MeshHooks): MeshHooks => ({
  myId: h.myId, mySid: h.mySid, signal: () => {}, onMessage: () => {}, onLink: () => {}, onTrack: () => {}, onPeerClosed: () => {},
});

export class Mesh {
  private peers = new Map<string, Peer>();
  /** members I may connect to: id -> sid (from the session) */
  private allowed = new Map<string, string>();
  /** signaling from someone not (yet) allowed */
  private pending = new Map<string, { at: number; list: SigData[] }>();
  /** last connection number per member (never reused while I'm in the room) */
  private gens = new Map<string, number>();
  /** the instance each member's last connection was for */
  private lastSid = new Map<string, string>();
  /** rebuilds since the link was last direct (backoff) */
  private rebuilds = new Map<string, number>();
  /** my mic track (null = silence); every link sends it via replaceTrack */
  localTrack: MediaStreamTrack | null = null;
  private healTimer: number;
  readonly stats = { rebuilds: 0, resends: 0, requests: 0, dropped: 0, congested: 0 };

  constructor(public hooks: MeshHooks) {
    this.healTimer = window.setInterval(() => this.heal(), 1000);
  }

  /** make the set of links match the room members (others only) */
  sync(members: { id: string; sid: string }[]) {
    this.allowed = new Map(members.map((m) => [m.id, m.sid]));
    for (const [id, sid] of this.allowed) {
      let p = this.peers.get(id);
      if (p && p.sid !== sid) { this.drop(id); p = undefined; } // their tab reloaded
      if (!p) this.create(id, sid, 'connecting', false);
    }
    for (const id of [...this.peers.keys()]) if (!this.allowed.has(id)) this.drop(id);
    // signaling that arrived before their membership
    for (const [id, pend] of [...this.pending]) {
      const sid = this.allowed.get(id);
      if (!sid) continue;
      this.pending.delete(id);
      for (const d of pend.list) if (d.sid === sid) this.signal(id, d);
    }
  }

  private create(id: string, sid: string, link: LinkState, rebuilt: boolean): Peer {
    const prev = this.gens.get(id) ?? 0;
    this.gens.set(id, prev + 1);
    // a new connection to someone I was connected to before: they may still hold the old one, so announce it
    const p = new Peer(this, id, sid, prev + 1, link, rebuilt || (prev > 0 && this.lastSid.get(id) === sid));
    this.lastSid.set(id, sid);
    this.peers.set(id, p);
    return p;
  }

  /** replace a link with a fresh connection (new number: the other side rebuilds its end too) */
  private rebuild(id: string, mine: boolean): Peer | undefined {
    const old = this.peers.get(id);
    if (!old) return undefined;
    if (mine) this.rebuilds.set(id, (this.rebuilds.get(id) ?? 0) + 1);
    this.stats.rebuilds++;
    log(id, mine ? 'rebuild (stuck/failed)' : 'rebuild (their end is new)');
    this.peers.delete(id);
    old.close();
    this.hooks.onPeerClosed(id);
    // relayed traffic keeps flowing meanwhile: show 'relay' rather than 'connecting'
    return this.create(id, old.sid, old.link === 'connecting' ? 'connecting' : 'relay', mine);
  }

  /** a link went direct */
  linked(id: string) { this.rebuilds.delete(id); }

  /** incoming signaling (from my inbox) */
  signal(from: string, data: SigData) {
    if (!data || typeof data.sid !== 'string' || typeof data.c !== 'number') return;
    log('<-', from, data.desc?.type ?? '', data.cands?.length ?? 0, data.req ?? '', 'c', data.c, 'tc', data.tc);
    if (data.tsid && data.tsid !== this.hooks.mySid) return; // meant for my previous incarnation
    if (this.allowed.get(from) !== data.sid) {
      // not a member (yet) / another instance of them: wait a moment for their membership, never connect blindly
      let pend = this.pending.get(from);
      if (!pend) { pend = { at: Date.now(), list: [] }; this.pending.set(from, pend); }
      if (pend.list.length < 24) pend.list.push(data);
      return;
    }
    let p = this.peers.get(from);
    if (p && p.sid !== data.sid) { this.drop(from); p = undefined; }
    if (p) {
      if (data.tc !== undefined && data.tc !== p.gen) { this.stats.dropped++; return; } // for an older connection of mine
      if (p.remoteGen >= 0 && data.c < p.remoteGen) { this.stats.dropped++; return; } // from an older connection of theirs
      // they rebuilt their end: a connection that negotiated with the old one can't continue
      if (p.remoteGen >= 0 && data.c > p.remoteGen && p.pc.remoteDescription) p = this.rebuild(from, false);
    }
    if (!p) p = this.create(from, data.sid, 'connecting', false);
    if (data.c > p.remoteGen) p.remoteGen = data.c;
    p.handle(data);
  }

  /** lost offers / answers, stuck and failed links */
  private heal() {
    const now = Date.now();
    for (const [id, pend] of this.pending) if (now - pend.at > PENDING_MS) { this.pending.delete(id); this.stats.dropped += pend.list.length; }
    for (const p of [...this.peers.values()]) {
      if (p.closed) continue;
      const pc = p.pc;
      if (p.link === 'p2p' && pc.connectionState === 'connected') {
        p.descTries = p.reqTries = 0;
        p.failedSince = 0;
        if (now - p.turnAt > 8000) p.checkTurn();
        continue;
      }
      // my offer was never answered: send it again
      if (pc.signalingState === 'have-local-offer' && !p.descPending && p.descAt &&
          now - p.descAt > backoff(LIMITS.offerRetryMs, p.descTries, 20_000)) {
        this.stats.resends++;
        p.resendOffer();
      }
      // polite and no offer ever came: ask for it
      if (p.polite && !pc.remoteDescription && pc.signalingState === 'stable' &&
          now - Math.max(p.reqAt, p.created) > backoff(LIMITS.offerRetryMs, p.reqTries, 20_000)) {
        this.stats.requests++;
        p.requestOffer();
      }
      // failed, or closed under me (a connection is only closed on purpose through Peer.close())
      const failed = pc.connectionState === 'failed' || pc.iceConnectionState === 'failed' || pc.connectionState === 'closed';
      if (failed) p.failedSince ||= now;
      else p.failedSince = 0;
      const n = this.rebuilds.get(p.id) ?? 0;
      if ((failed && now - p.failedSince > backoff(LIMITS.failedRebuildMs, n, 60_000)) ||
          (p.link !== 'p2p' && now - p.created > backoff(LIMITS.stuckRebuildMs, n, 120_000))) {
        this.rebuild(p.id, true);
      }
    }
  }

  /** false when there is no open channel (the caller relays it) */
  send(id: string, raw: string, reliable: boolean): boolean {
    const p = this.peers.get(id);
    if (!p || p.closed) return false;
    const dc = reliable ? p.r : p.u;
    if (!dc || dc.readyState !== 'open') return false;
    // congested: drop state updates, newer ones follow
    if (!reliable && dc.bufferedAmount > LIMITS.unreliableMaxBuffered) { this.stats.congested++; return true; }
    try { dc.send(raw); return true; } catch { return false; }
  }

  /** one raw message over every open reliable channel (my 'bye') */
  sendAll(raw: string) {
    for (const id of this.peers.keys()) this.send(id, raw, true);
  }

  link(id: string): LinkState { return this.peers.get(id)?.link ?? 'connecting'; }

  /** the direct link to id is up right now (data channel open, ICE connected): their browser answers */
  linkAlive(id: string): boolean {
    const p = this.peers.get(id);
    if (!p || p.closed || p.link !== 'p2p' || p.r?.readyState !== 'open') return false;
    const s = p.pc.iceConnectionState;
    return s === 'connected' || s === 'completed';
  }

  /** the direct link to id goes through a TURN server */
  viaTurn(id: string): boolean { const p = this.peers.get(id); return !!p && p.link === 'p2p' && p.turn; }

  has(id: string) { return this.peers.has(id); }

  setLocalAudio(track: MediaStreamTrack | null) {
    this.localTrack = track;
    for (const p of this.peers.values()) {
      if (p.audio && !p.closed) void p.audio.sender.replaceTrack(track).catch(() => undefined);
    }
  }

  drop(id: string) {
    const p = this.peers.get(id);
    this.pending.delete(id);
    if (!p) return;
    this.peers.delete(id);
    p.close();
    this.hooks.onPeerClosed(id);
  }

  /** stop reporting anything (the session left); links stay open until closeAll() */
  detach() {
    this.hooks = NOOP_HOOKS(this.hooks);
    clearInterval(this.healTimer);
  }

  closeAll() {
    clearInterval(this.healTimer);
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.pending.clear();
  }

  /** debug: per-link connection states */
  debug() {
    return [...this.peers.values()].map((p) => ({
      id: p.id, link: p.link, turn: p.turn, polite: p.polite, c: p.gen, rc: p.remoteGen, pc: p.pc.connectionState, ice: p.pc.iceConnectionState,
      sig: p.pc.signalingState, r: p.r?.readyState ?? null, u: p.u?.readyState ?? null, audio: p.audio?.currentDirection ?? null,
    }));
  }
}
