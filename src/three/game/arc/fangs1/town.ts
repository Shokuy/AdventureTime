import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { clamp, W } from '../../../../engine/util';
import { text } from '../../../../art/draw';
import { noOutline } from '../../../gfx';
import { glowTex } from '../../../world/textures';
import { damp } from '../../../models/kit';
import type { Level3D } from '../../level';
import type { Level3Def } from '../../levels';
import { addGrappleRing } from '../../heroes';
import { buildTown, townProps as T, createFolk, TOWN_NIGHT, type TownLayout } from '../town';
import type { FolkRig, FolkAnim } from '../town';
import { vamp, isVamp, ambient, createBat, type VampKit, type GreyZone, type Lantern, type VRig } from '../vampires';
import { Cast } from './cast';
import { createCount, type CountRig, type CountAnim } from './bossRig';
import { Squirter, companion, specialFolk, actText } from './common';
import { TITLE, DEATH, SIGNS, BARK, TOAST } from './lines';

/*
 * «Клыки в пастиле», part 1 — `fangs1_town` (docs/script-fangs.md §5.1–5.3): Пастильное королевство at midnight,
 * built on the hub town (buildTown, night palette). The intro (5.1) plays on the square at the clock tower; then the
 * town is grey district by district and the tower's door is wrapped in a grey veil until four districts have their
 * colour back:
 *   • the square (start) — Мармеладка (5.2.1), biters, a flock of scouts; clears itself;
 *   • the market street — an ambush ring among the stalls; its colour comes back when the ambush is won;
 *   • the west lane, «улица фонарей» — Зефирыч (5.2.2) and four dark «солнышки» to light against biters and a mist;
 *     its colour comes back with all four lanterns lit and its vampires gone;
 *   • the north street by the lab — a brute, biters, a flyer; clears itself;
 *   • (optional) the east quarter — пресняки, a flyer, the rooftop run (crumbs, a golden walnut on the tower balcony),
 *     a sweet balcony over the creek for Ноки's glide / Бублик's bridge or hook / Пастила's pad, and a cellar in the lab
 *     yard that only Ноки's bat fits into (a golden walnut).
 * Then the veil falls and the exit scene 5.3 at the tower door ends the level (→ fangs1_roofs).
 * Co-op: everything placed at build is replicated by build order; zones / lanterns / the ambush are the host's;
 * the veil and the goal arrow follow the zones on every machine; the intro and exit are world scenes.
 */

export const TOWN_ID = 'fangs1_town';
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const vec = V;

/** the clock tower (layout: −13.5, −15.5, r 2.6) — its door faces the square */
export const TOWER = { x: -13.5, z: -15.5, r: 2.6, door: V(-13.5, 0, -12.6), spire: V(-13.5, 23.1, -15.5) };
/** the story four at the foot of the tower (5.1) */
export const MARKS = {
  tosha: V(-14.2, 0, -9.6), bublik: V(-13.0, 0, -8.4), pastila: V(-15.8, 0, -10.4), noki: V(-17.4, 0, -11.6),
  ladder: V(-5.8, 0, -14.0),
};

interface ZoneDef { id: string; at: [number, number, number]; r: number; auto: 'clear' | 'none'; goal: [number, number, number] }
/** in route order (the goal arrow walks them); `east` is optional */
const ZONES: ZoneDef[] = [
  { id: 'square', at: [0, 0, 0], r: 21, auto: 'clear', goal: [0, 0, 6] },
  { id: 'market', at: [0, 0, 37.5], r: 11, auto: 'none', goal: [0, 0, 37.5] },
  { id: 'west', at: [-32, 0, -1], r: 15, auto: 'none', goal: [-31.5, 0, 6] },
  { id: 'north', at: [-1, 0, -25], r: 14, auto: 'clear', goal: [-2, 0, -23] },
  { id: 'east', at: [40, 0, 0], r: 13, auto: 'clear', goal: [36, 0, 0] },
];
export const REQUIRED = ['square', 'market', 'west', 'north'];

export function townLevel(): Level3Def {
  const p = TOWN_NIGHT;
  return {
    id: TOWN_ID, chapter: 0, title: TITLE.town, subtitle: 'Клыки в пастиле', music: 'night_town',
    spawn: [-10.6, 0, -7.6], yaw: 0.85, killY: -12,
    bg: p.bg, fog: p.fog, hemi: p.hemi, sun: { ...p.sun, dir: [...p.sun.dir] as [number, number, number] },
    castScenes: true, deathText: DEATH.town,
    startScript: 'fangs1_intro',
    build(L) { new NightTown(L); },
  };
}

/** a garland of paper lanterns hung for the Праздник фонариков (lit before the wave, again once the square is back) */
class Garlands {
  mats: THREE.MeshToonMaterial[] = [];
  glowM: THREE.SpriteMaterial;
  lit = 1;
  private want = 1;
  private cols = ['#ff7aa8', '#ffd34a', '#7ad8ff', '#9af08a', '#ff9a4a'];
  constructor(L: Level3D, spans: [THREE.Vector3, THREE.Vector3][], lit: boolean) {
    this.cols.forEach((c) => this.mats.push(new THREE.MeshToonMaterial({ color: c, emissive: c, emissiveIntensity: 0.9 })));
    this.glowM = new THREE.SpriteMaterial({ map: glowTex(), color: '#ffd8a0', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 });
    const g = new THREE.Group();
    const bulb = new THREE.SphereGeometry(0.16, 10, 8).scale(1, 1.25, 1);
    const cord = new THREE.MeshBasicMaterial({ color: '#2a1e2e' });
    let n = 0;
    for (const [a, b] of spans) {
      const len = a.distanceTo(b), k = Math.max(5, Math.round(len / 1.3));
      const sag = Math.min(1.6, len * 0.09);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(a.clone().lerp(b, t).setY(a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sag)); }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.022, 4), cord);
      noOutline(tube);
      g.add(tube);
      for (let i = 1; i < k; i++) {
        const p = curve.getPoint(i / k);
        const m = new THREE.Mesh(bulb, this.mats[n++ % this.mats.length]);
        m.position.copy(p).setY(p.y - 0.18);
        g.add(m);
        if (i % 2 === 0) { const s = new THREE.Sprite(this.glowM); s.scale.setScalar(0.9); s.position.copy(m.position); noOutline(s); g.add(s); }
      }
    }
    L.deco(g);
    this.lit = this.want = lit ? 1 : 0;
    this.apply();
  }
  set(on: boolean) { this.want = on ? 1 : 0; }
  update(dt: number) {
    if (Math.abs(this.lit - this.want) < 0.002) return;
    this.lit = damp(this.lit, this.want, this.want ? 2 : 5, dt);
    this.apply();
  }
  private apply() {
    for (const m of this.mats) m.emissiveIntensity = 0.9 * this.lit;
    this.glowM.opacity = 0.5 * this.lit;
  }
}

/** the grey veil around the clock tower's foot (falls when the four districts are back) */
class Veil {
  obj = new THREE.Group();
  k = 1;
  open = false;
  /** not there yet (the intro, before the grey wave) */
  hidden = false;
  private mat: THREE.SpriteMaterial;
  private puffs: { s: THREE.Sprite; a: number; r: number; y: number; sz: number }[] = [];
  private seal: THREE.Mesh;
  private sealM: THREE.MeshBasicMaterial;
  constructor(L: Level3D) {
    // soft grey puffs swirling round the tower's foot, a grey swirl sealing the door
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    this.mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color: '#a8a4b8', transparent: true, opacity: 0.7, depthWrite: false });
    for (let i = 0; i < 22; i++) {
      const s = new THREE.Sprite(this.mat);
      const p = { s, a: (i / 22) * Math.PI * 2, r: 3.0 + (i % 3) * 0.25, y: 0.5 + (i % 5) * 0.75, sz: 2.2 + (i % 4) * 0.5 };
      s.scale.setScalar(p.sz);
      noOutline(s);
      this.obj.add(s);
      this.puffs.push(p);
    }
    const sw = document.createElement('canvas'); sw.width = sw.height = 128;
    const g2 = sw.getContext('2d')!;
    g2.strokeStyle = 'rgba(200,196,214,0.9)'; g2.lineWidth = 7;
    g2.beginPath(); for (let a = 0; a < Math.PI * 7; a += 0.05) { const r = a * 2.6; const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r; if (a === 0) g2.moveTo(x, y); else g2.lineTo(x, y); } g2.stroke();
    this.sealM = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sw), color: '#c8c4d8', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    this.seal = new THREE.Mesh(new THREE.CircleGeometry(1.25, 32), this.sealM);
    this.seal.position.set(0, 1.35, TOWER.r + 0.12);
    noOutline(this.seal);
    this.obj.add(this.seal);
    this.obj.position.set(TOWER.x, 0, TOWER.z);
    L.deco(this.obj);
  }
  update(t: number, dt: number) {
    this.k = damp(this.k, this.open ? 0 : 1, this.open ? 1.6 : 6, dt);
    this.mat.opacity = 0.62 * this.k;
    this.sealM.opacity = 0.8 * this.k;
    this.seal.rotation.z = t * 0.8;
    for (const p of this.puffs) {
      const a = p.a + t * 0.35;
      p.s.position.set(Math.sin(a) * p.r, p.y + Math.sin(t * 1.3 + p.a * 3) * 0.25, Math.cos(a) * p.r);
    }
    this.obj.visible = this.k > 0.01 && !this.hidden;
  }
}

/** the level's runtime (L.refs.f1town) */
export class NightTown {
  lay: TownLayout;
  V: VampKit;
  cast: Cast;
  zones = new Map<string, GreyZone>();
  westLanterns: Lantern[] = [];
  garlands: Garlands;
  veil: Veil;
  squirt: Squirter;
  /** the intro is on (deco townsfolk, the Count on the spire) */
  introOn = false;
  deco: { folk: { rig: FolkRig; g: THREE.Group; anim: FolkAnim; id: string }[]; count: { rig: CountRig; g: THREE.Group; anim: CountAnim } | null; ladder: THREE.Group | null } = { folk: [], count: null, ladder: null };
  /** gameplay пресняки of the square: hidden while the intro shows the townsfolk before the wave */
  squareFolk: THREE.Object3D[] = [];
  marmeladka: THREE.Object3D | null = null;
  private marketArena = -1;
  private doneN = -1;
  private hudT = 99;
  private veilToast = false;
  private t = 0;
  private bats: { g: THREE.Group; rig: VRig; from: THREE.Vector3; to: THREE.Vector3; t: number; d: number }[] = [];

  constructor(readonly L: Level3D) {
    L.refs.f1town = this;
    const introSeen = L.seen.has('fangs1_intro');
    this.lay = buildTown(L, { night: true, lampLights: 0, noHubProps: true, gateLabel: 'ПРАЗДНИК ФОНАРИКОВ' });
    const V = this.V = vamp(L);
    // night: pale before the intro's moon turns red; red from then on
    V.nightLook({ red: introSeen ? 1 : 0, moonDir: [-0.4, 0.8, -0.6], fog: [30, 140], dark: 0.55 });
    V.moon({ size: 30, red: introSeen ? 1 : 0 });
    // (the town's own sky dome is drawn after the night's: lift the moon and the stars over it)
    const mc = V.moonCtl!;
    mc.group.traverse((o) => { o.renderOrder = 5; });
    L.scene.traverse((o) => { if (o instanceof THREE.Points && o.renderOrder === -999) o.renderOrder = 4; });
    this.cast = new Cast(L);
    // ── colour of the world ──
    for (const z of ZONES) {
      const gz = V.greyZone(z.id, z.at, z.r, { auto: z.auto, edge: 5 });
      if (!introSeen) gz.amount = 0; // (the grey wave of the intro brings it)
      this.zones.set(z.id, gz);
    }
    this.buildLanterns();
    this.buildSquare(introSeen);
    this.buildMarket();
    this.buildWest();
    this.buildNorth();
    this.buildEast();
    this.buildSecrets();
    // candles
    L.cp(-7.4, 0, -6.2);
    L.cp(2.6, 0, 26.0);
    L.cp(-29.4, 0, 14.2);
    L.cp(-19.5, 0, -22.4);
    // signs (§11)
    L.signAt(-3.4, 0, 49.5, SIGNS.feast);
    L.signAt(1.8, 0, 15.6, SIGNS.icing);
    L.signAt(TOWER.x + 3.0, 0, TOWER.z + 4.4, SIGNS.clock);
    L.signAt(-29.6, 0, 11.6, SIGNS.lantern);
    // the veil, the garlands
    this.veil = new Veil(L);
    const lamps = this.lay.lamps.slice(0, 8).map((p) => V3(p).setY(3.05));
    const spans: [THREE.Vector3, THREE.Vector3][] = lamps.map((p, i) => [p, lamps[(i + 1) % 8]]);
    spans.push([vec(TOWER.x + 1.6, 8.5, TOWER.z + 1.6), lamps[4]], [vec(TOWER.x + 1.6, 8.5, TOWER.z + 1.6), lamps[5]], [lamps[0], lamps[4]], [lamps[2], lamps[6]]);
    this.garlands = new Garlands(L, spans, !introSeen);
    this.squirt = new Squirter(L);
    L.updaters.push((t, dt) => this.update(t, dt));
    L.overlayDraw.push((ctx) => this.draw(ctx));
    if (!introSeen) this.buildIntroDeco();
  }

  // ───────────────────────── build ─────────────────────────
  private buildLanterns() {
    const V = this.V;
    // (the first six lanterns get real lights: the dark lantern street first, then the market's)
    for (const [x, z] of [[-30.4, 9.5], [-33.6, 1.5], [-30.4, -6.5], [-33.6, -14.5]] as const) this.westLanterns.push(V.lantern(x, 0, z, { lit: false, r: 5.2 }));
    V.lantern(-4.2, 0, 33.0, { r: 4.6 });
    V.lantern(4.2, 0, 42.0, { r: 4.6 });
    // a few more that only glow: the square, the north street, the east quarter
    V.lantern(5.0, 0, -4.0, { r: 4.2 });
    V.lantern(-8.6, 0, 12.2, { r: 4.2, lit: false });
    V.lantern(-6.0, 0, -29.2, { r: 4.6 });
    V.lantern(33.8, 0, 9.0, { r: 4.4, lit: false });
  }

  private buildSquare(introSeen: boolean) {
    const L = this.L, V = this.V;
    // the townsfolk: Мармеладка (5.2.1) by the start, two more; biters and a flock of scouts
    const m = V.folk(-6.4, 0, -5.2, 'marmelad', 2.4);
    const a = V.folk(-0.6, 0, -8.6, 'zefir', 0.4);
    const b = V.folk(5.6, 0, 2.6, 'pryanik', -2.2);
    this.squareFolk = [m.root, a.root, b.root];
    this.marmeladka = m.root;
    specialFolk(L, m, {
      grey: BARK.marmeladkaGrey, back: BARK.marmeladkaBack,
      after: () => { L.hint('f1colour', TOAST.colour); companion(L, 'bublik_lick', 'bublik', BARK.bublik[1]); },
    });
    void introSeen;
    L.enemy('fanger', 6.5, 0, 7.5, { aggro: 11 });
    L.enemy('fanger', -5.0, 0, 9.5, { aggro: 11 });
    V.flock(2, 4.6, 3, 3);
  }

  private buildMarket() {
    const L = this.L, V = this.V;
    // stall keepers (by their stalls, outside the ring)
    for (const s of this.lay.stalls.slice(0, 4)) V.folk(s.keeper.x, 0, s.keeper.z, undefined, s.yaw);
    // a biter on the bridge's south end, before the market
    L.enemy('fanger', -2.2, 0, 27.2, { aggro: 10 });
    // the ambush ring among the stalls
    this.marketArena = L.arenas.length;
    L.arena(0, 0, 37.5, 6.4, [
      [{ kind: 'fanger', x: -3, y: 0, z: 34.5 }, { kind: 'fanger', x: 3, y: 0, z: 40.5 }, { kind: 'bat', x: 0, y: 3.6, z: 37.5 }, { kind: 'bat', x: 1.5, y: 3.8, z: 36 }],
      [{ kind: 'fanger', x: 3, y: 0, z: 34 }, { kind: 'mist', x: -3, y: 0, z: 41 }, { kind: 'bat', x: -1, y: 3.6, z: 38 }, { kind: 'bat', x: 2, y: 3.8, z: 39 }],
      [{ kind: 'brute', x: 0, y: 0, z: 41.5 }, { kind: 'fanger', x: -3.5, y: 0, z: 35 }, { kind: 'fanger', x: 3.5, y: 0, z: 35 }],
    ], [{ kind: 'heart', x: 0, y: 0.6, z: 37.5 }, { kind: 'bigcrumb', x: 1.2, y: 0.6, z: 37.5 }]);
    L.crumbLine(-1.6, 0, 46, 1.6, 0, 50, 4);
  }

  private buildWest() {
    const L = this.L, V = this.V;
    // Зефирыч, grey, by his dark lantern street (5.2.2)
    const z = V.folk(-31.4, 0, 13.4, 'zefir', 3.1);
    specialFolk(L, z, {
      back: BARK.zefirych,
      after: () => { L.hint('f1lanterns', TOAST.lanterns); companion(L, 'pastila_lantern', 'pastila', BARK.pastila[1]); },
    });
    V.folk(-32.6, 0, -2.0, 'pryanik', 1.2);
    V.folk(-31.2, 0, -17.0, 'marmelad', -0.6);
    L.enemy('fanger', -31.6, 0, 5.0, { aggro: 11 });
    L.enemy('fanger', -32.4, 0, -9.5, { aggro: 11 });
    L.enemy('fanger', -31.0, 0, -18.5, { aggro: 11 });
    L.enemy('mist', -33.0, 0, -4.0, { aggro: 12 });
    V.flock(-32, 4.8, -1, 3);
  }

  private buildNorth() {
    const L = this.L, V = this.V;
    V.folk(-4.2, 0, -27.4, 'zefir', 0.2);
    V.folk(6.4, 0, -21.4, 'pryanik', 2.8);
    L.enemy('brute', 2.0, 0, -23.4, { aggro: 12 });
    L.enemy('fanger', -8.6, 0, -23.0, { aggro: 11 });
    L.enemy('fanger', 9.4, 0, -24.0, { aggro: 11 });
    L.enemy('flyer', 3.0, 7.5, -28.0);
  }

  private buildEast() {
    const L = this.L, V = this.V;
    V.folk(31.8, 0, 6.2, 'marmelad', -1.4);
    V.folk(34.6, 0, -13.6, 'zefir', 0.6);
    L.enemy('fanger', 33.2, 0, -6.4, { aggro: 10 });
    L.enemy('flyer', 40, 7.5, 2);
    // the rooftop run (the hub's: crates → flat roofs → the bridge → the gable → the tower balcony)
    let n = 0;
    const line = (a: THREE.Vector3, b: THREE.Vector3, k: number) => { for (let i = 0; i < k; i++) { const t = k === 1 ? 0.5 : i / (k - 1); L.pick('crumb', a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + 0.45, a.z + (b.z - a.z) * t, 'f1_roof_' + n++); } };
    line(vec(38.5, 3.32, -13.6), vec(38.5, 3.32, -10.4), 3);
    line(vec(38.5, 4.76, -1.6), vec(38.5, 4.76, 1.6), 3);
    line(vec(38.5, 6.6, 10.4), vec(38.5, 6.6, 13.6), 3);
    const last = this.lay.roofRoute[this.lay.roofRoute.length - 1];
    L.pick('nut', last.x, last.y + 0.75, last.z, 'nut_f1_tower');
    // Бублик's hook: a ring over the first flat roof (straight up from the lane)
    addGrappleRing(L, 34.2, 6.6, -4.5);
  }

  /** secrets: a sweet balcony over the creek; a cellar in the lab yard only Ноки's bat fits into */
  private buildSecrets() {
    const L = this.L, pal = this.lay.pal;
    // the balcony over the creek, south of the east tower (glide / bridge / hook / pad / double jump + dash)
    const bx = 46, bz = 19.6, by = 6.2;
    L.add(T.pastilaBridge({ x: bx, y: by, z: bz, len: 3.2, w: 3.2, rotY: 1, rails: false, pal, th: 0.4 }));
    // stilts (candy canes) under it
    const caneM = new THREE.MeshToonMaterial({ color: '#d8d2e6' });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, by + 1, 8), caneM);
      c.position.set(bx + sx * 1.3, (by - 1) / 2, bz + sz * 1.3);
      L.deco(c);
    }
    L.pick('bigcrumb', bx - 0.6, by + 0.75, bz, 'f1_balcony_a');
    L.pick('bigcrumb', bx + 0.6, by + 0.75, bz, 'f1_balcony_b');
    L.pick('heart', bx, by + 0.75, bz + 0.8);
    addGrappleRing(L, bx, by + 3.4, bz - 0.4);
    // the cellar in the lab yard: a sugar-brick hut with a slot under its door (0.62 m) — only a bat gets in
    const cx = 22, cz = -44;
    const hut = new THREE.Group();
    const brick = new THREE.MeshToonMaterial({ color: '#b8a2c0' });
    const roofM = new THREE.MeshToonMaterial({ color: '#7a52a8' });
    const wall = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: THREE.Material = brick) => {
      const me = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m);
      me.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); me.castShadow = true; me.receiveShadow = true;
      hut.add(me);
      L.col({ kind: 'box', min: V(x0, y0, z0), max: V(x1, y1, z1) });
    };
    // walls: back, sides, the front over the slot (the slot: x ±0.8, y 0..0.62)
    wall(cx - 2.2, 0, cz - 2.2, cx + 2.2, 2.6, cz - 1.9);
    wall(cx - 2.2, 0, cz - 1.9, cx - 1.9, 2.6, cz + 2.2);
    wall(cx + 1.9, 0, cz - 1.9, cx + 2.2, 2.6, cz + 2.2);
    wall(cx - 1.9, 0, cz + 1.9, cx - 0.8, 2.6, cz + 2.2);
    wall(cx + 0.8, 0, cz + 1.9, cx + 1.9, 2.6, cz + 2.2);
    wall(cx - 0.8, 0.62, cz + 1.9, cx + 0.8, 2.6, cz + 2.2);
    wall(cx - 2.4, 2.6, cz - 2.4, cx + 2.4, 2.95, cz + 2.4, roofM);
    L.deco(hut);
    L.pick('nut', cx, 0.7, cz - 0.6, 'nut_f1_cellar');
    L.pick('bigcrumb', cx - 1.0, 0.5, cz - 1.0, 'f1_cellar_a');
    L.pick('bigcrumb', cx + 1.0, 0.5, cz - 1.0, 'f1_cellar_b');
    L.signAt(cx + 2.6, 0, cz + 2.6, 'Погреб Зефирыча. Ключ потерян. Щель под дверью — для мышей');
    void pal;
  }

  /** the townsfolk before the wave, Зефирыч on his stepladder, the Count on the spire (intro only) */
  private buildIntroDeco() {
    const L = this.L;
    const folk = (id: string, kind: Parameters<typeof createFolk>[0], look: Parameters<typeof createFolk>[1], at: THREE.Vector3, yaw: number, state: FolkAnim['state'] = 'idle') => {
      const rig = createFolk(kind, look);
      const g = new THREE.Group(); g.add(rig.root); g.position.copy(at); g.rotation.y = yaw;
      L.scene.add(g);
      const anim: FolkAnim = { state, speed: 0, talk: 0, look: 0, grey: 0 };
      this.deco.folk.push({ rig, g, anim, id });
    };
    // Зефирыч on a stepladder at the lamp by the tower, lighting the last lantern
    const lad = new THREE.Group();
    const wood = new THREE.MeshToonMaterial({ color: '#8a5a3a' });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.7, 0.07), wood); leg.position.set(sx * 0.32, 0.8, sz * 0.36); leg.rotation.x = sz * 0.18; lad.add(leg); }
    for (let i = 0; i < 4; i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.16), wood); r.position.set(0, 0.35 + i * 0.4, 0.36 - i * 0.07); lad.add(r); }
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.5), wood); top.position.y = 1.62; lad.add(top);
    lad.position.copy(MARKS.ladder).add(V(0.9, 0, 0.9));
    lad.rotation.y = 0.8;
    L.deco(lad);
    this.deco.ladder = lad;
    folk('zefirych', 'marsh', { color: '#fff8fa', hat: 'top', accent: '#6a6a9a', hold: 'pole', glasses: true }, lad.position.clone().setY(1.66), -1.2);
    // the folk hanging lanterns (where the grey ones will shuffle about)
    folk('marmeladka', 'gumdrop', { color: '#5ad86a', hold: 'lantern', hat: 'bow', accent: '#ff5a8a', scale: 0.85 }, V(-6.4, 0, -5.2), 2.4, 'wave');
    folk('a', 'marsh', { color: '#ffd6e4', hat: 'kerchief', accent: '#ff5a8a' }, V(-0.6, 0, -8.6), 0.4, 'cheer');
    folk('b', 'ginger', { hat: 'top', accent: '#ff5a8a' }, V(5.6, 0, 2.6), -2.2, 'talk');
    folk('c', 'cupcake', { color: '#ffc8e0', accent: '#9a6ad8', hat: 'chef' }, V(-3.4, 0, 3.6), 1.2);
    // the Count (a figure for the scene; the boss is on the roofs)
    const rig = createCount();
    const g = new THREE.Group(); g.add(rig.root); g.position.copy(TOWER.spire); g.visible = false;
    L.scene.add(g);
    this.deco.count = { rig, g, anim: { st: 'perch', p: 0, flash: 0, talk: 0, small: 0, glow: 0.6, speed: 0 } };
  }
  /** the intro is over (or was force-ended): the town as it is from now on */
  endIntro() {
    const L = this.L;
    this.introOn = false;
    for (const f of this.deco.folk) { L.scene.remove(f.g); f.rig.dispose(); }
    this.deco.folk = [];
    if (this.deco.ladder) { L.scene.remove(this.deco.ladder); this.deco.ladder = null; }
    if (this.deco.count) { L.scene.remove(this.deco.count.g); this.deco.count = null; }
    for (const b of this.bats) L.scene.remove(b.g);
    this.bats = [];
    for (const z of this.zones.values()) if (z.state === 'grey') z.amount = 1;
    for (const r of this.squareFolk) r.visible = true;
    for (const e of L.enemies) e.root.visible = true;
    this.veil.hidden = false;
    this.cast.hideAll();
    this.V.night?.set(1, 0.01); this.V.moonCtl?.set(1, 0.01);
    if (this.zones.get('square')!.state === 'grey') this.garlands.set(false);
  }

  /** intro: scout bats burst from the roofs and dive at the townsfolk (a look on every machine) */
  batsBurst() {
    const L = this.L;
    const starts = [V(-14.5, 6, -32), V(-22.5, 6.5, -32), V(14.5, 6, -32), V(-38.5, 6, -4), V(TOWER.x, 17, TOWER.z), V(22.5, 6, 35), V(-14.5, 6, 35), V(30.5, 5.5, -32)];
    const ends = [V(-6.4, 1.2, -5.2), V(-0.6, 1.2, -8.6), V(5.6, 1.2, 2.6), V(-3.4, 1.2, 3.6), MARKS.ladder.clone().add(V(0.9, 2.6, 0.9))];
    starts.forEach((s, i) => {
      for (let k = 0; k < 2; k++) {
        const rig = createBat();
        const g = new THREE.Group(); g.add(rig.root); g.position.copy(s); g.scale.setScalar(1.4);
        L.scene.add(g);
        this.bats.push({ g, rig, from: s.clone().add(V(k * 1.2, k * 0.6, 0)), to: ends[(i + k) % ends.length].clone().add(V(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5)), t: -k * 0.25 - i * 0.08, d: 1.6 + Math.random() * 0.6 });
      }
    });
    audio.sfx('batScreech', { pitch: 0.9 });
    audio.sfx('batFlap', { volume: 0.6 });
    this.burst = true;
  }
  /** intro: the grey wave over the town (zones fade in, the garlands and folk go grey) */
  greyWave(secs: number) {
    const L = this.L;
    this.waveT = 0; this.waveDur = secs;
    this.waved = true;
    this.garlands.set(false);
    ambient(L, () => {
      L.fx.ring(V(0, 0.2, 0), 22, '#9a96a8', 1.2);
      L.fx.ring(V(0, 0.4, 0), 12, '#c8c4d4', 0.8, false);
      audio.sfx('drain', { pitch: 0.7 });
      L.tcam.shake(0.25);
    });
  }
  private waveT = -1;
  private waveDur = 2;
  /** intro beats passed: the flock burst out, the grey wave came */
  private burst = false;
  private waved = false;

  // ───────────────────────── per frame ─────────────────────────
  private update(t: number, dt: number) {
    const L = this.L;
    this.t += dt;
    // the intro was force-ended (watchdog / host): tidy up
    if (this.introOn && !L.storyOn()) this.endIntro();
    // gameplay folk of the square stay out of the intro's picture before the wave
    if (this.introOn) {
      for (const r of this.squareFolk) r.visible = this.waved && this.waveT < 0;
      // the vampires come with the flock
      for (const e of L.enemies) if (isVamp(e)) e.root.visible = this.burst;
    }
    this.veil.hidden = this.introOn && !this.waved;
    this.updateIntroDeco(dt);
    // zones: host rules for the market (the ambush) and the lantern street (all four lanterns + no vampires)
    if (L.authority && !this.introOn) {
      const mk = this.zones.get('market')!;
      if (mk.state === 'grey' && L.arenas[this.marketArena]?.state === 'done') V3restore(this.V, 'market');
      const w = this.zones.get('west')!;
      if (w.state === 'grey' && this.westLanterns.every((l) => l.lit) && !L.enemies.some((e) => !e.dead && isVamp(e) && inZone(e.home, w))) V3restore(this.V, 'west');
    }
    // the square's garlands light again once its colour is back
    if (!this.introOn && this.zones.get('square')!.state !== 'grey') this.garlands.set(true);
    this.garlands.update(dt);
    // the veil, the exit, the goal arrow
    const done = REQUIRED.filter((id) => this.zones.get(id)!.state !== 'grey').length;
    if (done !== this.doneN) {
      if (this.doneN >= 0 && done > this.doneN && !this.introOn) { this.hudT = 0; audio.sfx('artifact', { pitch: 1.2, volume: 0.5 }); }
      this.doneN = done;
    }
    this.hudT += dt;
    const open = done >= REQUIRED.length;
    if (open && !this.veil.open) {
      this.veil.open = true;
      L.exit(TOWER.x - 2.2, -1, TOWER.door.z - 0.2, TOWER.x + 2.2, 4, TOWER.door.z + 2.8);
      if (!this.introOn) { L.hud.toast(TOAST.veilGone, 5); ambient(L, () => { L.fx.stars(V(TOWER.x, 2.5, TOWER.z + 3), 40, ['#ffe14a', '#fff3c0', '#ff9fc0']); audio.sfx('colorRestore', { pitch: 0.9 }); }); }
    }
    this.veil.update(t, dt);
    if (!open && !this.veilToast && !this.introOn && !L.inCutscene && L.seen.has('fangs1_intro') && (this.zones.get('square')!.state !== 'grey' || Math.hypot(L.player.pos.x - TOWER.x, L.player.pos.z - TOWER.z) < 7.5) && this.t > 9) { this.veilToast = true; L.hint('f1veil', TOAST.veil); }
    L.refs.goalHint = open ? undefined : this.nextGoal();
    // the story four's lines on the way (solo)
    this.lines();
    this.squirt.update(dt);
  }

  private nextGoal(): THREE.Vector3 | undefined {
    for (const z of ZONES) {
      if (!REQUIRED.includes(z.id)) continue;
      if (this.zones.get(z.id)!.state === 'grey') return V(...z.goal);
    }
    return undefined;
  }

  private lines() {
    const L = this.L, p = L.player.pos;
    if (L.nl || L.inCutscene || this.introOn) return;
    const near = (x: number, z: number, r: number) => Math.hypot(p.x - x, p.z - z) < r;
    if (this.t > 10 && !near(-10.6, -7.6, 6)) companion(L, 'tosha_go', 'tosha', BARK.tosha[0]);
    if (near(0, 31, 6)) companion(L, 'pastila_syrup', 'pastila', BARK.pastila[0]);
    if (near(-31.5, 3, 9) && L.enemies.some((e) => e.kind === 'bat' && !e.dead && Math.hypot(e.body.pos.x - p.x, e.body.pos.z - p.z) < 10)) companion(L, 'noki_bat', 'noki', BARK.noki[0]);
    if (near(-14, -22.5, 8)) companion(L, 'bublik_angry', 'bublik', BARK.bublik[0]);
    if (near(4, -24, 8)) companion(L, 'tosha_together', 'tosha', BARK.tosha[1]);
    if (near(22, -40, 7)) companion(L, 'noki_quiet', 'noki', BARK.noki[1]);
  }

  private updateIntroDeco(dt: number) {
    const L = this.L;
    // the grey wave
    if (this.waveT >= 0) {
      this.waveT += dt;
      const k = clamp(this.waveT / this.waveDur, 0, 1);
      for (const z of this.zones.values()) if (z.state === 'grey') z.amount = k * k * (3 - 2 * k);
      for (const f of this.deco.folk) f.anim.grey = Math.max(f.anim.grey ?? 0, clamp((this.waveT - 0.3) / 1.2, 0, 1));
      if (k >= 1) this.waveT = -1;
    }
    for (const f of this.deco.folk) {
      const grey = f.anim.grey ?? 0;
      if (grey > 0.5 && f.anim.state !== 'sit') { f.anim.state = 'idle'; }
      f.anim.talk = 0;
      f.rig.update(dt, f.anim);
    }
    if (this.deco.count) this.deco.count.rig.update(dt, this.deco.count.anim);
    for (const b of this.bats) {
      b.t += dt;
      const k = clamp(b.t / b.d, 0, 1);
      if (b.t < 0) continue;
      const mid = b.from.clone().lerp(b.to, 0.5).add(V(0, 3, 0));
      const p = qbez(b.from, mid, b.to, k);
      if (k >= 1) { p.add(V(Math.sin(b.t * 5 + b.d * 9) * 0.7, Math.sin(b.t * 7) * 0.3, Math.cos(b.t * 5 + b.d * 9) * 0.7)); }
      const prev = b.g.position.clone();
      b.g.position.copy(p);
      if (p.distanceToSquared(prev) > 1e-6) b.g.rotation.y = Math.atan2(p.x - prev.x, p.z - prev.z);
      b.rig.update(dt, { st: 'fly', p: 0, speed: 3, flash: 0 });
    }
    void L;
  }

  private draw(ctx: CanvasRenderingContext2D) {
    const L = this.L;
    this.squirt.draw(ctx);
    if (this.introOn || L.letterbox > 0.3 || this.doneN < 0) return;
    // «Кварталы в красках: N из M» (доп.) — shown for a while after each district, faint otherwise
    const a = this.hudT < 5 ? 1 : 0.55;
    const pop = this.hudT < 0.4 ? 1 + (0.4 - this.hudT) * 0.8 : 1;
    if (this.doneN < REQUIRED.length) text(ctx, TOAST.district(this.doneN, REQUIRED.length), W / 2, 56, { size: 18 * pop, color: '#ffe8a0', align: 'center', alpha: a, stroke: 4 });
  }

  /** the intro's first toast with the button word */
  static presnyakToast() { return actText(TOAST.presnyak); }
}

// ───────────────────────── helpers ─────────────────────────
function V3(p: { x: number; y: number; z: number }) { return new THREE.Vector3(p.x, p.y, p.z); }
function inZone(p: THREE.Vector3, z: GreyZone) { return Math.hypot(p.x - z.center.x, p.z - z.center.z) < z.radius; }
function V3restore(V: VampKit, id: string) { V.restoreZone(id); }
function qbez(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, t: number) {
  const u = 1 - t;
  return new THREE.Vector3(u * u * a.x + 2 * u * t * b.x + t * t * c.x, u * u * a.y + 2 * u * t * b.y + t * t * c.y, u * u * a.z + 2 * u * t * b.z + t * t * c.z);
}
