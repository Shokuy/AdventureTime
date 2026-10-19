import * as THREE from 'three';
import { W, H, rand, damp } from '../../engine/util';
import { input, type Action } from '../../engine/input';
import { audio } from '../../engine/audio';
import { text, rrect, OUT } from '../../art/draw';
import { MenuList, type MenuItem } from '../../ui/widgets';
import { TextInput } from '../../ui/textInput';
import { glyphDevice, glyphWidth, drawGlyph, glyphLabel, type GlyphDevice } from '../../ui/glyphs';
import { profile, TAG_COLORS, HERO_KINDS, type HeroLook, type HatKind, type BackKind, type HeroKind } from '../../net/profile';
import { RT, toUI } from '../runtime';
import { mat, basic, mesh, noOutline, canvasTex, PAL } from '../gfx';
import { FX3 } from '../fx';
import { sanitizeLook, HAT_KINDS, BACK_KINDS, type HeroAnim, type HeroRig, type HeroState } from '../models/hero';
import { createHeroModel, HERO_INFO, HERO_SLOTS } from '../models/heroes';
import { openHeroPicker, heroPickerOpen } from '../game/heroes';

/*
 * «Мой герой»: the hero I play (profile.kind) big on a little stage + a list: which hero (◀ ▶, or the picker), then
 * his look — Tosha: hat, colours, back item; the others: their colour slots (HERO_SLOTS) — the nameplate colour and
 * my name (shared by every hero).
 */

type C = CanvasRenderingContext2D;

export const HAT_NAMES: Record<HatKind, string> = {
  beanie: 'Шапочка', cap: 'Кепка', crown: 'Корона', pirate: 'Пиратская', bunny: 'Ушки зайки', chef: 'Колпак повара', viking: 'Шлем викинга', none: 'Без шапки',
};
export const BACK_NAMES: Record<BackKind, string> = { none: 'Ничего', backpack: 'Рюкзак', cape: 'Плащ', wings: 'Крылышки' };

/** curated cartoon palettes (the classic Tosha colour is always first) */
export const PALETTES = {
  hatColor: ['#ff8a2a', '#e8383d', '#ffd34a', '#3fb8a8', '#3a6ad8', '#8a5ae0', '#ff6aa8', '#5ac85a', '#f6f0e4', '#3a3446'],
  scarfColor: ['#e8383d', '#ff8a2a', '#ffd34a', '#5ac85a', '#3fb8a8', '#3a6ad8', '#8a5ae0', '#ff6aa8', '#f6f0e4', '#3a3446'],
  shirtColor: ['#3fb8a8', '#e8383d', '#ff8a2a', '#ffd34a', '#5ac85a', '#3a6ad8', '#8a5ae0', '#ff6aa8', '#f6f0e4', '#4a4a5a'],
  shortsColor: ['#6b4a3a', '#3a5a9a', '#2a2a3a', '#7a8a3a', '#c84a3a', '#5a3a7a', '#d8b070', '#3a7a6a', '#8a8a96', '#ff8a2a'],
  bootColor: ['#4a2f25', '#2a2a32', '#c83a3a', '#3a5ad0', '#e8b040', '#3a8a4a', '#ff6aa8', '#f0ece0', '#7a4ab0', '#8a5a2a'],
  backColor: ['#8a5a3a', '#e8383d', '#3a6ad8', '#ffd34a', '#5ac85a', '#8a5ae0', '#ff6aa8', '#3fb8a8', '#f6f0e4', '#2a2a3a'],
  tagColor: [...TAG_COLORS, '#ffffff', '#ff4a4a', '#4affc8', '#ffa8e0'],
} satisfies Record<string, string[]>;
type ColorKey = keyof typeof PALETTES;

const STAGE_Y = 0.22;
/** vertical field of view over the 720-high UI area */
const FOV = 30;
const PANEL_X = 975;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function pick<T>(a: readonly T[]): T { return a[Math.floor(Math.random() * a.length)]; }

/** a centred cream plate with "[glyph][glyph] label" prompts for the device in hand (PlayStation / Xbox / keys) */
function drawPrompts(ctx: C, items: Array<[Action[], string]>, cx: number, y: number, size: number, dev: GlyphDevice) {
  const fs = size * 0.68, gap = size * 0.14, sep = size * 0.8;
  const font = `400 ${fs}px Pangolin, "Comic Sans MS", sans-serif`;
  const labelW = items.map(([, label]) => { ctx.font = font; return ctx.measureText(label).width; });
  const glyphsW = items.map(([acts]) => acts.reduce((w, a) => w + glyphWidth(ctx, a, size, dev) + gap, 0));
  const total = labelW.reduce((a, b) => a + b, 0) + glyphsW.reduce((a, b) => a + b, 0) + sep * (items.length - 1);
  const pad = size * 0.5, ph = size * 1.4;
  rrect(ctx, cx - total / 2 - pad, y - ph / 2, total + pad * 2, ph, ph * 0.42, 'rgba(255,246,226,0.94)', 3);
  let x = cx - total / 2;
  items.forEach(([acts, label], i) => {
    for (const a of acts) x += drawGlyph(ctx, a, x, y, size, 'left', dev) + gap;
    text(ctx, label, x, y + size * 0.04, { size: fs, font: 'body', color: OUT, base: 'middle' });
    x += labelW[i] + sep;
  });
}

/** a random but tasteful look */
export function randomLook(): HeroLook {
  const P = PALETTES;
  const shirt = pick(P.shirtColor);
  let scarf = pick(P.scarfColor);
  while (scarf === shirt) scarf = pick(P.scarfColor);
  return {
    hat: pick(HAT_KINDS.filter((h) => h !== 'none' || Math.random() < 0.5)),
    hatColor: pick(P.hatColor), scarfColor: scarf, shirtColor: shirt,
    shortsColor: pick(P.shortsColor), bootColor: pick(P.bootColor),
    back: Math.random() < 0.25 ? 'none' : pick(BACK_KINDS.filter((b) => b !== 'none')),
    backColor: pick(P.backColor), tagColor: pick(P.tagColor),
  };
}

export class Customize3D {
  is3d = true;
  t = 0;
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 200);
  hero: HeroRig;
  /** the hero on show (= the one I play) */
  kind: HeroKind = profile.kind;
  heroG = new THREE.Group();
  anim: HeroAnim = { state: 'idle', speed: 0, attack: null, weapon: 'sword', flash: 0, talk: 0, expr: 'happy', squash: 1 };
  fx = new FX3();
  list: MenuList;
  /** turntable */
  yaw = -0.35;
  yawVel = 0;
  manualT = 0;
  /** camera distance factor (mouse wheel) */
  zoom = 1;
  private zoomCur = 1;
  private dragging = false;
  private lastMX = 0;
  /** short show-off after a change */
  private showT = 0;
  private showState: HeroState = 'cheer';
  private hover = 0;
  private edit: TextInput | null = null;
  /** ignore confirm / back until released (after the name field closes) */
  private holdOff = false;
  private leaving = false;
  private spot: THREE.Mesh;

  /** the colour key of each list row (null = not a colour row) */
  private rowKeys: (ColorKey | null)[] = [];

  constructor(private onExit: () => void) {
    // a damaged saved look (bad kinds / colours) is repaired here, so everything below can trust it
    const clean = sanitizeLook(profile.look);
    if (JSON.stringify(clean) !== JSON.stringify(profile.look)) profile.setLook(clean);
    this.buildStage();
    this.hero = createHeroModel(this.kind, profile.lookOf(this.kind));
    this.heroG.add(this.hero.root);
    this.heroG.position.y = STAGE_Y;
    this.scene.add(this.heroG);
    this.scene.add(this.fx.group);
    this.spot = this.scene.getObjectByName('spot') as THREE.Mesh;
    this.list = this.buildList();
    audio.playMusic('menu');
  }

  private buildList(sel = 0): MenuList {
    const col = (key: ColorKey, label: string, disabled?: () => boolean): MenuItem => ({
      label, disabled,
      left: () => this.cycleColor(key, -1), right: () => this.cycleColor(key, 1),
    });
    const heroRow: MenuItem = {
      label: () => `Герой: ${HERO_INFO[this.kind].name}`,
      left: () => this.switchHero(-1), right: () => this.switchHero(1),
      action: () => openHeroPicker({ onPick: (k) => this.showHero(k) }),
    };
    const rows: Array<[MenuItem, ColorKey | null]> = [[{ label: () => `Имя: ${profile.name}`, action: () => this.editName() }, null], [heroRow, null]];
    if (this.kind === 'tosha') {
      rows.push(
        [{ label: () => `Шапка: ${HAT_NAMES[this.look.hat]}`, left: () => this.cycleKind('hat', -1), right: () => this.cycleKind('hat', 1) }, null],
        [col('hatColor', 'Цвет шапки', () => this.look.hat === 'none'), 'hatColor'],
        [col('scarfColor', 'Шарф'), 'scarfColor'],
        [col('shirtColor', 'Футболка'), 'shirtColor'],
        [col('shortsColor', 'Шорты'), 'shortsColor'],
        [col('bootColor', 'Ботинки'), 'bootColor'],
        [{ label: () => `На спине: ${BACK_NAMES[this.look.back]}`, left: () => this.cycleKind('back', -1), right: () => this.cycleKind('back', 1) }, null],
        [col('backColor', 'Цвет вещи на спине', () => this.look.back === 'none'), 'backColor'],
      );
    } else {
      for (const sl of HERO_SLOTS[this.kind]) rows.push([col(sl.key as ColorKey, sl.label), sl.key as ColorKey]);
    }
    rows.push(
      [col('tagColor', 'Табличка с именем'), 'tagColor'],
      [{ label: 'Случайно!', action: () => this.randomize() }, null],
      [{ label: 'Готово', action: () => this.exit() }, null],
    );
    this.rowKeys = rows.map((r) => r[1]);
    const list = new MenuList(rows.map((r) => r[0]), PANEL_X, 104, { w: 470, h: rows.length > 12 ? 36 : 38, gap: rows.length > 12 ? 5 : 6, size: 20 });
    list.sel = Math.min(sel, rows.length - 1);
    return list;
  }

  /** ◀ ▶ on the hero row: play (and dress) the next hero */
  private switchHero(d: number) {
    const i = HERO_KINDS.indexOf(this.kind);
    this.showHero(HERO_KINDS[(i + d + HERO_KINDS.length) % HERO_KINDS.length]);
  }
  private showHero(kind: HeroKind) {
    profile.setKind(kind);
    if (kind === this.kind) return;
    this.kind = kind;
    this.heroG.remove(this.hero.root);
    this.hero.dispose();
    this.hero = createHeroModel(kind, profile.lookOf(kind));
    this.heroG.add(this.hero.root);
    this.list = this.buildList(1);
    this.showOff('cheer');
    audio.sfx('menuSelect');
  }

  // ───────────────────────── stage ─────────────────────────
  private buildStage() {
    const s = this.scene;
    s.background = new THREE.Color('#1c1028');
    s.fog = new THREE.Fog('#1c1028', 9, 26);
    s.add(new THREE.HemisphereLight('#ffe8d0', '#3a2448', 1.15));
    const sun = new THREE.DirectionalLight('#fff0dc', 2.2);
    sun.position.set(2.5, 6, 4.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera; sc.left = -3; sc.right = 3; sc.top = 3; sc.bottom = -3; sc.near = 0.5; sc.far = 20;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
    s.add(sun, sun.target);
    const rim = new THREE.DirectionalLight('#b8a0ff', 0.9);
    rim.position.set(-3, 3, -4);
    s.add(rim);

    const floor = mesh(new THREE.CircleGeometry(30, 48), mat('#2e1c3c'), { cast: false });
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    // round stage: wooden drum, red carpet top, gold rim
    const drum = mesh(new THREE.CylinderGeometry(1.15, 1.22, STAGE_Y - 0.02, 48), mat(PAL.wood));
    drum.position.y = (STAGE_Y - 0.02) / 2;
    s.add(drum);
    const carpet = mesh(new THREE.CylinderGeometry(1.04, 1.04, 0.03, 48), mat('#b8323a'), { cast: false });
    carpet.position.y = STAGE_Y - 0.01;
    s.add(carpet);
    const rimRing = mesh(new THREE.TorusGeometry(1.1, 0.035, 8, 64), mat(PAL.gold));
    rimRing.rotation.x = Math.PI / 2; rimRing.position.y = STAGE_Y - 0.015;
    s.add(rimRing);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const stud = mesh(new THREE.SphereGeometry(0.04, 12, 8), mat(PAL.gold), { cast: false });
      stud.position.set(Math.sin(a) * 1.19, STAGE_Y * 0.5, Math.cos(a) * 1.19);
      s.add(stud);
    }
    // velvet curtain with folds behind the stage
    const cg = new THREE.PlaneGeometry(16, 8, 160, 1);
    const p = cg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, Math.sin(x * 3.2) * 0.14 + Math.sin(x * 1.3) * 0.08); }
    cg.computeVertexNormals();
    const curtain = mesh(cg, mat('#7a2050'), { cast: false });
    curtain.position.set(0, 4, -4.2);
    s.add(curtain);
    const valance = mesh(new THREE.CylinderGeometry(0.5, 0.5, 16, 24, 1), mat('#9a2a5e'), { cast: false });
    valance.rotation.z = Math.PI / 2; valance.position.set(0, 6.4, -3.8);
    s.add(valance);
    // soft spotlight cone on the stage
    const beamTex = canvasTex(4, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,240,200,0)'); gr.addColorStop(1, 'rgba(255,240,200,1)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 1.25, 7, 32, 1, true), basic('#fff0d0', { transparent: true, opacity: 0.13, side: THREE.DoubleSide, additive: true, map: beamTex, depthWrite: false }));
    beam.position.set(0, 3.5 + STAGE_Y, 0);
    beam.name = 'spot';
    s.add(noOutline(beam));
  }

  // ───────────────────────── editing ─────────────────────────
  /** the look on show (sanitized: always safe to read, unlike raw profile.look) */
  get look(): HeroLook { return this.hero.look; }

  private setLook(patch: Partial<HeroLook>, show: HeroState = 'cheer') {
    this.hero.setLook(patch);
    profile.setLookOf(this.kind, this.hero.look);
    this.showOff(show);
  }

  /** the palette of a colour row for the hero on show */
  private palette(key: ColorKey): string[] {
    if (this.kind === 'tosha' || key === 'tagColor') return PALETTES[key];
    return HERO_SLOTS[this.kind].find((s) => s.key === key)?.palette ?? PALETTES[key];
  }

  private showOff(state: HeroState) {
    this.showState = state;
    this.showT = state === 'cheer' ? 0.9 : 1.4;
    this.fx.stars(V(0, STAGE_Y + 1.15, 0), 10, ['#ffe14a', '#ffffff', this.look.tagColor]);
  }

  private cycleColor(key: ColorKey, d: number) {
    const pal = this.palette(key);
    const i = pal.indexOf(this.look[key].toLowerCase());
    const n = i < 0 ? (d > 0 ? 0 : pal.length - 1) : (i + d + pal.length) % pal.length;
    this.setLook({ [key]: pal[n] } as Partial<HeroLook>);
  }

  private cycleKind(which: 'hat' | 'back', d: number) {
    if (which === 'hat') {
      const i = HAT_KINDS.indexOf(this.look.hat);
      this.setLook({ hat: HAT_KINDS[(i + d + HAT_KINDS.length) % HAT_KINDS.length] });
    } else {
      const i = BACK_KINDS.indexOf(this.look.back);
      const back = BACK_KINDS[(i + d + BACK_KINDS.length) % BACK_KINDS.length];
      // show the new back item off: run (cape flutters), hover (wings flap)
      this.setLook({ back }, back === 'cape' ? 'run' : back === 'wings' ? 'fall' : 'cheer');
      if (back !== 'none') this.manualT = 0;
    }
  }

  private randomize() {
    const l: Partial<HeroLook> = this.kind === 'tosha' ? randomLook() : Object.fromEntries(HERO_SLOTS[this.kind].map((s) => [s.key, pick(s.palette)]));
    this.setLook(l, l.back === 'wings' ? 'fall' : 'cheer');
    this.fx.stars(V(0, STAGE_Y + 0.6, 0), 24, ['#ffe14a', '#ff6aa8', '#5ad8ff', '#ffffff']);
    audio.sfx('nut');
  }

  private editName() {
    if (this.edit) return;
    const r = this.list.rect(0);
    this.edit = new TextInput({
      x: r.x, y: r.y, w: r.w, h: r.h, size: 22,
      value: profile.name, maxLength: 16, placeholder: 'Как тебя зовут?',
      onSubmit: (v) => {
        const name = v.trim();
        if (name && name !== profile.name) { profile.setName(name); this.showOff('cheer'); audio.sfx('coin'); }
        this.closeEdit();
      },
      onCancel: () => this.closeEdit(),
    });
  }

  private closeEdit() {
    this.edit = null;
    this.holdOff = true;
  }

  private exit() {
    if (this.leaving) return;
    this.leaving = true;
    this.edit?.close();
    this.onExit();
  }

  leave() {
    this.edit?.close();
    this.edit = null;
    this.dispose();
  }

  /** free the stage on the GPU (a fresh one is built on every visit): geometries, own materials & textures, shadow map */
  private dispose() {
    this.heroG.remove(this.hero.root);
    this.hero.dispose();
    const geos = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Light) o.dispose(); // the sun's shadow map
      if (o instanceof THREE.InstancedMesh) o.dispose();
      const m = o as THREE.Mesh;
      if (m.geometry) geos.add(m.geometry); // stage + fx geometries are all made here (no shared cache)
      if (m.material) for (const x of [m.material].flat()) mats.add(x);
    });
    for (const g of geos) g.dispose();
    for (const m of mats) {
      if (m instanceof THREE.MeshToonMaterial) continue; // toon materials here come from the shared mat() cache
      (m as THREE.MeshBasicMaterial).map?.dispose();
      m.dispose();
    }
  }

  // ───────────────────────── loop ─────────────────────────
  update(dt: number) {
    this.t += dt;
    if (this.edit && this.edit.closed) this.closeEdit();
    // a mouse click that closed the name box (blur) must not also press a row: wait for the release
    if (this.holdOff && !input.down('confirm') && !input.down('jump') && !input.down('attack') && !input.down('back') && !input.mouseDown) this.holdOff = false;
    if (!this.edit && !this.holdOff && !this.leaving && !heroPickerOpen()) {
      if (input.pressed('back')) { audio.sfx('menuMove'); this.exit(); }
      else this.list.update(dt);
    }
    this.updateTurntable(dt);

    // hero: show-off after a change, otherwise a relaxed idle
    this.showT = Math.max(0, this.showT - dt);
    const a = this.anim;
    const showing = this.showT > 0;
    a.state = showing ? this.showState : 'idle';
    a.speed = showing && this.showState === 'run' ? 1 : 0;
    a.expr = showing ? 'happy' : this.edit ? 'surprised' : 'normal';
    a.talk = 0;
    // wings showcase: hover above the stage
    const hoverT = showing && this.showState === 'fall' ? 1 : 0;
    this.hover = damp(this.hover, hoverT, 5, dt);
    this.heroG.position.y = STAGE_Y + this.hover * (0.28 + Math.sin(this.t * 6) * 0.04);
    this.heroG.rotation.y = this.yaw;
    this.zoomCur = damp(this.zoomCur, this.zoom, 8, dt);
    this.hero.update(dt, a);

    if (Math.random() < 0.25) this.fx.glow.emit(V(rand(-1.2, 1.2), rand(0.3, 2.6), rand(-1, 0.6)), { count: 1, speed: [0.05, 0.25], life: [1.5, 3], size: [0.03, 0.06], colors: ['#fff0c0', '#ffffff'], g: -0.15 });
    this.fx.update(dt);
    (this.spot.material as THREE.MeshBasicMaterial).opacity = 0.11 + Math.sin(this.t * 1.3) * 0.02;
  }

  private updateTurntable(dt: number) {
    let manual = 0;
    if (!this.edit) {
      // mouse drag anywhere left of the panel
      if (input.mouseClicked && input.mouseX < PANEL_X - this.list.w / 2 - 10) { this.dragging = true; this.lastMX = input.mouseX; }
      if (!input.mouseDown) this.dragging = false;
      if (this.dragging) {
        const dx = input.mouseX - this.lastMX;
        this.lastMX = input.mouseX;
        if (dx) { this.yaw += dx * 0.012; this.yawVel = dx * 0.012 / Math.max(dt, 1e-3); this.manualT = 2.5; }
      }
      if (input.wheel) this.zoom = THREE.MathUtils.clamp(this.zoom + input.wheel * 0.08, 0.5, 1.2);
      // pad: L1 / R1 (and the right stick); keys: Q / E, Z / ]
      const padL = input.padHeld('heal'), padR = input.padHeld('interact');
      const keyE = input.down('heal') && !padL;
      const right = input.down('camR') || keyE || padR;
      const left = input.down('camL') || input.down('swap') || padL;
      manual = (right ? 1 : 0) - (left ? 1 : 0) + input.stickRX;
    }
    if (Math.abs(manual) > 0.05) { this.yaw += manual * dt * 2.6; this.yawVel = manual * 2.6; this.manualT = 2.5; }
    else if (!this.dragging) {
      this.manualT = Math.max(0, this.manualT - dt);
      // fling, then slow auto-spin
      this.yawVel = damp(this.yawVel, this.manualT > 0 ? 0 : 0.5, this.manualT > 0 ? 3 : 1.5, dt);
      this.yaw += this.yawVel * dt;
    }
  }

  render(ctx: C) {
    // keep Tosha in the left part of the logical UI area whatever the window shape: the 30° view spans the
    // letterboxed UI height (taller windows widen it), and the camera slides so he stands at x = 380
    const aspect = RT.winW / RT.winH;
    const k = Math.max(1, RT.winH / (H * RT.scale));
    const tanH = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * k;
    const z = this.zoomCur;
    const dist = 4.1 * z;
    const ndc = ((380 - W / 2) * RT.scale) / (RT.winW / 2);
    const dx = -ndc * dist * tanH * aspect;
    this.cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanH));
    this.cam.aspect = aspect;
    this.cam.updateProjectionMatrix();
    const ty = 0.92 + (1 - z) * 0.45;
    this.cam.position.set(dx, ty + 0.38 * z, dist);
    this.cam.lookAt(dx, ty, 0);
    this.fx.setScale(RT.winH * (RT.r3?.pixelRatio ?? 1) * 0.9);
    RT.r3?.render(this.scene, this.cam);

    ctx.clearRect(0, 0, W, H);
    this.drawNamePlate(ctx);
    // panel
    const px = PANEL_X - this.list.w / 2 - 24, pw = this.list.w + 48;
    rrect(ctx, px + 6, 22, pw, 676, 26, 'rgba(0,0,0,0.3)', 0);
    rrect(ctx, px, 16, pw, 676, 26, 'rgba(36,20,48,0.86)', 4);
    text(ctx, 'Мой герой', PANEL_X, 74, { size: 44, color: '#ffd34a', align: 'center', stroke: 8 });
    this.list.draw(ctx);
    this.drawSwatches(ctx);
    const dev = glyphDevice();
    if (this.edit) this.drawEditHint(ctx, dev);
    else if (dev !== 'kb') {
      drawPrompts(ctx, [[['up', 'down'], 'выбрать'], [['left', 'right'], 'менять'], [['heal', 'interact'], 'крутить'], [['back'], 'назад']], PANEL_X, 667, 21, dev);
    } else {
      text(ctx, `↑↓ выбрать   ◀ ▶ менять   мышь / ${glyphLabel('swap')} ${glyphLabel('heal')} — крутить   колесо — ближе   Esc — назад`, PANEL_X, 672, { size: 14, font: 'body', color: '#d8c8e8', align: 'center', alpha: 0.85 });
    }
  }

  /** under the name box (over the inactive list): how to finish typing — ✕ / A done, ○ / B cancel; Enter / Esc */
  private drawEditHint(ctx: C, dev: GlyphDevice) {
    const r = this.list.rect(0);
    rrect(ctx, r.x - 10, r.y + r.h + 3, r.w + 20, 48, 16, '#2a1838', 0);
    drawPrompts(ctx, [[['confirm'], 'готово'], [['back'], 'отмена']], PANEL_X, r.y + r.h + 27, 24, dev);
  }

  private drawNamePlate(ctx: C) {
    const p = toUI(V(this.heroG.position.x, this.heroG.position.y + 1.5, 0), this.cam);
    if (!p.vis) return;
    const name = profile.name;
    ctx.font = '900 24px Rubik, "Arial Black", sans-serif';
    const w = Math.max(90, ctx.measureText(name).width + 34);
    const y = Math.max(40, p.y - 20);
    const bob = Math.sin(this.t * 2) * 3;
    rrect(ctx, p.x - w / 2 + 4, y - 20 + bob + 5, w, 40, 14, 'rgba(0,0,0,0.3)', 0);
    const tag = this.look.tagColor;
    rrect(ctx, p.x - w / 2, y - 20 + bob, w, 40, 14, tag, 4);
    ctx.beginPath();
    ctx.moveTo(p.x - 9, y + 19 + bob); ctx.lineTo(p.x + 9, y + 19 + bob); ctx.lineTo(p.x, y + 31 + bob); ctx.closePath();
    ctx.fillStyle = tag; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = OUT; ctx.stroke();
    ctx.fillStyle = tag; ctx.fillRect(p.x - 9, y + 15 + bob, 18, 5);
    text(ctx, name, p.x, y + 2 + bob, { size: 24, color: OUT, align: 'center', base: 'middle' });
  }

  /** colour dots on the colour rows (same transform as MenuList's animated buttons) */
  private drawSwatches(ctx: C) {
    const keys: Array<[number, ColorKey]> = [];
    this.rowKeys.forEach((k, i) => { if (k) keys.push([i, k]); });
    const L = this.list;
    for (const [i, key] of keys) {
      const r = L.rect(i);
      const a = L.anim[i] ?? 0;
      const dis = L.items[i].disabled?.() ?? false;
      const c = this.look[key];
      ctx.save();
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      const sc = 1 + a * 0.06;
      ctx.scale(sc, sc);
      ctx.rotate(a * Math.sin(L.t * 3) * 0.012);
      if (dis) ctx.globalAlpha = 0.35;
      const sx = r.w / 2 - 66;
      // the whole palette as tiny dots when selected
      if (a > 0.5 && !dis) {
        const pal = this.palette(key);
        const cur = pal.indexOf(c.toLowerCase());
        for (let k = 0; k < pal.length; k++) {
          const x = -r.w / 2 + 50 + k * 9;
          ctx.beginPath(); ctx.arc(x, 12, k === cur ? 3.6 : 2.6, 0, Math.PI * 2);
          ctx.fillStyle = pal[k]; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = OUT; ctx.stroke();
        }
      }
      ctx.beginPath(); ctx.arc(sx, 1, 12 + a * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = c; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.beginPath(); ctx.arc(sx - 4, -3, 3.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.fill();
      ctx.restore();
    }
    // the name row: a little pencil
    const r0 = L.rect(0);
    if (!this.edit) text(ctx, '✎', r0.x + r0.w - 48, r0.y + r0.h / 2 + 2, { size: 20, color: OUT, align: 'center', base: 'middle', alpha: 0.6 + (L.anim[0] ?? 0) * 0.4 });
  }
}
