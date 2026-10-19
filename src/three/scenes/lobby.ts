import { startPvp } from '../game/pvp';
import * as THREE from 'three';
import { W, H, clamp, damp, ease, rand } from '../../engine/util';
import { input } from '../../engine/input';
import { audio } from '../../engine/audio';
import { save } from '../../engine/save';
import { text, rrect, wrap, OUT } from '../../art/draw';
import { MenuList, type MenuItem } from '../../ui/widgets';
import { TextInput } from '../../ui/textInput';
import { drawGlyph, drawHint, glyphDevice } from '../../ui/glyphs';
import { ChatPanel, QUICK_PHRASES, QP_ACTIONS } from '../../ui/chat';
import { voiceUI, drawMicBadge, drawSpeaker } from '../../ui/voiceHud';
import { net, type Member } from '../../net/session';
import { profile, TAG_COLORS, type HeroLook, type HeroKind } from '../../net/profile';
import { MAX_PLAYERS } from '../../net/config';
import { MSG } from '../../net/protocol';
import { game, STORY } from '../../game/game';
import { RT, toUI } from '../runtime';
import { mat, basic, mesh, noOutline } from '../gfx';
import { FX3 } from '../fx';
import { type HeroAnim, type HeroRig } from '../models/hero';
import { createHeroModel, heroName } from '../models/heroes';
import { openHeroPicker } from '../game/heroes';
import { room } from '../world/rooms';
import * as P from '../world/props';
import { Customize3D } from './customize';
import { coop, DIFFICULTIES, DIFF_NAME, DIFF_COLOR, type Difficulty } from '../game/coop';
import { coopFlow, MAP_CH } from '../game/coopFlow';
import { EPISODES, prologueDone } from '../game/episodes';
import { SettingsPanel, type SettingsTab } from '../../ui/settings';

/*
 * «Играть с друзьями»: the co-op lobby. A cosy den where every member's Tosha stands on the rug with a card
 * (name, host crown, ready, ping, link, voice). Start screen: create / join by code / quick match / my Tosha.
 * Room screen: ready toggle, host picks the chapter + difficulty and starts, chat, voice, per-player volume / kick.
 */

type C = CanvasRenderingContext2D;
type Mode = 'start' | 'code' | 'room' | 'voice' | 'players' | 'member';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const COL_X = 1124; // right column centre
const COL_W = 276;

interface Slot {
  id: string;
  rig: HeroRig;
  g: THREE.Group;
  x: number; tx: number;
  pop: number; gone: boolean;
  cheer: number; wasReady: boolean;
  t: number; lookKey: string; kind: HeroKind;
  anim: HeroAnim;
  bubble: { text: string; t: number; big?: boolean } | null;
}

/** what a slot shows: a room member, or me alone on the start screen */
interface Who { id: string; name: string; look: HeroLook; ready: boolean; host: boolean; me: boolean; m?: Member; kind: HeroKind; heroLook: HeroLook }

export class LobbyScene {
  is3d = true;
  /** coopFlow: this scene is the lobby (a 'lobby' scene message doesn't reload it) */
  coopLobby = true;
  t = 0;
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 200);
  fx = new FX3();
  mode: Mode = 'start';
  startMenu: MenuList;
  roomMenu: MenuList | null = null;
  sub: MenuList | null = null;
  /** «Настройки» (start screen, room menu, F1) */
  panel: SettingsPanel | null = null;
  chat = new ChatPanel({ x: 16, y: 150, w: 280, h: 554, onLine: (from, txt) => this.say(from, txt) });
  private slots = new Map<string, Slot>();
  private codeBox: TextInput | null = null;
  private busy = '';
  private err: { text: string; t: number } | null = null;
  private toastMsg: { text: string; t: number } | null = null;
  private pubRooms = -1;
  private makePublic = false;
  private offs: (() => void)[] = [];
  private unwatch: (() => void) | null = null;
  private live = false;
  private wasHost: boolean | null = null;
  private memberKey = '';
  private pSel = 0;
  private memberId = '';
  private confirm: { what: string; t: number } | null = null;
  private copiedT = 0;
  private lastQP = 0;
  private camPos = V(-1.55, 1.3, 4.9);
  private camAt = V(-1.55, 0.78, 0);
  private flame: THREE.Group;
  private fire: THREE.PointLight;
  private keepScene = false;
  /** meshes this scene made itself (freed on leave; room / props come from shared caches) */
  private own: THREE.Mesh[] = [];
  private names = new Map<string, string>();
  private cfgT = 1;

  constructor(opts: { join?: string } = {}) {
    this.flame = new THREE.Group();
    this.fire = new THREE.PointLight('#ff9a3a', 30, 30, 1.4);
    this.build();
    this.startMenu = this.buildStart();
    net.setMeta({ scene: 'lobby', ready: false });
    audio.playMusic('den');
    if (opts.join) queueMicrotask(() => this.connect('join', opts.join));
    if (net.active) this.enterRoom();
  }

  // ───────────────────────── 3D set ─────────────────────────
  private build() {
    const sc = this.scene;
    sc.background = new THREE.Color('#1a0e08');
    sc.fog = new THREE.Fog('#2a160c', 24, 70);
    sc.add(new THREE.HemisphereLight('#ffd8a8', '#3a2010', 0.95));
    const sun = new THREE.DirectionalLight('#ffc890', 1.25);
    sun.position.set(-0.4, 1, 0.7).multiplyScalar(30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const c = sun.shadow.camera; c.left = -14; c.right = 14; c.top = 14; c.bottom = -14; c.far = 90;
    sun.shadow.bias = -0.0006;
    sc.add(sun, sun.target);
    sc.add(room({ theme: 'den', x0: -13, x1: 13, z0: -8, z1: 14, floorY: 0, wallH: 12 }).obj);
    sc.add(P.rug({ x: 0, y: 0, z: 0.2, w: 9.5, d: 3.6, color: '#a8343a' }).obj);
    // fireplace behind the team
    const fp = new THREE.Group();
    const stone = mesh(new THREE.BoxGeometry(4.6, 4.2, 1.6), mat('#7a6a66')); stone.position.y = 2.1; fp.add(stone);
    const hole = mesh(new THREE.BoxGeometry(2.8, 2.4, 0.4), basic('#2a0e06')); hole.position.set(0, 1.3, 0.65); fp.add(hole);
    const glowB = mesh(new THREE.PlaneGeometry(2.6, 2.2), basic('#ff7a2a', { additive: true, opacity: 0.4 }), { cast: false, receive: false }); glowB.position.set(0, 1.25, 0.87); fp.add(glowB);
    const mantel = mesh(new THREE.BoxGeometry(5.4, 0.4, 2), mat('#5a3a2a')); mantel.position.set(0, 4.3, 0.1); fp.add(mantel);
    const logs: THREE.Mesh[] = [];
    for (const r of [0.5, -0.5]) {
      const lg = mesh(new THREE.CylinderGeometry(0.18, 0.2, 1.8, 8), mat('#5a3420')); lg.rotation.set(0, r, Math.PI / 2); lg.position.set(0, 0.32, 1.25); fp.add(lg); logs.push(lg);
    }
    this.own.push(stone, hole, glowB, mantel, ...logs);
    fp.position.set(0, 0, -7.2);
    sc.add(fp);
    // a few flickering flame tongues (each with its own phase)
    const tongues: [number, number, string, number, number][] = [[0.62, 1.7, '#ff5a1a', 0, 0], [0.42, 1.2, '#ff8a2a', -0.5, 0.1], [0.42, 1.25, '#ff8a2a', 0.5, -0.05], [0.4, 1.05, '#ffd04a', 0, 0.2], [0.2, 0.55, '#fff0a0', 0.05, 0.35]];
    for (const [r, h, col, x, z] of tongues) {
      const f = mesh(new THREE.ConeGeometry(r, h, 10), basic(col, { additive: true, opacity: 0.9 }), { cast: false, receive: false });
      f.position.set(x, h / 2 + 0.25, z); this.flame.add(f);
      this.own.push(f);
    }
    noOutline(this.flame);
    this.flame.position.set(0, 0.1, -6.0);
    sc.add(this.flame);
    this.fire.position.set(0, 2, -5.6);
    sc.add(this.fire);
    // shelves, honey, candles
    sc.add(P.shelfBoard({ x: -6.5, y: 4.2, z: -7.4, w: 5, d: 1.2, th: 0.3 }).obj);
    for (let i = 0; i < 3; i++) sc.add(P.jar({ x: -8 + i * 1.5, y: 4.5, z: -7.4, r: 0.5, h: 1.1, jam: 'honey' }).obj);
    sc.add(P.shelfBoard({ x: 6.5, y: 4.2, z: -7.4, w: 5, d: 1.2, th: 0.3 }).obj);
    for (let i = 0; i < 3; i++) sc.add(P.jar({ x: 5 + i * 1.5, y: 4.5, z: -7.4, r: 0.5, h: 1.1, jam: i === 1 ? 'red' : 'honey' }).obj);
    for (const x of [-2.2, 2.2]) sc.add(P.candle({ x, y: 4.8, z: -7.1, r: 0.18, h: 0.7, light: false }).obj);
    sc.add(P.barrel({ x: -9, y: 0, z: -4.5, r: 1, h: 2.2 }).obj);
    sc.add(P.crate({ x: 9, y: 0, z: -4, w: 2, h: 1.6, d: 2, rotY: 0.3 }).obj);
    sc.add(this.fx.group);
  }

  private disposeScene() {
    for (const s of this.slots.values()) { this.scene.remove(s.g); s.rig.dispose(); }
    this.slots.clear();
    for (const m of this.own) {
      m.geometry.dispose();
      if (m.material instanceof THREE.MeshBasicMaterial) m.material.dispose();
    }
    this.own = [];
    this.scene.traverse((o) => { if (o instanceof THREE.Light) o.dispose(); });
  }

  // ───────────────────────── menus ─────────────────────────
  private buildStart() {
    const items: MenuItem[] = [];
    const last = coopFlow.lastRoom();
    if (last) items.push({ label: `Вернуться в комнату ${last}`, action: () => this.connect('join', last) });
    items.push(
      { label: 'Создать комнату', action: () => this.connect('create') },
      { label: () => `Комната: ${this.makePublic ? 'открытая' : 'по коду'}`, left: () => { this.makePublic = !this.makePublic; }, right: () => { this.makePublic = !this.makePublic; }, action: () => { this.makePublic = !this.makePublic; } },
      { label: 'Войти по коду', action: () => this.openCode() },
      { label: 'Быстрая игра', action: () => this.connect('quick') },
      { label: () => `Герой: ${heroName(profile.kind)}`, action: () => openHeroPicker() },
      { label: 'Мой герой', action: () => this.customize() },
      { label: 'Настройки', action: () => this.openSettings() },
      { label: 'Назад', action: () => this.exit() },
    );
    return new MenuList(items, 250, 206, { w: 400, h: 44, gap: 8, size: 23 });
  }

  /** the settings panel; the host may change the room's difficulty on its «Сложность» page */
  private openSettings(tab?: SettingsTab) {
    this.panel = new SettingsPanel({
      tab, where: 'lobby',
      roomDiff: net.active && net.isHost ? (d) => this.cycleDiff(d) : undefined,
      onClose: () => { this.panel = null; },
    });
  }

  private startHelp(): string {
    const it = this.startMenu.items[this.startMenu.sel];
    const l = typeof it?.label === 'function' ? it.label() : it?.label ?? '';
    if (l.startsWith('Вернуться')) return 'Ты недавно был в этой комнате — можно зайти обратно.';
    if (l === 'Создать комнату') return this.makePublic ? 'Новая открытая комната — её найдут через быструю игру.' : 'Новая комната для друзей: скажи им её код.';
    if (l.startsWith('Комната:')) return this.makePublic ? 'Открытая — в неё могут попасть случайные игроки.' : 'По коду — войдут только те, кому ты скажешь код.';
    if (l === 'Войти по коду') return 'Друг уже создал комнату? Введи её код.';
    if (l === 'Быстрая игра') return 'Попасть в случайную открытую комнату (или открыть свою).';
    if (l === 'Мой герой') return 'Цвета, шапка, имя — так тебя увидят друзья.';
    if (l.startsWith('Герой:')) return 'Тоша, Бублик, Ноки или Пастила — за кого играть после пролога (в прологе все — Тоши).';
    if (l === 'Настройки') return 'Звук, голоса друзей, картинка, управление.';
    return 'Вернуться в главное меню.';
  }

  private buildRoom() {
    const host = net.isHost;
    const chapterLabel = () => (net.roomState === 'playing' && !net.isHost ? `Сейчас: ${roomNow()}` : startName(coop.cfg.chapter));
    const diffLabel = () => `Сложность: ${DIFF_NAME[coop.cfgDiff()]}`;
    const common: MenuItem[] = [
      { label: () => `Голос: ${voiceUI.status()}`, action: () => this.openVoice() },
      { label: () => (this.copiedT > 0 ? 'Код скопирован!' : 'Скопировать код'), action: () => this.copyCode() },
      { label: () => `Герой: ${heroName(profile.kind)}`, action: () => openHeroPicker() },
      { label: 'Мой герой', action: () => this.customize() },
      { label: 'Настройки', action: () => this.openSettings() },
      { label: 'Выйти из комнаты', action: () => this.leaveRoom() },
    ];
    const items: MenuItem[] = host ? [
      { label: () => this.startLabel(), action: () => this.tryStart() },
      { label: chapterLabel, left: () => this.cycleChapter(-1), right: () => this.cycleChapter(1) },
      { label: diffLabel, action: () => this.cycleDiff(1), left: () => this.cycleDiff(-1), right: () => this.cycleDiff(1) },
      { label: 'PvP: Крошечная лихорадка', action: () => { startPvp(); }, disabled: () => net.members.size < 2 },
      ...common,
    ] : [
      { label: () => (net.me?.ready ? '✓ Готов (отменить)' : 'Я готов!'), action: () => this.toggleReady(), disabled: () => net.roomState === 'playing' },
      { label: chapterLabel, disabled: () => true },
      { label: diffLabel, disabled: () => true },
      ...common,
    ];
    this.roomMenu = new MenuList(items, COL_X, 112, { w: COL_W, h: 46, gap: 8, size: 19 });
    this.wasHost = host;
  }

  private openVoice() {
    this.mode = 'voice';
    this.sub = new MenuList([
      {
        label: () => `Микрофон: ${net.voice.enabled ? 'включён' : 'выключен'}`,
        action: () => { void voiceUI.toggleMic().then((ok) => { if (!ok) this.showErr(voiceUI.error); }); },
      },
      {
        label: () => `Режим: ${net.voice.ptt ? 'по кнопке' : 'открытый'}`,
        action: () => net.voice.setPTT(!net.voice.ptt), left: () => net.voice.setPTT(!net.voice.ptt), right: () => net.voice.setPTT(!net.voice.ptt),
      },
      { label: () => `Заглушить себя: ${voiceUI.selfMute ? 'да' : 'нет'}`, action: () => voiceUI.setSelfMute(!voiceUI.selfMute), disabled: () => !net.voice.enabled },
      { label: 'Назад', action: () => this.backToRoom() },
    ], COL_X, 112, { w: COL_W, h: 46, gap: 8, size: 19 });
  }

  private openMember(id: string) {
    const m = net.members.get(id);
    if (!m) return;
    this.mode = 'member';
    this.memberId = id;
    const back = { label: 'Назад', action: () => { this.mode = 'players'; this.sub = null; } };
    const vol = (d: number) => net.voice.setVolume(id, Math.round((net.voice.getVolume(id) + d) * 10) / 10);
    const items: MenuItem[] = m.isMe ? [
      { label: () => `Герой: ${heroName(profile.kind)}`, action: () => openHeroPicker() },
      { label: 'Мой герой', action: () => this.customize() },
      back,
    ] : [
      { label: () => `Громкость: ${Math.round(net.voice.getVolume(id) * 100)}%`, left: () => vol(-0.1), right: () => vol(0.1) },
      { label: () => (net.voice.isMuted(id) ? 'Включить звук' : 'Заглушить'), action: () => net.voice.mute(id, !net.voice.isMuted(id)) },
      ...(net.isHost ? [{ label: 'Выгнать из комнаты', action: () => this.kick(id) }] : []),
      back,
    ];
    this.sub = new MenuList(items, COL_X, 112, { w: COL_W, h: 46, gap: 8, size: 19 });
  }

  private backToRoom() { this.mode = 'room'; this.sub = null; }

  // ───────────────────────── actions ─────────────────────────
  private async connect(kind: 'create' | 'join' | 'quick', code?: string) {
    if (this.busy || net.status === 'joining') return;
    this.err = null;
    this.busy = kind === 'create' ? 'Создаём комнату…' : kind === 'quick' ? 'Ищем, с кем поиграть…' : `Заходим в комнату ${code ?? ''}…`;
    try {
      if (kind === 'create') await net.create({ public: this.makePublic });
      else if (kind === 'quick') await net.quickMatch();
      else await net.join(code ?? '');
      audio.sfx('door');
      this.enterRoom();
    } catch (e) {
      // backing out of a join on purpose is not an error
      if ((e as { code?: string })?.code === 'cancelled') return;
      this.showErr((e as Error)?.message || 'Не получилось подключиться');
      audio.sfx('denied');
      if (kind === 'join' && code && code === coopFlow.lastRoom()) { coopFlow.forgetRoom(); this.startMenu = this.buildStart(); }
    } finally {
      this.busy = '';
    }
  }

  private openCode() {
    this.mode = 'code';
    this.codeBox = new TextInput({
      x: W / 2 - 170, y: 318, w: 340, h: 74, size: 46, maxLength: 5, uppercase: true, allow: /[A-Za-z0-9]/,
      placeholder: 'ABCDE', onBlur: 'keep',
      onSubmit: (v) => { this.codeBox = null; this.mode = 'start'; void this.connect('join', v); },
      onCancel: () => { this.codeBox = null; this.mode = 'start'; },
    });
  }

  private enterRoom() {
    if (!net.active) return;
    this.closeCode();
    this.mode = 'room';
    this.sub = null;
    this.buildRoom();
    this.pSel = 0;
    // the host's default start: the world map once its prologue is done, else where its own story stands
    if (net.isHost) {
      const cur = STORY[save.data.story];
      const list = chapterList();
      coop.cfg.chapter = prologueDone() ? MAP_CH : cur?.kind === 'level' && list.includes(save.data.story) ? save.data.story : list[list.length - 1] ?? 1;
      // the difficulty: my own solo setting in a new room; back in the same room (after the credits) it stays
      if (cfgRoom !== net.code) { cfgRoom = net.code; coop.setCfgDiff(save.data.settings.easy ? 'easy' : 'normal'); }
      this.sendCfg();
    }
    this.unwatchRooms();
  }

  private leaveRoom() {
    net.leave();
    coopFlow.forgetRoom();
    this.mode = 'start';
    this.sub = null;
    this.roomMenu = null;
    this.startMenu = this.buildStart();
    audio.sfx('door');
  }

  private exit() {
    this.closeCode();
    game.toMenu();
  }

  private customize() {
    const lobby = this;
    this.keepScene = true;
    game.go(() => new Customize3D(() => { lobby.keepScene = false; game.go(() => lobby); }));
  }

  private toggleReady() {
    const me = net.me;
    if (!me) return;
    net.setMeta({ ready: !me.ready });
    if (!me.ready) audio.sfx('checkpoint', { volume: 0.6 });
  }

  private cycleChapter(d: number) {
    const list = chapterList();
    let i = list.indexOf(coop.cfg.chapter);
    if (i < 0) i = 0;
    coop.cfg.chapter = list[(i + d + list.length) % list.length];
    this.sendCfg();
  }

  /** лёгкая → нормальная → хардкор (co-op only) */
  private cycleDiff(d: number) {
    const i = DIFFICULTIES.indexOf(coop.cfgDiff());
    coop.setCfgDiff(DIFFICULTIES[(i + d + DIFFICULTIES.length) % DIFFICULTIES.length]);
    this.sendCfg();
  }

  private sendCfg() { if (net.isHost) net.send('all', MSG.lobbyCfg, { ch: coop.cfg.chapter, easy: coop.cfg.easy, hard: coop.cfg.hard }); }

  /** others (not the host) that pressed ready / all others */
  private readyCount(): [number, number] {
    let r = 0, n = 0;
    for (const m of net.members.values()) { if (m.isHost) continue; n++; if (m.ready) r++; }
    return [r, n];
  }

  /** the label under the room menu's cursor */
  private selLabel() {
    const it = this.roomMenu?.items[this.roomMenu.sel];
    return typeof it?.label === 'function' ? it.label() : it?.label ?? '';
  }

  /** the host's cursor is on the difficulty option */
  private diffSelected() {
    const it = this.roomMenu?.items[this.roomMenu.sel];
    const l = typeof it?.label === 'function' ? it.label() : it?.label ?? '';
    return l.startsWith('Сложность');
  }

  private startLabel() {
    const [r, n] = this.readyCount();
    if (this.confirm?.what === 'start') return 'Точно начать?';
    if (!n || r === n) return 'Начать игру!';
    return `Начать (готовы ${r} из ${n})`;
  }

  private tryStart() {
    if (!net.isHost) return;
    const [r, n] = this.readyCount();
    if (n && r < n && this.confirm?.what !== 'start') {
      this.confirm = { what: 'start', t: 4 };
      this.toast('Не все готовы — нажми ещё раз, чтобы начать без них');
      return;
    }
    this.confirm = null;
    audio.sfx('victory', { volume: 0.6 });
    if (coop.cfg.chapter === MAP_CH) coopFlow.hostMap();
    else coopFlow.hostStart(coop.cfg.chapter);
  }

  private kick(id: string) {
    const m = net.members.get(id);
    if (!m || !net.isHost) return;
    if (this.confirm?.what !== 'kick:' + id) {
      this.confirm = { what: 'kick:' + id, t: 4 };
      this.toast(`Нажми ещё раз, чтобы выгнать ${m.name}`);
      return;
    }
    this.confirm = null;
    net.kick(id);
    this.toast(`${m.name} больше не в комнате`);
    this.mode = 'players';
    this.sub = null;
  }

  private copyCode() {
    const code = net.code;
    if (!code) return;
    const done = () => { this.copiedT = 2.2; audio.sfx('coin'); };
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* */ }
      ta.remove();
      document.getElementById('ui')?.focus();
      if (ok) done(); else this.toast(`Скопировать не вышло — продиктуй код: ${code}`);
    };
    try {
      if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(code).then(done, fallback); return; }
    } catch { /* */ }
    fallback();
  }

  private phrase(i: number) {
    if (!net.active || this.t - this.lastQP < 0.6) return;
    this.lastQP = this.t;
    net.send('all', MSG.phrase, { i });
    this.say(net.myId, QUICK_PHRASES[i], true);
    audio.sfx('textBlip', { pitch: 1.6 });
  }

  /** a speech bubble over someone's Tosha */
  private say(id: string, txt: string, big = false) {
    const s = this.slots.get(id);
    if (s) s.bubble = { text: txt, t: 0, big };
  }

  private toast(s: string) { this.toastMsg = { text: s, t: 0 }; }
  private showErr(s: string) { this.err = { text: s, t: 0 }; }

  private closeCode() { this.codeBox?.close(); this.codeBox = null; if (this.mode === 'code') this.mode = 'start'; }

  private unwatchRooms() { this.unwatch?.(); this.unwatch = null; }

  // ───────────────────────── lifecycle ─────────────────────────
  private attach() {
    this.live = true;
    this.chat.attach();
    this.offs.push(net.on(MSG.lobbyCfg, (d: { ch?: number; easy?: boolean; hard?: boolean }, from) => {
      if (from !== net.hostId || !d) return;
      if (typeof d.ch === 'number' && (d.ch === MAP_CH || STORY[d.ch]?.kind === 'level')) coop.cfg.chapter = d.ch;
      if (typeof d.easy === 'boolean') { coop.takeDiff(d); if (net.code) cfgRoom = net.code; }
    }));
    this.offs.push(net.on(MSG.phrase, (d: { i?: number }, from) => {
      const i = Number(d?.i);
      if (i >= 0 && i < QUICK_PHRASES.length) { this.say(from, QUICK_PHRASES[i], true); audio.sfx('textBlip', { pitch: 1.6, volume: 0.6 }); }
    }));
    this.offs.push(net.onMembers(() => this.onMembers()));
    if (net.active) net.setMeta({ scene: 'lobby' });
    this.onMembers();
  }

  private onMembers() {
    if (!net.active) return;
    for (const m of net.members.values()) this.names.set(m.id, m.name);
    const key = [...net.members.keys()].join(',');
    if (key !== this.memberKey) {
      const before = new Set(this.memberKey ? this.memberKey.split(',') : []);
      this.memberKey = key;
      for (const m of net.members.values()) {
        if (!before.has(m.id) && before.size && !m.isMe) { this.chat.sys(`${m.name} заходит в комнату`, m.look.tagColor); audio.sfx('door', { volume: 0.5 }); }
      }
      for (const id of before) if (!net.members.has(id)) this.chat.sys(`${this.names.get(id) ?? 'Кто-то'} выходит из комнаты`);
      // newcomers need the host's chapter / difficulty
      this.sendCfg();
    }
    this.uniqueColor();
  }

  /** two Toshas with the same nameplate colour are confusing: the later one takes a free colour (this room only) */
  private uniqueColor() {
    const me = net.me;
    if (!me) return;
    const taken = new Set<string>();
    for (const m of net.members.values()) { if (m.isMe) break; taken.add((m.look.tagColor || '').toLowerCase()); }
    const mine = (me.look.tagColor || '').toLowerCase();
    if (!taken.has(mine)) return;
    const free = TAG_COLORS.find((c) => !taken.has(c.toLowerCase()));
    if (free) net.setMeta({ look: { ...me.look, tagColor: free } });
  }

  leave() {
    this.panel?.dispose();
    this.live = false;
    for (const o of this.offs) o();
    this.offs = [];
    this.chat.detach();
    this.closeCode();
    this.unwatchRooms();
    if (!this.keepScene) this.disposeScene();
  }

  // ───────────────────────── update ─────────────────────────
  update(dt: number) {
    this.t += dt;
    if (!this.live) this.attach();
    const notice = coopFlow.takeNotice();
    if (notice) this.showErr(notice);
    if (this.err) { this.err.t += dt; if (this.err.t > 6) this.err = null; }
    if (this.toastMsg) { this.toastMsg.t += dt; if (this.toastMsg.t > 3.2) this.toastMsg = null; }
    if (this.confirm) { this.confirm.t -= dt; if (this.confirm.t <= 0) this.confirm = null; }
    this.copiedT = Math.max(0, this.copiedT - dt);
    // host: the start option / difficulty again every few seconds (friends whose lobby opened after mine — back from the map)
    this.cfgT -= dt;
    if (this.cfgT <= 0) { this.cfgT = 2.5; if (net.active && net.isHost && this.mode !== 'start') this.sendCfg(); }

    // the room went away under us (kicked, network) / came (joined from elsewhere)
    if (!net.active && this.mode !== 'start' && this.mode !== 'code') { this.mode = 'start'; this.sub = null; this.roomMenu = null; this.startMenu = this.buildStart(); this.chat.close(); }
    if (net.active && (this.mode === 'start' || this.mode === 'code') && !this.busy) this.enterRoom();
    if (this.mode === 'start' && !this.unwatch) {
      this.unwatch = net.watchRooms(() => { this.pubRooms = net.rooms().filter((r) => r.state === 'lobby' && r.n < r.max).length; });
    }
    if (net.active && this.wasHost !== net.isHost && (this.mode === 'room' || this.roomMenu)) {
      const sel = this.roomMenu?.sel ?? 0;
      this.buildRoom();
      if (this.roomMenu) this.roomMenu.sel = Math.min(sel, this.roomMenu.items.length - 1);
      if (net.isHost) { this.toast('Теперь ты хозяин комнаты'); this.sendCfg(); }
    }
    if (this.codeBox && this.codeBox.closed) { this.codeBox = null; if (this.mode === 'code') this.mode = 'start'; }

    this.updateInput(dt);
    this.updateSlots(dt);
    this.updateCamera(dt);
    const f = Math.sin(this.t * 11) * 0.12 + Math.sin(this.t * 6.3) * 0.08;
    this.flame.children.forEach((o, i) => {
      const k = Math.sin(this.t * (9 + i * 2.3) + i * 1.7) * 0.14 + Math.sin(this.t * 5.1 + i) * 0.07;
      o.scale.set(1 - k * 0.5, 1 + k, 1 - k * 0.5);
      o.rotation.y = this.t * (0.6 + i * 0.3);
    });
    this.fire.intensity = 28 + f * 14;
    if (Math.random() < 0.4) this.fx.glow.emit(V(rand(-0.6, 0.6), 1.4, -6.0), { count: 1, speed: [0.5, 1.4], dir: V(0, 1, 0), spread: 0.3, life: [0.6, 1.2], size: [0.05, 0.1], colors: ['#ffb02a', '#ffe14a', '#ff6a2a'], g: -0.5 });
    this.fx.update(dt);
  }

  private updateInput(dt: number) {
    if (this.busy) { input.menuTick(); return; }
    if (this.panel) { this.panel.update(dt); return; }
    if (this.mode !== 'code' && input.pressed('help')) { this.openSettings('controls'); return; }
    const inRoom = this.mode === 'room' || this.mode === 'voice' || this.mode === 'players' || this.mode === 'member';
    if (inRoom) {
      // chat: T / click on the panel (typing suspends the rest of the input)
      if (this.chat.update(dt, { allowOpen: true })) return;
      if (this.chat.typing) return;
      for (let i = 0; i < 4; i++) if (input.pressed(QP_ACTIONS[i]) && !input.padHeld('up') && !input.padHeld('down') && !input.padHeld('left') && !input.padHeld('right')) this.phrase(i);
    }
    switch (this.mode) {
      case 'start':
        this.startMenu.update(dt);
        if (input.pressed('back')) { audio.sfx('menuMove'); this.exit(); }
        break;
      case 'code':
        input.menuTick();
        // the box lost focus (click elsewhere): Esc still closes it
        if (input.pressed('back')) { this.closeCode(); audio.sfx('menuMove'); }
        break;
      case 'room': {
        const menu = this.roomMenu;
        if (!menu) break;
        const it = menu.items[menu.sel];
        // ← from a plain row (or a click on a card) goes to the players
        if (input.pressed('left') && !it?.left && net.members.size > 0) { this.mode = 'players'; this.pSel = this.myIndex(); audio.sfx('menuMove'); input.menuTick(); break; }
        menu.update(dt);
        if (input.pressed('back')) { menu.sel = menu.items.length - 1; audio.sfx('menuMove'); }
        this.clickCards();
        this.clickCode();
        break;
      }
      case 'voice':
      case 'member':
        this.sub?.update(dt);
        if (input.pressed('back')) { audio.sfx('menuMove'); if (this.mode === 'member') { this.mode = 'players'; this.sub = null; } else this.backToRoom(); }
        this.clickCards();
        break;
      case 'players': {
        input.menuTick();
        const list = this.who();
        const n = list.length;
        if (input.pressed('left')) { this.pSel = (this.pSel - 1 + n) % n; audio.sfx('menuMove'); }
        if (input.pressed('right')) {
          if (this.pSel >= n - 1) { this.backToRoom(); audio.sfx('menuMove'); break; }
          this.pSel++; audio.sfx('menuMove');
        }
        this.pSel = clamp(this.pSel, 0, n - 1);
        if (input.pressed('confirm') || input.pressed('attack') || (input.pressed('jump') && !input.down('up'))) { const w = list[this.pSel]; if (w) { audio.sfx('menuSelect'); this.openMember(w.id); } }
        else if (input.pressed('back') || input.pressed('up')) { this.backToRoom(); audio.sfx('menuMove'); }
        this.clickCards();
        break;
      }
    }
  }

  private myIndex() { return Math.max(0, this.who().findIndex((w) => w.me)); }

  /** click on a player's card opens that player's menu */
  private clickCards() {
    if (!input.mouseClicked) return;
    const list = this.who();
    for (let i = 0; i < list.length; i++) {
      const r = this.cardRect(list[i].id);
      if (r && input.mouseX >= r.x && input.mouseX <= r.x + r.w && input.mouseY >= r.y - 150 && input.mouseY <= r.y + r.h) {
        this.pSel = i;
        audio.sfx('menuSelect');
        this.openMember(list[i].id);
        return;
      }
    }
  }

  private clickCode() {
    if (input.mouseClicked && input.mouseX >= 16 && input.mouseX <= 296 && input.mouseY >= 16 && input.mouseY <= 136) this.copyCode();
  }

  /** who stands on the rug */
  who(): Who[] {
    // each one stands as the hero he picked (mine straight from my profile: no wait for the meta round trip)
    if (!net.active) return [{ id: net.myId, name: profile.name, look: profile.look, ready: false, host: false, me: true, kind: profile.kind, heroLook: profile.lookOf(profile.kind) }];
    return [...net.members.values()].map((m) => {
      const pick = m.isMe ? profile.pick() : m.hero;
      return { id: m.id, name: m.name, look: m.look, ready: m.ready, host: m.isHost, me: m.isMe, m, kind: pick.kind, heroLook: pick.look };
    });
  }

  private updateSlots(dt: number) {
    const list = this.who();
    const n = list.length;
    const spacing = Math.min(1.45, 5.0 / Math.max(1, n));
    const seen = new Set<string>();
    list.forEach((w, i) => {
      seen.add(w.id);
      let s = this.slots.get(w.id);
      const tx = (i - (n - 1) / 2) * spacing;
      const lookKey = JSON.stringify(w.heroLook);
      if (s && s.kind !== w.kind) {
        // picked another hero: a new figure on the same spot (with a little cheer)
        s.g.remove(s.rig.root); s.rig.dispose();
        s.rig = createHeroModel(w.kind, w.heroLook); s.g.add(s.rig.root);
        s.kind = w.kind; s.lookKey = lookKey; s.cheer = 1.2;
        this.fx.glow.emit(V(s.x, 0.8, 0), { count: 18, speed: [1, 3], life: [0.4, 0.9], size: [0.06, 0.12], colors: [w.look.tagColor, '#ffffff'], g: -1 });
      }
      if (!s) {
        const rig = createHeroModel(w.kind, w.heroLook);
        const g = new THREE.Group();
        g.add(rig.root);
        g.position.set(tx, 0, 0);
        this.scene.add(g);
        s = {
          id: w.id, rig, g, x: tx, tx, pop: 0, gone: false, cheer: this.t > 0.5 ? 1.2 : 0, wasReady: w.ready, t: rand(0, 5), lookKey, kind: w.kind, bubble: null,
          anim: { state: 'idle', speed: 0, attack: null, weapon: 'none', flash: 0, talk: 0, expr: 'happy', squash: 1 },
        };
        this.slots.set(w.id, s);
        if (this.t > 0.5) this.fx.glow.emit(V(tx, 0.8, 0), { count: 18, speed: [1, 3], life: [0.4, 0.9], size: [0.06, 0.12], colors: [w.look.tagColor, '#ffffff'], g: -1 });
      }
      s.tx = tx;
      s.gone = false;
      if (lookKey !== s.lookKey) { s.lookKey = lookKey; s.rig.setLook(w.heroLook); s.cheer = 1; }
      if (w.ready && !s.wasReady) { s.cheer = 1.4; this.fx.glow.emit(V(s.x, 1, 0), { count: 14, speed: [1, 3], life: [0.4, 0.8], size: [0.06, 0.12], colors: ['#7ef08a', '#ffffff'], g: -1 }); }
      s.wasReady = w.ready;
      const speaking = w.me ? voiceUI.talking : !!w.m?.speaking;
      s.anim.talk = speaking ? Math.abs(Math.sin(this.t * 14)) * 0.8 : damp(s.anim.talk, 0, 10, dt);
    });
    for (const s of this.slots.values()) if (!seen.has(s.id)) s.gone = true;
    for (const [id, s] of this.slots) {
      s.t += dt;
      s.cheer = Math.max(0, s.cheer - dt);
      if (s.bubble) { s.bubble.t += dt; if (s.bubble.t > 6) s.bubble = null; }
      s.pop = damp(s.pop, s.gone ? 0 : 1, s.gone ? 12 : 7, dt);
      if (s.gone && s.pop < 0.03) { this.scene.remove(s.g); s.rig.dispose(); this.slots.delete(id); continue; }
      s.x = damp(s.x, s.tx, 6, dt);
      const hop = s.cheer > 0 ? Math.abs(Math.sin(s.cheer * 7)) * 0.25 * Math.min(1, s.cheer) : 0;
      s.g.position.set(s.x, hop, Math.sin(s.t * 0.7) * 0.05);
      const pe = ease.outBack(clamp(s.pop, 0, 1));
      s.g.scale.setScalar(Math.max(0.001, pe));
      s.g.rotation.y = Math.sin(s.t * 0.5) * 0.18 - s.x * 0.04;
      s.anim.state = s.cheer > 0 ? 'cheer' : 'idle';
      s.anim.expr = s.cheer > 0 ? 'happy' : (net.members.get(id)?.ready ? 'happy' : 'normal');
      s.rig.update(dt, s.anim);
    }
  }

  private updateCamera(dt: number) {
    const room = net.active;
    const pos = room ? V(0, 1.95, 10.2) : V(-1.55, 1.3, 4.9);
    const at = room ? V(0, 0.98, 0) : V(-1.55, 0.78, 0);
    this.camPos.x = damp(this.camPos.x, pos.x + Math.sin(this.t * 0.25) * 0.15, 3, dt);
    this.camPos.y = damp(this.camPos.y, pos.y, 3, dt);
    this.camPos.z = damp(this.camPos.z, pos.z, 3, dt);
    this.camAt.x = damp(this.camAt.x, at.x, 3, dt);
    this.camAt.y = damp(this.camAt.y, at.y, 3, dt);
    this.camAt.z = damp(this.camAt.z, at.z, 3, dt);
    this.cam.position.copy(this.camPos);
    this.cam.lookAt(this.camAt);
  }

  // ───────────────────────── render ─────────────────────────
  render(ctx: C) {
    this.fx.setScale(RT.winH * (RT.r3?.pixelRatio ?? 1) * 0.9);
    this.cam.aspect = RT.winW / RT.winH;
    this.cam.updateProjectionMatrix();
    RT.r3?.render(this.scene, this.cam);
    ctx.clearRect(0, 0, W, H);
    // soft vignette edges
    const g = ctx.createRadialGradient(W / 2, H / 2, 260, W / 2, H / 2, 820);
    g.addColorStop(0, 'rgba(10,4,6,0)'); g.addColorStop(1, 'rgba(10,4,6,0.6)');
    ctx.fillStyle = g; ctx.fillRect(-2000, -2000, W + 4000, H + 4000);

    if (this.mode === 'start' || this.mode === 'code') this.drawStart(ctx);
    else this.drawRoom(ctx);

    // toast + error banner (top centre)
    if (this.toastMsg) {
      const a = clamp(Math.min(this.toastMsg.t * 5, (3.2 - this.toastMsg.t) * 3), 0, 1);
      banner(ctx, this.toastMsg.text, W / 2, 50, '#fff3d8', 'rgba(30,15,20,0.85)', a);
    }
    if (this.err) {
      const a = clamp(Math.min(this.err.t * 5, (6 - this.err.t) * 2), 0, 1);
      banner(ctx, this.err.text, W / 2, this.toastMsg ? 104 : 50, '#ffffff', '#b0353a', a);
    }
    if (this.busy) this.drawBusy(ctx);
    this.panel?.draw(ctx);
  }

  private drawStart(ctx: C) {
    const tt = ease.outBack(clamp(this.t / 0.8, 0, 1));
    ctx.save(); ctx.translate(250, 120); ctx.scale(tt, tt); ctx.translate(-250, -120);
    text(ctx, 'Играть', 250, 100, { size: 56, color: '#ffd34a', align: 'center', stroke: 10 });
    text(ctx, 'с друзьями', 250, 150, { size: 40, color: '#ffb0e0', align: 'center', stroke: 8 });
    text(ctx, `До ${MAX_PLAYERS} Тош в одной комнате — по сети, с чатом и голосом`, 250, 186, { size: 17, font: 'body', color: '#f6ecd2', align: 'center', stroke: 4 });
    ctx.restore();
    this.startMenu.draw(ctx);
    const help = this.startHelp();
    ctx.font = '400 19px Pangolin, sans-serif';
    wrap(ctx, help, 470).forEach((l, i) => text(ctx, l, 250, 640 + i * 24, { size: 19, font: 'body', color: '#fff3d8', align: 'center', stroke: 4 }));
    if (this.pubRooms >= 0) {
      const s = this.pubRooms === 0 ? 'Открытых комнат пока нет' : `Открытых комнат: ${this.pubRooms}`;
      text(ctx, s, W - 24, H - 22, { size: 17, font: 'body', color: '#d8c8b0', align: 'right', stroke: 4 });
    }
    // my Tosha's nameplate
    this.drawCards(ctx, false);
    // prompts
    let x = 52;
    x += drawHint(ctx, 'confirm', 'выбрать', x, 18, { size: 24 }) + 22;
    drawHint(ctx, 'back', 'назад', x, 18, { size: 24 });
    if (this.mode === 'code') {
      ctx.fillStyle = 'rgba(12,6,16,0.72)'; ctx.fillRect(-2000, -2000, W + 4000, H + 4000);
      rrect(ctx, W / 2 - 230, 210, 460, 250, 26, 'rgba(30,14,10,0.92)', 5);
      text(ctx, 'Код комнаты', W / 2, 268, { size: 34, color: '#ffd34a', align: 'center', stroke: 6 });
      text(ctx, '5 букв или цифр — спроси у друга', W / 2, 300, { size: 18, font: 'body', color: '#f6ecd2', align: 'center' });
      text(ctx, 'Enter — войти   Esc — назад', W / 2, 432, { size: 17, font: 'body', color: '#d8c8b0', align: 'center' });
    }
  }

  private drawRoom(ctx: C) {
    // room code card (click = copy)
    rrect(ctx, 16, 16, 280, 120, 20, 'rgba(30,14,10,0.84)', 4);
    text(ctx, net.isPublic ? 'ОТКРЫТАЯ КОМНАТА' : 'КОМНАТА ПО КОДУ', 156, 44, { size: 15, color: '#d8c8b0', align: 'center' });
    const code = net.code ?? '·····';
    ctx.save();
    ctx.font = '900 52px Rubik, sans-serif';
    const cw = 40;
    for (let i = 0; i < code.length; i++) {
      const x = 156 + (i - (code.length - 1) / 2) * cw;
      text(ctx, code[i], x, 98 + Math.sin(this.t * 2 + i * 0.7) * 2, { size: 50, color: '#ffd34a', align: 'center', stroke: 8 });
    }
    ctx.restore();
    text(ctx, this.copiedT > 0 ? 'Скопировано!' : 'клик — скопировать', 156, 124, { size: 14, font: 'body', color: this.copiedT > 0 ? '#9ae06a' : '#a89888', align: 'center' });

    this.chat.draw(ctx);
    this.drawCards(ctx, true);

    // right column: menu / submenu with a title
    const title = this.mode === 'voice' ? 'Голосовой чат' : this.mode === 'member' ? (net.members.get(this.memberId)?.name ?? '') : net.isHost ? 'Ты — хозяин' : 'Комната';
    text(ctx, title, COL_X, 92, { size: 24, color: '#ffd34a', align: 'center', stroke: 6 });
    drawMicBadge(ctx, COL_X - COL_W / 2, 36, { always: true, t: this.t });
    if (this.mode === 'room' || this.mode === 'players') this.roomMenu?.draw(ctx);
    else this.sub?.draw(ctx);
    if (this.mode === 'voice') {
      ctx.font = '400 17px Pangolin, sans-serif';
      const lines = net.voice.ptt ? 'Держи кнопку, чтобы тебя слышали. Друзей слышно всегда.' : 'Тебя слышно всё время, пока микрофон включён.';
      wrap(ctx, lines, COL_W).forEach((l, i) => text(ctx, l, COL_X, 340 + i * 22, { size: 17, font: 'body', color: '#fff3d8', align: 'center', stroke: 4 }));
      if (net.voice.ptt) drawHint(ctx, 'talk', '— говорить', COL_X - 70, 400, { size: 26 });
      if (voiceUI.error) {
        wrap(ctx, voiceUI.error, COL_W).forEach((l, i) => text(ctx, l, COL_X, 440 + i * 22, { size: 17, font: 'body', color: '#ff8a8a', align: 'center', stroke: 4 }));
      }
    }
    if (this.mode === 'member') {
      const m = net.members.get(this.memberId);
      if (m && !m.isMe) {
        text(ctx, `пинг ${m.ping < 0 ? '…' : m.ping + ' мс'} · ${linkName(m.link)}`, COL_X, 330, { size: 17, font: 'body', color: '#d8c8b0', align: 'center', stroke: 4 });
      }
    }

    // status line (bottom centre)
    const cx = 640;
    let status = '';
    let col = '#fff3d8';
    if (net.roomState === 'playing' && !net.isHost) { status = 'Друзья уже в игре — ты присоединишься к следующей главе'; col = '#ffe680'; }
    else if (net.isHost) {
      const [r, n] = this.readyCount();
      status = n === 0 ? 'Позови друзей: скажи им код комнаты' : r === n ? 'Все готовы — можно начинать!' : `Готовы ${r} из ${n}…`;
    } else status = net.me?.ready ? 'Ждём, пока хозяин начнёт…' : 'Закончишь наряжаться — жми «Я готов!»';
    text(ctx, status, cx, 594, { size: 21, font: 'body', color: col, align: 'center', stroke: 5 });
    const diff = coop.cfgDiff();
    if (!net.isHost && net.roomState !== 'playing') text(ctx, `${chapterName(coop.cfg.chapter)} · сложность: ${DIFF_NAME[diff]}`, cx, 622, { size: 17, font: 'body', color: diff === 'hard' ? DIFF_COLOR.hard : '#d8c8b0', align: 'center', stroke: 4 });
    else if (!net.isHost) text(ctx, `Сложность: ${DIFF_NAME[diff]}`, cx, 622, { size: 17, font: 'body', color: diff === 'hard' ? DIFF_COLOR.hard : '#d8c8b0', align: 'center', stroke: 4 });
    else if (this.mode === 'room' && this.diffSelected()) text(ctx, DIFF_HELP[diff], cx, 622, { size: 17, font: 'body', color: DIFF_COLOR[diff], align: 'center', stroke: 4 });
    else if (this.mode === 'room' && this.selLabel() === startName(coop.cfg.chapter)) text(ctx, coop.cfg.chapter === MAP_CH ? 'Карта Хрумляндии: серию выбираете на карте' : chapterName(coop.cfg.chapter), cx, 622, { size: 17, font: 'body', color: '#d8c8b0', align: 'center', stroke: 4 });

    // prompts
    let x = 330;
    const y = 688;
    if (this.mode === 'players') {
      x += drawHint(ctx, 'left', '', x, y, { size: 24 }) - 4;
      x += drawHint(ctx, 'right', 'выбрать Тошу', x, y, { size: 24 }) + 18;
      x += drawHint(ctx, 'confirm', 'настроить', x, y, { size: 24 }) + 18;
      drawHint(ctx, 'back', 'назад', x, y, { size: 24 });
    } else {
      x += drawHint(ctx, 'left', 'игроки', x, y, { size: 24 }) + 18;
      // quick phrases: keys 1–4 here (on a pad the d-pad belongs to the menus)
      if (glyphDevice() === 'kb') {
        x += drawGlyph(ctx, 'qp1', x, y, 24, 'left') + 4;
        text(ctx, '–', x + 2, y + 6, { size: 18, color: '#fff3d8', stroke: 4 });
        x += 16;
        x += drawHint(ctx, 'qp4', 'фразы', x, y, { size: 24 }) + 18;
      }
      if (net.voice.enabled && net.voice.ptt) drawHint(ctx, 'talk', 'говорить', x, y, { size: 24 });
    }
  }

  /** logical rect of a player's card (under the feet) */
  private cardRect(id: string): { x: number; y: number; w: number; h: number } | null {
    const s = this.slots.get(id);
    if (!s) return null;
    const feet = toUI(s.g.position.clone().setY(0), this.cam);
    const n = Math.max(1, this.who().length);
    const w = clamp(560 / n, 104, 164);
    return { x: feet.x - w / 2, y: feet.y + 14, w, h: 58 };
  }

  private drawCards(ctx: C, room: boolean) {
    const list = this.who();
    list.forEach((w, i) => {
      const s = this.slots.get(w.id);
      const r = this.cardRect(w.id);
      if (!s || !r) return;
      const a = clamp(s.pop, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      const sel = (this.mode === 'players' && i === this.pSel) || (this.mode === 'member' && this.memberId === w.id);
      const lift = sel ? -4 + Math.sin(this.t * 5) * 2 : 0;
      rrect(ctx, r.x + 3, r.y + 5 + lift, r.w, r.h, 14, 'rgba(0,0,0,0.35)', 0);
      rrect(ctx, r.x, r.y + lift, r.w, r.h, 14, sel ? '#ffd34a' : 'rgba(255,247,230,0.94)', sel ? 4 : 3);
      // name in the player's colour on a dark plate
      ctx.font = '700 17px Rubik, sans-serif';
      const name = fit(ctx, w.name, r.w - (w.host ? 34 : 14));
      const nw = ctx.measureText(name).width + (w.host ? 22 : 0);
      rrect(ctx, r.x + 6, r.y + 5 + lift, r.w - 12, 24, 9, 'rgba(30,16,20,0.88)', 0);
      let nx = r.x + r.w / 2 - nw / 2;
      if (w.host) { drawCrown(ctx, nx + 8, r.y + 16 + lift, 16); nx += 20; }
      text(ctx, name, nx, r.y + 23 + lift, { size: 17, weight: 700, color: w.look.tagColor || '#ffd34a' });
      // second row: ready / ping / voice
      const ry = r.y + 44 + lift;
      if (room) {
        let st: string, sc: string;
        if (w.host) { st = 'хозяин'; sc = '#8a6a2a'; }
        else if (w.ready) { st = '✓ готов'; sc = '#2f7a2a'; }
        else { st = 'не готов'; sc = '#9a6a6a'; }
        text(ctx, st, r.x + 10, ry + 5, { size: 15, font: 'body', color: sc });
        const m = w.m;
        if (m && !m.isMe) {
          const pc = m.link === 'relay' ? '#c87a1a' : m.link === 'connecting' ? '#8a8a8a' : m.ping > 200 ? '#c8501a' : '#2f7a2a';
          const pt = m.link === 'connecting' ? '…' : m.ping >= 0 ? `${m.ping}` : '…';
          text(ctx, pt, r.x + r.w - 32, ry + 5, { size: 14, color: pc, align: 'right' });
          drawLink(ctx, r.x + r.w - 22, ry, m.link, this.t);
          if (m.speaking || m.muted) drawSpeaker(ctx, r.x + r.w / 2 + 14, ry - 1, 18, { speaking: m.speaking, muted: m.muted, t: this.t });
        } else if (w.me) {
          text(ctx, 'это ты', r.x + r.w - 10, ry + 5, { size: 14, font: 'body', color: '#8a7a6a', align: 'right' });
          if (voiceUI.talking) drawSpeaker(ctx, r.x + r.w / 2 + 10, ry - 1, 18, { speaking: true, t: this.t });
        }
      } else {
        text(ctx, 'Это ты!', r.x + r.w / 2, ry + 5, { size: 15, font: 'body', color: '#6a5a4a', align: 'center' });
      }
      ctx.restore();
      // speech bubble over the head
      if (s.bubble) this.drawBubble(ctx, s, w.look.tagColor);
    });
  }

  private drawBubble(ctx: C, s: Slot, color: string) {
    const b = s.bubble!;
    const head = toUI(s.g.position.clone().setY(1.55), this.cam);
    const a = clamp(Math.min(b.t / 0.15, (6 - b.t) / 0.6), 0, 1);
    const sc = ease.outBack(clamp(b.t * 5, 0, 1));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(head.x, head.y - 10); ctx.scale(sc, sc);
    const fs = b.big ? 22 : 18;
    ctx.font = `${b.big ? '900' : '400'} ${fs}px ${b.big ? 'Rubik' : 'Pangolin'}, sans-serif`;
    const lines = wrap(ctx, b.text, 220).slice(0, 4);
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 26, bh = lines.length * (fs + 4) + 16;
    rrect(ctx, -bw / 2, -bh - 12, bw, bh, 14, b.big ? color : '#fffaf0', 3);
    ctx.beginPath(); ctx.moveTo(-8, -13); ctx.lineTo(0, -1); ctx.lineTo(8, -13); ctx.closePath();
    ctx.fillStyle = b.big ? color : '#fffaf0'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
    lines.forEach((l, i) => text(ctx, l, 0, -bh - 12 + 8 + (i + 1) * (fs + 4) - 4, { size: fs, font: b.big ? 'title' : 'body', color: OUT, align: 'center' }));
    ctx.restore();
  }

  private drawBusy(ctx: C) {
    ctx.fillStyle = 'rgba(12,6,16,0.6)'; ctx.fillRect(-2000, -2000, W + 4000, H + 4000);
    rrect(ctx, W / 2 - 240, H / 2 - 70, 480, 140, 26, 'rgba(30,14,10,0.94)', 5);
    for (let i = 0; i < 8; i++) {
      const a = this.t * 6 + (i / 8) * Math.PI * 2;
      ctx.globalAlpha = 0.25 + 0.75 * ((i + Math.floor(this.t * 10)) % 8) / 8;
      ctx.beginPath(); ctx.arc(W / 2 + Math.cos(a) * 20, H / 2 - 22 + Math.sin(a) * 20, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd34a'; ctx.fill();
    }
    ctx.globalAlpha = 1;
    text(ctx, this.busy, W / 2, H / 2 + 40, { size: 22, font: 'body', color: '#fff3d8', align: 'center' });
  }
}

// ───────────────────────── helpers ─────────────────────────
/** what each difficulty means (under the status line while the host picks it) */
const DIFF_HELP: Record<Difficulty, string> = {
  easy: 'Лёгкая: +3 сердечка, крошки при падении не теряются',
  normal: 'Нормальная: как задумано',
  hard: 'Хардкор: падение в библиотеке — нокаут, выход только всей командой, враги крепче',
};
/** the room whose difficulty the host already picked (a new room starts from the host's solo setting) */
let cfgRoom: string | null = null;
/** what the host can start: the world map (prologue done) + the prologue's chapters (reached ones; chapter 1 always) */
function chapterList(): number[] {
  const out: number[] = prologueDone() ? [MAP_CH] : [];
  const n0 = out.length;
  STORY.forEach((s, i) => { if (s.kind === 'level' && (i <= save.data.reached || out.length === n0)) out.push(i); });
  return out;
}

/** «Пролог, глава 2: Пиршественный зал» / «Карта Хрумляндии» */
function chapterName(i: number): string {
  if (i === MAP_CH) return 'Карта Хрумляндии';
  const s = STORY[i];
  if (!s || s.kind !== 'level') return '—';
  return `Пролог, глава ${chapterNo(i)}: ${s.title.split('. ')[1] ?? s.title}`;
}
/** the start option's label: «Продолжить на карте» / «Пролог: глава N» */
function startName(i: number): string { return i === MAP_CH ? 'Продолжить на карте' : `Пролог: глава ${chapterNo(i)}`; }
function chapterNo(i: number) { return STORY.slice(0, i + 1).filter((s) => s.kind === 'level').length; }

/** where the host is right now (from its meta scene: 'lvl:<id>' | 'den' | 'story' | 'credits') */
function roomNow(): string {
  const h = net.hostId ? net.members.get(net.hostId) : undefined;
  const sc = h?.scene ?? '';
  if (sc.startsWith('lvl:')) {
    const st = STORY.find((s) => s.kind === 'level' && s.id === sc.slice(4));
    if (st && st.kind === 'level') return st.title.split('. ')[1] ?? st.title;
    // (someone waiting in the lobby never got the level message: find the episode by its level)
    const ep = (coopFlow.ep ? EPISODES[coopFlow.ep] : null) ?? Object.values(EPISODES).find((e) => e.levels.includes(sc.slice(4))) ?? null;
    return ep ? ep.title : 'глава';
  }
  return sc === 'den' ? 'берлога' : sc === 'story' ? 'заставка' : sc === 'credits' ? 'титры' : sc === 'map' ? 'карта' : sc === 'scene' ? 'серия' : 'игра';
}

function linkName(l: string) { return l === 'p2p' ? 'напрямую' : l === 'relay' ? 'через сервер' : 'соединяемся…'; }

/** shorten to fit (current ctx.font) */
function fit(ctx: C, s: string, w: number): string {
  if (ctx.measureText(s).width <= w) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(t + '…').width > w) t = t.slice(0, -1);
  return t + '…';
}

function banner(ctx: C, s: string, x: number, y: number, color: string, bg: string, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '400 20px Pangolin, sans-serif';
  const w = Math.min(W - 40, ctx.measureText(s).width + 44);
  rrect(ctx, x - w / 2, y - 22, w, 44, 16, bg, 3);
  text(ctx, s, x, y + 7, { size: 20, font: 'body', color, align: 'center' });
  ctx.restore();
}

/** a little gold crown (host) centred at x, y */
export function drawCrown(ctx: C, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-s * 0.5, s * 0.3); ctx.lineTo(-s * 0.55, -s * 0.3); ctx.lineTo(-s * 0.22, -s * 0.02); ctx.lineTo(0, -s * 0.45);
  ctx.lineTo(s * 0.22, -s * 0.02); ctx.lineTo(s * 0.55, -s * 0.3); ctx.lineTo(s * 0.5, s * 0.3); ctx.closePath();
  ctx.fillStyle = '#f2c23a'; ctx.fill();
  ctx.lineWidth = Math.max(1.5, s * 0.12); ctx.lineJoin = 'round'; ctx.strokeStyle = OUT; ctx.stroke();
  ctx.restore();
}

/** link quality dot: green = direct, orange = via the server, grey pulsing = connecting */
function drawLink(ctx: C, x: number, y: number, link: string, t: number) {
  const col = link === 'p2p' ? '#5ac85a' : link === 'relay' ? '#ff9a3a' : '#a8a8a8';
  ctx.save();
  if (link === 'connecting') ctx.globalAlpha *= 0.4 + 0.6 * Math.abs(Math.sin(t * 4));
  for (let i = 0; i < 3; i++) {
    const h = 5 + i * 4;
    rrect(ctx, x + i * 6 - 8, y + 6 - h, 4, h, 1.5, link === 'relay' && i === 2 ? 'rgba(0,0,0,0.15)' : col, 0);
  }
  ctx.restore();
}
