import * as THREE from 'three';
import { W, H, damp, clamp } from '../../../engine/util';
import { input } from '../../../engine/input';
import { audio } from '../../../engine/audio';
import { text, rrect, OUT } from '../../../art/draw';
import { glyphDevice, drawGlyph, glyphWidth } from '../../../ui/glyphs';
import { game } from '../../../game/game';
import { net } from '../../../net/session';
import { profile, HERO_KINDS, type HeroKind } from '../../../net/profile';
import { Renderer3D } from '../../render';
import { RT } from '../../runtime';
import { mat, mesh, basic, noOutline, canvasTex } from '../../gfx';
import { FX3 } from '../../fx';
import { createHeroModel, HERO_INFO } from '../../models/heroes';
import type { HeroAnim, HeroRig } from '../../models/hero';
import { heroKindFor, isPrologueLevel } from './where';

/*
 * «Выбор героя»: the four heroes turning on pedestals, the chosen one in the spotlight, its name, role and abilities
 * (with the buttons for the device in hand); in a room, a tag under each hero for every friend who picked it
 * (repeats allowed). Opens over ANY scene as an overlay (its own small renderer on an offscreen canvas):
 *   openHeroPicker({ onPick?, onClose? })
 * — the lobby («Герой»), «Мой герой», the world map and the hub's Зеркало героев call it. Over a level the world keeps
 * running (co-op!) while my hero stands still; over other scenes the scene underneath pauses. Picking sets
 * profile.kind (friends see it in the room meta) and, in a level that plays picks, swaps my hero on the spot.
 */

type C = CanvasRenderingContext2D;
export interface PickerOpts {
  /** after a pick (the default handler already saved it and swapped my hero in a level) */
  onPick?: (kind: HeroKind) => void;
  /** closed (picked or not) */
  onClose?: () => void;
  /** a line under the title (e.g. «В прологе все играют Тошей») */
  note?: string;
}

const SPOTS = [-3, -1, 1, 3];
const PED_Y = 0.32;
const FOV = 34;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** a level, duck-typed (importing level.ts here would be a cycle): it swaps my hero live when it plays picks */
interface LevelLike { def: { id: string; hero?: HeroKind }; player: { setKind(k: HeroKind): void; kind: HeroKind; pos: THREE.Vector3; center(): THREE.Vector3; dead: boolean }; fx: FX3; phys: unknown }
const asLevel = (s: unknown): LevelLike | null => (s && typeof s === 'object' && 'def' in s && 'player' in s && 'phys' in s ? s as LevelLike : null);
function applyToLevel(scene: unknown, kind: HeroKind) {
  const L = asLevel(scene);
  if (!L || L.player.dead || heroKindFor(L.def) !== kind || L.player.kind === kind) return;
  L.player.setKind(kind);
  const c = L.player.center();
  L.fx.emit(c, { count: 26, speed: [1.5, 4], life: [0.3, 0.7], size: [0.18, 0.34], colors: ['#ffffff', '#f0e4f8', HERO_INFO[kind].color], drag: 3 });
  L.fx.stars(c, 14);
  audio.sfx('whoosh', { pitch: 1.3 });
}

export class HeroPicker3D {
  sel: number;
  t = 0;
  closed = false;
  private canvas = document.createElement('canvas');
  private r3: Renderer3D;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 100);
  private fx = new FX3();
  private heroes: { kind: HeroKind; rig: HeroRig; g: THREE.Group; ped: THREE.Group; anim: HeroAnim; yaw: number; k: number; cheer: number }[] = [];
  private spot: THREE.Mesh;
  private appear = 0;
  private hover = -1;

  constructor(private opts: PickerOpts = {}) {
    this.sel = Math.max(0, HERO_KINDS.indexOf(profile.kind));
    this.r3 = new Renderer3D(this.canvas);
    this.r3.ao = false;
    this.build();
    this.spot = this.scene.getObjectByName('spot') as THREE.Mesh;
    audio.sfx('menuSelect', { pitch: 1.2 });
  }

  private build() {
    const s = this.scene;
    s.background = new THREE.Color('#1e1230');
    s.fog = new THREE.Fog('#1e1230', 10, 28);
    s.add(new THREE.HemisphereLight('#ffe8d0', '#3a2448', 1.2));
    const sun = new THREE.DirectionalLight('#fff0dc', 2.1);
    sun.position.set(2, 7, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera; sc.left = -6; sc.right = 6; sc.top = 4; sc.bottom = -4; sc.near = 0.5; sc.far = 24;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
    s.add(sun, sun.target);
    const rim = new THREE.DirectionalLight('#b8a0ff', 0.9); rim.position.set(-3, 3, -5); s.add(rim);
    s.add(this.fx.group);
    const floor = mesh(new THREE.CircleGeometry(30, 48), mat('#2a1a3c'), { cast: false });
    floor.rotation.x = -Math.PI / 2; s.add(floor);
    // a mirror-hall backdrop: tall arched frames
    const frameM = mat('#c89a3a'), glassM = basic('#3a2a5a');
    for (let i = -3; i <= 3; i++) {
      const fg = new THREE.Group(); fg.position.set(i * 2.4, 0, -4.6);
      const glass = mesh(new THREE.PlaneGeometry(1.7, 3.6), glassM, { cast: false }); glass.position.y = 2.1; fg.add(glass);
      const arch = mesh(new THREE.TorusGeometry(0.85, 0.08, 8, 24, Math.PI), frameM); arch.position.y = 3.9; fg.add(arch);
      for (const sx of [-1, 1]) { const post = mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.6, 10), frameM); post.position.set(sx * 0.85, 2.1, 0); fg.add(post); }
      s.add(fg);
    }
    // pedestals + heroes
    HERO_KINDS.forEach((kind, i) => {
      const ped = new THREE.Group(); ped.position.set(SPOTS[i], 0, 0);
      const info = HERO_INFO[kind];
      const drum = mesh(new THREE.CylinderGeometry(0.72, 0.8, PED_Y, 40), mat('#4a2e5e')); drum.position.y = PED_Y / 2; ped.add(drum);
      const top = mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.03, 40), mat(info.color), { cast: false }); top.position.y = PED_Y; ped.add(top);
      const ring = mesh(new THREE.TorusGeometry(0.76, 0.03, 8, 48), mat('#f2c23a')); ring.rotation.x = Math.PI / 2; ring.position.y = PED_Y; ped.add(ring);
      s.add(ped);
      const rig = createHeroModel(kind, profile.lookOf(kind));
      const g = new THREE.Group(); g.add(rig.root); g.position.set(SPOTS[i], PED_Y, 0);
      s.add(g);
      this.heroes.push({ kind, rig, g, ped, anim: { state: 'idle', speed: 0, attack: null, weapon: 'sword', flash: 0, talk: 0, expr: 'normal', squash: 1 }, yaw: 0.4 - i * 0.3, k: 0, cheer: 0 });
    });
    const beamTex = canvasTex(4, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,240,200,0)'); gr.addColorStop(1, 'rgba(255,240,200,1)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 1.0, 6, 32, 1, true), basic('#fff0d0', { transparent: true, opacity: 0.07, side: THREE.DoubleSide, additive: true, map: beamTex, depthWrite: false }));
    beam.name = 'spot'; beam.position.y = 3 + PED_Y;
    s.add(noOutline(beam));
  }

  get kind(): HeroKind { return HERO_KINDS[this.sel]; }

  private move(d: number) {
    this.sel = (this.sel + d + HERO_KINDS.length) % HERO_KINDS.length;
    this.heroes[this.sel].cheer = 1.0;
    audio.sfx('menuMove');
  }

  private pick() {
    const kind = this.kind;
    profile.setKind(kind);
    applyToLevel(game.scene, kind);
    audio.sfx('menuSelect');
    this.opts.onPick?.(kind);
    this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.opts.onClose?.();
  }

  /** screen position (UI units) of a point on the stage */
  private ui(p: THREE.Vector3) {
    const v = p.clone().project(this.cam);
    return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, vis: v.z < 1 };
  }

  update(dt: number) {
    if (this.closed) return;
    this.t += dt;
    this.appear = Math.min(1, this.appear + dt * 4);
    // input (the scene underneath gets none: see the overlay host)
    if (input.pressed('back') || input.pressed('pause')) { audio.sfx('menuMove'); this.close(); return; }
    if (input.pressed('left') || input.pressed('camL')) this.move(-1);
    if (input.pressed('right') || input.pressed('camR')) this.move(1);
    // mouse: hover a hero to select, click to pick
    this.hover = -1;
    for (let i = 0; i < this.heroes.length; i++) {
      const p = this.ui(V(SPOTS[i], PED_Y + 0.6, 0));
      if (Math.abs(input.mouseX - p.x) < 120 && input.mouseY > 90 && input.mouseY < 470) this.hover = i;
    }
    if (input.mouseMoved && this.hover >= 0 && this.hover !== this.sel) this.move(this.hover - this.sel);
    if ((input.mouseClicked && this.hover >= 0) || input.pressed('confirm') || input.pressed('jump')) { this.pick(); return; }
    // stage
    for (let i = 0; i < this.heroes.length; i++) {
      const h = this.heroes[i];
      const on = i === this.sel;
      h.k = damp(h.k, on ? 1 : 0, 9, dt);
      h.cheer = Math.max(0, h.cheer - dt);
      h.yaw += dt * (on ? 0.9 : 0.35);
      h.g.rotation.y = h.yaw;
      h.g.position.z = h.k * 0.55;
      h.ped.position.z = h.g.position.z;
      h.g.scale.setScalar(1 + h.k * 0.22);
      h.anim.state = h.cheer > 0 ? 'cheer' : on ? 'idle' : 'idle';
      h.anim.expr = on ? 'happy' : 'normal';
      h.rig.update(dt, h.anim);
    }
    const cur = this.heroes[this.sel];
    this.spot.position.x = damp(this.spot.position.x, SPOTS[this.sel], 12, dt);
    this.spot.position.z = cur.g.position.z;
    (this.spot.material as THREE.MeshBasicMaterial).opacity = 0.06 + Math.sin(this.t * 1.3) * 0.015;
    if (Math.random() < 0.3) this.fx.glow.emit(V(SPOTS[this.sel] + (Math.random() - 0.5) * 1.4, 0.4 + Math.random() * 2, cur.g.position.z + (Math.random() - 0.5)), { count: 1, speed: [0.05, 0.25], life: [1, 2], size: [0.03, 0.06], colors: ['#fff0c0', HERO_INFO[cur.kind].color], g: -0.2 });
    this.fx.update(dt);
  }

  draw(ctx: C) {
    if (this.closed) return;
    // the stage: rendered at the UI area's real pixel size, drawn under the panels
    const pw = Math.max(320, Math.round(W * RT.scale)), ph = Math.max(180, Math.round(H * RT.scale));
    if (this.r3.width !== pw || this.r3.height !== ph) this.r3.setSize(pw, ph, Math.min(2, window.devicePixelRatio || 1));
    this.cam.aspect = W / H; this.cam.updateProjectionMatrix();
    this.cam.position.set(0, 1.75, 8.6); this.cam.lookAt(0, 0.42, 0);
    this.fx.setScale(ph * 0.9);
    this.r3.render(this.scene, this.cam);
    ctx.save();
    ctx.globalAlpha = this.appear;
    ctx.drawImage(this.canvas, 0, 0, W, H);
    ctx.globalAlpha = 1;
    const dev = glyphDevice();
    text(ctx, 'Выбор героя', W / 2, 52, { size: 42, color: '#ffd34a', align: 'center', stroke: 8 });
    if (this.opts.note) text(ctx, this.opts.note, W / 2, 84, { size: 17, font: 'body', color: '#e8dcf0', align: 'center', stroke: 4 });
    // who picked whom (co-op): tags under the pedestals; mine is marked
    const picks: { kind: HeroKind; name: string; color: string; me: boolean }[] = [];
    if (net.active) for (const m of net.members.values()) picks.push({ kind: m.isMe ? profile.kind : m.hero.kind, name: m.name, color: m.look.tagColor || '#ffd34a', me: m.isMe });
    else picks.push({ kind: profile.kind, name: profile.name, color: profile.look.tagColor, me: true });
    for (let i = 0; i < HERO_KINDS.length; i++) {
      const kind = HERO_KINDS[i];
      const h = this.heroes[i];
      const base = this.ui(V(SPOTS[i], 0, h.g.position.z + 0.82));
      const on = i === this.sel;
      text(ctx, HERO_INFO[kind].name, base.x, base.y + 14, { size: on ? 26 : 20, color: on ? HERO_INFO[kind].color : '#d8c8e8', align: 'center', stroke: 6 });
      // tags of who picked this hero, stacked above his head
      const top = this.ui(V(SPOTS[i], PED_Y + (kind === 'bublik' ? 0.95 : 1.3) * h.g.scale.y, h.g.position.z));
      const list = picks.filter((p) => p.kind === kind);
      list.forEach((p, j) => {
        ctx.font = '700 15px Rubik, sans-serif';
        const label = p.me ? `${p.name} (ты)` : p.name;
        const w = ctx.measureText(label).width + 18;
        const y = top.y - 30 - j * 24;
        rrect(ctx, base.x - w / 2, y, w, 21, 9, p.color, 2);
        text(ctx, label, base.x, y + 15, { size: 15, weight: 700, color: OUT, align: 'center' });
      });
    }
    // the info panel
    const info = HERO_INFO[this.kind];
    const px = 70, py = 500, pwid = W - 140, phh = 178;
    rrect(ctx, px + 6, py + 6, pwid, phh, 22, 'rgba(0,0,0,0.3)', 0);
    rrect(ctx, px, py, pwid, phh, 22, 'rgba(36,20,48,0.9)', 4);
    text(ctx, info.name, px + 30, py + 46, { size: 38, color: info.color, stroke: 7 });
    wrapLines(info.role, 30).forEach((ln, i) => text(ctx, ln, px + 30, py + 82 + i * 22, { size: 17, font: 'body', color: '#f0e4f8' }));
    if (profile.kind === this.kind) text(ctx, '✓ сейчас выбран', px + 30, py + 150, { size: 15, font: 'body', color: '#9ff0a0' });
    // abilities with the buttons for the device in hand (right half)
    info.abilities.forEach((a, i) => {
      const xx = px + pwid * 0.46, yy = py + 30 + i * 30;
      const gw = drawGlyph(ctx, a.act, xx, yy, 22, 'left', dev);
      text(ctx, a.name, xx + gw + 8, yy + 6, { size: 17, weight: 700, color: '#ffe9a0' });
      ctx.font = '700 17px Rubik, sans-serif';
      const nw = ctx.measureText(a.name).width;
      if (a.text) text(ctx, '— ' + a.text, xx + gw + 14 + nw, yy + 6, { size: 15, font: 'body', color: '#d8c8e8' });
    });
    // prompts
    const items: Array<[Parameters<typeof drawGlyph>[1][], string]> = [[['left', 'right'], 'выбрать'], [['confirm'], `играть: ${info.name}`], [['back'], 'назад']];
    let x = W / 2 - 250;
    const y = H - 22;
    rrect(ctx, W / 2 - 280, y - 17, 560, 34, 14, 'rgba(255,246,226,0.92)', 3);
    for (const [acts, label] of items) {
      for (const a of acts) x += drawGlyph(ctx, a, x, y, 22, 'left', dev) + 4;
      text(ctx, label, x + 2, y + 6, { size: 16, font: 'body', color: OUT });
      ctx.font = '400 16px Pangolin, sans-serif';
      x += ctx.measureText(label).width + 26;
    }
    void glyphWidth; void clamp;
    ctx.restore();
  }

  dispose() {
    for (const h of this.heroes) h.rig.dispose();
    const geos = new Set<THREE.BufferGeometry>();
    this.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m.parent && this.heroes.some((h) => h.rig.root === m.parent))) geos.add(m.geometry); });
    // (shared model geometries come from the kit cache and stay)
    (this.r3 as unknown as { renderer: THREE.WebGLRenderer }).renderer.dispose();
    (this.r3 as unknown as { renderer: THREE.WebGLRenderer }).renderer.forceContextLoss();
  }
}

// ───────────────────────── the overlay host ─────────────────────────
let active: HeroPicker3D | null = null;
let installed = false;

/** wrap the game loop once: the picker reads its keys first, then the scene runs with the input modal (no actions) */
function install() {
  if (installed) return;
  installed = true;
  const g = game as unknown as { update(dt: number): void; render(ctx: C, drawFade?: boolean): void };
  const u = g.update.bind(g), r = g.render.bind(g);
  g.update = (dt: number) => {
    const p = active;
    if (!p) { u(dt); return; }
    p.update(dt);
    // the scene underneath keeps running (a co-op world must) but gets no input while the picker is up
    const click = input.mouseClicked, wheel = input.wheel;
    input.modal = true; input.mouseClicked = false; input.wheel = 0;
    try { u(dt); } finally { input.modal = false; input.mouseClicked = click; input.wheel = wheel; }
    if (p.closed) { if (active === p) active = null; p.dispose(); input.clearAll(); }
  };
  g.render = (ctx: C, drawFade?: boolean) => {
    r(ctx, drawFade);
    if (active && !active.closed) active.draw(ctx);
  };
}

/** open «Выбор героя» over whatever is on screen (one at a time; returns it) */
export function openHeroPicker(opts: PickerOpts = {}): HeroPicker3D {
  install();
  if (active && !active.closed) return active;
  const L = asLevel(game.scene);
  const note = opts.note ?? (L && isPrologueLevel(L.def.id) ? 'В прологе все играют Тошей — выбор пригодится в Хрумляндии' : undefined);
  active = new HeroPicker3D({ ...opts, note });
  input.releaseLock();
  input.clearAll();
  return active;
}
/** the picker is up */
export function heroPickerOpen() { return !!active && !active.closed; }

function wrapLines(s: string, max: number): string[] {
  const out: string[] = []; let cur = '';
  for (const w of s.split(' ')) { if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) out.push(cur);
  return out;
}
