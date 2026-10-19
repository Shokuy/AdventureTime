import * as THREE from 'three';
import { W, clamp, ease } from '../../engine/util';
import { input } from '../../engine/input';
import { audio } from '../../engine/audio';
import { save } from '../../engine/save';
import { rrect, text, wrap } from '../../art/draw';
import { net } from '../../net/session';
import { MSG } from '../../net/protocol';
import { toUI } from '../runtime';
import { LEVEL_PLUGINS } from './level';
import type { Level3D, LevelPlugin, HeroLike } from './level';
import type { Enemy3 } from './enemies';
import type { Shot3 } from './objects';
import type { RemoteHero3 } from './remoteHero';
import { drawScoreboard, drawCrown, type BoardCol, type BoardRow } from '../../ui/scoreboard';
import { TEAM_RESULTS, type TeamCheck, type TeamResults, type TeamRow } from '../../ui/results';
import { drawHint } from '../../ui/glyphs';

/**
 * The competitive layer of a co-op chapter (features 23–27), a LEVEL_PLUGINS plugin:
 *  • per-player stats for the chapter run: crumbs, kills, damage dealt, revives, downs, golden walnuts,
 *    combo (hits in a row without taking damage) and the best combo;
 *  • the HOST credits hits / kills / damage (it resolves every swing and pea: L.attacker / Shot3.shooter / its own),
 *    detects downs and lost hearts, counts revives; owners report what only they know (crumbs, walnuts);
 *    the host broadcasts the table (≈5 Hz while it changes + a reliable keyframe), the last one is final;
 *  • the leader (most points) wears a crown and is `L.refs.leaderId` (the throne King goes after him);
 *  • walnut race announcements in the event feed; a combo counter; the Tab / Share scoreboard;
 *  • the team page of the results card (MVP, fun titles, team medal) via TEAM_RESULTS.
 * Solo: the plugin isn't created at all.
 */

/**
 * Message types this layer listens to (shared with the other co-op modules):
 *  revive — reviver → all (or 'host') when a revive COMPLETES: `{ who: <revived member id>, done: true }`
 *           (progress messages without `done` are ignored; `by` may name the reviver, else the sender counts).
 *           Code on any machine may call `creditRevive(L, byId, whoId)` instead. Without either, the host still
 *           notices a friend getting up next to someone and credits the nearest hero.
 *  score  — host → all `{ s: [[id, crumbs, kills, dmg, revives, downs, nuts, combo, best]…], l: leaderId, f?: 1 }`
 *           (f = final table at the chapter's end); client → host `{ me: [crumbs, nuts] }`.
 *  walnut — finder → all `{ n, of }` → «Вася нашёл золотой орешек! (2/3)».
 */
export const SCORE_EVENTS = { revive: MSG.revive, score: MSG.score, walnut: MSG.walnut } as const;

/** the PvP arena's level id (pvp.ts has its own scores; this plugin stays out of it) */
export const PVP_ID = 'pvp';

export interface PStats { crumbs: number; kills: number; dmg: number; revives: number; downs: number; nuts: number; combo: number; best: number }
const FIELDS = ['crumbs', 'kills', 'dmg', 'revives', 'downs', 'nuts', 'combo', 'best'] as const;
const blank = (): PStats => ({ crumbs: 0, kills: 0, dmg: 0, revives: 0, downs: 0, nuts: 0, combo: 0, best: 0 });
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);

/** points for the crown and MVP: fighting, helping and treasure count, getting knocked down costs */
export function scorePoints(s: PStats) {
  return Math.max(0, Math.round(s.crumbs + s.kills * 10 + s.dmg * 2 + s.revives * 25 + s.nuts * 30 + s.best * 2 - s.downs * 15));
}

/** a chapter run: survives team wipes (the level is rebuilt with the same world `seen` set) */
interface Session {
  rows: Map<string, PStats>;
  leader: string;
  /** my L.stats.crumbs when the run started (my crumbs = the difference) */
  crumbBase: number;
  myNuts: number;
  /** how many times the level was built in this run (wipes = builds − 1) */
  builds: number;
  /** the host's final table arrived: numbers are frozen */
  final: boolean;
}
const SESSIONS = new WeakMap<Set<string>, Session>();
const PLUGINS = new WeakMap<Level3D, ScorePlugin>();

const COLS: BoardCol[] = [
  { label: 'Очки', w: 76 }, { label: 'Крошки', w: 82 }, { label: 'Враги', w: 74 }, { label: 'Урон', w: 72 },
  { label: 'Подъёмы', w: 90 }, { label: 'Падения', w: 86 }, { label: 'Орешки', w: 82 }, { label: 'Комбо', w: 76 },
];

/** fun titles: the best at each stat (a hero holds at most two; ties share) */
const TITLES: { name: string; key: keyof TeamRow & keyof PStats; min: number }[] = [
  { name: 'Ангел-хранитель', key: 'revives', min: 1 },
  { name: 'Гроза арбузов', key: 'kills', min: 1 },
  { name: 'Камикадзе', key: 'downs', min: 2 },
  { name: 'Орехолов', key: 'nuts', min: 1 },
  { name: 'Комбо-мастер', key: 'best', min: 5 },
  { name: 'Крошкоед', key: 'crumbs', min: 1 },
  { name: 'Тяжёлая рука', key: 'dmg', min: 1 },
];

const tmp = new THREE.Vector3();
const idOf = (h: HeroLike) => (h.isLocal ? net.myId : (h as unknown as RemoteHero3).id);
/** the members playing this chapter: a friend who joined mid-chapter waits in the lobby (scene 'lobby') and is not on
 *  the team table, the scoreboard or in the race for the crown (same rule as NetLevel's remote heroes) */
const team = () => [...net.members].filter(([, m]) => m.isMe || m.scene !== 'lobby');

class ScorePlugin implements LevelPlugin {
  readonly s: Session;
  private inbox: { type: string; d: any; from: string }[] = [];
  private unsubs: (() => void)[] = [];
  /** host: whose swing / pea is being resolved right now */
  private cur: string | null = null;
  private wrapped = new WeakSet<object>();
  private alive = new Set<Enemy3>();
  private lastHit = new WeakMap<Enemy3, { by: string; t: number }>();
  private heroHp = new Map<string, number>();
  private heroDown = new Map<string, { down: boolean; dead: boolean; at: THREE.Vector3 }>();
  private pendingRev: { who: string; by: string; t: number }[] = [];
  private lastRev = new Map<string, number>();
  private t = 0;
  private sendT = 0;
  private keyT = 1;
  private dirty = true;
  private finalSent = false;
  private meT = 0;
  private meSent = '';
  private lastNuts: number;
  private leaderT = -99;
  private boardK = 0;
  /** seconds the "hold Tab" tip has been on screen */
  private tipT = 0;
  // combo counter
  private comboK = 0;
  private comboPulse = 0;
  private shownCombo = 0;
  private broke = 0;
  private brokeAt = 0;
  private readonly teamGet = () => this.teamResults();

  constructor(private L: Level3D) {
    let s = SESSIONS.get(L.seen);
    if (!s) { s = { rows: new Map(), leader: '', crumbBase: L.stats.crumbs, myNuts: 0, builds: 0, final: false }; SESSIONS.set(L.seen, s); }
    s.builds++;
    this.s = s;
    this.lastNuts = save.data.nuts;
    for (const ty of [SCORE_EVENTS.score, SCORE_EVENTS.walnut, SCORE_EVENTS.revive]) {
      this.unsubs.push(net.on(ty, (d, from) => this.inbox.push({ type: ty, d, from })));
    }
    this.install();
    TEAM_RESULTS.get = this.teamGet;
    PLUGINS.set(L, this);
  }

  row(id: string): PStats {
    let r = this.s.rows.get(id);
    if (!r) { r = blank(); this.s.rows.set(id, r); }
    return r;
  }

  // ───────────────────────── kill credit (host) ─────────────────────────
  /** wrap the places where heroes' hits are resolved, so every hit knows whose it is */
  private install() {
    const L = this.L;
    const any = L as unknown as Record<string, (...a: any[]) => any>;
    const hook = (name: string, who: (a: any[]) => string | null, after: (who: string | null) => void) => {
      const orig = any[name];
      any[name] = (...a: any[]) => {
        const by = who(a);
        try { return this.credit(by, () => orig.apply(L, a)); } finally { after(by); }
      };
    };
    // my own swing (host) / a friend's swing resolved by the host (L.attacker is set inside)
    hook('meleeHit', () => (L.nl?.isHost ? net.myId : null), (by) => this.tagShots(by));
    hook('remoteMelee', (a) => (L.nl?.isHost ? String(a[0]) : null), (by) => this.tagShots(by));
    // peas: the host flies every real pea (a friend's has Shot3.shooter)
    hook('spawnPea', () => null, () => this.tagShots(net.myId));
    hook('remotePea', () => null, () => this.tagShots(null));
  }

  /** host: run f with hits credited to `by` (enemy hurt() and the boss's hp drop) */
  private credit<T>(by: string | null, f: () => T): T {
    if (!by || !this.L.nl?.isHost || this.s.final) return f();
    const outer = this.cur === null;
    const prev = this.cur;
    this.cur = by;
    const boss = outer ? this.L.boss : null;
    const b0 = boss ? boss.hp : 0;
    if (outer) this.wrapEnemies();
    try { return f(); } finally {
      this.cur = prev;
      if (boss && this.L.boss === boss && boss.hp < b0) this.onHit(by, b0 - Math.max(0, boss.hp), null);
    }
  }

  /** host: player-owned shots (peas, reflected meat) remember who fired them */
  private tagShots(by: string | null) {
    if (!this.L.nl?.isHost) return;
    for (const s of this.L.shots) {
      if (this.wrapped.has(s) || s.owner !== 'player' || s.visual || s.dead) continue;
      this.wrapShot(s, s.shooter ?? by ?? net.myId);
    }
  }
  private wrapShot(s: Shot3, by: string) {
    this.wrapped.add(s);
    const orig = s.update;
    s.update = (Lx: Level3D, dt: number) => this.credit(by, () => orig.call(s, Lx, dt));
  }

  private wrapEnemies() {
    for (const e of this.L.enemies) {
      if (this.wrapped.has(e)) continue;
      this.wrapped.add(e);
      this.alive.add(e);
      const orig = e.hurt;
      e.hurt = (Lx: Level3D, dmg: number, from: THREE.Vector3, kind: string) => {
        const by = this.cur, hp0 = e.hp;
        orig.call(e, Lx, dmg, from, kind);
        if (by && e.hp < hp0) this.onHit(by, hp0 - Math.max(0, e.hp), e);
      };
    }
  }

  private onHit(by: string, dmg: number, e: Enemy3 | null) {
    const r = this.row(by);
    r.dmg += dmg;
    r.combo++;
    if (r.combo > r.best) r.best = r.combo;
    if (e) this.lastHit.set(e, { by, t: this.t });
    this.dirty = true;
  }

  /** host: enemies that died since the last tick go to whoever hit them last */
  private scanKills() {
    if (!this.alive.size) return;
    const live = new Set(this.L.enemies);
    for (const e of this.alive) {
      if (!e.dead && live.has(e)) continue;
      this.alive.delete(e);
      const h = this.lastHit.get(e);
      if (e.dead && h && this.t - h.t < 8) { this.row(h.by).kills++; this.dirty = true; }
    }
  }

  // ───────────────────────── downs / lost hearts / revives (host) ─────────────────────────
  private trackHeroes() {
    for (const h of this.L.heroes()) {
      const id = idOf(h);
      const r = this.row(id);
      const hp0 = this.heroHp.get(id);
      if (hp0 !== undefined && h.hp < hp0 && r.combo > 0) { r.combo = 0; this.dirty = true; }
      this.heroHp.set(id, h.hp);
      const down = h.downed || h.dead;
      const st = this.heroDown.get(id);
      if (!st) { this.heroDown.set(id, { down, dead: h.dead, at: h.pos.clone() }); continue; }
      if (down && !st.down) { r.downs++; r.combo = 0; this.dirty = true; st.dead = h.dead; }
      else if (down) st.dead = st.dead || h.dead;
      else if (st.down && !st.dead && h.pos.distanceTo(st.at) < 3) {
        // got up where he lay (not at a candle): somebody helped — the nearest standing hero, unless told otherwise
        let by = '', bd = 3.5;
        for (const o of this.L.alivePlayers()) {
          const oid = idOf(o);
          if (oid === id) continue;
          const d = o.pos.distanceTo(h.pos);
          if (d < bd) { bd = d; by = oid; }
        }
        if (by) this.pendingRev.push({ who: id, by, t: this.t });
      }
      st.down = down;
      st.at.copy(h.pos);
    }
    // a guessed revive waits a moment for the real message
    if (this.pendingRev.length) {
      this.pendingRev = this.pendingRev.filter((p) => {
        if (this.t - p.t < 0.8) return true;
        const last = this.lastRev.get(p.who);
        if (last === undefined || last < p.t - 2.5) this.revived(p.by, p.who);
        return false;
      });
    }
  }

  /** host: `by` brought `who` back up */
  revived(by: string, who: string) {
    if (who) {
      const last = this.lastRev.get(who);
      if (last !== undefined && this.t - last < 2.5) return;
      this.lastRev.set(who, this.t);
    }
    this.row(by).revives++;
    this.dirty = true;
  }

  // ───────────────────────── leader ─────────────────────────
  private pickLeader() {
    let lead = '';
    const ids = team().map(([id]) => id);
    if (ids.length >= 2) {
      let bp = 0;
      for (const id of ids) {
        const p = scorePoints(this.row(id));
        if (p > bp || (p === bp && p > 0 && id === this.s.leader)) { bp = p; lead = id; }
      }
    }
    this.setLeader(lead);
  }

  private setLeader(id: string) {
    if (id === this.s.leader) return;
    this.s.leader = id;
    this.dirty = true;
    if (!id || this.L.results || this.t - this.leaderT < 12) return;
    this.leaderT = this.t;
    const name = id === net.myId ? 'Ты' : net.members.get(id)?.name ?? '?';
    this.L.feed(`${name} — ${id === net.myId ? 'лидер! Король это заметит…' : 'теперь лидер!'}`, '#ffd34a');
  }

  // ───────────────────────── messages ─────────────────────────
  private handleInbox() {
    const msgs = this.inbox;
    this.inbox = [];
    for (const m of msgs) {
      const d = m.d ?? {};
      if (m.type === SCORE_EVENTS.score) {
        if (Array.isArray(d.me) && net.isHost) {
          const r = this.row(m.from);
          if (!this.s.final) { r.crumbs = num(d.me[0]); r.nuts = num(d.me[1]); this.dirty = true; }
        } else if (Array.isArray(d.s) && !net.isHost && m.from === net.hostId) this.applyTable(d);
      } else if (m.type === SCORE_EVENTS.walnut) {
        const name = net.members.get(m.from)?.name ?? 'Кто-то';
        this.L.feed(`${name} нашёл золотой орешек! (${num(d.n)}/${num(d.of)})`, '#ffe14a');
        audio.sfx('coin', { pitch: 1.6, volume: 0.5 });
      } else if (m.type === SCORE_EVENTS.revive && net.isHost) {
        if (d.done === true || d.state === 'done' || (typeof d.p === 'number' && d.p >= 1)) {
          this.revived(typeof d.by === 'string' ? d.by : m.from, typeof d.who === 'string' ? d.who : '');
        }
      }
    }
  }

  /** client: the host's table (my own crumbs / walnuts stay mine until the final table) */
  private applyTable(d: { s: unknown[][]; l?: string; f?: number }) {
    if (this.s.final) return;
    const fin = !!d.f;
    for (const rec of d.s) {
      if (!Array.isArray(rec) || typeof rec[0] !== 'string') continue;
      const id = rec[0];
      const r = this.row(id);
      FIELDS.forEach((f, i) => {
        if (id === net.myId && !fin && (f === 'crumbs' || f === 'nuts')) return;
        r[f] = num(rec[i + 1]);
      });
    }
    this.setLeader(typeof d.l === 'string' ? d.l : '');
    if (fin) this.s.final = true;
  }

  private pack(final: boolean) {
    const s: (string | number)[][] = [];
    for (const [id] of team()) {
      const r = this.row(id);
      s.push([id, r.crumbs, r.kills, Math.round(r.dmg * 10) / 10, r.revives, r.downs, r.nuts, r.combo, r.best]);
    }
    return final ? { s, l: this.s.leader, f: 1 } : { s, l: this.s.leader };
  }

  // ───────────────────────── my own counters ─────────────────────────
  private trackMine(dt: number) {
    const L = this.L, s = this.s;
    const nuts = save.data.nuts;
    const found = nuts > this.lastNuts && !L.results && !s.final;
    this.lastNuts = nuts;
    if (L.results || s.final) return;
    if (found) {
      s.myNuts++;
      net.send('all', SCORE_EVENTS.walnut, { n: L.nutsFound(), of: L.nutIds.length });
    }
    const crumbs = Math.max(0, L.stats.crumbs - s.crumbBase);
    const me = this.row(net.myId);
    if (me.crumbs !== crumbs || me.nuts !== s.myNuts) { me.crumbs = crumbs; me.nuts = s.myNuts; this.dirty = true; }
    if (!net.isHost) {
      this.meT -= dt;
      const key = crumbs + ':' + s.myNuts;
      if (key !== this.meSent && this.meT <= 0) { this.meT = 0.25; this.meSent = key; net.send('host', SCORE_EVENTS.score, { me: [crumbs, s.myNuts] }); }
    }
  }

  // ───────────────────────── tick ─────────────────────────
  update(dt: number) {
    const L = this.L, nl = L.nl;
    if (!nl) return;
    this.t += dt;
    this.handleInbox();
    this.trackMine(dt);
    if (nl.isHost && !this.s.final) {
      this.wrapEnemies();
      this.tagShots(null);
      this.scanKills();
      this.trackHeroes();
      this.pickLeader();
    }
    if (nl.isHost) {
      this.sendT -= dt; this.keyT -= dt;
      if (!this.finalSent && L.results) {
        // the chapter is over: one last reliable table everyone builds the results from
        this.finalSent = true;
        this.s.final = true;
        net.send('all', SCORE_EVENTS.score, this.pack(true));
      } else if (!this.finalSent && ((this.dirty && this.sendT <= 0) || this.keyT <= 0)) {
        const key = this.keyT <= 0;
        this.sendT = 0.2;
        if (key) this.keyT = 2.5;
        this.dirty = false;
        net.send('all', SCORE_EVENTS.score, this.pack(false), key);
      }
    }
    L.refs.leaderId = this.s.leader || undefined;
    // UI
    const held = input.down('score') && !L.paused && !input.suspended;
    this.boardK = clamp(this.boardK + (held ? dt * 6 : -dt * 8), 0, 1);
    const c = this.row(net.myId).combo;
    if (c > this.shownCombo) { this.comboPulse = 1; if (c % 10 === 0) { input.rumble(0.25, 0.1, 90); audio.sfx('coin', { pitch: 1.2 + Math.min(1, c / 40), volume: 0.5 }); } }
    else if (c < this.shownCombo && this.shownCombo >= 5) { this.broke = this.shownCombo; this.brokeAt = this.t; }
    this.shownCombo = c;
    this.comboPulse = Math.max(0, this.comboPulse - dt * 4);
    this.comboK = clamp(this.comboK + (c >= 3 && !L.results ? dt * 6 : -dt * 3), 0, 1);
    // the tip counts only while it can be seen (not during the intro / loading)
    if (L.letterbox < 0.3 && !nl.waiting && !L.paused) this.tipT += dt;
  }

  dispose() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (TEAM_RESULTS.get === this.teamGet) TEAM_RESULTS.get = null;
  }

  // ───────────────────────── results (team page) ─────────────────────────
  teamResults(): TeamResults | null {
    const L = this.L;
    if (!L.nl) return null;
    const rows: TeamRow[] = [];
    for (const [id, m] of team()) {
      const r = this.row(id);
      rows.push({
        id, name: m.name, color: m.look?.tagColor || '#ffd34a', me: id === net.myId, pts: scorePoints(r),
        crumbs: r.crumbs, kills: r.kills, dmg: Math.round(r.dmg), revives: r.revives, downs: r.downs, nuts: r.nuts, best: r.best, titles: [],
      });
    }
    rows.sort((a, b) => b.pts - a.pts || b.kills - a.kills || (a.id < b.id ? -1 : 1));
    // a title always names the real record holder(s); somebody who already has two just doesn't get a third
    for (const T of TITLES) {
      const top = Math.max(...rows.map((r) => r[T.key]));
      if (top < T.min) continue;
      for (const r of rows) if (r[T.key] === top && r.titles.length < 2) r.titles.push(T.name);
    }
    if (rows.length > 1) for (const r of rows) if (!r.titles.length) r.titles.push('Турист');
    const mvp = rows[0] && rows[0].pts > 0 ? rows[0].id : null;
    // the team medal: enemies beaten, few knock-downs, no team wipes
    const st = L.stats;
    const checks: TeamCheck[] = [];
    const enemies = L.def.id === 'chase' ? 0 : st.enemies;
    if (enemies > 0) checks.push({ label: `Враги: ${Math.min(st.kills, enemies)} из ${enemies}`, good: st.kills >= Math.ceil(enemies * 0.85) });
    const downs = rows.reduce((a, r) => a + r.downs, 0);
    checks.push({ label: `Падения команды: ${downs} (можно ${rows.length})`, good: downs <= rows.length });
    const wipes = Math.max(0, this.s.builds - 1);
    checks.push({ label: wipes ? `Вся команда падала: ${wipes} р.` : 'Ни разу не легли все вместе', good: wipes === 0 });
    const ok = checks.filter((c) => c.good).length;
    const medal: 1 | 2 | 3 = ok === checks.length ? 3 : ok * 2 >= checks.length ? 2 : 1;
    return { rows, mvp, medal, checks };
  }

  // ───────────────────────── drawing ─────────────────────────
  draw(ctx: CanvasRenderingContext2D) {
    const L = this.L;
    if (!L.nl) return;
    if (!L.results) this.drawCrown(ctx);
    if (!L.paused && !L.results && L.letterbox < 0.3) { this.drawCombo(ctx); this.drawTip(ctx); }
    if (this.boardK > 0.01) this.drawBoard(ctx);
  }

  /** the leader's crown over his head */
  private drawCrown(ctx: CanvasRenderingContext2D) {
    const L = this.L, id = this.s.leader;
    if (!id || team().length < 2) return;
    const cam = L.tcam.cam;
    let s: { x: number; y: number; vis: boolean };
    if (id === net.myId) {
      const p = L.player;
      if (p.hidden || p.dead) return;
      s = toUI(tmp.copy(p.pos).setY(p.pos.y + 1.85), cam);
    } else {
      const r = L.remote(id);
      if (!r || r.hidden) return;
      const head = toUI(tmp.copy(r.pos).setY(r.pos.y + 1.55), cam);
      s = { x: head.x, y: head.y - (r.downed || r.dead ? 62 : 40), vis: head.vis };
      // a speech bubble over his nameplate (level.ts draws it there): the crown sits on top of the bubble
      if (r.bubble && r.bubble.t < 6) {
        ctx.font = '400 18px Pangolin, sans-serif';
        s.y = head.y - 44 - wrap(ctx, r.bubble.text, 260).length * 22 - 14 - 16;
      }
      const d = r.pos.distanceTo(L.player.pos);
      if (d > 60) return;
    }
    if (!s.vis || s.x < -40 || s.x > W + 40 || s.y < -40) return;
    drawCrown(ctx, s.x, s.y + Math.sin(L.t * 3) * 3, 0.8, L.t);
  }

  /** my combo streak (left, under the HUD) */
  private drawCombo(ctx: CanvasRenderingContext2D) {
    const L = this.L;
    const r = this.row(net.myId);
    const k = ease.outCubic(this.comboK);
    if (k > 0.01) {
      const c = Math.max(r.combo, 3);
      const col = c >= 25 ? '#ff6ad0' : c >= 12 ? '#ff9a3a' : '#ffd34a';
      const x = 20, y = 128;
      ctx.save();
      ctx.globalAlpha = k;
      ctx.translate(x - (1 - k) * 60, y);
      rrect(ctx, 0, 0, 150, 52, 16, 'rgba(30,15,15,0.6)', 0);
      text(ctx, 'КОМБО', 14, 20, { size: 13, color: '#e8d8c8' });
      ctx.save();
      const sc = 1 + this.comboPulse * 0.35;
      ctx.translate(16, 44); ctx.scale(sc, sc);
      text(ctx, `×${r.combo}`, 0, 0, { size: 26, color: col, stroke: 5 });
      ctx.restore();
      text(ctx, `рекорд ${r.best}`, 138, 44, { size: 13, font: 'body', color: '#c8b8b0', align: 'right' });
      ctx.restore();
    }
    // the streak just broke
    const bt = this.t - this.brokeAt;
    if (this.broke && bt < 1.4) {
      const a = clamp(Math.min(bt * 6, (1.4 - bt) / 0.4), 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      text(ctx, `Серия ×${this.broke} прервана!`, 24, 150 + bt * 10, { size: 17, font: 'body', color: '#ff8a8a', stroke: 4 });
      ctx.restore();
    }
    void L;
  }

  /** first seconds of a run: where the scoreboard is */
  private drawTip(ctx: CanvasRenderingContext2D) {
    const t = this.tipT;
    if (this.s.builds > 1 || t > 12 || t < 1 || this.comboK > 0.1 || this.boardK > 0.5) return;
    const a = clamp(Math.min((t - 1) * 2, (12 - t) / 0.8), 0, 1);
    ctx.save();
    ctx.globalAlpha = a * 0.92;
    drawHint(ctx, 'score', 'держи — таблица очков', 22, 146, { size: 26 });
    ctx.restore();
  }

  private drawBoard(ctx: CanvasRenderingContext2D) {
    const rows: (BoardRow & { pts: number })[] = [];
    for (const [id, m] of team()) {
      const r = this.row(id);
      const pts = scorePoints(r);
      rows.push({
        id, name: m.name, color: m.look?.tagColor || '#ffd34a', me: id === net.myId, crown: id === this.s.leader, host: m.isHost, ping: m.ping, pts,
        cells: [pts, r.crumbs, r.kills, Math.round(r.dmg), r.revives, r.downs, r.nuts, r.combo > 0 ? `${r.best} (${r.combo})` : r.best],
      });
    }
    rows.sort((a, b) => b.pts - a.pts || (a.id < b.id ? -1 : 1));
    drawScoreboard(ctx, { title: 'ТАБЛИЦА ОЧКОВ', sub: this.L.def.title, cols: COLS, rows, k: this.boardK, t: this.L.t, ping: true, hold: 'score' });
  }

  wantsInput() { return false; }
}

/** a revive finished: `by` helped `who` up (call it on any machine; the host keeps the count) */
export function creditRevive(L: Level3D, by: string, who: string) {
  const p = PLUGINS.get(L);
  if (!p) return;
  if (net.isHost) p.revived(by, who);
  else net.send('host', SCORE_EVENTS.revive, { by, who, done: true });
}

/** the running chapter's table for other modules (e.g. the den / lobby) */
export function scoreTable(L: Level3D): { id: string; stats: PStats; pts: number }[] {
  const p = PLUGINS.get(L);
  if (!p) return [];
  return [...p.s.rows].map(([id, stats]) => ({ id, stats: { ...stats }, pts: scorePoints(stats) }));
}

// registered once the module graph has loaded (safe even if a module level.ts depends on imports SCORE_EVENTS)
const register = () => LEVEL_PLUGINS.push((L) => (L.nl && L.def.id !== PVP_ID ? new ScorePlugin(L) : null));
try { register(); } catch { queueMicrotask(register); }
