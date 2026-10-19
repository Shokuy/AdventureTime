import * as THREE from 'three';
import { LEVEL_PLUGINS } from './level';
import type { Level3D, LevelPlugin, HeroLike } from './level';
import { net } from '../../net/session';
import { MSG } from '../../net/protocol';
import { input } from '../../engine/input';
import { audio } from '../../engine/audio';
import { save } from '../../engine/save';
import { W, H, clamp } from '../../engine/util';
import { rrect, text, OUT } from '../../art/draw';
import { drawHint, glyphWidth, glyphLabel } from '../../ui/glyphs';
import { toUI } from '../runtime';
import { Noodle3 } from './objects';
import { BLEED_T } from './player';
import { coop } from './coop';
import type { RemoteHero3 } from './remoteHero';
import { stashesOf } from './plates';

/**
 * Co-op hero mechanics (a LEVEL_PLUGINS plugin, co-op levels only; docs/MULTIPLAYER.md features 11, 12, 14, 16, 17, 20):
 *  • downed → revive: 0 hp knocks me down (Player3); a friend holds interact next to me for REVIVE_T s — his machine drives
 *    the progress ring and sends `revive`, mine applies it. Bleeding out = a death (crumbs lost) and a respawn at the
 *    latest candle. Everyone down at once → the host restarts the team from the candle (L.teamWipe);
 *  • boost jump: Player3 jumps off a friend's head; here everyone hears about it (the friend gets squashed);
 *  • gifts: hold interact next to a friend (nobody downed nearby) → a honey jar, or 10 crumbs;
 *  • rescue: my swing next to a grabbed friend asks the host to free him (noodles: his own machine cuts its noodle);
 *  • respawn polish, emote / downed visuals for friends (RemoteHero3), the co-op stash hints (plates.ts);
 *  • library falls: everyone hears about a crash to the floor; in hardcore it knocks the faller out (Player3.fallKO:
 *    no bleed-out, `f: 1` on his 'down' messages) until a friend comes down to lift him; the ХАРДКОР badge.
 * Every network message is queued and handled inside the fixed tick.
 */

const REVIVE_R = 1.6;
const REVIVE_T = 1.6;
const GIFT_R = 1.9;
const GIFT_T = 0.8;
const RESCUE_R = 2.2;
/** dead (bled out / the chase) → back at the candle after this long */
const RESPAWN_T = 2.2;
/** host: everyone out this long → the team wipe banner, then the restart */
const WIPE_T = 1.0;
const WIPE_DELAY = 1.8;

const DOWN_C = '#ff8a8a';
const UP_C = '#9ff0a0';
const GIFT_C = '#ffd98a';

/** things a scoreboard / results card may want to count (every machine hears every event once) */
export type CoopEvent = 'down' | 'revive' | 'bleedout' | 'wipe' | 'gift' | 'rescue' | 'boost';
type CoopListener = (ev: CoopEvent, who: string, by?: string) => void;
const listeners = new Set<CoopListener>();
/** subscribe to co-op events: who = the hero it happened to, by = the helper (reviver, giver, rescuer, booster) */
export function onCoopEvent(cb: CoopListener): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
function emit(ev: CoopEvent, who: string, by?: string) {
  for (const cb of [...listeners]) { try { cb(ev, who, by); } catch { /* a listener never breaks the game */ } }
}

type Inbox = { type: string; d: Record<string, unknown>; from: string };
const r2 = (x: number) => Math.round(x * 100) / 100;
const tmp = new THREE.Vector3();

class CoopMechanics implements LevelPlugin {
  private q: Inbox[] = [];
  private unsubs: (() => void)[] = [];
  private t = 0;
  private wasDowned = false;
  private wasDead = false;
  private bleedSendT = 0;
  // holding interact on a friend (revive / gift)
  private holdT = 0;
  private holdKind: 'revive' | 'gift' | null = null;
  private holdWho: string | null = null;
  private holdSendT = 0;
  /** after a finished gift / revive, or a hit: let go of interact before the next one */
  private needRelease = false;
  private lastHp = 0;
  /** what interact would do right now (for the prompts) */
  private target: RemoteHero3 | null = null;
  private targetKind: 'revive' | 'gift' | null = null;
  private nearT = 0;
  private lastAtkId = -1;
  // host: team wipe
  private wipeT = 0;
  private wiping = -1;
  /** library falls: my crash count seen so far; friends knocked out by a fall (hardcore, no bleed-out) */
  private crashes = 0;
  private ko = new Set<string>();

  constructor(private L: Level3D) {
    for (const ty of [MSG.down, MSG.revive, MSG.boost, MSG.gift, MSG.rescue]) {
      this.unsubs.push(net.on(ty, (d, from) => { if (d && typeof d === 'object') this.q.push({ type: ty, d: d as Record<string, unknown>, from }); }));
    }
    this.lastHp = L.player.hp;
    this.crashes = L.player.crashes;
  }

  dispose() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.L.player.busyAt = null;
  }

  wantsInput() { return false; }

  private nameOf(id: unknown): string {
    if (id === net.myId) return 'Ты';
    return (typeof id === 'string' && this.L.remote(id)?.name) || 'Друг';
  }

  update(dt: number) {
    const L = this.L, p = L.player;
    this.t += dt;
    for (const m of this.q.splice(0)) { try { this.handle(m); } catch (e) { console.warn('[coop]', m.type, e); } }

    // ── my hero went down / bled out / came back ──
    // a crash to the library floor: friends hear about it (hardcore: the 'down' below says it all)
    if (p.crashes !== this.crashes) {
      this.crashes = p.crashes;
      if (!p.fallKO) net.send('all', MSG.down, { k: 'fall' });
    }
    if (p.downed && !this.wasDowned) {
      net.send('all', MSG.down, { d: 1, b: r2(p.bleedT), ...(p.fallKO ? { f: 1 } : {}) });
      L.feed(p.fallKO ? 'Нокаут! Лежи — друзья должны спуститься за тобой' : `Тебя сбили! Друзья поднимут (${glyphLabel('interact')})`, DOWN_C);
      input.rumble(0.4, 0.9, 380);
      emit('down', net.myId);
      this.bleedSendT = 1;
    }
    if (p.downed) {
      this.bleedSendT -= dt;
      if (this.bleedSendT <= 0) { this.bleedSendT = 1; net.send('all', MSG.down, { d: 1, b: r2(p.bleedT), s: 1, ...(p.fallKO ? { f: 1 } : {}) }, false); }
    }
    if (!p.downed && this.wasDowned && p.dead) {
      net.send('all', MSG.down, { d: 0, out: 1 });
      L.feed('Никто не успел… вернёшься у свечки', DOWN_C);
      emit('bleedout', net.myId);
    }
    if (this.wasDead && !p.dead) this.backAtCandle();
    this.wasDowned = p.downed;
    this.wasDead = p.dead;
    // dead (bled out, or the chase) → back at the latest candle
    if (p.dead && L.deathT > RESPAWN_T && this.wiping < 0 && !L.complete) L.respawnLocal();

    this.updateHold(dt);
    this.updateRescue();
    // boost jump: tell everyone, squash the friend on my screen right away
    if (p.boostOff) {
      const r = p.boostOff;
      p.boostOff = null;
      r.kick(0.5);
      net.send('all', MSG.boost, { on: r.id });
      emit('boost', r.id, net.myId);
    }
    this.updateWipe(dt);
  }

  // ───────────────── revive / gift (hold interact) ─────────────────
  private updateHold(dt: number) {
    const L = this.L, p = L.player, nl = L.nl!;
    // (not in the PvP crumb grab: nobody goes down there, and gifts would mess with the score)
    const can = !p.dead && !p.downed && !p.grabbedBy && !p.hidden && p.control && !L.paused && !L.results && !L.complete && L.def.id !== 'pvp';
    let target: RemoteHero3 | null = null, kind: 'revive' | 'gift' | null = null;
    if (can) {
      // a downed friend within reach comes first, then any friend for a gift
      let bd = REVIVE_R;
      for (const r of nl.remotes.values()) {
        if (!r.downed || r.dead || r.hidden || Math.abs(r.pos.y - p.pos.y) > 1.3) continue;
        const d = Math.hypot(r.pos.x - p.pos.x, r.pos.z - p.pos.z);
        if (d < bd) { bd = d; target = r; kind = 'revive'; }
      }
      if (!target) {
        bd = GIFT_R;
        for (const r of nl.remotes.values()) {
          if (r.downed || r.dead || r.hidden || r.stale || Math.abs(r.pos.y - p.pos.y) > 1.3) continue;
          const d = Math.hypot(r.pos.x - p.pos.x, r.pos.z - p.pos.z);
          if (d < bd) { bd = d; target = r; kind = 'gift'; }
        }
        // never gift while a downed friend lies close by (that press is meant for him)
        if (target) for (const r of nl.remotes.values()) if (r.downed && r.pos.distanceTo(p.pos) < REVIVE_R + 1.2) { target = null; kind = null; }
      }
    }
    // the gift prompt waits until I stand by a friend for a moment (not while running past in a fight)
    const still = Math.hypot(p.vel.x, p.vel.z) < 1;
    this.nearT = target && target === this.target && (still || kind === 'revive') ? this.nearT + dt : 0;
    this.target = target; this.targetKind = kind;
    const down = input.down('interact');
    if (!down) this.needRelease = false;
    if (p.hp < this.lastHp) { this.needRelease = true; } // a hit breaks the hold
    this.lastHp = p.hp;
    if (!(can && down && target && kind && !this.needRelease)) { this.stopHold(); return; }
    if (target.id !== this.holdWho || kind !== this.holdKind) { this.holdT = 0; this.holdSendT = 0; }
    this.holdWho = target.id; this.holdKind = kind;
    // (a revive goes faster for heroes made for it: Пастила ×2 — HeroKit.reviveMul)
    this.holdT += dt * (kind === 'revive' ? p.kit.reviveMul ?? 1 : 1);
    p.busyAt = target.pos;
    if (kind === 'revive') {
      const pr = clamp(this.holdT / REVIVE_T, 0, 1);
      target.reviveP = pr; target.reviveBy = net.myId; target.reviveSeen = 0.45;
      this.holdSendT -= dt;
      if (pr >= 1) {
        // to everyone: the owner applies it, the host's scoreboard credits me (score.ts reads { who, by, done: true })
        net.send('all', MSG.revive, { to: target.id, who: target.id, by: net.myId, done: true });
        audio.sfx('heal', { pitch: 1.2, volume: 0.6 });
        L.fx.stars(target.center(), 14, [UP_C, '#ffffff']);
        this.needRelease = true;
        this.stopHold();
      } else if (this.holdSendT <= 0) {
        this.holdSendT = 0.25;
        net.send('all', MSG.revive, { to: target.id, p: r2(pr) });
      }
    } else if (this.holdT >= GIFT_T) {
      this.give(target);
      this.needRelease = true;
      this.stopHold();
    }
  }

  private stopHold() {
    this.holdT = 0; this.holdKind = null; this.holdWho = null;
    this.L.player.busyAt = null;
  }

  /** a honey jar if I have one, else 10 crumbs */
  private give(r: RemoteHero3) {
    const L = this.L, p = L.player;
    let k: 'honey' | 'crumbs';
    if (save.data.potions > 0) { save.data.potions--; k = 'honey'; }
    else if (save.data.crumbs >= 10) { save.data.crumbs -= 10; k = 'crumbs'; }
    else {
      audio.sfx('denied', { volume: 0.5 });
      L.fx.text(p.center().setY(p.pos.y + 1.6), 'Нечего подарить…', '#ff9a9a', 18);
      return;
    }
    save.write();
    net.send('all', MSG.gift, { to: r.id, k, n: k === 'crumbs' ? 10 : 1 });
    L.bark(p.root, 'Держи!', 1.6, 1.55);
    audio.sfx('throw', { pitch: 1.3, volume: 0.6 }); audio.sfx('coin', { pitch: 1.2 });
    tmp.copy(p.center()).lerp(r.center(), 0.5).setY(Math.max(p.pos.y, r.pos.y) + 1.3);
    L.fx.stars(tmp.clone(), 12, k === 'honey' ? ['#ffb020', '#ffe080', '#ffffff'] : ['#f0b850', '#ffe0a0']);
    L.feed(`Ты подарил ${r.name} ${k === 'honey' ? 'мёд' : '10 крошек'}`, GIFT_C);
    emit('gift', r.id, net.myId);
  }

  // ───────────────── rescue ─────────────────
  /** my new swing next to a grabbed friend: ask the host to free him */
  private updateRescue() {
    const L = this.L, p = L.player;
    if (!p.atk || p.atk === 'sling' || p.atkId === this.lastAtkId) return;
    this.lastAtkId = p.atkId;
    if (p.dead || p.downed || p.grabbedBy) return;
    const c = p.center();
    for (const r of L.nl!.remotes.values()) {
      if (!r.grabbed || r.dead || r.downed) continue;
      if (r.center(tmp).distanceTo(c) < RESCUE_R) { net.send('host', MSG.rescue, { who: r.id }); break; }
    }
  }

  /** my hero is let go: a noodle is cut on my own machine, anything else is released through its own grabber */
  private freeMe() {
    const L = this.L, p = L.player;
    const g = p.grabbedBy;
    if (!g) return false;
    if (g instanceof Noodle3) g.cut(L);
    if (p.grabbedBy === g) { p.grabbedBy = null; g.release(); p.body.vel.y = 8; p.invuln = Math.max(p.invuln, 0.8); }
    L.fx.text(p.center().setY(p.pos.y + 1.5), 'Спасён!', '#7ae8ff', 24);
    L.fx.stars(p.center(), 14, ['#7ae8ff', '#ffffff', '#ffe14a']);
    audio.sfx('break');
    return true;
  }

  // ───────────────── team wipe (host) ─────────────────
  private updateWipe(dt: number) {
    const L = this.L, nl = L.nl!;
    if (this.wiping >= 0) {
      this.wiping -= dt;
      if (this.wiping < 0) { this.wiping = 99; L.teamWipe(); }
      return;
    }
    if (!net.isHost || L.complete || L.results || nl.waiting) { this.wipeT = 0; return; }
    const hs: HeroLike[] = L.heroes();
    const out = hs.length > 1 && hs.every((h) => h.dead || h.downed) && hs.some((h) => h.downed);
    this.wipeT = out ? this.wipeT + dt : 0;
    if (this.wipeT > WIPE_T) {
      this.wiping = WIPE_DELAY;
      net.send('all', MSG.down, { k: 'wipe' });
      this.showWipe();
      emit('wipe', net.myId);
    }
  }

  private showWipe() {
    const L = this.L;
    L.hud.showBanner('ВСЕ ПОВЕРЖЕНЫ!', '#ff5a6a');
    L.feed('Вся команда лежит — начинаем у свечки', DOWN_C);
    audio.sfx('fall', { pitch: 0.8 });
    L.tcam.shake(0.4);
  }

  /** respawn polish: I'm back at the candle */
  private backAtCandle() {
    const L = this.L, p = L.player;
    L.fx.ring(p.pos.clone().setY(p.pos.y + 0.05), 1.8, '#ffe9a0', 0.5);
    L.fx.stars(p.center(), 20, ['#fff6c0', '#ffe14a', '#ffffff']);
    L.fx.text(p.center().setY(p.pos.y + 1.6), 'Снова в деле!', '#ffe680', 22);
    audio.sfx('checkpoint', { volume: 0.6 });
    net.send('all', MSG.down, { k: 'back' });
  }

  // ───────────────── messages ─────────────────
  private handle(m: Inbox) {
    const L = this.L, p = L.player, d = m.d;
    const me = net.myId;
    switch (m.type) {
      case MSG.down: {
        if (d.k === 'wipe') { if (m.from !== me && this.wiping < 0) { this.showWipe(); this.wiping = 99; emit('wipe', m.from); } break; }
        const r = L.remote(m.from);
        if (!r) break;
        if (d.k === 'back') { L.feed(`${r.name} снова у свечки`, '#ffe680'); break; }
        if (d.k === 'fall') { L.feed(`${r.name} сорвался и полетел вниз!`, '#ffc890'); break; }
        if (d.d === 1) {
          const fresh = r.bleed <= 0 && !d.s;
          r.bleed = clamp(Number(d.b) || BLEED_T, 0, BLEED_T);
          if (d.f) this.ko.add(r.id); else this.ko.delete(r.id);
          if (fresh) {
            L.feed(d.f ? `${r.name} рухнул вниз — спустись и подними его!` : `${r.name} сбит — подними его (держи ${glyphLabel('interact')})!`, DOWN_C);
            emit('down', r.id);
          }
        } else if (d.d === 0) {
          r.bleed = 0; r.reviveP = 0;
          this.ko.delete(r.id);
          if (typeof d.by === 'string') {
            L.feed(d.by === me ? `Ты поднял ${r.name}!` : `${this.nameOf(d.by)} поднял ${r.name}!`, UP_C);
            emit('revive', r.id, d.by);
          } else if (d.out) { L.feed(`${r.name} не дождался помощи`, DOWN_C); emit('bleedout', r.id); }
        }
        break;
      }
      case MSG.revive: {
        const to = d.to;
        if (to === me) {
          if (d.done) {
            if (p.revive(L)) {
              net.send('all', MSG.down, { d: 0, by: m.from });
              L.feed(`${this.nameOf(m.from)} поднял тебя!`, UP_C);
              input.rumble(0.5, 0.2, 200);
              emit('revive', me, m.from);
            }
          } else p.reviving(Number(d.p) || 0, m.from);
        } else if (typeof to === 'string' && !d.done && m.from !== me) {
          const r = L.remote(to);
          if (r) { r.reviveP = clamp(Number(d.p) || 0, 0, 1); r.reviveBy = m.from; r.reviveSeen = 0.45; }
        }
        break;
      }
      case MSG.boost: {
        const on = d.on;
        if (on === me) {
          p.squash = 0.5;
          audio.sfx('bounce', { pitch: 0.75, volume: 0.6 });
          L.fx.text(p.center().setY(p.pos.y + 1.5), 'Уф!', '#fff3d8', 20);
        } else if (typeof on === 'string') L.remote(on)?.kick(0.5);
        const j = L.remote(m.from);
        if (j) L.fx.stars(j.pos.clone(), 10, ['#ffe14a', '#ffffff']);
        if (typeof on === 'string') emit('boost', on, m.from);
        break;
      }
      case MSG.gift: {
        const giver = L.remote(m.from);
        if (giver) giver.bubble = { text: 'Держи!', t: 0 };
        const k = d.k === 'honey' ? 'honey' : 'crumbs';
        if (d.to === me) {
          if (k === 'honey' && save.data.potions < 3) { save.data.potions++; audio.sfx('heal'); L.fx.text(p.center().setY(p.pos.y + 1.6), '+мёд', '#ffd060', 22); }
          else {
            // a full honey shelf turns the jar into crumbs
            const n = k === 'honey' ? 10 : clamp(Math.round(Number(d.n) || 10), 1, 10);
            save.data.crumbs += n;
            audio.sfx('coin', { pitch: 0.9 });
            L.fx.text(p.center().setY(p.pos.y + 1.6), `+${n} крошек`, '#ffe0a0', 22);
          }
          save.write();
          L.fx.stars(p.center(), 12, ['#ffe080', '#ffffff']);
          L.feed(`${this.nameOf(m.from)} подарил тебе ${k === 'honey' ? 'мёд' : 'крошки'}!`, GIFT_C);
        } else if (typeof d.to === 'string') {
          L.feed(`${this.nameOf(m.from)} → ${this.nameOf(d.to)}: ${k === 'honey' ? 'мёд' : 'крошки'}`, GIFT_C);
        }
        if (typeof d.to === 'string') emit('gift', d.to, m.from);
        break;
      }
      case MSG.rescue: {
        if (d.free) { this.freeMe(); break; }
        if (d.done) {
          if (m.from === me) break;
          this.rescued(String(d.who ?? ''), String(d.by ?? ''));
          break;
        }
        if (net.isHost && typeof d.who === 'string') this.hostRescue(d.who, m.from);
        break;
      }
    }
  }

  /** host: `by` swung next to grabbed `who` — free him */
  private hostRescue(who: string, by: string) {
    const L = this.L, nl = L.nl!, me = net.myId;
    if (who === by) return;
    const victim: HeroLike | undefined = who === me ? L.player : L.remote(who);
    const hero: HeroLike | undefined = by === me ? L.player : L.remote(by);
    const held = who === me ? !!L.player.grabbedBy : !!L.remote(who)?.grabbed;
    if (!victim || !hero || !held || hero.pos.distanceTo(victim.pos) > RESCUE_R + 1.8) return;
    // the swing's own hit already freed him (the monster / the King's fist resolve it first): one rescue, one feed line
    const done = (L.refs.rescuedAt ??= {}) as Record<string, number>;
    if (L.t - (done[who] ?? -99) < 1.5) return;
    done[who] = L.t;
    // host-side grabbers (the spaghetti monster, the King's fist) let go right away
    for (const e of nl.ents.values()) {
      const g = e as { netReleased?(L: Level3D, who: string, why: string): void };
      if (typeof g.netReleased === 'function') { try { g.netReleased(L, who, 'rescue'); } catch { /* */ } }
    }
    if (who === me) this.freeMe();
    else net.send(who, MSG.rescue, { free: 1, by });
    net.send('all', MSG.rescue, { done: 1, who, by });
    this.rescued(who, by);
  }

  /** everyone: `by` freed `who` (the victim's own machine frees him through 'free' / the grabber's own release) */
  private rescued(who: string, by: string) {
    const L = this.L, me = net.myId;
    if (who === me) L.feed(`${this.nameOf(by)} спас тебя!`, '#9fe8ff');
    else {
      const r = L.remote(who);
      if (r) { L.fx.stars(r.center(), 12, ['#7ae8ff', '#ffffff']); L.fx.text(r.center().setY(r.pos.y + 1.5), 'Спасён!', '#7ae8ff', 22); }
      L.feed(`${this.nameOf(by)} спас ${this.nameOf(who)}!`, '#9fe8ff');
    }
    emit('rescue', who, by);
  }

  // ───────────────── drawing ─────────────────
  draw(ctx: CanvasRenderingContext2D) {
    const L = this.L, p = L.player, nl = L.nl!;
    for (const s of stashesOf(L)) s.drawHints(L, ctx);
    if (L.results) return;
    if (coop.hard && L.def.id !== 'pvp') this.drawHardBadge(ctx);
    const cam = L.tcam.cam;
    // rings over downed friends: bleed-out (red) and revive progress (green), and the prompt when I'm close
    for (const r of nl.remotes.values()) {
      if (!r.downed || r.hidden) continue;
      const s = toUI(this.overBody(r), cam);
      if (!s.vis || s.x < -40 || s.x > W + 40 || s.y < -40 || s.y > H + 40) continue;
      const d = r.pos.distanceTo(p.pos);
      const sc = clamp(1.3 - d / 30, 0.6, 1.1);
      // (knocked out by a fall in hardcore: no bleed timer — just the plus, waiting for a friend)
      this.ring(ctx, s.x, s.y, 22 * sc, this.ko.has(r.id) ? -1 : r.bleed > 0 ? r.bleed / BLEED_T : 1, r.reviveP);
      if (this.target === r && this.targetKind === 'revive') this.prompt(ctx, s.x, s.y + 40 * sc, r.reviveP > 0 ? 'Поднимаю…' : 'Держи — поднять');
    }
    // gift prompt (only after standing by a friend for a moment) and its progress
    if (this.target && this.targetKind === 'gift' && (this.nearT > 0.5 || this.holdKind === 'gift')) {
      const r = this.target;
      const s = toUI(tmp.copy(r.pos).setY(r.pos.y + 0.35), cam);
      if (s.vis) {
        const label = save.data.potions > 0 ? 'Подарить мёд' : 'Подарить 10 крошек';
        if (this.holdKind === 'gift') this.ring(ctx, s.x, s.y - 30, 16, -1, clamp(this.holdT / GIFT_T, 0, 1), '#ffd34a');
        else this.prompt(ctx, s.x, s.y, label, 0.85);
      }
    }
    if (p.downed) this.drawDowned(ctx);
  }

  /** hardcore: a small red badge in the top-right corner (hidden with the rest of the HUD in cutscenes) */
  private drawHardBadge(ctx: CanvasRenderingContext2D) {
    const a = clamp(1 - this.L.letterbox * 1.5, 0, 1);
    if (a <= 0.01) return;
    const label = '☠ ХАРДКОР';
    ctx.save();
    ctx.globalAlpha = a * 0.92;
    ctx.font = '900 16px Rubik, "Arial Black", sans-serif';
    const w = ctx.measureText(label).width + 28;
    rrect(ctx, W - 20 - w, 18, w, 32, 14, 'rgba(120,14,30,0.82)', 3);
    text(ctx, label, W - 20 - w / 2, 40, { size: 16, color: '#ffe0e0', align: 'center' });
    ctx.restore();
  }

  /** a point just over a hero lying on his belly (his body is ahead of his feet) */
  private overBody(h: HeroLike) {
    return h.forward(tmp).multiplyScalar(0.35).add(h.pos).setY(h.pos.y + 0.8);
  }

  /** a round timer: a red bleed arc (k = share left; −1 none) and a progress arc on top */
  private ring(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, k: number, prog: number, progColor = UP_C) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(30,12,20,0.72)'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
    const a0 = -Math.PI / 2;
    if (k >= 0) {
      ctx.beginPath(); ctx.arc(x, y, R - 6, a0, a0 + Math.PI * 2 * clamp(k, 0, 1));
      ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.strokeStyle = k < 0.3 && Math.floor(this.t * 6) % 2 === 0 ? '#ffffff' : '#ff4a5a'; ctx.stroke();
    }
    if (prog > 0) {
      ctx.beginPath(); ctx.arc(x, y, R - 6, a0, a0 + Math.PI * 2 * clamp(prog, 0, 1));
      ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.strokeStyle = progColor; ctx.stroke();
    }
    // a little plus in the middle
    ctx.fillStyle = prog > 0 ? progColor : '#fff3d8';
    const s = R * 0.34, w = R * 0.13;
    ctx.fillRect(x - s, y - w, s * 2, w * 2); ctx.fillRect(x - w, y - s, w * 2, s * 2);
    ctx.restore();
  }

  /** "[R] Держи — поднять", centred at x */
  private prompt(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, alpha = 1) {
    const size = 24;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `400 ${size * 0.72}px Pangolin, "Comic Sans MS", sans-serif`;
    const w = glyphWidth(ctx, 'interact', size) + size * 0.3 + ctx.measureText(label).width;
    rrect(ctx, x - w / 2 - 10, y - size / 2 - 5, w + 20, size + 10, 12, 'rgba(30,12,20,0.6)', 0);
    drawHint(ctx, 'interact', label, x - w / 2, y, { size });
    ctx.restore();
  }

  /** my own knocked-down screen: pulsing red edges, the bleed timer, what to do */
  private drawDowned(ctx: CanvasRenderingContext2D) {
    const L = this.L, p = L.player;
    const k = clamp(p.bleedT / BLEED_T, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.25 + (1 - k) * 0.3 + Math.sin(this.t * (4 + (1 - k) * 6)) * 0.08;
    ctx.strokeStyle = '#d0102a'; ctx.lineWidth = 70; ctx.strokeRect(-2000, -2000, W + 4000, H + 4000);
    ctx.lineWidth = 46; ctx.strokeRect(0, 0, W, H);
    ctx.restore();
    // over my hero
    const s = toUI(this.overBody(p), L.tcam.cam);
    if (s.vis) this.ring(ctx, s.x, s.y, 22, p.fallKO ? -1 : k, p.reviveP);
    // the panel
    const y = H - 150;
    const pw = p.fallKO ? 620 : 500;
    rrect(ctx, W / 2 - pw / 2, y - 36, pw, 92, 18, 'rgba(30,10,18,0.78)', 4);
    text(ctx, p.reviveP > 0 ? 'ТЕБЯ ПОДНИМАЮТ!' : p.fallKO ? 'НОКАУТ!' : 'ТЕБЯ СБИЛИ!', W / 2, y, { size: 30, color: p.reviveP > 0 ? UP_C : '#ff6a7a', align: 'center', stroke: 6 });
    const line = p.reviveP > 0 ? `${this.nameOf(p.reviveBy)} уже рядом… ${Math.round(p.reviveP * 100)}%`
      : p.fallKO ? `Хардкор: друзья должны спуститься и подержать ${glyphLabel('interact')} рядом с тобой`
        : `Ползи к друзьям — пусть подержат ${glyphLabel('interact')} рядом с тобой · ${Math.ceil(p.bleedT)} с`;
    text(ctx, line, W / 2, y + 34, { size: 19, font: 'body', color: '#fff3d8', align: 'center' });
  }
}

LEVEL_PLUGINS.push((L) => (L.nl ? new CoopMechanics(L) : null));
