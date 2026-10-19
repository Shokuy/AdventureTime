import * as THREE from 'three';
import { W, H, clamp, ease } from '../../../../engine/util';
import { input, type Action } from '../../../../engine/input';
import { audio, type MusicName } from '../../../../engine/audio';
import { save } from '../../../../engine/save';
import { rrect, text, wrap, OUT } from '../../../../art/draw';
import { drawHint, glyphLabel } from '../../../../ui/glyphs';
import { game } from '../../../../game/game';
import { wait, tween, all, type Script, type Waiter } from '../../../../game/coroutine';
import { DenScene } from '../../../../scenes/den';
import { net } from '../../../../net/session';
import { toUI } from '../../../runtime';
import { createHeroModel } from '../../../models/heroes';
import type { HeroAnim, HeroRig, HeroExpr, HeroState } from '../../../models/hero';
import { LEVEL_PLUGINS, type Level3D, type Npc3 } from '../../level';
import type { Level3Def } from '../../levels';
import { coop } from '../../coop';
import { coopFlow } from '../../coopFlow';
import { myProgress, EPISODES, hasStoryFlag, setStoryFlag } from '../../episodes';
import { buildTown, type TownLayout, type V3 } from './layout';
import { createFolk, type FolkRig, type FolkKind, type FolkLook, type FolkAnim } from './people';
import { say, speakingNow, installSpeech, SPEAKERS, type SpeakerId } from './speech';
import { TOWN_HOOKS, type TownOverlay } from './hooks';
import { openHeroPicker, heroPickerOpen } from '../../heroes';
import { DAY } from './palette';
import * as T from './props';
import { SHOP_GREET, SHOP_REACT, BOARD, SIGNS, barksOf, barkGroup, PASTILA_TALK, TOASTS, TRAIN, TRAIN_ENTRY, TRAIN_EXIT, TRAIN_COMBOS, TRAIN_OTHER, TRAIN_CLOSED, type BarkWho, type TrainLine } from './lines';
import { buildCourse, type Course, type Station } from './course';

/*
 * The hub level `hub` — Пастильное королевство by day (docs/script-fangs.md §4). Free walk, no enemies:
 *  • the town (buildTown), townsfolk with idle animations and barks by arc stage (4.10), signs (4.7);
 *  • Медовая лавка Вторника — the bear at the counter opens the den's shop UI (DenScene with a ShopHook): the same goods
 *    and upgrades, bought with MY crumbs (every player shops for himself in co-op);
 *  • Зеркало героев — opens the hero picker (TOWN_HOOKS.heroPicker; the roster's openHeroPicker) or says «скоро»;
 *  • the laboratory — princess Пастила (a short talk by stage), Ириска, Ноки after the meeting;
 *  • the notice board — the stage's notes + the next series;
 *  • the gate — out to the map: solo at once; co-op: the host leads the room (3 s countdown), clients wait for him;
 *  • scenes: 4.1 hub_arrival (first entry, world scene), 4.2 shop intro (mine), 4.3 + 4.4 lab meeting (world scene on
 *    entering the lab), 4.5 the mirror (mine, after 4.4);
 *  • secrets: a rooftop run in the east quarter (crumbs → the tower balcony's golden walnut), a crumb on the fountain.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const v3 = (p: V3) => new THREE.Vector3(p.x, p.y, p.z);
/** save keys of the hub's one-time scenes */
export const HUB_SEEN = { arrival: 'scene:hub_arrival', shop: 'scene:hub_shop_bear', meet: 'scene:hub_lab_meet', plan: 'scene:hub_lab_plan', mirror: 'scene:hub_mirror' };
const ARC_IDS = ['fangs1', 'fangs2', 'fangs3', 'fangs4', 'fangs5'];

/** the progress that decides what the hub shows: mine solo, the room's (the host's map) in co-op */
const roomProg = () => (coop.active ? coopFlow.mapProg() : myProgress());
/** series of the arc done (0–5) */
export function arcStage(): number {
  const prog = roomProg();
  return ARC_IDS.filter((id) => prog[id]?.done).length;
}
/** the story flag set by 4.4 (`hub_lab_plan`): the four have met, series 2 is open */
export const LAB_FLAG = 'hub_lab_plan';
export const metInLab = () => hasStoryFlag(LAB_FLAG, roomProg()) || hasStoryFlag(LAB_FLAG);

/** the music of the hub by day: the vampire kit's `hub_day` once it exists, else a calm existing track */
function hubMusic(): MusicName {
  return 'hub_day';
}

export function hubLevel(): Level3Def {
  const pal = DAY;
  const first = !save.has(HUB_SEEN.arrival);
  return {
    id: 'hub', chapter: 0, title: 'Пастильное королевство', subtitle: 'Город из пастилы, пряников и зефира', music: hubMusic(),
    spawn: [0, 0, 46], yaw: Math.PI, killY: -12,
    // «сюжетный состав»: while the bars are down the players' figures are hidden, the story four stand in the scene
    castScenes: true,
    bg: pal.bg, fog: pal.fog, hemi: pal.hemi, sun: pal.sun,
    ...(first ? { startScript: 'hub_arrival' } : {}),
    build(L) { new TownHub(L); },
  };
}

// ───────────────────────── helpers ─────────────────────────

function heroAnim(o: Partial<HeroAnim> = {}): HeroAnim {
  return { state: 'idle', speed: 0, attack: null, weapon: 'none', flash: 0, talk: 0, expr: 'normal', squash: 1, ...o };
}
const lerpAng = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/** a story figure (Тоша, Бублик, Ноки, Пастила) placed by a script or the hub */
interface Figure { kind: 'tosha' | 'bublik' | 'noki' | 'pastila'; rig: HeroRig; g: THREE.Group; anim: HeroAnim; speaker: SpeakerId; walk: { to: THREE.Vector3; speed: number } | null; face: number | null }
/** a townsperson */
interface Folk {
  id: string; who: BarkWho; name: string; rig: FolkRig; g: THREE.Group;
  mode: 'stand' | 'walk' | 'sit'; home: THREE.Vector3; homeYaw: number;
  path: THREE.Vector3[] | null; len: number; speed: number; phase: number;
  anim: FolkAnim; barkCd: number; near: boolean; waveT: number; talkT: number; grey: number;
  /** speaker id for scenes */
  speaker: SpeakerId;
}
/** something you can use with [interact] */
interface Spot { pos: THREE.Vector3; r: number; dy: number; label: () => string; act: () => void; when?: () => boolean }

const BLOCK: Action[] = ['pause', 'help', 'attack', 'jump', 'shoot', 'dash', 'special', 'heal', 'interact', 'confirm', 'back', 'swap', 'emote', 'ping', 'chat', 'score', 'qp1', 'qp2', 'qp3', 'qp4'];

// ───────────────────────── the hub runtime ─────────────────────────

export class TownHub {
  readonly lay: TownLayout;
  stage: number;
  folk: Folk[] = [];
  figures = new Map<string, Figure>();
  spots: Spot[] = [];
  bear: Npc3 | null = null;
  overlay: TownOverlay | null = null;
  /** a personal talk / scene is playing on my machine */
  busy = false;
  /** a personal scene with the story four: my own figure is hidden on my screen (friends still see me) */
  hideMe = false;
  prompt: Spot | null = null;
  private gateT = 0;
  private gateFollow: { name: string; t: number } | null = null;
  private gateToastT = 0;
  private leaving = false;
  private offNet: (() => void)[] = [];
  private framed = false;
  private boomT = -1;
  private boom: THREE.Group | null = null;

  constructor(readonly L: Level3D) {
    L.refs.town = this;
    this.stage = arcStage();
    const notes = BOARD[Math.min(this.stage, BOARD.length - 1)].slice(0, 3).map((n, i) => ({ title: ['Объявление', 'Внимание!', 'Пропажа'][i] ?? 'Объявление', lines: noteLines(n) }));
    this.lay = buildTown(L, { notes });
    this.course = buildCourse(L, this.lay.pal);
    installSpeech(L);
    this.extraProps();
    this.placePeople();
    this.placeSpots();
    this.placeSecrets();
    this.placeSigns();
    // the lab meeting (4.3 + 4.4) plays when someone walks into the lab (the goal arrow points there until then)
    const lab = this.lay.lab;
    if (!metInLab()) L.trigger(lab.center.x - 4, -1, lab.center.z - 2, lab.center.x + 4, 4, lab.center.z + lab.r - 0.3, 'hub_lab_meet');
    // input for the overlays: before the level reads it
    const orig = L.update.bind(L);
    L.update = (dt: number) => { this.preUpdate(dt); orig(dt); };
    if (L.nl) {
      this.offNet.push(net.on('town_gate', (d: { go?: number; name?: string }, from: string) => {
        if (from === net.myId) return;
        if (d.go) this.gateFollow = { name: d.name ?? net.members.get(from)?.name ?? 'Хозяин', t: 3 };
        else this.gateFollow = null;
      }));
    }
  }

  // ───────────── building ─────────────

  private extraProps() {
    const L = this.L, pal = this.lay.pal;
    // a road post by the gate, a waffle doormat under the arch
    L.add(T.townSignpost({ x: 3.8, y: 0, z: 50.6, rotY: 2, label: 'КАРТА →', pal }));
    L.add(T.waffleMat({ x: 0, y: 0, z: 54, w: 5.2, d: 2.4 }));
  }

  private folkAt(id: string, who: BarkWho, kind: FolkKind, look: FolkLook, at: V3, yaw: number, o: { mode?: Folk['mode']; path?: V3[]; speed?: number; phase?: number; grey?: number; speaker?: SpeakerId; name?: string; collide?: boolean } = {}): Folk {
    const L = this.L;
    const rig = createFolk(kind, look);
    const g = new THREE.Group();
    g.add(rig.root);
    g.position.set(at.x, at.y, at.z);
    g.rotation.y = yaw;
    L.scene.add(g);
    const path = o.path ? o.path.map(v3) : null;
    let len = 0;
    if (path) for (let i = 0; i < path.length; i++) len += path[i].distanceTo(path[(i + 1) % path.length]);
    const f: Folk = {
      id, who, name: o.name ?? SPEAKERS[o.speaker ?? (who as SpeakerId)]?.name ?? 'Житель', rig, g,
      mode: o.mode ?? (path ? 'walk' : 'stand'), home: v3(at), homeYaw: yaw, path, len, speed: o.speed ?? 1.2, phase: o.phase ?? 0,
      anim: { state: o.mode === 'sit' ? 'sit' : 'idle', speed: 0, talk: 0, look: 0, grey: o.grey ?? 0 },
      barkCd: 2 + Math.random() * 4, near: false, waveT: 0, talkT: 0, grey: o.grey ?? 0, speaker: o.speaker ?? (who === 'presnyak' ? 'presnyak' : who as SpeakerId),
    };
    if (o.collide !== false && !path) L.col({ kind: 'cyl', x: at.x, z: at.z, r: 0.38, y0: at.y, y1: at.y + rig.height });
    this.folk.push(f);
    return f;
  }

  figure(key: string, kind: Figure['kind'], at: THREE.Vector3, yaw: number): Figure {
    const old = this.figures.get(key);
    if (old) { old.g.position.copy(at); old.g.rotation.y = yaw; old.g.visible = true; return old; }
    const rig = createHeroModel(kind);
    const g = new THREE.Group();
    g.add(rig.root);
    g.position.copy(at); g.rotation.y = yaw;
    this.L.scene.add(g);
    const speaker: SpeakerId = kind === 'tosha' ? 'tosha' : kind === 'bublik' ? 'bublik' : kind;
    const f: Figure = { kind, rig, g, anim: heroAnim(), speaker, walk: null, face: null };
    this.figures.set(key, f);
    return f;
  }
  dropFigure(key: string) {
    const f = this.figures.get(key);
    if (!f) return;
    this.L.scene.remove(f.g);
    f.rig.dispose();
    this.figures.delete(key);
  }

  private placePeople() {
    const L = this.L, lay = this.lay, st = this.stage;
    const grey = st >= 1 && st <= 4;
    // the bear at his counter
    const k = lay.shop.keeper;
    this.bear = L.npc('bear', k.x, k.y, k.z, lay.shop.keeperYaw, 0.8);
    this.bear.anim.state = 'stand';
    L.col({ kind: 'cyl', x: k.x, z: k.z, r: 0.8, y0: k.y, y1: k.y + 2.2 });
    // the gate guard
    this.folkAt('pryanik', 'pryanik', 'ginger', { hat: 'helmet', hold: 'pin', accent: '#d8dce8' }, { x: -3.4, y: 0, z: 51.6 }, 2.6, { name: 'Пряник' });
    // the square
    const fl = lay.walks[0];
    this.folkAt('marmeladka', 'marmeladka', 'gumdrop', { color: '#5ad86a', hold: 'lantern', hat: 'bow', accent: '#ff5a8a', scale: 0.85 }, fl[0], 0, { path: fl, speed: 1.7, phase: 0, name: 'Мармеладка' });
    this.folkAt('kid', 'zhitel', 'gumdrop', { color: '#ff7aa8', scale: 0.8, hat: 'beret', accent: '#7ad8ff' }, fl[6], 0, { path: fl, speed: 1.7, phase: 0.5 });
    // (r 10.7: inside the benches at (±7, ±10) — at 12.4 his round ran straight through them — and the flowerbeds)
    const ring = Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2; return { x: Math.sin(a) * 10.7, y: 0, z: Math.cos(a) * 10.7 }; });
    this.folkAt('zefirych', 'zefirych', 'marsh', { color: '#fff8fa', hat: 'top', accent: '#6a6a9a', hold: 'pole', glasses: true }, ring[0], 0, { path: ring.reverse(), speed: 0.7, phase: 0.2, name: 'Дед Зефирыч' });
    const b0 = lay.benches[2], b1 = lay.benches[1];
    this.folkAt('granny', grey ? 'presnyak' : 'zhitel', 'marsh', { color: '#ffe8f0', hat: 'kerchief', accent: '#c88aff', glasses: true }, b0.seat, b0.yaw, { mode: 'sit', grey: grey ? 1 : 0, collide: false });
    if (grey) this.folkAt('greyman', 'presnyak', 'lolly', { color: '#ff9a4a' }, b1.seat, b1.yaw, { mode: 'sit', grey: 1, collide: false });
    else this.folkAt('reader', 'zhitel', 'cupcake', { color: '#c8f0ff', accent: '#ff7aa8' }, b1.seat, b1.yaw, { mode: 'sit', collide: false });
    // the market street and the stalls
    const kinds: [FolkKind, FolkLook][] = [[ 'marsh', { color: '#ffd6e4', hat: 'kerchief', accent: '#ff5a8a', apron: true }], ['lolly', { color: '#7ad8ff' }], ['cupcake', { color: '#ffc8e0', accent: '#9a6ad8', hat: 'chef' }], ['gumdrop', { color: '#ffcf3a', hat: 'beret', accent: '#ff5a8a' }], ['ginger', { color: '#c8803e', hat: 'bow', accent: '#ff5a8a' }]];
    lay.stalls.forEach((s, i) => this.folkAt('stall' + i, 'zhitel', kinds[i][0], kinds[i][1], s.keeper, s.yaw, {}));
    this.folkAt('stroller', 'zhitel', 'ginger', { hat: 'top', accent: '#ff5a8a' }, lay.walks[1][0], 0, { path: lay.walks[1], speed: 1.1, phase: 0.3 });
    // the bakery, the post
    this.folkAt('beze', 'beze', 'cupcake', { color: '#fffaf6', accent: '#ff9fc0', hat: 'chef', scale: 1.15, apron: true }, { x: -14.5, y: 0, z: 31.4 }, Math.PI, { name: 'Мадам Безе' });
    this.folkAt('ponchik', 'ponchik', 'gumdrop', { color: '#e8a050', hat: 'beret', accent: '#3a6ad8', hold: 'bag' }, lay.walks[3][0], 0, { path: lay.walks[3], speed: 1.5, phase: 0.1, name: 'Пончик' });
    // the north street, the creek
    this.folkAt('north', 'zhitel', 'cupcake', { color: '#d8ffe8', accent: '#ff7aa8' }, lay.walks[2][0], 0, { path: lay.walks[2], speed: 1.0, phase: 0.6 });
    this.folkAt('creekA', grey ? 'presnyak' : 'zhitel', 'lolly', { color: '#c88aff' }, { x: 26.5, y: 0, z: 14.2 }, -2.4, { grey: grey ? 1 : 0 });
    this.folkAt('creekB', 'zhitel', 'marsh', { color: '#fff0d8', hat: 'bow', accent: '#ff5a8a' }, { x: 25.2, y: 0, z: 13.0 }, 0.9, {});
    // the lab: Ириска, the princess (before the meeting she is on her stepladder by the telescope), Ноки after it
    const lc = lay.lab.center;
    this.folkAt('iriska', 'iriska', 'toffee', { color: '#e0a060', glasses: true, soot: true, apron: false, hold: 'extinguisher', hat: 'none' }, { x: lc.x + 1.5, y: 0, z: lc.z - 3.0 }, -0.3, { name: 'Ириска', speaker: 'iriska', collide: false });
    if (metInLab()) this.afterMeeting();
    else { const ld = this.ladderSpot(); this.figure('pastila', 'pastila', ld.at, ld.yaw); }
    const ps = lay.lab.princess;
    L.col({ kind: 'cyl', x: ps.x, z: ps.z, r: 0.38, y0: 0, y1: 1.2 });
  }

  /** after 4.4: the princess at her bench, Ноки by the lab door under her black umbrella (day), Ириска at her course */
  afterMeeting() {
    const lay = this.lay, lc = lay.lab.center, ps = lay.lab.princess;
    const pas = this.figure('pastila', 'pastila', V(ps.x, 0, ps.z), lay.lab.princessYaw);
    pas.face = null; pas.g.rotation.y = lay.lab.princessYaw;
    const noki = this.figure('noki', 'noki', V(lc.x + 3.9, 0, lc.z + 8.6), 0.4);
    noki.face = null; noki.g.rotation.y = 0.4;
    if (!lay.pal.night && !noki.g.getObjectByName('umbrella')) noki.g.add(umbrella());
    this.nokiSpot.copy(noki.g.position);
    const iri = this.folk.find((f) => f.id === 'iriska');
    if (iri && this.course) { iri.g.position.copy(this.course.host); iri.home.copy(this.course.host); iri.homeYaw = this.course.hostYaw; iri.g.rotation.y = this.course.hostYaw; }
  }
  /** the training course in the lab's yard (4.6) */
  course: Course | null = null;
  /** toasts waiting their turn (the course's button hints) */
  private toastQ: string[] = [];
  private toastT = 0;
  private courseToastT = 0;
  private comboI = 0;
  /** where Ноки can be talked to (after the meeting) */
  nokiSpot = new THREE.Vector3(0, -100, 0);

  /** where the princess stands on her stepladder by the telescope (before the meeting) */
  ladderSpot() {
    const lc = this.lay.lab.center;
    return { at: V(lc.x - 2.5, 1.05, lc.z - 2.0), yaw: Math.PI + 0.5 };
  }

  private placeSpots() {
    const L = this.L, lay = this.lay;
    // the shop
    this.spots.push({ pos: v3(lay.shop.counter), r: 2.6, dy: 2.4, label: () => 'Медовая лавка', act: () => this.openShop() });
    // the mirror
    this.spots.push({ pos: v3(lay.mirror.front), r: 2.6, dy: 3.6, label: () => 'Зеркало героев', act: () => this.useMirror() });
    // the board
    this.spots.push({ pos: v3(lay.board.front), r: 2.4, dy: 2.8, label: () => 'Доска объявлений', act: () => this.openBoard() });
    // the princess / Ноки / Ириска
    this.spots.push({
      pos: V(lay.lab.princess.x, 0, lay.lab.princess.z + 1.2), r: 2.2, dy: 2.2, label: () => 'Поговорить',
      when: () => metInLab(), act: () => this.talkPastila(),
    });
    // the course: a station's sign repeats its hints
    for (const st of this.course?.stations ?? []) this.spots.push({ pos: st.sign, r: 1.6, dy: 2.4, label: () => 'Подсказка', when: () => metInLab(), act: () => this.stationToasts(st) });
    // townsfolk: a chat = a bark (and a wave)
    for (const f of this.folk) {
      this.spots.push({ pos: f.g.position, r: f.mode === 'walk' ? 1.6 : 1.9, dy: f.rig.height + 0.6, label: () => 'Поболтать', act: () => this.chat(f) });
    }
    this.spots.push({ pos: this.nokiSpot, r: 1.9, dy: 2.4, label: () => 'Поговорить', when: () => metInLab() && !!this.figures.get('noki'), act: () => { const n = this.figures.get('noki'); if (n) this.chatFigure(n, 'noki'); } });
    void L;
  }

  private placeSecrets() {
    const L = this.L, r = this.lay.roofRoute;
    // the rooftop run: crumbs once (save ids), a big crumb and the golden walnut on the tower balcony
    let n = 0;
    const line = (a: THREE.Vector3, b: THREE.Vector3, k: number) => { for (let i = 0; i < k; i++) { const t = k === 1 ? 0.5 : i / (k - 1); L.pick('crumb', a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + 0.45, a.z + (b.z - a.z) * t, 'hub_roof_' + n++); } };
    line(V(38.5, 3.32, -13.6), V(38.5, 3.32, -10.4), 3);
    line(V(38.5, 4.76, -1.6), V(38.5, 4.76, 1.6), 3);
    line(V(38.5, 4.72, 3.4), V(38.5, 4.72, 5.6), 2);
    line(V(38.5, 6.6, 10.4), V(38.5, 6.6, 13.6), 3);
    L.pick('bigcrumb', 42.8, 7.7 + 0.45, 9.5, 'hub_roof_big');
    const last = r[r.length - 1];
    L.pick('nut', last.x, last.y + 0.75, last.z, 'nut_hub_tower');
    // the fountain's strawberry
    L.pick('bigcrumb', 0, 4.75, 0, 'hub_fountain_top');
    L.signAt(36.4, 1.3, -17.3, 'Ящики, крыши, мостик… А что там, на балконе башни?');
  }

  private placeSigns() {
    const L = this.L, lay = this.lay;
    L.signAt(-2.4, 0, 51.4, SIGNS.gate);
    L.signAt(3.8, 0, 50.6, SIGNS.road);
    L.signAt(2.9, 0, lay.lab.door.z + 1.4, SIGNS.lab);
    L.signAt(lay.shop.counter.x + 0.4, 0, lay.shop.counter.z - 4.0, SIGNS.shop);
    L.signAt(lay.mirror.front.x - 1.6, 0, lay.mirror.front.z + 3.2, SIGNS.mirror);
    L.signAt(lay.clock.x + 2.8, 0, lay.clock.z + 2.4, SIGNS.clock);
    L.signAt(-14.5, 0, 30.2, SIGNS.bakery);
    L.signAt(14.5, 0, 30.2, SIGNS.post);
    L.signAt(0, 0, 5.8, SIGNS.fountain);
    L.signAt(lay.board.front.x, 0, lay.board.front.z + 2.6, SIGNS.board);
  }

  // ───────────── per frame ─────────────

  /** before the level's own update: an open overlay takes the input */
  private preUpdate(dt: number) {
    const L = this.L;
    if (this.overlay) {
      this.overlay.update(dt);
      for (const a of BLOCK) input.consume(a);
      input.mouseClicked = false;
      L.player.control = false;
      if (this.overlay.done()) this.closeOverlay();
      return;
    }
    if (this.prompt && input.pressed('interact') && this.canAct()) {
      input.consume('interact');
      this.prompt.act();
    }
  }

  canAct() {
    const L = this.L, p = L.player;
    return !this.busy && !this.overlay && !this.leaving && !heroPickerOpen() && !L.inCutscene && !L.paused && !L.results && !L.settings && !L.popup.active
      && p.control && !p.dead && !p.downed && !p.hidden && L.letterbox < 0.05;
  }

  /** after the level's update (as a plugin) */
  update(dt: number) {
    const L = this.L;
    const t = L.nl ? net.time() : L.t;
    const cam = L.tcam.cam.position;
    const me = L.player.pos;
    // townsfolk
    for (const f of this.folk) this.updateFolk(f, dt, t, cam, me);
    // story figures
    const talking = speakingNow(L);
    for (const f of this.figures.values()) this.updateFigure(f, dt, talking);
    if (this.bear) this.bear.anim.state = 'stand';
    if (this.hideMe) { L.player.root.visible = false; L.player.blob.visible = false; }
    // the nearest thing to use
    this.prompt = null;
    if (this.canAct()) {
      let best = Infinity;
      for (const s of this.spots) {
        if (s.when && !s.when()) continue;
        const d = Math.hypot(me.x - s.pos.x, me.z - s.pos.z);
        if (d < s.r && d < best && Math.abs(me.y - s.pos.y) < 2.2) { best = d; this.prompt = s; }
      }
    }
    this.updateGate(dt);
    this.updateCourse(dt);
    this.updateLabHook();
    this.updateBoom(dt);
    // a purchase changes my hero right away (hearts, peas, the lid)
    if (this.overlay instanceof ShopOverlay) this.syncHero();
  }

  private updateFolk(f: Folk, dt: number, t: number, cam: THREE.Vector3, me: THREE.Vector3) {
    const L = this.L;
    if (f.path) {
      // walkers: the same spot on every machine (the room's clock)
      const d = ((t * f.speed + f.phase * f.len) % f.len + f.len) % f.len;
      let acc = 0;
      for (let i = 0; i < f.path.length; i++) {
        const a = f.path[i], b = f.path[(i + 1) % f.path.length];
        const l = a.distanceTo(b);
        if (acc + l >= d) {
          const k = (d - acc) / l;
          f.g.position.lerpVectors(a, b, k);
          f.g.rotation.y = lerpAng(f.g.rotation.y, Math.atan2(b.x - a.x, b.z - a.z), Math.min(1, dt * 8));
          break;
        }
        acc += l;
      }
    }
    const far = f.g.position.distanceTo(cam) > 60;
    f.g.visible = !far;
    if (far) return;
    const dx = me.x - f.g.position.x, dz = me.z - f.g.position.z;
    const dist = Math.hypot(dx, dz);
    const near = dist < 5 && !L.inCutscene && !this.hideMe;
    if (near && !f.near && f.mode !== 'walk') f.waveT = 1.4;
    f.near = near;
    f.barkCd -= dt;
    if (near && f.barkCd <= 0 && dist < 4.2) { this.bark(f); f.barkCd = 18 + Math.random() * 14; }
    f.waveT = Math.max(0, f.waveT - dt);
    f.talkT = Math.max(0, f.talkT - dt);
    const rel = Math.atan2(dx, dz) - f.g.rotation.y;
    const look = near ? Math.atan2(Math.sin(rel), Math.cos(rel)) : 0;
    if (f.mode === 'stand' && near && Math.abs(look) > 0.9) f.g.rotation.y = lerpAng(f.g.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 2.5));
    else if (f.mode === 'stand' && !near) f.g.rotation.y = lerpAng(f.g.rotation.y, f.homeYaw, Math.min(1, dt * 1.5));
    const sp = speakingNow(L);
    const speaking = !!sp && sp.id === f.speaker && sp.talking;
    f.anim.state = f.mode === 'walk' ? 'walk' : f.mode === 'sit' ? 'sit' : f.waveT > 0 ? 'wave' : f.talkT > 0 || speaking ? 'talk' : 'idle';
    f.anim.speed = f.mode === 'walk' ? Math.min(1, f.speed / 3) : 0;
    f.anim.talk = speaking || f.talkT > 0.6 ? Math.abs(Math.sin(L.t * 14)) : 0;
    f.anim.look = clamp(look, -1, 1);
    f.anim.grey = f.grey;
    f.rig.update(dt, f.anim);
  }

  private updateFigure(f: Figure, dt: number, talking: ReturnType<typeof speakingNow>) {
    if (f.walk) {
      const p = f.g.position, to = f.walk.to;
      const dx = to.x - p.x, dz = to.z - p.z, d = Math.hypot(dx, dz);
      const step = f.walk.speed * dt;
      if (d <= step) { p.x = to.x; p.z = to.z; f.walk = null; }
      else { p.x += dx / d * step; p.z += dz / d * step; f.g.rotation.y = lerpAng(f.g.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 10)); }
      f.anim.state = f.walk ? 'walk' : 'idle'; f.anim.speed = f.walk ? Math.min(1, f.walk.speed / 7.6) : 0;
    } else if (f.anim.state === 'walk') { f.anim.state = 'idle'; f.anim.speed = 0; }
    if (f.face !== null) f.g.rotation.y = lerpAng(f.g.rotation.y, f.face, Math.min(1, dt * 6));
    const on = !!talking && talking.id === f.speaker && talking.talking;
    f.anim.talk = on ? Math.abs(Math.sin(this.L.t * 15)) : 0;
    f.rig.update(dt, f.anim);
  }

  bark(f: Folk, line?: string) {
    const lines = barksOf(f.who, this.stage);
    if (!lines.length) return;
    const s = line ?? lines[Math.floor(Math.random() * lines.length)];
    this.L.bark(f.g, s, 2.6 + s.length * 0.03, f.rig.height + 0.45);
    f.talkT = 1.2;
  }

  // ───────────── interactions ─────────────

  private chat(f: Folk) {
    f.waveT = f.mode === 'walk' ? 0 : 0.8;
    this.bark(f);
    f.barkCd = 10;
  }
  private chatFigure(f: Figure, who: BarkWho) {
    const lines = barksOf(who, this.stage);
    const s = lines[Math.floor(Math.random() * lines.length)];
    this.L.bark(f.g, s, 2.6 + s.length * 0.03, 1.55);
    f.anim.talk = 1;
  }

  /** the shop: the first time the bear's scene (4.2, mine), then the den's shop UI */
  private openShop() {
    if (!save.has(HUB_SEEN.shop)) { save.collect(HUB_SEEN.shop); save.write(); this.personal(shopIntro(this), () => this.openShop()); return; }
    this.frameShop();
    this.openOverlay(new ShopOverlay(this));
    audio.sfx('door', { pitch: 1.3, volume: 0.5 });
  }

  private useMirror() {
    const L = this.L;
    if (metInLab() && !save.has(HUB_SEEN.mirror)) { save.collect(HUB_SEEN.mirror); save.write(); this.personal(mirrorScene(this), () => this.useMirror()); return; }
    const at = v3(this.lay.mirror.at).setY(1.8);
    L.fx.stars(at, 26, ['#ffffff', '#c8b4ff', '#ffd6f0']);
    audio.sfx('artifact', { pitch: 1.4, volume: 0.6 });
    const pick = TOWN_HOOKS.heroPicker;
    const ov = pick ? pick(L, at, () => { /* the overlay reports done() */ }) : null;
    if (ov) { this.openOverlay(ov); return; }
    // the roster's picker hosts itself over the game (my hero stands still, the co-op world keeps going)
    try { openHeroPicker({ note: TOASTS.mirrorNote }); } catch (e) { console.warn('[town] hero picker failed', e); L.hud.toast(TOASTS.mirrorSoon, 4); }
  }

  private openBoard() {
    audio.sfx('menuSelect');
    this.openOverlay(new BoardOverlay(this));
  }

  private talkPastila() {
    const lines = PASTILA_TALK[barkGroup(this.stage)];
    const f = this.figures.get('pastila');
    const self = this;
    this.personal((function* (): Script {
      if (f) { f.face = Math.atan2(self.L.player.pos.x - f.g.position.x, self.L.player.pos.z - f.g.position.z); }
      for (const s of lines) yield say(self.L, 'pastila', s);
      if (f) f.face = null;
    })(), undefined, f ? { look: f.g.position.clone().setY(1.3), from: 4.2 } : undefined);
  }

  /** a personal talk / scene (my machine only): my hero stops, lines advance on a press, the camera frames it */
  personal(g: Script, then?: () => void, frame?: { look: THREE.Vector3; from: number; pos?: THREE.Vector3 }) {
    const L = this.L;
    this.busy = true;
    L.player.control = false;
    L.player.body.vel.set(0, 0, 0);
    input.releaseLock();
    const d = L.dialog;
    const noIn = d.noInput;
    d.noInput = false;
    if (frame) { if (frame.pos) this.frame(frame.pos, frame.look); else this.frameAt(frame.look, frame.from); }
    const self = this;
    L.runGen((function* (): Script {
      try { yield* g; } finally {
        d.noInput = noIn;
        d.close();
        self.busy = false;
        self.unframe();
        if (!L.worldCut) L.player.control = true;
        self.hideMe = false;
        then?.();
      }
    })());
  }

  openOverlay(o: TownOverlay) {
    const L = this.L;
    this.overlay = o;
    L.player.control = false;
    L.player.body.vel.x = 0; L.player.body.vel.z = 0;
    input.releaseLock();
  }
  closeOverlay() {
    const L = this.L;
    this.overlay?.dispose?.();
    this.overlay = null;
    this.syncHero();
    this.unframe();
    if (!L.worldCut) L.player.control = true;
    input.clearAll();
  }

  /** my hero after shopping: hearts, peas, the lid (the HUD reads the save) */
  syncHero() {
    const p = this.L.player;
    const max = save.data.maxHp + (coop.easy ? 3 : 0);
    if (p.maxHp !== max) { p.maxHp = max; p.hp = max; }
    p.ammo = Math.max(p.ammo, save.data.ammoMax);
    p.lid = save.data.upgrades.lid;
  }

  // ───────────── camera framing (mine) ─────────────

  frameAt(look: THREE.Vector3, dist: number, side = 0.6, up = 1.0) {
    const L = this.L, p = L.player.pos;
    const dir = V(p.x - look.x, 0, p.z - look.z);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
    dir.normalize();
    const right = V(dir.z, 0, -dir.x);
    const pos = look.clone().addScaledVector(dir, dist).addScaledVector(right, side * dist).setY(look.y + up);
    this.frame(pos, look);
  }
  frame(pos: THREE.Vector3, look: THREE.Vector3, smooth = 3.2) {
    const tc = this.L.tcam;
    if (tc.mode !== 'cine') tc.beginCine();
    tc.cineSmooth = smooth;
    tc.cinePos.copy(pos);
    tc.cineLook.copy(look);
    this.framed = true;
  }
  unframe() {
    if (!this.framed) return;
    this.framed = false;
    const L = this.L;
    if (L.tcam.mode === 'cine' && !L.worldCut) L.tcam.endCine(L.camModeDefault, L.player.center().setY(L.player.pos.y + 0.95));
  }
  /** the shop: the bear on the left of the screen, the panel on the right */
  private frameShop() {
    const k = this.lay.shop.keeper, c = this.lay.shop.counter;
    const out = V(c.x - k.x, 0, c.z - k.z).normalize();
    // screen-right as seen from the street looking in at the counter
    const sr = V(out.z, 0, -out.x);
    const look = V(k.x, k.y + 1.5, k.z).addScaledVector(out, 0.6).addScaledVector(sr, 2.3);
    const pos = V(k.x, k.y + 1.8, k.z).addScaledVector(out, 6.6).addScaledVector(sr, 0.5);
    this.frame(pos, look, 4);
  }

  /** TOWN_HOOKS.labScene: an interlude another module wants played in the lab at this arc stage (host / solo decides) */
  private updateLabHook() {
    const L = this.L, hook = TOWN_HOOKS.labScene;
    if (!hook || !L.authority || L.worldCut || L.inCutscene || this.busy || !metInLab()) return;
    const name = hook(this.stage);
    if (!name || save.has('scene:' + name)) return;
    const c = this.lay.lab.center, r = this.lay.lab.r - 0.6;
    if (!L.alivePlayers().some((h) => Math.hypot(h.pos.x - c.x, h.pos.z - c.z) < r && h.pos.y < 3)) return;
    save.collect('scene:' + name); save.write();
    L.run(name);
  }

  // ───────────── «Полоса препятствий имени Ириски» (4.6) ─────────────

  private updateCourse(dt: number) {
    const L = this.L, c = this.course, p = L.player.pos;
    this.courseToastT = Math.max(0, this.courseToastT - dt);
    if (this.toastQ.length) { this.toastT -= dt; if (this.toastT <= 0) { L.hud.toast(this.toastQ.shift()!, 6); this.toastT = 6.2; } }
    if (!c || !this.canAct()) return;
    const inside = (b: { x0: number; z0: number; x1: number; z1: number }) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1 && p.y < 3;
    if (!inside(c.area) && !inside(c.gate)) return;
    if (!metInLab()) { if (this.courseToastT <= 0) { L.hud.toast(TRAIN_CLOSED, 4); this.courseToastT = 8; } return; }
    if (!save.has('hub:train:entry')) { save.collect('hub:train:entry'); save.write(); this.personal(this.trainLines(TRAIN_ENTRY), undefined, this.courseFrame()); return; }
    for (const st of c.stations) {
      if (!inside(st.mat) || save.has('hub:train:' + st.kind)) continue;
      save.collect('hub:train:' + st.kind); save.write();
      const all4 = c.stations.every((s) => save.has('hub:train:' + s.kind));
      const self = this;
      this.personal((function* (): Script {
        yield* self.trainLines(TRAIN[st.kind].lines);
        if (all4 && !save.has('hub:train:done')) { save.collect('hub:train:done'); save.write(); yield* self.trainLines([TRAIN_EXIT]); }
      })(), () => {
        this.stationToasts(st);
        const iri = this.folk.find((f) => f.id === 'iriska');
        if (iri) this.bark(iri, TRAIN_COMBOS[this.comboI++ % TRAIN_COMBOS.length]);
      }, { look: st.focus, from: 0, pos: V(st.focus.x + 0.8, 3.6, -35.8) });
      return;
    }
  }

  /** lines of the course with the speakers' portraits (Ириска turns to me while she talks) */
  private *trainLines(lines: TrainLine[]): Script {
    const iri = this.folk.find((f) => f.id === 'iriska');
    for (const [who, txt, expr] of lines) {
      if (iri && who === 'iriska') iri.waveT = 0.6;
      yield say(this.L, who, txt, expr);
    }
  }
  private courseFrame() {
    const h = this.course!.host;
    return { look: h.clone().setY(1.1), from: 4.4 };
  }
  /** the station's two button hints for whoever plays its hero; the others are sent to the mirror */
  stationToasts(st: Station) {
    const kind = this.L.player.kind;
    this.toastQ.length = 0;
    if (kind === st.kind) { this.toastQ.push(...TRAIN[st.kind].toasts.map(actText)); this.toastT = 0; }
    else { this.L.hud.toast(TRAIN_OTHER, 4); }
  }

  // ───────────── the gate (to the map) ─────────────

  private updateGate(dt: number) {
    const L = this.L, p = L.player, z = this.lay.gate.zone;
    if (this.gateFollow) { this.gateFollow.t = Math.max(0, this.gateFollow.t - dt); }
    this.gateToastT = Math.max(0, this.gateToastT - dt);
    if (this.leaving || L.inCutscene) return;
    const inside = !p.dead && !p.hidden && p.pos.x > z.min.x && p.pos.x < z.max.x && p.pos.z > z.min.z && p.pos.z < z.max.z && p.pos.y < z.max.y;
    if (!L.nl) {
      if (inside) { this.leaving = true; this.toMap(); }
      return;
    }
    if (net.isHost) {
      if (inside) {
        if (this.gateT === 0) { net.send('all', 'town_gate', { go: 1, name: net.me?.name ?? 'Хозяин' }); audio.sfx('door', { volume: 0.5 }); }
        this.gateT += dt;
        if (this.gateT >= 3) { this.leaving = true; this.toMap(); }
      } else if (this.gateT > 0) { this.gateT = 0; net.send('all', 'town_gate', { go: 0 }); }
    } else if (inside && this.gateToastT <= 0) {
      this.gateToastT = 6;
      L.hud.toast(TOASTS.gateClient, 3.5);
    }
  }

  private toMap() {
    const L = this.L;
    audio.sfx('door');
    L.fadeFlash();
    if (!L.nl) { save.data.mapAt = 'hub'; save.write(); game.toMap(); return; }
    save.data.mapAt = 'hub';
    coopFlow.hostMap();
  }

  // ───────────── the lab's «БУМ!» (4.1) ─────────────

  startBoom() {
    const L = this.L;
    const c = this.lay.lab.center;
    const at = V(c.x, 11.5, c.z);
    L.fx.stars(at, 40, ['#ff9fc0', '#ffffff', '#ffd6e4']);
    L.fx.ring(at.clone(), 3.5, '#ffb3cc', 0.6, false);
    L.tcam.shake(0.25);
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color: '#ffc4d8', transparent: true, opacity: 0.9, depthWrite: false });
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), m);
      const a = (i / 7) * Math.PI * 2;
      s.position.set(Math.cos(a) * 1.3, Math.sin(i * 1.7) * 0.5, Math.sin(a) * 1.3);
      s.scale.setScalar(0.9 + (i % 3) * 0.3);
      g.add(s);
    }
    g.position.copy(at);
    g.layers.set(1); g.traverse((o) => o.layers.set(1));
    L.scene.add(g);
    this.boom = g; this.boomT = 0;
  }
  private updateBoom(dt: number) {
    if (!this.boom) return;
    this.boomT += dt;
    const k = this.boomT / 6;
    this.boom.position.y += dt * 0.9;
    this.boom.scale.setScalar(1 + ease.outCubic(Math.min(1, this.boomT)) * 1.8 + k);
    ((this.boom.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = clamp(0.9 * (1 - k), 0, 0.9);
    if (k >= 1) { this.L.scene.remove(this.boom); this.boom = null; }
  }

  // ───────────── drawing (plugin) ─────────────

  draw(ctx: CanvasRenderingContext2D) {
    const L = this.L, cam = L.tcam.cam;
    if (this.prompt && !this.overlay && this.canAct()) {
      const s = this.prompt;
      const u = toUI(s.pos.clone().setY(s.pos.y + s.dy), cam);
      if (u.vis) {
        ctx.save();
        const label = s.label();
        ctx.font = '400 20px Pangolin, sans-serif';
        const w = 46 + ctx.measureText(label).width;
        const x = clamp(u.x - w / 2, 10, W - w - 10), y = clamp(u.y, 40, H - 40);
        rrect(ctx, x - 10, y - 20, w + 20, 40, 14, 'rgba(30,14,22,0.72)', 0);
        drawHint(ctx, 'interact', label, x, y, { size: 26 });
        ctx.restore();
      }
    }
    // the gate countdown (host and the room)
    const n = net.isHost && this.gateT > 0 ? Math.ceil(3 - this.gateT) : this.gateFollow ? Math.ceil(this.gateFollow.t) : 0;
    if (L.nl && n > 0 && !this.leaving) {
      const str = net.isHost ? TOASTS.gateHost(n) : TOASTS.gateFollow(this.gateFollow?.name ?? '', n);
      ctx.save();
      ctx.font = '900 30px Rubik, sans-serif';
      const w = ctx.measureText(str).width + 60;
      rrect(ctx, W / 2 - w / 2, 96, w, 56, 18, 'rgba(30,14,22,0.78)', 4);
      text(ctx, str, W / 2, 134, { size: 30, color: '#9ae06a', align: 'center', stroke: 5 });
      ctx.restore();
    }
    this.overlay?.draw(ctx);
  }

  dispose() {
    for (const off of this.offNet) off();
    this.offNet.length = 0;
    this.overlay?.dispose?.();
    this.overlay = null;
    for (const f of this.folk) f.rig.dispose();
    for (const f of this.figures.values()) f.rig.dispose();
  }
}

/** the script's action placeholders → the player's buttons ([прыжок], [атака], [рывок], [приём], [гаджет], [E]) */
function actText(s: string): string {
  const map: Record<string, Action> = { '[прыжок]': 'jump', '[атака]': 'attack', '[выстрел]': 'shoot', '[рывок]': 'dash', '[приём]': 'special', '[гаджет]': 'swap', '[E]': 'interact' };
  return s.replace(/\[(прыжок|атака|выстрел|рывок|приём|гаджет|E)\]/g, (m) => glyphLabel(map[m]));
}

/** a note's text in short lines for the paper (≈ 18 letters each) */
function noteLines(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of s.split(' ')) {
    if ((cur + ' ' + w).trim().length > 17 && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out.length > 5 ? [...out.slice(0, 4), out[4] + '…'] : out;
}

// ───────────────────────── overlays ─────────────────────────

/** the den's shop panel over the town, the bear on the left */
class ShopOverlay implements TownOverlay {
  den: DenScene;
  private closed = false;
  private lastBubble = '';
  constructor(private hub: TownHub) {
    const st = Math.min(hub.stage, SHOP_GREET.length - 1);
    this.den = new DenScene(3, null, { shop: { title: 'Лавка Вторника', keeper: 'Вторник', greet: SHOP_GREET[st], react: SHOP_REACT, closeLabel: 'Спасибо, до встречи!', close: () => { this.closed = true; } } });
  }
  private t = 0;
  update(dt: number) {
    // a moment of grace: the press that finished the bear's last line must not hit «Спасибо, до встречи!»
    this.t += dt;
    if (this.t < 0.5) { this.den.t += dt; this.den.bubbleT += dt; input.menuTick(); return; }
    this.den.update(dt);
    if (this.den.bubble !== this.lastBubble) { this.lastBubble = this.den.bubble; }
    if (this.hub.bear && this.den.bubbleT < 1.6) this.hub.bear.talk = 0.35;
  }
  draw(ctx: CanvasRenderingContext2D) {
    const L = this.hub.L;
    const k = this.hub.lay.shop.keeper;
    const head = toUI(V(k.x, k.y + 2.0, k.z), L.tcam.cam);
    this.den.renderPanel(ctx, true, clamp(head.x - 60, 20, 250), clamp(head.y - 10, 140, 420));
  }
  done() { return this.closed; }
}

/** the notice board: the stage's notes and what's next */
class BoardOverlay implements TownOverlay {
  private t = 0;
  private closed = false;
  private notes: string[];
  private next: { title: string; sub: string; teaser: string } | null;
  constructor(private hub: TownHub) {
    this.notes = BOARD[Math.min(hub.stage, BOARD.length - 1)];
    const prog = coop.active ? coopFlow.mapProg() : myProgress();
    const nextId = ARC_IDS.find((id) => !prog[id]?.done) ?? null;
    const ep = nextId ? EPISODES[nextId] : null;
    this.next = ep ? { title: `Серия ${ep.n}. ${ep.title}`, sub: ep.subtitle, teaser: ep.teaser ?? '' } : null;
  }
  update(dt: number) {
    this.t += dt;
    input.menuTick();
    if (this.t > 0.25 && (input.pressed('back') || input.pressed('confirm') || input.pressed('interact') || input.pressed('attack') || input.pressed('jump') || input.mouseClicked)) { this.closed = true; audio.sfx('menuMove'); }
  }
  draw(ctx: CanvasRenderingContext2D) {
    const a = ease.outBack(clamp(this.t * 4, 0, 1));
    ctx.save();
    ctx.fillStyle = `rgba(20,10,16,${0.45 * clamp(this.t * 4, 0, 1)})`; ctx.fillRect(-2000, -2000, W + 4000, H + 4000);
    const pw = 860, ph = 520, px = W / 2 - pw / 2, py = H / 2 - ph / 2 - 10;
    ctx.translate(W / 2, H / 2); ctx.scale(a, a); ctx.translate(-W / 2, -H / 2);
    rrect(ctx, px + 8, py + 10, pw, ph, 26, 'rgba(0,0,0,0.35)', 0);
    rrect(ctx, px, py, pw, ph, 26, '#c8803e', 5);
    rrect(ctx, px + 18, py + 18, pw - 36, ph - 36, 18, '#e2b07a', 3);
    text(ctx, 'Доска объявлений', W / 2, py + 64, { size: 36, color: '#fff7e6', align: 'center', stroke: 7 });
    const colors = ['#fff8e8', '#fff0f6', '#eef8ff'];
    const n = this.notes.length;
    const nw = 236, gap = 22, total = n * nw + (n - 1) * gap;
    this.notes.forEach((s, i) => {
      const x = W / 2 - total / 2 + i * (nw + gap), y = py + 96 + (i % 2) * 10;
      ctx.save(); ctx.translate(x + nw / 2, y + 100); ctx.rotate((i - (n - 1) / 2) * 0.035); ctx.translate(-nw / 2, -100);
      rrect(ctx, 4, 6, nw, 210, 10, 'rgba(0,0,0,0.25)', 0);
      rrect(ctx, 0, 0, nw, 210, 10, colors[i % 3], 3);
      ctx.fillStyle = ['#ff4f6a', '#4fa8ff', '#5ac85a'][i % 3]; ctx.beginPath(); ctx.arc(nw / 2, 12, 9, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.font = '400 20px Pangolin, sans-serif';
      wrap(ctx, s, nw - 30).slice(0, 7).forEach((l, k) => text(ctx, l, nw / 2, 48 + k * 24, { size: 20, font: 'body', color: '#4a2a3a', align: 'center' }));
      ctx.restore();
    });
    if (this.next) {
      const y = py + 340;
      rrect(ctx, px + 40, y, pw - 80, 120, 16, '#fff7e6', 3);
      text(ctx, 'Следующая серия:', px + 64, y + 34, { size: 20, font: 'body', color: '#8a4a2a' });
      text(ctx, this.next.title, px + 230, y + 36, { size: 26, color: '#c8304a', stroke: 0 });
      ctx.font = '400 20px Pangolin, sans-serif';
      wrap(ctx, this.next.teaser, pw - 140).slice(0, 2).forEach((l, k) => text(ctx, l, px + 64, y + 68 + k * 24, { size: 20, font: 'body', color: OUT }));
    } else {
      text(ctx, 'Вся Хрумляндия снова в красках!', W / 2, py + 400, { size: 26, color: '#c8304a', align: 'center', stroke: 0 });
    }
    text(ctx, 'Нажмите любую кнопку, чтобы закрыть', W / 2, py + ph - 26, { size: 17, font: 'body', color: '#5a3a2a', align: 'center' });
    ctx.restore();
  }
  done() { return this.closed; }
}

// ───────────────────────── scenes (docs/script-fangs.md §4) ─────────────────────────

const hubOf = (L: Level3D) => L.refs.town as TownHub | undefined;
const pl = (L: Level3D, solo: string, coopStr: string) => (L.nl ? coopStr : solo);
void pl;

/** a figure walks to (x, z) at speed (a Waiter, capped) */
function walkFig(f: Figure | undefined, x: number, z: number, speed = 2.4, max = 5): Waiter {
  if (!f) return { update: () => true };
  f.walk = { to: V(x, f.g.position.y, z), speed };
  let t = 0;
  return { update: (dt) => { t += dt; if (t > max) { f.walk = null; f.g.position.set(x, f.g.position.y, z); } return !f.walk; } };
}

/** 4.1 hub_arrival — at the gate (world scene, first entry) */
function* hubArrival(L: Level3D): Script {
  const hub = hubOf(L);
  if (!hub) return;
  save.collect(HUB_SEEN.arrival);
  L.cutscene(true);
  const tosha = hub.figure('tosha', 'tosha', V(-0.7, 0, 62.5), Math.PI);
  const bublik = hub.figure('bublik', 'bublik', V(0.9, 0, 63.2), Math.PI);
  const pry = hub.folk.find((f) => f.id === 'pryanik');
  // the road, the gate, the towers behind
  yield L.shot(V(0, 3.4, 76), V(0, 6, 40), 0);
  yield all(L.shot(V(1.4, 2.7, 70), V(0, 2.3, 52), 4.2), walkFig(tosha, -0.7, 57.6, 1.6, 6), walkFig(bublik, 0.9, 58.2, 1.6, 6), say(L, 'narrator', 'К вечеру Тоша и Бублик дошли до зефирных башен. Бублик шёл на запах. Тоша — за Бубликом.'));
  // Пряник steps out with his rolling pin
  if (pry) { pry.mode = 'stand'; pry.g.position.set(-0.3, 0, 55.2); pry.g.rotation.y = 0; pry.homeYaw = 0; }
  yield L.shot(V(2.2, 2.0, 52.2), V(-0.2, 1.0, 58.0), 0.8);
  yield say(L, 'pryanik', 'Стой! Кто идёт? Пароль!', 'angry');
  tosha.face = Math.PI;
  yield say(L, 'tosha', 'Э-э… Здравствуйте?', 'surprised');
  yield say(L, 'pryanik', 'Неверно. Пароль — «пожалуйста». Ну да ладно, вежливых пускаем и так. Проходите!');
  // (he steps aside, still in the picture with the two — at his post by the wall he talked from behind the camera)
  if (pry) { pry.g.position.set(-2.3, 0, 53.3); pry.g.rotation.y = 1.25; pry.homeYaw = 1.25; }
  yield all(L.shot(V(0.9, 2.0, 50.3), V(-0.6, 1.0, 54.4), 1.0), walkFig(tosha, -0.6, 54.4, 2.0), walkFig(bublik, 0.9, 54.8, 2.0));
  bublik.anim.expr = 'happy';
  yield say(L, 'bublik', 'Тоша, тут пахнет пастилой, пряниками и зефиром. Я что, в раю?', 'happy');
  yield say(L, 'pryanik', 'Вы в Пастильном королевстве. Рай — это дальше, в пекарне у Мадам Безе.');
  yield say(L, 'tosha', 'Нам нужна принцесса Пастила! Утром над скалой вспыхнула красная луна!');
  yield say(L, 'pryanik', 'Тс-с! Не кричите про луну — жителей перепугаете.', 'scared');
  yield say(L, 'pryanik', 'Принцесса в лаборатории, в розовой башне. Стучите погромче: она там что-то взрывает.');
  // a distant «БУМ!» and a pink cloud over the pink tower: behind the two, through the gate
  tosha.face = Math.PI; bublik.face = Math.PI;
  yield L.shot(V(1.3, 1.9, 58.8), V(0, 4.6, 26), 1.0);
  hub.startBoom();
  audio.sfx('boom', { volume: 0.5 });
  L.hud.showBanner('БУМ!', '#ff7aa8');
  yield wait(1.4);
  yield say(L, 'bublik', '…Кажется, она дома.');
  yield wait(0.2);
  hub.dropFigure('tosha'); hub.dropFigure('bublik');
  if (pry) { pry.g.position.set(-3.4, 0, 51.6); pry.g.rotation.y = 2.6; pry.homeYaw = 2.6; }
  L.cutscene(false);
  yield L.camBack(0.6);
  L.hud.showChapter(L.def.title, L.def.subtitle);
  L.bannerShown = true;
  L.hud.toast('Розовая башня — лаборатория принцессы. Можно погулять по городу или идти прямо к ней', 6);
  save.write();
}

/** 4.2 the shop intro (mine): the bear behind the counter, Тоша and Бублик in front */
function* shopIntro(hub: TownHub): Script {
  const L = hub.L;
  const c = v3(hub.lay.shop.counter), k = v3(hub.lay.shop.keeper);
  const out = c.clone().sub(k).setY(0).normalize();
  const side = V(-out.z, 0, out.x);
  hub.hideMe = true;
  const tAt = c.clone().addScaledVector(side, 0.8).addScaledVector(out, -0.4);
  const bAt = c.clone().addScaledVector(side, -0.9).addScaledVector(out, -0.2);
  const tosha = hub.figure('s_tosha', 'tosha', tAt, Math.atan2(-out.x, -out.z));
  const bublik = hub.figure('s_bublik', 'bublik', bAt, Math.atan2(-out.x, -out.z));
  hub.frame(k.clone().addScaledVector(out, 4.2).addScaledVector(side, 1.4).setY(2.2), k.clone().setY(k.y + 1.2));
  try {
    yield say(L, 'bear', 'Хо-хо! Кого я вижу! Нашли-таки по запаху мёда?', 'happy');
    hub.frame(c.clone().addScaledVector(out, 4.0).addScaledVector(side, -2.2).setY(2.0), c.clone().addScaledVector(out, -1.2).setY(1.0));
    yield say(L, 'tosha', 'Дедушка Вторник?! Вы же сказали, у вас свои дела!', 'surprised');
    yield say(L, 'bear', 'Так вот они, дела! Сорок лет мечтал о своей лавке. Я шёл напрямки, через малинник.');
    yield say(L, 'bublik', 'А мы по тропинке. И нюхали каждый куст. Это важно.');
    hub.frame(k.clone().addScaledVector(out, 4.2).addScaledVector(side, 1.4).setY(2.2), k.clone().setY(k.y + 1.2));
    yield say(L, 'bear', 'Крошки и тут вместо денег. Тащите — всё старое добро при мне, и кое-что новенькое привезли.');
    if (metInLab()) yield say(L, 'bear', 'Слыхал, вы теперь с принцессой и Ноки? Для всех четверых найдётся товар. Хо-хо.');
    else yield say(L, 'bear', 'А как познакомитесь с принцессой — найдётся товар и для ваших новых друзей. Хо-хо.');
  } finally {
    hub.dropFigure('s_tosha'); hub.dropFigure('s_bublik');
    void tosha; void bublik;
  }
}

/** 4.5 the mirror, first approach after 4.4 (mine) */
function* mirrorScene(hub: TownHub): Script {
  const L = hub.L;
  const m = v3(hub.lay.mirror.at), front = v3(hub.lay.mirror.front);
  const out = front.clone().sub(m).setY(0).normalize();
  const side = V(-out.z, 0, out.x);
  const face = Math.atan2(-out.x, -out.z);
  hub.hideMe = true;
  const at = (a: number, b: number) => front.clone().addScaledVector(out, a).addScaledVector(side, b).setY(0.3);
  const fp = hub.figure('m_pastila', 'pastila', at(-0.3, 1.6), face);
  const fn = hub.figure('m_noki', 'noki', at(-0.4, -2.9), face + Math.PI - 0.5);
  if (!hub.lay.pal.night && !fn.g.getObjectByName('umbrella')) fn.g.add(umbrella());
  const fb = hub.figure('m_bublik', 'bublik', at(0.6, -0.6), face);
  const ft = hub.figure('m_tosha', 'tosha', at(0.4, -1.8), face);
  hub.frame(front.clone().addScaledVector(out, 5.2).addScaledVector(side, 0.6).setY(2.4), m.clone().setY(1.8));
  try {
    yield say(L, 'pastila', 'Зеркало героев. Посмотрите — и побудьте Тошей, Бубликом, Ноки или мной.');
    yield say(L, 'noki', 'Я в него не смотрю. Оно мне ничего не показывает.');
    yield say(L, 'bublik', 'А если все захотят быть мной?');
    yield say(L, 'pastila', 'Зеркало не жадное. Хоть шесть Бубликов.');
    fb.anim.expr = 'happy';
    yield say(L, 'bublik', 'Шесть Бубликов — это уже не отряд. Это пекарня.', 'happy');
  } finally {
    for (const k of ['m_pastila', 'm_noki', 'm_bublik', 'm_tosha']) hub.dropFigure(k);
    void fp; void fn; void ft;
  }
  L.hud.toast(`Подойдите к зеркалу и нажмите ${glyphLabel('interact')} — выбор героя`, 5);
}

/** 4.3 hub_lab_meet — the lab: Пастила on her stepladder, a bat, Ноки through the window (world scene) */
function* labMeet(L: Level3D): Script {
  const hub = hubOf(L);
  if (!hub) return;
  save.collect(HUB_SEEN.meet);
  const c = v3(hub.lay.lab.center);
  const at = (x: number, z: number, y = 0) => V(c.x + x, y, c.z + z);
  L.cutscene(true);
  const tosha = hub.figure('tosha', 'tosha', at(-0.7, 6.2), Math.PI);
  const bublik = hub.figure('bublik', 'bublik', at(0.8, 6.4), Math.PI);
  const ld = hub.ladderSpot();
  const pas = hub.figure('pastila', 'pastila', ld.at, ld.yaw);
  pas.face = ld.yaw;
  const iri = hub.folk.find((f) => f.id === 'iriska');
  if (iri) { iri.g.position.copy(at(1.5, -3.0)); iri.homeYaw = -0.3; iri.g.rotation.y = -0.3; }
  // from the door: the princess on her stepladder, back to us, writing
  yield L.shot(at(0.4, 8.0, 2.0), at(-1.8, -2.0, 1.9), 0);
  yield all(walkFig(tosha, c.x - 0.6, c.z + 2.8, 2.0), walkFig(bublik, c.x + 0.8, c.z + 3.0, 2.0), L.shot(at(0.6, 5.6, 1.9), at(-1.9, -1.8, 1.9), 1.6));
  yield say(L, 'tosha', 'Принцесса Пастила? Здравствуйте! Мы видели красную луну!', 'happy');
  yield say(L, 'pastila', 'Алую. Сегодня в 6:42 утра, над Чёрным перевалом. Ровно ноль целых восемь десятых секунды.');
  // she turns around
  pas.face = 0.4;
  yield L.shot(at(-0.4, 1.4, 1.8), at(-2.4, -2.0, 1.9), 0.8);
  yield say(L, 'pastila', 'Погодите. Вы тоже видели? А вы кто такие?', 'surprised');
  // …and comes down
  pas.g.position.copy(at(-1.6, -0.9)); pas.face = 0.3; L.fx.dust(pas.g.position.clone(), 8);
  yield L.shot(at(1.6, 3.6, 1.7), at(-0.8, 0.8, 1.1), 0.8);
  yield say(L, 'tosha', 'Я Тоша, это Бублик. Мы утром выбрались из Ямы Громадин!');
  yield say(L, 'pastila', 'Из Ямы Громадин? Оттуда никто не выбирается. Потрясающе. Можно я вас потом измерю?', 'surprised');
  yield say(L, 'bublik', 'Можно. Только не щекотно.');
  // a bat through the right window, fluttering over the flasks
  const win = at(5.5, 0.2, 2.7);
  const bat = makeBat();
  bat.scale.setScalar(1.8);
  bat.position.copy(win);
  L.scene.add(bat);
  audio.sfx('break', { pitch: 1.6, volume: 0.6 });
  L.fx.sparks(win.clone(), 16, ['#e8f8ff', '#ffffff', '#bfe6ff']);
  let bt = 0;
  const flyTo = (dt: number, target?: THREE.Vector3) => {
    bt += dt;
    const home = target ?? at(0.6 + Math.sin(bt * 2.2) * 1.8, -2.9 + Math.cos(bt * 2.2) * 0.6, 2.3 + Math.sin(bt * 5) * 0.3);
    bat.position.lerp(home, Math.min(1, dt * 4));
    bat.lookAt(home.x + Math.cos(bt * 2.2), home.y, home.z - Math.sin(bt * 2.2));
    flap(bat, bt);
  };
  const flyFor = (sec: number): Waiter => { let t = 0; return { update: (dt) => { flyTo(dt); t += dt; return t >= sec; } }; };
  for (const f of [tosha, bublik, pas]) f.face = Math.atan2(bat.position.x - f.g.position.x, bat.position.z - f.g.position.z);
  yield all(L.shot(at(-1.4, 2.4, 2.2), at(1.2, -2.6, 2.1), 0.6), flyFor(0.9));
  pas.anim.expr = 'scared';
  yield all(say(L, 'pastila', 'Летучая мышь! Не дайте ей сесть на пастилу — выпьет весь вкус!', 'scared'), flyFor(0.1));
  // Ноки in through the window — one swing: ДЗЫНЬ!
  const land = at(2.7, 0.9);
  const noki = hub.figure('noki', 'noki', win.clone().setY(2.2), -Math.PI / 2);
  noki.face = null;
  L.fx.sparks(win.clone(), 20, ['#e8f8ff', '#ffffff', '#c8304a']);
  audio.sfx('break', { pitch: 1.2, volume: 0.6 });
  let nt = 0;
  const jump: Waiter = { update: (dt) => {
    nt += dt; flyTo(dt, land.clone().add(V(-1.0, 1.7, -0.6)));
    const k = Math.min(1, nt / 0.7);
    noki.g.position.set(win.x + (land.x - win.x) * k, 2.2 * (1 - k) + Math.sin(k * Math.PI) * 1.2, win.z + (land.z - win.z) * k);
    noki.anim.state = k < 1 ? 'jump' : 'idle';
    noki.g.rotation.y = Math.atan2(land.x - 1.0 - noki.g.position.x, land.z - 0.6 - noki.g.position.z);
    return k >= 1;
  } };
  yield all(L.shot(at(-0.9, 3.4, 2.0), at(2.4, 0.4, 1.5), 0.5), jump);
  noki.anim.attack = { kind: 'axe', p: 0 };
  let swing = 0;
  yield { update: (dt: number) => { swing += dt; flyTo(dt, land.clone().add(V(-1.0, 1.6, -0.6))); if (noki.anim.attack) noki.anim.attack.p = Math.min(1, swing / 0.4); return swing >= 0.4; } };
  noki.anim.attack = null;
  L.fx.chunks(bat.position.clone(), 14, ['#9a96a2', '#c8c4cc', '#6a6672']);
  L.fx.ring(bat.position.clone(), 1.6, '#c8c4cc', 0.4, false);
  audio.sfx('clang', { pitch: 1.4 });
  L.scene.remove(bat);
  pas.anim.expr = 'normal';
  for (const f of [tosha, bublik, pas]) f.face = Math.atan2(noki.g.position.x - f.g.position.x, noki.g.position.z - f.g.position.z);
  noki.face = Math.atan2(pas.g.position.x - noki.g.position.x, pas.g.position.z - noki.g.position.z);
  yield L.shot(at(-0.5, 3.6, 1.8), at(2.6, 0.6, 1.3), 0.6);
  yield say(L, 'noki', 'Двери — для тех, кого ждут. Привет, Пастила.', 'sly');
  yield L.shot(at(0.6, 4.4, 2.0), at(0.4, -0.2, 1.1), 0.6);
  yield say(L, 'pastila', 'Ноки! Третье окно за месяц!', 'angry');
  yield say(L, 'noki', 'Это был разведчик Короля Полночь. Где разведчик — там к ночи будет вся стая.');
  yield L.shot(at(1.2, 5.6, 1.7), at(-0.2, 2.2, 1.0), 0.6);
  yield say(L, 'tosha', 'Какого короля? Ещё одного?!', 'surprised');
  yield say(L, 'noki', 'Того самого. Алая луна взойдёт сегодня ночью. Он проснулся.');
  yield say(L, 'bublik', 'Мне уже не нравится этот король. А я его даже не видел.', 'scared');
  yield L.shot(at(0.6, 4.4, 2.0), at(0.4, -0.2, 1.1), 0.6);
  yield say(L, 'pastila', 'Мой Солнечный сироп не готов. Есть только пробная банка. Нам нужна помощь.');
  // 4.4 follows right away (its own scene, so each fits the co-op watchdog)
  if (L.authority) L.runGen((function* (): Script { yield wait(0.05); L.run('hub_lab_plan'); })());
  yield wait(0.1);
}

/** 4.4 hub_lab_plan — the model of Хрумляндия, the mirror, the plan for the night (world scene); opens series 2 */
function* labPlan(L: Level3D): Script {
  const hub = hubOf(L);
  if (!hub) return;
  const c = v3(hub.lay.lab.center);
  const at = (x: number, z: number, y = 0) => V(c.x + x, y, c.z + z);
  L.cutscene(true);
  const tosha = hub.figure('tosha', 'tosha', at(-0.6, 2.8), Math.PI);
  const bublik = hub.figure('bublik', 'bublik', at(0.8, 3.0), Math.PI);
  const pas = hub.figure('pastila', 'pastila', at(-1.6, -0.9), 0.3);
  const noki = hub.figure('noki', 'noki', at(2.7, 0.9), -1.9);
  const iri = hub.folk.find((f) => f.id === 'iriska');
  if (iri) { iri.g.position.copy(at(1.5, -3.0)); iri.homeYaw = -0.3; }
  const table = at(-0.6, 0.9);
  // everyone at the table-model
  yield all(walkFig(tosha, table.x - 1.2, table.z + 1.7, 2.2), walkFig(bublik, table.x + 0.6, table.z + 1.8, 2.2), walkFig(pas, table.x - 1.8, table.z - 0.6, 2.2), walkFig(noki, table.x + 1.8, table.z - 0.5, 2.2),
    L.shot(at(0.8, 5.6, 2.6), V(table.x, 1.0, table.z), 1.0));
  for (const f of [tosha, bublik, pas, noki]) f.face = Math.atan2(table.x - f.g.position.x, table.z - f.g.position.z);
  yield say(L, 'tosha', 'Мы поможем! Правда, Бублик?', 'happy');
  yield say(L, 'bublik', 'Правда. Если потом будет пирог.');
  yield L.shot(V(table.x + 0.3, 4.4, table.z + 1.6), V(table.x, 0.9, table.z - 0.1), 1.0);
  yield say(L, 'pastila', 'Будет. Смотрите: это вся Хрумляндия. Я склеила её сама.', 'happy');
  yield say(L, 'pastila', 'Где побывали — там краски. Где нет — туман. Ходите — макет сам дорисуется.');
  yield say(L, 'pastila', 'А это вам — карманная копия. Не мните. И флажки не отклеивайте.');
  yield L.shot(V(table.x - 2.2, 2.0, table.z + 2.8), V(table.x + 1.6, 1.3, table.z - 0.5), 0.8);
  yield say(L, 'noki', 'Видите чёрный замок на скале? Замок Полночь. Туда не суйтесь. Пока.');
  yield say(L, 'pastila', 'На площади стоит моё Зеркало героев. Глянете в него — и на время станете одним из нас.');
  yield L.shot(V(table.x + 1.8, 1.7, table.z + 3.4), V(table.x - 0.2, 1.0, table.z + 1.4), 0.7);
  yield say(L, 'bublik', 'Я уже глянул, пока шли. Полчаса был принцессой. Хвост остался.', 'happy');
  yield say(L, 'pastila', 'Побочный эффект. Научно доказано: проходит.', 'sly');
  yield L.shot(V(table.x - 2.2, 2.0, table.z + 2.8), V(table.x + 1.6, 1.3, table.z - 0.5), 0.6);
  yield say(L, 'noki', 'До темноты пара часов. Готовьтесь: лавка, тренировка, что там у вас ещё.');
  yield say(L, 'pastila', 'Как стемнеет — все на площадь, к часовой башне. Ириска покажет полосу препятствий.');
  if (iri) { yield L.shot(at(-0.6, -1.0, 1.7), iri.g.position.clone().setY(0.9), 0.6); iri.waveT = 1.6; }
  yield say(L, 'iriska', 'Полоса препятствий имени меня! Почти не взрывается!', 'happy');
  // the four part: Тоша and Бублик are the players again; the princess stays, Ноки waits in the shade by the window
  setStoryFlag(LAB_FLAG);
  hub.dropFigure('tosha'); hub.dropFigure('bublik');
  hub.afterMeeting();
  L.cutscene(false);
  yield L.camBack(0.6);
  L.hud.toast('Зеркало героев на площади — смена героя в любой момент', 5);
  yield wait(0.1);
  L.hud.toast('Готовы к ночи? К часовой башне или в карту — начнётся Серия 2', 6);
  save.write();
}

/** Ноки's black umbrella (by day in the hub, docs/script-fangs.md §13.5), held over her right shoulder */
function umbrella(): THREE.Group {
  const g = new THREE.Group(); g.name = 'umbrella';
  const black = new THREE.MeshToonMaterial({ color: '#241a2a', side: THREE.DoubleSide });
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.36, 8, 1, true), black);
  canopy.position.y = 1.62; g.add(canopy);
  const rib = new THREE.MeshToonMaterial({ color: '#8a2a5a' });
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const tip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), rib); tip.position.set(Math.sin(a) * 0.8, 1.44, Math.cos(a) * 0.8); g.add(tip); }
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 6), new THREE.MeshToonMaterial({ color: '#3a2a3a' }));
  stick.position.y = 1.15; g.add(stick);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 6, 10, Math.PI), new THREE.MeshToonMaterial({ color: '#8a2a5a' }));
  hook.position.y = 0.52; hook.rotation.z = Math.PI; g.add(hook);
  g.position.set(0.3, 0.05, 0.08);
  g.rotation.set(0.1, 0, -0.16);
  return g;
}

/** a little scout bat for 4.3 */
function makeBat(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshToonMaterial({ color: '#3a2a46' });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), m); g.add(body);
  for (const s of [-1, 1]) {
    const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(0.45, 0.12); shape.lineTo(0.38, -0.05); shape.lineTo(0.26, 0.02); shape.lineTo(0.16, -0.08); shape.closePath();
    const w = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshToonMaterial({ color: '#4a3a5a', side: THREE.DoubleSide }));
    w.scale.x = s; w.name = s > 0 ? 'wr' : 'wl';
    g.add(w);
  }
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), new THREE.MeshBasicMaterial({ color: '#ff3a4a' })); e.position.set(s * 0.06, 0.04, 0.14); g.add(e); }
  return g;
}
function flap(bat: THREE.Group, t: number) {
  const a = Math.sin(t * 22) * 0.9;
  const wr = bat.getObjectByName('wr'), wl = bat.getObjectByName('wl');
  if (wr) wr.rotation.z = a; if (wl) wl.rotation.z = -a;
}

// ───────────────────────── registration ─────────────────────────

LEVEL_PLUGINS.push((L) => {
  const hub = L.refs.town;
  if (!(hub instanceof TownHub) || hub.L !== L) return null;
  return {
    update: (dt: number) => hub.update(dt),
    draw: (ctx: CanvasRenderingContext2D) => hub.draw(ctx),
    dispose: () => hub.dispose(),
    wantsInput: () => !!hub.overlay,
  };
});

export const HUB_SCRIPTS = {
  scripts: {
    hub_arrival: hubArrival,
    hub_lab_meet: labMeet,
    hub_lab_plan: labPlan,
  } as Record<string, (L: Level3D) => Script>,
  special: {} as Record<string, (L: Level3D) => void>,
};

export type { Figure, Folk };
export type { HeroExpr, HeroState };
