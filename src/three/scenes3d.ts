import * as THREE from 'three';
import { W, H, TAU, clamp, ease, lerp, rand, srand } from '../engine/util';
import { input } from '../engine/input';
import { audio, MusicName } from '../engine/audio';
import { save } from '../engine/save';
import { text, rrect, wrap, OUT } from '../art/draw';
import type { Who } from '../art/characters';
import { vignetteCanvas } from '../art/props';
import { Dialog } from '../ui/dialog';
import { MenuList } from '../ui/widgets';
import { Coroutine, Script, wait, tween, all } from '../game/coroutine';
import { game, STORY } from '../game/game';
import { DenScene } from '../scenes/den';
import { RT, toUI, cineZoom } from './runtime';
import { mat, basic, mesh, noOutline, canvasTex, PAL } from './gfx';
import { FX3 } from './fx';
import { createHero, createDog, createBear, createKing, createGuard, KING_HAND_REST } from './models';
import type { HeroAnim, KingAnim, KingRig } from './models';
import type { HeroRig } from './models/hero';
import type { Rig } from './models/rig';
import { room } from './world/rooms';
import * as P from './world/props';
import { SettingsPanel, type SettingsTab } from '../ui/settings';
import * as O from './world/outdoor';
import { Customize3D } from './scenes/customize';
import { profile } from '../net/profile';
// co-op
import { net } from '../net/session';
import { coop } from './game/coop';
import { coopFlow } from './game/coopFlow';
import { prologueDone, myProgress } from './game/episodes';
import { MenuTown } from './scenes/menuTown';
import { LobbyScene, drawCrown } from './scenes/lobby';
import { ChatPanel } from '../ui/chat';
import { drawMicBadge, drawSpeaker } from '../ui/voiceHud';

type C = CanvasRenderingContext2D;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function heroAnim(o: Partial<HeroAnim> = {}): HeroAnim {
  return { state: 'idle', speed: 0, attack: null, weapon: 'sword', flash: 0, talk: 0, expr: 'normal', squash: 1, ...o };
}
function kingAnim(o: Partial<KingAnim> = {}): KingAnim {
  return {
    eye: 0, mouth: 0.15, anger: 0, look: { x: 0, y: 0 }, dizzy: 0, chew: 0, slump: 0, stand: 0, flash: 0, talk: 0,
    hands: [{ pos: KING_HAND_REST[0].clone(), pose: 'rest', glow: 0, flash: 0 }, { pos: KING_HAND_REST[1].clone(), pose: 'rest', glow: 0, flash: 0 }],
    ...o,
  };
}

function baseScene(bg: string, fog: [string, number, number], hemi: [string, string, number], sun: [string, number, [number, number, number]]) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bg);
  scene.fog = new THREE.Fog(fog[0], fog[1], fog[2]);
  scene.add(new THREE.HemisphereLight(hemi[0], hemi[1], hemi[2]));
  const s = new THREE.DirectionalLight(sun[0], sun[1]);
  s.position.set(...sun[2]).multiplyScalar(40);
  s.castShadow = true;
  s.shadow.mapSize.set(2048, 2048);
  const c = s.shadow.camera; c.left = -40; c.right = 40; c.top = 40; c.bottom = -40; c.far = 200;
  s.shadow.bias = -0.0006;
  scene.add(s, s.target);
  return { scene, sun: s };
}

function render3(scene: THREE.Scene, cam: THREE.PerspectiveCamera) {
  cam.aspect = RT.winW / RT.winH; cam.updateProjectionMatrix();
  RT.r3?.render(scene, cam);
}

/** sky-colored big sphere for outdoor scenes */
function skySphere(top: string, bottom: string) {
  const tex = canvasTex(4, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, top); gr.addColorStop(1, bottom);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
  noOutline(m);
  return m;
}

/** the logo's plaque after the prologue: the arc being played, then a hint of the next land (none before) */
function logoSubtitle(): { text: string; color: string } | null {
  if (!prologueDone()) return null;
  if (myProgress().fangs5?.done) return { text: 'Скоро: Лимонное графство', color: '#c8a020' };
  return { text: 'Ночь клыков', color: '#9a2a4a' };
}

// ═══════════════════════════════ MENU ═══════════════════════════════
export class Menu3D {
  is3d = true;
  t = 0;
  scene: THREE.Scene;
  cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 600);
  /** the backdrop: the King's throne room until the prologue is done, then Пастильное королевство by night */
  king: KingRig | null = null;
  kAnim = kingAnim();
  hero: HeroRig | null = null;
  town: MenuTown | null = null;
  guards: { rig: Rig<any>; root: THREE.Group; dir: number }[] = [];
  fx = new FX3();
  mode: 'main' | 'settings' | 'controls' | 'chapters' | 'confirm' = 'main';
  main: MenuList;
  sub: MenuList | null = null;
  /** «Настройки» / «Управление»: the settings panel (its own tab) */
  panel: SettingsPanel | null = null;
  vignette = vignetteCanvas(W, H, 0.6);
  zT = 0;
  /** co-op: a message from the room flow (kicked, room full…) */
  notice: { text: string; t: number } | null = null;
  constructor() {
    if (prologueDone()) {
      this.town = new MenuTown();
      this.scene = this.town.scene;
      this.main = this.buildMain();
      audio.playMusic('menu');
      return;
    }
    const b = baseScene('#120c1c', ['#1e1530', 60, 160], ['#d8c8ff', '#2a1c3a', 1.1], ['#c8d8ff', 2.0, [0.3, 1, 0.6]]);
    this.scene = b.scene;
    this.scene.add(room({ theme: 'throne', x0: -40, x1: 40, z0: -50, z1: 40, floorY: 0, wallH: 60 }).obj);
    // same set-up as the boss hall: the King sits ON his (sunken) throne
    this.scene.add(P.throne({ x: 0, y: 4.1 - 9.4 * 1.5, z: -38, s: 1.5 }).obj);
    for (const [x, z] of [[-26, -18], [26, -18], [-26, 12], [26, 12]]) this.scene.add(P.pillar({ x, y: 0, z, r: 2, h: 60 }).obj);
    for (const x of [-20, 20]) this.scene.add(P.banner({ x, y: 22, z: -49.4, w: 8, h: 18 }).obj);
    this.king = createKing();
    this.king.root.position.set(0, 4.1, -36);
    this.scene.add(this.king.root);
    this.hero = createHero(profile.look);
    this.hero.root.position.set(7, 0, 4);
    this.hero.root.rotation.y = Math.PI + 0.35;
    this.scene.add(this.hero.root);
    for (const [x, d] of [[-30, 1], [30, -1]] as const) {
      const rig = createGuard('guard');
      const root = new THREE.Group(); root.add(rig.root); root.position.set(x, 0, 12); root.rotation.y = d > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.scene.add(root);
      this.guards.push({ rig, root, dir: d });
    }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(5, 8, 100, 32, 1, true), new THREE.MeshBasicMaterial({ color: '#b8d0ff', transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    beam.position.set(0, 50, -14); noOutline(beam); this.scene.add(beam);
    this.scene.add(this.fx.group);
    this.main = this.buildMain();
    audio.playMusic('menu');
  }
  buildMain() {
    if (prologueDone()) {
      // after the prologue: the map of Хрумляндия first (every series is played from there), a fresh start at the bottom
      return new MenuList([
        { label: 'Карта Хрумляндии', action: () => game.toMap() },
        { label: 'Играть с друзьями', action: () => this.coopLobby() },
        { label: 'Мой герой', action: () => this.customize() },
        { label: 'Управление', action: () => this.open('controls') },
        { label: 'Настройки', action: () => this.open('settings') },
        { label: 'Новая игра', action: () => this.newGame() },
      ], 230, 340, { w: 320, h: 40, gap: 7, size: 22 });
    }
    const m = new MenuList([
      { label: () => (save.data.started ? 'Новая игра' : 'Начать игру'), action: () => this.newGame() },
      // after the prologue «Продолжить» opens the world map of Хрумляндия
      { label: 'Продолжить', action: () => (prologueDone() ? game.toMap() : game.story(save.data.story)), disabled: () => !save.data.started && !prologueDone() },
      { label: 'Главы', action: () => this.open('chapters'), disabled: () => save.data.reached < 1 },
      { label: 'Играть с друзьями', action: () => this.coopLobby() },
      { label: 'Мой герой', action: () => this.customize() },
      { label: 'Управление', action: () => this.open('controls') },
      { label: 'Настройки', action: () => this.open('settings') },
    ], 230, 340, { w: 320, h: 40, gap: 7, size: 22 });
    // a saved game: the cursor starts on «Продолжить»
    if (save.data.started || prologueDone()) m.sel = 1;
    return m;
  }
  /** "Играть с друзьями": the co-op lobby (optionally joining an invite code right away) */
  coopLobby(join?: string) {
    game.go(() => new LobbyScene({ join }));
  }
  /** "Мой Тоша": the customization stage, then back to this same menu (cursor kept), its Tosha in the new look */
  customize() {
    const menu = this;
    game.go(() => new Customize3D(() => {
      menu.hero?.setLook(profile.look);
      game.go(() => menu);
    }));
  }
  newGame() {
    if (save.data.started) { this.open('confirm'); return; }
    save.reset();
    game.story(0);
  }
  open(m: Menu3D['mode']) {
    this.mode = m;
    const back = { label: 'Назад', action: () => { this.mode = 'main'; this.sub = null; } };
    if (m === 'settings' || m === 'controls') {
      const tab: SettingsTab = m === 'controls' ? 'controls' : 'sound';
      this.sub = null;
      this.panel = new SettingsPanel({ tab, where: 'menu', onClose: () => { this.panel = null; this.mode = 'main'; } });
    } else if (m === 'chapters') {
      const items = STORY.map((s, i) => ({ s, i })).filter(({ s, i }) => s.kind === 'level' && i <= save.data.reached);
      const medal = (id: string) => { const m = save.data.medals[id] ?? 0; return m ? '   ' + '★'.repeat(m) + '☆'.repeat(3 - m) : ''; };
      this.sub = new MenuList([...items.map(({ s, i }) => ({ label: (s as { title: string }).title + medal((s as { id: string }).id), action: () => game.story(i) })), back], W / 2, 170, { w: 560, h: 52, gap: 10, size: 22 });
    } else if (m === 'confirm') {
      this.sub = new MenuList([
        { label: 'Да, начать заново', action: () => { save.reset(); game.story(0); } },
        { label: 'Нет, вернуться', action: () => { this.mode = 'main'; this.sub = null; } },
      ], W / 2, 360, { w: 420, h: 54, gap: 14, size: 24 });
    }
  }
  update(dt: number) {
    this.t += dt;
    const n = coopFlow.takeNotice();
    if (n) this.notice = { text: n, t: 0 };
    if (this.notice) { this.notice.t += dt; if (this.notice.t > 5) this.notice = null; }
    const inv = this.t > 0.3 ? coopFlow.takeInvite() : null;
    if (inv) this.coopLobby(inv);
    if (this.panel) this.panel.update(dt);
    else if (this.mode === 'main') { this.main.update(dt); if (input.pressed('help')) this.open('controls'); }
    else if (input.pressed('back')) { this.mode = 'main'; this.sub = null; audio.sfx('menuMove'); }
    else this.sub?.update(dt);
    if (this.town) { this.town.update(dt); this.town.camera(this.cam, this.t); return; }
    this.kAnim.mouth = 0.15 + Math.sin(this.t * 1.2) * 0.12;
    this.king?.update(dt, this.kAnim);
    this.hero?.update(dt, heroAnim({ state: 'lookUp', expr: 'surprised' }));
    for (const g of this.guards) {
      g.root.position.x += g.dir * dt * 2.2;
      if (g.root.position.x > 34) g.root.position.x = -34;
      if (g.root.position.x < -34) g.root.position.x = 34;
      g.rig.update(dt, { state: 'walk', speed: 0.6, flash: 0 });
    }
    this.zT += dt;
    if (this.zT > 1.1) { this.zT = 0; this.fx.text(V(4 + rand(-1, 1), 30, -16), 'z', '#e8d8ff', 26 + rand(0, 14)); }
    if (Math.random() < 0.3) this.fx.glow.emit(V(rand(-6, 6), rand(0, 30), -14 + rand(-6, 6)), { count: 1, speed: [0.1, 0.4], life: [2, 4], size: [0.08, 0.16], colors: ['#e0d0ff', '#ffffff'], g: -0.2 });
    this.fx.update(dt);
    const a = this.t * 0.06;
    this.cam.position.set(Math.sin(a) * 10 + 12, 7 + Math.sin(this.t * 0.2) * 1.2, 26 + Math.cos(a) * 4);
    this.cam.lookAt(-2, 14, -20);
  }
  render(ctx: C) {
    const fx = this.town?.fx ?? this.fx;
    fx.setScale(RT.winH * (RT.r3?.pixelRatio ?? 1) * 0.9);
    render3(this.scene, this.cam);
    ctx.clearRect(0, 0, W, H);
    for (const ft of fx.texts) {
      const s = toUI(ft.pos, this.cam);
      if (s.vis) text(ctx, ft.text, s.x, s.y, { size: ft.size, color: ft.color, align: 'center', stroke: 4, alpha: Math.min(1, ft.life * 2) });
    }
    ctx.save(); ctx.globalAlpha = 0.6; ctx.drawImage(this.vignette, 0, 0, W, H); ctx.restore();
    if (this.mode === 'main') {
      this.drawLogo(ctx);
      this.main.draw(ctx);
    } else if (this.panel) this.panel.draw(ctx);
    else {
      ctx.fillStyle = 'rgba(12,6,16,0.72)'; ctx.fillRect(-2000, -2000, W + 4000, H + 4000);
      const title = { settings: 'Настройки', controls: 'Управление', chapters: 'Главы', confirm: 'Начать заново?', main: '' }[this.mode];
      text(ctx, title, W / 2, 110, { size: 52, color: '#ffd34a', align: 'center', stroke: 9 });
      if (this.mode === 'confirm') text(ctx, 'Весь прогресс, крошки и находки пропадут.', W / 2, 300, { size: 24, font: 'body', color: '#f6ecd2', align: 'center' });
      this.sub?.draw(ctx);
    }
    if (this.notice) {
      const a = clamp(Math.min(this.notice.t * 5, (5 - this.notice.t) * 2), 0, 1);
      ctx.save(); ctx.globalAlpha = a;
      ctx.font = '400 21px Pangolin, sans-serif';
      const w = ctx.measureText(this.notice.text).width + 48;
      rrect(ctx, W / 2 - w / 2 + 120, 24, w, 46, 16, '#b0353a', 4);
      text(ctx, this.notice.text, W / 2 + 120, 54, { size: 21, font: 'body', color: '#fff', align: 'center' });
      ctx.restore();
    }
  }
  drawLogo(ctx: C) {
    const word = (str: string, x: number, y: number, size: number, c1: string, c2: string, phase: number) => {
      ctx.font = `900 ${size}px Rubik, sans-serif`;
      const total = ctx.measureText(str).width;
      let cx = x - total / 2;
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        const w = ctx.measureText(ch).width;
        ctx.save();
        ctx.translate(cx + w / 2, y + Math.sin(this.t * 2.4 + i * 0.6 + phase) * 4);
        ctx.rotate(Math.sin(this.t * 1.7 + i * 0.9 + phase) * 0.05);
        const gr = ctx.createLinearGradient(0, -size * 0.8, 0, 0);
        gr.addColorStop(0, c1); gr.addColorStop(1, c2);
        ctx.font = `900 ${size}px Rubik, sans-serif`;
        ctx.textAlign = 'center'; ctx.lineJoin = 'round';
        ctx.lineWidth = size * 0.22; ctx.strokeStyle = OUT; ctx.strokeText(ch, 0, 0);
        ctx.fillStyle = gr; ctx.fillText(ch, 0, 0);
        ctx.restore();
        cx += w;
      }
    };
    const a = ease.outBack(clamp(this.t / 1.2, 0, 1));
    ctx.save();
    ctx.translate(230, 120); ctx.scale(a, a); ctx.translate(-230, -120);
    // a compass rose: the far lands are out there
    ctx.save(); ctx.translate(230, 42); ctx.rotate(Math.sin(this.t * 0.9) * 0.12);
    ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = OUT;
    ctx.beginPath(); ctx.arc(0, 0, 21, 0, TAU); ctx.fillStyle = '#3a2a5a'; ctx.fill(); ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const r = i * Math.PI / 2 + Math.PI / 4;
      ctx.beginPath(); ctx.moveTo(Math.cos(r) * 22, Math.sin(r) * 22); ctx.lineTo(Math.cos(r + 0.5) * 7, Math.sin(r + 0.5) * 7); ctx.lineTo(Math.cos(r - 0.5) * 7, Math.sin(r - 0.5) * 7); ctx.closePath();
      ctx.fillStyle = '#c8b8f0'; ctx.fill(); ctx.lineWidth = 3; ctx.stroke();
    }
    for (let i = 0; i < 4; i++) {
      const r = i * Math.PI / 2 - Math.PI / 2;
      ctx.beginPath(); ctx.moveTo(Math.cos(r) * 36, Math.sin(r) * 36); ctx.lineTo(Math.cos(r + 0.42) * 9, Math.sin(r + 0.42) * 9); ctx.lineTo(Math.cos(r - 0.42) * 9, Math.sin(r - 0.42) * 9); ctx.closePath();
      ctx.fillStyle = i === 0 ? '#ff5a5a' : '#f2c23a'; ctx.fill(); ctx.lineWidth = 4; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fillStyle = '#fff3d8'; ctx.fill(); ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
    word('ЛЕГЕНДЫ', 230, 138, 66, '#ffe680', '#ff8a2a', 0);
    word('ДАЛЬНИХ ЗЕМЕЛЬ', 230, 196, 40, '#ffd0f0', '#c66ae8', 2);
    // the plaque: where the story is now
    const sub = logoSubtitle();
    if (sub) {
      ctx.font = '400 23px Pangolin, sans-serif';
      const pw = Math.max(210, ctx.measureText(sub.text).width + 44);
      rrect(ctx, 230 - pw / 2, 220, pw, 38, 16, sub.color, 4);
      text(ctx, sub.text, 230, 247, { size: 23, font: 'body', color: '#fff', align: 'center' });
    }
    ctx.restore();
  }
}

// ═══════════════════════════════ DEN (shop) ═══════════════════════════════
export class Den3D {
  is3d = true;
  t = 0;
  den: DenScene;
  scene: THREE.Scene;
  cam = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 300);
  bear: Rig<any>;
  hero: Rig<HeroAnim>;
  flame: THREE.Group;
  fireLight: THREE.PointLight;
  fx = new FX3();
  /** co-op: room chat + friends' Toshas around the fire */
  chat: ChatPanel | null = null;
  friends = new Map<string, { rig: HeroRig; g: THREE.Group; slot: number; ready: boolean; cheer: number; bubble: { text: string; t: number } | null }>();
  /** «Настройки» (button, Esc / Options, F1) */
  panel: SettingsPanel | null = null;
  constructor(visit: number) {
    const mp = coop.active;
    this.den = new DenScene(visit, mp ? {
      host: () => net.isHost,
      ready: () => !!net.me?.ready,
      toggleReady: () => net.setMeta({ ready: !net.me?.ready }),
      count: () => coopFlow.othersReady(),
      go: () => coopFlow.hostNext(),
      chat: () => this.chat?.open(),
      leave: () => { net.leave(); game.toMenu(); },
      next: coopFlow.nextTitle(),
    } : null, { settings: () => { this.panel = new SettingsPanel({ where: 'den', onClose: () => { this.panel = null; } }); } });
    if (mp) {
      this.chat = new ChatPanel({ x: 16, y: 58, w: 226, h: 300, onLine: (from, txt) => { const f = this.friends.get(from); if (f) f.bubble = { text: txt, t: 0 }; } });
      this.chat.attach();
    }
    const b = baseScene('#1a0e08', ['#2a160c', 30, 80], ['#ffd8a8', '#3a2010', 0.9], ['#ffc890', 1.2, [-0.4, 1, 0.6]]);
    this.scene = b.scene;
    this.scene.add(room({ theme: 'den', x0: -14, x1: 14, z0: -12, z1: 12, floorY: 0, wallH: 14 }).obj);
    this.scene.add(P.rug({ x: -3, y: 0, z: 1, w: 9, d: 7, color: '#a8343a' }).obj);
    // armchair
    const chair = new THREE.Group();
    const seat = mesh(new THREE.BoxGeometry(4.4, 1.4, 3.6), mat('#6a2a5a')); seat.position.y = 0.7; chair.add(seat);
    const back = mesh(new THREE.BoxGeometry(4.4, 4.2, 1), mat('#7a3a6a')); back.position.set(0, 2.1, -1.6); chair.add(back);
    for (const sx of [-1, 1]) { const arm = mesh(new THREE.BoxGeometry(0.9, 2.4, 3.6), mat('#7a3a6a')); arm.position.set(sx * 2.4, 1.2, 0); chair.add(arm); }
    chair.position.set(-7, 0, -3); chair.rotation.y = 0.5;
    this.scene.add(chair);
    this.bear = createBear();
    this.bear.root.position.set(-6.8, 1.35, -2.8); this.bear.root.rotation.y = 0.5;
    this.scene.add(this.bear.root);
    // fireplace
    const fp = new THREE.Group();
    const stone = mesh(new THREE.BoxGeometry(5, 4.5, 1.6), mat('#6a5a5a')); stone.position.y = 2.25; fp.add(stone);
    const hole = mesh(new THREE.BoxGeometry(3, 2.6, 0.4), basic('#140806')); hole.position.set(0, 1.4, 0.65); fp.add(hole);
    fp.position.set(2, 0, -11);
    this.scene.add(fp);
    this.flame = new THREE.Group();
    for (const [s, c, y] of [[0.9, '#ff6a2a', 0.9], [0.55, '#ffd04a', 0.75]] as const) {
      const f = mesh(new THREE.ConeGeometry(s, s * 2.2, 10), basic(c, { additive: true, opacity: 0.95 }), { cast: false, receive: false });
      f.position.y = y; this.flame.add(f);
    }
    noOutline(this.flame);
    this.flame.position.set(2, 0.4, -10.2);
    this.scene.add(this.flame);
    this.fireLight = new THREE.PointLight('#ff9a3a', 30, 30, 1.4);
    this.fireLight.position.set(2, 2, -9);
    this.scene.add(this.fireLight);
    // shelf with honey jars
    this.scene.add(P.shelfBoard({ x: -6, y: 6, z: -11.2, w: 8, d: 1.4, th: 0.3 }).obj);
    for (let i = 0; i < 4; i++) this.scene.add(P.jar({ x: -9 + i * 2, y: 6.3, z: -11.2, r: 0.6, h: 1.3, jam: 'honey' }).obj);
    this.hero = createHero(mp ? net.me?.look ?? profile.look : undefined);
    this.hero.root.position.set(-4.2, 0, 2.6); this.hero.root.rotation.y = -2.5;
    this.scene.add(this.hero.root);
    this.scene.add(this.fx.group);
    this.cam.position.set(2.5, 4.4, 10.5);
    this.cam.lookAt(-1.2, 2.4, -2);
  }
  update(dt: number) {
    this.t += dt;
    if (this.chat) {
      this.chat.update(dt, { allowOpen: !this.den.chapters && !this.panel });
      this.syncFriends(dt);
      const n = coopFlow.takeNotice(); // e.g. the host changed
      if (n) this.den.say(n);
    }
    if (this.panel) this.panel.update(dt);
    else this.den.update(dt);
    const talk = this.den.bubbleT < 1.5 ? Math.abs(Math.sin(this.t * 14)) : 0;
    this.bear.update(dt, { state: 'sit', talk, wave: 0, speed: 0 });
    this.hero.update(dt, heroAnim({ state: 'idle', expr: 'happy' }));
    const f = Math.sin(this.t * 11) * 0.12 + Math.sin(this.t * 6.3) * 0.08;
    this.flame.scale.set(1 - f * 0.4, 1 + f, 1 - f * 0.4);
    this.fireLight.intensity = 28 + f * 14;
    if (Math.random() < 0.4) this.fx.glow.emit(V(2 + rand(-0.6, 0.6), 1.4, -10), { count: 1, speed: [0.5, 1.4], dir: V(0, 1, 0), spread: 0.3, life: [0.6, 1.2], size: [0.05, 0.1], colors: ['#ffb02a', '#ffe14a', '#ff6a2a'], g: -0.5 });
    this.fx.update(dt);
  }
  render(ctx: C) {
    this.fx.setScale(RT.winH * (RT.r3?.pixelRatio ?? 1) * 0.9);
    render3(this.scene, this.cam);
    ctx.clearRect(0, 0, W, H);
    const head = toUI(this.bear.root.position.clone().add(V(0, 3.4, 0)), this.cam);
    if (this.chat) this.drawFriends(ctx);
    this.den.renderPanel(ctx, true, clamp(head.x - 40, 20, 260), clamp(head.y - 10, 120, 400));
    if (this.chat && !this.den.chapters) {
      this.chat.draw(ctx);
      drawMicBadge(ctx, 20, 26, { t: this.t });
    }
    this.panel?.draw(ctx);
  }
  /** co-op: friends stand around the rug (join order), cheer when they get ready */
  private syncFriends(dt: number) {
    // on the rug around my Tosha, turned toward the camera / the bear
    const spots: [number, number][] = [[-2.4, 1.6], [-6.6, 2.4], [-3.0, 0.0], [-1.6, 3.2], [-6.0, 0.4]];
    let i = 0;
    const seen = new Set<string>();
    for (const m of net.members.values()) {
      if (m.isMe) continue;
      seen.add(m.id);
      let f = this.friends.get(m.id);
      if (!f) {
        const rig = createHero(m.look);
        const g = new THREE.Group(); g.add(rig.root);
        this.scene.add(g);
        f = { rig, g, slot: i, ready: m.ready, cheer: 0, bubble: null };
        this.friends.set(m.id, f);
      }
      const sp = spots[i % spots.length];
      f.g.position.set(sp[0], 0, sp[1]);
      f.g.rotation.y = Math.atan2(2.5 - sp[0], 10.5 - sp[1]) - 0.5 + Math.sin(this.t * 0.4 + i) * 0.15;
      if (m.ready && !f.ready) f.cheer = 1.4;
      f.ready = m.ready;
      f.cheer = Math.max(0, f.cheer - dt);
      if (f.bubble) { f.bubble.t += dt; if (f.bubble.t > 6) f.bubble = null; }
      if (JSON.stringify(f.rig.look) !== JSON.stringify(m.look)) f.rig.setLook(m.look);
      f.rig.update(dt, heroAnim({ state: f.cheer > 0 ? 'cheer' : m.scene === 'den' ? 'idle' : 'sit', expr: m.ready ? 'happy' : 'normal', talk: m.speaking ? Math.abs(Math.sin(this.t * 14)) * 0.8 : 0 }));
      i++;
    }
    for (const [id, f] of this.friends) if (!seen.has(id)) { this.scene.remove(f.g); f.rig.dispose(); this.friends.delete(id); }
  }
  private drawFriends(ctx: C) {
    for (const [id, f] of this.friends) {
      const m = net.members.get(id);
      if (!m) continue;
      const p = toUI(f.g.position.clone().add(V(0, 1.3, 0)), this.cam);
      if (!p.vis) continue;
      ctx.font = '700 17px Rubik, sans-serif';
      const w = ctx.measureText(m.name).width + 20 + (m.isHost ? 20 : 0) + (m.ready ? 22 : 0);
      rrect(ctx, p.x - w / 2, p.y - 24, w, 26, 10, 'rgba(20,10,16,0.7)', 0);
      let x = p.x - w / 2 + 10;
      if (m.isHost) { drawCrown(ctx, x + 8, p.y - 11, 15); x += 20; }
      text(ctx, m.name, x, p.y - 5, { size: 17, weight: 700, color: m.look.tagColor || '#ffd34a' });
      if (m.ready) text(ctx, '✓', p.x + w / 2 - 16, p.y - 4, { size: 18, color: '#7ef08a', align: 'center', stroke: 3 });
      if (m.speaking || m.muted) drawSpeaker(ctx, p.x + w / 2 + 14, p.y - 11, 18, { speaking: m.speaking, muted: m.muted, t: this.t });
      if (f.bubble) {
        const a = clamp(Math.min(f.bubble.t / 0.15, (6 - f.bubble.t) / 0.6), 0, 1);
        ctx.save(); ctx.globalAlpha = a;
        ctx.font = '400 18px Pangolin, sans-serif';
        const lines = wrap(ctx, f.bubble.text, 220).slice(0, 3);
        const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 24, bh = lines.length * 22 + 14;
        rrect(ctx, p.x - bw / 2, p.y - 34 - bh, bw, bh, 12, '#fffaf0', 3);
        lines.forEach((l, k) => text(ctx, l, p.x, p.y - 34 - bh + 26 + k * 22, { size: 18, font: 'body', color: OUT, align: 'center' }));
        ctx.restore();
      }
    }
  }
  leave() {
    this.panel?.dispose();
    this.chat?.detach();
    for (const f of this.friends.values()) f.rig.dispose();
    this.friends.clear();
  }
}

// ═══════════════════════════════ STORY (intro / ending) ═══════════════════════════════
export class Story3D {
  is3d = true;
  t = 0;
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 900);
  dialog = new Dialog();
  fx = new FX3();
  co: Coroutine;
  skipHold = 0;
  done = false;
  bigText: { text: string; t: number; color: string } | null = null;
  fade = 0; flash = 0;
  updaters: ((dt: number) => void)[] = [];
  talkers: Record<string, number> = {};
  overlay: ((ctx: C) => void) | null = null;
  vignette = vignetteCanvas(W, H, 0.55);
  /** co-op: finished here, waiting for the room (host: for the others' ready / a timeout) */
  private coopT = 0;
  private coopSkip = false;
  private coopGone = false;
  constructor(public id: 'intro' | 'ending') {
    this.dialog.onSpeak = (who) => { this.talkers[who] = 0.3; };
    this.co = new Coroutine(id === 'intro' ? introScript(this) : endingScript(this));
  }
  say(who: Who, s: string, expr?: string) { return this.dialog.say(who, s, expr); }
  music(m: MusicName) { audio.playMusic(m); }
  big(s: string, color = '#ffffff') { this.bigText = { text: s, t: 0, color }; }
  talk(who: string) { return (this.talkers[who] ?? 0) > 0 ? Math.abs(Math.sin(this.t * 16)) : 0; }
  setScene(s: THREE.Scene) {
    this.scene = s;
    s.add(this.fx.group);
    this.updaters = [];
  }
  finish(skip = false) {
    if (this.done) return;
    this.done = true;
    this.dialog.close();
    // co-op: the host moves the room on; a client says it's ready and waits
    if (coop.active) { this.coopSkip = skip; if (!net.isHost) net.setMeta({ ready: true }); return; }
    game.advance();
  }
  private coopTick(dt: number) {
    this.coopT += dt;
    if (!net.isHost || this.coopGone) return;
    const [r, n] = coopFlow.othersReady();
    if (this.coopSkip || r >= n || this.coopT > 15 || this.skipHold > 0.8) { this.coopGone = true; coopFlow.hostNext(); }
  }
  update(dt: number) {
    this.t += dt;
    for (const k of Object.keys(this.talkers)) this.talkers[k] = Math.max(0, this.talkers[k] - dt * 3);
    this.dialog.update(dt);
    if (this.bigText) { this.bigText.t += dt; if (this.bigText.t > 1.6) this.bigText = null; }
    this.flash = Math.max(0, this.flash - dt * 2);
    if (input.down('back') || input.down('pause')) { this.skipHold += dt; if (this.skipHold > 0.8) this.finish(true); } else this.skipHold = 0;
    const waiting = this.done && coop.active;
    if (waiting) this.coopTick(dt);
    else this.co.update(dt);
    for (const u of this.updaters) u(dt);
    this.fx.update(dt);
    if (this.co.done) this.finish();
  }
  render(ctx: C) {
    this.fx.setScale(RT.winH * (RT.r3?.pixelRatio ?? 1) * 0.9);
    // every shot is framed for 16:9: a narrower window shows the same framing between the bars (not a cropped middle)
    this.cam.zoom = cineZoom();
    render3(this.scene, this.cam);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.vignette, 0, 0, W, H);
    this.overlay?.(ctx);
    if (this.bigText) {
      const b = this.bigText;
      const s = 1 + Math.max(0, 0.25 - b.t) * 3;
      ctx.save(); ctx.translate(W / 2, H / 2 - 60); ctx.scale(s, s); ctx.rotate(Math.sin(b.t * 30) * 0.03 * Math.max(0, 1 - b.t));
      ctx.globalAlpha = clamp((1.6 - b.t) * 3, 0, 1);
      text(ctx, b.text, 0, 0, { size: 96, color: b.color, align: 'center', base: 'middle', stroke: 14 });
      ctx.restore();
    }
    if (this.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${this.flash})`; ctx.fillRect(-2000, -2000, W + 4000, H + 4000); }
    if (this.fade > 0) { ctx.fillStyle = `rgba(10,4,6,${this.fade})`; ctx.fillRect(-2000, -2000, W + 4000, H + 4000); }
    ctx.fillStyle = '#0a0406'; ctx.fillRect(-2000, -2000, W + 4000, 2050); ctx.fillRect(-2000, H - 50, W + 4000, 2050);
    this.dialog.draw(ctx);
    if (this.done && coop.active) {
      const [r, n] = coopFlow.othersReady();
      const s = net.isHost ? (n ? `Ждём остальных (${r} из ${n})… Держи Esc — не ждать` : 'Поехали!') : 'Ждём остальных…';
      text(ctx, s, W / 2, H - 16, { size: 20, font: 'body', color: '#fff3d8', align: 'center', stroke: 4, alpha: 0.65 + Math.sin(this.t * 3) * 0.3 });
      return;
    }
    text(ctx, this.skipHold > 0 ? 'Пропускаем...' : 'Держи Esc — пропустить', W - 20, 32, { size: 15, font: 'body', color: '#f6ecd2', align: 'right', alpha: this.skipHold > 0 ? 0.9 : 0.4 });
  }
}

// ── shared builders for the story scenes ──
function forestScene(S: Story3D) {
  const b = baseScene('#0e1030', ['#1a1a44', 40, 170], ['#9aa8f0', '#2a2a40', 1.15], ['#c8d6ff', 2.2, [-0.5, 1, 0.3]]);
  const sc = b.scene;
  sc.add(skySphere('#080a24', '#2a1e4a'));
  const ground = mesh(new THREE.PlaneGeometry(500, 500), mat('#22331f'));
  ground.rotation.x = -Math.PI / 2; sc.add(ground);
  const path = mesh(new THREE.PlaneGeometry(500, 5), mat('#4a3e2c'));
  path.rotation.x = -Math.PI / 2; path.position.y = 0.01; sc.add(path);
  // trees
  const R = srand(9);
  const n = 220;
  const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 9, 7), mat('#162a1e'), n);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.45, 0.6, 3, 6), mat('#2a1c14'), n);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    let x = R() * 300 - 150, z = R() * 200 - 100;
    if (Math.abs(z) < 7) z += Math.sign(z || 1) * 9;
    const s = 0.8 + R() * 1.1;
    m4.compose(V(x, 3 * s + 1.5 * s, z), new THREE.Quaternion(), V(s, s, s)); cone.setMatrixAt(i, m4);
    m4.compose(V(x, 1.5 * s, z), new THREE.Quaternion(), V(s, s, s)); trunk.setMatrixAt(i, m4);
  }
  cone.castShadow = trunk.castShadow = true;
  sc.add(cone, trunk);
  const moon = mesh(new THREE.SphereGeometry(10, 24, 16), basic('#fff6d0', { fog: false }));
  moon.position.set(-60, 90, -200); noOutline(moon); sc.add(moon);
  S.setScene(sc);
  S.updaters.push(() => {
    if (Math.random() < 0.4) S.fx.glow.emit(V(S.cam.position.x + rand(-20, 20), rand(0.5, 5), rand(-14, 10)), { count: 1, speed: [0.1, 0.4], life: [1.5, 3], size: [0.08, 0.14], colors: ['#d8ff7a', '#f0ffb0'], g: 0 });
  });
}

function shaftScene(S: Story3D, tint: string, light: string) {
  const b = baseScene('#0a0604', ['#140c08', 10, 60], [light, '#1a0e08', 0.9], ['#ffd8a0', 0.8, [0, 1, 0.2]]);
  const sc = b.scene;
  const tex = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = tint; g.fillRect(0, 0, w, h);
    const R = srand(4);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(0,0,0,${0.1 + R() * 0.25})`; g.beginPath(); g.arc(R() * w, R() * h, 2 + R() * 10, 0, TAU); g.fill(); }
    g.strokeStyle = '#5a3a1a'; g.lineWidth = 5;
    for (let i = 0; i < 16; i++) { const x = R() * w, y = R() * h; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 20, y + 30, x + R() * 40 - 20, y + 70); g.stroke(); }
    for (let i = 0; i < 30; i++) { g.fillStyle = '#7a6a58'; g.beginPath(); g.ellipse(R() * w, R() * h, 6 + R() * 12, 4 + R() * 8, 0, 0, TAU); g.fill(); }
  }, { repeat: [3, 6] });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 300, 24, 1, true), new THREE.MeshToonMaterial({ map: tex, side: THREE.BackSide }));
  shaft.position.y = -100;
  sc.add(shaft);
  S.setScene(sc);
  return tex;
}

// ── INTRO ──
// Night: Тоша and Бублик take a shortcut home through the woods at the edge of Хрумляндия (co-op: the friends walk with
// them). The ground cracks under Тоша; Бублик stretches after him — not long enough yet — and then the grass under the
// dog gives way too: an old overgrown well by the path (the Moon Well: the ending climbs out of it). Тоша tumbles down a
// crack; Бублик lands in the well's old bucket and starts the slow ride down on its rope (it creaks all night: the bear
// hears it, and the bucket brings him down into the throne room in the end).
function* introScript(S: Story3D): Script {
  forestScene(S);
  S.music('forest');
  const team = coop.active;
  const others = team ? [...net.members.values()].filter((m) => !m.isMe).slice(0, 5) : [];
  const myLook = team ? net.me?.look ?? profile.look : undefined;
  const hero = createHero(myLook); const dog = createDog();
  const hr = new THREE.Group(); hr.add(hero.root); const dr = new THREE.Group(); dr.add(dog.root);
  hr.rotation.y = Math.PI / 2; dr.rotation.y = Math.PI / 2;
  hr.position.set(-10, 0, 0.8); dr.position.set(-12.2, 0, -0.8);
  S.scene.add(hr, dr);
  // co-op: the friends walk along behind, each in their own look
  const FR: [number, number][] = [[-2.1, 2.3], [-3.7, 0.9], [-4.6, 2.7], [-5.9, 0.3], [-6.7, 2.0]];
  const friends = others.map((m, i) => {
    const rig = createHero(m.look); const g = new THREE.Group(); g.add(rig.root);
    g.rotation.y = Math.PI / 2; g.position.set(hr.position.x + FR[i][0], 0, FR[i][1]);
    S.scene.add(g);
    return { rig, g };
  });
  const st = {
    walk: 1, heroState: 'walk' as HeroAnim['state'], heroExpr: 'happy' as HeroAnim['expr'],
    dogState: 'walk' as 'walk' | 'idle' | 'fly', dogExpr: 'happy' as 'normal' | 'happy' | 'angry', stretch: 1,
    fallH: 0, fallD: 0, fallF: 0,
  };
  S.updaters.push((dt) => {
    hr.position.x += dt * 1.7 * st.walk; dr.position.x += dt * 1.7 * st.walk;
    hr.position.y = -st.fallH * 8; dr.position.y = -st.fallD * 8;
    hero.update(dt, heroAnim({ state: st.heroState, speed: 0.4 * st.walk, expr: st.heroExpr, talk: S.talk('hero') }));
    dog.update(dt, { state: st.dogState, speed: 0.4 * st.walk, talk: S.talk('dog'), stretch: st.stretch, expr: st.dogExpr });
    for (const f of friends) {
      f.g.position.x += dt * 1.7 * st.walk; f.g.position.y = -st.fallF * 8;
      f.rig.update(dt, heroAnim({ state: st.heroState, speed: 0.4 * st.walk, expr: st.heroExpr }));
    }
    if (st.walk > 0) {
      S.cam.position.set(hr.position.x + 3, 2.6, 8.5);
      S.cam.lookAt(hr.position.x - 1, 1.2, 0);
    }
  });
  yield wait(1.4);
  yield S.say('narrator', team
    ? 'Ночь. Тоша с друзьями и пёс Бублик срезали дорогу домой — через лес на краю Хрумляндии.'
    : 'Ночь. Тоша и его пёс Бублик срезали дорогу домой — через лес на краю Хрумляндии.');
  yield S.say('dog', 'Тоша, ещё чуть-чуть — и выйдем к дороге. Я так голоден, что съел бы целый пирог!');
  yield S.say('hero', 'А я — целого короля! С короной!', 'happy');
  yield S.say('dog', 'Хе-хе. Только не настоящего.');
  yield wait(0.5);
  st.walk = 0; st.heroState = 'idle'; st.dogState = 'idle'; st.heroExpr = 'scared';
  audio.sfx('thud', { pitch: 0.6 });
  yield wait(0.4);
  yield S.say('hero', 'Ой... Ты слышал?', 'scared');
  // the ground cracks under Тоша (and the friends)
  audio.sfx('break', { pitch: 0.5 }); audio.sfx('bigSlam');
  S.big('КРРРАК!', '#ffd34a');
  const hole = (x: number, z: number, r: number) => {
    const h = new THREE.Mesh(new THREE.CircleGeometry(r, 28), new THREE.MeshBasicMaterial({ color: '#050302', polygonOffset: true, polygonOffsetFactor: -4 }));
    h.rotation.x = -Math.PI / 2; h.position.set(x, 0.03, z); h.scale.setScalar(0.01);
    S.scene.add(h);
    return h;
  };
  const holes = [hole(hr.position.x, hr.position.z, 1.6), ...friends.map((f) => hole(f.g.position.x, f.g.position.z, 1.25))];
  const cracks = new THREE.Group();
  const R = srand(3);
  for (let i = 0; i < 9; i++) {
    const c = mesh(new THREE.BoxGeometry(rand(2, 4), 0.05, 0.12), basic('#050302'), { cast: false, receive: false });
    c.position.set(hr.position.x - 1 + R() * 2 - 1, 0.04, R() * 2 - 1); c.rotation.y = R() * TAU;
    cracks.add(c);
  }
  S.scene.add(cracks);
  S.cam.position.set(hr.position.x + 4, 5, 9); S.cam.lookAt(hr.position.x - 1.2, 0, 0);
  yield tween(0.35, (k) => { for (const h of holes) h.scale.setScalar(Math.max(0.01, ease.outBack(k))); });
  audio.sfx('fall');
  st.heroState = 'tumble';
  // Бублик throws himself after him: the stretchy dog stretches as long as he can — and it isn't long enough (yet)
  dr.rotation.y = Math.atan2(hr.position.x - dr.position.x, hr.position.z - dr.position.z);
  st.dogExpr = 'angry';
  audio.sfx('whoosh', { pitch: 1.2 });
  yield all(
    S.say('dog', team ? 'Ребята! Хватайтесь!' : 'Тоша! Хватайся!', 'angry'),
    tween(0.75, (k) => { st.fallH = k * 0.07; st.fallF = k * 0.1; st.stretch = 1 + ease.outCubic(k) * 2.7; }),
  );
  // (he slips through, just past the dog's nose)
  yield tween(0.5, (k) => { st.fallH = lerp(0.07, 1, k * k); st.fallF = lerp(0.1, 1, k); });
  st.dogExpr = 'normal';
  yield S.say('dog', 'Не достал...');
  // ...and the grass under the dog gives way: an old well by the path, hidden in the weeds
  audio.sfx('break', { pitch: 0.85 });
  const wellHole = hole(dr.position.x, dr.position.z, 1.3);
  const wellRim = mesh(new THREE.CylinderGeometry(1.35, 1.45, 0.42, 22, 1, true), mat('#8a8676', { side: THREE.DoubleSide }));
  wellRim.position.set(dr.position.x, 0.2, dr.position.z); wellRim.scale.set(0.01, 1, 0.01);
  S.scene.add(wellRim);
  S.cam.position.set(dr.position.x + 3.5, 3.2, dr.position.z + 6); S.cam.lookAt(dr.position.x, 0.2, dr.position.z);
  yield tween(0.3, (k) => { const s = Math.max(0.01, ease.outBack(k)); wellHole.scale.setScalar(s); wellRim.scale.set(s, 1, s); });
  st.dogState = 'fly'; st.dogExpr = 'normal';
  audio.sfx('fall', { pitch: 1.3 });
  yield tween(0.85, (k) => { st.fallD = k * k; st.stretch = lerp(st.stretch, 1, Math.min(1, k * 3)); });
  yield wait(0.3);
  // falling shaft
  const tex = shaftScene(S, '#4a3020', '#ffd8a0');
  const fallHero = createHero(myLook); const fh = new THREE.Group(); fh.add(fallHero.root); S.scene.add(fh);
  const fallFriends = others.slice(0, 3).map((m, i) => {
    const rig = createHero(m.look); const g = new THREE.Group(); g.add(rig.root); S.scene.add(g);
    return { rig, g, a: (i + 1) * 2.1 };
  });
  audio.playMusic('tension');
  S.updaters.push((dt) => {
    tex.offset.y += dt * 2.2;
    fh.rotation.x += dt * 4; fh.rotation.z += dt * 2.6;
    fh.position.set(Math.sin(S.t * 2) * 1.2, -3, Math.cos(S.t * 1.6) * 1.2);
    fallHero.update(dt, heroAnim({ state: 'tumble', expr: 'scared', talk: S.talk('hero') }));
    for (const f of fallFriends) {
      f.g.rotation.x += dt * 3.4; f.g.rotation.z -= dt * 2.2;
      f.g.position.set(Math.cos(S.t * 0.9 + f.a) * 3.4, -4.5 - Math.sin(S.t * 1.3 + f.a), Math.sin(S.t * 0.9 + f.a) * 3.4);
      f.rig.update(dt, heroAnim({ state: 'tumble', expr: 'scared' }));
    }
    if (Math.random() < 0.9) S.fx.emit(V(rand(-5, 5), -18, rand(-5, 5)), { count: 2, speed: [30, 40], dir: V(0, 1, 0), spread: 0.02, life: [0.4, 0.6], size: [0.05, 0.08], colors: ['#ffffff'] });
  });
  S.cam.position.set(0, 6, 0.01); S.cam.lookAt(0, -3, 0);
  yield S.say('hero', 'А-А-А-А-А-А!!!', 'scared');
  yield S.say('narrator', team
    ? 'Ребята летели вниз долго-долго. А Бублик провалился в старый колодец у тропы...'
    : 'Тоша летел вниз долго-долго. А Бублик провалился в старый колодец у тропы...');
  // the dog's slow ride down the well, in its old bucket on a long rope
  const tex2 = shaftScene(S, '#2e3a22', '#e0ffd0');
  const d2 = createDog(); const dg = new THREE.Group(); dg.add(d2.root); S.scene.add(dg);
  dg.position.set(0.05, -2.12, 0); dg.rotation.y = Math.PI / 2;
  const pail = O.bucket(); pail.scale.setScalar(2); pail.position.set(0, -2.75, 0); S.scene.add(pail);
  const rope = mesh(new THREE.CylinderGeometry(0.035, 0.035, 42, 5), mat('#b8955e'));
  rope.position.set(0, -1.25 + 21, 0); S.scene.add(rope);
  S.updaters.push((dt) => {
    tex2.offset.y += dt * 0.08;
    const bob = Math.sin(S.t * 1.2) * 0.1;
    dg.position.y = -2.12 + bob; pail.position.y = -2.75 + bob; rope.position.y = 19.75 + bob;
    pail.rotation.z = Math.sin(S.t * 0.9) * 0.05; dg.rotation.z = pail.rotation.z;
    d2.update(dt, { state: 'sit', speed: 0, talk: S.talk('dog'), stretch: 1, expr: 'normal' });
  });
  // (the bucket framed in the upper part of the shot, clear of the dialog box)
  S.cam.position.set(3.4, -0.7, 4.4); S.cam.lookAt(0, -2.75, 0);
  yield wait(1);
  yield S.say('dog', '...Хм. Ведро. Верёвка. Похоже, спускаться я буду очень долго.');
  yield S.say('dog', team ? 'Держитесь, ребята. Я вас найду. Рано или... очень поздно.' : 'Держись, Тоша. Я тебя найду. Рано или... очень поздно.');
  // impact
  S.fade = 1;
  audio.stopMusic(0.2);
  audio.sfx('bigSlam');
  S.flash = 0.8;
  S.big('БУМ!', '#ff8a2a');
  yield wait(1.8);
}

// ── ENDING ──
// The Moon Well: a deep round shaft lined with mossy stone that comes out as an old well in a forest clearing on a
// hilltop. Бублик stretches from the floor to the rim as a living ladder; Тоша and Вторник climb him up into a sunrise
// over misty hills, then the three sit on a fallen log. One continuous world (shaft + clearing), cut into camera shots.

const W_UI = W;
const EW = { R: 3.3, FLOOR: -32, RIM: 1.02, SUN_AZ: 0.12 };
/** the long dog leans on the −Z wall of the shaft (toward the sunrise) */
const DOG_SIDE = V(0, 0, -1);
const LOG_P = V(0.3, 0, -13.2);
/** the climbing dog's head/rump pieces are drawn a bit bigger so the "ladder" reads from far away */
const DOG_S = 1.5;
/** chest / rump centres in the dog rig's local space (models/dog.ts: BODY_Y, RUMP_Z, RUMP_Z + SPAN) */
const DOG_FRONT = V(0, 0.24, 0.22);
const DOG_RUMP = V(0, 0.24, -0.3);
const isGroup = (o: THREE.Object3D): o is THREE.Group => (o as THREE.Group).isGroup === true;
const nearly = (a: number, b: number) => Math.abs(a - b) < 1e-3;
const angDist = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** hilltop clearing: flat around the well and the log, falling away toward the sunrise (−Z), gently rising elsewhere */
function endGroundH(x: number, z: number) {
  const r = Math.hypot(x, z);
  const toward = r > 1e-3 ? -z / r : 0;
  const f = O.smoothstep(0.0, 0.55, toward);
  const dl = Math.hypot(x - LOG_P.x, (z - LOG_P.z) * 1.6);
  const und = (0.3 * Math.sin(x * 0.23 + 1.3) * Math.cos(z * 0.19 - 0.4) + 0.2 * Math.sin((x - z) * 0.11 + 0.5) + 0.08 * Math.sin(x * 0.7 + z * 0.5))
    * O.smoothstep(4.5, 10, r) * O.smoothstep(2.2, 6, dl);
  const drop = f * 42 * O.smoothstep(18, 62, r);
  const rise = (1 - f) * (3 * O.smoothstep(24, 80, r) + 1.4 * Math.sin(Math.atan2(z, x) * 3 + 1) * O.smoothstep(30, 80, r));
  return und - drop + rise;
}

function furTex() {
  return canvasTex(128, 128, (g, w, h) => {
    const R = srand(8);
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, PAL.dogBelly); bg.addColorStop(0.15, PAL.dogBelly); bg.addColorStop(0.27, PAL.dog);
    bg.addColorStop(0.73, PAL.dog); bg.addColorStop(0.85, PAL.dogBelly); bg.addColorStop(1, PAL.dogBelly);
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const sp = g.createLinearGradient(0, h * 0.38, 0, h * 0.62);
    sp.addColorStop(0, 'rgba(122,62,28,0)'); sp.addColorStop(0.3, PAL.dogDark); sp.addColorStop(0.7, PAL.dogDark); sp.addColorStop(1, 'rgba(122,62,28,0)');
    g.fillStyle = sp; g.fillRect(0, h * 0.38, w, h * 0.24);
    // soft fur mottling (round, not streaky — it must not read as bark)
    for (let i = 0; i < 40; i++) {
      const x = R() * w, y = h * (0.2 + R() * 0.6), r = 4 + R() * 9;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const c = R() < 0.5 ? '150,78,34' : '196,118,62';
      gr.addColorStop(0, `rgba(${c},0.35)`); gr.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, { wrap: true });
}

interface EndWorld {
  scene: THREE.Scene;
  hemi: THREE.HemisphereLight;
  shaftLights: { l: THREE.PointLight; i: number }[];
  key: THREE.PointLight;
  /** light beams / opening halo: only shown while the camera is down in the shaft */
  beams: ((k: number) => void)[];
  birds: ReturnType<typeof O.birdFlock>;
  logTop: number;
  setSun(el: number): void;
}

function buildEndingWorld(): EndWorld {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e9bba0');
  scene.fog = new THREE.Fog('#e3b6a2', 45, 360);
  const sunDir = O.dirAzEl(EW.SUN_AZ, 0.06);
  const R = srand(21);

  // ── sky, distant hills, clouds, valley mist ──
  const sky = O.skyDome(
    { zenith: '#27458c', upper: '#6d86c8', lower: '#f2a78e', horizon: '#ffd590', anti: '#c39ab6', glow: '#ffac58', sun: '#fff5da', moon: '#f4f2ff' },
    sunDir, { sunSize: 0.046, moonDir: V(-0.035, 1, -0.05), moonSize: 0.03 });
  scene.add(sky.mesh);
  scene.add(O.hillRings([
    { r: 150, base: -21, amp: 12, seed: 11, color: '#4b5d7a', rim: '#9d7f8c', haze: '#c99c9e', bumps: 2.2, seg: 1500 },
    { r: 215, base: -15, amp: 18, seed: 12, color: '#6a7395', rim: '#b8939d', haze: '#d9a9a2', bumps: 2.4, seg: 1500 },
    { r: 300, base: -7, amp: 26, seed: 13, color: '#9389a8', rim: '#d8aaa4', haze: '#e9baa6', bumps: 1.4, seg: 1000 },
    { r: 410, base: 3, amp: 38, seed: 14, color: '#b99dad', rim: '#efc2a8', haze: '#f3caaa', seg: 640, notch: 0.45 },
    { r: 540, base: 12, amp: 64, seed: 15, color: '#d4b1ae', rim: '#f8d6ae', haze: '#f8dab0', seg: 512, notch: 0.8 },
  ], EW.SUN_AZ, '#8b8fc2'));
  scene.add(O.cloudBank([
    { az: -0.55, el: 0.13, dist: 640, w: 150, h: 26, seed: 1 },
    { az: 0.42, el: 0.17, dist: 660, w: 120, h: 22, seed: 2 },
    { az: 0.05, el: 0.27, dist: 700, w: 170, h: 24, seed: 3 },
    { az: -1.05, el: 0.2, dist: 650, w: 110, h: 20, seed: 4 },
    { az: 0.95, el: 0.1, dist: 620, w: 130, h: 22, seed: 5 },
    { az: -0.25, el: 0.07, dist: 600, w: 90, h: 14, seed: 6 },
  ], EW.SUN_AZ, { top: '#b4a2c8', bottom: '#ffb489', glow: '#ffe4b0' }));
  for (const [y, op, sd, c] of [[-36, 0.32, 3, '#ffe8d6'], [-31, 0.22, 4, '#fbdcca'], [-26, 0.14, 5, '#f6d2c4']] as const) {
    scene.add(O.mistSheet({ y, r0: 22, r1: 160, color: c, opacity: op, seed: sd }));
  }
  const glare = O.sunGlare('#ffb35e', 80, 0.5);
  scene.add(glare);

  // ── lights: warm low sun with long shadows, cool sky fill ──
  const hemi = new THREE.HemisphereLight('#a3b6f0', '#7a6242', 0.95);
  const sun = new THREE.DirectionalLight('#ffbd7e', 3.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 300;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
  sun.target.position.set(0, 0, -6);
  scene.add(hemi, sun, sun.target);
  const setSun = (el: number) => {
    O.dirAzEl(EW.SUN_AZ, el, sunDir);
    sky.setSun(sunDir);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 130);
    glare.position.copy(sunDir).multiplyScalar(130);
  };
  setSun(0.06);
  // inside the shaft: cool light from the opening, a warm sliver of dawn, teal mushroom glow at the bottom
  const shaftLights = [
    { l: new THREE.PointLight('#d8e4ff', 26, 36, 1.4), i: 26 },
    { l: new THREE.PointLight('#ffcf9c', 10, 14, 1.2), i: 10 },
    { l: new THREE.PointLight('#6fe2cc', 6, 8, 1.4), i: 6 },
  ];
  shaftLights[0].l.position.set(0.4, -2.0, 0.8);
  shaftLights[1].l.position.set(-0.6, 0.2, 1.6);
  shaftLights[2].l.position.set(-1.5, EW.FLOOR + 0.8, 1.2);
  const key = new THREE.PointLight('#eef2ff', 0, 7, 1.2);
  for (const s of shaftLights) scene.add(s.l);
  scene.add(key);

  // ── terrain ──
  const C = (h: string) => new THREE.Color(h);
  const gA = C('#6f9e3c'), gB = C('#93b04a'), gDirt = C('#8c7652'), gDeep = C('#4e7840'), gFar = C('#6c8a5c');
  scene.add(O.terrainRing({
    r0: EW.R + 0.6, r1: 130, seg: 160, rings: 90, power: 2.2, seed: 9, height: endGroundH,
    color: (x, z, y, R2) => {
      const r = Math.hypot(x, z);
      const patch = 0.5 + 0.5 * Math.sin(x * 0.35 + Math.sin(z * 0.3) * 2) * Math.cos(z * 0.27 - x * 0.1);
      const c = gA.clone().lerp(gB, patch * 0.7 + R2() * 0.15);
      c.lerp(gDirt, 0.6 * (1 - O.smoothstep(EW.R + 0.8, EW.R + 2.8, r)));
      const dl = Math.hypot(x - LOG_P.x, (z - LOG_P.z) * 1.5);
      c.lerp(gDirt, 0.35 * (1 - O.smoothstep(1.4, 3.2, dl)));
      c.lerp(gDeep, O.smoothstep(-1, -22, y) * 0.65);
      c.lerp(gFar, O.smoothstep(60, 125, r) * 0.5);
      return c;
    },
  }));

  // ── forest around the clearing, trees down the slopes, two framing trees at the crest ──
  const trees: O.TreeSpot[] = [];
  const addTree = (x: number, z: number, s: number, kind?: 'pine' | 'round') => trees.push({ x, y: endGroundH(x, z), z, s, kind: kind ?? (R() < 0.55 ? 'pine' : 'round') });
  for (let i = 0; i < 700 && trees.length < 190; i++) {
    const a = R() * TAU, r = 17.5 + Math.pow(R(), 0.8) * 42;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (-z / r > 0.4) continue;
    addTree(x, z, 2.0 + R() * 1.5 + r * 0.015);
  }
  const nRing = trees.length;
  for (let i = 0; i < 1600 && trees.length < nRing + 230; i++) {
    const a = (R() - 0.5) * 2.6, r = 26 + R() * 100;
    if (r < 34 && Math.abs(a) < 0.45) continue;
    addTree(Math.sin(a) * r, -Math.cos(a) * r, 1.6 + R() * 1.3);
  }
  addTree(-10.5, -19.5, 3.8, 'round'); addTree(-13.5, -17, 3.0, 'pine'); addTree(12, -18.5, 3.4, 'pine'); addTree(14.5, -16, 2.6, 'round');
  scene.add(O.treeInstances(trees, 22));

  // ── grass, flowers, rocks ──
  const grass: O.GroundSpot[] = [];
  const gAt = (x: number, z: number, s: number) => grass.push({ x, y: endGroundH(x, z), z, s });
  for (let i = 0; i < 3400; i++) { const a = R() * TAU, r = EW.R + 0.7 + Math.sqrt(R()) * 22; gAt(Math.cos(a) * r, Math.sin(a) * r, 0.55 + R() * 0.6); }
  for (let i = 0; i < 170; i++) { const a = R() * TAU, r = EW.R + 0.65 + R() * 0.5; gAt(Math.cos(a) * r, Math.sin(a) * r, 0.8 + R() * 0.5); }
  for (let i = 0; i < 90; i++) gAt(LOG_P.x + (R() - 0.5) * 5.2, LOG_P.z + (R() - 0.5) * 1.6, 0.7 + R() * 0.5);
  scene.add(O.grassTufts(grass, ['#6e9c38', '#5f8e34', '#86aa46', '#9cb24c', '#7aa03e'], 31));
  const flowers: O.GroundSpot[] = [];
  for (let c = 0; c < 42; c++) {
    const a = R() * TAU, r = 4.5 + R() * 17;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    for (let i = 0; i < 12; i++) { const x = cx + (R() - 0.5) * 2.4, z = cz + (R() - 0.5) * 2.4; flowers.push({ x, y: endGroundH(x, z), z, s: 0.9 + R() * 0.6 }); }
  }
  scene.add(O.flowerPatch(flowers, ['#fff6e8', '#ffd84a', '#ff8fb0', '#c99cff', '#7fb6ff', '#ffffff'], 41));
  const rk: O.GroundSpot[] = [];
  for (let i = 0; i < 60 && rk.length < 22; i++) {
    const a = R() * TAU, r = 6 + R() * 18;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - LOG_P.x, z - LOG_P.z) < 3.2 || Math.hypot(x + 1, z + 5.8) < 2.5 || r < EW.R + 2) continue;
    rk.push({ x, y: endGroundH(x, z), z, s: 0.25 + R() * 0.6 });
  }
  scene.add(O.rocks(rk, ['#9a968a', '#8a8a80', '#a8a090'], 51));

  // ── the Moon Well: stone shaft + well wall + capstones ──
  const wall = O.stoneRingWall({
    rIn: EW.R, thick: 0.72, y0: EW.FLOOR - 0.3, y1: 0.8, seed: 61, course: [0.42, 0.62], blockLen: 0.9, protrude: 0.09,
    tint: (y, _a, R2) => {
      const above = y > -0.15;
      const pal = above ? ['#aaa696', '#9d9a8c', '#b4ab98', '#929484'] : ['#8b8f86', '#7e857c', '#938b7c', '#727c74', '#7b8170'];
      const c = new THREE.Color(pal[Math.floor(R2() * pal.length)]).multiplyScalar(0.86 + R2() * 0.26);
      if (!above) {
        const k = O.smoothstep(EW.FLOOR, -1.5, y);
        if (R2() < 0.22 + 0.3 * (1 - k)) c.lerp(new THREE.Color('#56703c'), 0.4);
        c.lerp(new THREE.Color('#5b6b86'), 0.22 * (1 - k));
        c.multiplyScalar(0.3 + 0.7 * k * k);
      } else if (R2() < 0.3) c.lerp(new THREE.Color('#7a9446'), 0.3);
      return c;
    },
  });
  scene.add(wall.mesh);
  scene.add(O.ringCap({ rIn: EW.R - 0.12, rOut: EW.R + 0.86, y: 0.8, h: 0.22, n: 22, seed: 62, color: '#b2ab9a' }));
  const mortarH = 0.95 - (EW.FLOOR - 0.3);
  const mortar = mesh(new THREE.CylinderGeometry(EW.R + 0.3, EW.R + 0.3, mortarH, 28, 1, true), mat('#34312a', { side: THREE.DoubleSide }), { cast: false });
  mortar.position.y = 0.95 - mortarH / 2;
  scene.add(mortar);

  const dogA = -Math.PI / 2;
  type Blob = Parameters<typeof O.blobs>[0][number];
  const moss: Blob[] = [];
  const green = (deep: boolean) => new THREE.Color(deep ? (R() < 0.5 ? '#4d6e34' : '#5f7d3a') : (R() < 0.5 ? '#6f9a3c' : '#86ab48'));
  for (const tp of wall.tops) {
    const below = tp.p.y < -0.2;
    if (below && angDist(tp.a, dogA) < 0.55) continue;
    const k = O.smoothstep(EW.FLOOR, 0, tp.p.y);
    const chance = below ? 0.1 + 0.12 * (1 - k) + 0.12 * O.smoothstep(-6, 0, tp.p.y) : 0.45;
    if (R() > chance) continue;
    const inward = V(-Math.cos(tp.a), 0, -Math.sin(tp.a));
    const rot = new THREE.Euler(0, Math.PI / 2 - tp.a, 0);
    moss.push({ p: tp.p.clone().addScaledVector(inward, 0.02), s: V(0.28 + R() * 0.35, 0.045 + R() * 0.035, 0.06 + R() * 0.05), rot, c: green(below) });
    if (below && R() < 0.4) { // hanging moss beard
      const hl = 0.2 + R() * 0.4;
      moss.push({ p: tp.p.clone().addScaledVector(inward, 0.0).add(V(0, -hl * 0.75, 0)), s: V(0.07 + R() * 0.1, hl, 0.03), rot, c: green(true).multiplyScalar(0.8) });
    }
  }
  for (let i = 0; i < 40; i++) { // cushions on the rim
    const a = R() * TAU;
    if (angDist(a, dogA) < 0.55) continue;
    const r = EW.R + 0.05 + R() * 0.75;
    moss.push({ p: V(Math.cos(a) * r, 1.03, Math.sin(a) * r), s: V(0.12 + R() * 0.16, 0.04 + R() * 0.03, 0.09 + R() * 0.12), rot: new THREE.Euler(0, R() * TAU, 0), c: green(false) });
  }
  for (let i = 0; i < 70; i++) { // ivy on the outside of the well
    const a = R() * TAU, y = R() * 0.75;
    const r = EW.R + 0.7;
    moss.push({ p: V(Math.cos(a) * r, y, Math.sin(a) * r), s: V(0.1, 0.07, 0.025), rot: new THREE.Euler(R() - 0.5, Math.PI / 2 - a, R() * TAU), c: green(R() < 0.4) });
  }
  // ledges with ferns
  const ferns: O.GroundSpot[] = [];
  for (const [a, y] of [[0.25, -6.2], [1.1, -11.6], [2.05, -17.3], [2.95, -22.8], [3.75, -27.2], [0.7, -24.5]] as const) {
    const k = O.smoothstep(EW.FLOOR, 0, y);
    const lg = mesh(new THREE.BoxGeometry(1.25, 0.2, 0.62), mat(new THREE.Color('#8a877c').multiplyScalar(0.45 + 0.55 * k)));
    const r = EW.R - 0.2;
    lg.position.set(Math.cos(a) * r, y, Math.sin(a) * r); lg.rotation.y = Math.PI / 2 - a;
    scene.add(lg);
    for (let i = 0; i < 3; i++) {
      const da = (R() - 0.5) * 0.3, rr = r - 0.05 - R() * 0.15;
      moss.push({ p: V(Math.cos(a + da) * rr, y + 0.1, Math.sin(a + da) * rr), s: V(0.2 + R() * 0.15, 0.06, 0.15), rot: new THREE.Euler(0, R() * 3, 0), c: green(true) });
      ferns.push({ x: Math.cos(a + da) * rr, y: y + 0.1, z: Math.sin(a + da) * rr, s: 0.9 + R() * 0.5 });
    }
  }
  // roots breaking through the upper shaft
  const rootMat = mat('#5c402c');
  for (let i = 0; i < 7; i++) {
    let a = R() * TAU;
    if (angDist(a, dogA) < 0.6) a += 1.4;
    const y0 = -0.4 - R() * 5;
    const c = (r: number, y: number, da = 0) => V(Math.cos(a + da) * r, y, Math.sin(a + da) * r);
    const curve = new THREE.CatmullRomCurve3([c(EW.R + 0.2, y0), c(EW.R - 0.25, y0 - 0.35, 0.05), c(EW.R - 0.45 - R() * 0.3, y0 - 1.2, -0.06), c(EW.R - 0.35 - R() * 0.3, y0 - 2.2 - R() * 1.8, 0.08)]);
    scene.add(mesh(O.taperTube(curve, 0.065 + R() * 0.035, 0.01, 20, 6), rootMat));
  }
  // vines hanging over the rim
  const vineMat = mat('#4a6e2c');
  for (let i = 0; i < 11; i++) {
    let a = R() * TAU;
    if (angDist(a, dogA) < 0.5) a += 1.2;
    const len = 3 + R() * 10;
    const pts = [V(Math.cos(a) * (EW.R + 0.35), 1.05, Math.sin(a) * (EW.R + 0.35))];
    for (let k = 0; k <= 6; k++) {
      const y = 0.85 - (k / 6) * len, da = Math.sin(k * 1.3 + i) * 0.04, r = EW.R - 0.08 - R() * 0.06;
      pts.push(V(Math.cos(a + da) * r, y, Math.sin(a + da) * r));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    scene.add(mesh(O.taperTube(curve, 0.035, 0.018, 36, 5), vineMat, { cast: false }));
    for (let s = 0.03; s < 1; s += 0.05 + R() * 0.05) {
      const p = curve.getPointAt(s);
      moss.push({ p: p.add(V((R() - 0.5) * 0.12, 0, (R() - 0.5) * 0.12)), s: V(0.075, 0.016, 0.05), rot: new THREE.Euler(R() * TAU, R() * TAU, R() * TAU), c: new THREE.Color(R() < 0.5 ? '#5f8f36' : '#77a442') });
    }
  }
  scene.add(O.blobs(moss));
  scene.add(O.grassTufts(ferns, ['#4f7a34', '#5d8a3a'], 33));

  // ── the damp bottom: mud, puddle, rubble, glowing mushrooms, a long-lost bucket ──
  const floorTex = canvasTex(256, 256, (g, w, h) => {
    const R2 = srand(12);
    g.fillStyle = '#3a372e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(20,24,22,${0.2 + R2() * 0.3})`; g.beginPath(); g.ellipse(R2() * w, R2() * h, 10 + R2() * 30, 8 + R2() * 20, R2() * 3, 0, TAU); g.fill(); }
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(${R2() < 0.5 ? '84,80,68' : '40,44,40'},0.55)`; g.beginPath(); g.ellipse(R2() * w, R2() * h, 2 + R2() * 3, 1.5 + R2() * 2, R2() * 3, 0, TAU); g.fill(); }
  });
  const floor = mesh(new THREE.CircleGeometry(EW.R + 0.12, 40), mat('#ffffff', { map: floorTex }), { cast: false });
  floor.rotation.x = -Math.PI / 2; floor.position.y = EW.FLOOR;
  scene.add(floor);
  const puddle = mesh(new THREE.CircleGeometry(0.75, 28), basic('#22364c'), { cast: false });
  puddle.rotation.x = -Math.PI / 2; puddle.scale.set(1.35, 0.85, 1); puddle.position.set(-1.05, EW.FLOOR + 0.012, 1.15);
  scene.add(puddle);
  const sheen = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 28), basic('#9fc8ff', { additive: true, opacity: 0.22, fog: false }));
  sheen.rotation.x = -Math.PI / 2; sheen.scale.set(1.35, 0.85, 1); sheen.position.set(-1.05, EW.FLOOR + 0.02, 1.15);
  scene.add(noOutline(sheen));
  const rubble: O.GroundSpot[] = [];
  for (let i = 0; i < 24; i++) { const a = R() * TAU, r = 1.9 + R() * 0.8; rubble.push({ x: Math.cos(a) * r, y: EW.FLOOR - 0.05, z: Math.sin(a) * r, s: 0.12 + R() * 0.3 }); }
  scene.add(O.rocks(rubble, ['#5e625c', '#53574f', '#67645a'], 71));
  const shroomCap = mat('#7fe8d6', { emissive: '#3fd0b8', emissiveIntensity: 0.9 });
  const shroomStem = mat('#d8e8e0');
  for (let i = 0; i < 7; i++) {
    const a = 2.0 + i * 0.22 + R() * 0.1, r = EW.R - 0.25 - R() * 0.25, s = 0.6 + R() * 0.7;
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.22, 6).translate(0, 0.11, 0), shroomStem));
    const cap = mesh(new THREE.SphereGeometry(0.12, 12, 6, 0, TAU, 0, Math.PI / 2), shroomCap); cap.position.y = 0.2; cap.scale.y = 0.7; g.add(cap);
    g.position.set(Math.cos(a) * r, EW.FLOOR, Math.sin(a) * r); g.scale.setScalar(s); g.rotation.z = (R() - 0.5) * 0.4;
    scene.add(g);
    const gl = O.sunGlare('#6ff0d8', 0.9 * s, 0.45); gl.position.set(Math.cos(a) * r, EW.FLOOR + 0.2 * s, Math.sin(a) * r);
    scene.add(gl);
  }
  const oldBucket = O.bucket();
  oldBucket.position.set(1.55, EW.FLOOR + 0.28, -1.2); oldBucket.rotation.set(0, 0.7, 1.45);
  scene.add(oldBucket);

  // ── light from the opening: a soft glow disc and a few slanted beams (no outline) ──
  const disc = new THREE.Mesh(new THREE.CircleGeometry(EW.R - 0.02, 48).rotateX(Math.PI / 2), basic('#fff2d8', { additive: true, map: O.glowTex(), opacity: 0.85, fog: false }));
  disc.position.y = -0.25;
  scene.add(noOutline(disc));
  const beamTex = canvasTex(64, 256, (g, w, h) => {
    const R3 = srand(5);
    for (let x = 0; x < w; x++) {
      const a = 0.3 + 0.7 * R3();
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.5, `rgba(255,255,255,${a * 0.35})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x, 0, 1, h);
    }
  }, { wrap: true });
  const beams: ((k: number) => void)[] = [];
  const beam = (rt: number, rb: number, len: number, x: number, z: number, tilt: number, color: string, op: number) => {
    const b = O.lightBeam(rt, rb, len, color, op, beamTex);
    b.mesh.position.set(x, 0.3 - len / 2, z); b.mesh.rotation.set(tilt, 0, tilt * 0.6);
    scene.add(b.mesh);
    beams.push(b.setOpacity);
  };
  beam(0.7, 1.3, 22, 0.7, 0.6, 0.05, '#fff0d2', 0.32);
  beam(0.45, 0.9, 18, -0.9, 0.9, -0.04, '#dfe8ff', 0.3);
  beam(0.5, 1.0, 26, 0.2, 1.4, 0.02, '#cfe0ff', 0.22);
  // bloom around the opening when seen from below
  const halo = O.sunGlare('#fff0d0', 9, 0.3);
  halo.position.set(0, -1.2, 0);
  scene.add(halo);
  beams.push((k) => { halo.material.opacity = 0.3 * k; halo.visible = k > 0.01; });

  // ── old-well props on the surface ──
  const wood = mat('#7a5a3c');
  const post = mesh(new THREE.CylinderGeometry(0.13, 0.16, 2.3, 8).translate(0, 1.15, 0), wood);
  post.position.set(EW.R + 1.15, 0, 1.4); post.rotation.z = -0.12; scene.add(post);
  const stub = mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.0, 8).translate(0, 0.5, 0), wood);
  stub.position.set(-EW.R - 1.0, 0, 1.9); stub.rotation.z = 0.08; scene.add(stub);
  const bk = O.bucket(); bk.position.set(-EW.R - 1.7, 0.27, -1.1); bk.rotation.set(0, 0.4, 1.4); scene.add(bk);
  const coil = O.ropeCoil(); coil.position.set(EW.R + 1.6, endGroundH(EW.R + 1.6, 2.6), 2.6); scene.add(coil);

  // ── the fallen log at the edge of the clearing ──
  const log = O.fallenLog({ len: 4.6, r: 0.44, seed: 91 });
  log.obj.position.copy(LOG_P); log.obj.rotation.y = 0.04;
  scene.add(log.obj);

  const birds = O.birdFlock(7, 81);
  birds.mesh.visible = false;
  scene.add(birds.mesh);
  return { scene, hemi, shaftLights, key, beams, birds, logTop: LOG_P.y + log.top, setSun };
}

interface LongDog {
  /** a point on the climbing (shaft-centre) side of the body at height y, d units out from the body axis */
  climbPos(y: number, d: number, out: THREE.Vector3): THREE.Vector3;
  update(dt: number, t: number, o: { talk: number; neck: number; wiggle: number; len: number; kick: number }): void;
  setVisible(v: boolean): void;
}

/**
 * Бублик as a living ladder: a dedicated furry tube along a gently curved path from the shaft floor to the rim
 * (belly toward the wall, dark spine stripe on the back), the real dog rig's chest/collar/head/front paws at the top
 * resting on the rim, and its rump/hind legs/tail standing on the floor. `len` < 1 retracts the body upward.
 */
function buildLongDog(scene: THREE.Scene): LongDog {
  const curve = new THREE.CatmullRomCurve3([
    V(0.0, 1.0, -(EW.R - 0.26)), V(0.06, -0.6, -(EW.R - 0.3)), V(0.12, -2.8, -(EW.R - 0.35)), V(0.38, -8, -(EW.R - 0.65)), V(0.25, -14.5, -(EW.R - 1.1)),
    V(-0.12, -21, -(EW.R - 1.6)), V(-0.28, -26.5, -(EW.R - 2.05)), V(-0.12, EW.FLOOR + 0.22, -(EW.R - 2.35)),
  ], false, 'centripetal');
  const SEG = 320, RAD = 16, TR = 0.245;
  const len = curve.getLength();
  const P: THREE.Vector3[] = [], Bv: THREE.Vector3[] = [], rr: number[] = [];
  const tg = new THREE.Vector3();
  const nv = (SEG + 1) * (RAD + 1);
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  for (let i = 0; i <= SEG; i++) {
    const u = i / SEG;
    const p = curve.getPointAt(u); curve.getTangentAt(u, tg);
    const n = DOG_SIDE.clone().addScaledVector(tg, -tg.dot(DOG_SIDE)).normalize();
    const b = tg.clone().cross(n);
    P.push(p); Bv.push(b);
    const endTaper = 0.9 + 0.1 * O.smoothstep(0, 0.012, Math.min(u, 1 - u));
    rr.push(TR * endTaper * (1 + 0.045 * Math.sin(u * len * 1.6) + 0.025 * Math.sin(u * len * 4.1 + 1)));
    for (let j = 0; j <= RAD; j++) {
      const a = (j / RAD) * TAU, k = i * (RAD + 1) + j;
      nor[k * 3] = n.x * Math.cos(a) + b.x * Math.sin(a);
      nor[k * 3 + 1] = n.y * Math.cos(a) + b.y * Math.sin(a);
      nor[k * 3 + 2] = n.z * Math.cos(a) + b.z * Math.sin(a);
      uv[k * 2] = (u * len) / 1.1; uv[k * 2 + 1] = j / RAD;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < SEG; i++) for (let j = 0; j < RAD; j++) {
    const a = i * (RAD + 1) + j, b = a + 1, c = a + RAD + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const writeTube = (t: number, wig: number) => {
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      const env = Math.min(1, u * 8, (1 - u) * 8);
      const off = wig * 0.1 * Math.sin(u * 46 - t * 17) * env;
      const r = rr[i] * (1 + 0.035 * Math.sin(t * 2.3 - u * 9));
      const cx = P[i].x + Bv[i].x * off, cy = P[i].y + Bv[i].y * off, cz = P[i].z + Bv[i].z * off;
      for (let j = 0; j <= RAD; j++) {
        const k = (i * (RAD + 1) + j) * 3;
        pos[k] = cx + nor[k] * r; pos[k + 1] = cy + nor[k + 1] * r; pos[k + 2] = cz + nor[k + 2] * r;
      }
    }
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  };
  writeTube(0, 0);
  geo.computeBoundingSphere();
  const tube = mesh(geo, mat('#ffffff', { map: furTex() }));
  tube.frustumCulled = false;

  // rig pieces: the real dog's front at the top, its rump at the bottom
  const top = createDog(), bot = createDog();
  top.root.scale.setScalar(DOG_S); bot.root.scale.setScalar(DOG_S);
  const tBody = top.root.getObjectByName('body')!;
  const front = tBody.getObjectByName('front')!;
  for (const c of tBody.children) c.visible = c === front;
  const fLegs = front.children.filter((c) => isGroup(c) && nearly(c.position.y, -0.1));
  const neck = front.getObjectByName('neck')!;
  const bBody = bot.root.getObjectByName('body')!;
  const bFront = bBody.getObjectByName('front')!;
  for (const c of bBody.children) c.visible = c !== bFront && !(c.rotation.x > 1.4);
  const hLegs = bBody.children.filter((c) => isGroup(c) && nearly(c.position.y, -0.1));
  const tail = bBody.children.find((c) => isGroup(c) && nearly(c.position.z, -0.13));
  tail?.scale.setScalar(1.6); // a proper tail to grab
  const group = new THREE.Group();
  group.add(tube, top.root, bot.root);
  scene.add(group);

  const m4 = new THREE.Matrix4(), xa = new THREE.Vector3(), ya = new THREE.Vector3(), za = new THREE.Vector3(), tp = new THREE.Vector3(), tt = new THREE.Vector3();
  const placeRig = (root: THREE.Object3D, u: number, local: THREE.Vector3) => {
    curve.getPointAt(u, tp); curve.getTangentAt(u, tt);
    za.copy(tt).negate();
    ya.copy(DOG_SIDE).addScaledVector(tt, -tt.dot(DOG_SIDE)).normalize().negate();
    xa.crossVectors(ya, za);
    m4.makeBasis(xa, ya, za);
    root.quaternion.setFromRotationMatrix(m4);
    root.position.copy(local).multiplyScalar(DOG_S).applyQuaternion(root.quaternion).negate().add(tp);
  };
  // height → curve parameter lookup (the path descends monotonically)
  const NY = 640;
  const ys = new Float32Array(NY + 1);
  for (let i = 0; i <= NY; i++) ys[i] = curve.getPointAt(i / NY).y;
  const uAtY = (y: number) => {
    if (y >= ys[0]) return 0;
    if (y <= ys[NY]) return 1;
    let lo = 0, hi = NY;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ys[mid] >= y) lo = mid; else hi = mid; }
    return (lo + (ys[lo] - y) / Math.max(1e-6, ys[lo] - ys[hi])) / NY;
  };
  let curLen = 1;
  return {
    climbPos(y, d, out) {
      const u = uAtY(y);
      curve.getPointAt(u, out); curve.getTangentAt(u, tt);
      const n = tp.copy(DOG_SIDE).addScaledVector(tt, -tt.dot(DOG_SIDE)).normalize();
      return out.addScaledVector(n, -d);
    },
    update(dt, t, o) {
      top.update(dt, { state: 'idle', speed: 0, talk: o.talk, stretch: 1, expr: 'happy' });
      bot.update(dt, { state: 'idle', speed: 0, talk: 0, stretch: 1, expr: 'happy' });
      fLegs.forEach((l, i) => l.rotation.set(-0.55 + Math.sin(t * 9 + i * 2) * 0.15 * o.talk, 0, (i ? -1 : 1) * 0.25));
      neck.rotation.x = o.neck;
      hLegs.forEach((l, i) => l.rotation.set(1.3 + Math.sin(t * 22 + i * Math.PI) * 0.6 * o.kick, 0, 0));
      if (tail) tail.rotation.x = 0.25;
      if (o.len !== curLen) { curLen = o.len; geo.setDrawRange(0, Math.floor(o.len * SEG) * RAD * 6); }
      placeRig(top.root, 0, DOG_FRONT);
      placeRig(bot.root, Math.max(0.002, o.len), DOG_RUMP);
      writeTube(t, o.wiggle);
    },
    setVisible(v) { group.visible = v; },
  };
}

// ── limb access for poses the rigs don't have (climbing, legs dangling off a log) ──
interface HeroLimbs { armL: THREE.Object3D; armR: THREE.Object3D; hipL: THREE.Object3D; hipR: THREE.Object3D; kneeL: THREE.Object3D; kneeR: THREE.Object3D }
function heroLimbs(root: THREE.Object3D): HeroLimbs {
  const body = root.getObjectByName('body')!;
  const gs = body.children.filter(isGroup);
  const hips = gs.filter((g) => nearly(g.position.y, 0.18)).sort((a, b) => b.position.x - a.position.x);
  const arms = gs.filter((g) => nearly(g.position.y, 0.435)).sort((a, b) => b.position.x - a.position.x);
  const knee = (h: THREE.Object3D) => h.children.find(isGroup)!;
  return { armL: arms[0], armR: arms[1], hipL: hips[0], hipR: hips[1], kneeL: knee(hips[0]), kneeR: knee(hips[1]) };
}
function poseHeroClimb(L: HeroLimbs, ph: number) {
  const s = Math.sin(ph), c = Math.cos(ph);
  L.armL.rotation.set(-2.6 - 0.42 * s, 0, -0.28);
  L.armR.rotation.set(-2.6 + 0.42 * s, 0, 0.28);
  L.hipL.rotation.set(-1.05 - 0.38 * c, 0, 0.28);
  L.hipR.rotation.set(-1.05 + 0.38 * c, 0, -0.28);
  L.kneeL.rotation.x = 1.4 + 0.35 * c;
  L.kneeR.rotation.x = 1.4 - 0.35 * c;
}
function poseHeroGrab(L: HeroLimbs, t: number) {
  const tug = Math.sin(t * 7) * 0.12;
  L.armL.rotation.set(-1.15 + tug, -0.3, -0.1);
  L.armR.rotation.set(-1.15 - tug, 0.3, 0.1);
}
function poseHeroSit(L: HeroLimbs, t: number) {
  L.hipL.rotation.set(-1.42, 0, 0.12); L.hipR.rotation.set(-1.38, 0, -0.12);
  L.kneeL.rotation.x = 1.2 + 0.32 * Math.sin(t * 2.4);
  L.kneeR.rotation.x = 1.2 + 0.32 * Math.sin(t * 2.4 + 2.6);
}
interface BearLimbs { armF: THREE.Object3D; armM: THREE.Object3D; legL: THREE.Object3D; legR: THREE.Object3D; mug: THREE.Object3D }
function bearLimbs(root: THREE.Object3D): BearLimbs {
  const torso = root.getObjectByName('body')!.children[0];
  const gs = torso.children.filter(isGroup);
  const legs = gs.filter((g) => nearly(g.position.y, -0.5)).sort((a, b) => b.position.x - a.position.x);
  const arms = gs.filter((g) => nearly(g.position.y, 0.36) && nearly(Math.abs(g.position.x), 0.66)).sort((a, b) => b.position.x - a.position.x);
  const paw = arms[1].children.find(isGroup)!;
  return { armF: arms[0], armM: arms[1], legL: legs[0], legR: legs[1], mug: paw.children.find(isGroup)! };
}
function poseBearClimb(B: BearLimbs, ph: number) {
  const s = Math.sin(ph), c = Math.cos(ph);
  B.armF.rotation.set(-2.45 - 0.35 * s, 0, -0.3);
  B.armM.rotation.set(-2.45 + 0.35 * s, 0, 0.3);
  B.legL.rotation.set(-0.75 - 0.35 * c, 0, 0.1);
  B.legR.rotation.set(-0.75 + 0.35 * c, 0, -0.1);
}

/**
 * The view from the hilltop at the end of the prologue: far off in the valley the marshmallow towers of Пастильное
 * королевство (the hub of «Хрумляндия»), and farther still, on the horizon, a black cliff with a castle on it (Замок
 * Полночь), over which a red moon flares up for a moment — the hook of the vampire arc (docs/script-fangs.md).
 * Flat, hand-hazed colours (no fog): they read as distant silhouettes against the dawn.
 */
function buildFarLands(scene: THREE.Scene) {
  const haze = (c: string, k: number) => new THREE.Color(c).lerp(new THREE.Color('#e6bdaa'), k);
  const R = srand(77);
  // the towers
  const tw = V(Math.sin(-0.62) * 205, -14, -Math.cos(-0.62) * 205);
  const towers = new THREE.Group();
  const cols = ['#f3b3c8', '#fbe4d8', '#bfe6d2', '#f6c6a2', '#f7d0e6'], roofs = ['#e87698', '#d65f86', '#f19ab6'];
  for (let i = 0; i < 9; i++) {
    const h = 18 + R() * 26, r = 2.2 + R() * 2.8;
    const x = (R() - 0.5) * 40, z = (R() - 0.5) * 18;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, h, 14), basic(haze(cols[i % cols.length], 0.3), { fog: false }));
    body.position.set(x, h / 2, z);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.35, r * 2.8, 14), basic(haze(roofs[i % roofs.length], 0.3), { fog: false }));
    roof.position.set(x, h + r * 1.4, z);
    const puff = new THREE.Mesh(new THREE.TorusGeometry(r * 1.05, r * 0.3, 8, 18).rotateX(Math.PI / 2), basic(haze('#fff7f2', 0.25), { fog: false }));
    puff.position.set(x, h * (0.45 + R() * 0.3), z);
    towers.add(body, roof, puff);
  }
  towers.position.copy(tw);
  scene.add(noOutline(towers));
  // the castle cliff
  const cs = V(Math.sin(-0.3) * 430, 44, -Math.cos(-0.3) * 430);
  const dark = haze('#2a1f38', 0.3), darker = haze('#1c1428', 0.26);
  const castle = new THREE.Group();
  const cliff = new THREE.Mesh(new THREE.CylinderGeometry(7, 19, 60, 9), basic(dark, { fog: false }));
  cliff.position.set(0, -30, 0);
  const keep = new THREE.Mesh(new THREE.BoxGeometry(15, 11, 10), basic(darker, { fog: false }));
  keep.position.set(0, 5.5, 0);
  castle.add(cliff, keep);
  for (const [x, h] of [[-8, 20], [7.5, 26], [1, 32]] as const) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.1, h, 8), basic(darker, { fog: false }));
    t.position.set(x, h / 2, -1);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(2.6, 7, 8), basic(darker, { fog: false }));
    spire.position.set(x, h + 3.5, -1);
    castle.add(t, spire);
  }
  castle.position.copy(cs);
  scene.add(noOutline(castle));
  // the red moon (hidden until it flares)
  const mp = cs.clone().add(V(13, 40, 0));
  const moonM = basic('#ff3434', { fog: false, opacity: 0 });
  const moon = new THREE.Mesh(new THREE.SphereGeometry(7, 20, 14), moonM);
  moon.position.copy(mp);
  const halo = O.sunGlare('#ff2020', 70, 0);
  halo.position.copy(mp);
  scene.add(noOutline(moon), halo);
  const haloM = halo.material as THREE.SpriteMaterial;
  return {
    towers: tw.clone().setY(10), castle: cs,
    flash(k: number) { moonM.opacity = k; haloM.opacity = k * 0.85; moon.visible = halo.visible = k > 0.01; },
  };
}

function* endingScript(S: Story3D): Script {
  S.music('ending');
  const W = buildEndingWorld();
  S.setScene(W.scene);
  const F = EW.FLOOR;
  const dogL = buildLongDog(W.scene);
  const hero = createHero(); const hr = new THREE.Group(); hr.add(hero.root); W.scene.add(hr);
  const bear = createBear(); const br = new THREE.Group(); const bLean = new THREE.Group(); bLean.add(bear.root); br.add(bLean); W.scene.add(br);
  const dog = createDog(); const dgr = new THREE.Group(); dgr.add(dog.root); dgr.visible = false; W.scene.add(dgr);
  const HL = heroLimbs(hero.root), BL = bearLimbs(bear.root);
  const st = {
    hero: 'stand' as 'stand' | 'grab' | 'climb' | 'free' | 'sit',
    heroState: 'idle' as HeroAnim['state'], heroExpr: 'happy' as HeroAnim['expr'],
    heroY: F, heroV: 0.8, heroMax: 99,
    bear: 'stand' as 'stand' | 'climb' | 'free' | 'sit',
    bearState: 'stand' as 'sit' | 'stand' | 'walk', bearWave: 0, bearLean: 0,
    bearY: F, bearV: 0.75, bearMax: 99,
    dogState: 'idle' as 'idle' | 'walk' | 'sit' | 'fly', dogExpr: 'happy' as 'normal' | 'happy' | 'angry',
    neck: -2.0, wiggle: 0, len: 1, kick: 0,
    /** climbers turn their bodies a little toward the camera (radians) */
    heroTurn: 0, bearTurn: 0,
    sunEl: 0.055, sunV: 0, birdsT: -1,
    /** 'top' = camera above the rim looking down the shaft: keep the shaft lit, hide the beams */
    light: 'auto' as 'auto' | 'top',
  };
  const cam = S.cam;
  let shot: (t: number) => void = () => {};
  let shotT = 0;
  const cut = (f: (t: number) => void) => { shot = f; shotT = 0; f(0); };
  const aim = (px: number, py: number, pz: number, lx: number, ly: number, lz: number, fov: number) => {
    cam.position.set(px, py, pz); cam.lookAt(lx, ly, lz); cam.fov = fov;
  };
  const camDir = new THREE.Vector3();
  S.updaters.push((dt) => {
    const t = S.t;
    if (st.hero === 'climb') st.heroY = Math.min(st.heroMax, st.heroY + st.heroV * dt);
    if (st.bear === 'climb') st.bearY = Math.min(st.bearMax, st.bearY + st.bearV * dt);
    // Тоша
    hero.update(dt, heroAnim({ state: st.heroState, expr: st.heroExpr, talk: S.talk('hero'), weapon: 'none' }));
    if (st.hero === 'climb') {
      dogL.climbPos(st.heroY + 0.55, 0.42, hr.position); hr.position.y = st.heroY;
      hr.rotation.set(0, Math.PI + st.heroTurn, 0);
      poseHeroClimb(HL, (st.heroY * TAU) / 0.55);
    } else if (st.hero === 'grab') poseHeroGrab(HL, t);
    else if (st.hero === 'sit') poseHeroSit(HL, t);
    // Вторник
    bear.update(dt, { state: st.bearState, talk: S.talk('bear'), wave: st.bearWave, speed: 0.5 });
    bLean.rotation.x = st.bearLean;
    BL.mug.visible = st.bear === 'sit';
    if (st.bear === 'climb') {
      dogL.climbPos(st.bearY + 1.4, 0.82, br.position); br.position.y = st.bearY;
      br.rotation.set(0, Math.PI + st.bearTurn, 0);
      poseBearClimb(BL, (st.bearY * TAU) / 0.8);
    } else if (st.bear === 'sit') { BL.legL.rotation.x = -0.95; BL.legR.rotation.x = -0.9; }
    // Бублик
    dogL.update(dt, t, { talk: S.talk('dog'), neck: st.neck, wiggle: st.wiggle, len: st.len, kick: st.kick });
    if (dgr.visible) dog.update(dt, { state: st.dogState, speed: 0, talk: S.talk('dog'), stretch: 1, expr: st.dogExpr });
    // lighting follows the camera: dim and cool inside the well, warm dawn outside
    const top = st.light === 'top';
    const inside = top ? 1 : O.smoothstep(0.6, -3.5, cam.position.y);
    W.hemi.intensity = top ? 0.95 : lerp(0.95, 0.4, inside);
    for (const s of W.shaftLights) s.l.intensity = s.i * inside;
    for (const fade of W.beams) fade(top ? 0 : inside);
    W.key.position.set(hr.position.x + 1.2, hr.position.y + 2.4, hr.position.z + 1.8);
    W.key.intensity = 10 * inside;
    st.sunEl += st.sunV * dt;
    W.setSun(st.sunEl);
    // dust motes drifting in the shaft light / golden pollen in the clearing
    if (inside > 0.5) {
      if (!top && Math.random() < 0.35) {
        const a = rand(0, TAU), r = Math.sqrt(Math.random()) * 1.9;
        S.fx.glow.emit(V(Math.cos(a) * r, cam.position.y + rand(1, 11), Math.sin(a) * r), { count: 1, speed: [0.02, 0.12], life: [2.5, 4.5], size: [0.02, 0.045], colors: ['#d8d0b8', '#b8c4dc', '#e0cca0'], g: -0.03, drag: 0.5 });
      }
    } else if (Math.random() < 0.3) {
      cam.getWorldDirection(camDir);
      const p = cam.position.clone().addScaledVector(camDir, rand(2.5, 10)).add(V(rand(-3, 3), rand(-1, 1.5), rand(-3, 3)));
      S.fx.glow.emit(p, { count: 1, speed: [0.05, 0.25], life: [2.5, 5], size: [0.03, 0.06], colors: ['#fff0b8', '#ffd890', '#ffffff'], g: -0.02, drag: 0.4 });
    }
    if (st.birdsT >= 0) { st.birdsT += dt; W.birds.update(t, V(-80 + st.birdsT * 5.5, 17, -95), Math.PI / 2 + 0.1, 1.7); }
    shotT += dt;
    shot(shotT);
  });

  // ── A: the bottom of the Moon Well, looking up the dog-ladder ──
  hr.position.set(-0.12, F, 0.02); hr.rotation.set(0, Math.PI, 0);
  br.position.set(-2.15, F, -0.55); br.rotation.set(0, Math.PI / 2 + 0.2, 0);
  S.fade = 1;
  // establishing shot from the rim: Бублик's head and paws on the stones, his body plunging down the shaft
  st.light = 'top'; st.neck = -1.0;
  cut((k) => {
    const e = ease.inOut(clamp((k - 1.4) / 6, 0, 1));
    st.neck = lerp(-1.0, -2.3, e);
    aim(lerp(1.5, 0.3, e), lerp(2.2, 6.4, e), lerp(0.2, -1.6, e), lerp(0, -0.1, e), lerp(1.2, F, e), lerp(-(EW.R - 0.4), -7.2, e), 50);
  });
  yield tween(1.0, (k) => { S.fade = 1 - k; });
  yield wait(0.6);
  yield S.say('narrator', 'Бублик вытянулся так длинно, как не вытягивался ещё никогда в жизни — до самого неба.');
  // down at the bottom (the King snores in his throne room next door): Тоша grabs the first thing he can reach
  st.light = 'auto';
  cut(() => aim(2.35, F + 1.25, 0.9, -0.25, F + 0.55, -0.45, 50));
  audio.sfx('snore');
  yield S.say('bear', 'Тс-с... Слышите? Король храпит. Лезем тихонько.');
  st.hero = 'grab'; st.heroExpr = 'happy';
  st.wiggle = 1; st.neck = -2.1; st.kick = 0.6;
  audio.sfx('grab');
  yield wait(0.4);
  yield S.say('dog', 'Не щекочите! Ай! Тоша, это мой хвост!', 'happy');
  st.wiggle = 0.25; st.kick = 0;
  st.hero = 'climb'; st.heroY = F + 0.05; st.heroV = 0.8; st.heroExpr = 'normal'; st.heroState = 'lookUp';
  // low angle up the dog-ladder toward the bright opening
  cut((k) => aim(1.7, F + 0.55, 2.2, lerp(-0.2, -0.3, clamp(k / 4, 0, 1)), hr.position.y + 3.2 + k * 0.6, hr.position.z - 1.2, 62));
  yield wait(2.4);
  // Вторник shuffles over and grabs on below
  st.bearState = 'walk';
  const bs = br.position.clone(), be = dogL.climbPos(F + 1.4, 0.82, V(0, 0, 0)), r0 = br.rotation.y;
  be.y = F;
  yield tween(1.0, (k) => { br.position.lerpVectors(bs, be, k); br.rotation.y = lerp(r0, Math.PI, k); });
  st.bear = 'climb'; st.bearState = 'stand'; st.bearY = F; st.bearV = 0.75; st.bearLean = 0.18;
  yield wait(1.8);

  // ── B: halfway up, tracking alongside ──
  st.heroY = -16.5; st.heroV = 0.6; st.heroMax = -9;
  st.bearY = -19.4; st.bearV = 0.6; st.bearMax = -11.9;
  st.neck = -1.6; st.wiggle = 0.15;
  st.bearTurn = -0.95; st.heroTurn = -0.6;
  cut(() => aim(1.8, st.heroY - 1.45, -2.45, 0.2, st.heroY - 0.6, -1.45, 68));
  yield wait(0.6);
  yield S.say('bear', 'Ох, мои старые лапы... Сорок лет не лазил!');
  yield wait(0.8);

  // ── C: nearly there, looking up past Тоша at the bright opening ──
  st.heroY = -6.8; st.heroV = 0.55; st.heroMax = -3.2; st.heroExpr = 'happy';
  st.bearY = -9.8; st.bearV = 0.55; st.bearMax = -6.0;
  st.neck = -2.3; st.heroTurn = -0.75; st.bearTurn = 0;
  cut(() => aim(1.75, st.heroY + 0.15, -2.45, 0.3, st.heroY + 0.8, -1.95, 55));
  yield wait(0.6);
  yield S.say('hero', 'Ещё чуть-чуть! Я вижу небо!', 'happy');
  // looking up past him at the bright round opening
  st.heroTurn = 0; st.heroMax = -2.2;
  cut(() => aim(0.6, st.heroY - 4, 0.2, 0, st.heroY + 4.5, -1.2, 66));
  yield wait(2.2);

  // ── D: out of the well, into the dawn ──
  st.heroY = -1.9; st.heroV = 0.85; st.heroMax = 0.15;
  st.bearY = -5.4; st.bearV = 0.85; st.bearMax = -1.25;
  st.neck = 1.0; st.wiggle = 0.1;
  st.sunV = 0.0012;
  cut((k) => {
    const e = ease.inOut(clamp((k - 2.4) / 5, 0, 1));
    aim(lerp(1.4, 0.8, e), lerp(3.1, 2.9, e), lerp(-(EW.R + 2.9), -(EW.R + 7.6), e), lerp(0, 0.3, e), lerp(0.5, 0.9, e), lerp(-(EW.R - 0.9), -(EW.R + 0.6), e), 50);
  });
  yield wait(2.4);
  // Тоша scrambles over the rim and hops onto the grass
  st.hero = 'free'; st.heroState = 'jump';
  const h0 = hr.position.clone(), h1 = V(-0.85, EW.RIM, -(EW.R + 0.35)), h2 = V(-1.5, endGroundH(-1.5, -(EW.R + 1.9)), -(EW.R + 1.9));
  audio.sfx('jump');
  yield tween(0.5, (k) => { hr.position.lerpVectors(h0, h1, ease.outQuad(k)); hr.position.y += Math.sin(k * Math.PI) * 0.45; });
  st.heroState = 'idle';
  yield wait(0.25);
  st.heroState = 'jump';
  yield tween(0.42, (k) => { hr.position.lerpVectors(h1, h2, k); hr.position.y += Math.sin(k * Math.PI) * 0.55; });
  audio.sfx('land');
  st.heroState = 'cheer';
  yield wait(0.5);
  // Вторник heaves himself out
  st.bear = 'free'; st.bearLean = 0.25;
  const b0 = br.position.clone(), b1 = V(1.0, EW.RIM - 0.1, -(EW.R + 0.25)), b2 = V(2.5, endGroundH(2.5, -(EW.R + 1.5)), -(EW.R + 1.5));
  yield tween(0.9, (k) => { br.position.lerpVectors(b0, b1, ease.inOut(k)); br.position.y += Math.sin(k * Math.PI) * 0.3; });
  st.bearLean = 0;
  yield tween(0.5, (k) => { br.position.lerpVectors(b1, b2, k); br.position.y += Math.sin(k * Math.PI) * 0.5; });
  audio.sfx('thud', { pitch: 0.8 });
  st.bearWave = 1;
  yield wait(0.4);
  // Бублик pulls himself up — zip! — and pops out
  st.neck = 0.6;
  audio.sfx('whoosh');
  st.kick = 1;
  yield tween(0.75, (k) => { st.len = 1 - ease.inQuad(k); });
  dogL.setVisible(false);
  dgr.visible = true; st.dogState = 'fly';
  const d0 = V(0, 0.7, -(EW.R - 0.3)), d1 = V(0.45, endGroundH(0.45, -(EW.R + 2.5)), -(EW.R + 2.5));
  dgr.rotation.set(0, Math.PI, 0);
  audio.sfx('bounce');
  yield tween(0.6, (k) => {
    dgr.position.lerpVectors(d0, d1, k); dgr.position.y += Math.sin(k * Math.PI) * 1.4;
    dgr.scale.setScalar(lerp(DOG_S, 1, ease.outQuad(k)));
  });
  st.dogState = 'idle';
  audio.sfx('land');
  st.heroState = 'idle'; st.bearWave = 0;
  yield wait(1.6);
  yield tween(0.7, (k) => { S.fade = k; });

  // ── E: on the fallen log, facing the sunrise ──
  const top = W.logTop;
  st.hero = 'sit'; st.heroState = 'sit'; st.heroExpr = 'happy';
  hr.position.set(LOG_P.x + 0.3, top, LOG_P.z + 0.02); hr.rotation.set(0, Math.PI, 0);
  st.bear = 'sit'; st.bearState = 'sit'; st.bearWave = 0; st.bearLean = 0;
  br.position.set(LOG_P.x - 1.15, top - 0.04, LOG_P.z + 0.05); br.rotation.set(0, Math.PI - 0.1, 0);
  st.dogState = 'sit';
  dgr.position.set(LOG_P.x + 1.05, top - 0.02, LOG_P.z); dgr.rotation.set(0, Math.PI + 0.15, 0);
  // co-op: the friends climbed out after them and stand by the log, looking at the view (each in their own look)
  const team = coop.active;
  const pals = (team ? [...net.members.values()].filter((m) => !m.isMe).slice(0, 5) : []).map((m, i) => {
    const rig = createHero(m.look); const g = new THREE.Group(); g.add(rig.root);
    const sx = i % 2 === 0 ? 1 : -1, row = Math.floor(i / 2);
    const x = LOG_P.x + sx * (2.3 + row * 1.0) - (sx < 0 ? 0.6 : 0), z = LOG_P.z - 0.5 - row * 0.45;
    g.position.set(x, endGroundH(x, z), z); g.rotation.y = Math.PI + sx * 0.15;
    W.scene.add(g);
    return { rig, g };
  });
  const pal = { state: 'idle' as HeroAnim['state'], expr: 'happy' as HeroAnim['expr'] };
  S.updaters.push((dt) => { for (const f of pals) f.rig.update(dt, heroAnim({ state: pal.state, expr: pal.expr, weapon: 'none' })); });
  const far = buildFarLands(W.scene);
  st.sunEl = 0.07; st.sunV = 0.0016;
  st.birdsT = 0; W.birds.mesh.visible = true;
  cut((k) => {
    const e = clamp(k / 16, 0, 1);
    aim(LOG_P.x + 2.4 - e * 0.6, 2.5 - e * 0.05, LOG_P.z + 7.8 - e * 0.8, LOG_P.x - 1.5, 2.0, LOG_P.z - 40, 46);
  });
  yield tween(1.0, (k) => { S.fade = 1 - k; });
  yield wait(0.8);
  yield S.say('narrator', team
    ? 'Так Тоша с друзьями, Бублик и медведь Вторник выбрались из Ямы — у той самой ночной тропы.'
    : 'Так Тоша, Бублик и медведь Вторник выбрались из Ямы — у той самой ночной тропы.');

  // ── F: their faces in the warm light ──
  const faceBear = () => cut((k) => aim(LOG_P.x - 0.4, 2.35, LOG_P.z - 3.2 + k * 0.03, LOG_P.x - 1.05, 2.25, LOG_P.z, 42));
  const faceHero = () => cut((k) => aim(LOG_P.x + 0.9 - k * 0.02, 1.45, LOG_P.z - 3.4, LOG_P.x + 0.45, 1.3, LOG_P.z, 44));
  const faceDog = () => cut((k) => aim(LOG_P.x + 1.6, 1.2, LOG_P.z - 2.3 + k * 0.02, LOG_P.x + 1.05, 1.1, LOG_P.z, 42));
  faceBear();
  yield wait(0.5);
  yield S.say('bear', 'Ох... А я и забыл, какое оно тёплое — солнце.');

  // ── G: Хрумляндия in daylight — the marshmallow towers of Пастильное королевство far off in the valley ──
  const eye = V(LOG_P.x - 1.8, 3.3, LOG_P.z - 1.6);
  cut((k) => {
    const e = ease.inOut(clamp(k / 10, 0, 1));
    aim(eye.x, eye.y + e * 0.4, eye.z, lerp(far.towers.x, far.towers.x * 0.8 + far.castle.x * 0.2, e), far.towers.y + 2, lerp(far.towers.z, far.towers.z * 0.8 + far.castle.z * 0.2, e), 40);
  });
  yield wait(0.6);
  yield S.say('bear', team ? 'А вот и она — Хрумляндия. Целая страна, малыши. Не только лес да тропинка.' : 'А вот и она — Хрумляндия. Целая страна, малыш. Не только лес да тропинка.');
  yield S.say('hero', 'Ух ты... Ночью мы ничего этого не видели! А что там — розовые башни?', 'surprised');
  yield S.say('bear', 'Пастильное королевство. Там пастила, пряники, зефир... и принцесса-учёная.');
  st.dogExpr = 'happy';
  yield S.say('dog', 'Пряники?..', 'happy');
  // far beyond, over a black cliff with a castle on it, a red moon flares up for a moment — in broad daylight
  cut(() => aim(eye.x, eye.y, eye.z, far.castle.x + 4, far.castle.y + 16, far.castle.z, 13));
  yield wait(0.7);
  audio.sfx('warn', { pitch: 0.5 });
  yield tween(1.5, (k) => far.flash(k < 0.2 ? k / 0.2 : k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45));
  far.flash(0);
  yield wait(0.4);
  st.heroExpr = 'scared'; pal.expr = 'scared';
  faceHero();
  yield S.say('hero', 'Ой! Вы видели?! Над той скалой — луна! Красная! Днём!', 'scared');
  faceBear();
  yield S.say('bear', 'Алая луна... Бабка говорила: раз в сто лет такое бывает. И тогда ночами лучше сидеть дома.');
  faceHero();
  st.heroExpr = 'normal';
  yield S.say('hero', 'А что бывает?');
  faceBear();
  yield S.say('bear', 'Не помню. Помню только, что бабка дрожала. Спросите принцессу Пастилу — она про луну всё знает.');
  faceHero();
  st.heroExpr = 'angry'; pal.expr = 'normal';
  yield S.say('hero', 'Тогда идём к принцессе! Дедушка Вторник, вы с нами?', 'angry');
  faceBear();
  yield S.say('bear', team ? 'Нет, малыши. У меня наверху свои дела — сорок лет копились.' : 'Нет, малыш. У меня наверху свои дела — сорок лет копились.');

  // the bear's farewell: he gets up off the log, waves, and walks away down the hill (side view, he walks off into the depth)
  st.heroExpr = 'happy'; pal.expr = 'happy';
  cut(() => aim(LOG_P.x + 6.8, 2.3, LOG_P.z - 1.8, LOG_P.x - 3.5, 1.3, LOG_P.z - 0.4, 46));
  st.bear = 'free'; st.bearState = 'stand';
  const u0 = br.position.clone(), u1 = V(LOG_P.x - 1.5, endGroundH(LOG_P.x - 1.5, LOG_P.z - 0.9), LOG_P.z - 0.9);
  yield tween(0.6, (k) => { br.position.lerpVectors(u0, u1, ease.outQuad(k)); br.position.y += Math.sin(k * Math.PI) * 0.25; });
  br.rotation.set(0, Math.PI / 2 + 0.6, 0);
  st.bearWave = 1;
  yield S.say('bear', 'Не грустите! Свидимся. Ищите меня по запаху мёда. Хо-хо!');
  st.bearWave = 0.4; st.bearState = 'walk';
  br.rotation.set(0, -Math.PI / 2 - 0.15, 0);
  const u2 = V(LOG_P.x - 13, 0, LOG_P.z - 2.6);
  yield tween(3.4, (k) => {
    br.position.x = lerp(u1.x, u2.x, k); br.position.z = lerp(u1.z, u2.z, k);
    br.position.y = endGroundH(br.position.x, br.position.z);
    if (k > 0.35) st.bearWave = 0;
  });
  st.bearState = 'stand';
  br.visible = false;

  // the old joke from the road, answered
  faceHero();
  yield S.say('hero', 'Бублик, помнишь — ты хотел съесть целый пирог, а я целого короля?', 'happy');
  faceDog();
  st.dogExpr = 'normal';
  yield wait(0.3);
  st.dogExpr = 'happy';
  yield S.say('dog', 'Короля мы уже видели. Хватит с меня королей! Пойдём лучше за пряниками.', 'happy');

  // ── H: crane up and away over the misty valley ──
  audio.sfx('victory');
  pal.state = 'cheer';
  cut((k) => {
    const e = ease.inOut(clamp(k / 8, 0, 1));
    aim(LOG_P.x + lerp(1.6, 0.8, e), lerp(2.4, 6.5, e), LOG_P.z + lerp(6.5, 12, e), LOG_P.x + lerp(-9, -16, e), lerp(2.6, -4, e), LOG_P.z + lerp(-40, -60, e), lerp(48, 54, e));
  });
  const endT = S.t;
  S.overlay = (ctx) => {
    const a = clamp((S.t - endT - 1.0) / 1.2, 0, 1);
    ctx.save(); ctx.globalAlpha = a;
    const s = ease.outBack(a);
    ctx.translate(W_UI / 2, 200); ctx.scale(s, s);
    text(ctx, 'КОНЕЦ ПРОЛОГА', 0, 0, { size: 96, color: '#fff3d8', align: 'center', base: 'middle', stroke: 14 });
    text(ctx, 'Дальше — Хрумляндия', 0, 78, { size: 34, font: 'body', color: '#ffe7b8', align: 'center', base: 'middle', stroke: 6 });
    ctx.restore();
  };
  yield wait(6);
  yield tween(0.9, (k) => { S.fade = k; });
  S.overlay = null;

  // ── post-credits: the king alone in his throne room ──
  const kb = baseScene('#120c1c', ['#1e1530', 40, 120], ['#d8c8ff', '#2a1c3a', 1.0], ['#c8d8ff', 1.6, [0.3, 1, 0.6]]);
  kb.scene.add(room({ theme: 'throne', x0: -30, x1: 30, z0: -40, z1: 30, floorY: 0, wallH: 50 }).obj);
  kb.scene.add(P.throne({ x: 0, y: 0, z: -28, s: 1 }).obj);
  // moonlight still falls through the empty Moon Well above the throne
  const mbeam = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 7, 60, 28, 1, true), basic('#b8ccff', { additive: true, opacity: 0.12, side: THREE.DoubleSide, fog: false }));
  mbeam.position.set(0, 30, -22);
  kb.scene.add(noOutline(mbeam));
  const pool = new THREE.Mesh(new THREE.CircleGeometry(7.5, 40).rotateX(-Math.PI / 2), basic('#c8d8ff', { additive: true, opacity: 0.22, map: O.glowTex(), fog: false }));
  pool.position.set(0, 0.05, -21);
  kb.scene.add(noOutline(pool));
  S.setScene(kb.scene);
  cam.fov = 52;
  audio.playMusic('den');
  const king = createKing(); king.root.position.set(0, 0, -20); kb.scene.add(king.root);
  const ka = kingAnim({ eye: 0.3, slump: 0.4, dizzy: 0.2 });
  const feeders: THREE.Group[] = [];
  const feederRigs: Rig<any>[] = [];
  for (const sx of [-1, 1]) {
    const g = createGuard('feeder'); const gr = new THREE.Group(); gr.add(g.root); gr.position.set(sx * 26, 0, 4); gr.rotation.y = -sx * Math.PI / 2;
    kb.scene.add(gr); feeders.push(gr); feederRigs.push(g);
  }
  let feedK = 0, shake = 0, kT = 0;
  /** low shot: the two little servants who come in (the one who speaks is in frame), the King's knees behind them */
  let low = false;
  S.updaters.push((dt) => {
    kT += dt;
    ka.talk = S.talk('king'); ka.mouth = Math.max(0.1, ka.talk * 0.6);
    king.update(dt, ka);
    feeders.forEach((f, i) => { const sx = i === 0 ? -1 : 1; f.position.x = lerp(sx * 26, sx * 1.7, feedK); feederRigs[i].update(dt, { state: feedK < 1 && feedK > 0 ? 'walk' : 'carry', speed: 0.6, flash: 0 }); });
    if (Math.random() < 0.3) S.fx.glow.emit(V(rand(-4, 4), rand(2, 30), -22 + rand(-4, 4)), { count: 1, speed: [0.05, 0.2], life: [2, 4], size: [0.08, 0.15], colors: ['#dfe8ff', '#ffffff'], g: -0.05 });
    const push = ease.inOut(clamp(kT / 14, 0, 1));
    shake = Math.max(0, shake - dt * 1.2);
    const sh = () => rand(-1, 1) * shake * 0.6;
    if (low) { cam.position.set(sh(), 1.7 + sh(), 8.2); cam.lookAt(0, 0.45, 0); return; }
    // (the crown keeps clear of the top bar)
    cam.position.set(sh(), lerp(9, 7.5, push) + sh(), lerp(24, 15, push));
    cam.lookAt(0, lerp(12.5, 14.1, push), -14);
  });
  yield tween(0.8, (k) => { S.fade = 1 - k; });
  yield wait(0.8);
  ka.eye = 0.7; ka.dizzy = 0;
  yield S.say('king', '...Э-эй? Кто-нибудь? Где все?');
  yield S.say('king', 'Мясо... кто-нибудь принесёт мне мясо?');
  low = true;
  yield tween(1.4, (k) => { feedK = k; });
  yield S.say('guard', 'Ваше Громадейшество! А может... сегодня салатик?', 'cheer');
  low = false;
  ka.anger = 1; ka.eye = 1; ka.slump = 0;
  audio.sfx('roar');
  shake = 1;
  yield S.say('king', 'НЕЕЕЕЕЕТ!!!', 'angry');
  yield wait(1.2);
}

void basic; void PAL;
