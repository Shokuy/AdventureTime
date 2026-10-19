import * as THREE from 'three';
import { W, H, clamp, damp, ease, rand } from '../../engine/util';
import { input } from '../../engine/input';
import { audio } from '../../engine/audio';
import { save } from '../../engine/save';
import { rrect, text, wrap, OUT } from '../../art/draw';
import type { Who } from '../../art/characters';
import { Dialog } from '../../ui/dialog';
import { Hud, ItemPopup } from '../../ui/hud';
import { SettingsPanel, ControlsHint, seenOnce, zoomTip, type SettingsTab } from '../../ui/settings';
import { bindText, glyphLabel } from '../../ui/glyphs';
import { MenuList } from '../../ui/widgets';
import { LevelResults } from '../../ui/results';
import { vignetteCanvas } from '../../art/props';
import { Coroutine, Script, Waiter, tween, wait } from '../../game/coroutine';
import { game, STORY } from '../../game/game';
import { PhysWorld } from '../physics/world';
import type { Built, Collider, BoxCol } from '../physics/types';
import { TPCamera, CamMode } from '../camera';
import { FX3 } from '../fx';
import { RT, toUI, cineZoom, viewUI } from '../runtime';
import { mat, mesh, noOutline, canvasTex } from '../gfx';
import { createArtifact } from '../models/artifacts';
import type { ArtifactKind } from '../models/artifacts';
import { setupSun, updateSun } from '../lighting';
import { Player3 } from './player';
import { Enemy3, makeEnemy3, EnemyKind, Soldier3 } from './enemies';
import type { EnemyOpts } from './enemies';
import { Shot3, Pickup3, PickKind, Noodle3, Checkpoint3, Faller3, Wave3, ShotKind } from './objects';
import { createBear, createDog, createKing, createGuard, KING_HAND_REST } from '../models';
import type { Rig } from '../models/rig';
import type { KingRig } from '../models';
import { LEVELS3, Level3Def } from './levels';
import { net } from '../../net/session';
import { coop, DIFF_NAME, DIFF_COLOR } from './coop';
import { NetLevel, GM, toV, netV3 } from './netLevel';
import type { Netted } from './netLevel';
import type { RemoteHero3 } from './remoteHero';
import { heroKindFor } from './heroes';
import { createHeroModel } from '../models/heroes';
import type { HeroAnim } from '../models/hero';
import { Breakable3 } from './breakables';
import type { BreakKind } from './breakables';
import { SCRIPTS3 } from './scripts';

type C = CanvasRenderingContext2D;

export interface Boss3Like {
  name: string; hp: number; maxHp: number;
  update(L: Level3D, dt: number): void;
  meleeHit(L: Level3D, c: THREE.Vector3, dir: THREE.Vector3, range: number, half: number, dmg: number, atkId: number, kind: string): boolean;
  shotHit(L: Level3D, s: Shot3): boolean;
  faceTarget(): THREE.Vector3;
  aimTargets(): THREE.Vector3[];
}

export interface Npc3 {
  /** the prologue's figures, and the story cast of «Хрумляндия» (the four heroes; their anim is a HeroAnim) */
  kind: 'bear' | 'dog' | 'kingBg' | 'feeder' | 'tosha' | 'bublik' | 'noki' | 'pastila';
  root: THREE.Group;
  rig: Rig<any>;
  anim: Record<string, any>;
  talk: number;
  t: number;
}

interface Bark { obj: THREE.Object3D; dy: number; text: string; t: number; dur: number }
interface Sign3 { pos: THREE.Vector3; text: string }
interface Trigger3 { min: THREE.Vector3; max: THREE.Vector3; script: string; fired: boolean }
interface Trap3 { min: THREE.Vector3; max: THREE.Vector3; drops: [number, number][]; dropY: number; cd: number }
export interface Wave3Def { kind: EnemyKind; x: number; y: number; z: number; o?: EnemyOpts }
/** something enemies can hear: footsteps, swings, a pea smacking a wall, a melon yelling "alarm!" */
export interface Noise3 { p: THREE.Vector3; r: number; t: number; alarm: boolean; target: THREE.Vector3 }
/** per-attempt counters for the level results (kept across respawns, like `seen`) */
export interface LevelStats { kills: number; enemies: number; crumbs: number; lost: number; deaths: number; hits: number; nuts: number; nutsTotal: number; time: number }
const STATS = new WeakMap<Set<string>, LevelStats>();
interface Arena3 {
  center: THREE.Vector3; radius: number; waves: Wave3Def[][]; reward: { kind: PickKind; x: number; y: number; z: number }[];
  state: 'idle' | 'active' | 'done'; wave: number; alive: Enemy3[]; bars: THREE.Group; cols: BoxCol[]; rise: number; key: string; enter: number;
  /** co-op failsafe: nobody alive got into the ring → the bars went back down and the fight goes on around it */
  open: boolean;
  /** co-op: host — seconds with no living hero inside; me — seconds my hero spent outside; host — state resend timer */
  emptyT: number; outT: number; syncT: number;
}
/** ability prizes of an ambush (a hero who doesn't have one yet must always be able to get it) */
const ABILITY_OF: Partial<Record<PickKind, 'doubleJump' | 'dash' | 'fork' | 'slingshot'>> = { doubleJump: 'doubleJump', dash: 'dash', fork: 'fork', sling: 'slingshot' };
/** co-op: a world cutscene step (one line, one camera move, one wait) never takes longer than this — it's stuck */
const CUT_STEP_MAX = 20;
/** co-op: a world cutscene that is still on after this long is force-ended for everyone (the longest scene ≈ 85 s) */
const CUT_MAX = 120;
/** height of each cinematic bar (UI units) */
const LETTERBOX = 70;
/** co-op: the host's word that a stuck world cutscene was force-ended (rides on GM.script; never a real script) */
const CUT_END = '__cutEnd';

/**
 * Feature modules hook into every level without editing this file: register a factory in LEVEL_PLUGINS
 * (e.g. co-op revives, chat bubbles, the scoreboard). Each level creates its own plugin instances.
 */
export interface LevelPlugin {
  /** fixed tick, after the world (rawDt = real time) */
  update?(dt: number): void;
  /** UI pass on the 2D canvas, after the HUD */
  draw?(ctx: CanvasRenderingContext2D): void;
  /** the level is being left */
  dispose?(): void;
  /** return true to swallow the pause key (e.g. a chat box is open) */
  wantsInput?(): boolean;
}
export const LEVEL_PLUGINS: ((L: Level3D) => LevelPlugin | null | void)[] = [];

/** what enemies and hazards need from a hero (the local Player3 or a friend's RemoteHero3) */
export interface HeroLike {
  readonly isLocal: boolean;
  pos: THREE.Vector3; vel: THREE.Vector3; yaw: number;
  body: { pos: THREE.Vector3; vel: THREE.Vector3; r: number; h: number; onGround: boolean };
  dead: boolean; downed: boolean; hidden: boolean; control: boolean; invuln: number; readonly dashing: boolean;
  atk: string | null; atkId: number;
  hp: number; maxHp: number;
  center(out?: THREE.Vector3): THREE.Vector3;
  forward(out?: THREE.Vector3): THREE.Vector3;
  hurt(L: Level3D, dmg: number, from: THREE.Vector3, knock?: THREE.Vector3, knockT?: number): boolean;
}

/** anything with its own per-frame logic that lives in a level (the feast King, a spaghetti monster…) */
export interface Actor3 { update(L: Level3D, dt: number): void; who?: string; talk?: number; dead?: boolean }
/** something besides enemies/boss that the hero's sword and peas can hit */
export interface Hittable3 {
  dead?: boolean;
  meleeHit(L: Level3D, c: THREE.Vector3, dir: THREE.Vector3, range: number, dmg: number, atkId: number, kind: string): boolean;
  shotHit(L: Level3D, s: Shot3): boolean;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

let raysTex: THREE.Texture | null = null;
/** soft golden sunburst for the "item get" halo */
function raysTexture() {
  if (raysTex) return raysTex;
  raysTex = canvasTex(256, 256, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, w / 2);
      gr.addColorStop(0, 'rgba(255,240,170,0.9)'); gr.addColorStop(1, 'rgba(255,200,80,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, w / 2, a, a + (i % 2 ? 0.12 : 0.2)); g.closePath(); g.fill();
    }
    const c = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.28);
    c.addColorStop(0, 'rgba(255,250,220,1)'); c.addColorStop(1, 'rgba(255,220,120,0)');
    g.fillStyle = c; g.fillRect(0, 0, w, h);
  });
  return raysTex;
}

/** an invisible vampire the player can't see right now: the slingshot doesn't lock onto it */
const unseen = (e: object) => { const v = (e as { invis?: { vis: number } | null }).invis; return !!v && v.vis < 0.3; };

export class Level3D {
  is3d = true;
  def: Level3Def;
  scene = new THREE.Scene();
  tcam = new TPCamera();
  phys = new PhysWorld();
  fx = new FX3();
  player = new Player3();
  enemies: Enemy3[] = [];
  shots: Shot3[] = [];
  pickups: Pickup3[] = [];
  noodles: Noodle3[] = [];
  checkpoints: Checkpoint3[] = [];
  fallers: Faller3[] = [];
  waves: Wave3[] = [];
  npcs: Record<string, Npc3> = {};
  npcList: Npc3[] = [];
  signs: Sign3[] = [];
  triggers: Trigger3[] = [];
  traps: Trap3[] = [];
  arenas: Arena3[] = [];
  updaters: ((t: number, dt: number) => void)[] = [];
  boss: Boss3Like | null = null;
  actors: Actor3[] = [];
  hittables: Hittable3[] = [];
  /** named things scripts need to find (e.g. refs.feastKing) */
  refs: Record<string, unknown> = {};
  chaser: { update(L: Level3D, dt: number): void } | null = null;
  exitZone: { min: THREE.Vector3; max: THREE.Vector3 } | null = null;
  killY = -30;

  noises: Noise3[] = [];
  stats: LevelStats;
  private enemySeq = 0; private pickSeq = 0;
  /** true while the level file builds the world (ids handed out now are identical on every client) */
  building = false;
  /** co-op glue (null in solo) */
  nl: NetLevel | null = null;
  /** my own pickups/hints (same set as `seen` in solo; personal in co-op where `seen` is the host's world state) */
  mySeen: Set<string>;
  /** story scripts running for everyone (they freeze the world like a cutscene) */
  private worldScripts = new Set<Coroutine>();
  /** co-op exit: how many heroes are at the door, and the countdown */
  exitWait: { n: number; of: number; t: number } | null = null;
  private exitT = 0;
  plugins: LevelPlugin[] = [];
  /** event feed (joins, revives, walnuts…) */
  feedLines: { text: string; color: string; t: number }[] = [];
  private pickKeys = new Map<Pickup3, string>();

  dialog = new Dialog();
  hud = new Hud();
  popup = new ItemPopup();
  scripts: Coroutine[] = [];
  barks: Bark[] = [];
  seen: Set<string>;

  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;

  t = 0; freeze = 0; paused = false;
  pauseMenu: MenuList | null = null;
  /** «Настройки» / «Управление» over the pause menu (F1 opens it straight from play and resumes on close) */
  settings: SettingsPanel | null = null;
  private settingsResume = false;
  /** first time in a level: the essentials card; how long the camera has been squeezed by a wall (zoom tip) */
  private ctlHint = new ControlsHint();
  private wallT = 0;
  letterbox = 0; letterboxTarget = 0;
  allowHurtInCutscene = false;
  checkpoint: THREE.Vector3 | null = null; checkpointYaw = 0;
  deathMenu: MenuList | null = null; deathT = 0;
  flashT = 0; whiteFlash = 0;
  vignette = vignetteCanvas(W, H, 0.45);
  slowT = 0;
  complete = false;
  bannerShown = false;
  camModeDefault: CamMode = 'follow';
  levelIndex: number;
  overlayDraw: ((ctx: C) => void)[] = [];

  constructor(id: string, index: number, fromCheckpoint?: { pos: THREE.Vector3; yaw: number }, seen?: Set<string>) {
    this.def = LEVELS3[id]();
    this.levelIndex = index;
    // «Хрумляндия»: the hero I play here (the prologue: Tosha; elsewhere my pick unless the level forces one)
    this.player.setKind(heroKindFor(this.def));
    this.seen = seen ?? new Set();
    const mp = coop.active;
    this.mySeen = mp ? coop.mySeen(id) : this.seen;
    if (mp) this.nl = new NetLevel(this);
    let st = STATS.get(this.mySeen);
    if (!st) { st = { kills: 0, enemies: 0, crumbs: 0, lost: 0, deaths: 0, hits: 0, nuts: 0, nutsTotal: 0, time: 0 }; STATS.set(this.mySeen, st); }
    this.stats = st;
    const firstBuild = !this.mySeen.has('built');
    this.mySeen.add('built');
    if (mp) { this.dialog.noInput = true; }
    this.dialog.onSpeak = (who) => this.speakAnim(who);
    const d = this.def;
    this.killY = d.killY;
    // lighting & atmosphere
    this.scene.background = new THREE.Color(d.bg);
    this.scene.fog = new THREE.Fog(d.fog[0], d.fog[1], d.fog[2]);
    this.hemi = new THREE.HemisphereLight(d.hemi[0], d.hemi[1], d.hemi[2]);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(d.sun.color, d.sun.intensity);
    setupSun(this.sun);
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.fx.group);
    this.scene.add(this.player.root, this.player.blob);
    this.tcam.setAspect(RT.winW / RT.winH);
    // build world
    this.building = true;
    d.build(this);
    this.building = false;
    if (firstBuild) {
      for (const a of this.arenas) for (const w of a.waves) st.enemies += w.length;
    }
    if (firstBuild) st.enemies += this.enemies.length;
    // spawn (co-op: friends stand in a little ring so nobody stacks)
    const sp = (fromCheckpoint?.pos ?? new THREE.Vector3(...d.spawn)).clone();
    const yaw = fromCheckpoint?.yaw ?? d.yaw;
    if (mp) {
      const ids = [...net.members.keys()].sort();
      const slot = Math.max(0, ids.indexOf(net.myId));
      if (slot > 0) {
        const a = (slot / 6) * Math.PI * 2;
        const off = new THREE.Vector3(Math.cos(a) * 1.4, 0.2, Math.sin(a) * 1.4);
        if (!this.phys.pointInSolid(sp.clone().add(off).setY(sp.y + 0.5))) sp.add(off);
      }
    }
    this.player.reset(sp, yaw);
    if (fromCheckpoint) {
      this.checkpoint = fromCheckpoint.pos.clone(); this.checkpointYaw = fromCheckpoint.yaw;
      for (const c of this.checkpoints) if (c.pos.distanceTo(fromCheckpoint.pos) < 2) { c.lit = true; c.flame.visible = true; }
    }
    this.camModeDefault = d.camMode ?? 'follow';
    this.tcam.yaw = yaw + Math.PI;
    SCRIPTS3.special[d.id]?.(this);
    this.tcam.mode = this.camModeDefault;
    this.tcam.snap(this.player.pos);
    audio.playMusic(d.music);
    for (const f of LEVEL_PLUGINS) { const pl = f(this); if (pl) this.plugins.push(pl); }
    this.fromCheckpoint = !!fromCheckpoint;
    if (this.nl) { if (!this.nl.isHost) net.send('host', GM.loaded, {}); }
    else this.begin();
  }

  private fromCheckpoint = false;
  /** the level starts for real (solo: right away; co-op: when every friend has loaded) */
  begin() {
    const d = this.def;
    if (!this.fromCheckpoint && d.startScript && !this.seen.has(d.startScript)) { if (this.authority) this.run(d.startScript); }
    else if (!this.fromCheckpoint && !this.bannerShown) { this.hud.showChapter(d.title, d.subtitle); this.bannerShown = true; }
  }

  // ───────────────── heroes (co-op aware) ─────────────────
  /** in a co-op game */
  get mp() { return !!this.nl; }
  /** this machine runs the world (solo, or the co-op host) */
  get authority() { return !this.nl || this.nl.isHost; }
  /** every hero in the level: mine first, then friends */
  heroes(): HeroLike[] {
    if (!this.nl) return [this.player];
    return [this.player, ...this.nl.remotes.values()];
  }
  /** heroes enemies can go after */
  alivePlayers(): HeroLike[] { return this.heroes().filter((h) => !h.dead && !h.downed && !h.hidden && !(h as { stale?: boolean }).stale); }
  /** nearest hero an enemy should care about (solo: always the player) */
  targetFor(pos: THREE.Vector3, maxDist = Infinity): HeroLike {
    if (!this.nl) return this.player;
    let best: HeroLike | null = null, bd = maxDist;
    for (const h of this.alivePlayers()) {
      const d = h.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = h; }
    }
    return best ?? this.player;
  }
  remote(id: string): RemoteHero3 | undefined { return this.nl?.remotes.get(id); }
  /** a line in the event feed (top right) */
  feed(text: string, color = '#fff3d8') {
    this.feedLines.push({ text, color, t: 0 });
    if (this.feedLines.length > 5) this.feedLines.shift();
  }

  // ───────────────── building API (used by level files) ─────────────────
  add(b: Built) {
    this.scene.add(b.obj);
    this.phys.add(b.colliders);
    this.phys.addHazards(b.hazards);
    if (b.update) this.updaters.push(b.update);
    return b;
  }
  deco(o: THREE.Object3D) { this.scene.add(o); return o; }
  col(c: Collider | Collider[]) { this.phys.add(c); }
  enemy(kind: EnemyKind, x: number, y: number, z: number, o: Wave3Def['o'] = {}, key?: string) {
    const e = makeEnemy3(kind, new THREE.Vector3(x, y, z), o);
    // placed enemies get a session key: killed once → no loot after a respawn (no crumb farming)
    if (key || this.building) {
      e.key = key ?? 'e' + this.enemySeq++;
      if (this.seen.has(e.key)) e.loot = 0;
    }
    if (this.building) this.nl?.add(e as unknown as Netted);
    // co-op: tougher melons for a bigger party (host decides HP; clients scale the same way until its snapshots
    // arrive — far enemies aren't in them, so their copies would otherwise keep solo HP)
    if (this.nl) { e.maxHp = Math.round(e.maxHp * coop.hpScale()); e.hp = e.maxHp; }
    this.enemies.push(e);
    this.scene.add(e.root, e.blob);
    return e;
  }
  /** an enemy that appears during play (ambush waves, summons, splits): the host tells everyone */
  spawnEnemy(kind: EnemyKind, x: number, y: number, z: number, o: Wave3Def['o'] = {}, key?: string) {
    const e = this.enemy(kind, x, y, z, o, key);
    this.nl?.spawned(e as unknown as Netted, 'enemy', { kind, x, y, z, o, key });
    return e;
  }
  /** golden walnuts placed in this level (save ids) */
  nutIds: string[] = [];
  nutsFound() { return this.nutIds.filter((n) => save.has(n)).length; }
  pick(kind: PickKind, x: number, y: number, z: number, id?: string) {
    if (kind === 'nut' && id && !this.nutIds.includes(id)) this.nutIds.push(id);
    if (id && save.has(id)) return null;
    let key: string | null = null;
    if (!id && this.building) { key = 'p' + this.pickSeq++; if (this.mySeen.has(key)) return null; }
    const p = new Pickup3(kind, new THREE.Vector3(x, y, z), id);
    if (key) this.pickKeys.set(p, key);
    this.pickups.push(p);
    this.scene.add(p.obj);
    if (p.blob) this.scene.add(p.blob);
    return p;
  }
  /** co-op: ability prizes that fly to my hero if I don't come for them (I was dead, downed, far away) */
  private homing = new Set<Pickup3>();
  /** an ambush prize for me (never through pick(): build-time pickup keys must stay the same on every build) */
  private prize(kind: PickKind, x: number, y: number, z: number) {
    const p = new Pickup3(kind, new THREE.Vector3(x, y, z));
    this.pickups.push(p);
    this.scene.add(p.obj);
    if (p.blob) this.scene.add(p.blob);
    const ab = ABILITY_OF[kind];
    if (this.nl && ab && !save.data.abilities[ab]) this.homing.add(p);
    return p;
  }
  /** co-op: an ability prize I haven't taken after a few seconds comes to me (wherever I am, once I can take it) */
  private updateHoming(dt: number) {
    if (!this.homing.size) return;
    const p = this.player;
    const free = !p.dead && !p.downed && !p.hidden && !p.grabbedBy && p.control && !this.worldCut && !this.complete && !this.itemGetting;
    for (const k of this.homing) {
      if (k.dead) { this.homing.delete(k); continue; }
      if (!free || k.age < 5) continue;
      const c = p.center();
      const d = c.distanceTo(k.pos);
      if (d < 0.05) continue;
      const v = Math.min(d, (6 + Math.min(k.age - 5, 3) * 6) * dt);
      k.pos.addScaledVector(c.sub(k.pos).normalize(), v);
      if (Math.random() < 0.4) this.fx.glow.emit(k.pos.clone(), { count: 1, speed: [0.1, 0.4], life: [0.3, 0.6], size: [0.06, 0.12], colors: ['#fff6c0', '#ffe14a'], g: -0.4 });
    }
  }
  /** a small crate / jam jar that spills crumbs when smashed (once per attempt) */
  private breakSeq = 0;
  breakable(kind: BreakKind, x: number, y: number, z: number, loot = 3) {
    const key = 'b' + this.breakSeq++;
    if (this.seen.has(key)) return null;
    const b = new Breakable3(this, kind, new THREE.Vector3(x, y, z), loot, key);
    this.actors.push(b); this.hittables.push(b);
    return b;
  }
  /** an enemy left the fight (for results + anti-farming) */
  countKill(e: Enemy3) {
    if (!e.key || this.seen.has(e.key)) return;
    this.seen.add(e.key);
    this.stats.kills++;
  }
  /** something enemies may hear; `target` is where they'll go look (defaults to the source) */
  noise(p: THREE.Vector3, r: number, o: { alarm?: boolean; target?: THREE.Vector3 } = {}) {
    this.noises.push({ p: p.clone(), r, t: 0, alarm: !!o.alarm, target: (o.target ?? p).clone() });
  }
  /** a one-time tip (remembered in the save) */
  hint(key: string, str: string) {
    const id = 'hint:' + key;
    if (save.has(id)) return;
    save.collect(id);
    this.hud.toast(str, 6);
  }
  crumbLine(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, n: number) {
    for (let i = 0; i < n; i++) { const k = n === 1 ? 0.5 : i / (n - 1); this.pick('crumb', x1 + (x2 - x1) * k, y1 + (y2 - y1) * k + 0.35, z1 + (z2 - z1) * k); }
  }
  crumbRing(x: number, y: number, z: number, r: number, n: number) {
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; this.pick('crumb', x + Math.cos(a) * r, y + 0.35, z + Math.sin(a) * r); }
  }
  cp(x: number, y: number, z: number) { const c = new Checkpoint3(new THREE.Vector3(x, y, z)); this.checkpoints.push(c); this.scene.add(c.obj); return c; }
  signAt(x: number, y: number, z: number, textStr: string) { this.signs.push({ pos: new THREE.Vector3(x, y, z), text: textStr }); }
  noodle(x: number, y: number, z: number, len: number, o: ConstructorParameters<typeof Noodle3>[2] = {}) { const n = new Noodle3(new THREE.Vector3(x, y, z), len, o); this.noodles.push(n); this.scene.add(n.obj); return n; }
  trigger(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, script: string) {
    this.triggers.push({ min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1), script, fired: this.seen.has(script) });
  }
  trap(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, drops: [number, number][], dropY: number) {
    this.traps.push({ min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1), drops, dropY, cd: 0 });
  }
  exit(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) { this.exitZone = { min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1) }; }
  arena(cx: number, cy: number, cz: number, radius: number, waves: Wave3Def[][], reward: { kind: PickKind; x: number; y: number; z: number }[] = [], enter = 2) {
    const key = `arena${Math.round(cx)}_${Math.round(cz)}`;
    const bars = new THREE.Group();
    const cols: BoxCol[] = [];
    const n = 28;
    const barGeo = new THREE.CylinderGeometry(0.16, 0.16, 4, 8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * radius, z = cz + Math.sin(a) * radius;
      const b = mesh(barGeo, mat('#cdd6e2'));
      b.position.set(x, cy - 2.2, z);
      bars.add(b);
      const tip = mesh(new THREE.ConeGeometry(0.22, 0.5, 8), mat('#e8eef5'));
      tip.position.set(0, 2.2, 0); b.add(tip);
      cols.push({ kind: 'box', min: new THREE.Vector3(x - 0.7, cy, z - 0.7), max: new THREE.Vector3(x + 0.7, cy + 7, z + 0.7), active: false, tag: 'gate' });
      // (7 m, not the bars' 4: the ring of tops must not be a ledge a trampoline / pad can land a hero on)
    }
    bars.visible = false;
    this.scene.add(bars);
    this.phys.add(cols);
    const done = this.seen.has(key);
    this.arenas.push({ center: new THREE.Vector3(cx, cy, cz), radius, waves, reward, state: done ? 'done' : 'idle', wave: 0, alive: [], bars, cols, rise: 0, key, enter, open: false, emptyT: 0, outT: 0, syncT: 0 });
    // already won (a respawn / team restart / late arrival): an ability prize I never picked up is still there for me
    if (done) for (const r of reward) { const ab = ABILITY_OF[r.kind]; if (ab && !save.data.abilities[ab]) this.prize(r.kind, r.x, r.y, r.z); }
  }
  npc(kind: Npc3['kind'], x: number, y: number, z: number, yaw = 0, scale = 1) {
    let rig: Rig<any>;
    let anim: Record<string, any>;
    if (kind === 'bear') { rig = createBear(); anim = { state: 'sit', talk: 0, wave: 0, speed: 0 }; }
    else if (kind === 'dog') { rig = createDog(); anim = { state: 'idle', speed: 0, talk: 0, stretch: 1, expr: 'happy' }; }
    else if (kind === 'feeder') { rig = createGuard('feeder'); anim = { state: 'carry', speed: 0.5, flash: 0 }; }
    else if (kind === 'tosha' || kind === 'bublik' || kind === 'noki' || kind === 'pastila') {
      // the story cast: canonical looks; scripts drive n.anim (a HeroAnim: state / expr / attack / fx), talk is automatic
      rig = createHeroModel(kind);
      anim = { state: 'idle', speed: 0, attack: null, weapon: 'sword', flash: 0, talk: 0, expr: 'normal', squash: 1 } satisfies HeroAnim;
    }
    else {
      const k: KingRig = createKing();
      rig = k;
      anim = {
        eye: 0.35, mouth: 0, anger: 0, look: { x: 0, y: 0 }, dizzy: 0, chew: 1, slump: 0, stand: 0, flash: 0, talk: 0,
        hands: [
          { pos: KING_HAND_REST[0].clone(), pose: 'rest', glow: 0, flash: 0 },
          { pos: KING_HAND_REST[1].clone(), pose: 'rest', glow: 0, flash: 0 },
        ],
      };
    }
    const root = new THREE.Group();
    root.add(rig.root);
    root.position.set(x, y, z);
    root.rotation.y = yaw;
    root.scale.setScalar(scale);
    this.scene.add(root);
    const n: Npc3 = { kind, root, rig, anim, talk: 0, t: rand(0, 5) };
    this.npcs[kind] = n; this.npcList.push(n);
    return n;
  }

  // ───────────────── gameplay services ─────────────────
  onLand(c: Collider) {
    if (c.bounce && c.obj) c.obj.userData.wob = 1;
    if (c.kind === 'box' && c.crumbly && c.obj && !c.obj.userData.crumbling) {
      c.obj.userData.crumbling = true; c.obj.userData.crumbleT = 0;
      audio.sfx('crumble', { volume: 0.5 });
    }
  }

  private updateColliderFx(dt: number) {
    for (const c of this.phys.cols) {
      const o = c.obj;
      if (!o) continue;
      const ud = o.userData;
      if (c.bounce) {
        ud.wob = Math.max(0, (ud.wob ?? 0) - dt * 2.2);
        const s = Math.sin(this.t * 24) * (ud.wob ?? 0);
        o.scale.set(1 + s * 0.12, 1 - s * 0.16, 1 + s * 0.12);
      }
      if (c.kind === 'box' && c.crumbly) {
        if (ud.crumbling) {
          ud.crumbleT += dt;
          o.position.x = (ud.baseX ??= o.position.x) + Math.sin(this.t * 60) * 0.05 * ud.crumbleT;
          if (Math.random() < 0.3) this.fx.chunks(tmp.set((c.min.x + c.max.x) / 2 + rand(-1, 1), c.min.y, (c.min.z + c.max.z) / 2 + rand(-1, 1)).clone(), 1, ['#d89a52', '#4a2a18'], c.min.y - 20, [0.06, 0.12]);
          if (ud.crumbleT > 0.6) {
            ud.crumbling = false; c.active = false; o.visible = false; ud.goneT = 3.2;
            audio.sfx('break', { volume: 0.6 });
            this.fx.chunks(tmp.set((c.min.x + c.max.x) / 2, c.max.y, (c.min.z + c.max.z) / 2).clone(), 22, ['#d89a52', '#4a2a18', '#eab26a'], c.min.y - 30, [0.1, 0.25]);
          }
        } else if (c.active === false && ud.goneT !== undefined) {
          ud.goneT -= dt;
          const pb = this.player.body;
          const inside = pb.pos.x > c.min.x - 0.4 && pb.pos.x < c.max.x + 0.4 && pb.pos.z > c.min.z - 0.4 && pb.pos.z < c.max.z + 0.4 && pb.pos.y < c.max.y + 1 && pb.pos.y + pb.h > c.min.y;
          if (ud.goneT <= 0 && !inside) {
            c.active = true; o.visible = true; ud.goneT = undefined;
            o.position.x = ud.baseX ?? o.position.x;
            this.fx.dust(tmp.set((c.min.x + c.max.x) / 2, c.max.y, (c.min.z + c.max.z) / 2).clone(), 8, '#fff3d8');
          }
        }
      }
    }
  }

  /** the hero currently swinging (host resolving a friend's swing) — enemies read it for sneak attacks / credit */
  attacker: string | null = null;
  meleeHit(c: THREE.Vector3, dir: THREE.Vector3, range: number, half: number, dmg: number, atkId: number, kind: string): boolean {
    if (this.nl && !this.nl.isHost) return this.predictMelee(c, dir, range, half, dmg, atkId, kind);
    return this.resolveMelee(c, dir, range, half, dmg, atkId, kind);
  }

  /** client: tell the host about my swing; guess locally whether it connects (for the pogo bounce and hit-stop) */
  /** swings whose hit was already felt here: the swing calls this every frame of its window, and a hit-stop on each
   *  one would freeze my hero (dt = 0 → the swing never ends) for as long as the target stays in reach */
  private feltAtk = new Set<number>();
  private predictMelee(c: THREE.Vector3, dir: THREE.Vector3, range: number, half: number, dmg: number, atkId: number, kind: string): boolean {
    net.send('host', GM.melee, { c: netV3(c), d: [Math.round(dir.x * 1000) / 1000, Math.round(dir.z * 1000) / 1000], r: range, h: half, dmg, atk: atkId, kind }, true);
    const cosHalf = Math.cos(half);
    let hit = false;
    for (const e of this.enemies) {
      if (e.dead || e.spawnT > 0) continue;
      tmp.copy(e.center()).sub(c);
      const dy = tmp.y; tmp.y = 0;
      const d = tmp.length();
      if (d > range + e.body.r || Math.abs(dy) > 1.4 + e.body.h * 0.4) continue;
      if (half < Math.PI && d > 0.3 && tmp.normalize().dot(dir) < cosHalf) continue;
      hit = true;
    }
    if (this.boss) for (const t of this.boss.aimTargets()) if (t.distanceTo(c) < range + 1.5) hit = true;
    // (PvP judges my swing against the rival puppets on my screen: it needs the whole swing)
    for (const h of this.hittables) if ((h as Hittable3 & { predictHit?(L: Level3D, c: THREE.Vector3, range: number, dir: THREE.Vector3, half: number, atkId: number, kind: string): boolean }).predictHit?.(this, c, range, dir, half, atkId, kind)) hit = true;
    if (hit && !this.feltAtk.has(atkId)) {
      this.feltAtk.add(atkId);
      if (this.feltAtk.size > 64) this.feltAtk.delete(this.feltAtk.values().next().value as number);
      this.hitstop(0.05); this.tcam.shake(0.12); audio.sfx('hit', { pitch: rand(0.9, 1.15), volume: 0.7 });
    }
    return hit;
  }

  /** host: a friend's swing (its own atk ids, resolved against the authoritative world) */
  remoteMelee(from: string, d: { c: number[]; d: number[]; r: number; h: number; dmg: number; atk: number; kind: string }) {
    const c = toV(d.c), dir = new THREE.Vector3(d.d[0], 0, d.d[1]);
    this.attacker = from;
    try { this.nl!.capture(() => this.resolveMelee(c, dir, d.r, d.h, d.dmg, d.atk, d.kind, false)); } finally { this.attacker = null; }
  }

  private resolveMelee(c: THREE.Vector3, dir: THREE.Vector3, range: number, half: number, dmg: number, atkId: number, kind: string, local = true): boolean {
    let hit = false;
    const cosHalf = Math.cos(half);
    for (const e of this.enemies) {
      if (e.dead || e.spawnT > 0 || e.lastHit === atkId) continue;
      const ec = e.center();
      tmp.copy(ec).sub(c);
      const dy = tmp.y; tmp.y = 0;
      const d = tmp.length();
      if (d > range + e.body.r || Math.abs(dy) > 1.4 + e.body.h * 0.4) continue;
      if (half < Math.PI && d > 0.3 && tmp.normalize().dot(dir) < cosHalf) continue;
      e.lastHit = atkId;
      e.hurt(this, dmg, c, kind);
      hit = true;
    }
    for (const s of this.shots) {
      if (s.dead || s.owner === 'player') continue;
      tmp.copy(s.pos).sub(c);
      if (tmp.length() > range + s.r) continue;
      if (half < Math.PI && tmp.clone().setY(0).normalize().dot(dir) < cosHalf - 0.3) continue;
      if (s.reflectable && this.boss) { s.reflect(this, this.boss.faceTarget()); hit = true; this.nl?.entEvent(s as unknown as Netted, 'reflect', { at: s.pos }); }
      else { s.pop(this); this.fx.sparks(s.pos.clone(), 6); hit = true; this.nl?.entEvent(s as unknown as Netted, 'pop'); }
    }
    tmp2.copy(c).addScaledVector(dir, range * 0.6);
    for (const n of this.noodles) if (n.hitTest(tmp2, range * 0.6) || n.hitTest(c, range * 0.5)) { n.cut(this); hit = true; }
    if (this.boss && this.boss.meleeHit(this, c, dir, range, half, dmg, atkId, kind)) hit = true;
    for (const h of this.hittables) if (h.meleeHit(this, c, dir, range, dmg, atkId, kind)) hit = true;
    if (hit && local) { this.hitstop(0.05); this.tcam.shake(0.12); }
    return hit;
  }

  /** closest enemy (or boss weak spot) center within a cone in front */
  nearestTarget(from: THREE.Vector3, dir: THREE.Vector3, maxDist: number, half: number): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null, bd = maxDist;
    const cosH = Math.cos(half);
    const consider = (p: THREE.Vector3) => {
      tmp.copy(p).sub(from);
      const d = tmp.length();
      if (d > bd || d < 0.01) return;
      tmp.y *= 0.3;
      if (tmp.normalize().dot(dir) < cosH) return;
      bd = d; best = p.clone();
    };
    for (const e of this.enemies) if (!e.dead && e.spawnT <= 0 && !unseen(e)) consider(e.center());
    if (this.boss) for (const p of this.boss.aimTargets()) consider(p);
    for (const t of this.extraTargets) consider(t());
    return best;
  }

  /** every point the slingshot can lock onto */
  aimTargetList(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const e of this.enemies) if (!e.dead && e.spawnT <= 0 && !unseen(e)) out.push(e.center());
    if (this.boss) out.push(...this.boss.aimTargets());
    for (const t of this.extraTargets) out.push(t());
    return out;
  }
  /** extra lockable points provided by level gimmicks (e.g. a monster's weak spot) */
  extraTargets: (() => THREE.Vector3)[] = [];

  spawnPea(from: THREE.Vector3, vel: THREE.Vector3) {
    // peas are weaker than the sword; the walnut slingshot makes them hit harder and pierce
    const dmg = Math.max(1, Math.ceil(save.data.dmg / 2)) + (save.data.upgrades.nutSling ? 1 : 0);
    const pierce = save.data.upgrades.nutSling ? 1 : 0;
    if (this.nl && !this.nl.isHost) {
      // the host flies the real pea; mine is just for looks
      net.send('host', GM.pea, { f: netV3(from), v: netV3(vel), dmg, pierce });
      // friends get my look-alike straight from me (one hop, launch time to catch up) — the host has the real one
      net.send('all', GM.vpea, { f: netV3(from), v: netV3(vel), t: net.time(), by: net.myId, c: 1 }, false);
      this.visualPea(from, vel).shooter = net.myId; // (mine: PvP checks it against the rivals I see)
      return;
    }
    const s = new Shot3('pea', from.clone(), vel, 6, 'player');
    s.dmg = dmg; s.pierce = pierce;
    this.shots.push(s); this.scene.add(s.obj);
    if (this.nl) net.send('all', GM.vpea, { f: netV3(from), v: netV3(vel), t: net.time() }, false);
  }
  /** host: a friend's pea */
  remotePea(from: string, d: { f: number[]; v: number[]; dmg: number; pierce: number }) {
    const s = new Shot3('pea', toV(d.f), toV(d.v), 6, 'player');
    s.dmg = Math.min(4, d.dmg); s.pierce = Math.min(1, d.pierce);
    s.shooter = from;
    this.shots.push(s); this.scene.add(s.obj);
    // (the shooter sent everyone else its look-alike himself)
  }
  /** a pea that only looks like one (someone else's, or mine on a client) */
  visualPea(from: THREE.Vector3, vel: THREE.Vector3, t?: number) {
    const s = new Shot3('pea', from.clone(), vel.clone(), 6, 'player');
    s.visual = true;
    // someone else's: it left his slingshot a moment ago — start it where it is by now
    const age = typeof t === 'number' && Number.isFinite(t) ? Math.min(0.35, Math.max(0, net.time() - t)) : 0;
    if (age > 0) {
      s.pos.addScaledVector(s.vel, age).y -= 0.5 * s.g * age * age;
      s.vel.y -= s.g * age;
      s.life -= age;
    }
    this.shots.push(s); this.scene.add(s.obj);
    return s;
  }
  /** host: an enemy projectile — every machine flies a copy, each copy only hurts its own hero */
  spawnEnemyShot(kind: ShotKind, from: THREE.Vector3, vel: THREE.Vector3, g: number, fromNet = false, ignoreTag: string | null = null) {
    const s = new Shot3(kind, from.clone(), vel, g, 'enemy');
    s.ignoreTag = ignoreTag;
    this.shots.push(s); this.scene.add(s.obj);
    if (this.nl?.isHost && !fromNet) this.nl.spawned(s as unknown as Netted, 'shot', { k: kind, f: from, v: vel, g, it: ignoreTag });
    return s;
  }
  /** something falls from above (share=false for things only over my head, like book traps) */
  addFaller(f: Faller3, share = true) {
    this.fallers.push(f); this.scene.add(f.obj, f.marker);
    if (share && this.nl?.isHost) this.nl.spawned(f as unknown as Netted, 'faller', { x: f.pos.x, y: f.pos.y, z: f.pos.z, gy: f.groundY, k: f.kind, w: f.warn });
  }
  addWave(w: Wave3, share = true) {
    this.waves.push(w); this.scene.add(w.obj);
    if (share && this.nl?.isHost) this.nl.spawned(w as unknown as Netted, 'wave', { c: w.center, s: w.speed, m: w.maxR, r0: w.r0 });
  }

  dropPickup(kind: PickKind, at: THREE.Vector3, fromNet = false) {
    // hardcore: half the hearts (the host rolls it once for everyone; a local drop rolls on its own)
    if (kind === 'heart' && !fromNet && coop.hard && Math.random() < 0.5) return;
    // co-op loot is per player: the host's drop happens on every machine, each hero picks up their own
    if (this.nl && this.nl.isHost && !fromNet) net.send('all', GM.drop, { k: kind, at: netV3(at) });
    const p = new Pickup3(kind, at.clone(), undefined, true);
    const a = rand(0, Math.PI * 2);
    p.vel.set(Math.cos(a) * rand(1, 3), rand(6, 9), Math.sin(a) * rand(1, 3));
    this.pickups.push(p); this.scene.add(p.obj);
    if (p.blob) this.scene.add(p.blob);
  }

  collect(p: Pickup3) {
    const pl = this.player;
    const at = p.pos.clone();
    const key = this.pickKeys.get(p);
    if (key) this.mySeen.add(key);
    if (p.kind === 'crumb') this.stats.crumbs += 1;
    else if (p.kind === 'bigcrumb') this.stats.crumbs += 5;
    switch (p.kind) {
      case 'nut': {
        save.data.nuts += 1;
        if (p.id) save.collect(p.id);
        audio.sfx('nut'); this.tcam.shake(0.15);
        this.fx.stars(at, 30, ['#ffe14a', '#fff6c0', '#ffffff']);
        this.fx.ring(at.clone(), 2.2, '#ffe14a', 0.4, false);
        this.hud.showBanner(`ЗОЛОТОЙ ОРЕШЕК! ${this.nutsFound()}/${this.nutIds.length}`, '#ffd34a');
        this.hint('nut', 'Золотые орешки — редкость! Медведь Вторник обменяет их на особые штуки');
        break;
      }
      case 'crumb': save.data.crumbs += 1; audio.sfx('coin'); this.fx.glow.emit(at, { count: 5, speed: [0.5, 2], life: [0.2, 0.4], size: [0.05, 0.09], colors: ['#ffe0a0', '#ffffff'] }); break;
      case 'bigcrumb': save.data.crumbs += 5; audio.sfx('coin', { pitch: 0.8 }); this.fx.text(at, '+5', '#ffe0a0', 20); this.fx.stars(at, 10); break;
      case 'heart': pl.hp = Math.min(pl.maxHp, pl.hp + 1); audio.sfx('heal'); this.fx.text(at, '+1 ♥', '#ff8aa0', 20); break;
      case 'peas': pl.ammo = Math.min(save.data.ammoMax, pl.ammo + 5); audio.sfx('coin', { pitch: 1.4 }); this.fx.text(at, '+5 горох', '#c8f0a0', 18); break;
      case 'honey': save.data.potions = Math.min(3, save.data.potions + 1); audio.sfx('heal'); this.fx.text(at, '+мёд', '#ffd060', 20); break;
      case 'container': save.data.maxHp += 1; pl.maxHp = save.data.maxHp; pl.hp = pl.maxHp; this.itemGet(p); break;
      case 'doubleJump': save.data.abilities.doubleJump = true; this.itemGet(p); break;
      case 'dash': save.data.abilities.dash = true; this.itemGet(p); break;
      case 'fork': save.data.abilities.fork = true; pl.weapon = 'fork'; this.itemGet(p); break;
      case 'sling': save.data.abilities.slingshot = true; pl.ammo = save.data.ammoMax; this.itemGet(p); break;
    }
    if (p.id) save.collect(p.id);
    // keep lights in the scene (intensity 0) so the light count never changes → no shader recompiles
    if (p.light && p.obj.parent) { p.light.getWorldPosition(tmp); p.obj.remove(p.light); p.light.position.copy(tmp); p.light.intensity = 0; this.scene.add(p.light); p.light = null; }
    this.scene.remove(p.obj); if (p.blob) this.scene.remove(p.blob);
  }

  itemGet(p: Pickup3) {
    audio.sfx('artifact');
    this.tcam.shake(0.2);
    save.write();
    this.itemGetting = true;
    this.runGen(this.itemGetScene(p.kind));
  }

  /** "item get!": the hero lifts the new artifact over his head in a halo of light, then the card */
  itemGetting = false;
  private itemAnim: ((dt: number) => void) | null = null;
  private *itemGetScene(kind: PickKind): Script {
    const pl = this.player;
    const wasCut = this.letterboxTarget > 0.5;
    if (!wasCut) this.cutscene(true);
    let landT = 0;
    yield { update: (dt: number) => { landT += dt; return pl.body.onGround || landT > 0.8; } };
    pl.forceState = 'cheer'; pl.expr = 'happy';
    const art = createArtifact(kind as ArtifactKind);
    art.root.scale.setScalar(0.95);
    const rays = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ map: raysTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    noOutline(rays);
    this.scene.add(art.root, rays);
    const head = pl.pos.clone().setY(pl.pos.y + 1.7);
    const fwd = pl.forward();
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const want = pl.pos.clone().addScaledVector(fwd, 4.0).addScaledVector(side, 1.0).setY(pl.pos.y + 1.35);
    const dir = want.clone().sub(head);
    const dl = dir.length(); dir.normalize();
    const hit = this.phys.raycast(head, dir, dl);
    const camPos = head.clone().addScaledVector(dir, Math.max(1.6, Math.min(dl, hit - 0.3)));
    let t = 0;
    this.itemAnim = (dt: number) => {
      t += dt;
      art.update(dt);
      art.root.position.copy(head).setY(head.y + Math.sin(t * 2.4) * 0.08);
      art.root.rotation.y += dt * 0.9;
      rays.position.copy(head);
      rays.lookAt(this.tcam.cam.position);
      rays.rotateZ(t * 0.5);
      (rays.material as THREE.MeshBasicMaterial).opacity = Math.min(0.85, t * 2);
      if (Math.random() < 0.3) this.fx.glow.emit(head.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.4, 0.6), rand(-0.6, 0.6))), { count: 1, speed: [0.2, 0.8], life: [0.5, 1], size: [0.06, 0.12], colors: ['#fff6c0', '#ffe14a'], g: -0.6 });
    };
    // look a little below the middle so hero + item sit above the card at the bottom of the screen
    yield this.shot(camPos, head.clone().setY(pl.pos.y + 0.6), 0.35);
    this.fx.stars(head, 40);
    this.fx.ring(head.clone(), 2.5, '#ffe14a', 0.5, false);
    let w = 0;
    yield { update: (dt: number) => { w += dt; this.itemAnim?.(dt); return w > 0.7; } };
    this.popup.compact = true;
    this.popup.show(kind as Exclude<PickKind, "nut">);
    yield { update: (dt: number) => { this.itemAnim?.(dt); return !this.popup.active; } };
    this.itemAnim = null;
    this.scene.remove(art.root, rays);
    pl.forceState = null; pl.expr = undefined;
    // co-op: a story scene that began while my card was up (a friend walked into a trigger) owns the camera, the
    // letterbox and the dialog box now — closing them here cut its line and once left the whole world frozen
    if (!wasCut && !this.storyOn()) { yield this.camBack(0.5); if (!this.storyOn()) this.cutscene(false); }
    this.itemGetting = false;
  }

  /** the King yelling from off-screen (chase): a line at the top of the screen */
  shoutText = ''; shoutT = 0; shoutDur = 0;
  shout(str: string, dur = 1.8) { this.shoutText = str; this.shoutT = 0; this.shoutDur = dur; }
  addEnemy(e: Enemy3) {
    if (this.building && !e.key) { e.key = 'e' + this.enemySeq++; if (this.seen.has(e.key)) e.loot = 0; }
    if (this.building) this.nl?.add(e as unknown as Netted);
    this.enemies.push(e); this.scene.add(e.root, e.blob); return e;
  }

  bark(obj: THREE.Object3D, str: string, dur = 1.6, dy = 1.4) {
    this.barks = this.barks.filter((b) => b.obj !== obj);
    this.barks.push({ obj, dy, text: str, t: 0, dur });
  }
  toast(str: string) { this.hud.toast(str); }
  hitstop(sec: number) { this.freeze = Math.max(this.freeze, sec); }
  fadeFlash() { this.flashT = 0.35; }

  /** a candle was lit (by me, by a friend, or by the host's word): everyone respawns there */
  lightCandle(i: number, announce = true) {
    const c = this.checkpoints[i];
    if (!c) return;
    if (!c.lit) c.light_(this); else this.setCheckpoint(c);
    if (announce && this.nl?.isHost) net.send('all', GM.candle, { i });
  }

  setCheckpoint(c: Checkpoint3) {
    this.checkpoint = c.pos.clone(); this.checkpointYaw = this.player.yaw;
    const p = this.player;
    p.hp = p.maxHp; p.ammo = Math.max(p.ammo, save.data.ammoMax);
    p.lid = save.data.upgrades.lid;
    this.toast('Свечка зажжена — тут ты возродишься');
    save.write();
  }

  /** crumbs dropped on the last death (shown on the death screen) */
  lostCrumbs = 0;
  onPlayerDeath() {
    save.data.deaths++;
    this.stats.deaths++;
    // dying costs a share of the crumbs in your pocket
    this.lostCrumbs = coop.easy ? 0 : Math.floor(save.data.crumbs * 0.15);
    save.data.crumbs -= this.lostCrumbs;
    this.stats.lost += this.lostCrumbs;
    if (this.lostCrumbs > 0) this.fx.chunks(this.player.center(), Math.min(20, this.lostCrumbs), ['#f0b850', '#e8a850'], this.player.pos.y, [0.06, 0.12]);
    save.write();
    this.slowT = 1.2;
    this.tcam.shake(0.6);
    this.deathT = 0;
  }

  speakAnim(who: Who) {
    // the story cast (L.npc('tosha' | 'bublik' | 'noki' | 'pastila')) talks for its speaker: hero → Тоша, dog → Бублик
    const cast = this.npcs[(who === 'hero' ? 'tosha' : who === 'dog' ? 'bublik' : who) as string];
    if (cast) cast.talk = 0.35;
    if (who === 'hero') this.player.talk = 0.35;
    else if (who === 'bear' && this.npcs.bear) this.npcs.bear.talk = 0.35;
    else if (who === 'dog' && this.npcs.dog) this.npcs.dog.talk = 0.35;
    else if (who === 'king') {
      if (this.npcs.kingBg) this.npcs.kingBg.talk = 0.35;
      const b = this.boss as unknown as { talk?: number } | null;
      if (b && 'talk' in b) b.talk = 0.35;
      const ch = this.chaser as unknown as { talk?: number } | null;
      if (ch && 'talk' in ch) ch.talk = 0.35;
      for (const a of this.actors) if (a.who === 'king') a.talk = 0.35;
    } else if (who === 'guard' && this.npcs.feeder) this.npcs.feeder.talk = 0.35;
  }

  // ───────────────── cutscene helpers ─────────────────
  /** run a story script; in co-op the host runs it for everyone (each machine plays it with its own camera) */
  run(id: string, fromNet = false) {
    // co-op: the host force-ended a stuck story scene for everyone
    if (id === CUT_END) { if (fromNet) this.endWorldCut('the host ended it', false); return; }
    const s = SCRIPTS3.scripts[id];
    if (!s) return;
    // co-op client: the host starts a story scene only once its previous one is over — mine still playing is late (or stuck)
    if (fromNet && this.storyOn()) this.endWorldCut(`'${id}' started`, false, true);
    this.seen.add(id);
    // clients never test triggers themselves: mark it here, or my goal arrow keeps pointing at a trigger long gone off
    for (const tr of this.triggers) if (tr.script === id) tr.fired = true;
    const co = new Coroutine(this.nl ? this.watched(id, s(this)) : s(this));
    this.scripts.push(co);
    this.worldScripts.add(co);
    this.storyIds.set(co, id);
    this.cutT = 0;
    if (this.nl?.isHost && !fromNet) net.send('all', GM.script, { name: id });
  }
  runGen(g: Script) { this.scripts.push(new Coroutine(g)); }
  get inCutscene() { return this.scripts.length > 0 || this.dialog.active; }
  /** the shared world is in a story beat (enemies hold still, triggers wait) */
  get worldCut() { return this.nl ? this.worldScripts.size > 0 : this.letterboxTarget > 0.5; }
  /** a story scene (L.run) is playing on this machine */
  storyOn() { for (const s of this.worldScripts) if (!s.done) return true; return false; }
  /** in co-op lines advance by themselves so everyone stays on the same beat */
  say(who: Who, str: string, expr?: string): Waiter {
    const w = this.dialog.say(who, str, expr, this.nl ? 1.2 : 0);
    // the box may be closed under a line that is still waiting (another scene ended, a force-end): that line is over
    const d = this.dialog;
    return { update: (dt) => w.update(dt) || !d.active };
  }

  // co-op watchdog: a story scene must never hold the shared world (enemies, triggers, the exit) forever
  private storyIds = new WeakMap<Coroutine, string>();
  /** seconds the current story scene has been on */
  private cutT = 0;
  /** co-op: a step of a story scene that can't finish (a wait that never comes true, an error) is skipped */
  private *watched(id: string, g: Script): Script {
    try {
      for (;;) {
        let r: IteratorResult<Waiter | undefined, void>;
        try { r = g.next(); } catch (e) { console.error(`[level] story scene '${id}' failed`, e); return; }
        if (r.done) return;
        const w = r.value;
        if (!w) { yield undefined; continue; }
        let t = 0;
        yield { update: (dt: number) => {
          try { if (w.update(dt)) return true; } catch (e) { console.error(`[level] story scene '${id}' failed`, e); return true; }
          t += dt;
          if (t < CUT_STEP_MAX) return false;
          console.warn(`[level] story scene '${id}': a step hung for ${CUT_STEP_MAX} s — skipped`);
          return true;
        } };
      }
    } finally {
      // force-ended (Coroutine.stop): the scene's own `finally` cleanup still runs
      try { g.return(undefined); } catch (e) { console.error(`[level] story scene '${id}': cleanup failed`, e); }
    }
  }
  /** co-op: stop the story scenes playing here and give me my hero back (host: for everyone) */
  private endWorldCut(why: string, announce = true, quiet = false) {
    if (!this.worldScripts.size) return;
    (quiet ? console.info : console.warn)(`[level] story scene force-ended: ${why}`);
    let finishing = false;
    for (const co of this.worldScripts) {
      const id = this.storyIds.get(co) ?? '';
      if (!co.done && (id.startsWith('exit_') || id === 'throne_victory')) finishing = true;
      co.stop();
    }
    this.worldScripts.clear();
    this.scripts = this.scripts.filter((s) => !s.done);
    this.cutT = 0;
    const p = this.player;
    p.auto = null; p.faceYaw = null; p.body.gravity = 32; p.root.scale.setScalar(1);
    if (!this.complete) p.hidden = false;
    if (!this.itemGetting) { p.forceState = null; p.expr = undefined; this.cutscene(false); } else this.dialog.close();
    if (announce && this.nl?.isHost) net.send('all', GM.script, { name: CUT_END });
    // the scene that ends the chapter never got to its end: the chapter is won all the same
    if (finishing && this.authority && !this.results) this.endLevel();
  }

  cutscene(on: boolean) {
    this.letterboxTarget = on ? 1 : 0;
    this.player.control = !on;
    input.mouseCombat = !on;
    if (on) { this.player.body.vel.x = 0; this.player.body.vel.z = 0; this.player.atk = null; this.player.dashT = 0; this.player.body.gravity = 32; }
    else { this.dialog.close(); if (this.tcam.mode === 'cine') this.tcam.endCine(this.camModeDefault, this.player.center().setY(this.player.pos.y + 0.95)); }
  }

  /** move the cinematic camera to (pos, look) over d seconds */
  shot(pos: THREE.Vector3, look: THREE.Vector3, d: number): Waiter {
    if (this.tcam.mode !== 'cine') this.tcam.beginCine();
    this.tcam.cineSmooth = 0;
    const p0 = this.tcam.cinePos.clone(), l0 = this.tcam.cineLook.clone();
    if (d <= 0) { this.tcam.cinePos.copy(pos); this.tcam.cineLook.copy(look); return { update: () => true }; }
    return tween(d, (k) => { this.tcam.cinePos.lerpVectors(p0, pos, k); this.tcam.cineLook.lerpVectors(l0, look, k); }, ease.inOut);
  }

  /** camera back behind the player */
  camBack(d: number): Waiter {
    const p = this.player;
    const focus = p.center().setY(p.pos.y + 0.95);
    const camYaw = p.yaw + Math.PI;
    const dist = this.tcam.zoomDist;
    const pitch = 0.32;
    const pos = focus.clone().add(new THREE.Vector3(Math.sin(camYaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(camYaw) * Math.cos(pitch) * dist));
    const w = this.shot(pos, focus, d);
    return { update: (dt) => { const r = w.update(dt); if (r) { this.tcam.endCine(this.camModeDefault, focus); } return r; } };
  }

  walkTo(x: number, z: number, speed = 0.55): Waiter {
    this.player.auto = { x, z, speed };
    return { update: () => this.player.auto === null };
  }

  // ───────────────── triggers / arenas / traps ─────────────────
  private inBox(p: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3) {
    return p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y && p.z >= min.z && p.z <= max.z;
  }

  private updateTriggers(dt = 0) {
    const hs = this.alivePlayers();
    if (!hs.length) return;
    const busy = this.nl ? this.worldCut : this.inCutscene;
    for (const tr of this.triggers) {
      if (tr.fired || busy) continue;
      // one story beat at a time: nothing else (another trigger, the exit) starts in the same frame
      if (hs.some((h) => this.inBox(h.pos, tr.min, tr.max))) { tr.fired = true; this.run(tr.script); return; }
    }
    if (!this.exitZone || this.complete || busy) return;
    const inside = hs.filter((h) => this.inBox(h.pos, this.exitZone!.min, this.exitZone!.max)).length;
    // hardcore: every hero in the level is needed — downed / dead ones too (revive them, bring them along), no countdown
    const hard = !!this.nl && coop.hard;
    const team = hard ? this.heroes().filter((h) => !(h as { stale?: boolean }).stale).length : hs.length;
    let go = inside > 0;
    if (this.nl && inside > 0 && inside < team) {
      // co-op: the door waits for the whole team (or 20 s once somebody is there)
      this.exitT += dt;
      go = !hard && this.exitT > 20;
      const w = { n: inside, of: team, t: hard ? 0 : Math.max(0, Math.ceil(20 - this.exitT)) };
      if (!this.exitWait || this.exitWait.n !== w.n || this.exitWait.t !== w.t || this.exitWait.of !== w.of) { this.exitWait = w; net.send('all', GM.exitWait, w); }
    } else if (inside === 0 && this.exitT > 0) { this.exitT = 0; this.exitWait = null; if (this.nl) net.send('all', GM.exitWait, { n: 0, of: team, t: 0 }); }
    if (go) {
      this.complete = true;
      this.exitWait = null;
      audio.sfx('door');
      if (('exit_' + this.def.id) in SCRIPTS3.scripts) this.run('exit_' + this.def.id);
      else this.endLevel();
    }
  }

  private updateTraps(dt: number) {
    const p = this.player;
    if (p.dead) return;
    for (const tr of this.traps) {
      tr.cd -= dt;
      if (tr.cd <= 0 && this.inBox(p.pos, tr.min, tr.max)) {
        tr.cd = 4.5;
        tr.drops.forEach(([x, z], i) => {
          const gy = this.phys.groundAt(x, z, tr.dropY - 1, 0.3);
          this.addFaller(new Faller3(x, tr.dropY, z, gy, 'book', 0.7 + i * 0.25), false);
        });
        audio.sfx('warn', { pitch: 0.8 });
      }
    }
  }

  /** seconds a wave enemy has been outside its closed ambush ring */
  private strayT = new WeakMap<object, number>();
  private updateArenas(dt: number) {
    const auth = this.authority;
    const busy = this.nl ? this.worldCut : this.inCutscene;
    this.arenas.forEach((a, i) => {
      const inRing = (h: HeroLike) => Math.hypot(h.pos.x - a.center.x, h.pos.z - a.center.z) < a.radius - a.enter && Math.abs(h.pos.y - a.center.y) < 2 && h.body.onGround;
      // (co-op: one ambush at a time — everyone is pulled into the running one)
      if (auth && a.state === 'idle' && !busy && this.alivePlayers().some(inRing) && !(this.nl && this.arenas.some((o) => o.state === 'active'))) {
        this.startArena(a);
        if (this.nl) net.send('all', GM.arena, { i, s: 'active', w: 0 });
      }
      if (a.bars.visible) {
        a.rise = damp(a.rise, a.state === 'active' && !a.open ? 1 : 0, 6, dt);
        for (const b of a.bars.children) b.position.y = a.center.y - 2.2 + a.rise * 4.2;
        if ((a.state === 'done' || a.open) && a.rise < 0.02) a.bars.visible = false;
      }
      if (this.nl && a.state === 'active') this.coopArena(a, i, dt);
      if (auth && a.state === 'active') {
        a.alive = a.alive.filter((e) => !e.dead);
        // a wave enemy that got outside the closed bars (knocked over, a fleeing bat) can't be reached: back into the ring
        // (flyers swoop out for a moment: only after 2.5 s outside)
        if (!a.open) for (const e of a.alive) {
          const p = e.body.pos, dx = p.x - a.center.x, dz = p.z - a.center.z, d = Math.hypot(dx, dz);
          if (d < a.radius + 0.6 && p.y > a.center.y - 2.5) { this.strayT.delete(e); continue; }
          const t = (this.strayT.get(e) ?? 0) + dt;
          this.strayT.set(e, t);
          if (t < 2.5) continue;
          this.strayT.delete(e);
          const k = d > 0.01 ? Math.max(1, a.radius - 2) / d : 0;
          p.set(a.center.x + dx * k, Math.max(p.y, a.center.y + 0.5), a.center.z + dz * k);
          e.body.vel.set(0, 0, 0);
        }
        if (a.alive.length === 0) {
          a.wave++;
          if (a.wave < a.waves.length) { this.spawnWave(a); this.toast(`Волна ${a.wave + 1} из ${a.waves.length}`); if (this.nl) net.send('all', GM.arena, { i, s: 'wave', w: a.wave }); }
          else { this.finishArena(a); if (this.nl) net.send('all', GM.arena, { i, s: 'done', w: a.wave }); }
        }
      }
    });
  }

  /** a hero counts as in the fight: inside the bars (any height a jump reaches), not fallen off below */
  private inArena(a: Arena3, p: THREE.Vector3) {
    return Math.hypot(p.x - a.center.x, p.z - a.center.z) < a.radius + 0.3 && p.y > a.center.y - 2.5 && p.y < a.center.y + 9;
  }

  /**
   * Co-op ambush rules: the whole living team fights inside the ring. Each machine pulls its own hero in (at the
   * start, after a respawn / revive, a late load); the host drops the bars when no living hero is inside for a few
   * seconds (never a closed wave in an empty ring — the waves still have to be beaten for the prize) and repeats the
   * state of a running ambush now and then for anyone who missed it.
   */
  private coopArena(a: Arena3, i: number, dt: number) {
    if (!a.open && this.arenas.find((o) => o.state === 'active' && !o.open) === a) this.pullIn(a, dt);
    if (!this.nl?.isHost) return;
    a.syncT += dt;
    if (a.syncT > 3) { a.syncT = 0; net.send('all', GM.arena, { i, s: 'active', w: a.wave, o: a.open ? 1 : 0 }); }
    const alive = this.alivePlayers();
    if (a.open || this.worldCut || this.complete || !alive.length || alive.some((h) => this.inArena(a, h.pos))) { a.emptyT = 0; return; }
    a.emptyT += dt;
    if (a.emptyT < 3) return;
    console.warn(`[level] ambush ${i}: nobody alive inside for 3 s — the bars go down`);
    this.openArena(a);
    net.send('all', GM.arena, { i, s: 'open', w: a.wave });
  }

  /** co-op: my hero is outside a closed ambush ring → into the ring in a puff of stars (each owner moves his own) */
  private pullIn(a: Arena3, dt: number) {
    const p = this.player;
    if (p.dead || p.downed || p.hidden || p.grabbedBy || this.worldCut || this.complete || this.results || this.itemGetting || this.inArena(a, p.pos)) { a.outT = Math.min(a.outT, 0); return; }
    a.outT += dt;
    if (a.outT < 0.35) return;
    const spot = this.ringSpot(a);
    if (!spot) { a.outT = -1; return; } // no free spot right now: try again in a moment
    a.outT = 0;
    this.fx.stars(p.center(), 16, ['#ffe14a', '#fff3c0', '#ffffff']);
    this.teleportMe(spot, Math.atan2(a.center.x - spot.x, a.center.z - spot.z));
    this.fx.stars(p.center(), 24, ['#ffe14a', '#fff3c0', '#ffffff']);
    this.fx.ring(p.pos.clone().setY(p.pos.y + 0.1), 1.6, '#ff5a4a', 0.35);
    audio.sfx('whoosh', { pitch: 1.3, volume: 0.6 });
    this.hud.toast('Засада! Все в круг!');
  }

  /** a free spot inside an ambush ring for my hero: on the side I come from, my own angle so friends don't stack */
  private ringSpot(a: Arena3): THREE.Vector3 | null {
    const p = this.player;
    const slot = this.nl ? Math.max(0, [...net.members.keys()].sort().indexOf(net.myId)) : 0;
    // (friends pulled in at the same moment can't see each other's new spots yet: each slot gets its own sixth of the ring)
    const from = Math.atan2(p.pos.z - a.center.z, p.pos.x - a.center.x) + [0, 1, -1, 2, -2, 3][slot % 6] * (Math.PI / 3);
    const R = Math.max(1, a.radius - 1.4);
    const pt = new THREE.Vector3();
    for (const k of [0.6, 0.4, 0.8, 0.2]) for (let j = 0; j < 12; j++) {
      const ang = from + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * (Math.PI / 6);
      const x = a.center.x + Math.cos(ang) * R * k, z = a.center.z + Math.sin(ang) * R * k;
      const gy = this.phys.groundAt(x, z, a.center.y + 2.5, 0.3);
      if (gy < a.center.y - 1.2) continue;
      if (this.phys.pointInSolid(pt.set(x, gy + 0.5, z), 'hero') || this.phys.pointInSolid(pt.set(x, gy + 1.3, z), 'hero')) continue;
      if (this.heroes().some((h) => !h.isLocal && Math.hypot(h.pos.x - x, h.pos.z - z) < 1.1)) continue;
      if (this.enemies.some((e) => !e.dead && Math.hypot(e.body.pos.x - x, e.body.pos.z - z) < 1.6)) continue;
      return pt.set(x, gy + 0.05, z);
    }
    return null;
  }

  /** move MY hero at once (not a walk): friends' copies jump there instead of sliding through walls */
  teleportMe(at: THREE.Vector3, yaw?: number) {
    const p = this.player;
    p.body.pos.copy(at); p.body.vel.set(0, 0, 0);
    if (yaw !== undefined) p.yaw = yaw;
    p.forgetSafe(at);
    p.teleported();
    this.tcam.snap(p.pos);
  }

  /** co-op failsafe: the bars sink back into the floor; the ambush goes on until its waves are beaten */
  private openArena(a: Arena3) {
    if (a.open) return;
    a.open = true;
    for (const c of a.cols) c.active = false;
    this.hud.toast('Прутья ушли в пол — добейте засаду!');
  }

  private startArena(a: Arena3) {
    a.state = 'active'; a.wave = 0;
    a.open = false; a.emptyT = 0; a.outT = 0; a.syncT = 0;
    a.bars.visible = true; a.rise = 0;
    for (const c of a.cols) c.active = true;
    this.hud.showBanner('ЗАСАДА!', '#ff5a4a');
    audio.sfx('warn'); audio.sfx('roar', { volume: 0.25, pitch: 2 });
    this.tcam.shake(0.3);
    if (this.authority) this.spawnWave(a);
  }

  private finishArena(a: Arena3) {
    a.state = 'done';
    this.seen.add(a.key);
    for (const c of a.cols) c.active = false;
    audio.sfx('victory', { volume: 0.6 });
    this.hud.showBanner('ПОБЕДА!', '#ffd34a');
    // the prize is per hero: everyone gets their own copy (co-op: an ability comes to whoever doesn't fetch it — the
    // dead, the downed, the far away)
    for (const r of a.reward) this.prize(r.kind, r.x, r.y, r.z);
    for (let i = 0; i < 6; i++) this.dropPickup('crumb', a.center.clone().setY(a.center.y + 1), true);
  }

  /** client: the host says an ambush started / moved on / lost its bars / ended (and repeats a running one) */
  netArena(d: { i: number; s: string; w: number; o?: number }) {
    const a = this.arenas[d.i];
    if (!a) return;
    if (d.s === 'done') {
      if (a.state !== 'done') { if (a.state === 'idle') { a.bars.visible = true; a.rise = 1; } this.finishArena(a); }
      return;
    }
    // (a late loader, or anyone who missed the start, gets it from the repeat)
    if (a.state === 'idle') this.startArena(a);
    if (a.state !== 'active') return;
    if (d.s === 'wave' && a.wave !== d.w) { a.wave = d.w; this.toast(`Волна ${a.wave + 1} из ${a.waves.length}`); }
    else if (d.w > a.wave) a.wave = d.w;
    if (d.s === 'open' || d.o) this.openArena(a);
  }

  private spawnWave(a: Arena3) {
    a.alive = [];
    a.waves[a.wave].forEach((w, i) => {
      const e = this.spawnEnemy(w.kind, w.x, w.y, w.z, { range: 6, ...w.o }, `${a.key}_${a.wave}_${i}`);
      e.spawnT = 0.6 + i * 0.15; e.arena = true;
      e.provoke(this);
      a.alive.push(e);
      this.fx.emit(e.center(), { count: 18, speed: [1, 3], life: [0.4, 0.8], size: [0.3, 0.6], colors: ['#ffffff', '#e8d8c8'], drag: 3 });
    });
  }

  results: LevelResults | null = null;
  private leaving = false;
  /** level done: show the results card first, then move on */
  endLevel() {
    if (this.results) return;
    if (this.nl?.isHost) net.send('all', GM.end, {});
    this.complete = true;
    this.cutscene(true);
    input.releaseLock();
    const best = save.data.medals[this.def.id] ?? 0;
    const step = STORY.find((s) => s.kind === 'level' && s.id === this.def.id);
    // in the chase you run past most melons: kills don't count there
    const stats = { ...this.stats, nuts: this.nutsFound(), nutsTotal: this.nutIds.length };
    if (this.def.id === 'chase') stats.enemies = 0;
    this.results = new LevelResults(step && step.kind === 'level' ? step.title : this.def.title, stats, best, (n) => { save.data.crumbs += n; save.write(); });
    save.data.medals[this.def.id] = Math.max(best, this.results.medal);
    save.write();
  }

  /** co-op: what happens after my results card (set by the co-op flow; default waits for the host) */
  static onCoopFinished: ((L: Level3D) => void) | null = null;
  /** waiting for the host after my results card (co-op) */
  waitingHost = false;

  private finishLevel() {
    save.write();
    if (this.nl) { this.waitingHost = true; Level3D.onCoopFinished?.(this); return; }
    // a level of an episode (not the prologue): the episode's next step
    if (game.run) { game.advance(); return; }
    const cur = STORY[save.data.story];
    if (cur?.kind === 'level' && cur.id === this.def.id) game.advance();
    else {
      const idx = STORY.findIndex((s) => s.kind === 'level' && s.id === this.def.id);
      game.story(Math.max(idx + 1, 0));
    }
  }

  respawn() {
    if (this.nl) { this.respawnLocal(); return; }
    const cp = this.checkpoint ? { pos: this.checkpoint.clone(), yaw: this.checkpointYaw } : undefined;
    const id = this.def.id, seen = this.seen, idx = this.levelIndex;
    game.go(() => new Level3D(id, idx, cp, seen), 3);
  }

  /** co-op: back on my feet at the latest candle (the world keeps going) */
  respawnLocal() {
    const p = this.player;
    const at = this.checkpoint ? this.checkpoint.clone() : new THREE.Vector3(...this.def.spawn);
    p.reset(at.add(new THREE.Vector3(rand(-1, 1), 0.3, rand(-1, 1))), this.checkpoint ? this.checkpointYaw : this.def.yaw);
    p.invuln = 2;
    this.deathMenu = null; this.deathT = 0; this.slowT = 0;
    this.tcam.snap(p.pos);
    this.fadeFlash();
  }

  /** co-op: everybody is down → the whole team restarts from the latest candle (host decides) */
  teamWipe(announce = true) {
    if (!this.nl) return;
    if (announce && this.nl.isHost) net.send('all', GM.wipe, {});
    const cp = this.checkpoint ? { pos: this.checkpoint.clone(), yaw: this.checkpointYaw } : undefined;
    const id = this.def.id, idx = this.levelIndex;
    // hardcore tower (no candles): the whole climb starts over — ambushes, the book, everything but the intro
    const seen = coop.hard && this.def.fallToFloor ? new Set([...this.seen].filter((k) => k === this.def.startScript)) : this.seen;
    game.go(() => new Level3D(id, idx, cp, seen), 3);
  }

  // ───────────────── grabs across the network ─────────────────
  /** victim side: the host says thing `by` grabbed my hero; its grab point comes from that thing's replica */
  netGrab(d: { by: number }) {
    const e = this.nl?.get(d.by) as (Netted & { grabTip?(): THREE.Vector3 }) | undefined;
    const p = this.player;
    if (!e || p.dead || p.grabbedBy) return;
    const self = this;
    const g = {
      tip: () => e.grabTip?.() ?? p.pos.clone().setY(p.pos.y + 0.6),
      release: () => { net.send('host', GM.release, { by: d.by, why: 'free' }); void self; },
    };
    p.grabbedBy = g as unknown as Noodle3;
    p.grip = 8; p.grabDmgT = 1.1;
    p.atk = null; p.dashT = 0; p.body.gravity = 32;
    audio.sfx('grab');
  }
  /** host: a friend broke free (thing handles it); victim: the host let go of me */
  netRelease(d: { by: number; why?: string; to?: string }, from: string) {
    if (this.nl?.isHost && from !== net.myId) {
      const e = this.nl.get(d.by) as (Netted & { netReleased?(L: Level3D, who: string, why: string): void }) | undefined;
      e?.netReleased?.(this, from, d.why ?? 'free');
      return;
    }
    const p = this.player;
    if (p.grabbedBy) { p.grabbedBy = null; p.body.vel.y = 8; p.invuln = 0.8; }
  }

  // ───────────────── update ─────────────────
  update(rawDt: number) {
    this.t += rawDt;
    this.nl?.preTick();
    this.dialog.update(rawDt);
    this.hud.update(rawDt, this.player);
    this.letterbox = damp(this.letterbox, this.letterboxTarget, 8, rawDt);
    this.flashT = Math.max(0, this.flashT - rawDt);
    this.whiteFlash = Math.max(0, this.whiteFlash - rawDt * 2);
    for (const f of this.feedLines) f.t += rawDt;
    this.feedLines = this.feedLines.filter((f) => f.t < 6);
    input.mouseCombat = this.player.control && !this.paused && !this.popup.active && !this.player.dead;
    input.coop = !!this.nl; // co-op: the d-pad sends quick phrases
    if (this.nl) { this.updateCoop(rawDt); return; }

    if (this.results) {
      this.hud.update(0, this.player);
      this.results.update(rawDt, input.pressed('confirm') || input.pressed('jump') || input.pressed('attack') || input.mouseClicked);
      if (this.results.done && !this.leaving) { this.leaving = true; this.finishLevel(); }
      return;
    }
    if (this.popup.active) {
      this.popup.update(rawDt);
      this.itemAnim?.(rawDt);
      if (this.popup.t > 0.7 && (input.pressed('confirm') || input.pressed('jump') || input.pressed('attack') || input.mouseClicked)) {
        this.popup.close(); audio.sfx('menuSelect');
      }
      return;
    }
    if (this.player.dead && this.deathT > 1.4) {
      if (!this.deathMenu) {
        input.releaseLock();
        this.deathMenu = new MenuList([
          { label: 'Ещё разок!', action: () => this.respawn() },
          { label: 'В главное меню', action: () => game.toMenu() },
        ], W / 2, H / 2 + 40, { w: 360 });
      }
      this.deathMenu.update(rawDt);
    }
    if (this.settings) { this.settings.update(rawDt); return; }
    if (input.pressed('help') && !this.player.dead && !this.complete) { this.openSettings('controls'); return; }
    if (input.pressed('pause') && !this.player.dead && !this.complete) this.togglePause();
    if (this.paused) { this.pauseMenu?.update(rawDt); return; }
    this.tips(rawDt);
    // click to capture the mouse for camera control
    if (input.mouseClicked && !input.locked && this.player.control && !this.player.dead) input.requestLock();

    let dt = rawDt;
    if (this.slowT > 0) { this.slowT -= rawDt; dt *= 0.35; }
    if (this.player.dead) this.deathT += rawDt;
    if (this.freeze > 0) { this.freeze -= rawDt; this.tcam.update(0, this.player.pos, this.player.vel, this.phys, false); return; }

    for (const s of this.scripts) s.update(dt);
    for (const s of this.scripts) if (s.done) this.worldScripts.delete(s);
    this.scripts = this.scripts.filter((s) => !s.done);

    this.player.update(this, dt);
    this.tickWorld(dt);
    for (const p of this.pickups) { p.update(this, dt); if (p.dead) { this.scene.remove(p.obj); if (p.blob) this.scene.remove(p.blob); } }
    this.pickups = this.pickups.filter((p) => !p.dead);
    if (!this.player.dead) { this.updateTriggers(dt); this.updateTraps(dt); this.updateArenas(dt); }
    this.castHide();
    this.fx.update(dt);
    this.followCamera(dt);
    for (const pl of this.plugins) pl.update?.(rawDt);
    save.data.playTime += rawDt;
    if (!this.complete && !this.player.dead) this.stats.time += rawDt;
  }

  /** the shared world: enemies, projectiles, bosses, props (solo: everything; co-op client: puppets + replicated sims) */
  private tickWorld(dt: number) {
    const frozen = this.worldCut;
    // the host's AI effects (barks, sparks, sounds) are captured for friends; ambient effects run everywhere anyway
    const cap = (f: () => void) => (this.nl ? this.nl.capture(f) : f());
    cap(() => {
      for (const e of this.enemies) {
        if (!frozen) e.update(this, dt); else e.sync(this, dt);
      }
    });
    for (const e of this.enemies) if (e.dead) { this.scene.remove(e.root, e.blob); this.nl?.remove(e as unknown as Netted); }
    this.enemies = this.enemies.filter((e) => !e.dead);
    for (const s of this.shots) { s.update(this, dt); if (s.dead) this.scene.remove(s.obj); }
    this.shots = this.shots.filter((s) => !s.dead);
    for (const n of this.noodles) n.update(this, dt);
    for (const c of this.checkpoints) c.update(this, dt);
    for (const f of this.fallers) { f.update(this, dt); if (f.dead) this.scene.remove(f.obj, f.marker); }
    this.fallers = this.fallers.filter((f) => !f.dead);
    for (const w of this.waves) { w.update(this, dt); if (w.dead) this.scene.remove(w.obj); }
    this.waves = this.waves.filter((w) => !w.dead);
    cap(() => {
      this.boss?.update(this, dt);
      this.chaser?.update(this, dt);
      for (const a of this.actors) a.update(this, dt);
    });
    for (const n of this.npcList) this.updateNpc(n, dt);
    if (this.actors.some((a) => a.dead)) this.actors = this.actors.filter((a) => !a.dead);
    if (this.hittables.some((h) => h.dead)) this.hittables = this.hittables.filter((h) => !h.dead);
    for (const n of this.noises) n.t += dt;
    this.noises = this.noises.filter((n) => n.t < 0.12);
    for (const u of this.updaters) u(this.t, dt);
    this.updateColliderFx(dt);
    for (const b of this.barks) b.t += dt;
    this.shoutT += dt;
    this.barks = this.barks.filter((b) => b.t < b.dur);
  }

  private followCamera(dt: number) {
    const p = this.player;
    this.tcam.aimK = p.aimK;
    this.tcam.update(dt, p.pos, p.vel, this.phys, p.control && !p.dead);
    updateSun(this.sun, p.pos, this.def.sun.dir, this.tcam.cam);
  }

  /** co-op tick: my overlays (pause, item card, results) and my hit-stop never stop the shared world */
  private updateCoop(rawDt: number) {
    const nl = this.nl!;
    let blocked = false;
    if (this.results) {
      this.results.update(rawDt, !this.waitingHost && (input.pressed('confirm') || input.pressed('jump') || input.pressed('attack') || input.mouseClicked));
      if (this.results.done && !this.leaving) { this.leaving = true; this.finishLevel(); }
      blocked = true;
    } else if (this.popup.active) {
      this.popup.update(rawDt);
      this.itemAnim?.(rawDt);
      if (this.popup.t > 0.7 && (input.pressed('confirm') || input.pressed('jump') || input.pressed('attack') || input.mouseClicked)) { this.popup.close(); audio.sfx('menuSelect'); }
      blocked = true;
    }
    if (this.settings) { this.settings.update(rawDt); blocked = true; }
    else {
      const free = !this.results && !this.complete && !this.plugins.some((pl) => pl.wantsInput?.());
      if (free && input.pressed('help')) this.openSettings('controls');
      else if (free && input.pressed('pause')) this.togglePause();
      if (this.paused && !this.settings) this.pauseMenu?.update(rawDt);
      if (this.paused) blocked = true;
    }
    if (!blocked) this.tips(rawDt);
    if (!blocked && input.mouseClicked && !input.locked && this.player.control && !this.player.dead) input.requestLock();

    // my hero: slow-mo and hit-stop are personal
    let dt = rawDt;
    if (this.slowT > 0) { this.slowT -= rawDt; dt *= 0.35; }
    if (this.freeze > 0) { this.freeze -= rawDt; dt = 0; }
    if (this.player.dead) this.deathT += rawDt; // back at the candle: coopMechanics.ts handles it

    for (const s of this.scripts) s.update(rawDt);
    for (const s of this.scripts) if (s.done) this.worldScripts.delete(s);
    this.scripts = this.scripts.filter((s) => !s.done);
    // watchdog: a story scene still on after CUT_MAX s is stuck somewhere — the host ends it for everyone
    // (a client ends its own copy a little later, in case the host's word never comes)
    if (this.worldScripts.size) { this.cutT += rawDt; if (this.cutT > (nl.isHost ? CUT_MAX : CUT_MAX + 10)) this.endWorldCut(`still on after ${Math.round(this.cutT)} s`); }
    else this.cutT = 0;

    const ctl = this.player.control;
    if (blocked) this.player.control = false;
    this.player.update(this, dt);
    this.player.control = ctl;
    for (const r of nl.remotes.values()) r.update(this, rawDt);

    // the shared world runs on real time; the host captures its effects for everyone
    if (!nl.waiting) {
      this.tickWorld(rawDt);
      this.updateArenas(rawDt);
      if (nl.isHost) this.updateTriggers(rawDt);
    }
    else for (const e of this.enemies) e.sync(this, 0);
    // my own things: loot, book traps over my head
    this.updateHoming(rawDt);
    for (const p of this.pickups) { p.update(this, rawDt); if (p.dead) { this.scene.remove(p.obj); if (p.blob) this.scene.remove(p.blob); } }
    this.pickups = this.pickups.filter((p) => !p.dead);
    this.updateTraps(rawDt);
    this.castHide();
    this.fx.update(rawDt);
    this.followCamera(dt || rawDt * 0.0001);
    for (const pl of this.plugins) pl.update?.(rawDt);
    nl.postTick(rawDt);
    save.data.playTime += rawDt;
    if (!this.complete && !this.player.dead) this.stats.time += rawDt;
  }

  /** «сюжетный состав» (def.castScenes): the players' figures are hidden while the bars are down (not during an item card) */
  get castHidden() { return !!this.def.castScenes && this.letterboxTarget > 0.5 && !this.itemGetting; }
  private castHide() {
    if (!this.castHidden) return;
    this.player.root.visible = false; this.player.blob.visible = false;
    for (const r of this.nl?.remotes.values() ?? []) { r.root.visible = false; r.blob.visible = false; }
  }

  private updateNpc(n: Npc3, dt: number) {
    n.t += dt;
    n.talk = Math.max(0, n.talk - dt * 3);
    const talk = n.talk > 0 ? Math.abs(Math.sin(n.t * 16)) : 0;
    n.anim.talk = talk;
    if (n.kind === 'kingBg') n.anim.mouth = Math.max(n.anim.mouthBase ?? 0, talk * 0.6);
    n.rig.update(dt, n.anim);
  }

  togglePause() {
    this.paused = !this.paused;
    audio.sfx('pause');
    if (this.paused) {
      input.releaseLock();
      audio.duckMusic(0.35);
      this.pauseMenu = new MenuList([
        { label: 'Продолжить', action: () => this.togglePause() },
        { label: 'Настройки', action: () => this.openSettings('sound') },
        { label: 'Управление', action: () => this.openSettings('controls') },
        ...(this.nl ? [
          { label: 'Покинуть комнату', action: () => { save.write(); net.leave(); game.toMenu(); } },
        ] : [
          { label: 'Начать с чекпоинта', action: () => { this.paused = false; this.respawn(); } },
          { label: 'В главное меню', action: () => { save.write(); game.toMenu(); } },
        ]),
      ], W / 2, 196, { w: 380, h: 50, gap: 12, size: 24 });
    } else {
      audio.duckMusic(1);
      this.pauseMenu = null;
    }
  }

  /** the settings panel over the pause; from play (F1) it pauses first and resumes when closed */
  openSettings(tab: SettingsTab) {
    if (!this.paused) { this.togglePause(); this.settingsResume = true; }
    this.ctlHint.dismiss();
    this.settings = new SettingsPanel({
      tab, where: 'level',
      onClose: () => {
        this.settings = null;
        if (this.settingsResume) { this.settingsResume = false; if (this.paused) this.togglePause(); }
      },
    });
  }

  /** first-time help: the essentials card, then (once ever) zoom tips when the camera is squeezed / in a big hall */
  private tips(dt: number) {
    const p = this.player;
    const free = p.control && !p.dead && !this.inCutscene && !this.popup.active && !this.results && this.letterbox < 0.05;
    this.ctlHint.update(dt, free && this.t > 2.5 && !this.hud.chapter);
    if (!free || !this.ctlHint.done) return;
    this.wallT = this.tcam.pulledIn ? this.wallT + dt : 0;
    if (this.wallT > 2.5 && seenOnce('tip:zoomWall')) this.hud.toast(zoomTip('wall'), 6);
    else if (this.tcam.mode === 'boss' && this.t > 10 && seenOnce('tip:zoomBig')) this.hud.toast(zoomTip('big'), 6);
  }

  leave() {
    this.settings?.dispose(); input.releaseLock(); input.mouseCombat = false; for (const pl of this.plugins) pl.dispose?.(); this.nl?.dispose();
    // free this level's GPU buffers: every level / respawn / team restart builds its world anew, and a geometry never
    // disposed keeps its buffers and three's vertex-array state for the rest of the session (≈ 400 geometries per arc
    // level load). A geometry shared with the next scene just uploads again.
    this.scene.traverse((o) => { const g = (o as { geometry?: THREE.BufferGeometry }).geometry; if (g && typeof g.dispose === 'function') g.dispose(); });
  }

  // ───────────────── render ─────────────────
  render(ctx: C) {
    if (RT.r3) {
      const cam = this.tcam.cam;
      const aspect = RT.winW / RT.winH;
      if (Math.abs(cam.aspect - aspect) > 1e-3) this.tcam.setAspect(aspect);
      // cutscenes are framed for 16:9: a narrower (taller) window widens the shot as the bars come in, so the band
      // between them shows the whole framing instead of a zoomed-in middle (people at the sides cut off)
      const zoom = 1 + (cineZoom() - 1) * clamp(this.letterbox, 0, 1);
      if (Math.abs(cam.zoom - zoom) > 1e-4) { cam.zoom = zoom; cam.updateProjectionMatrix(); }
      this.fx.setScale(RT.winH * RT.r3.pixelRatio * 0.9);
      RT.r3.render(this.scene, cam);
    }
    ctx.clearRect(0, 0, W, H);
    this.drawWorldUI(ctx);
    if (this.nl) this.drawCoopUI(ctx);
    this.drawAim(ctx);
    if (this.flashT > 0) { ctx.fillStyle = `rgba(10,4,8,${this.flashT / 0.35})`; ctx.fillRect(0, 0, W, H); }
    if (this.whiteFlash > 0) { ctx.fillStyle = `rgba(255,255,255,${this.whiteFlash})`; ctx.fillRect(0, 0, W, H); }
    if (!this.player.dead && this.player.hp === 1) {
      ctx.save(); ctx.globalAlpha = 0.18 + Math.sin(this.t * 6) * 0.08;
      ctx.strokeStyle = '#ff2040'; ctx.lineWidth = 40; ctx.strokeRect(0, 0, W, H);
      ctx.restore();
    }
    if (this.letterbox > 0.01) {
      const bh = LETTERBOX * this.letterbox;
      ctx.fillStyle = '#0a0406';
      ctx.fillRect(-2000, -2000, W + 4000, 2000 + bh); ctx.fillRect(-2000, H - bh, W + 4000, 2000);
    }
    // speech barks over the bars (a line said in a cutscene used to hide behind them)
    this.drawBarks(ctx);
    for (const f of this.overlayDraw) f(ctx);
    this.drawChaseMeter(ctx);
    // (no toasts / chapter card / banner under the pause or a hub panel — the shop — that covers the middle)
    const panel = !!(this.refs.town as { overlay?: unknown } | undefined)?.overlay;
    // (the «Как играть» card last frame: the toasts go below it instead of under its rows)
    this.hud.toastTop = this.paused ? 0 : this.ctlHint.bottom + 10;
    this.hud.draw(ctx, this.player, this.t, this.player.dead ? 0 : clamp(1 - this.letterbox * 1.5, 0, 1), !this.paused && !panel);
    this.dialog.draw(ctx);
    for (const pl of this.plugins) pl.draw?.(ctx);
    if (!this.paused) this.ctlHint.draw(ctx);
    this.popup.draw(ctx);
    if (this.results) this.results.draw(ctx);
    if (!input.locked && this.player.control && !this.paused && !this.player.dead && !this.popup.active && this.t > 1) {
      text(ctx, 'Кликни по экрану, чтобы управлять камерой мышью', W / 2, H - 14, { size: 15, font: 'body', color: '#fff3d8', align: 'center', alpha: 0.55, stroke: 3 });
    }
    if (this.player.dead && this.deathT > 0.6) this.drawDeath(ctx);
    if (this.paused) this.drawPause(ctx);
  }

  /** current objective: unfired story triggers → key artifacts → the exit */
  goal(): THREE.Vector3 | null {
    for (const tr of this.triggers) if (!tr.fired) return tr.min.clone().add(tr.max).multiplyScalar(0.5);
    // an ambush guarding an artifact
    for (const a of this.arenas) if (a.state !== 'done' && a.reward.some((r) => r.kind === 'doubleJump' || r.kind === 'dash' || r.kind === 'fork')) return a.center.clone();
    for (const p of this.pickups) if (!p.dead && (p.kind === 'doubleJump' || p.kind === 'dash' || p.kind === 'fork')) return p.pos.clone();
    if (this.exitZone) return this.exitZone.min.clone().add(this.exitZone.max).multiplyScalar(0.5);
    const gh = this.refs.goalHint as THREE.Vector3 | undefined;
    return gh ? gh.clone() : null;
  }

  private drawGoal(ctx: C) {
    if (this.inCutscene || this.player.dead || this.boss || this.chaser) return;
    const g = this.goal();
    if (!g) return;
    const cam = this.tcam.cam;
    const d = g.distanceTo(this.player.pos);
    if (d < 4) return;
    const top = g.clone().setY(g.y + 2.5);
    const s = toUI(top, cam);
    const onScreen = s.vis && s.x > 40 && s.x < W - 40 && s.y > 60 && s.y < H - 60;
    const pulse = 0.65 + Math.sin(this.t * 4) * 0.25;
    ctx.save();
    if (onScreen) {
      const y = s.y - 8 + Math.sin(this.t * 3) * 6;
      ctx.globalAlpha = pulse;
      ctx.beginPath(); ctx.moveTo(s.x, y + 14); ctx.lineTo(s.x - 11, y - 4); ctx.lineTo(s.x + 11, y - 4); ctx.closePath();
      ctx.fillStyle = '#ffd34a'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
      text(ctx, `${Math.round(d)} м`, s.x, y - 12, { size: 15, color: '#fff3d8', align: 'center', stroke: 4 });
    } else {
      // arrow at the screen edge pointing toward the goal
      const v = top.clone().project(cam);
      let ax = v.x, ay = -v.y;
      if (v.z > 1) { ax = -ax; ay = -ay; }
      const len = Math.hypot(ax, ay) || 1;
      ax /= len; ay /= len;
      const cx = W / 2 + ax * (W / 2 - 60), cy = H / 2 + ay * (H / 2 - 60);
      ctx.translate(cx, cy); ctx.rotate(Math.atan2(ay, ax));
      ctx.globalAlpha = pulse;
      ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-10, -13); ctx.lineTo(-4, 0); ctx.lineTo(-10, 13); ctx.closePath();
      ctx.fillStyle = '#ffd34a'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
    }
    ctx.restore();
  }

  private drawCoopUI(ctx: C) { drawCoopUIImpl(this, ctx); }

  private drawWorldUI(ctx: C) {
    this.drawGoal(ctx);
    const cam = this.tcam.cam;
    // floating numbers
    for (const ft of this.fx.texts) {
      const s = toUI(ft.pos, cam);
      if (!s.vis) continue;
      const k = ft.life / ft.max;
      ctx.save();
      ctx.globalAlpha = Math.min(1, k * 3);
      text(ctx, ft.text, s.x, s.y, { size: ft.size, color: ft.color, align: 'center', base: 'middle', stroke: 5 });
      ctx.restore();
    }
    // what the melons think: "?" filling up, "!" when spotted, "?" pulsing while they search
    for (const e of this.enemies) {
      if (!(e instanceof Soldier3)) continue;
      const ind = e.indicator();
      if (!ind) continue;
      const s = toUI(tmp.copy(e.body.pos).setY(e.body.pos.y + e.body.h + 0.6), cam);
      if (!s.vis) continue;
      const dist = e.body.pos.distanceTo(this.player.pos);
      if (dist > 30) continue;
      const sc = clamp(1.25 - dist / 40, 0.6, 1.1);
      ctx.save();
      ctx.translate(s.x, s.y); ctx.scale(sc, sc);
      if (ind.kind === 'alert') {
        const k = clamp(e.alertT / 0.2, 0, 1);
        ctx.scale(0.6 + ease.outBack(k) * 0.4, 0.6 + ease.outBack(k) * 0.4);
        text(ctx, '!', 0, 0, { size: 40, color: '#ff3a4a', align: 'center', base: 'middle', stroke: 7 });
      } else if (ind.kind === 'search') {
        ctx.globalAlpha = 0.75 + Math.sin(this.t * 6) * 0.25;
        text(ctx, '?', 0, 0, { size: 34, color: '#ff9a3a', align: 'center', base: 'middle', stroke: 7 });
      } else {
        // "?" that fills up from the bottom as suspicion grows
        text(ctx, '?', 0, 0, { size: 34, color: 'rgba(255,255,255,0.35)', align: 'center', base: 'middle', stroke: 7 });
        ctx.save();
        ctx.beginPath(); ctx.rect(-30, 18 - 36 * ind.v, 60, 36 * ind.v + 4); ctx.clip();
        text(ctx, '?', 0, 0, { size: 34, color: ind.v > 0.6 ? '#ff9a3a' : '#ffd34a', align: 'center', base: 'middle' });
        ctx.restore();
      }
      ctx.restore();
    }
    // sign tooltips
    const p = this.player;
    for (const sg of this.signs) {
      const d = Math.hypot(p.pos.x - sg.pos.x, p.pos.z - sg.pos.z);
      // (not in a boss fight: a sign by the arena popped up over the boss's barks)
      if (d > 3.2 || Math.abs(p.pos.y - sg.pos.y) > 2.5 || this.inCutscene || this.camModeDefault === 'boss') continue;
      const s = toUI(tmp.copy(sg.pos).setY(sg.pos.y + 2.4), cam);
      if (!s.vis) continue;
      const a = clamp((3.2 - d) / 1, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = '400 21px Pangolin, sans-serif';
      const lines = wrap(ctx, bindText(sg.text), 340);
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 34;
      const h = lines.length * 26 + 22;
      const x = clamp(s.x - w / 2, 10, W - w - 10), y = clamp(s.y - h, 10, H - h - 10);
      rrect(ctx, x + 4, y + 6, w, h, 14, 'rgba(0,0,0,0.3)', 0);
      rrect(ctx, x, y, w, h, 14, '#fff7e6', 3);
      lines.forEach((l, i) => text(ctx, l, x + w / 2, y + 30 + i * 26, { size: 21, font: 'body', color: OUT, align: 'center' }));
      ctx.restore();
    }
  }

  /**
   * Speech barks, drawn over the cinematic bars and kept inside what is visible: under the top bar, above the
   * dialog box, inside the window. A head just off the top of the shot (the King's) still shows its bubble at the
   * edge (without the tail); one far off to a side stays hidden as before.
   */
  private drawBarks(ctx: C) {
    if (!this.barks.length) return;
    const cam = this.tcam.cam;
    const v = viewUI();
    const lb = this.letterbox > 0.01 ? LETTERBOX * this.letterbox : 0;
    const top = Math.max(v.y0, lb), bottom = Math.min(v.y1, H - lb);
    const cover = this.dialog.coverTop();
    const maxY = (cover ?? bottom) - 8;
    for (const b of this.barks) {
      b.obj.getWorldPosition(tmp);
      tmp.y += b.dy;
      const s = toUI(tmp, cam);
      if (!s.vis || s.x < v.x0 - 120 || s.x > v.x1 + 120 || s.y > bottom + 120) continue;
      const a = b.t < 0.15 ? b.t / 0.15 : b.t > b.dur - 0.3 ? (b.dur - b.t) / 0.3 : 1;
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.font = '400 20px Pangolin, sans-serif';
      const w = ctx.measureText(b.text).width + 26;
      const sc = ease.outBack(clamp(b.t * 5, 0, 1));
      const x = clamp(s.x, v.x0 + w / 2 + 8, v.x1 - w / 2 - 8);
      const y = clamp(s.y, top + 46, Math.max(top + 46, maxY));
      ctx.translate(x, y); ctx.scale(sc, sc);
      rrect(ctx, -w / 2, -40, w, 34, 12, '#fffaf0', 3);
      if (Math.abs(y - s.y) < 12) {
        const tx = clamp(s.x - x, -w / 2 + 16, w / 2 - 16);
        ctx.beginPath(); ctx.moveTo(tx - 6, -7); ctx.lineTo(tx, 4); ctx.lineTo(tx + 8, -7); ctx.closePath(); ctx.fillStyle = '#fffaf0'; ctx.fill();
        ctx.strokeStyle = OUT; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(tx - 6, -6); ctx.lineTo(tx, 4); ctx.lineTo(tx + 8, -6); ctx.stroke();
      }
      text(ctx, b.text, 0, -16, { size: 20, font: 'body', color: OUT, align: 'center' });
      ctx.restore();
    }
  }

  /** slingshot crosshair (aim mode) and the quick-shot lock-on marker */
  private drawAim(ctx: C) {
    const p = this.player;
    if (p.dead || this.inCutscene || this.paused) return;
    const cam = this.tcam.cam;
    const lockRing = (pt: THREE.Vector3, col: string, r: number, a: number) => {
      const s = toUI(pt, cam);
      if (!s.vis) return;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(s.x, s.y);
      ctx.rotate(this.t * 2.2);
      ctx.lineWidth = 3.5; ctx.strokeStyle = OUT;
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(0, 0, r, i * Math.PI / 2 + 0.25, i * Math.PI / 2 + 1.3); ctx.stroke(); }
      ctx.lineWidth = 2; ctx.strokeStyle = col;
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(0, 0, r, i * Math.PI / 2 + 0.25, i * Math.PI / 2 + 1.3); ctx.stroke(); }
      ctx.restore();
    };
    if (p.aimK > 0.3) {
      const locked = !!p.aim.lock;
      const col = locked ? '#ff4a5a' : '#fff3d8';
      ctx.save();
      ctx.globalAlpha = p.aimK;
      ctx.translate(W / 2, H / 2);
      ctx.lineCap = 'round';
      for (const [w, c] of [[5, OUT], [2.4, col]] as const) {
        ctx.lineWidth = w; ctx.strokeStyle = c;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.beginPath(); ctx.moveTo(dx * 7, dy * 7); ctx.lineTo(dx * 17, dy * 17); ctx.stroke(); }
        ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      if (p.aim.lock) lockRing(p.aim.lock, '#ff4a5a', 26, p.aimK);
      text(ctx, `Горох: ${p.ammo}`, W / 2, H / 2 + 52, { size: 16, color: p.ammo > 0 ? '#c8f0a0' : '#ff9a9a', align: 'center', stroke: 4, alpha: p.aimK * 0.9 });
      text(ctx, `Отпусти ${glyphLabel('shoot')} (или жми ${glyphLabel('attack')}) — выстрел`, W / 2, H - 40, { size: 15, font: 'body', color: '#fff3d8', align: 'center', stroke: 3, alpha: p.aimK * 0.7 });
    } else if (p.quickLock && p.control) {
      lockRing(p.quickLock, '#ffd34a', 18, 0.75);
    }
  }

  /** chase: how close the King is */
  private drawChaseMeter(ctx: C) {
    const ch = this.chaser as unknown as { active?: boolean; front?: number } | null;
    if (ch && ch.active && ch.front !== undefined && !this.player.dead && this.letterbox < 0.5) this.drawMeter(ctx, ch.front);
    this.drawShout(ctx);
  }

  /**
   * The chase King's shout: shown whether he runs or not (the retry taunt comes before he starts, «СТОЙ!!!» at the
   * door after he stops), and under the top cinematic bar instead of on its edge.
   */
  private drawShout(ctx: C) {
    if (!this.shoutText || this.shoutT >= this.shoutDur) return;
    const a = clamp(Math.min(this.shoutT / 0.12, (this.shoutDur - this.shoutT) / 0.3), 0, 1);
    const sc = 1 + (1 - ease.outBack(clamp(this.shoutT * 5, 0, 1))) * 0.6;
    const lb = this.letterbox > 0.01 ? LETTERBOX * this.letterbox : 0;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(W / 2, Math.max(88, lb + 52)); ctx.scale(sc, sc); ctx.rotate(Math.sin(this.t * 30) * 0.015);
    text(ctx, this.shoutText, 0, 0, { size: 30, color: '#ff6a7a', align: 'center', stroke: 7 });
    ctx.restore();
  }

  private drawMeter(ctx: C, front: number) {
    const gap = this.player.pos.x - front;
    const danger = clamp(1 - (gap - 3) / 16, 0, 1);
    if (danger > 0.45) {
      ctx.save();
      ctx.globalAlpha = (danger - 0.45) * (0.5 + 0.3 * Math.sin(this.t * 10));
      const g = ctx.createLinearGradient(0, 0, 160, 0);
      g.addColorStop(0, 'rgba(255,30,60,0.9)'); g.addColorStop(1, 'rgba(255,30,60,0)');
      ctx.fillStyle = g; ctx.fillRect(-2000, -2000, 2160, H + 4000);
      const g2 = ctx.createLinearGradient(0, H, 0, H - 120);
      g2.addColorStop(0, 'rgba(255,30,60,0.9)'); g2.addColorStop(1, 'rgba(255,30,60,0)');
      ctx.fillStyle = g2; ctx.fillRect(-2000, H - 120, W + 4000, 2120);
      ctx.restore();
    }
    const x = W / 2 - 160, y = 22;
    rrect(ctx, x, y, 320, 30, 14, 'rgba(30,10,20,0.7)', 3);
    rrect(ctx, x + 6, y + 6, 308 * danger, 18, 9, danger > 0.7 ? '#ff3a5a' : danger > 0.45 ? '#ffb02a' : '#7ad04a', 0);
    text(ctx, danger > 0.7 ? 'КОРОЛЬ ДОГОНЯЕТ!' : 'Король позади', W / 2, y + 22, { size: 16, color: '#fff3d8', align: 'center', stroke: 4 });
  }

  private drawDeath(ctx: C) {
    const k = clamp((this.deathT - 0.6) / 0.8, 0, 1);
    ctx.save();
    ctx.fillStyle = `rgba(20,4,10,${0.65 * k})`; ctx.fillRect(-2000, -2000, W + 4000, H + 4000);
    ctx.globalAlpha = k;
    const s = 1 + (1 - ease.outBack(k)) * 0.5;
    ctx.translate(W / 2, H / 2 - 90); ctx.scale(s, s); ctx.rotate(Math.sin(this.t * 2) * 0.02);
    text(ctx, 'ОЙ-ОЙ-ОЙ!', 0, 0, { size: 72, color: '#ff5a6a', align: 'center', stroke: 12 });
    text(ctx, this.def.deathText ?? 'Ой... досталось! Ещё разок?', 0, 50, { size: 26, font: 'body', color: '#fff3d8', align: 'center', stroke: 6 });
    if (this.lostCrumbs > 0) text(ctx, `Растеряно крошек: ${this.lostCrumbs}`, 0, 86, { size: 21, font: 'body', color: '#ffc870', align: 'center', stroke: 5 });
    ctx.restore();
    if (this.deathMenu && this.deathT > 1.4) this.deathMenu.draw(ctx);
  }

  private drawPause(ctx: C) {
    if (this.settings) { this.settings.draw(ctx); return; }
    ctx.fillStyle = 'rgba(15,6,12,0.7)'; ctx.fillRect(-2000, -2000, W + 4000, H + 4000);
    text(ctx, 'ПАУЗА', W / 2, 110, { size: 60, color: '#ffd34a', align: 'center', stroke: 10 });
    // this level's own name (the prologue's chapters and every episode level alike)
    const d = this.def;
    text(ctx, d.subtitle ? `${d.subtitle}. ${d.title}` : d.title, W / 2, 142, { size: 18, font: 'body', color: '#f6ecd2', align: 'center' });
    text(ctx, `Сложность: ${this.nl ? DIFF_NAME[coop.diff] : save.data.settings.easy ? 'полегче' : 'нормально'}`, W / 2, 168, { size: 16, font: 'body', color: this.nl ? DIFF_COLOR[coop.diff] : '#d8c8b0', align: 'center' });
    this.pauseMenu?.draw(ctx);
    text(ctx, 'F1 — управление в любой момент', W / 2, H - 24, { size: 15, font: 'body', color: '#d8c8b0', align: 'center', alpha: 0.7 });
  }
}

// ───────────────── co-op overlays ─────────────────
const DOWN_TINT = '#ff6a6a';
function drawCoopUIImpl(L: Level3D, ctx: C) {
  const nl = L.nl!;
  const cam = L.tcam.cam;
  for (const r of nl.remotes.values()) {
    if (r.hidden || L.castHidden) continue;
    const head = toUI(tmp.copy(r.pos).setY(r.pos.y + 1.55), cam);
    const color = r.look.tagColor || '#ffd34a';
    if (head.vis && head.x > -50 && head.x < W + 50 && head.y > -50 && head.y < H + 50) {
      const d = r.pos.distanceTo(L.player.pos);
      const a = clamp(1.4 - d / 45, 0.35, 1);
      ctx.save(); ctx.globalAlpha = a;
      ctx.font = '700 17px Rubik, sans-serif';
      const w = ctx.measureText(r.name).width + 20;
      rrect(ctx, head.x - w / 2, head.y - 24, w, 24, 10, 'rgba(20,10,16,0.65)', 0);
      text(ctx, r.name, head.x, head.y - 6, { size: 17, weight: 700, color, align: 'center' });
      if (r.talking) text(ctx, '🔊', head.x + w / 2 + 12, head.y - 6, { size: 15, align: 'center' });
      // health pips
      const n = Math.min(12, r.maxHp);
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = i < r.hp ? '#ff3a5a' : 'rgba(60,30,40,0.7)';
        ctx.fillRect(head.x - n * 4 + i * 8, head.y + 2, 6, 4);
      }
      if (r.downed || r.dead) text(ctx, r.dead ? '✖' : 'ПОМОГИ!', head.x, head.y - 34, { size: 16, color: DOWN_TINT, align: 'center', stroke: 4 });
      if (r.bubble) {
        const bt = r.bubble.t;
        const ba = bt < 0.15 ? bt / 0.15 : bt > 5.4 ? (6 - bt) / 0.6 : 1;
        ctx.globalAlpha = a * clamp(ba, 0, 1);
        ctx.font = '400 18px Pangolin, sans-serif';
        const lines = wrap(ctx, r.bubble.text, 260);
        const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 24, bh = lines.length * 22 + 14;
        rrect(ctx, head.x - bw / 2, head.y - 44 - bh, bw, bh, 12, '#fffaf0', 3);
        lines.forEach((l, i) => text(ctx, l, head.x, head.y - 44 - bh + 26 + i * 22, { size: 18, font: 'body', color: OUT, align: 'center' }));
      }
      ctx.restore();
    } else if (r.downed) {
      // off-screen arrow toward a friend who needs help
      const v = tmp.copy(r.pos).project(cam);
      let ax = v.x, ay = -v.y;
      if (v.z > 1) { ax = -ax; ay = -ay; }
      const len = Math.hypot(ax, ay) || 1;
      const cx = W / 2 + (ax / len) * (W / 2 - 50), cy = H / 2 + (ay / len) * (H / 2 - 50);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.atan2(ay, ax));
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-9, -12); ctx.lineTo(-9, 12); ctx.closePath();
      ctx.fillStyle = DOWN_TINT; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.restore();
    }
  }
  // event feed (top right)
  L.feedLines.forEach((f, i) => {
    const a = clamp(Math.min(f.t * 4, (6 - f.t) / 0.5), 0, 1);
    text(ctx, f.text, W - 20, 120 + i * 26, { size: 18, font: 'body', color: f.color, align: 'right', stroke: 4, alpha: a });
  });
  // the door waits for the team
  if (L.exitWait && L.exitWait.n > 0 && !L.complete) {
    const w = L.exitWait;
    rrect(ctx, W / 2 - 230, 60, 460, 40, 14, coop.hard ? 'rgba(48,8,16,0.82)' : 'rgba(20,10,16,0.75)', 3);
    // hardcore: no countdown — the door opens only for the whole team
    if (coop.hard) text(ctx, `Хардкор: нужны все — ${w.n} из ${w.of}`, W / 2, 87, { size: 19, font: 'body', color: '#ff9a9a', align: 'center' });
    else text(ctx, `У двери ${w.n} из ${w.of} — ждём остальных… ${w.t} с`, W / 2, 87, { size: 19, font: 'body', color: '#ffe680', align: 'center' });
  }
  if (L.waitingHost) text(ctx, 'Ждём, пока хост продолжит…', W / 2, H - 30, { size: 20, font: 'body', color: '#fff3d8', align: 'center', stroke: 5, alpha: 0.6 + Math.sin(L.t * 3) * 0.3 });
  if (nl.waiting) text(ctx, 'Ждём, пока все загрузятся…', W / 2, H / 2 + 120, { size: 22, font: 'body', color: '#fff3d8', align: 'center', stroke: 5 });
}

void noOutline;
