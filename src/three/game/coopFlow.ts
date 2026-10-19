import * as THREE from 'three';
import { net, normalizeCode, type LeaveReason } from '../../net/session';
import { urlParam } from '../../net/config';
import { save } from '../../engine/save';
import { game, STORY, type Scene } from '../../game/game';
import { coop } from './coop';
import { GM } from './netLevel';
import { MSG } from '../../net/protocol';
import { Level3D } from './level';
import { EPISODES, stepsOf, completeEpisode, myProgress, prologueStep, type Progress } from './episodes';

/**
 * Co-op scene flow: the host decides what everyone plays next (a chapter, the den, a story scene, the credits,
 * the world map, an episode of «Хрумляндия»); clients follow without touching their own solo story progress.
 *  • the lobby starts a prologue chapter (hostStart) or the world map (hostMap); after the prologue's credits the
 *    room goes to the map; on the map the host picks an episode (hostEpisode) — its levels / scene steps play in
 *    order, and when it's done everyone records it (completeEpisode) and the room is back on the map;
 *  • den / story scenes: everyone presses ready (meta `ready`), the host moves on (hostNext);
 *  • the host left mid-chapter → the new host restarts the chapter from the last candle for everyone;
 *  • someone joined while the room sits in the den → the host pulls them in (mid-chapter they wait in the lobby);
 *  • kicked / dropped → main menu with a notice; the last room code is kept per tab for «Вернуться в комнату».
 */

/** what the lobby / den / story scenes register so the flow can open them */
export const COOP_SCENES: {
  den?: (visit: number) => Scene;
  story?: (id: 'intro' | 'ending') => Scene;
  credits?: () => Scene;
  lobby?: () => Scene;
  /** the world map */
  map?: () => Scene;
  /** an episode's scene step (a cutscene / the «Серия в разработке» card) */
  scene?: (ep: string, id: string) => Scene;
} = {};

/** the lobby's start option «Продолжить на карте» (coop.cfg.chapter; the others are STORY indexes) */
export const MAP_CH = -1;
/** an episode's levels: the hero has everything the prologue gave */
const FULL_KIT: (keyof typeof save.data.abilities)[] = ['slingshot', 'doubleJump', 'fork', 'dash'];

/** chapter loadout: abilities every hero needs to clear chapter N (friends who skipped ahead get them) */
const LOADOUT: Record<string, (keyof typeof save.data.abilities)[]> = {
  pantry: [],
  feast: ['slingshot', 'doubleJump'],
  library: ['slingshot', 'doubleJump', 'fork'],
  chase: ['slingshot', 'doubleJump', 'fork', 'dash'],
  throne: ['slingshot', 'doubleJump', 'fork', 'dash'],
};

/** the room's difficulty rides on every level / scene message (late joiners and a new host keep it); hard = «Хардкор» */
type Diff = { easy?: boolean; hard?: boolean };
/** `ep`: the episode the level belongs to (none: the prologue's STORY; `step` is then a STORY index, else the episode's) */
type LevelMsg = { step: number; id: string; seen: string[]; easy: boolean; hard?: boolean; cp?: number[]; cpYaw?: number; ep?: string };
/** map: `prog` = the host's progress (what the room's map shows), `fin` = the episode just finished (everyone records it),
 *  `at` = the host's node (friends' figurines start there) */
type SceneMsg = {
  kind: 'den' | 'story' | 'credits' | 'lobby' | 'map' | 'scene'; step: number; visit?: number; id?: string; ep?: string;
  prog?: Progress; fin?: string; at?: string;
} & Diff;

const LAST_ROOM = 'gk-last-room';
const r2 = (v: number) => Math.round(v * 100) / 100;

class CoopFlow {
  private ready = false;
  /** the story step the room is on (in an episode: its step) */
  step = 1;
  /** the episode the room plays (null: the prologue's STORY) */
  ep: string | null = null;
  /** the host's map progress (what the room's map shows on a client) */
  roomProg: Progress | null = null;
  /** the host's node on the map (where friends' figurines start) */
  roomAt: string | null = null;
  /** a message for the next menu / lobby frame (kicked, room full, host changed…) */
  private notice: string | null = null;
  /** host: what the room is doing now (late joiners get the den) */
  private cur: { level?: LevelMsg; scene?: SceneMsg } = {};
  private lastHost: string | null = null;
  private known = new Set<string>();
  private invite: string | null = null;

  init() {
    if (this.ready) return;
    this.ready = true;
    net.on(GM.level, (d: LevelMsg) => { if (!net.isHost) this.enterLevel(d); });
    net.on('scene', (d: SceneMsg) => { if (!net.isHost) this.enterScene(d); });
    net.onLeave((reason) => this.onLeave(reason));
    net.onMembers(() => this.onMembers());
    Level3D.onCoopFinished = (L) => { if (net.isHost) this.hostNext(L.levelIndex); };
    // ?room=ABCDE invite links open the lobby and join
    const inv = normalizeCode(urlParam('room') ?? '');
    if (inv) this.invite = inv;
  }

  // ───────────────────────── host moves the room ─────────────────────────
  /** host: start story step `step` for the whole room */
  hostStart(step: number) {
    const s = STORY[step];
    if (!s || !net.isHost) return;
    coop.started = true;
    this.step = step;
    this.ep = null;
    net.setRoomState?.('playing');
    if (s.kind === 'level') {
      const msg: LevelMsg = { step, id: s.id, seen: [], ...this.diff() };
      net.send('all', GM.level, msg);
      this.enterLevel(msg);
    } else {
      const msg: SceneMsg = { ...(s.kind === 'den' ? { kind: 'den', step, visit: s.visit } : s.kind === 'story' ? { kind: 'story', step, id: s.id } : { kind: 'credits', step }), ...this.diff() };
      net.send('all', 'scene', msg);
      this.enterScene(msg);
    }
  }

  /** host: after a chapter (or a den / story scene / the credits / an episode's step) move the room on */
  hostNext(from = this.step) {
    if (!net.isHost) return;
    if (this.ep) { this.hostEpisode(this.ep, from + 1); return; }
    const next = from + 1;
    // the prologue is over (its credits): on to the world map
    if (!STORY[next]) { this.hostMap(); return; }
    // the host's own solo progress advances with the room
    save.data.story = Math.max(save.data.story, next);
    save.data.reached = Math.max(save.data.reached, next);
    save.write();
    this.hostStart(next);
  }

  /** host: the whole room to the world map (`fin`: the episode just finished — everyone records it) */
  hostMap(fin?: string) {
    if (!net.isHost) return;
    if (fin) completeEpisode(fin);
    coop.started = true;
    this.ep = null;
    net.setRoomState?.('playing');
    const msg: SceneMsg = { kind: 'map', step: -1, prog: this.mapProg(), at: save.data.mapAt, ...(fin ? { fin } : {}), ...this.diff() };
    this.roomProg = msg.prog ?? null;
    net.send('all', 'scene', msg);
    this.enterScene(msg);
  }

  /** host: play step `step` of an episode for the room (past its end → done → the map) */
  hostEpisode(id: string, step = 0) {
    const ep = EPISODES[id];
    if (!ep || ep.soon || !net.isHost) return;
    save.data.mapAt = id;
    if (id === 'prologue') { this.hostStart(Math.max(1, step || prologueStep())); return; }
    const s = stepsOf(ep)[step];
    if (!s) { this.hostMap(ep.hub ? undefined : id); return; }
    coop.started = true;
    this.ep = id;
    this.step = step;
    net.setRoomState?.('playing');
    if (s.kind === 'level') {
      const msg: LevelMsg = { step, id: s.id, ep: id, seen: [], ...this.diff() };
      net.send('all', GM.level, msg);
      this.enterLevel(msg);
    } else {
      const msg: SceneMsg = { kind: 'scene', step, ep: id, id: s.kind === 'scene' ? s.id : '', ...this.diff() };
      net.send('all', 'scene', msg);
      this.enterScene(msg);
    }
  }

  /**
   * What the room's map shows: a client — the host's progress; the host — its own plus what the room already had
   * (a new host keeps the room's open nodes instead of re-locking them).
   */
  mapProg(): Progress {
    const mine = myProgress();
    if (!net.isHost) return this.roomProg ?? mine;
    const out: Progress = { ...(this.roomProg ?? {}) };
    for (const [id, p] of Object.entries(mine)) {
      const o = out[id];
      out[id] = o ? { done: o.done || p.done, medal: Math.max(o.medal, p.medal) } : { done: p.done, medal: p.medal };
    }
    return out;
  }

  /** the room's difficulty for a level / scene message */
  private diff(): { easy: boolean; hard: boolean } { return { easy: coop.cfg.easy, hard: coop.cfg.hard }; }

  backToLobby() {
    const msg: SceneMsg = { kind: 'lobby', step: this.step, ...this.diff() };
    if (net.isHost) { net.send('all', 'scene', msg); net.setRoomState?.('lobby'); }
    this.enterScene(msg);
  }

  /** others (everyone but the host) who pressed ready in the current scene / all others */
  othersReady(): [number, number] {
    let r = 0, n = 0;
    for (const m of net.members.values()) { if (m.isHost) continue; n++; if (m.ready) r++; }
    return [r, n];
  }

  /** the title of the chapter after the current step ('' when none) */
  nextTitle(from = this.step): string {
    for (let i = from + 1; i < STORY.length; i++) { const s = STORY[i]; if (s.kind === 'level') return s.title.split('. ')[1] ?? s.title; }
    return '';
  }

  // ───────────────────────── everyone ─────────────────────────
  /** everyone: load a chapter with the host's world state */
  private enterLevel(d: LevelMsg) {
    coop.started = true;
    coop.takeDiff(d);
    this.step = d.step;
    this.ep = typeof d.ep === 'string' && EPISODES[d.ep] ? d.ep : null;
    this.cur = { level: d };
    net.setMeta({ ready: false, scene: 'lvl:' + d.id });
    coop.lendKit(LOADOUT[d.id] ?? (this.ep ? FULL_KIT : []));
    const cp = d.cp ? { pos: new THREE.Vector3(d.cp[0], d.cp[1], d.cp[2]), yaw: d.cpYaw ?? 0 } : undefined;
    const seen = new Set(d.seen);
    game.goNow(() => new Level3D(d.id, d.step, cp, seen));
  }

  private enterScene(d: SceneMsg) {
    this.step = d.step;
    if (typeof d.easy === 'boolean') coop.takeDiff(d);
    // (a resent / late copy of the map message must not credit an episode the newcomer didn't play)
    this.cur = { scene: { ...d, fin: undefined } };
    net.setMeta({ ready: false, scene: d.kind });
    if (d.kind === 'map') {
      // only a machine that played the episode records it (not someone who joined mid-episode and waited in the lobby)
      const played = !!d.fin && this.ep === d.fin;
      coop.started = true;
      this.ep = null;
      coop.returnKit();
      if (d.prog && typeof d.prog === 'object') this.roomProg = d.prog;
      if (typeof d.at === 'string' && EPISODES[d.at]) this.roomAt = d.at;
      if (d.fin && played && !net.isHost) completeEpisode(d.fin);
      const f = COOP_SCENES.map;
      // already there (a client whose credits ended first, a newer progress): no reload
      if (f && (game.scene as { worldMap?: unknown } | null)?.worldMap !== true) game.goNow(f);
      return;
    }
    if (d.kind === 'scene') {
      coop.started = true;
      this.ep = typeof d.ep === 'string' && EPISODES[d.ep] ? d.ep : null;
      const f = COOP_SCENES.scene;
      if (f && this.ep) { const ep = this.ep, id = d.id ?? ''; game.goNow(() => f(ep, id)); }
      return;
    }
    if (d.kind === 'lobby') {
      coop.started = false;
      coop.returnKit();
      const f = COOP_SCENES.lobby;
      // already there (a client whose credits ended first): no reload
      if (f && (game.scene as { coopLobby?: unknown } | null)?.coopLobby !== true) game.goNow(f);
      return;
    }
    coop.started = true;
    if (d.kind === 'den' && COOP_SCENES.den) game.goNow(() => COOP_SCENES.den!(d.visit ?? 1));
    else if (d.kind === 'story' && COOP_SCENES.story) game.goNow(() => COOP_SCENES.story!(d.id === 'intro' ? 'intro' : 'ending'));
    else if (d.kind === 'credits' && COOP_SCENES.credits) { const make = COOP_SCENES.credits; game.goNow(() => new CoopCredits(make())); }
  }

  /** a client whose credits ended: wait for the host on the world map */
  toMapLocal() { this.enterScene({ kind: 'map', step: -1 }); }

  private onMembers() {
    if (!net.active) { this.lastHost = null; this.known.clear(); return; }
    if (net.code) { try { sessionStorage.setItem(LAST_ROOM, net.code); } catch { /* */ } }
    // host migration: the old host left while we were playing → I restart the room from where it was
    const host = net.hostId;
    const prev = this.lastHost;
    this.lastHost = host;
    if (prev && host && prev !== host && coop.started) {
      if (net.isHost) this.takeOver();
      else this.say(`Новый хозяин комнаты: ${net.members.get(host)?.name ?? '?'}`);
    }
    // newcomers: while the room sits in the den the host pulls them in (mid-chapter they wait in the lobby)
    const fresh: string[] = [];
    for (const id of net.members.keys()) if (!this.known.has(id)) { this.known.add(id); if (id !== net.myId) fresh.push(id); }
    for (const id of [...this.known]) if (!net.members.has(id)) this.known.delete(id);
    // newcomers learn the room's chapter / difficulty right away (mid-chapter they wait in the lobby and show it)
    if (net.isHost && coop.started) for (const id of fresh) net.send(id, MSG.lobbyCfg, { ch: coop.cfg.chapter, ...this.diff() });
    if (net.isHost && coop.started && fresh.length) {
      const sc = this.cur.scene;
      if (sc && (sc.kind === 'den' || sc.kind === 'map' || sc.kind === 'scene')) for (const id of fresh) net.send(id, 'scene', this.fresh(sc));
    }
  }

  /** I became the host in the middle of a game */
  private takeOver() {
    const L = game.scene instanceof Level3D ? game.scene : null;
    // the chapter was already won (exit / victory scene, results card): finish it for everyone, don't replay it
    if (L && L.nl && (L.complete || (L.boss as { state?: string } | null)?.state === 'dead')) {
      if (L.waitingHost) this.hostNext(L.levelIndex); // my card is done: on to the next scene now
      else if (!L.results && !L.inCutscene) L.endLevel(); // (a running exit scene ends it itself — I'm the authority now)
      // (a card still on screen moves the room on when I close it: Level3D.onCoopFinished)
      this.say('Хозяин вышел — теперь хозяин ты');
      return;
    }
    if (L && L.nl) {
      // restart the chapter from the last candle for everyone (enemy state of the old host is gone)
      const msg: LevelMsg = {
        step: this.step, id: L.def.id, seen: [...L.seen], ...this.diff(), ...(this.ep ? { ep: this.ep } : {}),
        cp: L.checkpoint ? [r2(L.checkpoint.x), r2(L.checkpoint.y), r2(L.checkpoint.z)] : undefined, cpYaw: L.checkpointYaw,
      };
      net.send('all', GM.level, msg);
      this.enterLevel(msg);
      this.say('Хозяин вышел — теперь хозяин ты. Продолжаем со свечки!');
      return;
    }
    // den / story / credits read net.isHost themselves; re-announce the scene so stragglers are in sync
    const sc = this.cur.scene;
    // (only to those not there yet: a resent scene would restart it for everyone — the ending story from its start)
    if (sc && sc.kind !== 'lobby') for (const m of net.members.values()) if (!m.isMe && m.scene !== sc.kind) net.send(m.id, 'scene', this.fresh(sc));
    this.say('Хозяин вышел — теперь хозяин ты');
  }

  private onLeave(reason: LeaveReason) {
    const wasPlaying = coop.started;
    coop.stop();
    this.cur = {};
    this.ep = null;
    this.roomProg = null;
    this.roomAt = null;
    this.lastHost = null;
    this.known.clear();
    if (reason === 'leave' || reason === 'kicked') this.forgetRoom();
    if (reason === 'kicked') this.say('Хозяин выгнал тебя из комнаты');
    else if (reason === 'full') this.say('Комната заполнена (6 из 6)');
    if (reason === 'leave' || reason === 'unload') return; // whoever left navigates
    // kicked / dropped: the lobby shows it on its start screen; anywhere else → main menu
    const inLobby = (game.scene as { coopLobby?: unknown } | null)?.coopLobby === true; // (the main menu has a coopLobby() method)
    if (!inLobby && (wasPlaying || game.scene instanceof Level3D || (game.scene as { worldMap?: unknown } | null)?.worldMap === true)) game.toMenu();
  }

  /** a scene message to resend: the map carries my (the host's) current progress */
  private fresh(sc: SceneMsg): SceneMsg { return sc.kind === 'map' ? { ...sc, prog: this.mapProg(), at: save.data.mapAt, ...this.diff() } : sc; }

  // ───────────────────────── notices / invites / reconnect ─────────────────────────
  /** show a message on the next menu / lobby frame */
  say(s: string) { this.notice = s; }
  takeNotice(): string | null { const n = this.notice; this.notice = null; return n; }
  /** the room this tab was in last (for «Вернуться в комнату»), null after leaving it on purpose */
  lastRoom(): string | null {
    if (net.active) return null;
    try { return normalizeCode(sessionStorage.getItem(LAST_ROOM) ?? ''); } catch { return null; }
  }
  forgetRoom() { try { sessionStorage.removeItem(LAST_ROOM); } catch { /* */ } }
  /** a ?room= invite code (once) */
  takeInvite(): string | null { const c = this.invite; this.invite = null; return c; }
}

export const coopFlow = new CoopFlow();

/**
 * The credits in co-op: the same scroll, but at the end everyone goes back to the room's lobby
 * (not the main menu) and a client's own solo story is left alone.
 */
class CoopCredits implements Scene {
  constructor(private inner: Scene & { leaving?: boolean }) {}
  update(dt: number) {
    const story = save.data.story;
    const pro = save.data.episodes.prologue;
    const was = !!this.inner.leaving;
    this.inner.update(dt);
    if (was || !this.inner.leaving) return;
    // a client's own prologue isn't finished by the room's (its solo story stays where it was)
    if (!net.isHost) {
      save.data.story = story;
      if (pro) save.data.episodes.prologue = pro; else delete save.data.episodes.prologue;
      save.write();
    }
    // the scroll asked for the solo map (game.go); the room's map replaces that pending scene
    if (!net.active) return;
    if (net.isHost) coopFlow.hostNext(coopFlow.step);
    else coopFlow.toMapLocal();
  }
  render(ctx: CanvasRenderingContext2D) { this.inner.render(ctx); }
  leave() { this.inner.leave?.(); }
}

/**
 * An episode's scene step is over (the «Серия в разработке» card, a cutscene): solo → the next step; co-op → the host
 * moves the room on, a client says it's ready and waits.
 */
export function stepDone() {
  if (!coop.active) { game.advance(); return; }
  if (net.isHost) coopFlow.hostNext();
  else net.setMeta({ ready: true });
}
